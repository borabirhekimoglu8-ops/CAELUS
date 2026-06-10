#!/usr/bin/env python3
"""SIG-CI negatif fixture üretici.

İmzalı bir senaryo paketini, ed25519 imzasının ilk 8 hex karakteri kasıtlı
bozulmuş (format korunmuş) bir kopya olarak yazar. Böylece depoda imzasız /
SELF_SIGNED_DEV senaryo tutmadan, motorun fail-closed SIGNATURE_MISMATCH yolu
CI'da gerçek ed25519 doğrulama hatasıyla sınanabilir.

Kullanım: make_negative_scenario.py <kaynak.json> <hedef.json>
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

SIG_RE = re.compile(r'("signature":\s*"ed25519:[0-9a-f]{64}:)([0-9a-f]{8})')


def corrupt(match: re.Match[str]) -> str:
    head, first8 = match.group(1), match.group(2)
    replacement = "0" * 8 if first8 != "0" * 8 else "f" * 8
    return head + replacement


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print(__doc__, file=sys.stderr)
        return 2
    src, dst = Path(argv[0]), Path(argv[1])
    text = src.read_text(encoding="utf-8")
    corrupted, n = SIG_RE.subn(corrupt, text, count=1)
    if n != 1:
        print(
            f"[make_negative_scenario] ed25519 imza alanı bulunamadı: {src}",
            file=sys.stderr,
        )
        return 1
    dst.parent.mkdir(parents=True, exist_ok=True)
    dst.write_text(corrupted, encoding="utf-8")
    print(f"[make_negative_scenario] bozuk imzalı kopya yazıldı: {dst}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
