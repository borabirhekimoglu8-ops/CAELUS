/**
 * CAELUS OS — 4-Bölgeli Endüstriyel Komuta Kokpiti Denetleyicisi (`war_room_cockpit.js`)
 *
 * Katman 3 (Master Spesifikasyon §4.1, §4.2, §4.3):
 * - Bölge 1: `TopCommandBar` (Sistem modu, canlı veri bayatlama rozetleri, Blake3 mühür denetçisi, OpenBridge Day/Dusk/Night)
 * - Bölge 2: `SpatialAndCausalStage` (Mod 1: %100 Çevrimdışı Ege Taktik Haritası + H3 Dalga Izgarası; Mod 2: Yönlü Nedensel Graf + Karşı-Olgu "What-If" Masası)
 * - Bölge 3: `BiTemporalTimeConductor` (`observed_at_ms` + `cutoff_learned_at_ms` T1 ↔ T2 Zaman Gezgini) & Sanallaştırılmış `TelemetryStreamGrid` (`CLS = 0`, `> 2^53 - 1` kayıpsız `seq_no` string)
 * - Bölge 4: `FourAgentCommandDock` (`SENTINEL`, `RED_TEAM`, `STRATEGIST`, `AUDITOR`, Karşılaştırmalı Action Card'lar, Operatör Ed25519 İmzası ve Kanıt-Bağlı Komuta Asistanı)
 *
 * A-1 / A-2 / A-3 Garantileri:
 * - Sıfır harici CDN / Google Fonts / çevrimiçi harita karo isteği.
 * - Tüm 64-bit tam sayılar (`seq_no`, `fp_val`, `observed_at_ms`, `learned_at_ms`) ondalık ASCII `string` olarak işlenir.
 * - `ws://127.0.0.1:47809` mevcutsa canlı AG-UI akışına bağlanır; çevrimdışı (air-gapped / `file://`) modda yerel deterministik motorla birebir aynı `state_blake3` özetlerini üretir.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    const sidecarAirlock = require("./sidecar_airlock_mcp.js");
    const agUiEngine = require("./war_room_ag_ui_engine.js");
    module.exports = factory(sidecarAirlock, agUiEngine);
  } else {
    root.CaelusWarRoomCockpit = factory(
      root.CaelusSidecarAirlockMcp,
      root.CaelusWarRoomAgUiEngine
    );
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (sidecarAirlock, agUiEngine) {
  "use strict";

  const T1_CUTOFF_MS = "1762848600000"; // 2025-11-11T08:10:00Z -> KANIT_YETERSİZ
  const TAMPER_CHECK_MS = "1762848900000"; // 2025-11-11T08:15:00Z -> SOURCE_EQUIVOCATION karantina
  const T2_CUTOFF_MS = "1762849500000"; // 2025-11-11T08:25:00Z -> KURAL_İHLALİ
  const TIMELINE_MIN_MS = 1762848240000n;
  const TIMELINE_MAX_MS = 1762849560000n;
  const VIRTUAL_ROW_HEIGHT_PX = 36;

  // Deterministik Operatör Ed25519 Test/Komuta Anahtar Tohumu (Yerel Hava Boşluklu İmzalama için)
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

  function formatUtcClockFromMsStr(msDecStr) {
    try {
      const ms = Number(BigInt(String(msDecStr)));
      const d = new Date(ms);
      const hh = String(d.getUTCHours()).padStart(2, "0");
      const mm = String(d.getUTCMinutes()).padStart(2, "0");
      const ss = String(d.getUTCSeconds()).padStart(2, "0");
      return `${hh}:${mm}:${ss} UTC`;
    } catch (_) {
      return `${msDecStr} ms`;
    }
  }

  function formatFpScaled(fpDecStr, unitSuffix, decimals = 1) {
    if (typeof fpDecStr !== "string" || fpDecStr.length === 0) return `0.0 ${unitSuffix}`;
    try {
      const v = BigInt(fpDecStr);
      const neg = v < 0n;
      const abs = neg ? -v : v;
      const whole = abs / 1000000n;
      const rem = abs % 1000000n;
      if (decimals === 2) {
        const frac2 = String((rem + 5000n) / 10000n).padStart(2, "0").slice(0, 2);
        return `${neg ? "-" : ""}${whole.toString()}.${frac2} ${unitSuffix}`;
      }
      const frac1 = ((rem + 50000n) / 100000n).toString().slice(0, 1);
      return `${neg ? "-" : "+"}${whole.toString()}.${frac1} ${unitSuffix}`;
    } catch (_) {
      return `${fpDecStr} ${unitSuffix}`;
    }
  }

  /**
   * Astro UXDS kuralı: Ciddiyet asla sadece renkle anlatılmaz; geometrik SVG şekil + etiket zorunludur.
   */
  function severityIconSvg(severityOrVerdict) {
    const key = String(severityOrVerdict || "").toUpperCase();
    if (key === "CRITICAL" || key === "KURAL_İHLALİ") {
      // Altıgen / Sekizgen Durdurma İkonu
      return '<svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true"><polygon points="5,1 11,1 15,5 15,11 11,15 5,15 1,11 1,5" fill="currentColor"/></svg>';
    }
    if (key === "SERIOUS" || key === "CAUTION" || key === "STALE") {
      // Uyarı Üçgeni
      return '<svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true"><polygon points="8,1.5 15,14.5 1,14.5" fill="currentColor"/></svg>';
    }
    if (key === "NOMINAL" || key === "GEÇTİ" || key === "FRESH") {
      // Dolu Daire
      return '<svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6" fill="currentColor"/></svg>';
    }
    // KANIT_YETERSİZ / INSUFFICIENT: İçi Boş Eşkenar Dörtgen (Fail-Closed Kilit)
    return '<svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true"><polygon points="8,1.5 14.5,8 8,14.5 1.5,8" fill="none" stroke="currentColor" stroke-width="2"/></svg>';
  }

  function epistemicSymbol(epistemicStatus) {
    if (epistemicStatus === "OBSERVATION") return "●";
    if (epistemicStatus === "CLAIM") return "◆";
    return "▲";
  }

  /**
   * Ham `.airlock.ndjson` metninden tüm zaman çizelgesi satırlarını (gelecek kesiti ve reddedilenler dahil)
   * 64-bit string hassasiyetini koruyarak ayrıştırır.
   */
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
      theme: options.initialTheme || "dusk", // "day" | "dusk" | "night"
      stageMode: options.initialStageMode || "MAP", // "MAP" | "GRAPH"
      playbackMode: "REPLAY", // "REPLAY" | "LIVE"
      transportMode: "AIRGAPPED_LOCAL", // "AIRGAPPED_LOCAL" | "WS_LIVE"
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
      customStressDeltaMin: "-18",
      lastCounterfactualPreview: null,
      sealedCards: {}, // card_id -> { operator_pubkey, operator_sig, audit_chain_head, approved_at_ms }
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
        } catch (_) {
          // Dinleyici hatası kokpiti durdurmaz
        }
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
          // Yeni kesitte kart listesi sıfırlanır; eğer yeni kesitte kart yoksa boş kalır
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
      });
      if (res.ok) {
        applyAgUiEnvelopes(res.envelopes);
      }
      return res;
    }

    function computeSourceStalenessStrip() {
      const cutoffBig = BigInt(state.cutoffLearnedAtMs);
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

      return tracked.map((item) => {
        const learnedRows = state.catalogRows.filter(
          (r) =>
            r.source_id === item.source_id &&
            !rejectedIds.has(r.event_id) &&
            BigInt(r.learned_at_ms) <= cutoffBig
        );
        if (learnedRows.length === 0) {
          return {
            code: item.code,
            source_id: item.source_id,
            freshness: "PENDING",
            age_sec_str: "—",
            label_tr: "Veri Bekleniyor",
          };
        }
        const latest = learnedRows[learnedRows.length - 1];
        const ageMs = cutoffBig - BigInt(latest.observed_at_ms);
        const ageSec = ageMs >= 0n ? ageMs / 1000n : 0n;
        const isStale = ageMs > item.max_ms;
        return {
          code: item.code,
          source_id: item.source_id,
          freshness: isStale ? "STALE" : "FRESH",
          age_sec_str: `${ageSec.toString()}sn`,
          label_tr: isStale ? "ESKİMİŞ" : "TAZE",
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
          let temporalStatus = "KESİTTE AKTİF";
          if (isFuture) {
            temporalStatus = "Henüz Öğrenilmedi (Gelecek Kesiti)";
          } else if (rejInfo) {
            temporalStatus = `KARANTİNA · ${rejInfo.error_code} (0-Bit)`;
          }
          return {
            ...r,
            is_future: isFuture,
            is_rejected: Boolean(rejInfo && !isFuture),
            rejection_info: rejInfo,
            temporal_status_tr: temporalStatus,
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

      // A-2 Fail-Closed Yasası: KANIT_YETERSİZ durumunda AUDITOR operatör mührünü kilitler
      if (
        currentVerdict === "KANIT_YETERSİZ" ||
        (card.auditor_check && !card.auditor_check.observation_corroborated)
      ) {
        return {
          ok: false,
          errorCode: "ERR_AUDITOR_FAIL_CLOSED_INSUFFICIENT_EVIDENCE",
          messageTr:
            "AUDITOR Kilidi: Bağımsız OBSERVATION kanıtı yetersizken (KANIT_YETERSİZ) operasyonel eylem imzalanamaz.",
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

    // İlk yüklemede T2 (08:25) kesitini deterministik olarak hazırla
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
   * Tarayıcı DOM Bağlayıcısı: 4-Bölgeli Endüstriyel Komuta Kokpitini `#caelus-war-room-cockpit-shell` içine çizer.
   */
  function mountWarRoomCockpitDom(rootEl, options = {}) {
    if (!rootEl || typeof document === "undefined") return null;

    const model = createWarRoomCockpitModel(options);
    const st = model.state;
    let wsClient = null;
    let liveReplayTimer = null;
    let virtualScrollTop = 0;

    function sendWsOrFallback(wsPayload, localFallbackFn) {
      if (wsClient && wsClient.readyState === 1) {
        wsClient.send(JSON.stringify(wsPayload));
        return true;
      }
      if (typeof localFallbackFn === "function") {
        localFallbackFn();
      }
      return false;
    }

    function setTheme(themeName, instantKbd = false) {
      if (!["day", "dusk", "night"].includes(themeName)) return;
      if (instantKbd) document.body.setAttribute("data-kbd-instant", "1");
      st.theme = themeName;
      document.documentElement.setAttribute("data-ob-theme", themeName);
      document.body.setAttribute("data-ob-theme", themeName);
      renderAll();
      if (instantKbd) {
        requestAnimationFrame(() => document.body.removeAttribute("data-kbd-instant"));
      }
    }

    function setStageMode(mode, instantKbd = false) {
      if (mode !== "MAP" && mode !== "GRAPH") return;
      if (instantKbd) document.body.setAttribute("data-kbd-instant", "1");
      st.stageMode = mode;
      renderStageZone();
      if (instantKbd) {
        requestAnimationFrame(() => document.body.removeAttribute("data-kbd-instant"));
      }
    }

    function toggleCockpitShellVisibility(active) {
      if (active) {
        document.body.setAttribute("data-c2-cockpit", "active");
      } else {
        document.body.removeAttribute("data-c2-cockpit");
      }
    }

    // İskelet DOM kurulumu (Sabit bölgeler: CLS = 0, yalnızca alt içerikler güncellenir)
    rootEl.innerHTML = `
      <header class="wr-top-command-bar" id="wr-zone-top-bar" role="banner"></header>

      <div class="wr-main-workspace">
        <section class="wr-stage-panel" id="wr-zone-spatial-causal" aria-label="Mekansal Taktik Harita ve Nedensel Graf Sahnesi"></section>
        <aside class="wr-agent-dock-panel" id="wr-zone-agent-dock" aria-label="4 Uzman Ajan ve Eylem Onay Komuta İskelesi"></aside>
      </div>

      <section class="wr-bottom-conductor-zone" id="wr-zone-time-conductor" aria-label="Çift-Zamanlı İletken ve Sanallaştırılmış Telemetri Akışı">
        <div class="wr-conductor-card" id="wr-bitemporal-box"></div>
        <div class="wr-telemetry-card" id="wr-telemetry-box">
          <div id="wr-telemetry-toolbar"></div>
          <div class="wr-virtual-grid-header" role="row">
            <span>seq_no (64-Bit String)</span>
            <span>event_id</span>
            <span>Kaynak / Grup</span>
            <span>Epistemik</span>
            <span>Gözlem UTC</span>
            <span>Öğrenilme UTC</span>
            <span>Sabit Nokta (1e6)</span>
            <span>Kesit Durumu</span>
          </div>
          <div class="wr-virtual-viewport" id="wr-virtual-viewport" tabindex="0" role="grid" aria-label="Sanallaştırılmış Telemetri Olay Akışı">
            <div class="wr-virtual-spacer" id="wr-virtual-spacer"></div>
          </div>
        </div>
      </section>

      <!-- Kriptografik Mühür & Manifest v2.0 Denetçi Modalı -->
      <div class="wr-modal-backdrop" id="wr-seal-inspector-modal" hidden role="dialog" aria-modal="true" aria-label="Kriptografik Mühür ve Denetim Zinciri Denetçisi">
        <div class="wr-modal-dialog" id="wr-seal-inspector-content"></div>
      </div>

      <!-- Cmd/Ctrl+K Hızlı Varlık, Kural ve Olay Arama Paleti -->
      <div class="wr-modal-backdrop" id="wr-cmdk-modal" hidden role="dialog" aria-modal="true" aria-label="Hızlı Varlık, Senaryo ve Kural Arama Paleti">
        <div class="wr-modal-dialog">
          <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:8px;">
            <strong>Hızlı Komuta Arama Paleti (Varlık · Olay · seq_no · Kural · Kesit)</strong>
            <button type="button" class="wr-btn" id="wr-btn-close-cmdk" aria-label="Arama paletini kapat">Kapat (ESC)</button>
          </div>
          <input type="search" class="wr-input" id="wr-cmdk-input" style="width:100%; margin-bottom:8px;" placeholder="Örn: 9007199254740993, VESSEL_AEGEAN_01, T1, T2, BERTH_02, KURAL_İHLALİ..." autocomplete="off">
          <div id="wr-cmdk-results" style="display:flex; flex-direction:column; gap:5px; max-height:320px; overflow-y:auto;"></div>
        </div>
      </div>
    `;

    // Evrensel 3B Stüdyodan geri dönüş kapsülü
    let returnPill = document.getElementById("wr-return-to-cockpit-pill");
    if (!returnPill) {
      returnPill = document.createElement("button");
      returnPill.type = "button";
      returnPill.id = "wr-return-to-cockpit-pill";
      returnPill.className = "wr-return-floating-pill";
      returnPill.innerHTML = "⚔ KOMUTA KOKPİTİNE DÖN (WAR ROOM)";
      returnPill.addEventListener("click", () => toggleCockpitShellVisibility(true));
      document.body.appendChild(returnPill);
    }

    const topBarEl = rootEl.querySelector("#wr-zone-top-bar");
    const stageEl = rootEl.querySelector("#wr-zone-spatial-causal");
    const agentDockEl = rootEl.querySelector("#wr-zone-agent-dock");
    const bitemporalBoxEl = rootEl.querySelector("#wr-bitemporal-box");
    const telemetryToolbarEl = rootEl.querySelector("#wr-telemetry-toolbar");
    const virtualViewportEl = rootEl.querySelector("#wr-virtual-viewport");
    const virtualSpacerEl = rootEl.querySelector("#wr-virtual-spacer");
    const sealModalEl = rootEl.querySelector("#wr-seal-inspector-modal");
    const sealContentEl = rootEl.querySelector("#wr-seal-inspector-content");
    const cmdkModalEl = rootEl.querySelector("#wr-cmdk-modal");
    const cmdkInputEl = rootEl.querySelector("#wr-cmdk-input");
    const cmdkResultsEl = rootEl.querySelector("#wr-cmdk-results");

    function renderTopBar() {
      const slice = (st.sliceSync && st.sliceSync.slice) || {};
      const verdict = slice.verdict || "KANIT_YETERSİZ";
      const stateHash = String(slice.state_blake3 || "");
      const stalenessItems = model.computeSourceStalenessStrip();

      const stalenessHtml = stalenessItems
        .map(
          (item) => `
          <span class="wr-staleness-pill" data-freshness="${item.freshness}" title="${escapeHtml(item.source_id)} · Durum: ${item.label_tr}">
            ${severityIconSvg(item.freshness)}
            <span>${escapeHtml(item.code)}:</span>
            <strong class="metric-value">${escapeHtml(item.age_sec_str)}</strong>
            <span>(${escapeHtml(item.label_tr)})</span>
          </span>`
        )
        .join("");

      topBarEl.innerHTML = `
        <div class="wr-brand-cluster">
          <span class="wr-system-title">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle cx="12" cy="12" r="9.5" stroke="currentColor" stroke-width="1.8"/>
              <path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="1.5"/>
            </svg>
            <span>CAELUS OS // WAR ROOM</span>
          </span>
          <span class="wr-mode-pill" data-transport="${st.transportMode}" id="wr-transport-badge">
            ${st.transportMode === "WS_LIVE" ? "● LIVE AIRLOCK (:47809)" : "◆ DET-MODE · HAVA BOŞLUKLU"}
          </span>
          <span class="wr-mode-pill">AEGEAN_FERRY_01 · MARITIME_SAFETY_V2</span>
          <span class="wr-verdict-banner-badge" data-verdict="${escapeHtml(verdict)}" id="wr-active-verdict-badge">
            ${severityIconSvg(verdict)}
            <span>HÜKÜM: ${escapeHtml(verdict)}</span>
          </span>
        </div>

        <div class="wr-staleness-cluster" aria-label="Canlı Sensör Tazelik Göstergeleri">
          ${stalenessHtml}
        </div>

        <div class="wr-controls-cluster">
          <button type="button" class="wr-hash-trigger hash-badge" id="wr-btn-open-seal-modal" title="state_blake3, Manifest v2.0 imzası ve denetim zinciri mühürlerini incele">
            <span>BLAKE3:</span>
            <strong>${escapeHtml(stateHash ? stateHash.slice(0, 12) + "…" : "—")}</strong>
          </button>

          <div role="group" aria-label="OpenBridge Köprüüstü Aydınlatma Teması" style="display:inline-flex; gap:4px;">
            <button type="button" class="wr-btn ${st.theme === "day" ? "wr-btn-active" : ""}" data-set-theme="day" aria-pressed="${st.theme === "day"}" title="Gündüz Köprüüstü Yüksek Kontrast (Alt+1)">Gündüz</button>
            <button type="button" class="wr-btn ${st.theme === "dusk" ? "wr-btn-active" : ""}" data-set-theme="dusk" aria-pressed="${st.theme === "dusk"}" title="Alacakaranlık Operasyon Merkezi (Alt+2)">Dusk</button>
            <button type="button" class="wr-btn ${st.theme === "night" ? "wr-btn-active" : ""}" data-set-theme="night" aria-pressed="${st.theme === "night"}" title="Gece Vardiyası Sıfır Mavi Işık (Alt+3)">Gece</button>
          </div>

          <button type="button" class="wr-btn" id="wr-btn-open-cmdk" title="Hızlı Varlık, Kural ve Olay Arama Paleti (Ctrl+K / Cmd+K)">⌕ Ara (Ctrl+K)</button>
          <button type="button" class="wr-btn" id="wr-btn-switch-studio" title="3B Evrensel Küre ve Senaryo Stüdyosu Görünümüne Geç">3B Stüdyo</button>
        </div>
      `;
    }

    function renderTacticalMapHtml() {
      const slice = (st.sliceSync && st.sliceSync.slice) || {};
      const verdict = slice.verdict || "KANIT_YETERSİZ";
      const cutoffBig = BigInt(st.cutoffLearnedAtMs);
      const isT2OrLater = cutoffBig >= BigInt(T2_CUTOFF_MS);
      const adsbLearned = cutoffBig >= 1762849260000n;
      const adsbStale = cutoffBig - 1762849115000n > 120000n;

      const primaryStroke =
        verdict === "KURAL_İHLALİ"
          ? "var(--status-critical)"
          : verdict === "GEÇTİ"
            ? "var(--status-nominal)"
            : "var(--epistemic-observation)";

      const h3Cells = [
        { cx: 295, cy: 170, code: "861e268f", wave: isT2OrLater ? "2.45m" : "1.85m", risk: isT2OrLater ? "SERIOUS" : "CAUTION" },
        { cx: 360, cy: 195, code: "861e268d", wave: isT2OrLater ? "3.15m p95" : "2.45m", risk: isT2OrLater ? "CRITICAL" : "CAUTION" },
        { cx: 430, cy: 215, code: "861e2693", wave: isT2OrLater ? "2.95m" : "2.10m", risk: isT2OrLater ? "SERIOUS" : "CAUTION" },
        { cx: 345, cy: 255, code: "861e269b", wave: "1.55m", risk: "NOMINAL" },
        { cx: 420, cy: 272, code: "861e2699", wave: "1.40m", risk: "NOMINAL" },
      ];

      function hexPoints(cx, cy, r) {
        const pts = [];
        for (let i = 0; i < 6; i++) {
          const ang = ((60 * i - 30) * Math.PI) / 180;
          pts.push(`${(cx + r * Math.cos(ang)).toFixed(1)},${(cy + r * Math.sin(ang)).toFixed(1)}`);
        }
        return pts.join(" ");
      }

      const h3Svg = st.mapLayers.h3Wave
        ? h3Cells
            .map((cell) => {
              const fill =
                cell.risk === "CRITICAL"
                  ? "rgba(255,59,48,0.20)"
                  : cell.risk === "SERIOUS"
                    ? "rgba(255,149,0,0.17)"
                    : cell.risk === "CAUTION"
                      ? "rgba(255,204,0,0.13)"
                      : "rgba(48,209,88,0.12)";
              const stroke =
                cell.risk === "CRITICAL"
                  ? "var(--status-critical)"
                  : cell.risk === "SERIOUS"
                    ? "var(--status-serious)"
                    : cell.risk === "CAUTION"
                      ? "var(--status-caution)"
                      : "var(--status-nominal)";
              return `
                <g>
                  <polygon points="${hexPoints(cell.cx, cell.cy, 34)}" fill="${fill}" stroke="${stroke}" stroke-width="1.2"/>
                  <text x="${cell.cx}" y="${cell.cy - 3}" text-anchor="middle" fill="var(--text-primary)" font-family="var(--font-mono)" font-size="9.5" font-weight="700">${cell.wave}</text>
                  <text x="${cell.cx}" y="${cell.cy + 10}" text-anchor="middle" fill="var(--text-secondary)" font-family="var(--font-mono)" font-size="8">${cell.code}</text>
                </g>`;
            })
            .join("")
        : "";

      const routeSvg = st.mapLayers.route
        ? `
          <!-- Ana Kuzey Sığacık → Vathi Koridoru -->
          <path d="M 238 118 L 308 166 L 385 204 L 478 242" fill="none" stroke="${primaryStroke}" stroke-width="${st.highlightedCorridor === "PRIMARY_NORTH" ? "3.6" : "2.2"}" stroke-dasharray="${verdict === "KURAL_İHLALİ" ? "8 5" : "none"}"/>
          <!-- Karşı-Olgu Güney Sisam Dalga Korunaklı Koridor -->
          <path d="M 238 118 L 285 215 L 365 268 L 478 242" fill="none" stroke="var(--status-nominal)" stroke-width="${st.highlightedCorridor === "SOUTH_SAMOS_SHELTERED" ? "3.6" : "1.8"}" stroke-dasharray="5 4" opacity="${st.highlightedCorridor === "SOUTH_SAMOS_SHELTERED" ? "1" : "0.72"}"/>
          <text x="366" y="290" text-anchor="middle" fill="var(--status-nominal)" font-family="var(--font-mono)" font-size="9.5" font-weight="700">KARŞI-OLGU: GÜNEY SİSAM KORUNAKLI KORİDOR</text>
        `
        : "";

      const berthSvg = st.mapLayers.berth
        ? `
          <g transform="translate(222, 92)" style="cursor:pointer;" data-map-select-event="ev_106">
            <rect x="0" y="0" width="94" height="22" rx="4" fill="var(--surface-panel)" stroke="${isT2OrLater ? "var(--status-critical)" : "var(--border-strong)"}" stroke-width="1.4"/>
            <text x="47" y="14" text-anchor="middle" fill="${isT2OrLater ? "var(--status-critical)" : "var(--text-primary)"}" font-family="var(--font-mono)" font-size="9.5" font-weight="700">BERTH-A ${isT2OrLater ? "(+35dk KİLİT)" : "(İZLEME)"}</text>
          </g>
          <g transform="translate(120, 114)" style="cursor:pointer;" data-map-focus-card="coa-20261111-01">
            <rect x="0" y="0" width="96" height="22" rx="4" fill="var(--surface-panel)" stroke="var(--status-nominal)" stroke-width="1.4"/>
            <text x="48" y="14" text-anchor="middle" fill="var(--status-nominal)" font-family="var(--font-mono)" font-size="9.5" font-weight="700">BERTH-B (YEDEK)</text>
          </g>
        `
        : "";

      const vesselX = isT2OrLater ? 268 : 252;
      const vesselY = isT2OrLater ? 140 : 128;
      const aisSvg = st.mapLayers.ais
        ? `
          <g transform="translate(${vesselX}, ${vesselY})" style="cursor:pointer;" data-map-select-event="${isT2OrLater ? "ev_104" : "ev_103"}">
            <circle cx="0" cy="0" r="17" fill="none" stroke="${primaryStroke}" stroke-width="1.3" stroke-dasharray="3 3"/>
            <line x1="0" y1="0" x2="28" y2="19" stroke="${primaryStroke}" stroke-width="2"/>
            <polygon points="-8,-6 10,0 -8,6 -4,0" transform="rotate(34)" fill="${primaryStroke}"/>
            <rect x="14" y="-24" width="174" height="32" rx="4" fill="var(--surface-panel)" stroke="${primaryStroke}" stroke-width="1.2"/>
            <text x="20" y="-11" fill="var(--text-primary)" font-family="var(--font-mono)" font-size="9.5" font-weight="700">VESSEL_AEGEAN_01 · 14.2 kn</text>
            <text x="20" y="2" fill="var(--text-secondary)" font-family="var(--font-mono)" font-size="8.8">${isT2OrLater ? "AIS:+35.0dk (OBS) ≠ OPS:+15.0dk (CLAIM)" : "OPS:+15.0dk (CLAIM · Tek Kaynak)"}</text>
          </g>
        `
        : "";

      const airspaceSvg =
        st.mapLayers.airspace && adsbLearned
          ? `
          <g transform="translate(196, 206)" style="cursor:pointer;" data-map-select-event="ev_102">
            <polygon points="0,-8 7,7 0,3 -7,7" fill="${adsbStale ? "var(--status-caution)" : "var(--epistemic-observation)"}"/>
            <rect x="-12" y="11" width="154" height="28" rx="4" fill="var(--surface-panel)" stroke="${adsbStale ? "var(--status-caution)" : "var(--epistemic-observation)"}" stroke-width="1.2"/>
            <text x="-6" y="23" fill="var(--text-primary)" font-family="var(--font-mono)" font-size="9" font-weight="700">SAR_HELI_AEGEAN_04 · 450m</text>
            <text x="-6" y="34" fill="${adsbStale ? "var(--status-caution)" : "var(--text-secondary)"}" font-family="var(--font-mono)" font-size="8.3">${adsbStale ? "▲ ADS-B ESKİMİŞ (>120sn)" : "● ADS-B TAZE GÖZLEM"}</text>
          </g>
        `
          : "";

      const vendoredEnginesReady =
        typeof window !== "undefined" &&
        Boolean(window.maplibregl || window.deck || window.Cesium);

      return `
        <div class="wr-map-container">
          <div class="wr-map-layer-bar" role="toolbar" aria-label="Taktik Harita Katman Denetimleri">
            <div style="display:flex; gap:5px; flex-wrap:wrap;">
              <button type="button" class="wr-layer-chip" data-toggle-layer="ais" aria-pressed="${st.mapLayers.ais}">● AIS Gemi</button>
              <button type="button" class="wr-layer-chip" data-toggle-layer="route" aria-pressed="${st.mapLayers.route}">━ Rota Koridoru</button>
              <button type="button" class="wr-layer-chip" data-toggle-layer="h3Wave" aria-pressed="${st.mapLayers.h3Wave}">⬡ H3 Dalga Riski</button>
              <button type="button" class="wr-layer-chip" data-toggle-layer="airspace" aria-pressed="${st.mapLayers.airspace}">▲ Hava Sahası (ADS-B)</button>
              <button type="button" class="wr-layer-chip" data-toggle-layer="berth" aria-pressed="${st.mapLayers.berth}">■ Liman Rıhtım</button>
            </div>
            <span class="metric-value" style="font-size:0.69rem; color:var(--text-secondary);">
              Yerel Vektör Harita (${vendoredEnginesReady ? "MapLibre/Deck/Cesium Yerel Paket Hazır" : "Yerel SVG Vektör"}) · 0 Dış Tile
            </span>
          </div>

          <svg class="wr-tactical-svg" viewBox="0 0 720 350" role="img" aria-label="Ege Denizi Sığacık - Sisam Vathi Taktik Deniz Koridoru Haritası">
            <defs>
              <pattern id="wr-grid-pat" width="60" height="60" patternUnits="userSpaceOnUse">
                <path d="M 60 0 L 0 0 0 60" fill="none" stroke="var(--chart-grid)" stroke-width="1"/>
              </pattern>
            </defs>
            <rect width="720" height="350" fill="url(#wr-grid-pat)"/>

            <!-- Kuzeydoğu Anadolu Kıyısı: Çeşme / Seferihisar / Sığacık / Kuşadası -->
            <path d="M 40 0 L 385 0 L 410 55 L 352 95 L 265 112 L 236 118 L 195 96 L 132 108 L 82 78 L 40 42 Z"
                  fill="var(--chart-land)" stroke="var(--chart-land-stroke)" stroke-width="1.6"/>
            <text x="232" y="68" fill="var(--text-secondary)" font-family="var(--font-mono)" font-size="10.5" font-weight="700">SEFERİHİSAR / SIĞACIK LİMANI</text>

            <!-- Doğu Kuşadası Körfezi Kıyısı -->
            <path d="M 565 72 L 720 45 L 720 350 L 635 350 L 602 252 L 585 162 Z"
                  fill="var(--chart-land)" stroke="var(--chart-land-stroke)" stroke-width="1.6"/>

            <!-- Sisam (Samos) Adası ve Vathi Limanı -->
            <path d="M 382 246 L 448 228 L 534 232 L 568 258 L 542 292 L 456 296 L 392 278 Z"
                  fill="var(--chart-land)" stroke="var(--chart-land-stroke)" stroke-width="1.8"/>
            <circle cx="482" cy="244" r="4.5" fill="var(--epistemic-observation)"/>
            <text x="482" y="266" text-anchor="middle" fill="var(--text-primary)" font-family="var(--font-mono)" font-size="10" font-weight="700">SİSAM / VATHI LİMANI</text>

            <!-- Koordinat Etiketleri & Deniz Mili Ölçeği -->
            <text x="14" y="20" fill="var(--text-muted)" font-family="var(--font-mono)" font-size="9">38°15'N · 26°45'E (EGE KORİDORU)</text>
            <g transform="translate(18, 324)">
              <line x1="0" y1="0" x2="72" y2="0" stroke="var(--text-secondary)" stroke-width="2"/>
              <line x1="0" y1="-4" x2="0" y2="4" stroke="var(--text-secondary)" stroke-width="1.5"/>
              <line x1="72" y1="-4" x2="72" y2="4" stroke="var(--text-secondary)" stroke-width="1.5"/>
              <text x="36" y="-5" text-anchor="middle" fill="var(--text-secondary)" font-family="var(--font-mono)" font-size="8.5">5.0 NM</text>
            </g>

            ${h3Svg}
            ${routeSvg}
            ${berthSvg}
            ${airspaceSvg}
            ${aisSvg}
          </svg>

          <div class="wr-map-hud-overlay">
            <div class="wr-map-hud-card metric-value">
              Kesit: <strong>${escapeHtml(formatUtcClockFromMsStr(st.cutoffLearnedAtMs))}</strong> ·
              12-Dünya Risk Bandı p50/p95:
              <strong>${escapeHtml(formatFpScaled(String((slice.world_12_risk_band_fp && slice.world_12_risk_band_fp.p50) || "0"), "dk"))}</strong> /
              <strong>${escapeHtml(formatFpScaled(String((slice.world_12_risk_band_fp && slice.world_12_risk_band_fp.p95) || "0"), "dk"))}</strong>
            </div>
            <div class="wr-map-hud-card">
              ● Gözlem &nbsp; ◆ İddia &nbsp; ▲ Hipotez &nbsp; | &nbsp; Kısayol: <kbd>G</kbd> Nedensel Graf
            </div>
          </div>
        </div>
      `;
    }

    function renderCausalGraphDeskHtml() {
      const slice = (st.sliceSync && st.sliceSync.slice) || {};
      const verdict = slice.verdict || "KANIT_YETERSİZ";
      const hasConflict =
        Array.isArray(slice.active_conflicts) && slice.active_conflicts.length > 0;
      const cutoffBig = BigInt(st.cutoffLearnedAtMs);

      const sourceNodes = [
        { id: "open_meteo_marine_ensemble", label: "open_meteo_marine", ep: "HYPOTHESIS", val: "Dalga p95 3.15m", y: 42, minMs: 1762848300000n },
        { id: "ferry_operator_dispatch", label: "ferry_operator_dispatch", ep: "CLAIM", val: "+15.0 dk Beyan", y: 98, minMs: 1762848600000n },
        { id: "ais_terrestrial_aegean", label: "ais_terrestrial_aegean", ep: "OBSERVATION", val: "+35.0 dk AIS", y: 162, minMs: 1762849380000n },
        { id: "port_berth_sensor_sigacik", label: "port_berth_sensor", ep: "OBSERVATION", val: "+35.0 dk PLC (seq>2^53)", y: 222, minMs: 1762849500000n },
        { id: "opensky_aegean_adsb", label: "opensky_aegean_adsb", ep: "OBSERVATION", val: "450m SAR ADS-B", y: 280, minMs: 1762849260000n },
      ];

      const nodesSvg = sourceNodes
        .map((n) => {
          const isLearned = cutoffBig >= n.minMs;
          const isDisabled = st.disabledSourceIds.has(n.id);
          const isSelected = st.selectedGraphNodeId === n.id;
          const stroke =
            n.ep === "OBSERVATION"
              ? "var(--epistemic-observation)"
              : n.ep === "CLAIM"
                ? "var(--epistemic-claim)"
                : "var(--epistemic-hypothesis)";
          const opacity = !isLearned || isDisabled ? "0.42" : "1";
          return `
            <g transform="translate(18, ${n.y})" opacity="${opacity}" style="cursor:pointer;" data-graph-node="${n.id}">
              <line x1="176" y1="20" x2="258" y2="148" stroke="${stroke}" stroke-width="${isSelected ? "2.2" : "1.2"}" stroke-dasharray="${n.ep === "OBSERVATION" ? "none" : "4 3"}"/>
              <rect x="0" y="0" width="176" height="40" rx="5" fill="var(--surface-panel)" stroke="${isSelected ? "var(--text-primary)" : stroke}" stroke-width="${isSelected ? "2.2" : "1.4"}"/>
              <text x="8" y="15" fill="var(--text-primary)" font-family="var(--font-mono)" font-size="9.3" font-weight="700">${epistemicSymbol(n.ep)} ${escapeHtml(n.label)}</text>
              <text x="8" y="30" fill="var(--text-secondary)" font-family="var(--font-mono)" font-size="8.8">${escapeHtml(n.val)} ${isDisabled ? "[DEVRE DIŞI]" : !isLearned ? "[GELECEK]" : ""}</text>
            </g>`;
        })
        .join("");

      const conflictEdgeSvg = hasConflict
        ? `
          <g>
            <path d="M 106 138 C 68 146, 68 154, 106 162" fill="none" class="wr-conflict-dash-line"/>
            <rect x="198" y="114" width="132" height="20" rx="4" fill="var(--status-critical-bg)" stroke="var(--status-critical)" stroke-width="1.2"/>
            <text x="264" y="127" text-anchor="middle" fill="var(--status-critical)" font-family="var(--font-mono)" font-size="8.8" font-weight="800">⚡ CONFLICT (Δ 20.0 dk)</text>
          </g>
        `
        : "";

      const tamperVisible = cutoffBig >= BigInt(TAMPER_CHECK_MS);
      const quarantineSvg = tamperVisible
        ? `
          <g transform="translate(18, 332)">
            <rect x="0" y="0" width="248" height="32" rx="4" fill="var(--status-critical-bg)" stroke="var(--status-critical)" stroke-width="1.2" stroke-dasharray="4 3"/>
            <text x="8" y="13" fill="var(--status-critical)" font-family="var(--font-mono)" font-size="8.8" font-weight="700">⛔ ev_103_equivocation (KARANTİNA)</text>
            <text x="8" y="25" fill="var(--text-secondary)" font-family="var(--font-mono)" font-size="8.2">SOURCE_EQUIVOCATION · 0-Bit State Etkisi</text>
          </g>
        `
        : "";

      const verdictColor =
        verdict === "KURAL_İHLALİ"
          ? "var(--status-critical)"
          : verdict === "GEÇTİ"
            ? "var(--status-nominal)"
            : "var(--status-insufficient)";

      const selectedSourceRows = st.catalogRows.filter(
        (r) => r.source_id === st.selectedGraphNodeId
      );
      const selectedLatest =
        selectedSourceRows[selectedSourceRows.length - 1] || st.catalogRows[0];
      const isNodeDisabled = st.disabledSourceIds.has(st.selectedGraphNodeId);
      const cf = st.lastCounterfactualPreview;

      return `
        <div class="wr-graph-desk-split">
          <div class="wr-causal-svg-wrap">
            <svg class="wr-causal-svg" viewBox="0 0 600 374" role="img" aria-label="Yönlü Nedensel Graf ve Kaynak Çatışma Ağı">
              <!-- Epistemik & Bağımsızlık Kapısı -->
              <g transform="translate(258, 122)">
                <line x1="124" y1="26" x2="174" y2="26" stroke="var(--border-strong)" stroke-width="1.8"/>
                <rect x="0" y="0" width="124" height="54" rx="6" fill="var(--surface-elevated)" stroke="var(--epistemic-observation)" stroke-width="1.6"/>
                <text x="62" y="20" text-anchor="middle" fill="var(--text-primary)" font-family="var(--font-mono)" font-size="9.5" font-weight="700">A-2 EPİSTEMİK KAPI</text>
                <text x="62" y="34" text-anchor="middle" fill="var(--text-secondary)" font-family="var(--font-mono)" font-size="8.4">Grup Teyidi: ${(slice.corroborated_groups || []).length}</text>
                <text x="62" y="46" text-anchor="middle" fill="var(--text-secondary)" font-family="var(--font-mono)" font-size="8.2">Eşik: ≥2 Gözlem/Grup</text>
              </g>

              <!-- Politika ve Deterministik Hüküm Düğümü -->
              <g transform="translate(432, 114)">
                <rect x="0" y="0" width="152" height="70" rx="6" fill="var(--surface-elevated)" stroke="${verdictColor}" stroke-width="2"/>
                <text x="76" y="19" text-anchor="middle" fill="var(--text-secondary)" font-family="var(--font-mono)" font-size="8.5">MARITIME_SAFETY_V2</text>
                <text x="76" y="38" text-anchor="middle" fill="${verdictColor}" font-family="var(--font-mono)" font-size="11" font-weight="800">${escapeHtml(verdict)}</text>
                <text x="76" y="55" text-anchor="middle" fill="var(--text-secondary)" font-family="var(--font-mono)" font-size="8.2">blake3:${escapeHtml(String(slice.state_blake3 || "").slice(0, 10))}…</text>
              </g>

              ${nodesSvg}
              ${conflictEdgeSvg}
              ${quarantineSvg}
            </svg>
          </div>

          <div class="wr-stress-desk-inspector">
            <div style="display:flex; align-items:center; justify-content:space-between; gap:6px;">
              <strong>Karşı-Olgu ("What-If") Stres Masası</strong>
              <span class="wr-epistemic-badge" data-epistemic="${escapeHtml(selectedLatest ? selectedLatest.epistemic_status : "OBSERVATION")}">
                ${epistemicSymbol(selectedLatest ? selectedLatest.epistemic_status : "OBSERVATION")}
                ${escapeHtml(selectedLatest ? selectedLatest.epistemic_status : "OBSERVATION")}
              </span>
            </div>

            <div class="metric-value" style="font-size:0.74rem; padding:7px 8px; border-radius:4px; background:var(--surface-inset); border:1px solid var(--border-subtle);">
              <div>Seçili Düğüm: <strong>${escapeHtml(st.selectedGraphNodeId)}</strong></div>
              <div>Bağımsızlık Grubu: <strong>${escapeHtml(selectedLatest ? selectedLatest.independence_group : "—")}</strong></div>
              <div>Son seq_no (String): <strong>${escapeHtml(selectedLatest ? selectedLatest.seq_no : "0")}</strong></div>
              <div>Sabit Nokta Değeri: <strong>${escapeHtml(selectedLatest ? selectedLatest.primary_fp_val : "0")} fp</strong></div>
            </div>

            <button type="button" class="wr-btn ${isNodeDisabled ? "wr-btn-warn" : ""}" id="wr-btn-toggle-disable-node">
              ${isNodeDisabled ? "↺ Düğümü Yeniden Etkinleştir" : "⊘ Düğümü Devre Dışı Bırak (What-If)"}
            </button>

            <div style="display:flex; flex-direction:column; gap:5px; padding-top:4px; border-top:1px solid var(--border-subtle);">
              <label for="wr-stress-delta-select" style="font-size:0.74rem; font-weight:700;">Müdahale / Parametre Değişikliği Seçin:</label>
              <select id="wr-stress-delta-select" class="wr-input" style="width:100%;">
                <option value="BERTH_02" ${st.customStressDeltaMin === "-18" ? "selected" : ""}>BERTH_02 Yedek Rampa Tahsisi (-18.0 dk Kuyruk Sönümleme)</option>
                <option value="ROUTE_SHELTER_01" ${st.customStressDeltaMin === "-7" ? "selected" : ""}>ROUTE_SHELTER_01 Güney Sisam Korunaklı Rota (16.0 dk Tavan)</option>
              </select>
              <button type="button" class="wr-btn wr-btn-seal" id="wr-btn-run-node-counterfactual">
                ⚡ Değeri Değiştirip Karşı-Olgu Koştur
              </button>
            </div>

            ${
              cf && cf.ok
                ? `
              <div class="metric-value" style="padding:8px; border-radius:5px; background:var(--status-nominal-bg); border:1px solid var(--status-nominal); font-size:0.73rem;">
                <div><strong>Karşı-Olgu Dalı (${escapeHtml(cf.branch_id)}):</strong></div>
                <div>Hüküm Geçişi: <strong>${escapeHtml(cf.base_verdict)} → ${escapeHtml(cf.branch_verdict)}</strong></div>
                <div>Dal Mühürü: <strong>${escapeHtml(String(cf.branch_state_blake3 || "").slice(0, 16))}…</strong></div>
              </div>`
                : ""
            }
          </div>
        </div>
      `;
    }

    function renderStageZone() {
      stageEl.innerHTML = `
        <div class="wr-panel-toolbar">
          <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;" role="tablist" aria-label="Mekansal Harita ve Nedensel Graf Görünüm Seçici">
            <button type="button" class="wr-btn ${st.stageMode === "MAP" ? "wr-btn-active" : ""}" role="tab" aria-selected="${st.stageMode === "MAP"}" data-stage-mode="MAP" id="wr-tab-stage-map">
              [M] Taktik Deniz Haritası
            </button>
            <button type="button" class="wr-btn ${st.stageMode === "GRAPH" ? "wr-btn-active" : ""}" role="tab" aria-selected="${st.stageMode === "GRAPH"}" data-stage-mode="GRAPH" id="wr-tab-stage-graph">
              [G] Nedensel Graf &amp; Karşı-Olgu Masası
            </button>
          </div>
          <span class="metric-value" style="font-size:0.72rem; color:var(--text-secondary);">
            Aktif Kural: <strong>${escapeHtml((st.sliceSync && st.sliceSync.slice && st.sliceSync.slice.applied_rule_id) || "—")}</strong>
          </span>
        </div>
        <div class="wr-stage-viewport">
          ${st.stageMode === "MAP" ? renderTacticalMapHtml() : renderCausalGraphDeskHtml()}
        </div>
      `;
    }

    function renderAgentDockZone() {
      const slice = (st.sliceSync && st.sliceSync.slice) || {};
      const verdict = slice.verdict || "KANIT_YETERSİZ";
      const sentinel = st.sentinelAlert || { severity: "NOMINAL", summary_tr: "Hazır", anomalies: [] };
      const redTeam = st.redTeamAlert || { severity: "NOMINAL", summary_tr: "Hazır", projected_breach_rules: [] };
      const auditorLocked = verdict === "KANIT_YETERSİZ";

      const conflicts = slice.active_conflicts || [];
      const activeAssertions = slice.active_assertions || [];
      let conflictPairHtml = "";
      if (conflicts.length > 0) {
        const cf = conflicts[0];
        const pair = activeAssertions.filter((a) => (cf.event_ids || []).includes(a.event_id));
        conflictPairHtml = `
          <div class="wr-conflict-matrix-box" id="wr-epistemic-conflict-box">
            <div style="display:flex; align-items:center; justify-content:space-between; gap:6px;">
              <strong>${severityIconSvg("CAUTION")} A-2 Epistemik Çelişki Matrisi (Yan Yana Korundu · Ortalama Alınmadı)</strong>
              <span class="metric-value" style="font-size:0.70rem;">${escapeHtml(cf.subject_id)}.${escapeHtml(cf.metric_key)}</span>
            </div>
            <div class="wr-conflict-pair-grid">
              ${pair
                .map(
                  (p) => `
                <div class="wr-conflict-source-cell">
                  <div style="display:flex; align-items:center; justify-content:space-between; gap:4px;">
                    <strong class="metric-value" style="font-size:0.72rem;">${escapeHtml(p.source_id)}</strong>
                    <span class="wr-epistemic-badge" data-epistemic="${escapeHtml(p.epistemic_status)}">
                      ${epistemicSymbol(p.epistemic_status)} ${escapeHtml(p.epistemic_status)}
                    </span>
                  </div>
                  <div class="metric-value" style="font-size:0.86rem; font-weight:800; margin-top:3px;">
                    ${escapeHtml(formatFpScaled(String(p.fp_val), "dk"))}
                  </div>
                  <div class="metric-value" style="font-size:0.68rem; color:var(--text-secondary);">event_id=${escapeHtml(p.event_id)} · seq=${escapeHtml(String(p.seq_no))}</div>
                </div>`
                )
                .join("")}
            </div>
          </div>
        `;
      }

      const cardsHtml = st.actionCards
        .map((card) => {
          const sealed = st.sealedCards[card.card_id] || null;
          const canSign =
            verdict !== "KANIT_YETERSİZ" &&
            card.auditor_check &&
            card.auditor_check.observation_corroborated;

          return `
            <article class="wr-action-card" data-card-id="${escapeHtml(card.card_id)}" data-focused="${st.focusedActionCardId === card.card_id}" data-sealed="${Boolean(sealed)}">
              <div style="display:flex; align-items:flex-start; justify-content:space-between; gap:8px;">
                <div>
                  <strong style="font-size:0.82rem;">${escapeHtml(card.title)}</strong>
                  <div style="font-size:0.73rem; color:var(--text-secondary); margin-top:2px;">${escapeHtml(card.rationale_tr)}</div>
                </div>
                <span class="wr-mode-pill metric-value">Güven: ${escapeHtml(String(card.opencti_confidence))}/100</span>
              </div>

              <div class="metric-value" style="display:flex; flex-wrap:wrap; gap:8px; font-size:0.72rem; padding:6px 8px; border-radius:4px; background:var(--surface-inset);">
                <span>Karşı-Olgu: <strong>${escapeHtml(card.base_verdict)} → ${escapeHtml(card.branch_verdict)}</strong></span>
                <span>Δ Gecikme: <strong>${escapeHtml(formatFpScaled(String(card.counterfactual_delta && card.counterfactual_delta.delay_change_min_fp), "dk"))}</strong></span>
                <span>Bağımsız Grup: <strong>${escapeHtml(String((card.independence_groups || []).length))}</strong></span>
              </div>

              ${
                sealed
                  ? `
                <div class="metric-value" style="padding:6px 8px; border-radius:4px; background:var(--status-nominal-bg); border:1px solid var(--status-nominal); color:var(--status-nominal); font-size:0.71rem;">
                  ✓ ED25519 İMZALANDI VE MÜHÜRLENDİ · pubkey=${escapeHtml(sealed.operator_pubkey.slice(0, 14))}… · sig=${escapeHtml(sealed.operator_sig.slice(0, 16))}…
                </div>`
                  : !canSign
                    ? `
                <div style="padding:6px 8px; border-radius:4px; background:var(--status-caution-bg); border:1px solid var(--status-caution); color:var(--status-caution); font-size:0.71rem; font-weight:700;">
                  ${severityIconSvg("CAUTION")} AUDITOR FAIL-CLOSED KİLİDİ: Bağımsız OBSERVATION teyidi olmadan (KANIT_YETERSİZ) imza mühürlenemez.
                </div>`
                    : ""
              }

              <div class="wr-action-btn-row">
                <button type="button" class="wr-btn" data-card-focus="${escapeHtml(card.card_id)}">Haritada &amp; Grafta Odakla</button>
                <button type="button" class="wr-btn" data-card-stress="${escapeHtml(card.card_id)}">Stres Testi Koştur</button>
                <button type="button" class="wr-btn wr-btn-seal" data-card-sign="${escapeHtml(card.card_id)}" ${!canSign || sealed ? "disabled" : ""}>
                  ${sealed ? "✓ Mühürlendi" : "Ed25519 İmzala ve Mühürle"}
                </button>
              </div>
            </article>
          `;
        })
        .join("");

      const latestReply = st.assistantReplies[0] || null;

      agentDockEl.innerHTML = `
        <div class="wr-panel-toolbar">
          <strong>4 Uzman Ajan &amp; İnsan-Onaylı Eylem İskelesi</strong>
          <span class="metric-value" style="font-size:0.70rem; color:var(--text-secondary);">CAELUS_AG_UI_V1</span>
        </div>

        <div class="wr-agent-roster-strip" role="list" aria-label="4 Uzman Ajan Durum Özeti">
          <div class="wr-agent-pill" role="listitem" data-agent-state="${sentinel.severity === "CRITICAL" || sentinel.severity === "SERIOUS" ? "ALERT" : "READY"}">
            <strong>1. SENTINEL</strong>
            <span class="metric-value" style="color:var(--text-secondary);">Anomali: ${escapeHtml(String(sentinel.anomaly_count || 0))}</span>
          </div>
          <div class="wr-agent-pill" role="listitem" data-agent-state="${redTeam.severity === "SERIOUS" ? "CONFLICT" : "READY"}">
            <strong>2. RED_TEAM</strong>
            <span class="metric-value" style="color:var(--text-secondary);">İhlal: ${escapeHtml(String((redTeam.projected_breach_rules || []).length))}</span>
          </div>
          <div class="wr-agent-pill" role="listitem" data-agent-state="READY">
            <strong>3. STRATEGIST</strong>
            <span class="metric-value" style="color:var(--text-secondary);">COA: ${escapeHtml(String(st.actionCards.length))} Dal</span>
          </div>
          <div class="wr-agent-pill" role="listitem" data-agent-state="${auditorLocked ? "LOCKED" : "READY"}">
            <strong>4. AUDITOR</strong>
            <span class="metric-value" style="color:var(--text-secondary);">${auditorLocked ? "FAIL-CLOSED" : "ONAY BEKLİYOR"}</span>
          </div>
        </div>

        <div class="wr-agent-scroll-body">
          <div style="padding:7px 9px; border-radius:5px; background:var(--surface-inset); border:1px solid var(--border-subtle); font-size:0.73rem;">
            <div><strong>SENTINEL:</strong> ${escapeHtml(sentinel.summary_tr || "")}</div>
            <div style="margin-top:3px;"><strong>RED_TEAM:</strong> ${escapeHtml(redTeam.summary_tr || "")}</div>
          </div>

          ${conflictPairHtml}
          ${cardsHtml}
        </div>

        <details class="wr-assistant-drawer" open>
          <summary class="wr-assistant-summary">
            <span>Kanıt-Bağlı Komuta Asistanı (MCP Araç Çıktısı Zorunlu)</span>
            <span class="metric-value" style="font-size:0.69rem; color:var(--text-secondary);">Sıfır Halüsinasyon</span>
          </summary>
          <div class="wr-assistant-body">
            <div style="display:flex; gap:5px; flex-wrap:wrap;">
              <button type="button" class="wr-layer-chip" data-assistant-preset="Aktif kesitteki hükmü ve çelişen kaynakları açıkla">Hükmü &amp; Çelişkiyi Açıkla</button>
              <button type="button" class="wr-layer-chip" data-assistant-preset="BERTH_02 karşı-olgu stres testi sonucunu göster">BERTH_02 Stres Testi</button>
            </div>
            <form id="wr-assistant-form" style="display:flex; gap:6px;">
              <input type="text" class="wr-input" id="wr-assistant-input" style="flex:1;" placeholder="MCP kanıt sorgusu yazın (örn. T2 neden KURAL_İHLALİ?)..." autocomplete="off">
              <button type="submit" class="wr-btn">Sor</button>
            </form>
            ${
              latestReply
                ? `
              <div class="metric-value" style="padding:7px 8px; border-radius:4px; background:var(--surface-panel); border:1px solid var(--border-subtle); font-size:0.72rem;">
                <div>${escapeHtml(latestReply.structured_answer_tr)}</div>
                <div style="margin-top:4px; color:var(--text-secondary); font-size:0.68rem;">
                  Çağrılan MCP Araçları: ${escapeHtml((latestReply.mcp_tools_invoked || []).join(", "))}
                </div>
              </div>`
                : ""
            }
          </div>
        </details>
      `;
    }

    function renderTimeConductorZone() {
      const cutoffBig = BigInt(st.cutoffLearnedAtMs);
      const span = Number(TIMELINE_MAX_MS - TIMELINE_MIN_MS);
      const cursorPct = Math.max(
        0,
        Math.min(100, ((Number(cutoffBig - TIMELINE_MIN_MS) / span) * 100))
      );

      const dotsSvg = st.catalogRows
        .map((r) => {
          const obsX = Math.max(
            12,
            Math.min(
              588,
              12 + ((Number(BigInt(r.observed_at_ms) - TIMELINE_MIN_MS) / span) * 576)
            )
          );
          const lrnX = Math.max(
            12,
            Math.min(
              588,
              12 + ((Number(BigInt(r.learned_at_ms) - TIMELINE_MIN_MS) / span) * 576)
            )
          );
          const isFuture = BigInt(r.learned_at_ms) > cutoffBig;
          const color =
            r.epistemic_status === "OBSERVATION"
              ? "var(--epistemic-observation)"
              : r.epistemic_status === "CLAIM"
                ? "var(--epistemic-claim)"
                : "var(--epistemic-hypothesis)";
          return `
            <g opacity="${isFuture ? "0.32" : "1"}">
              <line x1="${obsX.toFixed(1)}" y1="14" x2="${lrnX.toFixed(1)}" y2="40" stroke="${color}" stroke-width="1" stroke-dasharray="2 2"/>
              <circle cx="${obsX.toFixed(1)}" cy="14" r="3.6" fill="${color}"/>
              <rect x="${(lrnX - 3.5).toFixed(1)}" y="36.5" width="7" height="7" rx="1" fill="${color}"/>
            </g>`;
        })
        .join("");

      const cursorX = 12 + (cursorPct / 100) * 576;

      bitemporalBoxEl.innerHTML = `
        <div style="display:flex; align-items:center; justify-content:space-between; gap:6px; flex-wrap:wrap;">
          <strong>Çift-Zamanlı İletken (Bi-Temporal Time Conductor)</strong>
          <span class="metric-value" style="font-size:0.74rem;">
            cutoff_learned_at_ms = <strong id="wr-cutoff-ms-readout">${escapeHtml(st.cutoffLearnedAtMs)}</strong>
            (${escapeHtml(formatUtcClockFromMsStr(st.cutoffLearnedAtMs))})
          </span>
        </div>

        <div class="wr-bitemporal-tracks">
          <svg class="wr-track-svg" viewBox="0 0 600 54" aria-label="Üst iz: Olay Gözlem Zamanı, Alt iz: Sistem Öğrenme Kesiti">
            <text x="4" y="10" fill="var(--text-muted)" font-family="var(--font-mono)" font-size="8">observed_at_ms</text>
            <line x1="12" y1="14" x2="588" y2="14" stroke="var(--border-strong)" stroke-width="1"/>
            <text x="4" y="51" fill="var(--text-muted)" font-family="var(--font-mono)" font-size="8">learned_at_ms</text>
            <line x1="12" y1="40" x2="588" y2="40" stroke="var(--border-strong)" stroke-width="1"/>
            ${dotsSvg}
            <line x1="${cursorX.toFixed(1)}" y1="2" x2="${cursorX.toFixed(1)}" y2="52" stroke="var(--status-critical)" stroke-width="2"/>
          </svg>

          <input type="range" class="wr-cutoff-slider" id="wr-cutoff-slider"
            min="${TIMELINE_MIN_MS.toString()}" max="${TIMELINE_MAX_MS.toString()}" step="10000"
            value="${escapeHtml(st.cutoffLearnedAtMs)}"
            aria-label="Öğrenilme kesiti zaman sürgüsü (cutoff_learned_at_ms)">
        </div>

        <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
          <button type="button" class="wr-btn ${st.playbackMode === "LIVE" ? "wr-btn-active" : ""}" id="wr-btn-toggle-playback" title="Boşluk (Space): Canlı Akış / Tekrar Oynatma">
            ${st.playbackMode === "LIVE" ? "⏸ LIVE" : "▶ REPLAY"} (Space)
          </button>
          <button type="button" class="wr-btn" id="wr-btn-step-prev" title="Önceki Olay ([)">[ Önceki</button>
          <button type="button" class="wr-btn" id="wr-btn-step-next" title="Sonraki Olay (])">Sonraki ]</button>
          <button type="button" class="wr-btn ${st.cutoffLearnedAtMs === T1_CUTOFF_MS ? "wr-btn-active" : ""}" data-snap-cutoff="${T1_CUTOFF_MS}" id="wr-btn-snap-t1">
            T1 · 08:10 (KANIT_YETERSİZ)
          </button>
          <button type="button" class="wr-btn ${st.cutoffLearnedAtMs === TAMPER_CHECK_MS ? "wr-btn-active" : ""}" data-snap-cutoff="${TAMPER_CHECK_MS}" id="wr-btn-snap-tamper">
            08:15 (Karantina)
          </button>
          <button type="button" class="wr-btn ${st.cutoffLearnedAtMs === T2_CUTOFF_MS ? "wr-btn-active" : ""}" data-snap-cutoff="${T2_CUTOFF_MS}" id="wr-btn-snap-t2">
            T2 · 08:25 (KURAL_İHLALİ)
          </button>
        </div>
      `;

      const filteredRows = model.getDecoratedTelemetryRows();
      telemetryToolbarEl.innerHTML = `
        <div style="display:flex; align-items:center; justify-content:space-between; gap:6px; flex-wrap:wrap;">
          <strong>Sanallaştırılmış Telemetri Akışı (${filteredRows.length} Olay · CLS=0)</strong>
          <div style="display:flex; gap:4px; flex-wrap:wrap;" role="group" aria-label="Epistemik Statü Filtresi">
            <button type="button" class="wr-layer-chip" data-ep-filter="ALL" aria-pressed="${st.epistemicFilter === "ALL"}">Tümü</button>
            <button type="button" class="wr-layer-chip" data-ep-filter="OBSERVATION" aria-pressed="${st.epistemicFilter === "OBSERVATION"}">● OBSERVATION</button>
            <button type="button" class="wr-layer-chip" data-ep-filter="CLAIM" aria-pressed="${st.epistemicFilter === "CLAIM"}">◆ CLAIM</button>
            <button type="button" class="wr-layer-chip" data-ep-filter="HYPOTHESIS" aria-pressed="${st.epistemicFilter === "HYPOTHESIS"}">▲ HYPOTHESIS</button>
            <button type="button" class="wr-layer-chip" data-ep-filter="REJECTED" aria-pressed="${st.epistemicFilter === "REJECTED"}">⛔ Karantina</button>
          </div>
        </div>
      `;

      renderVirtualTelemetryRows(filteredRows);
    }

    function renderVirtualTelemetryRows(rows) {
      const list = rows || model.getDecoratedTelemetryRows();
      const totalHeight = Math.max(list.length * VIRTUAL_ROW_HEIGHT_PX, VIRTUAL_ROW_HEIGHT_PX);
      virtualSpacerEl.style.height = `${totalHeight}px`;

      const viewportHeight = virtualViewportEl.clientHeight || 180;
      const firstIdx = Math.max(0, Math.floor(virtualScrollTop / VIRTUAL_ROW_HEIGHT_PX) - 2);
      const visibleCount = Math.ceil(viewportHeight / VIRTUAL_ROW_HEIGHT_PX) + 5;
      const lastIdx = Math.min(list.length, firstIdx + visibleCount);

      let html = "";
      for (let i = firstIdx; i < lastIdx; i++) {
        const r = list[i];
        const topPx = i * VIRTUAL_ROW_HEIGHT_PX;
        const metricText =
          r.primary_metric_key === "delay_min_fp"
            ? formatFpScaled(r.primary_fp_val, "dk", 1)
            : r.primary_metric_key === "wave_m_fp"
              ? formatFpScaled(r.primary_fp_val, "m", 2)
              : r.primary_metric_key === "wind_speed_mps_fp"
                ? formatFpScaled(r.primary_fp_val, "m/s", 2)
                : r.primary_metric_key === "baro_alt_m_fp"
                  ? formatFpScaled(r.primary_fp_val, "m", 1)
                  : `${r.primary_fp_val} fp`;

        html += `
          <div class="wr-virtual-grid-row" role="row"
               style="top:${topPx}px;"
               data-row-event-id="${escapeHtml(r.event_id)}"
               data-row-source-id="${escapeHtml(r.source_id)}"
               data-future="${r.is_future}"
               data-rejected="${r.is_rejected}"
               data-selected="${st.selectedEventId === r.event_id}">
            <span class="metric-value wr-cell-ellipsis" title="seq_no=${escapeHtml(r.seq_no)}">
              ${escapeHtml(r.seq_no)}${r.exceeds_ieee754_safe_int ? " ★>2^53" : ""}
            </span>
            <span class="metric-value wr-cell-ellipsis">${escapeHtml(r.event_id)}</span>
            <span class="wr-cell-ellipsis" title="${escapeHtml(r.source_id)} (${escapeHtml(r.independence_group)})">${escapeHtml(r.source_id)}</span>
            <span>
              <span class="wr-epistemic-badge" data-epistemic="${escapeHtml(r.epistemic_status)}">
                ${epistemicSymbol(r.epistemic_status)} ${escapeHtml(r.epistemic_status)}
              </span>
            </span>
            <span class="timestamp-cell">${escapeHtml(formatUtcClockFromMsStr(r.observed_at_ms))}</span>
            <span class="timestamp-cell">${escapeHtml(formatUtcClockFromMsStr(r.learned_at_ms))}</span>
            <span class="metric-value">${escapeHtml(metricText)}</span>
            <span class="wr-cell-ellipsis" title="${escapeHtml(r.temporal_status_tr)}">${escapeHtml(r.temporal_status_tr)}</span>
          </div>
        `;
      }
      virtualSpacerEl.innerHTML = html;
    }

    function openSealInspectorModal() {
      const slice = (st.sliceSync && st.sliceSync.slice) || {};
      const val = (st.sliceSync && st.sliceSync.validation) || {};
      const mf = model.getManifestObject();
      const sealedEntries = Object.values(st.sealedCards);

      sealContentEl.innerHTML = `
        <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:10px;">
          <strong>Kriptografik Mühür &amp; Kaynak Manifestosu v2.0 Denetçisi</strong>
          <button type="button" class="wr-btn" id="wr-btn-close-seal-modal">Kapat (ESC)</button>
        </div>
        <div class="metric-value" style="display:flex; flex-direction:column; gap:6px; font-size:0.74rem; padding:10px; border-radius:6px; background:var(--surface-inset); border:1px solid var(--border-subtle);">
          <div><strong>state_blake3:</strong> ${escapeHtml(slice.state_blake3 || "—")}</div>
          <div><strong>audit_head_blake3:</strong> ${escapeHtml(st.auditChainHead || slice.state_blake3 || "—")}</div>
          <div><strong>manifest_version:</strong> ${escapeHtml(mf.manifest_version || "2.0")} (require_v2_airlock=${String(mf.require_v2_airlock)})</div>
          <div><strong>trust_anchor_pubkey:</strong> ${escapeHtml(mf.trust_anchor_pubkey || "—")}</div>
          <div><strong>manifest_sig:</strong> ${escapeHtml(String(mf.manifest_sig || "").slice(0, 48))}…</div>
          <div><strong>Doğrulanan / Karantinaya Alınan Paket:</strong> ${escapeHtml(String(val.accepted_count || 0))} kabul / ${escapeHtml(String(val.rejected_count || 0))} karantina (0-bit state değişimi garantili)</div>
        </div>
        <div style="margin-top:10px;">
          <strong>Mühürlenen Operatör Eylem Kartları (${sealedEntries.length}):</strong>
          ${
            sealedEntries.length === 0
              ? '<div style="color:var(--text-secondary); margin-top:4px;">Henüz operatör tarafından Ed25519 ile imzalanmış kart bulunmuyor.</div>'
              : sealedEntries
                  .map(
                    (s) => `
                  <div class="metric-value" style="margin-top:6px; padding:8px; border-radius:4px; background:var(--status-nominal-bg); border:1px solid var(--status-nominal); font-size:0.72rem;">
                    <div>Kart: <strong>${escapeHtml(s.card_id)}</strong> · Hüküm Bağlamı: ${escapeHtml(s.verdict_context)}</div>
                    <div>operator_pubkey: ${escapeHtml(s.operator_pubkey)}</div>
                    <div>operator_sig: ${escapeHtml(s.operator_sig.slice(0, 56))}…</div>
                  </div>`
                  )
                  .join("")
          }
        </div>
      `;
      sealModalEl.hidden = false;
    }

    function renderCmdkResults(queryStr) {
      const q = String(queryStr || "").trim().toLowerCase();
      const items = [
        { label: "Kesit T1 · 08:10 UTC → KANIT_YETERSİZ", hint: T1_CUTOFF_MS, run: () => triggerCutoffChange(T1_CUTOFF_MS, true) },
        { label: "Kesit 08:15 UTC → SOURCE_EQUIVOCATION Karantina Testi", hint: TAMPER_CHECK_MS, run: () => triggerCutoffChange(TAMPER_CHECK_MS, true) },
        { label: "Kesit T2 · 08:25 UTC → KURAL_İHLALİ (+15dk CLAIM vs +35dk OBS)", hint: T2_CUTOFF_MS, run: () => triggerCutoffChange(T2_CUTOFF_MS, true) },
        { label: "64-Bit Hassasiyet Çapası: ev_106 (seq_no = 9007199254740993 > 2^53 - 1)", hint: "port_berth_sensor_sigacik", run: () => { st.selectedEventId = "ev_106"; triggerCutoffChange(T2_CUTOFF_MS, true); } },
        { label: "Varlık: VESSEL_AEGEAN_01 (Ege Feribotu · Taktik Harita Odağı)", hint: "MAP", run: () => setStageMode("MAP", true) },
        { label: "Nedensel Graf & Karşı-Olgu Stres Masası (CONFLICT Kenarı)", hint: "GRAPH", run: () => setStageMode("GRAPH", true) },
        { label: "Eylem Kartı COA-01: BERTH_02 Yedek Rampa Yönlendirmesi", hint: "coa-20261111-01", run: () => { st.focusedActionCardId = "coa-20261111-01"; renderAll(); } },
        { label: "Tema: OpenBridge Gece Vardiyası (#050505 / #d97736)", hint: "Alt+3", run: () => setTheme("night", true) },
      ].filter((it) => !q || it.label.toLowerCase().includes(q) || it.hint.toLowerCase().includes(q));

      cmdkResultsEl.innerHTML = items
        .map(
          (it, idx) => `
          <button type="button" class="wr-btn" style="justify-content:space-between; width:100%; text-align:left;" data-cmdk-idx="${idx}">
            <span>${escapeHtml(it.label)}</span>
            <span class="metric-value" style="color:var(--text-secondary);">${escapeHtml(it.hint)}</span>
          </button>`
        )
        .join("");

      cmdkResultsEl.querySelectorAll("[data-cmdk-idx]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const idx = Number(btn.getAttribute("data-cmdk-idx"));
          cmdkModalEl.hidden = true;
          if (items[idx]) items[idx].run();
        });
      });
    }

    function triggerCutoffChange(nextCutoffMsStr, instantKbd = false) {
      if (instantKbd) document.body.setAttribute("data-kbd-instant", "1");
      const targetStr = String(nextCutoffMsStr);
      model.setCutoffMs(targetStr);
      if (wsClient && wsClient.readyState === 1) {
        wsClient.send(
          JSON.stringify({
            cmd: "EVALUATE_SLICE",
            cutoff_learned_at_ms: targetStr,
          })
        );
      }
      if (instantKbd) {
        requestAnimationFrame(() => document.body.removeAttribute("data-kbd-instant"));
      }
    }

    function togglePlaybackMode(instantKbd = false) {
      if (instantKbd) document.body.setAttribute("data-kbd-instant", "1");
      if (st.playbackMode === "LIVE") {
        st.playbackMode = "REPLAY";
        if (liveReplayTimer) {
          clearInterval(liveReplayTimer);
          liveReplayTimer = null;
        }
      } else {
        st.playbackMode = "LIVE";
        if (BigInt(st.cutoffLearnedAtMs) >= BigInt(T2_CUTOFF_MS)) {
          model.setCutoffMs("1762848300000");
        }
        liveReplayTimer = setInterval(() => {
          if (BigInt(st.cutoffLearnedAtMs) >= BigInt(T2_CUTOFF_MS)) {
            st.playbackMode = "REPLAY";
            clearInterval(liveReplayTimer);
            liveReplayTimer = null;
            renderTimeConductorZone();
            return;
          }
          const nextMs = model.stepEventCursor(1);
          if (wsClient && wsClient.readyState === 1) {
            wsClient.send(JSON.stringify({ cmd: "EVALUATE_SLICE", cutoff_learned_at_ms: nextMs }));
          }
        }, 1200);
      }
      renderTimeConductorZone();
      if (instantKbd) {
        requestAnimationFrame(() => document.body.removeAttribute("data-kbd-instant"));
      }
    }

    function renderAll() {
      renderTopBar();
      renderStageZone();
      renderAgentDockZone();
      renderTimeConductorZone();
    }

    model.subscribe(() => renderAll());

    // Delegated Click & Input Event Handlers
    rootEl.addEventListener("click", (ev) => {
      const target = ev.target.closest("button, [data-graph-node], [data-row-event-id], [data-map-select-event], [data-map-focus-card]");
      if (!target) return;

      if (target.hasAttribute("data-set-theme")) {
        setTheme(target.getAttribute("data-set-theme"), false);
        return;
      }
      if (target.id === "wr-btn-open-seal-modal") {
        openSealInspectorModal();
        return;
      }
      if (target.id === "wr-btn-close-seal-modal") {
        sealModalEl.hidden = true;
        return;
      }
      if (target.id === "wr-btn-open-cmdk") {
        cmdkModalEl.hidden = false;
        renderCmdkResults("");
        cmdkInputEl.value = "";
        cmdkInputEl.focus();
        return;
      }
      if (target.id === "wr-btn-close-cmdk") {
        cmdkModalEl.hidden = true;
        return;
      }
      if (target.id === "wr-btn-switch-studio") {
        toggleCockpitShellVisibility(false);
        return;
      }
      if (target.hasAttribute("data-stage-mode")) {
        setStageMode(target.getAttribute("data-stage-mode"), false);
        return;
      }
      if (target.hasAttribute("data-toggle-layer")) {
        const layerKey = target.getAttribute("data-toggle-layer");
        st.mapLayers[layerKey] = !st.mapLayers[layerKey];
        renderStageZone();
        return;
      }
      if (target.hasAttribute("data-map-select-event")) {
        st.selectedEventId = target.getAttribute("data-map-select-event");
        renderTimeConductorZone();
        return;
      }
      if (target.hasAttribute("data-map-focus-card")) {
        st.focusedActionCardId = target.getAttribute("data-map-focus-card");
        renderAgentDockZone();
        return;
      }
      if (target.hasAttribute("data-graph-node")) {
        st.selectedGraphNodeId = target.getAttribute("data-graph-node");
        renderStageZone();
        return;
      }
      if (target.id === "wr-btn-toggle-disable-node") {
        model.toggleGraphSourceDisabled(st.selectedGraphNodeId);
        return;
      }
      if (target.id === "wr-btn-run-node-counterfactual") {
        const sel = rootEl.querySelector("#wr-stress-delta-select");
        const modeVal = sel ? sel.value : "BERTH_02";
        const interventions =
          modeVal === "ROUTE_SHELTER_01"
            ? [{ target_id: "ROUTE_SHELTER_01", override_field: "route_shelter_corridor", fp_val: "16000000" }]
            : [{ target_id: "BERTH_02", override_field: "status", fp_val: "0" }];
        st.customStressDeltaMin = modeVal === "ROUTE_SHELTER_01" ? "-7" : "-18";
        sendWsOrFallback(
          {
            cmd: "RUN_COUNTERFACTUAL",
            base_cutoff_ms: st.cutoffLearnedAtMs,
            branch_id: `cf_${modeVal.toLowerCase()}`,
            interventions,
          },
          () => model.runInteractiveCounterfactual(interventions, `cf_${modeVal.toLowerCase()}`)
        );
        return;
      }
      if (target.hasAttribute("data-card-focus")) {
        const cid = target.getAttribute("data-card-focus");
        st.focusedActionCardId = cid;
        st.highlightedCorridor =
          cid === "coa-20261111-02" ? "SOUTH_SAMOS_SHELTERED" : "PRIMARY_NORTH";
        setStageMode("MAP", false);
        renderAgentDockZone();
        return;
      }
      if (target.hasAttribute("data-card-stress")) {
        const cid = target.getAttribute("data-card-stress");
        const card = st.actionCards.find((c) => c.card_id === cid);
        if (card) {
          st.focusedActionCardId = cid;
          st.stageMode = "GRAPH";
          sendWsOrFallback(
            {
              cmd: "RUN_COUNTERFACTUAL",
              base_cutoff_ms: st.cutoffLearnedAtMs,
              branch_id: card.branch_id,
              interventions: card.interventions,
            },
            () => model.runInteractiveCounterfactual(card.interventions, card.branch_id)
          );
        }
        return;
      }
      if (target.hasAttribute("data-card-sign")) {
        const cid = target.getAttribute("data-card-sign");
        const localSigned = model.signAndSealActionCardLocal(cid);
        if (localSigned.ok && wsClient && wsClient.readyState === 1) {
          wsClient.send(
            JSON.stringify({
              cmd: "SIGN_ACTION_CARD",
              card_id: localSigned.card_id,
              scenario_id: localSigned.scenario_id,
              verdict_context: localSigned.verdict_context,
              state_blake3: localSigned.state_blake3,
              branch_state_blake3: localSigned.branch_state_blake3,
              approved_at_ms: localSigned.approved_at_ms,
              operator_pubkey: localSigned.operator_pubkey,
              operator_sig: localSigned.operator_sig,
            })
          );
        }
        return;
      }
      if (target.hasAttribute("data-assistant-preset")) {
        const q = target.getAttribute("data-assistant-preset");
        sendWsOrFallback(
          { cmd: "ASSISTANT_QUERY", cutoff_learned_at_ms: st.cutoffLearnedAtMs, query: q },
          () => model.submitAssistantQueryLocal(q)
        );
        return;
      }
      if (target.id === "wr-btn-toggle-playback") {
        togglePlaybackMode(false);
        return;
      }
      if (target.id === "wr-btn-step-prev") {
        const prevMs = model.stepEventCursor(-1);
        if (wsClient && wsClient.readyState === 1) {
          wsClient.send(JSON.stringify({ cmd: "EVALUATE_SLICE", cutoff_learned_at_ms: prevMs }));
        }
        return;
      }
      if (target.id === "wr-btn-step-next") {
        const nextMs = model.stepEventCursor(1);
        if (wsClient && wsClient.readyState === 1) {
          wsClient.send(JSON.stringify({ cmd: "EVALUATE_SLICE", cutoff_learned_at_ms: nextMs }));
        }
        return;
      }
      if (target.hasAttribute("data-snap-cutoff")) {
        triggerCutoffChange(target.getAttribute("data-snap-cutoff"), false);
        return;
      }
      if (target.hasAttribute("data-ep-filter")) {
        st.epistemicFilter = target.getAttribute("data-ep-filter");
        virtualScrollTop = 0;
        virtualViewportEl.scrollTop = 0;
        renderTimeConductorZone();
        return;
      }
      if (target.hasAttribute("data-row-event-id")) {
        st.selectedEventId = target.getAttribute("data-row-event-id");
        st.selectedGraphNodeId = target.getAttribute("data-row-source-id") || st.selectedGraphNodeId;
        renderVirtualTelemetryRows();
        if (st.stageMode === "GRAPH") renderStageZone();
      }
    });

    rootEl.addEventListener("input", (ev) => {
      if (ev.target && ev.target.id === "wr-cutoff-slider") {
        triggerCutoffChange(ev.target.value, false);
      } else if (ev.target && ev.target.id === "wr-cmdk-input") {
        renderCmdkResults(ev.target.value);
      }
    });

    rootEl.addEventListener("submit", (ev) => {
      if (ev.target && ev.target.id === "wr-assistant-form") {
        ev.preventDefault();
        const inp = rootEl.querySelector("#wr-assistant-input");
        const q = inp ? inp.value.trim() : "";
        if (!q) return;
        inp.value = "";
        sendWsOrFallback(
          { cmd: "ASSISTANT_QUERY", cutoff_learned_at_ms: st.cutoffLearnedAtMs, query: q },
          () => model.submitAssistantQueryLocal(q)
        );
      }
    });

    virtualViewportEl.addEventListener(
      "scroll",
      () => {
        virtualScrollTop = virtualViewportEl.scrollTop;
        renderVirtualTelemetryRows();
      },
      { passive: true }
    );

    // §4.3 Zorunlu Operatör Klavye Kısayolları (0ms gecikmeli)
    window.addEventListener("keydown", (ev) => {
      const cockpitActive = document.body.getAttribute("data-c2-cockpit") === "active";
      if (!cockpitActive) return;

      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "k") {
        ev.preventDefault();
        cmdkModalEl.hidden = !cmdkModalEl.hidden;
        if (!cmdkModalEl.hidden) {
          renderCmdkResults("");
          cmdkInputEl.value = "";
          cmdkInputEl.focus();
        }
        return;
      }

      if (ev.key === "Escape") {
        if (!cmdkModalEl.hidden) cmdkModalEl.hidden = true;
        if (!sealModalEl.hidden) sealModalEl.hidden = true;
        return;
      }

      const tag = (ev.target && ev.target.tagName ? ev.target.tagName : "").toUpperCase();
      const isEditing =
        tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || Boolean(ev.target && ev.target.isContentEditable);
      if (isEditing) return;

      if (ev.altKey && ev.key === "1") {
        ev.preventDefault();
        setTheme("day", true);
        return;
      }
      if (ev.altKey && ev.key === "2") {
        ev.preventDefault();
        setTheme("dusk", true);
        return;
      }
      if (ev.altKey && ev.key === "3") {
        ev.preventDefault();
        setTheme("night", true);
        return;
      }
      if (!ev.ctrlKey && !ev.metaKey && !ev.altKey) {
        if (ev.code === "Space") {
          ev.preventDefault();
          togglePlaybackMode(true);
        } else if (ev.key === "[") {
          ev.preventDefault();
          document.body.setAttribute("data-kbd-instant", "1");
          const prevMs = model.stepEventCursor(-1);
          if (wsClient && wsClient.readyState === 1) {
            wsClient.send(JSON.stringify({ cmd: "EVALUATE_SLICE", cutoff_learned_at_ms: prevMs }));
          }
          requestAnimationFrame(() => document.body.removeAttribute("data-kbd-instant"));
        } else if (ev.key === "]") {
          ev.preventDefault();
          document.body.setAttribute("data-kbd-instant", "1");
          const nextMs = model.stepEventCursor(1);
          if (wsClient && wsClient.readyState === 1) {
            wsClient.send(JSON.stringify({ cmd: "EVALUATE_SLICE", cutoff_learned_at_ms: nextMs }));
          }
          requestAnimationFrame(() => document.body.removeAttribute("data-kbd-instant"));
        } else if (ev.key === "m" || ev.key === "M") {
          ev.preventDefault();
          setStageMode("MAP", true);
        } else if (ev.key === "g" || ev.key === "G") {
          ev.preventDefault();
          setStageMode("GRAPH", true);
        }
      }
    });

    // Canlı WebSocket (`ws://127.0.0.1:47809`) Köprüsü: Yalnızca localhost / açıkça yapılandırılmışsa bağlan
    function connectLocalAgUiBridgeIfAvailable() {
      if (typeof WebSocket === "undefined" || typeof location === "undefined") return;
      const explicitWsUrl = window.CAELUS_AG_UI_WS_URL || "";
      const isLocalLoopback =
        location.hostname === "127.0.0.1" || location.hostname === "localhost";
      if (!explicitWsUrl && !isLocalLoopback) return;

      const wsUrl = explicitWsUrl || "ws://127.0.0.1:47809/ws";
      try {
        const sock = new WebSocket(wsUrl);
        sock.addEventListener("open", () => {
          wsClient = sock;
          st.transportMode = "WS_LIVE";
          renderTopBar();
          sock.send(
            JSON.stringify({
              cmd: "EVALUATE_SLICE",
              cutoff_learned_at_ms: st.cutoffLearnedAtMs,
            })
          );
        });
        sock.addEventListener("message", (msgEv) => {
          try {
            const parsed = JSON.parse(String(msgEv.data || ""));
            if (parsed && parsed.protocol === "CAELUS_AG_UI_V1") {
              model.applyAgUiEnvelopes([parsed]);
            }
          } catch (_) {
            // Geçersiz çerçeve fail-closed yoksayılır
          }
        });
        sock.addEventListener("close", () => {
          if (wsClient === sock) wsClient = null;
          st.transportMode = "AIRGAPPED_LOCAL";
          renderTopBar();
        });
        sock.addEventListener("error", () => {
          // Hava boşluklu modda sessizce yerel motorda kal
        });
      } catch (_) {
        // Çevrimdışı ortam
      }
    }

    setTheme(st.theme, true);
    renderAll();
    connectLocalAgUiBridgeIfAvailable();

    return {
      model,
      setTheme,
      setStageMode,
      triggerCutoffChange,
      toggleCockpitShellVisibility,
    };
  }

  // Tarayıcıda `#caelus-war-room-cockpit-shell` mevcutsa otomatik olarak monte et
  if (typeof document !== "undefined") {
    const boot = () => {
      const el = document.getElementById("caelus-war-room-cockpit-shell");
      if (el && !window.__caelusWarRoomCockpitInstance) {
        window.__caelusWarRoomCockpitInstance = mountWarRoomCockpitDom(el);
      }
    };
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", boot, { once: true });
    } else {
      boot();
    }
  }

  return {
    T1_CUTOFF_MS,
    TAMPER_CHECK_MS,
    T2_CUTOFF_MS,
    EMBEDDED_AEGEAN_PILOT_BUNDLE,
    parseTimelineCatalogFromBatch,
    createWarRoomCockpitModel,
    mountWarRoomCockpitDom,
  };
});
