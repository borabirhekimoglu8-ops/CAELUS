# Intel Veri Düzlemi İmza Sözleşmesi (v1)

**Kapsam:** MQTT (`caelus/intel` topic) ve Zapier webhook üzerinden motora giren
tüm intel payload'ları.
**Kapatılan açık:** `docs/GERCEK_DUNYA_GECIS_RAPORU.md` §5 FIELD-IDENTITY —
"broker'a ulaşan herkes nedensel grafa veri enjekte edebilir".

## Katmanlar

| Katman | Env | Ne kanıtlar | Yokken (dev build) | Yokken (`CAELUS_PRODUCTION`) |
|---|---|---|---|---|
| 1 — Kaynak imzası | `CAELUS_TRUSTED_INTEL_PUBKEY` (64 hex) | Payload'ı **kim** üretti (yazarlık) | Yüksek sesli uyarı + imzasız kabul | Connector **başlamaz** (do_init FATAL) |
| 2 — Taşıma token'ı | `CAELUS_INTEL_TOKEN` | Gönderenin hatta erişimi | Yüksek sesli uyarı + token'sız kabul | Connector **başlamaz** (do_init FATAL) |

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

## Uygulama haritası

| Parça | Konum |
|---|---|
| Zarf ayrıştırma + kapı | `include/plugin/caelus_connector.h` (`extract_intel_sig_line`, `IntelAuthGate::admit`) |
| ed25519 doğrulayıcı kancası | `connector_detail::set_intel_sig_verifier` ← `core_engine.cpp` bootstrap'ında Rust `caelus_verify_scenario_signature` FFI'si kurulur |
| Audit köprüsü | `core_engine.cpp` `audit_intel_rejections()` |
| Testler | `tests/connector_smoke.py` — kapı birim kontrolleri (d)+(e) + Zapier uçtan uca |
| Sürüm | v1: tek pin. v2 adayı: slot-başına anahtar + `source_slot_id` bağlama (topic sözleşmesiyle) |
