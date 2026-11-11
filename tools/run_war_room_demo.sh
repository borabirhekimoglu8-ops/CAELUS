#!/usr/bin/env bash
# ==============================================================================
# CAELUS OS — War Room Kokpiti, 4 Uzman Ajan ve Sidecar Airlock Başlatıcı (.sh)
#
# Kullanım:
#   ./tools/run_war_room_demo.sh              # Varsayılan: %100 Hava Boşluklu (Offline) Ege Pilotu
#   ./tools/run_war_room_demo.sh --offline    # Çevrimdışı T1 (08:10) -> T2 (08:25) Replay Modu
#   ./tools/run_war_room_demo.sh --live       # Canlı Open-Meteo Marine + OpenSky + AISStream Modu
#   ./tools/run_war_room_demo.sh --verify     # Tek geçişli doğrulama (sunucuyu bloklamadan çıkar)
# ==============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

MODE="--offline"
VERIFY_ONLY="0"
PORT="${CAELUS_WAR_ROOM_PORT:-47809}"

for arg in "$@"; do
  case "$arg" in
    --live)
      MODE="--live"
      ;;
    --offline)
      MODE="--offline"
      ;;
    --verify|--verify-only)
      VERIFY_ONLY="1"
      ;;
  esac
done

echo "=================================================================="
echo "  CAELUS OS // WAR ROOM — 4-Katmanlı Komuta Kokpiti Başlatılıyor"
echo "  Mod: ${MODE} | Bağlantı: http://127.0.0.1:${PORT} (WS /ws)"
echo "=================================================================="

echo "[1/4] Rust Sidecar Airlock ve Denetim Doğrulayıcı derleniyor..."
cargo build --release --locked --bin caelus_sidecar_airlock --bin caelus_verify_audit

echo "[2/4] Ege Feribot Pilot veri seti ve Manifest v2.0 mühürleri doğrulanıyor..."
if [[ ! -f "$ROOT/configs/source_manifest.json" || ! -f "$ROOT/scenarios/pilot_aegean_ferry_airlock/events.airlock.ndjson" ]]; then
  "$ROOT/target/release/caelus_sidecar_airlock" build-aegean-pilot
fi

echo "[3/4] WASM çekirdeği ve Hava Boşluklu Standalone/PWA paketi güncelleniyor..."
if rustup target list --installed 2>/dev/null | grep -q "wasm32-unknown-unknown"; then
  cargo build --release --locked --manifest-path "$ROOT/caelus_wasm/Cargo.toml" --target wasm32-unknown-unknown
fi
python3 -W error "$ROOT/tools/build_standalone.py"

if [[ "$VERIFY_ONLY" == "1" ]]; then
  echo "[4/4] MCP 64-Bit ve AG-UI doğrulama testi çalıştırılıyor..."
  node "$ROOT/tools/caelus_mcp_server.mjs" --self-test
  echo "[OK] Tek geçişli doğrulama tamamlandı."
  exit 0
fi

echo "[4/4] AG-UI 4-Ajan WebSocket & Kokpit Sunucusu başlatılıyor (127.0.0.1:${PORT})..."
echo "      Tarayıcınızda açın: http://127.0.0.1:${PORT}"
exec node "$ROOT/tools/caelus_ag_ui_ws_server.mjs" "$MODE" --port "$PORT"

