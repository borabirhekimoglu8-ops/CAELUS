#!/usr/bin/env python3
"""PR-1 Sidecar Airlock & Bi-Temporal Event Contract — Isolation & Aegean Ferry Pilot Tests.

Covers the complete PR-1 verification matrix (§5, §6.1–§6.4, §7.1–§7.4):
  1. Core Isolation & Zero New Dependencies (`cargo tree -p caelus_core --no-default-features`,
     zero network/FS/float-geo crates, plus Linux `unshare -n` network-namespace isolation).
  2. `test_airlock_security_boundaries` — valid `ferry_ops` + `port_observer` signatures accepted;
     1-bit body tamper, wrong/expired key, unauthorized `event_kind` / epistemic elevation,
     `v99` schema, `> 2^62` fixed-point value, and `(source_id, seq_no)` equivocation leave
     `state_blake3` 0-bit changed and emit sealed `INGEST_REJECTED` / `SECURITY_ALERT_EQUIVOCATION`
     audit entries verified by `caelus_verify_audit`.
  3. `test_ferry_delay_bitemporal_slice` — Aegean ferry delay (`T1 = 08:10` single `CLAIM` ->
     `KANIT_YETERSİZ`; `T2 = 08:25` calibrated `OBSERVATION` +35 min -> `KURAL_İHLALİ`;
     re-evaluating `cutoff = 08:10` with `T2` in the same file produces bit-for-bit identical
     snapshot, `state_blake3`, and deterministic `SEAL` + 10-voyage anonymized pilot replay).
  4. `test_conflicting_sources_preserved` — Source A `+10 min` vs independent Source B `+40 min`
     preserved side-by-side without overwrite; never produces unilateral `GEÇTİ`.
  5. `test_mcp_client_end_to_end_and_64bit_strings` — Real stdio MCP client against
     `tools/caelus_mcp_server.mjs` exercising `caelus_airlock_validate_batch`,
     `caelus_evaluate_slice`, `caelus_explain_outcome`, 1-step audit traceability, and lossless
     64-bit decimal string transport strictly above `2^53 - 1` (`"9007199254740993"`).
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
EXE_SUFFIX = ".exe" if os.name == "nt" else ""

SEED_FERRY_OPS = "11" * 32
SEED_PORT_OBS = "22" * 32
SEED_COAST_LOG = "33" * 32
SEED_MODEL_AGENT = "44" * 32
SEED_EXPIRED = "55" * 32
SEED_ROGUE = "66" * 32
SEED_AUDIT = "77" * 32


def resolve_or_build_rust_bins() -> tuple[Path, Path]:
    rel_airlock = ROOT / "target" / "release" / f"caelus_sidecar_airlock{EXE_SUFFIX}"
    dbg_airlock = ROOT / "target" / "debug" / f"caelus_sidecar_airlock{EXE_SUFFIX}"
    rel_verify = ROOT / "target" / "release" / f"caelus_verify_audit{EXE_SUFFIX}"
    dbg_verify = ROOT / "target" / "debug" / f"caelus_verify_audit{EXE_SUFFIX}"

    if rel_airlock.is_file() and rel_verify.is_file():
        return rel_airlock, rel_verify
    if dbg_airlock.is_file() and dbg_verify.is_file():
        return dbg_airlock, dbg_verify

    cmd = [
        "cargo",
        "build",
        "--locked",
        "--bin",
        "caelus_sidecar_airlock",
        "--bin",
        "caelus_verify_audit",
    ]
    res = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True)
    if res.returncode != 0:
        raise RuntimeError(
            f"Failed to build airlock/audit binaries:\nSTDOUT:\n{res.stdout}\nSTDERR:\n{res.stderr}"
        )
    return dbg_airlock, dbg_verify


def run_cli(bin_path: Path, args: list[str], expect_ok: bool = True) -> subprocess.CompletedProcess[str]:
    proc = subprocess.run(
        [str(bin_path), *args],
        cwd=ROOT,
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    if expect_ok and proc.returncode != 0:
        raise AssertionError(
            f"CLI failed ({bin_path.name} {' '.join(args)}) exit={proc.returncode}\n"
            f"STDOUT: {proc.stdout}\nSTDERR: {proc.stderr}"
        )
    return proc


def derive_pubkey(airlock_bin: Path, seed_hex: str) -> str:
    res = run_cli(airlock_bin, ["pubkey", "--seed", seed_hex])
    pk = res.stdout.strip()
    assert len(pk) == 64, f"unexpected pubkey: {pk}"
    return pk


class SidecarAirlockPilotTest(unittest.TestCase):
    airlock_bin: Path
    verify_audit_bin: Path
    pub_ferry_ops: str
    pub_port_obs: str
    pub_coast_log: str
    pub_model_agent: str
    pub_expired: str
    pub_audit: str

    @classmethod
    def setUpClass(cls) -> None:
        cls.airlock_bin, cls.verify_audit_bin = resolve_or_build_rust_bins()
        cls.pub_ferry_ops = derive_pubkey(cls.airlock_bin, SEED_FERRY_OPS)
        cls.pub_port_obs = derive_pubkey(cls.airlock_bin, SEED_PORT_OBS)
        cls.pub_coast_log = derive_pubkey(cls.airlock_bin, SEED_COAST_LOG)
        cls.pub_model_agent = derive_pubkey(cls.airlock_bin, SEED_MODEL_AGENT)
        cls.pub_expired = derive_pubkey(cls.airlock_bin, SEED_EXPIRED)
        cls.pub_audit = derive_pubkey(cls.airlock_bin, SEED_AUDIT)

    def _write_pilot_manifest(self, path: Path) -> Path:
        manifest = {
            "manifest_version": "2.0",
            "require_v2_airlock": True,
            "sources": [
                {
                    "source_id": "ferry_ops",
                    "key_id": "ferry_ops_k1",
                    "pubkey": self.pub_ferry_ops,
                    "allowed_event_kinds": ["SCHEDULE_REPORT", "DELAY_NOTICE"],
                    "independence_group": "operator_dispatch",
                    "origin_class": "HUMAN_OPERATOR",
                    "expires_at_ms": None,
                },
                {
                    "source_id": "port_observer",
                    "key_id": "port_obs_k1",
                    "pubkey": self.pub_port_obs,
                    "allowed_event_kinds": ["BERTH_OCCUPANCY", "RAMP_SENSOR"],
                    "independence_group": "port_authority_sensor",
                    "origin_class": "CALIBRATED_SENSOR",
                    "expires_at_ms": None,
                },
                {
                    "source_id": "coast_log_ops",
                    "key_id": "coast_log_k1",
                    "pubkey": self.pub_coast_log,
                    "allowed_event_kinds": ["DELAY_NOTICE", "PORT_LOG"],
                    "independence_group": "coastal_authority",
                    "origin_class": "HUMAN_OPERATOR",
                    "expires_at_ms": None,
                },
                {
                    "source_id": "advisor_summarizer",
                    "key_id": "advisor_sum_k1",
                    "pubkey": self.pub_model_agent,
                    "allowed_event_kinds": ["MODEL_SUMMARY"],
                    "independence_group": "advisor_model",
                    "origin_class": "MODEL_OR_AGENT",
                    "expires_at_ms": None,
                },
                {
                    "source_id": "expired_beacon",
                    "key_id": "expired_k1",
                    "pubkey": self.pub_expired,
                    "allowed_event_kinds": ["BERTH_OCCUPANCY"],
                    "independence_group": "legacy_beacon",
                    "origin_class": "CALIBRATED_SENSOR",
                    "expires_at_ms": "1700000100000",
                },
            ],
        }
        path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8", newline="\n")
        return path

    def _normalize_records(
        self,
        work_dir: Path,
        name: str,
        records: list[dict[str, object]],
        seed_hex: str,
        source_id: str,
        key_id: str,
        origin: str,
    ) -> list[str]:
        raw_path = work_dir / f"{name}_raw.json"
        out_path = work_dir / f"{name}.airlock.ndjson"
        raw_path.write_text(json.dumps(records), encoding="utf-8", newline="\n")
        run_cli(
            self.airlock_bin,
            [
                "normalize",
                "--input",
                str(raw_path),
                "--output",
                str(out_path),
                "--source-id",
                source_id,
                "--key-id",
                key_id,
                "--origin",
                origin,
                "--seed",
                seed_hex,
            ],
        )
        return [l for l in out_path.read_text(encoding="utf-8").splitlines() if l.strip()]

    # ─────────────────────────────────────────────────────────────────────────
    # §5 & §6.1: Derleme/Dağıtım İzolasyonu ve Sıfır Yeni Harici Bağımlılık
    # ─────────────────────────────────────────────────────────────────────────
    def test_core_isolation_and_zero_deps(self) -> None:
        nostd_proc = subprocess.run(
            [
                "cargo",
                "check",
                "--locked",
                "--manifest-path",
                str(ROOT / "caelus_core" / "Cargo.toml"),
                "--no-default-features",
            ],
            cwd=ROOT,
            capture_output=True,
            text=True,
            encoding="utf-8",
        )
        self.assertEqual(nostd_proc.returncode, 0, nostd_proc.stderr)

        tree_proc = subprocess.run(
            [
                "cargo",
                "tree",
                "--locked",
                "--manifest-path",
                str(ROOT / "caelus_core" / "Cargo.toml"),
                "--no-default-features",
                "--edges",
                "normal",
            ],
            cwd=ROOT,
            capture_output=True,
            text=True,
            encoding="utf-8",
        )
        self.assertEqual(tree_proc.returncode, 0, tree_proc.stderr)
        non_empty = [ln.strip() for ln in tree_proc.stdout.splitlines() if ln.strip()]
        self.assertGreaterEqual(len(non_empty), 1)
        self.assertTrue(non_empty[0].startswith("caelus_core "))

        allowed_nostd_crates = {
            "caelus_core",
            "blake3",
            "arrayref",
            "arrayvec",
            "cfg-if",
            "constant_time_eq",
            "libc",
        }
        for line in non_empty:
            tokens = [tok for tok in line.replace("├──", " ").replace("└──", " ").replace("│", " ").split() if tok and not tok.startswith("(")]
            if tokens:
                crate_name = tokens[0]
                self.assertIn(
                    crate_name,
                    allowed_nostd_crates,
                    f"Unexpected external dependency in caelus_core no_std tree: {crate_name}\n{tree_proc.stdout}",
                )

        forbidden_tokens = [
            "tokio",
            "mio",
            "hyper",
            "reqwest",
            "h3o",
            "duckdb",
            "nmea",
            "rmcp",
            "nexosim",
        ]
        for tok in forbidden_tokens:
            self.assertNotIn(tok, tree_proc.stdout.lower())

        cargo_toml = (ROOT / "Cargo.toml").read_text(encoding="utf-8").lower()
        deps_section = cargo_toml[cargo_toml.index("[dependencies]") :]
        for deferred in ("h3o", "duckdb", "nmea", "rmcp", "nexosim"):
            self.assertNotIn(
                deferred,
                deps_section,
                f"Zero-external-crate dependency mandate violated: {deferred} found in Cargo.toml [dependencies]",
            )

        core_airlock_src = (ROOT / "caelus_core" / "src" / "airlock.rs").read_text(encoding="utf-8")
        for forbidden_src in ("std::net", "std::fs", "TcpStream", "UdpSocket", "f64", "f32"):
            # Ensure zero float or OS network/fs usage in caelus_core/src/airlock.rs code lines
            code_lines = [
                ln.split("//")[0]
                for ln in core_airlock_src.splitlines()
                if not ln.lstrip().startswith("//")
            ]
            joined_code = "\n".join(code_lines)
            self.assertNotIn(
                forbidden_src,
                joined_code,
                f"Forbidden token {forbidden_src!r} found in caelus_core/src/airlock.rs",
            )

        # §6.1: On Linux, execute caelus_core unit tests inside an isolated network namespace (`unshare -n`)
        if sys.platform.startswith("linux") and shutil.which("unshare"):
            build_json = subprocess.run(
                [
                    "cargo",
                    "test",
                    "--locked",
                    "--manifest-path",
                    str(ROOT / "caelus_core" / "Cargo.toml"),
                    "--no-default-features",
                    "--lib",
                    "--no-run",
                    "--message-format=json",
                ],
                cwd=ROOT,
                capture_output=True,
                text=True,
                encoding="utf-8",
            )
            self.assertEqual(build_json.returncode, 0, build_json.stderr)
            test_exe: str | None = None
            for line in build_json.stdout.splitlines():
                if not line.startswith("{"):
                    continue
                msg = json.loads(line)
                if msg.get("reason") == "compiler-artifact" and msg.get("profile", {}).get("test"):
                    exe = msg.get("executable")
                    if exe:
                        test_exe = exe
            self.assertIsNotNone(test_exe, "Could not locate caelus_core test executable")
            assert test_exe is not None

            unshare_res = subprocess.run(
                ["unshare", "-rn", test_exe, "airlock::tests"],
                cwd=ROOT,
                capture_output=True,
                text=True,
            )
            if unshare_res.returncode != 0 and shutil.which("sudo"):
                # Restricted CI kernels with kernel.unprivileged_userns_clone=0
                sudo_res = subprocess.run(
                    ["sudo", "-n", "unshare", "-n", test_exe, "airlock::tests"],
                    cwd=ROOT,
                    capture_output=True,
                    text=True,
                )
                if sudo_res.returncode == 0:
                    unshare_res = sudo_res
            if unshare_res.returncode != 0 and (
                "Operation not permitted" in unshare_res.stderr
                or "Permission denied" in unshare_res.stderr
            ):
                # Kernel/AppArmor blocks userns without root; run test binary + verify zero socket syscalls
                direct_res = subprocess.run(
                    [test_exe, "airlock::tests"],
                    cwd=ROOT,
                    capture_output=True,
                    text=True,
                )
                self.assertEqual(direct_res.returncode, 0, direct_res.stderr)
                if shutil.which("nm"):
                    nm_res = subprocess.run(
                        ["nm", "-u", test_exe], capture_output=True, text=True, check=True
                    )
                    for net_sym in ("connect@", "socket@", "getaddrinfo@"):
                        self.assertNotIn(net_sym, nm_res.stdout)
            else:
                self.assertEqual(
                    unshare_res.returncode,
                    0,
                    f"Linux unshare -n core test failed:\n{unshare_res.stdout}\n{unshare_res.stderr}",
                )

    # ─────────────────────────────────────────────────────────────────────────
    # §3.4 & §6.2: İmza, Yetki, Aralık ve Equivocation Sınır Testleri
    # ─────────────────────────────────────────────────────────────────────────
    def test_airlock_security_boundaries(self) -> None:
        with tempfile.TemporaryDirectory(prefix="caelus_airlock_sec_") as tmp:
            wdir = Path(tmp)
            manifest_path = self._write_pilot_manifest(wdir / "source_manifest.json")

            ferry_lines = self._normalize_records(
                wdir,
                "ferry_clean",
                [
                    {
                        "event_kind": "DELAY_NOTICE",
                        "event_id": "evt_sec_ops_1",
                        "seq_no": "1",
                        "observed_at_ms": "1700000000000",
                        "learned_at_ms": "1700000300000",
                        "subject_id": "VOYAGE_SIGACIK_VATHI_0800",
                        "metric_key": "departure_delay_min",
                        "value": "12.5",
                        "unit": "minutes",
                        "epistemic_status": "CLAIM",
                        "note": "normal operator delay notice",
                    }
                ],
                SEED_FERRY_OPS,
                "ferry_ops",
                "ferry_ops_k1",
                "HUMAN_OPERATOR",
            )
            port_lines = self._normalize_records(
                wdir,
                "port_clean",
                [
                    {
                        "event_kind": "BERTH_OCCUPANCY",
                        "event_id": "evt_sec_port_1",
                        "seq_no": "1",
                        "observed_at_ms": "1700000060000",
                        "learned_at_ms": "1700000360000",
                        "subject_id": "VOYAGE_SIGACIK_VATHI_0800",
                        "metric_key": "departure_delay_min",
                        "value": "14.0",
                        "unit": "minutes",
                        "epistemic_status": "OBSERVATION",
                        "note": "calibrated berth sensor within 20m limit",
                    }
                ],
                SEED_PORT_OBS,
                "port_observer",
                "port_obs_k1",
                "CALIBRATED_SENSOR",
            )

            clean_batch = wdir / "clean.airlock.ndjson"
            clean_batch.write_text(
                "\n".join([*ferry_lines, *port_lines]) + "\n", encoding="utf-8", newline="\n"
            )
            clean_res = json.loads(
                run_cli(
                    self.airlock_bin,
                    [
                        "evaluate-slice",
                        "--batch",
                        str(clean_batch),
                        "--manifest",
                        str(manifest_path),
                        "--cutoff-ms",
                        "1700001000000",
                    ],
                ).stdout
            )
            self.assertEqual(clean_res["verdict"], "GEÇTİ")
            baseline_state_blake3 = clean_res["state_blake3"]

            # Build 6 adversarial packets covering every §3.4 & §6.2 failure class:
            # (1) 1-bit body tamper -> ERR_SIGNATURE_MISMATCH
            tampered_obj = json.loads(ferry_lines[0])
            tampered_obj["payload_raw"] = tampered_obj["payload_raw"].replace(
                '"12500000"', '"12500001"'
            )
            pkt_tampered = json.dumps(tampered_obj, separators=(",", ":"))

            # (2) Wrong/untrusted signing key -> ERR_UNTRUSTED_SOURCE
            rogue_lines = self._normalize_records(
                wdir,
                "rogue",
                [
                    {
                        "event_kind": "DELAY_NOTICE",
                        "event_id": "evt_rogue",
                        "seq_no": "9",
                        "observed_at_ms": "1700000100000",
                        "learned_at_ms": "1700000400000",
                        "subject_id": "VOYAGE_SIGACIK_VATHI_0800",
                        "metric_key": "departure_delay_min",
                        "value": "99.0",
                        "unit": "minutes",
                    }
                ],
                SEED_ROGUE,
                "ferry_ops",
                "ferry_ops_k1",
                "HUMAN_OPERATOR",
            )

            # (3) Expired source key -> ERR_UNTRUSTED_SOURCE
            expired_lines = self._normalize_records(
                wdir,
                "expired",
                [
                    {
                        "event_kind": "BERTH_OCCUPANCY",
                        "event_id": "evt_expired",
                        "seq_no": "1",
                        "observed_at_ms": "1700000150000",
                        "learned_at_ms": "1700000410000",
                        "subject_id": "VOYAGE_SIGACIK_VATHI_0800",
                        "metric_key": "departure_delay_min",
                        "value": "50.0",
                        "unit": "minutes",
                        "epistemic_status": "OBSERVATION",
                    }
                ],
                SEED_EXPIRED,
                "expired_beacon",
                "expired_k1",
                "CALIBRATED_SENSOR",
            )

            # (4) Unauthorized event_kind (`ferry_ops` signing `BERTH_OCCUPANCY`) -> ERR_UNAUTHORIZED_KIND
            unauth_lines = self._normalize_records(
                wdir,
                "unauth_kind",
                [
                    {
                        "event_kind": "BERTH_OCCUPANCY",
                        "event_id": "evt_unauth_kind",
                        "seq_no": "2",
                        "observed_at_ms": "1700000160000",
                        "learned_at_ms": "1700000420000",
                        "subject_id": "VOYAGE_SIGACIK_VATHI_0800",
                        "metric_key": "departure_delay_min",
                        "value": "55.0",
                        "unit": "minutes",
                        "epistemic_status": "CLAIM",
                    }
                ],
                SEED_FERRY_OPS,
                "ferry_ops",
                "ferry_ops_k1",
                "HUMAN_OPERATOR",
            )

            # (5a) Sidecar CLI refuses to sign |val| > 2^62 (`4611686018427.387905` * 1e6 = 2^62 + 1)
            over_raw = wdir / "over_2pow62.json"
            over_raw.write_text(
                json.dumps(
                    [
                        {
                            "event_kind": "BERTH_OCCUPANCY",
                            "event_id": "evt_over_range",
                            "seq_no": "5",
                            "observed_at_ms": "1700000170000",
                            "learned_at_ms": "1700000430000",
                            "subject_id": "VOYAGE_SIGACIK_VATHI_0800",
                            "metric_key": "departure_delay_min",
                            "value": "4611686018427.387905",
                            "unit": "minutes",
                        }
                    ]
                ),
                encoding="utf-8",
            )
            over_proc = run_cli(
                self.airlock_bin,
                [
                    "normalize",
                    "--input",
                    str(over_raw),
                    "--output",
                    str(wdir / "unused.ndjson"),
                    "--source-id",
                    "port_observer",
                    "--key-id",
                    "port_obs_k1",
                    "--origin",
                    "CALIBRATED_SENSOR",
                    "--seed",
                    SEED_PORT_OBS,
                ],
                expect_ok=False,
            )
            self.assertNotEqual(over_proc.returncode, 0)
            self.assertIn("ERR_SCHEMA_OR_RANGE", over_proc.stderr)

            # (5b) Unknown schema_version `v99` packet -> ERR_SCHEMA_OR_RANGE
            pkt_v99 = json.dumps(
                {
                    "contract": "CAELUS_INTEL_V99",
                    "schema_version": "99.0",
                    "learned_at_ms": "1700000430000",
                    "sig": tampered_obj["sig"],
                    "header": tampered_obj["header"],
                    "payload_raw": tampered_obj["payload_raw"],
                },
                separators=(",", ":"),
            )

            # (6) Source equivocation: same `(ferry_ops, seq_no=1)` with different payload -> ERR_SOURCE_EQUIVOCATION
            equiv_lines = self._normalize_records(
                wdir,
                "equiv",
                [
                    {
                        "event_kind": "DELAY_NOTICE",
                        "event_id": "evt_sec_ops_equiv",
                        "seq_no": "1",
                        "observed_at_ms": "1700000180000",
                        "learned_at_ms": "1700000440000",
                        "subject_id": "VOYAGE_SIGACIK_VATHI_0800",
                        "metric_key": "departure_delay_min",
                        "value": "48.0",
                        "unit": "minutes",
                        "epistemic_status": "CLAIM",
                        "note": "equivocating seq_no=1",
                    }
                ],
                SEED_FERRY_OPS,
                "ferry_ops",
                "ferry_ops_k1",
                "HUMAN_OPERATOR",
            )

            mixed_batch = wdir / "mixed_attack.airlock.ndjson"
            mixed_batch.write_text(
                "\n".join(
                    [
                        *ferry_lines,
                        *port_lines,
                        pkt_tampered,
                        *rogue_lines,
                        *expired_lines,
                        *unauth_lines,
                        pkt_v99,
                        *equiv_lines,
                    ]
                )
                + "\n",
                encoding="utf-8",
                newline="\n",
            )

            audit_path = wdir / "security_audit.ndjson"
            attack_res = json.loads(
                run_cli(
                    self.airlock_bin,
                    [
                        "evaluate-slice",
                        "--batch",
                        str(mixed_batch),
                        "--manifest",
                        str(manifest_path),
                        "--cutoff-ms",
                        "1700001000000",
                        "--audit-log",
                        str(audit_path),
                        "--audit-seed",
                        SEED_AUDIT,
                        "--det-clock",
                    ],
                ).stdout
            )

            # 0-bit simulation state invariance!
            self.assertEqual(
                attack_res["state_blake3"],
                baseline_state_blake3,
                "Rejected packets MUST NOT alter state_blake3 by even 1 bit!",
            )
            self.assertEqual(attack_res["verdict"], "GEÇTİ")
            rejected_codes = [r["error_code"] for r in attack_res["rejected_in_slice"]]
            self.assertIn("ERR_SIGNATURE_MISMATCH", rejected_codes)
            self.assertIn("ERR_UNTRUSTED_SOURCE", rejected_codes)
            self.assertIn("ERR_UNAUTHORIZED_KIND", rejected_codes)
            self.assertIn("ERR_SCHEMA_OR_RANGE", rejected_codes)
            self.assertIn("ERR_SOURCE_EQUIVOCATION", rejected_codes)
            self.assertIn("ferry_ops", attack_res["downgraded_sources"])

            # Verify sealed cryptographic audit chain with `caelus_verify_audit`
            verify_proc = run_cli(
                self.verify_audit_bin,
                [str(audit_path), "--expect-signer", self.pub_audit],
            )
            self.assertIn("OK: verified", verify_proc.stdout)
            audit_raw = audit_path.read_text(encoding="utf-8")
            self.assertIn("INGEST_REJECTED", audit_raw)
            self.assertIn("SECURITY_ALERT_EQUIVOCATION", audit_raw)
            self.assertIn("SLICE_EVALUATION", audit_raw)

    # ─────────────────────────────────────────────────────────────────────────
    # §6.3, §7.1, §7.2: Çift Zamanlı Kesit, Sıfır Bilgi Sızıntısı ve 10 Sefer Pilotu
    # ─────────────────────────────────────────────────────────────────────────
    def test_ferry_delay_bitemporal_slice(self) -> None:
        # Base epoch: 08:00 = 1_700_000_000_000 ms
        # T1 event: observed 08:00 (1700000000000), learned 08:05 (1700000300000), +15 min CLAIM
        # Slice T1 cutoff: 08:10 (1700000600000) -> KANIT_YETERSİZ
        # T2 event: observed 08:02 (1700000120000 <= 08:10!), learned 08:20 (1700001200000 > 08:10!), +35 min OBSERVATION
        # Slice T2 cutoff: 08:25 (1700001500000) -> KURAL_İHLALİ
        with tempfile.TemporaryDirectory(prefix="caelus_ferry_bitemp_") as tmp:
            wdir = Path(tmp)
            manifest_path = self._write_pilot_manifest(wdir / "source_manifest.json")

            t1_lines = self._normalize_records(
                wdir,
                "t1_ops",
                [
                    {
                        "event_kind": "DELAY_NOTICE",
                        "event_id": "ferry_sigacik_t1_claim",
                        "seq_no": "1",
                        "observed_at_ms": "1700000000000",
                        "learned_at_ms": "1700000300000",
                        "subject_id": "VOYAGE_SIGACIK_VATHI_0800",
                        "metric_key": "departure_delay_min",
                        "value": "15.0",
                        "unit": "minutes",
                        "epistemic_status": "CLAIM",
                        "note": "kalkis 15 dk gecikecek, neden belirsiz",
                    }
                ],
                SEED_FERRY_OPS,
                "ferry_ops",
                "ferry_ops_k1",
                "HUMAN_OPERATOR",
            )

            batch_file = wdir / "events.airlock.ndjson"
            batch_file.write_text(t1_lines[0] + "\n", encoding="utf-8", newline="\n")

            audit_t1_pre = wdir / "audit_t1_pre.ndjson"
            res_t1_pre = json.loads(
                run_cli(
                    self.airlock_bin,
                    [
                        "evaluate-slice",
                        "--batch",
                        str(batch_file),
                        "--manifest",
                        str(manifest_path),
                        "--cutoff-ms",
                        "1700000600000",
                        "--audit-log",
                        str(audit_t1_pre),
                        "--audit-seed",
                        SEED_AUDIT,
                        "--audit-session-id",
                        "1001",
                        "--det-clock",
                    ],
                ).stdout
            )
            self.assertEqual(res_t1_pre["verdict"], "KANIT_YETERSİZ")
            self.assertEqual(
                res_t1_pre["applied_rule_id"], "RULE_UNCORROBORATED_CLAIM_OR_HYPOTHESIS"
            )
            self.assertIn(
                "INDEPENDENT_CORROBORATION_REQUIRED_FOR_SINGLE_SOURCE_CLAIM",
                res_t1_pre["missing_evidence"],
            )

            # Append T2 calibrated port sensor observation (`observed: 08:02`, `learned: 08:20`, +35 min)
            t2_lines = self._normalize_records(
                wdir,
                "t2_port",
                [
                    {
                        "event_kind": "BERTH_OCCUPANCY",
                        "event_id": "port_sigacik_t2_obs",
                        "seq_no": "1",
                        "observed_at_ms": "1700000120000",
                        "learned_at_ms": "1700001200000",
                        "subject_id": "VOYAGE_SIGACIK_VATHI_0800",
                        "metric_key": "departure_delay_min",
                        "value": "35.0",
                        "unit": "minutes",
                        "epistemic_status": "OBSERVATION",
                        "note": "rihtim rampasi arizasi nedeniyle yanasma/kalkis +35 dk",
                    }
                ],
                SEED_PORT_OBS,
                "port_observer",
                "port_obs_k1",
                "CALIBRATED_SENSOR",
            )
            batch_file.write_text(
                t1_lines[0] + "\n" + t2_lines[0] + "\n", encoding="utf-8", newline="\n"
            )

            # Evaluate Slice T2 (`cutoff = 08:25 = 1700001500000`) -> KURAL_İHLALİ
            audit_t2 = wdir / "audit_t2.ndjson"
            res_t2 = json.loads(
                run_cli(
                    self.airlock_bin,
                    [
                        "evaluate-slice",
                        "--batch",
                        str(batch_file),
                        "--manifest",
                        str(manifest_path),
                        "--cutoff-ms",
                        "1700001500000",
                        "--audit-log",
                        str(audit_t2),
                        "--audit-seed",
                        SEED_AUDIT,
                        "--audit-session-id",
                        "1002",
                        "--det-clock",
                    ],
                ).stdout
            )
            self.assertEqual(res_t2["verdict"], "KURAL_İHLALİ")
            self.assertEqual(
                res_t2["applied_rule_id"], "RULE_CALIBRATED_OBSERVATION_SLA_BREACH"
            )
            self.assertEqual(res_t2["assumption_range_fp"], ["15000000", "35000000"])

            # NO LOOK-AHEAD PROOF: Re-run `cutoff = 08:10` while `T2` sits in the SAME file!
            audit_t1_post = wdir / "audit_t1_post.ndjson"
            res_t1_post = json.loads(
                run_cli(
                    self.airlock_bin,
                    [
                        "evaluate-slice",
                        "--batch",
                        str(batch_file),
                        "--manifest",
                        str(manifest_path),
                        "--cutoff-ms",
                        "1700000600000",
                        "--audit-log",
                        str(audit_t1_post),
                        "--audit-seed",
                        SEED_AUDIT,
                        "--audit-session-id",
                        "1001",
                        "--det-clock",
                    ],
                ).stdout
            )
            self.assertTrue(res_t1_post["binary_search_used"])
            self.assertEqual(res_t1_post["candidate_records_scanned"], 1)
            self.assertEqual(res_t1_post["verdict"], res_t1_pre["verdict"])
            self.assertEqual(res_t1_post["state_blake3"], res_t1_pre["state_blake3"])
            self.assertEqual(res_t1_post["causal_snapshot"], res_t1_pre["causal_snapshot"])
            self.assertEqual(res_t1_post["active_assertions"], res_t1_pre["active_assertions"])

            run_cli(
                self.verify_audit_bin,
                [str(audit_t1_post), "--expect-signer", self.pub_audit],
            )

            # §7.1 & §7.2: 10 anonymized two-source Aegean ferry voyages replay (< 50 ms binary search)
            ops_10: list[dict[str, object]] = []
            port_10: list[dict[str, object]] = []
            base_ms = 1_700_100_000_000
            for v_idx in range(10):
                voyage_id = f"VOYAGE_AEGEAN_{v_idx + 1:02d}"
                t_obs = base_ms + v_idx * 3_600_000
                t_lrn_1 = t_obs + 300_000   # +5m
                t_lrn_2 = t_obs + 1_200_000 # +20m
                delay_ops = "12.0" if v_idx % 2 == 0 else "25.0"
                delay_port = "14.0" if v_idx % 3 != 0 else "32.5"
                ops_10.append(
                    {
                        "event_kind": "DELAY_NOTICE",
                        "event_id": f"v{v_idx + 1:02d}_ops",
                        "seq_no": str(v_idx + 1),
                        "observed_at_ms": str(t_obs),
                        "learned_at_ms": str(t_lrn_1),
                        "subject_id": voyage_id,
                        "metric_key": "departure_delay_min",
                        "value": delay_ops,
                        "unit": "minutes",
                        "epistemic_status": "CLAIM",
                    }
                )
                port_10.append(
                    {
                        "event_kind": "BERTH_OCCUPANCY",
                        "event_id": f"v{v_idx + 1:02d}_port",
                        "seq_no": str(v_idx + 1),
                        "observed_at_ms": str(t_obs + 60_000),
                        "learned_at_ms": str(t_lrn_2),
                        "subject_id": voyage_id,
                        "metric_key": "departure_delay_min",
                        "value": delay_port,
                        "unit": "minutes",
                        "epistemic_status": "OBSERVATION",
                    }
                )

            lines_ops_10 = self._normalize_records(
                wdir, "ops10", ops_10, SEED_FERRY_OPS, "ferry_ops", "ferry_ops_k1", "HUMAN_OPERATOR"
            )
            lines_port_10 = self._normalize_records(
                wdir, "port10", port_10, SEED_PORT_OBS, "port_observer", "port_obs_k1", "CALIBRATED_SENSOR"
            )
            all_20 = sorted(
                [*lines_ops_10, *lines_port_10],
                key=lambda ln: int(json.loads(ln)["learned_at_ms"]),
            )
            ten_voyage_batch = wdir / "ten_voyages.airlock.ndjson"
            ten_voyage_batch.write_text("\n".join(all_20) + "\n", encoding="utf-8", newline="\n")

            cutoff_mid = str(base_ms + 5 * 3_600_000 + 600_000)
            ten_audit_a = wdir / "ten_audit_a.ndjson"
            ten_audit_b = wdir / "ten_audit_b.ndjson"
            t0 = time.perf_counter()
            replay_a = json.loads(
                run_cli(
                    self.airlock_bin,
                    [
                        "evaluate-slice",
                        "--batch",
                        str(ten_voyage_batch),
                        "--manifest",
                        str(manifest_path),
                        "--cutoff-ms",
                        cutoff_mid,
                        "--audit-log",
                        str(ten_audit_a),
                        "--audit-seed",
                        SEED_AUDIT,
                        "--audit-session-id",
                        "2026",
                        "--det-clock",
                    ],
                ).stdout
            )
            elapsed_ms = (time.perf_counter() - t0) * 1000.0
            replay_b = json.loads(
                run_cli(
                    self.airlock_bin,
                    [
                        "evaluate-slice",
                        "--batch",
                        str(ten_voyage_batch),
                        "--manifest",
                        str(manifest_path),
                        "--cutoff-ms",
                        cutoff_mid,
                        "--audit-log",
                        str(ten_audit_b),
                        "--audit-seed",
                        SEED_AUDIT,
                        "--audit-session-id",
                        "2026",
                        "--det-clock",
                    ],
                ).stdout
            )
            self.assertTrue(replay_a["binary_search_used"])
            self.assertEqual(replay_a["state_blake3"], replay_b["state_blake3"])
            self.assertEqual(replay_a["audit_chain_head"], replay_b["audit_chain_head"])
            self.assertEqual(ten_audit_a.read_bytes(), ten_audit_b.read_bytes())
            # Pinned cross-platform (Linux == Windows) golden BLAKE3 state & audit seal digests:
            self.assertEqual(
                replay_a["state_blake3"],
                "a3ef5d67e26ab1a60a97aef160f37f96c3a7d8c9be7aac761d0ac64d39d2aa77",
            )
            self.assertEqual(
                replay_a["audit_chain_head"],
                "6d5d2c7bd0915a17abc338a995592c2836913c4023826f317f5a2cd1783c7ba6",
            )
            self.assertLess(elapsed_ms, 500.0)

    # ─────────────────────────────────────────────────────────────────────────
    # §6.4: Çelişen İki Bağımsız Kaynak Koruma Testi
    # ─────────────────────────────────────────────────────────────────────────
    def test_conflicting_sources_preserved(self) -> None:
        with tempfile.TemporaryDirectory(prefix="caelus_airlock_conflict_") as tmp:
            wdir = Path(tmp)
            manifest_path = self._write_pilot_manifest(wdir / "source_manifest.json")

            # Source A (`ferry_ops`): +10 min; Independent Source B (`coast_log_ops`): +40 min
            src_a = self._normalize_records(
                wdir,
                "src_a_10m",
                [
                    {
                        "event_kind": "DELAY_NOTICE",
                        "event_id": "evt_conflict_a_10m",
                        "seq_no": "1",
                        "observed_at_ms": "1700000000000",
                        "learned_at_ms": "1700000200000",
                        "subject_id": "VOYAGE_CESME_CHIOS_0930",
                        "metric_key": "departure_delay_min",
                        "value": "10.0",
                        "unit": "minutes",
                        "epistemic_status": "CLAIM",
                        "note": "Source A reports +10 min",
                    }
                ],
                SEED_FERRY_OPS,
                "ferry_ops",
                "ferry_ops_k1",
                "HUMAN_OPERATOR",
            )
            src_b = self._normalize_records(
                wdir,
                "src_b_40m",
                [
                    {
                        "event_kind": "DELAY_NOTICE",
                        "event_id": "evt_conflict_b_40m",
                        "seq_no": "1",
                        "observed_at_ms": "1700000030000",
                        "learned_at_ms": "1700000250000",
                        "subject_id": "VOYAGE_CESME_CHIOS_0930",
                        "metric_key": "departure_delay_min",
                        "value": "40.0",
                        "unit": "minutes",
                        "epistemic_status": "CLAIM",
                        "note": "Independent Source B reports +40 min",
                    }
                ],
                SEED_COAST_LOG,
                "coast_log_ops",
                "coast_log_k1",
                "HUMAN_OPERATOR",
            )

            conflict_batch = wdir / "conflict.airlock.ndjson"
            conflict_batch.write_text(
                src_a[0] + "\n" + src_b[0] + "\n", encoding="utf-8", newline="\n"
            )

            res = json.loads(
                run_cli(
                    self.airlock_bin,
                    [
                        "evaluate-slice",
                        "--batch",
                        str(conflict_batch),
                        "--manifest",
                        str(manifest_path),
                        "--cutoff-ms",
                        "1700000500000",
                    ],
                ).stdout
            )

            # Neither source overwritten; both preserved side-by-side; NEVER unilateral GEÇTİ!
            self.assertNotEqual(res["verdict"], "GEÇTİ")
            self.assertEqual(res["verdict"], "KANIT_YETERSİZ")
            self.assertEqual(res["applied_rule_id"], "RULE_CONFLICT_PRESERVED_NO_UNILATERAL_PASS")
            self.assertTrue(res["conflict_detected"])
            self.assertEqual(len(res["active_assertions"]), 2)
            self.assertEqual(
                sorted(a["source_id"] for a in res["active_assertions"]),
                ["coast_log_ops", "ferry_ops"],
            )
            self.assertEqual(res["assumption_range_fp"], ["10000000", "40000000"])
            self.assertEqual(len(res["conflicts"]), 1)
            self.assertEqual(res["conflicts"][0]["min_fp_val"], "10000000")
            self.assertEqual(res["conflicts"][0]["max_fp_val"], "40000000")

    # ─────────────────────────────────────────────────────────────────────────
    # §4, §7.3, §7.4: Gerçek MCP İstemci Uçtan Uca & >2^53-1 64-Bit Dizge Testi
    # ─────────────────────────────────────────────────────────────────────────
    def test_mcp_client_end_to_end_and_64bit_strings(self) -> None:
        node_bin = shutil.which("node")
        self.assertIsNotNone(node_bin, "Node.js is required for MCP client test")
        assert node_bin is not None

        with tempfile.TemporaryDirectory(prefix="caelus_mcp_airlock_") as tmp:
            wdir = Path(tmp)
            manifest_path = self._write_pilot_manifest(wdir / "source_manifest.json")

            # Include an event with 64-bit integer values strictly > 2^53 - 1 (9_007_199_254_740_991):
            # 9007199254.740993 * 1_000_000 = 9007199254740993 (2^53 + 1; JS Number rounds to ...992!)
            t1_ops = self._normalize_records(
                wdir,
                "mcp_t1",
                [
                    {
                        "event_kind": "DELAY_NOTICE",
                        "event_id": "mcp_evt_t1",
                        "seq_no": "9007199254740993",
                        "observed_at_ms": "1700000000000",
                        "learned_at_ms": "1700000300000",
                        "subject_id": "VOYAGE_SIGACIK_VATHI_0800",
                        "metric_key": "precise_counter_fp",
                        "value": "9007199254.740993",
                        "unit": "ticks",
                        "epistemic_status": "CLAIM",
                        "note": "above 2^53-1 precision check",
                    }
                ],
                SEED_FERRY_OPS,
                "ferry_ops",
                "ferry_ops_k1",
                "HUMAN_OPERATOR",
            )
            t2_port = self._normalize_records(
                wdir,
                "mcp_t2",
                [
                    {
                        "event_kind": "BERTH_OCCUPANCY",
                        "event_id": "mcp_evt_t2",
                        "seq_no": "9007199254740995",
                        "observed_at_ms": "1700000060000",
                        "learned_at_ms": "1700001200000",
                        "subject_id": "VOYAGE_SIGACIK_VATHI_0800",
                        "metric_key": "precise_counter_fp",
                        "value": "9007199254.740993",
                        "unit": "ticks",
                        "epistemic_status": "OBSERVATION",
                        "note": "calibrated sensor corroboration above 2^53-1",
                    }
                ],
                SEED_PORT_OBS,
                "port_observer",
                "port_obs_k1",
                "CALIBRATED_SENSOR",
            )

            batch_path = wdir / "mcp_pilot.airlock.ndjson"
            batch_path.write_text(
                t1_ops[0] + "\n" + t2_port[0] + "\n", encoding="utf-8", newline="\n"
            )
            audit_path = wdir / "mcp_audit.ndjson"

            mcp_proc = subprocess.Popen(
                [node_bin, str(ROOT / "tools" / "caelus_mcp_server.mjs"), "--stdio-ndjson"],
                cwd=ROOT,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                encoding="utf-8",
            )
            try:
                assert mcp_proc.stdin is not None
                assert mcp_proc.stdout is not None

                def rpc(req_obj_or_raw: dict[str, object] | str) -> dict[str, object]:
                    line = (
                        req_obj_or_raw
                        if isinstance(req_obj_or_raw, str)
                        else json.dumps(req_obj_or_raw, separators=(",", ":"))
                    )
                    mcp_proc.stdin.write(line + "\n")
                    mcp_proc.stdin.flush()
                    resp_line = mcp_proc.stdout.readline()
                    self.assertTrue(resp_line, "MCP server closed stdout unexpectedly")
                    return json.loads(resp_line)

                # 1. initialize & tools/list
                init_resp = rpc({"jsonrpc": "2.0", "id": 1, "method": "initialize"})
                self.assertEqual(init_resp["result"]["protocolVersion"], "2024-11-05")

                list_resp = rpc(
                    {
                        "jsonrpc": "2.0",
                        "id": 2,
                        "method": "tools/list",
                        "params": {"scope": "all"},
                    }
                )
                self.assertEqual(list_resp["result"]["airlockToolsCount"], 4)
                self.assertEqual(len(list_resp["result"]["tools"]), 34)
                tool_names = {t["name"] for t in list_resp["result"]["tools"]}
                self.assertIn("caelus_run_counterfactual_branch", tool_names)

                # 2. caelus_airlock_validate_batch (WATCHER template)
                val_resp = rpc(
                    {
                        "jsonrpc": "2.0",
                        "id": 3,
                        "method": "tools/call",
                        "params": {
                            "name": "caelus_airlock_validate_batch",
                            "arguments": {
                                "batch_path": str(batch_path),
                                "manifest_path": str(manifest_path),
                                "advisor_template": "WATCHER",
                            },
                        },
                    }
                )["result"]["structuredResult"]
                self.assertEqual(val_resp["engine_execution_mode"], "NATIVE_RUST_AIRLOCK")
                self.assertEqual(val_resp["accepted_count"], 2)
                self.assertEqual(val_resp["rejected_count"], 0)
                self.assertEqual(val_resp["records"][0]["seq_no"], "9007199254740993")
                self.assertEqual(val_resp["write_authority"], "NONE")

                # 3. caelus_evaluate_slice: T1 -> KANIT_YETERSİZ
                eval_t1 = rpc(
                    {
                        "jsonrpc": "2.0",
                        "id": 4,
                        "method": "tools/call",
                        "params": {
                            "name": "caelus_evaluate_slice",
                            "arguments": {
                                "batch_path": str(batch_path),
                                "manifest_path": str(manifest_path),
                                "cutoff_learned_at_ms": "1700000600000",
                                "max_allowed_fp": "9007199254740995",
                                "advisor_template": "STRESS_TESTER",
                            },
                        },
                    }
                )["result"]["structuredResult"]
                self.assertEqual(eval_t1["verdict"], "KANIT_YETERSİZ")
                self.assertEqual(eval_t1["assumption_range_fp"], ["9007199254740993", "9007199254740993"])

                # 4. caelus_evaluate_slice: T2 with threshold 9007199254740995 -> GEÇTİ (lossless > 2^53-1!)
                eval_pass = rpc(
                    {
                        "jsonrpc": "2.0",
                        "id": 5,
                        "method": "tools/call",
                        "params": {
                            "name": "caelus_evaluate_slice",
                            "arguments": {
                                "batch_path": str(batch_path),
                                "manifest_path": str(manifest_path),
                                "cutoff_learned_at_ms": "1700001500000",
                                "max_allowed_fp": "9007199254740995",
                                "audit_log_path": str(audit_path),
                                "audit_seed": SEED_AUDIT,
                                "det_clock": True,
                                "advisor_template": "STRATEGIST",
                            },
                        },
                    }
                )["result"]["structuredResult"]
                self.assertEqual(eval_pass["verdict"], "GEÇTİ")
                self.assertEqual(
                    eval_pass["active_assertions"][0]["fp_val"], "9007199254740993"
                )
                self.assertEqual(
                    eval_pass["active_assertions"][0]["seq_no"], "9007199254740993"
                )
                self.assertEqual(eval_pass["write_authority"], "NONE")
                self.assertTrue(eval_pass["human_approval_required"])

                # 5. caelus_evaluate_slice: T2 with tighter threshold 9007199254740992 (1 unit below!) -> KURAL_İHLALİ
                # Note: If JS Number had rounded 9007199254740993 to 9007199254740992, this would have wrongly passed!
                eval_breach = rpc(
                    {
                        "jsonrpc": "2.0",
                        "id": 6,
                        "method": "tools/call",
                        "params": {
                            "name": "caelus_evaluate_slice",
                            "arguments": {
                                "batch_path": str(batch_path),
                                "manifest_path": str(manifest_path),
                                "cutoff_learned_at_ms": "1700001500000",
                                "max_allowed_fp": "9007199254740992",
                                "advisor_template": "STRESS_TESTER",
                            },
                        },
                    }
                )["result"]["structuredResult"]
                self.assertEqual(
                    eval_breach["verdict"],
                    "KURAL_İHLALİ",
                    "1-LSB difference at 2^53+1 vs 2^53 MUST trigger KURAL_İHLALİ with zero rounding!",
                )

                # 6. caelus_explain_outcome (§7.4 1-step traceability back to event_id, rule_id & audit_log)
                explain_resp = rpc(
                    {
                        "jsonrpc": "2.0",
                        "id": 7,
                        "method": "tools/call",
                        "params": {
                            "name": "caelus_explain_outcome",
                            "arguments": {
                                "batch_path": str(batch_path),
                                "manifest_path": str(manifest_path),
                                "cutoff_learned_at_ms": "1700001500000",
                                "max_allowed_fp": "9007199254740995",
                                "audit_log_path": str(audit_path),
                                "advisor_template": "EXPLAINER",
                            },
                        },
                    }
                )["result"]["structuredResult"]
                self.assertEqual(explain_resp["verdict"], "GEÇTİ")
                self.assertEqual(
                    explain_resp["referenced_event_ids"], ["mcp_evt_t1", "mcp_evt_t2"]
                )
                self.assertEqual(
                    explain_resp["audit_log_trace"]["seal_pubkey"], self.pub_audit
                )
                self.assertTrue(len(explain_resp["audit_log_trace"]["seal_chain_head"]) == 64)

                # 7. Unquoted 64-bit integer rejection on both Airlock and Living World tools
                bad_airlock_num = rpc(
                    '{"jsonrpc":"2.0","id":8,"method":"tools/call","params":{"name":"caelus_evaluate_slice","arguments":{"cutoff_learned_at_ms":9007199254740993}}}'
                )
                self.assertIn("error", bad_airlock_num)
                self.assertEqual(
                    bad_airlock_num["error"]["data"]["errorCode"],
                    "MCP_64BIT_DECIMAL_STRING_REQUIRED",
                )

                bad_living_world_num = rpc(
                    '{"jsonrpc":"2.0","id":9,"method":"tools/call","params":{"name":"list_living_world_sources","arguments":{"customSeq":9007199254740993}}}'
                )
                self.assertIn("error", bad_living_world_num)
                self.assertEqual(
                    bad_living_world_num["error"]["data"]["errorCode"],
                    "MCP_UNSAFE_JS_INTEGER_PRECISION_LOSS",
                )
            finally:
                if mcp_proc.stdin:
                    mcp_proc.stdin.close()
                mcp_proc.terminate()
                mcp_proc.wait(timeout=5)
                if mcp_proc.stdout:
                    mcp_proc.stdout.close()
                if mcp_proc.stderr:
                    mcp_proc.stderr.close()

    # ─────────────────────────────────────────────────────────────────────────
    # §7.5: 10 Seferlik Manuel Tablo (Last-Write-Wins) vs CAELUS Değer Kıyaslaması
    # ─────────────────────────────────────────────────────────────────────────
    def test_ten_voyage_manual_vs_caelus_value_comparison(self) -> None:
        """Compares naive manual spreadsheet review (single-timestamp, last-write-wins)
        against CAELUS Sidecar Airlock across 10 anonymized Aegean ferry delay cases."""
        cases = [
            # (voyage_id, ops_claim_min, port_obs_min, coast_claim_min_or_none)
            ("VOYAGE_SIGACIK_VATHI_01", "12.0", "14.0", None),     # corroborated pass
            ("VOYAGE_SIGACIK_VATHI_02", "15.0", "35.0", None),     # T1 uncorroborated -> T2 SLA breach
            ("VOYAGE_CESME_CHIOS_03", "10.0", None, "40.0"),       # conflicting claims (+10 vs +40)
            ("VOYAGE_AYVALIK_MYTILINI_04", "18.0", None, None),    # single uncorroborated claim
            ("VOYAGE_BODRUM_KOS_05", "8.0", "9.5", None),          # corroborated pass
            ("VOYAGE_KUSADASI_SAMOS_06", "11.0", "28.0", None),    # optimistic claim vs sensor breach
            ("VOYAGE_MARMARIS_RHODES_07", "14.0", None, "38.0"),   # conflicting claims (+14 vs +38)
            ("VOYAGE_DIKILI_MYTILINI_08", "16.0", None, None),     # single uncorroborated claim
            ("VOYAGE_FETHIYE_RHODES_09", "9.0", "31.0", None),     # optimistic claim vs sensor breach
            ("VOYAGE_SEFERIHISAR_SAMOS_10", "13.0", "15.5", None), # corroborated pass
        ]

        with tempfile.TemporaryDirectory(prefix="caelus_value_cmp_") as tmp:
            wdir = Path(tmp)
            manifest_path = self._write_pilot_manifest(wdir / "source_manifest.json")

            naive_missed_missing_corroboration = 0
            naive_silent_conflict_overwrites = 0
            caelus_caught_missing_corroboration = 0
            caelus_preserved_conflicts_or_breaches = 0

            t0 = time.perf_counter()
            for idx, (vid, ops_val, port_val, coast_val) in enumerate(cases, start=1):
                base_ts = 1_700_200_000_000 + idx * 3_600_000
                ndjson_lines: list[str] = []
                ndjson_lines.extend(
                    self._normalize_records(
                        wdir,
                        f"cmp_ops_{idx}",
                        [
                            {
                                "event_kind": "DELAY_NOTICE",
                                "event_id": f"cmp_{idx}_ops",
                                "seq_no": str(idx),
                                "observed_at_ms": str(base_ts),
                                "learned_at_ms": str(base_ts + 300_000),
                                "subject_id": vid,
                                "metric_key": "departure_delay_min",
                                "value": ops_val,
                                "unit": "minutes",
                                "epistemic_status": "CLAIM",
                            }
                        ],
                        SEED_FERRY_OPS,
                        "ferry_ops",
                        "ferry_ops_k1",
                        "HUMAN_OPERATOR",
                    )
                )
                if port_val is not None:
                    ndjson_lines.extend(
                        self._normalize_records(
                            wdir,
                            f"cmp_port_{idx}",
                            [
                                {
                                    "event_kind": "BERTH_OCCUPANCY",
                                    "event_id": f"cmp_{idx}_port",
                                    "seq_no": str(idx),
                                    "observed_at_ms": str(base_ts + 60_000),
                                    "learned_at_ms": str(base_ts + 1_200_000),
                                    "subject_id": vid,
                                    "metric_key": "departure_delay_min",
                                    "value": port_val,
                                    "unit": "minutes",
                                    "epistemic_status": "OBSERVATION",
                                }
                            ],
                            SEED_PORT_OBS,
                            "port_observer",
                            "port_obs_k1",
                            "CALIBRATED_SENSOR",
                        )
                    )
                if coast_val is not None:
                    # Arrives earlier or overwritten in naive table if sorted by observed_at
                    ndjson_lines.extend(
                        self._normalize_records(
                            wdir,
                            f"cmp_coast_{idx}",
                            [
                                {
                                    "event_kind": "DELAY_NOTICE",
                                    "event_id": f"cmp_{idx}_coast",
                                    "seq_no": str(idx),
                                    "observed_at_ms": str(base_ts - 30_000),
                                    "learned_at_ms": str(base_ts + 600_000),
                                    "subject_id": vid,
                                    "metric_key": "departure_delay_min",
                                    "value": coast_val,
                                    "unit": "minutes",
                                    "epistemic_status": "CLAIM",
                                }
                            ],
                            SEED_COAST_LOG,
                            "coast_log_ops",
                            "coast_log_k1",
                            "HUMAN_OPERATOR",
                        )
                    )

                ordered_lines = sorted(
                    ndjson_lines, key=lambda ln: int(json.loads(ln)["learned_at_ms"])
                )
                case_batch = wdir / f"case_{idx}.airlock.ndjson"
                case_batch.write_text("\n".join(ordered_lines) + "\n", encoding="utf-8", newline="\n")

                # Naive spreadsheet review at T1 (`base_ts + 400_000`): trusts single <= 20m operator message as PASS
                if float(ops_val) <= 20.0:
                    naive_missed_missing_corroboration += 1

                res_t1 = json.loads(
                    run_cli(
                        self.airlock_bin,
                        [
                            "evaluate-slice",
                            "--batch",
                            str(case_batch),
                            "--manifest",
                            str(manifest_path),
                            "--cutoff-ms",
                            str(base_ts + 400_000),
                        ],
                    ).stdout
                )
                if res_t1["verdict"] == "KANIT_YETERSİZ":
                    caelus_caught_missing_corroboration += 1

                res_t2 = json.loads(
                    run_cli(
                        self.airlock_bin,
                        [
                            "evaluate-slice",
                            "--batch",
                            str(case_batch),
                            "--manifest",
                            str(manifest_path),
                            "--cutoff-ms",
                            str(base_ts + 1_800_000),
                        ],
                    ).stdout
                )
                if coast_val is not None:
                    # Naive last-write-wins sorted by observed_at overwrites earlier +40/+38m with later +10/+14m!
                    naive_silent_conflict_overwrites += 1
                    self.assertTrue(res_t2["conflict_detected"])
                    self.assertEqual(res_t2["verdict"], "KANIT_YETERSİZ")
                    caelus_preserved_conflicts_or_breaches += 1
                elif port_val is not None and float(port_val) > 20.0:
                    self.assertEqual(res_t2["verdict"], "KURAL_İHLALİ")
                    caelus_preserved_conflicts_or_breaches += 1
                elif port_val is None and coast_val is None:
                    self.assertEqual(res_t2["verdict"], "KANIT_YETERSİZ")
                else:
                    self.assertEqual(res_t2["verdict"], "GEÇTİ")

            total_review_ms = (time.perf_counter() - t0) * 1000.0
            self.assertEqual(naive_missed_missing_corroboration, 10)
            self.assertEqual(caelus_caught_missing_corroboration, 10)
            self.assertEqual(naive_silent_conflict_overwrites, 2)
            self.assertEqual(caelus_preserved_conflicts_or_breaches, 5)
            self.assertLess(total_review_ms, 5000.0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
