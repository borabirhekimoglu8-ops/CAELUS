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
import os
import stat
import sys
from pathlib import Path
from typing import Any, Callable


AUDIT_GENESIS_CTX = b"CAELUS_AUDIT_GENESIS_V1"
AUDIT_SEAL_CTX = b"CAELUS_AUDIT_SEAL_V1"
NEURAL_MODEL_SIGNATURE_CTX = b"CAELUS_NEURAL_MODEL_V1\0"
NEURAL_PACKAGE_ID_CTX = b"CAELUS_NEURAL_PACKAGE_ID_V1\0"
ZERO_HEX_32 = "0" * 64
FP_ONE = 1_000_000
NEURAL_MINIMUM_CONFIDENCE_FP = 650_000
NEURAL_MAXIMUM_OOD_FP = 500_000
NEURAL_POLICY_V1_HASH = "3ba5fa3cea21e9b52e36944661e039765a559cc5e653847d788d7e60544641e2"
MAX_NEURAL_ARTIFACT_BYTES = 16 * 1024 * 1024
MAX_NEURAL_EVENTS_PER_SESSION = 100_000

NEURAL_ACCEPTED_DECISIONS = {
    "ACCEPTED_ADVISORY",
    "ACCEPTED_BOUNDED",
}
NEURAL_GATE_DECISIONS = NEURAL_ACCEPTED_DECISIONS | {
    "REJECTED_LOW_CONFIDENCE",
    "REJECTED_OOD",
    "REJECTED_RANGE",
    "REJECTED_INVARIANT",
    "REJECTED_TIMEOUT",
    "REJECTED_MODEL_TRUST",
    "REJECTED_SCHEMA",
    "REJECTED_RUNTIME",
    "SYMBOLIC_FALLBACK",
}
NEURAL_RUNTIME_STATUSES = {
    "OK",
    "MODEL_UNAVAILABLE",
    "MODEL_UNTRUSTED",
    "SCHEMA_MISMATCH",
    "MALFORMED_INPUT",
    "UNSUPPORTED_OPERATOR",
    "DIMENSION_MISMATCH",
    "OVERFLOW",
    "TIMEOUT",
    "RUNTIME_FAILURE",
}


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


def parse_i64(value: Any, where: str) -> int:
    if isinstance(value, bool):
        raise VerificationError(f"{where}: expected i64")
    if isinstance(value, int) and -(1 << 63) <= value <= (1 << 63) - 1:
        return value
    raise VerificationError(f"{where}: expected i64")


def expect_bool(value: Any, where: str) -> bool:
    if not isinstance(value, bool):
        raise VerificationError(f"{where}: expected boolean")
    return value


def expect_string(value: Any, where: str, maximum: int = 256) -> str:
    if not isinstance(value, str) or not value or len(value) > maximum:
        raise VerificationError(f"{where}: expected non-empty string <= {maximum} chars")
    return value


def expect_list(value: Any, where: str, maximum: int) -> list[Any]:
    if not isinstance(value, list) or len(value) > maximum:
        raise VerificationError(f"{where}: expected array with <= {maximum} entries")
    return value


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


def strict_json_loads(text: str, where: str) -> Any:
    def reject_duplicates(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
        result: dict[str, Any] = {}
        for key, value in pairs:
            if key in result:
                raise VerificationError(f"{where}: duplicate JSON key {key!r}")
            result[key] = value
        return result

    def reject_nonfinite(value: str) -> None:
        raise VerificationError(f"{where}: non-finite JSON number {value}")

    try:
        return json.loads(
            text,
            object_pairs_hook=reject_duplicates,
            parse_constant=reject_nonfinite,
        )
    except (json.JSONDecodeError, RecursionError) as exc:
        raise VerificationError(f"{where}: invalid JSON") from exc


def line_object(raw_line: bytes, where: str) -> dict[str, Any]:
    try:
        text = raw_line.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise VerificationError(f"{where}: invalid JSON line") from exc
    obj = strict_json_loads(text, where)
    if not isinstance(obj, dict):
        raise VerificationError(f"{where}: line must be a JSON object")
    return obj


def read_regular_file_bounded(path: Path, maximum: int, where: str) -> bytes:
    absolute_path = path.absolute()
    for parent in absolute_path.parents:
        if parent == parent.parent:
            break
        try:
            parent_metadata = parent.lstat()
        except OSError as exc:
            raise VerificationError(
                f"{where}: cannot stat parent directory {parent}: {exc}"
            ) from exc
        if stat.S_ISLNK(parent_metadata.st_mode):
            raise VerificationError(
                f"{where}: symbolic-link parent directories are not allowed: {parent}"
            )
        if not stat.S_ISDIR(parent_metadata.st_mode):
            raise VerificationError(f"{where}: parent is not a directory: {parent}")
    try:
        metadata = path.lstat()
    except OSError as exc:
        raise VerificationError(f"{where}: cannot stat {path}: {exc}") from exc
    if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISREG(metadata.st_mode):
        raise VerificationError(f"{where}: {path} must be a regular non-symlink file")
    if metadata.st_size <= 0 or metadata.st_size > maximum:
        raise VerificationError(
            f"{where}: {path} must contain 1..{maximum} bytes"
        )
    flags = os.O_RDONLY | getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_BINARY", 0)
    flags |= getattr(os, "O_NOFOLLOW", 0)
    try:
        descriptor = os.open(path, flags)
    except OSError as exc:
        raise VerificationError(f"{where}: cannot open {path}: {exc}") from exc
    try:
        opened_metadata = os.fstat(descriptor)
        if not stat.S_ISREG(opened_metadata.st_mode):
            raise VerificationError(f"{where}: {path} is not a regular file")
        if (
            opened_metadata.st_dev != metadata.st_dev
            or opened_metadata.st_ino != metadata.st_ino
            or opened_metadata.st_mode != metadata.st_mode
            or opened_metadata.st_mtime_ns != metadata.st_mtime_ns
            or opened_metadata.st_size != metadata.st_size
            or opened_metadata.st_size <= 0
            or opened_metadata.st_size > maximum
        ):
            raise VerificationError(f"{where}: {path} changed before it was opened")
        chunks: list[bytes] = []
        total = 0
        while True:
            chunk = os.read(descriptor, min(64 * 1024, maximum - total + 1))
            if not chunk:
                break
            chunks.append(chunk)
            total += len(chunk)
            if total > maximum:
                raise VerificationError(f"{where}: {path} grew beyond its limit")
        if total != opened_metadata.st_size:
            raise VerificationError(f"{where}: {path} changed while being read")
        final_opened_metadata = os.fstat(descriptor)
        try:
            final_path_metadata = path.lstat()
        except OSError as exc:
            raise VerificationError(
                f"{where}: cannot re-stat {path} after reading: {exc}"
            ) from exc
        identity_fields = ("st_dev", "st_ino", "st_mode", "st_size", "st_mtime_ns")
        if any(
            getattr(final_opened_metadata, field) != getattr(opened_metadata, field)
            or getattr(final_path_metadata, field) != getattr(opened_metadata, field)
            for field in identity_fields
        ):
            raise VerificationError(f"{where}: {path} changed while being read")
        return b"".join(chunks)
    finally:
        os.close(descriptor)


def load_neural_model_reference(
    directory: Path,
    blake3_module: Any,
    verifier: Callable[[bytes, bytes, bytes], None] | None,
    trusted_pubkey: bytes | None,
    verify_signature: bool,
) -> dict[str, Any]:
    where = f"neural model {directory}"
    manifest_bytes = read_regular_file_bounded(
        directory / "manifest.json", 64 * 1024, where
    )
    weights = read_regular_file_bounded(
        directory / "weights.bin", MAX_NEURAL_ARTIFACT_BYTES, where
    )
    signature_bytes = read_regular_file_bounded(
        directory / "model.sig", 512, where
    )
    try:
        manifest_text = manifest_bytes.decode("utf-8", errors="strict")
    except UnicodeDecodeError as exc:
        raise VerificationError(f"{where}: manifest is not valid UTF-8") from exc
    manifest = strict_json_loads(manifest_text, f"{where}: manifest")
    if not isinstance(manifest, dict):
        raise VerificationError(f"{where}: manifest must be a JSON object")

    manifest_hash = blake3_digest(blake3_module, manifest_bytes)
    weights_hash = blake3_digest(blake3_module, weights)
    package_hash = blake3_digest(
        blake3_module, NEURAL_PACKAGE_ID_CTX + manifest_hash + weights_hash
    )
    expected_weights_hash = expect_hex(
        manifest.get("weights_hash"), 64, f"{where}: weights_hash"
    )
    expected_model_hash = expect_hex(
        manifest.get("model_hash"), 64, f"{where}: model_hash"
    )
    if bytes.fromhex(expected_weights_hash) != weights_hash:
        raise VerificationError(f"{where}: weights_hash does not match weights.bin")
    if bytes.fromhex(expected_model_hash) != weights_hash:
        raise VerificationError(f"{where}: model_hash does not match weights.bin")
    if parse_u64(manifest.get("weights_size"), f"{where}: weights_size") != len(weights):
        raise VerificationError(f"{where}: weights_size does not match weights.bin")

    try:
        signature_text = signature_bytes.decode("ascii", errors="strict").strip()
    except UnicodeDecodeError as exc:
        raise VerificationError(f"{where}: model.sig is not ASCII") from exc
    parts = signature_text.split(":")
    if len(parts) != 3 or parts[0] != "ed25519":
        raise VerificationError(f"{where}: malformed model.sig")
    public_key = bytes.fromhex(expect_hex(parts[1], 64, f"{where}: signer pubkey"))
    signature = bytes.fromhex(expect_hex(parts[2], 128, f"{where}: signature"))
    signer_identity = expect_hex(
        manifest.get("signer_identity"), 64, f"{where}: signer_identity"
    )
    if public_key.hex() != signer_identity:
        raise VerificationError(f"{where}: signer_identity does not match model.sig")
    if trusted_pubkey is not None and public_key != trusted_pubkey:
        raise VerificationError(f"{where}: signer does not match trusted neural pubkey")
    if verify_signature:
        if verifier is None:
            raise VerificationError(
                "neural model signature verification requires 'cryptography' or 'pynacl'"
            )
        try:
            verifier(
                public_key,
                signature,
                NEURAL_MODEL_SIGNATURE_CTX + manifest_hash + weights_hash,
            )
        except VerificationError as exc:
            raise VerificationError(f"{where}: model signature is invalid") from exc

    return {
        "model_id": expect_string(manifest.get("model_id"), f"{where}: model_id", 63),
        "model_version": expect_string(
            manifest.get("model_version"), f"{where}: model_version", 31
        ),
        "manifest_hash": manifest_hash.hex(),
        "weights_hash": weights_hash.hex(),
        "package_hash": package_hash.hex(),
        "signer_pubkey": public_key.hex(),
    }


class NeuralSemanticVerifier:
    """Validate cross-event neural evidence after the cryptographic chain."""

    def __init__(
        self,
        model_reference: dict[str, Any] | None = None,
        require_model_reference: bool = True,
    ) -> None:
        self.model_reference = model_reference
        self.require_model_reference = require_model_reference
        self.session_id: int | None = None
        self.scenario_id: str | None = None
        self.scenario_hash: str | None = None
        self.scenario_authorized = False
        self.pending_authority: dict[str, Any] | None = None
        self.trust_after_by_node: dict[str, int] = {}
        self.evidence_ids: set[str] = set()
        self.last_neural_tick: int | None = None
        self.inference_count = 0
        self.authority_count = 0

    def begin_session(self, session_id: int, where: str, continuation: bool) -> None:
        if continuation:
            if self.session_id is not None and self.session_id != session_id:
                raise VerificationError(
                    f"{where}: rotated segment changed neural session_id"
                )
            self.session_id = session_id
            return
        if self.session_id is not None:
            self.finish_session(where)
        self.session_id = session_id
        self.scenario_id = None
        self.scenario_hash = None
        self.scenario_authorized = False
        self.pending_authority = None
        self.trust_after_by_node.clear()
        self.evidence_ids.clear()
        self.last_neural_tick = None

    def finish_session(self, where: str) -> None:
        if self.pending_authority is not None:
            raise VerificationError(
                f"{where}: missing neural authority resolution for "
                f"tick {self.pending_authority['tick']}"
            )

    def _expect_session(self, event: dict[str, Any], where: str) -> None:
        if self.session_id is None:
            raise VerificationError(f"{where}: neural event precedes GENESIS")
        event_session = expect_hex(
            event.get("session_id"), 16, f"{where}: session_id"
        )
        if int(event_session, 16) != self.session_id:
            raise VerificationError(f"{where}: neural event session_id mismatch")

    def _observe_scenario(self, event: dict[str, Any], where: str) -> None:
        if self.pending_authority is not None:
            raise VerificationError(
                f"{where}: scenario changed with unresolved neural authority"
            )
        if self.scenario_id is not None:
            raise VerificationError(
                f"{where}: duplicate SCENARIO_ACTIVATED within one audit session"
            )
        self.scenario_id = expect_string(
            event.get("scenario_id"), f"{where}: scenario_id", 63
        )
        self.scenario_hash = expect_hex(
            event.get("scenario_hash"), 64, f"{where}: scenario_hash"
        )
        if self.scenario_hash == ZERO_HEX_32:
            raise VerificationError(f"{where}: scenario_hash must not be zero")
        authorized = expect_bool(
            event.get("neural_assurance_authorized"),
            f"{where}: neural_assurance_authorized",
        )
        if authorized and (
            event.get("signature_status") != "VERIFIED"
            or event.get("signature_scheme") != "ed25519+pinned"
        ):
            raise VerificationError(
                f"{where}: neural assurance requires a pinned verified scenario"
            )
        self.scenario_authorized = authorized
        self.trust_after_by_node.clear()

    def _observe_inference(self, event: dict[str, Any], where: str) -> None:
        self._expect_session(event, where)
        if self.pending_authority is not None:
            raise VerificationError(
                f"{where}: prior neural inference has no authority resolution"
            )
        if self.scenario_id is None or self.scenario_hash is None:
            raise VerificationError(
                f"{where}: neural inference precedes SCENARIO_ACTIVATED"
            )
        scenario_id = expect_string(
            event.get("scenario_id"), f"{where}: scenario_id", 63
        )
        scenario_hash = expect_hex(
            event.get("scenario_hash"), 64, f"{where}: scenario_hash"
        )
        if scenario_id != self.scenario_id or scenario_hash != self.scenario_hash:
            raise VerificationError(f"{where}: neural scenario commitment mismatch")

        tick = parse_u64(event.get("tick"), f"{where}: tick")
        if self.last_neural_tick is not None and tick <= self.last_neural_tick:
            raise VerificationError(
                f"{where}: neural inference ticks must be strictly increasing"
            )
        model_hash = expect_hex(event.get("model_hash"), 64, f"{where}: model_hash")
        manifest_hash = expect_hex(
            event.get("manifest_hash"), 64, f"{where}: manifest_hash"
        )
        input_hash = expect_hex(event.get("input_hash"), 64, f"{where}: input_hash")
        output_hash = expect_hex(
            event.get("output_hash"), 64, f"{where}: output_hash"
        )
        policy_hash = expect_hex(
            event.get("policy_hash"), 64, f"{where}: policy_hash"
        )
        if policy_hash != NEURAL_POLICY_V1_HASH:
            raise VerificationError(f"{where}: untrusted Neural Policy V1 commitment")
        evidence_id = expect_hex(
            event.get("evidence_id"), 64, f"{where}: evidence_id"
        )
        if evidence_id != output_hash:
            raise VerificationError(f"{where}: evidence_id must equal output_hash")
        if evidence_id in self.evidence_ids:
            raise VerificationError(f"{where}: replayed neural evidence_id")
        if output_hash == ZERO_HEX_32 or policy_hash == ZERO_HEX_32:
            raise VerificationError(f"{where}: output/policy commitments must not be zero")

        runtime_status = expect_string(
            event.get("runtime_status"), f"{where}: runtime_status", 48
        )
        gate_decision = expect_string(
            event.get("gate_decision"), f"{where}: gate_decision", 48
        )
        if runtime_status not in NEURAL_RUNTIME_STATUSES:
            raise VerificationError(f"{where}: unknown neural runtime_status")
        if gate_decision not in NEURAL_GATE_DECISIONS:
            raise VerificationError(f"{where}: unknown neural gate_decision")
        accepted = gate_decision in NEURAL_ACCEPTED_DECISIONS
        model_trusted = expect_bool(
            event.get("model_trusted"), f"{where}: model_trusted"
        )
        fallback = expect_bool(event.get("fallback"), f"{where}: fallback")
        authority_expected = expect_bool(
            event.get("authority_expected"), f"{where}: authority_expected"
        )
        if accepted:
            if not self.scenario_authorized:
                raise VerificationError(
                    f"{where}: accepted output is not authorized by the active scenario"
                )
            if runtime_status != "OK" or not model_trusted:
                raise VerificationError(
                    f"{where}: accepted output lacks trusted successful inference"
                )
            if fallback or not authority_expected:
                raise VerificationError(
                    f"{where}: accepted output has inconsistent fallback/authority flags"
                )
            if input_hash == ZERO_HEX_32 or model_hash == ZERO_HEX_32:
                raise VerificationError(
                    f"{where}: accepted output has a zero input/model commitment"
                )
            if manifest_hash == ZERO_HEX_32:
                raise VerificationError(
                    f"{where}: accepted output has a zero manifest commitment"
                )
            if event.get("model_load_status") != "LOADED":
                raise VerificationError(
                    f"{where}: accepted output does not report a loaded model"
                )
            expect_string(event.get("model_id"), f"{where}: model_id", 63)
            expect_string(event.get("model_version"), f"{where}: model_version", 31)
        elif not fallback or authority_expected:
            raise VerificationError(
                f"{where}: rejected output has inconsistent fallback/authority flags"
            )

        confidence = parse_i64(
            event.get("confidence_min_fp"), f"{where}: confidence_min_fp"
        )
        ood = parse_i64(event.get("ood_max_fp"), f"{where}: ood_max_fp")
        if not 0 <= confidence <= FP_ONE or not 0 <= ood <= FP_ONE:
            raise VerificationError(f"{where}: confidence/OOD outside fixed-point range")
        if accepted and (
            confidence < NEURAL_MINIMUM_CONFIDENCE_FP
            or ood > NEURAL_MAXIMUM_OOD_FP
        ):
            raise VerificationError(
                f"{where}: accepted output violates Neural Policy V1 thresholds"
            )
        if parse_u64(
            event.get("feature_schema_version"), f"{where}: feature_schema_version"
        ) != 1:
            raise VerificationError(f"{where}: unsupported neural feature schema")
        if event.get("runtime_mode") != "DETERMINISTIC_FIXED_POINT_ASSURANCE":
            raise VerificationError(f"{where}: unsupported neural runtime_mode")

        if accepted and self.model_reference is None and self.require_model_reference:
            raise VerificationError(
                f"{where}: accepted neural evidence requires --neural-model-dir"
            )
        if self.model_reference is not None and model_trusted:
            expected = self.model_reference
            if (
                model_hash != expected["package_hash"]
                or manifest_hash != expected["manifest_hash"]
                or event.get("model_id") != expected["model_id"]
                or event.get("model_version") != expected["model_version"]
            ):
                raise VerificationError(
                    f"{where}: neural event does not reference the pinned model package"
                )

        self.inference_count += 1
        if self.inference_count > MAX_NEURAL_EVENTS_PER_SESSION:
            raise VerificationError(
                f"{where}: neural event count exceeds verifier safety limit"
            )
        self.last_neural_tick = tick
        self.evidence_ids.add(evidence_id)
        if authority_expected:
            self.pending_authority = {
                "tick": tick,
                "evidence_id": evidence_id,
                "model_hash": model_hash,
                "input_hash": input_hash,
                "output_hash": output_hash,
                "policy_hash": policy_hash,
                "gate_decision": gate_decision,
            }

    def _validate_proposals(self, event: dict[str, Any], where: str) -> None:
        proposals = expect_list(
            event.get("applied_proposals"), f"{where}: applied_proposals", 64
        )
        seen_indices: set[int] = set()
        seen_ids: set[str] = set()
        pending_updates: dict[str, int] = {}
        for index, proposal in enumerate(proposals):
            item_where = f"{where}: applied_proposals[{index}]"
            if not isinstance(proposal, dict):
                raise VerificationError(f"{item_where}: expected object")
            node_index = parse_u64(proposal.get("node_index"), f"{item_where}: node_index")
            node_id = expect_string(proposal.get("node_id"), f"{item_where}: node_id", 63)
            before = parse_i64(
                proposal.get("trust_before_fp"), f"{item_where}: trust_before_fp"
            )
            delta = parse_i64(proposal.get("delta_fp"), f"{item_where}: delta_fp")
            after = parse_i64(
                proposal.get("trust_after_fp"), f"{item_where}: trust_after_fp"
            )
            if node_index in seen_indices or node_id in seen_ids:
                raise VerificationError(f"{item_where}: duplicate node proposal")
            if not 0 <= before <= FP_ONE or not 0 <= after <= FP_ONE:
                raise VerificationError(f"{item_where}: trust outside fixed-point range")
            if not -50_000 <= delta <= 50_000 or before + delta != after:
                raise VerificationError(f"{item_where}: invalid bounded trust transition")
            previous = self.trust_after_by_node.get(node_id)
            if previous is not None and previous != before:
                raise VerificationError(f"{item_where}: trust pre-state breaks audit history")
            seen_indices.add(node_index)
            seen_ids.add(node_id)
            pending_updates[node_id] = after
        self.trust_after_by_node.update(pending_updates)

    def _validate_levers(self, event: dict[str, Any], where: str) -> None:
        levers = expect_list(
            event.get("lever_candidates"), f"{where}: lever_candidates", 32
        )
        selected_ids: list[str] = []
        for index, lever in enumerate(levers):
            item_where = f"{where}: lever_candidates[{index}]"
            if not isinstance(lever, dict):
                raise VerificationError(f"{item_where}: expected object")
            expect_string(lever.get("lever_id"), f"{item_where}: lever_id", 63)
            for field in ("neural_score_fp", "symbolic_score_fp"):
                score = parse_i64(lever.get(field), f"{item_where}: {field}")
                if not 0 <= score <= FP_ONE:
                    raise VerificationError(f"{item_where}: {field} outside range")
            if expect_bool(lever.get("selected"), f"{item_where}: selected"):
                selected_ids.append(lever["lever_id"])
        selected = event.get("selected_lever_id")
        if not isinstance(selected, str) or len(selected) > 63:
            raise VerificationError(f"{where}: invalid selected_lever_id")
        if len(selected_ids) > 1 or (selected_ids and selected != selected_ids[0]):
            raise VerificationError(f"{where}: selected lever flags are inconsistent")
        if selected and not selected_ids:
            raise VerificationError(f"{where}: selected_lever_id has no selected candidate")

    def _observe_authority(self, event: dict[str, Any], where: str) -> None:
        self._expect_session(event, where)
        pending = self.pending_authority
        if pending is None:
            raise VerificationError(f"{where}: neural authority has no inference evidence")
        linked = {
            "tick": parse_u64(event.get("tick"), f"{where}: tick"),
            "evidence_id": expect_hex(
                event.get("evidence_id"), 64, f"{where}: evidence_id"
            ),
            "model_hash": expect_hex(
                event.get("model_hash"), 64, f"{where}: model_hash"
            ),
            "input_hash": expect_hex(
                event.get("input_hash"), 64, f"{where}: input_hash"
            ),
            "output_hash": expect_hex(
                event.get("output_hash"), 64, f"{where}: output_hash"
            ),
            "policy_hash": expect_hex(
                event.get("policy_hash"), 64, f"{where}: policy_hash"
            ),
        }
        for key, value in linked.items():
            if value != pending[key]:
                raise VerificationError(f"{where}: authority {key} mismatch")

        event_type = event.get("type")
        if event_type == "NEURAL_AUTHORITY_V1":
            if event.get("gate_decision") != pending["gate_decision"]:
                raise VerificationError(f"{where}: authority gate_decision mismatch")
            if not expect_bool(
                event.get("authority_committed"), f"{where}: authority_committed"
            ):
                raise VerificationError(f"{where}: authority event was not committed")
            if expect_bool(
                event.get("symbolic_state_overwritten"),
                f"{where}: symbolic_state_overwritten",
            ):
                raise VerificationError(f"{where}: neural output overwrote symbolic state")
            if expect_bool(
                event.get("outage_latch_overridden"),
                f"{where}: outage_latch_overridden",
            ):
                raise VerificationError(f"{where}: neural output overrode outage latch")
            proposals = expect_list(
                event.get("applied_proposals"), f"{where}: applied_proposals", 64
            )
            if pending["gate_decision"] == "ACCEPTED_ADVISORY" and proposals:
                raise VerificationError(
                    f"{where}: advisory authority cannot apply bounded proposals"
                )
            if pending["gate_decision"] == "ACCEPTED_BOUNDED" and not proposals:
                raise VerificationError(
                    f"{where}: bounded authority contains no bounded proposals"
                )
            self._validate_proposals(event, where)
            self._validate_levers(event, where)
        else:
            committed = expect_bool(
                event.get("authority_committed"), f"{where}: authority_committed"
            )
            rollback_applied = expect_bool(
                event.get("rollback_applied"), f"{where}: rollback_applied"
            )
            rollback_failed = expect_bool(
                event.get("rollback_failed"), f"{where}: rollback_failed"
            )
            if expect_bool(
                event.get("symbolic_state_overwritten"),
                f"{where}: symbolic_state_overwritten",
            ):
                raise VerificationError(f"{where}: neural output overwrote symbolic state")
            if expect_bool(
                event.get("outage_latch_overridden"),
                f"{where}: outage_latch_overridden",
            ):
                raise VerificationError(f"{where}: neural output overrode outage latch")
            if committed:
                raise VerificationError(f"{where}: resolution cannot remain committed")
            if event_type == "NEURAL_AUTHORITY_REJECTED_V1":
                if event.get("gate_decision") != "REJECTED_INVARIANT":
                    raise VerificationError(
                        f"{where}: authority rejection has invalid gate_decision"
                    )
                if rollback_applied or rollback_failed:
                    raise VerificationError(
                        f"{where}: pre-commit rejection cannot report rollback"
                    )
            elif event_type == "NEURAL_AUTHORITY_ROLLBACK_V1":
                if event.get("gate_decision") != "SYMBOLIC_FALLBACK":
                    raise VerificationError(
                        f"{where}: rollback has invalid gate_decision"
                    )
                advisory_noop = (
                    pending["gate_decision"] == "ACCEPTED_ADVISORY"
                    and not rollback_applied
                    and not rollback_failed
                )
                if not advisory_noop and rollback_applied == rollback_failed:
                    raise VerificationError(
                        f"{where}: rollback must report exactly one terminal result"
                    )
                if rollback_failed:
                    raise VerificationError(
                        f"{where}: symbolic rollback failed; session is unsafe"
                    )

        self.pending_authority = None
        self.authority_count += 1

    def observe_event(self, event: Any, where: str) -> None:
        if not isinstance(event, dict):
            raise VerificationError(f"{where}: EVENT payload must be a JSON object")
        event_type = event.get("type")
        if event_type == "SCENARIO_ACTIVATED":
            self._observe_scenario(event, where)
        elif event_type == "NEURAL_INFERENCE_V1":
            self._observe_inference(event, where)
        elif event_type in {
            "NEURAL_AUTHORITY_V1",
            "NEURAL_AUTHORITY_REJECTED_V1",
            "NEURAL_AUTHORITY_ROLLBACK_V1",
        }:
            self._observe_authority(event, where)


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
    neural_semantics: NeuralSemanticVerifier | None,
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
                    if neural_semantics is not None:
                        neural_semantics.begin_session(
                            session_id, where, continuation=False
                        )
                    continue
                if chain_head is not None:
                    raise VerificationError(f"{where}: duplicate GENESIS")
                session_id, chain_head = verify_genesis(
                    blake3_module,
                    obj,
                    previous_segment_head,
                    where,
                )
                if neural_semantics is not None:
                    neural_semantics.begin_session(
                        session_id,
                        where,
                        continuation=previous_segment_head is not None,
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
                if neural_semantics is not None:
                    neural_semantics.observe_event(obj.get("event"), where)
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
    parser.add_argument(
        "--neural-model-dir",
        type=Path,
        help=(
            "optional signed model package whose identity must match every "
            "trusted NEURAL_INFERENCE_V1 event"
        ),
    )
    parser.add_argument(
        "--trusted-neural-pubkey-hex",
        help="32-byte ed25519 public-key pin for --neural-model-dir",
    )
    parser.add_argument(
        "--skip-neural-semantics",
        action="store_true",
        help="verify only the generic chain/SEAL structure, not NEURAL_* event linkage",
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
        trusted_neural_pubkey = None
        if args.trusted_neural_pubkey_hex:
            trusted_neural_pubkey = bytes.fromhex(
                expect_hex(
                    args.trusted_neural_pubkey_hex,
                    64,
                    "--trusted-neural-pubkey-hex",
                )
            )
        if args.neural_model_dir and trusted_neural_pubkey is None:
            raise VerificationError(
                "--neural-model-dir requires --trusted-neural-pubkey-hex"
            )
        if trusted_neural_pubkey is not None and args.neural_model_dir is None:
            raise VerificationError(
                "--trusted-neural-pubkey-hex requires --neural-model-dir"
            )

        model_reference = None
        if args.neural_model_dir is not None:
            model_reference = load_neural_model_reference(
                args.neural_model_dir,
                blake3_module,
                verifier,
                trusted_neural_pubkey,
                verify_signature=True,
            )
        neural_semantics = (
            None
            if args.skip_neural_semantics
            else NeuralSemanticVerifier(model_reference)
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
                neural_semantics,
            )
        if neural_semantics is not None:
            neural_semantics.finish_session(str(segments[-1]))
            if args.verbose:
                print(
                    "neural semantics: "
                    f"inferences={neural_semantics.inference_count} "
                    f"authority_resolutions={neural_semantics.authority_count}"
                )
        print(f"OK: verified {len(segments)} segment(s), final_chain_head={previous_head.hex()}")
        return 0
    except VerificationError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
