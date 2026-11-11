#!/usr/bin/env bash
# =============================================================================
#  CAELUS OS — Blackbox Build Automation Script (Linux / macOS)
#  Air-Gapped · Offline-First · Single Static Executable
#
#  Aşama 1: UI Varlık Karartma   → include/ui_payload.h  (hex byte array)
#  Aşama 2: Rust Derlemesi       → target/release/libcaelus_network.a (LTO+z)
#  Aşama 3: C++ Linkleme         → dist/caelus_os (static + strip-all)
# =============================================================================
set -euo pipefail          # Strict mode: exit on error, unset var, pipe fail
IFS=$'\n\t'

# ── Renk kodları ─────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PAYLOAD_H="$ROOT/include/ui_payload.h"
OUT_DIR="$ROOT/dist"
CORES="$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)"

# Detect OS for platform-specific flags
OS_TYPE="$(uname -s)"
if [[ "$OS_TYPE" == "Darwin" ]]; then
    RUST_LIB="$ROOT/target/release/libcaelus_network.a"
    STATIC_FLAG=""          # macOS: full -static breaks system libs; use -static-libgcc -static-libstdc++
    STATIC_LIBS="-static-libgcc -static-libstdc++"
    STRIP_CMD="strip"
    EXTRA_LINKER_FLAGS=""
else
    RUST_LIB="$ROOT/target/release/libcaelus_network.a"
    STATIC_FLAG="-static"
    STATIC_LIBS=""
    STRIP_CMD="strip"
    # No "-Wl,--allow-multiple-definition": on Linux the Rust staticlib and g++/
    # clang++ share the GNU ABI, so there are no duplicate symbols to suppress.
    # That flag silently picks one of two colliding definitions and can mask real
    # ODR / runtime mismatches.
    EXTRA_LINKER_FLAGS=""
fi

OUT_EXE="$OUT_DIR/caelus_os"
PROD_DEFINE=""
if [[ "${CAELUS_PRODUCTION:-0}" == "1" ]]; then
    PROD_DEFINE="-DCAELUS_PRODUCTION"
fi

# ── Hata mesajı yardımcısı ───────────────────────────────────────────────────
die() { echo -e "${RED}[HATA]${RESET} $*" >&2; exit 1; }
ok()  { echo -e "${GREEN}[OK]${RESET}   $*"; }
inf() { echo -e "${CYAN}[INFO]${RESET}  $*"; }
warn(){ echo -e "${YELLOW}[UYARI]${RESET} $*"; }

# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}╔══════════════════════════════════════════════════════════╗${RESET}"
echo -e "${BOLD}║    CAELUS OS — Blackbox Build System v1.0.0              ║${RESET}"
echo -e "${BOLD}║    Air-Gapped · Offline-First · Target: <50 MB ELF       ║${RESET}"
echo -e "${BOLD}╚══════════════════════════════════════════════════════════╝${RESET}"
echo ""

# ── Ön Kontrol ───────────────────────────────────────────────────────────────
inf "Araç bağımlılıkları kontrol ediliyor..."

command -v cargo   >/dev/null 2>&1 || die "'cargo' bulunamadı. Rust toolchain gerekli: https://rustup.rs"
ok "cargo: $(cargo --version)"

# Detect C++ compiler: prefer g++, fallback to clang++
CXX_BIN=""
if command -v g++ >/dev/null 2>&1; then
    CXX_BIN="g++"
    ok "C++ derleyici: g++ ($(g++ --version | head -1))"
elif command -v clang++ >/dev/null 2>&1; then
    CXX_BIN="clang++"
    ok "C++ derleyici: clang++ ($(clang++ --version | head -1))"
else
    die "Ne g++ ne de clang++ bulundu. Lütfen GCC veya LLVM kurun."
fi

[[ -f "$ROOT/ui/index.html" ]] || die "ui/index.html bulunamadı."
[[ -f "$ROOT/ui/scenario_compiler.js" ]] || die "ui/scenario_compiler.js bulunamadı."
[[ -f "$ROOT/ui/app.js"     ]] || die "ui/app.js bulunamadı."
ok "UI kaynak dosyaları: mevcut"
echo ""

mkdir -p "$ROOT/include" "$OUT_DIR"

# =============================================================================
# AŞAMA 1 — UI Varlık Karartma (Asset Obfuscation & Embedding)
# ui/index.html + ui/scenario_compiler.js + ui/app.js → include/ui_payload.h
# =============================================================================
echo -e "${BOLD}══════════════════════════════════════════════════════════════${RESET}"
echo -e "${BOLD}[AŞAMA 1/3] UI Gömme (Asset Embedding — gizleme/şifreleme DEĞİL)${RESET}"
echo -e "${BOLD}══════════════════════════════════════════════════════════════${RESET}"

inf "tools/embed_ui_payload.py ile tüm UI ve 4-Bölgeli Komuta Kokpiti varlıkları gömülüyor..."
if command -v python3 >/dev/null 2>&1; then
    PYTHON_EMBED=(python3)
elif command -v python >/dev/null 2>&1; then
    PYTHON_EMBED=(python)
elif command -v py >/dev/null 2>&1; then
    PYTHON_EMBED=(py -3)
else
    err "tools/embed_ui_payload.py için Python 3 bulunamadı."
    exit 1
fi

EMBED_ROOT="$ROOT"
EMBED_OUT="$PAYLOAD_H"
if command -v cygpath >/dev/null 2>&1 && [[ "$(uname -s)" =~ ^(MINGW|MSYS|CYGWIN) ]]; then
    EMBED_ROOT="$(cygpath -m "$ROOT")"
    EMBED_OUT="$(cygpath -m "$PAYLOAD_H")"
fi

"${PYTHON_EMBED[@]}" "$EMBED_ROOT/tools/embed_ui_payload.py" --root "$EMBED_ROOT" --output "$EMBED_OUT"
ok "Aşama 1 tamamlandı → $PAYLOAD_H"
echo ""

# =============================================================================
# AŞAMA 2 — Rust Shadow-Mesh Derlemesi (Size Optimization)
# cargo build --release → target/release/libcaelus_network.a
# =============================================================================
echo -e "${BOLD}══════════════════════════════════════════════════════════════${RESET}"
echo -e "${BOLD}[AŞAMA 2/3] Rust Shadow-Mesh Derlemesi (LTO + opt-z)${RESET}"
echo -e "${BOLD}══════════════════════════════════════════════════════════════${RESET}"

pushd "$ROOT" > /dev/null
if [[ "${CAELUS_SKIP_RUST:-0}" == "1" && -f "$RUST_LIB" ]]; then
    inf "CAELUS_SKIP_RUST=1 — mevcut $RUST_LIB yeniden kullanılıyor."
else
    cargo build --release --locked 2>&1 | sed 's/^/   /'
fi
if [[ ! -f "$RUST_LIB" ]]; then
    die "Beklenen statik kütüphane bulunamadı: $RUST_LIB"
fi
popd > /dev/null

RUST_SIZE_KB=$(du -k "$RUST_LIB" | cut -f1)
ok "Aşama 2 tamamlandı → $RUST_LIB"
inf "libcaelus_network.a boyutu: ${RUST_SIZE_KB} KB"
echo ""

# =============================================================================
# AŞAMA 3 — C++ Linkleme ve Mühürleme (Static Link + Strip)
# =============================================================================
echo -e "${BOLD}══════════════════════════════════════════════════════════════${RESET}"
echo -e "${BOLD}[AŞAMA 3/3] C++ Linkleme ve Mühürleme${RESET}"
echo -e "${BOLD}══════════════════════════════════════════════════════════════${RESET}"

# Additional system libs needed by Rust staticlib on Linux
if [[ "$OS_TYPE" != "Darwin" ]]; then
    SYS_LIBS=(-ldl -lpthread -lm)
else
    SYS_LIBS=()
fi

if [[ -n "$PROD_DEFINE" ]]; then
    inf "CAELUS_PRODUCTION=1 — dev/demo kapilari derleme-disi birakilacak."
fi
inf "Derleme başlıyor: $CXX_BIN -O3 -flto $STATIC_FLAG ..."

"$CXX_BIN" \
    -std=c++17 \
    -O3 \
    -flto \
    -DCAELUS_EMBEDDED_UI=1 \
    $PROD_DEFINE \
    $STATIC_FLAG \
    $STATIC_LIBS \
    -I"$ROOT" \
    -I"$ROOT/include" \
    -I"$ROOT/src" \
    "$ROOT/core_engine.cpp" \
    "$ROOT/src/intel_core.cpp" \
    -o "$OUT_EXE" \
    "$RUST_LIB" \
    "${SYS_LIBS[@]}" \
    $EXTRA_LINKER_FLAGS \
    2>&1 | sed 's/^/   /'

[[ -f "$OUT_EXE" ]] || die "Çıktı ELF dosyası oluşturulamadı: $OUT_EXE"
ok "Linkleme başarılı → $OUT_EXE"

# ── Strip debug symbols (tersine mühendislik engellemesi) ─────────────────────
inf "Debug sembolleri siliniyor (strip --strip-all)..."
if [[ "$OS_TYPE" == "Darwin" ]]; then
    # macOS strip syntax differs
    "$STRIP_CMD" "$OUT_EXE" 2>/dev/null && ok "strip tamamlandı (macOS)." \
        || warn "'strip' başarısız. macOS toolchain uyum sorunu olabilir."
else
    "$STRIP_CMD" --strip-all "$OUT_EXE" 2>/dev/null && ok "strip --strip-all tamamlandı." \
        || warn "'strip --strip-all' başarısız. binutils kurulu mu?"
fi

# Make executable
chmod +x "$OUT_EXE"

# ── Final binary report ───────────────────────────────────────────────────────
EXE_SIZE_BYTES=$(wc -c < "$OUT_EXE")
EXE_SIZE_KB=$(( EXE_SIZE_BYTES / 1024 ))
EXE_SIZE_MB=$(( EXE_SIZE_BYTES / 1048576 ))

echo ""
echo -e "${BOLD}══════════════════════════════════════════════════════════════${RESET}"
echo -e "${BOLD}[TAMAMLANDI] CAELUS OS Blackbox Binary Üretildi${RESET}"
echo -e "${BOLD}══════════════════════════════════════════════════════════════${RESET}"
echo -e "Çıktı   : ${CYAN}$OUT_EXE${RESET}"
echo -e "Boyut   : ${EXE_SIZE_KB} KB  (~${EXE_SIZE_MB} MB)"

if (( EXE_SIZE_BYTES < 50 * 1024 * 1024 )); then
    echo -e "Hedef   : ${GREEN}<50 MB ✓  BAŞARILI${RESET}"
else
    echo -e "Hedef   : ${RED}<50 MB ✗  AŞILDI${RESET} — UPX sıkıştırması deneyin: upx --best $OUT_EXE"
    die "Binary boyut bütçesi aşıldı (<50 MB zorunlu)."
fi

echo ""
echo -e "${YELLOW}[NOT]${RESET} UI varlıkları binary'ye gömüldü (hex bayt dizisi). Bu bir"
echo -e "       ŞİFRELEME ya da gizleme DEĞİLDİR: 'strings' ile HTML/JS aynen"
echo -e "       geri çıkarılabilir. Gerçek koruma için varlıkları AES ile"
echo -e "       şifreleyip çalışma anında çözün."
echo -e "${YELLOW}[NOT]${RESET} 'strip' yalnızca sembolleri temizler; gömülü UI metnini gizlemez."
echo ""

exit 0
