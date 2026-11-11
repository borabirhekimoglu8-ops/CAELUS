# CAELUS OS — Project Fluent Yerel Mesaj Sözlüğü (Türkçe / TR)
# A-1 & A-4 Yasası: Çekirdek yalnızca kanonik msg_id + sabit nokta parametreleri üretir;
# dil veya anlatım seviyesi değiştiğinde state_blake3 0 bit değişir.

verdict-pass-plain = Emniyetli — İşleme Uygun
verdict-pass-technical = VERDICT: PASS · Politika { $policy_id } + state_blake3={ $state_blake3 }

verdict-rule-breach-plain = Emniyet Kuralı Aşıldı — Müdahale Gerekli
verdict-rule-breach-technical = VERDICT: RULE_BREACH · Kırılan kural { $rule_id } (eşik={ $max_allowed_fp } fp)

verdict-insufficient-corroboration-plain = Tek Kaynaklı Bildirim — Bağımsız Teyit Bekleniyor
verdict-insufficient-corroboration-technical = VERDICT: INSUFFICIENT_EVIDENCE · Eksik independence_group: { $missing_groups }

epistemic-observation-plain = Doğrudan Sensör Ölçümü
epistemic-observation-technical = EPISTEMIC: OBSERVATION · Kalibre donanım / AIS / NMEA kaydı

epistemic-claim-plain = Operatör / Kurum Bildirimi
epistemic-claim-technical = EPISTEMIC: CLAIM · İnsan veya dış kurum beyanı

epistemic-hypothesis-plain = Hava / Model Tahmini
epistemic-hypothesis-technical = EPISTEMIC: HYPOTHESIS · Sayısal hava modeli veya ajan çıkarımı

security-source-equivocation-plain = Güvenlik Uyarısı: Kaynak Çelişkili Veri Gönderdi (Engellendi)
security-source-equivocation-technical = SECURITY_ALERT_EQUIVOCATION · Aynı ({ $source_id }, seq_no={ $seq_no }), farklı blake3

temporal-bitemporal-plain = Olay Anı / Sistemin Öğrendiği An
temporal-bitemporal-technical = observed_at_ms vs. cutoff_learned_at_ms (No Look-Ahead Slice)

counterfactual-branch-plain = Alternatif Senaryo Denemesi ("Ya Şöyle Olursa?")
counterfactual-branch-technical = Counterfactual Delta · İzole dal branch_state_blake3={ $branch_state_blake3 } fark analizi

explain-outcome-plain = Karar Durumu: { $verdict_label }. Aktif politika: { $policy_title }. Doğrulanan bağımsız kaynak grubu sayısı: { $group_count }. Denetim zinciri doğrulandı.
explain-outcome-technical = EXPLAIN_OUTCOME · verdict={ $verdict_code } · rule={ $rule_id } · groups={ $group_count } · state_blake3={ $state_blake3 } · audit_verified={ $audit_verified }
