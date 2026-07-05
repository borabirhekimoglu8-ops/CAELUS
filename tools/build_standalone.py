#!/usr/bin/env python3
"""CAELUS — bilgisayardan bağımsız (standalone) War Room sayfası üretici.

Nedensel motoru (caelus_core → caelus_wasm, WebAssembly) + War Room UI'ını +
imzalı senaryoları TEK bir self-contained HTML dosyasına gömer. Sonuç dosya
sunucu/masaüstü/ağ olmadan (file:// dahil) telefon/tarayıcıda gerçek
simülasyonu çalıştırır — demo/uydurma veri yoktur.

Önkoşul (bir kez):
    rustup target add wasm32-unknown-unknown
Derleme:
    cargo build --release --target wasm32-unknown-unknown \
        --manifest-path caelus_wasm/Cargo.toml
    python3 tools/build_standalone.py            # → dist/caelus_standalone.html
"""

from __future__ import annotations
import base64
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WASM = ROOT / "caelus_wasm/target/wasm32-unknown-unknown/release/caelus_wasm.wasm"
SCENARIOS = ["BS-01_SAHTE_UFUK", "BS-02_GOLGE_ARSIV", "BS-03_KUM_SAATI"]


def main() -> int:
    if not WASM.exists():
        print(f"HATA: {WASM} yok. Önce wasm'ı derleyin:\n"
              f"  cargo build --release --target wasm32-unknown-unknown "
              f"--manifest-path caelus_wasm/Cargo.toml", file=sys.stderr)
        return 1

    idx = (ROOT / "ui/index.html").read_text(encoding="utf-8")
    appjs = (ROOT / "ui/app.js").read_text(encoding="utf-8")
    wasm_b64 = base64.b64encode(WASM.read_bytes()).decode("ascii")
    scen = {n: (ROOT / f"scenarios/{n}.json").read_text(encoding="utf-8") for n in SCENARIOS}

    # Standalone'da offline jitter'ı sustur (yerel motor gerçek veri verir).
    appjs = appjs.replace(
        "function fluctuate() {\n  if (state.isTyping) return;",
        "function fluctuate() {\n  return; // STANDALONE: yerel WASM motoru gerçek veri verir; jitter yok\n  if (state.isTyping) return;")

    inject = ("<script>\n"
              "window.CAELUS_WASM_B64=" + json.dumps(wasm_b64) + ";\n"
              "window.CAELUS_SCENARIOS=" + json.dumps(scen) + ";\n"
              "</script>\n")
    out = idx.replace('<script src="app.js"></script>',
                      inject + "<script>\n" + appjs + "\n</script>")

    dist = ROOT / "dist"
    dist.mkdir(exist_ok=True)
    target = dist / "caelus_standalone.html"
    target.write_text(out, encoding="utf-8")
    print(f"yazıldı: {target} ({len(out)} bayt; wasm {len(wasm_b64)} b64, "
          f"senaryolar: {', '.join(scen)})")
    print("Bu dosyayı telefonda/tarayıcıda açın — sunucu/ağ/masaüstü gerekmez.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
