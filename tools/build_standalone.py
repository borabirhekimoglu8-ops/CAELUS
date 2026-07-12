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
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WASM = ROOT / "caelus_wasm/target/wasm32-unknown-unknown/release/caelus_wasm.wasm"
SCENARIOS = ["BS-01_SAHTE_UFUK", "BS-02_GOLGE_ARSIV", "BS-03_KUM_SAATI"]
SIG_RE = re.compile(r"^ed25519:([0-9a-fA-F]{64}):([0-9a-fA-F]{128})$")


def main() -> int:
    if not WASM.exists():
        print(f"HATA: {WASM} yok. Önce wasm'ı derleyin:\n"
              f"  cargo build --release --target wasm32-unknown-unknown "
              f"--manifest-path caelus_wasm/Cargo.toml", file=sys.stderr)
        return 1

    idx = (ROOT / "ui/index.html").read_text(encoding="utf-8")
    appjs = (ROOT / "ui/app.js").read_text(encoding="utf-8")
    wasm_b64 = base64.b64encode(WASM.read_bytes()).decode("ascii")
    trusted_pubkey = (ROOT / "tools/caelus_trusted_pubkey.txt").read_text(encoding="ascii").strip().lower()
    if not re.fullmatch(r"[0-9a-f]{64}", trusted_pubkey):
        print("HATA: tools/caelus_trusted_pubkey.txt geçersiz", file=sys.stderr)
        return 1

    scen: dict[str, str] = {}
    for name in SCENARIOS:
        raw = (ROOT / f"scenarios/{name}.json").read_text(encoding="utf-8")
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError as exc:
            print(f"HATA: {name} JSON ayrıştırılamadı: {exc}", file=sys.stderr)
            return 1
        match = SIG_RE.fullmatch(str(parsed.get("signature", "")))
        if not match or match.group(1).lower() != trusted_pubkey:
            print(f"HATA: {name} imzası pinlenmiş CAELUS anahtarıyla eşleşmiyor", file=sys.stderr)
            return 1
        if parsed.get("id") != name:
            print(f"HATA: {name} dosya adı ile paket id alanı eşleşmiyor", file=sys.stderr)
            return 1
        scen[name] = raw

    # Standalone'da offline jitter'ı sustur (yerel motor gerçek veri verir).
    appjs = appjs.replace(
        "function fluctuate() {\n  if (state.isTyping) return;",
        "function fluctuate() {\n  return; // STANDALONE: yerel WASM motoru gerçek veri verir; jitter yok\n  if (state.isTyping) return;")

    build_sha = os.environ.get("GITHUB_SHA", "local")[:12]
    inject = ("<script>\n"
              "window.CAELUS_WASM_B64=" + json.dumps(wasm_b64) + ";\n"
              "window.CAELUS_SCENARIOS=" + json.dumps(scen) + ";\n"
              "window.CAELUS_BUILD_SHA=" + json.dumps(build_sha) + ";\n"
              "</script>\n")
    out = idx.replace('<script src="app.js"></script>',
                      inject + "<script>\n" + appjs + "\n</script>")

    dist = ROOT / "dist"
    dist.mkdir(exist_ok=True)
    target = dist / "index.html"
    target.write_text(out, encoding="utf-8")
    # Eski paylaşılmış bağlantıları bozmamak için aynı self-contained sayfayı
    # legacy dosya adıyla da üret.
    (dist / "caelus_standalone.html").write_text(out, encoding="utf-8")

    manifest = {
        "name": "CAELUS Universal Decision Engine",
        "short_name": "CAELUS",
        "description": "Offline-first deterministic causal decision engine",
        "start_url": "./",
        "scope": "./",
        "display": "standalone",
        "orientation": "any",
        "background_color": "#05090f",
        "theme_color": "#05090f",
    }
    (dist / "manifest.webmanifest").write_text(
        json.dumps(manifest, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )

    cache_name = f"caelus-{build_sha}"
    service_worker = f"""'use strict';
const CACHE = {json.dumps(cache_name)};
const ASSETS = ['./', './index.html', './caelus_standalone.html', './manifest.webmanifest'];
self.addEventListener('install', event => {{
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
}});
self.addEventListener('activate', event => {{
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
}});
self.addEventListener('fetch', event => {{
  if (event.request.method !== 'GET') return;
  event.respondWith(fetch(event.request).then(response => {{
    const copy = response.clone();
    caches.open(CACHE).then(cache => cache.put(event.request, copy));
    return response;
  }}).catch(() => caches.match(event.request).then(hit => hit || caches.match('./index.html'))));
}});
"""
    (dist / "sw.js").write_text(service_worker, encoding="utf-8")
    (dist / ".nojekyll").write_text("", encoding="ascii")
    print(f"yazıldı: {target} ({len(out)} bayt; wasm {len(wasm_b64)} b64, "
          f"senaryolar: {', '.join(scen)})")
    print("iPhone/Safari ve masaüstü için PWA paketi hazır — ilk açılıştan sonra çevrimdışı çalışır.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
