# CAELUS DCE Hardening Raporu

Branch: `cursor/caelus-dce-hardening-7d3e`  
PR: `https://github.com/borabirhekimoglu8-ops/CAELUS/pull/1`

## Özet

CAELUS DCE, Palantir-style teknik değerlendirmeye hazırlanmak için güvenlik, determinism, Linux build readiness, audit doğrulama, Rust/C++ engine equivalence ve JSON/demo readiness başlıklarında güçlendirildi.

## Yapılan Ana Değişiklikler

### 1. Güvenlik / Trust Boundary

- `tools/caelus_signing.key` repodan kaldırıldı.
- `.gitignore` eklendi.
- Private signing material artık ignore ediliyor.
- Signer CLI örnekleri repo içi key yerine `/secure/offline/...` path kullanacak şekilde güncellendi.
- Production build’de dev bypass string’lerinin binary içinde kalmaması sağlandı.
- Public trust anchor mevcut imzalı senaryolarla uyumlu bırakıldı.

### 2. Linux Production Build Readiness

- `build.sh` artık `CAELUS_PRODUCTION=1` destekliyor.
- Linux build artık `-DCAELUS_PRODUCTION` ve `-DCAELUS_EMBEDDED_UI=1` geçiriyor.
- Binary boyutu `>=50 MB` ise hard fail yapıyor.
- Linux linker argümanları düzeltildi.
- Repo root include path eklendi.
- `CMakeLists.txt` içine `CAELUS_PRODUCTION` option eklendi.
- Rust 1.83 uyumluluğu için lockfile pinleri yapıldı:
  - `base64ct = 1.6.0`
  - `blake3 = 1.8.2`

### 3. Determinizm ve Engine Semantiği

- `remaining_lockout` artık tick başına azalıyor.
- Başarısız lever artık `lockout_ticks` kadar kilitli kalıyor, sonsuza kadar değil.
- `cost_ticks` artık engine davranışına dahil edildi.
- Başarılı lever sonrası cost cooldown uygulanıyor.
- Başarısız lever için `max(cost_ticks-1, lockout_ticks)` uygulanıyor.
- Long-horizon tick cast riski kaldırıldı.
- `reported_state - state` mutlak farkında INT64_MIN overflow riski giderildi.
- Intel packet path fixed-point hale getirildi:
  - `inject_intel_fp(...)` eklendi.
  - double artık compute path değil, display/log yüzeyi.

### 4. Fixed-point Output / JSON Readiness

- Snapshot’a `throughput_ratio_fp` alanı eklendi.
- `throughput_ratio` artık fixed-point değerden display double olarak türetiliyor.
- REPL JSON çıktısına `throughput_ratio_fp` eklendi.
- `--json-stdout` bayrağı eklendi:
  - Varsayılan `[REPL_JSON] {...}` formatı korundu.
  - İstenirse prefixsiz saf JSON satırı üretilebiliyor.
- WS JSON escaping düzeltildi.
- Audit `SESSION_START` ve `SESSION_END` JSON escaping düzeltildi.
- `scenario_loaded` event’i artık imza bilgisini taşıyor:
  - `sig_status: VERIFIED`
  - `signature_path: ed25519+pinned`

### 5. Rust/C++ Dual-engine Equivalence

- `tests/run_bs_exec_golden.py` geliştirildi.
- Platforma göre default binary seçimi eklendi:
  - Linux: `dist/caelus_os`
  - Windows: `dist/caelus_os.exe`
- Prefixli ve prefixsiz JSON satırları destekleniyor.
- `--reference-binary` eklendi.
- Aynı komut akışı iki binary’de çalıştırılıp normalized snapshot field-by-field karşılaştırılıyor.
- Rust core REPL ile C++ binary live differential koşusu CI’ya eklendi.
- Yeni snapshot alanı nedeniyle golden hash’ler refresh edildi.

Yeni golden hash’ler:

- `BS-01_SAHTE_UFUK`: `933619724894aa211676775ffe2668c261080d67dcc7b359c60746d2fe49b9b7`
- `BS-02_GOLGE_ARSIV`: `1f71f60e45760879c3ca56990b63dc184fc79685d49899ec1586bc261d1643d8`
- `BS-03_KUM_SAATI`: `63358ef3448af8d252720f3c9f4f9d2ee77eff84ebabcc571447d326cd4e02c3`

### 6. Audit Seal Verification

- `tools/verify_audit_log.py` güçlendirildi.
- SEAL fingerprint, pubkey üzerinden Blake3 ile doğrulanıyor.
- Optional `--trusted-pubkey-hex` eklendi.
- Appended sealed sessions destekleniyor.
- CI’da deterministik audit log izolasyonu eklendi.
- Det-mode audit identity stabilize edildi:
  - sabit test `CAELUS_IDENTITY_KEY_HEX` set ediliyor.
  - `CDET: audit_chain_head` bit-bit deterministik hale geldi.

### 7. CI / Test Altyapısı

Yeni dosya: `ci.sh`

`ci.sh` şunları çalıştırıyor:

1. Root Rust testleri
2. `caelus_core` Rust testleri
3. C++ doctest
4. Linux production build
5. Production bypass string scan
6. Determinism double-run
7. Audit chain + SEAL verification
8. C++ golden snapshots
9. Rust core REPL ↔ C++ live differential

`ci.bat` da güncellendi:

- Audit verifier adımı eklendi.
- Deterministik audit log izolasyonu eklendi.

### 8. Demo / Technical Evaluation Dokümanı

Yeni doküman: `docs/PALANTIR_DCE_DEMO.md`

İçerik:

- CAELUS DCE teknik değerlendirme framing’i
- Kernel claim
- Operator claim
- Forensics claim
- Domain-neutral scenario mapping
- Verified vs simulated UI ayrımı
- Evaluation commands
- Signing-key policy

## Doğrulama Sonuçları

Aşağıdaki kontroller başarıyla geçti:

- `cargo test`
  - 22 network/audit test
  - 3 signer test
- `cargo test --manifest-path caelus_core/Cargo.toml --features std`
  - 13 unit test
  - invariant sweep geçti
  - narrowed model geçti
  - 1 büyük exhaustive test intentionally ignored
- C++ doctest
  - 12 test case
  - 69 assertion
- `CAELUS_PRODUCTION=1 ./build.sh`
  - Linux binary yaklaşık 3.7 MB
- Production bypass string scan
- Clean audit verification
- C++ golden snapshots
- Rust core REPL ↔ C++ live differential
- `./ci.sh`

## Bilinen Notlar

- Opsera MCP security scan çalıştırılamadı çünkü Opsera MCP server auth istiyor.
- Yerel secret/string scan ve CI security-relevant kontroller çalıştırıldı.
- Python audit verifier için cloud ortamına `blake3` modülü kuruldu.
- Gerçek production key rotation yapılmadı.
- Private seed repodan çıkarıldı ama public trust anchor mevcut senaryolarla uyumlu bırakıldı.
- Eski commit history içinde private seed geçmişte bulunmuş olabilir.
- Gerçek production için Git history temizliği + key rotation gerekir.
- UI görsel doğrulama yapılmadı; değişiklikler ağırlıklı backend/CLI/CI/kernel seviyesinde.

## Sonuç

CAELUS DCE artık teknik değerlendirme açısından daha güçlü durumda:

- Linux’ta production build alıyor.
- Dev bypass’lar production binary’den çıkıyor.
- Audit seal doğrulaması güçlendi.
- C++ ve Rust motorlar live differential gate ile karşılaştırılabiliyor.
- Lockout, cost, fixed-point ve determinism riskleri azaltıldı.
- JSON output ve demo framing değerlendirme-dostu hale getirildi.
