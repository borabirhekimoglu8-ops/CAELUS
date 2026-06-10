#!/usr/bin/env python3
"""
Deterministic BS-EXEC REPL golden runner.

Runs BS-01, BS-02 and BS-03 through the CAELUS REPL with stdin commands,
validates hysteresis threshold ticks exactly, and hashes normalized JSON
snapshots. Uses only the Python standard library.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_BINARY = ROOT / "dist" / "caelus_os.exe"
SCENARIOS = {
    "BS-01_SAHTE_UFUK": ROOT / "scenarios" / "BS-01_SAHTE_UFUK.json",
    "BS-02_GOLGE_ARSIV": ROOT / "scenarios" / "BS-02_GOLGE_ARSIV.json",
    "BS-03_KUM_SAATI": ROOT / "scenarios" / "BS-03_KUM_SAATI.json",
}

# Latched outage semantics (T-20/T-25): outage is LATCHED by any Perishable
# deadline miss or non-reversible hysteresis flip, and is cleared ONLY by an
# explicit successful recovery lever. This command stream fires no levers, so:
#   BS-01: REEFER_PHARMA (Perishable) deadline at tick 384 latches outage long
#          before the non-reversible HYST_PERM_REROUTE flip at 576 -> True.
#   BS-02: HYST_PAYROLL_MISS (tick 144) is itself non-reversible -> latches on
#          its own flip (PAYROLL_FAILURE is a Service node; its deadline does
#          NOT latch). HYST_SUPPLIER_FLIGHT (240) observes the latch -> True.
#   BS-03: HYST_BLOKAJ (tick 24) is reversible and precedes every latch source
#          (REEFER_CONVOY deadline is 120) -> False. HYST_TRAFIK_KAYBI (216)
#          follows both the deadline latch and its own non-reversible flip -> True.
EXPECTED_HYSTERESIS_OUTAGE = {
    ("BS-01_SAHTE_UFUK", "HYST_PERM_REROUTE"): True,
    ("BS-02_GOLGE_ARSIV", "HYST_PAYROLL_MISS"): True,
    ("BS-02_GOLGE_ARSIV", "HYST_SUPPLIER_FLIGHT"): True,
    ("BS-03_KUM_SAATI", "HYST_BLOKAJ"): False,
    ("BS-03_KUM_SAATI", "HYST_TRAFIK_KAYBI"): True,
}

# Regenerated with `--refresh` against the latched-outage engine build
# (build.bat, GCC + x86_64-pc-windows-gnu, signed scenarios, no dev bypass).
EXPECTED_SNAPSHOT_HASHES = {
    "BS-01_SAHTE_UFUK": "4dc1f03841c3c8f6fb08ce0482d8008ffd9c1966c06aeae80856ac274c286daa",
    "BS-02_GOLGE_ARSIV": "176cdc02520bebdef92f0319d63ae038a7c65bcd46266ec46cc44ae151cf832e",
    "BS-03_KUM_SAATI": "c67e43d1d1b96a57813ab49f89172be3220919785c8355e12f2171f72e3012e4",
}

REPL_START_TICK = 3
JSON_LINE_RE = re.compile(r"\[REPL_JSON\]\s+(\{[^\r\n]*\})")


def load_hysteresis(scenario_id: str) -> list[dict[str, Any]]:
    path = SCENARIOS[scenario_id]
    with path.open("r", encoding="utf-8") as f:
        data = json.load(f)
    hyst = data["extended_causal_model"].get("hysteresis", [])
    return sorted(hyst, key=lambda item: int(item["threshold_tick"]))


def build_commands(hysteresis: list[dict[str, Any]]) -> list[str]:
    commands = ["snapshot --json"]
    current_tick = REPL_START_TICK
    for item in hysteresis:
        threshold = int(item["threshold_tick"])
        ticks_to_run = threshold - current_tick + 1
        if ticks_to_run <= 0:
            raise ValueError(
                f"Histerezis eşiği mevcut tick'ten önce: threshold={threshold}, "
                f"current={current_tick}"
            )
        commands.append(f"tick {ticks_to_run}")
        commands.append("snapshot --json")
        current_tick += ticks_to_run
    commands.append("quit")
    return commands


def run_repl(binary: Path, scenario_id: str, commands: list[str]) -> str:
    # Scenarios carry real ed25519 signatures matching the pinned trust anchor,
    # so the dev bypass is not needed — and must NOT leak in from the ambient
    # environment: this suite is the signed verification path (SIGNED-CI).
    env = os.environ.copy()
    env.pop("CAELUS_ALLOW_DEV_SCENARIOS", None)
    proc = subprocess.run(
        [str(binary), "--scenario", scenario_id, "--repl", "--det-mode"],
        input="\n".join(commands) + "\n",
        text=True,
        encoding="utf-8",
        errors="replace",
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        cwd=str(ROOT),
        env=env,
        check=False,
    )
    if proc.returncode != 0:
        raise RuntimeError(
            f"{scenario_id} REPL koşumu başarısız oldu (exit={proc.returncode}).\n"
            f"--- stdout/stderr ---\n{proc.stdout}"
        )
    return proc.stdout


def parse_snapshots(output: str) -> list[dict[str, Any]]:
    snapshots = []
    for match in JSON_LINE_RE.finditer(output):
        snapshots.append(json.loads(match.group(1)))
    return snapshots


def normalize_snapshot(snapshot: dict[str, Any]) -> dict[str, Any]:
    fields = [
        "current_tick",
        "last_snapshot_tick",
        "raw_friction",
        "clamped_friction",
        "regime_exceeded",
        "outage_active",
        "deadline_missed",
        "hysteresis_flip",
        "throughput_ratio",
    ]
    normalized: dict[str, Any] = {}
    for field in fields:
        value = snapshot[field]
        if isinstance(value, float):
            value = round(value, 6)
        normalized[field] = value
    return normalized


def assert_case(
    scenario_id: str,
    hysteresis: list[dict[str, Any]],
    output: str,
    snapshots: list[dict[str, Any]],
    refresh: bool = False,
) -> dict[str, Any]:
    expected_count = 1 + len(hysteresis)
    if len(snapshots) != expected_count:
        raise AssertionError(
            f"{scenario_id}: {expected_count} JSON snapshot bekleniyordu, "
            f"{len(snapshots)} bulundu. Binary snapshot --json destekli mi?"
        )

    start = snapshots[0]
    if start["current_tick"] != REPL_START_TICK or start["last_snapshot_tick"] != REPL_START_TICK - 1:
        raise AssertionError(
            f"{scenario_id}: REPL başlangıç tick'i beklenenden farklı: "
            f"current={start['current_tick']} last={start['last_snapshot_tick']}"
        )

    milestones: list[dict[str, Any]] = [
        {"name": "repl_start", "snapshot": normalize_snapshot(start)}
    ]
    flip_events: list[list[Any]] = []

    for idx, item in enumerate(hysteresis, start=1):
        hyst_id = str(item["id"])
        threshold = int(item["threshold_tick"])
        snap = snapshots[idx]

        if snap["last_snapshot_tick"] != threshold:
            raise AssertionError(
                f"{scenario_id}/{hyst_id}: last_snapshot_tick={snap['last_snapshot_tick']}, "
                f"beklenen={threshold}"
            )
        if snap["current_tick"] != threshold + 1:
            raise AssertionError(
                f"{scenario_id}/{hyst_id}: current_tick={snap['current_tick']}, "
                f"beklenen={threshold + 1}"
            )
        if not snap["hysteresis_flip"]:
            raise AssertionError(f"{scenario_id}/{hyst_id}: hysteresis_flip false geldi")
        if not refresh:
            expected_outage = EXPECTED_HYSTERESIS_OUTAGE[(scenario_id, hyst_id)]
            if bool(snap["outage_active"]) != expected_outage:
                raise AssertionError(
                    f"{scenario_id}/{hyst_id}: outage_active={snap['outage_active']}, "
                    f"beklenen={expected_outage}"
                )

        flip_events.append([hyst_id, threshold])
        milestones.append(
            {
                "hysteresis_id": hyst_id,
                "threshold_tick": threshold,
                "snapshot": normalize_snapshot(snap),
            }
        )

    normalized = {
        "scenario_id": scenario_id,
        "milestones": milestones,
        "flip_events": flip_events,
    }
    payload = json.dumps(normalized, sort_keys=True, separators=(",", ":")).encode("utf-8")
    snapshot_hash = hashlib.sha256(payload).hexdigest()
    if not refresh:
        expected_hash = EXPECTED_SNAPSHOT_HASHES[scenario_id]
        if snapshot_hash != expected_hash:
            raise AssertionError(
                f"{scenario_id}: snapshot hash uyuşmadı\n"
                f"  actual  : {snapshot_hash}\n"
                f"  expected: {expected_hash}"
            )
    return {"normalized": normalized, "snapshot_hash": snapshot_hash}


def selected_scenarios(value: str) -> list[str]:
    if value == "all":
        return list(SCENARIOS.keys())
    if value not in SCENARIOS:
        raise argparse.ArgumentTypeError(f"Bilinmeyen senaryo: {value}")
    return [value]


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(
        description="BS-EXEC REPL golden runner: hysteresis tick/outage/hash doğrulaması."
    )
    parser.add_argument(
        "--binary",
        default=str(DEFAULT_BINARY),
        help=f"caelus_os.exe yolu (varsayılan: {DEFAULT_BINARY})",
    )
    parser.add_argument(
        "--scenario",
        default="all",
        help="Koşulacak senaryo ID'si veya all",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="REPL'i çalıştırmadan üretilecek komutları ve beklenen hash'i yazdır",
    )
    parser.add_argument(
        "--refresh",
        action="store_true",
        help="Beklenti karşılaştırmalarını atla; motor çıktısından güncel "
        "EXPECTED_HYSTERESIS_OUTAGE / EXPECTED_SNAPSHOT_HASHES değerlerini yazdır "
        "(golden yenileme — T-25 prosedürü)",
    )
    args = parser.parse_args(argv)

    binary = Path(args.binary)
    scenarios = selected_scenarios(args.scenario)

    if not args.dry_run and not binary.exists():
        print(
            f"[HATA] Binary bulunamadı: {binary}\n"
            "       Önce build.bat çalıştırın veya --binary ile yolu verin.",
            file=sys.stderr,
        )
        return 2

    try:
        for scenario_id in scenarios:
            hysteresis = load_hysteresis(scenario_id)
            commands = build_commands(hysteresis)

            print(f"[CASE] {scenario_id}")
            print(f"       expected_snapshot_hash={EXPECTED_SNAPSHOT_HASHES[scenario_id]}")
            if args.dry_run:
                print("       commands:")
                for command in commands:
                    print(f"         {command}")
                continue

            output = run_repl(binary, scenario_id, commands)
            snapshots = parse_snapshots(output)
            result = assert_case(
                scenario_id, hysteresis, output, snapshots, refresh=args.refresh
            )
            if args.refresh:
                for m in result["normalized"]["milestones"][1:]:
                    print(
                        f"       ACTUAL outage ({scenario_id!r}, "
                        f"{m['hysteresis_id']!r}): {bool(m['snapshot']['outage_active'])}"
                    )
                print(f'       ACTUAL hash  "{scenario_id}": "{result["snapshot_hash"]}"')
                continue
            for event in result["normalized"]["flip_events"]:
                print(f"       hysteresis {event[0]} tick={event[1]} doğrulandı")
            print(f"       snapshot_hash={result['snapshot_hash']} OK")
    except (AssertionError, RuntimeError, ValueError, KeyError, json.JSONDecodeError) as exc:
        print(f"[FAIL] {exc}", file=sys.stderr)
        return 1

    print("[OK] BS-EXEC REPL golden suite tamamlandı.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
