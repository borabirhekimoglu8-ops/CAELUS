#!/usr/bin/env python3
"""tools/pure_blake3.py doğrulaması: gerçek blake3 paketiyle bit-bit eşitlik.

Sınır boyutları (blok/chunk/ağaç geçişleri) + sabit tohumlu rastgele gövdeler.
Gerçek blake3 paketi kurulu değilse test atlanır (fallback'in var olma sebebi
zaten o ortamlar), ama CI'da kurulu olduğundan CI her zaman tam karşılaştırır.
"""

from __future__ import annotations

import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "tools"))

from pure_blake3 import blake3 as pure_blake3  # noqa: E402


def main() -> int:
    try:
        import blake3 as real_blake3
    except ImportError:
        print("SKIP: gerçek blake3 paketi yok, karşılaştırma atlandı")
        return 0

    rng = random.Random(0xCAE105)
    sizes = [0, 1, 2, 31, 32, 63, 64, 65, 127, 128, 129,
             1023, 1024, 1025, 2047, 2048, 2049, 3072, 4095, 4096, 4097,
             5 * 1024 + 7, 16 * 1024, 31 * 1024 + 1]
    failures = 0
    for size in sizes:
        data = bytes(rng.randrange(256) for _ in range(size))
        expected = real_blake3.blake3(data).digest()
        got = pure_blake3(data).digest()
        if expected != got:
            print(f"FAIL size={size}: {expected.hex()} != {got.hex()}")
            failures += 1

    # Parçalı update yolu tek seferlik update ile aynı sonucu vermeli.
    data = bytes(rng.randrange(256) for _ in range(10_000))
    h = pure_blake3()
    for i in range(0, len(data), 137):
        h.update(data[i:i + 137])
    if h.digest() != real_blake3.blake3(data).digest():
        print("FAIL: incremental update mismatch")
        failures += 1

    # Bilinen vektör: boş girdi (BLAKE3 spec test vektörü).
    empty_expected = "af1349b9f5f9a1a6a0404dea36dcc9499bcb25c9adc112b7cc9a93cae41f3262"
    if pure_blake3(b"").hexdigest() != empty_expected:
        print("FAIL: empty-input known vector")
        failures += 1

    if failures:
        print(f"pure_blake3: {failures} eşleşmezlik")
        return 1
    print(f"OK: pure_blake3 {len(sizes)} boyut + parçalı update + bilinen vektör bit-bit eşleşti")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
