# CAELUS OS — Demo Modundan Çıkış: Gerçek Dünya Bağlantı Raporu

**Sürüm:** 1.0 (Geçiş Raporu — durum raporu değil; envanter + tasarım + yol haritası)
**Kapsam:** Projeyi demo/dev modundan çıkarıp gerçek dünyaya — gerçek imzalı senaryolar, gerçek eklenti ekosistemi, gerçek saha veri kaynakları, gerçek operasyon — bağlamak için gereken her şeyin (1) kod-kanıtlı envanteri, (2) güven zinciri denetimi ve tasarımı, (3) önceliklendirilmiş yol haritası
**Dayanak:** Mevcut kaynak ağacı — `core_engine.cpp`, `include/scenario_pack.h`, `include/causal_engine.h`, `include/ws_emitter.h`, `include/audit_log.h`, `include/det_rng.h`, `include/plugin/*`, `src/lib.rs`, `src/scenario_verify.rs`, `src/audit_log.rs`, `src/network/{mesh_auth.rs,discovery.rs}`, `src/bin/caelus_sign_scenario.rs`, `src/intel_core.{h,cpp}`, `scenarios/BS-0{1,2,3}*.json`, `tests/*`, `tools/verify_audit_log.py`, `ci.bat`, `build.bat`, `CMakeLists.txt`, `ui/app.js`
**Tarih:** 2026-06-10 (öğle dalgası; T-22 BUILD-MATRIX ve T-23 KEYMGMT-WIRE ajanları çalışırken yazıldı — bkz. §9.2)
**İlişkili raporlar:** `docs/GELISTIRME_RAPORU_v4.md` (boşluk denetimi) · `docs/GELISTIRME_RAPORU_v5.md` (sertleştirme dalgası teyidi)

> Bu rapor v5'in üzerine kuruludur ve onun envanterini TEKRARLAMAZ; v5 "ne yapıldı"yı belgeler, bu rapor "gerçek dünyaya bağlanmak için ne eksik"i belgeler. v4/v5 disiplini korunmuştur: **her iddia dosya/satır kanıtlıdır; "okunarak teyit" ile "çalıştırılarak teyit" ayrımı §9'da açıkça verilmiştir.** Bugün inen dalga (T-16 derleme onarımı + 23/23 test, T-9/T-17 signer CLI+FFI, T-19 DPAPI KEYMGMT, T-18 plugin imza gate'i, T-17 LOADER-WIRE `--plugin` CLI, T-20 outage latching, T-21 connector smoke) bu raporun zemini kabul edilmiştir.

---

## 1. Yönetici Özeti

**Motor teknik olarak hazır; üretime bağlanmasını engelleyen şey kod eksikliği değil, GÜVEN ZİNCİRİ ve OPERASYON kablolamasıdır.**

Bugün itibarıyla CAELUS OS derleniyor (Rust 23/23 test), imza atabiliyor (`caelus_sign_scenario` CLI + `caelus_sign_scenario_payload` FFI, C++ kanonik payload ile bit-bit uyumlu), imza doğruluyor (ed25519, fail-closed), dinamik eklenti yüklüyor (`--plugin` CLI; imza gate'li; exit 4 fail-closed; audit'e deterministik `PLUGIN_LOADED`), cihaz kimliğini Windows'ta DPAPI ile koruyor, outage'ı latch'liyor ve connector hattını ağ-aktif smoke testiyle kanıtlıyor. Yani **mekanizmaların hepsi var**.

Eksik olan üç şey mekanizma değil, **politika ve kablolama**:

1. **Güven çapası yok (P0).** Motor, senaryo imzasındaki **gömülü pubkey'e** güveniyor: imza string'inin içinden pubkey'i çıkarıp yalnız matematiksel doğrulama yapıyor; "bu pubkey'e güveniyor muyum?" sorusunu HİÇ sormuyor (§3.1, kanıt satırlarıyla). Bugünkü e2e zaten kanıtladı: rastgele üretilmiş geçici bir anahtarla imzalanan senaryo, dev bypass OLMADAN kabul edildi. Gerçek dünyada bu, "signer CLI'yi eline geçiren herkes motorun kabul edeceği senaryo basabilir" demektir. Aynı desen audit mühründe de var (§3.3); plugin gate'inde ise üretim verifier'ı hiç yok (§3.2).
2. **İçerikler hâlâ demo damgalı (P0/P1).** Üç BS senaryosu da `SELF_SIGNED_DEV`; golden test beklentileri latch-öncesi motoru kilitliyor (latch'li rebuild sonrası golden runner FAIL verir); `dist/caelus_os.exe` latch-öncesi ara derleme olduğu için YETKİLİ DEĞİL.
3. **Saha veri düzlemi kimliksiz (P1).** Mesh kontrol düzlemi ed25519-imzalı beacon + anti-replay ile korunurken (`src/network/discovery.rs`), intel veri düzlemi (MQTT/Zapier payload'ları) hiçbir kimlik/imza taşımıyor: broker'a ulaşan herkes motorun nedensel grafına veri enjekte edebilir (§5).

Bu rapor; §2'de tüm demo kapılarını dosya/satır kanıtıyla envanterler, §3'te güven zinciri tasarımını (anahtar töreni + pinli güven çapası + `CAELUS_PRODUCTION` derleme-dışı bırakma) verir, §4–§7'de eklenti/saha/kimlik/operasyon bağlantı yüzeylerini "demo'da ne / üretimde ne olmalı" tablolarıyla tasarlar, §8'de net kabul kriterli P0/P1/P2 yol haritasını çıkarır.

---

## 2. Demo-Modu Envanteri (Tam Liste, Dosya/Satır Kanıtlı)

Aşağıdaki tablo `rg "getenv|env::var|ALLOW|DEV|BYPASS|stub|TODO"` taraması + ilgili dosyaların okunmasıyla çıkarılmıştır. "Üretim kararı" sütunu §8'deki yol haritasına bağlanır.

| # | Demo kapısı / koltuk değneği | Konum (kanıt) | Varsayılan | Gerçek-dünya riski | Üretim kararı |
|---|---|---|---|---|---|
| E-1 | `CAELUS_ALLOW_DEV_SCENARIOS` + `SELF_SIGNED_DEV` senaryo bypass'ı | `include/scenario_pack.h:880-888` | Kapalı (ret) | Açıkken imza zinciri tamamen devre dışı | Üretim build'inde **derleme-dışı** (§3.5) |
| E-2 | Üç BS paketi hâlâ `SELF_SIGNED_DEV` | `scenarios/BS-01_SAHTE_UFUK.json:7`, `BS-02_GOLGE_ARSIV.json:7`, `BS-03_KUM_SAATI.json:7` | — | Referans senaryolar dev kapısı olmadan YÜKLENEMEZ; tatbikat = demo demek | SIGNED-GOLDEN: CLI ile gerçek imza + `--write` (§3.4) |
| E-3 | **Gömülü-anahtara-güven (pinli çapa yok)** | `include/scenario_pack.h:896-907` + `src/scenario_verify.rs:43-53` | — (her zaman aktif) | **CLI'si olan herkes kabul edilen senaryo basar** — bugünkü e2e ile fiilen kanıtlı | P0: pinli güven çapası (§3.4) |
| E-4 | `CAELUS_PLUGIN_ALLOW_UNVERIFIED=1` plugin bypass'ı | `include/plugin/caelus_plugin_registry.h:678-681` (yalnız `"1"` kabul) | Kapalı | Açıkken imzasız `.dll/.so` motora yüklenir (kod yürütme) | Üretim build'inde **derleme-dışı** (§3.5) |
| E-5 | **Üretim plugin verifier'ı YOK** | `core_engine.cpp:751-754` (`set_signature_verifier` bilerek çağrılmıyor) | Verifier=nullptr | Verifier yokken tek savunma env bypass'ın kapalı olması; `--plugin` ile imzasız eklenti istenirse reddedilir ama imzalı eklenti de doğrulanamaz | P1: ed25519 modül verifier backend'i (§4) |
| E-6 | `CAELUS_IDENTITY_KEY_HEX` (POSIX) + `CAELUS_TPM_KEY_HANDLE` stub | `src/network/mesh_auth.rs:392-404` | Yok → hata | Env'e konursa kimlik tohumu ortam değişkeninde düz; TPM yolu stub | POSIX TPM/HSM backend (§6); env yalnız dev/CI |
| E-7 | `CAELUS_ENCLAVE_KEY` yoksa **ephemeral CSPRNG** anahtar | `src/intel_core.cpp:275-283` ("UNCONFIGURED" damgası) | Ephemeral | At-rest profil blob'ları yeniden başlatmada çözülemez; "yapılandırılmamış enklav" | Enklav anahtarını KEYMGMT'e bağla (§6) |
| E-8 | `--det-mode` sabit seed + sabit enklav anahtarı enjekte eder | `core_engine.cpp:712-722` (`0xCAE105DEADBEEF00`, `cae1...cae1`) | Yalnız `--det-mode` ile | Üretimde ASLA set edilmemeli; CI test vektörü | CI'ya hapset; üretimde flag yok |
| E-9 | env-gated connector'lar kapalı-varsayılan | `core_engine.cpp:823-835` (`CAELUS_ENABLE_MQTT_CONNECTOR` / `CAELUS_ENABLE_ZAPIER_CONNECTOR`) | Kapalı | Açıkken kimliksiz intel kabul eder (§5) | Topic sözleşmesi + payload imzası (§5) |
| E-10 | Golden/CI'da bayat (latch-öncesi) değerler | `tests/golden/bs0{1,2,3}_expected.json`, `tests/run_bs_exec_golden.py:33-45` (`EXPECTED_HYSTERESIS_OUTAGE` hep `False`, sabit `EXPECTED_SNAPSHOT_HASHES`) | — | Latch'li rebuild sonrası golden runner FAIL → CI kırmızı / yanlış geçer | GOLDEN-REFRESH (T-25, §7) |
| E-11 | `dist/caelus_os.exe` latch-öncesi ara derleme | `dist/caelus_os.exe` (10.06 10:33; T-19/T-20 öncesi) | — | Yetkili değil; golden + SIG-CI bu binary'e güvenemez | Yeniden derle (bu run'da YASAK; §9.2) |
| E-12 | UI'nin `AWAITING_SCENARIO_INJECTION` boş-taban durumu | `core_engine.cpp:856-862`, `ui/app.js:1344-1357` | İmzalı senaryo yoksa | Demo'da "veri yok" doğru davranış; gerçek dünyada operatöre "neden boş" telemetrisi gerekir | Boş-taban nedenini audit + UI'de ayrıştır (§7) |
| E-13 | War Room WS telemetrisi kimlik doğrulamasız (loopback) | `include/ws_emitter.h:4-5, 308-312` (yalnız `127.0.0.1`) | Loopback-only | Loopback'te düşük risk; uzak görüntüleme istenirse auth yok | Uzak erişim isteniyorsa TLS+token (§7, opsiyonel) |
| E-14 | TODO/atıl notlar | `include/plugin/caelus_plugin_registry.h:183-188` ("ABI-level hook only: not wired yet") | — | KEYMGMT kancası kimlik yoluna T-23'e dek bağlı değildi | T-23 KEYMGMT-WIRE akışta (§9.2) |

**Tarama notu:** Yukarıdaki liste, üretime geçişi etkileyen tüm `getenv`/`env::var`/dev-flag noktalarını kapsar. Geri kalan env değişkenleri **operasyonel ayar** niteliğindedir, demo koltuk değneği değildir ve üretimde meşrudur: `CAELUS_CONNECTOR_MAX_EVENTS` (`caelus_connector.h:283`), `CAELUS_MQTT_*`/`CAELUS_ZAPIER_WEBHOOK_PORT` (`caelus_connector.h:840-843,1089`), `CAELUS_WS_MAX_CLIENTS`/`CAELUS_WS_BUFFER_EVENTS` (`ws_emitter.h:585-591`), `CAELUS_AUDIT_MAX_BYTES`/`CAELUS_AUDIT_FLUSH_EVERY` (`src/audit_log.rs:43-44`).

---

## 3. Güven Zinciri Tasarımı (P0)

### 3.1 GÜVEN MODELİ DENETİMİ — Net Bulgu: **GÖMÜLÜ-ANAHTARA-GÜVEN (pinli çapa YOK)**

Bu, raporun en kritik bulgusudur. Senaryo imza doğrulama yolu `include/scenario_pack.h` içinde `verify_signature_gate` → `parse_ed25519_signature_format` → `caelus_verify_scenario_signature` (Rust FFI) zinciriyle işler. Kod **okunarak** şu kesin sonuca varıldı: motor, imza string'inin **kendi içine gömülü pubkey'e** güvenir; pinli bir güven çapası, allowlist veya beklenen-imzalayan kontrolü **yoktur**.

İmza formatı `ed25519:<pubkey-hex>:<signature-hex>` olarak ayrıştırılıyor — **pubkey imzanın PARÇASI**:

```857:872:include/scenario_pack.h
    static bool parse_ed25519_signature_format(
        const std::string& sig, uint8_t pubkey[32], uint8_t signature[64]) {
        static const std::string prefix = "ed25519:";
        if (sig.compare(0, prefix.size(), prefix) != 0) return false;

        size_t pub_start = prefix.size();
        size_t sep = sig.find(':', pub_start);
        if (sep == std::string::npos) return false;
        std::string pubkey_hex = sig.substr(pub_start, sep - pub_start);
        std::string sig_hex = sig.substr(sep + 1);

        // ed25519 public key = 32 bytes, signature = 64 bytes.
        if (!is_hex_string(pubkey_hex, 64) || !is_hex_string(sig_hex, 128)) return false;
        return hex_to_bytes(pubkey_hex, pubkey, 32) &&
               hex_to_bytes(sig_hex, signature, 64);
    }
```

Doğrulama, **payload'dan çıkarılan** bu pubkey ile yapılır; başka hiçbir kontrol yok:

```896:916:include/scenario_pack.h
        uint8_t pubkey[32] = {};
        uint8_t signature[64] = {};
        if (!parse_ed25519_signature_format(sig, pubkey, signature)) {
            std::cerr << "[FATAL] SIGNATURE_MISMATCH: imza formatı geçersiz. "
                      << "Beklenen: ed25519:<hex-pubkey-32B>:<hex-signature-64B>\n";
            return false;
        }

        const std::string payload = canonical_signed_payload(root);
        const uint8_t ok = caelus_verify_scenario_signature(
            reinterpret_cast<const uint8_t*>(payload.data()), payload.size(),
            pubkey, signature);
        if (ok != 1u) {
            std::cerr << "[FATAL] SIGNATURE_MISMATCH: ed25519 doğrulaması başarısız.\n";
            return false;
        }

        std::cout << "[SCENARIO] ed25519 imza doğrulandı "
                  << "(payload=CAELUS_SCENARIO_PACK_V1 canonical critical fields).\n";
        return true;
```

Rust FFI tarafı yalnızca matematiği yapar — anahtarın güvenilirliğine dair hiçbir kavramı yoktur (`from_bytes(pubkey_arr)` ile verilen anahtarı doğrudan kullanır):

```43:53:src/scenario_verify.rs
        let verifying_key = match VerifyingKey::from_bytes(pubkey_arr) {
            Ok(v) => v,
            Err(_) => return 0u8,
        };
        let signature = Signature::from_bytes(sig_arr);

        if verifying_key.verify(msg, &signature).is_ok() {
            1u8
        } else {
            0u8
        }
```

**Sonuç — kanıtlı:** Doğrulama yalnızca "bu pubkey, bu payload'ı gerçekten imzaladı mı?" sorusunu yanıtlar. "Bu pubkey'e GÜVENİYOR muyum?" sorusu hiçbir yerde sorulmaz. Bu yüzden **rastgele üretilmiş herhangi bir ed25519 anahtarı, kendi pubkey'ini imzaya gömerek geçerli bir senaryo üretebilir.** Bugünkü e2e bunu pratikte gösterdi: `caelus_sign_scenario --generate-key` ile üretilen taze anahtarla imzalanan senaryo, `CAELUS_ALLOW_DEV_SCENARIOS` set EDİLMEDEN kabul edildi (v5 §2.2/§6.1). Demo için yeterli; **gerçek dünyada P0 bir açıktır.**

### 3.2 Aynı Denetim — Plugin Gate'i

`DynamicPluginLoader::verify_plugin_signature` (`caelus_plugin_registry.h:582-601`) üç durumu ayırır: (a) bir verifier kayıtlıysa onu çağırır; (b) yoksa ve `CAELUS_PLUGIN_ALLOW_UNVERIFIED=1` ise dev bypass; (c) ikisi de yoksa **reddeder** (strict-fail). Mimari doğru — **kanca (`set_signature_verifier`) var, fail-closed davranış var** — ama **üretim verifier backend'i hiç yazılmamış** ve motor bilerek hiçbir verifier kaydetmiyor:

```751:754:core_engine.cpp
    //   Burada bilerek hicbir imza verifier'i KAYDEDILMEZ ve dev-bypass ZORLANMAZ.
    //   DynamicPluginLoader'in mevcut strict-fail davranisi aynen gecerlidir:
    //   verifier yoksa ve CAELUS_PLUGIN_ALLOW_UNVERIFIED=1 set degilse imzasiz
    //   eklenti REDDEDILIR ([PLUGIN-SIG] SIGNATURE_REQUIRED / UNVERIFIED_PLUGIN_REJECTED).
```

Yani plugin tarafında anahtar **hiç gelmiyor** (ne gömülü ne pinli); savunma tamamen "env bypass kapalı" olmasına dayanıyor. Üretimde imzalı eklenti yüklemek için ed25519 modül-imza verifier'ı + pinli anahtar gerekir (§4).

### 3.3 Aynı Denetim — Audit Log Mührü (ed25519 seal)

Audit mührü `src/audit_log.rs:370-422` içinde `self.identity.sign(msg)` ile atılır ve **mühürleyen cihazın kendi** pubkey'i + fingerprint'i satıra yazılır:

```380:384:src/audit_log.rs
        // ed25519 deterministik imza (RFC 8032 §5.1 — rastgele nonce YOK)
        let signature = self.identity.sign(&msg);
        let sig_bytes = signature.to_bytes();
        let pubkey_bytes = *self.identity.verifying_key.as_bytes();
        let fp_bytes = self.identity.fingerprint;
```

Doğrulayıcı `tools/verify_audit_log.py:255` de pubkey'i **satırdan** alır (`obj.get("pubkey")`) ve yalnız matematiği doğrular. Yani audit "kendi kendini doğrulayan" bir mühür: zincirin bütünlüğünü kanıtlar (tek bit değişse kırılır), ama **"bu cihaza ait mi?"** sorusunu doğrulayıcıya bırakır. Burada anahtar = cihaz kimliği (`mesh_auth.rs` DeviceIdentity, Windows'ta DPAPI korumalı). Gerçek dünyada eksik olan: doğrulama prosedürünün, mühürdeki `fingerprint`'i **kayıtlı filo cihaz listesine (slot manifesti)** karşı pinlemesi (§6/§7).

**Üç yüzeyin ortak kök problemi:** Kriptografi sağlam, **anahtar dağıtımı/pinleme politikası yok.** Çözüm üç yerde de aynı desendir: *beklenen pubkey'i derleme-içi sabit veya imzalı manifest olarak pinle.*

### 3.4 P0 Tasarım: Anahtar Töreni + Pinli Güven Çapası + SIGNED-GOLDEN

**(a) Anahtar töreni (key ceremony).** Üretim imza anahtarı (senaryo yayıncısı kök anahtarı) hava-boşluklu bir makinede üretilir; özel anahtar Windows'ta DPAPI (mevcut `dpapi_protect_seed`, `mesh_auth.rs:560`) veya tercihen donanım (TPM/HSM, §6) ile korunur, asla düz diske yazılmaz. Pubkey **dağıtılacak güven çapasıdır**.

**(b) Pinli güven çapası — iki seçenek (ikisi birden önerilir):**
- **Derleme-içi sabit allowlist:** Motorun içine gömülü `TRUSTED_SCENARIO_PUBKEYS[]` (1..N adet 32-byte ed25519 pubkey). `verify_signature_gate`, payload'dan çıkardığı pubkey'in bu listede olup olmadığını ED25519 doğrulamasından **önce** kontrol eder; listede yoksa `UNTRUSTED_SIGNER_REJECTED` ile reddeder. Bu, §3.1'deki açığı doğrudan kapatır.
- **İmzalı manifest (rotasyon için):** Kök anahtarın imzaladığı bir `trusted_keys.manifest` (ed25519). Motor, derleme-içi **kök** anahtarla manifesti doğrular, sonra manifestteki alt-anahtarları kabul eder. Anahtar rotasyonunu yeniden derlemeden mümkün kılar.

**(c) SIGNED-GOLDEN.** Üç BS senaryosu (`SELF_SIGNED_DEV`) üretim/test anahtarıyla gerçekten imzalanır:

```bash
caelus_sign_scenario --json scenarios/BS-01_SAHTE_UFUK.json --key caelus_signing.key --write
# çıktı: ed25519:<64hex-pub>:<128hex-sig>  → JSON'un "signature" alanına yazılır
```

İmzalayan pubkey güven çapasına eklenir; böylece BS-01/02/03 dev bypass OLMADAN yüklenir ve tatbikatlar "demo modu" olmaktan çıkar (§7 playbook'ları).

### 3.5 P0 Tasarım: Dev Kapılarının Üretim Build'inde Derleme-Dışı Bırakılması

E-1/E-4/E-8 bayrakları runtime env ile açılıyor; üretimde bunların **ikili içinde bile bulunmaması** gerekir. Öneri: `CAELUS_PRODUCTION` derleme makrosu (CMake `option(CAELUS_PRODUCTION ...)` + `target_compile_definitions`).

```cpp
// scenario_pack.h::verify_signature_gate içinde:
if (sig == "SELF_SIGNED_DEV") {
#ifdef CAELUS_PRODUCTION
    std::cerr << "[FATAL] SELF_SIGNED_DEV üretim derlemesinde tamamen devre dışı.\n";
    return false;                       // env bakılmaz; kod yolu derlenmez
#else
    if (env_flag_enabled("CAELUS_ALLOW_DEV_SCENARIOS")) { ... }
#endif
}
```

Aynı `#ifdef` `allow_unverified_plugins_for_dev()` (plugin bypass) ve `--det-mode` seed enjeksiyonu için uygulanır. Böylece üretim binary'sinde dev bypass'lar **fiziksel olarak yoktur**; yanlış-yapılandırma riski sıfırlanır. Mevcut kod tabanında halihazırda `CAELUS_EMBEDDED_UI` (`core_engine.cpp:702`) ve `CAELUS_WITH_ORTOOLS` (`caelus_solver.h:43`) ile aynı desen kullanılıyor — yeni bir mekanizma gerektirmez.

---

## 4. Eklenti Ekosistemi (P1)

**Mimari hazır, backend yok.** `set_signature_verifier` kancası, fail-closed loader, ABI sürümleme (1.1, `caelus_plugin_abi.h:37-57`), `--plugin` CLI ve `PLUGIN_LOADED` audit kaydı mevcut. Eksik olan tek şey **gerçek bir doğrulayıcı backend ve modülleri imzalayacak araç**.

| Yüzey | Demo'da ne | Üretimde ne olmalı |
|---|---|---|
| Plugin imza doğrulama | Verifier yok; yalnız strict-fail + env bypass | `set_signature_verifier`'a ed25519 modül-imza verifier backend'i; pubkey §3.4 çapasından pinli |
| Modül imzalama aracı | Yok | Signer CLI'ye `--sign-plugin <module.dll>` modu: modül baytlarının ed25519 imzası → yan dosya `module.dll.sig` veya gömülü bölüm |
| Plugin keşif/yükleme | `--plugin <path>` tekrarlanabilir, deterministik sıra (`core_engine.cpp:665-673,764-779`) | Aynen korunur; ek olarak imza yan-dosyası zorunlu |
| Dağıtım/kurulum | Yok | İmzalı modül + `.sig` + manifest; kurulum dizini allowlist; audit'e `PLUGIN_LOADED` (zaten var, `core_engine.cpp:963-968`) |

**Üretim verifier tasarımı (özet):** `verify_plugin_signature(path)` → modülün yanındaki `<path>.sig` okunur → modül baytları + imza + **pinli pubkey** `caelus_verify_*` benzeri FFI ile doğrulanır → başarısızsa `UNVERIFIED_PLUGIN_REJECTED` (mevcut log koduyla). Bu, senaryo doğrulamasıyla **aynı güven çapasını** paylaşır; tek anahtar töreni iki yüzeyi de besler.

---

## 5. Saha Veri Bağlantısı (P1)

Connector mimarisi gerçek: MQTT 3.1.1 QoS0 LAN/loopback istemcisi (`caelus_connector.h:826-1074`) ve loopback-only Zapier webhook alıcısı (`caelus_connector.h:1076-1276`). Smoke testi (`tests/connector_smoke.py`) hattın `network → pull_intel → registry inject_intel → CausalEngine graf düğümü`ne kadar çalıştığını **kanıtladı** (Actor_Alpha=0.82, Regulatory_Gate=0.2, friction 1.0x→deterministik artış). Ancak veri düzleminin iki temel açığı var.

| Yüzey | Demo'da ne | Üretimde ne olmalı |
|---|---|---|
| MQTT broker topolojisi | `127.0.0.1:1883` varsayılan; env ile host/port/topic (`caelus_connector.h:840-843`) | Air-gapped LAN içinde adanmış broker; TLS+ACL; sabit `caelus/intel` topic sözleşmesi |
| **Payload kimliği/imzası** | **Yok** — broker'a ulaşan herkes intel enjekte eder | Payload imzası (ed25519) + kaynak slot pinleme; `source_slot_id` kontrol düzlemi kimliğine bağlanmalı |
| Payload şeması | JSON `{friction_coefficient, crisis_level, memo}` veya CSV (`parse_intel_payload`, `caelus_connector.h:638`) | Aynı şema **üretim sözleşmesine terfi**: connector_smoke'taki kanıtlanmış JSON/CSV referans alınır, sürümlenir |
| Webhook alıcısı | Loopback `127.0.0.1:47810`, auth yok (`caelus_connector.h:1089,1108`) | Yalnız yerel köprü aracı; uzak kaynak isteniyorsa önüne kimlik doğrulamalı relay |
| Hız/kalite limitleri | Replay tavanı `CAELUS_CONNECTOR_MAX_EVENTS` (`caelus_connector.h:283`), ring 128 (`kRingCapacity`), payload ≤1024B (`kMaxPayloadBytes`) | Bu sınırları T-12/T-13 dinamik limit politikasına bağla; coeff [0,1] / crisis clamp zaten var (`clamp_coeff/clamp_crisis`) |

**Topic sözleşmesi (öneri):** `caelus/intel/<sector>/<slot_id>` — broker ACL'i her slot'u yalnız kendi alt-topic'ine yazmaya kısıtlar; motor `source_slot_id`'yi topic'ten doğrular. Bu, "kimliksiz enjeksiyon" açığını veri düzleminde kapatır ve kontrol düzlemindeki slot manifestiyle (§6) hizalar.

---

## 6. Kimlik ve Filo (P1/P2)

Kontrol düzlemi olgun: `src/network/discovery.rs` link-local UDP multicast (`224.0.0.251:47808`) üzerinde ed25519-imzalı beacon, `fingerprint == Blake3(verifying_key)` zorlaması ve monotonik sayaç + zaman damgalı **anti-replay** taşır (`discovery.rs:9-13,192,293-296`). Cihaz kimliği Windows'ta DPAPI korumalı (`mesh_auth.rs`, magic `CAELUSKEY1\0WIN-DPAPI\0`).

| Yüzey | Demo'da ne | Üretimde ne olmalı |
|---|---|---|
| Cihaz kaydı (enrollment) | Slot `0x202606070099` core_engine'de sabit (`core_engine.cpp:972`) | Cihaz başına benzersiz slot; kayıt töreni → slot manifestine ekleme |
| Slot manifesti | Örtük; tek sabit slot | İmzalı `slot_manifest` (kök anahtarla); beacon doğrulamada pinlenir |
| KEYMGMT delege → C++ registry | T-23 ile Rust seam var (`mesh_auth.rs:294-345`, `caelus_keymgmt_register`); C++ registry kancası (`caelus_plugin_registry.h:189-213`) henüz `caelus_keymgmt_register` çağırmıyor | C++ KEYMGMT eklentisi yüklendiğinde registry → `caelus_keymgmt_register` → identity persist DELEGE; **T-23 akışta (§9.2)** |
| TPM yolu | POSIX'te `CAELUS_TPM_KEY_HANDLE` stub (`mesh_auth.rs:396-400`) | Gerçek TPM/HSM backend (POSIX) veya KEYMGMT eklentisiyle delege |
| Enklav anahtarı | `CAELUS_ENCLAVE_KEY` yoksa ephemeral (`intel_core.cpp:281`) | KEYMGMT'ten türet; at-rest profil blob'ları kalıcı çözülür |

**Not (T-23):** `mesh_auth.rs` içinde delege seam tam — `KeymgmtDelegate`, `caelus_keymgmt_register` FFI, `load_or_generate_with_delegate`/`persist` delege yolu, round-trip testi (`keymgmt_delegate_round_trip`). Kalan iş C++ registry'nin bu FFI'yi KEYMGMT eklentisi kaydında çağırmasıdır. Bu dosya **şu an T-23 ajanınca düzenleniyor** (§9.2), durum run sonunda yeniden okunarak işaretlendi.

---

## 7. Operasyon (P2)

| Yüzey | Demo'da ne | Üretimde ne olmalı |
|---|---|---|
| Dağıtım paketi | Tek `dist/caelus_os.exe` (~5 MB); `<50MB` guard CMake/build.bat'te | Statik binary + toolchain matrisi (MSVC+MinGW) fiili koşum; `<50MB` korunur |
| CI tam zinciri | `ci.bat` 6 adım: Rust test, C++ test, connector smoke, <50MB, det×2 SHA-256, SIG-CI | + SIGNED-GOLDEN (gerçek imza, dev bypass'sız) + GOLDEN-REFRESH sonrası golden runner + her iki toolchain |
| Golden süiti | Latch-öncesi değerleri kodluyor (E-10) | GOLDEN-REFRESH: latch'li motorda snapshot/hash + `EXPECTED_HYSTERESIS_OUTAGE` yeniden üret |
| Audit saklama/doğrulama | `tools/verify_audit_log.py` (zincir + SEAL ed25519, blake3 gerekli) | Periyodik offline doğrulama; mührün `fingerprint`'i slot manifestine pinlenir (§3.3) |
| BS senaryoları | Demo profilleri (SELF_SIGNED_DEV) | İmzalı tatbikat playbook'ları (BS-01/02/03 → operatör senaryoları) |
| UI boş-taban | `AWAITING_SCENARIO_INJECTION` (E-12) | "Neden boş" gerekçesi audit + UI'de; imzalı senaryo gelince otomatik geçiş |

**Golden borcu detayı (E-10):** `--dry-run` ile **çalıştırılarak** teyit edildi: runner BS-01 için `tick 574`, BS-02 için `tick 142`+`tick 96`, BS-03 için `tick 22`+`tick 192` komutlarını üretir ve sabit hash `43c0…1978` (BS-01) bekler. `run_bs_exec_golden.py:31-45` tüm histerezis flip'leri için `outage_active=False` kodluyor; oysa latch'li motorda non-reversible flip'ler (`bs01_expected.json:96-115` `reversible:false`) outage'ı **latch eder**. Latch'li binary ile koşulduğunda runner **FAIL** verecek — bu beklenen bir borçtur, motor hatası değildir.

---

## 8. Önceliklendirilmiş Yol Haritası

Öncelik: **P0** üretime-engel/itibar · **P1** yüksek · **P2** orta. Efor: S/M/L.

| Kod | İş paketi | Öncelik | Efor | Net kabul kriteri ("üretime hazır" tanımı) |
|---|---|---|---|---|
| **TRUST-ANCHOR** | Pinli güven çapası (derleme-içi `TRUSTED_SCENARIO_PUBKEYS` + opsiyonel imzalı manifest); `verify_signature_gate` ED25519'dan önce pin kontrolü | **P0** | M | Pinli-olmayan anahtarla imzalı senaryo `UNTRUSTED_SIGNER_REJECTED` ile reddedilir; pinli anahtarla imzalı kabul edilir — **test: taze anahtar e2e artık BAŞARISIZ olmalı** |
| **SIGNED-GOLDEN** | BS-01/02/03'ü gerçek anahtarla imzala (`--write`), pubkey'i çapaya ekle | **P0** | S | Üç senaryo `CAELUS_ALLOW_DEV_SCENARIOS` OLMADAN yüklenir; SIG-CI dev bypass'sız geçer |
| **PROD-BUILD-GATES** | `CAELUS_PRODUCTION` makrosu; SELF_SIGNED_DEV + plugin bypass + det-seed kod yollarını `#ifdef` ile derleme-dışı bırak | **P0** | S–M | Üretim binary'sinde dev bypass env'leri etkisiz; sembol/dize taramasında dev kod yolu yok |
| **PLUGIN-VERIFIER** | `set_signature_verifier`'a ed25519 modül verifier backend'i + signer'a `--sign-plugin` | **P1** | M | İmzalı eklenti yüklenir, imzasız/yanlış-imzalı `UNVERIFIED_PLUGIN_REJECTED`; pinli pubkey çapadan |
| **FIELD-IDENTITY** | MQTT payload imzası + topic sözleşmesi (`caelus/intel/<sector>/<slot>`) + broker ACL; `source_slot_id` pinleme | **P1** | M–L | İmzasız/yanlış-slot payload reddedilir; smoke testi imzalı payload'la güncellenir |
| **KEYMGMT-WIRE** | C++ registry → `caelus_keymgmt_register` delege bağlama (T-23 kalanı) | **P1** | S | KEYMGMT eklentisi yüklü iken identity persist/load delege üzerinden; round-trip e2e |
| **GOLDEN-REFRESH** | Latch'li motora göre golden snapshot/hash + `EXPECTED_HYSTERESIS_OUTAGE` yenile (T-25) | **P1** | S–M | Yeniden derlenmiş binary ile `run_bs_exec_golden.py` PASS |
| **BUILD-MATRIX-CI** | MSVC+MinGW fiili CI koşumu (<50MB + det + SIG-CI + smoke + signed golden) | **P2** | M | İki toolchain'de de tüm CI yeşil; binary <50MB |
| **FLEET-ENROLL** | İmzalı slot manifesti + cihaz başına slot + audit fingerprint pinleme | **P2** | M–L | Yeni cihaz kayıt töreniyle eklenir; beacon/audit manifeste karşı doğrulanır |
| **TPM-BACKEND** | POSIX TPM/HSM backend (veya KEYMGMT eklentisi) + enklav anahtarı bağlama | **P2** | L | POSIX'te düz-metin/env'siz kimlik; at-rest profil blob'ları kalıcı çözülür |

**Önerilen faz sıralaması:**
- **Faz A (güven — P0):** TRUST-ANCHOR + SIGNED-GOLDEN + PROD-BUILD-GATES. Bu üçü tamamlanmadan motor "gerçek dünya" iddiası taşıyamaz; §1'deki kök problemi kapatır.
- **Faz B (yüzey kimlikleri — P1):** PLUGIN-VERIFIER + FIELD-IDENTITY + KEYMGMT-WIRE + GOLDEN-REFRESH.
- **Faz C (operasyon ölçek — P2):** BUILD-MATRIX-CI + FLEET-ENROLL + TPM-BACKEND.

---

## 9. Kapanış: Hangi İddialar Nasıl Teyit Edildi

### 9.1 Doğrulama Tablosu

| İddia | Yöntem | Sonuç |
|---|---|---|
| Senaryo güven modeli = gömülü-anahtara-güven (pinli çapa yok) | `scenario_pack.h:857-916` + `scenario_verify.rs:43-53` **okundu** | ✅ Pubkey imzadan çıkarılıyor; allowlist/pin yok |
| Plugin gate strict-fail ama üretim verifier yok | `caelus_plugin_registry.h:582-601,678-681` + `core_engine.cpp:751-754` **okundu** | ✅ Kanca var, backend yok, motor verifier kaydetmiyor |
| Audit mührü kendi-kimliğine imzalı, doğrulayıcı pubkey'i satırdan alır | `audit_log.rs:370-422` + `verify_audit_log.py:247-263` **okundu** | ✅ Fingerprint pinleme doğrulayıcıya bırakılmış |
| Üç BS paketi SELF_SIGNED_DEV | `scenarios/BS-0{1,2,3}*.json:7` **okundu** | ✅ Üçü de `SELF_SIGNED_DEV` |
| Dev kapıları env-gated (E-1/E-4/E-8/E-9) | ilgili dosya satırları **okundu** | ✅ Hepsi runtime env; üretimde `#ifdef` önerildi |
| Golden latch-öncesi değerleri kodluyor + runner latch'siz | `run_bs_exec_golden.py --dry-run` **çalıştırıldı**; `bs01_expected.json` **okundu** | ✅ `tick 574…` + sabit hash; `outage_active:false` |
| Connector smoke hattı derlenebilir/planlı | `connector_smoke.py --dry-run` **çalıştırıldı** | ✅ `[SMOKE OK] dry-run tamamlandi` (g++ derleme satırı doğrulandı, fiili derleme yapılmadı) |
| Mesh kontrol düzlemi imzalı + anti-replay | `discovery.rs:9-13,192,293-296` **okundu** | ✅ ed25519 beacon + monotonik sayaç/zaman |

### 9.2 Eşzamanlılık / "Rapor Anındaki Hâl" İşaretleri

Bu rapor, ikisi **şu an başka ajanlarca düzenlenen** dört dosyaya dokunmadan yazıldı; çakışmayı önlemek için yalnız `docs/GERCEK_DUNYA_GECIS_RAPORU.md` yazıldı, motor/cargo derlemesi çalıştırılmadı, `dist` yeniden üretilmedi.

- **`src/network/mesh_auth.rs`** (T-23 KEYMGMT-WIRE) — run sonunda okundu: KEYMGMT delege seam (`KeymgmtDelegate`, `caelus_keymgmt_register` FFI `:319`, `load_or_generate_with_delegate` `:416`, delege `persist` `:457`, round-trip test `:1300`) **mevcut**. Kalan iş C++ registry'nin bu FFI'yi çağırması (§6 KEYMGMT-WIRE). *Devam ediyor.*
- **`build.bat`** (T-22 BUILD-MATRIX) — run sonunda okundu: `CAELUS_CXX` seçimi, GCC/MSVC/GNU-linker preflight (`:84-89`), MSVC fallback iskeleti **mevcut**. Çoklu-toolchain fiili koşum bu makinede kanıtlanmadı (MSVC yok). *Devam ediyor.*
- **`CMakeLists.txt`** (T-22) — run sonunda okundu: MSVC/GCC matris flag'leri (`:27-57`), MinGW/MSVC `RUST_LIB_PATH` seçimi (`:106-114`), Windows link listesinde `crypt32` (`:124-125`) **mevcut**. *Devam ediyor.*
- **`dist/caelus_os.exe`** — latch-öncesi ara derleme; **yetkili değil**; bu run'da yeniden derleme bilinçli olarak yapılmadı.

Geçici dosya üretilmedi (connector_smoke `--dry-run` `build_tests/` altına kalıcı bir şey bırakmadı — koşum sonrası dizin boş teyit edildi).

---

*Bu rapor, mevcut kaynak ağacındaki gerçek dosya ve sembollere dayanır. En kritik bulgu: senaryo/plugin/audit üç yüzeyinde de kriptografi sağlam fakat **anahtar pinleme politikası yoktur** (gömülü-anahtara-güven), bu yüzden gerçek dünyaya geçişin P0 işi pinli güven çapası + gerçek imzalı içerik + üretim build kapılarıdır. Mekanizmalar (signer, verifier kancaları, DPAPI, fail-closed loader, imzalı mesh, latch'li outage, audit zinciri) hazır olduğundan, geriye kalan iş çoğunlukla "politika + kablolama"dır — yeni motor yazımı değil. "Okunarak teyit" ve "çalıştırılarak teyit" ayrımı §9.1'de açıkça verilmiştir; eşzamanlı ajan dosyaları §9.2'de "rapor anındaki hâl" olarak işaretlenmiştir.*
