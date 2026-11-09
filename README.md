# CAELUS OS

**Hava boşluklu (air-gapped), tam deterministik, nöro-sembolik nedensel kriz simülasyonu ve karar destek motoru.**

CAELUS; bir operasyonun (liman, tedarik zinciri, lojistik ağı…) nedensel grafını yükler, 15 dakikalık tick'lerle ileri sarar ve "hangi eşik aşılırsa sistem geri döndürülemez biçimde bozulur, hangi kaldıraç hangi olasılıkla kurtarır" sorularını yanıtlar. Tek bir statik çalıştırılabilir dosya olarak derlenir; internete hiç çıkmaz, dış kütüphane ve yorumlayıcı gerektirmez.

> Dış teknik değerlendirmeler için sunum çerçevesi: [`docs/PALANTIR_DCE_DEMO.md`](docs/PALANTIR_DCE_DEMO.md) ·
> Kapsamlı mimari envanter: [`docs/CAELUS_PROJE_RAPORU.md`](docs/CAELUS_PROJE_RAPORU.md)

## Mimari

| Katman | Dil | Rol |
|---|---|---|
| Çekirdek motor + senaryo + plugin SDK | C++17 (header-ağırlıklı) | Nedensel simülasyon, JSON ayrıştırma, orkestrasyon |
| Ağ + kripto + denetim | Rust (staticlib, C FFI) | Shadow-Mesh P2P, ed25519/X25519/Blake3, DPAPI, audit zinciri |
| Referans çekirdek | Rust (`caelus_core/`, no_std uyumlu) | C++ motoruyla bit-bit diferansiyel doğrulama |
| Arayüz ("War Room") | Vanilla JS/CSS (gömülü) | Loopback WebSocket (`127.0.0.1:47809`) üzerinden canlı telemetri |

### Tasarım aksiyomları (kodda zorlanır)

1. **Sıfır internet** — DNS/HTTP/dışa soket yok; telemetri yalnız loopback, eş keşfi yalnız link-local UDP multicast (`224.0.0.251:47808`).
2. **Tam determinizm** — tüm motor aritmetiği `int64_t` sabit nokta (ölçek 1e6), doyma (saturating) yarı-aritmetiği; `--det-mode` aynı girdiden her platformda bit-bit aynı çıktıyı ve aynı audit hash zincirini üretir.
3. **Fail-closed güvenlik** — imzasız senaryo reddedilir, imzasız eklenti yüklenmez (exit 4); `CAELUS_PRODUCTION` derlemesinde tüm geliştirme bypass'ları derleme dışıdır.
4. **Adli izlenebilirlik** — her oturum append-only, Blake3-zincirli, ed25519-mühürlü NDJSON denetim günlüğüne yazılır; `tools/verify_audit_log.py` zinciri ve mührü harici olarak doğrular.

## Derleme

Gereksinimler: Rust toolchain (cargo), C++17 derleyicisi (g++/MSVC), `strip`.

```bash
# Linux / macOS — üretim modu
CAELUS_PRODUCTION=1 ./build.sh          # → dist/caelus_os
```

```bat
:: Windows (MinGW veya MSVC; otomatik fallback)
build.bat                                :: → dist\caelus_os.exe
```

Build üç fazlıdır: UI gömme (`include/ui_payload.h`) → Rust staticlib → C++ statik link. Ayrıntı ve toolchain matrisi için `build.sh` / `build.bat` başlıklarına bakın.

## Çalıştırma

```bash
dist/caelus_os --scenario BS-01_SAHTE_UFUK --repl   # etkileşimli REPL
dist/caelus_os --scenario UNIVERSAL_BASELINE --det-mode  # deterministik CI koşusu
```

REPL komutları: `status/snapshot [--json]`, `list`, `tick <n>`, `lever <id>`, `help`, `quit`. Windows'ta son kullanıcı başlatıcısı `CAELUS_CALISTIR.bat`'tır; gömülü War Room arayüzü geçici dizine açılır ve çıkışta silinir. Arayüz komutları (lever/tick/status) canlı WebSocket köprüsü üzerinden gerçek motoru sürer; paneller motorun canlı snapshot'ından beslenir (uydurma telemetri yoktur).

### Uzak War Room (telefon/tablet — opsiyonel, varsayılan KAPALI)

Varsayılan güvenli davranış loopback'tir (arayüz yalnız kendi makinende). Aynı WiFi'daki bir telefondan **canlı** motoru açmak için opt-in uzak mod:

```bash
# Zorunlu: uzun, gizli bir token belirle (kimlik doğrulaması budur)
CAELUS_WARROOM_REMOTE=1 CAELUS_WARROOM_TOKEN=<uzun-gizli-dize> \
  dist/caelus_os --scenario BS-01_SAHTE_UFUK --repl
```

Motor `0.0.0.0:47809`'a bağlanır ve gömülü UI'ı aynı portta HTTP ile sunar. Telefonda aç:

```
http://<bilgisayarın-LAN-IP>:47809/?token=<uzun-gizli-dize>
```

- **Fail-closed:** `CAELUS_WARROOM_TOKEN` yoksa uzak moda **hiç geçilmez**, loopback'te kalır.
- **Güvenlik sınırı WebSocket'tir:** statik sayfa/JS herkese açıktır ama token olmadan hiçbir canlı veri akmaz ve hiçbir komut kabul edilmez (yanlış/eksik token → WS reddedilir). Token karşılaştırması sabit-zamanlıdır.
- **TLS yok:** token LAN'da düz metin gider; yalnızca güvendiğin yerel ağda kullan. Bu, "sıfır internet" aksiyomunun bilinçli, opt-in bir gevşetilmesidir — internete değil, yalnız yerel ağa açılır.

## Test ve CI

```bash
./ci.sh    # Linux tam hattı (aşağıdaki adımların tümü)
```

| Adım | İçerik |
|---|---|
| Rust testleri | `cargo test` (ağ/kripto/audit) + `caelus_core` çekirdek testleri |
| C++ birim testleri | doctest harness (`tests/test_causal_engine.cpp`, JSON parser sınır vakaları dahil) |
| Connector smoke | Intel veri düzlemi token + ed25519 imza kapısı (kabul/ret/graf propagasyonu) |
| blake3 eşdeğerliği | `tools/pure_blake3.py` fallback'inin gerçek pakete bit-bit eşitliği |
| Üretim build | `CAELUS_PRODUCTION=1 ./build.sh` + <50 MB boyut kapısı |
| Bypass taraması | Üretim binary'sinde dev-bypass string'i olmadığı doğrulanır |
| Determinizm | Çift koşu, CDET bloklarının bit-bit karşılaştırması |
| Audit doğrulama | Blake3 zinciri + ed25519 SEAL (`tools/verify_audit_log.py`) |
| Golden + diferansiyel | REPL snapshot'ları C++ ve Rust çekirdeklerinde karşılaştırılır |

GitHub Actions ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) her push'ta üç job koşar: **Linux** (`ci.sh`), **Windows/MSVC** (`ci.bat`) ve **çapraz platform determinizm** — iki platformun `--det-mode` CDET blokları bit-bit karşılaştırılır ("aynı girdi her platformda aynı çıktı" iddiasının sürekli kanıtı). `v*` tag'i push'lamak [`release.yml`](.github/workflows/release.yml) ile SHA-256'lı release binary'si yayımlar. Doğrulayıcı için Python bağımlılıkları: `pip install blake3 cryptography` (blake3 yoksa saf-Python fallback devreye girer).

## Güven zinciri

```
imzalama tohumu (repo DIŞI, offline)
   └─ caelus_sign_scenario CLI → scenarios/BS-xx.json  ("signature": ed25519:<pub>:<sig>)
         └─ yükleme anında: kanonik yük → ed25519 doğrulama → pinli güven çapası
            (CAELUS_TRUSTED_PUBKEY = tools/caelus_trusted_pubkey.txt)
```

Paralel zincirler: eklentiler (`<plugin>.sig` sidecar + pin), mesh (imzalı beacon + fingerprint + anti-replay), kimlik (Windows DPAPI blob / KEYMGMT eklentisi), audit mührü (`--trusted-pubkey-hex` pini), **intel veri düzlemi** (`CAELUS_TRUSTED_INTEL_PUBKEY` pini + `#sig=ed25519:` payload zarfı — bkz. [`docs/INTEL_IMZA_SOZLESMESI.md`](docs/INTEL_IMZA_SOZLESMESI.md)). Özel imzalama tohumları **hiçbir zaman** repoya girmez; rotasyon offline anahtar töreni gerektirir (`docs/PALANTIR_DCE_DEMO.md#signing-key-policy`).

## Depo düzeni

```
core_engine.cpp        Ana orkestrasyon: CLI, REPL, plugin bootstrap
include/               Nedensel motor, senaryo yükleyici, WS emitter, plugin SDK
src/                   Rust ağ/kripto/audit katmanı + intel_core (C++)
caelus_core/           Rust referans çekirdeği (diferansiyel doğrulama)
scenarios/             İmzalı BS senaryo paketleri (şema 2.0)
tests/                 doctest, golden runner, connector smoke, fixtures/
tools/                 Audit doğrulayıcı, güven çapası, Verus taslakları
ui/                    War Room kaynakları (build'de binary'ye gömülür)
docs/                  Geliştirme raporları (v1–v5), geçiş/UI/golden raporları
```

## Bilinen sınırlar

- POSIX kimlik yolu TPM/HSM yerine `CAELUS_IDENTITY_KEY_HEX` env değişkenini kullanır.
- War Room telemetrisi bilinçli olarak yalnız loopback'tir; uzak izleme kapsam dışıdır.
