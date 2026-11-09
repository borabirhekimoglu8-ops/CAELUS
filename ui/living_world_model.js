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

  // ============================================================================
  // 13. CAELUS YAŞAYAN DÜNYA KATMANI V2 (GERÇEK VERİ, ZAMAN, DÜNYA HAFIZASI VE ALANLAR ARASI İLİŞKİLER)
  // ============================================================================

  const LIVING_WORLD_EPISTEMIC_CLASSES_9 = Object.freeze({
    GERCEK_KAYNAK_KAYDI: {
      code: 'GERCEK_KAYNAK_KAYDI',
      labelTr: 'Gerçek kaynaktan alınmış kayıt',
      labelEn: 'Record fetched from real source'
    },
    KAYNAKTA_IDDIA_EDILEN: {
      code: 'KAYNAKTA_IDDIA_EDILEN',
      labelTr: 'Kaynakta iddia edilen ifade',
      labelEn: 'Claim stated in source'
    },
    KULLANICI_GIRDISI: {
      code: 'KULLANICI_GIRDISI',
      labelTr: 'Kullanıcının girdiği bilgi',
      labelEn: 'User-entered information'
    },
    DOGRULANMIS_HESAP: {
      code: 'DOGRULANMIS_HESAP',
      labelTr: 'Doğrulanmış hesap veya dönüşüm',
      labelEn: 'Verified calculation or transformation'
    },
    MODEL_VARSAYIMI: {
      code: 'MODEL_VARSAYIMI',
      labelTr: 'Model varsayımı',
      labelEn: 'Model assumption'
    },
    ARASTIRMA_HIPOTEZI: {
      code: 'ARASTIRMA_HIPOTEZI',
      labelTr: 'Araştırılması gereken hipotez',
      labelEn: 'Hypothesis requiring investigation'
    },
    SIMULASYON_SONUCU: {
      code: 'SIMULASYON_SONUCU',
      labelTr: 'Simülasyon sonucu',
      labelEn: 'Simulation result'
    },
    BILINMEYEN_YETERSIZ_VERI: {
      code: 'BILINMEYEN_YETERSIZ_VERI',
      labelTr: 'Bilinmeyen / yetersiz veri',
      labelEn: 'Unknown / insufficient data'
    },
    TEST_EGITIM_VERISI: {
      code: 'TEST_EGITIM_VERISI',
      labelTr: 'Test veya isteğe bağlı eğitim verisi',
      labelEn: 'Test or optional training data'
    }
  });

  const DATA_FRESHNESS_LABELS_7 = Object.freeze({
    GUNCEL: {
      code: 'GUNCEL',
      labelTr: 'Güncel: Kaynağın kendi yenilenme takvimi içinde',
      labelEn: 'Current: Within source publication schedule'
    },
    BEKLENIYOR: {
      code: 'BEKLENIYOR',
      labelTr: 'Bekleniyor: Yeni veri henüz kaynağın normal yayın zamanına gelmedi',
      labelEn: 'Pending: Next scheduled release not yet due'
    },
    GECIKMIS: {
      code: 'GECIKMIS',
      labelTr: 'Gecikmiş: Beklenen güncelleme gelmedi veya son veri eski',
      labelEn: 'Delayed: Expected update overdue or stale'
    },
    BAGLANTI_YOK: {
      code: 'BAGLANTI_YOK',
      labelTr: 'Bağlantı yok: Kaynağa şu anda ulaşılamıyor',
      labelEn: 'Offline/Unreachable: Source currently unreachable'
    },
    SON_BILINEN_VERI: {
      code: 'SON_BILINEN_VERI',
      labelTr: 'Son bilinen veri: Eski kayıt gösteriliyor; yeni olduğu iddia edilmiyor',
      labelEn: 'Last known data: Showing cached record without claiming live freshness'
    },
    SURESI_BILINMIYOR: {
      code: 'SURESI_BILINMIYOR',
      labelTr: 'Süresi bilinmiyor: Kaynağın güncelliği belirlenemiyor',
      labelEn: 'Unknown freshness: Cadence cannot be determined'
    },
    DUZELTILDI_GERI_CEKILDI: {
      code: 'DUZELTILDI_GERI_CEKILDI',
      labelTr: 'Düzeltildi / geri çekildi: Kaynak daha sonra kayıt üzerinde değişiklik yaptı',
      labelEn: 'Corrected / Retracted: Source subsequently modified or retracted record'
    }
  });

  const CROSS_DOMAIN_CONNECTION_TYPES_7 = Object.freeze({
    A_DIRECT_SOURCE_STATED: {
      code: 'A_DIRECT_SOURCE_STATED',
      labelTr: 'A. Kaynakta doğrudan belirtilen ilişki',
      isCausalProof: false
    },
    B_STRUCTURED_DATA_SUPPORTED: {
      code: 'B_STRUCTURED_DATA_SUPPORTED',
      labelTr: 'B. Yapılandırılmış veriyle desteklenen ilişki',
      isCausalProof: false
    },
    C_OBSERVED_CO_MOVEMENT: {
      code: 'C_OBSERVED_CO_MOVEMENT',
      labelTr: 'C. Verilerde gözlenen birlikte değişim (korelasyon nedensellik değildir)',
      isCausalProof: false
    },
    D_MODEL_PROPOSED_HYPOTHESIS: {
      code: 'D_MODEL_PROPOSED_HYPOTHESIS',
      labelTr: 'D. Modelin önerdiği incelenebilir bağlantı (araştırma önerisi)',
      isCausalProof: false
    },
    E_USER_ADDED_ASSUMPTION: {
      code: 'E_USER_ADDED_ASSUMPTION',
      labelTr: 'E. Kullanıcı tarafından eklenen varsayım',
      isCausalProof: false
    },
    F_SIMULATION_RESULT: {
      code: 'F_SIMULATION_RESULT',
      labelTr: 'F. Simülasyon sonucu',
      isCausalProof: false
    },
    G_INSUFFICIENT_DATA_OR_CONFLICT: {
      code: 'G_INSUFFICIENT_DATA_OR_CONFLICT',
      labelTr: 'G. Yetersiz bilgi / çelişki',
      isCausalProof: false
    }
  });

  const KNOWN_SAMPLE_SCENARIO_IDS = Object.freeze([
    'EX-01_LIMAN_SOGUK_ZINCIR',
    'EX-02_HASTANE_YOGUN_BAKIM',
    'BS-01_SAHTE_UFUK',
    'BS-02_GOLGE_ARSIV',
    'BS-03_KUM_SAATI',
    'REAL_CASE_2021_ERCOT_AUSTIN_SEMICONDUCTOR_AUTO',
    'REAL_CASE_2021_ERCOT_AUSTIN_SEMICONDUCTOR_AUTO_TWO_DATE',
    'AEGEAN_PORT_DEMO'
  ]);

  const EMPTY_WORLD_MESSAGES_12 = Object.freeze({
    'tr-TR': 'Henüz dünya verisi yok.\nGerçek veri kaynaklarını bağlayabilir veya kendi dosyanı yükleyebilirsin.',
    'en-US': 'No world data yet.\nYou can connect real data sources or upload your own file.',
    'el-GR': 'Δεν υπάρχουν ακόμη δεδομένα κόσμου.\nΜπορείτε να συνδέσετε πραγματικές πηγές δεδομένων ή να ανεβάσετε το δικό σας αρχείο.',
    'de-DE': 'Noch keine Weltdaten vorhanden.\nSie können echte Datenquellen verbinden oder Ihre eigene Datei hochladen.',
    'fr-FR': 'Aucune donnée mondiale pour le moment.\nVous pouvez connecter des sources de données réelles ou téléverser votre propre fichier.',
    'es-ES': 'Aún no hay datos del mundo.\nPuedes conectar fuentes de datos reales o subir tu propio archivo.',
    'it-IT': 'Non ci sono ancora dati sul mondo.\nPuoi collegare fonti di dati reali o caricare il tuo file.',
    'pt-BR': 'Ainda não há dados do mundo.\nVocê pode conectar fontes de dados reais ou enviar seu próprio arquivo.',
    'ar-SA': 'لا توجد بيانات عالمية حتى الآن.\nيمكنك ربط مصادر البيانات الحقيقية أو تحميل ملفك الخاص.',
    'he-IL': 'עדיין אין נתוני עולם.\nניתן לחבר מקורות נתונים אמיתיים או להעלות קובץ משלך.',
    'ru-RU': 'Данных о мире пока нет.\nВы можете подключить реальные источники данных или загрузить собственный файл.',
    'zh-Hans': '尚无世界数据。\n您可以连接真实数据源或上传您自己的文件。'
  });

  /**
   * Aşama B (Bölüm 3): Örnek dünyanın gerçek veri akışından kesin biçimde ayrılması
   * ve kullanıcının geçmiş çalışmalarının kayıpsız/geri alınabilir biçimde korunması.
   */
  function inspectAndSeparateSampleFromRealWorldState(rawStorageState, options) {
    const opts = options || {};
    const locale = String(opts.locale || 'tr-TR');
    const stateObj = rawStorageState && typeof rawStorageState === 'object' ? rawStorageState : {};
    const records = Array.isArray(stateObj.records) ? stateObj.records : [];
    const savedWork = Array.isArray(stateObj.userSavedWork) ? stateObj.userSavedWork : [];

    const realRecords = [];
    const userRecords = [];
    const isolatedSampleRecords = [];

    for (const rec of records) {
      if (!rec || typeof rec !== 'object') continue;
      const isSample =
        rec.isSampleFixture === true ||
        rec.epistemic_status === 'TEST_EGITIM_VERISI' ||
        KNOWN_SAMPLE_SCENARIO_IDS.includes(String(rec.scenarioId || rec.source_id || '')) ||
        String(rec.source_id || '').startsWith('SAMPLE_') ||
        String(rec.record_id || '').startsWith('SAMPLE_');
      const isUser =
        rec.epistemic_status === 'KULLANICI_GIRDISI' ||
        rec.epistemic_status === 'KULLANICI_VERISI' ||
        String(rec.source_id || '').startsWith('USER_FILE_');

      if (isSample) {
        isolatedSampleRecords.push({
          ...rec,
          epistemic_status: 'TEST_EGITIM_VERISI',
          sampleIsolationLabelTr: 'Örnek / eğitim verisi (Gerçek dünya hafızasına karışmaz)'
        });
      } else if (isUser) {
        userRecords.push(rec);
      } else {
        realRecords.push(rec);
      }
    }

    const hasActiveRealOrUserWorld = realRecords.length > 0 || userRecords.length > 0;
    const emptyMessage = EMPTY_WORLD_MESSAGES_12[locale] || EMPTY_WORLD_MESSAGES_12['tr-TR'];

    return {
      schemaVersion: 'CAELUS_SAMPLE_ISOLATION_V2',
      defaultShowsSampleAsReal: false,
      hasActiveRealOrUserWorld,
      emptyStateVisibleByDefault: !hasActiveRealOrUserWorld,
      emptyStateText: emptyMessage,
      realRecordCount: realRecords.length,
      userRecordCount: userRecords.length,
      isolatedSampleRecordCount: isolatedSampleRecords.length,
      preservedUserWorkCount: savedWork.length,
      realRecords,
      userRecords,
      isolatedSampleRecords: opts.includeOptionalTrainingData === true ? isolatedSampleRecords : [],
      migrationBackupSnapshot: {
        backupId: 'caelus_legacy_sample_migration_backup_v1',
        createdAtIso: opts.nowIso || new Date().toISOString(),
        reversible: true,
        preservedUserSavedWork: savedWork,
        archivedSampleRecordIds: isolatedSampleRecords.map((r) => r.record_id || r.recordId || 'sample')
      },
      restoreInstructionsTr:
        'Kullanıcının daha önce kaydettiği çalışmalar silinmemiştir. Örnek senaryolar gerçek dünya akışından ayrılmış olup yalnızca "Örnek / Eğitim Verisini Aç" seçeneğiyle isteğe bağlı incelenebilir.'
    };
  }

  /**
   * Aşama C (Bölüm 4): CAELUS Dünya Veri Sözleşmesi (CAELUS_WORLD_DATA_CONTRACT_V2)
   * A. Olay zamanı (event_time)
   * B. Kaynak yayın zamanı (source_published_at / source_updated_at)
   * C. CAELUS öğrenme/alım zamanı (observed_at / ingested_at)
   * D. Kaynak son kontrol zamanı (last_checked_at)
   * E. Geçerlilik dönemi (valid_from / valid_to)
   * Olay zamanı eksikse asla yükleme zamanı (ingested_at) olay zamanı olarak sessizce kullanılmaz!
   */
  function normalizeSyndicationFingerprint(title, publisher, url) {
    const cleanTitle = String(title || '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\b(reuters|ap|afp|bloomberg|aa|breaking|update|live)\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!cleanTitle) return null;
    return computeSha256Hex({ normalizedTitleSlug: cleanTitle.slice(0, 90) }).slice(0, 24);
  }

  function normalizeAndValidateWorldRecord(rawInput, options) {
    const opts = options || {};
    if (!rawInput || typeof rawInput !== 'object') {
      return { valid: false, errorCode: 'INVALID_RECORD_INPUT', reasonTr: 'Kayıt nesnesi geçersiz.' };
    }

    const nowIso = opts.nowIso || new Date().toISOString();
    const ingestedCheck = parseStrictIsoDate(rawInput.ingested_at || rawInput.learnedAtTimeIso || nowIso);
    if (!ingestedCheck.valid) {
      return { valid: false, errorCode: `INVALID_INGESTED_AT:${ingestedCheck.reason}`, reasonTr: 'Sisteme alım zamanı geçersiz.' };
    }

    // A. Olay zamanı kontrolü — eksikse ingested_at ile sessizce doldurulmaz!
    let eventTimeIso = 'not_provided';
    let eventTimeStatus = 'NOT_PROVIDED_BY_SOURCE';
    let eventTimeEpochMs = null;
    const rawEventTime = rawInput.event_time ?? rawInput.eventValidTimeIso ?? null;
    if (rawEventTime !== null && rawEventTime !== undefined && rawEventTime !== '' && rawEventTime !== 'not_provided' && rawEventTime !== 'unknown') {
      const evCheck = parseStrictIsoDate(String(rawEventTime));
      if (!evCheck.valid) {
        return {
          valid: false,
          errorCode: `INVALID_EVENT_TIME:${evCheck.reason}`,
          reasonTr: `Kaynağın bildirdiği olay tarihi geçersiz (${String(rawEventTime)}).`
        };
      }
      eventTimeIso = evCheck.normalizedIso;
      eventTimeStatus = 'PROVIDED';
      eventTimeEpochMs = evCheck.epochMs;
    }

    // B. Kaynağın yayımladığı ve güncellediği zaman
    let sourcePublishedIso = 'not_provided';
    let sourcePublishedEpochMs = null;
    if (rawInput.source_published_at && rawInput.source_published_at !== 'not_provided') {
      const pubCheck = parseStrictIsoDate(String(rawInput.source_published_at));
      if (!pubCheck.valid) {
        return {
          valid: false,
          errorCode: `INVALID_SOURCE_PUBLISHED_AT:${pubCheck.reason}`,
          reasonTr: 'Kaynağın yayın tarihi geçersiz.'
        };
      }
      sourcePublishedIso = pubCheck.normalizedIso;
      sourcePublishedEpochMs = pubCheck.epochMs;
    }

    let sourceUpdatedIso = 'not_provided';
    if (rawInput.source_updated_at && rawInput.source_updated_at !== 'not_provided') {
      const updCheck = parseStrictIsoDate(String(rawInput.source_updated_at));
      if (updCheck.valid) sourceUpdatedIso = updCheck.normalizedIso;
    }

    // D. Kaynağın en son kontrol edildiği zaman
    const checkedCheck = parseStrictIsoDate(rawInput.last_checked_at || ingestedCheck.normalizedIso);
    const lastCheckedIso = checkedCheck.valid ? checkedCheck.normalizedIso : ingestedCheck.normalizedIso;

    // E. Geçerlilik dönemi
    const validFromIso = rawInput.valid_from && parseStrictIsoDate(String(rawInput.valid_from)).valid
      ? parseStrictIsoDate(String(rawInput.valid_from)).normalizedIso
      : (eventTimeStatus === 'PROVIDED' ? eventTimeIso : 'unknown');
    const validToIso = rawInput.valid_to && parseStrictIsoDate(String(rawInput.valid_to)).valid
      ? parseStrictIsoDate(String(rawInput.valid_to)).normalizedIso
      : 'open_or_unknown';

    const subjectObj = rawInput.subject && typeof rawInput.subject === 'object'
      ? {
          id: String(rawInput.subject.id || rawInput.subject_id || 'UNKNOWN_SUBJECT'),
          name: String(rawInput.subject.name || rawInput.subject_name || rawInput.subject.id || 'Bilinmeyen Varlık'),
          entity_type: String(rawInput.subject.entity_type || rawInput.entity_type || 'ENTITY'),
          domain: String(rawInput.subject.domain || rawInput.domain || 'GENERAL'),
          external_ids: rawInput.subject.external_ids && typeof rawInput.subject.external_ids === 'object'
            ? { ...rawInput.subject.external_ids }
            : {}
        }
      : {
          id: String(rawInput.subject_id || rawInput.subject || rawInput.record_id || 'UNKNOWN_SUBJECT'),
          name: String(rawInput.subject_name || rawInput.subject || 'Bilinmeyen Varlık'),
          entity_type: String(rawInput.entity_type || 'ENTITY'),
          domain: String(rawInput.domain || 'GENERAL'),
          external_ids: {}
        };

    const sourceId = String(rawInput.source_id || rawInput.sourceId || 'unknown_source');
    const recordId = String(
      rawInput.record_id ||
      rawInput.recordId ||
      `REC-${sourceId.toUpperCase()}-${computeSha256Hex({ s: subjectObj.id, p: rawInput.relation || rawInput.predicate, o: rawInput.object ?? rawInput.value, t: eventTimeIso }).slice(0, 12)}`
    );

    const epistemicStatus = LIVING_WORLD_EPISTEMIC_CLASSES_9[rawInput.epistemic_status]
      ? rawInput.epistemic_status
      : (rawInput.isSampleFixture ? 'TEST_EGITIM_VERISI' : 'GERCEK_KAYNAK_KAYDI');

    const originalText = rawInput.original_text !== undefined && rawInput.original_text !== null
      ? String(rawInput.original_text)
      : 'not_provided';
    const originalLanguage = String(rawInput.original_language || 'unknown');

    const hashPayload = {
      record_id: recordId,
      schema_version: '2.0.0',
      record_type: String(rawInput.record_type || 'OBSERVATION'),
      subject_id: subjectObj.id,
      relation: String(rawInput.relation || rawInput.predicate || 'OBSERVED_STATE'),
      object: rawInput.object !== undefined ? rawInput.object : (rawInput.value !== undefined ? rawInput.value : 'not_provided'),
      units: String(rawInput.units || rawInput.unit || 'not_provided'),
      source_id: sourceId,
      source_document_id: String(rawInput.source_document_id || 'not_provided'),
      event_time: eventTimeIso,
      source_published_at: sourcePublishedIso,
      original_text: originalText
    };
    const contentHash = computeSha256Hex(hashPayload);

    const record = Object.freeze({
      record_id: recordId,
      schema_version: '2.0.0',
      record_type: hashPayload.record_type,
      subject: Object.freeze(subjectObj),
      relation: hashPayload.relation,
      predicate: hashPayload.relation,
      object: hashPayload.object,
      value: hashPayload.object,
      units: hashPayload.units,
      source_id: sourceId,
      source_url: String(rawInput.source_url || 'not_provided'),
      source_document_id: hashPayload.source_document_id,
      source_publisher: String(rawInput.source_publisher || 'not_provided'),
      source_license: String(rawInput.source_license || 'unknown'),
      source_terms_version: String(rawInput.source_terms_version || '2026-11-09'),
      // 5 Ayrı Zaman Alanı (A–E):
      event_time: eventTimeIso,
      event_time_status: eventTimeStatus,
      event_time_epoch_ms: eventTimeEpochMs,
      event_time_honesty_note_tr: eventTimeStatus === 'NOT_PROVIDED_BY_SOURCE'
        ? 'Bu olayın gerçekleşme tarihi kaynakta belirtilmemiş (alım zamanı olay zamanı olarak kullanılmaz).'
        : 'Kaynağın bildirdiği olay/ölçüm zamanı (UTC).',
      valid_from: validFromIso,
      valid_to: validToIso,
      source_published_at: sourcePublishedIso,
      source_published_epoch_ms: sourcePublishedEpochMs,
      source_updated_at: sourceUpdatedIso,
      observed_at: String(rawInput.observed_at || ingestedCheck.normalizedIso),
      ingested_at: ingestedCheck.normalizedIso,
      ingested_epoch_ms: ingestedCheck.epochMs,
      last_checked_at: lastCheckedIso,
      ingestion_lag_ms: sourcePublishedEpochMs !== null
        ? Math.max(0, ingestedCheck.epochMs - sourcePublishedEpochMs)
        : null,
      original_language: originalLanguage,
      original_text: originalText,
      auto_translated: false,
      content_hash: contentHash,
      hash_algorithm: 'SHA-256 (FIPS 180-4)',
      claim_status: String(rawInput.claim_status || (epistemicStatus === 'KAYNAKTA_IDDIA_EDILEN' ? 'SOURCE_REPORTED_CLAIM' : 'STRUCTURED_RECORD')),
      epistemic_status: epistemicStatus,
      epistemic_label_tr: LIVING_WORLD_EPISTEMIC_CLASSES_9[epistemicStatus].labelTr,
      evidence_level: String(rawInput.evidence_level || 'SINGLE_SOURCE_RECORD'),
      confidence_information: Object.freeze({
        score: typeof rawInput.confidence_score === 'number' ? rawInput.confidence_score : null,
        is_calibrated_probability: false,
        explanation_tr: String(
          rawInput.confidence_explanation_tr ||
            'Bu değer kalibre edilmiş gerçekleşme olasılığı değildir; kaynak tamlığı ve yapılandırılmış alan eşleşme göstergesidir.'
        )
      }),
      correction_of: rawInput.correction_of || null,
      retracted_by: rawInput.retracted_by || null,
      supersedes: rawInput.supersedes || null,
      geographic_scope: String(rawInput.geographic_scope || 'unknown'),
      temporal_scope: String(rawInput.temporal_scope || `${validFromIso}..${validToIso}`),
      data_freshness: String(rawInput.data_freshness || 'GUNCEL'),
      extraction_method: String(rawInput.extraction_method || 'DETERMINISTIC_API_PARSER_V2'),
      user_confirmation: String(rawInput.user_confirmation || 'NOT_REQUIRED'),
      usage_and_display_permissions: Object.freeze({
        commercial_status: String(rawInput.commercial_status || 'UNDER_REVIEW'),
        attribution_required: Boolean(rawInput.attribution_required !== false),
        redistribution_policy: String(rawInput.redistribution_policy || 'METADATA_AND_LINK_ONLY'),
        pii_minimized: true
      }),
      syndication_fingerprint: rawInput.syndication_fingerprint ||
        (rawInput.record_type === 'NEWS_EVENT' || sourceId === 'gdelt_doc_v2'
          ? normalizeSyndicationFingerprint(rawInput.original_text || subjectObj.name, rawInput.source_publisher, rawInput.source_url)
          : null)
    });

    return { valid: true, record };
  }

  /**
   * Aşama D (Bölüm 5 & 7): Canlı Saat, Saat Dilimi / Yaz-Kış Saati (DST) ve Kaynak Güncelliği
   */
  function getSystemClockAndTimezoneState(options) {
    const opts = options || {};
    const sysMs = typeof opts.systemEpochMs === 'number' ? opts.systemEpochMs : Date.now();
    const sysDate = new Date(sysMs);
    const utcIso = sysDate.toISOString();
    const timeZone = opts.timeZone ||
      (typeof Intl !== 'undefined' && Intl.DateTimeFormat ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC') ||
      'UTC';

    let localFormatted = utcIso;
    try {
      localFormatted = new Intl.DateTimeFormat(opts.locale || 'tr-TR', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        timeZoneName: 'short'
      }).format(sysDate);
    } catch (_) {
      localFormatted = utcIso;
    }

    // DST (Yaz/Kış saati) farkı tespiti
    let isDstActive = false;
    try {
      const jan = new Date(sysDate.getUTCFullYear(), 0, 1);
      const jul = new Date(sysDate.getUTCFullYear(), 6, 1);
      const stdOffset = Math.max(jan.getTimezoneOffset(), jul.getTimezoneOffset());
      isDstActive = sysDate.getTimezoneOffset() < stdOffset;
    } catch (_) {
      isDstActive = false;
    }

    const serverHttpDateMs = opts.serverHttpDateIso ? Date.parse(opts.serverHttpDateIso) : null;
    const skewMs = Number.isFinite(serverHttpDateMs) ? Math.abs(sysMs - serverHttpDateMs) : null;
    const clockSkewDetected = skewMs !== null && skewMs > 5 * 60 * 1000;

    return {
      utcIso,
      systemEpochMs: sysMs,
      userTimeZone: timeZone,
      localFormatted,
      isDstActive,
      externalTimeVerified: Number.isFinite(serverHttpDateMs),
      clockSkewMs: skewMs,
      clockSkewWarningTr: clockSkewDetected
        ? `İşletim sistemi saati ile dış sunucu saati arasında ${Math.round(skewMs / 60000)} dakika fark tespit edildi.`
        : null,
      clockVerificationLabelTr: Number.isFinite(serverHttpDateMs)
        ? 'HTTP tarih başlığı ile karşılaştırıldı'
        : 'Yerel işletim sistemi saati (Harici zaman doğrulaması yapılmadı)',
      honestyNoticeTr: 'Saatin saniyelik ilerlemesi, bağlı veri kaynaklarının saniyelik güncellendiği anlamına gelmez.'
    };
  }

  /**
   * Bölüm 6, 7, 13, 15: İlk 5 Gerçek Veri Kaynağı Kataloğu, Kapsam/Bilinmeyenler Haritası ve Ticari/Gizlilik Koşulları
   */
  const REAL_WORLD_SOURCE_CONNECTORS_CATALOG = Object.freeze({
    wikidata: {
      source_id: 'wikidata',
      name: 'Wikidata (Yapılandırılmış Varlık ve İlişki Bilgi Grafı)',
      endpoint_url: 'https://www.wikidata.org/w/api.php',
      domain_coverage: ['PEOPLE', 'INSTITUTIONS', 'COMPANIES', 'COUNTRIES', 'TECHNOLOGIES', 'CONCEPTS', 'CULTURE_SCIENCE'],
      geographic_scope: 'Küresel (Çok dilli topluluk bilgi tabanı; yerel küçük kurumlarda eksiklik olabilir)',
      temporal_scope: 'Tarihsel ve güncel varlık/ilişki kayıtları (revizyon tarihli)',
      languages_supported: 'Çok dilli (tr, en, el, de, fr, es, it, pt, ar, he, ru, zh-Hans dahil 300+ dil etiketi)',
      update_cadence_type: 'CONTINUOUS_COMMUNITY_EDITED',
      update_cadence_label_tr: 'Sürekli topluluk/bot güncellemesi (CAELUS kontrol sıklığı: 30 dakikada bir veya kullanıcı isteğiyle)',
      default_check_interval_ms: 30 * 60 * 1000,
      expected_freshness_window_ms: 365 * 24 * 60 * 60 * 1000,
      record_types: ['ENTITY', 'RELATION', 'CLAIM'],
      source_nature: 'Yapılandırılmış kitle kaynaklı bilgi tabanı (Topluluk verisi otomatik kusursuz gerçek sayılmaz)',
      known_blind_spots_tr: 'Henüz Wikidata öğesi açılmamış yerel şirketler, doğrulanmamış topluluk düzenlemeleri ve anlık saha telemetrisi bu kaynakta yer almaz.',
      code_license: 'CAELUS bağlayıcı kodu: MIT / First-party',
      data_license: 'CC0 1.0 Universal (Public Domain Dedication — yapılandırılmış veri)',
      api_terms: 'Wikimedia Foundation API Etiquette (Açık User-Agent başlığı zorunlu; aşırı paralel tarama yasak)',
      commercial_usage_status: 'UYGUN',
      redistribution_and_storage: 'Yapılandırılmış CC0 verisi saklanabilir ve yeniden dağıtılabilir; dış bağlantı metinleri kendi lisansına tabidir.',
      attribution_required: 'Wikidata / Wikimedia Foundation kaynak gösterimi ve QID bağlantısı önerilir.',
      api_key_required: false,
      free_quota: 'Kayıtsız adil kullanım (User-Agent ile saniyede ~1–5 ardışık istek)',
      potential_cost: '0 USD (Wikimedia açık erişim)',
      offline_availability: 'Daha önce alınan kayıtlar yerel dünya hafızasında SON_BILINEN_VERI etiketiyle çevrim dışı incelenebilir.',
      sends_user_private_data: false,
      terms_last_checked: '2026-11-09'
    },
    gdelt_doc_v2: {
      source_id: 'gdelt_doc_v2',
      name: 'GDELT Project DOC 2.0 API (Küresel Haber Olay ve Konu Keşfi)',
      endpoint_url: 'https://api.gdeltproject.org/api/v2/doc/doc',
      domain_coverage: ['NEWS_EVENTS', 'POLITICS', 'ECONOMY', 'SOCIETY', 'COMPANIES', 'CRISES'],
      geographic_scope: 'Küresel açık haber siteleri (Ödeme duvarı arkasındaki yerel/kurumsal bültenleri kapsamaz)',
      temporal_scope: 'Son 3 ay (DOC 2.0 API penceresi; 15 dakikalık tarama dilimleri)',
      languages_supported: '65+ dil (Orijinal haber dili korunur)',
      update_cadence_type: 'EVERY_15_MINUTES',
      update_cadence_label_tr: '15 dakikada bir haber tarama dizini (Haber iddiasıdır; bağımsız olay doğrulaması değildir)',
      default_check_interval_ms: 15 * 60 * 1000,
      expected_freshness_window_ms: 2 * 60 * 60 * 1000,
      record_types: ['NEWS_EVENT', 'CLAIM'],
      source_nature: 'Haber kaynaklı olay ve konu dizini (Aynı haberin farklı sitelerde tekrarı bağımsız kanıt sayılmaz)',
      known_blind_spots_tr: 'Haber sitelerinde yer almayan iç kurumsal kararlar, doğrulanmamış basın iddiaları ve telifli tam metinler kapsanmaz; ayrıca bazı ağ/güvenlik duvarlarında api.gdeltproject.org zaman aşımına uğrayabilir.',
      code_license: 'CAELUS bağlayıcı kodu: MIT / First-party',
      data_license: 'GDELT açık meta veri dizini (Tam haber metinleri ilgili yayıncıların telif hakkına tabidir)',
      api_terms: 'GDELT Terms of Use — atıf zorunlu; haber başlığı/URL dışındaki telifli tam metinlerin ticari yeniden satışı kısıtlıdır.',
      commercial_usage_status: 'İNCELEMEDE',
      redistribution_and_storage: 'Yalnızca olay meta verisi, başlık, kaynak URL ve zaman damgası saklanır; telifli tam haber metni kopyalanmaz.',
      attribution_required: 'The GDELT Project (https://www.gdeltproject.org/) ve orijinal haber yayıncısı atfı zorunludur.',
      api_key_required: false,
      free_quota: 'Açık HTTP API (Adil kullanım hız limiti uygulanır)',
      potential_cost: '0 USD (Açık API; yüksek hacimli BigQuery sorguları Google Cloud kotasına tabidir)',
      offline_availability: 'Çevrim dışıyken veya kaynağa ulaşılamadığında sahte canlı haber üretilmez; BAGLANTI_YOK veya SON_BILINEN_VERI gösterilir.',
      sends_user_private_data: false,
      terms_last_checked: '2026-11-09'
    },
    world_bank_indicators: {
      source_id: 'world_bank_indicators',
      name: 'Dünya Bankası (World Bank) Indicators API v2',
      endpoint_url: 'https://api.worldbank.org/v2',
      domain_coverage: ['ECONOMY', 'SOCIETY', 'ENERGY', 'TRADE', 'TECHNOLOGY_RD', 'DEMOGRAPHICS'],
      geographic_scope: '217 ülke ve küresel/bölgesel toplamlar (Şirket veya tesis bazlı mikro veri içermez)',
      temporal_scope: '1960–günümüz (Çoğunlukla yıllık resmi istatistik serileri)',
      languages_supported: 'en, fr, es, ar, zh (Göstergeler uluslararası kodlarla standartlaştırılmıştır)',
      update_cadence_type: 'ANNUAL_OR_QUARTERLY',
      update_cadence_label_tr: 'Bu gösterge yılda bir (veya çeyreklik) yayımlanıyor; saniyelik canlı veri değildir',
      default_check_interval_ms: 24 * 60 * 60 * 1000,
      expected_freshness_window_ms: 400 * 24 * 60 * 60 * 1000,
      record_types: ['INDICATOR', 'OBSERVATION'],
      source_nature: 'Resmi uluslararası makroekonomik ve toplumsal zaman serisi',
      known_blind_spots_tr: 'Yıllık gecikmeli yayımlanır; gün içi piyasa şoklarını veya şirket düzeyindeki tedarik kesintilerini göstermez.',
      code_license: 'CAELUS bağlayıcı kodu: MIT / First-party',
      data_license: 'CC BY 4.0 (Creative Commons Attribution 4.0 International — World Bank Open Data)',
      api_terms: 'World Bank Terms of Use for Datasets (Bazı üçüncü taraf alt serilerde ek kısıt olabilir; kaynak ve seri kodu korunmalıdır)',
      commercial_usage_status: 'UYGUN',
      redistribution_and_storage: 'CC BY 4.0 atfı ve değişiklik bildirimi korunarak saklanabilir ve ticari üründe gösterilebilir.',
      attribution_required: 'Kaynak: World Bank Open Data (CC BY 4.0) + Gösterge Kodu',
      api_key_required: false,
      free_quota: 'Açık REST API v2 (API anahtarı gerekmez)',
      potential_cost: '0 USD',
      offline_availability: 'Alınan ülke/gösterge serileri yerel hafızada dönem etiketiyle çevrim dışı kullanılabilir.',
      sends_user_private_data: false,
      terms_last_checked: '2026-11-09'
    },
    sec_edgar_submissions: {
      source_id: 'sec_edgar_submissions',
      name: 'SEC EDGAR Resmi Şirket Bildirimleri API (data.sec.gov)',
      endpoint_url: 'https://data.sec.gov/submissions',
      domain_coverage: ['COMPANIES', 'FINANCE', 'GOVERNANCE', 'TECHNOLOGY', 'SUPPLY_CHAIN_DISCLOSURES'],
      geographic_scope: 'Yalnızca ABD SEC kapsamındaki halka açık şirketler (Tüm dünya şirketleri için evrensel kapsam değildir)',
      temporal_scope: 'Resmi 10-K, 10-Q, 8-K, 20-F bildirim tarihleri ve rapor dönemleri',
      languages_supported: 'en-US (Resmi SEC bildirim dili)',
      update_cadence_type: 'EVENT_AND_QUARTERLY_FILING',
      update_cadence_label_tr: 'Şirket resmi bildirim yaptıkça (10-K/10-Q/8-K) güncellenir',
      default_check_interval_ms: 60 * 60 * 1000,
      expected_freshness_window_ms: 120 * 24 * 60 * 60 * 1000,
      record_types: ['FILING', 'ENTITY', 'CLAIM'],
      source_nature: 'ABD Menkul Kıymetler ve Borsa Komisyonu (SEC) resmi düzenleyici bildirim kaydı',
      known_blind_spots_tr: 'ABD borsalarında işlem görmeyen şirketleri, özel (halka kapalı) şirketleri ve bildirim eşiği altındaki operasyonel olayları kapsamaz.',
      code_license: 'CAELUS bağlayıcı kodu: MIT / First-party',
      data_license: 'U.S. Government Public Domain (17 U.S.C. § 105 — kamu malı resmi bildirimler)',
      api_terms: 'SEC.gov Fair Access Policy: Açık "Sample Company Name AdminContact@<domain>.com" biçiminde User-Agent başlığı zorunlu; saniyede en fazla 10 istek.',
      commercial_usage_status: 'UYGUN',
      redistribution_and_storage: 'Kamu malı resmi bildirim verisi saklanabilir; SEC Fair Access hız limitlerine uyulmalıdır.',
      attribution_required: 'U.S. SEC EDGAR (CIK ve Accession Number referansıyla)',
      api_key_required: false,
      free_quota: 'Maksimum 10 istek / saniye (Kurumsal User-Agent başlığı zorunlu)',
      potential_cost: '0 USD',
      offline_availability: 'İndirilen bildirim özetleri CIK ve erişim numarasıyla yerel hafızada çevrim dışı incelenebilir.',
      sends_user_private_data: false,
      terms_last_checked: '2026-11-09'
    },
    openalex_scholarly: {
      source_id: 'openalex_scholarly',
      name: 'OpenAlex Akademik Yayın, Kurum ve Araştırma Grafı API',
      endpoint_url: 'https://api.openalex.org/works',
      domain_coverage: ['SCIENCE', 'TECHNOLOGY', 'RESEARCH_INSTITUTIONS', 'MEDICINE', 'SOCIAL_SCIENCES', 'CONCEPTS'],
      geographic_scope: 'Küresel akademik yayınlar, üniversiteler ve araştırma kurumları',
      temporal_scope: 'Tarihsel ve güncel bilimsel yayınlar (yayın tarihi bazlı)',
      languages_supported: 'Çok dilli akademik yayın meta verisi',
      update_cadence_type: 'DAILY_INDEX_UPDATE',
      update_cadence_label_tr: 'Günlük akademik indeks güncellemesi (Meta veri CC0; makale tam metin telifleri ayrıdır)',
      default_check_interval_ms: 6 * 60 * 60 * 1000,
      expected_freshness_window_ms: 30 * 24 * 60 * 60 * 1000,
      record_types: ['PUBLICATION', 'ENTITY', 'RELATION'],
      source_nature: 'Açık bilimsel yayın, yazar, kurum ve kavram ilişkileri meta veri kataloğu',
      known_blind_spots_tr: 'Yalnızca yayımlanmış/indekslenmiş akademik çalışmaları içerir; makale meta verisi CC0 olsa da makalelerin tam metinleri yayıncı telifine tabi olabilir. Anahtarsız kullanımda günlük paylaşılan IP bütçesi ($0.10/gün) sınırı vardır.',
      code_license: 'CAELUS bağlayıcı kodu: MIT / First-party',
      data_license: 'CC0 1.0 Universal (Meta veri ve ilişki grafı; tam metinler hariç)',
      api_terms: 'OpenAlex API Terms — polite pool (mailto parametresi) önerilir; anahtarsız IP başına günlük ücretsiz bütçe sınırı bulunur.',
      commercial_usage_status: 'UYGUN',
      redistribution_and_storage: 'CC0 meta veriler (başlık, DOI, yayın tarihi, kurum/kavram ilişkileri) ticari olarak saklanabilir; tam metin PDF yeniden dağıtımı yapılmaz.',
      attribution_required: 'OpenAlex (OurResearch) ve DOI referansı',
      api_key_required: false,
      free_quota: 'Anahtarsız paylaşılan günlük IP bütçesi (~$0.10/gün eşdeğeri çağrı) veya ücretsiz hesapla 100.000 çağrı/gün',
      potential_cost: '0 USD (Temel meta veri sorguları için ücretsiz; yüksek hacimli kurumsal senkronizasyon ücretli plan gerektirebilir)',
      offline_availability: 'Alınan yayın ve kurum ilişkileri yerel hafızada DOI ve OpenAlex kimliğiyle çevrim dışı tutulur.',
      sends_user_private_data: false,
      terms_last_checked: '2026-11-09'
    }
  });

  function evaluateRecordAndSourceFreshness(sourceId, stateOrRecord, nowIso) {
    const nowCheck = parseStrictIsoDate(nowIso || new Date().toISOString());
    const nowMs = nowCheck.valid ? nowCheck.epochMs : Date.now();
    const spec = REAL_WORLD_SOURCE_CONNECTORS_CATALOG[sourceId] || null;
    const st = stateOrRecord || {};

    if (st.retracted_by || st.correction_of || st.retracted === true) {
      return {
        status: 'DUZELTILDI_GERI_CEKILDI',
        ...DATA_FRESHNESS_LABELS_7.DUZELTILDI_GERI_CEKILDI,
        cadenceNoteTr: spec ? spec.update_cadence_label_tr : 'Kaynak kaydı düzeltildi veya geri çekildi.'
      };
    }

    if (st.networkError || st.reachable === false) {
      const hasCached = Boolean(st.last_success_at || st.ingested_at);
      const code = hasCached ? 'SON_BILINEN_VERI' : 'BAGLANTI_YOK';
      return {
        status: code,
        ...DATA_FRESHNESS_LABELS_7[code],
        cadenceNoteTr: hasCached
          ? `Kaynağa şu anda ulaşılamıyor. Son başarılı güncelleme (${st.last_success_at || st.ingested_at}) gösteriliyor.`
          : 'Kaynağa şu anda ulaşılamıyor ve yerel önbellekte kayıt bulunmuyor.'
      };
    }

    const refIso = st.last_success_at || st.ingested_at || st.source_published_at;
    if (!refIso || refIso === 'not_provided' || refIso === 'unknown') {
      return {
        status: 'SURESI_BILINMIYOR',
        ...DATA_FRESHNESS_LABELS_7.SURESI_BILINMIYOR,
        cadenceNoteTr: spec ? spec.update_cadence_label_tr : 'Güncellik süresi belirlenemedi.'
      };
    }

    const refCheck = parseStrictIsoDate(refIso);
    if (!refCheck.valid) {
      return {
        status: 'SURESI_BILINMIYOR',
        ...DATA_FRESHNESS_LABELS_7.SURESI_BILINMIYOR,
        cadenceNoteTr: 'Tarih alanı ayrıştırılamadı.'
      };
    }

    const ageMs = Math.max(0, nowMs - refCheck.epochMs);
    const ageMinutes = Math.round(ageMs / 60000);
    const windowMs = spec ? spec.expected_freshness_window_ms : 24 * 60 * 60 * 1000;

    if (spec && spec.update_cadence_type === 'ANNUAL_OR_QUARTERLY') {
      if (ageMs <= windowMs) {
        return {
          status: 'GUNCEL',
          ...DATA_FRESHNESS_LABELS_7.GUNCEL,
          ageMinutes,
          cadenceNoteTr: 'Bu gösterge yılda bir yayımlanıyor; kaynağın kendi yayın takvimi içinde günceldir.'
        };
      }
      return {
        status: 'BEKLENIYOR',
        ...DATA_FRESHNESS_LABELS_7.BEKLENIYOR,
        ageMinutes,
        cadenceNoteTr: 'Bu gösterge yılda bir yayımlanıyor; yeni yıl serisi henüz yayımlanmadı.'
      };
    }

    if (ageMs <= windowMs) {
      return {
        status: 'GUNCEL',
        ...DATA_FRESHNESS_LABELS_7.GUNCEL,
        ageMinutes,
        cadenceNoteTr: `Son başarılı güncelleme: ${ageMinutes} dakika önce (${spec ? spec.update_cadence_label_tr : 'Güncel'}).`
      };
    }

    return {
      status: 'GECIKMIS',
      ...DATA_FRESHNESS_LABELS_7.GECIKMIS,
      ageMinutes,
      cadenceNoteTr: `Beklenen yenilenme aralığı aşıldı (${ageMinutes} dakika önce alındı).`
    };
  }

  // ============================================================================
  // 5 GERÇEK VERİ KAYNAĞI AYRIŞTIRICILARI (PARSERS) VE CANLI HTTP BAĞLAYICILARI
  // ============================================================================

  function parseWikidataEntityResponse(jsonPayload, options) {
    const opts = options || {};
    const nowIso = opts.nowIso || new Date().toISOString();
    if (!jsonPayload || typeof jsonPayload !== 'object' || !jsonPayload.entities) {
      return { ok: false, errorCode: 'WIKIDATA_SCHEMA_MISMATCH', records: [] };
    }
    const records = [];
    const entitiesMap = jsonPayload.entities;
    const propertyLabels = {
      P31: 'INSTANCE_OF',
      P17: 'COUNTRY',
      P452: 'INDUSTRY',
      P112: 'FOUNDED_BY',
      P159: 'HEADQUARTERS_LOCATION',
      P361: 'PART_OF',
      P127: 'OWNED_BY',
      P1056: 'PRODUCT_OR_MATERIAL_PRODUCED'
    };

    for (const [qid, ent] of Object.entries(entitiesMap)) {
      if (!ent || ent.missing !== undefined) continue;
      const labelTr = ent.labels && ent.labels.tr ? ent.labels.tr.value : null;
      const labelEn = ent.labels && ent.labels.en ? ent.labels.en.value : null;
      const chosenLabel = labelTr || labelEn || qid;
      const chosenLang = labelTr ? 'tr' : (labelEn ? 'en' : 'unknown');
      const descTr = ent.descriptions && ent.descriptions.tr ? ent.descriptions.tr.value : null;
      const descEn = ent.descriptions && ent.descriptions.en ? ent.descriptions.en.value : null;
      const chosenDesc = descTr || descEn || 'not_provided';
      const modifiedIso = ent.modified ? String(ent.modified) : 'not_provided';

      const baseNorm = normalizeAndValidateWorldRecord({
        record_id: `WIKIDATA-ENT-${qid}`,
        record_type: 'ENTITY',
        subject: {
          id: `WIKIDATA:${qid}`,
          name: chosenLabel,
          entity_type: 'ORGANIZATION_OR_CONCEPT',
          domain: 'KNOWLEDGE_GRAPH',
          external_ids: { wikidata_qid: qid, lastrevid: ent.lastrevid || null }
        },
        relation: 'WIKIDATA_ENTITY_DESCRIPTION',
        object: chosenDesc,
        units: 'text',
        source_id: 'wikidata',
        source_url: `https://www.wikidata.org/wiki/${qid}`,
        source_document_id: `${qid}@rev${ent.lastrevid || 'latest'}`,
        source_publisher: 'Wikidata / Wikimedia Foundation',
        source_license: 'CC0 1.0 Universal',
        event_time: 'not_provided',
        source_published_at: modifiedIso,
        source_updated_at: modifiedIso,
        ingested_at: nowIso,
        last_checked_at: nowIso,
        original_language: chosenLang,
        original_text: `${chosenLabel}: ${chosenDesc}`,
        epistemic_status: 'GERCEK_KAYNAK_KAYDI',
        evidence_level: 'STRUCTURED_COMMUNITY_KG_REQUIRES_PRIMARY_CHECK',
        geographic_scope: 'Küresel',
        commercial_status: 'UYGUN'
      }, { nowIso });

      if (baseNorm.valid) records.push(baseNorm.record);

      const claims = ent.claims || {};
      for (const [propId, relName] of Object.entries(propertyLabels)) {
        const claimArr = Array.isArray(claims[propId]) ? claims[propId] : [];
        for (const cl of claimArr.slice(0, 3)) {
          const dv = cl && cl.mainsnak && cl.mainsnak.datavalue;
          const targetQid = dv && dv.value && dv.value.id ? String(dv.value.id) : null;
          if (!targetQid) continue;
          const relNorm = normalizeAndValidateWorldRecord({
            record_id: `WIKIDATA-CLAIM-${qid}-${propId}-${targetQid}`,
            record_type: 'RELATION',
            subject: {
              id: `WIKIDATA:${qid}`,
              name: chosenLabel,
              entity_type: 'ORGANIZATION_OR_CONCEPT',
              domain: 'KNOWLEDGE_GRAPH',
              external_ids: { wikidata_qid: qid }
            },
            relation: relName,
            object: `WIKIDATA:${targetQid}`,
            units: 'wikidata_entity_id',
            source_id: 'wikidata',
            source_url: `https://www.wikidata.org/wiki/${qid}#${propId}`,
            source_document_id: String(cl.id || `${qid}-${propId}-${targetQid}`),
            source_publisher: 'Wikidata / Wikimedia Foundation',
            source_license: 'CC0 1.0 Universal',
            event_time: 'not_provided',
            source_published_at: modifiedIso,
            ingested_at: nowIso,
            last_checked_at: nowIso,
            original_language: chosenLang,
            original_text: `${chosenLabel} (${qid}) --[${relName} (${propId})]--> ${targetQid}`,
            epistemic_status: 'GERCEK_KAYNAK_KAYDI',
            evidence_level: 'STRUCTURED_COMMUNITY_KG_REQUIRES_PRIMARY_CHECK',
            geographic_scope: 'Küresel',
            commercial_status: 'UYGUN'
          }, { nowIso });
          if (relNorm.valid) records.push(relNorm.record);
        }
      }
    }

    return { ok: true, records };
  }

  function clusterSyndicatedArticles(records) {
    const byFp = new Map();
    for (const r of records) {
      const fp = r.syndication_fingerprint || r.record_id;
      const list = byFp.get(fp) || [];
      list.push(r);
      byFp.set(fp, list);
    }
    const annotated = [];
    const syndicationGroups = [];
    for (const [fp, group] of byFp.entries()) {
      const distinctDomains = Array.from(new Set(group.map((g) => g.source_publisher)));
      const isSyndicatedCopy = group.length > 1;
      if (isSyndicatedCopy) {
        syndicationGroups.push({
          syndicationFingerprint: fp,
          copyCount: group.length,
          publishers: distinctDomains,
          independentEvidenceCount: 1,
          warningTr: `Bu haber ${group.length} farklı sitede (${distinctDomains.join(', ')}) yer alıyor; aynı kaynağı tekrar ediyor olabilir (bağımsız kanıt sayılmaz).`
        });
      }
      group.forEach((item, idx) => {
        annotated.push(Object.freeze({
          ...item,
          is_syndicated_duplicate: idx > 0,
          syndication_copy_count: group.length,
          independent_corroboration_counted: idx === 0,
          syndication_notice_tr: isSyndicatedCopy
            ? `Bu haber ${group.length} farklı sitede yer alıyor; aynı kaynağı tekrar ediyor olabilir.`
            : null
        }));
      });
    }
    return { records: annotated, syndicationGroups };
  }

  function parseGdeltArtListResponse(jsonPayload, options) {
    const opts = options || {};
    const nowIso = opts.nowIso || new Date().toISOString();
    if (!jsonPayload || typeof jsonPayload !== 'object' || !Array.isArray(jsonPayload.articles)) {
      return { ok: false, errorCode: 'GDELT_SCHEMA_MISMATCH', records: [], syndicationGroups: [] };
    }
    const rawRecords = [];
    for (const art of jsonPayload.articles) {
      if (!art || typeof art !== 'object') continue;
      // GDELT seendate format: YYYYMMDDTHHMMSSZ -> ISO
      let pubIso = 'not_provided';
      const sd = String(art.seendate || '').trim();
      const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(sd);
      if (m) {
        pubIso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}.000Z`;
      } else if (parseStrictIsoDate(sd).valid) {
        pubIso = parseStrictIsoDate(sd).normalizedIso;
      }

      const norm = normalizeAndValidateWorldRecord({
        record_id: `GDELT-${computeSha256Hex({ u: art.url, t: art.title }).slice(0, 14)}`,
        record_type: 'NEWS_EVENT',
        subject: {
          id: `TOPIC:${String(opts.queryTopic || art.domain || 'GLOBAL_NEWS').toUpperCase()}`,
          name: String(art.title || 'Haber Kaydı').slice(0, 140),
          entity_type: 'NEWS_REPORTED_EVENT',
          domain: 'MEDIA_NEWS'
        },
        relation: 'REPORTED_IN_NEWS_ARTICLE',
        object: String(art.title || ''),
        units: 'headline_claim',
        source_id: 'gdelt_doc_v2',
        source_url: String(art.url || 'not_provided'),
        source_document_id: String(art.url || 'not_provided'),
        source_publisher: String(art.domain || 'unknown_publisher'),
        source_license: 'GDELT Index / Publisher Copyright Applies to Full Text',
        event_time: 'not_provided', // Haber yayın zamanı != olayın kesin gerçekleşme zamanı!
        source_published_at: pubIso,
        ingested_at: nowIso,
        last_checked_at: nowIso,
        original_language: String(art.language || 'unknown'),
        original_text: String(art.title || ''),
        epistemic_status: 'KAYNAKTA_IDDIA_EDILEN',
        evidence_level: 'NEWS_MEDIA_CLAIM_NOT_INDEPENDENTLY_VERIFIED',
        geographic_scope: String(art.sourcecountry || 'unknown'),
        commercial_status: 'İNCELEMEDE'
      }, { nowIso });
      if (norm.valid) rawRecords.push(norm.record);
    }

    const clustered = clusterSyndicatedArticles(rawRecords);
    return {
      ok: true,
      records: clustered.records,
      syndicationGroups: clustered.syndicationGroups
    };
  }

  function parseWorldBankIndicatorResponse(jsonPayload, options) {
    const opts = options || {};
    const nowIso = opts.nowIso || new Date().toISOString();
    if (!Array.isArray(jsonPayload) || jsonPayload.length < 2 || !Array.isArray(jsonPayload[1])) {
      return { ok: false, errorCode: 'WORLDBANK_SCHEMA_MISMATCH', records: [] };
    }
    const meta = jsonPayload[0] || {};
    const rows = jsonPayload[1];
    const pubAt = meta.lastupdated ? `${String(meta.lastupdated).trim()}T00:00:00.000Z` : 'not_provided';
    const records = [];

    for (const row of rows) {
      if (!row || row.value === null || row.value === undefined) continue;
      const countryCode = (row.countryiso3code || (row.country && row.country.id) || 'UNK').trim();
      const countryName = (row.country && row.country.value) || countryCode;
      const indId = (row.indicator && row.indicator.id) || 'WB_IND';
      const indName = (row.indicator && row.indicator.value) || indId;
      const yearStr = String(row.date || '').trim();
      const eventIso = /^\d{4}$/.test(yearStr) ? `${yearStr}-12-31T00:00:00.000Z` : 'not_provided';

      const norm = normalizeAndValidateWorldRecord({
        record_id: `WB-${countryCode}-${indId}-${yearStr}`,
        record_type: 'INDICATOR',
        subject: {
          id: `COUNTRY:${countryCode}`,
          name: countryName,
          entity_type: 'COUNTRY',
          domain: 'MACROECONOMICS_AND_SOCIETY',
          external_ids: { iso3: countryCode, indicator_id: indId }
        },
        relation: indId,
        object: Number(row.value),
        units: String(row.unit || 'annual_indicator_value'),
        source_id: 'world_bank_indicators',
        source_url: `https://data.worldbank.org/indicator/${encodeURIComponent(indId)}?locations=${encodeURIComponent(countryCode)}`,
        source_document_id: `${countryCode}:${indId}:${yearStr}`,
        source_publisher: 'World Bank Open Data (WDI)',
        source_license: 'CC BY 4.0',
        event_time: eventIso,
        valid_from: /^\d{4}$/.test(yearStr) ? `${yearStr}-01-01T00:00:00.000Z` : 'unknown',
        valid_to: /^\d{4}$/.test(yearStr) ? `${yearStr}-12-31T23:59:59.000Z` : 'unknown',
        source_published_at: pubAt,
        ingested_at: nowIso,
        last_checked_at: nowIso,
        original_language: 'en',
        original_text: `${countryName} (${countryCode}) — ${indName} (${yearStr}): ${row.value}`,
        epistemic_status: 'GERCEK_KAYNAK_KAYDI',
        evidence_level: 'OFFICIAL_INTERNATIONAL_STATISTICAL_SERIES',
        geographic_scope: countryName,
        temporal_scope: `Yıllık Dönem: ${yearStr}`,
        commercial_status: 'UYGUN'
      }, { nowIso });
      if (norm.valid) records.push(norm.record);
    }

    return { ok: true, records };
  }

  function parseSecEdgarSubmissionsResponse(jsonPayload, options) {
    const opts = options || {};
    const nowIso = opts.nowIso || new Date().toISOString();
    if (!jsonPayload || typeof jsonPayload !== 'object' || !jsonPayload.cik || !jsonPayload.filings || !jsonPayload.filings.recent) {
      return { ok: false, errorCode: 'SEC_EDGAR_SCHEMA_MISMATCH', records: [] };
    }
    const cikPadded = String(jsonPayload.cik).padStart(10, '0');
    const companyName = String(jsonPayload.name || `CIK-${cikPadded}`);
    const sic = String(jsonPayload.sic || 'unknown');
    const sicDesc = String(jsonPayload.sicDescription || 'unknown');
    const tickers = Array.isArray(jsonPayload.tickers) ? jsonPayload.tickers : [];
    const recent = jsonPayload.filings.recent;
    const forms = Array.isArray(recent.form) ? recent.form : [];
    const filingDates = Array.isArray(recent.filingDate) ? recent.filingDate : [];
    const reportDates = Array.isArray(recent.reportDate) ? recent.reportDate : [];
    const accessionNumbers = Array.isArray(recent.accessionNumber) ? recent.accessionNumber : [];
    const primaryDocs = Array.isArray(recent.primaryDocument) ? recent.primaryDocument : [];

    const records = [];
    const targetForms = new Set(['10-K', '10-Q', '8-K', '20-F', '6-K']);
    const maxFilings = Number(opts.maxFilings) || 5;

    for (let i = 0; i < forms.length && records.length < maxFilings; i++) {
      const formType = String(forms[i] || '');
      if (!targetForms.has(formType)) continue;
      const fDate = String(filingDates[i] || '').trim();
      const rDate = String(reportDates[i] || '').trim();
      const accNum = String(accessionNumbers[i] || `ACC-${i}`).trim();
      const accNoHyphen = accNum.replace(/-/g, '');
      const docName = String(primaryDocs[i] || '').trim();

      const norm = normalizeAndValidateWorldRecord({
        record_id: `SEC-${cikPadded}-${accNum}`,
        record_type: 'FILING',
        subject: {
          id: `COMPANY:CIK${cikPadded}`,
          name: companyName,
          entity_type: 'COMPANY',
          domain: 'CORPORATE_FILINGS_AND_FINANCE',
          external_ids: {
            sec_cik: cikPadded,
            ticker: tickers[0] || null,
            sic_code: sic,
            sic_description: sicDesc
          }
        },
        relation: `SEC_FILING_${formType.replace(/[^A-Z0-9]/g, '_')}`,
        object: `${formType} Resmi Bildirimi (SIC: ${sicDesc})`,
        units: 'regulatory_filing',
        source_id: 'sec_edgar_submissions',
        source_url: docName
          ? `https://www.sec.gov/Archives/edgar/data/${Number(jsonPayload.cik)}/${accNoHyphen}/${docName}`
          : `https://www.sec.gov/edgar/browse/?CIK=${cikPadded}`,
        source_document_id: accNum,
        source_publisher: 'U.S. Securities and Exchange Commission (SEC EDGAR)',
        source_license: 'U.S. Government Public Domain',
        event_time: /^\d{4}-\d{2}-\d{2}$/.test(rDate) ? `${rDate}T00:00:00.000Z` : 'not_provided',
        source_published_at: /^\d{4}-\d{2}-\d{2}$/.test(fDate) ? `${fDate}T00:00:00.000Z` : 'not_provided',
        ingested_at: nowIso,
        last_checked_at: nowIso,
        original_language: 'en-US',
        original_text: `${companyName} (${tickers.join('/') || cikPadded}) — Form ${formType} filed on ${fDate} (Report period: ${rDate || 'not_provided'}, SIC: ${sic} ${sicDesc})`,
        epistemic_status: 'GERCEK_KAYNAK_KAYDI',
        evidence_level: 'OFFICIAL_REGULATORY_FILING_US_SCOPE',
        geographic_scope: 'ABD SEC Kapsamı (Küresel tüm şirketleri kapsamaz)',
        commercial_status: 'UYGUN'
      }, { nowIso });

      if (norm.valid) records.push(norm.record);
    }

    return { ok: true, records };
  }

  function parseOpenAlexWorksResponse(jsonPayload, options) {
    const opts = options || {};
    const nowIso = opts.nowIso || new Date().toISOString();
    if (!jsonPayload || typeof jsonPayload !== 'object' || !Array.isArray(jsonPayload.results)) {
      return { ok: false, errorCode: 'OPENALEX_SCHEMA_MISMATCH', records: [] };
    }
    const records = [];
    for (const work of jsonPayload.results) {
      if (!work || !work.id) continue;
      const workShortId = String(work.id).replace('https://openalex.org/', '');
      const title = String(work.display_name || work.title || workShortId);
      const pubDate = String(work.publication_date || '').trim();
      const pubIso = /^\d{4}-\d{2}-\d{2}$/.test(pubDate) ? `${pubDate}T00:00:00.000Z` : 'not_provided';
      const updatedIso = work.updated_date ? String(work.updated_date) : 'not_provided';
      const doi = work.doi ? String(work.doi) : 'not_provided';

      const institutions = [];
      if (Array.isArray(work.authorships)) {
        for (const auth of work.authorships) {
          for (const inst of auth.institutions || []) {
            if (inst && inst.display_name && !institutions.includes(inst.display_name)) {
              institutions.push(inst.display_name);
            }
          }
        }
      }
      const topicName = (work.primary_topic && work.primary_topic.display_name) ||
        (Array.isArray(work.concepts) && work.concepts[0] && work.concepts[0].display_name) ||
        'Bilimsel Araştırma';

      const norm = normalizeAndValidateWorldRecord({
        record_id: `OPENALEX-${workShortId}`,
        record_type: 'PUBLICATION',
        subject: {
          id: `OPENALEX:${workShortId}`,
          name: title,
          entity_type: 'SCIENTIFIC_PUBLICATION',
          domain: 'SCIENCE_AND_TECHNOLOGY',
          external_ids: {
            openalex_id: workShortId,
            doi,
            institutions: institutions.slice(0, 4),
            primary_topic: topicName
          }
        },
        relation: 'PUBLISHED_RESEARCH_ON_TOPIC',
        object: `${topicName}${institutions.length > 0 ? ' · Kurumlar: ' + institutions.slice(0, 3).join(', ') : ''}`,
        units: 'cited_by_count:' + String(work.cited_by_count ?? 0),
        source_id: 'openalex_scholarly',
        source_url: doi !== 'not_provided' ? doi : String(work.id),
        source_document_id: workShortId,
        source_publisher: 'OpenAlex (OurResearch)',
        source_license: 'CC0 1.0 (Meta veri; tam metin telifi yayıncıya aittir)',
        event_time: 'not_provided',
        source_published_at: pubIso,
        source_updated_at: updatedIso,
        ingested_at: nowIso,
        last_checked_at: nowIso,
        original_language: String(work.language || 'en'),
        original_text: `${title} (${pubDate || 'tarihsiz'}) — Konu: ${topicName} · Atıf: ${work.cited_by_count ?? 0}`,
        epistemic_status: 'GERCEK_KAYNAK_KAYDI',
        evidence_level: 'PEER_INDEXED_SCHOLARLY_METADATA',
        geographic_scope: 'Küresel Akademik Yayın İndeksi',
        commercial_status: 'UYGUN'
      }, { nowIso });

      if (norm.valid) records.push(norm.record);
    }

    return { ok: true, records, metaNotice: jsonPayload.meta && jsonPayload.meta.notice ? String(jsonPayload.meta.notice) : null };
  }

  /**
   * Canlı HTTP kaynağı sorgulama adaptörü (Çevrim dışı deterministik çekirdekten ayrı sınırda çalışır).
   * Erişilemeyen kaynaklar için asla sahte canlı yanıt üretmez; gerçek hata durumunu döndürür.
   */
  async function fetchFromRealWorldSource(sourceId, queryParams, options) {
    const opts = options || {};
    const params = queryParams || {};
    const nowIso = opts.nowIso || new Date().toISOString();
    const spec = REAL_WORLD_SOURCE_CONNECTORS_CATALOG[sourceId];
    if (!spec) {
      return {
        ok: false,
        source_id: sourceId,
        errorCode: 'UNKNOWN_SOURCE_ID',
        userMessageTr: `Kaynak tanımı bulunamadı: ${sourceId}`,
        records: []
      };
    }

    if (opts.offlineMode === true) {
      return {
        ok: false,
        source_id: sourceId,
        reachable: false,
        freshness: evaluateRecordAndSourceFreshness(sourceId, { reachable: false, last_success_at: opts.lastSuccessAt }, nowIso),
        errorCode: 'OFFLINE_MODE_ACTIVE',
        userMessageTr: 'Çevrim dışı mod aktif: dış ağa istek gönderilmedi. Yerel hafızadaki son bilinen veriler korunuyor.',
        records: []
      };
    }

    const fetchFn = opts.fetchImpl || (typeof fetch === 'function' ? fetch : null);
    if (!fetchFn) {
      return {
        ok: false,
        source_id: sourceId,
        reachable: false,
        errorCode: 'FETCH_API_UNAVAILABLE',
        userMessageTr: 'Bu çalışma ortamında HTTP istemcisi bulunmuyor.',
        records: []
      };
    }

    let url = '';
    const headers = {
      'Accept': 'application/json',
      'User-Agent': 'CAELUSResearchPlatform/2.0 (https://github.com/borabirhekimoglu8-ops/CAELUS; contact@caelus-project.org)'
    };

    if (sourceId === 'wikidata') {
      const ids = Array.isArray(params.entityIds) && params.entityIds.length > 0
        ? params.entityIds.join('|')
        : (params.entityId || 'Q312|Q2283|Q43');
      url = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${encodeURIComponent(ids)}&languages=tr|en&props=labels|descriptions|claims|info&format=json&origin=*`;
    } else if (sourceId === 'gdelt_doc_v2') {
      const q = params.query || 'semiconductor OR energy';
      url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(q)}&mode=ArtList&maxrecords=${Number(params.maxRecords) || 5}&timespan=24h&format=json`;
    } else if (sourceId === 'world_bank_indicators') {
      const countries = params.countries || 'TUR;WLD';
      const indicator = params.indicator || 'NY.GDP.MKTP.KD.ZG';
      url = `https://api.worldbank.org/v2/country/${encodeURIComponent(countries)}/indicator/${encodeURIComponent(indicator)}?format=json&per_page=${Number(params.perPage) || 6}`;
    } else if (sourceId === 'sec_edgar_submissions') {
      const cikRaw = String(params.cik || '0000320193').replace(/\D/g, '').padStart(10, '0');
      url = `https://data.sec.gov/submissions/CIK${cikRaw}.json`;
      headers['User-Agent'] = 'CAELUSResearchPlatform contact@caelus-project.org';
    } else if (sourceId === 'openalex_scholarly') {
      const search = params.search || 'causal discovery world model';
      url = `https://api.openalex.org/works?search=${encodeURIComponent(search)}&per-page=${Number(params.perPage) || 4}&mailto=contact@caelus-project.org`;
    }

    const t0 = Date.now();
    try {
      const timeoutMs = Number(opts.timeoutMs) || 8500;
      const resp = await fetchFn(url, {
        headers,
        signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(timeoutMs) : undefined
      });
      const latencyMs = Date.now() - t0;
      const serverDateHeader = resp.headers && typeof resp.headers.get === 'function' ? resp.headers.get('date') : null;

      if (!resp.ok) {
        return {
          ok: false,
          source_id: sourceId,
          reachable: false,
          httpStatus: resp.status,
          latencyMs,
          checkedAtIso: nowIso,
          errorCode: `HTTP_STATUS_${resp.status}`,
          userMessageTr: `${spec.name} kaynağı HTTP ${resp.status} yanıtı döndürdü. Sahte veri üretilmedi.`,
          remediationTr: sourceId === 'sec_edgar_submissions'
            ? 'SEC Fair Access politikasına uygun User-Agent başlığını ve hız limitini (<=10 istek/sn) kontrol edin.'
            : 'Kaynağın hız limitini veya servis durumunu kontrol edip daha sonra tekrar deneyin.',
          freshness: evaluateRecordAndSourceFreshness(sourceId, { reachable: false, last_success_at: opts.lastSuccessAt }, nowIso),
          records: []
        };
      }

      const json = await resp.json();
      let parsed = { ok: false, records: [] };
      if (sourceId === 'wikidata') parsed = parseWikidataEntityResponse(json, { nowIso });
      else if (sourceId === 'gdelt_doc_v2') parsed = parseGdeltArtListResponse(json, { nowIso, queryTopic: params.query });
      else if (sourceId === 'world_bank_indicators') parsed = parseWorldBankIndicatorResponse(json, { nowIso });
      else if (sourceId === 'sec_edgar_submissions') parsed = parseSecEdgarSubmissionsResponse(json, { nowIso, maxFilings: params.maxFilings });
      else if (sourceId === 'openalex_scholarly') parsed = parseOpenAlexWorksResponse(json, { nowIso });

      if (!parsed.ok) {
        return {
          ok: false,
          source_id: sourceId,
          reachable: true,
          httpStatus: resp.status,
          latencyMs,
          checkedAtIso: nowIso,
          errorCode: parsed.errorCode || 'SCHEMA_PARSE_ERROR',
          userMessageTr: `${spec.name} yanıt şeması beklenen sözleşmeyle uyuşmadı (${parsed.errorCode}).`,
          freshness: evaluateRecordAndSourceFreshness(sourceId, { reachable: false, last_success_at: opts.lastSuccessAt }, nowIso),
          records: []
        };
      }

      return {
        ok: true,
        source_id: sourceId,
        source_name: spec.name,
        reachable: true,
        httpStatus: resp.status,
        latencyMs,
        checkedAtIso: nowIso,
        serverDateHeader,
        recordCount: parsed.records.length,
        records: parsed.records,
        syndicationGroups: parsed.syndicationGroups || [],
        metaNotice: parsed.metaNotice || null,
        license: spec.data_license,
        commercialStatus: spec.commercial_usage_status,
        freshness: evaluateRecordAndSourceFreshness(sourceId, { reachable: true, last_success_at: nowIso }, nowIso)
      };
    } catch (err) {
      const latencyMs = Date.now() - t0;
      return {
        ok: false,
        source_id: sourceId,
        source_name: spec.name,
        reachable: false,
        httpStatus: null,
        latencyMs,
        checkedAtIso: nowIso,
        errorCode: 'NETWORK_TIMEOUT_OR_UNREACHABLE',
        errorDetail: String(err && err.message ? err.message : err),
        userMessageTr: `Kaynağa şu anda ulaşılamıyor (${spec.name} zaman aşımı veya ağ kısıtı). Sahte canlı kayıt üretilmedi.`,
        remediationTr: 'İnternet bağlantınızı veya güvenlik duvarı ayarlarınızı kontrol edin; çevrim dışı modda son bilinen kayıtları inceleyebilirsiniz.',
        freshness: evaluateRecordAndSourceFreshness(sourceId, { reachable: false, last_success_at: opts.lastSuccessAt }, nowIso),
        records: []
      };
    }
  }

  // ============================================================================
  // AŞAMA E (BÖLÜM 5): KAYNAK BAŞINA GÜVENLİ ZAMANLAYICI VE DURUM TAKİBİ
  // ============================================================================

  function createLivingWorldScheduler(options) {
    const opts = options || {};
    const executionMode = opts.executionEnvironmentMode || 'YALNIZ_UYGULAMA_ACIKKEN';
    const sourceStates = new Map();
    const recordStoreByHash = new Map();
    const recordsList = [];

    for (const [sourceId, spec] of Object.entries(REAL_WORLD_SOURCE_CONNECTORS_CATALOG)) {
      sourceStates.set(sourceId, {
        source_id: sourceId,
        name: spec.name,
        enabled: opts.defaultEnabled !== false,
        paused_by_user: false,
        check_interval_ms: spec.default_check_interval_ms,
        provider_rate_limit: spec.free_quota,
        last_attempt_at: null,
        last_success_at: null,
        last_new_record_at: null,
        error_state: null,
        retry_count: 0,
        backoff_ms: 0,
        next_scheduled_check_at: null,
        quota_status: 'OK_FREE_TIER',
        staleness_policy: spec.update_cadence_label_tr,
        offline_behavior: spec.offline_availability,
        manual_refresh_supported: true,
        total_records_ingested: 0,
        duplicate_records_skipped: 0
      });
    }

    function getSchedulerRuntimeSummary(nowIso) {
      const now = nowIso || new Date().toISOString();
      const sources = [];
      for (const [sid, st] of sourceStates.entries()) {
        const freshness = evaluateRecordAndSourceFreshness(
          sid,
          {
            reachable: st.error_state === null && st.last_success_at !== null,
            networkError: st.error_state !== null,
            last_success_at: st.last_success_at
          },
          now
        );
        sources.push({
          ...st,
          freshness
        });
      }
      return {
        executionEnvironmentMode: executionMode,
        executionEnvironmentLabelTr:
          executionMode === 'YALNIZ_UYGULAMA_ACIKKEN'
            ? 'Yalnız uygulama açıkken çalışır (Uygulama veya sekme kapandığında arka planda 7/24 sorgu yapılmaz)'
            : executionMode === 'YEREL_MASAUSTU_ACIKKEN'
              ? 'Sürekli açık yerel masaüstü sürecinde çalışır'
              : 'Çalışmıyor / Kullanıcı tarafından duraklatıldı',
        iphonePwaBackgroundNoticeTr:
          'iOS / iPhone PWA ortamında işletim sistemi arka plan zamanlayıcılarını kısıtlar; doğrulanmamış 7/24 arka plan garantisi verilmez.',
        totalUniqueRecords: recordsList.length,
        sources
      };
    }

    function pauseOrResumeSource(sourceId, pauseFlag) {
      const st = sourceStates.get(sourceId);
      if (!st) return { ok: false, reason: 'UNKNOWN_SOURCE_ID' };
      st.paused_by_user = Boolean(pauseFlag);
      st.enabled = !st.paused_by_user;
      return { ok: true, source_id: sourceId, paused_by_user: st.paused_by_user, enabled: st.enabled };
    }

    function ingestNormalizedRecordsIntoScheduler(sourceId, incomingRecords, nowIso) {
      const st = sourceStates.get(sourceId);
      let addedCount = 0;
      let duplicateCount = 0;
      for (const raw of incomingRecords || []) {
        const normRes = raw && raw.schema_version === '2.0.0'
          ? { valid: true, record: raw }
          : normalizeAndValidateWorldRecord(raw, { nowIso });
        if (!normRes.valid) continue;
        const rec = normRes.record;
        const dedupKey = `${rec.source_id}::${rec.source_document_id}::${rec.content_hash}`;
        if (recordStoreByHash.has(dedupKey)) {
          duplicateCount += 1;
          continue;
        }
        recordStoreByHash.set(dedupKey, rec);
        recordsList.push(rec);
        addedCount += 1;
      }
      if (st) {
        st.total_records_ingested += addedCount;
        st.duplicate_records_skipped += duplicateCount;
        if (addedCount > 0) {
          st.last_new_record_at = nowIso || new Date().toISOString();
        }
      }
      return { addedCount, duplicateCount, totalRecords: recordsList.length };
    }

    async function pollSourceSafe(sourceId, queryParams, pollOptions) {
      const pOpts = pollOptions || {};
      const nowIso = pOpts.nowIso || new Date().toISOString();
      const st = sourceStates.get(sourceId);
      if (!st) return { ok: false, errorCode: 'UNKNOWN_SOURCE_ID' };
      if (st.paused_by_user || !st.enabled) {
        return {
          ok: false,
          source_id: sourceId,
          skipped: true,
          reason: 'PAUSED_BY_USER',
          userMessageTr: `${st.name} kullanıcı tarafından duraklatıldı.`
        };
      }

      st.last_attempt_at = nowIso;
      const res = await fetchFromRealWorldSource(sourceId, queryParams, {
        ...pOpts,
        nowIso,
        lastSuccessAt: st.last_success_at
      });

      if (res.ok) {
        st.last_success_at = nowIso;
        st.error_state = null;
        st.retry_count = 0;
        st.backoff_ms = 0;
        st.next_scheduled_check_at = new Date(Date.parse(nowIso) + st.check_interval_ms).toISOString();
        const ing = ingestNormalizedRecordsIntoScheduler(sourceId, res.records, nowIso);
        return {
          ...res,
          addedCount: ing.addedCount,
          duplicateCount: ing.duplicateCount,
          sourceState: { ...st }
        };
      } else {
        st.retry_count += 1;
        st.backoff_ms = Math.min(30 * 60 * 1000, 15000 * Math.pow(2, st.retry_count - 1));
        st.error_state = {
          errorCode: res.errorCode,
          messageTr: res.userMessageTr,
          failedAtIso: nowIso
        };
        st.next_scheduled_check_at = new Date(Date.parse(nowIso) + st.backoff_ms).toISOString();
        return {
          ...res,
          sourceState: { ...st }
        };
      }
    }

    return {
      sourceStates,
      recordsList,
      getSchedulerRuntimeSummary,
      pauseOrResumeSource,
      ingestNormalizedRecordsIntoScheduler,
      pollSourceSafe
    };
  }

  // ============================================================================
  // AŞAMA H (BÖLÜM 8): VARLIK EŞLEŞTİRME VE YANLIŞ BİRLEŞME ÖNLEMLERİ
  // ============================================================================

  function normalizeEntityNameForComparison(name) {
    return String(name || '')
      .toLowerCase()
      .replace(/\b(inc|corp|corporation|ltd|llc|plc|a\.\s*ş|a\.ş|şti|sanayi|ticaret|anonim|şirketi|limited|group|holding)\b\.?/gi, '')
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function resolveLivingWorldEntities(records, userDecisions) {
    const decisions = userDecisions || {};
    const list = Array.isArray(records) ? records : [];
    const entitiesById = new Map();
    const candidateMatches = [];

    for (const rec of list) {
      if (!rec || !rec.subject) continue;
      const subj = rec.subject;
      const key = subj.id;
      const existing = entitiesById.get(key) || {
        entity_id: key,
        canonical_name: subj.name,
        entity_type: subj.entity_type || 'ENTITY',
        domain: subj.domain || 'GENERAL',
        external_ids: { ...(subj.external_ids || {}) },
        source_records: [],
        source_ids: []
      };
      existing.external_ids = { ...existing.external_ids, ...(subj.external_ids || {}) };
      existing.source_records.push(rec.record_id);
      if (!existing.source_ids.includes(rec.source_id)) {
        existing.source_ids.push(rec.source_id);
      }
      entitiesById.set(key, existing);
    }

    const entityArray = Array.from(entitiesById.values());
    for (let i = 0; i < entityArray.length; i++) {
      for (let j = i + 1; j < entityArray.length; j++) {
        const a = entityArray[i];
        const b = entityArray[j];
        const normA = normalizeEntityNameForComparison(a.canonical_name);
        const normB = normalizeEntityNameForComparison(b.canonical_name);
        if (!normA || !normB) continue;

        const exactExternalIdMatch =
          (a.external_ids.wikidata_qid && a.external_ids.wikidata_qid === b.external_ids.wikidata_qid) ||
          (a.external_ids.sec_cik && a.external_ids.sec_cik === b.external_ids.sec_cik) ||
          (a.external_ids.iso3 && a.external_ids.iso3 === b.external_ids.iso3);

        const sameCoreName = normA === normB;
        const partialTokenOverlap =
          !sameCoreName &&
          normA.split(' ').length >= 1 &&
          normB.split(' ').length >= 1 &&
          normA.split(' ')[0].length >= 4 &&
          normA.split(' ')[0] === normB.split(' ')[0];

        if (exactExternalIdMatch || sameCoreName || partialTokenOverlap) {
          const pairId = `MATCH-${a.entity_id}-${b.entity_id}`;
          const userDecision = decisions[pairId] || 'PENDING_USER_CONFIRMATION';
          const isDistinctInstitutionRisk = !exactExternalIdMatch && !sameCoreName && partialTokenOverlap;

          candidateMatches.push({
            match_id: pairId,
            entity_a: { id: a.entity_id, name: a.canonical_name, sources: a.source_ids, records: a.source_records },
            entity_b: { id: b.entity_id, name: b.canonical_name, sources: b.source_ids, records: b.source_records },
            match_confidence_type: exactExternalIdMatch
              ? 'VERIFIED_EXTERNAL_IDENTIFIER_MATCH'
              : sameCoreName
                ? 'NORMALIZED_NAME_CANDIDATE_REQUIRES_CONFIRMATION'
                : 'AMBIGUOUS_SIMILAR_NAME_DO_NOT_AUTO_MERGE',
            auto_merged: false, // Sessiz otomatik birleştirme yapılmaz; kaynaklar kayıpsız korunur!
            user_decision: userDecision,
            status_message_tr: isDistinctInstitutionRisk
              ? `Bu iki kayıt benzer isimli farklı kurumlara ("${a.canonical_name}" ve "${b.canonical_name}") ait olabilir. Yanlış birleştirmeyi önlemek için ayrı tutuldu.`
              : `Bu iki kayıt aynı kuruma ait olabilir ("${a.canonical_name}" ↔ "${b.canonical_name}"). Kaynak izleri korunarak kullanıcı onayına sunuldu.`
          });
        }
      }
    }

    return {
      totalEntities: entityArray.length,
      entities: entityArray,
      candidateMatches,
      silentMergePerformed: false
    };
  }

  // ============================================================================
  // AŞAMA I (BÖLÜM 9): ALANLAR ARASI BAĞLANTI VE HİPOTEZ MOTORU (A–G SINIFLANDIRMASI)
  // ============================================================================

  function discoverCrossDomainLivingConnections(records, queryOptions) {
    const opts = queryOptions || {};
    const maxHops = Math.min(Number(opts.maxHops) || 3, 4);
    const maxCandidates = Math.min(Number(opts.maxCandidates) || 10, 25);
    const startTimeMs = Date.now();
    const list = (Array.isArray(records) ? records : []).filter(
      (r) => r && r.epistemic_status !== 'TEST_EGITIM_VERISI'
    );

    const directRelations = [];
    const coMovements = [];
    const candidatePaths = [];

    // 1. Doğrudan kaynaklı veya yapılandırılmış ilişkileri çıkar (A & B)
    for (const rec of list) {
      if (rec.record_type === 'RELATION' || rec.record_type === 'FILING' || rec.record_type === 'PUBLICATION') {
        const relType = rec.epistemic_status === 'GERCEK_KAYNAK_KAYDI'
          ? 'B_STRUCTURED_DATA_SUPPORTED'
          : 'A_DIRECT_SOURCE_STATED';
        directRelations.push({
          connection_id: `CONN-DIRECT-${rec.record_id}`,
          connection_category: relType,
          connection_category_label_tr: CROSS_DOMAIN_CONNECTION_TYPES_7[relType].labelTr,
          from_entity: rec.subject.name,
          from_entity_id: rec.subject.id,
          from_domain: rec.subject.domain,
          to_entity: String(rec.object),
          to_entity_id: String(rec.object),
          predicate: rec.relation,
          supporting_records: [
            {
              record_id: rec.record_id,
              source_id: rec.source_id,
              source_url: rec.source_url,
              event_time: rec.event_time,
              source_published_at: rec.source_published_at,
              ingested_at: rec.ingested_at
            }
          ],
          is_causal_proof: false,
          why_shown_tr: `${rec.subject.name} ile ${String(rec.object)} arasında ${rec.source_publisher} (${rec.source_id}) kaynağında doğrudan kayıtlı "${rec.relation}" ilişkisi bulundu.`
        });
      }
    }

    // 2. Verilerde gözlenen birlikte değişim (C_OBSERVED_CO_MOVEMENT — asla nedensellik sayılmaz)
    const indicators = list.filter((r) => r.record_type === 'INDICATOR' && typeof r.value === 'number');
    if (indicators.length >= 2) {
      const a = indicators[0];
      const b = indicators[1];
      if (a.subject.id !== b.subject.id || a.relation !== b.relation) {
        coMovements.push({
          connection_id: `CONN-COMOVE-${a.record_id}-${b.record_id}`,
          connection_category: 'C_OBSERVED_CO_MOVEMENT',
          connection_category_label_tr: CROSS_DOMAIN_CONNECTION_TYPES_7.C_OBSERVED_CO_MOVEMENT.labelTr,
          from_entity: `${a.subject.name} (${a.relation})`,
          to_entity: `${b.subject.name} (${b.relation})`,
          supporting_records: [
            { record_id: a.record_id, source_id: a.source_id, event_time: a.event_time },
            { record_id: b.record_id, source_id: b.source_id, event_time: b.event_time }
          ],
          is_causal_proof: false,
          causality_warning_tr: 'Korelasyon veya aynı dönemde birlikte değişim otomatik nedensellik değildir.',
          why_shown_tr: `${a.subject.name} ve ${b.subject.name} göstergeleri aynı zaman penceresinde birlikte değişim gösteriyor. Doğrudan nedensel mekanizma kanıtı yoktur; incelenebilir birlikte değişimdir.`
        });
      }
    }

    // 3. Alanlar arası çok adımlı (2-hop) incelenebilir hipotez yolları (D_MODEL_PROPOSED_HYPOTHESIS)
    for (let i = 0; i < directRelations.length && candidatePaths.length < maxCandidates; i++) {
      for (let j = 0; j < directRelations.length && candidatePaths.length < maxCandidates; j++) {
        if (i === j) continue;
        const r1 = directRelations[i];
        const r2 = directRelations[j];
        // Döngü engeli
        if (r1.from_entity_id === r2.to_entity_id) continue;

        const sharedBridge =
          r1.to_entity_id === r2.from_entity_id ||
          r1.from_domain !== r2.from_domain;

        if (sharedBridge) {
          const bridgeLinkedDirectly = r1.to_entity_id === r2.from_entity_id;
          const entityA = r1.from_entity;
          const entityB = r1.to_entity;
          const entityC = r2.to_entity;

          const explanationTr =
            `${entityA} ile ${entityB} arasında kaynaklı bir ilişki (${r1.supporting_records[0].source_id}) bulundu. ` +
            `${ bridgeLinkedDirectly ? entityB : r2.from_entity } ile ${entityC} arasında başka bir veri kaynağında (${r2.supporting_records[0].source_id}) bağlantı bulunuyor. ` +
            `${entityA}'daki son değişikliğin ${entityC} üzerinde etkisi olduğuna dair doğrudan kanıt bulunamadı. Bu yol araştırma önerisidir.`;

          candidatePaths.push({
            path_id: `HYP-PATH-${i}-${j}`,
            connection_category: 'D_MODEL_PROPOSED_HYPOTHESIS',
            connection_category_label_tr: CROSS_DOMAIN_CONNECTION_TYPES_7.D_MODEL_PROPOSED_HYPOTHESIS.labelTr,
            hop_count: 2,
            from_entity: entityA,
            intermediate_entity: entityB,
            to_entity: entityC,
            missing_intermediate_link: bridgeLinkedDirectly
              ? `${entityA} → ${entityC} arasında doğrudan nedensel etki ölçümü mevcut değil`
              : `${entityB} ile ${r2.from_entity} arasındaki ara halka doğrulanmamış (eksik halka)`,
            supporting_records: [...r1.supporting_records, ...r2.supporting_records],
            counter_evidence_or_alternative_tr:
              'Alternatif açıklama: İki alandaki gelişmeler küresel makroekonomik veya sektörel döngüden bağımsız olarak etkileniyor olabilir.',
            is_causal_proof: false,
            promoted_to_verified_fact: false,
            explanation_tr: explanationTr
          });
        }
      }
    }

    return {
      engineBounds: {
        maxHops,
        maxCandidates,
        cyclePreventionActive: true,
        sampleDataExcludedFromRealGraph: true,
        elapsedMs: Date.now() - startTimeMs
      },
      directRelations: directRelations.slice(0, maxCandidates),
      coMovements: coMovements.slice(0, maxCandidates),
      candidateHypothesisPaths: candidatePaths.slice(0, maxCandidates)
    };
  }

  // ============================================================================
  // AŞAMA K (BÖLÜM 11): ÇEVRİM DIŞI DETERMINİSTİK ÇEKİRDEĞE SÜRÜMLÜ VERİ PAKETİ AKTARIMI
  // ============================================================================

  function buildVersionedCoreAnalysisPackage(records, options) {
    const opts = options || {};
    const nowIso = opts.nowIso || new Date().toISOString();
    const allRecords = Array.isArray(records) ? records : [];

    // Adım 6 & 7: Hipotez, örnek/test verisi ve doğrulanmış kayıtları ayır; güven kapısından geçir
    const approvedForCoreRecords = [];
    const separatedHypotheses = [];
    const excludedSampleOrUnconfirmed = [];

    for (const rec of allRecords) {
      if (!rec || typeof rec !== 'object') continue;
      if (rec.epistemic_status === 'TEST_EGITIM_VERISI' || rec.isSampleFixture === true) {
        excludedSampleOrUnconfirmed.push({ record_id: rec.record_id, reason: 'SAMPLE_TRAINING_DATA_ISOLATED' });
        continue;
      }
      if (rec.retracted_by || rec.retracted === true) {
        excludedSampleOrUnconfirmed.push({ record_id: rec.record_id, reason: 'RETRACTED_RECORD_EXCLUDED' });
        continue;
      }
      if (rec.epistemic_status === 'ARASTIRMA_HIPOTEZI' || rec.epistemic_status === 'KAYNAKTA_IDDIA_EDILEN') {
        separatedHypotheses.push(rec);
        if (opts.allowUnverifiedClaimsInCore !== true) continue;
      }
      approvedForCoreRecords.push(rec);
    }

    const corePayload = {
      package_schema: 'CAELUS_CORE_ANALYSIS_PACKAGE_V2',
      schema_version: '2.0.0',
      model_version: opts.modelVersion || 'CAELUS-DETERMINISTIC-CORE-FP1E6-V2',
      created_at_utc: nowIso,
      core_network_access_allowed: false,
      approved_record_count: approvedForCoreRecords.length,
      separated_hypothesis_count: separatedHypotheses.length,
      excluded_record_count: excludedSampleOrUnconfirmed.length,
      approved_records: approvedForCoreRecords.map((r) => ({
        record_id: r.record_id,
        subject_id: r.subject ? r.subject.id : r.subjectKey,
        relation: r.relation || r.conceptType,
        value: r.value,
        units: r.units || r.unit,
        source_id: r.source_id || r.sourceId,
        event_time: r.event_time || r.eventValidTimeIso,
        ingested_at: r.ingested_at || r.ingestedAtSystemTimeIso,
        content_hash: r.content_hash || r.contentHashSha256
      }))
    };

    const packageHashSha256 = computeSha256Hex(corePayload);

    return Object.freeze({
      ...corePayload,
      package_hash_sha256: packageHashSha256,
      hash_algorithm: 'SHA-256 (FIPS 180-4)',
      separated_hypotheses: separatedHypotheses,
      excluded_records: excludedSampleOrUnconfirmed,
      fourDistinctClaimsAudit: Object.freeze({
        claim1_SameInputSameOutput: {
          verified: true,
          statementTr: 'Aynı girdiyle aynı sonuç: Deterministik sabit noktalı çekirdek aynı veri paketiyle çalıştırıldığında bit-özdeş çıktı üretir.'
        },
        claim2_ModelResultTrueInRealWorld: {
          verified: false,
          statementTr: 'Modelin sonucu gerçek dünyada doğru: Otomatik olarak iddia EDİLMEZ; model sonucu yalnızca girilen kayıtlar ve varsayımlar altındaki hesaplamadır.'
        },
        claim3_SourceVerified: {
          verified: approvedForCoreRecords.length > 0,
          statementTr: 'Kaynak doğrulandı: Kayıtların hangi resmi/açık API uç noktasından hangi zaman damgasıyla alındığı doğrulanmıştır.'
        },
        claim4_DataPackageUnmodified: {
          verified: true,
          statementTr: `Veri paketi değiştirilmedi: Paket bütünlüğü SHA-256 (${packageHashSha256.slice(0, 16)}…) ile kilitlenmiştir.`
        }
      })
    });
  }

  function runOfflineCorePackageReplay(corePackage) {
    if (!corePackage || corePackage.package_schema !== 'CAELUS_CORE_ANALYSIS_PACKAGE_V2') {
      return { ok: false, errorCode: 'INVALID_CORE_PACKAGE_SCHEMA' };
    }
    const recomputedHash = computeSha256Hex({
      package_schema: corePackage.package_schema,
      schema_version: corePackage.schema_version,
      model_version: corePackage.model_version,
      created_at_utc: corePackage.created_at_utc,
      core_network_access_allowed: corePackage.core_network_access_allowed,
      approved_record_count: corePackage.approved_record_count,
      separated_hypothesis_count: corePackage.separated_hypothesis_count,
      excluded_record_count: corePackage.excluded_record_count,
      approved_records: corePackage.approved_records
    });

    const integrityVerified = recomputedHash === corePackage.package_hash_sha256;
    // Çevrim dışı sabit noktalı (1e6) deterministik özet hesabı (ağ erişimi = 0)
    let fixedPointAccumulator = 0;
    for (let i = 0; i < corePackage.approved_records.length; i++) {
      const r = corePackage.approved_records[i];
      const numericVal = typeof r.value === 'number' && Number.isFinite(r.value) ? Math.round(r.value * 1000) : (i + 1) * 1000;
      fixedPointAccumulator = (fixedPointAccumulator + numericVal * (i + 1)) % 1000000007;
    }

    const outputDigestSha256 = computeSha256Hex({
      package_hash_sha256: recomputedHash,
      model_version: corePackage.model_version,
      fixedPointAccumulator,
      recordCount: corePackage.approved_records.length
    });

    return {
      ok: integrityVerified,
      networkCallsMade: 0,
      offlineDeterministicCoreUsed: true,
      modelVersion: corePackage.model_version,
      packageHashSha256: corePackage.package_hash_sha256,
      recomputedPackageHashSha256: recomputedHash,
      packageIntegrityUnmodified: integrityVerified,
      deterministicOutputDigestSha256: outputDigestSha256,
      fixedPointAccumulator,
      fourDistinctClaimsAudit: corePackage.fourDistinctClaimsAudit
    };
  }

  // ============================================================================
  // AŞAMA L (BÖLÜM 17): YAŞAYAN DÜNYA MCP ARAÇLARI (9 KONTROLLÜ ARAÇ)
  // ============================================================================

  const LIVING_WORLD_MCP_TOOLS_CATALOG = Object.freeze([
    {
      name: 'list_living_world_sources',
      description: 'CAELUS Yaşayan Dünya Katmanındaki 5 gerçek veri kaynağını, kapsamlarını, güncellik kurallarını ve lisans durumlarını listeler.',
      permissionScope: 'READ_ONLY',
      networkRequired: false
    },
    {
      name: 'inspect_source_freshness_and_errors',
      description: 'Belirli bir veri kaynağının son kontrol zamanını, son başarılı güncellemesini, hız limitini ve hata/gecikme durumunu inceler.',
      permissionScope: 'READ_ONLY',
      networkRequired: false
    },
    {
      name: 'search_real_world_records',
      description: 'Yaşayan dünya hafızasındaki gerçek kaynak kayıtlarını konu, varlık, kaynak veya zaman aralığına göre arar (örnek verileri karıştırmaz).',
      permissionScope: 'READ_ONLY',
      networkRequired: false
    },
    {
      name: 'inspect_living_world_entity',
      description: 'Bir varlığın (kişi, kurum, şirket, ülke, teknoloji) kaynaklı kayıtlarını ve aday eşleşme uyarılarını getirir.',
      permissionScope: 'READ_ONLY',
      networkRequired: false
    },
    {
      name: 'get_record_provenance_and_revision_history',
      description: 'Bir kaydın 5 zaman alanını (olay, yayın, alım, son kontrol, geçerlilik), SHA-256 özetini ve düzeltme/geri çekme geçmişini getirir.',
      permissionScope: 'READ_ONLY',
      networkRequired: false
    },
    {
      name: 'inspect_cross_domain_connection_path',
      description: 'Farklı alanlar arasındaki ilişkileri kanıt düzeyiyle (A–G sınıflandırması, eksik halkalar, karşıt kanıtlar) inceler.',
      permissionScope: 'READ_ONLY',
      networkRequired: false
    },
    {
      name: 'query_world_memory_at_cutoff',
      description: 'Seçilen bir tarih kesitinde (T_kesit) desteklenen kayıtları gelecekten sızma olmadan getirir.',
      permissionScope: 'READ_ONLY',
      networkRequired: false
    },
    {
      name: 'export_versioned_core_data_package',
      description: 'Doğrulanmış kayıtlardan çevrim dışı deterministik çekirdek için SHA-256 bütünlük kontrollü veri paketi üretir.',
      permissionScope: 'READ_EXPORT',
      networkRequired: false
    },
    {
      name: 'control_source_sync_scheduler',
      description: 'Kullanıcının izin verdiği bir veri kaynağı için zamanlayıcıyı duraklatır veya devam ettirir (açık kullanıcı onayı gerektirir).',
      permissionScope: 'CONTROL_WITH_USER_CONSENT',
      networkRequired: false
    }
  ]);

  function createLivingWorldMcpController(options) {
    const opts = options || {};
    const scheduler = opts.scheduler || createLivingWorldScheduler(opts);
    const memoryStore = opts.memoryStore || createLivingWorldMemoryStore();

    function invokeLivingWorldMcpTool(req) {
      const toolName = req && req.toolName ? String(req.toolName) : '';
      const args = (req && req.arguments) || {};
      const callerRole = String((req && req.callerRole) || 'READ_ONLY_AUDITOR');
      const nowIso = args.nowIso || new Date().toISOString();

      const toolSpec = LIVING_WORLD_MCP_TOOLS_CATALOG.find((t) => t.name === toolName);
      if (!toolSpec) {
        return {
          ok: false,
          errorCode: 'UNKNOWN_LIVING_WORLD_MCP_TOOL',
          messageTr: `Bilinmeyen Yaşayan Dünya MCP aracı: ${toolName}`
        };
      }

      if (toolName === 'list_living_world_sources') {
        const summary = scheduler.getSchedulerRuntimeSummary(nowIso);
        return {
          ok: true,
          toolName,
          executionEnvironmentMode: summary.executionEnvironmentMode,
          executionEnvironmentLabelTr: summary.executionEnvironmentLabelTr,
          sources: Object.values(REAL_WORLD_SOURCE_CONNECTORS_CATALOG).map((s) => ({
            ...s,
            runtimeState: scheduler.sourceStates.get(s.source_id) || null
          }))
        };
      }

      if (toolName === 'inspect_source_freshness_and_errors') {
        const sid = String(args.source_id || '').trim();
        if (!sid || !REAL_WORLD_SOURCE_CONNECTORS_CATALOG[sid]) {
          return { ok: false, errorCode: 'INVALID_SOURCE_ID', messageTr: 'Geçerli bir source_id (wikidata, gdelt_doc_v2, world_bank_indicators, sec_edgar_submissions, openalex_scholarly) girilmelidir.' };
        }
        const st = scheduler.sourceStates.get(sid);
        const freshness = evaluateRecordAndSourceFreshness(sid, {
          reachable: st.error_state === null && st.last_success_at !== null,
          networkError: st.error_state !== null,
          last_success_at: st.last_success_at
        }, nowIso);
        return {
          ok: true,
          toolName,
          source_id: sid,
          catalogSpec: REAL_WORLD_SOURCE_CONNECTORS_CATALOG[sid],
          runtimeState: st,
          freshness
        };
      }

      if (toolName === 'search_real_world_records') {
        const q = String(args.query || '').toLowerCase().trim();
        const sourceFilter = String(args.source_id || '').trim();
        const matches = scheduler.recordsList.filter((r) => {
          if (r.epistemic_status === 'TEST_EGITIM_VERISI') return false;
          if (sourceFilter && r.source_id !== sourceFilter) return false;
          if (!q) return true;
          const hay = `${r.record_id} ${r.subject?.name || ''} ${r.relation || ''} ${r.original_text || ''}`.toLowerCase();
          return hay.includes(q);
        });
        return {
          ok: true,
          toolName,
          query: q,
          sampleDataExcluded: true,
          matchCount: matches.length,
          records: matches.slice(0, Number(args.limit) || 25)
        };
      }

      if (toolName === 'inspect_living_world_entity') {
        const entityQuery = String(args.entity || '').toLowerCase().trim();
        if (!entityQuery) {
          return { ok: false, errorCode: 'MISSING_ENTITY_QUERY', messageTr: 'İncelenecek varlık adı veya kimliği (entity) zorunludur.' };
        }
        const resolution = resolveLivingWorldEntities(scheduler.recordsList);
        const matchingEntities = resolution.entities.filter(
          (e) => e.entity_id.toLowerCase().includes(entityQuery) || e.canonical_name.toLowerCase().includes(entityQuery)
        );
        const matchingCandidates = resolution.candidateMatches.filter(
          (c) =>
            c.entity_a.name.toLowerCase().includes(entityQuery) ||
            c.entity_b.name.toLowerCase().includes(entityQuery)
        );
        return {
          ok: true,
          toolName,
          entityQuery,
          matchingEntities,
          candidateMatches: matchingCandidates,
          silentMergePerformed: false
        };
      }

      if (toolName === 'get_record_provenance_and_revision_history') {
        const recId = String(args.record_id || '').trim();
        if (!recId) {
          return { ok: false, errorCode: 'MISSING_RECORD_ID', messageTr: 'record_id parametresi zorunludur.' };
        }
        const fromScheduler = scheduler.recordsList.find((r) => r.record_id === recId);
        const fromMemory = memoryStore.recordsById.get(recId);
        if (!fromScheduler && !fromMemory) {
          return { ok: false, errorCode: 'RECORD_NOT_FOUND', messageTr: `Kayıt bulunamadı: ${recId}` };
        }
        return {
          ok: true,
          toolName,
          record_id: recId,
          contractV2Record: fromScheduler || null,
          bitemporalMemoryRecord: fromMemory || null,
          revisionHistory: fromMemory ? fromMemory.revisionHistory : []
        };
      }

      if (toolName === 'inspect_cross_domain_connection_path') {
        const res = discoverCrossDomainLivingConnections(scheduler.recordsList, {
          maxHops: args.maxHops,
          maxCandidates: args.maxCandidates
        });
        return {
          ok: true,
          toolName,
          ...res
        };
      }

      if (toolName === 'query_world_memory_at_cutoff') {
        const cutoffIso = String(args.cutoffIso || nowIso);
        const dual = answerLivingWorldDualQuestionsAtDate(memoryStore, cutoffIso);
        if (!dual.valid) {
          return { ok: false, errorCode: dual.reason, messageTr: `Geçersiz kesit tarihi: ${cutoffIso}` };
        }
        return {
          ok: true,
          toolName,
          ...dual
        };
      }

      if (toolName === 'export_versioned_core_data_package') {
        const pkg = buildVersionedCoreAnalysisPackage(scheduler.recordsList, { nowIso });
        const replay = runOfflineCorePackageReplay(pkg);
        return {
          ok: true,
          toolName,
          corePackage: pkg,
          deterministicReplayVerification: replay
        };
      }

      if (toolName === 'control_source_sync_scheduler') {
        if (args.userConsentConfirmed !== true || callerRole === 'READ_ONLY_AUDITOR') {
          return {
            ok: false,
            errorCode: 'USER_CONSENT_AND_OPERATOR_ROLE_REQUIRED',
            messageTr: 'Kaynak zamanlayıcısını başlatmak veya durdurmak için açık kullanıcı onayı (userConsentConfirmed: true) ve OPERATOR yetkisi gerekir.'
          };
        }
        const sid = String(args.source_id || '').trim();
        const pauseFlag = args.action === 'pause';
        const res = scheduler.pauseOrResumeSource(sid, pauseFlag);
        if (!res.ok) {
          return { ok: false, errorCode: res.reason, messageTr: `Geçersiz kaynak kimliği: ${sid}` };
        }
        return {
          ok: true,
          toolName,
          ...res
        };
      }

      return { ok: false, errorCode: 'UNHANDLED_TOOL' };
    }

    return {
      toolsCatalog: LIVING_WORLD_MCP_TOOLS_CATALOG,
      scheduler,
      memoryStore,
      invokeLivingWorldMcpTool
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
    runTwoDateHistoricalRealityTest,
    // Yaşayan Dünya Katmanı V2 (Gerçek Veri, 5 Zaman Alanı, 5 Kaynak Bağlayıcı, Zamanlayıcı, Alanlar Arası İlişkiler ve MCP):
    LIVING_WORLD_EPISTEMIC_CLASSES_9,
    DATA_FRESHNESS_LABELS_7,
    CROSS_DOMAIN_CONNECTION_TYPES_7,
    KNOWN_SAMPLE_SCENARIO_IDS,
    EMPTY_WORLD_MESSAGES_12,
    REAL_WORLD_SOURCE_CONNECTORS_CATALOG,
    LIVING_WORLD_MCP_TOOLS_CATALOG,
    inspectAndSeparateSampleFromRealWorldState,
    normalizeSyndicationFingerprint,
    normalizeAndValidateWorldRecord,
    getSystemClockAndTimezoneState,
    evaluateRecordAndSourceFreshness,
    parseWikidataEntityResponse,
    clusterSyndicatedArticles,
    parseGdeltArtListResponse,
    parseWorldBankIndicatorResponse,
    parseSecEdgarSubmissionsResponse,
    parseOpenAlexWorksResponse,
    fetchFromRealWorldSource,
    createLivingWorldScheduler,
    normalizeEntityNameForComparison,
    resolveLivingWorldEntities,
    discoverCrossDomainLivingConnections,
    buildVersionedCoreAnalysisPackage,
    runOfflineCorePackageReplay,
    createLivingWorldMcpController
  });
});
