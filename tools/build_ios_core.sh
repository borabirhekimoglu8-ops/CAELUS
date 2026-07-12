#!/usr/bin/env bash
# =============================================================================
#  CAELUS Mobile — iOS core build (Rust staticlib + C++ bridge → XCFramework)
#
#  Produces dist/ios/CaelusCore.xcframework containing, per platform slice:
#    • libcaelus_network.a   (Rust: ed25519 gates, Blake3 audit chain, identity)
#    • caelus_mobile_bridge  (C++17: causal engine + neural stack + C ABI)
#  merged into one static library, plus the public C header and a Clang
#  module map so Swift imports it as `import CaelusCore`.
#
#  REQUIREMENTS (macOS build host):
#    • Xcode ≥ 15 with the iOS SDK (xcode-select -p must point at Xcode,
#      not the CommandLineTools-only install)
#    • rustup with the Apple targets installed:
#        rustup target add aarch64-apple-ios aarch64-apple-ios-sim \
#            x86_64-apple-ios
#    • cargo ≥ the repository MSRV (see rust-toolchain.toml if present)
#
#  USAGE:
#    tools/build_ios_core.sh                 # device + simulator slices
#    CAELUS_IOS_SIM_X86=1 tools/build_ios_core.sh   # add Intel-sim slice
#
#  On a non-macOS host this script stops after the environment report with
#  exit code 2 (deliberate: an iOS build cannot be produced or validated
#  here, and pretending otherwise would be a fake result).
#
#  SECURITY:
#    • No private key material is read, embedded, or generated here.
#    • Only pinned PUBLIC trust anchors (compiled into the sources) ship.
#    • Checksums (SHA-256) of every produced artifact are written next to
#      the XCFramework for supply-chain verification.
# =============================================================================
set -euo pipefail
IFS=$'\n\t'

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$ROOT/dist/ios"
BUILD_DIR="$ROOT/target/ios-build"
XCFRAMEWORK="$OUT_DIR/CaelusCore.xcframework"
MIN_IOS_VERSION="16.0"

RED='\033[0;31m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'; RESET='\033[0m'
die() { echo -e "${RED}[HATA]${RESET} $*" >&2; exit 1; }
ok()  { echo -e "${GREEN}[OK]${RESET}   $*"; }
inf() { echo -e "${CYAN}[INFO]${RESET}  $*"; }

# ── Environment report ───────────────────────────────────────────────────────
inf "CAELUS Mobile iOS core build"
inf "Repo root : $ROOT"
inf "Min iOS   : $MIN_IOS_VERSION"

if [[ "$(uname -s)" != "Darwin" ]]; then
    echo ""
    echo "Bu betik yalnızca macOS üzerinde iOS derlemesi üretebilir."
    echo "Bu host: $(uname -s). Çalıştırılması gereken komutlar (macOS'ta):"
    echo ""
    echo "  rustup target add aarch64-apple-ios aarch64-apple-ios-sim"
    echo "  tools/build_ios_core.sh"
    echo ""
    echo "Linux üzerinde doğrulanabilen kısım (paylaşılan çekirdek + köprü):"
    echo "  bash ci.sh   # C++/Rust testleri + mobil köprü test paketi"
    exit 2
fi

command -v xcodebuild >/dev/null 2>&1 || die "xcodebuild bulunamadı (Xcode kurulu ve seçili olmalı)."
command -v xcrun      >/dev/null 2>&1 || die "xcrun bulunamadı."
command -v cargo      >/dev/null 2>&1 || die "cargo bulunamadı (https://rustup.rs)."
command -v rustup     >/dev/null 2>&1 || die "rustup bulunamadı."
command -v libtool    >/dev/null 2>&1 || die "libtool bulunamadı."
command -v shasum     >/dev/null 2>&1 || die "shasum bulunamadı."
ok "Araçlar: xcodebuild=$(xcodebuild -version | head -1), cargo=$(cargo --version)"

# ── Targets ──────────────────────────────────────────────────────────────────
# slice-adı : rust-target : sdk : clang-arch : clang-target-triple
SLICES=(
    "device:aarch64-apple-ios:iphoneos:arm64:arm64-apple-ios${MIN_IOS_VERSION}"
    "sim-arm64:aarch64-apple-ios-sim:iphonesimulator:arm64:arm64-apple-ios${MIN_IOS_VERSION}-simulator"
)
if [[ "${CAELUS_IOS_SIM_X86:-0}" == "1" ]]; then
    SLICES+=("sim-x86_64:x86_64-apple-ios:iphonesimulator:x86_64:x86_64-apple-ios${MIN_IOS_VERSION}-simulator")
fi

for slice in "${SLICES[@]}"; do
    IFS=':' read -r _name rust_target _sdk _arch _triple <<< "$slice"
    rustup target list --installed | grep -q "^${rust_target}$" \
        || die "Rust hedefi eksik: rustup target add ${rust_target}"
done
ok "Rust Apple hedefleri kurulu."

rm -rf "$BUILD_DIR" "$XCFRAMEWORK"
mkdir -p "$BUILD_DIR" "$OUT_DIR"

# ── Public headers + module map ──────────────────────────────────────────────
HEADERS_DIR="$BUILD_DIR/headers"
mkdir -p "$HEADERS_DIR"
cp "$ROOT/include/mobile/caelus_mobile.h" "$HEADERS_DIR/"
cat > "$HEADERS_DIR/module.modulemap" <<'EOF'
module CaelusCore {
    header "caelus_mobile.h"
    export *
}
EOF
ok "Başlıklar hazırlandı → $HEADERS_DIR"

# ── Per-slice build ──────────────────────────────────────────────────────────
build_slice() {
    local name="$1" rust_target="$2" sdk="$3" arch="$4" triple="$5"
    local slice_dir="$BUILD_DIR/$name"
    mkdir -p "$slice_dir"

    inf "[$name] Rust staticlib ($rust_target)..."
    cargo build --release --locked --lib --target "$rust_target" \
        --manifest-path "$ROOT/Cargo.toml"
    local rust_lib="$ROOT/target/$rust_target/release/libcaelus_network.a"
    [[ -f "$rust_lib" ]] || die "[$name] Rust staticlib üretilemedi: $rust_lib"

    inf "[$name] C++ köprüsü (clang++, $triple, min iOS $MIN_IOS_VERSION)..."
    local sdk_path
    sdk_path="$(xcrun --sdk "$sdk" --show-sdk-path)"
    xcrun --sdk "$sdk" clang++ \
        -std=c++17 -O2 -fvisibility=hidden \
        -isysroot "$sdk_path" \
        -target "$triple" \
        -I"$ROOT" -I"$ROOT/include" -I"$ROOT/src" \
        -c "$ROOT/src/mobile/caelus_mobile_bridge.cpp" \
        -o "$slice_dir/caelus_mobile_bridge.o"

    inf "[$name] Statik kütüphane birleştirme..."
    xcrun --sdk "$sdk" libtool -static -no_warning_for_no_symbols \
        -o "$slice_dir/libCaelusCore.a" \
        "$slice_dir/caelus_mobile_bridge.o" \
        "$rust_lib"

    inf "[$name] Sembol doğrulaması..."
    local required_symbols=(
        _caelus_mobile_abi_version_v1
        _caelus_mobile_engine_create_v1
        _caelus_mobile_engine_destroy_v1
        _caelus_mobile_load_scenario_v1
        _caelus_mobile_load_neural_model_v1
        _caelus_mobile_tick_v1
        _caelus_mobile_apply_lever_v1
        _caelus_mobile_snapshot_json_v1
        _caelus_mobile_checkpoint_v1
        _caelus_mobile_restore_checkpoint_v1
        _caelus_mobile_audit_path_v1
        _caelus_mobile_audit_status_json_v1
        _caelus_mobile_export_audit_v1
        _caelus_mobile_note_lifecycle_v1
        _caelus_mobile_seal_session_v1
        _caelus_mobile_last_error_v1
        _caelus_mobile_blake3_v1
        _caelus_mobile_verify_model_signature_v1
        _caelus_mobile_register_key_protection_v1
    )
    local symbol_table
    symbol_table="$(xcrun --sdk "$sdk" nm -gU "$slice_dir/libCaelusCore.a" 2>/dev/null || true)"
    for symbol in "${required_symbols[@]}"; do
        echo "$symbol_table" | grep -q " $symbol\$" \
            || die "[$name] Zorunlu ABI sembolü eksik: $symbol"
    done
    ok "[$name] 19/19 ABI sembolü mevcut."
}

for slice in "${SLICES[@]}"; do
    IFS=':' read -r name rust_target sdk arch triple <<< "$slice"
    build_slice "$name" "$rust_target" "$sdk" "$arch" "$triple"
done

# ── Simulator slices → single fat library (xcframework wants one per SDK) ────
SIM_LIBS=()
[[ -f "$BUILD_DIR/sim-arm64/libCaelusCore.a"  ]] && SIM_LIBS+=("$BUILD_DIR/sim-arm64/libCaelusCore.a")
[[ -f "$BUILD_DIR/sim-x86_64/libCaelusCore.a" ]] && SIM_LIBS+=("$BUILD_DIR/sim-x86_64/libCaelusCore.a")
mkdir -p "$BUILD_DIR/simulator"
if (( ${#SIM_LIBS[@]} > 1 )); then
    xcrun lipo -create "${SIM_LIBS[@]}" -output "$BUILD_DIR/simulator/libCaelusCore.a"
else
    cp "${SIM_LIBS[0]}" "$BUILD_DIR/simulator/libCaelusCore.a"
fi
ok "Simülatör dilimi hazır (${#SIM_LIBS[@]} mimari)."

# ── XCFramework ──────────────────────────────────────────────────────────────
inf "XCFramework paketleme..."
xcodebuild -create-xcframework \
    -library "$BUILD_DIR/device/libCaelusCore.a"    -headers "$HEADERS_DIR" \
    -library "$BUILD_DIR/simulator/libCaelusCore.a" -headers "$HEADERS_DIR" \
    -output "$XCFRAMEWORK"
[[ -d "$XCFRAMEWORK" ]] || die "XCFramework üretilemedi."
ok "XCFramework → $XCFRAMEWORK"

# ── Checksums ────────────────────────────────────────────────────────────────
inf "SHA-256 sağlama toplamları..."
( cd "$OUT_DIR" && find CaelusCore.xcframework -type f -print0 \
    | sort -z \
    | xargs -0 shasum -a 256 ) > "$OUT_DIR/CaelusCore.xcframework.sha256"
ok "Checksums → $OUT_DIR/CaelusCore.xcframework.sha256"

# ── Size report ──────────────────────────────────────────────────────────────
DEVICE_KB=$(du -k "$BUILD_DIR/device/libCaelusCore.a" | cut -f1)
SIM_KB=$(du -k "$BUILD_DIR/simulator/libCaelusCore.a" | cut -f1)
inf "Cihaz dilimi   : ${DEVICE_KB} KB (statik arşiv; uygulamaya yalnızca kullanılan semboller linklenir)"
inf "Simülatör dilimi: ${SIM_KB} KB"

echo ""
ok "iOS core build tamamlandı."
echo "Sonraki adım: platforms/ios/CAELUSMobile projesini Xcode ile açın;"
echo "XCFramework referansı dist/ios/CaelusCore.xcframework yolunu bekler."
exit 0
