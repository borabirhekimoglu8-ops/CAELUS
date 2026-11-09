# CAELUS — Keşif ve Bilgi Değeri Motoru Mimarisi (`CAELUS_KESIF_VE_BILGI_DEGERI_MIMARISI.md`)

## 1. Yönetici Özeti ve Stratejik Vizyon

**CAELUS Keşif ve Bilgi Değeri Motoru** (`ui/discovery_value_engine.js`, `tools/caelus_mcp_server.mjs`, `tools/run_discovery_research_lab.py`), CAELUS Yaşayan Dünya Modeli’nin üzerine inşa edilmiş; yalnızca mevcut veriyi işleyen değil, **hangi bilgilerin eksik olduğunu tespit eden, hangi bilinmeyenin bir kararı veya senaryo sıralamasını değiştirebileceğini (karar duyarlılığı) hesaplayan, rakip açıklamaları ayırt edecek araştırma adımlarını öneren, dış kaynaklara kontrollü/güvenli biçimde erişen ve yeni kanıt geldiğinde önceki değerlendirmeyi silmeden yeni sürüme güncelleyen** evrensel bir karar-bilimi ve keşif katmanıdır.

Sistem aşağıdaki 10 temel soruya yanıt verir:
1. **Ne biliyorum?** (`search_world_memory`, `livingWorldBundle` bitemporal kayıtları)
2. **Ne bilmiyorum?** (`list_information_gaps`, belirsizlik aralıkları `[min, max]`)
3. **Hangi bilinmeyen bir kararı değiştirebilir?** (`runDecisionSensitivityAndInformationValueEngine` — karar değişim eşiği `flipThresholdValue`)
4. **Birbirine rakip açıklamaları hangi veri ayırabilir?** (`competingHypothesesSeparated`, Bayesçi Beklenen Bilgi Kazanımı `EIG`)
5. **Bu veri hangi kaynakta bulunabilir?** (`candidateSourceId`, OpenAlex CC0, yerel MarkItDown belgeleri, kamu veri akışları)
6. **Kaynağın erişim, güven ve ticari kullanım koşulları nedir?** (`inspect_source_rights`, 14 zorunlu ticari denetim alanı)
7. **Bilgiyi edinmenin tahmini maliyeti ve süresi nedir?** (`researchCostUsd`, `costEpistemicStatus`: `KULLANICI_TARAFINDAN_BILINEN_MALIYET` / `TAHMIN_EDILMIS_MALIYET` / `BILINMIYOR_MALIYET`, `estimatedDurationHours`)
8. **Yeni veri geldiğinde hangi hipotez güçlendi veya zayıfladı?** (`submitHypothesisEvidence`, `recordResearchJournalEntry`)
9. **Önceki değerlendirmem neden değişti?** (`assessmentVersions` v1 $\to$ v2 değişim gerekçesi `changeRationaleTr`)
10. **Daha önce neyi araştırdım, ne buldum ve neyi bulamadım?** (`createDiscoveryResearchJournal` — `FOUND_VERIFIED`, `SEARCHED_NOT_FOUND`, `SOURCE_UNREACHABLE_OR_RESTRICTED`)

---

## 2. Çekirdek Mimari İlkeler ve Katman Ayrımı

```
+-----------------------------------------------------------------------------------+
| 1. DETERMINİSTİK VE ÇEVRİM DIŞI ÇEKİRDEK (Ağ ve MCP olmadan %100 çalışır)         |
|  - C++17 / Rust / WASM Sabit Noktalı (int64 x 10^6) Nedensel Motor                |
|  - Bitemporal Yaşayan Dünya Hafızası (ui/living_world_model.js)                   |
|  - Karar Duyarlılığı, Eşik Taraması ve Hipotez/Araştırma Günlüğü                   |
|    (ui/discovery_value_engine.js)                                                 |
+-----------------------------------------------------------------------------------+
                                        ^
                                        | Doğrulama, Zaman Kesimi (t <= t_karar),
                                        | Şema ve Güvenilmeyen Metin Kapısı
+-----------------------------------------------------------------------------------+
| 2. KONTROLLÜ MCP VE ARAŞTIRMA AJANI KATMANI (tools/caelus_mcp_server.mjs)         |
|  - 11 Özel CAELUS MCP Aracı (Varsayılan: READ_ONLY_CLIENT, en az yetki)           |
|  - 4 Kontrollü Ajan Rolü:                                                         |
|    Ajan A (Hipotez Üretici) | Ajan B (Bilgi Değeri Sıralayıcı)                    |
|    Ajan C (Kaynak Toplayıcı - Doğrudan Hafızaya Yazamaz!) | Ajan D (Denetim/Kayıt)|
+-----------------------------------------------------------------------------------+
                                        ^
                                        | Güvenilmeyen Dış İçerik Sınırı
+-----------------------------------------------------------------------------------+
| 3. DIŞ KAYNAK ADAPTÖRLERİ VE PYTHON ARAŞTIRMA LABORATUVARI                        |
|  - OpenAlex Bilimsel Adaptör (CC0 Üstveri vs Makale Tam Metin Telif Ayrımı)       |
|  - Yerel Belge -> Markdown Adaptörü (MarkItDown Eşdeğeri, Sayfa/Tablo Korumalı)   |
|  - Python Araştırma Laboratuvarı (tools/run_discovery_research_lab.py):           |
|    PyTorch 2.11.0+cpu GP/GNN/EIG, DoWhy 0.8 Refutation, River 0.26.1 ADWIN        |
+-----------------------------------------------------------------------------------+
```

### 2.1. Karar Duyarlılığı vs. Gerçek Ekonomik EVPI Ayrımı (Metodolojik Dürüstlük)
- `runDecisionSensitivityAndInformationValueEngine` fonksiyonu, kalibre edilmiş tam olasılık dağılımı ve doğrulanmış parasal kayıp fonksiyonu bulunmadığında **gerçek ekonomik Beklenen Bilgi Değeri (EVPI)** iddiasında bulunmaz (`isTrueCalibratedEconomicEvpi: false`).
- Bunun yerine her bilinmeyen değişkeni tanımlı `[minVal, maxVal]` aralığı boyunca 21 deterministik ızgara noktasında tarar:
  - Hangi eşik değerinde (`flipThresholdValue`) birincil önerilen kararın (`topDecisionId`) değiştiğini (`decisionFlipped: true/false`),
  - En yüksek ve en düşük karar faydası arasındaki salınımı (`maxPayoffSwing`),
  - Kararı hiç değiştirmeyen değişkenlerin (`maxPayoffSwing === 0`) belirsizlik aralığı ne kadar geniş olursa olsun **düşük öncelik** (`DUSUK_KARARI_ETKILEMEYEN_BILINMEYEN`) aldığını açıkça gösterir.

### 2.2. Hipotez ve Araştırma Günlüğü (`SEARCHED_NOT_FOUND` ve Sürüm Koruma)
- `createDiscoveryResearchJournal` ve `recordResearchJournalEntry`, yapılan her araştırmayı 3 olası sonuç durumuyla kaydeder:
  1. `FOUND_VERIFIED`: Veri bulundu, doğrulandı ve gerekiyorsa yeni bir değerlendirme sürümü (`versionNumber: v + 1`) oluşturuldu.
  2. `SEARCHED_NOT_FOUND` (**"Arandı ancak bulunamadı"**): Kaynak tarandı ancak ilgili kesim tarihinde veri mevcut değil veya ticari sır kapsamında. Veri **asla uydurulmaz** (`foundValue: null`), neden bulunamadığı `notFoundOrUnreachableReasonTr` alanına yazılır ve önceki değerlendirme sürümü olduğu gibi korunur.
  3. `SOURCE_UNREACHABLE_OR_RESTRICTED`: Kaynağa çevrim dışı kipte veya erişim kısıtı nedeniyle ulaşılamadı.
- **Sürüm Değişmezliği:** Yeni kanıt geldiğinde `journal.assessmentVersions` dizisindeki önceki değerlendirme (`v1`) `Object.freeze` ile korunur; yeni değerlendirme (`v2`) `previousVersionNumber: 1` referansıyla eklenir.

### 2.3. CAELUS MCP Sunucusu ve Güvenilmeyen Dış İçerik Sınırı
- `createCaelusMcpServer` (`ui/discovery_value_engine.js`) ve bağımsız JSON-RPC 2.0 sunucusu (`tools/caelus_mcp_server.mjs`) tam **11 aracı** sunar:
  1. `search_world_memory` (`READ`)
  2. `compare_world_states` (`READ`)
  3. `list_information_gaps` (`READ`)
  4. `inspect_hypothesis` (`READ`)
  5. `list_counterevidence` (`READ`)
  6. `run_sensitivity_analysis` (`READ_COMPUTE`)
  7. `rank_information_needs` (`READ_COMPUTE`)
  8. `compare_scenarios` (`READ_COMPUTE`)
  9. `record_research_result` (`WRITE` — yalnızca `AUTHORIZED_RESEARCH_RECORDER` veya `AGENT_D_AUDIT_AND_LEDGER` rolüne açık)
  10. `inspect_source_rights` (`READ`)
  11. `create_evidence_package` (`READ_PACKAGE`)
- **Güvenlik Kapıları (`sanitizeAndValidateUntrustedExternalInput`):**
  - Dış belgelerden, web sayfalarından veya DOM içeriklerinden gelen her metin `isUntrustedExternalData: true` olarak işaretlenir.
  - Metin içinde `Ignore all previous instructions`, `grant_admin_role`, `bypass_verification_gate` gibi istem enjeksiyonu (prompt injection) kalıpları tespit edilirse çağrının etkin rolü derhal `READ_ONLY_CLIENT` seviyesine düşürülür ve yazma işlemi reddedilir (`privilegeEscalationBlocked: true`).
  - Dosya yolu geçişi (`../`, `/etc/`, `\Windows\`, `file://`) ve yerel ağ SSRF (`127.0.0.1`, `localhost`, `169.254.x.x`, `192.168.x.x`) girişimleri `MCP_INVALID_PATH_OR_URL_INPUT` hatasıyla engellenir.

---

## 3. Kullanıcı Deneyimi: 7 Adımlı Sade Araştırma Akışı

`ui/index.html` içindeki `#caelus-discovery-value-engine-workspace` bölümü, kullanıcıya karmaşık iç terimleri dayatmadan 7 adımlı sade bir akış sunar:
1. **Sorumu seç** (`#dve-question-select`)
2. **CAELUS’un bildiklerini gör** (`#dve-card-knowns-unknowns`)
3. **Önemli bilinmeyenleri gör** (`#dve-card-knowns-unknowns`)
4. **Hangi bilginin kararı değiştirebileceğini incele** (`#dve-card-decision-sensitivity`)
5. **Araştırma önerilerini karşılaştır** (`#dve-card-ranking-comparison` — 4 yöntem yan yana)
6. **Yeni kaynak veya veri ekle** (`#dve-card-research-journal` — "Arandı, bulunamadı" dahil)
7. **Eski ve yeni değerlendirmeyi karşılaştır** (`#dve-card-assessment-diff`)

İkinci katman teknik ayrıntılar (12 parça entegrasyon matrisi, 11 MCP aracı, River ADWIN istatistiği ve SHA-256 tekrar oynatım özeti) `#dve-second-layer-audit-drawer` çekmecesinde kademeli açılım (progressive disclosure) ile sunulur.
