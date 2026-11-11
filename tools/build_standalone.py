#!/usr/bin/env python3
"""CAELUS — bilgisayardan bağımsız (standalone) War Room ve PWA sayfası üretici.

Nedensel motoru (caelus_core -> caelus_wasm, WebAssembly) + War Room UI'ını +
imzalı senaryoları hem TEK bir self-contained HTML dosyasına (dist/caelus_standalone.html)
gömer hem de GitHub Pages (/CAELUS/ alt dizini dahil) ve iPhone Safari/WebKit için
tam çevrimdışı PWA paketini (dist/index.html, dist/caelus_wasm.wasm, dist/manifest.webmanifest,
dist/sw.js, dist/assets/, dist/vendor/) üretir.

Önkoşul (bir kez):
    rustup target add wasm32-unknown-unknown
Derleme:
    cargo build --release --locked --target wasm32-unknown-unknown -p caelus_wasm
    python3 tools/build_standalone.py
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import re
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WASM_CANDIDATES = [
    ROOT / "target/wasm32-unknown-unknown/release/caelus_wasm.wasm",
    ROOT / "caelus_wasm/target/wasm32-unknown-unknown/release/caelus_wasm.wasm",
]
SCENARIOS = ["BS-01_SAHTE_UFUK", "BS-02_GOLGE_ARSIV", "BS-03_KUM_SAATI"]
SIG_RE = re.compile(r"^ed25519:([0-9a-fA-F]{64}):([0-9a-fA-F]{128})$")
ROOT_ABS_ATTR_RE = re.compile(r'(?:src|href)\s*=\s*["\']\/[^\/]')


def resolve_wasm_binary() -> Path | None:
    existing = [p for p in WASM_CANDIDATES if p.is_file() and p.stat().st_size > 0]
    if existing:
        existing.sort(key=lambda p: p.stat().st_mtime, reverse=True)
        return existing[0]
    existing_standalone = ROOT / "dist/caelus_standalone.html"
    if existing_standalone.exists():
        raw_st = existing_standalone.read_text(encoding="utf-8")
        m_wasm = re.search(r'window\.CAELUS_WASM_B64\s*=\s*"([^"]+)"', raw_st)
        if m_wasm:
            fallback_wasm = WASM_CANDIDATES[0]
            fallback_wasm.parent.mkdir(parents=True, exist_ok=True)
            fallback_wasm.write_bytes(base64.b64decode(m_wasm.group(1)))
            print(f"[BİLGİ] {fallback_wasm} mevcut dist/caelus_standalone.html içinden geri yüklendi.")
            return fallback_wasm
    return None


def write_utf8_lf(path: Path, content: str) -> None:
    with path.open("w", encoding="utf-8", newline="\n") as fh:
        fh.write(content)


def main() -> int:
    wasm_path = resolve_wasm_binary()
    if wasm_path is None or not wasm_path.exists():
        print(
            "HATA: caelus_wasm.wasm bulunamadı. Önce WASM motorunu derleyin:\n"
            "  cargo build --release --locked --target wasm32-unknown-unknown -p caelus_wasm",
            file=sys.stderr,
        )
        return 1

    wasm_bytes = wasm_path.read_bytes()
    if len(wasm_bytes) < 8 or wasm_bytes[:4] != b"\x00asm":
        print(f"HATA: {wasm_path} geçerli bir WebAssembly ikilisi değil", file=sys.stderr)
        return 1

    idx = (ROOT / "ui/index.html").read_text(encoding="utf-8")
    tokens_css_path = ROOT / "ui/tokens.css"
    tokens_css = tokens_css_path.read_text(encoding="utf-8") if tokens_css_path.exists() else ""
    if tokens_css:
        idx = idx.replace(
            '<link rel="stylesheet" href="./tokens.css">',
            "<style>\n" + tokens_css + "\n</style>",
        )
    compilerjs = (ROOT / "ui/scenario_compiler.js").read_text(encoding="utf-8")
    lwmjs_path = ROOT / "ui/living_world_model.js"
    lwmjs = lwmjs_path.read_text(encoding="utf-8") if lwmjs_path.exists() else ""
    dvejs_path = ROOT / "ui/discovery_value_engine.js"
    dvejs = dvejs_path.read_text(encoding="utf-8") if dvejs_path.exists() else ""
    frtjs_path = ROOT / "ui/first_real_task_engine.js"
    frtjs = frtjs_path.read_text(encoding="utf-8") if frtjs_path.exists() else ""
    paajs_path = ROOT / "ui/personal_agent_and_advisor.js"
    paajs = paajs_path.read_text(encoding="utf-8") if paajs_path.exists() else ""
    spjs_path = ROOT / "ui/spatial_experience.js"
    spjs = spjs_path.read_text(encoding="utf-8") if spjs_path.exists() else ""
    i18n_js_path = ROOT / "ui/war_room_i18n.js"
    i18n_js = i18n_js_path.read_text(encoding="utf-8") if i18n_js_path.exists() else ""
    airlock_mcp_path = ROOT / "ui/sidecar_airlock_mcp.js"
    airlock_mcp_js = airlock_mcp_path.read_text(encoding="utf-8") if airlock_mcp_path.exists() else ""
    ag_ui_engine_path = ROOT / "ui/war_room_ag_ui_engine.js"
    ag_ui_engine_js = ag_ui_engine_path.read_text(encoding="utf-8") if ag_ui_engine_path.exists() else ""
    cockpit_js_path = ROOT / "ui/war_room_cockpit.js"
    cockpit_js = cockpit_js_path.read_text(encoding="utf-8") if cockpit_js_path.exists() else ""
    appjs = (ROOT / "ui/app.js").read_text(encoding="utf-8")
    wasm_b64 = base64.b64encode(wasm_bytes).decode("ascii")
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
        "function fluctuate() {\n  return; // STANDALONE: yerel WASM motoru gerçek veri verir; jitter yok\n  if (state.isTyping) return;",
    )

    pilot_manifest_path = ROOT / "configs/source_manifest.json"
    pilot_batch_path = ROOT / "scenarios/pilot_aegean_ferry_airlock/events.airlock.ndjson"
    pilot_meta_path = ROOT / "scenarios/pilot_aegean_ferry_airlock/pilot_scenario_meta.json"
    pilot_bundle = {}
    if pilot_manifest_path.exists() and pilot_batch_path.exists():
        pilot_bundle = {
            "manifest_json": pilot_manifest_path.read_text(encoding="utf-8"),
            "batch_ndjson": pilot_batch_path.read_text(encoding="utf-8"),
            "meta": json.loads(pilot_meta_path.read_text(encoding="utf-8")) if pilot_meta_path.exists() else {},
        }

    content_hasher = hashlib.sha256()
    for part in (
        idx,
        tokens_css,
        compilerjs,
        lwmjs,
        dvejs,
        frtjs,
        paajs,
        spjs,
        i18n_js,
        airlock_mcp_js,
        ag_ui_engine_js,
        cockpit_js,
        appjs,
        json.dumps(pilot_bundle, sort_keys=True),
    ):
        content_hasher.update(part.encode("utf-8"))
    content_hasher.update(wasm_bytes)
    content_sha10 = content_hasher.hexdigest()[:10]
    env_sha = os.environ.get("GITHUB_SHA", "").strip()[:8]
    build_sha = f"{env_sha}-{content_sha10}" if env_sha else content_sha10
    inject = (
        "<script>\n"
        "window.CAELUS_WASM_B64=" + json.dumps(wasm_b64) + ";\n"
        "window.CAELUS_SCENARIOS=" + json.dumps(scen) + ";\n"
        "window.CAELUS_AIRLOCK_PILOT_BUNDLE=" + json.dumps(pilot_bundle) + ";\n"
        "window.CAELUS_BUILD_SHA=" + json.dumps(build_sha) + ";\n"
        "</script>\n"
    )
    logo_path = ROOT / "ui/assets/caelus-logo.png"
    if logo_path.exists():
        logo_b64 = base64.b64encode(logo_path.read_bytes()).decode("ascii")
        logo_data_uri = f"data:image/png;base64,{logo_b64}"
        idx = idx.replace('src="./assets/caelus-logo.png"', f'src="{logo_data_uri}"')
        idx = idx.replace('src="/assets/caelus-logo.png"', f'src="{logo_data_uri}"')

    sw_register_snippet = (
        "<script>\n"
        "if ('serviceWorker' in navigator && "
        "(location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1') && "
        "location.port !== '47809') {\n"
        "  window.addEventListener('load', function () {\n"
        "    navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(function () {});\n"
        "  });\n"
        "}\n"
        "</script>\n"
    )

    out = re.sub(
        r'<script src="scenario_compiler\.js"></script>[\s\S]*?<script src="app\.js"></script>',
        lambda _: (
            inject
            + "<script>\n" + compilerjs + "\n</script>\n"
            + ("<script>\n" + lwmjs + "\n</script>\n" if lwmjs else "")
            + ("<script>\n" + dvejs + "\n</script>\n" if dvejs else "")
            + ("<script>\n" + frtjs + "\n</script>\n" if frtjs else "")
            + ("<script>\n" + paajs + "\n</script>\n" if paajs else "")
            + ("<script>\n" + spjs + "\n</script>\n" if spjs else "")
            + ("<script>\n" + i18n_js + "\n</script>\n" if i18n_js else "")
            + ("<script>\n" + airlock_mcp_js + "\n</script>\n" if airlock_mcp_js else "")
            + ("<script>\n" + ag_ui_engine_js + "\n</script>\n" if ag_ui_engine_js else "")
            + ("<script>\n" + cockpit_js + "\n</script>\n" if cockpit_js else "")
            + "<script>\n" + appjs + "\n</script>\n"
            + sw_register_snippet
        ),
        idx,
        count=1,
    )
    if '<script src="app.js"></script>' in out:
        print("HATA: standalone JS gömme işaretçisi bulunamadı", file=sys.stderr)
        return 1

    root_abs_hit = ROOT_ABS_ATTR_RE.search(out)
    if root_abs_hit:
        print(
            f"HATA: dist/index.html içinde subpath (/CAELUS/) uyumsuz kök-mutlak bağlantı tespit edildi: "
            f"{root_abs_hit.group(0)}",
            file=sys.stderr,
        )
        return 1

    dist = ROOT / "dist"
    dist.mkdir(exist_ok=True)

    # Kopyalanan yerel varlıklar: GitHub Pages (/CAELUS/) ve çevrimdışı PWA için
    shutil.copy2(wasm_path, dist / "caelus_wasm.wasm")
    if tokens_css_path.is_file():
        shutil.copy2(tokens_css_path, dist / "tokens.css")
    ui_assets_dir = ROOT / "ui/assets"
    if ui_assets_dir.is_dir():
        shutil.copytree(ui_assets_dir, dist / "assets", dirs_exist_ok=True)
    ui_vendor_dir = ROOT / "ui/vendor"
    if ui_vendor_dir.is_dir():
        shutil.copytree(ui_vendor_dir, dist / "vendor", dirs_exist_ok=True)
    locales_dir = ROOT / "locales"
    if locales_dir.is_dir():
        shutil.copytree(locales_dir, dist / "locales", dirs_exist_ok=True)

    target = dist / "index.html"
    write_utf8_lf(target, out)
    # Eski paylaşılmış bağlantıları bozmamak için aynı self-contained sayfayı
    # legacy dosya adıyla da üret.
    write_utf8_lf(dist / "caelus_standalone.html", out)

    manifest = {
        "name": "CAELUS OS — Endüstriyel Komuta Kokpiti",
        "short_name": "CAELUS C2",
        "description": "Air-gapped deterministic causal C2 war room & Sidecar Airlock",
        "start_url": "./",
        "scope": "./",
        "display": "standalone",
        "orientation": "any",
        "background_color": "#0b1017",
        "theme_color": "#0b1017",
        "lang": "tr",
        "icons": [
            {
                "src": "./assets/caelus-symbol.svg",
                "sizes": "any",
                "type": "image/svg+xml",
                "purpose": "any",
            },
            {
                "src": "./assets/caelus-logo.png",
                "sizes": "512x512",
                "type": "image/png",
                "purpose": "any maskable",
            },
        ],
    }
    write_utf8_lf(
        dist / "manifest.webmanifest",
        json.dumps(manifest, ensure_ascii=False, separators=(",", ":")),
    )

    cache_name = f"caelus-{build_sha}"
    service_worker = f"""'use strict';
const CACHE = {json.dumps(cache_name)};
const ASSETS = [
  './',
  './index.html',
  './caelus_standalone.html',
  './manifest.webmanifest',
  './caelus_wasm.wasm',
  './assets/caelus-symbol.svg',
  './assets/caelus-logo.png'
];
self.addEventListener('install', event => {{
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
}});
self.addEventListener('activate', event => {{
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
}});
self.addEventListener('fetch', event => {{
  if (event.request.method !== 'GET') return;
  const reqUrl = new URL(event.request.url);
  if (reqUrl.origin !== self.location.origin) return;

  if (event.request.mode === 'navigate') {{
    event.respondWith(
      fetch(event.request)
        .then(response => {{
          if (response.ok) {{
            const copy = response.clone();
            caches.open(CACHE).then(cache => cache.put('./index.html', copy));
          }}
          return response;
        }})
        .catch(() => caches.match(event.request).then(hit => hit || caches.match('./index.html') || caches.match('./')))
    );
    return;
  }}

  event.respondWith(
    caches.match(event.request).then(cached => {{
      const networkFetch = fetch(event.request).then(response => {{
        if (response.ok) {{
          const copy = response.clone();
          caches.open(CACHE).then(cache => cache.put(event.request, copy));
        }}
        return response;
      }});
      return cached || networkFetch;
    }})
  );
}});
"""
    write_utf8_lf(dist / "sw.js", service_worker)
    write_utf8_lf(dist / ".nojekyll", "")
    print(
        f"yazıldı: {target} ({len(out)} bayt; wasm {len(wasm_bytes)} bayt [{wasm_path.relative_to(ROOT)}], "
        f"senaryolar: {', '.join(scen)})"
    )
    print("iPhone/Safari ve masaüstü için subpath-safe (/CAELUS/) PWA paketi hazır — ilk açılıştan sonra çevrimdışı çalışır.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
