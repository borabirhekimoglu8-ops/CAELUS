#!/usr/bin/env python3
"""Rebuild, sign, and verify a disposable CAELUS Neural V1 package offline."""

from __future__ import annotations

import argparse
import importlib.util
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import tempfile
from types import ModuleType


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SIGNER = (
    ROOT
    / "target"
    / "release"
    / ("caelus_sign_model.exe" if os.name == "nt" else "caelus_sign_model")
)
GENERATOR = ROOT / "caelus_ml" / "generate_dataset.py"
TRAINER = ROOT / "caelus_ml" / "train_v1.py"
VERIFIER = ROOT / "tools" / "verify_audit_log.py"
HEX_32 = re.compile(r"^[0-9a-f]{64}$")
MAX_OUTPUT_BYTES = 2 * 1024 * 1024


class ToolchainFailure(RuntimeError):
    pass


def run_checked(command: list[str], label: str, *, timeout: int = 300) -> bytes:
    environment = os.environ.copy()
    environment["LC_ALL"] = "C"
    environment["LANG"] = "C"
    try:
        result = subprocess.run(
            command,
            cwd=ROOT,
            env=environment,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            timeout=timeout,
            check=False,
        )
    except subprocess.TimeoutExpired as error:
        raise ToolchainFailure(f"{label} timed out") from error
    if len(result.stdout) > MAX_OUTPUT_BYTES:
        raise ToolchainFailure(f"{label} exceeded the output bound")
    if result.returncode != 0:
        detail = result.stdout.decode("utf-8", errors="replace")
        raise ToolchainFailure(f"{label} exited {result.returncode}:\n{detail}")
    return result.stdout


def publish_private_key(path: Path) -> None:
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_BINARY", 0)
    descriptor = os.open(path, flags, 0o600)
    try:
        seed = os.urandom(32)
        written = 0
        while written < len(seed):
            count = os.write(descriptor, seed[written:])
            if count <= 0:
                raise ToolchainFailure("short write while creating ephemeral signing seed")
            written += count
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
    if os.name != "nt":
        os.chmod(path, 0o600)


def publish_text(path: Path, text: str) -> None:
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_BINARY", 0)
    descriptor = os.open(path, flags, 0o600)
    data = text.encode("ascii")
    try:
        written = 0
        while written < len(data):
            count = os.write(descriptor, data[written:])
            if count <= 0:
                raise ToolchainFailure(f"short write while creating {path}")
            written += count
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def load_verifier_module() -> ModuleType:
    spec = importlib.util.spec_from_file_location("caelus_audit_verifier", VERIFIER)
    if spec is None or spec.loader is None:
        raise ToolchainFailure("cannot load the committed audit verifier")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def require_signer(path: Path) -> Path:
    absolute = Path(os.path.abspath(path))
    metadata = os.lstat(absolute)
    if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISREG(metadata.st_mode):
        raise ToolchainFailure(f"signer must be a regular non-symlink file: {absolute}")
    if os.name != "nt" and not os.access(absolute, os.X_OK):
        raise ToolchainFailure(f"signer is not executable: {absolute}")
    return absolute


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--signer-binary", type=Path, default=DEFAULT_SIGNER)
    args = parser.parse_args(argv)
    try:
        signer = require_signer(args.signer_binary)
        with tempfile.TemporaryDirectory(prefix="caelus-neural-toolchain-") as temporary:
            work = Path(temporary)
            dataset = work / "dataset.jsonl"
            dataset_manifest = work / "dataset.manifest.json"
            model_directory = work / "model"
            model_directory.mkdir(mode=0o700)
            signing_key = work / "ephemeral-neural-signing.key"
            trusted_signer = work / "trusted-neural-pubkey.txt"

            run_checked(
                [
                    sys.executable,
                    str(GENERATOR),
                    "--output",
                    str(dataset),
                    "--manifest",
                    str(dataset_manifest),
                    "--samples",
                    "220",
                    "--seed",
                    "0xCAE105DEADBEEF00",
                ],
                "deterministic dataset generation",
            )

            publish_private_key(signing_key)
            public_key = run_checked(
                [
                    str(signer),
                    "--key",
                    str(signing_key),
                    "--print-public-key",
                ],
                "ephemeral public-key derivation",
            ).decode("ascii", errors="strict").strip()
            if not HEX_32.fullmatch(public_key):
                raise ToolchainFailure("model signer returned a malformed public key")
            publish_text(trusted_signer, public_key + "\n")

            run_checked(
                [
                    sys.executable,
                    str(TRAINER),
                    "--dataset",
                    str(dataset),
                    "--dataset-manifest",
                    str(dataset_manifest),
                    "--output-dir",
                    str(model_directory),
                    "--signer-identity",
                    public_key,
                    "--trusted-signer-file",
                    str(trusted_signer),
                    "--model-id",
                    "caelus-ci-disposable-v1",
                    "--model-version",
                    "1.0.0",
                    "--created-utc",
                    "2026-07-10T00:00:00Z",
                ],
                "deterministic quantized model export",
            )
            run_checked(
                [
                    str(signer),
                    "--manifest",
                    str(model_directory / "manifest.json"),
                    "--weights",
                    str(model_directory / "weights.bin"),
                    "--key",
                    str(signing_key),
                    "--output",
                    str(model_directory / "model.sig"),
                    "--write",
                ],
                "model package signing",
            )

            verifier = load_verifier_module()
            ed25519 = verifier.load_ed25519_verifier()
            if ed25519 is None:
                raise ToolchainFailure(
                    "real model-signature verification requires cryptography or pynacl"
                )
            reference = verifier.load_neural_model_reference(
                model_directory,
                verifier.load_blake3(),
                ed25519[0],
                bytes.fromhex(public_key),
                verify_signature=True,
            )
            if (
                reference.get("model_id") != "caelus-ci-disposable-v1"
                or reference.get("signer_pubkey") != public_key
                or not HEX_32.fullmatch(str(reference.get("package_hash", "")))
            ):
                raise ToolchainFailure("verified disposable package metadata is inconsistent")
            if (model_directory / "weights.bin").stat().st_size != 5_367:
                raise ToolchainFailure("exported V1 weights blob has an unexpected size")
    except (OSError, UnicodeError, ValueError, ToolchainFailure) as error:
        print(f"neural toolchain smoke: FAIL: {error}", file=sys.stderr)
        return 1
    print("neural toolchain smoke: PASS (dataset -> export -> sign -> verify)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
