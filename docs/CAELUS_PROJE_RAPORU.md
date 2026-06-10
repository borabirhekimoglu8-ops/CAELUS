# CAELUS OS — Kapsamlı Proje Raporu

**Tarih:** 2026-06-10
**Rapor türü:** Enine boyuna proje envanteri + mimari analiz + güncel durum tespiti
**Dayanak:** Mevcut kaynak ağacının tamamı (aşağıda dosya dosya listelenmiştir). Tüm iddialar bu rapor yazılırken **diskten okunarak** doğrulanmıştır; önceki raporlardan (v5, Gerçek Dünya Geçiş Raporu) sonra inen değişiklikler (pinli güven çapası, üretim plugin verifier'ı, `--plugin` CLI, gerçek imzalı senaryolar, KEYMGMT wiring, `CAELUS_PRODUCTION` derleme bayrağı) ayrıca teyit edilmiş ve durum tabloları buna göre **güncellenmiştir**.
**İlişkili raporlar:** `docs/GELISTIRME_RAPORU.md` (v1) → `_v2` → `_v3` → `_v4` → `_v5` · `docs/GERCEK_DUNYA_GECIS_RAPORU.md` · `docs/UI_MODERNIZASYON_RAPORU.md` · `docs/BS_EXEC_GOLDEN_MATRIX.md` · `docs/BS_EXEC_REPL_KILAVUZU.md`

---

## 1. Yönetici Özeti

**CAELUS OS**, hava boşluklu (air-gapped), buluta hiç dokunmayan, %100 deterministik bir **nöro-sembolik nedensel kriz simülasyon ve karar destek motorudur**. Tek bir statik çalıştırılabilir dosya (< 50 MB bütçe; mevcut binary ≈ **5,27 MB**) olarak derlenir; içine web tabanlı "War Room" arayüzü gömülüdür, dış kütüphane ve yorumlayıcı (Python, JS runtime vb.) gerektirmez.

Projenin üç dilli hibrit bir gövdesi vardır:

| Katman | Dil | Rol |
|---|---|---|
| Çekirdek motor + senaryo + plugin SDK | **C++17** (header-ağırlıklı) | Nedensel simülasyon, JSON ayrıştırma, orkestrasyon |
| Ağ + kripto + denetim | **Rust** (staticlib, C FFI) | Shadow-Mesh P2P, ed25519/X25519/Blake3, DPAPI, audit zinciri |
| Arayüz | **Vanilla JS/CSS** (gömülü) | Loopback WebSocket üzerinden canlı telemetri "War Room" |

Bugünkü durum tek cümlede: **Motor derleniyor, imza atıyor ve doğruluyor (pinli güven çapasıyla), dinamik eklentiyi imza kapısından geçirerek yüklüyor, kimliğini DPAPI ile koruyor, outage'ı kalıcı kilitliyor (latching), her oturumu Blake3-zincirli + ed25519-mühürlü adli kayda yazıyor — yani mekanizma katmanı üretim olgunluğuna çok yakın; kalan işler test güncelliği (golden refresh), bayat binary'nin yeniden derlenmesi, saha veri düzlemi kimliği ve çoklu-toolchain CI gibi çevre işlerdir.**

---

## 2. Proje Kimliği ve Tasarım Felsefesi

### 2.1 Ne yapar?

CAELUS, bir operasyonun (liman, tedarik zinciri, lojistik ağı…) **nedensel grafını** (düğümler + kenarlar + geri besleme döngüleri + histerezis eşikleri) yükler, 15 dakikalık tick'lerle ileri sarar ve şu soruları yanıtlar:

- Sürtünme (friction) nereden besleniyor, hangi düğüm hangi düğümü buluyor?
- Hangi eşik aşıldığında sistem **geri döndürülemez** biçimde bozulur (histerezis)?
- Raporlanan durum ile gerçek durum arasındaki fark ne (gözlemlenebilirlik saldırıları — `reported_state ≠ state`, `trust` katsayısı)?
- Hangi kaldıraç (lever) hangi olasılıkla kurtarır?

### 2.2 Tasarım aksiyomları (kodda zorlanan)

1. **SIFIR İNTERNET.** DNS yok, HTTP yok, dışa giden soket yok. Telemetri yalnız `127.0.0.1:47809` (loopback WebSocket); eş keşfi yalnız link-local UDP multicast `224.0.0.251:47808` (LAN dışına yönlendirilmez).
2. **TAM DETERMİNİZM.** Tüm motor aritmetiği `int64_t` sabit nokta (`FP_SCALE = 1.000.000`), taşma yerine doyma (saturating); IEEE 754 platform farkı yok. `--det-mode` sabit seed + sanal saat (ts=0) enjekte eder → aynı girdi her platformda bit-bit aynı çıktı ve aynı audit hash zinciri üretir.
3. **FAIL-CLOSED GÜVENLİK.** İmzasız senaryo reddedilir, imzasız eklenti yüklenmez (exit 4), el sıkışmada yetkisiz slot claim'i el sıkışmayı düşürür. `CAELUS_PRODUCTION` derlemesinde tüm dev-bypass yolları **derleme dışıdır** (env'e hiç bakılmaz).
4. **ADLİ İZLENEBİLİRLİK.** Her oturum append-only, Blake3-zincirli, oturum sonunda ed25519-mühürlü NDJSON denetim günlüğüne yazılır; tek bitlik oynama zinciri kırar.
5. **ETİK SINIR.** `intel_core` yalnız gözlemlenebilir, alan-bağımsız operasyonel faktörleri modeller; kişi profilleme ve sözde-bilimsel skorlama **bilinçli olarak çıkarılmıştır** (başlık yorumunda gerekçeli).

---

## 3. Depo Envanteri

```
CAELUS/
├── core_engine.cpp            (1.151)  Ana orkestrasyon: CLI, REPL, plugin bootstrap, UI dump
├── CMakeLists.txt               (165)  MSVC/MinGW çift leg, statik CRT, OR-Tools opsiyonel
├── build.bat / build.sh    (457/206)  3 fazlı build: UI gömme → cargo → C++ statik link
├── ci.bat                       (429)  6 adımlı CI hattı
├── Cargo.toml / Cargo.lock              Rust staticlib + signer CLI tanımı
├── CAELUS_CALISTIR.bat                  Son kullanıcı başlatıcısı (dist exe'yi açar)
├── caelus_identity.key          (287B)  DPAPI-korumalı cihaz kimliği blob'u
├── caelus_audit_<sid>.log               Örnek mühürlü denetim günlüğü
├── include/
│   ├── causal_engine.h          (820)  Nedensel motor v2 (tick, histerezis, outage latch)
│   ├── scenario_pack.h          (965)  JSON yükleyici + ed25519 imza kapısı + pinli çapa
│   ├── ws_emitter.h             (641)  RFC 6455 loopback WebSocket (inline SHA-1+Base64)
│   ├── audit_log.h              (184)  Rust audit FFI'sinin C++ sarmalayıcısı
│   ├── caelus_logger.h           (71)  Sıfır-maliyet hot-path logger (varsayılan kapalı)
│   ├── det_rng.h                 (62)  xoshiro256** deterministik RNG (kripto DEĞİL)
│   ├── ui_payload.h          (629 KB)  build Phase 1'in ürettiği gömülü UI baytları
│   └── plugin/
│       ├── caelus_plugin_abi.h      (317)  Saf C99 ABI v1.1 (5 plugin sınıfı + KEYMGMT)
│       ├── caelus_plugin_registry.h (907)  Registry + DynamicPluginLoader + imza gate
│       ├── caelus_connector.h     (1.411)  CsvReplay / MQTT / Zapier connector'ları
│       ├── caelus_solver.h          (312)  DeterministicSolver + ORToolsSolver (CP-SAT)
│       └── caelus_reporter.h        (185)  Rapor formatlama/persist katmanı
├── src/
│   ├── intel_core.h/.cpp    (102/416)  Operasyonel risk profili + gerçek AES-256-CBC
│   ├── lib.rs                    (92)  Rust crate kökü — tüm FFI yüzeyi re-export
│   ├── audit_log.rs             (693)  Blake3-zincir + ed25519-mühür audit motoru
│   ├── scenario_verify.rs        (49)  ed25519 senaryo imza doğrulayıcısı
│   ├── bin/caelus_sign_scenario.rs (707)  Üretim imzalama CLI'si (kanonik parser dahil)
│   └── network/
│       ├── mesh_auth.rs       (1.205)  3-fazlı el sıkışma, kimlik, DPAPI KEYMGMT
│       └── discovery.rs         (857)  UDP multicast keşif + anti-replay + intel kuyruğu
├── ui/
│   ├── index.html             (1.286)  War Room arayüzü (CSS Grid, CRT efektleri)
│   └── app.js                 (2.361)  WS istemcisi, mesh canvas, sparkline, SFX
├── scenarios/
│   ├── BS-01_SAHTE_UFUK.json            Gözlemlenebilirlik saldırısı (liman)
│   ├── BS-02_GOLGE_ARSIV.json           İnsan/finans kara kuğusu
│   └── BS-03_KUM_SAATI.json             Zaman-baskılı blokaj senaryosu
├── tests/
│   ├── test_causal_engine.cpp   (126)  doctest C++ birim testleri
│   ├── connector_smoke.py       (847)  Mini MQTT broker + Zapier loopback smoke
│   ├── run_bs_exec_golden.py    (233)  REPL golden koşucusu (⚠ bayat — §10)
│   └── golden/bs0{1,2,3}_*               Beklenen snapshot + REPL komut dosyaları
├── tools/
│   ├── caelus_signing.key        (32B)  ed25519 imzalama tohumu (⚠ düz metin — §9.4)
│   ├── caelus_trusted_pubkey.txt (64h)  Pinli güven çapasının hex hâli
│   └── verify_audit_log.py      (315)  Harici audit zincir + mühür doğrulayıcısı
├── dist/caelus_os.exe        (5,27 MB)  Statik binary (⚠ kaynaktan eski — §10)
└── docs/                                8 rapor (v1–v5 geliştirme, geçiş, UI, golden)
```

Toplam el yazımı kaynak (ui_payload.h ve kilit dosyaları hariç): **≈ 17.500 satır**.

---

## 4. Mimari — Katman Katman

### 4.1 Genel veri akışı

```
  scenarios/BS-xx.json ──ed25519 gate──▶ ScenarioPack ──▶ CausalEngine v2 (tick döngüsü)
                                              │                  │
  MQTT / Zapier / CSV connector'ları ──▶ IntelFeedQueue ─FFI──▶ friction enjeksiyonu
  (Rust discovery.rs, UDP multicast)          │                  │
                                              │                  ├──▶ WsEmitter (127.0.0.1:47809)
  Shadow-Mesh el sıkışma (mesh_auth.rs) ──────┘                  │       └──▶ ui/ War Room (gömülü)
                                                                 └──▶ AuditLog (Blake3 zinciri → SEAL)
```

### 4.2 `core_engine.cpp` — Orkestrasyon

- **CLI:** `--scenario <id>`, `--intel-replay <path>`, `--plugin <path>` (tekrarlanabilir, deterministik sıra), `--interactive|--repl`, `--det-mode`, `--print-scenario-payload`, `--sign-scenario` + `--key`, `--help`.
- **REPL komutları:** `status/snapshot [--json]`, `list`, `tick <n>`, `lever <id>`, `help`, `quit`. `snapshot --json` çıktısı golden testlerin temelidir (`[REPL_JSON]` satırları).
- **Plugin bootstrap:** `DynamicPluginLoader` örnekleniyor; `CAELUS_PRODUCTION` derlemesinde üretim ed25519 verifier'ı **koşulsuz** kayıtlı; değilse yalnız `CAELUS_PLUGIN_ALLOW_UNVERIFIED=1` bypass'ı verifier kaydını atlar. Güvenle yüklenemeyen eklenti **FATAL exit 4** (fail-closed, "sessizce atlandı" yok).
- **Gömülü UI:** `CAELUS_EMBEDDED_UI` ile `ui_payload.h` baytları geçici dizine yazılır, tarayıcı açılır, **çıkışta silinir** (diskte düz UI kalmaz).
- **Determinizm enjeksiyonu:** `--det-mode` sabit seed (`0xCAE105DEADBEEF00`) + sabit enklav anahtarı + `session_id=0` + sanal saat kurar — yalnız CI içindir.

### 4.3 `causal_engine.h` — Nedensel Motor v2

Eski "ağırlıklı doğrusal toplam" modelinin yerine **tick-tabanlı nedensel yayılım**:

- **Düğüm türleri:** `Service`, `Buffer`, `Queue`, `Perishable`, `Gate`, `Adversary`.
- **Sabit nokta aritmetiği:** tüm değerler `int64_t × 1e6`; çarpma/bölme ara-taşmasız, doyma yarı-manuel uzun aritmetikle (`fp_mul_div_u64_sat`) yapılır.
- **Gözlemlenebilirlik katmanı:** her düğümün `state_fp` (gerçek) ve `reported_state_fp` (ekranda görünen) + `trust_fp` katsayısı var → "veri gerçektir" aksiyomunu sınayan senaryolar (BS-01) doğrudan modellenebiliyor.
- **Histerezis:** eşik aşımı `reversible:false` ise `permanent_friction_fp_` doyarak artar ve **outage latch'lenir**.
- **Outage latching durum makinesi (T-20):** `latch_outage()` yalnız kilitler, hiçbir yol `outage_`'ı yan etkiyle temizlemez; `Perishable` deadline kaçırma da latch'ler (`irrecoverable=true`); tek temizleme yolu **başarılı recovery lever'ı** (`clear_outage_recovery()`). Outage iken `throughput_ratio = 0.0`.
- **REGIME_EXCEEDED:** ham çarpan 3.0× tavanını aşarsa sessiz doyum yerine açık olay yayılır (audit + WS).

### 4.4 `src/intel_core.*` — Operasyonel Risk Modülü

- `OperationalRiskProfile`: 5 normalize faktör (bürokratik karmaşıklık, tarihsel gecikme oranı, aktör eylem olasılığı, rota tıkanıklığı, çevresel şiddet). **Kişi değil senaryo** profillenir.
- Sürtünme çarpanı her zaman `[1.0, 3.0]` aralığına kelepçelenir; ham değer telemetri için ayrıca raporlanır.
- **Gerçek AES-256-CBC (PKCS#7)** + açılışta FIPS-197 known-answer self-test; anahtar `CAELUS_ENCLAVE_KEY` (64 hex) ya da açıkça "UNCONFIGURED" damgalı ephemeral CSPRNG anahtarı — sahte "decryption succeeded" çıktısı yoktur.

### 4.5 `scenario_pack.h` — Senaryo Yükleyici + İmza Kapısı

- **Sıfır-bağımlılık JSON ayrıştırıcı:** RFC 8259 unicode escape, sayı sınır kontrolü, özyineleme derinlik limiti.
- **İki katmanlı paket:** `extended_causal_model` (v2 graf) + `v1_engine_bridge` (geriye dönük `OperationalRiskProfile` + zamanlı intel dizisi).
- **İmza kapısı (güncel hâli):**
  1. `signature` alanı zorunlu, format `ed25519:<64hex-pubkey>:<128hex-sig>`.
  2. Kanonik yük (`CAELUS_SCENARIO_PACK_V1` + sıralı anahtarlar + 17-hassasiyet float) Rust `caelus_verify_scenario_signature` ile matematiksel doğrulanır.
  3. **Pinli güven çapası:** pubkey, derleme içi `CAELUS_TRUSTED_PUBKEY[32]` sabitiyle (`9bb1dbd0…a04fa802` = `tools/caelus_trusted_pubkey.txt`) `memcmp` edilir → "kim imzaladı?" sorusu artık soruluyor. *(Geçiş raporundaki P0 bulgu E-3 kapanmıştır.)*
  4. `CAELUS_PRODUCTION` derlemesinde `SELF_SIGNED_DEV`, `CAELUS_ALLOW_DEV_SCENARIOS` ve `CAELUS_TRUST_ANY_PUBKEY` yolları **derleme dışıdır**; geliştirme derlemesinde env bypass'ları yüksek sesli uyarıyla çalışır.
- Başlıkta **anahtar töreni** prosedürü belgelidir (pubkey türet → pin güncelle → senaryoları yeniden imzala → commit).

### 4.6 Rust Katmanı — `caelus_network` staticlib

`crate-type = ["staticlib","rlib"]`; `panic = "unwind"` bilinçli (her FFI girişi `catch_unwind` ile sarılı — tek bozuk paket, hava boşluklu cihazı çökertemez). Bağımlılıklar: `ed25519-dalek`, `x25519-dalek`, `blake3`, `rand`, `subtle` (sabit-zaman karşılaştırma), `zeroize` (anahtar sıfırlama).

**`mesh_auth.rs` — Shadow-Mesh el sıkışma:**
- 3 faz: challenge (imzalı, nonce'lu) → response (transkripte bağlı, cross-session replay imkânsız) → complete (X25519 DH; **küçük-order/non-contributory anahtar reddi**; Blake3 KDF her iki vk + slot hash + nonce'u bağlar).
- Domain-separation sabitleri (`CAELUS_MESH_CHALLENGE_V1` …) cross-protocol imza tekrarını keser.
- **ZK-stil OTP slot claim zorlaması:** responder'ın slot iddiası doğrulanamazsa el sıkışma **düşer** (yetkilendirme raporlanmaz, zorlanır).
- **KEYMGMT (T-19 + T-23):** Windows'ta kimlik tohumu gerçek **DPAPI** (`CryptProtectData`) blob'u olarak `CAELUSKEY1\0WIN-DPAPI\0` magic'iyle persist edilir; eski düz 32-bayt tohumlar okunduğunda otomatik migrate edilir; POSIX'te düz metin yazmak **yasaktır** (yalnız `CAELUS_IDENTITY_KEY_HEX` env). Ayrıca `caelus_keymgmt_register` ile kayıt edilen harici KEYMGMT eklentisi (ABI 1.1 `protect_key`/`unprotect_key`) artık kimlik persist/load yolundan **fiilen çağrılıyor** — geçiş raporundaki T-23 kapanmıştır.

**`discovery.rs` — P2P keşif + intel kuyruğu:**
- UDP multicast `224.0.0.251:47808`, beacon aralığı 500 ms, peer TTL 10 s, `MAX_PEERS=256` (bellek-tüketme flood koruması).
- Her beacon ed25519 imzalı; fingerprint = `Blake3(verifying_key)` eşleşmezse çerçeve düşer; timestamp tazelik penceresi (30 s) + kesin artan sayaç → replay bloklu.
- **Sanal saat FFI'si** (`caelus_clock_set_virtual`) TTL/tazelik kontrollerini CI'da deterministik yapar.

**`audit_log.rs` — Adli denetim günlüğü (R6):**
- NDJSON; `h_n = Blake3(h_{n-1} ‖ event_json)`; `GENESIS → EVENT… → SEAL`; append-only (`O_APPEND`).
- Mühür: `ed25519(SEAL_CTX ‖ session_id ‖ seq ‖ chain_head)` + cihaz parmak izi + pubkey.
- `tools/verify_audit_log.py` zinciri ve mührü harici olarak doğrular (cryptography veya PyNaCl backend'i).

**`caelus_sign_scenario` CLI (üretim signer, T-9):**
- Kendi strict JSON parser'ı ile C++ kanonik yüküyle **bit-bit aynı** yükü üretir; `--generate-key`, `--write` (imzayı senaryoya yazar), `--export-pubkey` destekli. Çıktı: `ed25519:<pub>:<sig>`.

### 4.7 Plugin SDK — `include/plugin/*`

- **ABI:** saf C99, `abi_version = (MAJOR<<16)|MINOR` (şu an **1.1**); MINOR yalnız ekleme yapar; her eklenti tek sembol export eder: `caelus_plugin_entry`.
- **5 plugin sınıfı:** `SOLVER` (çizelge optimizasyonu), `CONNECTOR` (saha verisi), `REPORTER`, `SCENARIO`, `KEYMGMT` (1.1'de eklendi).
- **Yerleşik solver'lar:** `DeterministicSolver` (her zaman var) + `ORToolsSolver` (CP-SAT; `CAELUS_WITH_ORTOOLS` derleme bayrağıyla, bulunamazsa şeffaf fallback).
- **Yerleşik connector'lar:** `CsvReplayConnector` (sınırlı dinamik replay deposu), `MqttConnector` (MQTT 3.1.1), `ZapierWebhookConnector` (loopback HTTP POST alıcısı). Hepsi CRTP, sanal çağrı yok; env kapılı: `CAELUS_ENABLE_MQTT_CONNECTOR` / `CAELUS_ENABLE_ZAPIER_CONNECTOR` (varsayılan kapalı).
- **DynamicPluginLoader:** imza doğrulama → `LoadLibrary/dlopen` → entry → ABI uyum kontrolü → registry kaydı. Üretim verifier'ı `<plugin>.sig` sidecar dosyasını okur, `ed25519:<pub>:<sig>` ayrıştırır, pubkey'i **`CAELUS_TRUSTED_PLUGIN_PUBKEY` piniyle** karşılaştırır ve `"CAELUS_PLUGIN_V1\n" ‖ ham-baytlar` mesajını doğrular. *(Geçiş raporundaki E-5 — "üretim verifier yok" — kapanmıştır.)*

### 4.8 `ws_emitter.h` + UI — War Room

- RFC 6455 WebSocket sunucusu, **yalnız 127.0.0.1:47809**; el sıkışma için gereken SHA-1 + Base64 inline (~75 satır); NDJSON metin çerçeveleri; geç bağlanan istemci için replay halkası; `CAELUS_WS_MAX_CLIENTS` / `CAELUS_WS_BUFFER_EVENTS` çalışma-zamanı limitleri.
- **UI v3.0:** sıfır dış bağımlılık; 3 sütunlu CSS Grid (mesh canvas + peer list + kripto log | komut bloğu + typewriter çıktı | kaldıraç barları + sparkline + sürtünme göstergesi + OTP zaman çizelgesi); CRT scanline/vignette/glow katmanları; boot animasyonu + WebAudio SFX; WS koparsa `DEMO MODE: OFFLINE` filigranı. Tüm renkler CSS değişkeni üzerinden (tema tek noktadan). Detaylı UX analizi `docs/UI_MODERNIZASYON_RAPORU.md`'dedir.

---

## 5. Senaryo Paketleri (BS Serisi, şema 2.0)

| Paket | Sınıf | Tema | Öne çıkan model ögeleri |
|---|---|---|---|
| **BS-01 SAHTE UFUK** | observability_attack | Küresel aktarma limanı: TOS checksum atlandı, 11.000 TEU hayalet envanter, telemetriyi karartan direktör (`trust=0.20`), kuyruğu bilinçli şişiren rakip CEO | `GHOST_INVENTORY` (reported=0, gerçek=0.11), `DIRECTOR_EGO` (Gate, reported 0.20 / gerçek 1.0), `RIVAL_CEO_FLEET` (Adversary), work-to-rule verimi −%35 |
| **BS-02 GÖLGE ARŞİV** | (insan/finans kara kuğusu) | Bordro kaçırma + tedarikçi kaçışı histerezisleri | `HYST_PAYROLL_MISS`, `HYST_SUPPLIER_FLIGHT` (ikisi de `reversible:false`) |
| **BS-03 KUM SAATİ** | (zaman baskısı) | Blokaj + trafik kaybı; perishable deadline dinamiği | `HYST_BLOKAJ`, `HYST_TRAFIK_KAYBI` |

Ortak özellikler: `tick_minutes: 15`, `horizon_hours: 240`, her pakette sınanan açık bir **aksiyom** cümlesi (örn. BS-01: "Plan-gerçekleşme sapması > %18 → veri güven katsayısı düşürülmeli").

**Güncel imza durumu:** Üç paket de artık `SELF_SIGNED_DEV` **değil**; pinli güven çapasıyla aynı anahtardan (`9bb1dbd0…`) üretilmiş **gerçek ed25519 imzaları** taşıyor. *(v5'teki T-24 / geçiş raporundaki E-2 kapanmıştır.)*

---

## 6. Güvenlik Mimarisi — Bütünleşik Görünüm

### 6.1 Güven zinciri (uçtan uca)

```
tools/caelus_signing.key (32B tohum)
        │  caelus_sign_scenario CLI (--write)
        ▼
scenarios/BS-xx.json  "signature": ed25519:<pub>:<sig>
        │  yükleme anında
        ▼
scenario_pack.h: format → kanonik yük → ed25519 doğrula → PİN (CAELUS_TRUSTED_PUBKEY)
        │  geçerse
        ▼
CausalEngine'e uygulanır; karar audit zincirine yazılır; oturum sonunda ed25519 SEAL
```

Paralel zincirler: **plugin** (`<dll>.sig` sidecar + `CAELUS_TRUSTED_PLUGIN_PUBKEY` pini), **mesh** (beacon imzası + fingerprint eşleşmesi + slot claim zorlaması), **kimlik** (DPAPI blob / KEYMGMT eklentisi).

### 6.2 Derleme modları

| | Geliştirme derlemesi | `CAELUS_PRODUCTION` derlemesi |
|---|---|---|
| `SELF_SIGNED_DEV` senaryo | Env `CAELUS_ALLOW_DEV_SCENARIOS=1` ile kabul (yüksek sesli log) | **Derleme dışı — koşulsuz ret** |
| Pubkey pin kontrolü | `CAELUS_TRUST_ANY_PUBKEY=1` ile atlanabilir (uyarı basar) | **Koşulsuz** |
| İmzasız plugin | `CAELUS_PLUGIN_ALLOW_UNVERIFIED=1` ile verifier kaydı atlanır | **Verifier koşulsuz kayıtlı** |

### 6.3 Saldırı yüzeyi değerlendirmesi

| Yüzey | Koruma | Kalıntı risk |
|---|---|---|
| Senaryo dosyası (untrusted JSON) | Strict parser (derinlik limiti, sayı sınırları), imza + pin, fail-closed | Düşük |
| Dinamik eklenti (.dll/.so = kod yürütme) | Sidecar imza + pin + ABI kontrol + exit 4 | Düşük (dev build'te env bypass kalır) |
| Mesh kontrol düzlemi (UDP beacon) | İmza, fingerprint eşleşmesi, tazelik + sayaç anti-replay, MAX_PEERS | Düşük |
| **Intel veri düzlemi (MQTT/Zapier payload)** | **Kimlik/imza YOK** — broker'a ulaşan herkes nedensel grafa veri enjekte edebilir | **Orta-Yüksek (açık iş, §10)** |
| WS telemetri | Yalnız loopback | Düşük (uzak izleme istenirse auth gerekir) |
| Kimlik tohumu diskte | Windows DPAPI blob + migrate; POSIX düz metin yasak | POSIX TPM/HSM yolu stub |
| Audit mührü | Blake3 zinciri + ed25519 SEAL | Doğrulayıcı, mühürdeki **gömülü** pubkey'e güvenir — pinli çapa henüz yok |

---

## 7. Determinizm Modeli

- **Sabit nokta her yerde:** motor float kullanmaz; 1e6 ölçekli `int64_t` + doyma.
- **DetRng:** xoshiro256** + SplitMix64 seeder; yalnız simülasyon olasılıkları için (kaldıraç başarısı vb.). Kripto yolları her zaman OS CSPRNG kullanır — başlıkta açıkça "NOT cryptographic" uyarısı var.
- **Sanal saat:** Rust discovery saati FFI ile dondurulabilir; audit `ts=0` yazar → hash zinciri deterministik.
- **CI kanıtı:** ci.bat determinizm adımı aynı koşuyu iki kez yapıp CDET bloğunun SHA-256'sını karşılaştırır.

---

## 8. Build ve CI Hattı

### 8.1 `build.bat` (Windows ana hattı, 3 faz)

1. **Faz 1 — UI gömme/obfuskasyon:** `ui/index.html` + `ui/app.js` → `include/ui_payload.h` (statik bayt dizileri).
2. **Faz 2 — Rust:** `cargo build --release` → `caelus_network.lib` (~14 MB; `opt-level="z"`, LTO, strip).
3. **Faz 3 — C++ statik link:** g++ (MinGW) veya cl.exe (MSVC) ile tek exe; `-lws2_32 -lbcrypt -lcrypt32 …`.

**Toolchain matrisi (T-22):** `CAELUS_CXX=GCC|MSVC|<path>` seçimi; GNU target/linker preflight; başarısızsa ve MSVC varsa otomatik MSVC fallback; `CAELUS_SKIP_CMAKE=1`, `CAELUS_DOCKER=1` modları. `build.sh` POSIX karşılığıdır; `CMakeLists.txt` IDE/CMake yolu için aynı hedefi (statik CRT, OR-Tools opsiyonel, post-build strip) sağlar.

### 8.2 `ci.bat` (6 adım)

| # | Adım | İçerik |
|---|---|---|
| 1 | Rust testleri | `cargo test` — 23/23 |
| 2 | C++ birim testleri | doctest harness derle + koş (9 vaka / 50 doğrulama) |
| 3 | Connector smoke | Mini yerel MQTT broker + Zapier loopback POST; `pull_intel → inject_intel` uçtan uca; `CAELUS_SKIP_CONNECTOR_SMOKE=1` ile atlanır |
| 4 | Binary boyut | dist exe < 50 MB |
| 5 | Determinizm | CDET SHA-256 × 2 koşu karşılaştırması |
| 6 | SIG-CI | Negatif imza testi (bozuk imza → SIGNATURE_MISMATCH beklenir) |

BS-EXEC golden koşucusu (`tests/run_bs_exec_golden.py`) ci.bat dışında ayrı koşulur — **şu an bayat** (§10).

---

## 9. Test Varlıkları ve Doğrulama Durumu

| Süit | Konum | Kapsam | Durum |
|---|---|---|---|
| Rust birim | `src/**/*.rs` (21) + signer bin (2) | El sıkışma, keşif, anti-replay, audit zinciri, KEYMGMT round-trip, kanonik yük, deterministik imza | ✅ 23/23 (v5'te çalıştırılarak teyit) |
| C++ doctest | `tests/test_causal_engine.cpp` | Sabit nokta, histerezis, snapshot | ✅ 9 vaka / 50 doğrulama |
| Connector smoke | `tests/connector_smoke.py` | Kendi C++ harness'ı; dış broker gerekmez | ✅ ci.bat Adım 3 |
| BS-EXEC golden | `tests/golden/*` + `run_bs_exec_golden.py` | 3 senaryonun REPL milestone snapshot'ları + normalize SHA-256 | ⚠ **Bayat** — latch-öncesi beklentiler (§10/T-25) |
| Audit doğrulayıcı | `tools/verify_audit_log.py` | Zincir + SEAL harici doğrulama | ✅ Mevcut |

---

## 10. Güncel Teknik Borç Durumu (bu raporla revize)

Önceki raporlardan bu yana kapananlar — **hepsi bu rapor için diskten teyitli:**

| Borç | Önceki durum | Şimdi | Kanıt |
|---|---|---|---|
| T-17 Loader wiring | "Yazıldı ama bağlanmadı" | ✅ **Kapandı** | `core_engine.cpp:707` `--plugin` CLI; `:825` loader örneklemesi; exit 4 fail-closed |
| E-3 / Güven çapası | "Gömülü anahtara güven, pin yok" (P0) | ✅ **Kapandı** | `scenario_pack.h:741` `CAELUS_TRUSTED_PUBKEY` + `:948` memcmp; `CAELUS_PRODUCTION` koşulsuz |
| E-5 Üretim plugin verifier | "Verifier=nullptr" | ✅ **Kapandı** | `core_engine.cpp:828/840` `VerifyPluginSignatureProd` + `CAELUS_TRUSTED_PLUGIN_PUBKEY` |
| T-24 / E-2 Demo imzalı senaryolar | `SELF_SIGNED_DEV` | ✅ **Kapandı** | Üç BS dosyasında gerçek `ed25519:9bb1dbd0…` imzaları |
| T-23 KEYMGMT wiring | "ABI var, kimlik yoluna bağlı değil" | ✅ **Kapandı** | `mesh_auth.rs:319` `caelus_keymgmt_register`; persist/load yolunda `keymgmt_delegate()` çağrıları (`:366`, `:457`) |
| E-1/E-4 Dev bypass'lar | Env ile her build'te açılabilir | ◑ **Daraltıldı** | `CAELUS_PRODUCTION` derlemesinde tüm bypass'lar derleme dışı |
| **GOLDEN-REFRESH (T-25)** | Golden latch-öncesi beklentileri kilitliyordu | ✅ **Kapandı (F0, 2026-06-10 öğleden sonra)** | `run_bs_exec_golden.py` latched beklentiler + yeni SHA-256'lar + `--refresh` modu; `tests/golden/*_expected.json` latched değerler + güncel REPL izleri; her iki süit yeşil |
| **Bayat dist binary** | 10:33 ara derlemesi | ✅ **Kapandı (F0)** | build.bat ile yeniden derlendi (~2,6 MB, GCC + windows-gnu, strip'li); ci.bat 6/6 adım yeşil ("TÜM TESTLER BAŞARILI") |
| **SIGNED-CI** | Golden/CI dev bypass ile koşuyordu | ✅ **Kapandı (F0)** | Golden runner'lardan `CAELUS_ALLOW_DEV_SCENARIOS` kaldırıldı (env sızması da engellendi); SIG-CI artık `tests/make_negative_scenario.py` ile üretilen bozuk-imzalı fixture'a karşı gerçek ed25519 reddini doğruluyor |

**Hâlâ açık olanlar (önem sırasıyla):**

| # | Açık iş | Önem | Detay |
|---|---|---|---|
| 3 | **Intel veri düzlemi kimliksiz** | Orta-Yüksek | Mesh kontrol düzlemi imzalıyken MQTT/Zapier intel payload'ları kimlik/imza taşımıyor; broker'a erişen herkes grafa veri enjekte edebilir. Topic sözleşmesi + payload imzası tasarımı geçiş raporu §5'te hazır. |
| 4 | **Audit mühür çapası** | Orta | `verify_audit_log.py` SEAL satırındaki **gömülü** pubkey ile doğruluyor; "beklenen imzacı" pini/parametresi yok — senaryo tarafında kapanan desen burada açık. |
| 5 | **Çoklu-toolchain fiili CI** | Orta | Matris script'te tam; bu makinede yalnız MinGW g++ 15.2.0 var, MSVC leg'i fiilen hiç koşulmadı. |
| 6 | **İmza anahtarı hijyeni** | Orta | `tools/caelus_signing.key` 32-baytlık ed25519 tohumu depoda **düz** duruyor (pinin private karşılığı!). Üretimde anahtar töreni + HSM/offline saklama şart; mevcut hâliyle "repo'ya erişen imza atar". |
| 7 | POSIX kimlik yolu | Düşük-Orta | TPM/HSM backend stub; yalnız env (`CAELUS_IDENTITY_KEY_HEX`) — dev/CI için kabul edilebilir, üretim Linux hedefi için değil. |
| 8 | T-14 audit verifier bağımlılığı | Düşük | `verify_audit_log.py` Python `blake3` paketine muhtaç (saf-Python fallback yok). |
| 9 | WS uzak erişim | Düşük | Loopback-only tasarım gereği güvenli; uzak War Room istenirse TLS+token gerekir (bilinçli kapsam dışı). |

---

## 11. Güçlü Yönler / Zayıf Yönler — Dürüst Bilanço

**Güçlü:**
- Olağanüstü disiplinli güvenlik mühendisliği: fail-closed varsayılanlar, domain separation, sabit-zaman karşılaştırmalar, zeroize, küçük-order DH reddi, anti-replay, saturating aritmetik — hepsi kodda, vaatte değil.
- Gerçek determinizm (CI'da hash'le kanıtlanan), gerçek adli izlenebilirlik (harici doğrulayıcılı).
- Sıfır dış bağımlılık felsefesi tavizsiz uygulanmış (JSON parser, SHA-1, Base64, AES, WS sunucusu hep inline).
- Rapor kültürü: v1→v5 + geçiş raporu, her iddia dosya/satır kanıtlı; teknik borçlar saklanmıyor, numaralanıp takip ediliyor.
- Plugin ABI'si gerçek bir SDK gibi tasarlanmış (saf C99, sürümleme sözleşmesi, 5 sınıf).

**Zayıf / dikkat:**
- ~~Test güncelliği motorun gerisinde~~ → **F0 ile giderildi (2026-06-10):** golden latched semantiğe yenilendi, her iki süit + ci.bat 6/6 yeşil.
- "Tek statik binary" dağıtım modeli, binary'nin kaynakla senkron tutulmasını kritikleştiriyor (F0 ile senkronlandı; süreçte tekrar açılabilir bir risk olarak izlenmeli).
- Kimlik/imza altyapısı güçlü ama **anahtar yaşam döngüsü** (üretim töreni, saklama, rotasyon) henüz operasyonel değil — private tohum depoda.
- Header-ağırlıklı C++ (965–1.411 satırlık başlıklar) derleme süresi ve okunabilirlik maliyeti getiriyor; tek-binary hedefi için bilinçli bir takas.
- C++ tarafının test yoğunluğu (126 satır doctest) Rust tarafına (≥23 test) göre zayıf.

---

## 12. Önerilen Yol Haritası (önceliklendirilmiş)

| Sıra | İş | Efor | Çıktı |
|---|---|---|---|
| 1 | ~~**Yeniden derle + tam CI**~~ | S | ✅ **Tamamlandı (F0, 2026-06-10):** yetkili `dist/caelus_os.exe` (~2,6 MB) + ci.bat 6/6 yeşil |
| 2 | ~~**GOLDEN-REFRESH (T-25)**~~ | S–M | ✅ **Tamamlandı (F0):** latched beklentiler + yeni hash'ler + `--refresh` modu; determinizm kanıt katmanı yeşil |
| 3 | ~~**SIGNED-CI**~~ | S | ✅ **Tamamlandı (F0):** golden dev bypass'sız; SIG-CI bozuk-imza fixture'ı (`tests/make_negative_scenario.py`) ile |
| 4 | **Anahtar töreni:** `caelus_signing.key`'i depodan çıkar, offline/HSM sakla, rotasyon prosedürünü işlet | M | İmza zincirinin gerçek dünyada anlamı |
| 5 | **Intel payload kimliği:** MQTT/Zapier veri düzlemine imza/kimlik (geçiş raporu §5 tasarımı) | M | Saha verisi enjeksiyon yüzeyi kapanır |
| 6 | **Audit mühür pini:** `verify_audit_log.py`'ye beklenen-imzacı parametresi | S | Adli zincirde "kim mühürledi" garantisi |
| 7 | **BUILD-MATRIX-CI:** MSVC leg'inin fiili koşumu | M | Taşınabilirlik iddiası kanıtlanır |
| 8 | POSIX TPM backend + uzak War Room auth (istenirse) | L | Üretim Linux + uzak izleme |

---

## 13. Hızlı Referans

| Öğe | Değer |
|---|---|
| Binary | `dist/caelus_os.exe` — 2.710.016 B (F0 yeniden derlemesi, 2026-06-10; bütçe < 50 MB) |
| Rust lib | `target/release/caelus_network.lib` — ≈ 14 MB |
| WS telemetri | `ws://127.0.0.1:47809` (yalnız loopback) |
| Mesh keşif | UDP multicast `224.0.0.251:47808` |
| Güven çapası | `9bb1dbd039043670…a04fa802` (`tools/caelus_trusted_pubkey.txt` = `scenario_pack.h` pini) |
| İmza formatı | `ed25519:<64hex-pubkey>:<128hex-sig>` |
| Plugin ABI | v1.1 (`caelus_plugin_entry`; sidecar `<plugin>.sig`) |
| Determinizm | `--det-mode` (seed `0xCAE105DEADBEEF00`, ts=0, session_id=0) |
| Çalıştırma | `CAELUS_CALISTIR.bat` veya `dist\caelus_os.exe --scenario BS-01_SAHTE_UFUK --repl` |
| Üretim derlemesi | `CAELUS_PRODUCTION` tanımı → tüm dev bypass'ları derleme dışı |

---

*Bu rapor; kaynak ağacındaki her ana dosyanın başlık/sözleşme bölümleri, üç senaryo paketi, test ve build script'leri ile mevcut yedi dokümantasyon raporu okunarak ve önceki raporlarda "açık" görünen kalemlerin güncel durumu (pin, verifier, `--plugin`, imzalar, KEYMGMT wiring, golden beklentileri, binary zaman damgaları) diskten yeniden doğrulanarak hazırlanmıştır.*
