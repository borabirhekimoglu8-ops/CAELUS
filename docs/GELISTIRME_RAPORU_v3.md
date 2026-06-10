# CAELUS OS — Geliştirme Raporu v3

**Sürüm:** 3.0
**Kapsam:** v2.0'dan bu yana yapılan sertleştirme + evrenselleştirme çalışmasının teknik denetimi; güncel güvenlik duruşu; teknik borç kapanma matrisi; kalan açıklar, yeni riskler ve önceliklendirilmiş yol haritası
**Dayanak:** Mevcut kaynak ağacı — `core_engine.cpp`, `include/causal_engine.h`, `include/scenario_pack.h`, `include/ws_emitter.h`, `include/det_rng.h`, `include/audit_log.h`, `include/plugin/*`, `src/lib.rs`, `src/audit_log.rs`, `src/scenario_verify.rs`, `src/network/discovery.rs`, `tests/test_causal_engine.cpp`, `tests/doctest.h`, `tools/verify_audit_log.py`, `scenarios/BS-0{1,2,3}*.json`, `ci.bat`, `build.bat`, `CMakeLists.txt`, `Cargo.toml`, `docs/BS_EXEC_REPL_KILAVUZU.md`
**Tarih:** 2026-06-10
**Önceki raporlar:** `docs/GELISTIRME_RAPORU.md` (v1.0 — R1…R10 önerileri, G-1…G-7 açıkları) · `docs/GELISTIRME_RAPORU_v2.md` (v2.0 — R1…R7/F0/R3 tamamlandı, G-1…G-7 kapanma matrisi, T-1…T-8 teknik borç, A/B/C/D faz yol haritası)

> Bu rapor v2.0'ın devamıdır. v2.0, motorun artık var olduğunu (Causal Engine v2), senaryoların dışarıdan geldiğini, determinizmin kanıtlandığını ve denetim izinin tutulduğunu doğrulamıştı; ancak yeni kodun **güvenlik borcunu** (sertleşmemiş JSON parser, zorlanmayan imza) ve motorun **sektör kilidini** (yerleşik Vathy baseline'ı) açık bırakmıştı. Aradan geçen sürede v2'nin **Faz A (sertleştirme)** ve **Faz B/C (canlandırma + kalite)** iş paketleri kodlandı ve buna ek olarak motor tabanı tamamen **evrenselleştirildi**. Bu rapor neyin gerçekten yapıldığını dosya/sembol kanıtıyla doğrular, hangi teknik borcun kapandığını ölçer ve yeni kodun getirdiği riskleri masaya yatırır.

---

## 1. Yönetici Özeti — Sertleştirme ve Evrenselleşme Sıçraması

v2.0'daki CAELUS OS **çalışan ama henüz korumasız ve sektöre gömülü** bir motordu: gerçek bir nedensel graf çalışıyordu, fakat senaryo paketlerinin imzası yalnızca loglanıyordu, JSON ayrıştırıcı kötü niyetli girdide çökebiliyordu, connector boru hattı uykudaydı, REPL yoktu ve motorun varsayılan tabanı hâlâ `load_vathy_baseline()` ile tek bir limana (Vathy) gömülüydü.

v3.0 itibarıyla proje iki eksende niteliksel olarak sıçradı:

- **Sertleştirme (kurcalanamazlık).** Senaryo paketleri artık **fiilen ed25519 ile doğrulanıyor**: imza `ed25519:<pubkey-hex>:<sig-hex>` formatında, imzalanan yük `extended_causal_model` + `v1_engine_bridge` üzerinden kanonikleştiriliyor, doğrulama Rust FFI (`caelus_verify_scenario_signature`, `ed25519-dalek`) ile yapılıyor; geçersiz imza → `[FATAL] SIGNATURE_MISMATCH` → motor boş şablonda kalır. JSON ayrıştırıcı **exception-free** sayı ayrıştırma (`from_chars`/`strtod`), 64 derinlik sınırı, katı `\uXXXX` çözümü, geçersiz vekil/çift anahtar/artık-çöp reddi ile fuzz-dayanıklı hale geldi. Sabit nokta aritmetiği **taşma-doymalı** (`fp_mul_div_u64_sat` çarpımı asla `a*b` oluşturmaz) çekirdeğe oturtuldu ve gerçek bir C++ doctest paketiyle (9 vaka, 50 doğrulama) test altına alındı.

- **Evrenselleşme (sektör-agnostiklik).** `load_vathy_baseline` → `load_universal_blank_slate`, `RunVathyShadowMeshHandshake` → `RunShadowMeshHandshake`, `RunVathyPortOptimization` → `RunOptimizationCycle` yeniden adlandırıldı; solver alan adları sektör-bağımsızlaştı (`task_start_min`, `target_deadline_min`, `commit_overhead_min`, `base_transit_*`, `arrival`, `completion`); motor kodundan tüm sektörel terimler (gemi/gümrük/kurye/boarding) temizlendi. Senaryo enjekte edilmediğinde motor `UNIVERSAL_BASELINE` + `AWAITING_SCENARIO_INJECTION` durumunda **sıfır-akış (1.0x nötr)** modunda bekler; tüm kriz yapısı yalnızca dış, imzalı JSON paketten gelir.

Buna ek olarak **canlandırma** tamamlandı: connector hattı uyandı (`ffi_inject_intel` gerçek callback, `CsvReplayConnector` tam, tick döngüsünde `dispatch_connectors()`, `--intel-replay`), bir senaryo REPL'i eklendi (`--repl`/`--interactive`), denetim günlüğü segment rotasyonu + bağımsız Python doğrulayıcı kazandı, WS emitter çok-istemcili (8) sıralı tampona geçti.

**Tek cümlede:** v2.0'da "motor var ama korunmasız ve Vathy'ye gömülü"ydü; v3.0'da motor **agnostik, kurcalanamaz ve ticari-aday** bir çekirdek. Geçiş, bir "demo/yerel ürün"den, herhangi bir sektörün imzalı senaryo paketini güvenle yürütebilen bir platforma doğrudur. Kalan iş, **imza üretim aracını (signer CLI)**, gerçek dünya connector'larını, anahtar yönetimini (TPM/DPAPI) ve birkaç ince determinizm/operasyon nüansını kapatmaktır.

---

## 2. Tamamlanan İşler (v2 sonrası)

| # | Başlık | Birincil dosyalar | Durum |
|---|---|---|---|
| 1 | T-1 JSON parser sertleştirme | `include/scenario_pack.h` | ✅ Tamam |
| 2 | T-2 Strict ed25519 imza doğrulama | `include/scenario_pack.h`, `src/scenario_verify.rs`, `src/lib.rs` | ✅ Tamam |
| 3 | R8 Connector hattı (gerçek enjeksiyon + CSV/JSONL replay) | `include/plugin/caelus_plugin_registry.h`, `include/plugin/caelus_connector.h`, `core_engine.cpp` | ✅ Tamam |
| 4 | R9 Senaryo REPL + BS-EXEC | `core_engine.cpp`, `docs/BS_EXEC_REPL_KILAVUZU.md` | ✅ Tamam |
| 5 | R7b / T-3 C++ test paketi + taşma düzeltmesi | `include/causal_engine.h`, `tests/doctest.h`, `tests/test_causal_engine.cpp`, `ci.bat` | ✅ Tamam |
| 6 | T-5 Audit log rotasyonu + doğrulayıcı | `src/audit_log.rs`, `tools/verify_audit_log.py` | ✅ Tamam |
| 7 | T-4 WS emitter çok-istemci | `include/ws_emitter.h` | ✅ Tamam |
| 8 | Evrenselleştirme refaktörü | `core_engine.cpp`, `include/causal_engine.h`, `include/plugin/caelus_solver.h`, `src/intel_core.*`, `ui/app.js` | ✅ Tamam |

### 2.1 T-1 — JSON Parser Sertleştirme

`include/scenario_pack.h` içindeki `JsonParser`, v2'de `std::stod`/`std::stoll` ile malformed girdide exception fırlatıp çökebiliyordu. v3'te tamamen **exception-free** ve sınırlı bir recursive-descent ayrıştırıcıya dönüştü:

- **Exception-free sayı ayrıştırma.** Tamsayılar `std::from_chars`, ondalıklar `std::strtod` + `errno`/`ERANGE`/`isfinite`/`parsed_end` denetimiyle çözülür; hata fırlatmak yerine `fail()` ile sessizce reddedilir.

```cpp
// scenario_pack.h — parse_number (exception fırlatmaz)
if (is_float) {
    errno = 0;
    char* parsed_end = nullptr;
    double v = std::strtod(num.c_str(), &parsed_end);
    if (errno == ERANGE || parsed_end != num.c_str() + num.size() || !std::isfinite(v)) {
        fail();
        return {};
    }
    return JsonVal::float_v(v);
}
int64_t parsed = 0;
const auto conv = std::from_chars(start, p, parsed, 10);
if (conv.ec != std::errc{} || conv.ptr != p) { fail(); return {}; }
```

- **Yığın taşması koruması.** `MAX_RECURSION_DEPTH = 64`; her `parse_value(depth)` çağrısı derinliği denetler → kötü niyetli derin-içiçe JSON (`[[[[…]]]]`) ayrıştırma yığınını taşıramaz.
- **Katı `\uXXXX` çözümü.** `read_unicode_escape` + `append_utf8` ile RFC 8259 uyumlu vekil-çift (surrogate pair) işleme; **tek başına düşük vekil** (`\uDD1E`) ve **eşsiz yüksek vekil** (`\uD834x`) reddedilir.
- **Diğer katılık kuralları.** Çift anahtar reddi (`parse_object` içinde mevcut anahtar taranır), baştaki sıfır reddi (`01` geçersiz), kontrol karakteri reddi (`< 0x20`), sonda artık-çöp reddi (`parse()` `p != end` ise başarısız).

Bu kurallar `tests/test_causal_engine.cpp` içinde üç ayrı vakayla doğrulanır: `JsonParser rejects malformed numbers without throwing`, `JsonParser enforces recursion depth`, `JsonParser strictly handles unicode escapes`.

### 2.2 T-2 — Strict ed25519 İmza Doğrulama

v2'de `signature` alanı yalnızca bilgilendirme amaçlı loglanıyordu. v3'te imza **bir güvenlik kapısıdır** (`verify_signature_gate`, `scenario_pack.h`) ve `load()` içinde manifest okunduktan hemen sonra zorlanır; başarısızlıkta paket yüklenmez.

- **İmza formatı.** `ed25519:<pubkey-hex-32B>:<sig-hex-64B>` — `parse_ed25519_signature_format` ile ayrıştırılır; uzunluk/hex katı kontrol edilir (pubkey 64 hex, imza 128 hex).
- **İmzalanan kanonik yük.** Yalnız kritik alanlar imzalanır; sıralama farkından kaynaklı sahteciliği önlemek için nesne anahtarları sıralı, ondalıklar 17 anlamlı basamak ile yazılır (`canonical_json`):

```cpp
// scenario_pack.h — canonical_signed_payload
payload += "CAELUS_SCENARIO_PACK_V1\n";
payload += "extended_causal_model=";
payload += canonical_json(cm ? *cm : null_value);
payload += "\nv1_engine_bridge=";
payload += canonical_json(bridge ? *bridge : null_value);
payload += "\n";
```

- **Rust üzerinden doğrulama.** C++ kanonik yük baytlarını `caelus_verify_scenario_signature` FFI'sine geçirir; doğrulama `ed25519-dalek` ile yapılır, panik-korumalıdır (`catch_unwind`) ve `msg_len`'i 16 MiB ile sınırlar:

```rust
// src/scenario_verify.rs
let verifying_key = VerifyingKey::from_bytes(pubkey_arr)?;
let signature = Signature::from_bytes(sig_arr);
if verifying_key.verify(msg, &signature).is_ok() { 1u8 } else { 0u8 }
```

- **Dev bypass kapısı.** `SELF_SIGNED_DEV` **varsayılan olarak reddedilir**; yalnız `CAELUS_ALLOW_DEV_SCENARIOS=1` ortam değişkeniyle, açık bir uyarı basılarak kabul edilir. Üç BS paketi (`scenarios/BS-0{1,2,3}*.json`) hâlâ `SELF_SIGNED_DEV` imzalıdır; dolayısıyla yalnız dev kapısı açıkken yüklenir.
- **Hata davranışı.** Boş imza, eksik kritik alan, geçersiz format veya başarısız ed25519 → `[FATAL] SIGNATURE_MISMATCH` (stderr) + `load()` → `false`. `core_engine.cpp`'de bu durumda `pack_loaded=false` olur ve motor `load_universal_blank_slate()` + `AWAITING_SCENARIO_INJECTION` ile **boş şablonda kalır** (çökmez).

### 2.3 R8 — Connector Hattı (Gerçek Enjeksiyon + Replay)

v2'de `ffi_inject_intel` no-op stub'tı ve `dispatch_connectors()` hiç çağrılmıyordu; connector boru hattı uykudaydı. v3'te hat tamamen canlı:

- **Gerçek motor enjeksiyon callback'i.** `PluginRegistry::bind_intel_injector(ctx, fn)` ile concrete bir sink bağlanır; `ffi_inject_intel` artık bu sink'e yönlendirir. `core_engine.cpp` `InjectConnectorIntel` köprüsünü `ConnectorIntelBridge{&causal_engine}` ile bağlar:

```cpp
// core_engine.cpp
ConnectorIntelBridge connector_bridge{&causal_engine};
g_registry.bind_intel_injector(&connector_bridge, &InjectConnectorIntel);
// InjectConnectorIntel → causal_engine.inject_intel(clamp(coeff,0,1), min(level,3), memo)
```

- **`CsvReplayConnector` tam implementasyon.** CSV (`tick,friction_coeff,crisis_level,memo`), JSONL ve ScenarioPack `intel_feed_sequence` formatlarını okur; olayları tick'e göre sıralar (`sort_events`, insertion-sort) ve `do_pull()` ile yalnız `tick <= current_tick` olanları sızdırır. Kapasite **256 olay** (`kMaxReplayEvents`), doluğunda tek seferlik uyarı verir.
- **Tick döngüsüne bağlama.** Hem ana akışta (`run_causal_tick` lambda) hem REPL'de (`run_repl_tick`) her tick öncesi `g_tick_ctr` güncellenir ve `g_registry.dispatch_connectors()` çağrılır; enjekte edilen olay sayısı raporlanır.
- **`--intel-replay <path>` bayrağı.** Senaryo paketinin kendi `intel_feed_sequence`'ine **ek** bir CSV/JSONL replay dosyası tanımlanabilir (ayrı bir `CsvReplayConnector` kaydı). Paket yüklenmemişse replay "geçerli imzalı senaryo gerekir" notuyla bekletilir.

### 2.4 R9 — Senaryo REPL + BS-EXEC

`core_engine.cpp` artık `--repl` (veya geriye uyumlu `--interactive`) ile etkileşimli bir senaryo konsolu sunar (`RunScenarioRepl`):

| Komut | Etki |
|---|---|
| `status` / `snapshot` | Güncel tick, ham/kenet sürtünme, rejim, outage, deadline, histerezis özeti |
| `tick <n>` | Motoru N tick ilerletir; her tick `dispatch_connectors()` ile zamanlı intel'i uygular |
| `lever <id>` | Senaryo kaldıracını `CausalEngine::apply_lever` ile uygular, 1 tick yayar, yeni snapshot basar |
| `list levers` | Yüklü senaryo kaldıraçlarını (id/target/p/cost/lockout) listeler |
| `help` / `quit` | Yardım / çıkış |

- Lever'lar deterministik (`apply_lever` tohumlu `DetRng`); `tick` komutu zamanlı `intel_feed_sequence` olaylarını connector hattından geçirir.
- **Adli iz.** Her REPL komutu `REPL_COMMAND`, her tick `REPL_TICK` olayı olarak denetim günlüğü zincirine yazılır (`audit_repl_event`, `run_repl_tick`).
- `docs/BS_EXEC_REPL_KILAVUZU.md`, BS-01/02/03 paketlerini uçtan uca koşmak için somut komut dizileri, eşik formülü (`tick <threshold_tick - current_tick + 1>`) ve beklenen gözlemleri (deadline kaçırma, histerezis flip, REGIME_EXCEEDED) belgeler.

### 2.5 R7b / T-3 — C++ Test Paketi ve Taşma Düzeltmesi

- **Taşma-doymalı sabit nokta.** `include/causal_engine.h` çarpma/bölmeyi `fp_mul_div_u64_sat` ile yapar; bu fonksiyon **asla `a*b` ara çarpımını oluşturmaz** (shift-add ile böler), bu yüzden JSON'dan gelen sınırsız `multiplier_fp`/`permanent_loss_fp` bile int64 taşmasına yol açmaz, `INT64_MAX/MIN`'e doyar. `d_to_fp` NaN→0, ±inf→±`INT64_MAX/MIN` kenetler; `fp_add_saturating` taşma-güvenlidir.
- **Minimal doctest harness.** `tests/doctest.h` (dış bağımlılık yok), `tests/test_causal_engine.cpp` **9 vaka / 50 doğrulama**: sabit nokta normal/sınır değerleri, `d_to_fp` non-finite kenetleme, boş şablon nötrlüğü, intel→sürtünme artışı, solver C ABI gidiş-dönüş, ve üç JSON sertleştirme vakası.
- **CI'ya ayrı C++ adımı.** `ci.bat` artık 4 adımlı: Rust testleri → **C++ unit tests (ADIM 2/4)** (`build_tests\caelus_cpp_tests.exe` derlenir + koşulur) → binary boyut → determinizm.

### 2.6 T-5 — Audit Log Rotasyonu + Doğrulayıcı

`src/audit_log.rs` artık sınırsız büyümeyen, segmentli bir adli kayıt üretir:

- **Segment rotasyonu.** `CAELUS_AUDIT_MAX_BYTES` (varsayılan 16 MiB) aşılınca mevcut segment mühürlenir (`seal_segment`), yeni segment `base.log.N` olarak açılır ve yeni genesis **`prev_segment_chain_head`** alanıyla önceki segmentin zincir başına bağlanır → segmentler arası zincir devamlılığı korunur.
- **Yapılandırılabilir flush.** `CAELUS_AUDIT_FLUSH_EVERY` (varsayılan 1 = her yazımda flush, adli dayanıklılık). Daha büyük değer I/O maliyetini düşürür ama güç kesintisinde son N olay riske girer.
- **Bağımsız Python doğrulayıcı.** `tools/verify_audit_log.py` segmentleri keşfeder (`base.log`, `base.log.1`, …), her satırın `prev`+`event`→Blake3→`hash` zincirini ve segment geçişlerini denetler, SEAL imzasını ed25519 ile doğrular. `blake3` modülü yoksa **açık hata** (sessizce geçmez); `cryptography`/`pynacl` yoksa `--chain-only` ile imza atlanabilir.

### 2.7 T-4 — WS Emitter Çok-İstemci

`include/ws_emitter.h` v2'deki tek-istemci/512-kuyruk tasarımından sıralı çok-istemci modeline geçti:

- **Çok-istemci.** En fazla **8 eşzamanlı War Room istemcisi** (`kMaxClients`); `select()` tabanlı tek thread tüm istemcileri yönetir, sınır dolunca yeni bağlantı reddedilir.
- **Sıralı halka tampon.** Olaylar `seq` numaralı bir `deque`'te tutulur (`CAELUS_WS_BUFFER_EVENTS` varsayılan 4096, üst sınır 65536); her istemci kendi `next_seq`'inden okur.
- **Boşluk bildirimi.** Bir istemci geride kalıp tampondan düşmüş olaylar varsa, ona `{"type":"ws_gap","dropped":N}` (`ws_gap`) gönderilir → veri kaybı sessiz kalmaz.
- **Air-gap korunur.** Yalnız `127.0.0.1`'e bağlanır; el sıkışma için gereken SHA-1/Base64 inline'dır, dış kütüphane eklenmez.

### 2.8 Evrenselleştirme Refaktörü

Motor çekirdeği sektör-agnostik hale getirildi:

| Eski (Vathy'ye gömülü) | Yeni (agnostik) | Konum |
|---|---|---|
| `load_vathy_baseline` | `load_universal_blank_slate` | `causal_engine.h` |
| `RunVathyShadowMeshHandshake` | `RunShadowMeshHandshake` | `core_engine.cpp` |
| `RunVathyPortOptimization` | `RunOptimizationCycle` | `core_engine.cpp` |
| gemi/gümrük/kurye/boarding alanları | `task_start_min`, `target_deadline_min`, `commit_overhead_min`, `base_transit_low/high_min`, `arrival`, `completion` | `plugin/caelus_solver.h`, `plugin/caelus_plugin_abi.h` |

- **Boş şablon = sıfır akış.** `load_universal_blank_slate()` soyut isimli iskelet düğümler kurar (`Regulatory_Gate`, `Actor_Alpha`, `Transit_Node`, `Friction_Entity`, `Buffer_Node`); tüm `state_fp=0` olduğundan `aggregate_friction()` 1.0x döndürür.
- **AWAITING durumu.** Varsayılan `scenario_id = "UNIVERSAL_BASELINE"`; `scenarios/UNIVERSAL_BASELINE.json` olmadığından motor boş şablona düşer, `engine_state("AWAITING_SCENARIO_INJECTION", …, 1.0)` yayar ve sıfır-akış nötr modunda bekler. Tüm kriz yapısı yalnız dış, imzalı paketten gelir.

---

## 3. Güvenlik Duruşu

v3'ün asıl kazanımı, "air-gapped + adli iz" iddiasını **kurcalanamazlıkla** desteklemesidir. T-1 ve T-2, motorun iki kritik saldırı yüzeyini kapatır: güvenilmeyen JSON ve yetkisiz senaryo.

### 3.1 T-1 / T-2 Nasıl Kapandı

| Saldırı yüzeyi | v2 durumu | v3 önlemi | Kanıt |
|---|---|---|---|
| Manipüle/malformed JSON | `stod`/`stoll` exception → çökme | Exception-free `from_chars`/`strtod` + `fail()` | `scenario_pack.h::parse_number` |
| Derin-içiçe JSON (yığın taşması) | Sınır yok | `MAX_RECURSION_DEPTH=64` | `scenario_pack.h::parse_value` |
| Unicode/vekil sahteciliği | `\u` desteklenmiyordu | Katı vekil-çift, lone/eşsiz vekil reddi | `read_unicode_escape` |
| Çift anahtar / artık-çöp | Tolere ediliyordu | Reddedilir | `parse_object`, `parse()` |
| int64 çarpım taşması | `(a*b)/SCALE` riski | `fp_mul_div_u64_sat` (a*b oluşmaz) | `causal_engine.h::detail` |
| Yetkisiz/sahte senaryo | İmza yalnız loglanıyordu | ed25519 doğrulama zorlanır | `verify_signature_gate` + `scenario_verify.rs` |

### 3.2 Tehdit Modeli

- **Manipüle JSON.** Saldırgan diske bozuk/aşırı bir `scenarios/<id>.json` koyarsa: sayı taşması, derin içiçe yapı, geçersiz escape, çift anahtar veya sondaki çöp ayrıştırıcıyı çökertemez; `load()` `false` döner, motor boş şablonda kalır.
- **Fuzzing.** Ayrıştırma yolları `noexcept` ve exception-free; girdi-tetikli `std::terminate`/abort yolu kapatıldı. `tests/test_causal_engine.cpp` malformed sayı, derinlik ve unicode için negatif vakalar içerir (fuzz tohumlarının çekirdeği).
- **Yığın taşması.** Derinlik sınırı (64) + heap-tabanlı `JsonVal` (özçağrı yığını sınırlı) ile derin-içiçe DoS engellenir.
- **İmza sahteciliği.** Kritik alanlar (graf + köprü) kanonikleştirilip imzalandığından, saldırgan grafı değiştirip eski imzayı yeniden kullanamaz (doğrulama bozulur). Pubkey imzanın içinde taşınsa da, **yetki** asıl olarak hangi pubkey'lerin kabul edileceği kararına (anahtar yönetimi/whitelist) bağlıdır — bu kısım henüz açık (bkz. 5.1, T-9).
- **Memo enjeksiyonu.** Saha memo'su WS katmanında sanitize edilir (`ws_json::intel_event` `"`/`\` → `_`) ve Rust FFI tarafından 127 bayta sınırlanır; UI'a ham JSON enjeksiyonu engellenir.

### 3.3 Kalan Güvenlik Notları

- **Doğrulama backend'i Rust FFI'ye bağımlı.** C++ tarafı imza doğrulamasını tek bir simgeye (`caelus_verify_scenario_signature`) devreder; bu simge link zamanında yoksa veya FFI değiştirilirse doğrulama kapısı tek noktadan etkilenir. (Tasarımca panik-korumalı ve sınırlı; yine de tek bağımlılık noktasıdır.)
- **Dev bypass ortam değişkeni.** `CAELUS_ALLOW_DEV_SCENARIOS=1` tüm imza zorlamasını `SELF_SIGNED_DEV` paketler için atlar. Geliştirme için gerekli; ancak üretimde yanlışlıkla ayarlı kalırsa kurcalanamazlık iddiası düşer. Üretim derlemesinde bu kapının derleme-zamanı kapatılması düşünülmeli.
- **İmza üreten araç yok.** Şu an gerçek (dev olmayan) imzalı paket üretecek bir signer CLI bulunmadığından, tüm pratik kullanım dev bypass'a yöneliyor (bkz. 5.1).
- **Anahtar gizliliği/TPM yok.** Cihaz kimliği `caelus_identity.key` dosyasında düz tutulur; donanım korumalı (TPM/DPAPI) saklama R10 kapsamında hâlâ açık.

---

## 4. Mevcut Mimari Durum

### 4.1 Güncellenmiş Katman Tablosu

| Katman | Dosya | v2 Durumu | v3 Durumu | Değerlendirme |
|---|---|---|---|---|
| Çekirdek orkestrasyon | `core_engine.cpp` | CLI + fazlı | **+ REPL + connector dispatch + agnostik isimler** | `--scenario/--repl/--intel-replay/--det-mode` |
| Nedensel model | `include/causal_engine.h` | Tick graf motoru | **+ taşma-doymalı fp, evrensel boş şablon** | Sektör-agnostik, taşma-güvenli |
| Senaryo girişi | `scenario_pack.h`, `scenarios/*.json` | İmza loglanıyordu | **Sertleşmiş parser + zorunlu ed25519 imza** | Geçersiz imza → blank slate |
| İmza doğrulama | `src/scenario_verify.rs` | (yoktu) | **ed25519-dalek FFI + canonical payload** | Panik-korumalı, 16 MiB sınırlı |
| Solver | `plugin/caelus_solver.h` | Eklenti soyutlaması | **+ agnostik alan adları** | Deterministik + opsiyonel OR-Tools |
| Connector | `plugin/caelus_connector.h`, registry | Stub (uykuda) | **CsvReplay tam + tick dispatch canlı** | 256 olay sınırı |
| Determinizm | `det_rng.h`, `discovery.rs`, `ci.bat` | Sanal saat + sıralı peer + CDET | **+ C++ unit test adımı** | İki-koşum SHA-256 kapısı |
| Denetim izi | `src/audit_log.rs`, `audit_log.h` | Blake3 zinciri + mühür | **+ segment rotasyonu + Python doğrulayıcı** | `prev_segment_chain_head` zincir devamlılığı |
| WS / UI | `ws_emitter.h`, `ui/*` | Tek-istemci + filigran | **8 istemci + sıralı tampon + ws_gap** | Loopback korunur |
| Eklenti SDK | `include/plugin/*` | C99 ABI + CRTP + Registry | **+ gerçek intel injector binding** | Dinamik yükleyici hâlâ yok |
| Kripto/ağ | `src/network/*.rs` | Güçlü | **Güçlü (değişmedi)** | 21 birim testi |

### 4.2 v2 Teknik Borç Kapanma Matrisi (T-1…T-8)

| # | v2 Riski | v3 Durumu | Açıklama |
|---|---|---|---|
| **T-1** | JSON parser sertleştirme eksik | ✅ Kapandı | Exception-free + derinlik 64 + katı `\u` + çift anahtar/çöp reddi |
| **T-2** | Senaryo imzası doğrulanmıyor | ✅ Kapandı | ed25519 canonical payload doğrulaması zorlanıyor |
| **T-3** | Causal taşma sınırları test edilmemiş | ✅ Kapandı | `fp_mul_div_u64_sat` (a*b yok) + doctest sınır vakaları |
| **T-4** | WS emitter tek-istemci + blocking | ✅ Kapandı | 8 istemci + sıralı tampon + `ws_gap` |
| **T-5** | Denetim günlüğü büyümesi + araç yok | ✅ Kapandı | Segment rotasyonu + `verify_audit_log.py` |
| **T-6** | Connector geri çağrısı stub | ✅ Kapandı | `ffi_inject_intel` gerçek + `dispatch_connectors` tick'te |
| **T-7** | Determinizmde `session_id` duvar saati | ◑ Kısmî | Hâlâ `time(nullptr)`; CDET `chain_head` buna bağlı (bkz. T-10) |
| **T-8** | `std::cout` log gürültüsü sıcak yolda | ✅ Kapandı | `causal_engine.h` hot path doğrudan G/Ç yapmıyor; olaylar kapalı varsayılanlı `caelus_logger.h` makrosuna bağlandı |

v2'nin sekiz borcundan **yedisi tam** kapandı; T-7 kısmî (nüans büyüdü).

---

## 5. Kalan Açıklar ve Yeni Riskler

### 5.1 Henüz Yapılmamış / Yarım Öneriler

- **R10 — Güvenlik sertleştirme kalanı.** Anahtar yönetimi/TPM/DPAPI tabanlı kimlik saklama, OTP slot gizliliği iyileştirmesi, denetim günlüğü erişim kontrolü hâlâ yok. `caelus_identity.key` düz dosyada.
- **İmza üreten araç (signer CLI) yok.** Doğrulama hattı tam, fakat **kanonik yükü imzalayacak bir araç bulunmuyor.** Operatörün gerçek bir senaryo paketini imzalaması için, C++ `canonical_signed_payload` mantığını birebir taklit eden bir imzalayıcı gerekir. Bu yüzden pratikte tüm paketler `SELF_SIGNED_DEV` + dev bypass ile yükleniyor — kurcalanamazlık kapısı **fiilen kullanım dışı** kalıyor.
- **Dinamik eklenti yükleyici yok.** ABI `caelus_plugin_entry` sözleşmesini tanımlıyor ama `LoadLibrary`/`dlopen` ile gerçek üçüncü-taraf `.dll/.so` yükleyici hâlâ yok; tüm eklentiler statik.
- **Gerçek dünya connector'ları yok.** `MqttConnector`/`ZapierWebhookConnector` hâlâ stub (`do_pull → 0`); yalnız `CsvReplayConnector` ve `NullConnector` aktif.

### 5.2 Yeni Teknik Borç ve Operasyonel Riskler

> v2 teknik borç dizisi T-8'e kadar kullanıldığı için yeni borçları **T-9'dan** itibaren numaralandırıyoruz.

| # | Risk | Konum | Önem | Açıklama |
|---|---|---|---|---|
| T-9 | **İmzalama aracı yok → dev bypass'a bağımlılık** | `scenario_pack.h`, süreç | Yüksek | Gerçek imzalı paket üretilemiyor; pratik kullanım `CAELUS_ALLOW_DEV_SCENARIOS=1`'e kayıyor, T-2'nin kazanımını operasyonel olarak nötrler. |
| T-10 | **CDET `audit_chain_head` duvar saatine bağlı** | `core_engine.cpp` (`audit_session_id = time(nullptr)`) + `audit_log.rs` (genesis `session_id`'yi hash'ler) | Yüksek | `--det-mode`'da bile `session_id` duvar saati; genesis hash ona bağlı; CDET bloğu `audit_chain_head`'i içerir. İki CI koşumu farklı saniyeye denk gelirse SHA-256 **farklı çıkar → determinizm testi flake olur.** |
| T-11 | **Canonical JSON imza formatı operasyonel kırılganlığı** | `canonical_json` (float `setprecision(17)`, anahtar sıralama) | Orta | İmzalayan araç ile C++ kanonikleştirme **bit-bit** aynı olmalı; ondalık biçim/sıralama farkı geçerli imzayı geçersiz kılar. Harici imzalayıcılar için yüksek hata yüzeyi. |
| T-12 | **Connector replay tamponu 256 olayla sınırlı** | `caelus_connector.h` (`kMaxReplayEvents=256`) | Orta | Uzun ufuklu / yoğun `intel_feed_sequence` veya büyük CSV/JSONL kayıtlarında 256 üstü olaylar **sessizce atlanır** (tek uyarı). Tam-ufuk yeniden oynatma kısıtlı. |
| T-13 | **WS 8-istemci sabit sınırı** | `ws_emitter.h` (`kMaxClients=8`) | Düşük | Derleme-zamanı sabiti; çok-operatör War Room senaryolarında dar kalabilir. 9. istemci reddedilir. |
| T-14 | **Python doğrulayıcı modül bağımlılığı** | `tools/verify_audit_log.py` | Düşük | `blake3` yoksa doğrulama hiç yapılamaz; air-gapped ortamda bu modüllerin çevrimdışı sağlanması gerekir. `--chain-only` yalnız imzayı atlar, Blake3'ü değil. |
| T-15 | **REPL ↔ determinizm/güvenlik etkileşimi** | `core_engine.cpp::RunScenarioRepl` | Düşük | REPL `std::cin`'den deterministik olmayan girdi alır; lever sonuçları `--det-mode` ile tekrarlanabilir ama operatör girişi/sırası değil. REPL olayları audit zincirine yazılır (iz iyi), fakat REPL içeren bir oturum CDET determinizm testine uygun değildir. |

---

## 6. Doğrulama / Test Durumu

### 6.1 Otomatik Testler

- **Rust birim testleri — 21 test** (`cargo test`):
  - `src/network/mesh_auth.rs` — 7 test (imzalı beacon, fingerprint↔anahtar bağı, anti-replay, kapasite sınırı).
  - `src/network/discovery.rs` — 8 test (sanal saat `VIRTUAL_CLOCK_ENABLED`, fingerprint-sıralı peer `sort_unstable_by_key`, intel kuyruğu).
  - `src/audit_log.rs` — 6 test (`chain_is_deterministic_for_same_events`, `different_events_give_different_hashes`, `seal_writes_and_marks_sealed`, `append_after_seal_is_rejected`, **`rotation_seals_segment_and_links_next_genesis`**, `ffi_roundtrip`).
- **C++ doctest — 9 vaka / 50 doğrulama** (`tests/test_causal_engine.cpp`, `tests/doctest.h`):
  - Sabit nokta normal + sınır (saturating) aritmetiği, `d_to_fp` non-finite kenetleme.
  - Boş şablon nötrlüğü (`raw==clamped==FP_ONE`), intel→sürtünme artışı.
  - Solver C ABI gidiş-dönüş (`SolverRequest::to_c` ↔ `SolverResult::from_c`).
  - JSON sertleştirme: malformed sayı (throw etmeden ret), derinlik sınırı, katı unicode/vekil.

### 6.2 `ci.bat` Akışı (4 Adım)

1. **Rust birim testleri** (`cargo test`).
2. **C++ unit tests** — `tests/test_causal_engine.cpp` derlenir (`build_tests\caelus_cpp_tests.exe`) ve koşulur.
3. **Binary boyut kontrolü** — `dist/caelus_os.exe < 50 MB` (yoksa `build.bat` ile derler).
4. **Determinizm doğrulama** — `--scenario UNIVERSAL_BASELINE --det-mode` iki kez koşulur, `CDET:` satırları `findstr` ile çıkarılır, `certutil` SHA-256 ile karşılaştırılır.

### 6.3 Smoke Testleri

| Smoke | Nasıl | Beklenen | Durum |
|---|---|---|---|
| **det-mode determinizm** | `ci.bat` Adım 4 | İki koşumun CDET SHA-256'sı eşleşir | ✅ Otomatik (T-10 flake riski) |
| **AWAITING_SCENARIO_INJECTION** | `--scenario UNIVERSAL_BASELINE --det-mode` | Boş şablon, `friction=1.000000x`, sıfır akış | ✅ Otomatik (CI bunu koşar) |
| **SIGNATURE_MISMATCH** | `--scenario BS-01_SAHTE_UFUK` (dev kapısı kapalı) | `[FATAL] SIGNATURE_MISMATCH` + blank slate'e düşüş | ◑ Manuel (CI'da yok; eklenmeli) |
| **BS-EXEC tam ufuk** | REPL + `CAELUS_ALLOW_DEV_SCENARIOS=1` (kılavuz) | Deadline/histerezis/REGIME_EXCEEDED gözlemleri | ◑ Manuel (golden testi yok) |

### 6.4 Derleme

`build.bat` üç aşamalı (UI gömme → Rust LTO+opt-z → C++ statik link + strip); `Cargo.toml` `opt-level="z"`, `lto=true`, `strip=true`, `panic="unwind"` (FFI `catch_unwind` için zorunlu). Hedef tek statik binary **< 50 MB**; boyut hem `build.bat` hem `ci.bat` Adım 3 ile denetlenir.

---

## 7. Sıradaki Yol Haritası

Öncelik: **P0** kritik/itibar · **P1** yüksek · **P2** orta. Efor: S/M/L.

| Kod | İş paketi | Öncelik | Efor | Kapattığı |
|---|---|---|---|---|
| SIGNER | **BLOKER:** `--print-scenario-payload` C++ canonical payload'u üretir; gerçek ed25519 imza için export edilmiş signing FFI gerekir | P0 | M | T-9, T-11, R10 |
| T-10 | **KAPANDI:** `--det-mode` audit `session_id=0`; CDET `audit_chain_head` duvar saatinden etkilenmez | P0 | S | T-10 |
| SIG-CI | **SIGNATURE_MISMATCH smoke testini `ci.bat`'a ekle** (dev kapısı kapalıyken BS paketi → blank slate beklentisi) | P1 | S | Güvenlik regresyonu |
| CONN-RT | **Gerçek dünya connector'ları** (`MqttConnector` LAN, `ZapierWebhookConnector` loopback 47810) tam implementasyon | P1 | M | R8 tamamlama |
| BS-EXEC | **BS-01/02/03 tam-ufuk golden testi** (deterministik REPL betiği + beklenen snapshot hash) | P1 | M | T-15, G-2 derinleştirme |
| T-12 | **Connector replay tamponunu büyüt/akıt** (256 → yapılandırılabilir veya streaming) | P2 | S | T-12 |
| LOADER | **Dinamik eklenti yükleyici** (`LoadLibrary`/`dlopen` + `caelus_plugin_entry`) | P2 | M | R4 tamamlama |
| KEYMGMT | **Anahtar yönetimi** (TPM/DPAPI ile `caelus_identity.key` koruması, pubkey whitelist) | P2 | M | R10 |
| T-8 | **KAPANDI:** `caelus_logger.h` ile kapalı varsayılanlı statik ring logger; `causal_engine.h` hot path `std::cout`/`std::cerr` kullanmıyor | P2 | S | T-8 |
| T-13 | **WS istemci sınırını yapılandırılabilir yap** | P2 | S | T-13 |

**Önerilen faz sıralaması:**
- **Faz E (imza operasyonelleştirme — P0):** SIGNER + T-10 + SIG-CI. Kurcalanamazlık kapısını "kodda var" durumundan "fiilen kullanılır" durumuna taşır; CI determinizm flake'ini kapatır. v3'ün en kritik açığı budur.
- **Faz F (gerçek veri — P1):** CONN-RT + BS-EXEC. Connector ekosistemini gerçek dünyaya bağlar, BS senaryolarını golden testle güvenceye alır.
- **Faz G (ekosistem + üretim — P2):** LOADER + KEYMGMT + T-12/T-13. Üçüncü-taraf eklenti, donanım anahtar koruması ve kalan kütüphane-kalitesi temizlik.

---

## 8. Ek: v1 → v2 → v3 İzlenebilirlik Matrisi

| Öneri / Borç | v1 | v2 | v3 | Kanıt dosyası |
|---|---|---|---|---|
| R1 Causal Engine v2 | öneri | ✅ | ✅ (+ taşma-doymalı, evrensel) | `causal_engine.h` |
| R2 Senaryo Paketi | öneri | ✅ (imza loglanıyor) | ✅ (imza zorlanıyor) | `scenario_pack.h`, `scenarios/*.json` |
| R3 UI canlı köprü | öneri | ✅ (tek-istemci) | ✅ (8 istemci + ws_gap) | `ws_emitter.h`, `ui/app.js` |
| R4 Eklenti SDK | öneri | ✅ (connector stub) | ◑ (intel injector canlı; dinamik yükleyici yok) | `include/plugin/*` |
| R5 Determinizm kemeri | öneri | ✅ | ✅ (+ C++ test adımı; T-10 flake riski) | `det_rng.h`, `discovery.rs`, `ci.bat` |
| R6 Denetim günlüğü | öneri | ✅ | ✅ (+ segment rotasyonu + Python doğrulayıcı) | `audit_log.rs`, `verify_audit_log.py` |
| R7 C++ test + CI | öneri | ◑ (CI var, C++ test yok) | ✅ (9 vaka/50 doğrulama + CI adımı) | `tests/*`, `ci.bat` |
| R8 Connector'lar | öneri | ✗ (stub) | ◑ (CsvReplay tam; MQTT/Zapier stub) | `caelus_connector.h` |
| R9 CLI REPL | öneri | ✗ | ✅ (REPL + BS-EXEC kılavuzu) | `core_engine.cpp`, `BS_EXEC_REPL_KILAVUZU.md` |
| R10 Güvenlik sertleştirme | öneri | ✗ | ◑ (imza doğrulama var; TPM/anahtar yönetimi/signer yok) | `scenario_verify.rs` |
| T-1 JSON sertleştirme | — | açık | ✅ | `scenario_pack.h` |
| T-2 İmza zorlama | — | açık | ✅ | `scenario_pack.h`, `scenario_verify.rs` |
| T-3 Taşma sınırları | — | açık | ✅ | `causal_engine.h`, `tests/*` |
| T-4 WS çok-istemci | — | açık | ✅ | `ws_emitter.h` |
| T-5 Audit rotasyonu | — | açık | ✅ | `audit_log.rs`, `verify_audit_log.py` |
| T-6 Connector callback | — | açık | ✅ | `caelus_plugin_registry.h` |
| T-7 session_id duvar saati | — | açık | ◑ (→ T-10) | `core_engine.cpp` |
| T-8 cout log gürültüsü | — | açık | ✅ | `causal_engine.h`, `caelus_logger.h` |
| T-9…T-15 (yeni) | — | — | açık | bkz. Bölüm 5.2 |

---

*Bu rapor, mevcut kaynak ağacındaki gerçek dosya ve sembollere dayanır. "✅ Kapandı" işaretli her madde için ilgili kanıt dosyası kod referansıyla verilmiştir; "◑/✗" işaretli maddeler kalan iş olarak Bölüm 5 ve 7'de izlenir.*
