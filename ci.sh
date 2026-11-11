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
MODEL_SIGNER="$ROOT/target/release/caelus_sign_model${EXE_EXT}"
REPL_BIN="$ROOT/caelus_core/target/release/caelus_core_repl${EXE_EXT}"
TEST_EXE="$ROOT/build_tests/caelus_cpp_tests${EXE_EXT}"
NEURAL_CPP_EXE="$ROOT/build_tests/neural_cpp_reference${EXE_EXT}"
NEURAL_RUST_EXE="$ROOT/tests/neural_reference/target/release/caelus_neural_reference${EXE_EXT}"
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
for tool in cargo wc cmp mktemp; do
    command -v "$tool" >/dev/null 2>&1 || die "missing required tool: $tool"
done
if [[ "$IS_WINDOWS_BASH" != "1" ]]; then
    command -v g++ >/dev/null 2>&1 || command -v clang++ >/dev/null 2>&1 || die "missing C++ compiler (g++ or clang++)"
fi
"${PYTHON_CMD[@]}" - <<'PY' || die "Python Ed25519 verifier missing (install cryptography or PyNaCl)"
try:
    import cryptography  # noqa: F401
except ImportError:
    import nacl  # noqa: F401
PY

mkdir -p "$ROOT/build_tests"
rm -f "$ROOT/caelus_audit_0000000000000000.log"

log "Offline dataset, export, signing, and model-verification smoke (clean checkout gate)"
cargo fetch --locked --manifest-path "$(host_path "$ROOT/caelus_core/Cargo.toml")"
cargo build --release --locked --bin caelus_sign_model
"${PYTHON_CMD[@]}" "$(host_path "$ROOT/tests/run_neural_toolchain_smoke.py")" \
    --signer-binary "$(host_path "$MODEL_SIGNER")"

log "Python neural, audit, UI, and training-tool tests"
"${PYTHON_CMD[@]}" -m unittest -v \
    tests.test_caelus_blake3 \
    tests.test_verify_audit_neural \
    tests.test_neural_war_room_contract \
    caelus_ml.test_pipeline

log "Rust no_std core gate & dependency isolation check"
cargo check --locked --manifest-path "$(host_path "$ROOT/caelus_core/Cargo.toml")" --no-default-features
"${PYTHON_CMD[@]}" - "$(host_path "$ROOT/caelus_core/Cargo.toml")" <<'PY'
import subprocess, sys
manifest = sys.argv[1]
r = subprocess.run(
    ["cargo", "tree", "--locked", "--manifest-path", manifest, "--no-default-features", "--edges", "normal"],
    capture_output=True, text=True, check=False,
)
if r.returncode != 0:
    print(r.stderr, file=sys.stderr)
    sys.exit(1)
lines = [ln.strip() for ln in r.stdout.splitlines() if ln.strip()]
if not lines or not lines[0].startswith("caelus_core "):
    print(f"unexpected caelus_core tree:\n{r.stdout}", file=sys.stderr)
    sys.exit(1)
allowed = {"caelus_core", "blake3", "arrayref", "arrayvec", "cfg-if", "constant_time_eq", "libc"}
for ln in lines:
    toks = [t for t in ln.replace("├──", " ").replace("└──", " ").replace("│", " ").split() if t and not t.startswith("(")]
    if toks and toks[0] not in allowed:
        print(f"forbidden dependency in caelus_core no_std tree: {toks[0]}\n{r.stdout}", file=sys.stderr)
        sys.exit(1)
PY

log "Rust network & host crate tests"
cargo test --locked

log "Rust core unit & property tests"
cargo test --locked --manifest-path "$(host_path "$ROOT/caelus_core/Cargo.toml")" --features std

log "C++ unit tests"
if [[ "$IS_WINDOWS_BASH" == "1" ]]; then
    if [[ "${CAELUS_CXX:-}" == "MSVC" ]] && command -v cl.exe >/dev/null 2>&1; then
        MSYS2_ARG_CONV_EXCL="*" cl.exe /nologo /std:c++17 /O2 /EHsc /utf-8 /W4 /WX \
            /DNOMINMAX /DWIN32_LEAN_AND_MEAN /D_CRT_SECURE_NO_WARNINGS /DCAELUS_CPP_UNIT_TEST=1 \
            "/I$(host_path "$ROOT")" "/I$(host_path "$ROOT/include")" "/I$(host_path "$ROOT/src")" "/I$(host_path "$ROOT/tests")" \
            "$(host_path "$ROOT/tests/test_causal_engine.cpp")" "/Fo:$(host_path "$ROOT/build_tests")/" "/Fe:$(host_path "$TEST_EXE")" \
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
    CAELUS_PRODUCTION=1 bash "$ROOT/build.sh"
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

if [[ ! -f "$VERIFY_BIN" || ! -f "$AIRLOCK_BIN" ]]; then
    cargo build --release --locked --bin caelus_verify_audit --bin caelus_sidecar_airlock
fi

log "Neural reference builds"
cargo build --release --locked \
    --manifest-path "$(host_path "$ROOT/tests/neural_reference/Cargo.toml")"
if [[ "$IS_WINDOWS_BASH" == "1" ]]; then
    if [[ "${CAELUS_CXX:-}" == "MSVC" ]] && command -v cl.exe >/dev/null 2>&1; then
        NEURAL_RUST_LIB="$ROOT/target/x86_64-pc-windows-msvc/release/caelus_network.lib"
        [[ -f "$NEURAL_RUST_LIB" ]] || NEURAL_RUST_LIB="$ROOT/target/release/caelus_network.lib"
        MSYS2_ARG_CONV_EXCL="*" cl.exe /nologo /std:c++17 /O2 /EHsc /utf-8 \
            "/I$(host_path "$ROOT")" "/I$(host_path "$ROOT/include")" "/I$(host_path "$ROOT/src")" \
            "$(host_path "$ROOT/tests/neural_cpp_reference.cpp")" "/Fo:$(host_path "$ROOT/build_tests")/" "/Fe:$(host_path "$NEURAL_CPP_EXE")" \
            /link /INCREMENTAL:NO "$(host_path "$NEURAL_RUST_LIB")" advapi32.lib ws2_32.lib userenv.lib bcrypt.lib ntdll.lib crypt32.lib
    else
        NEURAL_RUST_LIB="$ROOT/target/x86_64-pc-windows-gnu/release/libcaelus_network.a"
        [[ -f "$NEURAL_RUST_LIB" ]] || NEURAL_RUST_LIB="$ROOT/target/release/libcaelus_network.a"
        g++ -std=c++17 -O2 -I"$ROOT" -I"$ROOT/include" -I"$ROOT/src" \
            "$ROOT/tests/neural_cpp_reference.cpp" -o "$NEURAL_CPP_EXE" "$NEURAL_RUST_LIB" \
            -static -lws2_32 -ladvapi32 -luserenv -lbcrypt -lntdll -lcrypt32
    fi
elif [[ "$OS_UNAME" == "Darwin" ]]; then
    g++ -std=c++17 -O2 -I"$ROOT" -I"$ROOT/include" -I"$ROOT/src" \
        "$ROOT/tests/neural_cpp_reference.cpp" -o "$NEURAL_CPP_EXE" \
        "$ROOT/target/release/libcaelus_network.a"
else
    g++ -std=c++17 -O2 -I"$ROOT" -I"$ROOT/include" -I"$ROOT/src" \
        "$ROOT/tests/neural_cpp_reference.cpp" -o "$NEURAL_CPP_EXE" \
        "$ROOT/target/release/libcaelus_network.a" \
        -ldl -lpthread -lm
fi

log "Neural C++/Rust exact differential and reviewed golden"
"${PYTHON_CMD[@]}" "$(host_path "$ROOT/tests/run_neural_differential.py")" \
    --cpp-binary "$(host_path "$NEURAL_CPP_EXE")" \
    --rust-binary "$(host_path "$NEURAL_RUST_EXE")" \
    --model-dir "$(host_path "$ROOT/models/assurance_v1")" \
    --golden "$(host_path "$ROOT/tests/golden/neural_v1_differential.json")"

log "BS-01 live neural assurance and fail-closed model negatives"
"${PYTHON_CMD[@]}" "$(host_path "$ROOT/tests/run_bs01_neural_demo.py")" \
    --binary "$(host_path "$EXE")" \
    --model-dir "$(host_path "$ROOT/models/assurance_v1")"

log "Sidecar Airlock PR-1 isolation, Aegean ferry pilot & MCP 64-bit string gate"
"${PYTHON_CMD[@]}" -W error "$(host_path "$ROOT/tests/test_airlock_ferry_pilot.py")"

if command -v node >/dev/null 2>&1; then
    log "War Room i18n parity, Plain Mode & Web Interface Guidelines gate"
    node --test "$(host_path "$ROOT/tests/test_i18n_and_plain_mode_parity.mjs")"
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
"${PYTHON_CMD[@]}" "$(host_path "$ROOT/tools/verify_audit_log.py")" "$(host_path "$aud2")" --trusted-pubkey-hex "$DET_SIGNER_PUBKEY"

log "Negative security suite (tamper / dev-signed / audit forgery must fail closed)"
"${PYTHON_CMD[@]}" "$(host_path "$ROOT/tests/run_security_negative.py")" --binary "$(host_path "$EXE")"
rm -f "$ROOT/caelus_audit_0000000000000000.log"

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
cargo build --release --locked --manifest-path "$(host_path "$ROOT/caelus_core/Cargo.toml")" --features std --bin caelus_core_repl
"${PYTHON_CMD[@]}" "$(host_path "$ROOT/tests/run_bs_exec_golden.py")" \
    --binary "$(host_path "$REPL_BIN")" \
    --reference-binary "$(host_path "$EXE")"

if [[ "$IS_WINDOWS_BASH" != "1" ]]; then
    log "Mobile C ABI bridge: host build + C++ bridge test suite"
    bash "$ROOT/tools/build_host_bridge.sh" --with-tests

    if command -v swift >/dev/null 2>&1; then
        log "Mobile Swift package: build + XCTest against the real native core"
        (cd "$ROOT/platforms/ios/CAELUSMobile" && swift build && swift test)

        log "Mobile BS-01 end-to-end demo (Swift -> C ABI -> shared core)"
        mobile_export="$(mktemp -d)"
        (cd "$ROOT/platforms/ios/CAELUSMobile" \
            && CAELUS_DEMO_EXPORT_DIR="$mobile_export" swift run caelus-mobile-demo)
        [[ -s "$mobile_export/audit_export.ndjson" ]] \
            || { rm -rf "$mobile_export"; die "mobile demo produced no audit export"; }

        log "Mobile demo audit chain + SEAL + neural identity verification"
        NEURAL_PUBKEY="c8527f9105465967aea81d07514ea11f597f32fedc7d6f8f9e7d182f999fc51f"
        "${PYTHON_CMD[@]}" "$ROOT/tools/verify_audit_log.py" \
            "$mobile_export/audit_export.ndjson" \
            --neural-model-dir "$ROOT/models/assurance_v1" \
            --trusted-neural-pubkey-hex "$NEURAL_PUBKEY"
        rm -rf "$mobile_export"
    else
        log "SKIP (no swift toolchain): mobile Swift package tests + BS-01 mobile demo"
    fi
fi

log "All checks passed"
