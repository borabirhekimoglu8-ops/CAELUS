#!/usr/bin/env python3
"""CAELUS intel payload imzalayıcısı (saha tarafı yardımcı aracı).

Bir intel payload'ını (JSON veya CSV) ed25519 ile imzalar ve motorun
IntelAuthGate'inin beklediği zarf satırını başa ekler:

    #sig=ed25519:<64hex-pubkey>:<128hex-signature>\n<gövde>

İmzalanan mesaj, alan ayrımı (domain separation) ön ekiyle gövde baytlarıdır:

    "CAELUS_INTEL_V1\n" || <gövde baytları>

Zarf satırı payload'ın İLK baytlarında olmalıdır (öncesinde boşluk dahi
olamaz); motor tarafındaki sözleşme byte-exact'tir. Ayrıntılar:
docs/INTEL_IMZA_SOZLESMESI.md

Kullanım:
    # 32 baytlık tohum üret (offline saklayın; depoya girmez!)
    python3 tools/sign_intel_payload.py --generate-key intel_signing.key

    # Pin değerini (pubkey hex) motor ortamına verilecek şekilde yazdır
    python3 tools/sign_intel_payload.py --key intel_signing.key --export-pubkey

    # stdin'den payload imzala, zarflı halini stdout'a yaz
    echo '{"friction_coeff":0.82,"crisis_level":2,"memo":"saha"}' | \
        python3 tools/sign_intel_payload.py --key intel_signing.key

    # dosyadan imzala, çıktıyı dosyaya yaz
    python3 tools/sign_intel_payload.py --key intel_signing.key \
        --in payload.json --out payload.signed

    # zarflı payload'ı yerel olarak doğrula (motor davranışının aynısı)
    python3 tools/sign_intel_payload.py --verify payload.signed \
        --trusted-pubkey-hex <64hex>
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

DOMAIN = b"CAELUS_INTEL_V1\n"
PREFIX = b"#sig=ed25519:"


def _ed25519():
    from cryptography.hazmat.primitives.asymmetric.ed25519 import (
        Ed25519PrivateKey,
        Ed25519PublicKey,
    )

    return Ed25519PrivateKey, Ed25519PublicKey


def load_seed(path: Path) -> bytes:
    data = path.read_bytes()
    if len(data) == 64:  # hex biçimi de kabul edilir
        try:
            data = bytes.fromhex(data.decode("ascii").strip())
        except ValueError:
            pass
    if len(data) != 32:
        raise SystemExit(f"HATA: {path} 32 baytlık ed25519 tohumu değil ({len(data)}B)")
    return data


def sign(body: bytes, seed: bytes) -> bytes:
    Ed25519PrivateKey, _ = _ed25519()
    key = Ed25519PrivateKey.from_private_bytes(seed)
    pub = key.public_key().public_bytes_raw()
    sig = key.sign(DOMAIN + body)
    return PREFIX + pub.hex().encode() + b":" + sig.hex().encode() + b"\n" + body


def verify(enveloped: bytes, trusted_pubkey_hex: str | None) -> None:
    _, Ed25519PublicKey = _ed25519()
    if not enveloped.startswith(PREFIX):
        raise SystemExit("HATA: payload #sig=ed25519: zarfıyla başlamıyor")
    rest = enveloped[len(PREFIX):]
    nl = rest.find(b"\n")
    if nl < 0:
        raise SystemExit("HATA: zarf satırı '\\n' ile bitmiyor")
    fields = rest[:nl].split(b":")
    if len(fields) != 2 or len(fields[0]) != 64 or len(fields[1]) != 128:
        raise SystemExit("HATA: zarf biçimi ed25519:<64hex>:<128hex> değil")
    pub = bytes.fromhex(fields[0].decode())
    sig = bytes.fromhex(fields[1].decode())
    if trusted_pubkey_hex is not None and pub.hex() != trusted_pubkey_hex.lower():
        raise SystemExit("HATA: pubkey pinle eşleşmiyor")
    body = rest[nl + 1:]
    Ed25519PublicKey.from_public_bytes(pub).verify(sig, DOMAIN + body)
    print(f"OK: imza geçerli (pubkey={pub.hex()}, gövde={len(body)}B)")


def main(argv: list[str]) -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--key", type=Path, help="32 baytlık ed25519 tohum dosyası")
    p.add_argument("--generate-key", type=Path, metavar="PATH",
                   help="yeni tohum üret ve PATH'e yaz (0600)")
    p.add_argument("--export-pubkey", action="store_true",
                   help="tohumun pubkey hex'ini yazdır (CAELUS_TRUSTED_INTEL_PUBKEY)")
    p.add_argument("--in", dest="infile", type=Path, help="gövde girdisi (yoksa stdin)")
    p.add_argument("--out", dest="outfile", type=Path, help="zarflı çıktı (yoksa stdout)")
    p.add_argument("--verify", type=Path, metavar="PATH",
                   help="zarflı payload'ı doğrula ve çık")
    p.add_argument("--trusted-pubkey-hex",
                   help="--verify için beklenen pubkey pini (64 hex)")
    a = p.parse_args(argv)

    if a.generate_key:
        seed = os.urandom(32)
        a.generate_key.write_bytes(seed)
        try:
            a.generate_key.chmod(0o600)
        except OSError:
            pass
        Ed25519PrivateKey, _ = _ed25519()
        pub = Ed25519PrivateKey.from_private_bytes(seed).public_key().public_bytes_raw()
        print(f"tohum yazıldı: {a.generate_key} (depoya KOYMAYIN)")
        print(f"CAELUS_TRUSTED_INTEL_PUBKEY={pub.hex()}")
        return 0

    if a.verify:
        verify(a.verify.read_bytes(), a.trusted_pubkey_hex)
        return 0

    if not a.key:
        p.error("--key gerekli (ya da --generate-key / --verify kullanın)")
    seed = load_seed(a.key)

    if a.export_pubkey:
        Ed25519PrivateKey, _ = _ed25519()
        pub = Ed25519PrivateKey.from_private_bytes(seed).public_key().public_bytes_raw()
        print(pub.hex())
        return 0

    body = a.infile.read_bytes() if a.infile else sys.stdin.buffer.read()
    out = sign(body, seed)
    if a.outfile:
        a.outfile.write_bytes(out)
    else:
        sys.stdout.buffer.write(out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
