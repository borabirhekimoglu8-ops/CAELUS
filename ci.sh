#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXE="$ROOT/dist/caelus_os"
TEST_EXE="$ROOT/build_tests/caelus_cpp_tests"
PYTHON="${PYTHON:-python3}"

log() { printf '[CI] %s\n' "$*"; }
die() { printf '[CI FAIL] %s\n' "$*" >&2; exit 1; }

cd "$ROOT"
mkdir -p "$ROOT/build_tests"

log "Rust network tests"
cargo test

log "Rust core tests"
cargo test --manifest-path "$ROOT/caelus_core/Cargo.toml" --features std

log "C++ unit tests"
g++ -std=c++17 -O2 -DCAELUS_CPP_UNIT_TEST=1 \
    -I"$ROOT" -I"$ROOT/include" -I"$ROOT/src" -I"$ROOT/tests" \
    "$ROOT/tests/test_causal_engine.cpp" -o "$TEST_EXE"
"$TEST_EXE"

if [[ "${CAELUS_SKIP_CONNECTOR_SMOKE:-0}" != "1" ]]; then
    log "Connector smoke (intel data-plane auth + signature gate)"
    "$PYTHON" "$ROOT/tests/connector_smoke.py"
fi

log "pure-Python blake3 fallback equivalence"
"$PYTHON" "$ROOT/tests/test_pure_blake3.py"

log "Linux production build"
CAELUS_PRODUCTION=1 "$ROOT/build.sh"

[[ -x "$EXE" ]] || die "missing binary: $EXE"
size_bytes="$(wc -c < "$EXE")"
(( size_bytes < 50 * 1024 * 1024 )) || die "binary exceeds 50 MB: $size_bytes bytes"

log "Production bypass string scan"
if strings "$EXE" | rg 'CAELUS_ALLOW_DEV_SCENARIOS|CAELUS_TRUST_ANY_PUBKEY|CAELUS_PLUGIN_ALLOW_UNVERIFIED'; then
    die "production binary contains development bypass strings"
fi

log "Determinism double-run"
out1="$(mktemp)"
out2="$(mktemp)"
blk1="$(mktemp)"
blk2="$(mktemp)"
trap 'rm -f "$out1" "$out2" "$blk1" "$blk2"' EXIT
rm -f "$ROOT/caelus_audit_0000000000000000.log"
"$EXE" --scenario UNIVERSAL_BASELINE --det-mode > "$out1" 2>&1
rm -f "$ROOT/caelus_audit_0000000000000000.log"
"$EXE" --scenario UNIVERSAL_BASELINE --det-mode > "$out2" 2>&1
rg '^CDET:' "$out1" > "$blk1"
rg '^CDET:' "$out2" > "$blk2"
cmp -s "$blk1" "$blk2" || die "CDET blocks differ"

log "Audit chain and SEAL verification"
"$PYTHON" "$ROOT/tools/verify_audit_log.py" "$ROOT/caelus_audit_0000000000000000.log"

log "Golden runner against C++ binary"
"$PYTHON" "$ROOT/tests/run_bs_exec_golden.py" --binary "$EXE"

log "Rust core REPL live differential against C++"
cargo build --release --manifest-path "$ROOT/caelus_core/Cargo.toml" --features std --bin caelus_core_repl
"$PYTHON" "$ROOT/tests/run_bs_exec_golden.py" \
    --binary "$ROOT/caelus_core/target/release/caelus_core_repl" \
    --reference-binary "$EXE"

log "All checks passed"
