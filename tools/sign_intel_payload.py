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

DOMAIN_V1 = b"CAELUS_INTEL_V1\n"
DOMAIN_V2 = b"CAELUS_INTEL_V2\n"
PREFIX_V1 = b"#sig=ed25519:"
PREFIX_V2 = b"#sig=ed25519v2:"
DOMAIN = DOMAIN_V1
PREFIX = PREFIX_V1


def parse_slot_spec(raw: str) -> int:
    s = raw.strip()
    if not s:
        raise SystemExit("HATA: source-slot boş olamaz")
    try:
        if s.lower().startswith("0x"):
            val = int(s, 16)
        elif len(s) == 16 and all(c in "0123456789abcdefABCDEF" for c in s):
            val = int(s, 16)
        else:
            val = int(s, 10)
    except ValueError as exc:
        raise SystemExit(f"HATA: geçersiz source-slot '{raw}'") from exc
    if val <= 0 or val > 0xFFFFFFFFFFFFFFFF:
        raise SystemExit(f"HATA: source-slot 1..2^64-1 aralığında olmalı ('{raw}')")
    return val


def load_manifest_spec(spec: str) -> dict[int, str]:
    s = spec.strip()
    if s.startswith("@"):
        p = Path(s[1:].strip())
        if not p.is_file():
            raise SystemExit(f"HATA: manifest dosyası okunamadı: {p}")
        text = p.read_text(encoding="utf-8")
    else:
        text = s

    out: dict[int, str] = {}
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        for tok in line.replace(";", ",").split(","):
            tok = tok.strip()
            if not tok:
                continue
            parts = tok.split(":")
            if len(parts) not in (2, 3):
                raise SystemExit(f"HATA: bozuk manifest girdisi: '{tok}'")
            slot_id = parse_slot_spec(parts[0])
            pub_hex = parts[1].strip().lower()
            if len(pub_hex) != 64:
                raise SystemExit(f"HATA: manifest pubkey 64 hex değil: '{tok}'")
            bytes.fromhex(pub_hex)
            if slot_id in out and out[slot_id] != pub_hex:
                raise SystemExit(f"HATA: manifest çakışan slot kaydı: 0x{slot_id:016x}")
            out[slot_id] = pub_hex
    if not out:
        raise SystemExit("HATA: manifest boş")
    return out


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


def sign(body: bytes, seed: bytes, source_slot: int | None = None) -> bytes:
    Ed25519PrivateKey, _ = _ed25519()
    key = Ed25519PrivateKey.from_private_bytes(seed)
    pub = key.public_key().public_bytes_raw()
    if source_slot is not None:
        slot_hex = f"{source_slot:016x}".encode("ascii")
        sig = key.sign(DOMAIN_V2 + slot_hex + b"\n" + body)
        return (
            PREFIX_V2
            + slot_hex
            + b":"
            + pub.hex().encode("ascii")
            + b":"
            + sig.hex().encode("ascii")
            + b"\n"
            + body
        )
    sig = key.sign(DOMAIN_V1 + body)
    return PREFIX_V1 + pub.hex().encode() + b":" + sig.hex().encode() + b"\n" + body


def verify(
    enveloped: bytes,
    trusted_pubkey_hex: str | None,
    trusted_manifest: str | None = None,
) -> None:
    _, Ed25519PublicKey = _ed25519()
    manifest_map = load_manifest_spec(trusted_manifest) if trusted_manifest else None

    if enveloped.startswith(PREFIX_V2):
        rest = enveloped[len(PREFIX_V2):]
        nl = rest.find(b"\n")
        if nl < 0:
            raise SystemExit("HATA: zarf satırı '\\n' ile bitmiyor")
        fields = rest[:nl].split(b":")
        if (
            len(fields) != 3
            or len(fields[0]) != 16
            or len(fields[1]) != 64
            or len(fields[2]) != 128
        ):
            raise SystemExit("HATA: zarf biçimi ed25519v2:<16hex>:<64hex>:<128hex> değil")
        slot_id = parse_slot_spec(fields[0].decode("ascii"))
        slot_hex = f"{slot_id:016x}".encode("ascii")
        pub = bytes.fromhex(fields[1].decode("ascii"))
        sig = bytes.fromhex(fields[2].decode("ascii"))
        if manifest_map is not None:
            expected_pub = manifest_map.get(slot_id)
            if expected_pub is None or pub.hex() != expected_pub:
                raise SystemExit("HATA: slot/pubkey manifest piniyle eşleşmiyor")
        elif trusted_pubkey_hex is not None and pub.hex() != trusted_pubkey_hex.lower():
            raise SystemExit("HATA: pubkey pinle eşleşmiyor")
        body = rest[nl + 1:]
        Ed25519PublicKey.from_public_bytes(pub).verify(
            sig, DOMAIN_V2 + slot_hex + b"\n" + body
        )
        print(
            f"OK: v2 imza geçerli (slot=0x{slot_id:016x}, pubkey={pub.hex()}, gövde={len(body)}B)"
        )
        return

    if manifest_map is not None:
        raise SystemExit("HATA: v2 manifest aktifken v1 (slotsuz) zarf kabul edilmez")

    if not enveloped.startswith(PREFIX_V1):
        raise SystemExit("HATA: payload #sig=ed25519: veya #sig=ed25519v2: zarfıyla başlamıyor")
    rest = enveloped[len(PREFIX_V1):]
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
    Ed25519PublicKey.from_public_bytes(pub).verify(sig, DOMAIN_V1 + body)
    print(f"OK: imza geçerli (pubkey={pub.hex()}, gövde={len(body)}B)")


def main(argv: list[str]) -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--key", type=Path, help="32 baytlık ed25519 tohum dosyası")
    p.add_argument("--generate-key", type=Path, metavar="PATH",
                   help="yeni tohum üret ve PATH'e yaz (0600)")
    p.add_argument("--export-pubkey", action="store_true",
                   help="tohumun pubkey hex'ini yazdır (CAELUS_TRUSTED_INTEL_PUBKEY)")
    p.add_argument("--source-slot",
                   help="FIELD-IDENTITY v2: kaynak slot ID (örn. 0xCAE1050000A10001)")
    p.add_argument("--v2", action="store_true",
                   help="ed25519v2 zarfı üret (--source-slot gerektirir)")
    p.add_argument("--in", dest="infile", type=Path, help="gövde girdisi (yoksa stdin)")
    p.add_argument("--out", dest="outfile", type=Path, help="zarflı çıktı (yoksa stdout)")
    p.add_argument("--verify", type=Path, metavar="PATH",
                   help="zarflı payload'ı doğrula ve çık")
    p.add_argument("--trusted-pubkey-hex",
                   help="--verify için beklenen tekli pubkey pini (64 hex)")
    p.add_argument("--trusted-manifest",
                   help="--verify için v2 slot manifesti ('<slot>:<64hex>,...' veya '@dosya')")
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
        if a.source_slot:
            slot_val = parse_slot_spec(a.source_slot)
            print(f"CAELUS_TRUSTED_INTEL_MANIFEST=0x{slot_val:016x}:{pub.hex()}")
        return 0

    if a.verify:
        verify(a.verify.read_bytes(), a.trusted_pubkey_hex, a.trusted_manifest)
        return 0

    if not a.key:
        p.error("--key gerekli (ya da --generate-key / --verify kullanın)")
    if a.v2 and not a.source_slot:
        p.error("--v2 ile birlikte --source-slot zorunludur")
    seed = load_seed(a.key)

    if a.export_pubkey:
        Ed25519PrivateKey, _ = _ed25519()
        pub = Ed25519PrivateKey.from_private_bytes(seed).public_key().public_bytes_raw()
        if a.source_slot:
            slot_val = parse_slot_spec(a.source_slot)
            print(f"0x{slot_val:016x}:{pub.hex()}")
        else:
            print(pub.hex())
        return 0

    slot_val = parse_slot_spec(a.source_slot) if a.source_slot else None
    body = a.infile.read_bytes() if a.infile else sys.stdin.buffer.read()
    out = sign(body, seed, source_slot=slot_val)
    if a.outfile:
        a.outfile.write_bytes(out)
    else:
        sys.stdout.buffer.write(out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
