#!/usr/bin/env bash
# =============================================================================
#  CAELUS Mobile — host (Linux/macOS) bridge build for Swift tests
#
#  Produces dist/host/:
#    • libcaelus_host_bridge.a — C++ mobile C ABI bridge
#      (src/mobile/caelus_mobile_bridge.cpp), the exact translation unit the
#      iOS XCFramework ships.
#    • libcaelus_network.a     — Rust staticlib (ed25519 gates, Blake3 audit
#      chain, identity) for the HOST triple.
#
#  These are what platforms/ios/CAELUSMobile links on Linux so `swift test`
#  and the BS-01 mobile demo exercise the REAL native core — no mocks.
#
#  USAGE:
#    tools/build_host_bridge.sh            # build archives
#    tools/build_host_bridge.sh --with-tests   # also build+run the C++ bridge
#                                              # test suite (doctest harness)
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$ROOT/dist/host"
OBJ_DIR="$ROOT/build_tests"
CXX="${CXX:-g++}"

log() { printf '[HOST-BRIDGE] %s\n' "$*"; }
die() { printf '[HOST-BRIDGE FAIL] %s\n' "$*" >&2; exit 1; }

command -v "$CXX"  >/dev/null 2>&1 || die "missing C++ compiler: $CXX"
command -v cargo   >/dev/null 2>&1 || die "missing cargo (https://rustup.rs)"
command -v ar      >/dev/null 2>&1 || die "missing ar"

mkdir -p "$OUT_DIR" "$OBJ_DIR"

log "Rust staticlib (host triple, release, locked)"
cargo build --release --locked --lib --manifest-path "$ROOT/Cargo.toml"
RUST_LIB="$ROOT/target/release/libcaelus_network.a"
[[ -f "$RUST_LIB" ]] || die "Rust staticlib missing: $RUST_LIB"
cp -f "$RUST_LIB" "$OUT_DIR/libcaelus_network.a"

log "C++ mobile bridge → static archive"
"$CXX" -std=c++17 -O2 -fPIC \
    -I"$ROOT" -I"$ROOT/include" -I"$ROOT/src" \
    -c "$ROOT/src/mobile/caelus_mobile_bridge.cpp" \
    -o "$OBJ_DIR/caelus_mobile_bridge_host.o"
rm -f "$OUT_DIR/libcaelus_host_bridge.a"
ar rcs "$OUT_DIR/libcaelus_host_bridge.a" \
    "$OBJ_DIR/caelus_mobile_bridge_host.o"

log "Archive symbols sanity check"
REQUIRED_SYMBOLS=(
    caelus_mobile_abi_version_v1
    caelus_mobile_engine_create_v1
    caelus_mobile_engine_destroy_v1
    caelus_mobile_load_scenario_v1
    caelus_mobile_load_neural_model_v1
    caelus_mobile_tick_v1
    caelus_mobile_apply_lever_v1
    caelus_mobile_snapshot_json_v1
    caelus_mobile_checkpoint_v1
    caelus_mobile_restore_checkpoint_v1
    caelus_mobile_audit_path_v1
    caelus_mobile_audit_status_json_v1
    caelus_mobile_export_audit_v1
    caelus_mobile_note_lifecycle_v1
    caelus_mobile_seal_session_v1
    caelus_mobile_last_error_v1
    caelus_mobile_blake3_v1
    caelus_mobile_verify_model_signature_v1
    caelus_mobile_trusted_anchors_json_v1
    caelus_mobile_register_key_protection_v1
)
SYMBOL_TABLE="$(nm -g --defined-only "$OUT_DIR/libcaelus_host_bridge.a")"
for symbol in "${REQUIRED_SYMBOLS[@]}"; do
    echo "$SYMBOL_TABLE" | grep -q " T ${symbol}\$" \
        || die "required ABI symbol missing from archive: $symbol"
done
log "${#REQUIRED_SYMBOLS[@]}/${#REQUIRED_SYMBOLS[@]} ABI symbols present."

if [[ "${1:-}" == "--with-tests" ]]; then
    log "C++ bridge test suite"
    "$CXX" -std=c++17 -O2 \
        -I"$ROOT" -I"$ROOT/include" -I"$ROOT/src" -I"$ROOT/tests" \
        "$ROOT/tests/test_mobile_bridge.cpp" \
        "$OUT_DIR/libcaelus_host_bridge.a" \
        "$OUT_DIR/libcaelus_network.a" \
        -ldl -lpthread -lm \
        -o "$ROOT/build_tests/test_mobile_bridge"
    CAELUS_REPO_ROOT="$ROOT" "$ROOT/build_tests/test_mobile_bridge"
fi

log "done → $OUT_DIR"
