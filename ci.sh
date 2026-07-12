#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXE="$ROOT/dist/caelus_os"
TEST_EXE="$ROOT/build_tests/caelus_cpp_tests"
NEURAL_CPP_EXE="$ROOT/build_tests/neural_cpp_reference"
NEURAL_RUST_EXE="$ROOT/tests/neural_reference/target/release/caelus_neural_reference"
MODEL_SIGNER="$ROOT/target/release/caelus_sign_model"
PYTHON="${PYTHON:-python3}"

log() { printf '[CI] %s\n' "$*"; }
die() { printf '[CI FAIL] %s\n' "$*" >&2; exit 1; }

cd "$ROOT"
for tool in cargo g++ rg strings wc cmp mktemp; do
    command -v "$tool" >/dev/null 2>&1 || die "missing required tool: $tool"
done
command -v "$PYTHON" >/dev/null 2>&1 || die "missing Python interpreter: $PYTHON"
"$PYTHON" - <<'PY' || die "Python Ed25519 verifier missing (install cryptography or PyNaCl)"
try:
    import cryptography  # noqa: F401
except ImportError:
    import nacl  # noqa: F401
PY

mkdir -p "$ROOT/build_tests"
rm -f "$ROOT/caelus_audit_0000000000000000.log"

log "Python neural, audit, UI, and training-tool tests"
"$PYTHON" -m unittest -v \
    tests.test_caelus_blake3 \
    tests.test_verify_audit_neural \
    tests.test_neural_war_room_contract \
    caelus_ml.test_pipeline

log "Rust network tests"
cargo test --locked

log "Rust core tests"
cargo test --locked --manifest-path "$ROOT/caelus_core/Cargo.toml" --features std

log "C++ unit tests"
g++ -std=c++17 -O2 -DCAELUS_CPP_UNIT_TEST=1 \
    -I"$ROOT" -I"$ROOT/include" -I"$ROOT/src" -I"$ROOT/tests" \
    "$ROOT/tests/test_causal_engine.cpp" -o "$TEST_EXE"
"$TEST_EXE"

log "Loopback connector integration smoke"
"$PYTHON" "$ROOT/tests/connector_smoke.py"

log "Offline dataset, export, signing, and model-verification smoke"
cargo build --release --locked --bin caelus_sign_model
"$PYTHON" "$ROOT/tests/run_neural_toolchain_smoke.py" \
    --signer-binary "$MODEL_SIGNER"

log "Linux production build"
CAELUS_PRODUCTION=1 "$ROOT/build.sh"

[[ -x "$EXE" ]] || die "missing binary: $EXE"
size_bytes="$(wc -c < "$EXE")"
(( size_bytes < 50 * 1024 * 1024 )) || die "binary exceeds 50 MB: $size_bytes bytes"

log "Neural reference builds"
cargo build --release --locked \
    --manifest-path "$ROOT/tests/neural_reference/Cargo.toml"
g++ -std=c++17 -O2 \
    -I"$ROOT" -I"$ROOT/include" -I"$ROOT/src" \
    "$ROOT/tests/neural_cpp_reference.cpp" \
    -o "$NEURAL_CPP_EXE" \
    "$ROOT/target/release/libcaelus_network.a" \
    -ldl -lpthread -lm

log "Neural C++/Rust exact differential and reviewed golden"
"$PYTHON" "$ROOT/tests/run_neural_differential.py" \
    --cpp-binary "$NEURAL_CPP_EXE" \
    --rust-binary "$NEURAL_RUST_EXE" \
    --model-dir "$ROOT/models/assurance_v1" \
    --golden "$ROOT/tests/golden/neural_v1_differential.json"

log "BS-01 live neural assurance and fail-closed model negatives"
"$PYTHON" "$ROOT/tests/run_bs01_neural_demo.py" \
    --binary "$EXE" \
    --model-dir "$ROOT/models/assurance_v1"

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

log "Audit chain and SEAL verification (pinned to det-mode signer)"
# Det-mode uses a fixed identity seed, so the SEAL pubkey is deterministic and
# can be pinned. Pinning makes the verifier check WHO sealed the log, not just
# that the chain is self-consistent (closes the 'attacker re-seals' gap).
DET_SEAL_PUBKEY="acdcc8494d458f44a7aaac1d6a84ec624daee88436db2ae26e67ba645a106228"
"$PYTHON" "$ROOT/tools/verify_audit_log.py" \
    "$ROOT/caelus_audit_0000000000000000.log" \
    --trusted-pubkey-hex "$DET_SEAL_PUBKEY"

log "Negative security suite (tamper / dev-signed / audit forgery must fail closed)"
"$PYTHON" "$ROOT/tests/run_security_negative.py" --binary "$EXE"

log "Golden runner against C++ binary"
"$PYTHON" "$ROOT/tests/run_bs_exec_golden.py" --binary "$EXE"

log "Rust core REPL live differential against C++"
cargo build --release --locked --manifest-path "$ROOT/caelus_core/Cargo.toml" --features std --bin caelus_core_repl
"$PYTHON" "$ROOT/tests/run_bs_exec_golden.py" \
    --binary "$ROOT/caelus_core/target/release/caelus_core_repl" \
    --reference-binary "$EXE"

log "All checks passed"
