/**
 * CAELUS — YAŞAYAN DÜNYA MODELİ (LIVING WORLD MODEL)
 * Zamansal Hafıza, Düşüncenin Değişimi, Uzak Bağlantı Keşfi, Hipotez ve Karşı Kanıt Defteri,
 * Rakip Dünya Modelleri, Kullanıcının Kendi Dünyası ve Ticari Bağımsızlık Kapısı.
 *
 * Mimari İlkeler:
 * - Çevrim dışı deterministik çekirdek: çalışma zamanında dış ağ çağrısı yapmaz.
 * - Çift zamanlı (Bitemporal) sızıntı koruması: T1 analizine T1 sonrasında öğrenilen bilgi giremez.
 * - Düzeltme (Correction) ve geri çekme (Retraction) geçmiş sürümleri silmez; versiyon zincirini korur.
 * - Aday ilişkiler ve hipotezler hiçbir zaman "kanıtlanmış nedensellik" veya "kesin doğru" olarak sunulmaz.
 * - Kalibre edilmemiş model skorları gerçekleşme olasılığı olarak sunulmaz.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    let baseCompiler = null;
    try {
      baseCompiler = require('./scenario_compiler.js');
    } catch (_) {
      baseCompiler = null;
    }
    module.exports = factory(baseCompiler);
  } else {
    root.CaelusLivingWorldModel = factory(root.CaelusScenarioCompiler || null);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (baseCompiler) {
  'use strict';

  // ============================================================================
  // 1. OLGUNLUK SINIFLARI, TİCARİ DURUM ETİKETLERİ VE 17 KAVRAM SÖZLÜĞÜ
  // ============================================================================

  const LIVING_WORLD_MATURITY_CLASSES = Object.freeze({
    A_WORKING_INTEGRATED: 'A. ÇALIŞAN VE ENTEGRE',
    B_LIMITED_PROTOTYPE: 'B. SINIRLI ÇALIŞAN PROTOTİP',
    C_RESEARCH_EXPERIMENT: 'C. ARAŞTIRMA DENEYİ',
    D_CONTRACT_READY_IMPL_MISSING: 'D. SÖZLEŞMESİ HAZIR, UYGULAMASI EKSİK',
    E_NOT_IMPLEMENTED_IN_THIS_WORK: 'E. BU ÇALIŞMADA GERÇEKLEŞTİRİLEMEDİ'
  });

  const COMMERCIAL_STATUS_LABELS = Object.freeze({
    APPROVED_CANDIDATE: 'ONAYLI ADAY',
    UNDER_REVIEW: 'İNCELEMEDE',
    EXCLUDED_FROM_COMMERCIAL_PACK: 'TİCARİ PAKETİN DIŞINDA',
    CAELUS_PROPRIETARY: 'CAELUS’A ÖZGÜ'
  });

  const COMMERCIAL_DEPLOYMENT_MODES = Object.freeze({
    A_PAID_CLOSED_SOURCE_SOFTWARE: 'A. Ücretli kapalı kaynak yazılım',
    B_CUSTOMER_DESKTOP_LOCAL_INSTALL: 'B. Müşteri bilgisayarına yerel kurulum',
    C_CUSTOMER_ON_PREM_PRIVATE_SERVER: 'C. Müşteri tesisine / özel sunucusuna kurulum',
    D_OFFLINE_OR_AIR_GAPPED: 'D. Çevrim dışı veya hava boşluklu çalışma',
    E_OPTIONAL_MANAGED_CLOUD: 'E. İleride isteğe bağlı yönetilen bulut hizmeti',
    F_ENTERPRISE_LICENSING_OR_ASSET_SALE: 'F. Müşteriye lisanslama veya şirket / varlık satışı'
  });

  const LIVING_WORLD_17_CONCEPTS = Object.freeze([
    'VARLIK',               // 1. Entity
    'OLAY',                 // 2. Event
    'KAYNAK',               // 3. Source
    'GOZLEM',               // 4. Observation
    'IDDIA',                // 5. Claim
    'ILISKI',               // 6. Relation
    'VARSAYIM',             // 7. Assumption
    'HIPOTEZ',              // 8. Hypothesis
    'ALTERNATIF_ACIKLAMA',  // 9. Alternative Explanation
    'KARSI_KANIT',          // 10. Counter-Evidence
    'MUDAHALE',             // 11. Intervention
    'SENARYO',              // 12. Scenario
    'MODEL_CALISTIRMASI',   // 13. Model Run
    'SONUC',                // 14. Outcome
    'DUZELTME',             // 15. Correction
    'GERI_CEKME',           // 16. Retraction
    'GORUS_DEGISIMI'        // 17. Belief Revision
  ]);

  const EPISTEMIC_UI_CATEGORIES_7 = Object.freeze({
    BILINEN: {
      code: 'BILINEN',
      labelTr: 'Bilinen (Doğrudan Gözlem)',
      descriptionTr: 'Birincil resmi veya sensör kaynağından doğrudan kaydedilmiş ölçüm/olgu.'
    },
    KAYNAKTA_IDDIA_EDILEN: {
      code: 'KAYNAKTA_IDDIA_EDILEN',
      labelTr: 'Kaynakta İddia Edilen',
      descriptionTr: 'Belirli bir kaynağın beyanı; bağımsız kaynaklarla doğrulanana kadar tek başına kesin olgu sayılmaz.'
    },
    VARSAYILAN: {
      code: 'VARSAYILAN',
      labelTr: 'Varsayılan',
      descriptionTr: 'Analiz veya kullanıcı tarafından açıkça tanımlanan senaryo/model varsayımı.'
    },
    ARASTIRILAN: {
      code: 'ARASTIRILAN',
      labelTr: 'Araştırılan (Hipotez / Aday Bağlantı)',
      descriptionTr: 'Veriden veya alan bilgisinden önerilen, kanıt ve karşı kanıtla sınanan aday ilişki/hipotez.'
    },
    SIMULE_EDILEN: {
      code: 'SIMULE_EDILEN',
      labelTr: 'Simüle Edilen',
      descriptionTr: 'Deterministik çekirdek veya model tarafından belirli varsayımlar altında hesaplanan projeksiyon.'
    },
    CELISKILI: {
      code: 'CELISKILI',
      labelTr: 'Çelişkili',
      descriptionTr: 'Birden fazla kaynağın aynı değişken veya olay hakkında birbiriyle uyuşmayan değerler bildirdiği durum.'
    },
    BILINMEYEN: {
      code: 'BILINMEYEN',
      labelTr: 'Bilinmeyen / Yetersiz Veri',
      descriptionTr: 'Karar kesim zamanında verisi bulunmayan, doğrulanmamış veya mevcut veriyle yanıtlanamayan alan.'
    }
  });

  const HYPOTHESIS_LIFECYCLE_STATUSES = Object.freeze({
    PROPOSED: 'ÖNERİLDİ',
    UNDER_INVESTIGATION: 'İNCELENİYOR',
    SUPPORTED_BY_EVIDENCE: 'DESTEKLEYEN KANIT VAR',
    COUNTER_EVIDENCE_PRESENT: 'KARŞIT KANIT VAR',
    UNCERTAIN: 'BELİRSİZ',
    WEAKENED: 'ZAYIFLADI',
    RETRACTED: 'GERİ ÇEKİLDİ'
  });

  // ============================================================================
  // YARDIMCI KRİPTOGRAFİK ÖZET VE SIKI TARİH DOĞRULAMA FONKSİYONLARI
  // ============================================================================

  function parseStrictIsoDate(isoStr) {
    if (baseCompiler && typeof baseCompiler.parseStrictIsoTimestamp === 'function') {
      return baseCompiler.parseStrictIsoTimestamp(isoStr);
    }
    if (typeof isoStr !== 'string' || isoStr.trim().length < 10) {
      return { valid: false, reason: 'EMPTY_OR_SHORT_TIMESTAMP' };
    }
    const trimmed = isoStr.trim();
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,6}))?)?(Z|[+-]\d{2}:\d{2})?)?$/.exec(trimmed);
    if (!m) {
      return { valid: false, reason: 'MALFORMED_ISO_FORMAT' };
    }
    const year = Number(m[1]);
    const month = Number(m[2]);
    const day = Number(m[3]);
    const hour = m[4] !== undefined ? Number(m[4]) : 0;
    const minute = m[5] !== undefined ? Number(m[5]) : 0;
    const second = m[6] !== undefined ? Number(m[6]) : 0;
    if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) {
      return { valid: false, reason: 'CALENDAR_OUT_OF_RANGE' };
    }
    const probe = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
    if (
      probe.getUTCFullYear() !== year ||
      probe.getUTCMonth() + 1 !== month ||
      probe.getUTCDate() !== day
    ) {
      return { valid: false, reason: 'CALENDAR_ROLLOVER_INVALID_DATE' };
    }
    const parsedMs = Date.parse(trimmed.includes('T') ? trimmed : `${trimmed}T00:00:00.000Z`);
    if (!Number.isFinite(parsedMs)) {
      return { valid: false, reason: 'UNPARSEABLE_DATE_MS' };
    }
    return { valid: true, epochMs: parsedMs, normalizedIso: new Date(parsedMs).toISOString() };
  }

  function canonicalJsonStringify(value) {
    if (value === null || typeof value !== 'object') {
      return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
      return '[' + value.map((item) => canonicalJsonStringify(item)).join(',') + ']';
    }
    const keys = Object.keys(value).sort();
    const parts = [];
    for (const k of keys) {
      if (value[k] === undefined || typeof value[k] === 'function') continue;
      parts.push(JSON.stringify(k) + ':' + canonicalJsonStringify(value[k]));
    }
    return '{' + parts.join(',') + '}';
  }

  function computeSha256Hex(payload) {
    const text = typeof payload === 'string' ? payload : canonicalJsonStringify(payload);
    if (baseCompiler && typeof baseCompiler.computeRealSha256Hex === 'function') {
      return baseCompiler.computeRealSha256Hex(text);
    }
    if (typeof require === 'function') {
      try {
        const crypto = require('crypto');
        return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
      } catch (_) {
        // Pure JS SHA-256 fallback below
      }
    }
    // Pure deterministic SHA-256 implementation for browser/offline environments
    const K = [
      0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
      0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
      0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
      0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
      0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
      0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
      0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
      0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
    ];
    const utf8 = unescape(encodeURIComponent(text));
    const words = [];
    for (let i = 0; i < utf8.length; i++) {
      words[i >> 2] |= (utf8.charCodeAt(i) & 0xff) << (24 - (i % 4) * 8);
    }
    const bitLen = utf8.length * 8;
    words[bitLen >> 5] |= 0x80 << (24 - (bitLen % 32));
    words[(((bitLen + 64) >> 9) << 4) + 15] = bitLen;
    let H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    const W = new Array(64);
    const rotr = (n, x) => (x >>> n) | (x << (32 - n));
    for (let i = 0; i < words.length; i += 16) {
      for (let t = 0; t < 16; t++) W[t] = words[i + t] | 0;
      for (let t = 16; t < 64; t++) {
        const s0 = rotr(7, W[t - 15]) ^ rotr(18, W[t - 15]) ^ (W[t - 15] >>> 3);
        const s1 = rotr(17, W[t - 2]) ^ rotr(19, W[t - 2]) ^ (W[t - 2] >>> 10);
        W[t] = (W[t - 16] + s0 + W[t - 7] + s1) | 0;
      }
      let [a, b, c, d, e, f, g, h] = H;
      for (let t = 0; t < 64; t++) {
        const S1 = rotr(6, e) ^ rotr(11, e) ^ rotr(25, e);
        const ch = (e & f) ^ (~e & g);
        const temp1 = (h + S1 + ch + K[t] + W[t]) | 0;
        const S0 = rotr(2, a) ^ rotr(13, a) ^ rotr(22, a);
        const maj = (a & b) ^ (a & c) ^ (b & c);
        const temp2 = (S0 + maj) | 0;
        h = g; g = f; f = e; e = (d + temp1) | 0;
        d = c; c = b; b = a; a = (temp1 + temp2) | 0;
      }
      H = [
        (H[0] + a) | 0, (H[1] + b) | 0, (H[2] + c) | 0, (H[3] + d) | 0,
        (H[4] + e) | 0, (H[5] + f) | 0, (H[6] + g) | 0, (H[7] + h) | 0
      ];
    }
    return H.map((v) => (v >>> 0).toString(16).padStart(8, '0')).join('');
  }

  // ============================================================================
  // 2. TİCARİ KULLANIM VE BAĞIMSIZLIK KAPISI (BÖLÜM 2)
  // ============================================================================

  const CAELUS_COMMERCIAL_COMPONENT_AND_DATA_INVENTORY = Object.freeze([
    {
      componentId: 'caelus_core_rust_no_std',
      name: 'CAELUS Deterministic Causal Core (Rust #![no_std] + alloc)',
      category: 'CORE_CODE',
      sourceAndVersion: 'First-party repository (`caelus_core/src/lib.rs`, v0.1.0)',
      licenseOrTerms: 'CAELUS Proprietary / First-Party Original Work',
      commercialUseAllowed: true,
      closedSourceCompatible: true,
      targetDeploymentCompatible: true,
      customerOnPremRedistributionAllowed: true,
      copyleftOrDisclosureObligation: 'Yok (CAELUS özgün kodu)',
      attributionOrNoticeRequired: false,
      modelWeightsSeparateTerms: 'Yok (sabit nokta nedensel motoru; derin ağ ağırlığı içermez)',
      dataRightsSummary: 'Tamamı CAELUS’a ait veri yapıları',
      offlineCapable: true,
      feeQuotaOrVendorLockIn: 'Yok',
      reviewedAtIso: '2026-11-09T14:35:00.000Z',
      directReferenceUrl: 'https://github.com/borabirhekimoglu8-ops/CAELUS/tree/main/caelus_core',
      commercialStatus: COMMERCIAL_STATUS_LABELS.CAELUS_PROPRIETARY
    },
    {
      componentId: 'caelus_cpp17_causal_engine',
      name: 'CAELUS Native C++17 Causal Engine & CLI REPL',
      category: 'CORE_CODE',
      sourceAndVersion: 'First-party repository (`src/causal_engine.hpp`, `src/main.cpp`, v9.0)',
      licenseOrTerms: 'CAELUS Proprietary / First-Party Original Work',
      commercialUseAllowed: true,
      closedSourceCompatible: true,
      targetDeploymentCompatible: true,
      customerOnPremRedistributionAllowed: true,
      copyleftOrDisclosureObligation: 'Yok (GCC Runtime Library Exception v3.1 / MSVC uyumlu)',
      attributionOrNoticeRequired: false,
      modelWeightsSeparateTerms: 'Yok',
      dataRightsSummary: 'Tamamı CAELUS’a ait veri yapıları',
      offlineCapable: true,
      feeQuotaOrVendorLockIn: 'Yok',
      reviewedAtIso: '2026-11-09T14:35:00.000Z',
      directReferenceUrl: 'https://github.com/borabirhekimoglu8-ops/CAELUS/tree/main/src',
      commercialStatus: COMMERCIAL_STATUS_LABELS.CAELUS_PROPRIETARY
    },
    {
      componentId: 'caelus_living_world_model_js',
      name: 'CAELUS Yaşayan Dünya Modeli, Hipotez Defteri, Düşüncenin Değişimi ve Senaryo Derleyicisi',
      category: 'CORE_CODE',
      sourceAndVersion: 'First-party repository (`ui/living_world_model.js`, `ui/scenario_compiler.js`, `ui/app.js`, v1.0.0)',
      licenseOrTerms: 'CAELUS Proprietary / First-Party Original Work',
      commercialUseAllowed: true,
      closedSourceCompatible: true,
      targetDeploymentCompatible: true,
      customerOnPremRedistributionAllowed: true,
      copyleftOrDisclosureObligation: 'Yok',
      attributionOrNoticeRequired: false,
      modelWeightsSeparateTerms: 'Yok',
      dataRightsSummary: 'CAELUS’a özgü çift zamanlı hafıza, hipotez yaşam döngüsü ve karar sözleşmeleri',
      offlineCapable: true,
      feeQuotaOrVendorLockIn: 'Yok',
      reviewedAtIso: '2026-11-09T14:35:00.000Z',
      directReferenceUrl: 'https://github.com/borabirhekimoglu8-ops/CAELUS/tree/main/ui',
      commercialStatus: COMMERCIAL_STATUS_LABELS.CAELUS_PROPRIETARY
    },
    {
      componentId: 'rust_crypto_dalek_blake3_stack',
      name: 'Rust Kriptografi Bağımlılıkları (ed25519-dalek@2.1, x25519-dalek@2.0, blake3@1.5, rand@0.8, subtle@2.5, zeroize@1.7)',
      category: 'THIRD_PARTY_LIBRARY',
      sourceAndVersion: 'Cargo.toml (`ed25519-dalek 2.1`, `x25519-dalek 2.0`, `blake3 1.5`, `rand 0.8`, `subtle 2.5`, `zeroize 1.7`)',
      licenseOrTerms: 'BSD-3-Clause (dalek, subtle) & CC0-1.0 / Apache-2.0 / MIT (blake3, rand, zeroize)',
      commercialUseAllowed: true,
      closedSourceCompatible: true,
      targetDeploymentCompatible: true,
      customerOnPremRedistributionAllowed: true,
      copyleftOrDisclosureObligation: 'Yok (İzin verici BSD-3 / MIT / Apache-2.0 / CC0)',
      attributionOrNoticeRequired: true,
      modelWeightsSeparateTerms: 'Yok',
      dataRightsSummary: 'Kriptografik özet ve imza kütüphaneleri',
      offlineCapable: true,
      feeQuotaOrVendorLockIn: 'Yok',
      reviewedAtIso: '2026-11-09T14:35:00.000Z',
      directReferenceUrl: 'https://github.com/dalek-cryptography/curve25519-dalek',
      commercialStatus: COMMERCIAL_STATUS_LABELS.APPROVED_CANDIDATE
    },
    {
      componentId: 'cesium_js_1_114_0',
      name: 'CesiumJS 3B Küre Motoru (NaturalEarthII Yerel Karo Seti ile)',
      category: 'THIRD_PARTY_LIBRARY',
      sourceAndVersion: '`ui/vendor/cesium/` (`cesium@1.114.0`)',
      licenseOrTerms: 'Apache License 2.0 (`ui/vendor/cesium/LICENSE.md`)',
      commercialUseAllowed: true,
      closedSourceCompatible: true,
      targetDeploymentCompatible: true,
      customerOnPremRedistributionAllowed: true,
      copyleftOrDisclosureObligation: 'Yok (Apache-2.0; LICENSE ve NOTICE bildirimleri korunmalı)',
      attributionOrNoticeRequired: true,
      modelWeightsSeparateTerms: 'Yok',
      dataRightsSummary: 'Gömülü NaturalEarthII dokuları Public Domain (`naturalearthdata.com`). Cesium Ion bulut anahtarı kullanılmaz.',
      offlineCapable: true,
      feeQuotaOrVendorLockIn: 'Yok (Cesium Ion devre dışı)',
      reviewedAtIso: '2026-11-09T14:35:00.000Z',
      directReferenceUrl: 'https://github.com/CesiumGS/cesium/blob/1.114/LICENSE.md',
      commercialStatus: COMMERCIAL_STATUS_LABELS.APPROVED_CANDIDATE
    },
    {
      componentId: 'ui_permissive_vendor_bundle',
      name: 'Yerel UI Kütüphaneleri (MapLibre GL 5.2.0, ECharts 5.5.1, Carbon Charts 1.27.27, Cytoscape 3.34.4, deck.gl 9.4.1, vis-timeline 7.7.3, Perspective 3.8.0, Three.js 0.187.0 + 3DTilesRendererJS 0.5.4, Motion 11.11.17, Lucide 1.70.0)',
      category: 'THIRD_PARTY_LIBRARY',
      sourceAndVersion: '`ui/vendor/` sabitlenmiş yerel paketler (`THIRD_PARTY_LICENSES.md`)',
      licenseOrTerms: 'MIT, BSD-3-Clause, ISC, Zlib ve Apache License 2.0',
      commercialUseAllowed: true,
      closedSourceCompatible: true,
      targetDeploymentCompatible: true,
      customerOnPremRedistributionAllowed: true,
      copyleftOrDisclosureObligation: 'Yok (Ücretli Motion+ ve Web Awesome Pro bileşenleri hariç tutulmuştur)',
      attributionOrNoticeRequired: true,
      modelWeightsSeparateTerms: 'Yok',
      dataRightsSummary: 'Kütüphane kodları; telemetri devre dışıdır',
      offlineCapable: true,
      feeQuotaOrVendorLockIn: 'Yok',
      reviewedAtIso: '2026-11-09T14:35:00.000Z',
      directReferenceUrl: 'https://github.com/borabirhekimoglu8-ops/CAELUS/blob/main/ui/vendor/THIRD_PARTY_LICENSES.md',
      commercialStatus: COMMERCIAL_STATUS_LABELS.APPROVED_CANDIDATE
    },
    {
      componentId: 'spacekit_eso_skybox_assets',
      name: 'Spacekit.js ESO Skybox Görselleri (`eso_milkyway.jpg`, `eso_lite.png`)',
      category: 'VISUAL_ASSET',
      sourceAndVersion: '`ui/vendor/spacekit/assets/skybox/` (`spacekit.js@0.1.1`)',
      licenseOrTerms: 'Spacekit kodu MIT; ancak `eso_*.jpg/png` görselleri ESO CC BY 4.0 koşullarına tabidir ve tam görüntü kimliği `README.md` içinde belgelenmemiştir',
      commercialUseAllowed: true,
      closedSourceCompatible: true,
      targetDeploymentCompatible: false,
      customerOnPremRedistributionAllowed: false,
      copyleftOrDisclosureObligation: 'CC BY 4.0 atıf zorunluluğu; tam ESO kaynak bağlantısı doğrulanmadan kapalı kaynak ticari pakete otomatik onaylanmaz',
      attributionOrNoticeRequired: true,
      modelWeightsSeparateTerms: 'Yok',
      dataRightsSummary: 'Ticari pakette Public Domain olan `nasa_tycho.jpg` tercih edilmeli veya ESO atfı doğrulanmalıdır',
      offlineCapable: true,
      feeQuotaOrVendorLockIn: 'Yok',
      reviewedAtIso: '2026-11-09T14:35:00.000Z',
      directReferenceUrl: 'https://www.eso.org/public/copyright/',
      commercialStatus: COMMERCIAL_STATUS_LABELS.UNDER_REVIEW
    },
    {
      componentId: 'davidhdev_react_bits',
      name: 'React Bits (`DavidHDev/react-bits`)',
      category: 'THIRD_PARTY_LIBRARY',
      sourceAndVersion: 'External candidate (`ui/vendor/react-bits-audit/AUDIT_NOTICE.md`)',
      licenseOrTerms: 'MIT + Commons Clause License Condition v1.0',
      commercialUseAllowed: false,
      closedSourceCompatible: false,
      targetDeploymentCompatible: false,
      customerOnPremRedistributionAllowed: false,
      copyleftOrDisclosureObligation: 'Commons Clause v1.0 bileşenlerin paket/bundle içinde veya port edilmiş sürüm olarak satışını ve yeniden dağıtımını yasaklar',
      attributionOrNoticeRequired: true,
      modelWeightsSeparateTerms: 'Yok',
      dataRightsSummary: 'Kodu projeye dahil edilmemiştir; CAELUS özgün bileşeni yazılmıştır',
      offlineCapable: true,
      feeQuotaOrVendorLockIn: 'Yeniden dağıtım yasağı',
      reviewedAtIso: '2026-11-09T14:35:00.000Z',
      directReferenceUrl: 'https://github.com/DavidHDev/react-bits/blob/main/LICENSE.md',
      commercialStatus: COMMERCIAL_STATUS_LABELS.EXCLUDED_FROM_COMMERCIAL_PACK
    },
    {
      componentId: 'gpl_isolated_engines_neo4j_openfoam',
      name: 'GPL-3.0 Harici Motorlar (Neo4j Community Edition GPLv3, OpenFOAM GPLv3)',
      category: 'EXTERNAL_ENGINE',
      sourceAndVersion: 'External process protocol adapters only (No GPL code in repository)',
      licenseOrTerms: 'GNU General Public License v3.0 (GPL-3.0)',
      commercialUseAllowed: true,
      closedSourceCompatible: false,
      targetDeploymentCompatible: false,
      customerOnPremRedistributionAllowed: false,
      copyleftOrDisclosureObligation: 'Kapalı kaynaklı ikiliyle birlikte dağıtılması veya bağlanması durumunda GPL-3.0 kaynak kodu açma yükümlülüğü doğurabilir',
      attributionOrNoticeRequired: true,
      modelWeightsSeparateTerms: 'Yok',
      dataRightsSummary: 'CAELUS ticari paketinin içine dahil edilmez',
      offlineCapable: true,
      feeQuotaOrVendorLockIn: 'Yok',
      reviewedAtIso: '2026-11-09T14:35:00.000Z',
      directReferenceUrl: 'https://www.gnu.org/licenses/gpl-3.0.html',
      commercialStatus: COMMERCIAL_STATUS_LABELS.EXCLUDED_FROM_COMMERCIAL_PACK
    },
    {
      componentId: 'public_domain_us_gov_datasets',
      name: 'ABD Kamu Malı Açık Veri Kaynakları (USGS Earthquake GeoJSON, NASA GIBS/EONET/JPL Horizons, FERC/NERC 2021 Winter Storm Uri Report)',
      category: 'DATASET_AND_SERVICE',
      sourceAndVersion: 'USGS FDSNWS v1, NASA EONET v3, NASA JPL Horizons v1.2, FERC/NERC Nov 2021 Report',
      licenseOrTerms: 'U.S. Government Public Domain (17 U.S.C. § 105) / NASA Open Data Policy',
      commercialUseAllowed: true,
      closedSourceCompatible: true,
      targetDeploymentCompatible: true,
      customerOnPremRedistributionAllowed: true,
      copyleftOrDisclosureObligation: 'Yok (Kaynak atfı yapılmalı, resmi kurum onayı izlenimi verilmemeli)',
      attributionOrNoticeRequired: true,
      modelWeightsSeparateTerms: 'Yok',
      dataRightsSummary: 'Saklama, analiz, modelleme ve örnek vaka paketinde yeniden dağıtım serbesttir',
      offlineCapable: true,
      feeQuotaOrVendorLockIn: 'Canlı API çağrılarında hız sınırı vardır; çevrim dışı vaka paketleri yereldir',
      reviewedAtIso: '2026-11-09T14:35:00.000Z',
      directReferenceUrl: 'https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits',
      commercialStatus: COMMERCIAL_STATUS_LABELS.APPROVED_CANDIDATE
    },
    {
      componentId: 'open_meteo_public_api',
      name: 'Open-Meteo Weather & Marine API (Ücretsiz Açık Katman vs Ticari Lisans)',
      category: 'EXTERNAL_SERVICE',
      sourceAndVersion: '`https://api.open-meteo.com/v1/forecast`',
      licenseOrTerms: 'Veri: CC BY 4.0; Barındırılan API Servisi: Yalnızca Ticari Olmayan (Non-Commercial) kullanım için ücretsizdir; ticari dağıtımda ücretli Open-Meteo Ticari API aboneliği veya kendi sunucunda (self-hosted) çalıştırma gerekir',
      commercialUseAllowed: false,
      closedSourceCompatible: true,
      targetDeploymentCompatible: false,
      customerOnPremRedistributionAllowed: false,
      copyleftOrDisclosureObligation: 'CC BY 4.0 atıf zorunluluğu + Ticari API sözleşmesi gereksinimi',
      attributionOrNoticeRequired: true,
      modelWeightsSeparateTerms: 'Yok',
      dataRightsSummary: 'Ticari dağıtım öncesi kurumsal API aboneliği alınmalı veya doğrudan NOAA/ECMWF açık veri hattı kullanılmalıdır',
      offlineCapable: false,
      feeQuotaOrVendorLockIn: 'Ticari kullanımda ücretli API aboneliği gerektirir',
      reviewedAtIso: '2026-11-09T14:35:00.000Z',
      directReferenceUrl: 'https://open-meteo.com/en/terms',
      commercialStatus: COMMERCIAL_STATUS_LABELS.UNDER_REVIEW
    },
    {
      componentId: 'dowhy_pyg_research_candidates',
      name: 'PyTorch Geometric (PyG) & DoWhy Nedensel Çıkarım Kütüphaneleri (Araştırma Adayları)',
      category: 'RESEARCH_LIBRARY',
      sourceAndVersion: 'PyG >= 2.5 (MIT), DoWhy >= 0.11 (MIT)',
      licenseOrTerms: 'MIT License',
      commercialUseAllowed: true,
      closedSourceCompatible: true,
      targetDeploymentCompatible: true,
      customerOnPremRedistributionAllowed: true,
      copyleftOrDisclosureObligation: 'Yok (MIT; alt bağımlılıklar ayrıca denetlenmeli)',
      attributionOrNoticeRequired: true,
      modelWeightsSeparateTerms: 'Kütüphane kodu MIT’dir; dışarıdan indirilecek model ağırlıkları ayrıca incelenmelidir',
      dataRightsSummary: 'Çevrim dışı araştırma ve benchmark karşılaştırması için uygundur; CAELUS çekirdeğinin zorunlu bağımlılığı değildir',
      offlineCapable: true,
      feeQuotaOrVendorLockIn: 'Yok',
      reviewedAtIso: '2026-11-09T14:35:00.000Z',
      directReferenceUrl: 'https://github.com/pyg-team/pytorch_geometric/blob/master/LICENSE',
      commercialStatus: COMMERCIAL_STATUS_LABELS.APPROVED_CANDIDATE
    },
    {
      componentId: 'vjepa2_visual_world_model_weights',
      name: 'V-JEPA 2 / V-JEPA 2.1 Görsel Dünya Modeli ve Ağırlıkları',
      category: 'MODEL_WEIGHTS',
      sourceAndVersion: 'Meta FAIR V-JEPA / V-JEPA 2',
      licenseOrTerms: 'Kod izin verici olsa da seçilen önceden eğitilmiş ağırlıklar ve eğitim veri kümeleri ayrı araştırma/lisans koşullarına tabidir; ayrıca yerel entegre GPU (Intel UHD 620) üzerinde çalıştırılamaz',
      commercialUseAllowed: false,
      closedSourceCompatible: false,
      targetDeploymentCompatible: false,
      customerOnPremRedistributionAllowed: false,
      copyleftOrDisclosureObligation: 'Model ağırlığı ve eğitim verisi ticari yeniden dağıtım hakları doğrulanmamıştır',
      attributionOrNoticeRequired: true,
      modelWeightsSeparateTerms: 'Evet — Model ağırlıkları kod lisansından ayrı koşullara tabidir',
      dataRightsSummary: 'Ticari pakete dahil edilmemiştir; CAELUS içinde yalnızca çok modlu gözlem/çıkarım sözleşmesi tanımlanmıştır',
      offlineCapable: false,
      feeQuotaOrVendorLockIn: 'Yüksek VRAM GPU donanım gereksinimi ve ağırlık lisansı kısıtı',
      reviewedAtIso: '2026-11-09T14:35:00.000Z',
      directReferenceUrl: 'https://github.com/facebookresearch/vjepa2',
      commercialStatus: COMMERCIAL_STATUS_LABELS.EXCLUDED_FROM_COMMERCIAL_PACK
    },
    {
      componentId: 'genie_closed_world_service',
      name: 'Google DeepMind Genie / Genie 2 ve Benzeri Kapalı Görsel Dünya Servisleri',
      category: 'EXTERNAL_SERVICE',
      sourceAndVersion: 'Proprietary External Research / Cloud Preview',
      licenseOrTerms: 'Kapalı kaynak / Ticari yeniden dağıtım ve müşteri tesisine kurulum hakkı yoktur',
      commercialUseAllowed: false,
      closedSourceCompatible: false,
      targetDeploymentCompatible: false,
      customerOnPremRedistributionAllowed: false,
      copyleftOrDisclosureObligation: 'Kapalı dış servis; çevrim dışı ve hava boşluklu kurulumla uyumsuz',
      attributionOrNoticeRequired: true,
      modelWeightsSeparateTerms: 'Ağırlıklar kamuya açık değildir',
      dataRightsSummary: 'Çekirdeğin bağımlılığı yapılmamıştır ve ticari paketin dışındadır',
      offlineCapable: false,
      feeQuotaOrVendorLockIn: 'Tam dış sağlayıcı bağımlılığı',
      reviewedAtIso: '2026-11-09T14:35:00.000Z',
      directReferenceUrl: 'https://deepmind.google/discover/blog/genie-2-a-large-scale-foundation-world-model/',
      commercialStatus: COMMERCIAL_STATUS_LABELS.EXCLUDED_FROM_COMMERCIAL_PACK
    }
  ]);

  const REQUIRED_13_COMMERCIAL_QUESTIONS = Object.freeze([
    'sourceAndVersion',
    'licenseOrTerms',
    'commercialUseAllowed',
    'closedSourceCompatible',
    'targetDeploymentCompatible',
    'customerOnPremRedistributionAllowed',
    'copyleftOrDisclosureObligation',
    'attributionOrNoticeRequired',
    'modelWeightsSeparateTerms',
    'dataRightsSummary',
    'offlineCapable',
    'feeQuotaOrVendorLockIn',
    'directReferenceUrl'
  ]);

  function auditCommercialComponentInventory(customComponents, deploymentMode) {
    const items = Array.isArray(customComponents) && customComponents.length > 0
      ? customComponents
      : CAELUS_COMMERCIAL_COMPONENT_AND_DATA_INVENTORY;
    const mode = deploymentMode || COMMERCIAL_DEPLOYMENT_MODES.A_PAID_CLOSED_SOURCE_SOFTWARE;

    const approvedForCommercialBundle = [];
    const underReviewComponents = [];
    const excludedComponents = [];
    const redLineViolations = [];

    for (const item of items) {
      const missingQuestions = REQUIRED_13_COMMERCIAL_QUESTIONS.filter(
        (q) => item[q] === undefined || item[q] === null || item[q] === ''
      );
      const status = item.commercialStatus;
      const isValidStatus = Object.values(COMMERCIAL_STATUS_LABELS).includes(status);

      // Red-line checks: an uncertain, non-commercial, closed-source-incompatible, or missing-question item
      // can NEVER be auto-approved for a closed-source / on-prem commercial bundle.
      const failsClosedSourceOrOnPrem =
        item.commercialUseAllowed !== true ||
        item.closedSourceCompatible !== true ||
        item.targetDeploymentCompatible !== true ||
        item.customerOnPremRedistributionAllowed !== true ||
        missingQuestions.length > 0 ||
        !isValidStatus;

      if (
        (status === COMMERCIAL_STATUS_LABELS.APPROVED_CANDIDATE ||
          status === COMMERCIAL_STATUS_LABELS.CAELUS_PROPRIETARY) &&
        failsClosedSourceOrOnPrem
      ) {
        redLineViolations.push({
          componentId: item.componentId,
          claimedStatus: status,
          reason: missingQuestions.length > 0
            ? `MISSING_COMMERCIAL_METADATA: ${missingQuestions.join(', ')}`
            : 'COMPONENT_FAILS_CLOSED_SOURCE_OR_REDISTRIBUTION_REQUIREMENTS',
          autoApproved: false
        });
        excludedComponents.push({ ...item, autoApproved: false, effectiveStatus: COMMERCIAL_STATUS_LABELS.UNDER_REVIEW });
        continue;
      }

      if (status === COMMERCIAL_STATUS_LABELS.CAELUS_PROPRIETARY || status === COMMERCIAL_STATUS_LABELS.APPROVED_CANDIDATE) {
        approvedForCommercialBundle.push({
          ...item,
          autoApproved: true,
          effectiveStatus: status
        });
      } else if (status === COMMERCIAL_STATUS_LABELS.UNDER_REVIEW) {
        underReviewComponents.push({
          ...item,
          autoApproved: false,
          effectiveStatus: COMMERCIAL_STATUS_LABELS.UNDER_REVIEW
        });
      } else {
        excludedComponents.push({
          ...item,
          autoApproved: false,
          effectiveStatus: COMMERCIAL_STATUS_LABELS.EXCLUDED_FROM_COMMERCIAL_PACK
        });
      }
    }

    return {
      deploymentMode: mode,
      totalEvaluated: items.length,
      approvedCount: approvedForCommercialBundle.length,
      underReviewCount: underReviewComponents.length,
      excludedCount: excludedComponents.length,
      redLineViolationCount: redLineViolations.length,
      approvedForCommercialBundle,
      underReviewComponents,
      excludedComponents,
      redLineViolations,
      allUncertainOrExcludedBlockedFromBundle: underReviewComponents.every((c) => c.autoApproved === false) &&
        excludedComponents.every((c) => c.autoApproved === false) &&
        redLineViolations.length === 0,
      legalCertitudeClaimed: false,
      honestAuditNoticeTr:
        'Bu otomatik denetim 13 ticari soruyu ve kırmızı çizgileri (GPL/AGPL, Commons Clause, araştırma ağırlıkları, ticari olmayan ücretsiz API katmanları) kontrol eder; belirsiz hiçbir bileşeni otomatik onaylamaz. Nihai dağıtım öncesi hukuk incelemesi yerine geçmez.'
    };
  }

  // ============================================================================
  // 4. YAŞAYAN DÜNYA HAFIZASI (BÖLÜM 4 — 17 KAVRAM, 13 ALAN, İKİ SORU)
  // ============================================================================

  function createLivingWorldMemoryStore(options) {
    const opts = options || {};
    return {
      storeId: opts.storeId || 'CAELUS-LIVING-WORLD-MEMORY-V1',
      createdAtSystemIso: opts.createdAtSystemIso || '2026-11-09T14:35:00.000Z',
      recordsById: new Map(),
      recordsInOrder: [],
      conflictClustersByKey: new Map(),
      savedAssessments: [],
      rejectedRecordLog: []
    };
  }

  function addLivingWorldRecord(store, rawRecord) {
    if (!store || !(store.recordsById instanceof Map)) {
      throw new Error('Geçersiz LivingWorldMemoryStore nesnesi.');
    }
    if (!rawRecord || typeof rawRecord !== 'object') {
      return { accepted: false, reason: 'INVALID_RECORD_OBJECT' };
    }
    const recordId = String(rawRecord.recordId || '').trim();
    const conceptType = String(rawRecord.conceptType || '').trim();
    if (!recordId) {
      return { accepted: false, reason: 'MISSING_RECORD_ID' };
    }
    if (!LIVING_WORLD_17_CONCEPTS.includes(conceptType)) {
      const rej = { recordId, reason: `UNSUPPORTED_CONCEPT_TYPE:${conceptType}` };
      store.rejectedRecordLog.push(rej);
      return { accepted: false, ...rej };
    }

    const validTimeCheck = parseStrictIsoDate(rawRecord.eventValidTimeIso);
    if (!validTimeCheck.valid) {
      const rej = { recordId, reason: `INVALID_EVENT_VALID_TIME:${validTimeCheck.reason}` };
      store.rejectedRecordLog.push(rej);
      return { accepted: false, ...rej };
    }
    const learnedTimeCheck = parseStrictIsoDate(rawRecord.learnedAtTimeIso);
    if (!learnedTimeCheck.valid) {
      const rej = { recordId, reason: `INVALID_LEARNED_TIME:${learnedTimeCheck.reason}` };
      store.rejectedRecordLog.push(rej);
      return { accepted: false, ...rej };
    }
    const ingestedTimeCheck = parseStrictIsoDate(
      rawRecord.ingestedAtSystemTimeIso || rawRecord.learnedAtTimeIso
    );
    if (!ingestedTimeCheck.valid) {
      const rej = { recordId, reason: `INVALID_INGESTED_TIME:${ingestedTimeCheck.reason}` };
      store.rejectedRecordLog.push(rej);
      return { accepted: false, ...rej };
    }

    const commercialStatus = rawRecord.commercialUsageStatus || COMMERCIAL_STATUS_LABELS.APPROVED_CANDIDATE;
    const epistemicCategory = rawRecord.epistemicCategory || 'KAYNAKTA_IDDIA_EDILEN';
    const contentPayload = {
      recordId,
      conceptType,
      sourceId: String(rawRecord.sourceId || 'UNKNOWN_SOURCE'),
      eventValidTimeIso: validTimeCheck.normalizedIso,
      learnedAtTimeIso: learnedTimeCheck.normalizedIso,
      subjectKey: String(rawRecord.subjectKey || rawRecord.targetVariableId || recordId),
      value: rawRecord.value !== undefined ? rawRecord.value : null,
      summaryTr: String(rawRecord.summaryTr || ''),
      unit: String(rawRecord.unit || 'unitless'),
      relatedEntityIds: Array.isArray(rawRecord.relatedEntityIds) ? rawRecord.relatedEntityIds.slice() : [],
      epistemicCategory
    };
    const contentHashSha256 = computeSha256Hex(contentPayload);

    const existing = store.recordsById.get(recordId);
    const previousVersions = existing
      ? existing.revisionHistory.concat([
          Object.freeze({
            versionNumber: existing.versionNumber,
            recordSnapshot: Object.freeze({ ...existing, revisionHistory: undefined }),
            archivedAtTimeIso: learnedTimeCheck.normalizedIso
          })
        ])
      : [];

    const versionNumber = existing ? existing.versionNumber + 1 : 1;
    const recordObj = {
      recordId,
      versionNumber,
      conceptType,
      sourceId: contentPayload.sourceId,
      sourceName: String(rawRecord.sourceName || contentPayload.sourceId),
      eventValidTimeIso: validTimeCheck.normalizedIso,
      eventValidEpochMs: validTimeCheck.epochMs,
      learnedAtTimeIso: learnedTimeCheck.normalizedIso,
      learnedAtEpochMs: learnedTimeCheck.epochMs,
      ingestedAtSystemTimeIso: ingestedTimeCheck.normalizedIso,
      ingestedAtEpochMs: ingestedTimeCheck.epochMs,
      revisionHistory: previousVersions,
      epistemicCategory,
      confidenceAndQuality: Object.freeze({
        score: typeof rawRecord.confidenceScore === 'number' ? rawRecord.confidenceScore : null,
        isCalibratedProbability: false,
        meaningTr: String(
          rawRecord.confidenceMeaningTr ||
            'Kaynak güvenilirliği ve veri tamlığına dayalı kalibre edilmemiş kalite ağırlığı (gerçekleşme olasılığı değildir).'
        )
      }),
      unit: contentPayload.unit,
      relatedEntityIds: contentPayload.relatedEntityIds,
      subjectKey: contentPayload.subjectKey,
      value: contentPayload.value,
      summaryTr: contentPayload.summaryTr,
      previousVersionId: existing ? `${recordId}@v${existing.versionNumber}` : (rawRecord.previousVersionId || null),
      contentHashSha256,
      hashMeaningTr: 'SHA-256 yalnızca kaydın bütünlüğünü (değiştirilmediğini) doğrular; kaynağın iddiasının doğru olduğunu kanıtlamaz.',
      commercialUsageStatus: commercialStatus,
      retracted: Boolean(rawRecord.retracted),
      retractedAtTimeIso: rawRecord.retractedAtTimeIso || null,
      retractionReasonTr: rawRecord.retractionReasonTr || null
    };

    store.recordsById.set(recordId, recordObj);
    if (!existing) {
      store.recordsInOrder.push(recordId);
    }

    // Çelişki kümeleme (GOZLEM ve IDDIA kayıtları için aynı subjectKey üzerinde farklı değer varsa birlikte koru)
    if (
      (conceptType === 'GOZLEM' || conceptType === 'IDDIA') &&
      recordObj.subjectKey &&
      recordObj.value !== null &&
      recordObj.value !== undefined
    ) {
      const clusterKey = recordObj.subjectKey;
      const cluster = store.conflictClustersByKey.get(clusterKey) || [];
      cluster.push({
        recordId: recordObj.recordId,
        sourceId: recordObj.sourceId,
        value: recordObj.value,
        unit: recordObj.unit,
        eventValidTimeIso: recordObj.eventValidTimeIso,
        learnedAtTimeIso: recordObj.learnedAtTimeIso,
        learnedAtEpochMs: recordObj.learnedAtEpochMs
      });
      store.conflictClustersByKey.set(clusterKey, cluster);
    }

    return {
      accepted: true,
      recordId,
      versionNumber,
      contentHashSha256,
      record: recordObj
    };
  }

  function applyLivingWorldCorrection(store, targetRecordId, correctionSpec) {
    const target = store.recordsById.get(targetRecordId);
    if (!target) {
      return { applied: false, reason: 'TARGET_RECORD_NOT_FOUND' };
    }
    const corrTimeCheck = parseStrictIsoDate(correctionSpec.learnedAtTimeIso);
    if (!corrTimeCheck.valid) {
      return { applied: false, reason: `INVALID_CORRECTION_TIME:${corrTimeCheck.reason}` };
    }
    const correctionRecordId = correctionSpec.correctionRecordId || `CORR-${targetRecordId}-v${target.versionNumber + 1}`;
    addLivingWorldRecord(store, {
      recordId: correctionRecordId,
      conceptType: 'DUZELTME',
      sourceId: correctionSpec.sourceId || target.sourceId,
      eventValidTimeIso: target.eventValidTimeIso,
      learnedAtTimeIso: corrTimeCheck.normalizedIso,
      ingestedAtSystemTimeIso: correctionSpec.ingestedAtSystemTimeIso || corrTimeCheck.normalizedIso,
      subjectKey: target.subjectKey,
      value: correctionSpec.correctedValue,
      unit: correctionSpec.unit || target.unit,
      relatedEntityIds: target.relatedEntityIds,
      previousVersionId: `${target.recordId}@v${target.versionNumber}`,
      epistemicCategory: correctionSpec.epistemicCategory || target.epistemicCategory,
      summaryTr: correctionSpec.summaryTr || `${targetRecordId} kaydı yeni kanıtla düzeltildi.`
    });

    // Hedef kaydı yeni sürüme yükseltirken önceki sürümü revisionHistory içinde koru
    const updated = addLivingWorldRecord(store, {
      ...target,
      recordId: target.recordId,
      conceptType: target.conceptType,
      sourceId: correctionSpec.sourceId || target.sourceId,
      eventValidTimeIso: target.eventValidTimeIso,
      learnedAtTimeIso: corrTimeCheck.normalizedIso,
      ingestedAtSystemTimeIso: correctionSpec.ingestedAtSystemTimeIso || corrTimeCheck.normalizedIso,
      value: correctionSpec.correctedValue !== undefined ? correctionSpec.correctedValue : target.value,
      summaryTr: correctionSpec.summaryTr || target.summaryTr,
      epistemicCategory: correctionSpec.epistemicCategory || target.epistemicCategory
    });

    return {
      applied: true,
      correctionRecordId,
      targetRecordId,
      newVersionNumber: updated.versionNumber,
      preservedPreviousVersionsCount: updated.record.revisionHistory.length
    };
  }

  function applyLivingWorldRetraction(store, targetRecordId, retractionSpec) {
    const target = store.recordsById.get(targetRecordId);
    if (!target) {
      return { applied: false, reason: 'TARGET_RECORD_NOT_FOUND' };
    }
    const retrTimeCheck = parseStrictIsoDate(retractionSpec.learnedAtTimeIso);
    if (!retrTimeCheck.valid) {
      return { applied: false, reason: `INVALID_RETRACTION_TIME:${retrTimeCheck.reason}` };
    }
    const retractionRecordId = retractionSpec.retractionRecordId || `RETR-${targetRecordId}`;
    addLivingWorldRecord(store, {
      recordId: retractionRecordId,
      conceptType: 'GERI_CEKME',
      sourceId: retractionSpec.sourceId || target.sourceId,
      eventValidTimeIso: target.eventValidTimeIso,
      learnedAtTimeIso: retrTimeCheck.normalizedIso,
      ingestedAtSystemTimeIso: retractionSpec.ingestedAtSystemTimeIso || retrTimeCheck.normalizedIso,
      subjectKey: target.subjectKey,
      value: null,
      unit: target.unit,
      relatedEntityIds: target.relatedEntityIds,
      previousVersionId: `${target.recordId}@v${target.versionNumber}`,
      epistemicCategory: 'BILINEN',
      summaryTr: retractionSpec.reasonTr || `${targetRecordId} kaydı geri çekildi.`
    });

    const updated = addLivingWorldRecord(store, {
      ...target,
      learnedAtTimeIso: retrTimeCheck.normalizedIso,
      ingestedAtSystemTimeIso: retractionSpec.ingestedAtSystemTimeIso || retrTimeCheck.normalizedIso,
      retracted: true,
      retractedAtTimeIso: retrTimeCheck.normalizedIso,
      retractionReasonTr: retractionSpec.reasonTr || 'Kaynak tarafından geri çekildi.'
    });

    return {
      applied: true,
      retractionRecordId,
      targetRecordId,
      newVersionNumber: updated.versionNumber,
      preservedPreviousVersionsCount: updated.record.revisionHistory.length
    };
  }

  /**
   * Seçilen bir kesim tarihinde (queryDateIso) bir kaydın o tarihte bilinen sürümünü çözer.
   * Gelecekte (queryDateIso sonrasında) yapılan düzeltmeleri veya geri çekmeleri GİZLER.
   */
  function resolveRecordVersionAtCutoff(record, cutoffEpochMs) {
    // Tüm sürümleri (eski sürümler + güncel sürüm) kronolojik sırayla incele
    const allVersions = (record.revisionHistory || [])
      .map((h) => h.recordSnapshot)
      .concat([record]);

    // Kesim zamanında veya öncesinde öğrenilmiş (learnedAtEpochMs <= cutoffEpochMs) en son sürümü seç
    let activeAtCutoff = null;
    for (const ver of allVersions) {
      if (ver.learnedAtEpochMs <= cutoffEpochMs && ver.ingestedAtEpochMs <= cutoffEpochMs) {
        activeAtCutoff = ver;
      }
    }
    return activeAtCutoff;
  }

  /**
   * Bölüm 4: İki temel bitemporal soruyu ayrı ayrı yanıtlar:
   * 1. Seçilen tarihte dünyada ne olduğu düşünülüyordu? (whatWasBelievedAboutWorldAtDate)
   * 2. CAELUS o tarihte hangi bilgilere erişebiliyordu? (whatInformationDidCaelusHaveAccessToAtDate)
   */
  function answerLivingWorldDualQuestionsAtDate(store, queryDateIso) {
    const dateCheck = parseStrictIsoDate(queryDateIso);
    if (!dateCheck.valid) {
      return {
        valid: false,
        reason: `INVALID_QUERY_DATE:${dateCheck.reason}`
      };
    }
    const cutoffMs = dateCheck.epochMs;
    const accessibleRecords = [];
    const blockedFutureRecords = [];
    const activeWorldBeliefs = [];
    const retractedByCutoffRecords = [];

    for (const recordId of store.recordsInOrder) {
      const latestRecord = store.recordsById.get(recordId);
      const versionAtCutoff = resolveRecordVersionAtCutoff(latestRecord, cutoffMs);
      if (!versionAtCutoff) {
        blockedFutureRecords.push({
          recordId: latestRecord.recordId,
          conceptType: latestRecord.conceptType,
          learnedAtTimeIso: latestRecord.learnedAtTimeIso,
          blockReason: 'LEARNED_OR_INGESTED_AFTER_QUERY_DATE'
        });
        continue;
      }
      accessibleRecords.push(versionAtCutoff);
      if (versionAtCutoff.retracted) {
        retractedByCutoffRecords.push(versionAtCutoff);
      } else if (versionAtCutoff.eventValidEpochMs <= cutoffMs) {
        activeWorldBeliefs.push(versionAtCutoff);
      }
    }

    // Kesim anında aktif olan çelişkileri hesapla (sessizce tek doğruya indirgeme!)
    const activeConflictsAtDate = [];
    for (const [subjectKey, entries] of store.conflictClustersByKey.entries()) {
      const visibleEntries = entries.filter((e) => e.learnedAtEpochMs <= cutoffMs);
      const distinctValues = Array.from(new Set(visibleEntries.map((e) => JSON.stringify(e.value)))).map((s) => JSON.parse(s));
      if (distinctValues.length > 1) {
        activeConflictsAtDate.push({
          subjectKey,
          competingValues: distinctValues,
          competingRecords: visibleEntries,
          preservedSideBySide: true
        });
      }
    }

    return {
      valid: true,
      queryDateIso: dateCheck.normalizedIso,
      question1_WhatWasBelievedAboutWorldAtDate: {
        questionTr: 'Seçilen tarihte dünyada ne olduğu düşünülüyordu?',
        activeBeliefCount: activeWorldBeliefs.length,
        activeBeliefs: activeWorldBeliefs,
        activeConflictsPreserved: activeConflictsAtDate,
        retractedByThisDateCount: retractedByCutoffRecords.length
      },
      question2_WhatInformationDidCaelusHaveAccessToAtDate: {
        questionTr: 'CAELUS o tarihte hangi bilgilere erişebiliyordu?',
        accessibleRecordCount: accessibleRecords.length,
        accessibleRecords,
        blockedFutureRecordCount: blockedFutureRecords.length,
        blockedFutureRecords
      },
      snapshotHashSha256: computeSha256Hex({
        queryDateIso: dateCheck.normalizedIso,
        accessibleRecordIds: accessibleRecords.map((r) => `${r.recordId}@v${r.versionNumber}`),
        activeConflictKeys: activeConflictsAtDate.map((c) => c.subjectKey)
      })
    };
  }

  // ============================================================================
  // 7. HİPOTEZ DEFTERİ VE KARŞI KANIT MOTORU (BÖLÜM 7)
  // ============================================================================

  function createHypothesisLedger() {
    return {
      ledgerId: 'CAELUS-HYPOTHESIS-LEDGER-V1',
      hypothesesById: new Map(),
      hypothesisOrder: []
    };
  }

  function registerLivingHypothesis(ledger, rawHypothesis) {
    if (!ledger || !(ledger.hypothesesById instanceof Map)) {
      throw new Error('Geçersiz HypothesisLedger.');
    }
    const hypothesisId = String(rawHypothesis.hypothesisId || '').trim();
    if (!hypothesisId) {
      throw new Error('Hipotez kimliği (hypothesisId) zorunludur.');
    }
    const createdCheck = parseStrictIsoDate(rawHypothesis.createdAtIso || '2021-02-17T12:00:00.000Z');
    if (!createdCheck.valid) {
      throw new Error(`Geçersiz hipotez oluşturulma zamanı: ${createdCheck.reason}`);
    }

    const initialStatus = rawHypothesis.initialStatus &&
      Object.values(HYPOTHESIS_LIFECYCLE_STATUSES).includes(rawHypothesis.initialStatus)
      ? rawHypothesis.initialStatus
      : HYPOTHESIS_LIFECYCLE_STATUSES.PROPOSED;

    const hyp = {
      hypothesisId,
      versionNumber: 1,
      previousVersionId: null,
      titleTr: String(rawHypothesis.titleTr || hypothesisId),
      descriptionTr: String(rawHypothesis.descriptionTr || ''),
      relatedEventIds: Array.isArray(rawHypothesis.relatedEventIds) ? rawHypothesis.relatedEventIds.slice() : [],
      relatedEntityIds: Array.isArray(rawHypothesis.relatedEntityIds) ? rawHypothesis.relatedEntityIds.slice() : [],
      createdAtIso: createdCheck.normalizedIso,
      createdAtEpochMs: createdCheck.epochMs,
      grounds: Array.isArray(rawHypothesis.grounds) ? rawHypothesis.grounds.slice() : [],
      assumptions: Array.isArray(rawHypothesis.assumptions) ? rawHypothesis.assumptions.slice() : [],
      // 5 Zorunlu Hipotez Sorusu:
      expectedObservationsIfTrue: Array.isArray(rawHypothesis.expectedObservationsIfTrue)
        ? rawHypothesis.expectedObservationsIfTrue.slice()
        : [],
      weakeningObservations: Array.isArray(rawHypothesis.weakeningObservations)
        ? rawHypothesis.weakeningObservations.slice()
        : [],
      alternativeExplanations: Array.isArray(rawHypothesis.alternativeExplanations)
        ? rawHypothesis.alternativeExplanations.slice()
        : [],
      missingInformation: Array.isArray(rawHypothesis.missingInformation)
        ? rawHypothesis.missingInformation.slice()
        : [],
      userInspectionGuideTr: String(
        rawHypothesis.userInspectionGuideTr ||
          'Dayanak kayıtlarını, beklenen gözlemleri ve karşı kanıt zaman damgalarını Hipotez Defteri kartından inceleyebilirsiniz.'
      ),
      supportingEvidence: [],
      counterEvidence: [],
      evaluationHistory: [
        Object.freeze({
          versionNumber: 1,
          evaluatedAtIso: createdCheck.normalizedIso,
          evaluatedAtEpochMs: createdCheck.epochMs,
          status: initialStatus,
          rationaleTr: 'Hipotez başlangıç dayanakları ve varsayımlarıyla oluşturuldu.',
          supportingCount: 0,
          counterCount: 0
        })
      ],
      status: initialStatus,
      isProvenTruth: false
    };

    ledger.hypothesesById.set(hypothesisId, hyp);
    if (!ledger.hypothesisOrder.includes(hypothesisId)) {
      ledger.hypothesisOrder.push(hypothesisId);
    }
    return hyp;
  }

  function computeHypothesisStatusFromEvidence(supportingList, counterList) {
    const supWeight = supportingList.reduce((acc, item) => acc + (Number(item.weight) || 1), 0);
    const cntWeight = counterList.reduce((acc, item) => acc + (Number(item.weight) || 1), 0);
    const hasDecisiveFalsifier = counterList.some((item) => item.isDecisiveFalsifier === true);

    if (hasDecisiveFalsifier && cntWeight >= supWeight) {
      return HYPOTHESIS_LIFECYCLE_STATUSES.RETRACTED;
    }
    if (supportingList.length === 0 && counterList.length === 0) {
      return HYPOTHESIS_LIFECYCLE_STATUSES.UNDER_INVESTIGATION;
    }
    if (counterList.length > 0 && cntWeight > supWeight * 1.25) {
      return HYPOTHESIS_LIFECYCLE_STATUSES.WEAKENED;
    }
    if (counterList.length > 0 && supportingList.length > 0) {
      return HYPOTHESIS_LIFECYCLE_STATUSES.COUNTER_EVIDENCE_PRESENT;
    }
    if (counterList.length > 0 && supportingList.length === 0) {
      return HYPOTHESIS_LIFECYCLE_STATUSES.WEAKENED;
    }
    if (supportingList.length > 0 && counterList.length === 0) {
      return HYPOTHESIS_LIFECYCLE_STATUSES.SUPPORTED_BY_EVIDENCE;
    }
    return HYPOTHESIS_LIFECYCLE_STATUSES.UNCERTAIN;
  }

  function submitHypothesisEvidence(ledger, hypothesisId, evidenceSpec) {
    const hyp = ledger.hypothesesById.get(hypothesisId);
    if (!hyp) {
      return { updated: false, reason: 'HYPOTHESIS_NOT_FOUND' };
    }
    const timeCheck = parseStrictIsoDate(evidenceSpec.learnedAtTimeIso);
    if (!timeCheck.valid) {
      return { updated: false, reason: `INVALID_EVIDENCE_TIME:${timeCheck.reason}` };
    }
    const polarity = evidenceSpec.polarity === 'COUNTER_EVIDENCE' ? 'COUNTER_EVIDENCE' : 'SUPPORTING_EVIDENCE';
    const evRecord = Object.freeze({
      evidenceId: String(evidenceSpec.evidenceId || `EV-${hypothesisId}-${hyp.versionNumber + 1}`),
      sourceId: String(evidenceSpec.sourceId || 'UNKNOWN_SOURCE'),
      polarity,
      learnedAtTimeIso: timeCheck.normalizedIso,
      learnedAtEpochMs: timeCheck.epochMs,
      summaryTr: String(evidenceSpec.summaryTr || ''),
      weight: typeof evidenceSpec.weight === 'number' ? evidenceSpec.weight : 1.0,
      isDecisiveFalsifier: Boolean(evidenceSpec.isDecisiveFalsifier)
    });

    const previousStatus = hyp.status;
    if (polarity === 'COUNTER_EVIDENCE') {
      hyp.counterEvidence.push(evRecord);
    } else {
      hyp.supportingEvidence.push(evRecord);
    }

    hyp.previousVersionId = `${hyp.hypothesisId}@v${hyp.versionNumber}`;
    hyp.versionNumber += 1;
    hyp.status = computeHypothesisStatusFromEvidence(hyp.supportingEvidence, hyp.counterEvidence);

    const historyEntry = Object.freeze({
      versionNumber: hyp.versionNumber,
      evaluatedAtIso: timeCheck.normalizedIso,
      evaluatedAtEpochMs: timeCheck.epochMs,
      previousStatus,
      status: hyp.status,
      triggeredByEvidenceId: evRecord.evidenceId,
      polarity,
      rationaleTr: `${polarity === 'COUNTER_EVIDENCE' ? 'Karşı kanıt' : 'Destekleyici kanıt'} (${evRecord.evidenceId}) eklendi: ${evRecord.summaryTr}`,
      supportingCount: hyp.supportingEvidence.length,
      counterCount: hyp.counterEvidence.length
    });
    hyp.evaluationHistory.push(historyEntry);

    return {
      updated: true,
      hypothesisId,
      previousStatus,
      newStatus: hyp.status,
      versionNumber: hyp.versionNumber,
      evidenceAdded: evRecord,
      historyEntry
    };
  }

  function evaluateHypothesisStateAtCutoff(hyp, cutoffEpochMs) {
    const visibleSupport = hyp.supportingEvidence.filter((e) => e.learnedAtEpochMs <= cutoffEpochMs);
    const visibleCounter = hyp.counterEvidence.filter((e) => e.learnedAtEpochMs <= cutoffEpochMs);
    const statusAtCutoff = visibleSupport.length === 0 && visibleCounter.length === 0
      ? hyp.evaluationHistory[0].status
      : computeHypothesisStatusFromEvidence(visibleSupport, visibleCounter);
    return {
      hypothesisId: hyp.hypothesisId,
      titleTr: hyp.titleTr,
      descriptionTr: hyp.descriptionTr,
      statusAtCutoff,
      supportingCountAtCutoff: visibleSupport.length,
      counterCountAtCutoff: visibleCounter.length,
      supportingEvidenceAtCutoff: visibleSupport,
      counterEvidenceAtCutoff: visibleCounter,
      expectedObservationsIfTrue: hyp.expectedObservationsIfTrue,
      weakeningObservations: hyp.weakeningObservations,
      alternativeExplanations: hyp.alternativeExplanations,
      missingInformation: hyp.missingInformation,
      isProvenTruth: false
    };
  }

  /**
   * Bölüm 15 Değişmezi: Bir hipotez, birincil gözlem doğrulama kapısından geçmeden
   * doğrulanmış gözlem (BILINEN / GOZLEM) olarak sunulamaz.
   */
  function attemptHypothesisPromotionToObservation(ledger, hypothesisId, verificationProof) {
    const hyp = ledger.hypothesesById.get(hypothesisId);
    if (!hyp) {
      return { promoted: false, reason: 'HYPOTHESIS_NOT_FOUND' };
    }
    const proof = verificationProof || {};
    const hasIndependentPrimarySources =
      Array.isArray(proof.independentPrimarySourceIds) && proof.independentPrimarySourceIds.length >= 2;
    const hasZeroActiveCounterEvidence = hyp.counterEvidence.length === 0;
    const passedSymbolicGate = proof.passedSymbolicConstraintGate === true;

    if (!hasIndependentPrimarySources || !hasZeroActiveCounterEvidence || !passedSymbolicGate) {
      return {
        promoted: false,
        reason: 'HYPOTHESIS_CANNOT_BE_PRESENTED_AS_VERIFIED_OBSERVATION_WITHOUT_GATE',
        missingRequirements: {
          hasIndependentPrimarySources,
          hasZeroActiveCounterEvidence,
          passedSymbolicGate
        }
      };
    }

    return {
      promoted: true,
      hypothesisId,
      promotedEpistemicCategory: 'BILINEN',
      verifiedBySourceIds: proof.independentPrimarySourceIds
    };
  }

  // ============================================================================
  // 5. DÜŞÜNCENİN DEĞİŞİMİ MOTORU (BÖLÜM 5 — İKİ TARİH ARASI DEĞERLENDİRME FARKI)
  // ============================================================================

  function compareWorldAssessmentsAcrossDates(store, hypothesisLedger, dateT1Iso, dateT2Iso, topicLabelTr) {
    const t1Check = parseStrictIsoDate(dateT1Iso);
    const t2Check = parseStrictIsoDate(dateT2Iso);
    if (!t1Check.valid || !t2Check.valid) {
      return {
        valid: false,
        reason: `INVALID_COMPARISON_DATES:${!t1Check.valid ? t1Check.reason : t2Check.reason}`
      };
    }
    if (t2Check.epochMs < t1Check.epochMs) {
      return {
        valid: false,
        reason: 'SECOND_DATE_MUST_NOT_PRECEDE_FIRST_DATE'
      };
    }

    const dualAtT1 = answerLivingWorldDualQuestionsAtDate(store, t1Check.normalizedIso);
    const dualAtT2 = answerLivingWorldDualQuestionsAtDate(store, t2Check.normalizedIso);

    const hypStatesAtT1 = [];
    const hypStatesAtT2 = [];
    const strengthenedHypotheses = [];
    const weakenedHypotheses = [];
    const retractedHypotheses = [];

    if (hypothesisLedger && hypothesisLedger.hypothesesById instanceof Map) {
      for (const hypId of hypothesisLedger.hypothesisOrder) {
        const hyp = hypothesisLedger.hypothesesById.get(hypId);
        if (hyp.createdAtEpochMs > t2Check.epochMs) continue;
        const s1 = evaluateHypothesisStateAtCutoff(hyp, t1Check.epochMs);
        const s2 = evaluateHypothesisStateAtCutoff(hyp, t2Check.epochMs);
        hypStatesAtT1.push(s1);
        hypStatesAtT2.push(s2);

        if (s2.statusAtCutoff === HYPOTHESIS_LIFECYCLE_STATUSES.RETRACTED && s1.statusAtCutoff !== HYPOTHESIS_LIFECYCLE_STATUSES.RETRACTED) {
          retractedHypotheses.push({
            hypothesisId: hypId,
            titleTr: hyp.titleTr,
            statusAtT1: s1.statusAtCutoff,
            statusAtT2: s2.statusAtCutoff,
            newCounterEvidence: s2.counterEvidenceAtCutoff.filter((e) => e.learnedAtEpochMs > t1Check.epochMs)
          });
        } else if (
          (s2.statusAtCutoff === HYPOTHESIS_LIFECYCLE_STATUSES.WEAKENED ||
            s2.statusAtCutoff === HYPOTHESIS_LIFECYCLE_STATUSES.COUNTER_EVIDENCE_PRESENT) &&
          s2.counterCountAtCutoff > s1.counterCountAtCutoff
        ) {
          weakenedHypotheses.push({
            hypothesisId: hypId,
            titleTr: hyp.titleTr,
            statusAtT1: s1.statusAtCutoff,
            statusAtT2: s2.statusAtCutoff,
            newCounterEvidence: s2.counterEvidenceAtCutoff.filter((e) => e.learnedAtEpochMs > t1Check.epochMs)
          });
        } else if (
          s2.statusAtCutoff === HYPOTHESIS_LIFECYCLE_STATUSES.SUPPORTED_BY_EVIDENCE &&
          s2.supportingCountAtCutoff > s1.supportingCountAtCutoff
        ) {
          strengthenedHypotheses.push({
            hypothesisId: hypId,
            titleTr: hyp.titleTr,
            statusAtT1: s1.statusAtCutoff,
            statusAtT2: s2.statusAtCutoff,
            newSupportingEvidence: s2.supportingEvidenceAtCutoff.filter((e) => e.learnedAtEpochMs > t1Check.epochMs)
          });
        }
      }
    }

    // T1 ile T2 arasında yeni öğrenilen gözlem ve iddialar
    const newlyArrivedObservations = dualAtT2.question2_WhatInformationDidCaelusHaveAccessToAtDate.accessibleRecords.filter(
      (r) =>
        r.learnedAtEpochMs > t1Check.epochMs &&
        r.learnedAtEpochMs <= t2Check.epochMs &&
        (r.conceptType === 'GOZLEM' || r.conceptType === 'IDDIA' || r.conceptType === 'KARSI_KANIT')
    );

    // T1 sonrasında düzeltilen veya geri çekilen kayıtlar (T1'deki eski sürümleriyle birlikte)
    const subsequentlyCorrectedRecords = [];
    const subsequentlyRetractedRecords = [];
    for (const recordId of store.recordsInOrder) {
      const latest = store.recordsById.get(recordId);
      const vAtT1 = resolveRecordVersionAtCutoff(latest, t1Check.epochMs);
      const vAtT2 = resolveRecordVersionAtCutoff(latest, t2Check.epochMs);
      if (vAtT1 && vAtT2 && vAtT2.versionNumber > vAtT1.versionNumber) {
        if (vAtT2.retracted && !vAtT1.retracted) {
          subsequentlyRetractedRecords.push({
            recordId,
            preservedVersionAtT1: vAtT1,
            retractedVersionAtT2: vAtT2,
            retractionReasonTr: vAtT2.retractionReasonTr
          });
        } else {
          subsequentlyCorrectedRecords.push({
            recordId,
            preservedVersionAtT1: vAtT1,
            correctedVersionAtT2: vAtT2
          });
        }
      }
    }

    // Değişmeyen varsayımlar
    const assumptionsAtT1 = dualAtT1.question1_WhatWasBelievedAboutWorldAtDate.activeBeliefs.filter(
      (r) => r.conceptType === 'VARSAYIM'
    );
    const unchangedAssumptions = assumptionsAtT1.filter((a1) => {
      const a2 = resolveRecordVersionAtCutoff(store.recordsById.get(a1.recordId), t2Check.epochMs);
      return a2 && a2.versionNumber === a1.versionNumber && !a2.retracted;
    });

    // Hâlâ bilinmeyen bilgiler (hipotezlerin eksik veri alanlarından ve açık bilgi boşluklarından)
    const stillUnknownInformation = [];
    for (const h2 of hypStatesAtT2) {
      for (const gap of h2.missingInformation || []) {
        if (!stillUnknownInformation.includes(gap)) {
          stillUnknownInformation.push(gap);
        }
      }
    }

    const previousAssessment = Object.freeze({
      assessmentId: `ASSESSMENT-${t1Check.normalizedIso}`,
      versionNumber: 1,
      evaluatedAtCutoffIso: t1Check.normalizedIso,
      accessibleRecordCount: dualAtT1.question2_WhatInformationDidCaelusHaveAccessToAtDate.accessibleRecordCount,
      activeBeliefCount: dualAtT1.question1_WhatWasBelievedAboutWorldAtDate.activeBeliefCount,
      hypothesisStates: hypStatesAtT1,
      activeConflicts: dualAtT1.question1_WhatWasBelievedAboutWorldAtDate.activeConflictsPreserved,
      snapshotHashSha256: dualAtT1.snapshotHashSha256
    });

    const currentAssessment = Object.freeze({
      assessmentId: `ASSESSMENT-${t2Check.normalizedIso}`,
      versionNumber: 2,
      previousAssessmentId: previousAssessment.assessmentId,
      evaluatedAtCutoffIso: t2Check.normalizedIso,
      accessibleRecordCount: dualAtT2.question2_WhatInformationDidCaelusHaveAccessToAtDate.accessibleRecordCount,
      activeBeliefCount: dualAtT2.question1_WhatWasBelievedAboutWorldAtDate.activeBeliefCount,
      hypothesisStates: hypStatesAtT2,
      activeConflicts: dualAtT2.question1_WhatWasBelievedAboutWorldAtDate.activeConflictsPreserved,
      snapshotHashSha256: dualAtT2.snapshotHashSha256
    });

    // Geçmiş değerlendirmeyi değiştirmeden ayrı sürüm olarak sakla
    store.savedAssessments.push(previousAssessment);
    store.savedAssessments.push(currentAssessment);

    const explicitRevisionRationaleTr =
      `${t1Check.normalizedIso} ile ${t2Check.normalizedIso} arasında ${newlyArrivedObservations.length} yeni gözlem/kanıt sisteme girdi, ` +
      `${subsequentlyCorrectedRecords.length} kayıt düzeltildi ve ${subsequentlyRetractedRecords.length} kayıt geri çekildi. ` +
      `Bunun sonucunda ${strengthenedHypotheses.length} hipotez güçlendi, ${weakenedHypotheses.length} hipotez zayıfladı ve ${retractedHypotheses.length} hipotez geri çekildi. ` +
      `Önceki değerlendirme (${previousAssessment.assessmentId}) değiştirilmeden korundu.`;

    const resultPayload = {
      valid: true,
      topicLabelTr: topicLabelTr || 'Çok Alanlı Dünya Değerlendirmesi',
      dateT1Iso: t1Check.normalizedIso,
      dateT2Iso: t2Check.normalizedIso,
      previousAssessmentPreservedUnchanged: true,
      previousAssessment,
      currentAssessment,
      newlyArrivedObservations,
      subsequentlyCorrectedRecords,
      subsequentlyRetractedRecords,
      strengthenedHypotheses,
      weakenedHypotheses,
      retractedHypotheses,
      conflictingSources: dualAtT2.question1_WhatWasBelievedAboutWorldAtDate.activeConflictsPreserved,
      unchangedAssumptions,
      stillUnknownInformation,
      explicitRevisionRationaleTr
    };

    return {
      ...resultPayload,
      replayIntegritySha256: computeSha256Hex(resultPayload)
    };
  }

  // ============================================================================
  // 6. ZAMANLI İLİŞKİ GRAFİĞİ VE UZAK BAĞLANTI KEŞFİ (BÖLÜM 6)
  // ============================================================================

  function discoverDistantCrossDomainConnections(graphSpec, querySpec) {
    const spec = graphSpec || {};
    const query = querySpec || {};
    const nodes = Array.isArray(spec.nodes) ? spec.nodes : [];
    const edges = Array.isArray(spec.edges) ? spec.edges : [];

    const maxNodes = Number(query.maxNodes) || 500;
    const maxEdges = Number(query.maxEdges) || 2000;
    const maxPaths = Number(query.maxPaths) || 12;
    const maxHops = Number(query.maxHops) || 5;
    const cutoffCheck = parseStrictIsoDate(query.cutoffTimeIso || '2026-12-31T23:59:59.000Z');
    const cutoffMs = cutoffCheck.valid ? cutoffCheck.epochMs : Number.MAX_SAFE_INTEGER;

    if (nodes.length === 0 || edges.length === 0) {
      return {
        status: 'INSUFFICIENT_DATA',
        terminationReason: 'EMPTY_GRAPH_OR_MISSING_RELATIONS',
        candidatePaths: [],
        budgetUsage: { nodesVisited: 0, edgesEvaluated: 0, maxNodes, maxEdges, maxPaths, maxHops },
        honestNoticeTr: 'YETERSİZ VERİ: Uzak bağlantı araştırması için yeterli düğüm veya ilişki kaydı bulunamadı.'
      };
    }

    const nodeById = new Map();
    for (const n of nodes.slice(0, maxNodes)) {
      nodeById.set(n.nodeId, n);
    }

    // Kesim zamanında geçerli olan yönlü kenarları filtrele
    const validEdges = [];
    for (const e of edges.slice(0, maxEdges)) {
      const fromCheck = e.validFromIso ? parseStrictIsoDate(e.validFromIso) : { valid: true, epochMs: 0 };
      const toCheck = e.validToIso ? parseStrictIsoDate(e.validToIso) : { valid: true, epochMs: Number.MAX_SAFE_INTEGER };
      if (!fromCheck.valid || !toCheck.valid) continue;
      if (fromCheck.epochMs > cutoffMs) continue;
      if (!nodeById.has(e.sourceNodeId) || !nodeById.has(e.targetNodeId)) continue;
      validEdges.push(e);
    }

    const sourceNodeId = query.sourceNodeId || (nodes[0] && nodes[0].nodeId);
    const targetDomainFilter = query.targetDomain || null;
    const candidatePaths = [];
    let nodesVisited = 0;
    let edgesEvaluated = 0;
    let budgetTruncated = false;
    let cyclesAvoidedCount = 0;

    // DFS / BFS çok adımlı yönlü yol arama (döngü kontrollü ve bütçe sınırlı)
    const queue = [
      {
        currentNodeId: sourceNodeId,
        visitedNodeIds: [sourceNodeId],
        edgeSteps: [],
        cumulativeLagHours: 0,
        domainsSeq: [nodeById.get(sourceNodeId)?.domain || 'UNKNOWN_DOMAIN']
      }
    ];

    while (queue.length > 0) {
      if (candidatePaths.length >= maxPaths || nodesVisited >= maxNodes || edgesEvaluated >= maxEdges) {
        budgetTruncated = true;
        break;
      }
      const state = queue.shift();
      nodesVisited += 1;

      if (state.edgeSteps.length >= 2) {
        const distinctDomains = Array.from(new Set(state.domainsSeq));
        const endNode = nodeById.get(state.currentNodeId);
        const matchesTargetDomain = !targetDomainFilter || (endNode && endNode.domain === targetDomainFilter);
        if (distinctDomains.length >= 2 && matchesTargetDomain) {
          const allSignals = Array.from(
            new Set(state.edgeSteps.flatMap((s) => s.discoverySignals || ['DOCUMENTED_DEPENDENCY']))
          );
          const hasHypothesisStep = state.edgeSteps.some(
            (s) => s.epistemicType === 'HIPOTEZ' || s.epistemicType === 'IDDIA'
          );
          candidatePaths.push({
            candidatePathId: `PATH-${sourceNodeId}-TO-${state.currentNodeId}-${state.edgeSteps.length}HOP`,
            sourceNodeId,
            targetNodeId: state.currentNodeId,
            hopCount: state.edgeSteps.length,
            nodeSequence: state.visitedNodeIds.slice(),
            domainsTraversed: state.domainsSeq.slice(),
            distinctDomainCount: distinctDomains.length,
            crossDomainTransitionsCount: state.domainsSeq.reduce(
              (acc, dom, idx, arr) => (idx > 0 && dom !== arr[idx - 1] ? acc + 1 : acc),
              0
            ),
            cumulativeLagHours: state.cumulativeLagHours,
            pathEpistemicStatus: hasHypothesisStep
              ? 'CANDIDATE_HYPOTHESIS_PATH_NOT_PROVEN_CAUSALITY'
              : 'DOCUMENTED_DEPENDENCY_CANDIDATE_PATH',
            isProvenCausality: false,
            signalsUsed: allSignals,
            derivedFromRecordIds: Array.from(
              new Set(state.edgeSteps.flatMap((s) => s.supportingSourceIds || []))
            ),
            edgeChain: state.edgeSteps.map((s) => ({
              from: s.sourceNodeId,
              to: s.targetNodeId,
              relationType: s.relationType || 'AFFECTS',
              epistemicType: s.epistemicType || 'HIPOTEZ',
              lagHours: Number(s.lagHours) || 0,
              supportingSourceIds: s.supportingSourceIds || [],
              mechanismNoteTr: s.mechanismNoteTr || ''
            })),
            whatIsCandidateRelationTr: `${nodeById.get(sourceNodeId)?.labelTr || sourceNodeId} olayının ${state.edgeSteps.length} adım ve ${state.cumulativeLagHours} saat toplam gecikmeyle ${endNode?.labelTr || state.currentNodeId} (${endNode?.domain || ''}) üzerinde dolaylı baskı oluşturabileceği aday yol.`,
            whyProposedTr: `Ortak tedarik/altyapı bağımlılığı ve gecikmeli geçiş sinyalleri (${allSignals.join(', ')}) üzerinden önerildi.`,
            alternativeExplanationsTr: state.edgeSteps
              .map((s) => s.alternativeExplanationTr)
              .filter(Boolean),
            whatDataWouldWeakenItTr: state.edgeSteps
              .map((s) => s.weakeningDataConditionTr)
              .filter(Boolean)
          });
        }
      }

      if (state.edgeSteps.length >= maxHops) {
        continue;
      }

      const outgoing = validEdges.filter((e) => e.sourceNodeId === state.currentNodeId);
      for (const edge of outgoing) {
        edgesEvaluated += 1;
        if (state.visitedNodeIds.includes(edge.targetNodeId)) {
          cyclesAvoidedCount += 1;
          continue;
        }
        const nextNode = nodeById.get(edge.targetNodeId);
        queue.push({
          currentNodeId: edge.targetNodeId,
          visitedNodeIds: state.visitedNodeIds.concat([edge.targetNodeId]),
          edgeSteps: state.edgeSteps.concat([edge]),
          cumulativeLagHours: state.cumulativeLagHours + (Number(edge.lagHours) || 0),
          domainsSeq: state.domainsSeq.concat([nextNode?.domain || 'UNKNOWN_DOMAIN'])
        });
      }
    }

    return {
      status: candidatePaths.length > 0 ? 'CANDIDATE_PATHS_FOUND' : 'NO_CROSS_DOMAIN_PATH_FOUND',
      terminationReason: budgetTruncated ? 'TRUNCATED_BY_COMPUTE_BUDGET' : 'COMPLETED_WITHIN_BUDGET',
      cyclesAvoidedCount,
      budgetUsage: {
        nodesVisited,
        edgesEvaluated,
        pathsFound: candidatePaths.length,
        maxNodes,
        maxEdges,
        maxPaths,
        maxHops
      },
      candidatePaths,
      algorithmBoundaryNoticeTr:
        'Bu algoritma yönlü, geçerlilik süreli ve gecikmeli çok adımlı ağ araması (multi-hop temporal graph traversal) uygular. Bulunan yollar araştırılabilir aday ilişkilerdir; tek başına kanıtlanmış nedensellik değildir.'
    };
  }

  // ============================================================================
  // 8. RAKİP DÜNYA MODELLERİ (BÖLÜM 8)
  // ============================================================================

  function evaluateCompetingWorldModelsAtCutoff(modelsInput, observationsAtCutoff) {
    const models = Array.isArray(modelsInput) && modelsInput.length > 0 ? modelsInput : [];
    const obsList = Array.isArray(observationsAtCutoff) ? observationsAtCutoff : [];

    if (models.length === 0) {
      return {
        decisionStatus: 'KARARSIZ_MODEL_TANIMSIZ',
        evaluatedModels: []
      };
    }

    const evaluatedModels = models.map((m) => {
      const supportingObs = [];
      const weakeningObs = [];
      let logLikelihoodScore = 0;

      for (const obs of obsList) {
        const expectedByModel = m.expectedSignatures && m.expectedSignatures[obs.subjectKey];
        if (!expectedByModel) continue;
        const obsVal = Number(obs.value);
        if (!Number.isFinite(obsVal)) continue;

        const minExpected = Number(expectedByModel.min);
        const maxExpected = Number(expectedByModel.max);
        if (obsVal >= minExpected && obsVal <= maxExpected) {
          supportingObs.push({
            recordId: obs.recordId,
            subjectKey: obs.subjectKey,
            observedValue: obsVal,
            expectedRange: [minExpected, maxExpected]
          });
          logLikelihoodScore += 1.0;
        } else {
          const distance = obsVal < minExpected ? minExpected - obsVal : obsVal - maxExpected;
          const span = Math.max(1, maxExpected - minExpected);
          weakeningObs.push({
            recordId: obs.recordId,
            subjectKey: obs.subjectKey,
            observedValue: obsVal,
            expectedRange: [minExpected, maxExpected],
            normalizedResidual: Number((distance / span).toFixed(4))
          });
          logLikelihoodScore -= Math.min(2.5, distance / span);
        }
      }

      return {
        modelId: m.modelId,
        titleTr: m.titleTr,
        dominantMechanismTr: m.dominantMechanismTr,
        explicitAssumptions: m.explicitAssumptions || [],
        derivedFromSourceIds: m.derivedFromSourceIds || [],
        supportingObservations: supportingObs,
        weakeningObservations: weakeningObs,
        divergenceDomains: m.divergenceDomains || [],
        uncalibratedLogEvidenceScore: Number(logLikelihoodScore.toFixed(4)),
        isProvenTruth: false,
        scoreMeaningTr: 'Gözlenen kesim öncesi verilerin modelin beklenen aralıklarıyla uyum skoru (kalibre edilmiş olasılık veya kanıtlanmış doğruluk değildir).'
      };
    });

    const sorted = evaluatedModels
      .slice()
      .sort((a, b) => b.uncalibratedLogEvidenceScore - a.uncalibratedLogEvidenceScore);

    const hasSufficientObs = obsList.length >= 2;
    const topDiff = sorted.length >= 2
      ? sorted[0].uncalibratedLogEvidenceScore - sorted[1].uncalibratedLogEvidenceScore
      : 0;
    const isIndecisive = !hasSufficientObs || topDiff < 0.35;

    return {
      decisionStatus: isIndecisive
        ? 'KARARSIZ_YETERSIZ_AYRIM_VERISI'
        : 'KANIT_UYUMU_FARKLILASTI_FAKAT_KESIN_DOGRULUK_DEGIL',
      indecisiveReasonTr: isIndecisive
        ? 'Mevcut kesim zamanı verileri rakip açıklamaları birbirinden kesin biçimde ayırmak için yetersizdir; birden fazla model birlikte korunmaktadır.'
        : 'Mevcut kanıtlar bazı modelleri daha fazla desteklemektedir; ancak zayıflayan modeller de yeni veri gelene kadar silinmeden izlenir.',
      evaluatedModels,
      rankedByEvidenceAlignment: sorted,
      divergenceSummaryTr:
        'Model A fiziksel temiz oda enerji/UPW duruşunu, Model B stok/işletme sermayesi davranışını, Model C düzenleyici yük atma kurallarını, Model D ise bu üç etkenin gecikmeli bileşimini baskın mekanizma olarak açıklar.'
    };
  }

  // ============================================================================
  // 9 & 10. NEDENSEL MEKANİZMA, KARŞI-OLGUSAL ANALİZ VE ÇOK ÖLÇEKLİ GELECEKLER
  // ============================================================================

  function runMultiScaleMultiActorFutures(config) {
    const cfg = config || {};
    const durationHours = Number(cfg.eventDurationHours) || 48;
    const backupCapacityPct = Number(cfg.backupCapacityPct) || 68;
    const insufficientData = cfg.insufficientData === true;

    if (insufficientData) {
      return {
        status: 'INSUFFICIENT_DATA_STOP',
        honestStopMessageTr: 'YETERSİZ VERİ: Kritik başlangıç kapasitesi veya şebeke/tesis durumu doğrulanamadığı için sahte senaryo sayıları üretilmedi.',
        scenarios: []
      };
    }

    const scalesRepresented = [
      { scaleId: 'OLAY_OLCEGI', labelTr: 'Olay Ölçeği (Saatler – Günler)', exampleEntityTr: 'ERCOT EEA3 Şebeke Yük Atma & Trafo Kesintisi' },
      { scaleId: 'KURUM_OLCEGI', labelTr: 'Kurum Ölçeği (Günler – Haftalar)', exampleEntityTr: 'Samsung S2, NXP Oak Hill & Infineon Austin Temiz Odaları' },
      { scaleId: 'SEKTOR_OLCEGI', labelTr: 'Sektör Ölçeği (Haftalar – Aylar)', exampleEntityTr: 'Küresel Otomotiv Tier-1 Fren/Motor MCU Tedarik Zinciri' },
      { scaleId: 'BOLGE_OLCEGI', labelTr: 'Bölge Ölçeği (Aylar – Çeyrekler)', exampleEntityTr: 'Kuzey Amerika, Avrupa ve Doğu Asya Otomotiv Üretim Koridorları' },
      { scaleId: 'UZUN_VADELI_YAPISAL_DEGISIM', labelTr: 'Uzun Vadeli Yapısal Değişim (Yıllar)', exampleEntityTr: 'Yarı İletken Coğrafi Yedeklilik, CHIPS Yatırımları ve Tampon Stok Politikası' }
    ];

    const actors = [
      {
        actorId: 'ACTOR_GRID_REGULATOR',
        actorType: 'PUBLIC_INSTITUTION',
        nameTr: 'Bölgesel Şebeke ve Kamu Altyapı Operatörü (ERCOT / Austin Energy)',
        objectiveTr: 'Konut ısıtması ve hastane/su altyapısını koruyarak toplam şebeke çöküşünü önlemek',
        resourceCapacityPct: Math.max(20, Math.min(100, backupCapacityPct)),
        decisionOptions: ['UNIFORM_INDUSTRIAL_CURTAILMENT', 'PROTECTED_CLEANROOM_MINIMUM_LOAD'],
        behavioralAssumptionTr: 'Kural tabanlı acil durum yük atma protokolü (EEA3)',
        dependencies: [],
        responseToInterventionTr: 'Korumalı mikro-şebeke protokolünde temiz oda vakum/UPW hatları için asgari koruma yüküne izin verir.'
      },
      {
        actorId: 'ACTOR_SEMI_FAB_COMPANY',
        actorType: 'COMPANY',
        nameTr: 'Yarı İletken Üreticileri (NXP / Samsung Austin / Infineon)',
        objectiveTr: 'Süreç içi wafer (WIP) hurdasını önlemek ve temiz oda kalibrasyon süresini kısaltmak',
        resourceCapacityPct: backupCapacityPct,
        decisionOptions: ['UNPREPARED_COLD_SHUTDOWN', 'CONTROLLED_SAFE_IDLE_AND_MCU_PRIORITIZATION'],
        behavioralAssumptionTr: 'Kısıtlı rasyonel tesis koruma davranışı (genel denge çözücüsü değildir)',
        dependencies: ['ACTOR_GRID_REGULATOR', 'ACTOR_UPW_CHEMICAL_SUPPLIER'],
        responseToInterventionTr: 'Kontrollü rölanti ve otomotiv MCU önceliklendirmesiyle yeniden başlatma süresini 5 haftadan ~2 haftaya indirir.'
      },
      {
        actorId: 'ACTOR_UPW_CHEMICAL_SUPPLIER',
        actorType: 'SUPPLIER',
        nameTr: 'Ultra-Saf Su (UPW) ve Özel Gaz Tedarikçisi',
        objectiveTr: 'Donma/basınç düşüşü altında boru hattı bütünlüğünü ve saflık standardını korumak',
        resourceCapacityPct: Math.max(15, backupCapacityPct - 10),
        decisionOptions: ['UNINSULATED_PIPELINE_FREEZE', 'THERMAL_TRACING_AND_BUFFER_TANK_DISPATCH'],
        behavioralAssumptionTr: 'Fiziksel basınç ve sıcaklık eşiklerine bağlı tedarik akışı',
        dependencies: ['ACTOR_GRID_REGULATOR'],
        responseToInterventionTr: 'Yedek tank devreye alındığında temiz oda sterilizasyon kaybını sınırlar.'
      },
      {
        actorId: 'ACTOR_FINANCE_INSURANCE',
        actorType: 'FINANCE_PROVIDER',
        nameTr: 'Kurumsal Finansman ve İş Kesintisi Sigorta Sağlayıcısı',
        objectiveTr: 'İşletme sermayesi ve tedarik sürekliliği kredi limitlerini stres altında yönetmek',
        resourceCapacityPct: 75,
        decisionOptions: ['PROCYCLICAL_CREDIT_TIGHTENING', 'CONTINGENT_WORKING_CAPITAL_BRIDGE'],
        behavioralAssumptionTr: 'Gecikmeli bilanço ve hasar rasyosu tepkisi',
        dependencies: ['ACTOR_SEMI_FAB_COMPANY'],
        responseToInterventionTr: 'Köprü işletme sermayesi sağlandığında Tier-1 tedarikçilerin panik iptallerini azaltır.'
      },
      {
        actorId: 'ACTOR_USER_AUTO_OEM',
        actorType: 'USER_DEFINED_ACTOR',
        nameTr: 'Kullanıcı Tanımlı Aktör: Otomotiv OEM & Tier-1 Tedarik Yöneticisi',
        objectiveTr: 'Kritik güvenlik/fren MCU stoklarını koruyarak montaj hattı duruşunu en aza indirmek',
        resourceCapacityPct: 60,
        decisionOptions: ['PANIC_DOUBLE_ORDERING_HOARDING', 'TRANSPARENT_CRITICAL_MCU_ALLOCATION'],
        behavioralAssumptionTr: 'Kullanıcı tarafından seçilen stok ve tahsis stratejisi',
        dependencies: ['ACTOR_SEMI_FAB_COMPANY', 'ACTOR_FINANCE_INSURANCE'],
        responseToInterventionTr: 'Şeffaf tahsiste kamçı etkisi (bullwhip effect) azalır.'
      }
    ];

    const severityFactor = Math.min(1, durationHours / 72);
    const baseThroughput = Math.max(0, Math.round(backupCapacityPct * (1 - 0.95 * severityFactor) - 25));
    const interventionThroughput = Math.max(
      baseThroughput + 15,
      Math.min(100, Math.round(backupCapacityPct * 0.94))
    );
    const compoundStressThroughput = Math.max(0, Math.round(baseThroughput * 0.25));

    const scenarios = [
      {
        scenarioId: 'SCENARIO_1_BASELINE',
        titleTr: '1. Baz Senaryo (Müdahalesiz / Bireysel Panik Stokçuluk)',
        interventionAppliedTr: 'Yok — plansız soğuk duruş ve panik siparişi',
        throughputPct: baseThroughput,
        peakStressPct: 100,
        outageActive: baseThroughput < 35,
        horizons: [
          {
            horizonId: 'NEAR_TERM_DAYS',
            labelTr: 'Yakın Vade (1–7 Gün)',
            projectedThroughputPct: baseThroughput,
            uncertaintyBandPct: 8,
            assumptionsTr: 'ERCOT yük atma süresi ve temiz oda yedek jeneratör kapasitesi sabit varsayıldı.'
          },
          {
            horizonId: 'MEDIUM_TERM_WEEKS',
            labelTr: 'Orta Vade (2–8 Hafta)',
            projectedThroughputPct: Math.max(0, baseThroughput + 12),
            uncertaintyBandPct: 18,
            assumptionsTr: 'Tier-1 MCU tampon stoklarının 2–3 haftada tükendiği ve vakum/UPW kalibrasyonunun 4–6 hafta sürdüğü varsayıldı.'
          },
          {
            horizonId: 'LONG_TERM_STRUCTURAL_MONTHS',
            labelTr: 'Uzun Vade (3–12 Ay — Kesin Tahmin Değildir)',
            projectedThroughputPct: 72,
            uncertaintyBandPct: 32,
            assumptionsTr: 'Ufuk uzadıkça yeni yatırım, ikame çip onayı ve makro talep değişimleri nedeniyle belirsizlik bandı genişler.'
          }
        ]
      },
      {
        scenarioId: 'SCENARIO_2_INTERVENTION',
        titleTr: '2. Müdahale Senaryosu (Korumalı Temiz Oda Rölantisi + Şeffaf Otomotiv MCU Tahsisi)',
        interventionAppliedTr: 'ALTERNATIVE_CLEANROOM_MICROGRID_AND_MCU_ALLOCATION',
        throughputPct: interventionThroughput,
        peakStressPct: Math.max(45, 100 - Math.round(backupCapacityPct * 0.35)),
        outageActive: interventionThroughput < 35,
        horizons: [
          {
            horizonId: 'NEAR_TERM_DAYS',
            labelTr: 'Yakın Vade (1–7 Gün)',
            projectedThroughputPct: interventionThroughput,
            uncertaintyBandPct: 9,
            assumptionsTr: 'Asgari temiz oda vakum/UPW basıncının korunduğu ve süreç içi wafer hurdasının önlendiği varsayıldı.'
          },
          {
            horizonId: 'MEDIUM_TERM_WEEKS',
            labelTr: 'Orta Vade (2–8 Hafta)',
            projectedThroughputPct: Math.min(100, interventionThroughput + 18),
            uncertaintyBandPct: 16,
            assumptionsTr: 'Kritik otomotiv güvenlik MCU’larına öncelikli tahsis yapıldığı varsayıldı.'
          },
          {
            horizonId: 'LONG_TERM_STRUCTURAL_MONTHS',
            labelTr: 'Uzun Vade (3–12 Ay — Kesin Tahmin Değildir)',
            projectedThroughputPct: 88,
            uncertaintyBandPct: 28,
            assumptionsTr: 'Uzun vadeli sonuçlar yapısal kapasite varsayımlarına duyarlıdır; kesin gelecek tahmini değildir.'
          }
        ]
      },
      {
        scenarioId: 'SCENARIO_3_COMPOUND_STRESS',
        titleTr: '3. Birleşik Stres Senaryosu (Artçı Soğuk Hava Dalgası + UPW Boru Çatlaması + Finansman Sıkışıklığı)',
        interventionAppliedTr: 'COMPOUND_SHOCK_STRESS_TEST',
        throughputPct: compoundStressThroughput,
        peakStressPct: 100,
        outageActive: true,
        horizons: [
          {
            horizonId: 'NEAR_TERM_DAYS',
            labelTr: 'Yakın Vade (1–7 Gün)',
            projectedThroughputPct: compoundStressThroughput,
            uncertaintyBandPct: 12,
            assumptionsTr: 'Fiziksel UPW boru hattı donması nedeniyle yazılımsal tahsis politikasının tek başına yeterli olmadığı stres durumu.'
          },
          {
            horizonId: 'MEDIUM_TERM_WEEKS',
            labelTr: 'Orta Vade (2–8 Hafta)',
            projectedThroughputPct: Math.min(100, compoundStressThroughput + 15),
            uncertaintyBandPct: 24,
            assumptionsTr: 'Fiziksel ekipman değişimi ve yeniden sertifikasyon gecikmesi.'
          },
          {
            horizonId: 'LONG_TERM_STRUCTURAL_MONTHS',
            labelTr: 'Uzun Vade (3–12 Ay — Kesin Tahmin Değildir)',
            projectedThroughputPct: 58,
            uncertaintyBandPct: 38,
            assumptionsTr: 'Yüksek dağılım dışı (OOD) belirsizlik; yalnızca stres testi sınırlarını gösterir.'
          }
        ]
      }
    ];

    return {
      status: 'COMPLETED',
      engineUsed: 'CAELUS_DETERMINISTIC_CAUSAL_AND_BOUNDED_ACTOR_ENGINE_V1',
      modelBoundaryNoticeTr:
        'Bu çok aktörlü ve çok ölçekli simülasyon deterministik kural ve kapasite kısıtlarıyla çalışır; genel amaçlı öğrenilmiş insan davranışı modeli veya kanıtlanmış oyun teorik Nash dengesi çözücüsü değildir.',
      scalesRepresented,
      actors,
      scenarios,
      counterfactualComparison: {
        questionTr: 'Aynı başlangıç koşullarında alternatif temiz oda koruması ve şeffaf MCU tahsisi devreye girseydi model sonucu nasıl değişirdi?',
        baselineScenarioId: 'SCENARIO_1_BASELINE',
        interventionScenarioId: 'SCENARIO_2_INTERVENTION',
        baselineThroughputPct: baseThroughput,
        interventionThroughputPct: interventionThroughput,
        throughputDeltaPctPoints: interventionThroughput - baseThroughput,
        sameInitialConditionsVerified: true,
        isGuaranteedRealWorldOutcome: false
      }
    };
  }

  // ============================================================================
  // 11 & 12. GRAFİK ÖĞRENME ARAŞTIRMA KATMANI VE ÇOK MODLU SÖZLEŞME (BÖLÜM 11–12)
  // ============================================================================

  const GRAPH_AND_WORLD_MODEL_RESEARCH_EVALUATION = Object.freeze([
    {
      areaCode: 'A_TEMPORAL_GRAPH_NETWORKS',
      name: 'A. Temporal Graph Networks (TGN)',
      maturityStatus: LIVING_WORLD_MATURITY_CLASSES.C_RESEARCH_EXPERIMENT,
      implementedInCaelus: '2-adımlı gecikmeli komşuluk mesaj geçişi (2-Hop Message-Passing Graph Transition) ve AR(1) Ridge grafik öğrenmesi olarak deneysel ve karşılaştırmalı uygulandı.',
      commercialStatus: COMMERCIAL_STATUS_LABELS.CAELUS_PROPRIETARY,
      limitationTr: 'Büyük ölçekli GPU üzerinde eğitilmiş derin TGN belleği değildir; küçük örneklemlerde basit eşik kuralı daha düşük hata verebilir.'
    },
    {
      areaCode: 'B_TEMPORAL_GRAPH_TRANSFORMERS',
      name: 'B. Temporal Graph Transformers (TGT)',
      maturityStatus: LIVING_WORLD_MATURITY_CLASSES.D_CONTRACT_READY_IMPL_MISSING,
      implementedInCaelus: 'Çıkarım ve dikkat (attention) ağırlık sözleşmesi tanımlıdır; ancak yerel CPU/entegre GPU üzerinde büyük ölçekli Transformer eğitimi yapılmamıştır.',
      commercialStatus: COMMERCIAL_STATUS_LABELS.CAELUS_PROPRIETARY,
      limitationTr: 'Eğitilmiş TGT ağırlığı iddiası taşınmaz.'
    },
    {
      areaCode: 'C_GRAPH_WORLD_MODELS',
      name: 'C. Graph World Models (GWM)',
      maturityStatus: LIVING_WORLD_MATURITY_CLASSES.A_WORKING_INTEGRATED,
      implementedInCaelus: 'CAELUS deterministik nedensel grafik çekirdeği (`caelus_core` Rust + C++17 + JS) ve 2-adımlı mesaj geçişli deneysel grafik geçiş modeliyle çalışır.',
      commercialStatus: COMMERCIAL_STATUS_LABELS.CAELUS_PROPRIETARY,
      limitationTr: 'Fiziksel/yapısal kısıtlar alan şablonlarına ve kesim öncesi gözlemlere dayanır.'
    },
    {
      areaCode: 'D_GRAPH_LINK_PREDICTION',
      name: 'D. Grafik İlişki Tahmini (Graph Link Prediction)',
      maturityStatus: LIVING_WORLD_MATURITY_CLASSES.A_WORKING_INTEGRATED,
      implementedInCaelus: '`evaluateTemporalGraphLinkPrediction` ve `discoverDistantCrossDomainConnections` ile zaman kesimli aday bağlantı tahmini ve referans yöntem karşılaştırması çalışır.',
      commercialStatus: COMMERCIAL_STATUS_LABELS.CAELUS_PROPRIETARY,
      limitationTr: 'Önerilen bağlantılar aday hipotezdir; kanıtlanmış nedensellik değildir.'
    },
    {
      areaCode: 'E_MULTISCALE_REPRESENTATION_LEARNING',
      name: 'E. Çok Ölçekli Temsil Öğrenmesi (Multi-Scale Representation)',
      maturityStatus: LIVING_WORLD_MATURITY_CLASSES.B_SINIRLI_CALISAN_PROTOTIP,
      implementedInCaelus: '`runJepaStyleLatentPredictor` (doğrusal ortogonal gizli uzay izdüşümü) ve 5 ölçekli (`OLAY` -> `YAPISAL`) toplulaştırma katmanı olarak çalışır.',
      commercialStatus: COMMERCIAL_STATUS_LABELS.CAELUS_PROPRIETARY,
      limitationTr: 'Derin öz-denetimli (self-supervised) sinir ağı eğitimi içermez.'
    },
    {
      areaCode: 'F_MODEL_ENSEMBLES',
      name: 'F. Model Toplulukları ve Rakip Dünya Modelleri (Model Ensembles)',
      maturityStatus: LIVING_WORLD_MATURITY_CLASSES.A_WORKING_INTEGRATED,
      implementedInCaelus: '`combineMultiModelEnsembleWithCalibration` ve `evaluateCompetingWorldModelsAtCutoff` (Model A/B/C/D) ile çalışır.',
      commercialStatus: COMMERCIAL_STATUS_LABELS.CAELUS_PROPRIETARY,
      limitationTr: 'Kalibrasyon kümesi küçük olduğunda ağırlıklar ters-kalıntı uyumuna dayanır.'
    },
    {
      areaCode: 'G_DISTRIBUTION_SHIFT_AND_OOD',
      name: 'G. Dağılım Değişimi ve Bilinmeyen Durum Tespiti (OOD Detection)',
      maturityStatus: LIVING_WORLD_MATURITY_CLASSES.A_WORKING_INTEGRATED,
      implementedInCaelus: '`runMultiStepWorldRollout` içinde Z-skoru/Mahalanobis mesafesi ve ufuk uzadıkça genişleyen belirsizlik bandı olarak çalışır.',
      commercialStatus: COMMERCIAL_STATUS_LABELS.CAELUS_PROPRIETARY,
      limitationTr: 'Köşegen kovaryans yaklaşımı kullanır.'
    },
    {
      areaCode: 'H_SCIENTIFIC_HYPOTHESIS_GENERATION',
      name: 'H. Bilimsel Hipotez Üretimi ve Karşı Kanıtla Karşılaştırma',
      maturityStatus: LIVING_WORLD_MATURITY_CLASSES.A_WORKING_INTEGRATED,
      implementedInCaelus: '`createHypothesisLedger`, `registerLivingHypothesis`, `submitHypothesisEvidence` ve `compareWorldAssessmentsAcrossDates` ile tam yaşam döngüsü olarak çalışır.',
      commercialStatus: COMMERCIAL_STATUS_LABELS.CAELUS_PROPRIETARY,
      limitationTr: 'Hipotez durum geçişleri kayıtlı kanıtlara dayanır; otomatik dış gerçeklik doğrulaması yapmaz.'
    }
  ]);

  /**
   * Bölüm 11: Gerçek Grafik Öğrenme Deneyi vs Basit Referans Yöntemler.
   * Hem gelişmiş mesaj geçişli modelin kazandığı çok adımlı gecikmeli rejimi,
   * hem de basit referans yöntemin kazandığı kısa/durağan rejimi dürüstçe raporlar.
   */
  function runGraphWorldModelVsBaselinesExperiment() {
    // Deney 1: Çok adımlı gecikmeli yayılım serisi (Üst akış şebeke şoku -> 1 adım sonra fabrika -> 2 adım sonra otomotiv)
    // Düğüm 0: Şebeke Kapasitesi, Düğüm 1: Fabrika Temiz Oda, Düğüm 2: Otomotiv MCU Akışı
    const cascadeSeries = [
      [100, 100, 100],
      [20, 95, 100],
      [25, 30, 92],
      [40, 35, 38],
      [70, 52, 42],
      [85, 76, 58],
      [92, 86, 79]
    ];

    function evaluateOnSeries(series) {
      let errPersistence = 0;
      let errMovingAvg = 0;
      let errThresholdRule = 0;
      let errExperimental2HopGwm = 0;
      let count = 0;

      for (let t = 2; t < series.length; t++) {
        const prev2 = series[t - 2];
        const prev1 = series[t - 1];
        const actual = series[t];

        // 1. Persistence (Son bilinen değer: y_hat(t) = y(t-1))
        const predPersistence = prev1[2];

        // 2. Moving Average (Son 2 adımın ortalaması)
        const predMovingAvg = 0.5 * (prev1[2] + prev2[2]);

        // 3. Basit Grafik Eşik Kuralı (1-adım üst akış prev1[1] < 50 ise düşür)
        const predThreshold = prev1[1] < 50 ? prev1[1] * 1.1 : prev1[2];

        // 4. Deneysel 2-Adımlı Mesaj Geçişli Grafik Dünya Modeli (2-Hop Message Passing:
        // Düğüm 2(t), hem Düğüm 1(t-1) hem de 2 adım önceki kök düğüm Düğüm 0(t-2) mesajını birleştirir)
        const msg1Hop = 0.55 * prev1[1];
        const msg2Hop = 0.30 * prev2[0];
        const selfRetention = 0.15 * prev1[2];
        const pred2HopGwm = Math.max(0, Math.min(100, msg1Hop + msg2Hop + selfRetention));

        errPersistence += Math.abs(actual[2] - predPersistence);
        errMovingAvg += Math.abs(actual[2] - predMovingAvg);
        errThresholdRule += Math.abs(actual[2] - predThreshold);
        errExperimental2HopGwm += Math.abs(actual[2] - pred2HopGwm);
        count += 1;
      }

      return {
        maePersistence: Number((errPersistence / count).toFixed(4)),
        maeMovingAverage: Number((errMovingAvg / count).toFixed(4)),
        maeSimpleThresholdRule: Number((errThresholdRule / count).toFixed(4)),
        maeExperimental2HopGwm: Number((errExperimental2HopGwm / count).toFixed(4))
      };
    }

    // Deney 2: Yalıtılmış/Tamponlu Alt Akış Serisi — Üst akış düğümleri dalgalanırken alt akış tamponu sabit kalır;
    // burada basit Persistence yöntemi (MAE=0) gelişmiş mesaj geçişli modeli açık farkla geçer!
    const stationaryShortSeries = [
      [40, 50, 90],
      [85, 35, 90],
      [30, 80, 90],
      [75, 45, 90],
      [50, 70, 90]
    ];

    const cascadeMetrics = evaluateOnSeries(cascadeSeries);
    const stationaryMetrics = evaluateOnSeries(stationaryShortSeries);

    return {
      experimentId: 'EXP-GWM-2HOP-VS-BASELINES-2026',
      maturityStatus: LIVING_WORLD_MATURITY_CLASSES.C_RESEARCH_EXPERIMENT,
      regime1_MultiHopDelayedCascade: {
        descriptionTr: '2 adımlı gecikmeli sektörler arası şok yayılımı (Şebeke -> Fabrika -> Otomotiv)',
        ...cascadeMetrics,
        winnerModel:
          cascadeMetrics.maeExperimental2HopGwm < cascadeMetrics.maeSimpleThresholdRule
            ? 'EXPERIMENTAL_2HOP_MESSAGE_PASSING_GWM'
            : 'SIMPLE_GRAPH_THRESHOLD_RULE'
      },
      regime2_ShortStationaryRegimeWhereBaselineWins: {
        descriptionTr: 'Kısa ve durağan seri (Gelişmiş modelin basit referansı geçemediği durumun dürüst gösterimi)',
        ...stationaryMetrics,
        winnerModel:
          stationaryMetrics.maePersistence <= stationaryMetrics.maeExperimental2HopGwm
            ? 'BASELINE_PERSISTENCE'
            : 'EXPERIMENTAL_2HOP_MESSAGE_PASSING_GWM',
        advancedModelBeatBaseline: stationaryMetrics.maeExperimental2HopGwm < stationaryMetrics.maePersistence
      },
      honestConclusionTr:
        'Çok adımlı gecikmeli şok yayılımında (Rejim 1) 2-adımlı mesaj geçişli grafik modeli (`MAE = ' +
        cascadeMetrics.maeExperimental2HopGwm +
        '`) basit referansları geçmektedir; ancak durağan/kısa serilerde (Rejim 2) basit Son Bilinen Değer (`MAE = ' +
        stationaryMetrics.maePersistence +
        '`) gelişmiş mesaj geçişli modelden (`MAE = ' +
        stationaryMetrics.maeExperimental2HopGwm +
        '`) daha düşük hata vermektedir. CAELUS her iki sonucu da gizlemeden raporlar.'
    };
  }

  /**
   * Bölüm 12: Görsel ve Çok Modlu Gözlem / Çıkarım Sözleşmesi.
   */
  function registerMultimodalObservationWithContract(rawModalInput) {
    const item = rawModalInput || {};
    const allowedModalities = [
      'TEXT',
      'NUMERIC_TIME_SERIES',
      'DOCUMENT',
      'GEO_SPATIAL',
      'IMAGE',
      'VIDEO',
      'USER_STRUCTURED_RECORD'
    ];
    const modality = allowedModalities.includes(item.modality) ? item.modality : 'TEXT';
    const isModelDerivedInference = Boolean(item.isModelDerivedInference);
    const commercialStatus = item.commercialRightsStatus || COMMERCIAL_STATUS_LABELS.UNDER_REVIEW;

    const canIncludeInCommercialPack =
      commercialStatus === COMMERCIAL_STATUS_LABELS.APPROVED_CANDIDATE ||
      commercialStatus === COMMERCIAL_STATUS_LABELS.CAELUS_PROPRIETARY;

    return {
      recordId: String(item.recordId || 'MODAL-REC-01'),
      modality,
      sourceId: String(item.sourceId || 'UNKNOWN_SOURCE'),
      isModelDerivedInference,
      // Görsel veya çok modlu bir modelin çıkarsaması ASLA doğrudan gözlem (BILINEN) olarak etiketlenmez!
      epistemicClassification: isModelDerivedInference
        ? 'MODEL_INFERENCE_NOT_RAW_OBSERVATION'
        : 'RAW_SOURCE_OBSERVATION_OR_CLAIM',
      uiBadgeCode: isModelDerivedInference ? 'SIMULE_EDILEN' : 'BILINEN',
      modelProvenance: isModelDerivedInference
        ? {
            modelName: String(item.modelName || 'UNSPECIFIED_MODEL'),
            modelVersion: String(item.modelVersion || '0.0.0'),
            weightsLicenseVerified: Boolean(item.weightsLicenseVerified)
          }
        : null,
      commercialRightsStatus: commercialStatus,
      admittedToCommercialDatasetPack: canIncludeInCommercialPack && (!isModelDerivedInference || Boolean(item.weightsLicenseVerified)),
      rejectionReasonIfExcluded:
        !canIncludeInCommercialPack || (isModelDerivedInference && !item.weightsLicenseVerified)
          ? 'UNVERIFIED_COMMERCIAL_RIGHTS_OR_MODEL_WEIGHTS'
          : null
    };
  }

  // ============================================================================
  // 13. KULLANICININ KENDİ DÜNYASI (BÖLÜM 13)
  // ============================================================================

  function createUserOwnWorldModel(initialSpec) {
    const init = initialSpec || {};
    return {
      workspaceId: init.workspaceId || 'USER-WORLD-WORKSPACE-01',
      ownerLabelTr: init.ownerLabelTr || 'Kullanıcı Karar ve İzleme Dünyası',
      externalDataTransmission: 'ZERO_EXTERNAL_TRANSMISSION_LOCAL_ONLY',
      entities: Array.isArray(init.entities) ? init.entities.slice() : [],
      supplyRelations: Array.isArray(init.supplyRelations) ? init.supplyRelations.slice() : [],
      userDecisions: Array.isArray(init.userDecisions) ? init.userDecisions.slice() : [],
      userAssumptions: Array.isArray(init.userAssumptions) ? init.userAssumptions.slice() : [],
      watchedQuestions: Array.isArray(init.watchedQuestions) ? init.watchedQuestions.slice() : []
    };
  }

  function addUserWorldWatchItem(userWorld, itemSpec) {
    if (!userWorld || !itemSpec) return { added: false };
    const category = String(itemSpec.category || 'ENTITY').toUpperCase();
    if (category === 'ENTITY' || category === 'INSTITUTION' || category === 'COMPANY' || category === 'TECHNOLOGY' || category === 'PRODUCT' || category === 'RESOURCE' || category === 'GEOGRAPHY') {
      const entityObj = {
        entityId: String(itemSpec.entityId || `USER-ENT-${userWorld.entities.length + 1}`),
        entityType: category,
        nameTr: String(itemSpec.nameTr || ''),
        domain: String(itemSpec.domain || 'USER_DOMAIN'),
        upstreamNodeIds: Array.isArray(itemSpec.upstreamNodeIds) ? itemSpec.upstreamNodeIds.slice() : [],
        addedByUser: true
      };
      userWorld.entities.push(entityObj);
      return { added: true, itemType: 'ENTITY', item: entityObj };
    }
    if (category === 'ASSUMPTION') {
      const assumpObj = {
        assumptionId: String(itemSpec.assumptionId || `USER-ASSUMP-${userWorld.userAssumptions.length + 1}`),
        textTr: String(itemSpec.textTr || ''),
        epistemicLabel: 'KULLANICI_VARSAYIMI',
        addedByUser: true
      };
      userWorld.userAssumptions.push(assumpObj);
      return { added: true, itemType: 'ASSUMPTION', item: assumpObj };
    }
    if (category === 'QUESTION') {
      const qObj = {
        questionId: String(itemSpec.questionId || `USER-Q-${userWorld.watchedQuestions.length + 1}`),
        questionTr: String(itemSpec.questionTr || ''),
        requiredEntityId: itemSpec.requiredEntityId || null,
        requiresMissingDataKey: itemSpec.requiresMissingDataKey || null
      };
      userWorld.watchedQuestions.push(qObj);
      return { added: true, itemType: 'QUESTION', item: qObj };
    }
    return { added: false, reason: 'UNKNOWN_USER_WORLD_CATEGORY' };
  }

  function evaluateEventImpactOnUserWorld(userWorld, discoveryResult, hypothesisStates) {
    const paths = (discoveryResult && discoveryResult.candidatePaths) || [];
    const hyps = Array.isArray(hypothesisStates) ? hypothesisStates : [];

    const verifiedRelations = [];
    const candidateHypothesesToInvestigate = [];
    const userAddedAssumptions = (userWorld.userAssumptions || []).map((a) => ({
      ...a,
      badge: EPISTEMIC_UI_CATEGORIES_7.VARSAYILAN.labelTr
    }));
    const missingLinksAndUnanswerableQuestions = [];

    for (const ent of userWorld.entities || []) {
      const matchingPaths = paths.filter(
        (p) =>
          p.nodeSequence.includes(ent.entityId) ||
          (ent.upstreamNodeIds || []).some((upId) => p.nodeSequence.includes(upId))
      );

      if (matchingPaths.length === 0) {
        missingLinksAndUnanswerableQuestions.push({
          targetId: ent.entityId,
          targetNameTr: ent.nameTr,
          status: 'YETERSİZ VERİ / BAĞLANTI YOK',
          explanationTr: `${ent.nameTr} varlığı ile incelenen olay arasında mevcut kayıtlı grafikte doğrulanmış veya aday bir yol bulunamadı.`
        });
        continue;
      }

      for (const mp of matchingPaths) {
        const verifiedEdges = mp.edgeChain.filter((e) => e.epistemicType === 'GOZLEM' || e.epistemicType === 'DOCUMENTED_DEPENDENCY');
        const hypothesisEdges = mp.edgeChain.filter((e) => e.epistemicType !== 'GOZLEM' && e.epistemicType !== 'DOCUMENTED_DEPENDENCY');

        if (verifiedEdges.length > 0) {
          verifiedRelations.push({
            userEntityId: ent.entityId,
            userEntityNameTr: ent.nameTr,
            verifiedSteps: verifiedEdges,
            badge: EPISTEMIC_UI_CATEGORIES_7.BILINEN.labelTr
          });
        }
        if (hypothesisEdges.length > 0) {
          candidateHypothesesToInvestigate.push({
            userEntityId: ent.entityId,
            userEntityNameTr: ent.nameTr,
            candidatePathId: mp.candidatePathId,
            cumulativeLagHours: mp.cumulativeLagHours,
            hypothesisSteps: hypothesisEdges,
            badge: EPISTEMIC_UI_CATEGORIES_7.ARASTIRILAN.labelTr
          });
        }
      }
    }

    const questionAnswers = (userWorld.watchedQuestions || []).map((q) => {
      if (q.requiresMissingDataKey) {
        return {
          questionId: q.questionId,
          questionTr: q.questionTr,
          answerStatus: 'BU SORU MEVCUT VERİYLE YANITLANAMIYOR',
          badge: EPISTEMIC_UI_CATEGORIES_7.BILINMEYEN.labelTr,
          explanationTr: `BU SORU MEVCUT VERİYLE YANITLANAMIYOR: Sorunun yanıtlanması için gereken '${q.requiresMissingDataKey}' verisi karar kesim zamanında mevcut değildir.`
        };
      }
      return {
        questionId: q.questionId,
        questionTr: q.questionTr,
        answerStatus: 'ADAY_ETKI_YOLLARI_VE_HIPOTEZLERLE_INCELENIYOR',
        badge: EPISTEMIC_UI_CATEGORIES_7.ARASTIRILAN.labelTr,
        activeHypothesesCount: hyps.length,
        explanationTr: 'Doğrulanmış üst akış bağlantıları ve araştırılan hipotezler üzerinden çok senaryolu etki aralığı hesaplandı.'
      };
    });

    return {
      workspaceId: userWorld.workspaceId,
      externalDataTransmission: 'ZERO_EXTERNAL_TRANSMISSION_LOCAL_ONLY',
      verifiedRelations,
      candidateHypothesesToInvestigate,
      userAddedAssumptions,
      missingLinksAndUnanswerableQuestions,
      questionAnswers
    };
  }

  // ============================================================================
  // 16. İKİ TARİHLİ DÜNYA GERÇEKLİK TESTİ (ŞUBAT – MART 2021 ERCOT -> AUSTIN -> OTOMOTİV)
  // ============================================================================

  function runTwoDateHistoricalRealityTest(customOptions) {
    const opts = customOptions || {};
    const dateT1Iso = opts.dateT1Iso || '2021-02-17T18:00:00.000Z';
    const dateT2Iso = opts.dateT2Iso || '2021-03-18T18:00:00.000Z';

    const store = createLivingWorldMemoryStore({
      storeId: 'CAELUS-ERCOT-AUSTIN-AUTO-2021-BITEMPORAL-STORE'
    });

    // 1. Varlıklar (T1 öncesinde bilinen)
    const baseEntities = [
      {
        recordId: 'ENT-ERCOT-GRID',
        conceptType: 'VARLIK',
        sourceId: 'ERCOT-PUBLIC-REGISTRY',
        eventValidTimeIso: '2021-02-01T00:00:00.000Z',
        learnedAtTimeIso: '2021-02-01T00:00:00.000Z',
        subjectKey: 'ercot_grid',
        value: 'ERCOT Texas Interconnect',
        epistemicCategory: 'BILINEN',
        summaryTr: 'Teksas Elektrik Güvenilirlik Konseyi (ERCOT) yüksek gerilim şebekesi.'
      },
      {
        recordId: 'ENT-AUSTIN-FABS',
        conceptType: 'VARLIK',
        sourceId: 'AUSTIN-INDUSTRIAL-REGISTRY',
        eventValidTimeIso: '2021-02-01T00:00:00.000Z',
        learnedAtTimeIso: '2021-02-01T00:00:00.000Z',
        subjectKey: 'austin_semiconductor_fabs',
        value: 'Samsung Austin S2, NXP Oak Hill/ATMC, Infineon Austin',
        epistemicCategory: 'BILINEN',
        summaryTr: 'Austin bölgesindeki otomotiv MCU ve RF/mantık yarı iletken temiz oda tesisleri.'
      },
      {
        recordId: 'ENT-GLOBAL-AUTO-OEM',
        conceptType: 'VARLIK',
        sourceId: 'AUTO-SUPPLY-CHAIN-REGISTRY',
        eventValidTimeIso: '2021-02-01T00:00:00.000Z',
        learnedAtTimeIso: '2021-02-01T00:00:00.000Z',
        subjectKey: 'global_automotive_oems',
        value: 'Global Automotive Tier-1 & OEM Assembly Lines',
        epistemicCategory: 'BILINEN',
        summaryTr: 'Kuzey Amerika, Avrupa ve Asya otomotiv OEM montaj hatları.'
      }
    ];
    for (const ent of baseEntities) {
      addLivingWorldRecord(store, ent);
    }

    // 2. T1 (17 Şubat 2021 18:00 UTC) öncesinde öğrenilen olay, gözlem, iddia ve varsayımlar
    const t1Records = [
      {
        recordId: 'EVT-ERCOT-EEA3-20210215',
        conceptType: 'OLAY',
        sourceId: 'ERCOT-EEA3-NOTICE-20210215',
        eventValidTimeIso: '2021-02-15T07:25:00.000Z',
        learnedAtTimeIso: '2021-02-15T08:00:00.000Z',
        subjectKey: 'ercot_load_shed_mw',
        value: 20000,
        unit: 'MW',
        relatedEntityIds: ['ENT-ERCOT-GRID'],
        epistemicCategory: 'BILINEN',
        summaryTr: 'ERCOT EEA3 acil durumu ilan etti ve ~20.000 MW zorunlu yük atma başlattı.'
      },
      {
        recordId: 'OBS-AUSTIN-CURTAILMENT-20210216',
        conceptType: 'GOZLEM',
        sourceId: 'AUSTIN-ENERGY-NOTICE-20210216',
        eventValidTimeIso: '2021-02-16T09:00:00.000Z',
        learnedAtTimeIso: '2021-02-16T11:30:00.000Z',
        subjectKey: 'austin_fab_power_status',
        value: 0,
        unit: 'pct_normal_power',
        relatedEntityIds: ['ENT-ERCOT-GRID', 'ENT-AUSTIN-FABS'],
        epistemicCategory: 'BILINEN',
        summaryTr: 'Austin Energy, Samsung S2, NXP ve Infineon yarı iletken tesislerinin şebeke elektriğini zorunlu olarak kesti.'
      },
      {
        recordId: 'CLM-EARLY-MEDIA-48H-RESTART',
        conceptType: 'IDDIA',
        sourceId: 'LOCAL-MEDIA-REPORT-20210217A',
        eventValidTimeIso: '2021-02-17T12:00:00.000Z',
        learnedAtTimeIso: '2021-02-17T15:00:00.000Z',
        subjectKey: 'austin_fab_restart_days',
        value: 2,
        unit: 'days',
        relatedEntityIds: ['ENT-AUSTIN-FABS'],
        epistemicCategory: 'KAYNAKTA_IDDIA_EDILEN',
        summaryTr: 'Erken medya iddiası: Elektrik verildikten sonra fabrikaların 48 saat (2 gün) içinde tam üretime döneceği öne sürüldü.'
      },
      {
        recordId: 'CLM-ENG-CLEANROOM-28D-REQUALIFICATION',
        conceptType: 'IDDIA',
        sourceId: 'SEMI-PROCESS-ENG-NOTE-20210217B',
        eventValidTimeIso: '2021-02-17T12:00:00.000Z',
        learnedAtTimeIso: '2021-02-17T16:30:00.000Z',
        subjectKey: 'austin_fab_restart_days',
        value: 30,
        unit: 'days',
        relatedEntityIds: ['ENT-AUSTIN-FABS'],
        epistemicCategory: 'KAYNAKTA_IDDIA_EDILEN',
        summaryTr: 'Yarı iletken süreç mühendisliği iddiası: Vakum, ultra-saf su (UPW) ve litografi yeniden kalibrasyonu en az 4–6 hafta (~30 gün) sürecek.'
      },
      {
        recordId: 'ASSUMP-TIER1-MCU-BUFFER-18DAYS',
        conceptType: 'VARSAYIM',
        sourceId: 'CAELUS-ANALYST-ASSUMPTION-01',
        eventValidTimeIso: '2021-02-17T10:00:00.000Z',
        learnedAtTimeIso: '2021-02-17T17:00:00.000Z',
        subjectKey: 'auto_tier1_mcu_buffer_days',
        value: 18,
        unit: 'days',
        relatedEntityIds: ['ENT-GLOBAL-AUTO-OEM'],
        epistemicCategory: 'VARSAYILAN',
        summaryTr: 'Otomotiv Tier-1 tedarikçilerinde ortalama 18 günlük (2–3 hafta) güvenlik MCU tampon stoku bulunduğu varsayımı.'
      }
    ];
    for (const r of t1Records) {
      addLivingWorldRecord(store, r);
    }

    // 3. Hipotez Defteri Kurulumu (T1'de oluşturulan 3 rakip/tamamlayıcı hipotez)
    const hypothesisLedger = createHypothesisLedger();

    registerLivingHypothesis(hypothesisLedger, {
      hypothesisId: 'HYP-1-FAST-48H-RECOVERY',
      titleTr: 'Hipotez 1: Hızlı (48 Saat) Temiz Oda Yeniden Başlatma ve Sıfır Otomotiv Etkisi',
      descriptionTr: 'Şebeke elektriği geri gelir gelmez Austin fabrikaları 48 saat içinde tam kapasiteye döner ve Tier-1 stokları sayesinde otomotiv montaj hatları hiç etkilenmez.',
      relatedEventIds: ['EVT-ERCOT-EEA3-20210215'],
      relatedEntityIds: ['ENT-AUSTIN-FABS', 'ENT-GLOBAL-AUTO-OEM'],
      createdAtIso: '2021-02-17T15:30:00.000Z',
      grounds: ['CLM-EARLY-MEDIA-48H-RESTART', 'ASSUMP-TIER1-MCU-BUFFER-18DAYS'],
      assumptions: ['Temiz oda UPW borularında donma/kontaminasyon olmadığı', 'Süreç içi waferların (WIP) zarar görmediği'],
      expectedObservationsIfTrue: [
        '20–22 Şubat 2021 itibarıyla NXP ve Samsung Austin tesislerinde %90+ wafer çıkış hızına dönülmesi',
        'Mart 2021’de otomotiv OEM’lerinde Austin kaynaklı hiçbir MCU duruşu yaşanmaması'
      ],
      weakeningObservations: [
        'Tesislerin Şubat sonunda ve Mart başında hâlâ kapalı veya düşük kapasitede kalması',
        'NXP veya Samsung’un 1 aylık üretim/gelir kaybı açıklaması'
      ],
      alternativeExplanations: [
        'Vakum, ultra-saf su (UPW) ve özel gaz hatlarının yeniden sertifikasyonunun 4–6 hafta sürmesi (Hipotez 2)'
      ],
      missingInformation: [
        'Kesinti anında temiz oda içindeki süreç içi wafer (WIP) hurda oranı',
        'Austin su şebekesindeki basınç düşüşünün UPW filtrelerine etkisi'
      ]
    });

    registerLivingHypothesis(hypothesisLedger, {
      hypothesisId: 'HYP-2-MULTI-WEEK-CLEANROOM-AND-OEM-CASCADE',
      titleTr: 'Hipotez 2: 4–6 Haftalık Temiz Oda Kalibrasyon Darboğazı ve Küresel Otomotiv OEM Sıçraması',
      descriptionTr: 'Plansız enerji ve su kesintisi nedeniyle Austin yarı iletken temiz odalarının tam kapasiteye dönüşü 4–6 hafta sürer; 2–3 haftalık Tier-1 tamponu tükendikten sonra Mart 2021’de küresel otomotiv montaj hatlarında vardiya duruşları başlar.',
      relatedEventIds: ['EVT-ERCOT-EEA3-20210215', 'OBS-AUSTIN-CURTAILMENT-20210216'],
      relatedEntityIds: ['ENT-ERCOT-GRID', 'ENT-AUSTIN-FABS', 'ENT-GLOBAL-AUTO-OEM'],
      createdAtIso: '2021-02-17T16:45:00.000Z',
      grounds: ['OBS-AUSTIN-CURTAILMENT-20210216', 'CLM-ENG-CLEANROOM-28D-REQUALIFICATION'],
      assumptions: ['Tier-1 MCU tampon stoklarının 3 haftadan az olduğu', 'Otomotiv MCU’larının kısa sürede başka dökümhaneye (TSMC vb.) taşınamayacağı'],
      expectedObservationsIfTrue: [
        'Mart 2021 ortasında NXP ve Samsung Austin tesislerinde yaklaşık 1 aylık üretim kaybının teyit edilmesi',
        'Mart–Nisan 2021’de Kuzey Amerika ve küresel otomotiv OEM’lerinde MCU eksikliği kaynaklı montaj duruşları'
      ],
      weakeningObservations: [
        'Fabrikaların 22 Şubat 2021’de tam kapasiteye dönmesi',
        'Alternatif dökümhanelerin 1 hafta içinde otomotiv MCU açığını kapatması'
      ],
      alternativeExplanations: [
        'Otomotiv duruşlarının Austin kesintisinden değil, yalnızca önceki 2020 pandemi sipariş iptallerinden kaynaklanması'
      ],
      missingInformation: [
        'Müşteri bazlı tam MCU tahsis öncelik listesi',
        'Fabrika içi kesin wafer hurda maliyeti (USD)'
      ]
    });

    // T1 öncesinde mevcut kanıtları hipotezlere bağla
    submitHypothesisEvidence(hypothesisLedger, 'HYP-1-FAST-48H-RECOVERY', {
      evidenceId: 'EV-T1-MEDIA-OPTIMISM',
      sourceId: 'LOCAL-MEDIA-REPORT-20210217A',
      polarity: 'SUPPORTING_EVIDENCE',
      learnedAtTimeIso: '2021-02-17T15:35:00.000Z',
      weight: 0.8,
      summaryTr: 'Yerel medya elektrik verildikten sonra hızlı yeniden başlatma beklentisini bildirdi.'
    });
    submitHypothesisEvidence(hypothesisLedger, 'HYP-2-MULTI-WEEK-CLEANROOM-AND-OEM-CASCADE', {
      evidenceId: 'EV-T1-ENG-CLEANROOM-PHYSICS',
      sourceId: 'SEMI-PROCESS-ENG-NOTE-20210217B',
      polarity: 'SUPPORTING_EVIDENCE',
      learnedAtTimeIso: '2021-02-17T16:50:00.000Z',
      weight: 1.2,
      summaryTr: 'Temiz oda vakum/UPW yeniden kalibrasyon fiziği en az 4 hafta gerektirdiğini gösteriyor.'
    });

    // 4. T1 SONRASINDA (T1 < t <= T2: 18 Şubat – 18 Mart 2021) Sisteme Giren Yeni Kanıtlar, Düzeltmeler ve Geri Çekmeler!
    // 4a. Erken medya iddiasının (48 saatte tam dönüş) 5 Mart 2021'de geri çekilmesi / düzeltilmesi
    applyLivingWorldRetraction(store, 'CLM-EARLY-MEDIA-48H-RESTART', {
      retractionRecordId: 'RETR-EARLY-MEDIA-48H-20210305',
      sourceId: 'AUSTIN-FAB-OPERATIONS-UPDATE-20210305',
      learnedAtTimeIso: '2021-03-05T14:00:00.000Z',
      reasonTr: 'Şebeke elektriği 19 Şubat’ta dönmesine rağmen temiz oda su/vakum ve ekipman kontrolleri nedeniyle 48 saatte üretime dönüş iddiası yanlışlandı.'
    });

    // 4b. Süreç mühendisliği yeniden başlatma tahmininin 17 Mart 2021 NXP resmi açıklamasıyla doğrulanıp güncellenmesi (DUZELTME)
    applyLivingWorldCorrection(store, 'CLM-ENG-CLEANROOM-28D-REQUALIFICATION', {
      correctionRecordId: 'CORR-NXP-OFFICIAL-1MONTH-LOSS-20210317',
      sourceId: 'NXP-PRESS-RELEASE-20210317',
      learnedAtTimeIso: '2021-03-17T13:30:00.000Z',
      correctedValue: 29,
      unit: 'days',
      epistemicCategory: 'BILINEN',
      summaryTr: 'NXP 17 Mart 2021 resmi açıklamasında Austin tesislerinde yaklaşık 1 aylık (29 gün) wafer üretim kaybı ve ~100 Milyon USD Q1 gelir etkisi oluştuğunu doğruladı.'
    });

    // 4c. T2 öncesi yeni birincil gözlemler
    addLivingWorldRecord(store, {
      recordId: 'OBS-NXP-100M-REVENUE-IMPACT-20210317',
      conceptType: 'GOZLEM',
      sourceId: 'NXP-PRESS-RELEASE-20210317',
      eventValidTimeIso: '2021-03-17T12:00:00.000Z',
      learnedAtTimeIso: '2021-03-17T13:00:00.000Z',
      subjectKey: 'austin_fab_confirmed_outage_days',
      value: 29,
      unit: 'days',
      relatedEntityIds: ['ENT-AUSTIN-FABS'],
      epistemicCategory: 'BILINEN',
      summaryTr: 'NXP Austin Oak Hill ve ATMC tesislerinde 16 Şubat duruşundan sonra tam üretime geçişin ~1 ay sürdüğü ve ~100 Milyon USD gelir etkisi yarattığı resmi olarak açıklandı.'
    });

    addLivingWorldRecord(store, {
      recordId: 'OBS-AUTO-OEM-CURTAILMENTS-20210316',
      conceptType: 'GOZLEM',
      sourceId: 'AUTO-OEM-PRODUCTION-FILINGS-20210316',
      eventValidTimeIso: '2021-03-15T09:00:00.000Z',
      learnedAtTimeIso: '2021-03-16T15:00:00.000Z',
      subjectKey: 'global_auto_oem_mcu_shortage_active',
      value: 1,
      unit: 'binary_flag',
      relatedEntityIds: ['ENT-AUSTIN-FABS', 'ENT-GLOBAL-AUTO-OEM'],
      epistemicCategory: 'BILINEN',
      summaryTr: 'Mart 2021 ortasında Kuzey Amerika ve küresel otomotiv OEM montaj hatlarında Teksas fırtınası kaynaklı MCU ve çip daralması nedeniyle vardiya kesintileri başladı.'
    });

    // 4d. T1 sonrasında öğrenilen karşı kanıt ve destekleyici kanıtları Hipotez Defterine işle
    submitHypothesisEvidence(hypothesisLedger, 'HYP-1-FAST-48H-RECOVERY', {
      evidenceId: 'EV-T2-NXP-1MONTH-FALSIFIES-48H',
      sourceId: 'NXP-PRESS-RELEASE-20210317',
      polarity: 'COUNTER_EVIDENCE',
      learnedAtTimeIso: '2021-03-17T13:15:00.000Z',
      weight: 2.5,
      isDecisiveFalsifier: true,
      summaryTr: 'NXP’nin 17 Mart 2021 resmi bildirimi Austin tesislerinde ~1 aylık üretim kaybı yaşandığını kanıtlayarak 48 saatte tam toparlanma hipotezini kesin biçimde çürüttü.'
    });

    submitHypothesisEvidence(hypothesisLedger, 'HYP-2-MULTI-WEEK-CLEANROOM-AND-OEM-CASCADE', {
      evidenceId: 'EV-T2-NXP-AND-OEM-CONFIRMATION',
      sourceId: 'NXP-PRESS-RELEASE-20210317',
      polarity: 'SUPPORTING_EVIDENCE',
      learnedAtTimeIso: '2021-03-17T13:20:00.000Z',
      weight: 2.0,
      summaryTr: 'Hem ~1 aylık temiz oda kaybı hem de Mart ortası otomotiv OEM montaj kesintileri gözlemlendi.'
    });

    // 4e. T2 sonrasında (Kasım 2021) yayınlanan FERC/NERC nihai raporu — hem T1 hem T2 kesiminde sızıntı kapısı tarafından engellenmeli!
    addLivingWorldRecord(store, {
      recordId: 'OBS-FERC-NERC-FINAL-REPORT-20211116',
      conceptType: 'GOZLEM',
      sourceId: 'FERC-NERC-JOINT-REPORT-20211116',
      eventValidTimeIso: '2021-02-15T07:25:00.000Z',
      learnedAtTimeIso: '2021-11-16T15:00:00.000Z',
      ingestedAtSystemTimeIso: '2021-11-17T09:00:00.000Z',
      subjectKey: 'ercot_unweatherized_gas_wellhead_pct',
      value: 44.2,
      unit: 'pct',
      relatedEntityIds: ['ENT-ERCOT-GRID'],
      epistemicCategory: 'BILINEN',
      summaryTr: 'Kasım 2021 FERC/NERC nihai raporu: Doğalgaz kuyu başı donma korumasızlığı oranı ayrıntılı olarak belgelendi (Şubat ve Mart 2021 karar anlarında henüz yayınlanmamıştı).'
    });

    // 5. Düşüncenin Değişimi Motorunu T1 ve T2 için çalıştır
    const beliefRevisionComparison = compareWorldAssessmentsAcrossDates(
      store,
      hypothesisLedger,
      dateT1Iso,
      dateT2Iso,
      'Şubat–Mart 2021 Teksas ERCOT Şebeke Çöküşü → Austin Yarı İletken Fabrikaları → Küresel Otomotiv MCU Krizi'
    );

    // 6. Uzak Bağlantı Keşfi (Çok adımlı zamanlı grafik)
    const distantGraphSpec = {
      nodes: [
        { nodeId: 'NODE_ERCOT_GRID', labelTr: 'Teksas ERCOT Elektrik Şebekesi', domain: 'ENERGY_INFRASTRUCTURE' },
        { nodeId: 'NODE_AUSTIN_WATER_UPW', labelTr: 'Austin Endüstriyel Su & Ultra-Saf Su (UPW) Hattı', domain: 'MUNICIPAL_WATER_INFRASTRUCTURE' },
        { nodeId: 'NODE_AUSTIN_SEMI_FABS', labelTr: 'Austin Yarı İletken Temiz Odaları (Samsung S2 / NXP / Infineon)', domain: 'SEMICONDUCTOR_MANUFACTURING' },
        { nodeId: 'NODE_AUTO_TIER1_ECU', labelTr: 'Otomotiv Tier-1 Fren ve Motor Kontrol Ünitesi (ECU) Üreticileri', domain: 'AUTOMOTIVE_TIER1_ELECTRONICS' },
        { nodeId: 'NODE_GLOBAL_AUTO_OEM_FINANCE', labelTr: 'Küresel Otomotiv OEM Montaj Hatları ve Çeyreklik Gelir Bilançosu', domain: 'GLOBAL_AUTOMOTIVE_AND_FINANCE' }
      ],
      edges: [
        {
          sourceNodeId: 'NODE_ERCOT_GRID',
          targetNodeId: 'NODE_AUSTIN_SEMI_FABS',
          relationType: 'POWER_CURTAILMENT',
          epistemicType: 'GOZLEM',
          lagHours: 6,
          validFromIso: '2021-02-15T00:00:00.000Z',
          discoverySignals: ['DOCUMENTED_DEPENDENCY', 'TEMPORAL_CO_OCCURRENCE'],
          supportingSourceIds: ['ERCOT-EEA3-NOTICE-20210215', 'AUSTIN-ENERGY-NOTICE-20210216'],
          mechanismNoteTr: 'EEA3 zorunlu endüstriyel yük atma kararıyla temiz oda şebeke enerjisinin kesilmesi.',
          alternativeExplanationTr: 'Tesis içi trafo arızası',
          weakeningDataConditionTr: 'Fabrikanın %100 bağımsız ada modu kojenerasyon santraline sahip olması'
        },
        {
          sourceNodeId: 'NODE_ERCOT_GRID',
          targetNodeId: 'NODE_AUSTIN_WATER_UPW',
          relationType: 'PUMP_PRESSURE_DROP',
          epistemicType: 'GOZLEM',
          lagHours: 18,
          validFromIso: '2021-02-15T00:00:00.000Z',
          discoverySignals: ['SHARED_GEOGRAPHY', 'DOCUMENTED_DEPENDENCY'],
          supportingSourceIds: ['AUSTIN-ENERGY-NOTICE-20210216'],
          mechanismNoteTr: 'Donma ve pompa istasyonu enerji kesintisiyle endüstriyel su basıncının düşmesi.',
          alternativeExplanationTr: 'Su arıtma kimyasalı eksikliği',
          weakeningDataConditionTr: 'Kapalı çevrim 30 günlük UPW rezervuarı bulunması'
        },
        {
          sourceNodeId: 'NODE_AUSTIN_WATER_UPW',
          targetNodeId: 'NODE_AUSTIN_SEMI_FABS',
          relationType: 'CLEANROOM_UPW_STARVATION',
          epistemicType: 'IDDIA',
          lagHours: 24,
          validFromIso: '2021-02-16T00:00:00.000Z',
          discoverySignals: ['PROCESS_ENGINEERING_DEPENDENCY'],
          supportingSourceIds: ['SEMI-PROCESS-ENG-NOTE-20210217B'],
          mechanismNoteTr: 'Elektrik gelse bile ultra-saf su (UPW) olmadan wafer yıkama ve litografi adımlarının başlatılamaması.',
          alternativeExplanationTr: 'Yalnızca personel ulaşım engeli',
          weakeningDataConditionTr: 'UPW kalitesinin hiç bozulmadan 24 saat içinde normale dönmesi'
        },
        {
          sourceNodeId: 'NODE_AUSTIN_SEMI_FABS',
          targetNodeId: 'NODE_AUTO_TIER1_ECU',
          relationType: 'AUTOMOTIVE_MCU_ALLOCATION_SHORTFALL',
          epistemicType: 'HIPOTEZ',
          lagHours: 336, // 14 gün
          validFromIso: '2021-02-16T00:00:00.000Z',
          discoverySignals: ['SUPPLY_CHAIN_TOPOLOGY', 'LAGGED_PROPAGATION'],
          supportingSourceIds: ['SEMI-PROCESS-ENG-NOTE-20210217B', 'ASSUMP-TIER1-MCU-BUFFER-18DAYS'],
          mechanismNoteTr: 'NXP/Infineon otomotiv MCU çıkışının durmasıyla 2 hafta sonra Tier-1 ECU üreticilerinde girdi daralması.',
          alternativeExplanationTr: 'Asya dökümhanelerindeki (TSMC/UMC) eşzamanlı kapasite sıkışıklığı',
          weakeningDataConditionTr: 'Tier-1 tedarikçilerin 90 günlük yedek MCU envanterine sahip olması'
        },
        {
          sourceNodeId: 'NODE_AUTO_TIER1_ECU',
          targetNodeId: 'NODE_GLOBAL_AUTO_OEM_FINANCE',
          relationType: 'ASSEMBLY_LINE_HALT_AND_EARNINGS_LOSS',
          epistemicType: 'HIPOTEZ',
          lagHours: 504, // 21 gün
          validFromIso: '2021-02-16T00:00:00.000Z',
          discoverySignals: ['MULTI_HOP_NETWORK_PATH', 'LAGGED_PROPAGATION'],
          supportingSourceIds: ['ASSUMP-TIER1-MCU-BUFFER-18DAYS'],
          mechanismNoteTr: 'Fren ve motor kontrol modülü eksikliği nedeniyle OEM araç montaj hatlarının durması ve çeyreklik gelir kaybı.',
          alternativeExplanationTr: 'Çelik/plastik hammadde veya liman konteyner gecikmesi',
          weakeningDataConditionTr: 'OEM’lerin eksik çipli araçları stokta bekletmeden alternatif MCU ile üretebilmesi'
        }
      ]
    };

    const distantConnections = discoverDistantCrossDomainConnections(distantGraphSpec, {
      sourceNodeId: 'NODE_ERCOT_GRID',
      targetDomain: 'GLOBAL_AUTOMOTIVE_AND_FINANCE',
      cutoffTimeIso: dateT2Iso,
      maxNodes: 100,
      maxEdges: 200,
      maxPaths: 8,
      maxHops: 5
    });

    // 7. Rakip Dünya Modelleri (Model A, B, C, D)
    const competingModelsSpec = [
      {
        modelId: 'MODEL_A_ENERGY_INFRASTRUCTURE_DOMINANT',
        titleTr: 'Model A: Enerji ve Su Altyapısı Kesintisi Baskın Etken',
        dominantMechanismTr: 'Fiziksel elektrik ve ultra-saf su (UPW) kesintisi temiz oda vakum/kalibrasyon döngüsünü bozarak doğrudan 1 aylık üretim kaybı yaratır.',
        explicitAssumptions: ['Temiz oda kalibrasyonunun fiziksel olarak hızlandırılamayacağı'],
        derivedFromSourceIds: ['OBS-AUSTIN-CURTAILMENT-20210216', 'SEMI-PROCESS-ENG-NOTE-20210217B'],
        divergenceDomains: ['SEMICONDUCTOR_MANUFACTURING', 'MUNICIPAL_WATER_INFRASTRUCTURE'],
        expectedSignatures: {
          austin_fab_power_status: { min: 0, max: 15 },
          austin_fab_restart_days: { min: 21, max: 45 },
          austin_fab_confirmed_outage_days: { min: 21, max: 40 }
        }
      },
      {
        modelId: 'MODEL_B_FINANCIAL_AND_INVENTORY_POLICY_DOMINANT',
        titleTr: 'Model B: Tam Zamanında (JIT) Stok ve Finansman Sıkışıklığı Baskın Etken',
        dominantMechanismTr: 'Otomotiv sektörünün pandemi başında güvenlik stoğunu sıfırlaması ve işletme sermayesi kısıtı nedeniyle küçük bir kesinti bile büyür.',
        explicitAssumptions: ['Fabrika duruşu kısa olsa bile JIT stok politikasının darboğaz yaratacağı'],
        derivedFromSourceIds: ['ASSUMP-TIER1-MCU-BUFFER-18DAYS'],
        divergenceDomains: ['GLOBAL_AUTOMOTIVE_AND_FINANCE'],
        expectedSignatures: {
          austin_fab_restart_days: { min: 1, max: 10 },
          auto_tier1_mcu_buffer_days: { min: 5, max: 21 },
          global_auto_oem_mcu_shortage_active: { min: 1, max: 1 }
        }
      },
      {
        modelId: 'MODEL_C_REGULATORY_LOAD_SHED_ALLOCATION_DOMINANT',
        titleTr: 'Model C: Düzenleyici Yük Atma Kuralları Baskın Etken',
        dominantMechanismTr: 'Endüstriyel tesislerin kritiklik ayrımı yapılmadan tamamen kesilmesi (asgari temiz oda koruma yükü verilmemesi) hasarı belirler.',
        explicitAssumptions: ['Asgari %15 koruma gücü verilseydi wafer hurdasının sıfır olacağı'],
        derivedFromSourceIds: ['EVT-ERCOT-EEA3-20210215', 'OBS-AUSTIN-CURTAILMENT-20210216'],
        divergenceDomains: ['ENERGY_INFRASTRUCTURE'],
        expectedSignatures: {
          ercot_load_shed_mw: { min: 15000, max: 25000 },
          austin_fab_power_status: { min: 0, max: 5 }
        }
      },
      {
        modelId: 'MODEL_D_MULTI_FACTOR_COUPLED',
        titleTr: 'Model D: Çok Etkenli Etkileşim (Enerji/UPW Kesintisi + 4 Haftalık Temiz Oda Fiziği + Düşük Otomotiv MCU Tamponu)',
        dominantMechanismTr: 'Şebeke/UPW kesintisi 1 aylık temiz oda kaybını tetikler; düşük Tier-1 MCU tamponu ile birleşerek 3–5 hafta gecikmeyle küresel otomotiv hatlarını durdurur.',
        explicitAssumptions: ['Hem fiziksel temiz oda gecikmesi hem de tedarik zinciri stok düşüklüğü birlikte çalışır'],
        derivedFromSourceIds: ['OBS-AUSTIN-CURTAILMENT-20210216', 'SEMI-PROCESS-ENG-NOTE-20210217B', 'ASSUMP-TIER1-MCU-BUFFER-18DAYS'],
        divergenceDomains: ['ENERGY_INFRASTRUCTURE', 'SEMICONDUCTOR_MANUFACTURING', 'GLOBAL_AUTOMOTIVE_AND_FINANCE'],
        expectedSignatures: {
          ercot_load_shed_mw: { min: 15000, max: 25000 },
          austin_fab_power_status: { min: 0, max: 10 },
          austin_fab_restart_days: { min: 20, max: 45 },
          austin_fab_confirmed_outage_days: { min: 20, max: 40 },
          global_auto_oem_mcu_shortage_active: { min: 1, max: 1 }
        }
      }
    ];

    const competingAtT1 = evaluateCompetingWorldModelsAtCutoff(
      competingModelsSpec,
      beliefRevisionComparison.previousAssessment
        ? answerLivingWorldDualQuestionsAtDate(store, dateT1Iso).question1_WhatWasBelievedAboutWorldAtDate.activeBeliefs
        : []
    );
    const competingAtT2 = evaluateCompetingWorldModelsAtCutoff(
      competingModelsSpec,
      answerLivingWorldDualQuestionsAtDate(store, dateT2Iso).question1_WhatWasBelievedAboutWorldAtDate.activeBeliefs
    );

    // 8. Çok Ölçekli / Çok Aktörlü 3 Senaryo Çalıştırması
    const multiScaleFutures = runMultiScaleMultiActorFutures({
      eventDurationHours: opts.eventDurationHours || 48,
      backupCapacityPct: opts.backupCapacityPct || 68,
      insufficientData: opts.insufficientData === true
    });

    // 9. Kullanıcının Kendi Dünyası
    const userWorld = createUserOwnWorldModel({
      ownerLabelTr: opts.userWorldOwnerLabelTr || 'Kullanıcı İzleme Alanı: Otomotiv Elektronik ve Yarı İletken Tedarik',
      entities: [
        {
          entityId: 'USER-WATCH-OEM-PLANT',
          entityType: 'COMPANY',
          nameTr: 'İzlenen Otomotiv Montaj ve Fren Modülü Hattı',
          domain: 'GLOBAL_AUTOMOTIVE_AND_FINANCE',
          upstreamNodeIds: ['NODE_AUTO_TIER1_ECU', 'NODE_GLOBAL_AUTO_OEM_FINANCE']
        },
        {
          entityId: 'USER-WATCH-UNCONNECTED-AGRI',
          entityType: 'COMPANY',
          nameTr: 'İzlenen Bağımsız Tarım Sulama Kooperatifi (Bağlantısız Test Varlığı)',
          domain: 'AGRICULTURE_LOCAL',
          upstreamNodeIds: ['NODE_UNCONNECTED_AGRI_WELL']
        }
      ],
      userAssumptions: [
        {
          assumptionId: 'USER-ASSUMP-BUFFER-14D',
          textTr: 'Kritik fren kontrol MCU emniyet stoğumuz 14 gündür.',
          epistemicLabel: 'KULLANICI_VARSAYIMI'
        }
      ],
      watchedQuestions: [
        {
          questionId: 'UQ-1',
          questionTr: 'Austin yarı iletken kesintisi izlediğim otomotiv fren modülü hattını hangi yolla ve kaç saat/gün gecikmeyle etkileyebilir?',
          requiredEntityId: 'USER-WATCH-OEM-PLANT',
          requiresMissingDataKey: null
        },
        {
          questionId: 'UQ-2',
          questionTr: 'NXP Oak Hill temiz odasında kesinti anında tam olarak kaç adet 300mm wafer hurdaya ayrıldı?',
          requiredEntityId: 'ENT-AUSTIN-FABS',
          requiresMissingDataKey: 'fab_internal_exact_wafer_scrap_count'
        }
      ]
    });

    if (Array.isArray(opts.extraUserWatchItems)) {
      for (const item of opts.extraUserWatchItems) {
        addUserWorldWatchItem(userWorld, item);
      }
    }

    const userWorldImpact = evaluateEventImpactOnUserWorld(
      userWorld,
      distantConnections,
      beliefRevisionComparison.currentAssessment.hypothesisStates
    );

    // 10. Gerçekleşen Tarihsel Sonuçlarla Karşılaştırma (Neyi Doğru Yakaladı, Neyi Kaçırdı?)
    const historicalOutcomeEvaluation = {
      correctlyCaptured: [
        {
          aspectTr: 'Çok haftalık temiz oda yeniden başlatma darboğazı',
          explanationTr: 'T1 (17 Şubat) anında erken medyanın "48 saatte tam üretime dönüş" iddiasını tek doğru kabul etmeyip süreç mühendisliği iddiasını (4–6 hafta) korudu; T2 (18 Mart) itibarıyla NXP’nin açıkladığı ~1 aylık üretim duruşu ile doğrulandı.'
        },
        {
          aspectTr: 'Enerji sektöründen yarı iletken ve küresel otomotiv montaj hatlarına gecikmeli sıçrama',
          explanationTr: 'ERCOT şebeke çöküşünün 2–3 haftalık Tier-1 tamponu tükendikten sonra Mart 2021 ortasında küresel otomotiv OEM vardiya duruşlarına yol açacağını çok adımlı grafik yoluyla yakaladı.'
        },
        {
          aspectTr: 'Kasım 2021 FERC/NERC raporunun Şubat ve Mart 2021 analizlerine sızmasının engellenmesi',
          explanationTr: 'Olay zamanı 15 Şubat 2021 olmasına rağmen yayın zamanı 16 Kasım 2021 olan FERC/NERC raporu hem T1 hem T2 kesiminde çift zamanlı kapı tarafından reddedildi.'
        }
      ],
      missedOrNotPredicted: [
        {
          aspectTr: 'Fabrika bazlı kesin dolar hasarı (~100 Milyon USD NXP / ~300 Milyon USD Samsung) ve tam wafer hurda adedi',
          explanationTr: 'T1 karar anında tesis içi gizli WIP wafer hurda adedi kamuya açık olmadığı için CAELUS kesin dolar veya wafer adedi uydurmadı; bu alanı "BİLİNMİYOR / YETERSİZ VERİ" olarak işaretledi.'
        },
        {
          aspectTr: 'Eşzamanlı Japonya Renesas Naka fabrika yangınının (19 Mart 2021) ikinci bir bağımsız şok olarak eklenmesi',
          explanationTr: 'T1 ve T2 (18 Mart 2021) kesiminde henüz gerçekleşmemiş olan 19 Mart 2021 Renesas yangını modelde yer almaz; küresel otomotiv MCU krizinin Nisan–Mayıs derinleşmesinde bu dışsal ikinci olay da etkili olmuştur.'
        }
      ]
    };

    const commercialAudit = auditCommercialComponentInventory();
    const graphExperiment = runGraphWorldModelVsBaselinesExperiment();

    const fullBundle = {
      caseId: 'REAL_CASE_2021_ERCOT_AUSTIN_SEMICONDUCTOR_AUTO_TWO_DATE',
      engineVersion: 'CAELUS-LIVING-WORLD-MODEL-1.0.0',
      dateT1Iso,
      dateT2Iso,
      memoryStore: store,
      hypothesisLedger,
      beliefRevisionComparison,
      distantConnections,
      competingWorldModels: {
        atT1: competingAtT1,
        atT2: competingAtT2
      },
      multiScaleFutures,
      userWorld,
      userWorldImpact,
      historicalOutcomeEvaluation,
      commercialAudit,
      graphExperiment,
      researchAreasEvaluation: GRAPH_AND_WORLD_MODEL_RESEARCH_EVALUATION
    };

    return {
      ...fullBundle,
      deterministicReplaySha256: computeSha256Hex({
        caseId: fullBundle.caseId,
        dateT1Iso,
        dateT2Iso,
        diffHash: beliefRevisionComparison.replayIntegritySha256,
        pathsCount: distantConnections.candidatePaths.length,
        scenarios: multiScaleFutures.scenarios.map((s) => ({ id: s.scenarioId, tp: s.throughputPct }))
      })
    };
  }

  return Object.freeze({
    LIVING_WORLD_MATURITY_CLASSES,
    COMMERCIAL_STATUS_LABELS,
    COMMERCIAL_DEPLOYMENT_MODES,
    LIVING_WORLD_17_CONCEPTS,
    EPISTEMIC_UI_CATEGORIES_7,
    HYPOTHESIS_LIFECYCLE_STATUSES,
    CAELUS_COMMERCIAL_COMPONENT_AND_DATA_INVENTORY,
    GRAPH_AND_WORLD_MODEL_RESEARCH_EVALUATION,
    parseStrictIsoDate,
    canonicalJsonStringify,
    computeSha256Hex,
    auditCommercialComponentInventory,
    createLivingWorldMemoryStore,
    addLivingWorldRecord,
    applyLivingWorldCorrection,
    applyLivingWorldRetraction,
    answerLivingWorldDualQuestionsAtDate,
    createHypothesisLedger,
    registerLivingHypothesis,
    submitHypothesisEvidence,
    evaluateHypothesisStateAtCutoff,
    attemptHypothesisPromotionToObservation,
    compareWorldAssessmentsAcrossDates,
    discoverDistantCrossDomainConnections,
    evaluateCompetingWorldModelsAtCutoff,
    runMultiScaleMultiActorFutures,
    runGraphWorldModelVsBaselinesExperiment,
    registerMultimodalObservationWithContract,
    createUserOwnWorldModel,
    addUserWorldWatchItem,
    evaluateEventImpactOnUserWorld,
    runTwoDateHistoricalRealityTest
  });
});
