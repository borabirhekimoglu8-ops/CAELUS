#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OS_UNAME="$(uname -s)"
IS_WINDOWS_BASH=0
EXE_EXT=""
case "$OS_UNAME" in
    MINGW*|MSYS*|CYGWIN*)
        IS_WINDOWS_BASH=1
        EXE_EXT=".exe"
        # Git Bash prepends /usr/bin (GNU coreutils /usr/bin/link) ahead of
        # inherited Windows PATH, shadowing MSVC's link.exe during cargo builds.
        if command -v cl.exe >/dev/null 2>&1; then
            export PATH="$(dirname "$(command -v cl.exe)"):$PATH"
        fi
        ;;
esac

EXE="$ROOT/dist/caelus_os${EXE_EXT}"
VERIFY_BIN="$ROOT/target/release/caelus_verify_audit${EXE_EXT}"
AIRLOCK_BIN="$ROOT/target/release/caelus_sidecar_airlock${EXE_EXT}"
REPL_BIN="$ROOT/target/release/caelus_core_repl${EXE_EXT}"
TEST_EXE="$ROOT/build_tests/caelus_cpp_tests${EXE_EXT}"
DET_SIGNER_PUBKEY="acdcc8494d458f44a7aaac1d6a84ec624daee88436db2ae26e67ba645a106228"
SAMPLE_SIGNER_PUBKEY="2dd8b43ecba8eff73b1aa25250de676f4f8a0be072b1f96a7eda7355648ca0d1"

host_path() {
    if [[ "$IS_WINDOWS_BASH" == "1" ]] && command -v cygpath >/dev/null 2>&1; then
        cygpath -m "$1"
    else
        printf '%s' "$1"
    fi
}

if [[ -n "${PYTHON:-}" ]]; then
    PYTHON_CMD=("$PYTHON")
elif [[ "$IS_WINDOWS_BASH" == "1" ]] && command -v py >/dev/null 2>&1; then
    PYTHON_CMD=(py -3)
elif command -v python3 >/dev/null 2>&1; then
    PYTHON_CMD=(python3)
elif command -v python >/dev/null 2>&1; then
    PYTHON_CMD=(python)
else
    printf '[CI FAIL] Python 3 interpreter not found\n' >&2
    exit 1
fi

log() { printf '[CI] %s\n' "$*"; }
die() { printf '[CI FAIL] %s\n' "$*" >&2; exit 1; }

AUDIT_DIR="$(mktemp -d)"
SIG_DIR="$(mktemp -d)"
cleanup() {
    rm -rf "$AUDIT_DIR" "$SIG_DIR"
    rm -f "$ROOT/caelus_audit_0000000000000000.log"
}
trap cleanup EXIT

cd "$ROOT"
mkdir -p "$ROOT/build_tests"

log "Rust no_std core gate & zero-dependency isolation check"
cargo check -p caelus_core --no-default-features
core_tree="$(cargo tree -p caelus_core --no-default-features --edges normal | sed '/^[[:space:]]*$/d')"
core_tree_lines="$(printf '%s\n' "$core_tree" | wc -l | tr -d '[:space:]')"
[[ "$core_tree_lines" == "1" ]] || die "caelus_core --no-default-features must have zero external dependencies, got: $core_tree"

log "Rust workspace unit & property tests"
cargo test --workspace --all-targets

log "C++ unit tests"
if [[ "$IS_WINDOWS_BASH" == "1" ]]; then
    if [[ "${CAELUS_CXX:-}" == "MSVC" ]] && command -v cl.exe >/dev/null 2>&1; then
        MSYS2_ARG_CONV_EXCL="*" cl.exe /nologo /std:c++17 /O2 /EHsc /utf-8 /W4 /WX \
            /DNOMINMAX /DWIN32_LEAN_AND_MEAN /D_CRT_SECURE_NO_WARNINGS /DCAELUS_CPP_UNIT_TEST=1 \
            "/I$(host_path "$ROOT")" "/I$(host_path "$ROOT/include")" "/I$(host_path "$ROOT/src")" "/I$(host_path "$ROOT/tests")" \
            "$(host_path "$ROOT/tests/test_causal_engine.cpp")" "/Fe:$(host_path "$TEST_EXE")" \
            /link /INCREMENTAL:NO ws2_32.lib
    else
        g++ -std=c++17 -O2 -Wall -Wextra -DCAELUS_CPP_UNIT_TEST=1 \
            -I"$ROOT" -I"$ROOT/include" -I"$ROOT/src" -I"$ROOT/tests" \
            "$ROOT/tests/test_causal_engine.cpp" -o "$TEST_EXE" -lws2_32
    fi
else
    g++ -std=c++17 -O2 -Wall -Wextra -DCAELUS_CPP_UNIT_TEST=1 \
        -I"$ROOT" -I"$ROOT/include" -I"$ROOT/src" -I"$ROOT/tests" \
        "$ROOT/tests/test_causal_engine.cpp" -o "$TEST_EXE" -pthread
fi
"$TEST_EXE"

if [[ "${CAELUS_SKIP_CONNECTOR_SMOKE:-0}" != "1" ]]; then
    log "Connector smoke (intel data-plane auth + FIELD-IDENTITY v1/v2)"
    "${PYTHON_CMD[@]}" "$(host_path "$ROOT/tests/connector_smoke.py")"
fi

log "pure-Python blake3 fallback equivalence"
"${PYTHON_CMD[@]}" "$(host_path "$ROOT/tests/test_pure_blake3.py")"

log "Production build (CAELUS_PRODUCTION=1)"
if [[ "$IS_WINDOWS_BASH" == "1" ]]; then
    CAELUS_PRODUCTION=1 cmd.exe //c "$(cygpath -w "$ROOT/build.bat")"
else
    CAELUS_PRODUCTION=1 "$ROOT/build.sh"
fi

[[ -f "$EXE" ]] || die "missing binary: $EXE"
[[ -x "$EXE" || "$IS_WINDOWS_BASH" == "1" ]] || die "binary is not executable: $EXE"
size_bytes="$(wc -c < "$EXE")"
(( size_bytes < 50 * 1024 * 1024 )) || die "binary exceeds 50 MB: $size_bytes bytes"

log "Production bypass byte scan"
"${PYTHON_CMD[@]}" - "$(host_path "$EXE")" <<'PY'
import pathlib, sys
data = pathlib.Path(sys.argv[1]).read_bytes()
forbidden = [
    b"CAELUS_ALLOW_DEV_SCENARIOS",
    b"CAELUS_TRUST_ANY_PUBKEY",
    b"CAELUS_PLUGIN_ALLOW_UNVERIFIED",
]
found = [tok.decode("ascii") for tok in forbidden if tok in data]
if found:
    print(f"[CI FAIL] production binary contains dev bypass strings: {found}", file=sys.stderr)
    sys.exit(1)
PY

if [[ ! -f "$VERIFY_BIN" ]]; then
    cargo build --release -p caelus_network --bin caelus_verify_audit
fi
if [[ ! -f "$AIRLOCK_BIN" ]]; then
    cargo build --release -p caelus_network --bin caelus_sidecar_airlock
fi

log "Sidecar Airlock PR-1 isolation, Aegean ferry pilot & MCP 64-bit string gate"
"${PYTHON_CMD[@]}" -W error "$(host_path "$ROOT/tests/test_airlock_ferry_pilot.py")"

if command -v node >/dev/null 2>&1; then
    log "War Room 4-Agent AG-UI & Air-Gapped Cockpit master gates"
    node --test "$(host_path "$ROOT/tests/test_war_room_master_gates.mjs")"
fi

log "Determinism double-run (isolated temp audit directory)"
export CAELUS_DET_SEED="0xCAE105DEADBEEF00"
export CAELUS_ENCLAVE_KEY="cae1cae1cae1cae1cae1cae1cae1cae1cae1cae1cae1cae1cae1cae1cae1cae1"
out1="$AUDIT_DIR/run1.out"
out2="$AUDIT_DIR/run2.out"
blk1="$AUDIT_DIR/blk1.txt"
blk2="$AUDIT_DIR/blk2.txt"
aud1="$AUDIT_DIR/run1_audit.log"
aud2="$AUDIT_DIR/caelus_audit_0000000000000000.log"

(
    cd "$AUDIT_DIR"
    "$EXE" --scenario UNIVERSAL_BASELINE --det-mode > "$out1" 2>&1
    mv "caelus_audit_0000000000000000.log" "$aud1"
    "$EXE" --scenario UNIVERSAL_BASELINE --det-mode > "$out2" 2>&1
)

grep -E '^CDET:' "$out1" | tr -d '\r' > "$blk1"
grep -E '^CDET:' "$out2" | tr -d '\r' > "$blk2"
[[ -s "$blk1" ]] || die "CDET block is empty"
cmp -s "$blk1" "$blk2" || die "CDET blocks differ"
cmp -s "$aud1" "$aud2" || die "Deterministic audit logs differ between Run 1 and Run 2"

log "Audit chain and pinned SEAL verification (standalone Rust + Python)"
"$VERIFY_BIN" --expect-signer "$DET_SIGNER_PUBKEY" "$(host_path "$aud2")"
"$VERIFY_BIN" --expect-signer "$SAMPLE_SIGNER_PUBKEY" "$(host_path "$ROOT/tests/fixtures/caelus_audit_sample.log")"
printed_signer="$("$VERIFY_BIN" --print-signer "$(host_path "$aud2")" | tr -d '\r')"
[[ "$printed_signer" == "$DET_SIGNER_PUBKEY" ]] || die "unexpected --print-signer output: $printed_signer"

neg_pin_out="$AUDIT_DIR/neg_pin.out"
if "$VERIFY_BIN" --expect-signer "$(host_path "$ROOT/tools/caelus_trusted_pubkey.txt")" "$(host_path "$aud2")" > "$neg_pin_out" 2>&1; then
    die "wrong --expect-signer pin was unexpectedly accepted"
fi
grep -q "UNTRUSTED_SEAL_SIGNER" "$neg_pin_out" || die "missing UNTRUSTED_SEAL_SIGNER diagnostic"

"${PYTHON_CMD[@]}" "$(host_path "$ROOT/tools/verify_audit_log.py")" --expect-signer "$DET_SIGNER_PUBKEY" "$(host_path "$aud2")"

log "Negative scenario signature rejection gate (SIG-CI)"
mkdir -p "$SIG_DIR/scenarios"
"${PYTHON_CMD[@]}" "$(host_path "$ROOT/tests/make_negative_scenario.py")" \
    "$(host_path "$ROOT/scenarios/BS-01_SAHTE_UFUK.json")" \
    "$(host_path "$SIG_DIR/scenarios/BS-01_SAHTE_UFUK.json")"
sig_out="$SIG_DIR/sig_negative.out"
(
    cd "$SIG_DIR"
    CAELUS_ALLOW_DEV_SCENARIOS=0 "$EXE" --scenario BS-01_SAHTE_UFUK --det-mode > "$sig_out" 2>&1
)
grep -q "SIGNATURE_MISMATCH" "$sig_out" || die "SIG-CI missing SIGNATURE_MISMATCH"
grep -q "AWAITING_SCENARIO_INJECTION" "$sig_out" || die "SIG-CI missing AWAITING_SCENARIO_INJECTION"
grep -q "CDET: raw_friction=1.000000" "$sig_out" || die "SIG-CI missing neutral raw_friction=1.000000"
grep -q "CDET: final_friction=1.000000" "$sig_out" || die "SIG-CI missing neutral final_friction=1.000000"

log "Golden runner against C++ binary"
"${PYTHON_CMD[@]}" "$(host_path "$ROOT/tests/run_bs_exec_golden.py")" --binary "$(host_path "$EXE")"

log "Rust core REPL live differential against C++"
cargo build --release -p caelus_core --features std --bin caelus_core_repl
"${PYTHON_CMD[@]}" "$(host_path "$ROOT/tests/run_bs_exec_golden.py")" \
    --binary "$(host_path "$REPL_BIN")" \
    --reference-binary "$(host_path "$EXE")"

log "All checks passed"
