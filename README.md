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

REPL komutları: `status/snapshot [--json]`, `list`, `tick <n>`, `lever <id>`, `help`, `quit`. Windows'ta son kullanıcı başlatıcısı `CAELUS_CALISTIR.bat`'tır; gömülü War Room arayüzü geçici dizine açılır ve çıkışta silinir.

## Test ve CI

```bash
./ci.sh    # Linux tam hattı (aşağıdaki adımların tümü)
```

| Adım | İçerik |
|---|---|
| Rust testleri | `cargo test` (ağ/kripto/audit) + `caelus_core` çekirdek testleri |
| C++ birim testleri | doctest harness (`tests/test_causal_engine.cpp`) |
| Üretim build | `CAELUS_PRODUCTION=1 ./build.sh` + <50 MB boyut kapısı |
| Bypass taraması | Üretim binary'sinde dev-bypass string'i olmadığı doğrulanır |
| Determinizm | Çift koşu, CDET bloklarının bit-bit karşılaştırması |
| Audit doğrulama | Blake3 zinciri + ed25519 SEAL (`tools/verify_audit_log.py`) |
| Golden + diferansiyel | REPL snapshot'ları C++ ve Rust çekirdeklerinde karşılaştırılır |

Aynı hat GitHub Actions üzerinde otomatik koşar: [`.github/workflows/ci.yml`](.github/workflows/ci.yml). Windows karşılığı `ci.bat`'tır. Doğrulayıcı için Python bağımlılıkları: `pip install blake3 cryptography`.

## Güven zinciri

```
imzalama tohumu (repo DIŞI, offline)
   └─ caelus_sign_scenario CLI → scenarios/BS-xx.json  ("signature": ed25519:<pub>:<sig>)
         └─ yükleme anında: kanonik yük → ed25519 doğrulama → pinli güven çapası
            (CAELUS_TRUSTED_PUBKEY = tools/caelus_trusted_pubkey.txt)
```

Paralel zincirler: eklentiler (`<plugin>.sig` sidecar + pin), mesh (imzalı beacon + fingerprint + anti-replay), kimlik (Windows DPAPI blob / KEYMGMT eklentisi), audit mührü (`--trusted-pubkey-hex` pini). Özel imzalama tohumları **hiçbir zaman** repoya girmez; rotasyon offline anahtar töreni gerektirir (`docs/PALANTIR_DCE_DEMO.md#signing-key-policy`).

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

- MQTT/Zapier intel veri düzlemi henüz payload imzası taşımıyor (tasarım `docs/GERCEK_DUNYA_GECIS_RAPORU.md` §5'te).
- POSIX kimlik yolu TPM/HSM yerine `CAELUS_IDENTITY_KEY_HEX` env değişkenini kullanır.
- War Room telemetrisi bilinçli olarak yalnız loopback'tir; uzak izleme kapsam dışıdır.
