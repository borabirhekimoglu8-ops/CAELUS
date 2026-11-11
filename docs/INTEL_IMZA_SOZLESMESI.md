# Intel Veri Düzlemi İmza Sözleşmesi (v1 & FIELD-IDENTITY v2)

**Kapsam:** MQTT (`caelus/intel` topic) ve Zapier webhook üzerinden motora giren
tüm intel payload'ları.
**Kapatılan açık:** `docs/GERCEK_DUNYA_GECIS_RAPORU.md` §5 FIELD-IDENTITY —
"broker'a ulaşan herkes nedensel grafa veri enjekte edebilir" ve OB-2 çoklu saha
kaynağı yanal hareket riski ("ele geçirilen tek saha sensörü başka bir `source_slot_id`
adına olay üretemez").

## Katmanlar

| Katman | Env | Ne kanıtlar | Yokken (dev build) | Yokken (`CAELUS_PRODUCTION`) |
|---|---|---|---|---|
| 1a — Çoklu kaynak manifesti (v2, önerilen) | `CAELUS_TRUSTED_INTEL_MANIFEST` (`<slot>:<64hex>,...` veya `@dosya`) | Payload'ı **hangi yetkili `source_slot_id`** üretti (slot-bağlı yazarlık) | `CAELUS_TRUSTED_INTEL_PUBKEY` varsa v1'e düşer; ikisi de yoksa uyarı | İkisi de yoksa veya geçersizse Connector **başlamaz** (`do_init` FATAL) |
| 1b — Tekil kaynak imzası (v1, geriye uyumlu) | `CAELUS_TRUSTED_INTEL_PUBKEY` (64 hex) | Payload'ı tekil pinli anahtar üretti | Yüksek sesli uyarı + imzasız kabul | Manifest de yoksa Connector **başlamaz** (`do_init` FATAL) |
| 2 — Taşıma token'ı | `CAELUS_INTEL_TOKEN` | Gönderenin hatta erişimi | Yüksek sesli uyarı + token'sız kabul | Connector **başlamaz** (`do_init` FATAL) |

Katman 1, katman 2'den bağımsız zorlanır: geçerli `X-Caelus-Auth` başlığı imza
kontrolünü **atlatmaz** (link erişimi ≠ yazarlık).

## Tel biçimi (byte-exact)

Zarf, payload'ın **ilk baytlarından** başlar (öncesinde boşluk dahi olamaz) ve
`\n` ile biter; kalan tüm baytlar imzalı gövdedir:

```
#sig=ed25519:<64hex-pubkey>:<128hex-signature>\n
<gövde: mevcut JSON veya CSV intel şeması, aynen>
```

İmzalanan mesaj (alan ayrımı — bir intel imzası asla senaryo/eklenti/mesh
imzası olarak yeniden kullanılamaz):

```
"CAELUS_INTEL_V1\n" || <ilk \n sonrası tüm baytlar>
```

## Karar tablosu (pin set iken)

| Durum | Sonuç |
|---|---|
| Zarf yok / başında boşluk var | RET (imzasız sayılmaz, düşürülür) |
| `#sig` ile başlıyor ama biçim bozuk | RET (asla "imzasız"a düşürülmez) |
| Pubkey ≠ pin | RET |
| İmza matematiksel geçersiz / gövde kurcalanmış | RET |
| Doğrulayıcı kancası kurulmamış | RET (fail-closed) + yüksek sesli hata |
| Hepsi geçerli | Zarf soyulur, gövde token katmanına geçer |

Pin **set değilken** başıboş bir zarf satırı yine soyulur (memo'ya sızamaz);
bozuk zarf yine reddedilir.

## Adli iz

Retler okuyucu thread'de atomik sayaca işlenir; motor thread'i her
`dispatch_connectors()` geçişinden sonra deltayı audit zincirine yazar:

```json
{"type":"INTEL_REJECTED","delta":N,"total":M}
```

## Saha tarafı imzalama

```bash
python3 tools/sign_intel_payload.py --generate-key intel_signing.key   # offline sakla
python3 tools/sign_intel_payload.py --key intel_signing.key --export-pubkey
# → CAELUS_TRUSTED_INTEL_PUBKEY olarak motor ortamına verilir

echo '{"friction_coeff":0.82,"crisis_level":2,"memo":"saha"}' | \
    python3 tools/sign_intel_payload.py --key intel_signing.key \
  | mosquitto_pub -t caelus/intel -s     # örnek MQTT yayını
```

Tohum dosyası **hiçbir zaman** depoya girmez (senaryo imzalama anahtarıyla aynı
politika); intel anahtarı senaryo/eklenti güven çapasından **ayrı** tutulmalıdır
(görev ayrılığı — saha cihazının ele geçmesi senaryo imzalama yetkisi vermez).

## Tel biçimi — FIELD-IDENTITY v2 (slot-bağlı manifest)

`CAELUS_TRUSTED_INTEL_MANIFEST` aktifken her mesaj **zorunlu olarak** v2 zarfıyla
başlar (slotsuz v1 zarfına düşürme — downgrade — reddedilir):

```
#sig=ed25519v2:<16hex-source-slot>:<64hex-pubkey>:<128hex-signature>\n
<gövde: mevcut JSON veya CSV intel şeması>
```

İmzalanan kanonik bayt dizisi (`<16hex-source-slot>` küçük harf 16 haneli onaltılık):

```
"CAELUS_INTEL_V2\n" || <16hex-source-slot> || "\n" || <ilk \n sonrası tüm baytlar>
```

Manifest biçimi (satır içi `,`/`;` ayracı veya `@<dosya_yolu>`):

```
# intel_sources.manifest
0xcae1050000a10001:1111111111111111111111111111111111111111111111111111111111111111
0xcae1050000a10002:2222222222222222222222222222222222222222222222222222222222222222
```

Doğrulanan `source_slot_id` doğrudan üretilen `CaelusIntelEvent::source_slot_id`
alanına damgalanır; JSON gövdede çelişen bir `"source_slot_id"` varsa mesaj reddedilir.

## Uygulama haritası

| Parça | Konum |
|---|---|
| Zarf ayrıştırma + v1/v2 manifest kapısı | `include/plugin/caelus_connector.h` (`extract_intel_sig_envelope`, `IntelSourceManifest`, `IntelAuthGate::admit`, `AirlockSourceManifestV2`, `AirlockFileConnector`) |
| Eklenti ABI 1.2 & 1.3 kaynak doğrulama kancaları | `include/plugin/caelus_plugin_abi.h` (`CAELUS_PLUGIN_ABI_MINOR = 3u`, `CaelusIntelSourceDescriptor`, `CaelusAirlockSourcePolicyV2`, `CaelusEngineFns::verify_intel_source`, `CaelusEngineFns::verify_airlock_v2`) |
| Dış Yan-Araba CLI ve Normalize Edici | `src/bin/caelus_sidecar_airlock.rs` + `src/airlock_host.rs` + `caelus_core/src/airlock.rs` |
| ed25519 doğrulayıcı kancası | `connector_detail::set_intel_sig_verifier` ← `core_engine.cpp` bootstrap'ında Rust `caelus_verify_scenario_signature` FFI'si kurulur |
| Audit köprüsü | `core_engine.cpp` `audit_intel_rejections()` + `src/audit_log.rs` (`INGEST_REJECTED`, `SECURITY_ALERT_EQUIVOCATION`, `SLICE_EVALUATION`) |
| Testler | `tests/connector_smoke.py` + `tests/test_airlock_ferry_pilot.py` |
| Sürüm | v1: tek pin (`CAELUS_TRUSTED_INTEL_PUBKEY`). FIELD-IDENTITY v2: slot-başına anahtar manifesti (`CAELUS_TRUSTED_INTEL_MANIFEST`). Sidecar Airlock v2: çift zamanlı (`observed_at_ms` / `learned_at_ms`) ve epistemik etiketli (`source_manifest.json`) `.airlock.ndjson` akışı |

---

## Sidecar Airlock Çift Zamanlı Olay Sözleşmesi (`CAELUS_INTEL_V2` — ABI 1.3)

Canlı `CAELUS_INTEL_V1` ve slot-bağlı `FIELD-IDENTITY v2` (`#sig=ed25519v2:...`) akışlarına **hiç dokunulmadan**, çevrimdışı imzalı paket değerlendirmesi (`Normalized Signed NDJSON Batch` → `AirlockFileConnector` / `caelus_core::airlock::ingest_verified_slice`) için `CAELUS_INTEL_V2` Sidecar Airlock zarfı tanımlanmıştır.

### 1. Kanonik İmza Zarfı (BOM yok, yalnız LF `\n`)

```text
#sig=ed25519:<64hex-pubkey>:<128hex-sig>
CAELUS_INTEL_V2
2.0
<source_id>|<key_id>|<event_kind>|<event_id>|<seq_no>|<observed_at_ms>|<learned_at_ms>|<epistemic_status>|<payload_blake3_hex>
<canonical_json_payload_single_line>
```

İmzalanan kanonik UTF-8 bayt dizisi (`#sig=...` satırı hariç):

```text
"CAELUS_INTEL_V2\n2.0\n" || <header_satırı> || "\n" || <canonical_json_payload_single_line>
```

> **Alan Ayrımı (Domain Separation):** `FIELD-IDENTITY v2` imzaları `"CAELUS_INTEL_V2\n<16hex-slot>\n..."` ile başlarken Sidecar Airlock imzaları `"CAELUS_INTEL_V2\n2.0\n..."` (`"."` içeren sürüm satırı) ile başlar; iki imza kümesi matematiksel olarak ayrışıktır.

`.airlock.ndjson` dosyasında her kayıt tek satırlık JSON nesnesi olarak saklanabilir (`learned_at_ms` üzerinde `O(log N)` ikili arama için):

```json
{"contract":"CAELUS_INTEL_V2","sig":"#sig=ed25519:<64hex-pub>:<128hex-sig>","schema_version":"2.0","header":"ferry_ops|ferry_ops_k1|DELAY_NOTICE|EVT-001|1|1762848000000|1762848300000|CLAIM|<64hex-blake3>","learned_at_ms":"1762848300000","payload_raw":"{\"subject_id\":\"VOYAGE_SIGACIK_VATHI_0800\",\"metric_key\":\"departure_delay\",\"fp_val\":\"15000000\",\"fp_scale\":1000000,\"unit\":\"minutes\",\"rounding\":\"HALF_EVEN\",\"overflow_policy\":\"REJECT_AT_AIRLOCK\",\"rule_id\":\"NORM_DECIMAL_FP1E6_HALF_EVEN_V1\",\"supersedes_event_id\":null,\"note\":\"kalkis 15 dk gecikecek\"}"}
```

### 2. Sabit Nokta ve 64-Bit JSON/MCP Hassasiyet Kuralı

* Tüm 64-bit tamsayılar (`fp_val`, `seq_no`, `observed_at_ms`, `learned_at_ms`, `expires_at_ms`, `cutoff_learned_at_ms`) JSON ve MCP JSON-RPC sınırında **ondalık ASCII dizge (`string`)** olarak taşınır (`2^53 - 1` üstü kayıpsız).
* Sabit nokta ölçeği `fp_scale = 1_000_000`, yuvarlama `HALF_EVEN`, taşma politikası `REJECT_AT_AIRLOCK` (`|fp_val| <= 2^62` Z3 güvenli tanım kümesi).

### 3. `source_manifest.json` ve Fail-Closed Hata Tablosu

`source_manifest.json` her `source_id` için pinli `key_id`, `pubkey` (sabit zamanlı karşılaştırma), `allowed_event_kinds`, `independence_group`, `origin_class` (`CALIBRATED_SENSOR`, `HUMAN_OPERATOR`, `MODEL_OR_AGENT`) ve isteğe bağlı `expires_at_ms` tanımlar.

| Hata Koşulu | Dönüş Kodu | Motor Durumu (`State`) | Denetim Günlüğü (`audit_log.rs`) |
|---|---|---|---|
| Bozuk `Ed25519` imzası veya `payload_blake3` uyuşmazlığı | `ERR_SIGNATURE_MISMATCH` | Değişmez (`0` bit fark) | `INGEST_REJECTED` + paket özeti |
| Tanımsız `source_id` / `key_id`, yanlış `pubkey` veya süresi dolmuş anahtar | `ERR_UNTRUSTED_SOURCE` | Değişmez (`0` bit fark) | `INGEST_REJECTED` + `key_id` |
| Kaynağın yetkili olmadığı `event_kind` veya epistemik statü ihlali | `ERR_UNAUTHORIZED_KIND` | Değişmez (`0` bit fark) | `INGEST_REJECTED` + yetki ihlali |
| Bilinmeyen `schema_version`, `LEGACY_UNSCOPED` (`require_v2_airlock=true`) veya `\|fp_val\| > 2^62` | `ERR_SCHEMA_OR_RANGE` | Değişmez (`0` bit fark) | `INGEST_REJECTED` + şema/aralık hatası |
| Aynı `(source_id, seq_no)` ile farklı `payload_blake3` | `ERR_SOURCE_EQUIVOCATION` | Değişmez (`0` bit fark) | `SECURITY_ALERT_EQUIVOCATION` |
