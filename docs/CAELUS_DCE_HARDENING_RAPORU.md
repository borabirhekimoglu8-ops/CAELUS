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
- `scenario_loaded` event’i artık GERÇEK imza doğrulama sonucunu taşıyor (sabit "VERIFIED" değil):
  - `VERIFIED` → ed25519 geçti VE pinli güven çapasıyla eşleşti (`signature_path: ed25519+pinned`)
  - `DEV_TRUST_BYPASS` → ed25519 geçti ama pin kontrolü dev bypass ile atlandı (`ed25519+unpinned`)
  - `SELF_SIGNED_DEV` → dev imza yalnızca dev flag ile kabul edildi (`self-signed-dev`)
  - Durum `ScenarioPack::verify_signature_gate` çıktısından gelir; yanıltıcı forensics önlenir.

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
- `--trusted-pubkey-hex` pin parametresi eklendi.
- **Pin artık CI'da varsayılan olarak kullanılıyor:** det-mode imzalayıcı pubkey'i
  (`acdcc8...106228`) hem `ci.sh` hem `ci.bat` audit adımında pinleniyor. Pin,
  zincirin yalnızca kendi-içinde-tutarlı olmasını değil "kim mühürledi?"
  sorusunu da denetler; saldırganın kendi anahtarıyla yeniden mühürlemesini engeller.
- Appended sealed sessions destekleniyor.
- CI’da deterministik audit log izolasyonu eklendi.
- Det-mode audit identity stabilize edildi:
  - sabit test `CAELUS_IDENTITY_KEY_HEX` set ediliyor.
  - `CDET: audit_chain_head` bit-bit deterministik hale geldi.

### 6.b Negatif Güvenlik Süiti (yeni)

Yeni dosya: `tests/run_security_negative.py` — sistemin **fail-closed** olduğunu
gerçek binary ve gerçek ed25519/Blake3 yollarıyla (stub yok) kanıtlar:

- Kurcalanmış senaryo (imzalı alan değiştirilmiş) → `SIGNATURE_MISMATCH`, yüklenmez.
- `SELF_SIGNED_DEV` senaryo, dev flag yokken → reddedilir.
- Kurcalanmış audit log (event hash bozulmuş) → verifier reddeder.
- Audit SEAL pin: doğru pubkey kabul, yanlış pubkey reddedilir.

Ek olarak C++ `test_causal_engine.cpp` imza gate'inin tüm dallarını birim
test ediyor (boş imza, SELF_SIGNED_DEV kabul/ret, ed25519 tamper-ret, pin-ret,
dev-bypass `DEV_TRUST_BYPASS` — asla `VERIFIED` değil).

### 7. CI / Test Altyapısı

Yeni dosya: `ci.sh`

`ci.sh` şunları çalıştırıyor:

1. Root Rust testleri
2. `caelus_core` Rust testleri
3. C++ doctest (imza gate negatif/pozitif dalları dahil)
4. Linux production build
5. Production bypass string scan
6. Determinism double-run
7. Audit chain + SEAL verification (**pinli pubkey**)
8. Negatif güvenlik süiti (tamper / dev-signed / audit forgery fail-closed)
9. C++ golden snapshots
10. Rust core REPL ↔ C++ live differential

`ci.bat` da güncellendi:

- Audit verifier adımı eklendi (**pinli pubkey**).
- Negatif güvenlik süiti adımı eklendi.
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
  - 19 test case
  - 94 assertion
  - imza gate negatif/pozitif dalları dahil (tamper-ret, pin-ret, dev-bypass)
- `CAELUS_PRODUCTION=1 ./build.sh`
  - Linux binary yaklaşık 3.7 MB
- Production bypass string scan
- Audit verification (pinli pubkey)
- Negatif güvenlik süiti (`tests/run_security_negative.py` — 6 kontrol, hepsi fail-closed)
- C++ golden snapshots
- Rust core REPL ↔ C++ live differential
- `./ci.sh`

## Bilinen Notlar

- Opsera MCP security scan çalıştırılamadı çünkü Opsera MCP server auth istiyor.
- Yerel secret/string scan ve CI security-relevant kontroller çalıştırıldı.
- Python audit verifier için cloud ortamına `blake3` modülü kuruldu.
- **C++ property testi yok:** Rust çekirdekte randomize `invariant_sweep` var;
  C++ motorda yalnız hedefli doctest'ler bulunuyor. C++'a özel UB/overflow
  modları daha az kapsamlı test ediliyor (bilinen sınır).
- **Statik glibc uyarıları:** Linux üretim linkinde `getaddrinfo` / `getpwuid_r`
  / `dlopen` için "statically linked applications require ... glibc" uyarıları
  çıkıyor. Binary pratikte host glibc'sine bağlıdır; "tek statik binary" iddiası
  "eşleşen glibc host için tek kendine-yeten binary" olarak okunmalı, tam
  taşınabilir statik çalıştırılabilir olarak değil.
- UI görsel doğrulama yapılmadı; değişiklikler ağırlıklı backend/CLI/CI/kernel seviyesinde.

### Anahtar / Git history riski (etki zinciriyle)

- Private seed (`tools/caelus_signing.key`) repodan çıkarıldı ve `.gitignore`'a eklendi.
- Public trust anchor mevcut senaryolarla uyumlu bırakıldı; gerçek production key rotation YAPILMADI.
- **Risk:** Eski commit history içinde private seed hâlâ bulunabilir. Eğer öyleyse,
  o anahtarla imzalanmış HER senaryo/plugin artık güvenilmez kabul edilmelidir.
- **Zorunlu remediation zinciri (production'a geçişte):**
  1. Git history temizliği (ör. `git filter-repo`) ile seed'in tüm geçmişten silinmesi.
  2. Offline anahtar töreni ile YENİ ed25519 çiftinin üretilmesi.
  3. `CAELUS_TRUSTED_PUBKEY` (include/scenario_pack.h) ve audit pin'inin yeni pubkey'e güncellenmesi.
  4. Tüm üretim senaryolarının ve plugin'lerin yeni anahtarla yeniden imzalanması.
  5. Golden hash'lerin (`run_bs_exec_golden.py`) ve audit pin'lerinin (`ci.sh`/`ci.bat`) yenilenmesi.
- Bu adımlar tamamlanana kadar paket bir demo/teknik değerlendirme başlangıç noktasıdır, production değildir.

## Sonuç

CAELUS DCE artık teknik değerlendirme açısından daha güçlü durumda:

- Linux’ta production build alıyor.
- Dev bypass’lar production binary’den çıkıyor.
- Audit seal doğrulaması güçlendi.
- C++ ve Rust motorlar live differential gate ile karşılaştırılabiliyor.
- Lockout, cost, fixed-point ve determinism riskleri azaltıldı.
- JSON output ve demo framing değerlendirme-dostu hale getirildi.
