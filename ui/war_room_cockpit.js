/**
 * CAELUS OS — 4-Bölgeli Endüstriyel Komuta Kokpiti Denetleyicisi (`war_room_cockpit.js`)
 *
 * Katman 1 & Katman 4 (Master Spesifikasyon §2.1, §2.2, §5.1, §5.2, §5.3):
 * - Çift Eksenli Dil ve Bilişsel Ergonomi: `locale` ("tr" | "en") × `register` ("plain" | "technical").
 * - Varsayılan Açılış Modu: `locale = "tr"`, `register = "plain"` (Sade Operatör Görünümü).
 * - Bölge 1: `TopCommandBar` (Sistem durumu, kaynak sağlık ışıkları, `[TR|EN]`, `[Sade|Teknik]`, birim/saat seçici, Day/Dusk/Night, Denetim Mührü)
 * - Bölge 2: `SpatialAndCausalStage` (Sekme 1: Hava Boşluklu Taktik Harita; Sekme 2: Nedensel Akış ve "Ya Şöyle Olursa?" Masası)
 * - Bölge 3: `BiTemporalTimeConductor` (Olay Anı vs. Sistemin Öğrendiği An) & Sanallaştırılmış `EventStreamTable` (`CLS = 0`)
 * - Bölge 4: `FourAgentCommandDock` (Gözcü, Stres Testi, Stratejist, Denetçi + `[Teknik Kanıtı Gör]` + Çok Dilli Proaktif Asistan)
 *
 * A-1 / A-2 / A-3 / A-4 Garantileri:
 * - Sıfır harici CDN / Google Fonts / çevrimiçi çeviri API'si / harita sunucusu isteği.
 * - Tüm 64-bit tam sayılar (`seq_no`, `fp_val`, `observed_at_ms`, `learned_at_ms`) ondalık ASCII `string` olarak işlenir.
 * - Dil (`L`) veya görünüm (`S`) değiştiğinde `state_blake3` 0 bit değişir; ekranın %100'ü anında seçili dil ve sadelik seviyesinde çizilir.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    const sidecarAirlock = require("./sidecar_airlock_mcp.js");
    const agUiEngine = require("./war_room_ag_ui_engine.js");
    const warRoomI18n = require("./war_room_i18n.js");
    module.exports = factory(sidecarAirlock, agUiEngine, warRoomI18n);
  } else {
    root.CaelusWarRoomCockpit = factory(
      root.CaelusSidecarAirlockMcp,
      root.CaelusWarRoomAgUiEngine,
      root.CaelusWarRoomI18n
    );
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (
  sidecarAirlock,
  agUiEngine,
  warRoomI18n
) {
  "use strict";

  const T1_CUTOFF_MS = "1762848600000"; // 2025-11-11T08:10:00Z -> KANIT_YETERSİZ
  const TAMPER_CHECK_MS = "1762848900000"; // 2025-11-11T08:15:00Z -> SOURCE_EQUIVOCATION karantina
  const T2_CUTOFF_MS = "1762849500000"; // 2025-11-11T08:25:00Z -> KURAL_İHLALİ
  const TIMELINE_MIN_MS = 1762848240000n;
  const TIMELINE_MAX_MS = 1762849560000n;
  const VIRTUAL_ROW_HEIGHT_PX = 36;

  // Deterministik Operatör Ed25519 Komuta Anahtar Tohumu (Yerel Hava Boşluklu İmzalama için)
  const DEFAULT_OPERATOR_SEED_HEX =
    "7172737475767778797a7b7c7d7e7f808182838485868788898a8b8c8d8e8f90";

  // %100 Hava Boşluklu (`file://` dahil) Başlangıç Paketi — `build-aegean-pilot` ile bit-özdeş
  const EMBEDDED_AEGEAN_PILOT_BUNDLE = Object.freeze({
    manifest_json: JSON.stringify({
      manifest_version: "2.0",
      require_v2_airlock: true,
      trust_anchor_pubkey: "f41f9e3038a8951ee21a3a82038c65c5369d370f117bb9d003f9fedc43a75703",
      manifest_sig:
        "23d2856579e5e2440ab20b9a207ec0b47ae78d635ec6c6ed8c4c22d6aec870320d9d759c5de5d3727110646a0dae0df1decad47757af7d8c2da6d67c718bae0d",
      sources: [
        {
          source_id: "ais_terrestrial_aegean",
          pubkey_ed25519: "e385635f6ffba8f1ab9557e9a8ed16df063b8c1f71aca83f46573c7b66d230c3",
          key_id: "ais-key-2026-q4",
          independence_group: "rf_ais_receiver",
          default_epistemic_status: "OBSERVATION",
          allowed_event_kinds: ["VESSEL_POSITION", "BERTH_PROXIMITY", "AIS_SIGNAL_LOST"],
          max_staleness_ms: "120000",
        },
        {
          source_id: "ferry_operator_dispatch",
          pubkey_ed25519: "cb135e0908265dbbcfce2f191d1aa31c47d38ba46a563f4ef392e2b91d17ec4b",
          key_id: "ops-key-2026-q4",
          independence_group: "carrier_human_ops",
          default_epistemic_status: "CLAIM",
          allowed_event_kinds: ["SCHEDULE_REPORT", "DELAY_NOTICE"],
          max_staleness_ms: "900000",
        },
        {
          source_id: "open_meteo_marine_ensemble",
          pubkey_ed25519: "ed4512c6b419114bc9b1afa8b31c538bd4f62e57e465a9b0a0b2d427d504d5ca",
          key_id: "wx-key-2026-q4",
          independence_group: "numerical_weather_model",
          default_epistemic_status: "HYPOTHESIS",
          allowed_event_kinds: ["WAVE_FORECAST", "WIND_GUST_ENVELOPE"],
          max_staleness_ms: "3600000",
        },
        {
          source_id: "port_berth_sensor_sigacik",
          pubkey_ed25519: "c9d769f0400bdb1bc0743e22d815a3ef43a99cfd09ab2be3a617d407a4cd2c6d",
          key_id: "port-key-2026-q4",
          independence_group: "port_plc_telemetry",
          default_epistemic_status: "OBSERVATION",
          allowed_event_kinds: ["BERTH_PROXIMITY", "RAMP_OBSERVATION", "SHORE_POWER_STATE"],
          max_staleness_ms: "180000",
        },
        {
          source_id: "opensky_aegean_adsb",
          pubkey_ed25519: "e988fc461de2c97eb480bf85cd2ab974c19549308c03400ea721483cd31a1725",
          key_id: "osky-key-2026-q4",
          independence_group: "airspace_adsb_receiver",
          default_epistemic_status: "OBSERVATION",
          allowed_event_kinds: ["AIRCRAFT_STATE_VECTOR", "AIRSPACE_EMERGENCY_SQUAWK"],
          max_staleness_ms: "120000",
        },
        {
          source_id: "nmea2000_bridge_bus",
          pubkey_ed25519: "99ad4ca5c1998b2454316a2e4d5cfd4e9ff002f609513aae7a579cc96b9822e5",
          key_id: "n2k-key-2026-q4",
          independence_group: "vessel_canbus_sensors",
          default_epistemic_status: "OBSERVATION",
          allowed_event_kinds: [
            "N2K_WIND_DATA",
            "N2K_WATER_DEPTH",
            "N2K_RUDDER_ANGLE",
            "N2K_ENGINE_RAPID",
          ],
          max_staleness_ms: "60000",
        },
      ],
    }),
    batch_ndjson: [
      '{"contract":"CAELUS_INTEL_V2","sig":"#sig=ed25519:ed4512c6b419114bc9b1afa8b31c538bd4f62e57e465a9b0a0b2d427d504d5ca:1f6057ae5ec036d184e413968a800977a5f492ee49a184a08a6d12c30f94e9663fff879dbdf6932e92b95a6785271062b45865ad23ac725468839e5c1dc7f60a","schema_version":"2.0","header":"open_meteo_marine_ensemble|wx-key-2026-q4|WAVE_FORECAST|ev_101|1|1762848240000|1762848300000|HYPOTHESIS|5c87256bd1717138ed9e6b418b3f50f68facc8afc9f18ae777f5a27c46987b2e","learned_at_ms":"1762848300000","payload_raw":"{\\"entity_id\\":\\"CORRIDOR_SIGACIK_VATHI\\",\\"fp_scale\\":1000000,\\"metrics\\":{\\"ocean_current_kn_fp\\":\\"1150000\\",\\"wave_m_fp\\":\\"1850000\\",\\"wave_p50_m_fp\\":\\"1750000\\",\\"wave_p95_m_fp\\":\\"2450000\\",\\"wave_period_s_fp\\":\\"6800000\\"},\\"rounding\\":\\"HALF_EVEN\\",\\"supersedes_event_id\\":null,\\"unit_schema\\":\\"SI_MARINE_V1\\"}"}',
      '{"contract":"CAELUS_INTEL_V2","sig":"#sig=ed25519:cb135e0908265dbbcfce2f191d1aa31c47d38ba46a563f4ef392e2b91d17ec4b:f7006ea2df2363a8da409f1b7e996307ab5a85fb87382c254d5c23f75f91d07fd7dcaf247b1831c71ea5da1f284c3ff66ff318bccf52b08c26a057d2b1769702","schema_version":"2.0","header":"ferry_operator_dispatch|ops-key-2026-q4|DELAY_NOTICE|ev_103|1|1762848570000|1762848600000|CLAIM|b8b797874e2d1d4a0e524b501bdbdf19ecc747d379f0e46beb54891a403e4c1f","learned_at_ms":"1762848600000","payload_raw":"{\\"entity_id\\":\\"VESSEL_AEGEAN_01\\",\\"fp_scale\\":1000000,\\"metrics\\":{\\"delay_min_fp\\":\\"15000000\\",\\"lat_deg_fp\\":\\"38198100\\",\\"lon_deg_fp\\":\\"26839200\\"},\\"rounding\\":\\"HALF_EVEN\\",\\"supersedes_event_id\\":null,\\"unit_schema\\":\\"SI_MARINE_V1\\"}"}',
      '{"contract":"CAELUS_INTEL_V2","sig":"#sig=ed25519:ed4512c6b419114bc9b1afa8b31c538bd4f62e57e465a9b0a0b2d427d504d5ca:19ac32f9b057c2f0f142b9e74a207ea85cfef1de5a7bed08f83842540ca5b684e83cbd9173ca169b3401af5b8c80876ebbda564d1dba7cc3699057eaef195d02","schema_version":"2.0","header":"open_meteo_marine_ensemble|wx-key-2026-q4|WAVE_FORECAST|ev_109|2|1762848580000|1762848600000|HYPOTHESIS|06d6a83d122e7d970d76e5f90a1ad79b0c5e156f9dc2a81d21e6f428401de740","learned_at_ms":"1762848600000","payload_raw":"{\\"entity_id\\":\\"VESSEL_AEGEAN_01\\",\\"fp_scale\\":1000000,\\"metrics\\":{\\"delay_min_fp\\":\\"18000000\\",\\"wave_m_fp\\":\\"2450000\\",\\"wave_p50_m_fp\\":\\"2100000\\",\\"wave_p95_m_fp\\":\\"3150000\\",\\"wind_gust_kn_fp\\":\\"31000000\\"},\\"rounding\\":\\"HALF_EVEN\\",\\"supersedes_event_id\\":null,\\"unit_schema\\":\\"SI_MARINE_V1\\"}"}',
      '{"contract":"CAELUS_INTEL_V2","sig":"#sig=ed25519:cb135e0908265dbbcfce2f191d1aa31c47d38ba46a563f4ef392e2b91d17ec4b:e82360947d41d7e5bcdb0caffaaadc2870c51411c6a2adb27f439f4edfd70613912b05ad1f2345adb1b2fb42d795c40ae23006af091a7a14269cc9997af7c808","schema_version":"2.0","header":"ferry_operator_dispatch|ops-key-2026-q4|DELAY_NOTICE|ev_103_equivocation|1|1762848890000|1762848900000|CLAIM|2ae5c29ae7b70bd950a07b03f4c867821dc700cb923fb6bd3c7f579fb338673c","learned_at_ms":"1762848900000","payload_raw":"{\\"entity_id\\":\\"VESSEL_AEGEAN_01\\",\\"fp_scale\\":1000000,\\"metrics\\":{\\"delay_min_fp\\":\\"5000000\\"},\\"rounding\\":\\"HALF_EVEN\\",\\"supersedes_event_id\\":null,\\"unit_schema\\":\\"SI_MARINE_V1\\"}"}',
      '{"contract":"CAELUS_INTEL_V2","sig":"#sig=ed25519:e988fc461de2c97eb480bf85cd2ab974c19549308c03400ea721483cd31a1725:8324da22f7fa91ad77dffb9c6fb2da676960c37dcfbceeaab692db45a2f8e65b86df2bc88ff8b496af1b0b6a6d3aa090122b5d2f7da67855eccb8d40fb1d1c05","schema_version":"2.0","header":"opensky_aegean_adsb|osky-key-2026-q4|AIRCRAFT_STATE_VECTOR|ev_102|1|1762849115000|1762849260000|OBSERVATION|4ca2dd0d3cfa577fe28e37495c6cd69233c1e16898cb406da6a624f100c31a0e","learned_at_ms":"1762849260000","payload_raw":"{\\"entity_id\\":\\"SAR_HELI_AEGEAN_04\\",\\"fp_scale\\":1000000,\\"metrics\\":{\\"baro_alt_m_fp\\":\\"450000000\\",\\"delay_min_fp\\":\\"0\\",\\"lat_deg_fp\\":\\"38142000\\",\\"lon_deg_fp\\":\\"26811000\\",\\"squawk_code_fp\\":\\"1200000000\\",\\"velocity_mps_fp\\":\\"62500000\\"},\\"rounding\\":\\"HALF_EVEN\\",\\"supersedes_event_id\\":null,\\"unit_schema\\":\\"SI_AVIATION_V1\\"}"}',
      '{"contract":"CAELUS_INTEL_V2","sig":"#sig=ed25519:e385635f6ffba8f1ab9557e9a8ed16df063b8c1f71aca83f46573c7b66d230c3:0d01f69bc70486e680d5508546fc563819c2dd49b9a98c2e6218234f9dca6ebc98308f505d85f95a97dfd7ba359c484ba53a5ca9728a4ca514295467dc42360d","schema_version":"2.0","header":"ais_terrestrial_aegean|ais-key-2026-q4|VESSEL_POSITION|ev_104|1|1762849360000|1762849380000|OBSERVATION|07c4c4126cf1b07b9c5ada1059d31b686692f331cd13e2685f191f06e0de270d","learned_at_ms":"1762849380000","payload_raw":"{\\"entity_id\\":\\"VESSEL_AEGEAN_01\\",\\"fp_scale\\":1000000,\\"metrics\\":{\\"delay_min_fp\\":\\"35000000\\",\\"lat_deg_fp\\":\\"38195420\\",\\"lon_deg_fp\\":\\"26837110\\",\\"sog_kn_fp\\":\\"14200000\\",\\"wave_m_fp\\":\\"2450000\\"},\\"rounding\\":\\"HALF_EVEN\\",\\"supersedes_event_id\\":null,\\"unit_schema\\":\\"SI_MARINE_V1\\"}"}',
      '{"contract":"CAELUS_INTEL_V2","sig":"#sig=ed25519:99ad4ca5c1998b2454316a2e4d5cfd4e9ff002f609513aae7a579cc96b9822e5:e8f30aee70dc292b707a0bef1ba03b3bf78b027fb6fc3da42131176098842aabca16731fc452679b227df8019efa9ad26a8b236ad8883828a1848ed2cc7ec907","schema_version":"2.0","header":"nmea2000_bridge_bus|n2k-key-2026-q4|N2K_WIND_DATA|ev_105|1|1762849435000|1762849440000|OBSERVATION|bcbbf449bf5997a05a536ef5ae1a761425d6cb2b18f7b231d25be0d0a97f44f3","learned_at_ms":"1762849440000","payload_raw":"{\\"entity_id\\":\\"BRIDGE_N2K_AEGEAN_01\\",\\"fp_scale\\":1000000,\\"metrics\\":{\\"depth_m_fp\\":\\"42800000\\",\\"rudder_angle_deg_fp\\":\\"-2500000\\",\\"wind_angle_deg_fp\\":\\"42500000\\",\\"wind_speed_mps_fp\\":\\"13800000\\"},\\"rounding\\":\\"HALF_EVEN\\",\\"supersedes_event_id\\":null,\\"unit_schema\\":\\"SI_MARINE_V1\\"}"}',
      '{"contract":"CAELUS_INTEL_V2","sig":"#sig=ed25519:c9d769f0400bdb1bc0743e22d815a3ef43a99cfd09ab2be3a617d407a4cd2c6d:a276b4eba0fc3e441eda2d7342fb3d99224165e8aecfde4c1ed0dd896cb371383a42a62ad6f485359c8b6b7105080e6210e5304c36949775b26ec8968abeb50f","schema_version":"2.0","header":"port_berth_sensor_sigacik|port-key-2026-q4|BERTH_PROXIMITY|ev_106|9007199254740993|1762849490000|1762849500000|OBSERVATION|e7c8a5bb2711cf2691c3136e79a56f4a3b3a5610299155ee7848bc361ec0597b","learned_at_ms":"1762849500000","payload_raw":"{\\"entity_id\\":\\"VESSEL_AEGEAN_01\\",\\"fp_scale\\":1000000,\\"metrics\\":{\\"delay_min_fp\\":\\"35000000\\",\\"gate_locked_fp\\":\\"1000000\\",\\"lat_deg_fp\\":\\"38199850\\",\\"lon_deg_fp\\":\\"26840410\\",\\"ramp_angle_deg_fp\\":\\"4250000\\",\\"shore_bus_v_fp\\":\\"400500000\\"},\\"rounding\\":\\"HALF_EVEN\\",\\"supersedes_event_id\\":null,\\"unit_schema\\":\\"SI_MARINE_V1\\"}"}',
    ].join("\n") + "\n",
  });

  function escapeHtml(val) {
    return String(val == null ? "" : val)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function getI18nCtx(st) {
    return {
      locale: st && st.locale ? st.locale : "tr",
      register: st && st.register ? st.register : "plain",
      speedUnit: st && st.speedUnit ? st.speedUnit : "kn",
      distanceUnit: st && st.distanceUnit ? st.distanceUnit : "nm",
      clockMode: st && st.clockMode ? st.clockMode : "UTC",
    };
  }

  function trOrKey(key, params, st) {
    if (warRoomI18n && warRoomI18n.t) {
      return warRoomI18n.t(key, params || {}, getI18nCtx(st));
    }
    return key;
  }

  function formatClockForState(msDecStr, st) {
    if (warRoomI18n && warRoomI18n.formatClockMs) {
      return warRoomI18n.formatClockMs(msDecStr, getI18nCtx(st));
    }
    return `${msDecStr} ms`;
  }

  function formatFpMinutesForState(fpDecStr, st, signed = true) {
    if (warRoomI18n && warRoomI18n.formatFpMinutes) {
      return warRoomI18n.formatFpMinutes(fpDecStr, {
        ...getI18nCtx(st),
        signed,
      });
    }
    return `${fpDecStr} fp`;
  }

  function formatFpMetersForState(fpDecStr, st, decimals = 2) {
    if (warRoomI18n && warRoomI18n.formatFpMeters) {
      return warRoomI18n.formatFpMeters(fpDecStr, {
        ...getI18nCtx(st),
        decimals,
      });
    }
    return `${fpDecStr} fp`;
  }

  function severityIconSvg(severityOrVerdict) {
    const key = String(severityOrVerdict || "").toUpperCase();
    if (key === "CRITICAL" || key === "KURAL_İHLALİ") {
      return '<svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true"><polygon points="5,1 11,1 15,5 15,11 11,15 5,15 1,11 1,5" fill="currentColor"/></svg>';
    }
    if (key === "SERIOUS" || key === "CAUTION" || key === "STALE") {
      return '<svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true"><polygon points="8,1.5 15,14.5 1,14.5" fill="currentColor"/></svg>';
    }
    if (key === "NOMINAL" || key === "GEÇTİ" || key === "FRESH") {
      return '<svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6" fill="currentColor"/></svg>';
    }
    return '<svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true"><polygon points="8,1.5 14.5,8 8,14.5 1.5,8" fill="none" stroke="currentColor" stroke-width="2"/></svg>';
  }

  function epistemicSymbol(epistemicStatus) {
    if (epistemicStatus === "OBSERVATION") return "●";
    if (epistemicStatus === "CLAIM") return "◆";
    return "▲";
  }

  function parseTimelineCatalogFromBatch(batchNdjson, manifestJson) {
    let manifestSources = {};
    try {
      const mf = JSON.parse(manifestJson);
      for (const s of mf.sources || []) {
        manifestSources[s.source_id] = s;
      }
    } catch (_) {
      manifestSources = {};
    }

    const rows = [];
    const lines = String(batchNdjson || "")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);

    for (let idx = 0; idx < lines.length; idx++) {
      try {
        const rec = JSON.parse(lines[idx]);
        const hdrParts = String(rec.header || "").split("|");
        const sourceId = hdrParts[0] || "unknown";
        const keyId = hdrParts[1] || "";
        const eventKind = hdrParts[2] || "METRIC";
        const eventId = hdrParts[3] || `ev_${idx}`;
        const seqNoStr = String(hdrParts[4] || "0");
        const observedAtMsStr = String(hdrParts[5] || rec.learned_at_ms || "0");
        const ingestedAtMsStr = String(hdrParts[6] || rec.learned_at_ms || "0");
        const epistemicStatus = hdrParts[7] || "CLAIM";
        const learnedAtMsStr = String(rec.learned_at_ms || ingestedAtMsStr);

        let payloadObj = {};
        try {
          payloadObj = JSON.parse(String(rec.payload_raw || "{}"));
        } catch (_) {
          payloadObj = {};
        }

        const entityId = String(payloadObj.entity_id || payloadObj.subject_id || "SYSTEM");
        const metrics = payloadObj.metrics || {};
        let primaryMetricKey = "fp_val";
        let primaryFpStr = "0";
        if (metrics.delay_min_fp !== undefined) {
          primaryMetricKey = "delay_min_fp";
          primaryFpStr = String(metrics.delay_min_fp);
        } else if (metrics.wave_m_fp !== undefined) {
          primaryMetricKey = "wave_m_fp";
          primaryFpStr = String(metrics.wave_m_fp);
        } else if (metrics.wind_speed_mps_fp !== undefined) {
          primaryMetricKey = "wind_speed_mps_fp";
          primaryFpStr = String(metrics.wind_speed_mps_fp);
        } else if (metrics.baro_alt_m_fp !== undefined) {
          primaryMetricKey = "baro_alt_m_fp";
          primaryFpStr = String(metrics.baro_alt_m_fp);
        } else if (payloadObj.fp_val !== undefined) {
          primaryMetricKey = String(payloadObj.metric_key || "fp_val");
          primaryFpStr = String(payloadObj.fp_val);
        }

        const mfEntry = manifestSources[sourceId] || {};
        rows.push({
          row_index: idx,
          raw_line: lines[idx],
          source_id: sourceId,
          key_id: keyId,
          independence_group: String(mfEntry.independence_group || "unscoped"),
          max_staleness_ms: String(mfEntry.max_staleness_ms || "300000"),
          event_kind: eventKind,
          event_id: eventId,
          seq_no: seqNoStr,
          exceeds_ieee754_safe_int: (() => {
            try {
              return BigInt(seqNoStr) > 9007199254740991n;
            } catch (_) {
              return false;
            }
          })(),
          observed_at_ms: observedAtMsStr,
          learned_at_ms: learnedAtMsStr,
          epistemic_status: epistemicStatus,
          entity_id: entityId,
          primary_metric_key: primaryMetricKey,
          primary_fp_val: primaryFpStr,
          metrics,
          sig: String(rec.sig || ""),
        });
      } catch (_) {
        // Bozuk satırlar fail-closed motor doğrulamasında yakalanır
      }
    }
    return rows;
  }

  /**
   * Hem tarayıcıda hem de Node.js testlerinde çalışabilen deterministik Kokpit Durum Makinesi.
   * Varsayılan açılış modu (§2.2): `locale = "tr"`, `register = "plain"` (Sade Operatör Görünümü).
   */
  function createWarRoomCockpitModel(options = {}) {
    const initialBundle =
      options.pilotBundle ||
      (typeof globalThis !== "undefined" && globalThis.CAELUS_AIRLOCK_PILOT_BUNDLE) ||
      EMBEDDED_AEGEAN_PILOT_BUNDLE;

    let manifestJson = String(initialBundle.manifest_json || EMBEDDED_AEGEAN_PILOT_BUNDLE.manifest_json);
    let batchNdjson = String(initialBundle.batch_ndjson || EMBEDDED_AEGEAN_PILOT_BUNDLE.batch_ndjson);

    const localOrchestrator = agUiEngine.createWarRoomAgUiOrchestrator({
      forcePureJsFallback:
        options.forcePureJsFallback !== undefined ? Boolean(options.forcePureJsFallback) : true,
      defaultBatchNdjson: batchNdjson,
      defaultManifestJson: manifestJson,
    });

    const state = {
      locale: warRoomI18n ? warRoomI18n.normalizeLocale(options.initialLocale || "tr") : "tr",
      register: warRoomI18n
        ? warRoomI18n.normalizeRegister(options.initialRegister || "plain")
        : "plain",
      speedUnit: options.initialSpeedUnit === "kmh" ? "kmh" : "kn",
      distanceUnit: options.initialDistanceUnit === "km" ? "km" : "nm",
      clockMode: options.initialClockMode === "LOCAL" ? "LOCAL" : "UTC",
      expandedProofCardIds: new Set(),
      theme: options.initialTheme || "dusk", // "day" | "dusk" | "night"
      stageMode: options.initialStageMode || "MAP", // "MAP" | "GRAPH"
      mapEngine: "SVG", // "SVG" | "MAPLIBRE_DECK" | "CESIUM_3D"
      playbackMode: "REPLAY", // "REPLAY" | "LIVE"
      replaySpeed: 1, // 1 | 10
      transportMode: "AIRGAPPED_LOCAL", // "AIRGAPPED_LOCAL" | "WS_LIVE" | "WS_CPP_ENGINE"
      serverAirlockMode: "OFFLINE_REPLAY", // "OFFLINE_REPLAY" | "LIVE_AIRLOCK"
      cutoffLearnedAtMs: String(options.initialCutoffMs || T2_CUTOFF_MS),
      epistemicFilter: "ALL", // "ALL" | "OBSERVATION" | "CLAIM" | "HYPOTHESIS" | "REJECTED"
      selectedEventId: "ev_106",
      selectedGraphNodeId: "ais_terrestrial_aegean",
      disabledSourceIds: new Set(),
      focusedActionCardId: "coa-20261111-01",
      highlightedCorridor: "PRIMARY_NORTH", // "PRIMARY_NORTH" | "SOUTH_SAMOS_SHELTERED"
      mapLayers: {
        ais: true,
        route: true,
        h3Wave: true,
        airspace: true,
        berth: true,
      },
      customStressMode: "BERTH_02", // "BERTH_02" | "ROUTE_SHELTER_01" | "CUSTOM_FP"
      customOverrideFp: "16000000",
      customStressDeltaMin: "-18",
      lastCounterfactualPreview: null,
      sealedCards: {},
      catalogRows: parseTimelineCatalogFromBatch(batchNdjson, manifestJson),
      sliceSync: null,
      sentinelAlert: null,
      redTeamAlert: null,
      actionCards: [],
      assistantReplies: [],
      auditChainHead: "",
    };

    const listeners = new Set();
    function notify() {
      for (const fn of listeners) {
        try {
          fn(state);
        } catch (_) {}
      }
    }

    function applyAgUiEnvelopes(envelopes) {
      if (!Array.isArray(envelopes)) return;
      const nextCards = [];
      let sawCardsInBatch = false;

      for (const env of envelopes) {
        if (!env || env.protocol !== "CAELUS_AG_UI_V1") continue;
        if (env.msg_type === "SLICE_STATE_SYNC") {
          state.sliceSync = env;
          state.cutoffLearnedAtMs = String(env.cutoff_learned_at_ms || state.cutoffLearnedAtMs);
          if (env.slice && env.slice.audit_chain_head) {
            state.auditChainHead = String(env.slice.audit_chain_head);
          } else if (env.slice && env.slice.state_blake3 && !state.auditChainHead) {
            state.auditChainHead = String(env.slice.state_blake3);
          }
          sawCardsInBatch = true;
        } else if (env.msg_type === "EVENT_ANOMALY_FLAGGED") {
          state.sentinelAlert = env;
        } else if (env.msg_type === "STRESS_THRESHOLD_ALERT") {
          state.redTeamAlert = env;
        } else if (env.msg_type === "ACTION_APPROVAL_CARD") {
          sawCardsInBatch = true;
          nextCards.push(env);
        } else if (env.msg_type === "COUNTERFACTUAL_BRANCH_RESULT") {
          state.lastCounterfactualPreview = env.result || env;
        } else if (env.msg_type === "ASSISTANT_EVIDENCE_REPLY") {
          state.assistantReplies = [env, ...state.assistantReplies.slice(0, 5)];
        } else if (env.msg_type === "OPERATOR_CARD_SEALED") {
          state.sealedCards[env.card_id] = {
            card_id: env.card_id,
            operator_pubkey: env.operator_pubkey,
            operator_sig: env.operator_sig,
            audit_chain_head: env.audit_chain_head,
            audit_chain_verified: Boolean(env.audit_chain_verified),
            approved_at_ms: state.cutoffLearnedAtMs,
          };
          if (env.audit_chain_head) {
            state.auditChainHead = String(env.audit_chain_head);
          }
        }
      }

      if (sawCardsInBatch) {
        state.actionCards = nextCards;
      }
      notify();
    }

    function buildFilteredBatchForDisabledSources() {
      if (state.disabledSourceIds.size === 0) return batchNdjson;
      return (
        state.catalogRows
          .filter((r) => !state.disabledSourceIds.has(r.source_id))
          .map((r) => r.raw_line)
          .join("\n") + "\n"
      );
    }

    function evaluateAtCutoffLocal(cutoffMsStr) {
      const targetCutoff = String(cutoffMsStr || state.cutoffLearnedAtMs);
      state.cutoffLearnedAtMs = targetCutoff;
      const res = localOrchestrator.orchestrateSliceStream({
        batch_ndjson: batchNdjson,
        manifest_json: manifestJson,
        cutoff_learned_at_ms: targetCutoff,
        scenario_id: "AEGEAN_FERRY_01",
        policy_id: "MARITIME_SAFETY_V2",
        locale: state.locale,
        register: state.register,
        clockMode: state.clockMode,
      });
      if (res.ok) {
        applyAgUiEnvelopes(res.envelopes);
      }
      return res;
    }

    function refreshLocalizedEnvelopesWithoutMutatingCore() {
      const prevReplies = state.assistantReplies.slice();
      evaluateAtCutoffLocal(state.cutoffLearnedAtMs);
      if (prevReplies.length > 0 && prevReplies[0] && prevReplies[0].query) {
        const refreshed = localOrchestrator.answerEvidenceBoundQuery({
          batch_ndjson: batchNdjson,
          manifest_json: manifestJson,
          cutoff_learned_at_ms: state.cutoffLearnedAtMs,
          scenario_id: "AEGEAN_FERRY_01",
          policy_id: "MARITIME_SAFETY_V2",
          locale: state.locale,
          register: state.register,
          clockMode: state.clockMode,
          query: prevReplies[0].query,
        });
        if (refreshed.ok && refreshed.envelope) {
          state.assistantReplies = [refreshed.envelope];
          notify();
        }
      }
    }

    function setLocale(nextLocale) {
      const norm = warRoomI18n ? warRoomI18n.normalizeLocale(nextLocale) : nextLocale === "en" ? "en" : "tr";
      if (state.locale === norm) return state.locale;
      state.locale = norm;
      refreshLocalizedEnvelopesWithoutMutatingCore();
      return state.locale;
    }

    function toggleLocale() {
      return setLocale(state.locale === "tr" ? "en" : "tr");
    }

    function setRegister(nextRegister) {
      const norm = warRoomI18n
        ? warRoomI18n.normalizeRegister(nextRegister)
        : nextRegister === "technical"
          ? "technical"
          : "plain";
      if (state.register === norm) return state.register;
      state.register = norm;
      refreshLocalizedEnvelopesWithoutMutatingCore();
      return state.register;
    }

    function toggleRegister() {
      return setRegister(state.register === "plain" ? "technical" : "plain");
    }

    function setUnits(unitPatch = {}) {
      if (unitPatch.speedUnit === "kn" || unitPatch.speedUnit === "kmh") {
        state.speedUnit = unitPatch.speedUnit;
      }
      if (unitPatch.distanceUnit === "nm" || unitPatch.distanceUnit === "km") {
        state.distanceUnit = unitPatch.distanceUnit;
      }
      if (unitPatch.clockMode === "UTC" || unitPatch.clockMode === "LOCAL") {
        state.clockMode = unitPatch.clockMode;
      }
      notify();
    }

    function toggleCardProof(cardId) {
      const id = String(cardId || "");
      if (!id) return;
      if (state.expandedProofCardIds.has(id)) {
        state.expandedProofCardIds.delete(id);
      } else {
        state.expandedProofCardIds.add(id);
      }
      notify();
    }

    function computeSourceStalenessStrip() {
      const cutoffBig = BigInt(state.cutoffLearnedAtMs);
      const ctx = getI18nCtx(state);
      const tracked = [
        { code: "AIS", source_id: "ais_terrestrial_aegean", max_ms: 120000n },
        { code: "PORT", source_id: "port_berth_sensor_sigacik", max_ms: 180000n },
        { code: "METEO", source_id: "open_meteo_marine_ensemble", max_ms: 3600000n },
        { code: "ADS-B", source_id: "opensky_aegean_adsb", max_ms: 120000n },
      ];

      const rejectedIds = new Set(
        ((state.sliceSync && state.sliceSync.slice && state.sliceSync.slice.rejected_in_slice) || []).map(
          (r) => r.event_id
        )
      );

      const secSuffix = trOrKey("freshness.seconds_suffix", {}, state);

      return tracked.map((item) => {
        const displayName =
          ctx.register === "technical"
            ? item.code
            : warRoomI18n
              ? warRoomI18n.formatSourceName(item.source_id, { locale: ctx.locale, register: "plain" })
              : item.code;

        const learnedRows = state.catalogRows.filter(
          (r) =>
            r.source_id === item.source_id &&
            !rejectedIds.has(r.event_id) &&
            BigInt(r.learned_at_ms) <= cutoffBig
        );
        if (learnedRows.length === 0) {
          const pendingLabel = trOrKey("freshness.pending", {}, state);
          return {
            code: item.code,
            display_name: displayName,
            source_id: item.source_id,
            freshness: "PENDING",
            age_sec_str: "—",
            status_label: pendingLabel,
            label_tr: pendingLabel,
          };
        }
        const latest = learnedRows[learnedRows.length - 1];
        const ageMs = cutoffBig - BigInt(latest.observed_at_ms);
        const ageSec = ageMs >= 0n ? ageMs / 1000n : 0n;
        const isStale = ageMs > item.max_ms;
        const statusLabel = isStale
          ? trOrKey("freshness.stale", {}, state)
          : trOrKey("freshness.fresh", {}, state);
        return {
          code: item.code,
          display_name: displayName,
          source_id: item.source_id,
          freshness: isStale ? "STALE" : "FRESH",
          age_sec_str: `${ageSec.toString()} ${secSuffix}`,
          status_label: statusLabel,
          label_tr: statusLabel,
        };
      });
    }

    function getDecoratedTelemetryRows() {
      const cutoffBig = BigInt(state.cutoffLearnedAtMs);
      const rejectedMap = new Map();
      const validationRejected =
        (state.sliceSync &&
          state.sliceSync.validation &&
          state.sliceSync.validation.rejected_records) ||
        [];
      for (const rej of validationRejected) {
        rejectedMap.set(rej.event_id, rej);
      }

      return state.catalogRows
        .map((r) => {
          const isFuture = BigInt(r.learned_at_ms) > cutoffBig;
          const rejInfo = rejectedMap.get(r.event_id) || null;
          let legacyStatusTr = "KESİTTE AKTİF";
          let localizedStatus = trOrKey("table.status_active", {}, state);
          if (isFuture) {
            legacyStatusTr = "Henüz Öğrenilmedi (Gelecek Kesiti)";
            localizedStatus = trOrKey("table.status_future", {}, state);
          } else if (rejInfo) {
            legacyStatusTr = `KARANTİNA · ${rejInfo.error_code} (0-Bit)`;
            localizedStatus =
              rejInfo.error_code === "ERR_SOURCE_EQUIVOCATION" && state.register === "plain"
                ? trOrKey("security.ERR_SOURCE_EQUIVOCATION", {}, state)
                : trOrKey(
                    "table.status_quarantined",
                    { error_code: rejInfo.error_code },
                    state
                  );
          }
          return {
            ...r,
            is_future: isFuture,
            is_rejected: Boolean(rejInfo && !isFuture),
            rejection_info: rejInfo,
            temporal_status_tr: legacyStatusTr,
            temporal_status_label: localizedStatus,
          };
        })
        .filter((r) => {
          if (state.epistemicFilter === "ALL") return true;
          if (state.epistemicFilter === "REJECTED") return Boolean(r.rejection_info);
          return r.epistemic_status === state.epistemicFilter;
        });
    }

    function stepEventCursor(direction) {
      const uniqueCutoffs = Array.from(
        new Set(state.catalogRows.map((r) => r.learned_at_ms))
      ).sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0));
      if (uniqueCutoffs.length === 0) return state.cutoffLearnedAtMs;

      const cur = BigInt(state.cutoffLearnedAtMs);
      if (direction < 0) {
        const prev = uniqueCutoffs.filter((ms) => BigInt(ms) < cur);
        const target = prev.length > 0 ? prev[prev.length - 1] : uniqueCutoffs[0];
        evaluateAtCutoffLocal(target);
        return target;
      }
      const next = uniqueCutoffs.filter((ms) => BigInt(ms) > cur);
      const target =
        next.length > 0 ? next[0] : uniqueCutoffs[uniqueCutoffs.length - 1];
      evaluateAtCutoffLocal(target);
      return target;
    }

    function runInteractiveCounterfactual(interventions, branchId = "cf_stress_desk") {
      const activeBatch = buildFilteredBatchForDisabledSources();
      const cfRes = localOrchestrator.airlockMcp.invokeAirlockTool({
        toolName: "caelus_run_counterfactual_branch",
        arguments: {
          batch_ndjson: activeBatch,
          manifest_json: manifestJson,
          base_cutoff_ms: state.cutoffLearnedAtMs,
          branch_id: branchId,
          interventions,
          scenario_id: "AEGEAN_FERRY_01",
          policy_id: "MARITIME_SAFETY_V2",
          advisor_template: "STRATEGIST",
        },
      });
      state.lastCounterfactualPreview = cfRes;
      notify();
      return cfRes;
    }

    function toggleGraphSourceDisabled(sourceId) {
      if (state.disabledSourceIds.has(sourceId)) {
        state.disabledSourceIds.delete(sourceId);
      } else {
        state.disabledSourceIds.add(sourceId);
      }
      const activeBatch = buildFilteredBatchForDisabledSources();
      const altSlice = localOrchestrator.airlockMcp.invokeAirlockTool({
        toolName: "caelus_evaluate_slice",
        arguments: {
          batch_ndjson: activeBatch,
          manifest_json: manifestJson,
          cutoff_learned_at_ms: state.cutoffLearnedAtMs,
          scenario_id: "AEGEAN_FERRY_01",
          policy_id: "MARITIME_SAFETY_V2",
          advisor_template: "STRESS_TESTER",
        },
      });
      const baseVerdict =
        (state.sliceSync && state.sliceSync.slice && state.sliceSync.slice.verdict) ||
        "KANIT_YETERSİZ";
      state.lastCounterfactualPreview = {
        ok: Boolean(altSlice && altSlice.ok),
        branch_id: `node_mask_${state.disabledSourceIds.size}`,
        base_verdict: baseVerdict,
        branch_verdict: altSlice.verdict || "KANIT_YETERSİZ",
        base_state_blake3:
          (state.sliceSync && state.sliceSync.slice && state.sliceSync.slice.state_blake3) || "",
        branch_state_blake3: altSlice.state_blake3 || "",
        delta_delay_min_fp: "0",
        disabled_sources: Array.from(state.disabledSourceIds),
      };
      notify();
      return state.lastCounterfactualPreview;
    }

    function signAndSealActionCardLocal(cardId, operatorSeedHex = DEFAULT_OPERATOR_SEED_HEX) {
      const card = state.actionCards.find((c) => c.card_id === cardId);
      if (!card) {
        return { ok: false, errorCode: "CARD_NOT_FOUND", messageTr: "Eylem kartı bulunamadı." };
      }
      const currentVerdict =
        (state.sliceSync && state.sliceSync.slice && state.sliceSync.slice.verdict) ||
        card.verdict_context;

      if (
        currentVerdict === "KANIT_YETERSİZ" ||
        (card.auditor_check && !card.auditor_check.observation_corroborated)
      ) {
        return {
          ok: false,
          errorCode: "ERR_AUDITOR_FAIL_CLOSED_INSUFFICIENT_EVIDENCE",
          messageTr: trOrKey("card.auditor_lock_banner", {}, state),
        };
      }

      const branchBlake3 =
        (card.counterfactual_delta && card.counterfactual_delta.branch_state_blake3) || "";
      const stateBlake3 =
        (state.sliceSync && state.sliceSync.slice && state.sliceSync.slice.state_blake3) ||
        card.state_blake3 ||
        "";
      const approvedAtMs = state.cutoffLearnedAtMs;

      const canonicalPayload = sidecarAirlock.buildOperatorActionCardSigningPayload({
        card_id: card.card_id,
        scenario_id: "AEGEAN_FERRY_01",
        verdict_context: currentVerdict,
        state_blake3: stateBlake3,
        branch_state_blake3: branchBlake3,
        approved_at_ms: approvedAtMs,
      });

      const { pubkeyHex, signatureHex } = sidecarAirlock.ed25519SignMessageHex(
        canonicalPayload,
        operatorSeedHex
      );

      const sealRecord = {
        ok: true,
        card_id: card.card_id,
        scenario_id: "AEGEAN_FERRY_01",
        verdict_context: currentVerdict,
        state_blake3: stateBlake3,
        branch_state_blake3: branchBlake3,
        approved_at_ms: approvedAtMs,
        operator_pubkey: pubkeyHex,
        operator_sig: signatureHex,
        canonical_payload: canonicalPayload,
        audit_chain_head: state.auditChainHead || stateBlake3,
        audit_chain_verified: true,
      };
      state.sealedCards[card.card_id] = sealRecord;
      notify();
      return sealRecord;
    }

    function submitAssistantQueryLocal(queryText) {
      const ans = localOrchestrator.answerEvidenceBoundQuery({
        batch_ndjson: batchNdjson,
        manifest_json: manifestJson,
        cutoff_learned_at_ms: state.cutoffLearnedAtMs,
        scenario_id: "AEGEAN_FERRY_01",
        policy_id: "MARITIME_SAFETY_V2",
        locale: state.locale,
        register: state.register,
        clockMode: state.clockMode,
        query: queryText,
      });
      if (ans.ok && ans.envelope) {
        applyAgUiEnvelopes([ans.envelope]);
      }
      return ans;
    }

    function updatePilotBundle(newManifestJson, newBatchNdjson) {
      if (newManifestJson) manifestJson = String(newManifestJson);
      if (newBatchNdjson) batchNdjson = String(newBatchNdjson);
      state.catalogRows = parseTimelineCatalogFromBatch(batchNdjson, manifestJson);
      return evaluateAtCutoffLocal(state.cutoffLearnedAtMs);
    }

    evaluateAtCutoffLocal(state.cutoffLearnedAtMs);

    return {
      T1_CUTOFF_MS,
      TAMPER_CHECK_MS,
      T2_CUTOFF_MS,
      state,
      subscribe(fn) {
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
      setCutoffMs: evaluateAtCutoffLocal,
      setLocale,
      toggleLocale,
      setRegister,
      toggleRegister,
      setUnits,
      toggleCardProof,
      stepEventCursor,
      applyAgUiEnvelopes,
      computeSourceStalenessStrip,
      getDecoratedTelemetryRows,
      runInteractiveCounterfactual,
      toggleGraphSourceDisabled,
      signAndSealActionCardLocal,
      submitAssistantQueryLocal,
      updatePilotBundle,
      getManifestObject() {
        try {
          return JSON.parse(manifestJson);
        } catch (_) {
          return {};
        }
      },
    };
  }

  /**
   * 4 Bölgenin saf (side-effect-free) HTML anlık görüntüsünü seçili `{ locale, register }`
   * ve birim/saat tercihlerinde üretir. Hem DOM denetleyicisi hem de kapı testleri kullanır.
   */
  function renderCockpitZonesSnapshot(model, opts = {}) {
    const st = model.state;
    const ctx = getI18nCtx(st);
    const isTech = ctx.register === "technical";
    const slice = (st.sliceSync && st.sliceSync.slice) || {};
    const verdict = slice.verdict || "KANIT_YETERSİZ";
    const appliedRuleId = slice.applied_rule_id || "RULE_SLA_BREACH_CORROBORATED";
    const missingGroups =
      slice.missing_corroborations || slice.missing_evidence || ["OBSERVATION"];
    const stateBlake3 = String(slice.state_blake3 || "");
    const stateHashShort = stateBlake3 ? stateBlake3.slice(0, 12) : "—";
    const auditHeadShort = st.auditChainHead ? st.auditChainHead.slice(0, 12) : stateHashShort;
    const stalenessStrip = model.computeSourceStalenessStrip();
    const decoratedRows = model.getDecoratedTelemetryRows();

    const transportKey =
      st.transportMode === "WS_LIVE"
        ? st.serverAirlockMode === "LIVE_AIRLOCK"
          ? "topbar.transport_live_airlock"
          : "topbar.transport_ws_replay"
        : st.transportMode === "WS_CPP_ENGINE"
          ? "topbar.transport_cpp_engine"
          : "topbar.transport_airgapped";

    const alarmBadgeText = warRoomI18n
      ? warRoomI18n.formatAlarmBadge(verdict, ctx)
      : verdict;
    const verdictText = warRoomI18n
      ? warRoomI18n.formatVerdict(
          verdict,
          {
            policy_id: "MARITIME_SAFETY_V2",
            rule_id: appliedRuleId,
            missing_groups: missingGroups,
          },
          ctx
        )
      : verdict;

    const policyTooltip = isTech
      ? "policy_id: MARITIME_SAFETY_V2"
      : trOrKey(
          "stage.active_rule_label",
          { rule_id: appliedRuleId, max_allowed_fp: "20000000" },
          st
        );

    const speedUnitDisplay =
      st.speedUnit === "kmh"
        ? `${trOrKey("unit.kmh_short", {}, st)} · ${trOrKey("unit.km_short", {}, st)}`
        : `${trOrKey("unit.kn_short", {}, st)} · ${trOrKey("unit.nm_short", {}, st)}`;
    const clockModeDisplay =
      st.clockMode === "LOCAL"
        ? trOrKey("topbar.clock_local", {}, st)
        : trOrKey("topbar.clock_utc", {}, st);

    const sealBadgeInnerHtml = isTech
      ? `<span class="hash-badge" translate="no">🔒 state_blake3: ${escapeHtml(stateHashShort)}… | audit_head: ${escapeHtml(auditHeadShort)}…</span>`
      : `<span>${escapeHtml(trOrKey("topbar.seal_badge_label", {}, st))}</span>`;

    const topBarHtml = `
      <a class="wr-skip-link" href="#wr-stage-region">${escapeHtml(trOrKey("app.skip_to_main", {}, st))}</a>
      <div class="wr-brand-cluster">
        <h1 class="wr-system-title" style="margin:0;">
          <span aria-hidden="true">⚓</span>
          <span>${escapeHtml(trOrKey("app.brand_title", {}, st))}</span>
        </h1>
        <span class="wr-mode-pill" ${isTech ? 'translate="no"' : ""}>${escapeHtml(trOrKey("topbar.system_mode_badge", {}, st))}</span>
        <span class="wr-mode-pill" title="${escapeHtml(policyTooltip)}" ${isTech ? 'translate="no"' : ""}>${escapeHtml(trOrKey("topbar.policy_badge", {}, st))}</span>
        <span class="wr-mode-pill" data-transport="${escapeHtml(st.transportMode)}" ${isTech ? 'translate="no"' : ""}>${escapeHtml(trOrKey(transportKey, {}, st))}</span>
      </div>

      <div class="wr-staleness-cluster" role="group" aria-label="${escapeHtml(trOrKey("topbar.aria_sources", {}, st))}">
        ${stalenessStrip
          .map(
            (p) => `
          <span class="wr-staleness-pill" data-freshness="${escapeHtml(p.freshness)}" title="${escapeHtml(p.display_name)} (${escapeHtml(p.age_sec_str)})">
            ${severityIconSvg(p.freshness)}
            <span>${escapeHtml(p.display_name)}:</span>
            <strong>${escapeHtml(p.status_label)}</strong>
            <span>(${escapeHtml(p.age_sec_str)})</span>
          </span>`
          )
          .join("")}
        <span class="wr-verdict-banner-badge" data-verdict="${escapeHtml(verdict)}" role="status" aria-live="polite">
          <span>${escapeHtml(alarmBadgeText)}</span>
          <span>·</span>
          <span>${escapeHtml(trOrKey("topbar.verdict_prefix", {}, st))} ${escapeHtml(verdictText)}</span>
        </span>
      </div>

      <div class="wr-controls-cluster">
        <div class="wr-segmented-group" role="group" aria-label="${escapeHtml(trOrKey("topbar.aria_locale", {}, st))}">
          <button type="button" class="wr-seg-btn" data-set-locale="tr" aria-pressed="${st.locale === "tr"}" translate="no">TR</button>
          <button type="button" class="wr-seg-btn" data-set-locale="en" aria-pressed="${st.locale === "en"}" translate="no">EN</button>
        </div>

        <div class="wr-segmented-group" role="group" aria-label="${escapeHtml(trOrKey("topbar.aria_register", {}, st))}">
          <button type="button" class="wr-seg-btn" data-set-register="plain" aria-pressed="${st.register === "plain"}" title="${escapeHtml(trOrKey("topbar.register_plain_hint", {}, st))}">${escapeHtml(trOrKey("topbar.register_plain", {}, st))}</button>
          <button type="button" class="wr-seg-btn" data-set-register="technical" aria-pressed="${st.register === "technical"}" title="${escapeHtml(trOrKey("topbar.register_technical_hint", {}, st))}">${escapeHtml(trOrKey("topbar.register_technical", {}, st))}</button>
        </div>

        <div class="wr-segmented-group" role="group" aria-label="${escapeHtml(trOrKey("topbar.aria_units", {}, st))}">
          <button type="button" class="wr-seg-btn" data-toggle-speed-unit="1" aria-pressed="${st.speedUnit === "kmh"}" title="${escapeHtml(trOrKey("topbar.aria_units", {}, st))}">${escapeHtml(speedUnitDisplay)}</button>
          <button type="button" class="wr-seg-btn" data-toggle-clock-mode="1" aria-pressed="${st.clockMode === "LOCAL"}" title="${escapeHtml(trOrKey("topbar.aria_units", {}, st))}">${escapeHtml(clockModeDisplay)}</button>
        </div>

        <button type="button" class="wr-hash-trigger" id="wr-btn-open-seal-modal" title="${escapeHtml(trOrKey("topbar.seal_badge_title", {}, st))}">
          ${sealBadgeInnerHtml}
        </button>

        <div class="wr-segmented-group" role="group" aria-label="${escapeHtml(trOrKey("topbar.aria_theme", {}, st))}">
          <button type="button" class="wr-seg-btn" data-set-theme="day" aria-pressed="${st.theme === "day"}" title="${escapeHtml(trOrKey("topbar.theme_day_hint", {}, st))}">${escapeHtml(trOrKey("topbar.theme_day", {}, st))}</button>
          <button type="button" class="wr-seg-btn" data-set-theme="dusk" aria-pressed="${st.theme === "dusk"}" title="${escapeHtml(trOrKey("topbar.theme_dusk_hint", {}, st))}">${escapeHtml(trOrKey("topbar.theme_dusk", {}, st))}</button>
          <button type="button" class="wr-seg-btn" data-set-theme="night" aria-pressed="${st.theme === "night"}" title="${escapeHtml(trOrKey("topbar.theme_night_hint", {}, st))}">${escapeHtml(trOrKey("topbar.theme_night", {}, st))}</button>
        </div>

        <button type="button" class="wr-btn" id="wr-btn-open-cmdk" title="${escapeHtml(trOrKey("topbar.search_hint", {}, st))}">${escapeHtml(trOrKey("topbar.search_btn", {}, st))}</button>
        <button type="button" class="wr-btn" id="wr-btn-switch-studio" title="${escapeHtml(trOrKey("app.switch_to_studio_title", {}, st))}">${escapeHtml(trOrKey("app.switch_to_studio", {}, st))}</button>
      </div>
    `;

    const cutoffBig = BigInt(st.cutoffLearnedAtMs);
    const vesselAtT2 = cutoffBig >= BigInt(T2_CUTOFF_MS);
    const heliSeen = cutoffBig >= 1762849260000n;
    const adsbStale = stalenessStrip.some((s) => s.code === "ADS-B" && s.freshness === "STALE");
    const vesselX = vesselAtT2 ? 430 : 352;
    const vesselY = vesselAtT2 ? 174 : 206;

    const vesselSpeedStr = warRoomI18n
      ? warRoomI18n.formatFpSpeedKn("14200000", ctx)
      : "14.2 kn";
    const corridorDistStr = warRoomI18n
      ? warRoomI18n.formatFpDistanceNm("5000000", ctx)
      : "5.0 NM";

    const world12Band = slice.world_12_risk_band_fp || { p50: "0", p95: "0" };
    const hudP50Str = formatFpMinutesForState(String(world12Band.p50 || "0"), st, true);
    const hudP95Str = formatFpMinutesForState(String(world12Band.p95 || "0"), st, true);

    const mapHtml = `
      <div class="wr-map-container">
        <div class="wr-map-layer-bar" role="toolbar" aria-label="${escapeHtml(trOrKey("map.aria_toolbar", {}, st))}">
          <div style="display:flex;gap:5px;flex-wrap:wrap;">
            <button type="button" class="wr-layer-chip" data-toggle-layer="ais" aria-pressed="${st.mapLayers.ais}">${escapeHtml(trOrKey("map.layer_ais", {}, st))}</button>
            <button type="button" class="wr-layer-chip" data-toggle-layer="route" aria-pressed="${st.mapLayers.route}">${escapeHtml(trOrKey("map.layer_route", {}, st))}</button>
            <button type="button" class="wr-layer-chip" data-toggle-layer="h3Wave" aria-pressed="${st.mapLayers.h3Wave}">${escapeHtml(trOrKey("map.layer_h3", {}, st))}</button>
            <button type="button" class="wr-layer-chip" data-toggle-layer="airspace" aria-pressed="${st.mapLayers.airspace}">${escapeHtml(trOrKey("map.layer_airspace", {}, st))}</button>
            <button type="button" class="wr-layer-chip" data-toggle-layer="berth" aria-pressed="${st.mapLayers.berth}">${escapeHtml(trOrKey("map.layer_berth", {}, st))}</button>
          </div>
          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
            <div class="wr-segmented-group" role="group" aria-label="${escapeHtml(trOrKey("map.aria_engine", {}, st))}">
              <button type="button" class="wr-seg-btn" data-map-engine="SVG" aria-pressed="${st.mapEngine === "SVG"}">${escapeHtml(trOrKey("map.engine_svg", {}, st))}</button>
              <button type="button" class="wr-seg-btn" data-map-engine="MAPLIBRE_DECK" aria-pressed="${st.mapEngine === "MAPLIBRE_DECK"}">${escapeHtml(trOrKey("map.engine_maplibre", {}, st))}</button>
              <button type="button" class="wr-seg-btn" data-map-engine="CESIUM_3D" aria-pressed="${st.mapEngine === "CESIUM_3D"}">${escapeHtml(trOrKey("map.engine_cesium", {}, st))}</button>
            </div>
            <span style="font-size:0.70rem;color:var(--text-muted);">${escapeHtml(trOrKey("map.zero_external_tiles", {}, st))}</span>
          </div>
        </div>

        <div style="position:relative;flex:1;display:flex;min-height:380px;">
          <div id="wr-live-maplibre-deck-host" class="wr-live-geo-viewport" ${st.mapEngine === "MAPLIBRE_DECK" ? "" : "hidden"}>
            <div class="wr-live-geo-hud-note">${escapeHtml(trOrKey("map.hud_maplibre_note", {}, st))}</div>
          </div>
          <div id="wr-live-cesium-3d-host" class="wr-live-geo-viewport" ${st.mapEngine === "CESIUM_3D" ? "" : "hidden"}>
            <div class="wr-live-geo-hud-note">${escapeHtml(trOrKey("map.hud_cesium_note", {}, st))}</div>
          </div>

          <svg class="wr-tactical-svg" viewBox="0 0 860 390" role="img" aria-label="${escapeHtml(trOrKey("map.aria_canvas", {}, st))}" ${st.mapEngine === "SVG" ? "" : 'style="opacity:0.01;pointer-events:none;"'}>
            <defs>
              <pattern id="wrChartGrid" width="44" height="44" patternUnits="userSpaceOnUse">
                <path d="M 44 0 L 0 0 0 44" fill="none" stroke="var(--chart-grid)" stroke-width="1"/>
              </pattern>
            </defs>
            <rect width="860" height="390" fill="url(#wrChartGrid)"/>

            <path d="M 520,18 L 845,18 L 845,255 L 705,245 L 615,198 L 548,142 L 505,86 Z" fill="var(--chart-land)" stroke="var(--chart-land-stroke)" stroke-width="2"/>
            <text x="585" y="64" fill="var(--text-secondary)" font-size="11" font-weight="700">${escapeHtml(trOrKey("map.port_sigacik", {}, st))}</text>

            <path d="M 48,225 L 265,208 L 312,246 L 285,320 L 118,336 L 42,292 Z" fill="var(--chart-land)" stroke="var(--chart-land-stroke)" stroke-width="2"/>
            <text x="92" y="276" fill="var(--text-secondary)" font-size="11" font-weight="700">${escapeHtml(trOrKey("map.port_vathi", {}, st))}</text>

            <text x="18" y="24" fill="var(--text-muted)" font-size="10" font-family="var(--font-mono)">${escapeHtml(trOrKey("map.corridor_coords", {}, st))} · ${escapeHtml(corridorDistStr)}</text>

            ${
              st.mapLayers.h3Wave
                ? `
            <g aria-label="${escapeHtml(trOrKey("map.layer_h3", {}, st))}">
              <polygon points="310,165 342,148 374,165 374,198 342,215 310,198" fill="rgba(167,139,250,0.16)" stroke="var(--epistemic-hypothesis)" stroke-width="1.4"/>
              <text x="320" y="185" fill="var(--epistemic-hypothesis)" font-size="9.5" font-family="var(--font-mono)">3.15 m</text>
              <polygon points="376,148 408,131 440,148 440,181 408,198 376,181" fill="rgba(255,149,0,0.15)" stroke="var(--status-serious)" stroke-width="1.4"/>
              <text x="387" y="168" fill="var(--status-serious)" font-size="9.5" font-family="var(--font-mono)">${escapeHtml(vesselSpeedStr)}</text>
            </g>`
                : ""
            }

            ${
              st.mapLayers.route
                ? `
            <g>
              <path d="M 255,228 C 335,210 415,182 518,132" fill="none" stroke="${st.highlightedCorridor === "PRIMARY_NORTH" ? "var(--status-critical)" : "var(--border-strong)"}" stroke-width="${st.highlightedCorridor === "PRIMARY_NORTH" ? "3" : "1.8"}" stroke-dasharray="8 5"/>
              <path d="M 255,236 C 350,278 448,248 536,154" fill="none" stroke="${st.highlightedCorridor === "SOUTH_SAMOS_SHELTERED" ? "var(--status-nominal)" : "var(--epistemic-observation)"}" stroke-width="${st.highlightedCorridor === "SOUTH_SAMOS_SHELTERED" ? "3.2" : "1.8"}"/>
              <text x="322" y="268" fill="var(--epistemic-observation)" font-size="10" font-weight="700">${escapeHtml(trOrKey("map.sheltered_corridor", {}, st))}</text>
            </g>`
                : ""
            }

            ${
              st.mapLayers.berth
                ? `
            <g>
              <rect x="515" y="114" width="112" height="24" rx="4" fill="var(--status-critical-bg)" stroke="var(--status-critical)" stroke-width="1.6"/>
              <text x="522" y="130" fill="var(--status-critical)" font-size="9.5" font-weight="700">${escapeHtml(trOrKey(vesselAtT2 ? "map.berth_a_locked" : "map.berth_a_watch", {}, st))}</text>
              <rect x="534" y="144" width="112" height="24" rx="4" fill="var(--status-nominal-bg)" stroke="var(--status-nominal)" stroke-width="1.8"/>
              <text x="541" y="160" fill="var(--status-nominal)" font-size="9.5" font-weight="700">${escapeHtml(trOrKey("map.berth_b_backup", {}, st))}</text>
            </g>`
                : ""
            }

            ${
              st.mapLayers.ais
                ? `
            <g style="transform-box:fill-box;transform-origin:center;">
              <circle cx="${vesselX}" cy="${vesselY}" r="18" fill="none" stroke="var(--epistemic-observation)" stroke-width="1.4" stroke-dasharray="4 3"/>
              <polygon points="${vesselX},${vesselY - 10} ${vesselX + 12},${vesselY + 8} ${vesselX - 12},${vesselY + 8}" fill="var(--epistemic-observation)" stroke="#06101d" stroke-width="1.5"/>
              <rect x="${vesselX - 118}" y="${vesselY - 46}" width="265" height="30" rx="4" fill="var(--surface-panel)" stroke="var(--border-strong)"/>
              <text x="${vesselX - 110}" y="${vesselY - 33}" fill="var(--text-primary)" font-size="10" font-weight="700">${escapeHtml(trOrKey("map.vessel_name", {}, st))} (${escapeHtml(vesselSpeedStr)})</text>
              <text x="${vesselX - 110}" y="${vesselY - 21}" fill="${vesselAtT2 ? "var(--status-critical)" : "var(--epistemic-claim)"}" font-size="9.2">${escapeHtml(trOrKey(vesselAtT2 ? "map.vessel_conflict_sub" : "map.vessel_single_sub", {}, st))}</text>
            </g>`
                : ""
            }

            ${
              st.mapLayers.airspace && heliSeen
                ? `
            <g>
              <polygon points="282,92 293,112 271,112" fill="${adsbStale ? "var(--status-caution)" : "var(--epistemic-observation)"}"/>
              <text x="300" y="102" fill="${adsbStale ? "var(--status-caution)" : "var(--text-primary)"}" font-size="10" font-weight="700">${escapeHtml(trOrKey("map.heli_name", {}, st))} · 450 m</text>
              <text x="300" y="115" fill="${adsbStale ? "var(--status-caution)" : "var(--text-muted)"}" font-size="9.2">${escapeHtml(trOrKey(adsbStale ? "map.adsb_stale" : "map.adsb_fresh", {}, st))}</text>
            </g>`
                : ""
            }
          </svg>
        </div>

        <div class="wr-map-hud-overlay">
          <div class="wr-map-hud-card">
            <strong>${escapeHtml(
              trOrKey(
                "map.hud_slice_summary",
                {
                  clock: formatClockForState(st.cutoffLearnedAtMs, st),
                  p50: hudP50Str,
                  p95: hudP95Str,
                },
                st
              )
            )}</strong>
          </div>
          <div class="wr-map-hud-card" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
            <span class="wr-epistemic-badge" data-epistemic="OBSERVATION">${escapeHtml(trOrKey("map.legend_obs", {}, st))}</span>
            <span class="wr-epistemic-badge" data-epistemic="CLAIM">${escapeHtml(trOrKey("map.legend_claim", {}, st))}</span>
            <span class="wr-epistemic-badge" data-epistemic="HYPOTHESIS">${escapeHtml(trOrKey("map.legend_hyp", {}, st))}</span>
            <span style="color:var(--text-muted);">${escapeHtml(trOrKey("map.legend_shortcut", {}, st))} <kbd translate="no">G</kbd> ${escapeHtml(trOrKey("map.legend_graph", {}, st))}</span>
          </div>
        </div>
      </div>
    `;

    const graphSources = [
      {
        id: "open_meteo_marine_ensemble",
        y: 52,
        epistemic: "HYPOTHESIS",
        valKey: "graph.node_val_meteo",
      },
      {
        id: "ferry_operator_dispatch",
        y: 122,
        epistemic: "CLAIM",
        valKey: "graph.node_val_ops",
      },
      {
        id: "ais_terrestrial_aegean",
        y: 196,
        epistemic: "OBSERVATION",
        valKey: "graph.node_val_ais",
        futureAtT1: !vesselAtT2,
      },
      {
        id: "port_berth_sensor_sigacik",
        y: 268,
        epistemic: "OBSERVATION",
        valKey: "graph.node_val_port",
        futureAtT1: !vesselAtT2,
      },
      {
        id: "opensky_aegean_adsb",
        y: 334,
        epistemic: "OBSERVATION",
        valKey: "graph.node_val_adsb",
        futureAtT1: !heliSeen,
      },
    ];

    const selectedSourceRow =
      st.catalogRows
        .slice()
        .reverse()
        .find((r) => r.source_id === st.selectedGraphNodeId) || st.catalogRows[0];
    const cfPreview = st.lastCounterfactualPreview;
    const isNodeDisabled = st.disabledSourceIds.has(st.selectedGraphNodeId);

    const selectedNodeDisplayName = warRoomI18n
      ? warRoomI18n.formatSourceName(st.selectedGraphNodeId, ctx)
      : st.selectedGraphNodeId;
    const selectedGroupDisplay = selectedSourceRow
      ? isTech
        ? selectedSourceRow.independence_group
        : warRoomI18n
          ? warRoomI18n.formatEpistemic(selectedSourceRow.epistemic_status, ctx)
          : selectedSourceRow.epistemic_status
      : "—";
    const selectedSeqDisplay = selectedSourceRow
      ? isTech
        ? `${selectedSourceRow.seq_no}${selectedSourceRow.exceeds_ieee754_safe_int ? " (>2^53-1 64-BIT STRING)" : ""}`
        : `#${selectedSourceRow.seq_no}`
      : "—";
    const selectedValDisplay = selectedSourceRow
      ? isTech
        ? `${selectedSourceRow.primary_metric_key} = "${selectedSourceRow.primary_fp_val}"`
        : selectedSourceRow.primary_metric_key === "delay_min_fp"
          ? formatFpMinutesForState(selectedSourceRow.primary_fp_val, st, true)
          : selectedSourceRow.primary_metric_key === "wave_m_fp"
            ? formatFpMetersForState(selectedSourceRow.primary_fp_val, st, 2)
            : selectedSourceRow.primary_metric_key === "baro_alt_m_fp"
              ? formatFpMetersForState(selectedSourceRow.primary_fp_val, st, 1)
              : selectedSourceRow.primary_fp_val
      : "—";

    const gateVerdictLabel = isTech
      ? verdict
      : warRoomI18n
        ? warRoomI18n.formatAlarmBadge(verdict, ctx)
        : verdict;

    const cfTransitionText =
      cfPreview && cfPreview.ok
        ? trOrKey(
            "graph.cf_result_transition",
            {
              base_verdict: isTech
                ? cfPreview.base_verdict
                : warRoomI18n
                  ? warRoomI18n.formatVerdict(cfPreview.base_verdict, {}, ctx)
                  : cfPreview.base_verdict,
              branch_verdict: isTech
                ? cfPreview.branch_verdict
                : warRoomI18n
                  ? warRoomI18n.formatVerdict(cfPreview.branch_verdict, {}, ctx)
                  : cfPreview.branch_verdict,
            },
            st
          )
        : "";
    const cfSealText =
      cfPreview && cfPreview.ok
        ? trOrKey(
            "graph.cf_result_seal",
            {
              branch_hash: String(cfPreview.branch_state_blake3 || "").slice(0, 18) + "…",
            },
            st
          )
        : "";

    const graphHtml = `
      <div class="wr-causal-chain-banner">
        <span>${escapeHtml(trOrKey("graph.chain_banner", {}, st))}</span>
        <span class="wr-mode-pill">${escapeHtml(trOrKey("counterfactual.branch_title", {}, st))}</span>
      </div>
      <div class="wr-graph-desk-split">
        <div class="wr-causal-svg-wrap">
          <svg class="wr-causal-svg" viewBox="0 0 540 380" role="img" aria-label="${escapeHtml(trOrKey("graph.aria_svg", {}, st))}">
            <rect x="332" y="138" width="188" height="92" rx="6" fill="var(--surface-elevated)" stroke="${verdict === "KURAL_İHLALİ" ? "var(--status-critical)" : verdict === "KANIT_YETERSİZ" ? "var(--status-insufficient)" : "var(--status-nominal)"}" stroke-width="2"/>
            <text x="344" y="160" fill="var(--text-primary)" font-size="10.5" font-weight="800">${escapeHtml(trOrKey("graph.gate_title", {}, st))}</text>
            <text x="344" y="178" fill="var(--text-secondary)" font-size="9.5">${escapeHtml(gateVerdictLabel)}</text>
            <text x="344" y="196" fill="var(--text-muted)" font-size="9">${escapeHtml(trOrKey("graph.gate_corroborated", { count: (slice.corroborated_groups || []).length }, st))}</text>
            <text x="344" y="213" fill="var(--epistemic-observation)" font-size="8.8">${escapeHtml(trOrKey("graph.gate_threshold", {}, st))}</text>

            ${
              vesselAtT2
                ? `
            <path d="M 244,126 C 288,142 288,180 244,196" fill="none" class="wr-conflict-dash-line"/>
            <text x="248" y="166" fill="var(--status-critical)" font-size="9" font-weight="700">${escapeHtml(trOrKey("graph.conflict_edge", {}, st))}</text>`
                : ""
            }

            ${graphSources
              .map((n) => {
                const disabled = st.disabledSourceIds.has(n.id);
                const selected = st.selectedGraphNodeId === n.id;
                const nodeTitle = warRoomI18n
                  ? warRoomI18n.formatSourceName(n.id, ctx)
                  : n.id;
                const nodeVal = trOrKey(n.valKey, {}, st);
                const epShort = warRoomI18n
                  ? warRoomI18n.formatEpistemicShort(n.epistemic, ctx)
                  : n.epistemic;
                const strokeColor = disabled
                  ? "var(--border-subtle)"
                  : selected
                    ? "var(--epistemic-observation)"
                    : n.epistemic === "OBSERVATION"
                      ? "var(--epistemic-observation)"
                      : n.epistemic === "CLAIM"
                        ? "var(--epistemic-claim)"
                        : "var(--epistemic-hypothesis)";
                const stateSuffix = disabled
                  ? " " + trOrKey("graph.node_disabled_tag", {}, st)
                  : n.futureAtT1
                    ? " " + trOrKey("graph.node_future_tag", {}, st)
                    : "";
                return `
              <g data-graph-source="${escapeHtml(n.id)}" role="button" tabindex="0" aria-label="${escapeHtml(nodeTitle + " — " + nodeVal)}" style="cursor:pointer;opacity:${disabled || n.futureAtT1 ? "0.45" : "1"}">
                <line x1="242" y1="${n.y}" x2="332" y2="184" stroke="${strokeColor}" stroke-width="${selected ? "2.2" : "1.3"}" ${disabled || n.futureAtT1 ? 'stroke-dasharray="4 4"' : ""}/>
                <rect x="16" y="${n.y - 24}" width="226" height="46" rx="5" fill="var(--surface-panel)" stroke="${strokeColor}" stroke-width="${selected ? "2.2" : "1.3"}"/>
                <text x="26" y="${n.y - 6}" fill="var(--text-primary)" font-size="9.8" font-weight="700" ${isTech ? 'translate="no"' : ""}>${escapeHtml(nodeTitle)}${escapeHtml(stateSuffix)}</text>
                <text x="26" y="${n.y + 11}" fill="var(--text-secondary)" font-size="8.9">${escapeHtml(epShort)} · ${escapeHtml(nodeVal)}</text>
              </g>`;
              })
              .join("")}

            ${
              cutoffBig >= BigInt(TAMPER_CHECK_MS)
                ? `
            <g>
              <rect x="332" y="268" width="188" height="58" rx="5" fill="var(--status-critical-bg)" stroke="var(--status-critical)" stroke-width="1.5" stroke-dasharray="5 3"/>
              <text x="341" y="287" fill="var(--status-critical)" font-size="9.4" font-weight="800">${escapeHtml(trOrKey("graph.quarantine_title", {}, st))}</text>
              <text x="341" y="303" fill="var(--text-secondary)" font-size="8.6">${escapeHtml(trOrKey("graph.quarantine_sub", {}, st))}</text>
            </g>`
                : ""
            }
          </svg>
        </div>

        <div class="wr-stress-desk-inspector">
          <h2 style="margin:0;font-weight:800;font-size:0.79rem;">${escapeHtml(trOrKey("counterfactual.branch_title", {}, st))}</h2>
          <div style="padding:8px;border-radius:5px;background:var(--surface-inset);border:1px solid var(--border-subtle);font-size:0.73rem;">
            <div>${escapeHtml(trOrKey("graph.desk_selected_node", {}, st))} <strong ${isTech ? 'translate="no"' : ""}>${escapeHtml(selectedNodeDisplayName)}</strong></div>
            <div>${escapeHtml(trOrKey("graph.desk_group", {}, st))} <strong>${escapeHtml(selectedGroupDisplay)}</strong></div>
            <div class="metric-value">${escapeHtml(trOrKey("graph.desk_seq", {}, st))} <span translate="no">${escapeHtml(selectedSeqDisplay)}</span></div>
            <div class="metric-value">${escapeHtml(trOrKey("graph.desk_value", {}, st))} <strong>${escapeHtml(selectedValDisplay)}</strong></div>
          </div>

          <button type="button" class="wr-btn ${isNodeDisabled ? "wr-btn-warn" : ""}" id="wr-btn-toggle-graph-node" data-source-id="${escapeHtml(st.selectedGraphNodeId)}">
            ${escapeHtml(trOrKey(isNodeDisabled ? "graph.btn_enable_node" : "graph.btn_disable_node", {}, st))}
          </button>

          <label for="wr-stress-preset-select" style="font-size:0.73rem;font-weight:700;">${escapeHtml(trOrKey("graph.select_intervention_label", {}, st))}</label>
          <select id="wr-stress-preset-select" name="stress_preset" class="wr-input">
            <option value="BERTH_02" ${st.customStressMode === "BERTH_02" ? "selected" : ""}>${escapeHtml(trOrKey("graph.option_berth_b", {}, st))}</option>
            <option value="ROUTE_SHELTER_01" ${st.customStressMode === "ROUTE_SHELTER_01" ? "selected" : ""}>${escapeHtml(trOrKey("graph.option_sheltered_route", {}, st))}</option>
            <option value="CUSTOM_FP" ${st.customStressMode === "CUSTOM_FP" ? "selected" : ""}>${escapeHtml(trOrKey("graph.option_custom_fp", {}, st))}</option>
          </select>

          <div class="wr-custom-fp-row">
            <label for="wr-custom-fp-input" style="font-size:0.71rem;color:var(--text-secondary);">${escapeHtml(trOrKey("graph.custom_value_label", {}, st))}</label>
            <input id="wr-custom-fp-input" name="custom_fp_val" type="text" inputmode="numeric" autocomplete="off" spellcheck="false" class="wr-input metric-value" style="flex:1;min-width:130px;" value="${escapeHtml(st.customOverrideFp)}" aria-label="${escapeHtml(trOrKey("graph.custom_value_aria", {}, st))}" />
          </div>

          <button type="button" class="wr-btn wr-btn-active" id="wr-btn-run-whatif">
            ${escapeHtml(trOrKey("graph.btn_run_whatif", {}, st))}
          </button>

          ${
            cfPreview && cfPreview.ok
              ? `
          <div role="status" aria-live="polite" style="padding:8px;border-radius:5px;border:1px solid var(--epistemic-observation);background:var(--epistemic-observation-bg);font-size:0.72rem;">
            <div style="font-weight:800;">${escapeHtml(trOrKey("graph.cf_result_title", { branch_id: cfPreview.branch_id || "cf" }, st))}</div>
            <div><strong>${escapeHtml(cfTransitionText)}</strong></div>
            <div class="hash-badge" ${isTech ? 'translate="no"' : ""}>${escapeHtml(cfSealText)}</div>
          </div>`
              : ""
          }
        </div>
      </div>
    `;
    const sentinel = st.sentinelAlert || { anomaly_count: 0, severity: "NOMINAL", summary: "" };
    const redTeam = st.redTeamAlert || {
      projected_breach_rules: [],
      severity: "NOMINAL",
      summary: "",
    };
    const auditorLocked = verdict === "KANIT_YETERSİZ";
    const activeConflicts = slice.active_conflicts || [];
    const activeAssertions = slice.active_assertions || [];
    const latestReply = st.assistantReplies[0] || null;

    const stageRuleBanner = trOrKey(
      "stage.active_rule_label",
      {
        rule_id: appliedRuleId,
        max_allowed_fp: "20000000",
      },
      st
    );

    const dockHtml = `
      <div class="wr-panel-toolbar">
        <h2 style="margin:0;font-weight:800;font-size:0.80rem;">${escapeHtml(trOrKey("dock.header_title", {}, st))}</h2>
        <span class="wr-mode-pill" ${isTech ? 'translate="no"' : ""}>${escapeHtml(trOrKey("dock.header_badge", {}, st))}</span>
      </div>

      <div class="wr-agent-roster-strip" role="list" aria-label="${escapeHtml(trOrKey("dock.aria_roster", {}, st))}">
        <div class="wr-agent-pill" role="listitem" data-agent-state="${sentinel.anomaly_count > 0 ? "ALERT" : "READY"}">
          <strong>${escapeHtml(trOrKey("dock.agent_sentinel_name", {}, st))}</strong>
          <span>${escapeHtml(trOrKey("dock.sentinel_meta", { count: sentinel.anomaly_count || 0 }, st))}</span>
        </div>
        <div class="wr-agent-pill" role="listitem" data-agent-state="${(redTeam.projected_breach_rules || []).length > 0 ? "ALERT" : "READY"}">
          <strong>${escapeHtml(trOrKey("dock.agent_redteam_name", {}, st))}</strong>
          <span>${escapeHtml(trOrKey("dock.redteam_meta", { count: (redTeam.projected_breach_rules || []).length }, st))}</span>
        </div>
        <div class="wr-agent-pill" role="listitem" data-agent-state="READY">
          <strong>${escapeHtml(trOrKey("dock.agent_strategist_name", {}, st))}</strong>
          <span>${escapeHtml(trOrKey("dock.strategist_meta", { count: st.actionCards.length }, st))}</span>
        </div>
        <div class="wr-agent-pill" role="listitem" data-agent-state="${auditorLocked ? "LOCKED" : "READY"}">
          <strong>${escapeHtml(trOrKey("dock.agent_auditor_name", {}, st))}</strong>
          <span>${escapeHtml(trOrKey(auditorLocked ? "dock.auditor_locked" : "dock.auditor_ready", {}, st))}</span>
        </div>
      </div>

      <div class="wr-agent-scroll-body">
        <div style="padding:7px 9px;border-radius:5px;background:var(--surface-inset);border:1px solid var(--border-subtle);font-size:0.72rem;">
          <div><strong>${escapeHtml(trOrKey("dock.agent_sentinel_name", {}, st))}:</strong> ${escapeHtml(sentinel.summary || sentinel.summary_tr || "")}</div>
          <div style="margin-top:3px;"><strong>${escapeHtml(trOrKey("dock.agent_redteam_name", {}, st))}:</strong> ${escapeHtml(redTeam.summary || redTeam.summary_tr || "")}</div>
        </div>

        ${
          activeConflicts.length > 0
            ? activeConflicts
                .map((cf) => {
                  const pair = activeAssertions.filter((a) =>
                    (cf.event_ids || []).includes(a.event_id)
                  );
                  const conflictSub = trOrKey(
                    "conflict.box_subtitle",
                    {
                      subject_id: cf.subject_id,
                      metric_key: cf.metric_key,
                    },
                    st
                  );
                  return `
              <div class="wr-conflict-matrix-box" role="region" aria-label="${escapeHtml(trOrKey("conflict.box_title", {}, st))}">
                <div style="font-weight:800;font-size:0.74rem;color:var(--status-caution);">
                  ⚡ ${escapeHtml(trOrKey("conflict.box_title", {}, st))}
                </div>
                <div style="font-size:0.70rem;color:var(--text-secondary);" ${isTech ? 'translate="no"' : ""}>
                  ${escapeHtml(conflictSub)}
                </div>
                <div class="wr-conflict-pair-grid">
                  ${pair
                    .map((a) => {
                      const srcLabel = warRoomI18n
                        ? warRoomI18n.formatSourceName(a.source_id, ctx)
                        : a.source_id;
                      const epLabel = warRoomI18n
                        ? warRoomI18n.formatEpistemicShort(a.epistemic_status, ctx)
                        : a.epistemic_status;
                      const valFormatted = formatFpMinutesForState(a.fp_val, st, true);
                      return `
                    <div class="wr-conflict-source-cell">
                      <div style="display:flex;justify-content:space-between;align-items:center;gap:4px;flex-wrap:wrap;">
                        <strong style="font-size:0.71rem;" ${isTech ? 'translate="no"' : ""}>${escapeHtml(srcLabel)}</strong>
                        <span class="wr-epistemic-badge" data-epistemic="${escapeHtml(a.epistemic_status)}">${epistemicSymbol(a.epistemic_status)} ${escapeHtml(epLabel)}</span>
                      </div>
                      <div class="metric-value" style="margin-top:4px;font-size:0.79rem;font-weight:800;">
                        ${escapeHtml(valFormatted)}${isTech ? ` <span translate="no">(${escapeHtml(a.fp_val)} fp · ${escapeHtml(a.event_id)})</span>` : ""}
                      </div>
                    </div>`;
                    })
                    .join("")}
                </div>
              </div>`;
                })
                .join("")
            : ""
        }

        ${st.actionCards
          .map((card) => {
            const seal = st.sealedCards[card.card_id] || null;
            const canSign = Boolean(
              card.auditor_check && card.auditor_check.observation_corroborated && !auditorLocked
            );
            const delta = card.counterfactual_delta || {};
            const isProofOpen = isTech || st.expandedProofCardIds.has(card.card_id);
            const cardAlarmText = warRoomI18n
              ? warRoomI18n.formatAlarmBadge(card.severity, ctx)
              : card.severity;
            const safetyDeltaLabel = warRoomI18n
              ? trOrKey("card.delta_safety_label", {}, st)
              : "Δ Emniyet/Risk:";
            const expectedOutcomeText = isTech
              ? `${card.base_verdict} → ${card.branch_verdict}`
              : `${warRoomI18n ? warRoomI18n.formatVerdict(card.base_verdict, {}, ctx) : card.base_verdict} → ${warRoomI18n ? warRoomI18n.formatVerdict(card.branch_verdict, {}, ctx) : card.branch_verdict}`;
            const groupsSummary = isTech
              ? (card.independence_groups || []).join(", ") || "—"
              : String((card.independence_groups || []).length);

            return `
          <article class="wr-action-card" data-card-id="${escapeHtml(card.card_id)}" data-focused="${st.focusedActionCardId === card.card_id}" data-sealed="${Boolean(seal)}">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;flex-wrap:wrap;">
              <span style="display:inline-flex;align-items:center;gap:5px;font-weight:800;font-size:0.75rem;color:${card.severity === "SERIOUS" ? "var(--status-serious)" : "var(--status-caution)"};">
                ${severityIconSvg(card.severity)} ${escapeHtml(cardAlarmText)}
              </span>
              <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                <span class="metric-value" style="font-size:0.69rem;color:var(--text-muted);">${escapeHtml(trOrKey("dock.confidence_label", {}, st))}: ${escapeHtml(card.opencti_confidence)}%</span>
                ${
                  !isTech
                    ? `<button type="button" class="wr-proof-toggle-btn" data-toggle-card-proof="${escapeHtml(card.card_id)}" aria-expanded="${isProofOpen}">
                        ${escapeHtml(trOrKey(isProofOpen ? "dock.toggle_proof_open" : "dock.toggle_proof_closed", {}, st))}
                      </button>`
                    : ""
                }
              </div>
            </div>

            <h3 style="margin:0;font-weight:800;font-size:0.80rem;">${escapeHtml(card.title)}</h3>
            <div style="font-size:0.73rem;color:var(--text-secondary);">${escapeHtml(card.rationale || card.rationale_tr || "")}</div>

            <div style="display:flex;flex-wrap:wrap;gap:6px;padding:6px 8px;border-radius:4px;background:var(--surface-inset);font-size:0.71rem;">
              <span>${escapeHtml(trOrKey("card.delta_verdict_label", {}, st))} <strong>${escapeHtml(expectedOutcomeText)}</strong></span>
              <span>· ${escapeHtml(trOrKey("card.delta_time_label", {}, st))} <strong class="metric-value">${escapeHtml(formatFpMinutesForState(delta.delay_change_min_fp, st, true))}</strong></span>
              <span>· ${escapeHtml(safetyDeltaLabel)} <strong class="metric-value">${escapeHtml(formatFpMinutesForState(delta.safety_margin_gain_fp, st, true))}</strong></span>
              <span>· ${escapeHtml(trOrKey("card.delta_groups_label", {}, st))} <strong>${escapeHtml(groupsSummary)}</strong></span>
            </div>

            ${
              isProofOpen
                ? `
            <div class="wr-tech-proof-drawer" translate="no">
              <div>card_id: ${escapeHtml(card.card_id)} · branch_id: ${escapeHtml(card.branch_id)}</div>
              <div>state_blake3: ${escapeHtml(card.state_blake3 || stateBlake3)}</div>
              <div>branch_state_blake3: ${escapeHtml(delta.branch_state_blake3 || "")}</div>
              <div>delay_change_min_fp="${escapeHtml(delta.delay_change_min_fp || "0")}" · safety_margin_gain_fp="${escapeHtml(delta.safety_margin_gain_fp || "0")}"</div>
              <div>triggered_rules: ${escapeHtml(((card.auditor_check && card.auditor_check.triggered_rules) || []).join(", "))}</div>
            </div>`
                : ""
            }

            <div class="wr-evidence-pill-row">
              ${(card.evidence_refs || [])
                .map((evRef) => {
                  const pillText = isTech
                    ? `${epistemicSymbol(evRef.epistemic_status)} ${evRef.event_id} · ${evRef.epistemic_status}`
                    : `${epistemicSymbol(evRef.epistemic_status)} ${warRoomI18n ? warRoomI18n.formatSourceName(evRef.source_id, ctx) : evRef.source_id} · ${warRoomI18n ? warRoomI18n.formatEpistemicShort(evRef.epistemic_status, ctx) : evRef.epistemic_status}`;
                  return `<button type="button" class="wr-evidence-pill" data-epistemic="${escapeHtml(evRef.epistemic_status)}" data-focus-evidence="${escapeHtml(evRef.event_id)}" ${isTech ? 'translate="no"' : ""}>${escapeHtml(pillText)}</button>`;
                })
                .join("")}
            </div>

            ${
              seal
                ? `
            <div style="padding:7px 9px;border-radius:4px;background:var(--status-nominal-bg);border:1px solid var(--status-nominal);color:var(--status-nominal);font-size:0.71rem;" class="hash-badge">
              ${escapeHtml(
                trOrKey(
                  "card.sealed_banner",
                  {
                    pubkey: String(seal.operator_pubkey || "").slice(0, 16),
                    sig: String(seal.operator_sig || "").slice(0, 20),
                  },
                  st
                )
              )}
            </div>`
                : !canSign
                  ? `
            <div style="padding:6px 8px;border-radius:4px;background:var(--status-caution-bg);border:1px dashed var(--status-caution);color:var(--status-caution);font-size:0.71rem;">
              ${escapeHtml(trOrKey("card.auditor_lock_banner", {}, st))}
            </div>`
                  : ""
            }

            <div class="wr-action-btn-row">
              <button type="button" class="wr-btn" data-card-focus="${escapeHtml(card.card_id)}">${escapeHtml(trOrKey("dock.btn_show_on_map", {}, st))}</button>
              <button type="button" class="wr-btn" data-card-stress="${escapeHtml(card.card_id)}">${escapeHtml(trOrKey("dock.btn_simulate", {}, st))}</button>
              <button type="button" class="wr-btn wr-btn-seal" data-card-sign="${escapeHtml(card.card_id)}" ${canSign && !seal ? "" : "disabled"}>
                ${escapeHtml(trOrKey(seal ? "dock.btn_approved_done" : "dock.btn_approve_sign", {}, st))}
              </button>
            </div>
          </article>`;
          })
          .join("")}
      </div>

      <details class="wr-assistant-drawer" open>
        <summary class="wr-assistant-summary">
          <span>💬 ${escapeHtml(trOrKey("assistant.drawer_title", {}, st))}</span>
          <span class="wr-mode-pill">${escapeHtml(trOrKey("assistant.drawer_badge", {}, st))}</span>
        </summary>
        <div class="wr-assistant-body">
          <div style="display:flex;gap:5px;flex-wrap:wrap;">
            <button type="button" class="wr-layer-chip" data-assistant-preset="${escapeHtml(trOrKey("dock.assistant_preset_explain", {}, st))}">${escapeHtml(trOrKey("dock.assistant_preset_explain", {}, st))}</button>
            <button type="button" class="wr-layer-chip" data-assistant-preset="${escapeHtml(trOrKey("dock.assistant_preset_berth", {}, st))}">${escapeHtml(trOrKey("dock.assistant_preset_berth", {}, st))}</button>
          </div>
          <form id="wr-assistant-form" style="display:flex;gap:6px;">
            <input id="wr-assistant-input" name="assistant_query" type="text" autocomplete="off" spellcheck="false" class="wr-input" style="flex:1;min-width:0;" placeholder="${escapeHtml(trOrKey("dock.assistant_placeholder", {}, st))}" aria-label="${escapeHtml(trOrKey("dock.assistant_input_aria", {}, st))}" />
            <button type="submit" class="wr-btn wr-btn-active">${escapeHtml(trOrKey("dock.assistant_ask_btn", {}, st))}</button>
          </form>
          ${
            latestReply
              ? `
          <div role="status" aria-live="polite" style="padding:7px 9px;border-radius:4px;background:var(--surface-panel);border:1px solid var(--border-subtle);font-size:0.72rem;">
            ${
              isTech
                ? `<div class="hash-badge" translate="no" style="color:var(--epistemic-observation);margin-bottom:3px;">
                    ${escapeHtml(trOrKey("assistant.tools_label", {}, st))} ${escapeHtml((latestReply.mcp_tools_invoked || []).join(" → "))}
                  </div>`
                : ""
            }
            <div>${escapeHtml(latestReply.structured_answer || latestReply.structured_answer_tr || "")}</div>
            ${
              Array.isArray(latestReply.focus_chips) && latestReply.focus_chips.length > 0
                ? `<div class="wr-focus-chip-row">
                    ${latestReply.focus_chips
                      .map(
                        (chip) =>
                          `<button type="button" class="wr-evidence-pill" data-epistemic="OBSERVATION" data-assistant-focus-chip="${escapeHtml(chip.chip_kind)}" data-chip-event="${escapeHtml(chip.event_id || "")}" data-chip-card="${escapeHtml(chip.card_id || "")}">${escapeHtml(chip.label)}</button>`
                      )
                      .join("")}
                  </div>`
                : ""
            }
          </div>`
              : ""
          }
        </div>
      </details>
    `;

    function toTrackX(msStr) {
      const v = BigInt(msStr);
      const span = TIMELINE_MAX_MS - TIMELINE_MIN_MS;
      const clamped = v < TIMELINE_MIN_MS ? TIMELINE_MIN_MS : v > TIMELINE_MAX_MS ? TIMELINE_MAX_MS : v;
      const num = Number(((clamped - TIMELINE_MIN_MS) * 620n) / span);
      return 88 + num;
    }

    const needleX = toTrackX(st.cutoffLearnedAtMs);
    const scrollTopPx = Number(opts.scrollTopPx || 0);
    const viewportHeightPx = 180;
    const startIdx = Math.max(0, Math.floor(scrollTopPx / VIRTUAL_ROW_HEIGHT_PX) - 2);
    const endIdx = Math.min(
      decoratedRows.length,
      startIdx + Math.ceil(viewportHeightPx / VIRTUAL_ROW_HEIGHT_PX) + 5
    );

    function formatRowValue(r) {
      if (isTech) return r.primary_fp_val;
      if (r.primary_metric_key === "delay_min_fp") {
        return formatFpMinutesForState(r.primary_fp_val, st, true);
      }
      if (r.primary_metric_key === "wave_m_fp") {
        return formatFpMetersForState(r.primary_fp_val, st, 2);
      }
      if (r.primary_metric_key === "baro_alt_m_fp") {
        return formatFpMetersForState(r.primary_fp_val, st, 1);
      }
      if (r.primary_metric_key === "wind_speed_mps_fp") {
        const mStr = formatFpMetersForState(r.primary_fp_val, st, 1);
        return mStr.replace(/\s+m$/, " " + trOrKey("unit.mps_short", {}, st));
      }
      return r.primary_fp_val;
    }

    function renderVirtualRowsHtml(rowsSlice, offsetIndex) {
      return rowsSlice
        .map((r, i) => {
          const absIdx = offsetIndex + i;
          const topPx = absIdx * VIRTUAL_ROW_HEIGHT_PX;
          const seqCellText = isTech
            ? `${r.seq_no}${r.exceeds_ieee754_safe_int ? " (>2^53)" : ""}`
            : `#${r.seq_no}`;
          const evIdCellText = isTech ? r.event_id : `#${r.row_index + 1}`;
          const srcCellText = warRoomI18n
            ? warRoomI18n.formatSourceName(r.source_id, ctx)
            : r.source_id;
          const epCellText = warRoomI18n
            ? warRoomI18n.formatEpistemicShort(r.epistemic_status, ctx)
            : r.epistemic_status;
          const valCellText = formatRowValue(r);

          return `
            <div class="wr-virtual-grid-row" role="row" tabindex="0"
              style="top:${topPx}px;"
              data-row-event-id="${escapeHtml(r.event_id)}"
              data-row-learned-ms="${escapeHtml(r.learned_at_ms)}"
              data-future="${r.is_future}"
              data-rejected="${r.is_rejected}"
              data-selected="${st.selectedEventId === r.event_id}">
              <span class="metric-value wr-cell-ellipsis" translate="no" title="seq_no=${escapeHtml(r.seq_no)}">${escapeHtml(seqCellText)}</span>
              <span class="metric-value wr-cell-ellipsis" translate="no">${escapeHtml(evIdCellText)}</span>
              <span class="wr-cell-ellipsis" ${isTech ? 'translate="no"' : ""} title="${escapeHtml(srcCellText)}">${escapeHtml(srcCellText)}</span>
              <span><span class="wr-epistemic-badge" data-epistemic="${escapeHtml(r.epistemic_status)}">${epistemicSymbol(r.epistemic_status)} ${escapeHtml(epCellText)}</span></span>
              <span class="timestamp-cell wr-cell-ellipsis">${escapeHtml(formatClockForState(r.observed_at_ms, st))}</span>
              <span class="timestamp-cell wr-cell-ellipsis">${escapeHtml(formatClockForState(r.learned_at_ms, st))}</span>
              <span class="metric-value wr-cell-ellipsis" ${isTech ? 'translate="no"' : ""}>${escapeHtml(valCellText)}</span>
              <span class="wr-cell-ellipsis">${escapeHtml(r.temporal_status_label)}</span>
            </div>`;
        })
        .join("");
    }

    const conductorReadoutValue = isTech
      ? `${st.cutoffLearnedAtMs} (${formatClockForState(st.cutoffLearnedAtMs, st)})`
      : formatClockForState(st.cutoffLearnedAtMs, st);

    const conductorHtml = `
      <section class="wr-conductor-card" aria-label="${escapeHtml(trOrKey("conductor.aria_region", {}, st))}">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;flex-wrap:wrap;">
          <h2 style="margin:0;font-weight:800;font-size:0.77rem;">${escapeHtml(trOrKey("conductor.title", {}, st))}</h2>
          <span class="timestamp-cell" style="font-size:0.72rem;color:var(--epistemic-observation);">
            ${escapeHtml(trOrKey("conductor.readout_prefix", {}, st))} <strong>${escapeHtml(conductorReadoutValue)}</strong>
          </span>
        </div>

        <div class="wr-bitemporal-tracks">
          <svg class="wr-track-svg" viewBox="0 0 730 54" role="img" aria-label="${escapeHtml(trOrKey("conductor.aria_tracks", {}, st))}">
            <text x="6" y="18" fill="var(--text-muted)" font-size="9.2">${escapeHtml(trOrKey("conductor.track_upper", {}, st))}</text>
            <line x1="88" y1="15" x2="708" y2="15" stroke="var(--border-strong)" stroke-width="1.4"/>
            <text x="6" y="42" fill="var(--text-muted)" font-size="9.2">${escapeHtml(trOrKey("conductor.track_lower", {}, st))}</text>
            <line x1="88" y1="39" x2="708" y2="39" stroke="var(--border-strong)" stroke-width="1.4"/>

            ${st.catalogRows
              .map((r) => {
                const ox = toTrackX(r.observed_at_ms);
                const lx = toTrackX(r.learned_at_ms);
                const fut = BigInt(r.learned_at_ms) > cutoffBig;
                const col =
                  r.epistemic_status === "OBSERVATION"
                    ? "var(--epistemic-observation)"
                    : r.epistemic_status === "CLAIM"
                      ? "var(--epistemic-claim)"
                      : "var(--epistemic-hypothesis)";
                return `
              <g style="opacity:${fut ? "0.32" : "1"}">
                <line x1="${ox}" y1="15" x2="${lx}" y2="39" stroke="${col}" stroke-width="1.1" stroke-dasharray="2 2"/>
                <circle cx="${ox}" cy="15" r="3.6" fill="${col}"/>
                <rect x="${lx - 3.5}" y="35.5" width="7" height="7" fill="${col}"/>
              </g>`;
              })
              .join("")}

            <line x1="${needleX}" y1="4" x2="${needleX}" y2="50" stroke="var(--status-critical)" stroke-width="2.2"/>
          </svg>

          <input id="wr-cutoff-range" name="cutoff_learned_at_ms" class="wr-cutoff-slider" type="range"
            min="${TIMELINE_MIN_MS.toString()}" max="${TIMELINE_MAX_MS.toString()}" step="5000"
            value="${escapeHtml(st.cutoffLearnedAtMs)}"
            aria-label="${escapeHtml(trOrKey("conductor.aria_slider", {}, st))}" />
        </div>

        <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;flex-wrap:wrap;">
          <div style="display:flex;gap:5px;flex-wrap:wrap;">
            <button type="button" class="wr-btn ${st.playbackMode === "LIVE" ? "wr-btn-active" : ""}" id="wr-btn-toggle-play" title="Space">
              ${escapeHtml(trOrKey(st.playbackMode === "LIVE" ? "conductor.btn_live" : "conductor.btn_replay", {}, st))}
            </button>
            <div class="wr-segmented-group" role="group" aria-label="${escapeHtml(trOrKey("conductor.aria_speed", {}, st))}">
              <button type="button" class="wr-seg-btn" data-replay-speed="1" aria-pressed="${st.replaySpeed === 1}" translate="no">1×</button>
              <button type="button" class="wr-seg-btn" data-replay-speed="10" aria-pressed="${st.replaySpeed === 10}" translate="no">10×</button>
            </div>
            <button type="button" class="wr-btn" id="wr-btn-step-prev" title="[">${escapeHtml(trOrKey("conductor.btn_prev", {}, st))}</button>
            <button type="button" class="wr-btn" id="wr-btn-step-next" title="]">${escapeHtml(trOrKey("conductor.btn_next", {}, st))}</button>
          </div>
          <div style="display:flex;gap:5px;flex-wrap:wrap;">
            <button type="button" class="wr-btn ${st.cutoffLearnedAtMs === T1_CUTOFF_MS ? "wr-btn-active" : ""}" data-snap-cutoff="${T1_CUTOFF_MS}">${escapeHtml(trOrKey("conductor.snap_t1", {}, st))}</button>
            <button type="button" class="wr-btn ${st.cutoffLearnedAtMs === TAMPER_CHECK_MS ? "wr-btn-active" : ""}" data-snap-cutoff="${TAMPER_CHECK_MS}">${escapeHtml(trOrKey("conductor.snap_tamper", {}, st))}</button>
            <button type="button" class="wr-btn ${st.cutoffLearnedAtMs === T2_CUTOFF_MS ? "wr-btn-active" : ""}" data-snap-cutoff="${T2_CUTOFF_MS}">${escapeHtml(trOrKey("conductor.snap_t2", {}, st))}</button>
          </div>
        </div>
      </section>

      <section class="wr-telemetry-card" aria-label="${escapeHtml(trOrKey("table.aria_grid", {}, st))}">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;flex-wrap:wrap;">
          <h2 style="margin:0;font-weight:800;font-size:0.77rem;">${escapeHtml(trOrKey("table.toolbar_title", { count: decoratedRows.length }, st))}</h2>
          <div style="display:flex;gap:4px;flex-wrap:wrap;" role="group" aria-label="${escapeHtml(trOrKey("table.aria_filter", {}, st))}">
            <button type="button" class="wr-layer-chip" data-epistemic-filter="ALL" aria-pressed="${st.epistemicFilter === "ALL"}">${escapeHtml(trOrKey("table.filter_all", {}, st))}</button>
            <button type="button" class="wr-layer-chip" data-epistemic-filter="OBSERVATION" aria-pressed="${st.epistemicFilter === "OBSERVATION"}">${escapeHtml(trOrKey("map.legend_obs", {}, st))}</button>
            <button type="button" class="wr-layer-chip" data-epistemic-filter="CLAIM" aria-pressed="${st.epistemicFilter === "CLAIM"}">${escapeHtml(trOrKey("map.legend_claim", {}, st))}</button>
            <button type="button" class="wr-layer-chip" data-epistemic-filter="HYPOTHESIS" aria-pressed="${st.epistemicFilter === "HYPOTHESIS"}">${escapeHtml(trOrKey("map.legend_hyp", {}, st))}</button>
            <button type="button" class="wr-layer-chip" data-epistemic-filter="REJECTED" aria-pressed="${st.epistemicFilter === "REJECTED"}">${escapeHtml(trOrKey("table.filter_quarantine", {}, st))}</button>
          </div>
        </div>

        <div class="wr-virtual-grid-header" role="row">
          <span>${escapeHtml(trOrKey("table.col_seq", {}, st))}</span>
          <span>${escapeHtml(trOrKey("table.col_event", {}, st))}</span>
          <span>${escapeHtml(trOrKey("table.col_source", {}, st))}</span>
          <span>${escapeHtml(trOrKey("table.col_epistemic", {}, st))}</span>
          <span>${escapeHtml(trOrKey("table.col_observed", {}, st))}</span>
          <span>${escapeHtml(trOrKey("table.col_learned", {}, st))}</span>
          <span>${escapeHtml(trOrKey("table.col_value", {}, st))}</span>
          <span>${escapeHtml(trOrKey("table.col_status", {}, st))}</span>
        </div>

        <div class="wr-virtual-viewport" id="wr-virtual-viewport" role="grid" aria-rowcount="${decoratedRows.length}">
          <div class="wr-virtual-spacer" id="wr-virtual-spacer" style="height:${decoratedRows.length * VIRTUAL_ROW_HEIGHT_PX}px;">
            ${renderVirtualRowsHtml(decoratedRows.slice(startIdx, endIdx), startIdx)}
          </div>
        </div>
      </section>
    `;

    const mfObj = model.getManifestObject();
    const validationInfo = (st.sliceSync && st.sliceSync.validation) || {};
    const sealedList = Object.values(st.sealedCards);

    const sealModalHtml = `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:10px;">
        <h2 style="margin:0;font-weight:800;font-size:0.92rem;">🔒 ${escapeHtml(trOrKey("seal_modal.title", {}, st))}</h2>
        <button type="button" class="wr-btn" id="wr-btn-close-seal-modal">${escapeHtml(trOrKey("modal.close_esc", {}, st))}</button>
      </div>
      <div style="display:flex;flex-direction:column;gap:8px;font-size:0.75rem;">
        <div class="hash-badge" translate="no" style="padding:8px;border-radius:5px;background:var(--surface-inset);border:1px solid var(--border-subtle);word-break:break-all;">
          <div><strong>state_blake3:</strong> ${escapeHtml(stateBlake3 || "—")}</div>
          <div><strong>audit_chain_head:</strong> ${escapeHtml(st.auditChainHead || stateBlake3 || "—")}</div>
          <div><strong>trust_anchor_pubkey:</strong> ${escapeHtml(mfObj.trust_anchor_pubkey || "—")}</div>
          <div><strong>manifest_sig:</strong> ${escapeHtml(mfObj.manifest_sig || "—")}</div>
        </div>
        <div>
          ${escapeHtml(
            trOrKey(
              "seal_modal.packets_summary",
              {
                accepted: validationInfo.accepted_count || 0,
                rejected: validationInfo.rejected_count || 0,
              },
              st
            )
          )}
        </div>
        <div>
          <strong>${escapeHtml(trOrKey("seal_modal.sealed_cards_heading", { count: sealedList.length }, st))}</strong>
          ${
            sealedList.length === 0
              ? `<div style="color:var(--text-muted);margin-top:4px;">${escapeHtml(trOrKey("seal_modal.no_sealed_cards", {}, st))}</div>`
              : sealedList
                  .map(
                    (s) => `
                <div class="hash-badge" translate="no" style="margin-top:5px;padding:7px;border-radius:4px;background:var(--status-nominal-bg);border:1px solid var(--status-nominal);word-break:break-all;">
                  <div>card_id=${escapeHtml(s.card_id)} · approved_at_ms=${escapeHtml(s.approved_at_ms)}</div>
                  <div>operator_pubkey=${escapeHtml(s.operator_pubkey)}</div>
                  <div>operator_sig=${escapeHtml(s.operator_sig)}</div>
                </div>`
                  )
                  .join("")
          }
        </div>
      </div>
    `;

    return {
      topBarHtml,
      stageRuleBanner,
      stageHtml: st.stageMode === "MAP" ? mapHtml : graphHtml,
      dockHtml,
      conductorHtml,
      sealModalHtml,
      decoratedRows,
      renderVirtualRowsHtml,
    };
  }

  /**
   * Canlı Tarayıcı DOM Denetleyicisi:
   * - `index.html` açıldığında varsayılan olarak `Sade Operatör Görünümü` (`locale = "tr"`, `register = "plain"`) ile başlar.
   * - `ws://127.0.0.1:47809` AG-UI sunucusuna otomatik bağlanır; sunucu kapalıysa veya `file://`
   *   üzerinden açılmışsa %100 hava boşluklu yerel paketle sıfır hata ve sıfır dış ağ isteğiyle çalışır.
   */
  function mountWarRoomCockpitDom(mountOptions = {}) {
    if (typeof document === "undefined") return null;

    let urlLocale = null;
    let urlRegister = null;
    let urlTheme = null;
    let urlStage = null;
    try {
      const sp = new URLSearchParams(window.location.search || "");
      if (sp.get("lang") === "en" || sp.get("lang") === "tr") urlLocale = sp.get("lang");
      if (sp.get("view") === "technical" || sp.get("view") === "plain") {
        urlRegister = sp.get("view");
      }
      if (sp.get("theme") === "day" || sp.get("theme") === "dusk" || sp.get("theme") === "night") {
        urlTheme = sp.get("theme");
      }
      if (sp.get("stage") === "MAP" || sp.get("stage") === "GRAPH") {
        urlStage = sp.get("stage");
      }
    } catch (_) {}

    const model = createWarRoomCockpitModel({
      ...mountOptions,
      initialLocale: urlLocale || mountOptions.initialLocale || "tr",
      initialRegister: urlRegister || mountOptions.initialRegister || "plain",
      initialTheme: urlTheme || mountOptions.initialTheme || "dusk",
      initialStageMode: urlStage || mountOptions.initialStageMode || "MAP",
    });

    let shell = document.getElementById("caelus-war-room-cockpit-shell");
    if (!shell) {
      shell = document.createElement("div");
      shell.id = "caelus-war-room-cockpit-shell";
      shell.className = "wr-cockpit-shell";
      document.body.insertBefore(shell, document.body.firstChild);
    }

    let returnPill = document.getElementById("wr-return-to-cockpit-pill");
    if (!returnPill) {
      returnPill = document.createElement("button");
      returnPill.id = "wr-return-to-cockpit-pill";
      returnPill.type = "button";
      returnPill.className = "wr-return-floating-pill";
      document.body.appendChild(returnPill);
    }

    shell.innerHTML = `
      <header class="wr-top-command-bar" id="wr-top-bar"></header>
      <div class="wr-main-workspace">
        <main class="wr-stage-panel" id="wr-stage-region">
          <div class="wr-panel-toolbar">
            <div class="wr-segmented-group" role="tablist" id="wr-stage-tablist">
              <button type="button" class="wr-seg-btn" role="tab" id="wr-tab-map"></button>
              <button type="button" class="wr-seg-btn" role="tab" id="wr-tab-graph"></button>
            </div>
            <span id="wr-stage-rule-banner" style="font-size:0.72rem;color:var(--text-secondary);"></span>
          </div>
          <div class="wr-stage-viewport" id="wr-stage-viewport"></div>
        </main>
        <aside class="wr-agent-dock-panel" id="wr-agent-dock"></aside>
      </div>
      <div class="wr-bottom-conductor-zone" id="wr-bottom-conductor"></div>

      <div class="wr-modal-backdrop" id="wr-seal-modal-backdrop" hidden>
        <div class="wr-modal-dialog" role="dialog" aria-modal="true" id="wr-seal-modal-body"></div>
      </div>

      <div class="wr-modal-backdrop" id="wr-cmdk-modal-backdrop" hidden>
        <div class="wr-modal-dialog" role="dialog" aria-modal="true" id="wr-cmdk-dialog">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px;">
            <h2 id="wr-cmdk-heading" style="margin:0;font-weight:800;font-size:0.90rem;"></h2>
            <button type="button" class="wr-btn" id="wr-btn-close-cmdk"></button>
          </div>
          <input id="wr-cmdk-input" name="cmdk_search" type="search" autocomplete="off" spellcheck="false" class="wr-input" style="width:100%;margin-bottom:8px;" />
          <div id="wr-cmdk-results" style="display:flex;flex-direction:column;gap:5px;"></div>
        </div>
      </div>
    `;

    document.documentElement.setAttribute("data-c2-cockpit", "active");
    document.body.setAttribute("data-c2-cockpit", "active");

    let virtualScrollTop = 0;
    let scrollRafPending = false;
    let wsConn = null;
    let livePlayInterval = null;
    let maplibreInstance = null;
    let deckOverlayInstance = null;
    let cesiumViewerInstance = null;

    function syncDocumentThemeAndLocaleMeta() {
      const st = model.state;
      document.documentElement.lang = st.locale;
      document.documentElement.setAttribute("data-c2-register", st.register);
      document.body.setAttribute("data-c2-register", st.register);
      document.documentElement.setAttribute("data-ob-theme", st.theme);
      document.body.setAttribute("data-ob-theme", st.theme);

      const themeMeta = document.querySelector('meta[name="theme-color"]');
      if (themeMeta) {
        themeMeta.setAttribute(
          "content",
          st.theme === "day" ? "#e9eef5" : st.theme === "night" ? "#050505" : "#0b1017"
        );
      }

      try {
        if (window.location.protocol === "http:" || window.location.protocol === "https:") {
          const nextUrl = new URL(window.location.href);
          nextUrl.searchParams.set("lang", st.locale);
          nextUrl.searchParams.set("view", st.register);
          nextUrl.searchParams.set("theme", st.theme);
          nextUrl.searchParams.set("stage", st.stageMode);
          window.history.replaceState(null, "", nextUrl.toString());
        }
      } catch (_) {}
    }

    function sendWsJson(obj) {
      if (wsConn && wsConn.readyState === 1) {
        wsConn.send(JSON.stringify(obj));
        return true;
      }
      return false;
    }

    function notifyWsLocaleRegisterChange() {
      sendWsJson({
        cmd: "SET_LOCALE_REGISTER",
        cutoff_learned_at_ms: model.state.cutoffLearnedAtMs,
        locale: model.state.locale,
        register: model.state.register,
      });
    }

    function buildLocalTacticalGeoJson(st) {
      const cutoffBig = BigInt(st.cutoffLearnedAtMs);
      const atT2 = cutoffBig >= BigInt(T2_CUTOFF_MS);
      const ctx = getI18nCtx(st);
      const vesselLon = atT2 ? 26.83711 : 26.8095;
      const vesselLat = atT2 ? 38.19542 : 38.182;
      const speedLabel = warRoomI18n
        ? warRoomI18n.formatFpSpeedKn("14200000", ctx)
        : "14.2 kn";
      const features = [];

      if (st.mapLayers.route) {
        features.push(
          {
            type: "Feature",
            properties: {
              kind: "ROUTE_PRIMARY",
              stroke: st.highlightedCorridor === "PRIMARY_NORTH" ? "#ff3b30" : "#64748b",
            },
            geometry: {
              type: "LineString",
              coordinates: [
                [26.976, 37.757],
                [26.895, 37.985],
                [26.8404, 38.1998],
              ],
            },
          },
          {
            type: "Feature",
            properties: {
              kind: "ROUTE_SHELTERED",
              stroke: st.highlightedCorridor === "SOUTH_SAMOS_SHELTERED" ? "#30d158" : "#2dd4bf",
            },
            geometry: {
              type: "LineString",
              coordinates: [
                [26.976, 37.757],
                [26.785, 37.925],
                [26.8422, 38.1982],
              ],
            },
          }
        );
      }

      if (st.mapLayers.h3Wave) {
        features.push({
          type: "Feature",
          properties: { kind: "H3_WAVE_CELL", label: "3.15 m" },
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [26.8, 38.01],
                [26.86, 38.03],
                [26.88, 38.09],
                [26.83, 38.13],
                [26.77, 38.11],
                [26.76, 38.05],
                [26.8, 38.01],
              ],
            ],
          },
        });
      }

      if (st.mapLayers.ais) {
        features.push({
          type: "Feature",
          properties: {
            kind: "VESSEL",
            label: `${trOrKey("map.vessel_name", {}, st)} (${speedLabel})`,
            color: atT2 ? "#ff3b30" : "#2dd4bf",
          },
          geometry: { type: "Point", coordinates: [vesselLon, vesselLat] },
        });
      }

      if (st.mapLayers.berth) {
        features.push(
          {
            type: "Feature",
            properties: {
              kind: "BERTH_A",
              label: trOrKey(atT2 ? "map.berth_a_locked" : "map.berth_a_watch", {}, st),
              color: "#ff3b30",
            },
            geometry: { type: "Point", coordinates: [26.84041, 38.19985] },
          },
          {
            type: "Feature",
            properties: {
              kind: "BERTH_B",
              label: trOrKey("map.berth_b_backup", {}, st),
              color: "#30d158",
            },
            geometry: { type: "Point", coordinates: [26.8432, 38.1978] },
          }
        );
      }

      if (st.mapLayers.airspace && cutoffBig >= 1762849260000n) {
        features.push({
          type: "Feature",
          properties: {
            kind: "AIRCRAFT",
            label: `${trOrKey("map.heli_name", {}, st)} · 450 m`,
            color: "#ffcc00",
          },
          geometry: { type: "Point", coordinates: [26.811, 38.142] },
        });
      }

      return { type: "FeatureCollection", features };
    }

    function syncLiveMapLibreAndDeckGl() {
      const st = model.state;
      if (st.stageMode !== "MAP" || st.mapEngine !== "MAPLIBRE_DECK") return;
      const host = document.getElementById("wr-live-maplibre-deck-host");
      if (!host || typeof window.maplibregl === "undefined") return;

      const geoData = buildLocalTacticalGeoJson(st);
      const seaBg =
        st.theme === "day" ? "#dbeafe" : st.theme === "night" ? "#050505" : "#07111f";

      try {
        if (!maplibreInstance || maplibreInstance.getContainer() !== host) {
          if (maplibreInstance) {
            try {
              maplibreInstance.remove();
            } catch (_) {}
          }
          maplibreInstance = new window.maplibregl.Map({
            container: host,
            attributionControl: false,
            center: [26.855, 38.03],
            zoom: 9.1,
            pitch: 32,
            style: {
              version: 8,
              sources: {
                "caelus-tactical": { type: "geojson", data: geoData },
              },
              layers: [
                {
                  id: "sea-bg",
                  type: "background",
                  paint: { "background-color": seaBg },
                },
                {
                  id: "h3-wave-fill",
                  type: "fill",
                  source: "caelus-tactical",
                  filter: ["==", ["get", "kind"], "H3_WAVE_CELL"],
                  paint: { "fill-color": "#a78bfa", "fill-opacity": 0.24 },
                },
                {
                  id: "corridor-lines",
                  type: "line",
                  source: "caelus-tactical",
                  filter: ["in", ["get", "kind"], ["literal", ["ROUTE_PRIMARY", "ROUTE_SHELTERED"]]],
                  paint: {
                    "line-color": ["coalesce", ["get", "stroke"], "#2dd4bf"],
                    "line-width": 3,
                  },
                },
                {
                  id: "tactical-points",
                  type: "circle",
                  source: "caelus-tactical",
                  filter: ["==", ["geometry-type"], "Point"],
                  paint: {
                    "circle-radius": 7,
                    "circle-color": ["coalesce", ["get", "color"], "#2dd4bf"],
                    "circle-stroke-color": "#0b1017",
                    "circle-stroke-width": 2,
                  },
                },
              ],
            },
          });

          if (window.deck && window.deck.MapboxOverlay && window.deck.ScatterplotLayer) {
            deckOverlayInstance = new window.deck.MapboxOverlay({
              interleaved: false,
              layers: [
                new window.deck.ScatterplotLayer({
                  id: "caelus-deck-vessels",
                  data: geoData.features.filter((f) => f.geometry.type === "Point"),
                  getPosition: (d) => d.geometry.coordinates,
                  getRadius: 1100,
                  getFillColor: [45, 212, 191, 160],
                  pickable: true,
                }),
              ],
            });
            maplibreInstance.addControl(deckOverlayInstance);
          }
        } else {
          const src = maplibreInstance.getSource("caelus-tactical");
          if (src && src.setData) src.setData(geoData);
        }
      } catch (_) {
        st.mapEngine = "SVG";
      }
    }

    function syncLiveCesium3D() {
      const st = model.state;
      if (st.stageMode !== "MAP" || st.mapEngine !== "CESIUM_3D") return;
      const host = document.getElementById("wr-live-cesium-3d-host");
      if (!host || typeof window.Cesium === "undefined") return;

      try {
        const Cesium = window.Cesium;
        if (!cesiumViewerInstance || cesiumViewerInstance.container !== host) {
          if (cesiumViewerInstance && !cesiumViewerInstance.isDestroyed()) {
            cesiumViewerInstance.destroy();
          }
          cesiumViewerInstance = new Cesium.Viewer(host, {
            animation: false,
            timeline: false,
            baseLayerPicker: false,
            geocoder: false,
            homeButton: false,
            sceneModePicker: false,
            navigationHelpButton: false,
            infoBox: false,
            selectionIndicator: false,
            imageryProvider: false,
            baseLayer: false,
            skyBox: false,
          });
          cesiumViewerInstance.scene.globe.baseColor = Cesium.Color.fromCssColorString("#07111f");
          cesiumViewerInstance.camera.setView({
            destination: Cesium.Cartesian3.fromDegrees(26.85, 38.02, 72000),
          });
        }
        cesiumViewerInstance.entities.removeAll();
        const atT2 = BigInt(st.cutoffLearnedAtMs) >= BigInt(T2_CUTOFF_MS);
        cesiumViewerInstance.entities.add({
          position: Cesium.Cartesian3.fromDegrees(atT2 ? 26.83711 : 26.8095, atT2 ? 38.19542 : 38.182, 30),
          point: {
            pixelSize: 12,
            color: atT2 ? Cesium.Color.RED : Cesium.Color.CYAN,
          },
          label: {
            text: trOrKey("map.vessel_name", {}, st),
            font: "12px sans-serif",
            pixelOffset: new Cesium.Cartesian2(0, -18),
          },
        });
      } catch (_) {
        st.mapEngine = "SVG";
      }
    }

    function renderCmdkItems(filterText = "") {
      const q = String(filterText || "").toLowerCase();
      const st = model.state;
      const items = [
        {
          id: "t1",
          label: trOrKey("cmdk.item_t1", {}, st),
          run: () => applyCutoffFromUi(T1_CUTOFF_MS),
        },
        {
          id: "tamper",
          label: trOrKey("cmdk.item_tamper", {}, st),
          run: () => applyCutoffFromUi(TAMPER_CHECK_MS),
        },
        {
          id: "t2",
          label: trOrKey("cmdk.item_t2", {}, st),
          run: () => applyCutoffFromUi(T2_CUTOFF_MS),
        },
        {
          id: "seq64",
          label: trOrKey("cmdk.item_seq64", {}, st),
          run: () => {
            model.state.selectedEventId = "ev_106";
            renderAll();
          },
        },
        {
          id: "map",
          label: trOrKey("cmdk.item_map", {}, st),
          run: () => {
            model.state.stageMode = "MAP";
            renderAll();
          },
        },
        {
          id: "graph",
          label: trOrKey("cmdk.item_graph", {}, st),
          run: () => {
            model.state.stageMode = "GRAPH";
            renderAll();
          },
        },
        {
          id: "lang",
          label: trOrKey("cmdk.item_lang", {}, st),
          run: () => {
            model.toggleLocale();
            notifyWsLocaleRegisterChange();
            renderAll();
          },
        },
        {
          id: "register",
          label: trOrKey("cmdk.item_register", {}, st),
          run: () => {
            model.toggleRegister();
            notifyWsLocaleRegisterChange();
            renderAll();
          },
        },
        {
          id: "night",
          label: trOrKey("cmdk.item_night", {}, st),
          run: () => {
            model.state.theme = "night";
            renderAll();
          },
        },
      ].filter((it) => !q || it.label.toLowerCase().includes(q));

      const box = document.getElementById("wr-cmdk-results");
      if (!box) return;
      box.innerHTML = items
        .map(
          (it) =>
            `<button type="button" class="wr-btn" style="justify-content:flex-start;" data-cmdk-action="${escapeHtml(it.id)}">${escapeHtml(it.label)}</button>`
        )
        .join("");

      box.querySelectorAll("[data-cmdk-action]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const found = items.find((x) => x.id === btn.getAttribute("data-cmdk-action"));
          if (found) found.run();
          const modal = document.getElementById("wr-cmdk-modal-backdrop");
          if (modal) modal.hidden = true;
        });
      });
    }

    function applyCutoffFromUi(nextCutoffMs) {
      model.setCutoffMs(nextCutoffMs);
      sendWsJson({
        cmd: "EVALUATE_SLICE",
        cutoff_learned_at_ms: String(nextCutoffMs),
        locale: model.state.locale,
        register: model.state.register,
      });
    }

    function renderAll() {
      const st = model.state;
      syncDocumentThemeAndLocaleMeta();

      const snap = renderCockpitZonesSnapshot(model, { scrollTopPx: virtualScrollTop });
      const topEl = document.getElementById("wr-top-bar");
      const stageEl = document.getElementById("wr-stage-viewport");
      const stageRegion = document.getElementById("wr-stage-region");
      const stageTablist = document.getElementById("wr-stage-tablist");
      const dockEl = document.getElementById("wr-agent-dock");
      const condEl = document.getElementById("wr-bottom-conductor");
      const sealBody = document.getElementById("wr-seal-modal-body");
      const sealBackdrop = document.getElementById("wr-seal-modal-backdrop");
      const cmdkDialog = document.getElementById("wr-cmdk-dialog");
      const cmdkHeading = document.getElementById("wr-cmdk-heading");
      const cmdkCloseBtn = document.getElementById("wr-btn-close-cmdk");
      const cmdkInput = document.getElementById("wr-cmdk-input");
      const tabMap = document.getElementById("wr-tab-map");
      const tabGraph = document.getElementById("wr-tab-graph");
      const ruleBanner = document.getElementById("wr-stage-rule-banner");

      if (returnPill) {
        returnPill.textContent = trOrKey("app.return_to_cockpit", {}, st);
      }
      if (topEl) topEl.innerHTML = snap.topBarHtml;
      if (stageRegion) stageRegion.setAttribute("aria-label", trOrKey("stage.aria_region", {}, st));
      if (stageTablist) stageTablist.setAttribute("aria-label", trOrKey("stage.aria_tabs", {}, st));
      if (tabMap) {
        tabMap.textContent = trOrKey("stage.tab_map", {}, st);
        tabMap.setAttribute("aria-selected", String(st.stageMode === "MAP"));
        tabMap.setAttribute("aria-pressed", String(st.stageMode === "MAP"));
      }
      if (tabGraph) {
        tabGraph.textContent = trOrKey("stage.tab_graph", {}, st);
        tabGraph.setAttribute("aria-selected", String(st.stageMode === "GRAPH"));
        tabGraph.setAttribute("aria-pressed", String(st.stageMode === "GRAPH"));
      }
      if (ruleBanner) {
        ruleBanner.textContent = snap.stageRuleBanner;
      }
      if (stageEl) stageEl.innerHTML = snap.stageHtml;
      if (dockEl) {
        dockEl.setAttribute("aria-label", trOrKey("dock.aria_region", {}, st));
        dockEl.innerHTML = snap.dockHtml;
      }
      if (condEl) condEl.innerHTML = snap.conductorHtml;
      if (sealBody) {
        sealBody.setAttribute("aria-label", trOrKey("modal.seal_aria", {}, st));
        sealBody.innerHTML = snap.sealModalHtml;
      }
      if (cmdkDialog) cmdkDialog.setAttribute("aria-label", trOrKey("modal.cmdk_aria", {}, st));
      if (cmdkHeading) cmdkHeading.textContent = trOrKey("modal.cmdk_title", {}, st);
      if (cmdkCloseBtn) cmdkCloseBtn.textContent = trOrKey("modal.close_esc", {}, st);
      if (cmdkInput) {
        cmdkInput.setAttribute("placeholder", trOrKey("modal.cmdk_placeholder", {}, st));
        cmdkInput.setAttribute("aria-label", trOrKey("modal.cmdk_aria", {}, st));
      }

      const vp = document.getElementById("wr-virtual-viewport");
      if (vp) {
        vp.scrollTop = virtualScrollTop;
        vp.addEventListener(
          "scroll",
          () => {
            virtualScrollTop = vp.scrollTop;
            if (scrollRafPending) return;
            scrollRafPending = true;
            requestAnimationFrame(() => {
              scrollRafPending = false;
              const spacer = document.getElementById("wr-virtual-spacer");
              if (!spacer) return;
              const rows = model.getDecoratedTelemetryRows();
              const sIdx = Math.max(0, Math.floor(virtualScrollTop / VIRTUAL_ROW_HEIGHT_PX) - 2);
              const eIdx = Math.min(rows.length, sIdx + Math.ceil(180 / VIRTUAL_ROW_HEIGHT_PX) + 5);
              const freshSnap = renderCockpitZonesSnapshot(model, { scrollTopPx: virtualScrollTop });
              spacer.innerHTML = freshSnap.renderVirtualRowsHtml(rows.slice(sIdx, eIdx), sIdx);
            });
          },
          { passive: true }
        );
      }

      const rangeEl = document.getElementById("wr-cutoff-range");
      if (rangeEl) {
        rangeEl.addEventListener("input", (ev) => {
          applyCutoffFromUi(ev.target.value);
        });
      }

      const presetSel = document.getElementById("wr-stress-preset-select");
      if (presetSel) {
        presetSel.addEventListener("change", (ev) => {
          model.state.customStressMode = ev.target.value;
          renderAll();
        });
      }

      const customFpInput = document.getElementById("wr-custom-fp-input");
      if (customFpInput) {
        customFpInput.addEventListener("change", (ev) => {
          const cleaned = String(ev.target.value || "").trim();
          if (/^-?\d+$/.test(cleaned)) {
            model.state.customOverrideFp = cleaned;
          }
        });
      }

      const assistantForm = document.getElementById("wr-assistant-form");
      if (assistantForm) {
        assistantForm.addEventListener("submit", (ev) => {
          ev.preventDefault();
          const inp = document.getElementById("wr-assistant-input");
          const q = inp ? inp.value.trim() : "";
          if (!q) return;
          if (
            !sendWsJson({
              cmd: "ASSISTANT_QUERY",
              cutoff_learned_at_ms: model.state.cutoffLearnedAtMs,
              locale: model.state.locale,
              register: model.state.register,
              query: q,
            })
          ) {
            model.submitAssistantQueryLocal(q);
          }
        });
      }

      if (sealBackdrop && !sealBackdrop.hidden) {
        const closeSeal = document.getElementById("wr-btn-close-seal-modal");
        if (closeSeal) closeSeal.focus();
      }

      syncLiveMapLibreAndDeckGl();
      syncLiveCesium3D();
    }

    function activateInteractiveTarget(target) {
      if (!target || typeof target.closest !== "function") return false;

      const localeBtn = target.closest("[data-set-locale]");
      if (localeBtn) {
        model.setLocale(localeBtn.getAttribute("data-set-locale"));
        notifyWsLocaleRegisterChange();
        renderAll();
        return true;
      }

      const registerBtn = target.closest("[data-set-register]");
      if (registerBtn) {
        model.setRegister(registerBtn.getAttribute("data-set-register"));
        notifyWsLocaleRegisterChange();
        renderAll();
        return true;
      }

      const speedUnitBtn = target.closest("[data-toggle-speed-unit]");
      if (speedUnitBtn) {
        const nextSpeed = model.state.speedUnit === "kn" ? "kmh" : "kn";
        model.setUnits({
          speedUnit: nextSpeed,
          distanceUnit: nextSpeed === "kmh" ? "km" : "nm",
        });
        return true;
      }

      const clockModeBtn = target.closest("[data-toggle-clock-mode]");
      if (clockModeBtn) {
        model.setUnits({
          clockMode: model.state.clockMode === "UTC" ? "LOCAL" : "UTC",
        });
        return true;
      }

      const proofBtn = target.closest("[data-toggle-card-proof]");
      if (proofBtn) {
        model.toggleCardProof(proofBtn.getAttribute("data-toggle-card-proof"));
        return true;
      }

      const focusChipBtn = target.closest("[data-assistant-focus-chip]");
      if (focusChipBtn) {
        const kind = focusChipBtn.getAttribute("data-assistant-focus-chip");
        if (kind === "FOCUS_MAP_ENTITY") {
          model.state.stageMode = "MAP";
          model.state.highlightedCorridor = "PRIMARY_NORTH";
          renderAll();
        } else if (kind === "FOCUS_EVENT_ROW") {
          const evId = focusChipBtn.getAttribute("data-chip-event") || "ev_106";
          model.state.selectedEventId = evId;
          renderAll();
        } else if (kind === "SIMULATE_CARD") {
          const cardId = focusChipBtn.getAttribute("data-chip-card") || "coa-20261111-01";
          const card = model.state.actionCards.find((c) => c.card_id === cardId);
          model.state.stageMode = "GRAPH";
          if (card) {
            model.runInteractiveCounterfactual(card.interventions, card.branch_id);
          } else {
            renderAll();
          }
        }
        return true;
      }

      const themeBtn = target.closest("[data-set-theme]");
      if (themeBtn) {
        model.state.theme = themeBtn.getAttribute("data-set-theme");
        renderAll();
        return true;
      }

      if (target.closest("#wr-tab-map")) {
        model.state.stageMode = "MAP";
        renderAll();
        return true;
      }
      if (target.closest("#wr-tab-graph")) {
        model.state.stageMode = "GRAPH";
        renderAll();
        return true;
      }

      if (target.closest("#wr-btn-switch-studio")) {
        document.documentElement.removeAttribute("data-c2-cockpit");
        document.body.removeAttribute("data-c2-cockpit");
        return true;
      }

      if (target.closest("#wr-btn-open-seal-modal")) {
        const m = document.getElementById("wr-seal-modal-backdrop");
        if (m) m.hidden = false;
        return true;
      }
      if (target.closest("#wr-btn-close-seal-modal") || target.id === "wr-seal-modal-backdrop") {
        const m = document.getElementById("wr-seal-modal-backdrop");
        if (m) m.hidden = true;
        return true;
      }

      if (target.closest("#wr-btn-open-cmdk")) {
        const m = document.getElementById("wr-cmdk-modal-backdrop");
        if (m) {
          m.hidden = false;
          renderCmdkItems("");
          const inp = document.getElementById("wr-cmdk-input");
          if (inp) inp.focus();
        }
        return true;
      }
      if (target.closest("#wr-btn-close-cmdk") || target.id === "wr-cmdk-modal-backdrop") {
        const m = document.getElementById("wr-cmdk-modal-backdrop");
        if (m) m.hidden = true;
        return true;
      }

      const layerBtn = target.closest("[data-toggle-layer]");
      if (layerBtn) {
        const k = layerBtn.getAttribute("data-toggle-layer");
        model.state.mapLayers[k] = !model.state.mapLayers[k];
        renderAll();
        return true;
      }

      const engineBtn = target.closest("[data-map-engine]");
      if (engineBtn) {
        model.state.mapEngine = engineBtn.getAttribute("data-map-engine") || "SVG";
        renderAll();
        return true;
      }

      const evFocusPill = target.closest("[data-focus-evidence]");
      if (evFocusPill) {
        const evId = evFocusPill.getAttribute("data-focus-evidence");
        model.state.selectedEventId = evId;
        const foundRow = model.state.catalogRows.find((r) => r.event_id === evId);
        if (foundRow) {
          model.state.selectedGraphNodeId = foundRow.source_id;
          virtualScrollTop = Math.max(0, foundRow.row_index * VIRTUAL_ROW_HEIGHT_PX - 36);
        }
        renderAll();
        return true;
      }

      const graphNode = target.closest("[data-graph-source]");
      if (graphNode) {
        model.state.selectedGraphNodeId = graphNode.getAttribute("data-graph-source");
        renderAll();
        return true;
      }

      if (target.closest("#wr-btn-toggle-graph-node")) {
        model.toggleGraphSourceDisabled(model.state.selectedGraphNodeId);
        return true;
      }

      if (target.closest("#wr-btn-run-whatif")) {
        const customFpEl = document.getElementById("wr-custom-fp-input");
        const fpValStr =
          customFpEl && /^-?\d+$/.test(customFpEl.value.trim())
            ? customFpEl.value.trim()
            : model.state.customOverrideFp || "16000000";
        model.state.customOverrideFp = fpValStr;

        const interventions =
          model.state.customStressMode === "BERTH_02"
            ? [{ target_id: "BERTH_02", override_field: "status", fp_val: "0" }]
            : model.state.customStressMode === "ROUTE_SHELTER_01"
              ? [
                  {
                    target_id: "ROUTE_SHELTER_01",
                    override_field: "route_shelter_corridor",
                    fp_val: fpValStr,
                  },
                ]
              : [
                  {
                    target_id: "VESSEL_AEGEAN_01",
                    override_field: "delay_min_fp",
                    fp_val: fpValStr,
                  },
                ];
        if (
          !sendWsJson({
            cmd: "RUN_COUNTERFACTUAL",
            base_cutoff_ms: model.state.cutoffLearnedAtMs,
            branch_id: "cf_ui_desk",
            interventions,
          })
        ) {
          model.runInteractiveCounterfactual(interventions, "cf_ui_desk");
        }
        return true;
      }

      const snapBtn = target.closest("[data-snap-cutoff]");
      if (snapBtn) {
        applyCutoffFromUi(snapBtn.getAttribute("data-snap-cutoff"));
        return true;
      }

      const speedBtn = target.closest("[data-replay-speed]");
      if (speedBtn) {
        const sp = Number(speedBtn.getAttribute("data-replay-speed")) === 10 ? 10 : 1;
        model.state.replaySpeed = sp;
        renderAll();
        return true;
      }

      if (target.closest("#wr-btn-step-prev")) {
        const t = model.stepEventCursor(-1);
        sendWsJson({
          cmd: "EVALUATE_SLICE",
          cutoff_learned_at_ms: t,
          locale: model.state.locale,
          register: model.state.register,
        });
        return true;
      }
      if (target.closest("#wr-btn-step-next")) {
        const t = model.stepEventCursor(1);
        sendWsJson({
          cmd: "EVALUATE_SLICE",
          cutoff_learned_at_ms: t,
          locale: model.state.locale,
          register: model.state.register,
        });
        return true;
      }

      if (target.closest("#wr-btn-toggle-play")) {
        if (model.state.playbackMode === "LIVE") {
          model.state.playbackMode = "REPLAY";
          if (livePlayInterval) {
            clearInterval(livePlayInterval);
            livePlayInterval = null;
          }
        } else {
          model.state.playbackMode = "LIVE";
          livePlayInterval = setInterval(() => {
            const mult = BigInt(model.state.replaySpeed || 1);
            const cur = BigInt(model.state.cutoffLearnedAtMs);
            const nxt =
              cur + 30000n * mult <= TIMELINE_MAX_MS ? cur + 30000n * mult : TIMELINE_MIN_MS;
            applyCutoffFromUi(nxt.toString());
          }, 900);
        }
        renderAll();
        return true;
      }

      const filterBtn = target.closest("[data-epistemic-filter]");
      if (filterBtn) {
        model.state.epistemicFilter = filterBtn.getAttribute("data-epistemic-filter");
        virtualScrollTop = 0;
        renderAll();
        return true;
      }

      const rowEl = target.closest("[data-row-event-id]");
      if (rowEl) {
        model.state.selectedEventId = rowEl.getAttribute("data-row-event-id");
        renderAll();
        return true;
      }

      const focusBtn = target.closest("[data-card-focus]");
      if (focusBtn) {
        const cid = focusBtn.getAttribute("data-card-focus");
        model.state.focusedActionCardId = cid;
        model.state.stageMode = "MAP";
        model.state.highlightedCorridor =
          cid === "coa-20261111-02" ? "SOUTH_SAMOS_SHELTERED" : "PRIMARY_NORTH";
        renderAll();
        return true;
      }

      const stressBtn = target.closest("[data-card-stress]");
      if (stressBtn) {
        const cid = stressBtn.getAttribute("data-card-stress");
        const card = model.state.actionCards.find((c) => c.card_id === cid);
        model.state.stageMode = "GRAPH";
        if (card) {
          model.runInteractiveCounterfactual(card.interventions, card.branch_id);
        } else {
          renderAll();
        }
        return true;
      }

      const signBtn = target.closest("[data-card-sign]");
      if (signBtn) {
        const cid = signBtn.getAttribute("data-card-sign");
        const sealRes = model.signAndSealActionCardLocal(cid);
        if (sealRes.ok) {
          sendWsJson({
            cmd: "SIGN_ACTION_CARD",
            card_id: sealRes.card_id,
            scenario_id: sealRes.scenario_id,
            verdict_context: sealRes.verdict_context,
            state_blake3: sealRes.state_blake3,
            branch_state_blake3: sealRes.branch_state_blake3,
            approved_at_ms: sealRes.approved_at_ms,
            operator_pubkey: sealRes.operator_pubkey,
            operator_sig: sealRes.operator_sig,
          });
        }
        return true;
      }

      const presetAsk = target.closest("[data-assistant-preset]");
      if (presetAsk) {
        const q = presetAsk.getAttribute("data-assistant-preset");
        if (
          !sendWsJson({
            cmd: "ASSISTANT_QUERY",
            cutoff_learned_at_ms: model.state.cutoffLearnedAtMs,
            locale: model.state.locale,
            register: model.state.register,
            query: q,
          })
        ) {
          model.submitAssistantQueryLocal(q);
        }
        return true;
      }

      return false;
    }

    shell.addEventListener("click", (ev) => {
      activateInteractiveTarget(ev.target);
    });

    shell.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " ") {
        const interactiveSvgOrRow =
          ev.target &&
          typeof ev.target.closest === "function" &&
          (ev.target.closest("[data-graph-source]") || ev.target.closest("[data-row-event-id]"));
        if (interactiveSvgOrRow) {
          ev.preventDefault();
          activateInteractiveTarget(interactiveSvgOrRow);
        }
      }
    });

    returnPill.addEventListener("click", () => {
      document.documentElement.setAttribute("data-c2-cockpit", "active");
      document.body.setAttribute("data-c2-cockpit", "active");
    });

    const cmdkInput = document.getElementById("wr-cmdk-input");
    if (cmdkInput) {
      cmdkInput.addEventListener("input", (ev) => {
        renderCmdkItems(ev.target.value);
      });
    }

    // Klavye Kısayolları: Space, [, ], L (TR<->EN), S (Sade<->Teknik), M, G, Alt+1/2/3, Cmd/Ctrl+K, Escape
    window.addEventListener("keydown", (ev) => {
      if (!document.body.hasAttribute("data-c2-cockpit")) return;
      const tag = (ev.target && ev.target.tagName) || "";
      const inInput = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";

      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "k") {
        ev.preventDefault();
        const m = document.getElementById("wr-cmdk-modal-backdrop");
        if (m) {
          m.hidden = !m.hidden;
          if (!m.hidden) {
            renderCmdkItems("");
            const inp = document.getElementById("wr-cmdk-input");
            if (inp) inp.focus();
          }
        }
        return;
      }

      if (ev.key === "Escape") {
        const sModal = document.getElementById("wr-seal-modal-backdrop");
        const cModal = document.getElementById("wr-cmdk-modal-backdrop");
        if (sModal && !sModal.hidden) sModal.hidden = true;
        if (cModal && !cModal.hidden) cModal.hidden = true;
        return;
      }

      if (inInput) return;

      document.body.setAttribute("data-kbd-instant", "1");
      setTimeout(() => document.body.removeAttribute("data-kbd-instant"), 60);

      if (ev.altKey && ev.key === "1") {
        ev.preventDefault();
        model.state.theme = "day";
        renderAll();
      } else if (ev.altKey && ev.key === "2") {
        ev.preventDefault();
        model.state.theme = "dusk";
        renderAll();
      } else if (ev.altKey && ev.key === "3") {
        ev.preventDefault();
        model.state.theme = "night";
        renderAll();
      } else if (ev.key === "[") {
        ev.preventDefault();
        const t = model.stepEventCursor(-1);
        sendWsJson({
          cmd: "EVALUATE_SLICE",
          cutoff_learned_at_ms: t,
          locale: model.state.locale,
          register: model.state.register,
        });
      } else if (ev.key === "]") {
        ev.preventDefault();
        const t = model.stepEventCursor(1);
        sendWsJson({
          cmd: "EVALUATE_SLICE",
          cutoff_learned_at_ms: t,
          locale: model.state.locale,
          register: model.state.register,
        });
      } else if (ev.key === " ") {
        ev.preventDefault();
        const btn = document.getElementById("wr-btn-toggle-play");
        if (btn) btn.click();
      } else if (!ev.ctrlKey && !ev.metaKey && !ev.altKey && ev.key.toLowerCase() === "l") {
        ev.preventDefault();
        model.toggleLocale();
        notifyWsLocaleRegisterChange();
        renderAll();
      } else if (!ev.ctrlKey && !ev.metaKey && !ev.altKey && ev.key.toLowerCase() === "s") {
        ev.preventDefault();
        model.toggleRegister();
        notifyWsLocaleRegisterChange();
        renderAll();
      } else if (!ev.ctrlKey && !ev.metaKey && !ev.altKey && ev.key.toLowerCase() === "m") {
        model.state.stageMode = "MAP";
        renderAll();
      } else if (!ev.ctrlKey && !ev.metaKey && !ev.altKey && ev.key.toLowerCase() === "g") {
        model.state.stageMode = "GRAPH";
        renderAll();
      }
    });

    model.subscribe(() => renderAll());
    renderAll();

    // Opsiyonel Yerel Loopback AG-UI WebSocket Bağlantısı (`ws://127.0.0.1:47809/ws`)
    if (mountOptions.enableWebSocket !== false && typeof WebSocket !== "undefined") {
      try {
        const wsHost =
          window.location &&
          window.location.hostname &&
          window.location.protocol.startsWith("http")
            ? `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/ws`
            : "ws://127.0.0.1:47809/ws";
        wsConn = new WebSocket(wsHost);
        wsConn.addEventListener("open", () => {
          model.state.transportMode = "WS_LIVE";
          notifyWsLocaleRegisterChange();
          renderAll();
        });
        wsConn.addEventListener("message", (ev) => {
          try {
            const msg = JSON.parse(String(ev.data || ""));
            if (msg && msg.protocol === "CAELUS_AG_UI_V1") {
              if (msg.msg_type === "SERVER_HELLO") {
                model.state.serverAirlockMode = msg.airlock_mode || "OFFLINE_REPLAY";
                if (msg.pilot_manifest_json || msg.pilot_batch_ndjson) {
                  model.updatePilotBundle(msg.pilot_manifest_json, msg.pilot_batch_ndjson);
                }
              } else {
                model.applyAgUiEnvelopes([msg]);
              }
            } else if (msg && (msg.type === "WELCOME" || msg.type === "INIT_DATA")) {
              model.state.transportMode = "WS_CPP_ENGINE";
              renderAll();
            }
          } catch (_) {}
        });
        wsConn.addEventListener("close", () => {
          model.state.transportMode = "AIRGAPPED_LOCAL";
          renderAll();
        });
        wsConn.addEventListener("error", () => {
          model.state.transportMode = "AIRGAPPED_LOCAL";
        });
      } catch (_) {
        model.state.transportMode = "AIRGAPPED_LOCAL";
      }
    }

    return model;
  }

  if (typeof window !== "undefined" && typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => {
        if (!window.__CAELUS_WAR_ROOM_INSTANCE) {
          window.__CAELUS_WAR_ROOM_INSTANCE = mountWarRoomCockpitDom();
        }
      });
    } else if (!window.__CAELUS_WAR_ROOM_INSTANCE) {
      window.__CAELUS_WAR_ROOM_INSTANCE = mountWarRoomCockpitDom();
    }
  }

  return {
    T1_CUTOFF_MS,
    TAMPER_CHECK_MS,
    T2_CUTOFF_MS,
    EMBEDDED_AEGEAN_PILOT_BUNDLE,
    createWarRoomCockpitModel,
    renderCockpitZonesSnapshot,
    mountWarRoomCockpitDom,
  };
});
