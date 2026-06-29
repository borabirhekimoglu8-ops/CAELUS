#!/usr/bin/env python3
"""Verify CAELUS audit log hash chains and SEAL signatures.

Usage:
    python tools/verify_audit_log.py <logfile> [--chain-only] [--verbose]
    python tools/verify_audit_log.py <logfile> --trusted-pubkey-hex <64-hex>

If <logfile>.1, <logfile>.2, ... exist, they are verified as continuation
segments and each rotated GENESIS must reference the previous segment head.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any, Callable


AUDIT_GENESIS_CTX = b"CAELUS_AUDIT_GENESIS_V1"
AUDIT_SEAL_CTX = b"CAELUS_AUDIT_SEAL_V1"
ZERO_HEX_32 = "0" * 64


class VerificationError(Exception):
    """Raised for a log format, hash-chain, or signature verification failure."""


def load_blake3() -> Any:
    try:
        import blake3  # type: ignore
    except ImportError as exc:
        raise VerificationError(
            "Python module 'blake3' is required for chain verification. "
            "No verification was performed; install/provide it offline, then retry."
        ) from exc
    return blake3


def load_ed25519_verifier() -> tuple[Callable[[bytes, bytes, bytes], None], str] | None:
    try:
        from cryptography.exceptions import InvalidSignature  # type: ignore
        from cryptography.hazmat.primitives.asymmetric.ed25519 import (  # type: ignore
            Ed25519PublicKey,
        )

        def verify_with_cryptography(pubkey: bytes, signature: bytes, message: bytes) -> None:
            try:
                Ed25519PublicKey.from_public_bytes(pubkey).verify(signature, message)
            except InvalidSignature as exc:
                raise VerificationError("SEAL ed25519 signature is invalid") from exc

        return verify_with_cryptography, "cryptography"
    except ImportError:
        pass

    try:
        from nacl.exceptions import BadSignatureError  # type: ignore
        from nacl.signing import VerifyKey  # type: ignore

        def verify_with_pynacl(pubkey: bytes, signature: bytes, message: bytes) -> None:
            try:
                VerifyKey(pubkey).verify(message, signature)
            except BadSignatureError as exc:
                raise VerificationError("SEAL ed25519 signature is invalid") from exc

        return verify_with_pynacl, "pynacl"
    except ImportError:
        return None


def blake3_digest(blake3_module: Any, data: bytes) -> bytes:
    return blake3_module.blake3(data).digest()


def expect_hex(value: Any, width: int, where: str) -> str:
    if not isinstance(value, str):
        raise VerificationError(f"{where}: expected hex string")
    if len(value) != width:
        raise VerificationError(f"{where}: expected {width} hex chars, got {len(value)}")
    try:
        bytes.fromhex(value)
    except ValueError as exc:
        raise VerificationError(f"{where}: invalid hex") from exc
    return value.lower()


def parse_u64(value: Any, where: str) -> int:
    if isinstance(value, bool):
        raise VerificationError(f"{where}: expected u64")
    if isinstance(value, int) and 0 <= value <= 0xFFFF_FFFF_FFFF_FFFF:
        return value
    raise VerificationError(f"{where}: expected u64")


def u64_le(value: int, where: str) -> bytes:
    if not 0 <= value <= 0xFFFF_FFFF_FFFF_FFFF:
        raise VerificationError(f"{where}: value is outside u64 range")
    return value.to_bytes(8, "little")


def parse_session_id(value: Any, where: str) -> int:
    if isinstance(value, str):
        try:
            session_id = int(value, 16)
        except ValueError as exc:
            raise VerificationError(f"{where}: invalid hex session_id") from exc
        return parse_u64(session_id, f"{where}: session_id")
    if isinstance(value, int):
        return parse_u64(value, f"{where}: session_id")
    raise VerificationError(f"{where}: invalid session_id")


def line_object(raw_line: bytes, where: str) -> dict[str, Any]:
    try:
        text = raw_line.decode("utf-8")
        obj = json.loads(text)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise VerificationError(f"{where}: invalid JSON line") from exc
    if not isinstance(obj, dict):
        raise VerificationError(f"{where}: line must be a JSON object")
    return obj


def skip_ws(text: str, index: int) -> int:
    while index < len(text) and text[index] in " \t\r\n":
        index += 1
    return index


def char_to_byte_offset(text: str, index: int) -> int:
    return len(text[:index].encode("utf-8"))


def extract_event_raw_bytes(raw_line: bytes, where: str) -> bytes:
    """Return the exact bytes Rust hashed for the top-level EVENT 'event' field."""
    try:
        text = raw_line.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise VerificationError(f"{where}: event line is not UTF-8") from exc

    decoder = json.JSONDecoder()
    index = skip_ws(text, 0)
    if index >= len(text) or text[index] != "{":
        raise VerificationError(f"{where}: EVENT line must be a JSON object")
    index += 1

    while True:
        index = skip_ws(text, index)
        if index >= len(text):
            raise VerificationError(f"{where}: unterminated EVENT object")
        if text[index] == "}":
            break

        try:
            key, key_end = decoder.raw_decode(text, index)
        except json.JSONDecodeError as exc:
            raise VerificationError(f"{where}: invalid object key") from exc
        if not isinstance(key, str):
            raise VerificationError(f"{where}: object key must be a string")

        index = skip_ws(text, key_end)
        if index >= len(text) or text[index] != ":":
            raise VerificationError(f"{where}: missing ':' after key {key!r}")
        value_start_raw = index + 1
        value_start = skip_ws(text, value_start_raw)

        try:
            _, value_end = decoder.raw_decode(text, value_start)
        except json.JSONDecodeError as exc:
            raise VerificationError(f"{where}: invalid value for key {key!r}") from exc

        if key == "event":
            close_index = skip_ws(text, value_end)
            if close_index >= len(text) or text[close_index] != "}":
                raise VerificationError(f"{where}: top-level 'event' field must be last")
            start_byte = char_to_byte_offset(text, value_start_raw)
            end_byte = char_to_byte_offset(text, close_index)
            return raw_line[start_byte:end_byte]

        index = skip_ws(text, value_end)
        if index < len(text) and text[index] == ",":
            index += 1
            continue
        if index < len(text) and text[index] == "}":
            break
        raise VerificationError(f"{where}: expected ',' or '}}'")

    raise VerificationError(f"{where}: missing top-level 'event' field")


def discover_segments(logfile: Path) -> list[Path]:
    if not logfile.exists():
        raise VerificationError(f"{logfile}: file does not exist")
    paths = [logfile]
    index = 1
    while True:
        candidate = Path(f"{logfile}.{index}")
        if not candidate.exists():
            break
        paths.append(candidate)
        index += 1
    return paths


def verify_genesis(
    blake3_module: Any,
    obj: dict[str, Any],
    previous_segment_head: bytes | None,
    where: str,
) -> tuple[int, bytes]:
    session_id = parse_session_id(obj.get("session_id"), where)
    expect_hex(obj.get("prev"), 64, f"{where}: prev")
    if obj["prev"].lower() != ZERO_HEX_32:
        raise VerificationError(f"{where}: GENESIS prev must be zero")

    if "prev_segment_chain_head" in obj:
        segment = parse_u64(obj.get("segment"), f"{where}: segment")
        prev_hex = expect_hex(
            obj.get("prev_segment_chain_head"),
            64,
            f"{where}: prev_segment_chain_head",
        )
        prev_head = bytes.fromhex(prev_hex)
        if previous_segment_head is not None and prev_head != previous_segment_head:
            raise VerificationError(
                f"{where}: prev_segment_chain_head does not match previous segment SEAL"
            )
        digest_input = (
            AUDIT_GENESIS_CTX
            + u64_le(session_id, f"{where}: session_id")
            + u64_le(segment, f"{where}: segment")
            + prev_head
        )
    else:
        if previous_segment_head is not None:
            raise VerificationError(f"{where}: rotated segment missing prev_segment_chain_head")
        digest_input = AUDIT_GENESIS_CTX + u64_le(session_id, f"{where}: session_id")

    expected_hash = blake3_digest(blake3_module, digest_input)
    actual_hash = bytes.fromhex(expect_hex(obj.get("hash"), 64, f"{where}: hash"))
    if actual_hash != expected_hash:
        raise VerificationError(f"{where}: GENESIS hash mismatch")
    return session_id, expected_hash


def verify_seal_signature(
    blake3_module: Any,
    verifier: Callable[[bytes, bytes, bytes], None],
    obj: dict[str, Any],
    session_id: int,
    chain_head: bytes,
    where: str,
    trusted_pubkey: bytes | None,
) -> None:
    seq = parse_u64(obj.get("seq"), f"{where}: seq")
    pubkey = bytes.fromhex(expect_hex(obj.get("pubkey"), 64, f"{where}: pubkey"))
    fingerprint = bytes.fromhex(expect_hex(obj.get("fingerprint"), 64, f"{where}: fingerprint"))
    expected_fingerprint = blake3_digest(blake3_module, pubkey)
    if fingerprint != expected_fingerprint:
        raise VerificationError(f"{where}: SEAL fingerprint does not match pubkey")
    if trusted_pubkey is not None and pubkey != trusted_pubkey:
        raise VerificationError(f"{where}: SEAL pubkey does not match trusted pubkey")
    signature = bytes.fromhex(expect_hex(obj.get("sig"), 128, f"{where}: sig"))
    message = (
        AUDIT_SEAL_CTX
        + u64_le(session_id, f"{where}: session_id")
        + u64_le(seq, f"{where}: seq")
        + chain_head
    )
    verifier(pubkey, signature, message)


def verify_segment(
    path: Path,
    previous_segment_head: bytes | None,
    blake3_module: Any,
    verifier: Callable[[bytes, bytes, bytes], None] | None,
    chain_only: bool,
    verbose: bool,
    trusted_pubkey: bytes | None,
) -> bytes:
    chain_head: bytes | None = None
    session_id: int | None = None
    event_count = 0
    saw_seal = False

    with path.open("rb") as handle:
        for line_no, raw_line in enumerate(handle, start=1):
            raw_line = raw_line.rstrip(b"\r\n")
            if not raw_line:
                continue
            where = f"{path}:{line_no}"
            obj = line_object(raw_line, where)
            record_type = obj.get("type")

            if record_type == "GENESIS":
                if saw_seal:
                    session_id, chain_head = verify_genesis(
                        blake3_module,
                        obj,
                        None,
                        where,
                    )
                    event_count = 0
                    saw_seal = False
                    continue
                if chain_head is not None:
                    raise VerificationError(f"{where}: duplicate GENESIS")
                session_id, chain_head = verify_genesis(
                    blake3_module,
                    obj,
                    previous_segment_head,
                    where,
                )
                continue

            if chain_head is None or session_id is None:
                raise VerificationError(f"{where}: first record must be GENESIS")
            if saw_seal:
                raise VerificationError(f"{where}: records found after SEAL before next GENESIS")

            if record_type == "EVENT":
                prev_hex = expect_hex(obj.get("prev"), 64, f"{where}: prev")
                if bytes.fromhex(prev_hex) != chain_head:
                    raise VerificationError(f"{where}: EVENT prev does not match chain head")
                event_raw = extract_event_raw_bytes(raw_line, where)
                expected_hash = blake3_digest(blake3_module, chain_head + event_raw)
                actual_hash = bytes.fromhex(expect_hex(obj.get("hash"), 64, f"{where}: hash"))
                if actual_hash != expected_hash:
                    raise VerificationError(f"{where}: EVENT hash mismatch")
                chain_head = expected_hash
                event_count += 1
                continue

            if record_type == "SEAL":
                seal_head = bytes.fromhex(
                    expect_hex(obj.get("chain_head"), 64, f"{where}: chain_head")
                )
                if seal_head != chain_head:
                    raise VerificationError(f"{where}: SEAL chain_head mismatch")
                if parse_u64(obj.get("entries"), f"{where}: entries") != event_count:
                    raise VerificationError(f"{where}: SEAL entries does not match event count")
                if not chain_only:
                    if verifier is None:
                        raise VerificationError(
                            "SEAL verification requires 'cryptography' or 'pynacl'. "
                            "Use --chain-only to skip ed25519 signature verification."
                        )
                    verify_seal_signature(
                        blake3_module,
                        verifier,
                        obj,
                        session_id,
                        chain_head,
                        where,
                        trusted_pubkey,
                    )
                saw_seal = True
                continue

            raise VerificationError(f"{where}: unsupported record type {record_type!r}")

    if chain_head is None:
        raise VerificationError(f"{path}: empty audit segment")
    if not saw_seal:
        raise VerificationError(f"{path}: missing SEAL record")

    if verbose:
        print(f"ok: {path} events={event_count} chain_head={chain_head.hex()}")
    return chain_head


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Verify CAELUS audit log segments")
    parser.add_argument("logfile", type=Path, help="base log file path")
    parser.add_argument("--chain-only", action="store_true", help="skip ed25519 SEAL signatures")
    parser.add_argument(
        "--trusted-pubkey-hex",
        help="optional 32-byte ed25519 public key pin expected in every SEAL",
    )
    parser.add_argument("--verbose", action="store_true", help="print per-segment details")
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    try:
        segments = discover_segments(args.logfile)
        blake3_module = load_blake3()
        verifier_info = load_ed25519_verifier()
        verifier = verifier_info[0] if verifier_info else None
        if verifier_info and args.verbose and not args.chain_only:
            print(f"ed25519 verifier: {verifier_info[1]}")
        trusted_pubkey = None
        if args.trusted_pubkey_hex:
            trusted_pubkey = bytes.fromhex(
                expect_hex(args.trusted_pubkey_hex, 64, "--trusted-pubkey-hex")
            )

        previous_head: bytes | None = None
        for segment in segments:
            previous_head = verify_segment(
                segment,
                previous_head,
                blake3_module,
                verifier,
                args.chain_only,
                args.verbose,
                trusted_pubkey,
            )
        print(f"OK: verified {len(segments)} segment(s), final_chain_head={previous_head.hex()}")
        return 0
    except VerificationError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
