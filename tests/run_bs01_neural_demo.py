#!/usr/bin/env python3
"""Live BS-01 neural-assurance acceptance and fail-closed security gate.

The positive case runs the production binary with the committed signed model,
warms the real graph-history ring to eight ticks, requires bounded symbolic
authority, and verifies the sealed audit log with the pinned model reference.

Negative cases mutate copied model packages. They must be rejected by the real
Ed25519/Blake3 loader while the signed scenario continues in symbolic fallback.
"""

from __future__ import annotations

import argparse
from decimal import Decimal
import json
import os
from pathlib import Path
import re
import stat
import sys
import tempfile
from typing import Any, Callable

try:
    from tests.run_neural_differential import run_bounded
except ModuleNotFoundError:
    from run_neural_differential import run_bounded


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_BINARY = ROOT / "dist" / ("caelus_os.exe" if os.name == "nt" else "caelus_os")
DEFAULT_MODEL = ROOT / "models" / "assurance_v1"
SCENARIO = ROOT / "scenarios" / "BS-01_SAHTE_UFUK.json"
VERIFIER = ROOT / "tools" / "verify_audit_log.py"
AUDIT_NAME = "caelus_audit_0000000000000000.log"
DET_SEAL_PUBKEY = "acdcc8494d458f44a7aaac1d6a84ec624daee88436db2ae26e67ba645a106228"
NEURAL_PUBKEY = "c8527f9105465967aea81d07514ea11f597f32fedc7d6f8f9e7d182f999fc51f"
MAX_FILE_BYTES = 16 * 1024 * 1024
MAX_PROCESS_OUTPUT_BYTES = 2 * 1024 * 1024
ZERO_HASH = "0" * 64
GHOST_LINE = re.compile(
    r"\[NEURAL\] node=GHOST_INVENTORY "
    r"reported_fp=(-?\d+) estimated_fp=(-?\d+) authoritative_fp=(-?\d+) "
    r"anomaly_fp=(-?\d+) confidence_fp=(-?\d+) ood_fp=(-?\d+)"
)


class DemoFailure(RuntimeError):
    pass


def read_regular(path: Path, maximum: int = MAX_FILE_BYTES) -> bytes:
    metadata = os.lstat(path)
    if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISREG(metadata.st_mode):
        raise DemoFailure(f"required input must be a regular non-symlink file: {path}")
    if metadata.st_size <= 0 or metadata.st_size > maximum:
        raise DemoFailure(f"input size outside 1..{maximum} bytes: {path}")
    flags = os.O_RDONLY | getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_BINARY", 0)
    flags |= getattr(os, "O_NOFOLLOW", 0)
    descriptor = os.open(path, flags)
    try:
        opened = os.fstat(descriptor)
        if not stat.S_ISREG(opened.st_mode) or (
            opened.st_dev,
            opened.st_ino,
        ) != (metadata.st_dev, metadata.st_ino):
            raise DemoFailure(f"input changed before open: {path}")
        chunks: list[bytes] = []
        total = 0
        while True:
            chunk = os.read(descriptor, min(64 * 1024, maximum - total + 1))
            if not chunk:
                break
            total += len(chunk)
            if total > maximum:
                raise DemoFailure(f"input grew beyond {maximum} bytes: {path}")
            chunks.append(chunk)
        if total != opened.st_size:
            raise DemoFailure(f"input changed while read: {path}")
        return b"".join(chunks)
    finally:
        os.close(descriptor)


def publish(path: Path, data: bytes) -> None:
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_BINARY", 0)
    descriptor = os.open(path, flags, 0o600)
    try:
        written = 0
        while written < len(data):
            count = os.write(descriptor, data[written:])
            if count <= 0:
                raise DemoFailure(f"short write while creating {path}")
            written += count
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def copy_regular(source: Path, destination: Path, maximum: int = MAX_FILE_BYTES) -> None:
    publish(destination, read_regular(source, maximum))


def clean_environment() -> dict[str, str]:
    allowed = ("SYSTEMROOT", "WINDIR", "TEMP", "TMP", "TMPDIR")
    environment = {name: os.environ[name] for name in allowed if name in os.environ}
    environment.update(
        {
            "LC_ALL": "C",
            "LANG": "C",
            "RUST_BACKTRACE": "0",
            "CAELUS_ENCLAVE_KEY": "cae1" * 16,
        }
    )
    return environment


def run_checked(
    command: list[str],
    *,
    cwd: Path,
    label: str,
    stdin: bytes | None = None,
    timeout: int = 90,
) -> bytes:
    try:
        stdout, stderr = run_bounded(
            command,
            label,
            clean_environment(),
            timeout=timeout,
            stdin_data=stdin,
            working_directory=cwd,
        )
    except (OSError, RuntimeError) as error:
        raise DemoFailure(str(error)) from error
    output = stdout + stderr
    if len(output) > MAX_PROCESS_OUTPUT_BYTES:
        raise DemoFailure(f"{label} exceeded the output bound")
    return output


def prepare_scenario(run_directory: Path) -> None:
    scenario_directory = run_directory / "scenarios"
    scenario_directory.mkdir(mode=0o700)
    copy_regular(SCENARIO, scenario_directory / SCENARIO.name, 2 * 1024 * 1024)


def copy_model(model_directory: Path, destination: Path) -> None:
    destination.mkdir(mode=0o700)
    copy_regular(model_directory / "manifest.json", destination / "manifest.json", 64 * 1024)
    copy_regular(model_directory / "weights.bin", destination / "weights.bin")
    copy_regular(model_directory / "model.sig", destination / "model.sig", 512)


def copy_executable(binary: Path, run_directory: Path) -> Path:
    destination = run_directory / ("caelus_os.exe" if os.name == "nt" else "caelus_os")
    copy_regular(binary, destination, 50 * 1024 * 1024)
    if os.name != "nt":
        os.chmod(destination, 0o700)
    return destination


def run_engine(binary: Path, run_directory: Path, model_directory: Path, ticks: int) -> str:
    output = run_checked(
        [
            str(binary),
            "--scenario",
            "BS-01_SAHTE_UFUK",
            "--repl",
            "--det-mode",
            "--neural-assurance",
            "--neural-model",
            str(model_directory),
        ],
        cwd=run_directory,
        label="BS-01 neural assurance",
        stdin=f"tick {ticks}\nquit\n".encode("ascii"),
    )
    return output.decode("utf-8", errors="replace")


def strict_object(line: str, label: str) -> dict[str, Any]:
    def reject_duplicates(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
        value: dict[str, Any] = {}
        for key, item in pairs:
            if key in value:
                raise DemoFailure(f"{label} contains duplicate JSON key {key!r}")
            value[key] = item
        return value

    try:
        value = json.loads(
            line,
            object_pairs_hook=reject_duplicates,
            parse_float=Decimal,
            parse_constant=lambda token: (_ for _ in ()).throw(
                DemoFailure(f"{label} contains non-finite number {token}")
            ),
        )
    except (json.JSONDecodeError, UnicodeError) as error:
        raise DemoFailure(f"{label} is invalid JSON: {error}") from error
    if not isinstance(value, dict):
        raise DemoFailure(f"{label} must be a JSON object")
    return value


def audit_events(run_directory: Path) -> list[dict[str, Any]]:
    audit_path = run_directory / AUDIT_NAME
    data = read_regular(audit_path)
    try:
        text = data.decode("utf-8", errors="strict")
    except UnicodeDecodeError as error:
        raise DemoFailure("audit log is not UTF-8") from error
    if not text.endswith("\n"):
        raise DemoFailure("audit log must end with a newline")
    events: list[dict[str, Any]] = []
    saw_seal = False
    for line_number, line in enumerate(text.splitlines(), 1):
        record = strict_object(line, f"audit line {line_number}")
        if record.get("type") == "SEAL":
            saw_seal = True
        event = record.get("event")
        if record.get("type") == "EVENT" and isinstance(event, dict):
            events.append(event)
    if not saw_seal:
        raise DemoFailure("audit log has no SEAL")
    return events


def verify_audit(run_directory: Path, model_directory: Path | None) -> None:
    command = [
        sys.executable,
        str(VERIFIER),
        str(run_directory / AUDIT_NAME),
        "--trusted-pubkey-hex",
        DET_SEAL_PUBKEY,
    ]
    if model_directory is not None:
        command.extend(
            [
                "--neural-model-dir",
                str(model_directory),
                "--trusted-neural-pubkey-hex",
                NEURAL_PUBKEY,
            ]
        )
    run_checked(command, cwd=ROOT, label="external audit verification")


def require_live_observer_evidence(output: str) -> tuple[int, ...]:
    match = GHOST_LINE.search(output)
    if match is None:
        raise DemoFailure("live output has no GHOST_INVENTORY observer evidence")
    reported, estimated, authoritative, anomaly, confidence, ood = map(int, match.groups())
    if reported != 0 or authoritative <= 0 or estimated == reported:
        raise DemoFailure("observer did not distinguish reported, estimated, and symbolic state")
    if anomaly <= 0 or confidence < 650_000 or ood > 500_000:
        raise DemoFailure("observer evidence violates the committed confidence/OOD policy")
    return reported, estimated, authoritative, anomaly, confidence, ood


def positive_run(binary: Path, model_directory: Path) -> dict[str, Any]:
    with tempfile.TemporaryDirectory(prefix="caelus-bs01-neural-positive-") as temporary:
        run_directory = Path(temporary)
        prepare_scenario(run_directory)
        pinned_binary = copy_executable(binary, run_directory)
        pinned_model = run_directory / "model"
        copy_model(model_directory, pinned_model)
        # Only the baseline tick is unconditional; discovery/intel setup may
        # contribute zero or two additional pre-REPL observations. Seven REPL
        # ticks therefore guarantees a complete eight-tick history either way.
        output = run_engine(pinned_binary, run_directory, pinned_model, ticks=7)
        for marker in (
            "model_status=LOADED",
            "gate=ACCEPTED_BOUNDED fallback=false",
            "advisory_lever=",
        ):
            if marker not in output:
                raise DemoFailure(f"positive BS-01 output is missing {marker!r}")
        observer = require_live_observer_evidence(output)

        events = audit_events(run_directory)
        accepted = [
            event
            for event in events
            if event.get("type") == "NEURAL_INFERENCE_V1"
            and event.get("gate_decision") == "ACCEPTED_BOUNDED"
        ]
        if not accepted:
            raise DemoFailure("audit has no accepted bounded neural inference")
        inference = accepted[0]
        if (
            inference.get("observed_history_ticks") != 8
            or inference.get("input_hash") == ZERO_HASH
            or inference.get("model_trusted") is not True
            or inference.get("fallback") is not False
        ):
            raise DemoFailure("accepted inference lacks trusted eight-tick commitments")

        authority = next(
            (
                event
                for event in events
                if event.get("type") == "NEURAL_AUTHORITY_V1"
                and event.get("evidence_id") == inference.get("evidence_id")
            ),
            None,
        )
        if authority is None:
            raise DemoFailure("accepted inference has no linked authority event")
        if (
            authority.get("authority_committed") is not True
            or authority.get("symbolic_state_overwritten") is not False
            or authority.get("outage_latch_overridden") is not False
            or not authority.get("selected_lever_id")
        ):
            raise DemoFailure("authority event does not preserve symbolic invariants")
        proposals = authority.get("applied_proposals")
        if not isinstance(proposals, list):
            raise DemoFailure("authority event has no bounded proposal list")
        ghost = next(
            (
                proposal
                for proposal in proposals
                if isinstance(proposal, dict)
                and proposal.get("node_id") == "GHOST_INVENTORY"
            ),
            None,
        )
        if ghost is None or type(ghost.get("delta_fp")) is not int or ghost["delta_fp"] >= 0:
            raise DemoFailure("anomalous GHOST_INVENTORY telemetry did not degrade trust")
        if ghost.get("trust_after_fp") != ghost.get("trust_before_fp") + ghost["delta_fp"]:
            raise DemoFailure("GHOST_INVENTORY trust transition is not arithmetically exact")
        verify_audit(run_directory, pinned_model)
        return {
            "observer": observer,
            "input_hash": inference.get("input_hash"),
            "output_hash": inference.get("output_hash"),
            "model_hash": inference.get("model_hash"),
            "confidence_min_fp": inference.get("confidence_min_fp"),
            "ood_max_fp": inference.get("ood_max_fp"),
            "applied_proposals": authority.get("applied_proposals"),
            "lever_candidates": authority.get("lever_candidates"),
            "selected_lever_id": authority.get("selected_lever_id"),
        }


def positive_case(binary: Path, model_directory: Path) -> None:
    first = positive_run(binary, model_directory)
    replay = positive_run(binary, model_directory)
    if first != replay:
        raise DemoFailure("deterministic BS-01 neural replay changed committed evidence")
    print("[OK] BS-01 live neural observer, gate, authority, and sealed audit")


Mutation = Callable[[Path], None]


def replace_file(path: Path, data: bytes) -> None:
    path.unlink()
    publish(path, data)


def mutate_weights(model_directory: Path) -> None:
    path = model_directory / "weights.bin"
    data = bytearray(read_regular(path))
    data[-1] ^= 0x01
    replace_file(path, bytes(data))


def mutate_signature(model_directory: Path) -> None:
    path = model_directory / "model.sig"
    text = read_regular(path, 512).decode("ascii", errors="strict")
    prefix, public_key, signature = text.strip().split(":")
    signature = ("0" if signature[0] != "0" else "1") + signature[1:]
    replace_file(path, f"{prefix}:{public_key}:{signature}\n".encode("ascii"))


def mutate_signer(model_directory: Path) -> None:
    path = model_directory / "model.sig"
    text = read_regular(path, 512).decode("ascii", errors="strict")
    prefix, _public_key, signature = text.strip().split(":")
    replace_file(path, f"{prefix}:{'00' * 32}:{signature}\n".encode("ascii"))


def mutate_manifest_version(model_directory: Path) -> None:
    path = model_directory / "manifest.json"
    manifest = strict_object(read_regular(path, 64 * 1024).decode("utf-8"), "manifest")
    manifest["manifest_version"] = 2
    encoded = (
        json.dumps(manifest, sort_keys=True, separators=(",", ":"), ensure_ascii=True) + "\n"
    ).encode("ascii")
    replace_file(path, encoded)


def mutate_malformed_signature(model_directory: Path) -> None:
    path = model_directory / "model.sig"
    replace_file(path, b"not-an-ed25519-sidecar\n")


def negative_case(
    binary: Path,
    source_model: Path,
    label: str,
    expected_status: str,
    mutation: Mutation | None,
    *,
    remove_weights: bool = False,
) -> None:
    with tempfile.TemporaryDirectory(prefix=f"caelus-neural-negative-{label}-") as temporary:
        run_directory = Path(temporary)
        prepare_scenario(run_directory)
        pinned_binary = copy_executable(binary, run_directory)
        model_directory = run_directory / "model"
        copy_model(source_model, model_directory)
        if mutation is not None:
            mutation(model_directory)
        if remove_weights:
            (model_directory / "weights.bin").unlink()
        output = run_engine(pinned_binary, run_directory, model_directory, ticks=1)
        if f"model_status={expected_status}" not in output:
            raise DemoFailure(
                f"{label}: expected model_status={expected_status}, got:\n{output}"
            )
        if "gate=REJECTED_MODEL_TRUST fallback=true" not in output:
            raise DemoFailure(f"{label}: model rejection did not enter symbolic fallback")
        if "gate=ACCEPTED_" in output or "[NEURAL] node=" in output:
            raise DemoFailure(f"{label}: rejected package produced accepted neural evidence")

        events = audit_events(run_directory)
        if any(event.get("type") == "NEURAL_AUTHORITY_V1" for event in events):
            raise DemoFailure(f"{label}: rejected package produced neural authority")
        inferences = [
            event for event in events if event.get("type") == "NEURAL_INFERENCE_V1"
        ]
        if not inferences or any(
            event.get("model_trusted") is not False
            or event.get("fallback") is not True
            or event.get("gate_decision") != "REJECTED_MODEL_TRUST"
            for event in inferences
        ):
            raise DemoFailure(f"{label}: rejection audit evidence is inconsistent")
        verify_audit(run_directory, None)
    print(f"[OK] {label}: {expected_status} -> symbolic fallback")


def validate_inputs(binary: Path, model_directory: Path) -> None:
    binary_metadata = os.lstat(binary)
    if stat.S_ISLNK(binary_metadata.st_mode) or not stat.S_ISREG(binary_metadata.st_mode):
        raise DemoFailure(f"binary must be a regular non-symlink file: {binary}")
    if os.name != "nt" and not os.access(binary, os.X_OK):
        raise DemoFailure(f"binary is not executable: {binary}")
    for name, maximum in (
        ("manifest.json", 64 * 1024),
        ("weights.bin", MAX_FILE_BYTES),
        ("model.sig", 512),
    ):
        read_regular(model_directory / name, maximum)
    trusted_pin = read_regular(
        ROOT / "tools" / "caelus_neural_trusted_pubkey.txt", 128
    ).decode("ascii").strip()
    if trusted_pin != NEURAL_PUBKEY:
        raise DemoFailure("committed neural public-key pin does not match the demo gate")


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--binary", type=Path, default=DEFAULT_BINARY)
    parser.add_argument("--model-dir", type=Path, default=DEFAULT_MODEL)
    args = parser.parse_args(argv)
    binary = Path(os.path.abspath(args.binary))
    model_directory = Path(os.path.abspath(args.model_dir))

    try:
        validate_inputs(binary, model_directory)
        positive_case(binary, model_directory)
        negative_case(
            binary, model_directory, "modified-weight", "SIGNATURE_INVALID", mutate_weights
        )
        negative_case(
            binary, model_directory, "invalid-signature", "SIGNATURE_INVALID", mutate_signature
        )
        negative_case(
            binary, model_directory, "wrong-signer", "SIGNER_UNTRUSTED", mutate_signer
        )
        negative_case(
            binary,
            model_directory,
            "unsupported-manifest-auth-envelope",
            "SIGNATURE_INVALID",
            mutate_manifest_version,
        )
        negative_case(
            binary,
            model_directory,
            "malformed-signature",
            "SIGNATURE_MALFORMED",
            mutate_malformed_signature,
        )
        negative_case(
            binary,
            model_directory,
            "missing-model-file",
            "UNAVAILABLE",
            None,
            remove_weights=True,
        )
    except (DemoFailure, OSError, ValueError) as error:
        print(f"BS-01 neural demo: FAIL: {error}", file=sys.stderr)
        return 1
    print("BS-01 neural demo: PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
