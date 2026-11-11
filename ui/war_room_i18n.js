/**
 * CAELUS OS — Dual-Axis Plain-Language UX & 100% Offline Translation Engine (`war_room_i18n.js`)
 *
 * Katman 1 (Master Spesifikasyon §2.1 & §2.2, Yasa A-3 & A-4):
 * - Çift Eksenli Dil Matrisi: `locale` ("tr" | "en" + genişletilebilir yerel paketler) × `register` ("plain" | "technical").
 * - Varsayılan Açılış Modu: `locale = "tr"`, `register = "plain"` (Sade Operatör Görünümü).
 * - Determinizm Garantisi: Dil veya anlatım seviyesi değiştiğinde çekirdek `state_blake3` özeti 0 bit değişir.
 * - Hava Boşluklu Çalışma: Sıfır harici HTTP/CDN isteği; `Intl.NumberFormat` ve `Intl.DateTimeFormat` ile yerel birim dönüşümü (`knot` ↔ `km/sa`, `NM` ↔ `km`, `UTC` ↔ `Yerel Saat`).
 *
 * Auto-synchronized from `locales/{tr,en}/{common,plain,technical}.json` via `tools/sync_war_room_i18n_bundle.mjs`.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    let nodeFs = null;
    let nodePath = null;
    try {
      nodeFs = require("node:fs");
      nodePath = require("node:path");
    } catch (_) {}
    module.exports = factory(nodeFs, nodePath);
  } else {
    root.CaelusWarRoomI18n = factory(null, null);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (nodeFs, nodePath) {
  "use strict";

  const DEFAULT_LOCALE = "tr";
  const DEFAULT_REGISTER = "plain";
  const SUPPORTED_LOCALES = ["tr", "en"];
  const SUPPORTED_REGISTERS = ["plain", "technical"];

  const EMBEDDED_LOCALE_CATALOG = {
  "tr": {
    "common": {
      "alarm.awaiting": "◌ TEYİT BEKLİYOR",
      "alarm.caution": "● DİKKAT",
      "alarm.critical": "▲ KRİTİK",
      "alarm.nominal": "✓ NORMAL",
      "alarm.serious": "■ CİDDİ",
      "app.brand_title": "CAELUS OS // KOMUTA MERKEZİ",
      "app.return_to_cockpit": "⚔ KOMUTA MERKEZİNE DÖN (WAR ROOM)",
      "app.skip_to_main": "Ana Komuta Sahnesine Atla",
      "app.switch_to_studio": "3B Küre Stüdyosu",
      "app.switch_to_studio_title": "Klasik 3B Küre ve Senaryo Stüdyosu Görünümüne Geç",
      "cmdk.item_graph": "Nedensel Akış ve \"Ya Şöyle Olursa?\" Masasını Aç",
      "cmdk.item_lang": "Dili Değiştir (Türkçe ↔ English · Kısayol: L)",
      "cmdk.item_map": "Hava Boşluklu Taktik Haritayı Aç",
      "cmdk.item_night": "Gece Görüş Koruma Moduna Geç (Alt+3)",
      "cmdk.item_register": "Görünümü Değiştir (Sade Görünüm ↔ Teknik Görünüm · Kısayol: S)",
      "cmdk.item_seq64": "Liman Rampa Sensörü Kaydına Odaklan (ev_106)",
      "cmdk.item_t1": "08:10 İlk Bildirim Kesitine Git (Tek Kaynaklı Bildirim)",
      "cmdk.item_t2": "08:25 Sensör Teyidi Kesitine Git (+15 dk Bildirim vs +35 dk Ölçüm)",
      "cmdk.item_tamper": "08:15 Güvenlik Uyarısı Kaydını İncele (Engellenen Çelişkili Veri)",
      "conductor.aria_region": "Çift-Zamanlı Tekrar Oynatma ve Olay Akışı",
      "conductor.aria_slider": "Sistemin Öğrendiği An zaman sürgüsü",
      "conductor.aria_speed": "Tekrar Oynatma Hızı Seçici",
      "conductor.aria_tracks": "Üst çizgi: Olay Anı, Alt çizgi: Sistemin Öğrendiği An",
      "conductor.btn_live": "⏸ CANLI AKIŞ",
      "conductor.btn_next": "Sonraki Olay ]",
      "conductor.btn_prev": "[ Önceki Olay",
      "conductor.btn_replay": "▶ KAYITTAN İNCELE",
      "conductor.snap_t1": "08:10 İlk Bildirim",
      "conductor.snap_t2": "08:25 Sensör Teyidi",
      "conductor.snap_tamper": "08:15 Güvenlik Engeli",
      "dock.agent_auditor_name": "4. DENETÇİ",
      "dock.agent_redteam_name": "2. STRES TESTİ",
      "dock.agent_sentinel_name": "1. GÖZCÜ",
      "dock.agent_strategist_name": "3. STRATEJİST",
      "dock.aria_region": "4 Uzman Ajan Karar Kartları ve Komuta Asistanı",
      "dock.aria_roster": "4 Uzman Ajan Durum Özeti",
      "dock.assistant_ask_btn": "Sor",
      "dock.assistant_input_aria": "Komuta Asistanı Soru Girişi",
      "dock.assistant_placeholder": "Komuta asistanına sorun (ör. Neden uyarı var? Yedek rıhtım ne kazandırır?)…",
      "dock.assistant_preset_berth": "Yedek Rıhtım Seçeneğini Sına",
      "dock.assistant_preset_explain": "Durumu ve Çelişkiyi Açıkla",
      "dock.btn_approve_sign": "Onayla ve Kayda Geçir",
      "dock.btn_approved_done": "✓ Onaylandı ve Kaydedildi",
      "dock.btn_show_on_map": "Haritada Göster",
      "dock.btn_simulate": "Senaryoyu Test Et",
      "dock.confidence_label": "Güven Derecesi",
      "dock.focus_chip_event": "🔎 Kaydı Göster",
      "dock.focus_chip_map": "📍 Haritada Odakla",
      "dock.focus_chip_simulate": "⚡ Seçeneği Dene",
      "dock.toggle_proof_closed": "Teknik Kanıtı Gör",
      "dock.toggle_proof_open": "Teknik Kanıtı Gizle",
      "freshness.fresh": "Canlı",
      "freshness.pending": "Bekleniyor",
      "freshness.seconds_suffix": "sn",
      "freshness.stale": "Gecikmeli",
      "graph.aria_svg": "Neden-Sonuç Akışı ve Kaynak Çelişki Ağı",
      "graph.btn_disable_node": "⊘ Kaynağı Kapatıp Senaryoyu Dene",
      "graph.btn_enable_node": "↺ Kaynağı Yeniden Aç",
      "graph.btn_run_whatif": "⚡ Senaryoyu Şimdi Test Et",
      "graph.custom_value_aria": "Özel senaryo müdahale değeri",
      "graph.custom_value_label": "Müdahale Değeri:",
      "graph.node_disabled_tag": "[KAPATILDI]",
      "graph.node_future_tag": "[HENÜZ ULAŞMADI]",
      "graph.option_berth_b": "Seçenek A: Yedek Rıhtıma (Berth-B) Yanaş (-18 dk Süre Kazancı)",
      "graph.option_custom_fp": "Özel Müdahale Değeri Test Et",
      "graph.option_sheltered_route": "Seçenek B: Güney Sisam Korunaklı Rotaya Geç / Limanda Bekle",
      "graph.select_intervention_label": "Denenecek Çözüm veya Müdahaleyi Seçin:",
      "map.adsb_fresh": "● HAVA RADARI CANLI",
      "map.adsb_stale": "▲ HAVA VERİSİ GECİKMELİ (>2 dk)",
      "map.aria_canvas": "Ege Denizi Sığacık - Sisam Vathi Taktik Deniz Koridoru Haritası",
      "map.aria_engine": "Yerel Harita Motoru Seçicisi",
      "map.aria_toolbar": "Harita Katman ve Çizim Motoru Kontrolleri",
      "map.berth_a_locked": "RIHTIM-A (+35 dk DOLU)",
      "map.berth_a_watch": "RIHTIM-A (İZLEMEDE)",
      "map.berth_b_backup": "RIHTIM-B (YEDEK AÇIK)",
      "map.corridor_coords": "38°15'K · 26°45'D (EGE KORİDORU)",
      "map.engine_cesium": "Cesium 3B",
      "map.engine_cesium_fallback": "Cesium 3B (Yedek)",
      "map.engine_maplibre": "MapLibre + deck.gl",
      "map.engine_maplibre_fallback": "MapLibre (Vektör Yedek)",
      "map.engine_svg": "Yerel Vektör (0 ms)",
      "map.heli_name": "ARAMA KURTARMA HELİKOPTERİ-04",
      "map.hud_cesium_note": "CESIUM 3B KORİDOR GÖRÜNÜMÜ AKTİF · %100 ÇEVRİMDIŞI YEREL KÜRE (0 DIŞ İSTEK)",
      "map.hud_maplibre_note": "MAPLIBRE GL + DECK.GL + PMTILES AKTİF · %100 YEREL VEKTÖR HARİTA (0 DIŞ İSTEK)",
      "map.layer_airspace": "▲ Hava Sahası",
      "map.layer_ais": "● Gemi İzleri",
      "map.layer_berth": "■ Liman Rıhtımları",
      "map.layer_h3": "⬡ Dalga Risk Hücreleri",
      "map.layer_route": "━ Rota Koridoru",
      "map.legend_claim": "◆ Bildirim",
      "map.legend_graph": "Nedensel Akış",
      "map.legend_hyp": "▲ Tahmin",
      "map.legend_obs": "● Sensör Ölçümü",
      "map.legend_shortcut": "Kısayol:",
      "map.port_sigacik": "SEFERİHİSAR / SIĞACIK LİMANI",
      "map.port_vathi": "SİSAM / VATHI LİMANI",
      "map.sheltered_corridor": "ALTERNATİF ROTA: GÜNEY SİSAM KORUNAKLI KORİDORU",
      "map.vessel_name": "EGE FERİBOTU-01",
      "map.zero_external_tiles": "0 Dış Harita İsteği",
      "modal.close_esc": "Kapat (ESC)",
      "modal.cmdk_aria": "Hızlı Komut ve Arama Çubuğu",
      "modal.cmdk_placeholder": "Gemi, olay, saat veya komut yazın (ör. 08:10, 08:25, Yedek Rıhtım, İngilizce, Teknik)…",
      "modal.cmdk_title": "Hızlı Komut ve Arama Çubuğu (Gemi · Olay · Kural · Dil · Görünüm)",
      "modal.seal_aria": "Denetim Mührü ve Kaynak Yetki Belgesi İnceleyicisi",
      "source.ais_terrestrial_aegean": "Gemi Trafiği AIS",
      "source.ferry_operator_dispatch": "Sefer Operatörü",
      "source.nmea2000_bridge_bus": "Köprü Üstü NMEA Sensörü",
      "source.open_meteo_marine_ensemble": "Deniz Hava Tahmini",
      "source.opensky_aegean_adsb": "Hava Sahası",
      "source.port_berth_sensor_sigacik": "Liman Sensörü",
      "stage.aria_region": "Taktik Harita ve Nedensel Akış Sahnesi",
      "stage.aria_tabs": "Harita ve Nedensel Akış Sekmeleri",
      "stage.tab_graph": "[G] Nedensel Akış ve \"Ya Şöyle Olursa?\" Masası",
      "stage.tab_map": "[M] Hava Boşluklu Taktik Harita",
      "table.aria_filter": "Bilgi Türü Filtresi",
      "table.aria_grid": "Sanallaştırılmış Olay Akış Tablosu",
      "table.filter_all": "Tümü",
      "table.filter_quarantine": "⛔ Engellenenler",
      "topbar.aria_locale": "Dil Seçicisi (TR veya EN, Kısayol: L)",
      "topbar.aria_register": "Sade veya Teknik Görünüm Anahtarı (Kısayol: S)",
      "topbar.aria_sources": "Canlı Veri Kaynaklarının Sağlık Işıkları",
      "topbar.aria_theme": "Köprü Üstü Aydınlatma Modu",
      "topbar.aria_units": "Hız, Mesafe ve Saat Birimi Seçicisi",
      "topbar.clock_local": "Yerel Saat",
      "topbar.clock_utc": "UTC",
      "topbar.register_plain": "Sade Görünüm",
      "topbar.register_plain_hint": "Sade Operatör Görünümü (Kısayol: S)",
      "topbar.register_technical": "Teknik Görünüm",
      "topbar.register_technical_hint": "Teknik Denetim Görünümü (Kısayol: S)",
      "topbar.search_btn": "⌕ Ara (Ctrl+K)",
      "topbar.search_hint": "Hızlı Komut, Gemi ve Olay Arama Çubuğu (Ctrl+K / Cmd+K)",
      "topbar.theme_day": "Gündüz",
      "topbar.theme_day_hint": "Gündüz Yüksek Kontrast Modu (Alt+1)",
      "topbar.theme_dusk": "Alacakaranlık",
      "topbar.theme_dusk_hint": "Alacakaranlık Vardiya Modu (Alt+2)",
      "topbar.theme_night": "Gece",
      "topbar.theme_night_hint": "Gece Görüş Koruma Modu (Alt+3)",
      "topbar.unit_km": "km",
      "topbar.unit_kmh": "km/sa",
      "topbar.unit_kn": "knot",
      "topbar.unit_nm": "deniz mili",
      "unit.km_short": "km",
      "unit.kmh_short": "km/sa",
      "unit.kn_short": "kn",
      "unit.meter_short": "m",
      "unit.min_short": "dk",
      "unit.mps_short": "m/sn",
      "unit.nm_short": "NM",
      "unit.sec_short": "sn"
    },
    "plain": {
      "agent.redteam.alert": "Olumsuz hava ve yoğunluk senaryosunda {count} emniyet sınırı aşılıyor (beklenen gecikme tavanı {p95_label}, dalga {wave_label}).",
      "agent.redteam.nominal": "Dalga yüksekliği, rüzgar ve yanaşma süresi emniyet sınırları içinde.",
      "agent.sentinel.alert": "{total} dikkat gerektiren durum var: {quarantined} engellenen şüpheli kayıt, {stale} gecikmeli sensör, {conflicts} kaynak çelişkisi.",
      "agent.sentinel.anomaly_conflict": "Operatör bildirimi ({min_label}) ile doğrudan sensör ölçümü ({max_label}) çelişiyor; her iki bilgi yan yana korundu.",
      "agent.sentinel.anomaly_equivocation": "Güvenlik Uyarısı: {source_name} aynı sıra numarasıyla farklı veri gönderdi ve otomatik engellendi.",
      "agent.sentinel.anomaly_rejected": "{source_name} kaydı güvenlik kontrolünden geçemediği için engellendi.",
      "agent.sentinel.anomaly_stale": "{source_name} verisi gecikti ({age_sec} sn geçti).",
      "agent.sentinel.nominal": "Tüm sensörler güncel; engellenen veya çelişen bildirim yok.",
      "agent.strategist.coa1_rationale": "Ana rıhtımdaki rampa yoğunluğunu atlayarak rüzgar altı Yedek Rıhtım-B'ye yanaşır ve gecikmeyi emniyetli sınıra indirir.",
      "agent.strategist.coa1_title": "Seçenek A: Yedek Rıhtıma (Berth-B) Yanaş — Süre Kazancı: 18 dk",
      "agent.strategist.coa2_rationale": "Açık deniz dalga riskini düşürmek için Güney Sisam korunaklı koridorunu kullanır ve rıhtım sırasını dengeler.",
      "agent.strategist.coa2_title": "Seçenek B: Güney Sisam Korunaklı Rotaya Geç / Limanda 25 dk Bekle",
      "assistant.drawer_badge": "Doğrulanmış Saha Verisi",
      "assistant.drawer_title": "Proaktif Komuta Asistanı",
      "assistant.reply_cf": "Alternatif senaryo denemesinde durum \"{base_verdict}\" yerine \"{branch_verdict}\" oluyor (süre etkisi: {delta_label}).",
      "assistant.reply_conflict": "Operatör bildirimi ({min_label}) ile doğrudan sensör ölçümü ({max_label}) arasında fark var; her iki kayıt silinmeden yan yana tutuluyor.",
      "assistant.reply_missing": "Henüz bağımsız sensör ölçümü ulaşmadığı için karar teyit bekliyor.",
      "assistant.reply_summary": "Saat {clock} itibarıyla sistem durumu: {verdict_label}.",
      "assistant.tools_label": "Kullanılan Doğrulama Adımları:",
      "card.auditor_lock_banner": "Denetçi Kilidi: Yalnızca tek kaynaklı bildirim varken karar onaylanamaz; bağımsız sensör teyidi bekleniyor.",
      "card.delta_groups_label": "Doğrulayan Sensör Grubu:",
      "card.delta_safety_label": "Emniyet Kazancı:",
      "card.delta_time_label": "Süre Etkisi:",
      "card.delta_verdict_label": "Beklenen Sonuç:",
      "card.sealed_banner": "✓ Operatör Tarafından Onaylandı ve Güvenli Kayıt Defterine İşlendi",
      "conductor.readout_prefix": "Sistemin Öğrendiği An:",
      "conductor.title": "Zaman Çizelgesi: Olay Anı / Sistemin Öğrendiği An",
      "conductor.track_lower": "Öğrenildiği An",
      "conductor.track_upper": "Olay Anı",
      "conflict.box_subtitle": "Operatör Bildirimi ile Sensör Ölçümü Karşılaştırması",
      "conflict.box_title": "Çelişen Kaynaklar Yan Yana Korundu (Ortalama Alınmadı)",
      "counterfactual.branch_title": "Alternatif Senaryo Denemesi (\"Ya Şöyle Olursa?\")",
      "dock.auditor_locked": "Teyit Bekliyor",
      "dock.auditor_ready": "Onaya Hazır",
      "dock.header_badge": "İnsan Onayı Zorunlu",
      "dock.header_title": "4 Uzman Ajan Önerileri ve Operatör Onayı",
      "dock.redteam_meta": "Risk Sınırı: {count}",
      "dock.sentinel_meta": "Uyarı: {count}",
      "dock.strategist_meta": "Seçenek: {count}",
      "epistemic.CLAIM": "Operatör / Kurum Bildirimi",
      "epistemic.HYPOTHESIS": "Hava / Model Tahmini",
      "epistemic.OBSERVATION": "Doğrudan Sensör Ölçümü",
      "explain.outcome_summary": "Durum: {verdict_label}. Doğrulayan bağımsız sensör grubu: {group_count}. Tüm kayıtlar denetim defterinde doğrulandı.",
      "graph.cf_result_seal": "İzole Simülasyon Doğrulandı (Ana Ekran Değişmedi)",
      "graph.cf_result_title": "Senaryo Deneme Sonucu:",
      "graph.cf_result_transition": "Yeni Durum: {base_verdict} → {branch_verdict}",
      "graph.chain_banner": "\"Liman Rampası Arızası (+35 dk)\" ──► \"Emniyetli Yanaşma Süresi Aşıldı\"",
      "graph.conflict_edge": "⚡ Kaynak Çelişkisi (20 dk Fark)",
      "graph.desk_group": "Bağımsız Kaynak Türü:",
      "graph.desk_selected_node": "Seçili Veri Kaynağı:",
      "graph.desk_seq": "Kayıt Sırası:",
      "graph.desk_value": "Ölçülen / Bildirilen Değer:",
      "graph.gate_corroborated": "Teyitli Kaynak Grubu: {count}",
      "graph.gate_threshold": "Şart: En Az 2 Bağımsız Sensör",
      "graph.gate_title": "ÇİFT KAYNAK TEYİT KAPISI",
      "graph.node_val_adsb": "450 m Hava Sahası Radarı",
      "graph.node_val_ais": "+35 dk Gemi AIS Ölçümü",
      "graph.node_val_meteo": "Dalga Tahmini: 3,15 m",
      "graph.node_val_ops": "+15 dk Operatör Bildirimi",
      "graph.node_val_port": "+35 dk İskele Sensörü",
      "graph.quarantine_sub": "Güvenlik Koruması: Sistem Durumu Etkilenmedi",
      "graph.quarantine_title": "⛔ Çelişkili Tekrar Kayıt Engellendi",
      "map.hud_slice_summary": "İncelenen An: {clock} · Tahmini Gecikme Aralığı: {p50} / {p95}",
      "map.vessel_conflict_sub": "Sensör: +35 dk ≠ Operatör Bildirimi: +15 dk",
      "map.vessel_single_sub": "Operatör Bildirimi: +15 dk (Sensör Teyidi Bekleniyor)",
      "seal_modal.no_sealed_cards": "Henüz onaylanıp kayda geçirilen bir karar kartı bulunmuyor.",
      "seal_modal.packets_summary": "{accepted} doğrulanmış kayıt kabul edildi · {rejected} şüpheli kayıt engellendi (sistem durumu korundu)",
      "seal_modal.sealed_cards_heading": "Onaylanıp Kayda Geçirilen Kararlar ({count}):",
      "seal_modal.title": "Sistem Bütünlük Mührü ve Veri Kaynağı Yetki Özeti",
      "security.ERR_SOURCE_EQUIVOCATION": "Güvenlik Uyarısı: Kaynak Çelişkili Veri Gönderdi (Engellendi)",
      "stage.active_rule_label": "Uygulanan Kural: Emniyetli Yanaşma Süresi (En Fazla 20 dk Gecikme)",
      "table.col_epistemic": "Bilgi Türü",
      "table.col_event": "Kayıt No",
      "table.col_learned": "Öğrenildiği An",
      "table.col_observed": "Olay Anı",
      "table.col_seq": "Kayıt Sırası",
      "table.col_source": "Veri Kaynağı",
      "table.col_status": "Durum",
      "table.col_value": "Ölçüm / Değer",
      "table.status_active": "Bu Anda Geçerli",
      "table.status_future": "Henüz Sisteme Ulaşmadı",
      "table.status_quarantined": "Güvenlik Nedeniyle Engellendi",
      "table.toolbar_title": "Canlı ve Kayıtlı Olay Akışı ({count} Kayıt)",
      "temporal.bitemporal_axis": "Olay Anı / Sistemin Öğrendiği An",
      "topbar.policy_badge": "Deniz Yanaşma Emniyeti",
      "topbar.seal_badge_label": "✓ Denetim Mührü Doğrulandı",
      "topbar.seal_badge_title": "Sistem bütünlük mührünü ve onaylı kayıt özetini görüntüle",
      "topbar.system_mode_badge": "Tam Tutarlı Emniyet Modu",
      "topbar.transport_airgapped": "◆ %100 Çevrimdışı Yerel Paket",
      "topbar.transport_cpp_engine": "● Yerel Motor Akışı",
      "topbar.transport_live_airlock": "● Canlı Saha Bağlantısı",
      "topbar.transport_ws_replay": "● Yerel Kayıt Akışı",
      "topbar.verdict_prefix": "DURUM:",
      "verdict.GEÇTİ": "Emniyetli — İşleme Uygun",
      "verdict.KANIT_YETERSİZ": "Tek Kaynaklı Bildirim — Bağımsız Teyit Bekleniyor",
      "verdict.KURAL_İHLALİ": "Emniyet Kuralı Aşıldı — Müdahale Gerekli"
    },
    "technical": {
      "agent.redteam.alert": "12-Dünya p95 stres zarfında {count} kural aşıldı (p95={p95_fp} fp, wave_p95={wave_fp} fp).",
      "agent.redteam.nominal": "12-Dünya p50/p95 risk zarfı MARITIME_SAFETY_V2 eşikleri içinde.",
      "agent.sentinel.alert": "{total} anomali saptandı ({quarantined} INGEST_REJECTED karantina, {stale} STALE sensör, {conflicts} epistemik çelişki).",
      "agent.sentinel.anomaly_conflict": "{subject_id}.{metric_key} çelişkisi [{min_fp} fp vs {max_fp} fp]; her iki event_id korundu.",
      "agent.sentinel.anomaly_equivocation": "SECURITY_ALERT_EQUIVOCATION: ({source_id}, seq_no={seq_no}) yakalandı; state_blake3 0-bit korundu.",
      "agent.sentinel.anomaly_rejected": "INGEST_REJECTED ({error_code}): source_id={source_id}, event_id={event_id}.",
      "agent.sentinel.anomaly_stale": "{source_id} max_staleness_ms sınırını aştı ({age_ms} ms > {max_ms} ms).",
      "agent.sentinel.nominal": "Tüm Ed25519 imzaları ve max_staleness_ms pencereleri nominal sınırda.",
      "agent.strategist.coa1_rationale": "BERTH_02 rampa tahsisi ile kuyruk gecikmesini 17000000 fp seviyesine çeker; RULE_SLA_BREACH_CORROBORATED kalkar.",
      "agent.strategist.coa1_title": "COA-01 (cf_01): BERTH_02 Yedek Rıhtım Yönlendirmesi (Δdelay=-18000000 fp)",
      "agent.strategist.coa2_rationale": "Güney Sisam korunaklı rota koridoru ile wave_p95 zarfını düşürür ve iskele kapı kilidini senkronize eder.",
      "agent.strategist.coa2_title": "COA-02 (cf_02): ROUTE_SHELTER_01 Güney Sisam Koridoru (fp_val=16000000)",
      "assistant.drawer_badge": "Sıfır Halüsinasyon",
      "assistant.drawer_title": "Kanıt-Bağlı Komuta Asistanı (MCP Araç Çıktısı Zorunlu)",
      "assistant.reply_cf": "Counterfactual ({branch_id}): {base_verdict} -> {branch_verdict} (Δdelay={delta_fp} fp, branch_blake3={branch_hash}…).",
      "assistant.reply_conflict": "Çelişki Korundu: {subject_id}.{metric_key} [{min_fp} fp vs {max_fp} fp] ({sources}).",
      "assistant.reply_missing": "Eksik independence_group: {missing_groups}.",
      "assistant.reply_summary": "[MCP Kanıt Yanıtı] cutoff={cutoff_ms} ms | verdict={verdict_code} | rule={rule_id} | state_blake3={state_hash}…",
      "assistant.tools_label": "Çağrılan MCP Araçları:",
      "card.auditor_lock_banner": "AUDITOR FAIL-CLOSED KİLİDİ: Bağımsız OBSERVATION teyidi olmadan (KANIT_YETERSİZ) Ed25519 mührü basılamaz.",
      "card.delta_groups_label": "independence_group:",
      "card.delta_safety_label": "Δ Emniyet/Risk:",
      "card.delta_time_label": "Δ Süre:",
      "card.delta_verdict_label": "Counterfactual:",
      "card.sealed_banner": "✓ ED25519 İMZALANDI VE MÜHÜRLENDİ · pubkey={pubkey}… · sig={sig}…",
      "conductor.readout_prefix": "cutoff_learned_at_ms =",
      "conductor.title": "Bi-Temporal Time Conductor (observed_at_ms vs. cutoff_learned_at_ms)",
      "conductor.track_lower": "learned_at_ms",
      "conductor.track_upper": "observed_at_ms",
      "conflict.box_subtitle": "{subject_id}.{metric_key} · independence_group karşılaştırması",
      "conflict.box_title": "A-2 Epistemik Çelişki Matrisi (Yan Yana Korundu · Ortalama Alınmadı)",
      "counterfactual.branch_title": "Counterfactual Delta · İzole dal branch_state_blake3 fark analizi",
      "dock.auditor_locked": "FAIL-CLOSED",
      "dock.auditor_ready": "ED25519 BEKLİYOR",
      "dock.header_badge": "CAELUS_AG_UI_V1",
      "dock.header_title": "4 Uzman Ajan & İnsan-Onaylı Eylem İskelesi",
      "dock.redteam_meta": "İhlal: {count}",
      "dock.sentinel_meta": "Anomali: {count}",
      "dock.strategist_meta": "COA: {count} Dal",
      "epistemic.CLAIM": "EPISTEMIC: CLAIM · İnsan veya dış kurum beyanı",
      "epistemic.HYPOTHESIS": "EPISTEMIC: HYPOTHESIS · Sayısal hava modeli veya ajan çıkarımı",
      "epistemic.OBSERVATION": "EPISTEMIC: OBSERVATION · Kalibre donanım / AIS / NMEA kaydı",
      "explain.outcome_summary": "EXPLAIN_OUTCOME · verdict={verdict_code} · rule={rule_id} · groups={group_count} · state_blake3={state_blake3}",
      "graph.cf_result_seal": "branch_state_blake3: {branch_hash}",
      "graph.cf_result_title": "Counterfactual Delta ({branch_id}):",
      "graph.cf_result_transition": "Hüküm Geçişi: {base_verdict} → {branch_verdict}",
      "graph.chain_banner": "port_berth_sensor_sigacik (delay_min_fp=35000000) ──► RULE_SLA_BREACH_CORROBORATED (>20000000 fp)",
      "graph.conflict_edge": "⚡ CONFLICT (Δ 20000000 fp · 20,0 dk)",
      "graph.desk_group": "independence_group:",
      "graph.desk_selected_node": "Seçili source_id:",
      "graph.desk_seq": "Son seq_no (64-Bit String):",
      "graph.desk_value": "Sabit Nokta Değeri (1e6):",
      "graph.gate_corroborated": "independence_group teyidi: {count}",
      "graph.gate_threshold": "Eşik: ≥2 OBSERVATION / Grup",
      "graph.gate_title": "A-2 EPİSTEMİK KAPI",
      "graph.node_val_adsb": "baro_alt_m_fp=450000000 (OBSERVATION)",
      "graph.node_val_ais": "delay_min_fp=35000000 (OBSERVATION)",
      "graph.node_val_meteo": "wave_p95_m_fp=3150000 (3,15 m)",
      "graph.node_val_ops": "delay_min_fp=15000000 (CLAIM)",
      "graph.node_val_port": "delay_min_fp=35000000 (seq>2^53)",
      "graph.quarantine_sub": "ERR_SOURCE_EQUIVOCATION · 0-Bit state_blake3 Etkisi",
      "graph.quarantine_title": "⛔ ev_103_equivocation (KARANTİNA)",
      "map.hud_slice_summary": "Kesit: {clock} · 12-Dünya Risk Bandı p50/p95: {p50} / {p95}",
      "map.vessel_conflict_sub": "AIS:+35000000 fp (OBSERVATION) ≠ OPS:+15000000 fp (CLAIM)",
      "map.vessel_single_sub": "OPS:+15000000 fp (CLAIM · Eksik independence_group)",
      "seal_modal.no_sealed_cards": "Henüz operatör tarafından Ed25519 ile mühürlenmiş kart bulunmuyor.",
      "seal_modal.packets_summary": "{accepted} kabul / {rejected} karantina (0-bit state_blake3 değişimi garantili)",
      "seal_modal.sealed_cards_heading": "Ed25519 Mühürlü Eylem Kartları ({count}):",
      "seal_modal.title": "Kriptografik Mühür & Kaynak Manifestosu v2.0 Denetçisi",
      "security.ERR_SOURCE_EQUIVOCATION": "SECURITY_ALERT_EQUIVOCATION · Aynı ({source_id}, seq_no={seq_no}), farklı blake3",
      "stage.active_rule_label": "Aktif Kural: {rule_id} (eşik={max_allowed_fp} fp)",
      "table.col_epistemic": "Epistemik Statü",
      "table.col_event": "event_id",
      "table.col_learned": "learned_at_ms",
      "table.col_observed": "observed_at_ms",
      "table.col_seq": "seq_no (64-Bit String)",
      "table.col_source": "source_id / Grup",
      "table.col_status": "Kesit Durumu",
      "table.col_value": "Sabit Nokta (1e6)",
      "table.status_active": "KESİTTE AKTİF",
      "table.status_future": "Henüz Öğrenilmedi (Gelecek Kesiti)",
      "table.status_quarantined": "KARANTİNA · {error_code} (0-Bit)",
      "table.toolbar_title": "Sanallaştırılmış Telemetri Akışı ({count} Olay · CLS=0)",
      "temporal.bitemporal_axis": "observed_at_ms vs. cutoff_learned_at_ms (No Look-Ahead Slice)",
      "topbar.policy_badge": "policy_id: MARITIME_SAFETY_V2",
      "topbar.seal_badge_label": "state_blake3 & audit_head",
      "topbar.seal_badge_title": "state_blake3, audit_head_blake3, Manifest v2.0 Ed25519 imzası ve denetim zincirini incele",
      "topbar.system_mode_badge": "DET-MODE · FP_SCALE=1e6",
      "topbar.transport_airgapped": "◆ AIR-GAPPED · CAELUS_INTEL_V2 YEREL PAKET",
      "topbar.transport_cpp_engine": "● C++ ENGINE (:47809 · OFFLINE REPLAY)",
      "topbar.transport_live_airlock": "● LIVE AIRLOCK (:47809 · CAELUS_AG_UI_V1)",
      "topbar.transport_ws_replay": "● OFFLINE REPLAY (:47809 · CAELUS_AG_UI_V1)",
      "topbar.verdict_prefix": "HÜKÜM:",
      "verdict.GEÇTİ": "VERDICT: PASS · Politika {policy_id} + state_blake3 mührü",
      "verdict.KANIT_YETERSİZ": "VERDICT: INSUFFICIENT_EVIDENCE · Eksik independence_group: {missing_groups}",
      "verdict.KURAL_İHLALİ": "VERDICT: RULE_BREACH · Kırılan kural {rule_id} ve eşik {threshold_label}"
    }
  },
  "en": {
    "common": {
      "alarm.awaiting": "◌ AWAITING CONFIRMATION",
      "alarm.caution": "● CAUTION",
      "alarm.critical": "▲ CRITICAL",
      "alarm.nominal": "✓ NOMINAL",
      "alarm.serious": "■ SERIOUS",
      "app.brand_title": "CAELUS OS // WAR ROOM",
      "app.return_to_cockpit": "⚔ RETURN TO WAR ROOM COCKPIT",
      "app.skip_to_main": "Skip to Main Command Stage",
      "app.switch_to_studio": "3D Globe Studio",
      "app.switch_to_studio_title": "Switch to Classic 3D Globe & Scenario Studio",
      "cmdk.item_graph": "Open Causal Flow & \"What-If\" Desk",
      "cmdk.item_lang": "Switch Language (Türkçe ↔ English · Shortcut: L)",
      "cmdk.item_map": "Open Air-Gapped Tactical Map",
      "cmdk.item_night": "Switch to Night Vision Preservation Mode (Alt+3)",
      "cmdk.item_register": "Switch View Mode (Plain View ↔ Technical View · Shortcut: S)",
      "cmdk.item_seq64": "Focus Port Ramp Sensor Record (ev_106)",
      "cmdk.item_t1": "Jump to 08:10 First Report Slice (Single-Source Report)",
      "cmdk.item_t2": "Jump to 08:25 Sensor Confirmation Slice (+15 min Report vs +35 min Sensor)",
      "cmdk.item_tamper": "Inspect 08:15 Security Alert Record (Blocked Conflicting Duplicate)",
      "conductor.aria_region": "Bi-Temporal Replay Conductor and Event Stream",
      "conductor.aria_slider": "System Received At timeline slider",
      "conductor.aria_speed": "Replay Speed Selector",
      "conductor.aria_tracks": "Upper track: Happened At, Lower track: Received At",
      "conductor.btn_live": "⏸ LIVE STREAM",
      "conductor.btn_next": "Next Event ]",
      "conductor.btn_prev": "[ Previous Event",
      "conductor.btn_replay": "▶ REPLAY REVIEW",
      "conductor.snap_t1": "08:10 First Report",
      "conductor.snap_t2": "08:25 Sensor Confirmation",
      "conductor.snap_tamper": "08:15 Security Block",
      "dock.agent_auditor_name": "4. AUDITOR",
      "dock.agent_redteam_name": "2. STRESS TEST",
      "dock.agent_sentinel_name": "1. SENTINEL",
      "dock.agent_strategist_name": "3. STRATEGIST",
      "dock.aria_region": "4 Specialist Agent Decision Cards and Command Assistant",
      "dock.aria_roster": "4 Specialist Agents Status Summary",
      "dock.assistant_ask_btn": "Ask",
      "dock.assistant_input_aria": "Command Assistant Query Input",
      "dock.assistant_placeholder": "Ask the command assistant (e.g. Why is there an alert? What does Berth-B save?)…",
      "dock.assistant_preset_berth": "Simulate Alternate Berth",
      "dock.assistant_preset_explain": "Explain Status & Conflict",
      "dock.btn_approve_sign": "Approve & Sign",
      "dock.btn_approved_done": "✓ Approved & Recorded",
      "dock.btn_show_on_map": "Show on Map",
      "dock.btn_simulate": "Simulate Option",
      "dock.confidence_label": "Confidence",
      "dock.focus_chip_event": "🔎 Inspect Record",
      "dock.focus_chip_map": "📍 Focus on Map",
      "dock.focus_chip_simulate": "⚡ Simulate Option",
      "dock.toggle_proof_closed": "View Technical Proof",
      "dock.toggle_proof_open": "Hide Technical Proof",
      "freshness.fresh": "Live",
      "freshness.pending": "Waiting",
      "freshness.seconds_suffix": "s",
      "freshness.stale": "Delayed",
      "graph.aria_svg": "Cause-and-Effect Flow and Source Conflict Network",
      "graph.btn_disable_node": "⊘ Mute Source & Test Scenario",
      "graph.btn_enable_node": "↺ Re-enable Source",
      "graph.btn_run_whatif": "⚡ Simulate Scenario Now",
      "graph.custom_value_aria": "Custom scenario intervention value",
      "graph.custom_value_label": "Intervention Value:",
      "graph.node_disabled_tag": "[MUTED]",
      "graph.node_future_tag": "[NOT YET RECEIVED]",
      "graph.option_berth_b": "Option A: Divert to Alternate Berth (Berth-B) (-18 min Saved)",
      "graph.option_custom_fp": "Test Custom Intervention Parameter",
      "graph.option_sheltered_route": "Option B: South Samos Sheltered Route / Hold in Port",
      "graph.select_intervention_label": "Choose Intervention or Option to Simulate:",
      "map.adsb_fresh": "● AIRSPACE RADAR LIVE",
      "map.adsb_stale": "▲ AIRSPACE DATA DELAYED (>2 min)",
      "map.aria_canvas": "Aegean Sea Sigacik to Samos Vathi Tactical Maritime Corridor Map",
      "map.aria_engine": "Local Map Engine Selector",
      "map.aria_toolbar": "Map Layer and Rendering Engine Controls",
      "map.berth_a_locked": "BERTH-A (+35 min OCCUPIED)",
      "map.berth_a_watch": "BERTH-A (MONITORING)",
      "map.berth_b_backup": "BERTH-B (BACKUP OPEN)",
      "map.corridor_coords": "38°15'N · 26°45'E (AEGEAN CORRIDOR)",
      "map.engine_cesium": "Cesium 3D",
      "map.engine_cesium_fallback": "Cesium 3D (Fallback)",
      "map.engine_maplibre": "MapLibre + deck.gl",
      "map.engine_maplibre_fallback": "MapLibre (Vector Fallback)",
      "map.engine_svg": "Local Vector (0 ms)",
      "map.heli_name": "SAR HELICOPTER-04",
      "map.hud_cesium_note": "CESIUM 3D CORRIDOR VIEW ACTIVE · 100% OFFLINE LOCAL ELLIPSOID (0 EXTERNAL REQUESTS)",
      "map.hud_maplibre_note": "MAPLIBRE GL + DECK.GL + PMTILES ACTIVE · 100% LOCAL VECTOR MAP (0 EXTERNAL REQUESTS)",
      "map.layer_airspace": "▲ Airspace",
      "map.layer_ais": "● Vessel Tracks",
      "map.layer_berth": "■ Port Berths",
      "map.layer_h3": "⬡ Wave Risk Cells",
      "map.layer_route": "━ Route Corridor",
      "map.legend_claim": "◆ Statement",
      "map.legend_graph": "Causal Flow",
      "map.legend_hyp": "▲ Forecast",
      "map.legend_obs": "● Sensor Reading",
      "map.legend_shortcut": "Shortcut:",
      "map.port_sigacik": "SEFERIHISAR / SIGACIK PORT",
      "map.port_vathi": "SAMOS / VATHI PORT",
      "map.sheltered_corridor": "ALTERNATE ROUTE: SOUTH SAMOS SHELTERED CORRIDOR",
      "map.vessel_name": "AEGEAN FERRY-01",
      "map.zero_external_tiles": "0 External Tile Requests",
      "modal.close_esc": "Close (ESC)",
      "modal.cmdk_aria": "Quick Command and Search Bar",
      "modal.cmdk_placeholder": "Type vessel, time, or command (e.g. 08:10, 08:25, Berth-B, Turkish, Technical)…",
      "modal.cmdk_title": "Quick Command & Search Bar (Vessel · Event · Rule · Language · View)",
      "modal.seal_aria": "Audit Seal and Source Authority Manifest Inspector",
      "source.ais_terrestrial_aegean": "Vessel Traffic AIS",
      "source.ferry_operator_dispatch": "Ferry Dispatch",
      "source.nmea2000_bridge_bus": "Bridge NMEA Sensor",
      "source.open_meteo_marine_ensemble": "Marine Weather Forecast",
      "source.opensky_aegean_adsb": "Airspace",
      "source.port_berth_sensor_sigacik": "Port Sensor",
      "stage.aria_region": "Tactical Map and Causal Flow Stage",
      "stage.aria_tabs": "Map and Causal Flow Tabs",
      "stage.tab_graph": "[G] Causal Flow & \"What-If\" Desk",
      "stage.tab_map": "[M] Air-Gapped Tactical Map",
      "table.aria_filter": "Evidence Type Filter",
      "table.aria_grid": "Virtualized Event Stream Table",
      "table.filter_all": "All",
      "table.filter_quarantine": "⛔ Blocked",
      "topbar.aria_locale": "Language Switcher (TR or EN, Shortcut: L)",
      "topbar.aria_register": "Plain or Technical View Switcher (Shortcut: S)",
      "topbar.aria_sources": "Live Data Source Health Indicators",
      "topbar.aria_theme": "Bridge Lighting Mode",
      "topbar.aria_units": "Speed, Distance, and Clock Unit Selector",
      "topbar.clock_local": "Local Time",
      "topbar.clock_utc": "UTC",
      "topbar.register_plain": "Plain View",
      "topbar.register_plain_hint": "Plain Operator View (Shortcut: S)",
      "topbar.register_technical": "Technical View",
      "topbar.register_technical_hint": "Technical Audit View (Shortcut: S)",
      "topbar.search_btn": "⌕ Search (Ctrl+K)",
      "topbar.search_hint": "Quick Command, Vessel, and Event Search Bar (Ctrl+K / Cmd+K)",
      "topbar.theme_day": "Day",
      "topbar.theme_day_hint": "Daylight High-Contrast Mode (Alt+1)",
      "topbar.theme_dusk": "Dusk",
      "topbar.theme_dusk_hint": "Dusk Watch Mode (Alt+2)",
      "topbar.theme_night": "Night",
      "topbar.theme_night_hint": "Night Vision Preservation Mode (Alt+3)",
      "topbar.unit_km": "km",
      "topbar.unit_kmh": "km/h",
      "topbar.unit_kn": "knots",
      "topbar.unit_nm": "NM",
      "unit.km_short": "km",
      "unit.kmh_short": "km/h",
      "unit.kn_short": "kn",
      "unit.meter_short": "m",
      "unit.min_short": "min",
      "unit.mps_short": "m/s",
      "unit.nm_short": "NM",
      "unit.sec_short": "s"
    },
    "plain": {
      "agent.redteam.alert": "Under adverse weather and queue load, {count} safety limits are exceeded (peak delay {p95_label}, wave {wave_label}).",
      "agent.redteam.nominal": "Wave height, crosswind, and berthing window remain within safety limits.",
      "agent.sentinel.alert": "{total} items need attention: {quarantined} blocked duplicate packet, {stale} delayed sensor, {conflicts} source conflict.",
      "agent.sentinel.anomaly_conflict": "Operator statement ({min_label}) disagrees with direct sensor reading ({max_label}); both records are preserved side by side.",
      "agent.sentinel.anomaly_equivocation": "Security Alert: {source_name} sent conflicting data under the same sequence number and was blocked.",
      "agent.sentinel.anomaly_rejected": "A packet from {source_name} failed security verification and was blocked.",
      "agent.sentinel.anomaly_stale": "{source_name} update is delayed ({age_sec} s elapsed).",
      "agent.sentinel.nominal": "All sensors are up to date; no blocked packets or conflicting reports.",
      "agent.strategist.coa1_rationale": "Bypasses main ramp congestion by docking at sheltered Alternate Berth-B, bringing arrival back within safety limits.",
      "agent.strategist.coa1_title": "Option A: Divert to Alternate Berth (Berth-B) — Time Saved: 18 min",
      "agent.strategist.coa2_rationale": "Uses the South Samos leeward corridor to lower open-sea wave exposure and synchronize berth gate clearance.",
      "agent.strategist.coa2_title": "Option B: Switch to South Samos Sheltered Route / Hold 25 min in Port",
      "assistant.drawer_badge": "Verified Field Evidence",
      "assistant.drawer_title": "Proactive Command Assistant",
      "assistant.reply_cf": "In the what-if simulation, status shifts from \"{base_verdict}\" to \"{branch_verdict}\" (time impact: {delta_label}).",
      "assistant.reply_conflict": "Operator statement ({min_label}) differs from direct sensor reading ({max_label}); both records are kept side by side without overwriting.",
      "assistant.reply_missing": "Independent sensor confirmation has not arrived yet, so action approval remains on hold.",
      "assistant.reply_summary": "As of {clock}, system status is: {verdict_label}.",
      "assistant.tools_label": "Verification Steps Used:",
      "card.auditor_lock_banner": "Auditor Lock: Action cannot be approved on a single-source statement; awaiting independent sensor confirmation.",
      "card.delta_groups_label": "Confirming Sensor Groups:",
      "card.delta_safety_label": "Safety Gain:",
      "card.delta_time_label": "Time Impact:",
      "card.delta_verdict_label": "Projected Outcome:",
      "card.sealed_banner": "✓ Approved by Operator and Recorded in Tamper-Proof Log",
      "conductor.readout_prefix": "System Received At:",
      "conductor.title": "Timeline: Happened At / Received At",
      "conductor.track_lower": "Received At",
      "conductor.track_upper": "Happened At",
      "conflict.box_subtitle": "Operator Statement vs. Direct Sensor Reading",
      "conflict.box_title": "Conflicting Sources Kept Side by Side (Never Averaged)",
      "counterfactual.branch_title": "What-If Scenario Simulation",
      "dock.auditor_locked": "Awaiting Confirmation",
      "dock.auditor_ready": "Ready for Approval",
      "dock.header_badge": "Human Approval Required",
      "dock.header_title": "4 Specialist Agent Recommendations & Operator Approval",
      "dock.redteam_meta": "At-Risk Limits: {count}",
      "dock.sentinel_meta": "Alerts: {count}",
      "dock.strategist_meta": "Options: {count}",
      "epistemic.CLAIM": "Reported Statement",
      "epistemic.HYPOTHESIS": "Model Forecast / Estimate",
      "epistemic.OBSERVATION": "Direct Sensor Reading",
      "explain.outcome_summary": "Status: {verdict_label}. Confirming independent sensor groups: {group_count}. All records verified in the audit log.",
      "graph.cf_result_seal": "Isolated Simulation Verified (Live Screen Unchanged)",
      "graph.cf_result_title": "What-If Simulation Result:",
      "graph.cf_result_transition": "New Status: {base_verdict} → {branch_verdict}",
      "graph.chain_banner": "\"Port Ramp Fault (+35 min)\" ──► \"Safe Berthing Window Exceeded\"",
      "graph.conflict_edge": "⚡ Source Disagreement (20 min Gap)",
      "graph.desk_group": "Independent Source Category:",
      "graph.desk_selected_node": "Selected Data Source:",
      "graph.desk_seq": "Record Sequence:",
      "graph.desk_value": "Measured / Reported Value:",
      "graph.gate_corroborated": "Confirmed Source Groups: {count}",
      "graph.gate_threshold": "Requirement: At Least 2 Independent Sensors",
      "graph.gate_title": "DUAL-SOURCE CONFIRMATION GATE",
      "graph.node_val_adsb": "450 m Airspace Radar",
      "graph.node_val_ais": "+35 min Vessel AIS Reading",
      "graph.node_val_meteo": "Wave Forecast: 3.15 m",
      "graph.node_val_ops": "+15 min Operator Report",
      "graph.node_val_port": "+35 min Berth Sensor",
      "graph.quarantine_sub": "Security Protection: System State Unchanged",
      "graph.quarantine_title": "⛔ Conflicting Duplicate Blocked",
      "map.hud_slice_summary": "Viewed Time: {clock} · Expected Delay Range: {p50} / {p95}",
      "map.vessel_conflict_sub": "Sensor: +35 min ≠ Operator Report: +15 min",
      "map.vessel_single_sub": "Operator Report: +15 min (Awaiting Sensor Confirmation)",
      "seal_modal.no_sealed_cards": "No decision card has been approved and recorded yet.",
      "seal_modal.packets_summary": "{accepted} verified records accepted · {rejected} suspicious records blocked (system state preserved)",
      "seal_modal.sealed_cards_heading": "Approved & Recorded Operator Decisions ({count}):",
      "seal_modal.title": "System Integrity Seal & Data Source Authority Summary",
      "security.ERR_SOURCE_EQUIVOCATION": "Security Alert: Conflicting Duplicate From Source (Blocked)",
      "stage.active_rule_label": "Active Safety Rule: Safe Berthing Window (Max 20 min Delay)",
      "table.col_epistemic": "Evidence Type",
      "table.col_event": "Record ID",
      "table.col_learned": "Received At",
      "table.col_observed": "Happened At",
      "table.col_seq": "Sequence",
      "table.col_source": "Data Source",
      "table.col_status": "Status",
      "table.col_value": "Reading / Value",
      "table.status_active": "Active at This Time",
      "table.status_future": "Not Yet Received",
      "table.status_quarantined": "Blocked by Security Check",
      "table.toolbar_title": "Live and Recorded Event Stream ({count} Records)",
      "temporal.bitemporal_axis": "Happened At / Received At",
      "topbar.policy_badge": "Maritime Berthing Safety",
      "topbar.seal_badge_label": "✓ Audit Seal Verified",
      "topbar.seal_badge_title": "View system integrity seal and approved decision log",
      "topbar.system_mode_badge": "Consistent Safety Mode",
      "topbar.transport_airgapped": "◆ 100% Offline Local Package",
      "topbar.transport_cpp_engine": "● Local Engine Stream",
      "topbar.transport_live_airlock": "● Live Field Connection",
      "topbar.transport_ws_replay": "● Local Replay Stream",
      "topbar.verdict_prefix": "STATUS:",
      "verdict.GEÇTİ": "Safe to Proceed",
      "verdict.KANIT_YETERSİZ": "Single-Source Report — Awaiting Confirmation",
      "verdict.KURAL_İHLALİ": "Safety Rule Breached — Action Required"
    },
    "technical": {
      "agent.redteam.alert": "12-World p95 stress envelope breached {count} rules (p95={p95_fp} fp, wave_p95={wave_fp} fp).",
      "agent.redteam.nominal": "12-World p50/p95 risk envelope is within MARITIME_SAFETY_V2 bounds.",
      "agent.sentinel.alert": "{total} anomalies flagged ({quarantined} INGEST_REJECTED quarantined, {stale} STALE sensors, {conflicts} epistemic conflicts).",
      "agent.sentinel.anomaly_conflict": "{subject_id}.{metric_key} conflict [{min_fp} fp vs {max_fp} fp]; both event_id records preserved.",
      "agent.sentinel.anomaly_equivocation": "SECURITY_ALERT_EQUIVOCATION: ({source_id}, seq_no={seq_no}) blocked; state_blake3 mutated by 0 bits.",
      "agent.sentinel.anomaly_rejected": "INGEST_REJECTED ({error_code}): source_id={source_id}, event_id={event_id}.",
      "agent.sentinel.anomaly_stale": "{source_id} exceeded max_staleness_ms ({age_ms} ms > {max_ms} ms).",
      "agent.sentinel.nominal": "All Ed25519 signatures and max_staleness_ms windows are within nominal bounds.",
      "agent.strategist.coa1_rationale": "Allocates leeward BERTH_02 ramp to reduce queue delay to 17000000 fp and clear RULE_SLA_BREACH_CORROBORATED.",
      "agent.strategist.coa1_title": "COA-01 (cf_01): BERTH_02 Alternate Ramp Allocation (Δdelay=-18000000 fp)",
      "agent.strategist.coa2_rationale": "Switches to South Samos sheltered corridor to lower wave_p95 exposure and synchronize berth gate lock.",
      "agent.strategist.coa2_title": "COA-02 (cf_02): ROUTE_SHELTER_01 South Samos Corridor (fp_val=16000000)",
      "assistant.drawer_badge": "Zero Hallucination",
      "assistant.drawer_title": "Evidence-Bound Command Assistant (Mandatory MCP Output)",
      "assistant.reply_cf": "Counterfactual ({branch_id}): {base_verdict} -> {branch_verdict} (Δdelay={delta_fp} fp, branch_blake3={branch_hash}…).",
      "assistant.reply_conflict": "Conflict Preserved: {subject_id}.{metric_key} [{min_fp} fp vs {max_fp} fp] ({sources}).",
      "assistant.reply_missing": "Missing independence_group: {missing_groups}.",
      "assistant.reply_summary": "[MCP Evidence Reply] cutoff={cutoff_ms} ms | verdict={verdict_code} | rule={rule_id} | state_blake3={state_hash}…",
      "assistant.tools_label": "MCP Tools Invoked:",
      "card.auditor_lock_banner": "AUDITOR FAIL-CLOSED LOCK: Ed25519 seal forbidden without independent OBSERVATION corroboration (KANIT_YETERSİZ).",
      "card.delta_groups_label": "independence_group:",
      "card.delta_safety_label": "Δ Safety/Risk:",
      "card.delta_time_label": "Δ Delay:",
      "card.delta_verdict_label": "Counterfactual:",
      "card.sealed_banner": "✓ ED25519 SIGNED & SEALED · pubkey={pubkey}… · sig={sig}…",
      "conductor.readout_prefix": "cutoff_learned_at_ms =",
      "conductor.title": "Bi-Temporal Time Conductor (observed_at_ms vs. cutoff_learned_at_ms)",
      "conductor.track_lower": "learned_at_ms",
      "conductor.track_upper": "observed_at_ms",
      "conflict.box_subtitle": "{subject_id}.{metric_key} · independence_group comparison",
      "conflict.box_title": "A-2 Epistemic Conflict Matrix (Preserved Side by Side · Unaveraged)",
      "counterfactual.branch_title": "Counterfactual Delta · Isolated branch_state_blake3 diff analysis",
      "dock.auditor_locked": "FAIL-CLOSED",
      "dock.auditor_ready": "AWAITING ED25519",
      "dock.header_badge": "CAELUS_AG_UI_V1",
      "dock.header_title": "4 Specialist Agents & Human-Signed Action Dock",
      "dock.redteam_meta": "Breaches: {count}",
      "dock.sentinel_meta": "Anomalies: {count}",
      "dock.strategist_meta": "COA: {count} Branches",
      "epistemic.CLAIM": "EPISTEMIC: CLAIM · Human or external authority statement",
      "epistemic.HYPOTHESIS": "EPISTEMIC: HYPOTHESIS · Numerical weather model or agent inference",
      "epistemic.OBSERVATION": "EPISTEMIC: OBSERVATION · Calibrated hardware / AIS / NMEA record",
      "explain.outcome_summary": "EXPLAIN_OUTCOME · verdict={verdict_code} · rule={rule_id} · groups={group_count} · state_blake3={state_blake3}",
      "graph.cf_result_seal": "branch_state_blake3: {branch_hash}",
      "graph.cf_result_title": "Counterfactual Delta ({branch_id}):",
      "graph.cf_result_transition": "Verdict Shift: {base_verdict} → {branch_verdict}",
      "graph.chain_banner": "port_berth_sensor_sigacik (delay_min_fp=35000000) ──► RULE_SLA_BREACH_CORROBORATED (>20000000 fp)",
      "graph.conflict_edge": "⚡ CONFLICT (Δ 20000000 fp · 20.0 min)",
      "graph.desk_group": "independence_group:",
      "graph.desk_selected_node": "Selected source_id:",
      "graph.desk_seq": "Latest seq_no (64-Bit String):",
      "graph.desk_value": "Fixed-Point Value (1e6):",
      "graph.gate_corroborated": "independence_group count: {count}",
      "graph.gate_threshold": "Threshold: ≥2 OBSERVATION / Group",
      "graph.gate_title": "A-2 EPISTEMIC GATE",
      "graph.node_val_adsb": "baro_alt_m_fp=450000000 (OBSERVATION)",
      "graph.node_val_ais": "delay_min_fp=35000000 (OBSERVATION)",
      "graph.node_val_meteo": "wave_p95_m_fp=3150000 (3.15 m)",
      "graph.node_val_ops": "delay_min_fp=15000000 (CLAIM)",
      "graph.node_val_port": "delay_min_fp=35000000 (seq>2^53)",
      "graph.quarantine_sub": "ERR_SOURCE_EQUIVOCATION · 0-Bit state_blake3 Impact",
      "graph.quarantine_title": "⛔ ev_103_equivocation (QUARANTINED)",
      "map.hud_slice_summary": "Slice: {clock} · 12-World Risk Band p50/p95: {p50} / {p95}",
      "map.vessel_conflict_sub": "AIS:+35000000 fp (OBSERVATION) ≠ OPS:+15000000 fp (CLAIM)",
      "map.vessel_single_sub": "OPS:+15000000 fp (CLAIM · Missing independence_group)",
      "seal_modal.no_sealed_cards": "No action card has been Ed25519-signed by the operator yet.",
      "seal_modal.packets_summary": "{accepted} accepted / {rejected} quarantined (0-bit state_blake3 mutation guaranteed)",
      "seal_modal.sealed_cards_heading": "Ed25519-Sealed Operator Action Cards ({count}):",
      "seal_modal.title": "Cryptographic Seal & Source Manifest v2.0 Inspector",
      "security.ERR_SOURCE_EQUIVOCATION": "SECURITY_ALERT_EQUIVOCATION · Same ({source_id}, seq_no={seq_no}), divergent blake3",
      "stage.active_rule_label": "Active Rule: {rule_id} (threshold={max_allowed_fp} fp)",
      "table.col_epistemic": "Epistemic Status",
      "table.col_event": "event_id",
      "table.col_learned": "learned_at_ms",
      "table.col_observed": "observed_at_ms",
      "table.col_seq": "seq_no (64-Bit String)",
      "table.col_source": "source_id / Group",
      "table.col_status": "Slice Status",
      "table.col_value": "Fixed-Point (1e6)",
      "table.status_active": "ACTIVE IN SLICE",
      "table.status_future": "Not Yet Learned (Future Slice)",
      "table.status_quarantined": "QUARANTINED · {error_code} (0-Bit)",
      "table.toolbar_title": "Virtualized Telemetry Stream ({count} Events · CLS=0)",
      "temporal.bitemporal_axis": "observed_at_ms vs. cutoff_learned_at_ms (No Look-Ahead Slice)",
      "topbar.policy_badge": "policy_id: MARITIME_SAFETY_V2",
      "topbar.seal_badge_label": "state_blake3 & audit_head",
      "topbar.seal_badge_title": "Inspect state_blake3, audit_head_blake3, Manifest v2.0 Ed25519 signature, and audit chain",
      "topbar.system_mode_badge": "DET-MODE · FP_SCALE=1e6",
      "topbar.transport_airgapped": "◆ AIR-GAPPED · CAELUS_INTEL_V2 LOCAL BUNDLE",
      "topbar.transport_cpp_engine": "● C++ ENGINE (:47809 · OFFLINE REPLAY)",
      "topbar.transport_live_airlock": "● LIVE AIRLOCK (:47809 · CAELUS_AG_UI_V1)",
      "topbar.transport_ws_replay": "● OFFLINE REPLAY (:47809 · CAELUS_AG_UI_V1)",
      "topbar.verdict_prefix": "VERDICT:",
      "verdict.GEÇTİ": "VERDICT: PASS · Policy {policy_id} + state_blake3 seal",
      "verdict.KANIT_YETERSİZ": "VERDICT: INSUFFICIENT_EVIDENCE · Missing independence_group: {missing_groups}",
      "verdict.KURAL_İHLALİ": "VERDICT: RULE_BREACH · Breached rule {rule_id} & threshold {threshold_label}"
    }
  }
};

  function cloneCatalog(src) {
    return JSON.parse(JSON.stringify(src));
  }

  function loadRuntimeCatalog(repoRootDir) {
    const active = cloneCatalog(EMBEDDED_LOCALE_CATALOG);
    if (nodeFs && nodePath) {
      const rootDir = repoRootDir || nodePath.resolve(__dirname, "..");
      const localesRoot = nodePath.join(rootDir, "locales");
      if (nodeFs.existsSync(localesRoot)) {
        for (const loc of Object.keys(active)) {
          for (const ns of ["common", "plain", "technical"]) {
            const fp = nodePath.join(localesRoot, loc, ns + ".json");
            if (nodeFs.existsSync(fp)) {
              try {
                active[loc][ns] = JSON.parse(nodeFs.readFileSync(fp, "utf8"));
              } catch (_) {}
            }
          }
        }
      }
    }
    return active;
  }

  const runtimeCatalog = loadRuntimeCatalog();

  function normalizeLocale(locale) {
    const s = String(locale || DEFAULT_LOCALE).trim().toLowerCase();
    return runtimeCatalog[s] ? s : DEFAULT_LOCALE;
  }

  function normalizeRegister(register) {
    const s = String(register || DEFAULT_REGISTER).trim().toLowerCase();
    return s === "technical" ? "technical" : "plain";
  }

  function getIntlLocaleTag(locale) {
    const loc = normalizeLocale(locale);
    return loc === "tr" ? "tr-TR" : "en-US";
  }

  function interpolateTemplate(templateStr, params = {}) {
    if (typeof templateStr !== "string") return "";
    return templateStr.replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key) => {
      if (Object.prototype.hasOwnProperty.call(params, key) && params[key] !== undefined && params[key] !== null) {
        return String(params[key]);
      }
      return "{" + key + "}";
    });
  }

  /**
   * Çift eksenli sözlük sorgusu (`locale` × `register`).
   * Önce seçili `register` (`plain` veya `technical`), bulunamazsa `common` sözlüğüne bakar.
   */
  function t(key, params = {}, ctx = {}) {
    const loc = normalizeLocale(ctx.locale);
    const reg = normalizeRegister(ctx.register);
    const bundle = runtimeCatalog[loc] || runtimeCatalog[DEFAULT_LOCALE];
    const regDict = bundle[reg] || {};
    const commonDict = bundle.common || {};
    const raw = Object.prototype.hasOwnProperty.call(regDict, key)
      ? regDict[key]
      : Object.prototype.hasOwnProperty.call(commonDict, key)
        ? commonDict[key]
        : key;
    return interpolateTemplate(raw, params);
  }

  function registerLocaleCatalog(localeCode, bundleObj) {
    const code = String(localeCode || "").trim().toLowerCase();
    if (!code || !bundleObj) return false;
    runtimeCatalog[code] = {
      common: { ...(bundleObj.common || {}) },
      plain: { ...(bundleObj.plain || {}) },
      technical: { ...(bundleObj.technical || {}) },
    };
    if (!SUPPORTED_LOCALES.includes(code)) {
      SUPPORTED_LOCALES.push(code);
    }
    return true;
  }

  function formatDecimalFromFpBigInt(fpBig, decimals, locale, explicitPlus = false) {
    const neg = fpBig < 0n;
    const abs = neg ? -fpBig : fpBig;
    const scale = 1000000n;
    let factor = 1n;
    for (let i = 0; i < decimals; i++) factor *= 10n;
    const step = scale / factor;
    const roundedUnits = (abs + step / 2n) / step;
    const intPart = roundedUnits / factor;
    const fracPart = roundedUnits % factor;
    const numVal = Number(intPart) + (decimals > 0 ? Number(fracPart) / Number(factor) : 0);

    let formatted;
    try {
      formatted = new Intl.NumberFormat(getIntlLocaleTag(locale), {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      }).format(numVal);
    } catch (_) {
      const sep = normalizeLocale(locale) === "tr" ? "," : ".";
      formatted =
        decimals > 0
          ? intPart.toString() + sep + fracPart.toString().padStart(decimals, "0")
          : intPart.toString();
    }
    const prefix = neg ? "-" : explicitPlus ? "+" : "";
    return prefix + formatted;
  }

  function formatFpMinutes(fpDecStr, ctx = {}) {
    const loc = normalizeLocale(ctx.locale);
    const minUnit = t("unit.min_short", {}, { locale: loc });
    const explicitPlus = ctx.signed !== false;
    try {
      const v = BigInt(String(fpDecStr || "0"));
      const numStr = formatDecimalFromFpBigInt(v, 1, loc, explicitPlus);
      return numStr + " " + minUnit;
    } catch (_) {
      return String(fpDecStr || "0") + " " + minUnit;
    }
  }

  function formatFpMeters(fpDecStr, ctx = {}) {
    const loc = normalizeLocale(ctx.locale);
    const mUnit = t("unit.meter_short", {}, { locale: loc });
    const decimals = ctx.decimals === 1 ? 1 : 2;
    try {
      const v = BigInt(String(fpDecStr || "0"));
      return formatDecimalFromFpBigInt(v, decimals, loc, false) + " " + mUnit;
    } catch (_) {
      return String(fpDecStr || "0") + " " + mUnit;
    }
  }

  /**
   * Sabit noktalı knot değerini (`1e6` ölçekli) kayan nokta hatası olmadan `knot` veya `km/sa` (`km/h`) olarak biçimler.
   * Tam dönüşüm: `1 knot = 1.852 km/h` -> `(fp * 1852n + 500n) / 1000n`.
   */
  function formatFpSpeedKn(fpKnDecStr, ctx = {}) {
    const loc = normalizeLocale(ctx.locale);
    const speedUnit = ctx.speedUnit === "kmh" ? "kmh" : "kn";
    try {
      const knFp = BigInt(String(fpKnDecStr || "0"));
      if (speedUnit === "kmh") {
        const kmhFp = (knFp * 1852n + 500n) / 1000n;
        return formatDecimalFromFpBigInt(kmhFp, 1, loc, false) + " " + t("unit.kmh_short", {}, { locale: loc });
      }
      return formatDecimalFromFpBigInt(knFp, 1, loc, false) + " " + t("unit.kn_short", {}, { locale: loc });
    } catch (_) {
      return String(fpKnDecStr || "0") + " " + t("unit.kn_short", {}, { locale: loc });
    }
  }

  /**
   * Sabit noktalı deniz mili (`NM * 1e6`) değerini `NM` veya `km` olarak biçimler.
   */
  function formatFpDistanceNm(fpNmDecStr, ctx = {}) {
    const loc = normalizeLocale(ctx.locale);
    const distUnit = ctx.distanceUnit === "km" ? "km" : "nm";
    try {
      const nmFp = BigInt(String(fpNmDecStr || "0"));
      if (distUnit === "km") {
        const kmFp = (nmFp * 1852n + 500n) / 1000n;
        return formatDecimalFromFpBigInt(kmFp, 1, loc, false) + " " + t("unit.km_short", {}, { locale: loc });
      }
      return formatDecimalFromFpBigInt(nmFp, 1, loc, false) + " " + t("unit.nm_short", {}, { locale: loc });
    } catch (_) {
      return String(fpNmDecStr || "0") + " " + t("unit.nm_short", {}, { locale: loc });
    }
  }

  function formatClockMs(msDecStr, ctx = {}) {
    const loc = normalizeLocale(ctx.locale);
    const clockMode = ctx.clockMode === "LOCAL" ? "LOCAL" : "UTC";
    try {
      const ms = Number(BigInt(String(msDecStr)));
      const d = new Date(ms);
      if (clockMode === "LOCAL") {
        const hhmmss = new Intl.DateTimeFormat(getIntlLocaleTag(loc), {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: false,
        }).format(d);
        return hhmmss + " " + t("topbar.clock_local", {}, { locale: loc });
      }
      const hh = String(d.getUTCHours()).padStart(2, "0");
      const mm = String(d.getUTCMinutes()).padStart(2, "0");
      const ss = String(d.getUTCSeconds()).padStart(2, "0");
      return hh + ":" + mm + ":" + ss + " UTC";
    } catch (_) {
      return String(msDecStr) + " ms";
    }
  }

  function formatVerdict(verdictCode, params = {}, ctx = {}) {
    const code = String(verdictCode || "KANIT_YETERSİZ");
    const loc = normalizeLocale(ctx.locale);
    const reg = normalizeRegister(ctx.register);
    const key = "verdict." + code;
    const thresholdLabel = params.threshold_label || formatFpMinutes(String(params.max_allowed_fp || "20000000"), { locale: loc, signed: false });
    return t(
      key,
      {
        policy_id: params.policy_id || "MARITIME_SAFETY_V2",
        rule_id: params.rule_id || "RULE_SLA_BREACH_CORROBORATED",
        threshold_label: thresholdLabel,
        missing_groups:
          Array.isArray(params.missing_groups) && params.missing_groups.length > 0
            ? params.missing_groups.join(", ")
            : params.missing_groups || "OBSERVATION",
      },
      { locale: loc, register: reg }
    );
  }

  function formatEpistemic(epistemicCode, ctx = {}) {
    const code = String(epistemicCode || "CLAIM").toUpperCase();
    return t("epistemic." + code, {}, ctx);
  }

  function formatEpistemicShort(epistemicCode, ctx = {}) {
    const reg = normalizeRegister(ctx.register);
    const code = String(epistemicCode || "CLAIM").toUpperCase();
    if (reg === "technical") return code;
    return t("epistemic." + code, {}, { locale: ctx.locale, register: "plain" });
  }

  function formatSourceName(sourceId, ctx = {}) {
    const reg = normalizeRegister(ctx.register);
    const rawId = String(sourceId || "unknown");
    if (reg === "technical") return rawId;
    const key = "source." + rawId;
    const resolved = t(key, {}, { locale: ctx.locale, register: "plain" });
    return resolved === key ? rawId : resolved;
  }

  function formatAlarmBadge(severityOrVerdict, ctx = {}) {
    const s = String(severityOrVerdict || "").toUpperCase();
    if (s === "CRITICAL" || s === "KURAL_İHLALİ") return t("alarm.critical", {}, ctx);
    if (s === "SERIOUS") return t("alarm.serious", {}, ctx);
    if (s === "CAUTION" || s === "STALE") return t("alarm.caution", {}, ctx);
    if (s === "NOMINAL" || s === "GEÇTİ" || s === "FRESH") return t("alarm.nominal", {}, ctx);
    return t("alarm.awaiting", {}, ctx);
  }

  /**
   * §2.1 Kanonik Mesaj Anahtarı Çözümleyici:
   * Çekirdek ve Sidecar yalnızca `msg_id` + `params` üretir; bu fonksiyon seçili `locale` ve `register`
   * için insan veya denetim metnini deterministik olarak üretir.
   */
  function resolveCanonicalMessage(msgId, params = {}, ctx = {}) {
    const loc = normalizeLocale(ctx.locale);
    const reg = normalizeRegister(ctx.register);
    const id = String(msgId || "");

    if (id === "verdict.pass") {
      return formatVerdict("GEÇTİ", params, { locale: loc, register: reg });
    }
    if (id === "verdict.rule_breach") {
      return formatVerdict("KURAL_İHLALİ", params, { locale: loc, register: reg });
    }
    if (id === "verdict.insufficient_corroboration") {
      return formatVerdict("KANIT_YETERSİZ", params, { locale: loc, register: reg });
    }
    if (id === "epistemic.observation") {
      return formatEpistemic("OBSERVATION", { locale: loc, register: reg });
    }
    if (id === "epistemic.claim") {
      return formatEpistemic("CLAIM", { locale: loc, register: reg });
    }
    if (id === "epistemic.hypothesis") {
      return formatEpistemic("HYPOTHESIS", { locale: loc, register: reg });
    }
    if (id === "security.source_equivocation") {
      return t(
        "security.ERR_SOURCE_EQUIVOCATION",
        {
          source_id: params.source_id || "unknown",
          seq_no: String(params.seq_no || "0"),
        },
        { locale: loc, register: reg }
      );
    }
    if (id === "temporal.bitemporal_slice") {
      return t("temporal.bitemporal_axis", params, { locale: loc, register: reg });
    }
    if (id === "counterfactual.branch_delta") {
      return t("counterfactual.branch_title", params, { locale: loc, register: reg });
    }
    if (id === "explain.outcome") {
      const verdictCode = String(params.verdict_code || "KANIT_YETERSİZ");
      const verdictLabel = formatVerdict(verdictCode, params, { locale: loc, register: "plain" });
      return t(
        "explain.outcome_summary",
        {
          verdict_label: verdictLabel,
          verdict_code: verdictCode,
          rule_id: params.rule_id || "—",
          group_count: String(params.group_count !== undefined ? params.group_count : "0"),
          state_blake3: String(params.state_blake3 || ""),
        },
        { locale: loc, register: reg }
      );
    }
    return t(id, params, { locale: loc, register: reg });
  }

  function verifyCatalogParity() {
    const issues = [];
    const baseCommon = Object.keys(runtimeCatalog.tr.common).sort();
    const basePlain = Object.keys(runtimeCatalog.tr.plain).sort();
    const baseTech = Object.keys(runtimeCatalog.tr.technical).sort();

    if (JSON.stringify(basePlain) !== JSON.stringify(baseTech)) {
      issues.push("TR plain vs technical keys differ");
    }

    for (const loc of Object.keys(runtimeCatalog)) {
      const cKeys = Object.keys(runtimeCatalog[loc].common || {}).sort();
      const pKeys = Object.keys(runtimeCatalog[loc].plain || {}).sort();
      const tKeys = Object.keys(runtimeCatalog[loc].technical || {}).sort();
      if (JSON.stringify(cKeys) !== JSON.stringify(baseCommon)) {
        issues.push(loc + "/common keys differ from tr/common");
      }
      if (JSON.stringify(pKeys) !== JSON.stringify(basePlain)) {
        issues.push(loc + "/plain keys differ from tr/plain");
      }
      if (JSON.stringify(tKeys) !== JSON.stringify(baseTech)) {
        issues.push(loc + "/technical keys differ from tr/technical");
      }
      for (const [ns, dict] of [
        ["common", runtimeCatalog[loc].common],
        ["plain", runtimeCatalog[loc].plain],
        ["technical", runtimeCatalog[loc].technical],
      ]) {
        for (const [k, v] of Object.entries(dict || {})) {
          if (typeof v !== "string" || v.trim().length === 0) {
            issues.push(loc + "/" + ns + ":" + k + " is empty");
          }
        }
      }
    }

    return {
      ok: issues.length === 0,
      locales: Object.keys(runtimeCatalog),
      commonKeyCount: baseCommon.length,
      plainKeyCount: basePlain.length,
      technicalKeyCount: baseTech.length,
      issues,
    };
  }

  return {
    DEFAULT_LOCALE,
    DEFAULT_REGISTER,
    SUPPORTED_LOCALES,
    SUPPORTED_REGISTERS,
    EMBEDDED_LOCALE_CATALOG,
    normalizeLocale,
    normalizeRegister,
    getIntlLocaleTag,
    t,
    registerLocaleCatalog,
    formatFpMinutes,
    formatFpMeters,
    formatFpSpeedKn,
    formatFpDistanceNm,
    formatClockMs,
    formatVerdict,
    formatEpistemic,
    formatEpistemicShort,
    formatSourceName,
    formatAlarmBadge,
    resolveCanonicalMessage,
    verifyCatalogParity,
    getCatalogSnapshot() {
      return cloneCatalog(runtimeCatalog);
    },
  };
});
