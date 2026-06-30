#!/usr/bin/env python3
"""End-to-end NEGATIVE security tests for CAELUS DCE.

Unlike the golden runner (which proves the happy path), this suite proves the
system FAILS CLOSED against tampering, using the real binary and the real
ed25519 / Blake3 paths — no stubs:

  1. A tampered scenario (mutated signed field) is rejected (SIGNATURE_MISMATCH)
     and never loaded.
  2. A SELF_SIGNED_DEV scenario is rejected when the dev bypass is not set.
  3. A tampered audit log (flipped event hash) is rejected by the verifier.
  4. The audit SEAL pubkey pin (--trusted-pubkey-hex) accepts the real signer
     and rejects any other key.

Stdlib only. Requires a built binary and the verifier's blake3/ed25519 deps.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_BINARY = ROOT / "dist" / ("caelus_os.exe" if os.name == "nt" else "caelus_os")
VERIFIER = ROOT / "tools" / "verify_audit_log.py"
SIGNED_SCENARIO = ROOT / "scenarios" / "BS-01_SAHTE_UFUK.json"
AUDIT_LOG = ROOT / "caelus_audit_0000000000000000.log"
PYTHON = sys.executable or "python3"


class NegativeTestError(Exception):
    pass


def _clean_env() -> dict[str, str]:
    env = os.environ.copy()
    for key in ("CAELUS_ALLOW_DEV_SCENARIOS", "CAELUS_TRUST_ANY_PUBKEY"):
        env.pop(key, None)
    return env


def _run_repl(binary: Path, scenario_id: str) -> str:
    proc = subprocess.run(
        [str(binary), "--scenario", scenario_id, "--repl", "--det-mode"],
        input="quit\n",
        text=True,
        encoding="utf-8",
        errors="replace",
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        cwd=str(ROOT),
        env=_clean_env(),
        check=False,
    )
    return proc.stdout


def test_tampered_scenario_rejected(binary: Path) -> None:
    data = json.loads(SIGNED_SCENARIO.read_text(encoding="utf-8"))
    # Mutate a field that is inside the signed payload (extended_causal_model),
    # keeping the JSON well-formed so only the ed25519 check can catch it.
    data["id"] = "SEC-NEG-TAMPER"
    node0 = data["extended_causal_model"]["nodes"][0]
    node0["capacity_fp"] = int(node0["capacity_fp"]) + 1
    target = ROOT / "scenarios" / "SEC-NEG-TAMPER.json"
    target.write_text(json.dumps(data), encoding="utf-8")
    try:
        out = _run_repl(binary, "SEC-NEG-TAMPER")
    finally:
        target.unlink(missing_ok=True)

    if "SIGNATURE_MISMATCH" not in out:
        raise NegativeTestError(
            "tampered scenario was NOT rejected with SIGNATURE_MISMATCH:\n" + out
        )
    if "imza doğrulandı" in out or "scenario_loaded" in out:
        raise NegativeTestError("tampered scenario appears to have loaded:\n" + out)
    print("[OK] tampered scenario rejected (SIGNATURE_MISMATCH, not loaded)")


def test_self_signed_rejected_without_flag(binary: Path) -> None:
    data = json.loads(SIGNED_SCENARIO.read_text(encoding="utf-8"))
    data["id"] = "SEC-NEG-SELFSIGN"
    data["signature"] = "SELF_SIGNED_DEV"
    target = ROOT / "scenarios" / "SEC-NEG-SELFSIGN.json"
    target.write_text(json.dumps(data), encoding="utf-8")
    try:
        out = _run_repl(binary, "SEC-NEG-SELFSIGN")
    finally:
        target.unlink(missing_ok=True)

    if "SIGNATURE_MISMATCH" not in out:
        raise NegativeTestError(
            "SELF_SIGNED_DEV scenario was NOT rejected without the dev flag:\n" + out
        )
    if "scenario_loaded" in out:
        raise NegativeTestError("SELF_SIGNED_DEV scenario appears to have loaded:\n" + out)
    print("[OK] SELF_SIGNED_DEV rejected without CAELUS_ALLOW_DEV_SCENARIOS")


def _verify_audit(args: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [PYTHON, str(VERIFIER), *args],
        text=True,
        capture_output=True,
        cwd=str(ROOT),
        check=False,
    )


def _produce_audit_log(binary: Path) -> None:
    AUDIT_LOG.unlink(missing_ok=True)
    subprocess.run(
        [str(binary), "--scenario", "UNIVERSAL_BASELINE", "--det-mode"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        cwd=str(ROOT),
        env=_clean_env(),
        check=False,
    )
    if not AUDIT_LOG.exists():
        raise NegativeTestError("binary did not produce an audit log")


def _seal_pubkey() -> str:
    for line in AUDIT_LOG.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        obj = json.loads(line)
        if obj.get("type") == "SEAL":
            return str(obj["pubkey"])
    raise NegativeTestError("no SEAL record found in audit log")


def test_audit_tamper_rejected(binary: Path) -> None:
    _produce_audit_log(binary)

    baseline = _verify_audit([str(AUDIT_LOG)])
    if baseline.returncode != 0:
        raise NegativeTestError("freshly produced audit log failed to verify:\n" + baseline.stderr)
    print("[OK] fresh audit log verifies (control)")

    # Pin to the real SEAL pubkey -> must pass.
    pubkey = _seal_pubkey()
    pinned = _verify_audit([str(AUDIT_LOG), "--trusted-pubkey-hex", pubkey])
    if pinned.returncode != 0:
        raise NegativeTestError("audit log rejected its own real SEAL pubkey:\n" + pinned.stderr)
    print("[OK] audit verifies under correct trusted-pubkey pin")

    # Pin to a different pubkey (flip first nibble) -> must fail.
    flipped = ("e" if pubkey[0] != "e" else "f") + pubkey[1:]
    wrong = _verify_audit([str(AUDIT_LOG), "--trusted-pubkey-hex", flipped])
    if wrong.returncode == 0:
        raise NegativeTestError("audit verifier ACCEPTED a wrong trusted pubkey")
    print("[OK] audit rejected under wrong trusted-pubkey pin")

    # Tamper: flip one byte inside an EVENT hash and re-verify -> must fail.
    lines = AUDIT_LOG.read_text(encoding="utf-8").splitlines()
    tampered_idx = None
    for idx, line in enumerate(lines):
        obj = json.loads(line)
        if obj.get("type") == "EVENT":
            h = obj["hash"]
            obj["hash"] = (("0" if h[0] != "0" else "1") + h[1:])
            lines[idx] = json.dumps(obj)
            tampered_idx = idx
            break
    if tampered_idx is None:
        raise NegativeTestError("no EVENT record to tamper")
    backup = AUDIT_LOG.read_text(encoding="utf-8")
    AUDIT_LOG.write_text("\n".join(lines) + "\n", encoding="utf-8")
    try:
        result = _verify_audit([str(AUDIT_LOG)])
    finally:
        AUDIT_LOG.write_text(backup, encoding="utf-8")
    if result.returncode == 0:
        raise NegativeTestError("audit verifier ACCEPTED a tampered event hash")
    print("[OK] audit rejected after event-hash tamper")


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="CAELUS DCE negative security suite")
    parser.add_argument("--binary", default=str(DEFAULT_BINARY))
    args = parser.parse_args(argv)
    binary = Path(args.binary)

    if not binary.exists():
        print(f"[HATA] Binary bulunamadı: {binary}", file=sys.stderr)
        return 2
    if not SIGNED_SCENARIO.exists():
        print(f"[HATA] İmzalı senaryo bulunamadı: {SIGNED_SCENARIO}", file=sys.stderr)
        return 2

    try:
        test_tampered_scenario_rejected(binary)
        test_self_signed_rejected_without_flag(binary)
        test_audit_tamper_rejected(binary)
    except NegativeTestError as exc:
        print(f"[FAIL] {exc}", file=sys.stderr)
        return 1

    print("[OK] negative security suite passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
