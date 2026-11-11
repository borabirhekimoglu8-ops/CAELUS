#!/usr/bin/env python3
"""CAELUS OS — Deterministik Tek-İkili (Single-Binary) UI Payload Gömücü.

build.bat (Windows MSVC/MinGW) ve build.sh (Linux/macOS GCC/Clang) tarafından
Aşama 1'de çağrılır. ui/index.html içine:
  - ui/tokens.css tasarım tokenlarını,
  - ui/assets/caelus-logo.png görselini (data URI),
  - imzalı senaryoları (window.CAELUS_SCENARIOS) ve Ege Feribot Airlock pilot
    paketini (window.CAELUS_AIRLOCK_PILOT_BUNDLE),
  - tüm yardımcı motorları + Sidecar Airlock MCP + 4-Ajan AG-UI + 4-Bölgeli
    Komuta Kokpiti modüllerini (sidecar_airlock_mcp.js, war_room_ag_ui_engine.js,
    war_room_cockpit.js)
deterministik UTF-8 LF olarak gömer ve include/ui_payload.h başlığını üretir.

Böylece hem http://127.0.0.1:47809 (C++ HTTP sunucusu) hem de %TEMP%/caelus_ui.html
üzerinden açılan tek-ikili dist/caelus_os(.exe) %100 hava boşluklu olarak yeni
4-Bölgeli Endüstriyel Komuta Kokpiti'ni eksiksiz çalıştırır.
"""

from __future__ import annotations

import argparse
import base64
import json
import re
import sys
from pathlib import Path

SCENARIOS = ["BS-01_SAHTE_UFUK", "BS-02_GOLGE_ARSIV", "BS-03_KUM_SAATI"]
SIG_RE = re.compile(r"^ed25519:([0-9a-fA-F]{64}):([0-9a-fA-F]{128})$")

INLINE_MODULES = [
    "ui/living_world_model.js",
    "ui/discovery_value_engine.js",
    "ui/first_real_task_engine.js",
    "ui/personal_agent_and_advisor.js",
    "ui/spatial_experience.js",
    "ui/sidecar_airlock_mcp.js",
    "ui/war_room_ag_ui_engine.js",
    "ui/war_room_cockpit.js",
]

# Not literal strings in source so scanning tools/ never false-triggers:
FORBIDDEN_BYPASS_TOKENS = [
    b"CAELUS_ALLOW_" + b"DEV_SCENARIOS",
    b"CAELUS_TRUST_" + b"ANY_PUBKEY",
    b"CAELUS_PLUGIN_" + b"ALLOW_UNVERIFIED",
]


def build_embedded_html(root: Path) -> bytes:
    idx = (root / "ui/index.html").read_text(encoding="utf-8")

    tokens_css_path = root / "ui/tokens.css"
    if tokens_css_path.is_file():
        tokens_css = tokens_css_path.read_text(encoding="utf-8")
        idx = idx.replace(
            '<link rel="stylesheet" href="./tokens.css">',
            "<style>\n" + tokens_css + "\n</style>",
        )

    logo_path = root / "ui/assets/caelus-logo.png"
    if logo_path.is_file():
        logo_b64 = base64.b64encode(logo_path.read_bytes()).decode("ascii")
        logo_uri = f"data:image/png;base64,{logo_b64}"
        idx = idx.replace('src="./assets/caelus-logo.png"', f'src="{logo_uri}"')
        idx = idx.replace('src="/assets/caelus-logo.png"', f'src="{logo_uri}"')

    trusted_pubkey = (
        (root / "tools/caelus_trusted_pubkey.txt").read_text(encoding="ascii").strip().lower()
    )
    if not re.fullmatch(r"[0-9a-f]{64}", trusted_pubkey):
        raise RuntimeError("tools/caelus_trusted_pubkey.txt gecersiz Ed25519 anahtari")

    scen: dict[str, str] = {}
    for name in SCENARIOS:
        raw = (root / f"scenarios/{name}.json").read_text(encoding="utf-8")
        parsed = json.loads(raw)
        match = SIG_RE.fullmatch(str(parsed.get("signature", "")))
        if not match or match.group(1).lower() != trusted_pubkey:
            raise RuntimeError(f"{name} imzasi pinli CAELUS anahtariyla eslesmiyor")
        if parsed.get("id") != name:
            raise RuntimeError(f"{name} paket id alani eslesmiyor")
        scen[name] = raw

    pilot_manifest_path = root / "configs/source_manifest.json"
    pilot_batch_path = root / "scenarios/pilot_aegean_ferry_airlock/events.airlock.ndjson"
    pilot_meta_path = root / "scenarios/pilot_aegean_ferry_airlock/pilot_scenario_meta.json"
    pilot_bundle: dict[str, object] = {}
    if pilot_manifest_path.is_file() and pilot_batch_path.is_file():
        pilot_bundle = {
            "batch_ndjson": pilot_batch_path.read_text(encoding="utf-8"),
            "manifest_json": pilot_manifest_path.read_text(encoding="utf-8"),
            "meta": (
                json.loads(pilot_meta_path.read_text(encoding="utf-8"))
                if pilot_meta_path.is_file()
                else {}
            ),
        }

    inject_parts = [
        '<script src="scenario_compiler.js"></script>\n',
        "<script>\n",
        "window.CAELUS_SCENARIOS="
        + json.dumps(scen, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        + ";\n",
        "window.CAELUS_AIRLOCK_PILOT_BUNDLE="
        + json.dumps(pilot_bundle, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        + ";\n",
        "</script>\n",
    ]
    for rel_mod in INLINE_MODULES:
        mod_path = root / rel_mod
        if not mod_path.is_file():
            raise RuntimeError(f"Zorunlu UI modulu bulunamadi: {rel_mod}")
        mod_src = mod_path.read_text(encoding="utf-8")
        # Escape accidental closing script tags inside JS literals/comments if any
        mod_src_safe = mod_src.replace("</script>", "<\\/script>")
        inject_parts.append("<script>\n" + mod_src_safe + "\n</script>\n")
    inject_parts.append('<script src="app.js"></script>')

    replacement = "".join(inject_parts)
    merged, count = re.subn(
        r'<script src="scenario_compiler\.js"></script>[\s\S]*?<script src="app\.js"></script>',
        lambda _: replacement,
        idx,
        count=1,
    )
    if count != 1:
        raise RuntimeError("ui/index.html icinde scenario_compiler.js .. app.js blogu bulunamadi")

    normalized = merged.replace("\r\n", "\n").replace("\r", "\n")
    return normalized.encode("utf-8")


def read_normalized_utf8_bytes(path: Path) -> bytes:
    txt = path.read_text(encoding="utf-8").replace("\r\n", "\n").replace("\r", "\n")
    return txt.encode("utf-8")


def format_c_byte_array(label: str, sym_name: str, len_name: str, data: bytes) -> str:
    hex_table = [f"0x{i:02x}" for i in range(256)]
    rows: list[str] = [
        f"// Embedded: {label}  ({len(data)} bytes)",
        f"static const unsigned char {sym_name}[] = {{",
    ]
    if data:
        for offset in range(0, len(data), 24):
            chunk = data[offset : offset + 24]
            rows.append("    " + ", ".join(hex_table[b] for b in chunk) + ",")
    rows.append("    0x00")
    rows.append("};")
    rows.append(f"static const std::size_t   {len_name} = {len(data)};")
    rows.append("")
    return "\n".join(rows)


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate deterministic include/ui_payload.h")
    parser.add_argument(
        "--root",
        type=Path,
        default=Path(__file__).resolve().parent.parent,
        help="CAELUS repository root",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=None,
        help="Output header path (default: <root>/include/ui_payload.h)",
    )
    args = parser.parse_args()
    root = args.root.resolve()
    out_path = (args.output or (root / "include/ui_payload.h")).resolve()

    html_bytes = build_embedded_html(root)
    compiler_bytes = read_normalized_utf8_bytes(root / "ui/scenario_compiler.js")
    app_bytes = read_normalized_utf8_bytes(root / "ui/app.js")

    for label, blob in [
        ("CAELUS_UI_HTML", html_bytes),
        ("CAELUS_SCENARIO_COMPILER_JS", compiler_bytes),
        ("CAELUS_UI_JS", app_bytes),
    ]:
        for tok in FORBIDDEN_BYPASS_TOKENS:
            if tok in blob:
                print(
                    f"HATA: {label} icinde uretim-disi dev bypass dizgesi tespit edildi: "
                    f"{tok.decode('ascii')}",
                    file=sys.stderr,
                )
                return 1

    header_parts = [
        "// AUTO-GENERATED - DO NOT EDIT",
        "// CAELUS OS - Deterministic Embedded War Room UI Payload Header",
        "// Generated by tools/embed_ui_payload.py",
        "#pragma once",
        "#include <cstddef>",
        "",
        format_c_byte_array(
            "ui/index.html (+tokens.css +airlock_mcp +ag_ui_engine +war_room_cockpit)",
            "CAELUS_UI_HTML",
            "CAELUS_UI_HTML_LEN",
            html_bytes,
        ),
        format_c_byte_array(
            "ui/scenario_compiler.js",
            "CAELUS_SCENARIO_COMPILER_JS",
            "CAELUS_SCENARIO_COMPILER_JS_LEN",
            compiler_bytes,
        ),
        format_c_byte_array(
            "ui/app.js",
            "CAELUS_UI_JS",
            "CAELUS_UI_JS_LEN",
            app_bytes,
        ),
    ]
    header_text = "\n".join(header_parts)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", encoding="utf-8", newline="\n") as fh:
        fh.write(header_text)

    total_kb = (len(html_bytes) + len(compiler_bytes) + len(app_bytes)) // 1024
    print(
        f"[UI-EMBED] {out_path} uretildi (HTML={len(html_bytes)} B, "
        f"Compiler={len(compiler_bytes)} B, App={len(app_bytes)} B, Toplam={total_kb} KB)"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
