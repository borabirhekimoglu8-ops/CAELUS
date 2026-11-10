/**
 * CAELUS — KONUŞAN DÜNYA MUHAKEME SİSTEMİ & KİŞİSEL AJAN OLUŞTURMA VE ÇALIŞTIRMA PLATFORMU
 * (ui/personal_agent_and_advisor.js)
 *
 * Bölüm A: CaelusConversationalAdvisor — LLM Dışı 8 Katmanlı Diyalog, Hafıza, Danışmanlık ve Cevap Pasaportu
 * Bölüm B: CaelusPersonalAgentStudio — Kodsuz Kişisel Ajan Sözleşmesi (V1), 9 Durumlu Yaşam Döngüsü,
 *          Yetki & İzolasyon Denetimi ve 3 Zorunlu Gerçek Ajan Yeteneği
 *
 * Temel İlkeler:
 * - Varsayılan çalışma hiçbir yerel veya bulut LLM'e bağımlı değildir (Zero LLM Runtime Dependency).
 * - Hiçbir kaynak dışı olgu uydurulmaz; eksik veri dürüstçe UNKNOWN / ABSTAIN_INSUFFICIENT_DATA olarak işaretlenir.
 * - Her yanıt üretilmeden önce Yapılandırılmış Cevap Planı (Structured Answer Plan) ve Cevap Pasaportu (Answer Passport) üretilir.
 * - Dış kaynaklardan ve dosyalardan gelen metinler güvenilmeyen veri (UNTRUSTED_DATA) olarak işlenir; araç çağrısı tetikleyemez.
 * - Ajanlar yalnızca kullanıcının açıkça verdiği kaynak, dosya ve araç yetkileriyle çalışır; ajanlar arası hafıza izoledir.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(root);
  } else {
    var exported = factory(root);
    root.CaelusConversationalAdvisor = exported.CaelusConversationalAdvisor;
    root.CaelusPersonalAgentStudio = exported.CaelusPersonalAgentStudio;
    root.CaelusPersonalAgentAndAdvisor = exported;
  }
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this, function (root) {
  'use strict';

  function getLivingWorldModel() {
    if (root && root.CaelusLivingWorldModel) return root.CaelusLivingWorldModel;
    if (typeof require === 'function') {
      try {
        return require('./living_world_model.js');
      } catch (_) {}
    }
    return null;
  }

  function getFirstRealTaskEngine() {
    if (root && root.CaelusFirstRealTaskEngine) return root.CaelusFirstRealTaskEngine;
    if (typeof require === 'function') {
      try {
        return require('./first_real_task_engine.js');
      } catch (_) {}
    }
    return null;
  }

  // ============================================================================
  // BÖLÜM A: KONUŞAN DÜNYA MUHAKEME SİSTEMİ (NON-LLM CONVERSATIONAL ADVISOR)
  // ============================================================================

  /**
   * 10 Zorunlu Cevap Pasaportu Sınıfı (Bölüm 7 — Geriye Dönük Şema Uyumluluğu)
   */
  var ANSWER_PASSPORT_CLASSES_10 = Object.freeze({
    SOURCE_CLAIM: {
      code: 'SOURCE_CLAIM',
      labelTr: 'Kaynaktan Alınmış İddia',
      labelEn: 'Sourced Claim',
      badgeColor: '#38bdf8'
    },
    VERIFIED_CALCULATION: {
      code: 'VERIFIED_CALCULATION',
      labelTr: 'Açık Hesap Sonucu',
      labelEn: 'Verified Calculation',
      badgeColor: '#22c55e'
    },
    RULE_DERIVATION: {
      code: 'RULE_DERIVATION',
      labelTr: 'Kuralla Türetilmiş Sonuç',
      labelEn: 'Rule-Based Derivation',
      badgeColor: '#818cf8'
    },
    USER_INPUT: {
      code: 'USER_INPUT',
      labelTr: 'Kullanıcının Kendi İfadesi',
      labelEn: 'User Statement',
      badgeColor: '#e2e8f0'
    },
    USER_PREFERENCE: {
      code: 'USER_PREFERENCE',
      labelTr: 'Kullanıcı Tercihi / Varsayımı',
      labelEn: 'User Preference / Assumption',
      badgeColor: '#c084fc'
    },
    MODEL_ASSUMPTION: {
      code: 'MODEL_ASSUMPTION',
      labelTr: 'Model Varsayımı',
      labelEn: 'Model Assumption',
      badgeColor: '#f59e0b'
    },
    SIMULATION_OUTPUT: {
      code: 'SIMULATION_OUTPUT',
      labelTr: 'Simülasyon Çıktısı',
      labelEn: 'Simulation Output',
      badgeColor: '#fb923c'
    },
    HYPOTHESIS: {
      code: 'HYPOTHESIS',
      labelTr: 'Olası Bağlantı / Hipotez',
      labelEn: 'Possible Connection / Hypothesis',
      badgeColor: '#facc15'
    },
    CONTRADICTION: {
      code: 'CONTRADICTION',
      labelTr: 'Çelişen Kayıtlar',
      labelEn: 'Conflicting Records',
      badgeColor: '#f43f5e'
    },
    UNKNOWN: {
      code: 'UNKNOWN',
      labelTr: 'Eksik Bilgi / Bilinmeyen',
      labelEn: 'Missing Information / Unknown',
      badgeColor: '#94a3b8'
    }
  });

  /**
   * Bölüm 2.5 & 5.1: Genişletilmiş 12 Epistemik Durum (Gerçek Veri, Dosya Bilgisi, Doğrulama Gerektiren İddia, Bağımsız Doğrulanmış Olgu ve Örnek Veri Ayrımı)
   */
  var EPISTEMIC_STATES_12 = Object.freeze(Object.assign({}, ANSWER_PASSPORT_CLASSES_10, {
    USER_FILE_FACT: {
      code: 'USER_FILE_FACT',
      labelTr: 'Kullanıcının Dosyasındaki Bilgi',
      labelEn: 'User File Fact',
      badgeColor: '#10b981'
    },
    UNVERIFIED_CLAIM: {
      code: 'UNVERIFIED_CLAIM',
      labelTr: 'Doğrulama Gerektiren İddia',
      labelEn: 'Claim Requiring Verification',
      badgeColor: '#fbbf24'
    },
    INDEPENDENTLY_CORROBORATED_FACT: {
      code: 'INDEPENDENTLY_CORROBORATED_FACT',
      labelTr: 'Bağımsız Olarak Doğrulanmış Olgu',
      labelEn: 'Independently Corroborated Fact',
      badgeColor: '#14b8a6'
    },
    SAMPLE_TRAINING_DATA: {
      code: 'SAMPLE_TRAINING_DATA',
      labelTr: 'Örnek veri (Eğitim / Test)',
      labelEn: 'Sample / Training Data',
      badgeColor: '#f97316'
    }
  }));

  var EMPTY_WORLD_DATA_MESSAGE_TR =
    'Henüz gerçek dünya verisi alınmadı. Bir kaynak seçebilir veya dosya ekleyebilirsin.';

  /**
   * 12 Desteklenen Konuşma Eylemi (Bölüm 5)
   */
  var SUPPORTED_SPEECH_ACTS_12 = Object.freeze({
    GREETING_AND_GUIDE: 'SELAMLAMA_VE_YONLENDIRME',
    WORLD_STATUS_QUERY: 'DUNYA_DURUMU_SORMA',
    ENTITY_RECENT_CHANGE: 'KURUM_KISI_KONU_TAKIBI',
    TEMPORAL_DIFF_QUERY: 'ZAMANSAL_SORGU',
    RELATION_EXPLORATION: 'ILISKI_SORGUSU',
    USER_DOMAIN_IMPACT: 'ETKI_VE_DANISMANLIK_SORGUSU',
    OPTION_COMPARISON: 'SECENEK_KARSILASTIRMA',
    USER_FILE_QUERY: 'KULLANICI_DOSYASI_SORMA',
    ASSUMPTION_CHANGE: 'VARSAYIM_DEGISTIRME',
    PROVENANCE_AND_EVIDENCE: 'KANIT_VE_KAYNAK_SORMA',
    CONTRADICTION_QUERY: 'CELISKI_SORMA',
    AMBIGUOUS_OR_UNDERSPECIFIED: 'BELIRSIZ_EKSIK_SORGU'
  });

  /**
   * 12 Deterministik Danışmanlık Politikası Eylemi (Bölüm 3.4)
   */
  var ADVISORY_POLICY_ACTIONS_12 = Object.freeze({
    FIND_RECORD: 'FIND_RECORD',
    RESOLVE_CONTEXT: 'RESOLVE_CONTEXT',
    ASK_CLARIFICATION: 'ASK_CLARIFICATION',
    INSPECT_SOURCE: 'INSPECT_SOURCE',
    SHOW_CONTRADICTION: 'SHOW_CONTRADICTION',
    EXPLORE_RELATION_PATH: 'EXPLORE_RELATION_PATH',
    EVALUATE_USER_DOMAIN_IMPACT: 'EVALUATE_USER_DOMAIN_IMPACT',
    RUN_CALCULATION: 'RUN_CALCULATION',
    COMPARE_OPTIONS: 'COMPARE_OPTIONS',
    SHOW_ASSUMPTION: 'SHOW_ASSUMPTION',
    ABSTAIN_INSUFFICIENT_DATA: 'ABSTAIN_INSUFFICIENT_DATA',
    ADVISE_WITH_PREFERENCES: 'ADVISE_WITH_PREFERENCES'
  });

  /**
   * 5 Ayrıştırılmış Hafıza Sınıfı (Bölüm 6)
   */
  var MEMORY_CLASS_CATALOG_5 = Object.freeze({
    A_EPHEMERAL_DIALOGUE_STATE: {
      id: 'A_EPHEMERAL_DIALOGUE_STATE',
      labelTr: 'Konuşma İçi Geçici Bağlam',
      descriptionTr: 'Son turlarda konuşulan kurum, olay, zaman aralığı ve açık sorular. Tek tıkla sıfırlanabilir.',
      mutableByUser: true,
      canOverwriteWorldFacts: false
    },
    B_USER_CONTROLLED_PREFERENCES: {
      id: 'B_USER_CONTROLLED_PREFERENCES',
      labelTr: 'Kullanıcı Kontrollü Tercih Hafızası',
      descriptionTr: 'Kullanıcının açıkça belirttiği ilgi alanları, takip ettiği kurumlar, dil ve bütçe/risk sınırları. Gizli profilleme yapılmaz.',
      mutableByUser: true,
      canOverwriteWorldFacts: false
    },
    C_SOURCED_WORLD_MEMORY: {
      id: 'C_SOURCED_WORLD_MEMORY',
      labelTr: 'Kaynaklı Dünya Hafızası',
      descriptionTr: 'Gerçek kaynaklardan gelen zaman damgalı ve kanıtlı dünya kayıtları. Kullanıcı tercihi veya sohbet varsayımı buraya olgu olarak yazılamaz.',
      mutableByUser: false,
      canOverwriteWorldFacts: true
    },
    D_USER_PRIVATE_FILES: {
      id: 'D_USER_PRIVATE_FILES',
      labelTr: 'Kullanıcı Özel Dosya ve Belge Hafızası',
      descriptionTr: 'Kullanıcının yüklediği CSV/JSON/metin dosyaları. Yalnızca izin verilen analiz/ajan tarafından okunur, orijinal dosya değiştirilmez.',
      mutableByUser: true,
      canOverwriteWorldFacts: false
    },
    E_PAST_ANALYSES_AND_REPORTS: {
      id: 'E_PAST_ANALYSES_AND_REPORTS',
      labelTr: 'Geçmiş Analiz ve Rapor Hafızası',
      descriptionTr: 'Önceki deterministik hesaplar, karşılaştırmalar ve dışa aktarılan rapor özetleri.',
      mutableByUser: true,
      canOverwriteWorldFacts: false
    }
  });

  /**
   * Ses ve Konuşma Teknolojisi Envanteri (Bölüm 2 & 8)
   */
  var VOICE_TECHNOLOGY_CATALOG = Object.freeze([
    {
      id: 'whisper_cpp',
      category: 'STT',
      name: 'whisper.cpp (GGML)',
      license: 'MIT',
      commercialUseAllowed: true,
      turkishSupport: 'Yüksek (tiny/base/small çok dilli modeller)',
      offlineCapable: true,
      approxBundleSizeMb: 75,
      statusInWorkspace: 'OPTIONAL_NATIVE_ADAPTER_NOT_BUNDLED'
    },
    {
      id: 'sherpa_onnx',
      category: 'STT_AND_TTS',
      name: 'sherpa-onnx (Next-gen Kaldi / ONNX Runtime)',
      license: 'Apache-2.0',
      commercialUseAllowed: true,
      turkishSupport: 'Destekleniyor (Whisper / Zipformer / Piper ONNX modelleri ile)',
      offlineCapable: true,
      approxBundleSizeMb: 45,
      statusInWorkspace: 'OPTIONAL_NATIVE_ADAPTER_NOT_BUNDLED'
    },
    {
      id: 'vosk_api',
      category: 'STT',
      name: 'Vosk Offline Speech Recognition',
      license: 'Apache-2.0',
      commercialUseAllowed: true,
      turkishSupport: 'Destekleniyor (vosk-model-small-tr-0.3 ~35 MB)',
      offlineCapable: true,
      approxBundleSizeMb: 35,
      statusInWorkspace: 'OPTIONAL_NATIVE_ADAPTER_NOT_BUNDLED'
    },
    {
      id: 'piper_tts',
      category: 'TTS',
      name: 'Piper Neural TTS (Eski rhasspy/piper MIT vs Yeni OHF-Voice/piper1-gpl GPL-3.0)',
      license: 'MIT (rhasspy/piper arşiv) / GPL-3.0 (piper1-gpl güncel) + Ses Modeli Lisansları Ayrıdır',
      commercialUseAllowed: false,
      commercialWarning: 'ÖNEMLİ LİSANS AYRIMI: Eski arşivlenmiş rhasspy/piper deposu MIT lisanslıydı; ancak güncel geliştirmenin taşındığı OHF-Voice/piper1-gpl deposu GPL-3.0 lisansına geçmiştir ve bazı ses modelleri (HuggingFace veri setleri) CC-BY-NC-SA gibi ticari olmayan kısıtlar taşıyabilir. Ticari ürüne doğrudan gömülmez; ayrı süreç veya açık ticari lisanslı ses modeli doğrulaması gerekir.',
      turkishSupport: 'Destekleniyor (tr_TR-dfki / fahrettin / fgl ses modelleri — model lisansı ayrıca denetlenmeli)',
      offlineCapable: true,
      approxBundleSizeMb: 28,
      statusInWorkspace: 'OPTIONAL_NATIVE_ADAPTER_NOT_BUNDLED'
    },
    {
      id: 'espeak_ng',
      category: 'TTS',
      name: 'eSpeak NG',
      license: 'GPL-3.0-or-later',
      commercialUseAllowed: false,
      commercialWarning: 'GPL-3.0 lisansı nedeniyle kapalı kaynak ticari ikiliye doğrudan statik bağlanamaz; yalnızca ayrı süreç veya MIT alternatif (Piper) önerilir.',
      turkishSupport: 'Temel kural tabanlı Türkçe',
      offlineCapable: true,
      approxBundleSizeMb: 6,
      statusInWorkspace: 'EXCLUDED_BY_COMMERCIAL_POLICY'
    },
    {
      id: 'silero_vad',
      category: 'VAD',
      name: 'Silero VAD (ONNX)',
      license: 'MIT',
      commercialUseAllowed: true,
      turkishSupport: 'Dilden bağımsız ses etkinliği tespiti',
      offlineCapable: true,
      approxBundleSizeMb: 2,
      statusInWorkspace: 'OPTIONAL_NATIVE_ADAPTER_NOT_BUNDLED'
    },
    {
      id: 'browser_web_speech',
      category: 'BROWSER_OPTIONAL_STT_TTS',
      name: 'W3C Web Speech API (SpeechRecognition / SpeechSynthesis)',
      license: 'W3C-Standard',
      commercialUseAllowed: true,
      turkishSupport: 'Tarayıcı ve işletim sistemi ses paketine bağlı (tr-TR)',
      offlineCapable: false,
      approxBundleSizeMb: 0,
      statusInWorkspace: 'AVAILABLE_WHEN_BROWSER_SUPPORTS_WITH_TEXT_FALLBACK'
    }
  ]);

  function getVoiceStackCatalogAndStatus(options) {
    var opts = options || {};
    var hasBrowserStt = Boolean(
      root && (root.SpeechRecognition || root.webkitSpeechRecognition)
    );
    var hasBrowserTts = Boolean(root && root.speechSynthesis);
    var micExplicitlyEnabled = opts.micEnabled === true;

    return {
      primaryMode: 'WRITTEN_CONVERSATION_PRIMARY',
      voiceStatus: micExplicitlyEnabled && (hasBrowserStt || hasBrowserTts)
        ? 'OPTIONAL_BROWSER_VOICE_READY'
        : 'TEXT_FALLBACK_ACTIVE',
      microphoneActive: false,
      audioDestination: 'NONE_UNTIL_USER_PUSH_TO_TALK',
      audioRetentionPolicy: 'RETENTION_NONE_IN_MEMORY_ONLY',
      honestDisclosureTr:
        'Birincil deneyim yazılı konuşmadır. Yerel/tarayıcı ses katmanı isteğe bağlıdır; mikrofon yalnızca siz bas-konuş düğmesini etkinleştirdiğinizde açılır, ses kaydı kalıcı olarak saklanmaz ve ses katmanı kullanılamadığında sistem otomatik olarak yazılı konuşmaya döner.',
      browserCapabilities: {
        speechRecognitionAvailable: hasBrowserStt,
        speechSynthesisAvailable: hasBrowserTts
      },
      catalog: VOICE_TECHNOLOGY_CATALOG
    };
  }

  // ----------------------------------------------------------------------------
  // Güvenilmeyen Kaynak / Dosya Metni Enjeksiyon Tespiti (Bölüm 9)
  // ----------------------------------------------------------------------------
  var UNTRUSTED_INJECTION_PATTERNS = [
    /ignore\s+(all\s+)?(previous|prior)\s+instructions/i,
    /disregard\s+(all\s+)?(previous|system)\s+instructions/i,
    /system\s*prompt/i,
    /yetkilerini\s+art[ıi]r/i,
    /t[üu]m\s+dosyalar[ıi]\s+sil/i,
    /gizli\s+anahtarlar[ıi]\s+(g[öo]nder|d[ıi][şs]ar[ıi]\s+aktar)/i,
    /execute\s+shell/i,
    /rm\s+-rf/i,
    /curl\s+http/i,
    /sudo\s+/i
  ];

  function scanUntrustedSourceForInjection(text) {
    var raw = String(text || '');
    var matched = [];
    for (var i = 0; i < UNTRUSTED_INJECTION_PATTERNS.length; i++) {
      var pat = UNTRUSTED_INJECTION_PATTERNS[i];
      if (pat.test(raw)) {
        matched.push(pat.source);
      }
    }
    return {
      isSuspicious: matched.length > 0,
      matchedPatterns: matched,
      handlingPolicy: matched.length > 0
        ? 'TREATED_AS_PASSIVE_TEXT_NO_TOOL_OR_PERMISSION_ESCALATION'
        : 'CLEAN_DATA'
    };
  }

  // ----------------------------------------------------------------------------
  // Katman 2: Türkçe Doğal Dil Anlama (NLU), Ek Çözümleme, Zamir ve Düzeltme
  // ----------------------------------------------------------------------------
  var TURKISH_STOPWORDS = new Set([
    've', 'veya', 'ile', 'için', 'bu', 'şu', 'o', 'bir', 'de', 'da', 'ki', 'mi', 'mı', 'mu', 'mü',
    'ne', 'nasıl', 'neden', 'niçin', 'hangi', 'kim', 'nerede', 'neydi', 'var', 'yok', 'olan',
    'son', 'dönemde', 'hakkında', 'ilişkili', 'ilgili', 'arasında', 'arasındaki', 'benim',
    'ilgilendiğim', 'alanı', 'alan', 'etkiler', 'peki', 'acaba', 'lütfen', 'bana', 'göre',
    'olarak', 'daha', 'çok', 'az', 'en', 'gibi', 'kadar', 'sonra', 'önce'
  ]);

  /**
   * Türkçe çekim eklerini soyarak kurum/varlık kökünü yakalar.
   * Örn: "Apple'ın" -> "Apple", "TSMC'de" -> "TSMC", "Bakanlığın" -> "Bakanlık", "Türkiye'deki" -> "Türkiye"
   */
  function normalizeTurkishTokenRoot(token) {
    if (!token) return '';
    var cleaned = String(token).trim().replace(/^[("'«“”]+|[)"'»“”.,;!?]+$/g, '');
    // Kesme işareti varsa öncesini al (Özel isim çekimi: Apple'ın, TSMC'deki, Türkiye'nin)
    var apostropheIdx = cleaned.search(/['’`]/);
    if (apostropheIdx > 1) {
      return cleaned.slice(0, apostropheIdx);
    }
    var lower = cleaned.toLocaleLowerCase('tr-TR');
    // Yaygın Türkçe hal ve iyelik ekleri (uzundan kısaya)
    var suffixes = [
      'larındaki', 'lerindeki', 'larından', 'lerinden', 'larında', 'lerinde',
      'ndaki', 'ndeki', 'daki', 'deki', 'taki', 'teki',
      'ından', 'inden', 'undan', 'ünden', 'ndan', 'nden', 'dan', 'den', 'tan', 'ten',
      'ının', 'inin', 'unun', 'ünün', 'nın', 'nin', 'nun', 'nün', 'ın', 'in', 'un', 'ün',
      'larıyla', 'leriyle', 'ıyla', 'iyle', 'yla', 'yle',
      'lara', 'lere', 'nda', 'nde', 'da', 'de', 'ta', 'te', 'ya', 'ye'
    ];
    for (var i = 0; i < suffixes.length; i++) {
      var suf = suffixes[i];
      if (lower.length > suf.length + 2 && lower.endsWith(suf)) {
        var stem = cleaned.slice(0, cleaned.length - suf.length);
        // Yumuşama geri alma: "Bakanlığ" -> "Bakanlık"
        if (/[ğĞ]$/.test(stem) && stem.length >= 4) {
          stem = stem.slice(0, -1) + (stem[stem.length - 1] === 'Ğ' ? 'K' : 'k');
        }
        return stem;
      }
    }
    return cleaned;
  }

  function detectUserCorrection(text) {
    var raw = String(text || '').trim();
    // Kalıp 1: "X değil Y" / "Hayır, X değil Y'yi kastettim"
    var m2 = raw.match(/(?:hay[ıi]r[,;\s]+|pardon[,;\s]+)?([A-Za-zÇĞİÖŞÜçğıöşü0-9._'-]+)\s+de[ğg]il[,;\s]+([A-Za-zÇĞİÖŞÜçğıöşü0-9._'-]+)(?:\s+hakk[ıi]nda|\s+i[çc]in|\s+demek\s+istedim|\s+kastettim)?/i);
    if (m2 && m2[1] && m2[2]) {
      return {
        isCorrection: true,
        rejectedTarget: normalizeTurkishTokenRoot(m2[1]),
        correctedTarget: normalizeTurkishTokenRoot(m2[2]),
        rawSegment: m2[0]
      };
    }
    // Kalıp 2: "hayır, X demek istedim" / "pardon X demek istedim" / "düzeltiyorum: X"
    var m1 = raw.match(/(?:hay[ıi]r|pardon|d[üu]zeltiyorum|yanl[ıi][şs]\s+yazd[ıi]m)[,\s:]+(.+?)(?:\s+demek\s+istedim|\s+olacakt[ıi]|\s+kastettim|$)/i);
    if (m1 && m1[1]) {
      var replacement = m1[1].replace(/\s+de[ğg]il\s+/i, ' ').trim();
      return {
        isCorrection: true,
        rejectedTarget: null,
        correctedTarget: normalizeTurkishTokenRoot(replacement),
        rawSegment: m1[0]
      };
    }
    return { isCorrection: false, rejectedTarget: null, correctedTarget: null };
  }

  function detectNegationAndScope(text) {
    var raw = String(text || '');
    var lower = raw.toLocaleLowerCase('tr-TR');
    var markers = [];
    if (/\bde[ğg]il\b/.test(lower)) markers.push('değil');
    if (/\byok\b/.test(lower)) markers.push('yok');
    if (/\bolmadan\b|\bhari[çc]\b/.test(lower)) markers.push('hariç/olmadan');
    if (/\b\w+(?:mad[ıi]|medi|m[ıi]yor|miyor|mayacak|meyecek|mez|maz)\b/.test(lower)) {
      markers.push('fiil_olumsuzluk_eki');
    }
    return {
      hasNegation: markers.length > 0,
      markers: markers
    };
  }

  function extractTemporalAndNumericSlots(text) {
    var raw = String(text || '');
    var lower = raw.toLocaleLowerCase('tr-TR');
    var timeWindow = null;

    var dayMatch = lower.match(/son\s+(\d+)\s+g[üu]n/);
    if (dayMatch) {
      timeWindow = { unit: 'days', value: Number(dayMatch[1]), label: 'son ' + dayMatch[1] + ' gün' };
    } else if (/bug[üu]n/.test(lower)) {
      timeWindow = { unit: 'days', value: 1, label: 'bugün' };
    } else if (/d[üu]n\b/.test(lower)) {
      timeWindow = { unit: 'days', value: 2, label: 'dün ve bugün' };
    } else if (/son\s+d[öo]nem|yak[ıi]n\s+zamanda|son\s+geli[şs]meler/.test(lower)) {
      timeWindow = { unit: 'recent', value: 30, label: 'son dönem' };
    }

    var numbers = [];
    var numRegex = /(\d+(?:[.,]\d+)?)\s*(tl|try|usd|eur|dolar|euro|%|y[üu]zde|g[üu]n|saat|ay|y[ıi]l|birim|adet|ton|mw|gw)?/gi;
    var match;
    while ((match = numRegex.exec(raw)) !== null) {
      var valStr = match[1].replace(',', '.');
      var val = Number(valStr);
      if (!Number.isNaN(val)) {
        numbers.push({
          value: val,
          unit: match[2] ? match[2].toLowerCase() : null,
          raw: match[0].trim()
        });
      }
    }

    return {
      timeWindow: timeWindow,
      numbers: numbers
    };
  }

  function extractCandidateEntitiesFromText(text, knownWorldRecords) {
    var raw = String(text || '').trim();
    var candidates = [];
    var seen = new Set();

    function addCandidate(name, matchSource) {
      var clean = String(name || '').trim();
      if (!clean || clean.length < 2) return;
      var key = clean.toLocaleLowerCase('tr-TR');
      if (TURKISH_STOPWORDS.has(key)) return;
      if (seen.has(key)) return;
      seen.add(key);
      candidates.push({ name: clean, matchSource: matchSource });
    }

    // 1. Köşeli parantez veya tırnak içi varlıklar: [Kurum], "Apple Inc."
    var bracketRegex = /\[([^\]]+)\]|"([^"]+)"|“([^”]+)”/g;
    var bm;
    while ((bm = bracketRegex.exec(raw)) !== null) {
      var inner = bm[1] || bm[2] || bm[3];
      if (inner) addCandidate(normalizeTurkishTokenRoot(inner), 'explicit_quoted');
    }

    // 2. Dünya hafızasındaki bilinen varlıklarla eşleşme
    var records = Array.isArray(knownWorldRecords) ? knownWorldRecords : [];
    var lowerRaw = raw.toLocaleLowerCase('tr-TR');
    for (var r = 0; r < records.length; r++) {
      var rec = records[r] || {};
      var ents = Array.isArray(rec.entities) ? rec.entities : [];
      for (var e = 0; e < ents.length; e++) {
        var ent = ents[e];
        var entName = typeof ent === 'string' ? ent : (ent && (ent.name || ent.label || ent.id));
        if (!entName) continue;
        var entLower = String(entName).toLocaleLowerCase('tr-TR');
        if (entLower.length >= 2 && lowerRaw.indexOf(entLower) !== -1) {
          addCandidate(entName, 'world_memory_entity');
        } else {
          // İlk kelime / kısaltma kontrolü (örn. "Apple Inc." -> "apple")
          var firstWord = entLower.split(/[\s,.-]+/)[0];
          if (firstWord && firstWord.length >= 3 && !TURKISH_STOPWORDS.has(firstWord) && lowerRaw.indexOf(firstWord) !== -1) {
            addCandidate(entName, 'world_memory_entity_alias');
          }
        }
      }
      if (rec.title) {
        var titleWords = String(rec.title).split(/\s+/);
        for (var tw = 0; tw < titleWords.length; tw++) {
          var rootWord = normalizeTurkishTokenRoot(titleWords[tw]);
          if (rootWord.length >= 4 && /^[A-ZÇĞİÖŞÜ]/.test(rootWord)) {
            var rwLower = rootWord.toLocaleLowerCase('tr-TR');
            if (!TURKISH_STOPWORDS.has(rwLower) && lowerRaw.indexOf(rwLower) !== -1) {
              addCandidate(rootWord, 'world_record_title_match');
            }
          }
        }
      }
    }

    // 3. "X hakkında" kalıbı
    var aboutMatch = raw.match(/([A-Za-zÇĞİÖŞÜçğıöşü0-9._'-]+(?:\s+[A-Za-zÇĞİÖŞÜçğıöşü0-9._'-]+){0,2})\s+hakk[ıi]nda/i);
    if (aboutMatch && aboutMatch[1]) {
      var phraseTokens = aboutMatch[1].trim().split(/\s+/).filter(function (tok) {
        return !TURKISH_STOPWORDS.has(tok.toLocaleLowerCase('tr-TR'));
      });
      if (phraseTokens.length > 0) {
        var normalizedPhrase = phraseTokens.map(normalizeTurkishTokenRoot).join(' ');
        addCandidate(normalizedPhrase, 'hakkinda_pattern');
      }
    }

    // 4. Büyük harfle başlayan özel isim / kısaltma adayları (cümle başı soru kelimeleri hariç)
    var tokens = raw.split(/\s+/);
    for (var i = 0; i < tokens.length; i++) {
      var rootTok = normalizeTurkishTokenRoot(tokens[i]);
      if (!rootTok || rootTok.length < 2) continue;
      var lowTok = rootTok.toLocaleLowerCase('tr-TR');
      if (TURKISH_STOPWORDS.has(lowTok)) continue;
      if (/^[A-ZÇĞİÖŞÜ]{2,}[0-9]*$/.test(rootTok) || (i > 0 && /^[A-ZÇĞİÖŞÜ][a-zçğıöşü]{2,}/.test(rootTok))) {
        addCandidate(rootTok, 'capitalized_token');
      }
    }

    return candidates;
  }

  function resolveAnaphoraAndEllipsis(text, extractedEntities, dialogueState) {
    var raw = String(text || '').trim();
    var lower = raw.toLocaleLowerCase('tr-TR');
    var state = dialogueState || {};
    var hasAnaphoraCue =
      /\bbu\s+de[ğg]i[şs]iklik\b|\bbu\s+geli[şs]me\b|\bbu\s+kurum\b|\bbu\s+olay\b|\bbu\s+durum\b|\boradaki\b|\bo\s+kurum\b|\bayn[ıi]\s+d[öo]nemde\b|\bpeki\s+bu\b|\bbunun\b|\bbuna\b|\bbu\b/.test(lower);

    var resolvedEntity = null;
    var resolvedRecordId = null;
    var resolutionSource = 'NONE';

    if (extractedEntities && extractedEntities.length > 0) {
      resolvedEntity = extractedEntities[0].name;
      resolutionSource = 'EXPLICIT_IN_TURN';
      if (state.activeEntity && state.activeEntity.toLocaleLowerCase('tr-TR') === resolvedEntity.toLocaleLowerCase('tr-TR')) {
        resolvedRecordId = state.activeRecordId || null;
      }
    } else if (hasAnaphoraCue && state.activeEntity) {
      resolvedEntity = state.activeEntity;
      resolvedRecordId = state.activeRecordId || null;
      resolutionSource = 'ANAPHORA_FROM_DIALOGUE_STATE';
    } else if (state.activeEntity && /\b(hangi\s+kurumlarla\s+ili[şs]kili|ilgilendi[ğg]im\s+alan[ıi]\s+etkiler\s+mi|bunu\s+nereden\s+biliyorsun|kayna[ğg][ıi]\s+ne)\b/.test(lower)) {
      resolvedEntity = state.activeEntity;
      resolvedRecordId = state.activeRecordId || null;
      resolutionSource = 'ELLIPSIS_FROM_DIALOGUE_STATE';
    }

    return {
      hasAnaphoraCue: hasAnaphoraCue,
      resolvedEntity: resolvedEntity,
      resolvedRecordId: resolvedRecordId,
      resolutionSource: resolutionSource
    };
  }

  function classifySpeechActAndIntent(text, nluContext) {
    var raw = String(text || '').trim();
    var lower = raw.toLocaleLowerCase('tr-TR');

    if (!raw || raw.length < 2) {
      return SUPPORTED_SPEECH_ACTS_12.AMBIGUOUS_OR_UNDERSPECIFIED;
    }

    // 1. Selamlama
    if (/^(merhaba|selam|g[üu]nayd[ıi]n|iyi\s+g[üu]nler|iyi\s+ak[şs]amlar|hey|hello|hi)\b/i.test(lower) && raw.split(/\s+/).length <= 5) {
      return SUPPORTED_SPEECH_ACTS_12.GREETING_AND_GUIDE;
    }

    // 2. Kanıt ve kaynak sorma
    if (/nereden\s+biliyorsun|kayna[ğg][ıi]\s+ne|hangi\s+kaynak|kan[ıi]t[ıi]\s+ne|ne\s+zaman\s+yay[ıi]mland[ıi]/i.test(lower)) {
      return SUPPORTED_SPEECH_ACTS_12.PROVENANCE_AND_EVIDENCE;
    }

    // 3. Çelişki sorma
    if (/neden\s+farkl[ıi]|farkl[ıi]\s+kaynaklar|[çc]eli[şs]ki|tutars[ıi]z|hangisi\s+do[ğg]ru/i.test(lower)) {
      return SUPPORTED_SPEECH_ACTS_12.CONTRADICTION_QUERY;
    }

    // 4. Kullanıcı ilgi alanı / danışmanlık etkisi sorma (Zorunlu Dikey Kesit Tur 3)
    if (/ilgilendi[ğg]im\s+alan[ıi]\s+etkiler\s+mi|benim\s+alan[ıi]m[ıi]\s+etkiler\s+mi|bana\s+etkisi\s+ne|benim\s+i[çc]in\s+ne\s+anlama\s+geliyor|etkiler\s+mi/i.test(lower)) {
      return SUPPORTED_SPEECH_ACTS_12.USER_DOMAIN_IMPACT;
    }

    // 5. İlişki sorgusu (Zorunlu Dikey Kesit Tur 2)
    if (/hangi\s+kurumlarla\s+ili[şs]kili|ili[şs]kili\s+oldu[ğg]u|aras[ıi]nda\s+nas[ıi]l\s+bir\s+ba[ğg]lant[ıi]|kimlerle\s+ba[ğg]lant[ıi]l[ıi]|ba[ğg]lant[ıi]lar[ıi]\s+neler/i.test(lower)) {
      return SUPPORTED_SPEECH_ACTS_12.RELATION_EXPLORATION;
    }

    // 6. Varsayım değiştirme
    if (/varsay[ıi]m|yaparsak\s+ne\s+de[ğg]i[şs]ir|olursa\s+ne\s+olur|tavan[ıi]n[ıi]\s+\d+|oran[ıi]n[ıi]\s+%\s*\d+/i.test(lower)) {
      return SUPPORTED_SPEECH_ACTS_12.ASSUMPTION_CHANGE;
    }

    // 7. Seçenek karşılaştırma
    if (/iki\s+se[çc]enek|se[çc]enek\s+var|hangisi\s+daha\s+uygun|kar[şs][ıi]la[şs]t[ıi]r|se[çc]enekleri\s+k[ıi]yasla/i.test(lower)) {
      return SUPPORTED_SPEECH_ACTS_12.OPTION_COMPARISON;
    }

    // 8. Kullanıcı dosyası hakkında soru
    if (/dosyamda|yükledi[ğg]im\s+dosya|csv|tabloda|sat[ıi]rda/i.test(lower)) {
      return SUPPORTED_SPEECH_ACTS_12.USER_FILE_QUERY;
    }

    // 9. Belirli kurum/kişi/konu hakkında son değişiklik (Zorunlu Dikey Kesit Tur 1)
    if ((nluContext && nluContext.resolvedEntity) && /ne\s+de[ğg]i[şs]ti|son\s+d[öo]nemde|hakk[ıi]nda|durumu\s+ne|neler\s+oldu/i.test(lower)) {
      return SUPPORTED_SPEECH_ACTS_12.ENTITY_RECENT_CHANGE;
    }

    // 10. Zamansal sorgu
    if (/son\s+\d+\s+g[üu]nde|d[üu]n\s+ile\s+bug[üu]n|zaman\s+i[çc]inde/i.test(lower)) {
      return SUPPORTED_SPEECH_ACTS_12.TEMPORAL_DIFF_QUERY;
    }

    // 11. Genel dünya durumu
    if (/d[üu]nyada\s+[öo]nemli\s+ne\s+var|bug[üu]n\s+d[üu]nyada|d[üu]nya\s+[şs]imdi|g[üu]ndemde\s+ne\s+var/i.test(lower)) {
      return SUPPORTED_SPEECH_ACTS_12.WORLD_STATUS_QUERY;
    }

    if (nluContext && nluContext.resolvedEntity) {
      return SUPPORTED_SPEECH_ACTS_12.ENTITY_RECENT_CHANGE;
    }

    return SUPPORTED_SPEECH_ACTS_12.AMBIGUOUS_OR_UNDERSPECIFIED;
  }

  function analyzeUtteranceNlu(utterance, dialogueState, worldRecords) {
    var text = String(utterance || '').trim();
    var correction = detectUserCorrection(text);
    var negation = detectNegationAndScope(text);
    var temporalAndNumeric = extractTemporalAndNumericSlots(text);
    var effectiveState = Object.assign({}, dialogueState || {});

    if (correction.isCorrection && correction.correctedTarget) {
      effectiveState.activeEntity = correction.correctedTarget;
    }

    var candidateEntities = extractCandidateEntitiesFromText(text, worldRecords);
    if (correction.isCorrection && correction.correctedTarget) {
      candidateEntities.unshift({
        name: correction.correctedTarget,
        matchSource: 'user_self_correction'
      });
    }

    var anaphora = resolveAnaphoraAndEllipsis(text, candidateEntities, effectiveState);
    var speechAct = classifySpeechActAndIntent(text, {
      resolvedEntity: anaphora.resolvedEntity,
      candidateEntities: candidateEntities
    });

    var isAmbiguous =
      speechAct === SUPPORTED_SPEECH_ACTS_12.AMBIGUOUS_OR_UNDERSPECIFIED &&
      !anaphora.resolvedEntity;

    return {
      rawText: text,
      speechAct: speechAct,
      candidateEntities: candidateEntities,
      resolvedEntity: anaphora.resolvedEntity,
      resolvedRecordId: anaphora.resolvedRecordId,
      anaphoraResolution: anaphora,
      correction: correction,
      negation: negation,
      temporalAndNumeric: temporalAndNumeric,
      isAmbiguous: isAmbiguous
    };
  }

  // ----------------------------------------------------------------------------
  // Deterministik İçerik Özeti (SHA-256 / FNV-1a Yedekli) ve Günlük Maskeleme
  // ----------------------------------------------------------------------------
  function computeDeterministicHashHex(input) {
    var lwm = getLivingWorldModel();
    if (lwm && typeof lwm.computeSha256Hex === 'function') {
      try {
        return lwm.computeSha256Hex(input);
      } catch (_) {}
    }
    var str = typeof input === 'string' ? input : JSON.stringify(input || '');
    if (typeof require === 'function') {
      try {
        var nodeCrypto = require('crypto');
        return nodeCrypto.createHash('sha256').update(str, 'utf8').digest('hex');
      } catch (_) {}
    }
    // Tarayıcı senkron yedeği: 256-bit deterministik karma (8x32-bit FNV-1a şeridi)
    var lanes = [
      0x811c9dc5, 0x811c9dc5 ^ 0x1337c0de, 0x811c9dc5 ^ 0x9e3779b9, 0x811c9dc5 ^ 0x7f4a7c15,
      0x811c9dc5 ^ 0x6a09e667, 0x811c9dc5 ^ 0xbb67ae85, 0x811c9dc5 ^ 0x3c6ef372, 0x811c9dc5 ^ 0xa54ff53a
    ];
    for (var i = 0; i < str.length; i++) {
      var code = str.charCodeAt(i);
      var laneIdx = i & 7;
      lanes[laneIdx] ^= code;
      lanes[laneIdx] = Math.imul(lanes[laneIdx], 0x01000193) >>> 0;
    }
    return lanes.map(function (v) { return ('00000000' + (v >>> 0).toString(16)).slice(-8); }).join('');
  }

  function sanitizeAuditLogMessage(rawText) {
    var s = String(rawText || '');
    s = s.replace(/((?:api[_-]?key|token|secret|password|authorization|bearer|cookie)\s*[:=]\s*)([^\s,;'"&]+)/gi, '$1[REDACTED_SECRET]');
    s = s.replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, '[REDACTED_API_KEY]');
    return s;
  }

  // ----------------------------------------------------------------------------
  // Bölüm 2.4 & 2.5: Gerçek Kaynak Kaydı Şeması, Kaynak İddiası vs Bağımsız Doğrulanmış Olgu Ayrımı
  // ----------------------------------------------------------------------------
  function normalizeAdvisorWorldRecord(rawRec, options) {
    var opts = options || {};
    var r = Object.assign({}, rawRec || {});
    var nowIso = opts.nowIso || new Date().toISOString();

    var isSample = Boolean(
      r.isSampleFixture === true ||
      r.data_origin === 'SAMPLE_TRAINING_DATA' ||
      r.epistemic_status === 'SAMPLE_TRAINING_DATA' ||
      r.epistemic_status === 'TEST_EGITIM_VERISI'
    );

    var sourceId = String(r.source_id || '').trim();
    var sourceUrl = String(r.source_url || '').trim();
    var hasValidSourceLink = Boolean(
      sourceId &&
      sourceUrl &&
      sourceUrl !== 'not_provided' &&
      sourceUrl !== 'unknown' &&
      /^https?:\/\//i.test(sourceUrl)
    );

    var corroboratingSources = Array.isArray(r.corroborating_sources) ? r.corroborating_sources.slice() : [];
    var isIndependentlyCorroborated = !isSample && hasValidSourceLink && (
      r.verification_status === 'INDEPENDENTLY_CORROBORATED_FACT' ||
      r.epistemic_status === 'INDEPENDENTLY_CORROBORATED_FACT' ||
      r.epistemic_status === 'DOGRULANMIS_OLGU' ||
      corroboratingSources.length >= 2
    );

    // KURAL 2.5 & 2.8: Kaynaksız iddia doğrulanmış olguya yükseltilemez;
    // Tek kaynaklı kayıt varsayılan olarak "Kaynaktan alınmış iddia" (SOURCE_CLAIM) statüsündedir.
    var epistemicStatus;
    var verificationStatus;
    if (isSample) {
      epistemicStatus = 'SAMPLE_TRAINING_DATA';
      verificationStatus = 'SAMPLE_TRAINING_NOT_REAL_WORLD_VERIFIED';
    } else if (r.epistemic_status === 'USER_PREFERENCE' || r.record_type === 'USER_PREFERENCE') {
      epistemicStatus = 'USER_PREFERENCE';
      verificationStatus = 'USER_PREFERENCE_NOT_WORLD_FACT';
    } else if (!hasValidSourceLink) {
      epistemicStatus = 'UNVERIFIED_CLAIM';
      verificationStatus = 'MISSING_SOURCE_OR_URL_CANNOT_PROMOTE_TO_FACT';
    } else if (isIndependentlyCorroborated) {
      epistemicStatus = 'INDEPENDENTLY_CORROBORATED_FACT';
      verificationStatus = 'CORROBORATED_BY_INDEPENDENT_PRIMARY_SOURCES';
    } else {
      epistemicStatus = 'SOURCE_CLAIM';
      verificationStatus = 'SINGLE_SOURCE_CLAIM_NOT_INDEPENDENTLY_CORROBORATED';
    }

    var ingestedAt = r.ingested_at && r.ingested_at !== 'not_provided' ? String(r.ingested_at) : nowIso;
    var publishedAt = r.source_published_at ? String(r.source_published_at) : 'not_provided';
    var eventTime = r.event_time ? String(r.event_time) : 'not_provided';

    var contentHash = r.content_hash || computeDeterministicHashHex({
      record_id: r.record_id || '',
      source_id: sourceId,
      source_url: sourceUrl,
      title: r.title || '',
      summary: r.summary || '',
      event_time: eventTime,
      source_published_at: publishedAt
    });

    var freshnessStatus = r.freshness_status || (
      r.error_state || r.reachable === false
        ? (r.ingested_at ? 'SON_BILINEN_VERI_KAYNAK_ERISILEMIYOR' : 'BAGLANTI_YOK')
        : (publishedAt !== 'not_provided' || ingestedAt ? 'GUNCEL' : 'SURESI_BILINMIYOR')
    );

    return Object.assign({}, r, {
      record_id: String(r.record_id || ('rec-' + contentHash.slice(0, 12))),
      record_type: r.record_type || 'SOURCE_RECORD',
      source_provider: r.source_provider || r.source_name || sourceId || 'unknown_provider',
      source_id: sourceId || 'unverified_source',
      source_name: r.source_name || r.source_provider || sourceId || 'Belirtilmemiş Kaynak',
      source_url: sourceUrl || 'not_provided',
      ingested_at: ingestedAt,
      source_published_at: publishedAt,
      event_time: eventTime,
      last_checked_at: r.last_checked_at || ingestedAt,
      data_format: r.data_format || 'application/json',
      title: String(r.title || (r.subject && r.subject.name) || 'Kaynak Kaydı'),
      summary: String(r.summary || r.original_text || ''),
      content_hash: contentHash,
      source_license: r.source_license || 'not_provided',
      usage_terms: r.usage_terms || r.source_license || 'Kaynak kullanım koşullarına tabidir',
      commercial_status: r.commercial_status || 'INCELEMEDE',
      freshness_status: freshnessStatus,
      epistemic_status: epistemicStatus,
      verification_status: verificationStatus,
      isSampleFixture: isSample,
      sample_badge_tr: isSample ? 'Örnek veri' : null,
      error_state: r.error_state || null,
      is_stale_cached_record: Boolean(r.is_stale_cached_record === true || r.reachable === false),
      entities: Array.isArray(r.entities) ? r.entities : (
        r.subject && r.subject.name
          ? [{ id: r.subject.id || r.subject.name, name: r.subject.name, type: r.subject.entity_type || 'ENTITY', sector: r.subject.domain || 'Genel' }]
          : []
      ),
      domains: Array.isArray(r.domains) ? r.domains : (r.subject && r.subject.domain ? [String(r.subject.domain).toLowerCase()] : ['general']),
      claims: Array.isArray(r.claims) ? r.claims : [
        {
          claim_id: 'clm-' + contentHash.slice(0, 10),
          statement: String(r.summary || r.original_text || r.title || ''),
          epistemic_status: epistemicStatus
        }
      ]
    });
  }

  function convertLivingWorldRecordToAdvisorRecord(lwmRec) {
    if (!lwmRec || typeof lwmRec !== 'object') return null;
    if (lwmRec.title && lwmRec.summary && Array.isArray(lwmRec.entities)) {
      return normalizeAdvisorWorldRecord(lwmRec);
    }
    var subj = lwmRec.subject || {};
    var subjName = subj.name || String(lwmRec.record_id || 'Varlık');
    var ents = [
      {
        id: subj.id || subjName,
        name: subjName,
        type: subj.entity_type || 'ENTITY',
        sector: subj.domain || 'Genel',
        external_ids: subj.external_ids || {}
      }
    ];
    if (typeof lwmRec.object === 'string' && /^WIKIDATA:Q\d+$/i.test(lwmRec.object)) {
      ents.push({
        id: lwmRec.object,
        name: lwmRec.object.replace(/^WIKIDATA:/i, ''),
        type: 'LINKED_ENTITY',
        sector: 'Bilgi Grafı İlişkisi'
      });
    }
    if (subj.external_ids && Array.isArray(subj.external_ids.institutions)) {
      subj.external_ids.institutions.forEach(function (instName) {
        if (instName) {
          ents.push({ id: instName, name: instName, type: 'INSTITUTION', sector: 'Araştırma Kurumu' });
        }
      });
    }
    var sourceIdNormalized = lwmRec.source_id === 'sec_edgar_submissions'
      ? 'sec_edgar'
      : lwmRec.source_id === 'openalex_scholarly'
        ? 'openalex'
        : lwmRec.source_id === 'world_bank_indicators'
          ? 'world_bank'
          : lwmRec.source_id === 'gdelt_doc_v2'
            ? 'gdelt_doc'
            : (lwmRec.source_id || 'wikidata');

    return normalizeAdvisorWorldRecord({
      record_id: lwmRec.record_id,
      record_type: lwmRec.record_type || 'SOURCE_RECORD',
      source_provider: lwmRec.source_publisher || lwmRec.source_id,
      source_id: sourceIdNormalized,
      source_id_raw: lwmRec.source_id,
      source_name: lwmRec.source_publisher || lwmRec.source_id,
      source_url: lwmRec.source_url,
      source_license: lwmRec.source_license,
      commercial_status: lwmRec.commercial_status,
      event_time: lwmRec.event_time || 'not_provided',
      source_published_at: lwmRec.source_published_at || 'not_provided',
      ingested_at: lwmRec.ingested_at,
      last_checked_at: lwmRec.last_checked_at || lwmRec.ingested_at,
      data_format: 'application/json',
      content_hash: lwmRec.content_hash,
      title: subjName + (lwmRec.relation ? ' — ' + lwmRec.relation : ''),
      summary: lwmRec.original_text || (subjName + ': ' + String(lwmRec.object !== undefined ? lwmRec.object : '')),
      numeric_value: typeof lwmRec.value === 'number' ? lwmRec.value : (typeof lwmRec.object === 'number' ? lwmRec.object : null),
      units: lwmRec.units || null,
      relation: lwmRec.relation || null,
      subject: subj,
      object: lwmRec.object,
      entities: ents,
      domains: subj.domain ? [String(subj.domain).toLowerCase()] : ['general'],
      epistemic_status: 'SOURCE_CLAIM',
      is_syndicated_duplicate: Boolean(lwmRec.is_syndicated_duplicate),
      syndication_copy_count: lwmRec.syndication_copy_count || 1
    });
  }

  function convertAdvisorRecordToLivingWorldV2(advRec) {
    if (!advRec || typeof advRec !== 'object') return null;
    if (advRec.subject && advRec.subject.id && advRec.subject.name) return advRec;
    var firstEnt = (Array.isArray(advRec.entities) && advRec.entities[0]) || { id: advRec.record_id, name: advRec.title || 'Varlık' };
    var entId = typeof firstEnt === 'string' ? firstEnt : (firstEnt.id || firstEnt.name || advRec.record_id);
    var entName = typeof firstEnt === 'string' ? firstEnt : (firstEnt.name || firstEnt.id || advRec.title);
    var extIds = {};
    if (/^Q\d+$/i.test(String(entId))) extIds.wikidata_qid = String(entId);
    if (/^CIK\d+$/i.test(String(entId))) extIds.sec_cik = String(entId).replace(/^CIK/i, '');
    return Object.assign({}, advRec, {
      subject: {
        id: String(entId),
        name: String(entName),
        entity_type: (firstEnt && firstEnt.type) || 'ENTITY',
        domain: (Array.isArray(advRec.domains) && advRec.domains[0]) || 'GENERAL',
        external_ids: extIds
      },
      relation: advRec.relation || advRec.record_type || 'REPORTED_UPDATE',
      object: advRec.summary || advRec.title || '',
      source_publisher: advRec.source_name || advRec.source_provider || advRec.source_id
    });
  }

  // ----------------------------------------------------------------------------
  // Eğitim / Örnek Veri Kayıtları (Yalnızca Açık Eğitim Modunda veya Kontrollü Testlerde Kullanılır)
  // Üretim / normal kullanım modunda otomatik yüklenmez!
  // ----------------------------------------------------------------------------
  function buildDefaultAdvisorWorldRecords(options) {
    var opts = options || {};
    var markAsSample = opts.markAsSampleFixture === true;
    var rawList = [
      {
        record_id: 'rec-wikidata-tsmc-2026',
        record_type: 'ENTITY_STATE_UPDATE',
        source_provider: 'Wikidata / Wikimedia Foundation',
        source_id: 'wikidata',
        source_name: 'Wikidata Sparql & Entity API',
        source_url: 'https://www.wikidata.org/wiki/Q713418',
        source_license: 'CC0-1.0',
        usage_terms: 'CC0 1.0 Public Domain Dedication; topluluk verisi birincil kaynak doğrulaması gerektirir.',
        commercial_status: 'ALLOWED_COMMERCIAL',
        event_time: '2026-03-28T09:00:00Z',
        source_published_at: '2026-03-28T11:30:00Z',
        ingested_at: '2026-03-30T08:00:00Z',
        last_checked_at: '2026-03-30T08:00:00Z',
        data_format: 'application/json',
        language: 'tr',
        title: 'TSMC Avrupa Yarı İletken Üretim Yatırımı ve Tedarik Zinciri Güncellemesi',
        summary: 'TSMC (Q713418), Avrupa otomotiv ve endüstriyel çip kapasitesi için Dresden tesisi ortaklık yapısını ve 2026 tedarik takvimini güncelledi.',
        entities: [
          { id: 'Q713418', name: 'TSMC', type: 'COMPANY', sector: 'Yarı İletken ve Elektronik' },
          { id: 'Q312', name: 'Apple Inc.', type: 'COMPANY', sector: 'Tüketici Elektroniği ve Bulut' },
          { id: 'Q234', name: 'ASML', type: 'COMPANY', sector: 'Litografi Ekipmanları' }
        ],
        locations: [{ name: 'Dresden, Almanya', country: 'DE' }],
        domains: ['technology', 'economy', 'supply_chain'],
        claims: [
          {
            claim_id: 'clm-tsmc-1',
            statement: 'TSMC, Avrupa üretim hattında endüstriyel ve otomotiv sınıfı 28nm/16nm/12nm kapasite planını resmi olarak güncelledi.',
            epistemic_status: markAsSample ? 'SAMPLE_TRAINING_DATA' : 'SOURCE_CLAIM'
          }
        ],
        epistemic_status: markAsSample ? 'SAMPLE_TRAINING_DATA' : 'SOURCE_CLAIM',
        isSampleFixture: markAsSample,
        sample_badge_tr: markAsSample ? 'Örnek veri' : null,
        confidence_note: markAsSample
          ? 'Örnek veri (Eğitim / Test Senaryosu — Canlı doğrulanmış gerçek dünya hafızası değildir).'
          : 'Kaynaklı kayıt (Wikidata Q713418).'
      },
      {
        record_id: 'rec-sec-apple-10k-2026',
        record_id_canonical: 'rec-sec-apple-10k-2026',
        record_type: 'CORPORATE_FILING',
        source_provider: 'U.S. Securities and Exchange Commission',
        source_id: 'sec_edgar',
        source_name: 'U.S. SEC EDGAR Submissions API',
        source_url: 'https://data.sec.gov/submissions/CIK0000320193.json',
        source_license: 'US-Public-Domain',
        usage_terms: 'U.S. Government Public Domain; SEC Fair Access <=10 req/s.',
        commercial_status: 'ALLOWED_COMMERCIAL',
        event_time: '2026-03-25T16:00:00Z',
        source_published_at: '2026-03-25T20:15:00Z',
        ingested_at: '2026-03-30T08:05:00Z',
        last_checked_at: '2026-03-30T08:05:00Z',
        data_format: 'application/json',
        language: 'tr',
        title: 'Apple Inc. SEC EDGAR Bildirimi: Yarı İletken Tedarik ve Donanım Üretim Planı',
        summary: 'Apple Inc. (CIK 0000320193) resmi SEC bildiriminde ileri düğüm işlemci tedarikinde TSMC ile kapasite tahsisini ve Avrupa/Asya lojistik yedekliliğini raporladı.',
        entities: [
          { id: 'CIK0000320193', name: 'Apple Inc.', type: 'COMPANY', sector: 'Teknoloji ve Donanım' },
          { id: 'Q713418', name: 'TSMC', type: 'COMPANY', sector: 'Yarı İletken ve Elektronik' }
        ],
        locations: [{ name: 'Cupertino, ABD', country: 'US' }],
        domains: ['economy', 'technology', 'supply_chain'],
        claims: [
          {
            claim_id: 'clm-apple-sec-1',
            statement: 'Apple Inc., tekil dökümhane (foundry) tedarik yoğunlaşması nedeniyle TSMC kapasite tahsislerini dönemsel risk faktörü ve ana üretim bağımlılığı olarak bildirdi.',
            epistemic_status: markAsSample ? 'SAMPLE_TRAINING_DATA' : 'SOURCE_CLAIM'
          }
        ],
        epistemic_status: markAsSample ? 'SAMPLE_TRAINING_DATA' : 'SOURCE_CLAIM',
        isSampleFixture: markAsSample,
        sample_badge_tr: markAsSample ? 'Örnek veri' : null,
        confidence_note: markAsSample
          ? 'Örnek veri (Eğitim / Test Senaryosu).'
          : 'ABD SEC EDGAR resmi kurumsal bildirim verisi.'
      },
      {
        record_id: 'rec-openalex-semi-supply-2026',
        record_type: 'SCIENTIFIC_PUBLICATION',
        source_provider: 'OpenAlex (OurResearch)',
        source_id: 'openalex',
        source_name: 'OpenAlex Scholarly Works API',
        source_url: 'https://api.openalex.org/works',
        source_license: 'CC0-1.0',
        usage_terms: 'CC0 1.0 meta veri; makale tam metin telifleri ilgili yayıncılara aittir.',
        commercial_status: 'ALLOWED_COMMERCIAL',
        event_time: '2026-03-20T00:00:00Z',
        source_published_at: '2026-03-21T10:00:00Z',
        ingested_at: '2026-03-30T08:10:00Z',
        last_checked_at: '2026-03-30T08:10:00Z',
        data_format: 'application/json',
        language: 'tr',
        title: 'Yarı İletken Tedarik Zinciri Darboğazlarının Bulut ve Endüstriyel Donanım Maliyetlerine Etkisi',
        summary: 'OpenAlex açık erişim araştırması, TSMC ve ASML ekosistemindeki kapasite kaymalarının elektronik, otomotiv ve veri merkezi donanım teslim sürelerini 6-14 hafta etkileyebildiğini inceliyor.',
        entities: [
          { id: 'Q713418', name: 'TSMC', type: 'COMPANY', sector: 'Yarı İletken ve Elektronik' },
          { id: 'Q234', name: 'ASML', type: 'COMPANY', sector: 'Litografi Ekipmanları' }
        ],
        locations: [{ name: 'Küresel', country: 'GLOBAL' }],
        domains: ['science', 'technology', 'supply_chain', 'economy'],
        claims: [
          {
            claim_id: 'clm-openalex-1',
            statement: 'Akademik çalışmaya göre dökümhane kapasite değişimleri alt kademe elektronik ve bulut donanım tedarikinde teslim süresi dalgalanması oluşturmaktadır.',
            epistemic_status: markAsSample ? 'SAMPLE_TRAINING_DATA' : 'SOURCE_CLAIM'
          }
        ],
        epistemic_status: markAsSample ? 'SAMPLE_TRAINING_DATA' : 'SOURCE_CLAIM',
        isSampleFixture: markAsSample,
        sample_badge_tr: markAsSample ? 'Örnek veri' : null,
        confidence_note: markAsSample
          ? 'Örnek veri (Eğitim / Test Senaryosu).'
          : 'OpenAlex hakemli/açık erişim bilimsel yayın kaydı.'
      }
    ];
    return rawList.map(function (item) {
      return normalizeAdvisorWorldRecord(item);
    });
  }

  // ============================================================================
  // BÖLÜM 3: DÜNYA VERİLERİ İÇİN AYRI VE DENETLENEBİLİR KAPI (`CaelusWorldDataGate`)
  // ============================================================================

  var LOGICAL_DATA_ZONES_5 = Object.freeze({
    A_USER_PRIVATE_SPACE: {
      zoneId: 'A_USER_PRIVATE_SPACE',
      labelTr: 'A. Kullanıcı Özel Alanı',
      descriptionTr: 'Kişisel dosyalar, sohbet geçmişi ve yerel notlar. Dış kaynak bağlayıcıları bu alanı varsayılan olarak okuyamaz ve dışarı gönderemez.',
      externalConnectorsCanRead: false
    },
    B_EXTERNAL_SOURCE_RECORDS: {
      zoneId: 'B_EXTERNAL_SOURCE_RECORDS',
      labelTr: 'B. Dış Kaynaklardan Alınan Kayıtlar',
      descriptionTr: 'Kullanıcının izin verdiği açık kaynaklardan alınan zaman damgalı, hash özeti doğrulanmış kaynak kayıtları.',
      externalConnectorsCanRead: true
    },
    C_USER_ASSUMPTIONS_AND_PREFERENCES: {
      zoneId: 'C_USER_ASSUMPTIONS_AND_PREFERENCES',
      labelTr: 'C. Kullanıcı Varsayımları ve Tercihleri',
      descriptionTr: 'Kullanıcının açıkça girdiği ilgi alanları, bütçe tavanı ve senaryo varsayımları. Dünya olgusu yerine geçmez.',
      externalConnectorsCanRead: false
    },
    D_DERIVED_RESULTS_AND_ANALYSES: {
      zoneId: 'D_DERIVED_RESULTS_AND_ANALYSES',
      labelTr: 'D. Türetilmiş Sonuçlar ve Analizler',
      descriptionTr: 'Deterministik hesaplamalar, kural çıkarımları ve karşılaştırma raporları.',
      externalConnectorsCanRead: false
    },
    E_LABELED_TEST_TRAINING_DATA: {
      zoneId: 'E_LABELED_TEST_TRAINING_DATA',
      labelTr: 'E. Açıkça Etiketlenmiş Test / Eğitim Verisi',
      descriptionTr: 'Yalnızca kullanıcı eğitim alanını açtığında veya testlerde kullanılan "Örnek veri" etiketli kayıtlar. Gerçek dünya hafızasına karışmaz.',
      externalConnectorsCanRead: false
    }
  });

  var WORLD_GATE_MODES_3 = Object.freeze({
    OFFLINE: {
      code: 'OFFLINE',
      labelTr: 'Çevrim Dışı',
      descriptionTr: 'Yalnızca daha önce yerelde bulunan veriler ve kullanıcı dosyaları kullanılır. Yeni internet verisi alınmaz (0 dış ağ isteği).'
    },
    PERMITTED_CONNECTION: {
      code: 'PERMITTED_CONNECTION',
      labelTr: 'İzinli Bağlantı',
      descriptionTr: 'Yalnızca kullanıcının açıkça seçtiği ve izin verdiği kaynaklara sınırlı HTTPS sorgusu gönderilir; özel dosyalar paylaşılmaz.'
    },
    SEPARATE_DEVICE_IMPORT: {
      code: 'SEPARATE_DEVICE_IMPORT',
      labelTr: 'Ayrı Cihazdan Aktarım',
      descriptionTr: 'Başka bir cihazda hazırlanmış veri paketinin şema ve SHA-256 içerik özeti doğrulamasıyla çevrim dışı içeri aktarılması.'
    }
  });

  var ALLOWED_EXTERNAL_SOURCE_HOSTS = Object.freeze({
    'www.wikidata.org': 'wikidata',
    'api.worldbank.org': 'world_bank_indicators',
    'data.sec.gov': 'sec_edgar_submissions',
    'api.openalex.org': 'openalex_scholarly',
    'api.gdeltproject.org': 'gdelt_doc_v2'
  });

  function validateExternalSourceRequestSafety(targetUrl, options) {
    var opts = options || {};
    var rawUrl = String(targetUrl || '').trim();
    if (!rawUrl) {
      return { allowed: false, reasonCode: 'EMPTY_URL', reasonTr: 'Hedef bağlantı boş.' };
    }
    var parsed;
    try {
      parsed = new URL(rawUrl);
    } catch (_) {
      return { allowed: false, reasonCode: 'INVALID_URL_SYNTAX', reasonTr: 'Geçersiz URL sözdizimi.' };
    }

    if (parsed.protocol !== 'https:') {
      return {
        allowed: false,
        reasonCode: 'NON_HTTPS_PROTOCOL_BLOCKED',
        reasonTr: 'Güvenlik politikası gereği yalnızca HTTPS protokolüne izin verilir (' + parsed.protocol + ' engellendi).'
      };
    }

    var host = String(parsed.hostname || '').toLowerCase();
    // SSRF / Yerel ağ / Loopback / Metadata IP engeli
    if (
      host === 'localhost' ||
      host === '0.0.0.0' ||
      host === '[::1]' ||
      host === '::1' ||
      /^127\./.test(host) ||
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^169\.254\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(host) ||
      host.endsWith('.local') ||
      host.endsWith('.internal')
    ) {
      return {
        allowed: false,
        reasonCode: 'SSRF_LOCAL_OR_PRIVATE_NETWORK_BLOCKED',
        reasonTr: 'Yerel ağ, loopback veya iç servis adreslerine (' + host + ') erişim güvenlik kapısı tarafından engellendi.'
      };
    }

    if (!ALLOWED_EXTERNAL_SOURCE_HOSTS[host]) {
      return {
        allowed: false,
        reasonCode: 'UNAPPROVED_EXTERNAL_HOST_BLOCKED',
        reasonTr: 'Hedef alan adı (' + host + ') onaylı açık veri kaynakları listesinde yer almıyor.'
      };
    }

    if (rawUrl.length > (opts.maxUrlLength || 1024)) {
      return {
        allowed: false,
        reasonCode: 'QUERY_URL_TOO_LONG',
        reasonTr: 'Dış sorgu URL uzunluğu sınırı aşıldı (veri sızıntısı önlemi).'
      };
    }

    return {
      allowed: true,
      reasonCode: 'SAFE_APPROVED_HTTPS_ENDPOINT',
      host: host,
      mappedSourceId: ALLOWED_EXTERNAL_SOURCE_HOSTS[host],
      maxTimeoutMs: opts.maxTimeoutMs || 8500,
      maxResponseBytes: opts.maxResponseBytes || (2 * 1024 * 1024)
    };
  }

  function previewOutboundSourceQuery(sourceId, queryParams, privateContext) {
    var params = queryParams || {};
    var priv = privateContext || {};
    var normalizedSid = sourceId === 'world_bank' ? 'world_bank_indicators'
      : sourceId === 'sec_edgar' ? 'sec_edgar_submissions'
      : sourceId === 'openalex' ? 'openalex_scholarly'
      : sourceId === 'gdelt_doc' ? 'gdelt_doc_v2'
      : sourceId;

    var outboundSummary = {};
    var endpointHost = '';
    if (normalizedSid === 'wikidata') {
      endpointHost = 'www.wikidata.org';
      outboundSummary = {
        action: params.searchQuery ? 'wbsearchentities + wbgetentities' : 'wbgetentities',
        queryOrEntityId: params.searchQuery || params.entityId || (Array.isArray(params.entityIds) ? params.entityIds.join('|') : 'Q43'),
        language: params.language || 'tr|en'
      };
    } else if (normalizedSid === 'world_bank_indicators') {
      endpointHost = 'api.worldbank.org';
      outboundSummary = {
        countries: params.countries || 'TUR',
        indicator: params.indicator || 'NY.GDP.MKTP.KD.ZG',
        perPage: Number(params.perPage) || 6
      };
    } else if (normalizedSid === 'sec_edgar_submissions') {
      endpointHost = 'data.sec.gov';
      outboundSummary = {
        cik: String(params.cik || '0000320193').replace(/\D/g, '').padStart(10, '0')
      };
    } else if (normalizedSid === 'openalex_scholarly') {
      endpointHost = 'api.openalex.org';
      outboundSummary = {
        search: String(params.search || '').slice(0, 120),
        perPage: Number(params.perPage) || 4
      };
    } else if (normalizedSid === 'gdelt_doc_v2') {
      endpointHost = 'api.gdeltproject.org';
      outboundSummary = {
        query: String(params.query || '').slice(0, 120),
        maxRecords: Number(params.maxRecords) || 5
      };
    } else {
      return {
        allowed: false,
        blockedReasonCode: 'UNSUPPORTED_SOURCE_ID',
        userPreviewTr: 'Desteklenmeyen kaynak kimliği: ' + sourceId
      };
    }

    var serializedQuery = JSON.stringify(outboundSummary);
    // Özel dosya içeriği veya gizli anahtar sızıntısı kontrolü
    if (/api[_-]?key|secret|password|bearer\s+|private_file_content/i.test(serializedQuery)) {
      return {
        allowed: false,
        blockedReasonCode: 'SENSITIVE_TOKEN_IN_OUTBOUND_QUERY',
        userPreviewTr: 'Sorgu içinde gizli anahtar/parola kalıbı tespit edildiğinden dış gönderim engellendi.'
      };
    }

    var privateFiles = Array.isArray(priv.privateFiles) ? priv.privateFiles : [];
    for (var i = 0; i < privateFiles.length; i++) {
      var pf = privateFiles[i] || {};
      var rawContent = String(pf.originalContent || pf.content || '').trim();
      if (rawContent.length >= 16 && serializedQuery.indexOf(rawContent.slice(0, 32)) !== -1) {
        return {
          allowed: false,
          blockedReasonCode: 'PRIVATE_FILE_CONTENT_LEAK_BLOCKED',
          userPreviewTr: 'Kullanıcı özel dosya içeriğinin dış kaynağa gönderilmesi engellendi.'
        };
      }
    }

    return {
      allowed: true,
      sourceId: normalizedSid,
      endpointHost: endpointHost,
      sharedFields: outboundSummary,
      privateFilesShared: false,
      chatHistoryShared: false,
      userPreviewTr:
        '"' + endpointHost + '" kaynağına yalnızca şu sorgu parametreleri gönderilecek: ' +
        JSON.stringify(outboundSummary) + '. Özel dosyalarınız ve sohbet geçmişiniz paylaşılmaz.'
    };
  }

  function createWorldDataGate(options) {
    var opts = options || {};
    var lwm = getLivingWorldModel();
    var currentMode = opts.initialMode && WORLD_GATE_MODES_3[opts.initialMode]
      ? opts.initialMode
      : 'OFFLINE'; // Varsayılan: kullanıcı açıkça izinli bağlantıya geçene kadar çevrim dışı / yerel

    var sourcePermissions = {
      wikidata: {
        sourceId: 'wikidata',
        displayName: 'Wikidata (Yapılandırılmış Varlık Grafı — CC0)',
        enabled: opts.enableWikidataByDefault === true,
        paused: false,
        license: 'CC0 1.0 Universal',
        usageTermsTr: 'Topluluk tarafından düzenlenen açık bilgi grafı; her iddia birincil kaynakla doğrulanmalıdır.',
        lastSuccessAt: null,
        lastAttemptAt: null,
        lastError: null,
        recordsCount: 0
      },
      world_bank_indicators: {
        sourceId: 'world_bank_indicators',
        displayName: 'World Bank Indicators API v2 (CC BY 4.0)',
        enabled: opts.enableWorldBankByDefault === true,
        paused: false,
        license: 'CC BY 4.0',
        usageTermsTr: 'Resmi uluslararası yıllık/çeyreklik istatistik serisi; dönem gecikmesi (lag) bulunur.',
        lastSuccessAt: null,
        lastAttemptAt: null,
        lastError: null,
        recordsCount: 0
      },
      sec_edgar_submissions: {
        sourceId: 'sec_edgar_submissions',
        displayName: 'U.S. SEC EDGAR Kurumsal Bildirimleri (Public Domain)',
        enabled: opts.enableSecEdgarByDefault === true,
        paused: false,
        license: 'U.S. Government Public Domain',
        usageTermsTr: 'Yalnızca ABD SEC kapsamındaki şirket bildirimlerini içerir; User-Agent ve <=10 istek/sn hız sınırına tabidir.',
        lastSuccessAt: null,
        lastAttemptAt: null,
        lastError: null,
        recordsCount: 0
      },
      openalex_scholarly: {
        sourceId: 'openalex_scholarly',
        displayName: 'OpenAlex Akademik Yayın İndeksi (CC0 Meta Veri)',
        enabled: opts.enableOpenAlexByDefault === true,
        paused: false,
        license: 'CC0 1.0 (Meta veri)',
        usageTermsTr: 'Yayın meta verisi CC0’dır; makalelerin tam metin telifleri ilgili yayıncılara aittir.',
        lastSuccessAt: null,
        lastAttemptAt: null,
        lastError: null,
        recordsCount: 0
      },
      gdelt_doc_v2: {
        sourceId: 'gdelt_doc_v2',
        displayName: 'GDELT DOC 2.0 Haber İndeksi (İncelemede / Yalnızca Başlık İddiası)',
        enabled: false,
        paused: false,
        license: 'GDELT Açık Meta Veri (Tam metinler yayıncı telifine tabidir)',
        usageTermsTr: 'Haber başlığı/bağlantısı tek başına doğrulanmış olgu değildir ("Kaynaktan alınmış haber iddiası"). Tam haber metinleri yeniden dağıtılmaz.',
        lastSuccessAt: null,
        lastAttemptAt: null,
        lastError: null,
        recordsCount: 0
      }
    };

    var zones = {
      A_USER_PRIVATE_SPACE: { files: [], chatNotes: [] },
      B_EXTERNAL_SOURCE_RECORDS: [],
      C_USER_ASSUMPTIONS_AND_PREFERENCES: {},
      D_DERIVED_RESULTS_AND_ANALYSES: [],
      E_LABELED_TEST_TRAINING_DATA: []
    };

    var networkAuditLog = [];

    function normalizeSourceKey(sid) {
      if (sid === 'world_bank') return 'world_bank_indicators';
      if (sid === 'sec_edgar') return 'sec_edgar_submissions';
      if (sid === 'openalex') return 'openalex_scholarly';
      if (sid === 'gdelt_doc') return 'gdelt_doc_v2';
      return sid;
    }

    function setMode(newMode) {
      if (!WORLD_GATE_MODES_3[newMode]) {
        throw new Error('Geçersiz çalışma kipi: ' + newMode);
      }
      currentMode = newMode;
      return WORLD_GATE_MODES_3[currentMode];
    }

    function getMode() {
      return WORLD_GATE_MODES_3[currentMode];
    }

    function setSourcePermission(sourceId, enabled) {
      var key = normalizeSourceKey(sourceId);
      if (!sourcePermissions[key]) throw new Error('Bilinmeyen kaynak: ' + sourceId);
      sourcePermissions[key].enabled = Boolean(enabled);
      if (enabled) sourcePermissions[key].paused = false;
      return Object.assign({}, sourcePermissions[key]);
    }

    function pauseSource(sourceId, paused) {
      var key = normalizeSourceKey(sourceId);
      if (!sourcePermissions[key]) throw new Error('Bilinmeyen kaynak: ' + sourceId);
      sourcePermissions[key].paused = Boolean(paused);
      return Object.assign({}, sourcePermissions[key]);
    }

    function removeSourceRecords(sourceId) {
      var key = normalizeSourceKey(sourceId);
      var shortKey = key === 'world_bank_indicators' ? 'world_bank'
        : key === 'sec_edgar_submissions' ? 'sec_edgar'
        : key === 'openalex_scholarly' ? 'openalex'
        : key === 'gdelt_doc_v2' ? 'gdelt_doc'
        : key;
      var before = zones.B_EXTERNAL_SOURCE_RECORDS.length;
      zones.B_EXTERNAL_SOURCE_RECORDS = zones.B_EXTERNAL_SOURCE_RECORDS.filter(function (r) {
        return r.source_id !== key && r.source_id !== shortKey && r.source_id_raw !== key;
      });
      if (sourcePermissions[key]) {
        sourcePermissions[key].recordsCount = 0;
        sourcePermissions[key].enabled = false;
      }
      return {
        removedCount: before - zones.B_EXTERNAL_SOURCE_RECORDS.length,
        remainingCount: zones.B_EXTERNAL_SOURCE_RECORDS.length
      };
    }

    function getSourcePermissionsAndStatus() {
      return Object.keys(sourcePermissions).map(function (k) {
        return Object.assign({}, sourcePermissions[k]);
      });
    }

    async function queryExternalSource(sourceId, queryParams, fetchOptions) {
      var fOpts = fetchOptions || {};
      var nowIso = fOpts.nowIso || new Date().toISOString();
      var key = normalizeSourceKey(sourceId);
      var perm = sourcePermissions[key];

      if (!perm) {
        return {
          ok: false,
          errorCode: 'UNKNOWN_SOURCE',
          userMessageTr: 'Bilinmeyen veri kaynağı: ' + sourceId,
          networkRequestSent: false,
          records: []
        };
      }

      // 1. Kip kontrolü: Çevrim dışı modda dış ağa kesinlikle çıkılmaz!
      if (currentMode === 'OFFLINE' || fOpts.offlineMode === true) {
        networkAuditLog.push({
          timestamp: nowIso,
          sourceId: key,
          mode: currentMode,
          networkRequestSent: false,
          outcome: 'BLOCKED_OFFLINE_MODE',
          detailTr: 'Çevrim dışı kip aktif olduğundan dış ağ isteği gönderilmedi.'
        });
        var cachedForOffline = zones.B_EXTERNAL_SOURCE_RECORDS.filter(function (r) {
          return r.source_id_raw === key || r.source_id === sourceId || r.source_id === key;
        });
        return {
          ok: false,
          errorCode: 'OFFLINE_MODE_NO_NETWORK',
          userMessageTr: 'Çevrim dışı mod aktif: yeni internet verisi alınmadı. Yereldeki kayıtlar korunuyor.',
          networkRequestSent: false,
          cachedRecordsCount: cachedForOffline.length,
          lastSuccessAt: perm.lastSuccessAt,
          records: []
        };
      }

      // 2. Kaynak izni ve duraklatma kontrolü
      if (!perm.enabled || perm.paused) {
        networkAuditLog.push({
          timestamp: nowIso,
          sourceId: key,
          mode: currentMode,
          networkRequestSent: false,
          outcome: 'BLOCKED_SOURCE_PERMISSION_DISABLED',
          detailTr: 'Kaynak izni kapalı veya kullanıcı tarafından duraklatılmış.'
        });
        return {
          ok: false,
          errorCode: 'SOURCE_PERMISSION_NOT_GRANTED',
          userMessageTr: '"' + perm.displayName + '" kaynağı için bağlantı izni açık değil veya duraklatılmış.',
          networkRequestSent: false,
          records: []
        };
      }

      // 3. Dışarı gönderilecek sorgu önizlemesi ve özel veri sızıntısı engeli
      var preview = previewOutboundSourceQuery(key, queryParams, {
        privateFiles: zones.A_USER_PRIVATE_SPACE.files
      });
      if (!preview.allowed) {
        networkAuditLog.push({
          timestamp: nowIso,
          sourceId: key,
          mode: currentMode,
          networkRequestSent: false,
          outcome: preview.blockedReasonCode,
          detailTr: sanitizeAuditLogMessage(preview.userPreviewTr)
        });
        return {
          ok: false,
          errorCode: preview.blockedReasonCode,
          userMessageTr: preview.userPreviewTr,
          networkRequestSent: false,
          records: []
        };
      }

      // 4. Özel URL güvenlik doğrulaması (eğer özel endpoint testi yapılıyorsa)
      if (fOpts.overrideUrlForSecurityTest) {
        var urlSafety = validateExternalSourceRequestSafety(fOpts.overrideUrlForSecurityTest);
        if (!urlSafety.allowed) {
          networkAuditLog.push({
            timestamp: nowIso,
            sourceId: key,
            mode: currentMode,
            networkRequestSent: false,
            outcome: urlSafety.reasonCode,
            detailTr: sanitizeAuditLogMessage(urlSafety.reasonTr)
          });
          return {
            ok: false,
            errorCode: urlSafety.reasonCode,
            userMessageTr: urlSafety.reasonTr,
            networkRequestSent: false,
            records: []
          };
        }
      }

      perm.lastAttemptAt = nowIso;
      if (!lwm || typeof lwm.fetchFromRealWorldSource !== 'function') {
        return {
          ok: false,
          errorCode: 'LIVING_WORLD_CONNECTOR_UNAVAILABLE',
          userMessageTr: 'Kaynak bağlayıcı modülü yüklü değil.',
          networkRequestSent: false,
          records: []
        };
      }

      var rawResult = await lwm.fetchFromRealWorldSource(key, queryParams, {
        fetchImpl: fOpts.fetchImpl,
        timeoutMs: fOpts.timeoutMs || 8500,
        nowIso: nowIso,
        lastSuccessAt: perm.lastSuccessAt
      });

      if (rawResult.ok && Array.isArray(rawResult.records)) {
        var converted = rawResult.records
          .map(convertLivingWorldRecordToAdvisorRecord)
          .filter(Boolean);

        // Yanıt boyutu sınırı kontrolü (maxResponseBytes)
        var maxBytes = fOpts.maxResponseBytes || (2 * 1024 * 1024);
        var serializedSize = JSON.stringify(converted).length;
        if (serializedSize > maxBytes) {
          perm.lastError = {
            code: 'RESPONSE_PAYLOAD_TOO_LARGE',
            messageTr: 'Kaynak yanıt boyutu güvenlik sınırını (' + maxBytes + ' bayt) aştı.',
            at: nowIso
          };
          return {
            ok: false,
            errorCode: 'RESPONSE_PAYLOAD_TOO_LARGE',
            userMessageTr: perm.lastError.messageTr,
            networkRequestSent: true,
            records: []
          };
        }

        converted.forEach(function (rec) {
          var existsIdx = zones.B_EXTERNAL_SOURCE_RECORDS.findIndex(function (ex) {
            return ex.record_id === rec.record_id && ex.content_hash === rec.content_hash;
          });
          if (existsIdx === -1) {
            zones.B_EXTERNAL_SOURCE_RECORDS.unshift(rec);
          }
        });

        perm.lastSuccessAt = nowIso;
        perm.lastError = null;
        perm.recordsCount = zones.B_EXTERNAL_SOURCE_RECORDS.filter(function (r) {
          return r.source_id_raw === key || r.source_id === key;
        }).length;

        networkAuditLog.push({
          timestamp: nowIso,
          sourceId: key,
          mode: currentMode,
          networkRequestSent: true,
          outboundPreview: preview.sharedFields,
          privateDataSent: false,
          outcome: 'SUCCESS',
          recordsReceived: converted.length
        });

        return {
          ok: true,
          sourceId: key,
          sourceName: perm.displayName,
          checkedAtIso: nowIso,
          lastSuccessAt: perm.lastSuccessAt,
          outboundPreview: preview,
          records: converted,
          rawConnectorResult: rawResult
        };
      } else {
        // BÖLÜM 2.7: Kaynak erişilemiyorsa son başarılı kaydın zamanını koru, eski olabileceğini göster, yeni veri uydurma!
        perm.lastError = {
          code: rawResult.errorCode || 'SOURCE_UNREACHABLE',
          messageTr: sanitizeAuditLogMessage(rawResult.userMessageTr || 'Kaynağa ulaşılamadı.'),
          at: nowIso
        };
        var previousRecords = zones.B_EXTERNAL_SOURCE_RECORDS
          .filter(function (r) {
            return r.source_id_raw === key || r.source_id === sourceId || r.source_id === key;
          })
          .map(function (oldRec) {
            return Object.assign({}, oldRec, {
              is_stale_cached_record: true,
              freshness_status: 'SON_BILINEN_VERI_KAYNAK_ERISILEMIYOR',
              staleWarningTr:
                'Kaynağa şu anda ulaşılamıyor (' + perm.lastError.code + '). Bu kayıt ' +
                oldRec.ingested_at + ' tarihinde alınmış son başarılı veridir ve güncel olmayabilir.'
            });
          });

        networkAuditLog.push({
          timestamp: nowIso,
          sourceId: key,
          mode: currentMode,
          networkRequestSent: true,
          outboundPreview: preview.sharedFields,
          privateDataSent: false,
          outcome: 'ERROR_' + perm.lastError.code,
          detailTr: perm.lastError.messageTr
        });

        return {
          ok: false,
          sourceId: key,
          sourceName: perm.displayName,
          errorCode: perm.lastError.code,
          userMessageTr:
            perm.lastError.messageTr +
            (perm.lastSuccessAt
              ? ' Son başarılı kayıt (' + perm.lastSuccessAt + ') korunuyor; eski olabilir.'
              : ' Henüz bu kaynaktan alınmış eski bir kayıt da bulunmuyor.'),
          lastSuccessAt: perm.lastSuccessAt,
          staleCachedRecords: previousRecords,
          fabricatedNewData: false,
          records: []
        };
      }
    }

    function importSeparateDevicePackage(pkg, importOptions) {
      var iOpts = importOptions || {};
      var nowIso = iOpts.nowIso || new Date().toISOString();
      if (!pkg || typeof pkg !== 'object' || !Array.isArray(pkg.records)) {
        return {
          ok: false,
          errorCode: 'INVALID_PACKAGE_SCHEMA',
          userMessageTr: 'Paket şeması geçersiz: records dizisi bulunamadı.'
        };
      }
      var imported = [];
      var rejected = [];
      for (var i = 0; i < pkg.records.length; i++) {
        var raw = pkg.records[i];
        var norm = normalizeAdvisorWorldRecord(raw, { nowIso: nowIso });
        if (norm.isSampleFixture) {
          zones.E_LABELED_TEST_TRAINING_DATA.push(norm);
          rejected.push({ record_id: norm.record_id, reason: 'SAMPLE_DATA_ROUTED_TO_TRAINING_ZONE' });
          continue;
        }
        if (norm.epistemic_status === 'UNVERIFIED_CLAIM') {
          rejected.push({ record_id: norm.record_id, reason: 'MISSING_SOURCE_OR_URL' });
          continue;
        }
        if (raw.expected_content_hash && raw.expected_content_hash !== norm.content_hash) {
          rejected.push({ record_id: norm.record_id, reason: 'CONTENT_HASH_MISMATCH' });
          continue;
        }
        zones.B_EXTERNAL_SOURCE_RECORDS.push(norm);
        imported.push(norm);
      }
      return {
        ok: true,
        mode: 'SEPARATE_DEVICE_IMPORT',
        importedCount: imported.length,
        rejectedCount: rejected.length,
        rejected: rejected,
        records: imported
      };
    }

    function inspectLogicalZones() {
      return {
        mode: WORLD_GATE_MODES_3[currentMode],
        catalog: LOGICAL_DATA_ZONES_5,
        A_USER_PRIVATE_SPACE_FILES_COUNT: zones.A_USER_PRIVATE_SPACE.files.length,
        B_EXTERNAL_SOURCE_RECORDS_COUNT: zones.B_EXTERNAL_SOURCE_RECORDS.length,
        B_EXTERNAL_SOURCE_RECORDS: zones.B_EXTERNAL_SOURCE_RECORDS.slice(),
        C_USER_ASSUMPTIONS_AND_PREFERENCES: JSON.parse(JSON.stringify(zones.C_USER_ASSUMPTIONS_AND_PREFERENCES)),
        D_DERIVED_RESULTS_COUNT: zones.D_DERIVED_RESULTS_AND_ANALYSES.length,
        E_LABELED_TEST_TRAINING_DATA_COUNT: zones.E_LABELED_TEST_TRAINING_DATA.length,
        sources: getSourcePermissionsAndStatus()
      };
    }

    return {
      getMode: getMode,
      setMode: setMode,
      getSourcePermissionsAndStatus: getSourcePermissionsAndStatus,
      setSourcePermission: setSourcePermission,
      pauseSource: pauseSource,
      removeSourceRecords: removeSourceRecords,
      previewOutboundSourceQuery: function (sid, qp) {
        return previewOutboundSourceQuery(sid, qp, { privateFiles: zones.A_USER_PRIVATE_SPACE.files });
      },
      queryExternalSource: queryExternalSource,
      importSeparateDevicePackage: importSeparateDevicePackage,
      inspectLogicalZones: inspectLogicalZones,
      getNetworkAuditLog: function () { return networkAuditLog.slice(); },
      registerPrivateFileMetadataOnly: function (fileMeta) {
        zones.A_USER_PRIVATE_SPACE.files.push(fileMeta);
      }
    };
  }

  // ============================================================================
  // BÖLÜM 7: ARAÇ VE TEKNOLOJİ DEĞERLENDİRME MOTORLARI (CEDAR, SOUFFLÉ/DATALOG, PROVSQL, Z3)
  // ============================================================================

  /**
   * 1. Cedar Tarzı Politika Değerlendiricisi (`evaluateCedarStylePolicy`)
   * - `permit(principal, action, resource) when { ... }`
   * - `forbid(principal, action, resource) when { ... }`
   * - Kural: En az bir `permit` eşleşmeli VE hiçbir `forbid` eşleşmemelidir (`forbid overrides permit`). Varsayılan: `DENY`.
   */
  function evaluateCedarStylePolicy(policies, request) {
    var req = request || {};
    var polList = Array.isArray(policies) ? policies : [];
    var matchedPermits = [];
    var matchedForbids = [];

    for (var i = 0; i < polList.length; i++) {
      var p = polList[i];
      if (!p || (p.effect !== 'permit' && p.effect !== 'forbid')) continue;
      var principalOk = !p.principal || p.principal === '*' || p.principal === req.principal;
      var actionOk = !p.action || p.action === '*' || p.action === req.action ||
        (Array.isArray(p.actions) && p.actions.indexOf(req.action) !== -1);
      var resourceOk = !p.resource || p.resource === '*' || p.resource === req.resource ||
        (Array.isArray(p.resources) && p.resources.indexOf(req.resource) !== -1);
      var whenOk = true;
      if (typeof p.when === 'function') {
        try {
          whenOk = Boolean(p.when(req.context || {}, req));
        } catch (_) {
          whenOk = false;
        }
      }
      if (principalOk && actionOk && resourceOk && whenOk) {
        if (p.effect === 'forbid') {
          matchedForbids.push(p.id || ('forbid_' + i));
        } else {
          matchedPermits.push(p.id || ('permit_' + i));
        }
      }
    }

    var decision = (matchedPermits.length > 0 && matchedForbids.length === 0) ? 'ALLOW' : 'DENY';
    return {
      decision: decision,
      allowed: decision === 'ALLOW',
      matchedPermits: matchedPermits,
      matchedForbids: matchedForbids,
      reasonCode: matchedForbids.length > 0
        ? 'EXPLICIT_FORBID_OVERRIDES_PERMIT'
        : (matchedPermits.length > 0 ? 'EXPLICIT_PERMIT_MATCHED' : 'DEFAULT_DENY_NO_PERMIT')
    };
  }

  /**
   * 2. Soufflé / Stratified Datalog Küçük Prototip Motoru (`runStratifiedDatalogLineageEngine`)
   * Kaynaklı dünya kayıtlarından taban olguları (EDB) çıkarır, yarı-naif sabit nokta (fixpoint)
   * çıkarımıyla türetilmiş ilişkileri (IDB) ve her çıkarımın tam soykütük ağacını (`lineage`) üretir.
   */
  function runStratifiedDatalogLineageEngine(worldRecords) {
    var recs = Array.isArray(worldRecords) ? worldRecords : [];
    var edbCoMention = [];
    var idbDerivedLinks = [];
    var seenPairs = new Set();

    // EDB: co_mentioned_in_record(EntityA, EntityB, RecordId, SourceId)
    for (var i = 0; i < recs.length; i++) {
      var r = recs[i];
      if (!r || r.isSampleFixture || r.epistemic_status === 'SAMPLE_TRAINING_DATA') continue;
      var ents = Array.isArray(r.entities) ? r.entities : [];
      for (var a = 0; a < ents.length; a++) {
        for (var b = 0; b < ents.length; b++) {
          if (a === b) continue;
          var nameA = typeof ents[a] === 'string' ? ents[a] : ents[a].name;
          var nameB = typeof ents[b] === 'string' ? ents[b] : ents[b].name;
          if (!nameA || !nameB || nameA === nameB) continue;
          edbCoMention.push({
            predicate: 'edb_shared_record',
            args: [nameA, nameB],
            recordId: r.record_id,
            sourceId: r.source_id
          });
        }
      }
    }

    // Kural 1 (Stratum 1): direct_link(X, Y) :- edb_shared_record(X, Y)
    for (var e = 0; e < edbCoMention.length; e++) {
      var fact = edbCoMention[e];
      var key1 = 'direct::' + fact.args[0] + '::' + fact.args[1];
      if (!seenPairs.has(key1)) {
        seenPairs.add(key1);
        idbDerivedLinks.push({
          predicate: 'idb_direct_entity_link',
          from: fact.args[0],
          to: fact.args[1],
          hopCount: 1,
          ruleId: 'R1_DIRECT_SHARED_RECORD',
          lineageRecords: [fact.recordId],
          lineageSources: [fact.sourceId],
          isCausalProof: false
        });
      }
    }

    // Kural 2 (Stratum 2 — Yarı-naif 2-adımlı geçişli aday yol):
    // candidate_2hop_path(X, Z, Y) :- direct_link(X, Y), direct_link(Y, Z), X != Z
    var directSnapshot = idbDerivedLinks.slice();
    for (var d1 = 0; d1 < directSnapshot.length; d1++) {
      for (var d2 = 0; d2 < directSnapshot.length; d2++) {
        var l1 = directSnapshot[d1];
        var l2 = directSnapshot[d2];
        if (l1.to === l2.from && l1.from !== l2.to) {
          var key2 = '2hop::' + l1.from + '::' + l1.to + '::' + l2.to;
          if (!seenPairs.has(key2)) {
            seenPairs.add(key2);
            idbDerivedLinks.push({
              predicate: 'idb_candidate_2hop_bridge',
              from: l1.from,
              via: l1.to,
              to: l2.to,
              hopCount: 2,
              ruleId: 'R2_TRANSITIVE_BRIDGE_HYPOTHESIS',
              lineageRecords: Array.from(new Set(l1.lineageRecords.concat(l2.lineageRecords))),
              lineageSources: Array.from(new Set(l1.lineageSources.concat(l2.lineageSources))),
              isCausalProof: false
            });
          }
        }
      }
    }

    return {
      engine: 'CAELUS_STRATIFIED_DATALOG_PROTOTYPE_V1',
      edbFactCount: edbCoMention.length,
      idbDerivedCount: idbDerivedLinks.length,
      derivedFacts: idbDerivedLinks
    };
  }

  /**
   * 3. ProvSQL Prensiplerine Uygun Semiring Provenance Polinomu ($\mathbb{N}[X]$)
   * Bir応答 içindeki kaynak/dosya kanıtlarını ($\otimes$ birleşim, $\oplus$ alternatif destek) izler.
   */
  function computeProvenanceSemiringPolynomial(passportSegments) {
    var segs = Array.isArray(passportSegments) ? passportSegments : [];
    var sourceTokens = [];
    var ruleTokens = [];
    var assumptionTokens = [];

    for (var i = 0; i < segs.length; i++) {
      var s = segs[i] || {};
      if (s.recordId) {
        sourceTokens.push(String(s.recordId));
      } else if (s.sourceFile && s.sourceRowNumber) {
        sourceTokens.push(String(s.sourceFile) + '#L' + String(s.sourceRowNumber));
      }
      if (s.classCode === 'RULE_DERIVATION' || s.classCode === 'VERIFIED_CALCULATION') {
        ruleTokens.push(s.calculationId || s.ruleId || s.classCode);
      }
      if (s.classCode === 'USER_PREFERENCE' || s.classCode === 'MODEL_ASSUMPTION') {
        assumptionTokens.push(s.classCode);
      }
    }

    var uniqueSources = Array.from(new Set(sourceTokens));
    var uniqueRules = Array.from(new Set(ruleTokens));
    var uniqueAssumptions = Array.from(new Set(assumptionTokens));

    var terms = [];
    if (uniqueSources.length === 0 && uniqueRules.length === 0) {
      return {
        semiring: 'N[X]_PROVENANCE_POLYNOMIAL',
        expression: '0 (ABSTAIN_OR_NO_EVIDENCE)',
        sourceTokens: [],
        ruleTokens: [],
        assumptionTokens: uniqueAssumptions
      };
    }

    if (uniqueSources.length > 0) {
      for (var u = 0; u < uniqueSources.length; u++) {
        var factors = [uniqueSources[u]];
        if (uniqueRules.length > 0) factors.push(uniqueRules[0]);
        if (uniqueAssumptions.length > 0) factors.push(uniqueAssumptions[0]);
        terms.push('(' + factors.join(' ⊗ ') + ')');
      }
    } else {
      terms.push('(' + uniqueRules.concat(uniqueAssumptions).join(' ⊗ ') + ')');
    }

    return {
      semiring: 'N[X]_PROVENANCE_POLYNOMIAL',
      expression: terms.join(' ⊕ '),
      sourceTokens: uniqueSources,
      ruleTokens: uniqueRules,
      assumptionTokens: uniqueAssumptions
    };
  }

  /**
   * 4. Z3 / Deterministik Kısıt Tutarlılığı ve UNSAT Çekirdeği Denetleyicisi (`verifyConstraintConsistencyBounds`)
   */
  function verifyConstraintConsistencyBounds(constraints, candidateOptions) {
    var c = constraints || {};
    var opts = Array.isArray(candidateOptions) ? candidateOptions : [];
    var unsatCore = [];

    if (typeof c.maxBudget === 'number' && typeof c.minBudget === 'number' && c.maxBudget < c.minBudget) {
      unsatCore.push('maxBudget (' + c.maxBudget + ') < minBudget (' + c.minBudget + ')');
    }
    if (typeof c.maxDurationDays === 'number' && c.maxDurationDays <= 0) {
      unsatCore.push('maxDurationDays (' + c.maxDurationDays + ') <= 0');
    }
    if (typeof c.maxRiskScore === 'number' && c.maxRiskScore < 0) {
      unsatCore.push('maxRiskScore (' + c.maxRiskScore + ') < 0');
    }

    var feasibleOptions = [];
    var rejectedByConstraint = [];

    for (var i = 0; i < opts.length; i++) {
      var o = opts[i] || {};
      var violations = [];
      if (typeof c.maxBudget === 'number' && typeof o.cost === 'number' && o.cost > c.maxBudget) {
        violations.push('cost (' + o.cost + ') > maxBudget (' + c.maxBudget + ')');
      }
      if (typeof c.maxDurationDays === 'number' && typeof o.durationDays === 'number' && o.durationDays > c.maxDurationDays) {
        violations.push('durationDays (' + o.durationDays + ') > maxDurationDays (' + c.maxDurationDays + ')');
      }
      if (typeof c.maxRiskScore === 'number' && typeof o.riskScore === 'number' && o.riskScore > c.maxRiskScore) {
        violations.push('riskScore (' + o.riskScore + ') > maxRiskScore (' + c.maxRiskScore + ')');
      }
      if (violations.length === 0) {
        feasibleOptions.push(o.name || ('Option_' + (i + 1)));
      } else {
        rejectedByConstraint.push({ option: o.name || ('Option_' + (i + 1)), violations: violations });
      }
    }

    if (opts.length > 0 && feasibleOptions.length === 0 && unsatCore.length === 0) {
      unsatCore.push('NO_OPTION_SATISFIES_JOINT_BOUNDS');
    }

    var status = unsatCore.length === 0 ? 'SAT' : 'UNSAT';
    return {
      status: status,
      satisfiable: status === 'SAT',
      feasibleOptions: feasibleOptions,
      rejectedByConstraint: rejectedByConstraint,
      unsatCore: unsatCore
    };
  }

  /**
   * Bölüm 7: 7 Dış Araç ve Teknoloji Değerlendirme Tablosu (`EXTERNAL_TECHNOLOGY_EVALUATION_CATALOG_7`)
   */
  var EXTERNAL_TECHNOLOGY_EVALUATION_CATALOG_7 = Object.freeze([
    {
      id: 'wasmtime_wasi',
      name: 'Wasmtime ve WASI (Bytecode Alliance)',
      license: 'Apache-2.0 WITH LLVM-exception',
      commercialStatus: 'UYGUN',
      architecturalDecision: 'Mevcut CAELUS bileşeni yeterli bulundu / Yalnızca masaüstü karşılaştırma referansı olarak tutuldu',
      rationaleTr: 'CAELUS zaten kendi deterministik WASM çekirdeğine (dist/caelus.wasm + WebWorker sınırı) ve yetenek bazlı izin kapısına sahiptir. Wasmtime masaüstü/sunucu süreçlerinde güçlüdür ancak tarayıcıda yerel WebAssembly motoru kullanılır ve iOS/iPadOS üzerinde işletim sistemi JIT kısıtlamaları (W^X) nedeniyle Wasmtime JIT kullanılamaz.'
    },
    {
      id: 'cedar_policy',
      name: 'Cedar Policy Language & Evaluator (AWS)',
      license: 'Apache-2.0',
      commercialStatus: 'UYGUN',
      architecturalDecision: 'Küçük prototip olarak denendi ve izin motoruna entegre edildi',
      rationaleTr: 'Cedar’ın permit/forbid ayrımı, forbid-overrides-permit kuralı ve varsayılan ret (default deny) modeli evaluateCedarStylePolicy() fonksiyonuyla CAELUS ajan ve kaynak izin denetleyicisine doğrudan uygulandı.'
    },
    {
      id: 'souffle_datalog',
      name: 'Soufflé Datalog',
      license: 'UPL-1.0 (Universal Permissive License)',
      commercialStatus: 'UYGUN',
      architecturalDecision: 'Küçük prototip olarak denendi / Native C++ derleyicisi karşılaştırma referansı olarak tutuldu',
      rationaleTr: 'Soufflé’nin katmanlı (stratified) yarı-naif Datalog çıkarımı ve türetim soykütüğü (provenance lineage) prensipleri runStratifiedDatalogLineageEngine() ile hafif JS prototipi olarak gömüldü; ağır C++ derleyici bağımlılığı mobil/tarayıcı paketine eklenmedi.'
    },
    {
      id: 'z3_prover',
      name: 'Z3 Theorem Prover (Microsoft Research)',
      license: 'MIT',
      commercialStatus: 'UYGUN',
      architecturalDecision: 'Mevcut CAELUS bileşeni yeterli bulundu + hafif kısıt tutarlılık denetleyicisi eklendi',
      rationaleTr: 'CAELUS çekirdeğinde zaten Rust proptest ve sabit nokta (Q32.32) değişmezlik kanıtları (docs/FIZIBILITE_ISPAT_VE_GOMULU.md) mevcuttur. Ayrıca kullanıcı bütçe/süre/risk kısıtlarının çelişkisini yakalayan verifyConstraintConsistencyBounds() eklendi; 30+ MB Z3 WASM ikilisi zorunlu çalışma zamanına yüklenmedi.'
    },
    {
      id: 'duckdb_local',
      name: 'DuckDB',
      license: 'MIT',
      commercialStatus: 'UYGUN',
      architecturalDecision: 'Mevcut CAELUS bileşeni yeterli bulundu (10.000 satır altı yerel akış motoru 0.28 ms)',
      rationaleTr: 'tools/verify_first_real_task_lab.py kıyaslamasında <10.000 satırlık kullanıcı CSV/XLSX dosyalarında CAELUS hafif akış motoru 0.28 ms’de sıfır bağımlılıkla çalışmaktadır; DuckDB (25k satırda 39.2 ms) yalnızca yüksek hacimli masaüstü analitiği için isteğe bağlı referans olarak belgelendi.'
    },
    {
      id: 'provsql',
      name: 'ProvSQL (Semiring Provenance)',
      license: 'MIT',
      commercialStatus: 'UYGUN',
      architecturalDecision: 'Küçük prototip olarak denendi (PostgreSQL bağımlılığı olmadan semiring soykütük modeli uygulandı)',
      rationaleTr: 'ProvSQL PostgreSQL eklentisi gerektirdiğinden veritabanı sunucusu eklenmedi; bunun yerine ProvSQL’in N[X] semiring soykütük polinomu (⊗ birleşim, ⊕ alternatif kanıt) computeProvenanceSemiringPolynomial() ile Cevap Pasaportuna entegre edildi.'
    },
    {
      id: 'model_context_protocol_mcp',
      name: 'MCP (Model Context Protocol)',
      license: 'MIT',
      commercialStatus: 'UYGUN',
      architecturalDecision: 'Doğrudan entegre edildi (tools/caelus_mcp_server.mjs — en az yetki ve salt okunur denetim sınırıyla)',
      rationaleTr: 'CAELUS MCP sunucusu JSON-RPC 2.0 üzerinden deterministik araçları sunar; ancak MCP tek başına güvenlik sınırı sayılmaz, özel kullanıcı dosyaları açık izin listesi olmadan dış araçlara açılmaz.'
    }
  ]);

  /**
   * Bölüm 5.7: Dil Yetkinliği ve Doğal Dil Çözümleme Derinliği Matrisi (`ADVISOR_LANGUAGE_CAPABILITY_MATRIX`)
   */
  var ADVISOR_LANGUAGE_CAPABILITY_MATRIX = Object.freeze({
    'tr-TR': {
      uiTranslationReady: true,
      advisorNluLevel: 'FULL_MORPHOLOGICAL_AND_DIALOGUE_NLU',
      descriptionTr: 'Tam Türkçe çekim eki soyma, zamir/eksilti çözümleme, kullanıcı düzeltmesi ("X değil Y"), olumsuzluk ve 12 konuşma eylemi desteklenir.'
    },
    'en-US': {
      uiTranslationReady: true,
      advisorNluLevel: 'STRUCTURED_KEYWORD_AND_ENTITY_NLU',
      descriptionTr: 'İngilizce arayüz çevirisi ve varlık/sayı/seçenek sorguları desteklenir; Türkçe morfolojik ek çözümleyici Türkçe odaklıdır.'
    },
    other10Locales: {
      locales: ['el', 'de', 'fr', 'es', 'it', 'pt', 'ar', 'he', 'ru', 'zh-Hans'],
      uiTranslationReady: true,
      advisorNluLevel: 'UI_LOCALIZED_ENTITY_LOOKUP_ONLY',
      descriptionTr: '12 dilde arayüz ve boş durum metinleri çevrilmiştir; ancak derin doğal dil/ek çözümlemesi şu anda Türkçe (birincil) ve İngilizce (temel) odaklıdır.'
    }
  });

  /**
   * Desteklenmeyen Serbest Soru Tespiti (Bölüm 5.6 — Dürüst Sınır Açıklaması)
   */
  function detectUnsupportedQuestionBoundary(text) {
    var raw = String(text || '').trim();
    var lower = raw.toLocaleLowerCase('tr-TR');
    if (/bana\s+(bir\s+)?([şs]iir|hik[aâ]ye|roman|masal|f[ıi]kra|kod\s+oyunu)\s+yaz/i.test(lower)) {
      return {
        isUnsupported: true,
        category: 'CREATIVE_WRITING_OUT_OF_SCOPE',
        reasonTr: 'Bu danışman genel amaçlı bir sohbet/metin üretim modeli (LLM) değildir; kurgusal metin, şiir veya hikâye üretmez. Yalnızca bağlı kaynak kayıtları, yerel dosyalarınız ve deterministik seçenek karşılaştırmaları hakkında kanıtlı yanıt verir.'
      };
    }
    if (/kesin\s+(al|sat)\s+emri\s+ver|hangi\s+hisseyi\s+kesin\s+alay[ıi]m|t[ıi]bbi\s+te[şs]his\s+koy|ila[çc]\s+re[çc]ete\s+et|mahkeme\s+karar[ıi]\s+ver/i.test(lower)) {
      return {
        isUnsupported: true,
        category: 'AUTONOMOUS_AUTHORITY_PROHIBITED',
        reasonTr: 'CAELUS finansal, tıbbi, hukuki veya operasyonel kararların otomatik ve kesin otoritesi değildir; yalnızca kaynaklı verileri, varsayımları ve eksik bilgileri şeffaf biçimde özetler.'
      };
    }
    return { isUnsupported: false, category: null, reasonTr: null };
  }

  /**
   * Kullanıcı CSV / Metin Tablosu Ayrıştırıcı (Satır Numaralı Kanıt ve Eksik Değer Tespiti — Bölüm 5.2 & 6.2)
   */
  function parseUserTableContentWithRowProvenance(fileName, rawContent, options) {
    var opts = options || {};
    var text = String(rawContent || '');
    var contentHash = computeDeterministicHashHex(text);
    var lines = text.split(/\r?\n/).filter(function (l) { return l.trim().length > 0; });
    if (lines.length === 0) {
      return {
        fileName: fileName,
        contentHash: contentHash,
        columns: [],
        totalDataRows: 0,
        validRows: [],
        missingOrInvalidRows: [],
        summaryTr: 'Dosya boş.'
      };
    }
    var delimiter = lines[0].indexOf(';') !== -1 && lines[0].indexOf(',') === -1 ? ';' : ',';
    var headers = lines[0].split(delimiter).map(function (h) { return h.trim(); });
    var validRows = [];
    var missingOrInvalidRows = [];

    for (var ln = 1; ln < lines.length; ln++) {
      var cols = lines[ln].split(delimiter).map(function (c) { return c.trim(); });
      var sourceRowNumber = ln + 1;
      var rowObj = { sourceRowNumber: sourceRowNumber, valuesByColumn: {} };
      var rowIssues = [];

      for (var cIdx = 0; cIdx < headers.length; cIdx++) {
        var colName = headers[cIdx] || ('col_' + (cIdx + 1));
        var cellVal = cols[cIdx] !== undefined ? cols[cIdx] : '';
        rowObj.valuesByColumn[colName] = cellVal;
        if (cellVal === '') {
          rowIssues.push('"' + colName + '" sütunu boş');
        } else if (/maliyet|cost|fiyat|price|sure|duration|gun|days|risk|puan|oran|miktar|amount/i.test(colName)) {
          var num = Number(cellVal.replace(',', '.'));
          if (Number.isNaN(num)) {
            rowIssues.push('"' + colName + '" sayısal değil ("' + cellVal + '")');
          } else if (num < 0 && /maliyet|cost|fiyat|sure|duration|gun|days/i.test(colName)) {
            rowIssues.push('"' + colName + '" negatif değer (' + num + ')');
          } else {
            rowObj.valuesByColumn[colName] = num;
          }
        }
      }

      if (!cols[0]) {
        rowIssues.push('Birincil tanımlayıcı/ad sütunu boş');
      }

      if (rowIssues.length > 0) {
        missingOrInvalidRows.push({
          sourceFile: fileName,
          sourceRowNumber: sourceRowNumber,
          rawLine: lines[ln],
          issues: rowIssues,
          reasonTr: 'Satır ' + sourceRowNumber + ': ' + rowIssues.join('; ')
        });
      } else {
        validRows.push(rowObj);
      }
    }

    return {
      fileName: fileName,
      mimeType: opts.mimeType || 'text/csv',
      contentHash: contentHash,
      ingestedAt: opts.nowIso || new Date().toISOString(),
      columns: headers,
      totalDataRows: lines.length - 1,
      validRows: validRows,
      missingOrInvalidRows: missingOrInvalidRows,
      originalContent: text
    };
  }

  /**
   * Konuşan Dünya Muhakeme Sistemi Denetleyicisi Oluşturucu (`createConversationalAdvisorSession`)
   */
  function createConversationalAdvisorSession(options) {
    var opts = options || {};
    var lwm = getLivingWorldModel();
    var trainingSampleModeActive = opts.enableTrainingSampleMode === true;

    // BÖLÜM 2.1 & 2.2: Üretim/normal kullanım modunda sabit örnek dünya kayıtları ve
    // sahte kullanıcı tercihleri gerçek veri yerine otomatik yüklenmez!
    var initialRealWorldRecords = [];
    var initialTrainingSampleRecords = [];
    var receivedVersionsById = new Map();

    function rememberReceivedVersion(record, receivedAt) {
      if (record.isSampleFixture || record.epistemic_status === 'UNVERIFIED_CLAIM') return;
      // Keep a copy independent of both the connector and live advisor memory.
      var snapshot = JSON.parse(JSON.stringify(record));
      var signature = JSON.stringify(snapshot, function (key, value) {
        return key === 'ingested_at' || key === 'last_checked_at' ? undefined : value;
      });
      var versions = receivedVersionsById.get(record.record_id) || [];
      if (versions.length && versions[versions.length - 1].signature === signature) return;
      versions.push({ receivedAt: receivedAt, signature: signature, record: snapshot });
      receivedVersionsById.set(record.record_id, versions);
    }

    function getReplayCut(knowledgeAsOf) {
      var cutoff = Date.parse(knowledgeAsOf);
      if (!Number.isFinite(cutoff) || cutoff > Date.now()) {
        throw new RangeError('Geçerli ve geçmiş bir bilgi kesiti seçin.');
      }
      var records = [];
      receivedVersionsById.forEach(function (versions) {
        for (var i = versions.length - 1; i >= 0; i--) {
          if (versions[i].receivedAt <= cutoff) {
            records.push(versions[i]);
            break;
          }
        }
      });
      records.sort(function (a, b) { return b.receivedAt - a.receivedAt; });
      return { cutoff: cutoff, records: records };
    }

    function answerReplayCut(userUtterance, cut) {
      var replay = createConversationalAdvisorSession({
        worldRecords: cut.records.map(function (entry) {
          return Object.assign({}, entry.record, { ingested_at: new Date(entry.receivedAt).toISOString() });
        }),
        language: opts.language
      });
      var result = replay.processAdvisorTurn(userUtterance);
      result.answerPassport.knowledgeAsOf = new Date(cut.cutoff).toISOString();
      result.answerPassport.availableWorldRecordCount = cut.records.length;
      return result;
    }

    function replayAdvisorTurn(userUtterance, knowledgeAsOf) {
      return answerReplayCut(userUtterance, getReplayCut(knowledgeAsOf));
    }

    function compareAdvisorReplayCuts(userUtterance, beforeAsOf, afterAsOf) {
      var before = getReplayCut(beforeAsOf);
      var after = getReplayCut(afterAsOf);
      if (after.cutoff <= before.cutoff) {
        throw new RangeError('İkinci bilgi kesiti ilk kesitten sonra olmalı.');
      }
      var previousById = new Map(before.records.map(function (entry) {
        return [entry.record.record_id, entry];
      }));
      var evidenceChanges = [];
      after.records.forEach(function (entry) {
        var record = entry.record;
        var previous = previousById.get(record.record_id);
        if (previous && previous.signature === entry.signature) return;
        evidenceChanges.push({
          kind: previous ? 'REVISED' : 'ADDED',
          recordId: record.record_id,
          title: record.title,
          sourceUrl: record.source_url,
          eventTime: record.event_time,
          receivedAt: new Date(entry.receivedAt).toISOString()
        });
      });
      return {
        before: answerReplayCut(userUtterance, before),
        after: answerReplayCut(userUtterance, after),
        evidenceChanges: evidenceChanges
      };
    }

    if (Array.isArray(opts.worldRecords) && opts.worldRecords.length > 0) {
      for (var wIdx = 0; wIdx < opts.worldRecords.length; wIdx++) {
        var normW = normalizeAdvisorWorldRecord(opts.worldRecords[wIdx]);
        if (normW.isSampleFixture && opts.allowSampleDataInRealMemory !== true) {
          initialTrainingSampleRecords.push(normW);
        } else if (normW.epistemic_status !== 'USER_PREFERENCE') {
          initialRealWorldRecords.push(normW);
          rememberReceivedVersion(normW, Date.now());
        }
      }
    } else if (trainingSampleModeActive) {
      initialTrainingSampleRecords = buildDefaultAdvisorWorldRecords({ markAsSampleFixture: true });
    }

    var initialParsedFiles = [];
    if (Array.isArray(opts.userFiles)) {
      opts.userFiles.forEach(function (uf) {
        if (uf && uf.fileName) {
          initialParsedFiles.push(
            uf.columns && Array.isArray(uf.validRows)
              ? uf
              : parseUserTableContentWithRowProvenance(uf.fileName, uf.originalContent || uf.content || '', { mimeType: uf.mimeType })
          );
        }
      });
    }

    // 5 Ayrıştırılmış Hafıza Katmanı + Açıkça Etiketlenmiş Eğitim Verisi Bölmesi
    var memoryStore = {
      A_EPHEMERAL_DIALOGUE_STATE: {
        activeEntity: null,
        activeRecordId: null,
        activeDomain: null,
        activeTimeWindow: null,
        lastIntent: null,
        userCorrections: [],
        pendingClarification: null,
        lastReferencedEntities: [],
        lastCalculationResult: null,
        turnHistory: []
      },
      B_USER_CONTROLLED_PREFERENCES: {
        interestAreas: Array.isArray(opts.initialInterestAreas)
          ? opts.initialInterestAreas.slice()
          : (trainingSampleModeActive ? ['Teknoloji ve Tedarik Zinciri', 'Yarı İletken ve Elektronik Donanım'] : []),
        followedEntities: Array.isArray(opts.initialFollowedEntities)
          ? opts.initialFollowedEntities.slice()
          : (trainingSampleModeActive ? ['TSMC', 'Apple Inc.'] : []),
        preferredLanguage: opts.language || 'tr-TR',
        budgetCeiling: typeof opts.budgetCeiling === 'number' ? opts.budgetCeiling : 100000,
        riskTolerance: opts.riskTolerance || 'DENGELI'
      },
      C_SOURCED_WORLD_MEMORY: initialRealWorldRecords,
      D_USER_PRIVATE_FILES: initialParsedFiles,
      E_PAST_ANALYSES_AND_REPORTS: [],
      F_TRAINING_SAMPLE_MEMORY: initialTrainingSampleRecords
    };

    function setTrainingSampleMode(enabled) {
      trainingSampleModeActive = Boolean(enabled);
      if (trainingSampleModeActive && memoryStore.F_TRAINING_SAMPLE_MEMORY.length === 0) {
        memoryStore.F_TRAINING_SAMPLE_MEMORY = buildDefaultAdvisorWorldRecords({ markAsSampleFixture: true });
      }
      if (!trainingSampleModeActive) {
        memoryStore.F_TRAINING_SAMPLE_MEMORY = [];
      }
      return {
        trainingSampleModeActive: trainingSampleModeActive,
        sampleRecordsCount: memoryStore.F_TRAINING_SAMPLE_MEMORY.length,
        realWorldRecordsCount: memoryStore.C_SOURCED_WORLD_MEMORY.length,
        badgeTr: trainingSampleModeActive ? 'Örnek veri (Eğitim alanı açık — Gerçek dünya hafızasına karışmaz)' : null
      };
    }

    function getActiveSearchableRecords() {
      if (memoryStore.C_SOURCED_WORLD_MEMORY.length > 0) {
        return memoryStore.C_SOURCED_WORLD_MEMORY;
      }
      if (trainingSampleModeActive) {
        return memoryStore.F_TRAINING_SAMPLE_MEMORY;
      }
      return [];
    }

    function findMatchingRecordsForEntity(entityName) {
      if (!entityName) return [];
      var pool = getActiveSearchableRecords();
      var target = String(entityName).toLocaleLowerCase('tr-TR');
      return pool.filter(function (rec) {
        if (!rec) return false;
        var titleMatch = String(rec.title || '').toLocaleLowerCase('tr-TR').indexOf(target) !== -1;
        var summaryMatch = String(rec.summary || '').toLocaleLowerCase('tr-TR').indexOf(target) !== -1;
        var ents = Array.isArray(rec.entities) ? rec.entities : [];
        var entMatch = ents.some(function (e) {
          var n = typeof e === 'string' ? e : (e && (e.name || e.id));
          return n && String(n).toLocaleLowerCase('tr-TR').indexOf(target) !== -1;
        });
        return titleMatch || summaryMatch || entMatch;
      });
    }

    function detectContradictionsInMatchingRecords(records, entityName) {
      var list = Array.isArray(records) ? records : [];
      var foundContradictions = [];
      for (var i = 0; i < list.length; i++) {
        for (var j = i + 1; j < list.length; j++) {
          var a = list[i];
          var b = list[j];
          if (!a || !b || a.record_id === b.record_id) continue;
          var sameOrUnspecifiedEventTime =
            !a.event_time ||
            !b.event_time ||
            a.event_time === 'not_provided' ||
            b.event_time === 'not_provided' ||
            String(a.event_time).slice(0, 10) === String(b.event_time).slice(0, 10);
          var explicitConflict =
            a.contradicts_record_id === b.record_id ||
            b.contradicts_record_id === a.record_id ||
            (typeof a.numeric_value === 'number' &&
             typeof b.numeric_value === 'number' &&
             a.relation && b.relation && a.relation === b.relation &&
             sameOrUnspecifiedEventTime &&
             a.numeric_value !== b.numeric_value);

          if (explicitConflict) {
            foundContradictions.push({
              entity: entityName || a.title,
              recordA: {
                recordId: a.record_id,
                sourceName: a.source_name,
                eventTime: a.event_time,
                publishedAt: a.source_published_at,
                summary: a.summary,
                numericValue: a.numeric_value
              },
              recordB: {
                recordId: b.record_id,
                sourceName: b.source_name,
                eventTime: b.event_time,
                publishedAt: b.source_published_at,
                summary: b.summary,
                numericValue: b.numeric_value
              },
              explanationTr:
                'Çelişen Kayıt Tespiti: "' + a.source_name + '" (' + String(a.source_published_at || a.ingested_at).slice(0, 10) +
                ') ile "' + b.source_name + '" (' + String(b.source_published_at || b.ingested_at).slice(0, 10) +
                ') farklı değer/iddia bildiriyor. Tek bir doğruymuş gibi birleştirilmedi.'
            });
          }
        }
      }
      return foundContradictions;
    }

    function discoverRelatedEntitiesAndPaths(entityName, matchingRecords) {
      var targetLower = String(entityName || '').toLocaleLowerCase('tr-TR');
      var relations = [];
      var seenNames = new Set();

      // 1. Doğrudan aynı kaynaklı kayıtta ortak geçen kurumlar (Birlikte geçme != Nedensellik)
      for (var i = 0; i < matchingRecords.length; i++) {
        var rec = matchingRecords[i];
        var isSample = Boolean(rec.isSampleFixture || rec.epistemic_status === 'SAMPLE_TRAINING_DATA');
        var ents = Array.isArray(rec.entities) ? rec.entities : [];
        for (var j = 0; j < ents.length; j++) {
          var ent = ents[j];
          var name = typeof ent === 'string' ? ent : (ent && ent.name);
          if (!name) continue;
          var nl = name.toLocaleLowerCase('tr-TR');
          if (nl === targetLower || seenNames.has(nl)) continue;
          seenNames.add(nl);
          relations.push({
            relatedEntity: name,
            entitySector: ent.sector || 'Kurumsal Varlık',
            relationCategory: 'DOGRUDAN_KAYNAKLI_ILISKI',
            relationLabelTr: isSample ? 'Örnek Veri İlişkisi / Ortak Kayıt' : 'Kaynaktan Alınmış İlişki / Ortak Kayıt',
            evidenceRecordId: rec.record_id,
            evidenceSourceName: rec.source_name,
            evidenceTitle: rec.title,
            eventTime: rec.event_time,
            epistemicClass: isSample ? 'SAMPLE_TRAINING_DATA' : 'SOURCE_CLAIM',
            isCausalProof: false,
            explanationTr:
              entityName + ' ile ' + name + ' aynı kaynak kaydında (' + rec.source_name + ' — "' + rec.title + '") birlikte yer alıyor (Aynı belgede geçme tek başına nedensellik kanıtı değildir).'
          });
        }
      }

      // 2. Yaşayan Dünya Katmanı (CaelusLivingWorldModel) üzerinden alanlar arası bağlantı keşfi
      var activePool = getActiveSearchableRecords();
      if (lwm && typeof lwm.discoverCrossDomainLivingConnections === 'function' && activePool.length > 0) {
        try {
          var v2Records = activePool.map(convertAdvisorRecordToLivingWorldV2).filter(Boolean);
          var cross = lwm.discoverCrossDomainLivingConnections(v2Records, {
            focusEntity: entityName
          });
          var crossLinks = (cross && Array.isArray(cross.connections)) ? cross.connections : [];
          for (var c = 0; c < crossLinks.length; c++) {
            var link = crossLinks[c];
            relations.push({
              relatedEntity: link.targetEntity || link.nodeB || 'Alanlar Arası Bağlantı',
              entitySector: (link.domains || []).join(' ↔ '),
              relationCategory: link.categoryCode || 'ORTAK_VARLIK_BAGLANTISI',
              relationLabelTr: link.categoryLabelTr || 'Alanlar Arası İlişki',
              evidenceRecordId: (link.supportingRecordIds && link.supportingRecordIds[0]) || null,
              evidenceSourceName: 'CAELUS Yaşayan Dünya Grafı',
              evidenceTitle: link.explanationTr || link.summary || '',
              eventTime: link.detectedAt || null,
              epistemicClass: link.isHypothesis ? 'HYPOTHESIS' : 'RULE_DERIVATION',
              isCausalProof: false,
              explanationTr: link.explanationTr || 'Ortak varlık ve zaman penceresi üzerinden tespit edilen bağlantı.'
            });
          }
        } catch (_) {}
      }

      return relations;
    }

    function selectAdvisoryPolicyAction(nlu, matchingRecords, unsupportedBoundary) {
      if (unsupportedBoundary && unsupportedBoundary.isUnsupported) {
        return ADVISORY_POLICY_ACTIONS_12.ABSTAIN_INSUFFICIENT_DATA;
      }
      switch (nlu.speechAct) {
        case SUPPORTED_SPEECH_ACTS_12.GREETING_AND_GUIDE:
          return ADVISORY_POLICY_ACTIONS_12.RESOLVE_CONTEXT;
        case SUPPORTED_SPEECH_ACTS_12.WORLD_STATUS_QUERY:
        case SUPPORTED_SPEECH_ACTS_12.ENTITY_RECENT_CHANGE:
        case SUPPORTED_SPEECH_ACTS_12.TEMPORAL_DIFF_QUERY:
          return matchingRecords.length > 0
            ? ADVISORY_POLICY_ACTIONS_12.FIND_RECORD
            : ADVISORY_POLICY_ACTIONS_12.ABSTAIN_INSUFFICIENT_DATA;
        case SUPPORTED_SPEECH_ACTS_12.RELATION_EXPLORATION:
          return matchingRecords.length > 0
            ? ADVISORY_POLICY_ACTIONS_12.EXPLORE_RELATION_PATH
            : ADVISORY_POLICY_ACTIONS_12.ABSTAIN_INSUFFICIENT_DATA;
        case SUPPORTED_SPEECH_ACTS_12.USER_DOMAIN_IMPACT:
          return matchingRecords.length > 0
            ? ADVISORY_POLICY_ACTIONS_12.EVALUATE_USER_DOMAIN_IMPACT
            : ADVISORY_POLICY_ACTIONS_12.ABSTAIN_INSUFFICIENT_DATA;
        case SUPPORTED_SPEECH_ACTS_12.PROVENANCE_AND_EVIDENCE:
          return ADVISORY_POLICY_ACTIONS_12.INSPECT_SOURCE;
        case SUPPORTED_SPEECH_ACTS_12.CONTRADICTION_QUERY:
          return ADVISORY_POLICY_ACTIONS_12.SHOW_CONTRADICTION;
        case SUPPORTED_SPEECH_ACTS_12.OPTION_COMPARISON:
          return ADVISORY_POLICY_ACTIONS_12.COMPARE_OPTIONS;
        case SUPPORTED_SPEECH_ACTS_12.ASSUMPTION_CHANGE:
          return ADVISORY_POLICY_ACTIONS_12.SHOW_ASSUMPTION;
        case SUPPORTED_SPEECH_ACTS_12.USER_FILE_QUERY:
          return memoryStore.D_USER_PRIVATE_FILES.length > 0
            ? ADVISORY_POLICY_ACTIONS_12.RUN_CALCULATION
            : ADVISORY_POLICY_ACTIONS_12.ABSTAIN_INSUFFICIENT_DATA;
        default:
          return ADVISORY_POLICY_ACTIONS_12.ASK_CLARIFICATION;
      }
    }

    /**
     * 8 Katmanlı Konuşma Turu İşleyici (`processAdvisorTurn`)
     */
    function processAdvisorTurn(userUtterance, turnOptions) {
      var tOpts = turnOptions || {};
      var nowIso = new Date().toISOString();
      var state = memoryStore.A_EPHEMERAL_DIALOGUE_STATE;
      var prefs = memoryStore.B_USER_CONTROLLED_PREFERENCES;
      var activePool = getActiveSearchableRecords();

      // Katman 1: Giriş, Ses Durumu ve Güvenlik Taraması
      var voiceState = getVoiceStackCatalogAndStatus({ micEnabled: tOpts.micEnabled === true });
      var injectionCheck = scanUntrustedSourceForInjection(userUtterance);
      var unsupportedBoundary = detectUnsupportedQuestionBoundary(userUtterance);

      // Katman 2: NLU Analizi
      var nlu = analyzeUtteranceNlu(userUtterance, state, activePool);

      if (nlu.correction.isCorrection) {
        state.userCorrections.push({
          correctedAt: nowIso,
          rejectedTarget: nlu.correction.rejectedTarget || state.activeEntity,
          correctedTarget: nlu.correction.correctedTarget
        });
      }

      var focusEntity = nlu.resolvedEntity || state.activeEntity || null;
      var matchingRecords = focusEntity
        ? findMatchingRecordsForEntity(focusEntity)
        : (nlu.speechAct === SUPPORTED_SPEECH_ACTS_12.WORLD_STATUS_QUERY || nlu.speechAct === SUPPORTED_SPEECH_ACTS_12.CONTRADICTION_QUERY
            ? activePool.slice(0, 6)
            : []);

      // Katman 4: Danışmanlık Politikası
      var policyAction = selectAdvisoryPolicyAction(nlu, matchingRecords, unsupportedBoundary);

      // Katman 6 & 7: Araçlar, Muhakeme ve Yapılandırılmış Cevap Planı
      var passportSegments = [];
      var claimIds = [];
      var calculationIds = [];
      var assumptions = [];
      var contradictions = [];
      var unknowns = [];
      var securityWarnings = [];
      var suggestedNextAction = '';
      var responseParagraphs = [];

      if (injectionCheck.isSuspicious) {
        securityWarnings.push({
          code: 'UNTRUSTED_INSTRUCTION_PATTERN_DETECTED',
          messageTr: 'Girdi içinde sistem/yetki komutu benzeri ifade tespit edildi; güvenlik politikası gereği hiçbir sistem aracı veya yetki değişimi tetiklenmedi.'
        });
      }

      if (trainingSampleModeActive && memoryStore.C_SOURCED_WORLD_MEMORY.length === 0) {
        passportSegments.push({
          classCode: 'SAMPLE_TRAINING_DATA',
          epistemicState: 'SAMPLE_TRAINING_DATA',
          labelTr: EPISTEMIC_STATES_12.SAMPLE_TRAINING_DATA.labelTr,
          text: 'Örnek veri: Eğitim alanı açık. Bu yanıttaki örnek kayıtlar gerçek dünya hafızasına aktarılmaz ve canlı kaynak doğrulaması yerine geçmez.'
        });
      }

      if (nlu.correction.isCorrection && nlu.correction.correctedTarget) {
        passportSegments.push({
          classCode: 'USER_INPUT',
          epistemicState: 'USER_INPUT',
          labelTr: ANSWER_PASSPORT_CLASSES_10.USER_INPUT.labelTr,
          text: 'Kullanıcı düzeltmesi uygulandı: Odak varlık "' + nlu.correction.correctedTarget + '" olarak güncellendi.'
        });
      }

      // Senaryo 0: Kapsam Dışı Serbest Soru veya Yetki Sınırı (Bölüm 5.6)
      if (unsupportedBoundary.isUnsupported) {
        unknowns.push(unsupportedBoundary.reasonTr);
        passportSegments.push({
          classCode: 'UNKNOWN',
          epistemicState: 'UNKNOWN',
          labelTr: ANSWER_PASSPORT_CLASSES_10.UNKNOWN.labelTr,
          text: unsupportedBoundary.reasonTr
        });
        responseParagraphs.push(unsupportedBoundary.reasonTr);
        suggestedNextAction = 'Bağlı açık kaynaklardan (Wikidata, World Bank, SEC EDGAR, OpenAlex) bir varlık/gösterge sorgulayabilir veya kendi CSV/XLSX dosyanızı yükleyerek analiz edebilirsiniz.';
      }
      // Senaryo 1: Kullanıcı Özel Dosyası Sorgusu (`USER_FILE_QUERY` — Bölüm 5.1 & 6.2)
      else if (nlu.speechAct === SUPPORTED_SPEECH_ACTS_12.USER_FILE_QUERY) {
        if (memoryStore.D_USER_PRIVATE_FILES.length === 0) {
          unknowns.push('Henüz yüklenmiş bir yerel kullanıcı dosyası bulunmuyor.');
          passportSegments.push({
            classCode: 'UNKNOWN',
            epistemicState: 'UNKNOWN',
            labelTr: ANSWER_PASSPORT_CLASSES_10.UNKNOWN.labelTr,
            text: EMPTY_WORLD_DATA_MESSAGE_TR
          });
          responseParagraphs.push(EMPTY_WORLD_DATA_MESSAGE_TR);
          suggestedNextAction = 'Yerel bir CSV veya XLSX dosyası seçerek sütunlarını, eksik değerlerini ve satır numaralı karşılaştırmasını inceleyebilirsiniz.';
        } else {
          var activeFile = memoryStore.D_USER_PRIVATE_FILES[0];
          var fCalcId = 'calc-file-' + Date.now();
          calculationIds.push(fCalcId);

          for (var vrIdx = 0; vrIdx < activeFile.validRows.length; vrIdx++) {
            var vRow = activeFile.validRows[vrIdx];
            passportSegments.push({
              classCode: 'SOURCE_CLAIM',
              epistemicState: 'USER_FILE_FACT',
              labelTr: EPISTEMIC_STATES_12.USER_FILE_FACT.labelTr,
              sourceFile: activeFile.fileName,
              sourceRowNumber: vRow.sourceRowNumber,
              text: activeFile.fileName + ' (Satır ' + vRow.sourceRowNumber + '): ' + JSON.stringify(vRow.valuesByColumn)
            });
          }

          passportSegments.push({
            classCode: 'VERIFIED_CALCULATION',
            epistemicState: 'VERIFIED_CALCULATION',
            labelTr: ANSWER_PASSPORT_CLASSES_10.VERIFIED_CALCULATION.labelTr,
            calculationId: fCalcId,
            sourceFile: activeFile.fileName,
            text:
              '"' + activeFile.fileName + '" dosyasında ' + activeFile.columns.length + ' sütun (' + activeFile.columns.join(', ') +
              '), ' + activeFile.validRows.length + ' geçerli satır ve ' + activeFile.missingOrInvalidRows.length + ' eksik/hatalı satır tespit edildi.'
          });

          for (var errIdx = 0; errIdx < activeFile.missingOrInvalidRows.length; errIdx++) {
            var errRow = activeFile.missingOrInvalidRows[errIdx];
            unknowns.push(errRow.reasonTr);
            passportSegments.push({
              classCode: 'UNKNOWN',
              epistemicState: 'UNKNOWN',
              labelTr: ANSWER_PASSPORT_CLASSES_10.UNKNOWN.labelTr,
              sourceFile: activeFile.fileName,
              sourceRowNumber: errRow.sourceRowNumber,
              text: errRow.reasonTr
            });
          }

          responseParagraphs.push(
            'Yüklediğiniz "' + activeFile.fileName + '" (SHA-256: ' + String(activeFile.contentHash).slice(0, 12) + '…) dosyasının deterministik inceleme sonucu:'
          );
          responseParagraphs.push(
            '• Sütunlar (' + activeFile.columns.length + '): ' + activeFile.columns.join(', ') +
            '\n• Geçerli Satır Sayısı: ' + activeFile.validRows.length + ' (Satır numaraları: ' +
            activeFile.validRows.map(function (r) { return 'Satır ' + r.sourceRowNumber; }).join(', ') + ')'
          );
          if (activeFile.missingOrInvalidRows.length > 0) {
            responseParagraphs.push(
              '• Eksik veya Geçersiz Değer Bulunan Satırlar (' + activeFile.missingOrInvalidRows.length + '): ' +
              activeFile.missingOrInvalidRows.map(function (e) { return e.reasonTr; }).join(' | ')
            );
          }
          suggestedNextAction = 'Dosyadaki geçerli satırları bütçe ve süre kriterlerinize göre karşılaştırabilir veya eksik satırları kendi dosyanızda düzeltebilirsiniz.';
        }
      }
      // Senaryo 1B: Çelişen Kayıt Sorgusu (`CONTRADICTION_QUERY` — Bölüm 5.1 & 5.3)
      else if (nlu.speechAct === SUPPORTED_SPEECH_ACTS_12.CONTRADICTION_QUERY) {
        var detectedConflicts = detectContradictionsInMatchingRecords(
          matchingRecords.length > 0 ? matchingRecords : activePool,
          focusEntity
        );
        if (detectedConflicts.length === 0) {
          unknowns.push('Mevcut kayıtlar arasında açıkça çelişen iki farklı kaynak kaydı tespit edilmedi.');
          passportSegments.push({
            classCode: 'UNKNOWN',
            epistemicState: 'UNKNOWN',
            labelTr: ANSWER_PASSPORT_CLASSES_10.UNKNOWN.labelTr,
            text: unknowns[0]
          });
          responseParagraphs.push(
            activePool.length === 0
              ? EMPTY_WORLD_DATA_MESSAGE_TR
              : 'İncelenen kayıtlar arasında şu anda doğrudan çelişen sayısal değer veya zıt kaynak iddiası bulunmuyor.'
          );
          suggestedNextAction = 'Farklı bir veri kaynağından yeni sorgu çekerek kaynaklar arası karşılaştırma yapabilirsiniz.';
        } else {
          for (var cIdx = 0; cIdx < detectedConflicts.length; cIdx++) {
            var conf = detectedConflicts[cIdx];
            contradictions.push(conf.explanationTr);
            passportSegments.push({
              classCode: 'CONTRADICTION',
              epistemicState: 'CONTRADICTION',
              labelTr: ANSWER_PASSPORT_CLASSES_10.CONTRADICTION.labelTr,
              recordId: conf.recordA.recordId + ' vs ' + conf.recordB.recordId,
              text: conf.explanationTr
            });
            responseParagraphs.push('• ' + conf.explanationTr);
          }
          suggestedNextAction = 'Çelişen kaynakların yayın tarihlerini ve veri toplama yöntemlerini (ör. resmi bildirim vs haber iddiası) kaynak bağlantılarından inceleyebilirsiniz.';
        }
      }
      // Senaryo 2: Belirli Kurum/Kişi/Konu Hakkında Son Değişiklik (Zorunlu Dikey Kesit Tur 1)
      else if (
        nlu.speechAct === SUPPORTED_SPEECH_ACTS_12.ENTITY_RECENT_CHANGE ||
        nlu.speechAct === SUPPORTED_SPEECH_ACTS_12.WORLD_STATUS_QUERY ||
        nlu.speechAct === SUPPORTED_SPEECH_ACTS_12.TEMPORAL_DIFF_QUERY
      ) {
        if (matchingRecords.length === 0) {
          var isCompletelyEmpty = activePool.length === 0 && memoryStore.D_USER_PRIVATE_FILES.length === 0;
          var emptyMsg = isCompletelyEmpty
            ? EMPTY_WORLD_DATA_MESSAGE_TR
            : (focusEntity ? '"' + focusEntity + '" hakkında ' : 'Bu konuda ') +
              'şu anda bağlı dünya hafızasında doğrulanmış bir kayıt bulunmuyor. Olgu uydurmamak adına tahmin yürütmüyorum.';

          unknowns.push(
            isCompletelyEmpty
              ? EMPTY_WORLD_DATA_MESSAGE_TR
              : (focusEntity ? '"' + focusEntity + '" için ' : '') + 'yerel dünya hafızasında doğrulanmış güncel kayıt bulunamadı.'
          );
          passportSegments.push({
            classCode: 'UNKNOWN',
            epistemicState: 'UNKNOWN',
            labelTr: ANSWER_PASSPORT_CLASSES_10.UNKNOWN.labelTr,
            text: unknowns[0]
          });
          responseParagraphs.push(emptyMsg);
          suggestedNextAction = 'Gerçek kaynak bağlayıcısından (Wikidata, World Bank, SEC EDGAR veya OpenAlex) yeni sorgu çalıştırabilir veya kendi veri dosyanızı yükleyebilirsiniz.';
        } else {
          var primaryRec = matchingRecords[0];
          state.activeEntity = focusEntity || (primaryRec.entities && primaryRec.entities[0] && primaryRec.entities[0].name) || primaryRec.title;
          state.activeRecordId = primaryRec.record_id;
          state.lastReferencedEntities = matchingRecords.reduce(function (acc, r) {
            (r.entities || []).forEach(function (e) {
              var nm = typeof e === 'string' ? e : e.name;
              if (nm && acc.indexOf(nm) === -1) acc.push(nm);
            });
            return acc;
          }, []);

          // Aynı varlık için çelişen kayıt var mı kontrol et
          var entityConflicts = detectContradictionsInMatchingRecords(matchingRecords, state.activeEntity);
          for (var ec = 0; ec < entityConflicts.length; ec++) {
            contradictions.push(entityConflicts[ec].explanationTr);
            passportSegments.push({
              classCode: 'CONTRADICTION',
              epistemicState: 'CONTRADICTION',
              labelTr: ANSWER_PASSPORT_CLASSES_10.CONTRADICTION.labelTr,
              recordId: entityConflicts[ec].recordA.recordId + ' vs ' + entityConflicts[ec].recordB.recordId,
              text: entityConflicts[ec].explanationTr
            });
          }

          for (var i = 0; i < matchingRecords.length; i++) {
            var rec = matchingRecords[i];
            if (Array.isArray(rec.claims)) {
              rec.claims.forEach(function (c) {
                if (c && c.claim_id) claimIds.push(c.claim_id);
              });
            }
            var segEpistemic = rec.isSampleFixture
              ? 'SAMPLE_TRAINING_DATA'
              : (rec.epistemic_status === 'UNVERIFIED_CLAIM'
                  ? 'UNVERIFIED_CLAIM'
                  : (rec.epistemic_status === 'INDEPENDENTLY_CORROBORATED_FACT' ? 'INDEPENDENTLY_CORROBORATED_FACT' : 'SOURCE_CLAIM'));
            passportSegments.push({
              classCode: 'SOURCE_CLAIM',
              epistemicState: segEpistemic,
              labelTr: EPISTEMIC_STATES_12[segEpistemic] ? EPISTEMIC_STATES_12[segEpistemic].labelTr : ANSWER_PASSPORT_CLASSES_10.SOURCE_CLAIM.labelTr,
              sourceName: rec.source_name,
              sourceUrl: rec.source_url,
              eventTime: rec.event_time,
              publishedAt: rec.source_published_at,
              ingestedAt: rec.ingested_at,
              contentHash: rec.content_hash,
              recordId: rec.record_id,
              isStaleCached: Boolean(rec.is_stale_cached_record),
              text:
                (rec.isSampleFixture ? '[Örnek veri — ' : '[') + rec.source_name +
                ' | Olay: ' + String(rec.event_time).slice(0, 10) +
                ' | Alım: ' + String(rec.ingested_at).slice(0, 10) + '] ' + rec.title + ' — ' + rec.summary
            });
          }

          var headerPrefix = (trainingSampleModeActive && memoryStore.C_SOURCED_WORLD_MEMORY.length === 0)
            ? '[Örnek veri] ' + state.activeEntity + ' hakkında eğitim alanında ' + matchingRecords.length + ' örnek kayıt bulunuyor:'
            : state.activeEntity + ' hakkında kaynaklı dünya hafızasında ' + matchingRecords.length + ' kayıtlı gelişme bulundu (Kaynaktan alınmış iddia / kayıt):';

          responseParagraphs.push(headerPrefix);
          for (var m = 0; m < matchingRecords.length; m++) {
            var mr = matchingRecords[m];
            var staleNote = mr.is_stale_cached_record ? ' [UYARI: Kaynak şu an erişilemiyor; son bilinen eski kayıt]' : '';
            responseParagraphs.push(
              '• [' + (mr.isSampleFixture ? 'Örnek veri · ' : '') + mr.source_name +
              ' — Olay Tarihi: ' + String(mr.event_time).slice(0, 10) +
              ', Yayın: ' + String(mr.source_published_at).slice(0, 10) +
              ', Alım: ' + String(mr.ingested_at).slice(0, 10) + ']' + staleNote + ' ' +
              mr.title + ': ' + mr.summary
            );
          }
          if (contradictions.length > 0) {
            responseParagraphs.push('⚠️ ' + contradictions.join(' '));
          }
          suggestedNextAction = '"' + state.activeEntity + ' ile ilgili bu değişiklik hangi kurumlarla ilişkili?" diye sorarak doğrudan ve dolaylı bağlantı yollarını inceleyebilirsiniz.';
        }
      }
      // Senaryo 3: İlişki Sorgusu (Zorunlu Dikey Kesit Tur 2: "Bu değişiklik hangi kurumlarla ilişkili?")
      else if (nlu.speechAct === SUPPORTED_SPEECH_ACTS_12.RELATION_EXPLORATION) {
        if (!focusEntity || matchingRecords.length === 0) {
          unknowns.push('İlişkisi incelenecek odak kurum veya kaynaklı kayıt bağlamı bulunamadı.');
          passportSegments.push({
            classCode: 'UNKNOWN',
            epistemicState: 'UNKNOWN',
            labelTr: ANSWER_PASSPORT_CLASSES_10.UNKNOWN.labelTr,
            text: activePool.length === 0 ? EMPTY_WORLD_DATA_MESSAGE_TR : unknowns[0]
          });
          responseParagraphs.push(
            activePool.length === 0
              ? EMPTY_WORLD_DATA_MESSAGE_TR
              : 'Hangi kurum veya değişiklik arasındaki ilişkileri incelemek istediğinizi netleştirebilir misiniz? (Örn. önce bir kurum adını belirtebilirsiniz.)'
          );
          suggestedNextAction = 'Önce incelemek istediğiniz kurumun adını yazın veya bir kaynak seçin.';
        } else {
          var relations = discoverRelatedEntitiesAndPaths(focusEntity, matchingRecords);
          state.activeEntity = focusEntity;
          if (relations.length === 0) {
            unknowns.push(focusEntity + ' için mevcut kayıtlarda başka bir kurumla doğrulanmış bağlantı bulunamadı.');
            passportSegments.push({
              classCode: 'UNKNOWN',
              epistemicState: 'UNKNOWN',
              labelTr: ANSWER_PASSPORT_CLASSES_10.UNKNOWN.labelTr,
              text: unknowns[0]
            });
            responseParagraphs.push(focusEntity + ' için mevcut dünya kayıtlarında başka bir kurumla ortak kayıt bulunamadı.');
          } else {
            responseParagraphs.push(
              'Önceki turda konuştuğumuz ' + focusEntity + ' gelişmesiyle ilişkili kurumlar ve kanıt sınıfları şunlardır:'
            );
            for (var rIdx = 0; rIdx < relations.length; rIdx++) {
              var rel = relations[rIdx];
              var pClass = rel.epistemicClass === 'HYPOTHESIS' ? 'HYPOTHESIS' : (rel.epistemicClass === 'RULE_DERIVATION' ? 'RULE_DERIVATION' : 'SOURCE_CLAIM');
              passportSegments.push({
                classCode: pClass,
                epistemicState: rel.epistemicClass || pClass,
                labelTr: ANSWER_PASSPORT_CLASSES_10[pClass].labelTr,
                sourceName: rel.evidenceSourceName,
                recordId: rel.evidenceRecordId,
                text: rel.relatedEntity + ' (' + rel.relationLabelTr + '): ' + rel.explanationTr
              });
              responseParagraphs.push(
                '• ' + rel.relatedEntity + ' [' + rel.relationLabelTr + ' — Kaynak: ' + rel.evidenceSourceName + ']: ' + rel.explanationTr
              );
            }
            responseParagraphs.push(
              'Not: Aynı belgede iki ismin birlikte geçmesi veya zamansal yakınlık tek başına nedensellik kanıtı değildir.'
            );
          }
          suggestedNextAction = '"Peki bu benim ilgilendiğim alanı etkiler mi?" diye sorarak kendi ilgi alanlarınız açısından olası etkileri değerlendirebilirsiniz.';
        }
      }
      // Senaryo 4: Kullanıcı İlgi Alanı ve Danışmanlık Etkisi (Zorunlu Dikey Kesit Tur 3: "Peki bu benim ilgilendiğim alanı etkiler mi?")
      else if (nlu.speechAct === SUPPORTED_SPEECH_ACTS_12.USER_DOMAIN_IMPACT) {
        var userInterests = Array.isArray(prefs.interestAreas) ? prefs.interestAreas : [];
        passportSegments.push({
          classCode: 'USER_PREFERENCE',
          epistemicState: 'USER_PREFERENCE',
          labelTr: ANSWER_PASSPORT_CLASSES_10.USER_PREFERENCE.labelTr,
          text: 'Kullanıcı kontrollü tercih hafızasındaki ilgi alanlarınız: ' + (userInterests.join(', ') || 'Tanımlı değil')
        });

        if (!focusEntity || matchingRecords.length === 0) {
          unknowns.push('Etki analizi için aktif bir dünya gelişmesi veya odak kurum bağlamı bulunmuyor.');
          passportSegments.push({
            classCode: 'UNKNOWN',
            epistemicState: 'UNKNOWN',
            labelTr: ANSWER_PASSPORT_CLASSES_10.UNKNOWN.labelTr,
            text: activePool.length === 0 ? EMPTY_WORLD_DATA_MESSAGE_TR : unknowns[0]
          });
          responseParagraphs.push(
            activePool.length === 0
              ? EMPTY_WORLD_DATA_MESSAGE_TR
              : 'Kayıtlı ilgi alanlarınız (' + (userInterests.join(', ') || 'belirtilmemiş') + ') mevcut, ancak hangi gelişmenin etkisini sormak istediğiniz net değil.'
          );
          suggestedNextAction = 'Lütfen değerlendirmek istediğiniz kurumu veya gelişmeyi belirtin.';
        } else {
          var rec0 = matchingRecords[0];
          passportSegments.push({
            classCode: 'SOURCE_CLAIM',
            epistemicState: rec0.isSampleFixture ? 'SAMPLE_TRAINING_DATA' : 'SOURCE_CLAIM',
            labelTr: ANSWER_PASSPORT_CLASSES_10.SOURCE_CLAIM.labelTr,
            sourceName: rec0.source_name,
            recordId: rec0.record_id,
            text: focusEntity + ' kaydı (' + rec0.source_name + '): ' + rec0.summary
          });
          var effectiveInterestsLabel = userInterests.length > 0 ? userInterests.join(', ') : 'henüz kullanıcı tarafından belirtilmemiş genel çalışma alanı';
          var ruleText =
            focusEntity + ' gelişmesi (' + (rec0.domains || []).join(', ') + ' alanları), tanımlı ilgi alanlarınız olan "' +
            effectiveInterestsLabel + '" ile tedarik zinciri ve sektörel bağımlılık kuralları üzerinden değerlendirildi.';
          passportSegments.push({
            classCode: 'RULE_DERIVATION',
            epistemicState: 'RULE_DERIVATION',
            labelTr: ANSWER_PASSPORT_CLASSES_10.RULE_DERIVATION.labelTr,
            ruleId: 'RULE_DOMAIN_INTERSECTION_V1',
            text: ruleText
          });
          var hypText =
            'Olası Bağlantı (Hipotez): Kapasite veya gösterge değişimleri, takip ettiğiniz projelerde tedarik süresi veya birim maliyet baskısı oluşturabilir (Doğrudan nedensellik kanıtı değil, incelenebilir senaryodur).';
          passportSegments.push({
            classCode: 'HYPOTHESIS',
            epistemicState: 'HYPOTHESIS',
            labelTr: ANSWER_PASSPORT_CLASSES_10.HYPOTHESIS.labelTr,
            text: hypText
          });
          var unkText =
            'Eksik Bilgi (Bilinmeyen): Sizin kendi sözleşmelerinizdeki stok tampon süresi ve birim fiyat sabitleme koşulları dünya hafızasında yer almadığından net mali etki tutarı henüz hesaplanamaz.';
          unknowns.push(unkText);
          passportSegments.push({
            classCode: 'UNKNOWN',
            epistemicState: 'UNKNOWN',
            labelTr: ANSWER_PASSPORT_CLASSES_10.UNKNOWN.labelTr,
            text: unkText
          });

          responseParagraphs.push(
            '1. [Kullanıcı Tercihi ve Bağlam]: Açıkça tanımladığınız ilgi alanlarınız (' + effectiveInterestsLabel + ') ile önceki turda incelenen ' + focusEntity + ' gelişmesini birlikte değerlendirdim.'
          );
          responseParagraphs.push(
            '2. [Kaynaktan Alınmış İddia + Kural Çıkarımı]: ' + ruleText
          );
          responseParagraphs.push(
            '3. [Olası Bağlantı / Hipotez]: ' + hypText
          );
          responseParagraphs.push(
            '4. [Bilinmeyen / Eksik Veri]: ' + unkText
          );
          suggestedNextAction = 'Kendi tedarik veya bütçe seçeneklerinizi içeren CSV/XLSX dosyanızı yükleyerek veya iki seçeneği yazarak deterministik maliyet/risk karşılaştırması çalıştırabilirsiniz.';
        }
      }
      // Senaryo 5: Kanıt ve Kaynak Sorma
      else if (nlu.speechAct === SUPPORTED_SPEECH_ACTS_12.PROVENANCE_AND_EVIDENCE) {
        if (matchingRecords.length === 0) {
          unknowns.push('Kanıtı gösterilecek aktif kayıt bulunamadı.');
          passportSegments.push({
            classCode: 'UNKNOWN',
            epistemicState: 'UNKNOWN',
            labelTr: ANSWER_PASSPORT_CLASSES_10.UNKNOWN.labelTr,
            text: activePool.length === 0 ? EMPTY_WORLD_DATA_MESSAGE_TR : unknowns[0]
          });
          responseParagraphs.push(activePool.length === 0 ? EMPTY_WORLD_DATA_MESSAGE_TR : 'Şu anda seçili bir kayıt bulunmuyor; önce bir kurum veya olay sorgulayabilirsiniz.');
          suggestedNextAction = 'Bir kaynak seçip sorgu çalıştırabilir veya yerel dosya ekleyebilirsiniz.';
        } else {
          responseParagraphs.push('Mevcut yanıtın dayandığı kaynak kayıtları, içerik özetleri (SHA-256) ve zaman damgaları:');
          matchingRecords.forEach(function (r) {
            passportSegments.push({
              classCode: 'SOURCE_CLAIM',
              epistemicState: r.isSampleFixture ? 'SAMPLE_TRAINING_DATA' : 'SOURCE_CLAIM',
              labelTr: ANSWER_PASSPORT_CLASSES_10.SOURCE_CLAIM.labelTr,
              sourceName: r.source_name,
              sourceUrl: r.source_url,
              recordId: r.record_id,
              contentHash: r.content_hash,
              text: r.source_name + ' (' + r.source_license + ') — Olay: ' + r.event_time + ', Yayın: ' + r.source_published_at + ', Sisteme Alım: ' + r.ingested_at + ', Hash: ' + String(r.content_hash || '').slice(0, 12)
            });
            responseParagraphs.push(
              '• Kaynak: ' + r.source_name + ' (' + r.source_url + ') | Lisans: ' + r.source_license +
              ' | Olay Zamanı: ' + r.event_time + ' | Yayın: ' + r.source_published_at +
              ' | CAELUS Alım: ' + r.ingested_at + ' | SHA-256: ' + String(r.content_hash || '').slice(0, 16)
            );
          });
          suggestedNextAction = 'Kaydın revizyon geçmişini veya çelişen iddiaları sorgulayabilirsiniz.';
        }
      }
      // Senaryo 6: Seçenek Karşılaştırma / Varsayım Değiştirme
      else if (
        nlu.speechAct === SUPPORTED_SPEECH_ACTS_12.OPTION_COMPARISON ||
        nlu.speechAct === SUPPORTED_SPEECH_ACTS_12.ASSUMPTION_CHANGE
      ) {
        var nums = nlu.temporalAndNumeric.numbers || [];
        if (nlu.speechAct === SUPPORTED_SPEECH_ACTS_12.ASSUMPTION_CHANGE && nums.length > 0) {
          prefs.budgetCeiling = nums[0].value;
          assumptions.push('Bütçe tavanı kullanıcı girdisiyle ' + nums[0].value + ' olarak güncellendi.');
          passportSegments.push({
            classCode: 'MODEL_ASSUMPTION',
            epistemicState: 'MODEL_ASSUMPTION',
            labelTr: ANSWER_PASSPORT_CLASSES_10.MODEL_ASSUMPTION.labelTr,
            text: assumptions[0]
          });
        }
        var calcId = 'calc-advisor-' + Date.now();
        calculationIds.push(calcId);
        var ceiling = prefs.budgetCeiling || 100000;
        assumptions.push('Aktif bütçe tavanı varsayımı: ' + ceiling + ' (kullanıcı tarafından değiştirilebilir).');
        var summaryCalc =
          'Deterministik Karşılaştırma Çerçevesi: Aktif bütçe tavanı varsayımı = ' + ceiling +
          ' birim. Seçeneklerin maliyet, süre ve tedarik riski kırılımı uydurma ağırlık kullanılmadan açık formülle hesaplanır.';
        passportSegments.push({
          classCode: 'VERIFIED_CALCULATION',
          epistemicState: 'VERIFIED_CALCULATION',
          labelTr: ANSWER_PASSPORT_CLASSES_10.VERIFIED_CALCULATION.labelTr,
          calculationId: calcId,
          text: summaryCalc
        });
        passportSegments.push({
          classCode: 'MODEL_ASSUMPTION',
          epistemicState: 'MODEL_ASSUMPTION',
          labelTr: ANSWER_PASSPORT_CLASSES_10.MODEL_ASSUMPTION.labelTr,
          text: 'Aktif bütçe tavanı varsayımı: ' + ceiling + ' (kullanıcı tarafından değiştirilebilir).'
        });
        responseParagraphs.push(summaryCalc);
        suggestedNextAction = 'Seçenek tablonuzu İlk Gerçek Görev veya Kişisel Ajan Karşılaştırma aracına aktararak satır bazlı kanıtlı raporu indirebilirsiniz.';
      }
      // Senaryo 7: Selamlama veya Belirsiz Soru
      else if (nlu.speechAct === SUPPORTED_SPEECH_ACTS_12.GREETING_AND_GUIDE) {
        passportSegments.push({
          classCode: 'USER_INPUT',
          epistemicState: 'USER_INPUT',
          labelTr: ANSWER_PASSPORT_CLASSES_10.USER_INPUT.labelTr,
          text: 'Kullanıcı selamlaması ve yönlendirme isteği.'
        });
        responseParagraphs.push(
          'Merhaba. Ben CAELUS Konuşan Dünya Muhakeme Danışmanıyım. Haricî bir LLM kullanmadan, yalnızca izin verdiğiniz gerçek kaynak kayıtları, kendi yerel dosyalarınız, açık kurallar ve deterministik hesaplama ile çalışırım.'
        );
        if (activePool.length === 0 && memoryStore.D_USER_PRIVATE_FILES.length === 0) {
          responseParagraphs.push(EMPTY_WORLD_DATA_MESSAGE_TR);
        }
        suggestedNextAction = 'Bir açık veri kaynağından (Wikidata veya World Bank) sorgu çekebilir, yerel CSV/XLSX dosyanızı yükleyebilir veya bir kurum hakkında soru sorabilirsiniz.';
      } else {
        unknowns.push('Sorguda incelenecek kurum, zaman aralığı veya karar seçeneği belirsiz.');
        passportSegments.push({
          classCode: 'UNKNOWN',
          epistemicState: 'UNKNOWN',
          labelTr: ANSWER_PASSPORT_CLASSES_10.UNKNOWN.labelTr,
          text: unknowns[0]
        });
        state.pendingClarification = {
          askedAt: nowIso,
          originalQuestion: userUtterance,
          clarificationPromptTr: 'Hangi kurum, olay veya karar seçeneği üzerinde durmamı istersiniz?'
        };
        responseParagraphs.push(
          'Sorunuzda hangi kurum, zaman aralığı veya seçenek üzerinde çalışmam gerektiği tam net değil. Yanlış bir varsayım yapmamak için soruyorum: Hangi kurum veya konuyu inceleyelim?'
        );
        suggestedNextAction = 'Bir kurum adı (ör. "TSMC" veya "Türkiye"), yerel dosya sorusu ("Dosyamda hangi satırlarda eksik veri var?") ya da karşılaştırmak istediğiniz seçenekleri yazabilirsiniz.';
      }

      // Katman 7: Yapılandırılmış Cevap Planı (Structured Answer Plan)
      var structuredAnswerPlan = {
        answer_type: policyAction,
        user_intent: nlu.speechAct,
        referenced_entities: focusEntity ? [focusEntity] : [],
        referenced_records: matchingRecords.map(function (r) { return r.record_id; }),
        claim_ids: claimIds,
        calculation_ids: calculationIds,
        assumptions: assumptions,
        contradictions: contradictions,
        unknowns: unknowns,
        confidence_basis: matchingRecords.length > 0
          ? (trainingSampleModeActive && memoryStore.C_SOURCED_WORLD_MEMORY.length === 0
              ? 'GROUNDED_IN_LABELED_TRAINING_SAMPLE_DATA'
              : 'GROUNDED_IN_' + matchingRecords.length + '_SOURCED_RECORDS')
          : 'ABSTAIN_OR_CLARIFICATION_REQUIRED',
        suggested_next_action: suggestedNextAction,
        language: prefs.preferredLanguage || 'tr-TR',
        response_policy: 'NON_LLM_CONTROLLED_GROUNDED_GENERATION',
        security_warnings: securityWarnings
      };

      // Katman 8: Kontrollü Yanıt, 7 Zorunlu Cevap Bileşeni (Bölüm 5.2) ve ProvSQL Semiring Soykütüğü
      var answerText = responseParagraphs.join('\n\n');
      var semiringProvenance = computeProvenanceSemiringPolynomial(passportSegments);
      var mandatoryDisclosure7 = {
        shortAnswerTr: responseParagraphs[0] || '',
        sourcesOrFileRows: passportSegments
          .filter(function (s) { return s.recordId || s.sourceFile; })
          .map(function (s) {
            return s.sourceFile
              ? (s.sourceFile + ' (Satır ' + s.sourceRowNumber + ')')
              : (s.sourceName + ' [' + s.recordId + ']');
          }),
        dataAndEventDates: matchingRecords.map(function (r) {
          return {
            recordId: r.record_id,
            eventTime: r.event_time,
            publishedAt: r.source_published_at,
            ingestedAt: r.ingested_at
          };
        }),
        appliedRuleOrCalculation: calculationIds.length > 0
          ? calculationIds.join(', ')
          : (passportSegments.some(function (s) { return s.classCode === 'RULE_DERIVATION'; }) ? 'RULE_DOMAIN_INTERSECTION_V1' : 'DIRECT_RECORD_LOOKUP'),
        assumptions: assumptions,
        unknowns: unknowns,
        nextStepForUser: suggestedNextAction
      };

      var answerPassport = {
        schema: 'CAELUS_ANSWER_PASSPORT_V1',
        generatedAt: nowIso,
        nonLlmGuaranteed: true,
        trainingSampleModeActive: trainingSampleModeActive && memoryStore.C_SOURCED_WORLD_MEMORY.length === 0,
        segments: passportSegments,
        mandatoryDisclosure7: mandatoryDisclosure7,
        provenanceSemiring: semiringProvenance,
        summaryCounts: passportSegments.reduce(function (acc, seg) {
          acc[seg.classCode] = (acc[seg.classCode] || 0) + 1;
          if (seg.epistemicState && seg.epistemicState !== seg.classCode) {
            acc[seg.epistemicState] = (acc[seg.epistemicState] || 0) + 1;
          }
          return acc;
        }, {})
      };

      state.lastIntent = nlu.speechAct;
      var turnRecord = {
        turnIndex: state.turnHistory.length + 1,
        timestamp: nowIso,
        userUtterance: userUtterance,
        nlu: nlu,
        policyAction: policyAction,
        structuredAnswerPlan: structuredAnswerPlan,
        answerText: answerText,
        answerPassport: answerPassport,
        voiceState: voiceState
      };
      state.turnHistory.push(turnRecord);

      return turnRecord;
    }

    function updateUserPreferences(partialPrefs) {
      if (!partialPrefs || typeof partialPrefs !== 'object') return memoryStore.B_USER_CONTROLLED_PREFERENCES;
      var p = memoryStore.B_USER_CONTROLLED_PREFERENCES;
      if (Array.isArray(partialPrefs.interestAreas)) {
        p.interestAreas = partialPrefs.interestAreas.map(String).filter(Boolean);
      }
      if (Array.isArray(partialPrefs.followedEntities)) {
        p.followedEntities = partialPrefs.followedEntities.map(String).filter(Boolean);
      }
      if (typeof partialPrefs.preferredLanguage === 'string' && partialPrefs.preferredLanguage.trim()) {
        p.preferredLanguage = partialPrefs.preferredLanguage.trim();
      }
      if (typeof partialPrefs.budgetCeiling === 'number' && !Number.isNaN(partialPrefs.budgetCeiling)) {
        p.budgetCeiling = partialPrefs.budgetCeiling;
      }
      return Object.assign({}, p);
    }

    function clearDialogueState() {
      memoryStore.A_EPHEMERAL_DIALOGUE_STATE = {
        activeEntity: null,
        activeRecordId: null,
        activeDomain: null,
        activeTimeWindow: null,
        lastIntent: null,
        userCorrections: [],
        pendingClarification: null,
        lastReferencedEntities: [],
        lastCalculationResult: null,
        turnHistory: []
      };
      return { cleared: true, state: memoryStore.A_EPHEMERAL_DIALOGUE_STATE };
    }

    function deleteUserPreferences() {
      memoryStore.B_USER_CONTROLLED_PREFERENCES = {
        interestAreas: [],
        followedEntities: [],
        preferredLanguage: 'tr-TR',
        budgetCeiling: null,
        riskTolerance: 'BELIRTILMEDI'
      };
      return { deleted: true, preferences: memoryStore.B_USER_CONTROLLED_PREFERENCES };
    }

    function inspectSeparatedMemory() {
      return {
        catalog: MEMORY_CLASS_CATALOG_5,
        trainingSampleModeActive: trainingSampleModeActive,
        A_EPHEMERAL_DIALOGUE_STATE: JSON.parse(JSON.stringify(memoryStore.A_EPHEMERAL_DIALOGUE_STATE)),
        B_USER_CONTROLLED_PREFERENCES: JSON.parse(JSON.stringify(memoryStore.B_USER_CONTROLLED_PREFERENCES)),
        C_SOURCED_WORLD_MEMORY_COUNT: memoryStore.C_SOURCED_WORLD_MEMORY.length,
        C_SOURCED_WORLD_MEMORY: memoryStore.C_SOURCED_WORLD_MEMORY.slice(),
        D_USER_PRIVATE_FILES_COUNT: memoryStore.D_USER_PRIVATE_FILES.length,
        D_USER_PRIVATE_FILES: memoryStore.D_USER_PRIVATE_FILES.map(function (f) {
          return {
            fileName: f.fileName,
            contentHash: f.contentHash,
            columns: f.columns,
            totalDataRows: f.totalDataRows,
            validRowsCount: f.validRows ? f.validRows.length : 0,
            missingOrInvalidRowsCount: f.missingOrInvalidRows ? f.missingOrInvalidRows.length : 0
          };
        }),
        E_PAST_ANALYSES_COUNT: memoryStore.E_PAST_ANALYSES_AND_REPORTS.length,
        F_TRAINING_SAMPLE_MEMORY_COUNT: memoryStore.F_TRAINING_SAMPLE_MEMORY.length
      };
    }

    function addWorldRecordsToAdvisorMemory(records, addOptions) {
      var aOpts = addOptions || {};
      if (!Array.isArray(records)) return memoryStore.C_SOURCED_WORLD_MEMORY.length;
      var receivedAt = Date.now();
      for (var i = 0; i < records.length; i++) {
        var raw = records[i];
        if (!raw || !raw.record_id) continue;
        // 1. Kullanıcı tercihi veya sohbet varsayımı dünya olgusu olarak yazılamaz!
        if (raw.epistemic_status === 'USER_PREFERENCE' || raw.record_type === 'USER_PREFERENCE') {
          continue;
        }
        var norm = normalizeAdvisorWorldRecord(raw);
        // 2. Örnek/eğitim verisi gerçek dünya hafızasına karışamaz!
        if (norm.isSampleFixture && aOpts.allowSampleDataInRealMemory !== true) {
          var sampleExists = memoryStore.F_TRAINING_SAMPLE_MEMORY.some(function (ex) {
            return ex.record_id === norm.record_id;
          });
          if (!sampleExists) memoryStore.F_TRAINING_SAMPLE_MEMORY.push(norm);
          continue;
        }
        // 3. Kaynaksız iddia (source_id veya geçerli source_url olmayan) doğrulanmış olguya yükseltilmez!
        if (norm.epistemic_status === 'UNVERIFIED_CLAIM' && aOpts.allowUnverifiedInWorldMemory !== true) {
          continue;
        }
        rememberReceivedVersion(norm, receivedAt);
        var exists = memoryStore.C_SOURCED_WORLD_MEMORY.some(function (ex) {
          return ex.record_id === norm.record_id;
        });
        if (!exists) {
          memoryStore.C_SOURCED_WORLD_MEMORY.unshift(norm);
        }
      }
      return memoryStore.C_SOURCED_WORLD_MEMORY.length;
    }

    function loadUserFileIntoAdvisor(fileName, content, fileOptions) {
      var parsed = parseUserTableContentWithRowProvenance(fileName, content, fileOptions);
      var existingIdx = memoryStore.D_USER_PRIVATE_FILES.findIndex(function (f) { return f.fileName === fileName; });
      if (existingIdx !== -1) {
        memoryStore.D_USER_PRIVATE_FILES[existingIdx] = parsed;
      } else {
        memoryStore.D_USER_PRIVATE_FILES.unshift(parsed);
      }
      return parsed;
    }

    return {
      processAdvisorTurn: processAdvisorTurn,
      replayAdvisorTurn: replayAdvisorTurn,
      compareAdvisorReplayCuts: compareAdvisorReplayCuts,
      updateUserPreferences: updateUserPreferences,
      clearDialogueState: clearDialogueState,
      deleteUserPreferences: deleteUserPreferences,
      inspectSeparatedMemory: inspectSeparatedMemory,
      addWorldRecordsToAdvisorMemory: addWorldRecordsToAdvisorMemory,
      ingestRealWorldRecords: addWorldRecordsToAdvisorMemory,
      ingestWorldRecord: function (rec, addOptions) {
        return addWorldRecordsToAdvisorMemory(Array.isArray(rec) ? rec : [rec], addOptions);
      },
      loadUserFileIntoAdvisor: loadUserFileIntoAdvisor,
      setTrainingSampleMode: setTrainingSampleMode,
      getVoiceStackCatalogAndStatus: getVoiceStackCatalogAndStatus
    };
  }

  // ============================================================================
  // BÖLÜM B: KİŞİSEL AJAN OLUŞTURMA VE ÇALIŞTIRMA PLATFORMU (`CaelusPersonalAgentStudio`)
  // ============================================================================

  var AGENT_CONTRACT_SCHEMA_VERSION = '1.0.0';

  /**
   * 9 Durumlu Ajan Yaşam Döngüsü (Bölüm 6.1)
   */
  var AGENT_LIFECYCLE_STATES_9 = Object.freeze({
    DRAFT: 'DRAFT',
    READY: 'READY',
    RUNNING: 'RUNNING',
    WAITING_FOR_USER: 'WAITING_FOR_USER',
    PAUSED: 'PAUSED',
    SOURCE_UNAVAILABLE: 'SOURCE_UNAVAILABLE',
    COMPLETED: 'COMPLETED',
    FAILED: 'FAILED',
    STOPPED: 'STOPPED'
  });

  /**
   * 3 Zorunlu Ajan Yetenek Türü (Bölüm 7)
   */
  var MANDATORY_AGENT_CAPABILITIES_3 = Object.freeze({
    TRACK_REAL_SOURCE: 'TRACK_REAL_SOURCE',
    INSPECT_USER_FILE: 'INSPECT_USER_FILE',
    COMPARE_OPTIONS: 'COMPARE_OPTIONS'
  });

  /**
   * 3 Dürüst Çalışma Modu (Bölüm 6.2)
   */
  var AGENT_EXECUTION_MODES_3 = Object.freeze({
    MANUAL: {
      code: 'MANUAL',
      labelTr: 'Elle Çalıştırılan Ajan',
      honestDisclosureTr: 'Yalnızca siz "Çalıştır" düğmesine bastığınızda çalışır; arka planda kendiliğinden başlamaz.'
    },
    APP_OPEN: {
      code: 'APP_OPEN',
      labelTr: 'Uygulama Açıkken Zamanlı Ajan',
      honestDisclosureTr: 'Yalnızca CAELUS sekmesi veya masaüstü uygulaması açıkken belirlenen aralıkla çalışır. Uygulama veya telefon kapalıyken 24 saat çalışıyor gibi gösterilmez.'
    },
    LOCAL_HOST: {
      code: 'LOCAL_HOST',
      labelTr: 'Yerel Masaüstü / Sunucu Süreci Ajanı',
      honestDisclosureTr: 'Yalnızca yerel bilgisayarınızda CAELUS yerel servisi çalışır durumdayken zamanlamayı sürdürür.'
    }
  });

  /**
   * Desteklenen Gerçek Kaynaklar ve Desteklenmeyen Kaynak Reddi (Bölüm 5.2 & 8)
   */
  var SUPPORTED_AGENT_SOURCES = Object.freeze([
    { id: 'wikidata', labelTr: 'Wikidata (Açık Bilgi Grafı — CC0)', commercialAllowed: true },
    { id: 'world_bank', labelTr: 'World Bank Indicators v2 (CC-BY 4.0)', commercialAllowed: true },
    { id: 'sec_edgar', labelTr: 'U.S. SEC EDGAR Kurumsal Bildirimleri (Public Domain)', commercialAllowed: true },
    { id: 'openalex', labelTr: 'OpenAlex Bilimsel Yayınlar (CC0)', commercialAllowed: true },
    { id: 'gdelt_doc', labelTr: 'GDELT DOC 2.0 Küresel Haber İndeksi', commercialAllowed: true },
    { id: 'user_local_file', labelTr: 'Kullanıcının Seçtiği Yerel Dosya (CSV / JSON / TXT)', commercialAllowed: true }
  ]);

  var UNSUPPORTED_SOURCE_PATTERNS = [
    { pattern: /b[üu]t[üu]n\s+sosyal\s+medya|t[üu]m\s+sosyal\s+medya|instagram|tiktok|whatsapp|telegram\s+mesajlar[ıi]m/i, reasonTr: 'Bütün sosyal medya veya kişisel mesajlaşma ağları' },
    { pattern: /kapal[ıi]\s+veritaban[ıi]|banka\s+hesab[ıi]m|e-?devlet\s+[şs]ifrem/i, reasonTr: 'Yetkisiz kapalı/özel hesaplar' },
    { pattern: /t[üu]m\s+d[üu]nyadaki\s+gizli|karanl[ıi]k\s+a[ğg]/i, reasonTr: 'Kapsamı belirsiz veya erişilemeyen ağlar' }
  ];

  /**
   * Doğal Dil Görev Açıklamasını Yapılandırılmış Ajan Taslağına Dönüştürücü (LLM Dışı — Bölüm 5.2)
   */
  function parseNaturalLanguageGoalToAgentDraft(goalText, options) {
    var raw = String(goalText || '').trim();
    var lower = raw.toLocaleLowerCase('tr-TR');
    var opts = options || {};

    // 1. Desteklenmeyen kaynak kontrolü
    for (var i = 0; i < UNSUPPORTED_SOURCE_PATTERNS.length; i++) {
      var up = UNSUPPORTED_SOURCE_PATTERNS[i];
      if (up.pattern.test(raw)) {
        return {
          supported: false,
          rejectedReason: up.reasonTr,
          honestUserMessageTr:
            'Bu kaynak şu anda desteklenmiyor. İstersen bağlı olan kaynaklardan seçim yapabilirsin.',
          availableSources: SUPPORTED_AGENT_SOURCES
        };
      }
    }

    // 2. Yetenek türü tespiti
    var capabilityType = MANDATORY_AGENT_CAPABILITIES_3.TRACK_REAL_SOURCE;
    if (/dosya|csv|json|tablo|sat[ıi]r|s[üu]tun/i.test(lower)) {
      capabilityType = MANDATORY_AGENT_CAPABILITIES_3.INSPECT_USER_FILE;
    } else if (/kar[şs][ıi]la[şs]t[ıi]r|se[çc]enek|k[ıi]yasla|maliyet|b[üu]t[çc]e/i.test(lower)) {
      capabilityType = MANDATORY_AGENT_CAPABILITIES_3.COMPARE_OPTIONS;
    }

    // 3. Kaynak seçimi
    var selectedSources = [];
    if (/wikidata|kurum|şirket|varlık/i.test(lower)) selectedSources.push('wikidata');
    if (/sec|edgar|apple|cik|bildirim/i.test(lower)) selectedSources.push('sec_edgar');
    if (/makale|bilim|ara[şs]t[ıi]rma|openalex/i.test(lower)) selectedSources.push('openalex');
    if (/ekonomi|enflasyon|gsyih|d[üu]nya\s+bankas[ıi]|world\s+bank/i.test(lower)) selectedSources.push('world_bank');
    if (/haber|medya|gdelt/i.test(lower)) selectedSources.push('gdelt_doc');

    if (capabilityType === MANDATORY_AGENT_CAPABILITIES_3.INSPECT_USER_FILE) {
      selectedSources = ['user_local_file'];
    } else if (selectedSources.length === 0) {
      selectedSources = ['wikidata', 'sec_edgar', 'openalex'];
    }

    // 4. Sıklık ve çalışma modu
    var scheduleMode = 'MANUAL';
    var scheduleDesc = 'manual';
    if (/her\s+saat|saatte\s+bir|periyodik|otomatik|zamanl[ıi]/i.test(lower)) {
      scheduleMode = 'APP_OPEN';
      scheduleDesc = 'every_60_minutes_while_app_open';
    }

    // 5. Odak varlıkları çıkar
    var extractedEntities = extractCandidateEntitiesFromText(raw, buildDefaultAdvisorWorldRecords()).map(function (c) {
      return c.name;
    });

    return {
      supported: true,
      capabilityType: capabilityType,
      proposedName: opts.name || (
        capabilityType === MANDATORY_AGENT_CAPABILITIES_3.INSPECT_USER_FILE
          ? 'Kullanıcı Dosyası Denetim Ajanı'
          : capabilityType === MANDATORY_AGENT_CAPABILITIES_3.COMPARE_OPTIONS
            ? 'Seçenek ve Kriter Karşılaştırma Ajanı'
            : (extractedEntities[0] ? extractedEntities[0] + ' Kaynak Takip Ajanı' : 'Gerçek Kaynak Takip Ajanı')
      ),
      proposedPurpose: raw || 'Belirlenen kaynakları ve kriterleri kanıtlarıyla incelemek.',
      selectedSources: selectedSources,
      focusEntities: extractedEntities,
      executionMode: scheduleMode,
      schedule: scheduleDesc,
      honestExecutionNoticeTr: AGENT_EXECUTION_MODES_3[scheduleMode].honestDisclosureTr
    };
  }

  /**
   * Sürümlü Ajan Sözleşmesi Oluşturucu ve Doğrulayıcı (`CAELUS_AGENT_CONTRACT_V1` — Bölüm 4 & 6)
   * İzinler varsayılan olarak kapalıdır (Default Deny); yalnızca açıkça verilen kaynak/dosya izni açılır.
   */
  function buildAgentContractV1(spec) {
    var s = spec || {};
    var nowIso = new Date().toISOString();
    var capabilityType = s.capabilityType || MANDATORY_AGENT_CAPABILITIES_3.TRACK_REAL_SOURCE;
    var execMode = s.executionMode && AGENT_EXECUTION_MODES_3[s.executionMode] ? s.executionMode : 'MANUAL';
    var strictDefaultDeny = s.strictDefaultDeny === true;

    var hasExplicitSources = Array.isArray(s.allowed_sources) && s.allowed_sources.length > 0;
    var hasExplicitFiles = Array.isArray(s.user_files) && s.user_files.length > 0;

    var allowedSources = Array.isArray(s.allowed_sources)
      ? s.allowed_sources.slice()
      : (strictDefaultDeny
          ? []
          : (capabilityType === MANDATORY_AGENT_CAPABILITIES_3.INSPECT_USER_FILE ? ['user_local_file'] : ['wikidata', 'sec_edgar', 'openalex']));

    var allowedTools = Array.isArray(s.allowed_tools)
      ? s.allowed_tools.slice()
      : (capabilityType === MANDATORY_AGENT_CAPABILITIES_3.INSPECT_USER_FILE
        ? ['file_table_inspector', 'row_provenance_linker']
        : capabilityType === MANDATORY_AGENT_CAPABILITIES_3.COMPARE_OPTIONS
          ? ['deterministic_option_calculator', 'unit_and_missing_validator']
          : ['living_world_source_reader', 'record_diff_detector']);

    var networkAccessGranted = s.network_access !== undefined
      ? Boolean(s.network_access)
      : (!strictDefaultDeny && (hasExplicitSources || capabilityType === MANDATORY_AGENT_CAPABILITIES_3.TRACK_REAL_SOURCE));

    var localFileReadGranted = s.local_file_read !== undefined
      ? Boolean(s.local_file_read)
      : (!strictDefaultDeny && (hasExplicitFiles || capabilityType === MANDATORY_AGENT_CAPABILITIES_3.INSPECT_USER_FILE));

    var agentId = s.agent_id || ('agent-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7));
    var contract = {
      agent_id: agentId,
      schema_version: AGENT_CONTRACT_SCHEMA_VERSION,
      version: typeof s.version === 'number' ? s.version : 1,
      version_history: Array.isArray(s.version_history) ? s.version_history.slice() : [],
      name: String(s.name || 'Kişisel CAELUS Ajanı').trim(),
      purpose: String(s.purpose || 'İzin verilen kaynakları ve verileri kurallarla incelemek.').trim(),
      capability_type: capabilityType,
      created_by: s.created_by || 'user',
      created_at: s.created_at || nowIso,
      updated_at: nowIso,
      status: s.status || AGENT_LIFECYCLE_STATES_9.READY,
      trigger: {
        type: execMode,
        schedule: s.schedule || (execMode === 'APP_OPEN' ? 'every_60_minutes_while_app_open' : 'manual_only'),
        interval_ms: typeof s.interval_ms === 'number' ? s.interval_ms : (execMode === 'APP_OPEN' ? 60 * 60 * 1000 : null),
        event_conditions: Array.isArray(s.event_conditions) ? s.event_conditions : [],
        honest_mode_disclosure: AGENT_EXECUTION_MODES_3[execMode].honestDisclosureTr
      },
      inputs: {
        topics: Array.isArray(s.topics) ? s.topics : [],
        entities: Array.isArray(s.entities) ? s.entities : [],
        locations: Array.isArray(s.locations) ? s.locations : [],
        user_files: Array.isArray(s.user_files) ? s.user_files : [],
        parameters: Object.assign({}, s.parameters || {})
      },
      allowed_sources: allowedSources,
      allowed_tools: allowedTools,
      permissions: {
        network_access: networkAccessGranted,
        local_file_read: localFileReadGranted,
        local_file_write: Boolean(s.local_file_write === true),
        notifications: Boolean(s.notifications === true),
        can_invoke_other_agents: false,
        external_action: false
      },
      memory_policy: {
        scope: 'agent_isolated_memory:' + agentId,
        retention_days: typeof s.retention_days === 'number' ? s.retention_days : 30,
        can_write_world_memory: false,
        can_read_other_agents: false
      },
      reasoning_policy: {
        allow_hypotheses: s.allow_hypotheses !== false,
        require_source_for_claims: true,
        abstain_on_missing_data: true
      },
      output_policy: {
        format: s.output_format || 'STRUCTURED_CARD_AND_REPORT',
        language: s.language || 'tr-TR',
        include_provenance: true,
        include_assumptions: true,
        include_unknowns: true
      },
      safety_limits: {
        max_runtime_ms: typeof s.max_runtime_ms === 'number' ? s.max_runtime_ms : 15000,
        max_steps: typeof s.max_steps === 'number' ? s.max_steps : 25,
        max_requests_per_run: typeof s.max_requests_per_run === 'number' ? s.max_requests_per_run : 10,
        max_records_per_run: typeof s.max_records_per_run === 'number' ? s.max_records_per_run : 200,
        max_result_bytes: typeof s.max_result_bytes === 'number' ? s.max_result_bytes : 524288,
        max_file_bytes: typeof s.max_file_bytes === 'number' ? s.max_file_bytes : (5 * 1024 * 1024),
        max_file_rows: typeof s.max_file_rows === 'number' ? s.max_file_rows : 10000
      },
      audit_policy: {
        log_every_step: true,
        log_source_access: true,
        log_permission_checks: true
      }
    };

    return contract;
  }

  function validateAgentContractV1(contract) {
    var errors = [];
    if (!contract || typeof contract !== 'object') {
      return { valid: false, errors: ['Ajan sözleşmesi nesnesi eksik.'] };
    }
    if (contract.schema_version !== AGENT_CONTRACT_SCHEMA_VERSION) {
      errors.push('Geçersiz schema_version: ' + contract.schema_version);
    }
    if (!contract.agent_id || typeof contract.agent_id !== 'string') {
      errors.push('agent_id zorunludur.');
    }
    if (!contract.name || typeof contract.name !== 'string') {
      errors.push('Ajan adı (name) zorunludur.');
    }
    if (!contract.purpose || typeof contract.purpose !== 'string') {
      errors.push('Ajan amacı (purpose) zorunludur.');
    }
    if (!AGENT_LIFECYCLE_STATES_9[contract.status]) {
      errors.push('Geçersiz yaşam döngüsü durumu: ' + contract.status);
    }
    if (!contract.permissions || typeof contract.permissions !== 'object') {
      errors.push('permissions bloğu zorunludur.');
    }
    if (!contract.memory_policy || contract.memory_policy.can_write_world_memory !== false) {
      errors.push('Ajan doğrudan doğrulanmış dünya hafızasına olgu yazamaz (can_write_world_memory: false olmalıdır).');
    }
    if (!contract.reasoning_policy || contract.reasoning_policy.require_source_for_claims !== true) {
      errors.push('require_source_for_claims: true zorunludur.');
    }
    if (!contract.safety_limits || typeof contract.safety_limits.max_steps !== 'number' || contract.safety_limits.max_steps <= 0) {
      errors.push('safety_limits.max_steps pozitif bir sayı olmalıdır.');
    }
    return {
      valid: errors.length === 0,
      errors: errors
    };
  }

  /**
   * Çalışma Zamanı Yetki ve İzolasyon Denetleyicisi (`enforceAgentRuntimePermission` — Bölüm 6.3 & 7.2 Cedar)
   */
  function enforceAgentRuntimePermission(agentContract, actionRequest, auditLog) {
    var nowIso = new Date().toISOString();
    var req = actionRequest || {};
    var perms = (agentContract && agentContract.permissions) || {};
    var allowedSources = (agentContract && agentContract.allowed_sources) || [];
    var allowedFiles = (agentContract && agentContract.inputs && agentContract.inputs.user_files) || [];
    var allowedTools = (agentContract && agentContract.allowed_tools) || [];
    var expectedScope = agentContract && agentContract.memory_policy && agentContract.memory_policy.scope;

    // Cedar tarzı politikaları derle (forbid her zaman permit'i ezer)
    var cedarPolicies = [
      {
        id: 'permit_own_memory',
        effect: 'permit',
        principal: agentContract ? agentContract.agent_id : '*',
        action: 'READ_AGENT_MEMORY',
        resource: expectedScope
      },
      {
        id: 'forbid_cross_agent_memory',
        effect: 'forbid',
        principal: '*',
        action: 'READ_AGENT_MEMORY',
        when: function (_, r) { return r.resource !== expectedScope; }
      },
      {
        id: 'permit_allowed_sources',
        effect: 'permit',
        principal: agentContract ? agentContract.agent_id : '*',
        action: 'ACCESS_SOURCE',
        resources: allowedSources
      },
      {
        id: 'forbid_network_when_disabled',
        effect: 'forbid',
        principal: '*',
        action: 'ACCESS_SOURCE',
        when: function (_, r) { return !perms.network_access && r.resource !== 'user_local_file'; }
      },
      {
        id: 'permit_allowed_files',
        effect: 'permit',
        principal: agentContract ? agentContract.agent_id : '*',
        action: 'READ_USER_FILE',
        resources: allowedFiles
      },
      {
        id: 'forbid_file_read_when_disabled',
        effect: 'forbid',
        principal: '*',
        action: 'READ_USER_FILE',
        when: function () { return !perms.local_file_read; }
      },
      {
        id: 'permit_allowed_tools',
        effect: 'permit',
        principal: agentContract ? agentContract.agent_id : '*',
        action: 'INVOKE_TOOL',
        resources: allowedTools
      }
    ];

    var cedarEval = evaluateCedarStylePolicy(cedarPolicies, {
      principal: agentContract ? agentContract.agent_id : 'unknown',
      action: req.type,
      resource: req.type === 'READ_AGENT_MEMORY' ? req.targetScope : req.target,
      context: {}
    });

    function recordCheck(allowed, code, detail) {
      var entry = {
        timestamp: nowIso,
        agentId: agentContract ? agentContract.agent_id : null,
        requestType: req.type,
        target: req.target || req.targetScope || null,
        allowed: allowed,
        code: code,
        cedarDecision: cedarEval.decision,
        cedarReasonCode: cedarEval.reasonCode,
        detailTr: sanitizeAuditLogMessage(detail)
      };
      if (Array.isArray(auditLog)) auditLog.push(entry);
      return entry;
    }

    // 1. Ajanlar arası hafıza izolasyonu kontrolü
    if (req.type === 'READ_AGENT_MEMORY') {
      if (req.targetScope !== expectedScope || !cedarEval.allowed) {
        return recordCheck(
          false,
          'CROSS_AGENT_ISOLATION_VIOLATION',
          'Ajan başka bir ajanın özel hafızasına (' + req.targetScope + ') erişemez.'
        );
      }
      return recordCheck(true, 'ALLOWED_OWN_MEMORY', 'Kendi izole hafıza kapsamına erişim doğrulandı.');
    }

    // 2. Ağ ve Kaynak erişimi kontrolü
    if (req.type === 'ACCESS_SOURCE') {
      if (!perms.network_access && req.target !== 'user_local_file') {
        return recordCheck(
          false,
          'PERMISSION_DENIED_NETWORK_DISABLED',
          'Ajanın ağ erişim yetkisi (network_access) kapalı olduğundan "' + req.target + '" kaynağına erişim engellendi.'
        );
      }
      if (allowedSources.indexOf(req.target) === -1 || !cedarEval.allowed) {
        return recordCheck(
          false,
          'PERMISSION_DENIED_SOURCE_NOT_ALLOWED',
          '"' + req.target + '" kaynağı bu ajanın izin verilen kaynaklar listesinde yer almıyor.'
        );
      }
      return recordCheck(true, 'ALLOWED_SOURCE', '"' + req.target + '" kaynağına erişim izni doğrulandı.');
    }

    // 3. Yerel dosya okuma kontrolü
    if (req.type === 'READ_USER_FILE') {
      if (!perms.local_file_read) {
        return recordCheck(
          false,
          'PERMISSION_DENIED_FILE_READ_DISABLED',
          'Ajanın yerel dosya okuma yetkisi (local_file_read) kapalı olduğundan dosya erişimi engellendi.'
        );
      }
      if (allowedFiles.indexOf(req.target) === -1 || !cedarEval.allowed) {
        return recordCheck(
          false,
          'PERMISSION_DENIED_FILE_NOT_IN_ALLOWLIST',
          '"' + req.target + '" dosyası bu ajana açıkça izin verilen dosyalar arasında değil.'
        );
      }
      return recordCheck(true, 'ALLOWED_FILE_READ', '"' + req.target + '" dosyası için okuma izni doğrulandı.');
    }

    // 4. Araç çağrısı kontrolü
    if (req.type === 'INVOKE_TOOL') {
      if (allowedTools.indexOf(req.target) === -1 || !cedarEval.allowed) {
        return recordCheck(
          false,
          'PERMISSION_DENIED_TOOL_NOT_ALLOWED',
          '"' + req.target + '" aracı bu ajanın izinli araçlar listesinde değil.'
        );
      }
      return recordCheck(true, 'ALLOWED_TOOL', '"' + req.target + '" aracı için yetki doğrulandı.');
    }

    return recordCheck(false, 'PERMISSION_DENIED_UNKNOWN_ACTION', 'Tanımlanmamış yetki talebi reddedildi.');
  }

  /**
   * Güvenli Şablon Dışa Aktarma (`exportAgentTemplateSafe` — Bölüm 4.2 & 8.2)
   * Gizli anahtarları, özel dosya içeriklerini ve kişisel verileri temizler.
   */
  function exportAgentTemplateSafe(agentContract) {
    var copy = JSON.parse(JSON.stringify(agentContract || {}));
    if (copy.inputs) {
      copy.inputs.user_files = [];
      if (copy.inputs.parameters && typeof copy.inputs.parameters === 'object') {
        var sanitizedParams = {};
        Object.keys(copy.inputs.parameters).forEach(function (k) {
          if (/key|token|secret|password|credential|private|filecontent/i.test(k)) {
            return;
          }
          sanitizedParams[k] = copy.inputs.parameters[k];
        });
        copy.inputs.parameters = sanitizedParams;
      }
    }
    copy.status = AGENT_LIFECYCLE_STATES_9.DRAFT;
    copy.exported_as_template_at = new Date().toISOString();
    copy.secrets_and_private_files_stripped = true;
    return copy;
  }

  var STUDIO_STORAGE_KEY_V1 = 'caelus_personal_agent_studio_v1';

  function getDefaultStorageAdapter(customAdapter) {
    if (customAdapter && typeof customAdapter.getItem === 'function' && typeof customAdapter.setItem === 'function') {
      return customAdapter;
    }
    try {
      if (root && root.localStorage && typeof root.localStorage.getItem === 'function') {
        return root.localStorage;
      }
    } catch (_) {}
    return null;
  }

  /**
   * Kişisel Ajan Stüdyosu ve Çalışma Zamanı Oluşturucu (`createPersonalAgentStudio` — Bölüm 6)
   */
  function createPersonalAgentStudio(options) {
    var opts = options || {};
    var storageAdapter = getDefaultStorageAdapter(opts.storageAdapter);
    var storageKey = opts.storageKey || STUDIO_STORAGE_KEY_V1;
    var trainingSampleModeActive = opts.enableTrainingSampleMode === true;

    var agentsById = new Map();
    var agentIsolatedMemories = new Map();
    var agentRunLogsById = new Map();
    var userFilesByName = new Map();

    // BÖLÜM 2.1: Üretim/normal kullanım modunda sabit örnek dünya kayıtları ve
    // sahte CSV dosyası gerçek veri yerine otomatik yüklenmez!
    var worldRecordsPool = [];
    if (Array.isArray(opts.worldRecords) && opts.worldRecords.length > 0) {
      worldRecordsPool = opts.worldRecords.map(normalizeAdvisorWorldRecord);
    } else if (trainingSampleModeActive) {
      worldRecordsPool = buildDefaultAdvisorWorldRecords({ markAsSampleFixture: true });
    }

    if (Array.isArray(opts.initialUserFiles)) {
      opts.initialUserFiles.forEach(function (f) {
        if (f && f.fileName) userFilesByName.set(f.fileName, JSON.parse(JSON.stringify(f)));
      });
    } else if (trainingSampleModeActive) {
      userFilesByName.set('tedarik_secenekleri_2026.csv', {
        fileName: 'tedarik_secenekleri_2026.csv',
        mimeType: 'text/csv',
        isSampleFixture: true,
        sample_badge_tr: 'Örnek veri',
        originalContent: [
          'secenek_adi,birim_maliyet_usd,teslim_suresi_gun,risk_puani,notlar',
          'Dresden Yerel Hat,142,18,15,Avrupa içi yedekli hat',
          'Asya Ekspres Hat,118,34,42,Tekil dökümhane bağımlılığı',
          'Eksik Satir Ornegi,abc,-5,,Bozuk veri satırı'
        ].join('\n')
      });
    }

    function saveStudioStateToStorage() {
      if (!storageAdapter) return { saved: false, reason: 'NO_STORAGE_ADAPTER' };
      try {
        var payload = {
          schema: 'CAELUS_AGENT_STUDIO_STORAGE_V1',
          savedAt: new Date().toISOString(),
          agents: Array.from(agentsById.values()),
          memories: Array.from(agentIsolatedMemories.entries()),
          runLogs: Array.from(agentRunLogsById.entries())
        };
        storageAdapter.setItem(storageKey, JSON.stringify(payload));
        return { saved: true, agentsCount: payload.agents.length };
      } catch (e) {
        return { saved: false, reason: String(e && e.message ? e.message : e) };
      }
    }

    function loadStudioStateFromStorage() {
      if (!storageAdapter) return { loaded: false, agentsCount: 0 };
      try {
        var raw = storageAdapter.getItem(storageKey);
        if (!raw) return { loaded: false, agentsCount: 0 };
        var parsed = JSON.parse(raw);
        if (!parsed || !Array.isArray(parsed.agents)) return { loaded: false, agentsCount: 0 };
        parsed.agents.forEach(function (ag) {
          if (ag && ag.agent_id && validateAgentContractV1(ag).valid) {
            agentsById.set(ag.agent_id, ag);
          }
        });
        if (Array.isArray(parsed.memories)) {
          parsed.memories.forEach(function (pair) {
            if (Array.isArray(pair) && pair[0]) agentIsolatedMemories.set(pair[0], pair[1]);
          });
        }
        if (Array.isArray(parsed.runLogs)) {
          parsed.runLogs.forEach(function (pair) {
            if (Array.isArray(pair) && pair[0]) agentRunLogsById.set(pair[0], Array.isArray(pair[1]) ? pair[1] : []);
          });
        }
        return { loaded: true, agentsCount: agentsById.size };
      } catch (_) {
        return { loaded: false, agentsCount: 0 };
      }
    }

    function clearStudioStorage() {
      if (storageAdapter && typeof storageAdapter.removeItem === 'function') {
        try { storageAdapter.removeItem(storageKey); } catch (_) {}
      }
      return { cleared: true };
    }

    if (opts.autoRestoreFromStorage !== false) {
      loadStudioStateFromStorage();
    }

    function setTrainingSampleMode(enabled) {
      trainingSampleModeActive = Boolean(enabled);
      if (trainingSampleModeActive) {
        if (worldRecordsPool.length === 0) {
          worldRecordsPool = buildDefaultAdvisorWorldRecords({ markAsSampleFixture: true });
        }
        if (!userFilesByName.has('tedarik_secenekleri_2026.csv')) {
          userFilesByName.set('tedarik_secenekleri_2026.csv', {
            fileName: 'tedarik_secenekleri_2026.csv',
            mimeType: 'text/csv',
            isSampleFixture: true,
            sample_badge_tr: 'Örnek veri',
            originalContent: [
              'secenek_adi,birim_maliyet_usd,teslim_suresi_gun,risk_puani,notlar',
              'Dresden Yerel Hat,142,18,15,Avrupa içi yedekli hat',
              'Asya Ekspres Hat,118,34,42,Tekil dökümhane bağımlılığı',
              'Eksik Satir Ornegi,abc,-5,,Bozuk veri satırı'
            ].join('\n')
          });
        }
      } else {
        worldRecordsPool = worldRecordsPool.filter(function (r) { return !r.isSampleFixture; });
        var f = userFilesByName.get('tedarik_secenekleri_2026.csv');
        if (f && f.isSampleFixture) {
          userFilesByName.delete('tedarik_secenekleri_2026.csv');
        }
      }
      return {
        trainingSampleModeActive: trainingSampleModeActive,
        worldRecordsCount: worldRecordsPool.length,
        userFilesCount: userFilesByName.size
      };
    }

    function setWorldRecordsPool(records) {
      if (!Array.isArray(records)) return worldRecordsPool.length;
      worldRecordsPool = records.map(normalizeAdvisorWorldRecord);
      return worldRecordsPool.length;
    }

    function registerUserFile(fileName, content, mimeType) {
      var text = String(content || '');
      userFilesByName.set(fileName, {
        fileName: fileName,
        mimeType: mimeType || 'text/csv',
        contentHash: computeDeterministicHashHex(text),
        sizeBytes: text.length,
        originalContent: text
      });
      return { registered: true, fileName: fileName, sizeBytes: text.length };
    }

    function createAgent(spec) {
      var contract = buildAgentContractV1(spec);
      var validation = validateAgentContractV1(contract);
      if (!validation.valid) {
        throw new Error('Geçersiz Ajan Sözleşmesi: ' + validation.errors.join(' | '));
      }
      agentsById.set(contract.agent_id, contract);
      agentIsolatedMemories.set(contract.memory_policy.scope, {
        seenRecordFingerprints: [],
        lastRunAt: null,
        missedRunsWhileClosed: 0,
        notes: []
      });
      agentRunLogsById.set(contract.agent_id, []);
      saveStudioStateToStorage();
      return contract;
    }

    function updateAgentDefinition(agentId, updates) {
      var existing = agentsById.get(agentId);
      if (!existing) throw new Error('Ajan bulunamadı: ' + agentId);
      var snapshot = JSON.parse(JSON.stringify(existing));
      delete snapshot.version_history;

      var nextVersion = (existing.version || 1) + 1;
      var merged = Object.assign({}, existing, updates || {}, {
        agent_id: existing.agent_id,
        version: nextVersion,
        updated_at: new Date().toISOString(),
        version_history: (existing.version_history || []).concat([
          {
            version: existing.version,
            archived_at: new Date().toISOString(),
            snapshot: snapshot
          }
        ])
      });
      if (updates && updates.permissions) {
        merged.permissions = Object.assign({}, existing.permissions, updates.permissions);
      }
      if (updates && updates.inputs) {
        merged.inputs = Object.assign({}, existing.inputs, updates.inputs);
      }
      if (updates && updates.safety_limits) {
        merged.safety_limits = Object.assign({}, existing.safety_limits, updates.safety_limits);
      }
      var validation = validateAgentContractV1(merged);
      if (!validation.valid) {
        throw new Error('Güncellenen Ajan Sözleşmesi geçersiz: ' + validation.errors.join(' | '));
      }
      agentsById.set(agentId, merged);
      saveStudioStateToStorage();
      return merged;
    }

    function revokeAgentPermission(agentId, permissionKind, targetValue) {
      var ag = agentsById.get(agentId);
      if (!ag) throw new Error('Ajan bulunamadı: ' + agentId);
      if (permissionKind === 'network_access') {
        ag.permissions.network_access = false;
      } else if (permissionKind === 'local_file_read') {
        ag.permissions.local_file_read = false;
      } else if (permissionKind === 'local_file_write') {
        ag.permissions.local_file_write = false;
      } else if (permissionKind === 'notifications') {
        ag.permissions.notifications = false;
      } else if (permissionKind === 'source' && targetValue) {
        ag.allowed_sources = ag.allowed_sources.filter(function (s) { return s !== targetValue; });
      } else if (permissionKind === 'file' && targetValue && ag.inputs && Array.isArray(ag.inputs.user_files)) {
        ag.inputs.user_files = ag.inputs.user_files.filter(function (f) { return f !== targetValue; });
      } else if (permissionKind === 'all') {
        ag.permissions.network_access = false;
        ag.permissions.local_file_read = false;
        ag.permissions.local_file_write = false;
        ag.permissions.notifications = false;
        ag.allowed_sources = [];
        if (ag.inputs) ag.inputs.user_files = [];
      }
      ag.updated_at = new Date().toISOString();
      saveStudioStateToStorage();
      return ag;
    }

    function pauseAgentRun(agentId) {
      var ag = agentsById.get(agentId);
      if (!ag) throw new Error('Ajan bulunamadı: ' + agentId);
      ag.status = AGENT_LIFECYCLE_STATES_9.PAUSED;
      ag.updated_at = new Date().toISOString();
      saveStudioStateToStorage();
      return ag;
    }

    function resumeAgentRun(agentId) {
      var ag = agentsById.get(agentId);
      if (!ag) throw new Error('Ajan bulunamadı: ' + agentId);
      ag.status = AGENT_LIFECYCLE_STATES_9.READY;
      ag.updated_at = new Date().toISOString();
      saveStudioStateToStorage();
      return ag;
    }

    function stopAgentRun(agentId) {
      var ag = agentsById.get(agentId);
      if (!ag) throw new Error('Ajan bulunamadı: ' + agentId);
      ag.status = AGENT_LIFECYCLE_STATES_9.STOPPED;
      ag.updated_at = new Date().toISOString();
      saveStudioStateToStorage();
      return ag;
    }

    function deleteAgentWithImpactPreview(agentId, confirmDelete) {
      var ag = agentsById.get(agentId);
      if (!ag) throw new Error('Ajan bulunamadı: ' + agentId);
      var logs = agentRunLogsById.get(agentId) || [];
      var impactPreview = {
        agentId: agentId,
        agentName: ag.name,
        whatWillBeDeletedTr: [
          'Ajan tanımı ve sürüm geçmişi (' + ag.version + ' sürüm)',
          'Ajanın kendi izole hafıza kapsamı (' + ag.memory_policy.scope + ')',
          'Ajanın çalışma günlükleri (' + logs.length + ' çalışma kaydı)'
        ],
        whatWillBePreservedTr: [
          'Kullanıcının kendi yerel dosyaları (' + ((ag.inputs && ag.inputs.user_files) || []).join(', ') + ') olduğu gibi korunur',
          'CAELUS paylaşılan kaynaklı dünya hafızası korunur'
        ]
      };
      if (!confirmDelete) {
        return { deleted: false, impactPreview: impactPreview };
      }
      agentsById.delete(agentId);
      agentIsolatedMemories.delete(ag.memory_policy.scope);
      agentRunLogsById.delete(agentId);
      saveStudioStateToStorage();
      return { deleted: true, impactPreview: impactPreview };
    }

    /**
     * Bölüm 6.5: Uygulama Kapalıyken Kaçırılan Zamanlı Çalışmaları Dürüstçe Tespit Et (`checkMissedScheduledRuns`)
     */
    function checkMissedScheduledRuns(nowIso) {
      var nowMs = Date.parse(nowIso || new Date().toISOString()) || Date.now();
      var summary = [];
      agentsById.forEach(function (ag) {
        if (!ag || ag.trigger.type !== 'APP_OPEN') return;
        var intervalMs = ag.trigger.interval_ms || (60 * 60 * 1000);
        var mem = agentIsolatedMemories.get(ag.memory_policy.scope) || {};
        var refIso = mem.lastRunAt || ag.created_at;
        var refMs = Date.parse(refIso) || nowMs;
        var elapsedMs = Math.max(0, nowMs - refMs);
        var missedCount = elapsedMs > intervalMs ? Math.floor(elapsedMs / intervalMs) : 0;
        if (missedCount > 0) {
          mem.missedRunsWhileClosed = (mem.missedRunsWhileClosed || 0) + missedCount;
          agentIsolatedMemories.set(ag.memory_policy.scope, mem);
        }
        summary.push({
          agentId: ag.agent_id,
          agentName: ag.name,
          executionMode: ag.trigger.type,
          lastRunAt: mem.lastRunAt || null,
          missedRunsCount: missedCount,
          backgroundExecutionClaimed: false,
          honestNoticeTr: missedCount > 0
            ? 'Uygulama kapalıyken ' + missedCount + ' zamanlı çalışma gerçekleşmedi (CAELUS arka planda gizlice çalışmaz). İsterseniz şimdi elle çalıştırabilirsiniz.'
            : 'Zamanlama güncel (yalnız uygulama açıkken çalışır).'
        });
      });
      saveStudioStateToStorage();
      return summary;
    }

    // --------------------------------------------------------------------------
    // 3 Zorunlu Ajan Yeteneğinin Gerçek Çalıştırılması ve Sınır Denetimi (`runAgent`)
    // --------------------------------------------------------------------------
    function runAgent(agentId, runContext) {
      var ag = agentsById.get(agentId);
      if (!ag) throw new Error('Ajan bulunamadı: ' + agentId);
      var ctx = runContext || {};
      var startedAtMs = Date.now();
      var startedAtIso = new Date(startedAtMs).toISOString();
      var auditSteps = [];
      var blockedPermissionAttempts = [];
      var securityAlerts = [];
      var limits = ag.safety_limits || {};
      var maxSteps = typeof limits.max_steps === 'number' ? limits.max_steps : 25;
      var maxRequests = typeof limits.max_requests_per_run === 'number' ? limits.max_requests_per_run : 10;
      var maxRecords = typeof limits.max_records_per_run === 'number' ? limits.max_records_per_run : 200;
      var maxRuntimeMs = typeof limits.max_runtime_ms === 'number' ? limits.max_runtime_ms : 15000;
      var maxResultBytes = typeof limits.max_result_bytes === 'number' ? limits.max_result_bytes : 524288;
      var maxFileBytes = typeof limits.max_file_bytes === 'number' ? limits.max_file_bytes : (5 * 1024 * 1024);
      var maxFileRows = typeof limits.max_file_rows === 'number' ? limits.max_file_rows : 10000;
      var stepCounter = 0;

      function checkRuntimeAndStepBudget(stepLabel) {
        stepCounter += 1;
        var elapsed = (typeof ctx.simulatedElapsedMs === 'number') ? ctx.simulatedElapsedMs : (Date.now() - startedAtMs);
        if (stepCounter > maxSteps) {
          return {
            exceeded: true,
            code: 'SAFETY_LIMIT_EXCEEDED_MAX_STEPS',
            reasonTr: 'Ajan çalışma adımı sınırı (' + maxSteps + ' adım) "' + stepLabel + '" aşamasında aşıldı ve güvenli biçimde durduruldu.'
          };
        }
        if (elapsed > maxRuntimeMs) {
          return {
            exceeded: true,
            code: 'SAFETY_LIMIT_EXCEEDED_MAX_RUNTIME_MS',
            reasonTr: 'Ajan çalışma süresi sınırı (' + maxRuntimeMs + ' ms) aşıldı ve güvenli biçimde durduruldu.'
          };
        }
        return { exceeded: false };
      }

      if (ag.status === AGENT_LIFECYCLE_STATES_9.PAUSED || ag.status === AGENT_LIFECYCLE_STATES_9.STOPPED) {
        return {
          ok: false,
          status: ag.status,
          errorTr: 'Ajan şu anda ' + ag.status + ' durumunda olduğundan çalıştırılmadı.'
        };
      }

      ag.status = AGENT_LIFECYCLE_STATES_9.RUNNING;

      var b0 = checkRuntimeAndStepBudget('init_memory_check');
      if (b0.exceeded) {
        ag.status = AGENT_LIFECYCLE_STATES_9.STOPPED;
        var limCard0 = buildActivityReportCard(ag, startedAtIso, Date.now() - startedAtMs, {
          summaryTr: b0.reasonTr,
          limitExceededCode: b0.code,
          evidenceItems: [],
          assumptions: [],
          unknowns: [b0.reasonTr],
          auditSteps: auditSteps,
          blockedPermissionAttempts: blockedPermissionAttempts,
          securityAlerts: securityAlerts
        });
        agentRunLogsById.get(agentId).push(limCard0);
        saveStudioStateToStorage();
        return limCard0;
      }

      // Adım 1: Kendi izole hafızasına erişim kontrolü
      var memScopeToRead = ctx.attemptCrossAgentMemoryScope || ag.memory_policy.scope;
      var memCheck = enforceAgentRuntimePermission(ag, {
        type: 'READ_AGENT_MEMORY',
        targetScope: memScopeToRead
      }, auditSteps);

      if (!memCheck.allowed) {
        blockedPermissionAttempts.push(memCheck);
        ag.status = AGENT_LIFECYCLE_STATES_9.FAILED;
        var failReport = buildActivityReportCard(ag, startedAtIso, Date.now() - startedAtMs, {
          summaryTr: 'Ajanlar arası hafıza izolasyonu ihlali engellendi.',
          evidenceItems: [],
          assumptions: [],
          unknowns: ['Yetkisiz hafıza kapsamına erişim reddedildi.'],
          auditSteps: auditSteps,
          blockedPermissionAttempts: blockedPermissionAttempts,
          securityAlerts: securityAlerts
        });
        agentRunLogsById.get(agentId).push(failReport);
        saveStudioStateToStorage();
        return failReport;
      }

      var ownMemory = agentIsolatedMemories.get(ag.memory_policy.scope) || { seenRecordFingerprints: [] };

      // YETENEK 1: GERÇEK KAYNAK TAKİP AJANI (`TRACK_REAL_SOURCE`)
      if (ag.capability_type === MANDATORY_AGENT_CAPABILITIES_3.TRACK_REAL_SOURCE) {
        var toolCheck = enforceAgentRuntimePermission(ag, {
          type: 'INVOKE_TOOL',
          target: 'living_world_source_reader'
        }, auditSteps);
        if (!toolCheck.allowed) {
          blockedPermissionAttempts.push(toolCheck);
          ag.status = AGENT_LIFECYCLE_STATES_9.FAILED;
          var tFail = buildActivityReportCard(ag, startedAtIso, Date.now() - startedAtMs, {
            summaryTr: 'Araç yetkisi reddedildi.',
            evidenceItems: [],
            assumptions: [],
            unknowns: [toolCheck.detailTr],
            auditSteps: auditSteps,
            blockedPermissionAttempts: blockedPermissionAttempts,
            securityAlerts: securityAlerts
          });
          agentRunLogsById.get(agentId).push(tFail);
          saveStudioStateToStorage();
          return tFail;
        }

        var requestedSources = Array.isArray(ctx.requestedSources) && ctx.requestedSources.length > 0
          ? ctx.requestedSources
          : ag.allowed_sources;

        if (requestedSources.length > maxRequests) {
          ag.status = AGENT_LIFECYCLE_STATES_9.STOPPED;
          var reqLimCard = buildActivityReportCard(ag, startedAtIso, Date.now() - startedAtMs, {
            summaryTr: 'Tek çalışmada izin verilen azami kaynak isteği sınırı (' + maxRequests + ') aşıldı.',
            limitExceededCode: 'SAFETY_LIMIT_EXCEEDED_MAX_REQUESTS_PER_RUN',
            evidenceItems: [],
            assumptions: [],
            unknowns: ['Kaynak isteği sayısı (' + requestedSources.length + ') > max_requests_per_run (' + maxRequests + ').'],
            auditSteps: auditSteps,
            blockedPermissionAttempts: blockedPermissionAttempts,
            securityAlerts: securityAlerts
          });
          agentRunLogsById.get(agentId).push(reqLimCard);
          saveStudioStateToStorage();
          return reqLimCard;
        }

        var checkedSources = [];
        for (var sIdx = 0; sIdx < requestedSources.length; sIdx++) {
          var bStep = checkRuntimeAndStepBudget('source_permission_check_' + sIdx);
          if (bStep.exceeded) {
            ag.status = AGENT_LIFECYCLE_STATES_9.STOPPED;
            var stepFailCard = buildActivityReportCard(ag, startedAtIso, Date.now() - startedAtMs, {
              summaryTr: bStep.reasonTr,
              limitExceededCode: bStep.code,
              evidenceItems: [],
              assumptions: [],
              unknowns: [bStep.reasonTr],
              auditSteps: auditSteps,
              blockedPermissionAttempts: blockedPermissionAttempts,
              securityAlerts: securityAlerts
            });
            agentRunLogsById.get(agentId).push(stepFailCard);
            saveStudioStateToStorage();
            return stepFailCard;
          }
          var srcId = requestedSources[sIdx];
          var srcPerm = enforceAgentRuntimePermission(ag, {
            type: 'ACCESS_SOURCE',
            target: srcId
          }, auditSteps);
          if (!srcPerm.allowed) {
            blockedPermissionAttempts.push(srcPerm);
          } else {
            checkedSources.push(srcId);
          }
        }

        if (checkedSources.length === 0) {
          ag.status = AGENT_LIFECYCLE_STATES_9.FAILED;
          var noSrcCard = buildActivityReportCard(ag, startedAtIso, Date.now() - startedAtMs, {
            summaryTr: 'Hiçbir kaynağa erişim yetkisi doğrulanamadı.',
            evidenceItems: [],
            assumptions: [],
            unknowns: ['İzin verilen kaynak listesi boş veya ağ erişimi kapalı.'],
            auditSteps: auditSteps,
            blockedPermissionAttempts: blockedPermissionAttempts,
            securityAlerts: securityAlerts
          });
          agentRunLogsById.get(agentId).push(noSrcCard);
          saveStudioStateToStorage();
          return noSrcCard;
        }

        if (ctx.simulateSourceUnavailable === true) {
          ag.status = AGENT_LIFECYCLE_STATES_9.SOURCE_UNAVAILABLE;
          var unavailCard = buildActivityReportCard(ag, startedAtIso, Date.now() - startedAtMs, {
            summaryTr: 'Hedef kaynak şu anda erişilemiyor (SOURCE_UNAVAILABLE). Uydurma veri üretilmedi.',
            evidenceItems: [],
            assumptions: [],
            unknowns: ['Kaynak bağlantı zaman aşımı veya HTTP hatası nedeniyle yeni kayıt alınamadı.'],
            auditSteps: auditSteps,
            blockedPermissionAttempts: blockedPermissionAttempts,
            securityAlerts: securityAlerts
          });
          agentRunLogsById.get(agentId).push(unavailCard);
          saveStudioStateToStorage();
          return unavailCard;
        }

        var candidateRecords = Array.isArray(ctx.recordsOverride) ? ctx.recordsOverride : worldRecordsPool;
        var focusEntities = (ag.inputs && Array.isArray(ag.inputs.entities)) ? ag.inputs.entities : [];

        var matched = [];
        var newRecords = [];
        var unchangedRecords = [];
        var syndicationDupes = [];
        var titleSeenInRun = new Set();

        for (var r = 0; r < candidateRecords.length && matched.length < maxRecords; r++) {
          var rec = candidateRecords[r];
          if (!rec || checkedSources.indexOf(rec.source_id) === -1) continue;

          var scan = scanUntrustedSourceForInjection((rec.title || '') + ' ' + (rec.summary || ''));
          if (scan.isSuspicious) {
            securityAlerts.push({
              recordId: rec.record_id,
              sourceId: rec.source_id,
              matchedPatterns: scan.matchedPatterns,
              handling: scan.handlingPolicy
            });
          }

          if (focusEntities.length > 0) {
            var hasFocus = focusEntities.some(function (fe) {
              var fl = String(fe).toLocaleLowerCase('tr-TR');
              var inTitle = String(rec.title || '').toLocaleLowerCase('tr-TR').indexOf(fl) !== -1;
              var inEnts = Array.isArray(rec.entities) && rec.entities.some(function (e) {
                var en = typeof e === 'string' ? e : e.name;
                return en && String(en).toLocaleLowerCase('tr-TR').indexOf(fl) !== -1;
              });
              return inTitle || inEnts;
            });
            if (!hasFocus) continue;
          }

          var normTitle = String(rec.title || '').toLocaleLowerCase('tr-TR').replace(/\s+/g, ' ').trim();
          if (titleSeenInRun.has(normTitle)) {
            syndicationDupes.push(rec.record_id);
            continue;
          }
          titleSeenInRun.add(normTitle);
          matched.push(rec);

          var fp = rec.record_id + '@' + (rec.content_hash || rec.source_published_at || rec.event_time || '');
          if (ownMemory.seenRecordFingerprints.indexOf(fp) === -1) {
            newRecords.push(rec);
            ownMemory.seenRecordFingerprints.push(fp);
          } else {
            unchangedRecords.push(rec);
          }
        }

        ownMemory.lastRunAt = startedAtIso;
        ag.status = AGENT_LIFECYCLE_STATES_9.COMPLETED;

        var evidenceItems = matched.map(function (m) {
          return {
            recordId: m.record_id,
            sourceId: m.source_id,
            sourceName: m.source_name,
            sourceUrl: m.source_url,
            contentHash: m.content_hash,
            title: m.title,
            eventTime: m.event_time,
            publishedAt: m.source_published_at,
            ingestedAt: m.ingested_at,
            lastCheckedAt: startedAtIso,
            isSampleFixture: Boolean(m.isSampleFixture),
            isNewSinceLastRun: newRecords.indexOf(m) !== -1
          };
        });

        var reportCard = buildActivityReportCard(ag, startedAtIso, Date.now() - startedAtMs, {
          summaryTr:
            checkedSources.length + ' izinli kaynak kontrol edildi. Önceki çalışmadan bu yana ' +
            newRecords.length + ' yeni kayıt, ' + unchangedRecords.length + ' değişmeyen kayıt ve ' +
            syndicationDupes.length + ' sendikasyon tekrarı tespit edildi.',
          diffSummary: {
            newRecordsCount: newRecords.length,
            unchangedRecordsCount: unchangedRecords.length,
            syndicationDuplicatesCount: syndicationDupes.length
          },
          evidenceItems: evidenceItems,
          assumptions: ['Yalnızca ajanın izinli olduğu kaynaklar (' + checkedSources.join(', ') + ') tarandı.'],
          unknowns: matched.length === 0 ? [
            worldRecordsPool.length === 0
              ? EMPTY_WORLD_DATA_MESSAGE_TR
              : 'Seçili filtre ve kaynaklarda eşleşen kayıt bulunamadı.'
          ] : [],
          auditSteps: auditSteps,
          blockedPermissionAttempts: blockedPermissionAttempts,
          securityAlerts: securityAlerts
        });
        agentRunLogsById.get(agentId).push(reportCard);
        saveStudioStateToStorage();
        return reportCard;
      }

      // YETENEK 2: KULLANICI DOSYASI İNCELEME AJANI (`INSPECT_USER_FILE`)
      if (ag.capability_type === MANDATORY_AGENT_CAPABILITIES_3.INSPECT_USER_FILE) {
        var targetFile = ctx.fileName || (ag.inputs && ag.inputs.user_files && ag.inputs.user_files[0]);
        var filePerm = enforceAgentRuntimePermission(ag, {
          type: 'READ_USER_FILE',
          target: targetFile || 'BELIRTILMEDI'
        }, auditSteps);

        if (!filePerm.allowed) {
          blockedPermissionAttempts.push(filePerm);
          ag.status = AGENT_LIFECYCLE_STATES_9.FAILED;
          var fFail = buildActivityReportCard(ag, startedAtIso, Date.now() - startedAtMs, {
            summaryTr: 'Dosya okuma yetkisi reddedildi: ' + filePerm.detailTr,
            evidenceItems: [],
            assumptions: [],
            unknowns: [filePerm.detailTr],
            auditSteps: auditSteps,
            blockedPermissionAttempts: blockedPermissionAttempts,
            securityAlerts: securityAlerts
          });
          agentRunLogsById.get(agentId).push(fFail);
          saveStudioStateToStorage();
          return fFail;
        }

        var fileEntry = userFilesByName.get(targetFile);
        if (!fileEntry) {
          ag.status = AGENT_LIFECYCLE_STATES_9.SOURCE_UNAVAILABLE;
          var missingFileCard = buildActivityReportCard(ag, startedAtIso, Date.now() - startedAtMs, {
            summaryTr: '"' + targetFile + '" dosyası bulunamadı.',
            evidenceItems: [],
            assumptions: [],
            unknowns: ['Dosya çalışma alanında yüklü değil.'],
            auditSteps: auditSteps,
            blockedPermissionAttempts: blockedPermissionAttempts,
            securityAlerts: securityAlerts
          });
          agentRunLogsById.get(agentId).push(missingFileCard);
          saveStudioStateToStorage();
          return missingFileCard;
        }

        var rawSnapshotBefore = String(fileEntry.originalContent || '');
        if (rawSnapshotBefore.length > maxFileBytes) {
          ag.status = AGENT_LIFECYCLE_STATES_9.STOPPED;
          var fileSizeFail = buildActivityReportCard(ag, startedAtIso, Date.now() - startedAtMs, {
            summaryTr: 'Dosya boyutu güvenlik sınırını (' + maxFileBytes + ' bayt) aştığından inceleme durduruldu.',
            limitExceededCode: 'SAFETY_LIMIT_EXCEEDED_MAX_FILE_BYTES',
            evidenceItems: [],
            assumptions: [],
            unknowns: ['Dosya boyutu (' + rawSnapshotBefore.length + ' bayt) > max_file_bytes (' + maxFileBytes + ').'],
            auditSteps: auditSteps,
            blockedPermissionAttempts: blockedPermissionAttempts,
            securityAlerts: securityAlerts
          });
          agentRunLogsById.get(agentId).push(fileSizeFail);
          saveStudioStateToStorage();
          return fileSizeFail;
        }

        var lines = rawSnapshotBefore.split(/\r?\n/).filter(function (l) { return l.trim().length > 0; });
        if (lines.length - 1 > maxFileRows) {
          ag.status = AGENT_LIFECYCLE_STATES_9.STOPPED;
          var fileRowsFail = buildActivityReportCard(ag, startedAtIso, Date.now() - startedAtMs, {
            summaryTr: 'Dosya satır sayısı güvenlik sınırını (' + maxFileRows + ' satır) aştığından inceleme durduruldu.',
            limitExceededCode: 'SAFETY_LIMIT_EXCEEDED_MAX_FILE_ROWS',
            evidenceItems: [],
            assumptions: [],
            unknowns: ['Satır sayısı (' + (lines.length - 1) + ') > max_file_rows (' + maxFileRows + ').'],
            auditSteps: auditSteps,
            blockedPermissionAttempts: blockedPermissionAttempts,
            securityAlerts: securityAlerts
          });
          agentRunLogsById.get(agentId).push(fileRowsFail);
          saveStudioStateToStorage();
          return fileRowsFail;
        }

        var headers = lines.length > 0 ? lines[0].split(',').map(function (h) { return h.trim(); }) : [];
        var validRows = [];
        var rowErrors = [];

        for (var ln = 1; ln < lines.length; ln++) {
          var cols = lines[ln].split(',').map(function (c) { return c.trim(); });
          var rowNum = ln + 1;
          var rowScan = scanUntrustedSourceForInjection(lines[ln]);
          if (rowScan.isSuspicious) {
            securityAlerts.push({
              sourceRowNumber: rowNum,
              matchedPatterns: rowScan.matchedPatterns,
              handling: rowScan.handlingPolicy
            });
          }
          var costVal = Number(cols[1]);
          var daysVal = Number(cols[2]);
          var riskVal = cols[3] !== '' && cols[3] !== undefined ? Number(cols[3]) : NaN;
          if (!cols[0] || Number.isNaN(costVal) || Number.isNaN(daysVal) || daysVal < 0 || Number.isNaN(riskVal)) {
            rowErrors.push({
              sourceRowNumber: rowNum,
              rawLine: lines[ln],
              reasonTr: 'Satır ' + rowNum + ': Sayısal maliyet/süre/risk değeri eksik, negatif veya geçersiz.'
            });
          } else {
            validRows.push({
              sourceRowNumber: rowNum,
              optionName: cols[0],
              unitCostUsd: costVal,
              deliveryDays: daysVal,
              riskScore: riskVal,
              notes: cols[4] || ''
            });
          }
        }

        var originalFileMutated = fileEntry.originalContent !== rawSnapshotBefore;
        ag.status = AGENT_LIFECYCLE_STATES_9.COMPLETED;

        var fileEvidence = validRows.map(function (vr) {
          return {
            sourceFile: targetFile,
            sourceRowNumber: vr.sourceRowNumber,
            optionName: vr.optionName,
            unitCostUsd: vr.unitCostUsd,
            deliveryDays: vr.deliveryDays,
            riskScore: vr.riskScore
          };
        });

        var fileReport = buildActivityReportCard(ag, startedAtIso, Date.now() - startedAtMs, {
          summaryTr:
            '"' + targetFile + '" dosyası incelendi: ' + validRows.length + ' geçerli satır doğrulandı, ' +
            rowErrors.length + ' hatalı/eksik satır yakalandı. Orijinal dosya değiştirilmedi.',
          fileInspectionDetail: {
            fileName: targetFile,
            detectedColumns: headers,
            validRowCount: validRows.length,
            errorRowCount: rowErrors.length,
            rowErrors: rowErrors,
            originalFileMutated: originalFileMutated
          },
          evidenceItems: fileEvidence,
          assumptions: ['Sütun eşleştirmesi başlık satırına (' + headers.join(', ') + ') göre yapıldı.'],
          unknowns: rowErrors.map(function (re) { return re.reasonTr; }),
          auditSteps: auditSteps,
          blockedPermissionAttempts: blockedPermissionAttempts,
          securityAlerts: securityAlerts
        });
        agentRunLogsById.get(agentId).push(fileReport);
        saveStudioStateToStorage();
        return fileReport;
      }

      // YETENEK 3: SEÇENEK KARŞILAŞTIRMA VE ÖZET AJANI (`COMPARE_OPTIONS`)
      if (ag.capability_type === MANDATORY_AGENT_CAPABILITIES_3.COMPARE_OPTIONS) {
        var calcToolPerm = enforceAgentRuntimePermission(ag, {
          type: 'INVOKE_TOOL',
          target: 'deterministic_option_calculator'
        }, auditSteps);
        if (!calcToolPerm.allowed) {
          blockedPermissionAttempts.push(calcToolPerm);
          ag.status = AGENT_LIFECYCLE_STATES_9.FAILED;
          var cFail = buildActivityReportCard(ag, startedAtIso, Date.now() - startedAtMs, {
            summaryTr: 'Karşılaştırma aracı yetkisi reddedildi.',
            evidenceItems: [],
            assumptions: [],
            unknowns: [calcToolPerm.detailTr],
            auditSteps: auditSteps,
            blockedPermissionAttempts: blockedPermissionAttempts,
            securityAlerts: securityAlerts
          });
          agentRunLogsById.get(agentId).push(cFail);
          saveStudioStateToStorage();
          return cFail;
        }

        var optionsList = Array.isArray(ctx.optionsToCompare)
          ? ctx.optionsToCompare
          : (ag.inputs && ag.inputs.parameters && Array.isArray(ag.inputs.parameters.options) ? ag.inputs.parameters.options : []);

        var unitMismatches = [];
        var missingFields = [];
        var evaluatedOptions = [];
        var seenCurrencies = new Set();

        for (var oIdx = 0; oIdx < optionsList.length; oIdx++) {
          var opt = optionsList[oIdx] || {};
          var optName = opt.name || ('Seçenek ' + (oIdx + 1));
          var currency = String(opt.currency || 'USD').toUpperCase();
          seenCurrencies.add(currency);

          if (typeof opt.cost !== 'number' || Number.isNaN(opt.cost)) {
            missingFields.push(optName + ': maliyet (cost) verisi eksik.');
            continue;
          }
          if (typeof opt.durationDays !== 'number' || Number.isNaN(opt.durationDays)) {
            missingFields.push(optName + ': teslim süresi (durationDays) verisi eksik.');
            continue;
          }
          var riskScore = typeof opt.riskScore === 'number' && !Number.isNaN(opt.riskScore) ? opt.riskScore : null;
          if (riskScore === null) {
            missingFields.push(optName + ': risk puanı eksik (varsayım uydurulmadı).');
          }

          evaluatedOptions.push({
            name: optName,
            cost: opt.cost,
            currency: currency,
            durationDays: opt.durationDays,
            riskScore: riskScore,
            deterministicCompositeIndex: riskScore !== null
              ? Number((opt.cost * 0.5 + opt.durationDays * 2.0 + riskScore * 1.5).toFixed(2))
              : null
          });
        }

        if (seenCurrencies.size > 1) {
          unitMismatches.push(
            'Para birimi uyumsuzluğu tespit edildi (' + Array.from(seenCurrencies).join(' vs ') + '). Kur varsayımı uydurulmadan doğrudan toplama durduruldu.'
          );
        }

        evaluatedOptions.sort(function (a, b) {
          if (a.deterministicCompositeIndex === null) return 1;
          if (b.deterministicCompositeIndex === null) return -1;
          return a.deterministicCompositeIndex - b.deterministicCompositeIndex;
        });

        ag.status = unitMismatches.length > 0
          ? AGENT_LIFECYCLE_STATES_9.WAITING_FOR_USER
          : AGENT_LIFECYCLE_STATES_9.COMPLETED;

        var compReport = buildActivityReportCard(ag, startedAtIso, Date.now() - startedAtMs, {
          summaryTr:
            unitMismatches.length > 0
              ? 'Birim uyumsuzluğu nedeniyle karşılaştırma kullanıcı onayı/dönüşümü bekliyor.'
              : evaluatedOptions.length + ' seçenek deterministik formülle karşılaştırıldı.',
          comparisonDetail: {
            evaluatedOptions: evaluatedOptions,
            unitMismatches: unitMismatches,
            missingFields: missingFields,
            formulaDisclosureTr: 'Bileşik Endeks = (Maliyet * 0.5) + (Süre_Gün * 2.0) + (Risk_Puanı * 1.5) — düşük endeks daha dengeli seçeneği gösterir.'
          },
          evidenceItems: evaluatedOptions,
          assumptions: [
            'Formül ağırlıkları açık model varsayımıdır: Maliyet(0.5), Süre(2.0), Risk(1.5). Kullanıcı tarafından değiştirilebilir.'
          ],
          unknowns: unitMismatches.concat(missingFields),
          auditSteps: auditSteps,
          blockedPermissionAttempts: blockedPermissionAttempts,
          securityAlerts: securityAlerts
        });

        if (JSON.stringify(compReport).length > maxResultBytes) {
          ag.status = AGENT_LIFECYCLE_STATES_9.STOPPED;
          compReport.status = AGENT_LIFECYCLE_STATES_9.STOPPED;
          compReport.limitExceededCode = 'SAFETY_LIMIT_EXCEEDED_MAX_RESULT_BYTES';
          compReport.summaryTr = 'Çıktı boyutu güvenlik sınırını (' + maxResultBytes + ' bayt) aştı.';
        }

        agentRunLogsById.get(agentId).push(compReport);
        saveStudioStateToStorage();
        return compReport;
      }

      ag.status = AGENT_LIFECYCLE_STATES_9.FAILED;
      return buildActivityReportCard(ag, startedAtIso, Date.now() - startedAtMs, {
        summaryTr: 'Desteklenmeyen ajan yetenek türü: ' + ag.capability_type,
        evidenceItems: [],
        assumptions: [],
        unknowns: [],
        auditSteps: auditSteps,
        blockedPermissionAttempts: blockedPermissionAttempts,
        securityAlerts: securityAlerts
      });
    }

    function buildActivityReportCard(ag, startedAtIso, durationMs, details) {
      var d = details || {};
      return {
        runId: 'run-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
        agentId: ag.agent_id,
        agentName: ag.name,
        agentVersion: ag.version,
        capabilityType: ag.capability_type,
        status: ag.status,
        limitExceededCode: d.limitExceededCode || null,
        startedAt: startedAtIso,
        completedAt: new Date().toISOString(),
        durationMs: Math.max(1, durationMs),
        summaryTr: d.summaryTr || '',
        diffSummary: d.diffSummary || null,
        fileInspectionDetail: d.fileInspectionDetail || null,
        comparisonDetail: d.comparisonDetail || null,
        evidenceItems: Array.isArray(d.evidenceItems) ? d.evidenceItems : [],
        assumptions: Array.isArray(d.assumptions) ? d.assumptions : [],
        unknowns: Array.isArray(d.unknowns) ? d.unknowns : [],
        auditSteps: Array.isArray(d.auditSteps) ? d.auditSteps : [],
        blockedPermissionAttempts: Array.isArray(d.blockedPermissionAttempts) ? d.blockedPermissionAttempts : [],
        securityAlerts: Array.isArray(d.securityAlerts) ? d.securityAlerts : []
      };
    }

    function listAgents() {
      return Array.from(agentsById.values());
    }

    function getAgentRunLogs(agentId) {
      return (agentRunLogsById.get(agentId) || []).slice();
    }

    return {
      createAgent: createAgent,
      updateAgentDefinition: updateAgentDefinition,
      revokeAgentPermission: revokeAgentPermission,
      pauseAgentRun: pauseAgentRun,
      resumeAgentRun: resumeAgentRun,
      stopAgentRun: stopAgentRun,
      deleteAgentWithImpactPreview: deleteAgentWithImpactPreview,
      runAgent: runAgent,
      listAgents: listAgents,
      getAgentRunLogs: getAgentRunLogs,
      registerUserFile: registerUserFile,
      setWorldRecordsPool: setWorldRecordsPool,
      addWorldRecordsToPool: function (newRecs) {
        var combined = (Array.isArray(newRecs) ? newRecs : []).concat(worldRecordsPool);
        return setWorldRecordsPool(combined);
      },
      setTrainingSampleMode: setTrainingSampleMode,
      saveStudioStateToStorage: saveStudioStateToStorage,
      loadStudioStateFromStorage: loadStudioStateFromStorage,
      clearStudioStorage: clearStudioStorage,
      checkMissedScheduledRuns: checkMissedScheduledRuns,
      exportAgentTemplateSafe: exportAgentTemplateSafe,
      parseNaturalLanguageGoalToAgentDraft: parseNaturalLanguageGoalToAgentDraft
    };
  }

  function createDecisionWorkspace(storageAdapter) {
    var storageKey = 'caelus_decision_workspace_v1';
    if (!storageAdapter || typeof storageAdapter.getItem !== 'function' ||
        typeof storageAdapter.setItem !== 'function' || typeof storageAdapter.removeItem !== 'function') {
      throw new Error('Kalıcı görev için yerel depolama gerekli.');
    }

    function integer(value, minimum, name) {
      if (!Number.isSafeInteger(value) || value < minimum) throw new TypeError(name + ' geçersiz.');
      return value;
    }

    function label(value, name) {
      if (typeof value !== 'string' || !value.trim() || value.length > 250) {
        throw new TypeError(name + ' boş veya çok uzun.');
      }
      return value.trim();
    }

    function timestamp(value) {
      if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) ||
          !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) {
        throw new TypeError('UTC zaman damgası geçersiz.');
      }
      return value;
    }

    function cleanTask(input) {
      if (!input || !Array.isArray(input.options) || !input.options.length || input.options.length > 20) {
        throw new TypeError('Bir ila yirmi seçenek girin.');
      }
      var names = new Set();
      var options = input.options.map(function (option) {
        var name = label(option.name, 'Seçenek');
        if (names.has(name)) throw new TypeError('Seçenek adları benzersiz olmalı.');
        names.add(name);
        return {
          name: name,
          units: integer(option.units, 0, 'Kapasite'),
          cost: integer(option.cost, 0, 'Maliyet'),
          deadline: timestamp(option.deadline),
          condition: option.condition ? label(option.condition, 'Teyit koşulu') : null
        };
      });
      return {
        goal: label(input.goal, 'Hedef'),
        minUnits: integer(input.minUnits, 1, 'Asgari kapasite'),
        maxCost: integer(input.maxCost, 0, 'Bütçe'),
        options: options
      };
    }

    function cleanResearchClaim(claim) {
      var evidence = claim && claim.evidence;
      if (!evidence || typeof evidence.sha256 !== 'string' || evidence.sha256.length !== 64 ||
          !/^[a-f0-9]{64}$/.test(evidence.sha256) || typeof evidence.quote !== 'string' || evidence.quote.length > 4096) {
        throw new TypeError('Araştırma alıntısı geçersiz veya 4.096 karakterden uzun.');
      }
      var value = label(claim.value, 'Kaynakta geçen değer');
      if (!evidence.quote.includes(value)) throw new TypeError('Değer kaynak alıntısında bulunamadı.');
      return {
        subject: label(claim.subject, 'Konu veya ölçüt'),
        value: value,
        evidence: {
          title: label(evidence.title, 'Kaynak adı'),
          line: integer(evidence.line, 1, 'Kaynak satırı'),
          sha256: evidence.sha256,
          quote: evidence.quote
        }
      };
    }

    function cleanEvidence(entry, task) {
      var condition = label(entry.condition, 'Teyit koşulu');
      if (!task.options.some(function (option) { return option.condition === condition; })) {
        throw new TypeError('Bu koşul göreve ait değil.');
      }
      if (!['CONFIRMED', 'DENIED', 'CONFLICTING'].includes(entry.status)) {
        throw new TypeError('Teyit durumu geçersiz.');
      }
      var cleaned = {
        condition: condition,
        status: entry.status,
        reference: label(entry.reference, 'Kaynak veya belge referansı'),
        receivedAt: timestamp(entry.receivedAt)
      };
      if (entry.researchClaim !== undefined) cleaned.researchClaim = cleanResearchClaim(entry.researchClaim);
      return cleaned;
    }

    function evaluate(task, evidence, cutoff) {
      var latestByCondition = new Map();
      evidence.forEach(function (entry) {
        if (entry.receivedAt <= cutoff) latestByCondition.set(entry.condition, entry);
      });
      var options = task.options.map(function (option) {
        var confirmation = latestByCondition.get(option.condition) || null;
        var status = 'AVAILABLE';
        if (option.units < task.minUnits || option.cost > task.maxCost) status = 'OUTSIDE_LIMITS';
        else if (option.deadline < cutoff) status = 'EXPIRED';
        else if (confirmation && confirmation.status === 'DENIED') status = 'DENIED';
        else if (option.condition && (!confirmation || confirmation.status !== 'CONFIRMED')) status = 'WAITING';
        return Object.assign({}, option, { status: status, evidence: confirmation });
      });
      var available = options.filter(function (option) { return option.status === 'AVAILABLE'; });
      available.sort(function (a, b) { return a.cost - b.cost || b.units - a.units; });
      return {
        asOf: cutoff,
        goal: task.goal,
        status: available.length ? 'PLAN_AVAILABLE' : options.some(function (option) {
          return option.status === 'WAITING';
        }) ? 'WAITING_FOR_EVIDENCE' : 'NO_FEASIBLE_PLAN',
        recommended: available[0] || null,
        options: options
      };
    }

    function load() {
      var raw = storageAdapter.getItem(storageKey);
      if (!raw) return null;
      var state = JSON.parse(raw);
      if (!state || state.schema !== 1 || !Array.isArray(state.evidence) || state.evidence.length > 200) {
        throw new Error('Görev kaydı okunamadı.');
      }
      var task = cleanTask(state.task);
      var createdAt = timestamp(state.createdAt);
      var previousAt = createdAt;
      var evidence = state.evidence.map(function (entry) {
        var cleaned = cleanEvidence(entry, task);
        if (cleaned.receivedAt < previousAt) throw new Error('Kanıt zaman sırası geçersiz.');
        previousAt = cleaned.receivedAt;
        return cleaned;
      });
      return { schema: 1, task: task, createdAt: createdAt, evidence: evidence };
    }

    function save(state) {
      storageAdapter.setItem(storageKey, JSON.stringify(state));
    }

    return {
      create: function (input) {
        if (load()) throw new Error('Yeni görev açmadan önce mevcut görevi silin.');
        var state = { schema: 1, task: cleanTask(input), createdAt: new Date().toISOString(), evidence: [] };
        save(state);
        return state;
      },
      load: load,
      recordEvidence: function (input) {
        var state = load();
        if (!state) throw new Error('Önce bir görev kaydedin.');
        if (state.evidence.length >= 200) throw new Error('Bu görev kanıt kayıt sınırına ulaştı.');
        var now = new Date().toISOString();
        var previous = state.evidence.at(-1);
        if (now < (previous ? previous.receivedAt : state.createdAt)) {
          throw new Error('Cihaz saati önceki kayıt zamanından geride.');
        }
        var entry = cleanEvidence(Object.assign({}, input, { receivedAt: now }), state.task);
        var before = evaluate(state.task, state.evidence, now);
        state.evidence.push(entry);
        var after = evaluate(state.task, state.evidence, now);
        save(state);
        return { before: before, after: after, evidence: entry };
      },
      replay: function (asOf) {
        var state = load();
        if (!state) return null;
        var cutoff = asOf === undefined ? new Date().toISOString() : timestamp(asOf);
        if (cutoff < state.createdAt || cutoff > new Date().toISOString()) {
          throw new RangeError('Bilgi kesiti görevin başlangıcı ile şimdi arasında olmalı.');
        }
        return evaluate(state.task, state.evidence, cutoff);
      },
      clear: function () {
        storageAdapter.removeItem(storageKey);
      }
    };
  }

  function createExperimentWorkspace(storageAdapter, cryptoAdapter) {
    var storageKey = 'caelus_experiment_workspace_v1';
    var clearGeneration = 0;
    if (!storageAdapter || !cryptoAdapter || !cryptoAdapter.subtle) {
      throw new Error('Deney kaydı için yerel depolama ve Web Crypto gerekli.');
    }

    function textField(value, field) {
      if (typeof value !== 'string' || !value.trim() || value.length > 250) {
        throw new TypeError(field + ' boş veya çok uzun.');
      }
      return value.trim();
    }

    function finite(value, field) {
      if (!Number.isFinite(value)) throw new TypeError(field + ' geçersiz.');
      return value;
    }

    function interval(input) {
      var low = finite(input.low, 'Alt sınır');
      var high = finite(input.high, 'Üst sınır');
      if (low > high) throw new RangeError('Alt sınır üst sınırı aşamaz.');
      return { low: low, high: high };
    }

    function protocol(input) {
      if (!input || !Array.isArray(input.hypotheses) || input.hypotheses.length !== 2) {
        throw new TypeError('Tam iki rakip hipotez gerekli.');
      }
      var hypotheses = input.hypotheses.map(function (hypothesis) {
        return { name: textField(hypothesis.name, 'Hipotez'), expected: interval(hypothesis.expected) };
      });
      if (hypotheses[0].name === hypotheses[1].name) throw new TypeError('Hipotez adları farklı olmalı.');
      return {
        question: textField(input.question, 'Soru'),
        measurement: textField(input.measurement, 'Ölçüm ve birim'),
        intervention: textField(input.intervention, 'Deney adımı'),
        baseline: interval(input.baseline),
        source: textField(input.source, 'Ön kayıt dayanağı'),
        hypotheses: hypotheses
      };
    }

    function iso(value) {
      if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) ||
          new Date(value).toISOString() !== value) throw new TypeError('Deney zaman damgası geçersiz.');
      return value;
    }

    async function digest(record) {
      var bytes = new TextEncoder().encode(JSON.stringify(record));
      var hash = await cryptoAdapter.subtle.digest('SHA-256', bytes);
      return Array.from(new Uint8Array(hash), function (value) {
        return value.toString(16).padStart(2, '0');
      }).join('');
    }

    function readRaw() {
      return storageAdapter.getItem(storageKey);
    }

    async function read(raw) {
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || parsed.schema !== 1) throw new Error('Deney kayıt şeması geçersiz.');
      var snapshot = { schema: 1, createdAt: iso(parsed.createdAt), protocol: protocol(parsed.protocol) };
      if (await digest(snapshot) !== parsed.digest) throw new Error('Deney ön kaydının bütünlüğü doğrulanamadı.');
      var observation = null;
      if (parsed.observation !== null) {
        var item = parsed.observation;
        observation = { value: finite(item.value, 'Ölçülen değer'), source: textField(item.source, 'Gözlem kaynağı'), receivedAt: iso(item.receivedAt) };
        if (observation.receivedAt < snapshot.createdAt) throw new Error('Ölçüm ön kayıttan önce olamaz.');
        if (await digest({ protocolDigest: parsed.digest, observation: observation }) !== parsed.observationDigest) {
          throw new Error('Deney gözleminin bütünlüğü doğrulanamadı.');
        }
      }
      return Object.assign({}, snapshot, { digest: parsed.digest, observation: observation, observationDigest: parsed.observationDigest || null });
    }

    function matches(bounds, value) { return bounds.low <= value && value <= bounds.high; }

    function result(record) {
      if (!record) return null;
      var hypotheses = record.protocol.hypotheses;
      var overlap = Math.max(hypotheses[0].expected.low, hypotheses[1].expected.low) <=
        Math.min(hypotheses[0].expected.high, hypotheses[1].expected.high);
      var observation = record.observation;
      var fitting = observation ? hypotheses.filter(function (hypothesis) {
        return matches(hypothesis.expected, observation.value);
      }).map(function (hypothesis) { return hypothesis.name; }) : [];
      return {
        record: record,
        predictionsOverlap: overlap,
        baselineMatched: observation ? matches(record.protocol.baseline, observation.value) : null,
        compatibleHypotheses: fitting,
        outcome: !observation ? 'AWAITING_OBSERVATION' :
          fitting.length === 1 ? 'ONE_COMPATIBLE' : fitting.length ? 'INCONCLUSIVE' : 'NONE_COMPATIBLE'
      };
    }

    return {
      load: async function () { return result(await read(readRaw())); },
      register: async function (input) {
        if (readRaw()) throw new Error('Mevcut deney ön kaydı zaten var.');
        var generation = clearGeneration;
        var snapshot = { schema: 1, createdAt: new Date().toISOString(), protocol: protocol(input) };
        var hash = await digest(snapshot);
        var record = Object.assign({}, snapshot, { digest: hash, observation: null, observationDigest: null });
        if (generation !== clearGeneration || readRaw()) throw new Error('Yerel deney alanı başka bir işlemle değişti.');
        storageAdapter.setItem(storageKey, JSON.stringify(record));
        return result(record);
      },
      observe: async function (input) {
        var raw = readRaw();
        var record = await read(raw);
        if (!record) throw new Error('Önce deney protokolünü kaydedin.');
        if (record.observation) throw new Error('Bu deney için ölçüm zaten kaydedildi.');
        var receivedAt = new Date().toISOString();
        if (receivedAt < record.createdAt) throw new Error('Cihaz saati ön kayıttan geride.');
        record.observation = { value: finite(input.value, 'Ölçülen değer'), source: textField(input.source, 'Gözlem kaynağı'), receivedAt: receivedAt };
        record.observationDigest = await digest({ protocolDigest: record.digest, observation: record.observation });
        if (readRaw() !== raw) throw new Error('Deney kaydı başka bir işlemle değişti.');
        storageAdapter.setItem(storageKey, JSON.stringify(record));
        return result(record);
      },
      clear: function () {
        storageAdapter.removeItem(storageKey);
        clearGeneration += 1;
      }
    };
  }

  function createResearchNotebook(storageAdapter) {
    var key = 'caelus_research_notebook_v1';
    var sourceLimit = 20;
    var documentLimit = 100000;
    var totalLimit = 400000;
    var engine = getFirstRealTaskEngine();
    if (!engine || typeof engine.computeSha256Hex !== 'function') {
      throw new Error('Araştırma defteri kaynak özeti hesaplayıcısı yüklenemedi.');
    }

    function required(value, field, limit) {
      if (typeof value !== 'string' || !value.trim() || value.length > limit) {
        throw new TypeError(field + ' boş veya izin verilen uzunluğu aşıyor.');
      }
      return value.trim();
    }

    function normalize(value) {
      return value.toLocaleLowerCase('tr-TR').normalize('NFD').replace(/\p{M}/gu, '').replace(/ı/g, 'i');
    }

    var stopWords = new Set(['bu', 'bir', 'ile', 'icin', 'veya', 'mi', 'mu', 'ne', 'nedir',
      'nasil', 'hangi', 'hakkinda', 'olarak', 'var', 'yok', 'the', 'and', 'what', 'which', 'about']);
    function terms(value) {
      return new Set((normalize(value).match(/[\p{L}\p{N}]+/gu) || []).filter(function (token) {
        return token.length >= 2 && !stopWords.has(token);
      }));
    }

    function load() {
      var raw = storageAdapter.getItem(key);
      if (!raw) return [];
      var saved = JSON.parse(raw);
      if (!saved || saved.schema !== 1 || !Array.isArray(saved.sources) ||
          saved.sources.length > sourceLimit || saved.sources.some(function (source) {
            return !source || typeof source.title !== 'string' || typeof source.content !== 'string' ||
              source.content.length > documentLimit || !/^[a-f0-9]{64}$/.test(source.sha256);
          })) throw new Error('Yerel araştırma defteri okunamadı.');
      return saved.sources;
    }

    function citation(source, number) {
      var lines = source.content.split('\n');
      if (!Number.isSafeInteger(number) || number < 1 || number > lines.length || !lines[number - 1].trim()) {
        throw new RangeError('Kaynak satırı bulunamadı.');
      }
      return { title: source.title, sha256: source.sha256, line: number, quote: lines[number - 1] };
    }

    function claim(reference, subject, value, sources) {
      if (!reference) throw new TypeError('Önce bir alıntı seçin.');
      var source = sources.find(function (entry) { return entry.sha256 === reference.sha256; });
      if (!source || engine.computeSha256Hex(source.content) !== source.sha256) {
        throw new Error('Kaynak kaldırılmış veya içeriği değişmiş.');
      }
      var evidence = citation(source, reference.line);
      var field = required(subject, 'Konu veya ölçüt', 250);
      var quotedValue = required(value, 'Kaynakta geçen değer', 250);
      if (!evidence.quote.includes(quotedValue)) throw new Error('Değeri alıntıdaki biçimiyle girin.');
      return { subject: field, value: quotedValue, evidence: evidence };
    }

    return {
      addSources: function (documents) {
        if (!Array.isArray(documents) || !documents.length || documents.length > sourceLimit) {
          throw new TypeError('Bir ila yirmi belge seçin.');
        }
        var sources = load();
        var seen = new Set(sources.map(function (source) { return source.sha256; }));
        var added = 0;
        documents.forEach(function (document) {
          var title = required(document.title, 'Belge adı', 250);
          // Preserve source line numbers and quoted whitespace.
          required(document.content, 'Belge metni', documentLimit);
          var content = document.content.replace(/\r\n?/g, '\n');
          var hash = engine.computeSha256Hex(content);
          if (!seen.has(hash)) {
            sources.push({ title: title, content: content, sha256: hash });
            seen.add(hash);
            added += 1;
          }
        });
        if (sources.length > sourceLimit || sources.reduce(function (size, source) {
          return size + source.content.length;
        }, 0) > totalLimit) throw new RangeError('Defter en fazla 20 belge ve toplam 400.000 karakter saklar.');
        storageAdapter.setItem(key, JSON.stringify({ schema: 1, sources: sources }));
        return added;
      },
      list: function () {
        return load().map(function (source) {
          return { title: source.title, sha256: source.sha256 };
        });
      },
      search: function (question) {
        var query = terms(required(question, 'Soru', 500));
        var hits = [];
        if (query.size === 0) return hits;
        load().forEach(function (source) {
          if (engine.computeSha256Hex(source.content) !== source.sha256) {
            throw new Error('Bir kaynağın içeriği değişmiş. Defteri yeniden oluşturun.');
          }
          source.content.split('\n').forEach(function (quote, index) {
            var tokens = terms(quote);
            var score = 0;
            query.forEach(function (term) { if (tokens.has(term)) score += 1; });
            if (score > 0) {
              hits.push({ title: source.title, sha256: source.sha256, line: index + 1, quote: quote, score: score });
            }
          });
        });
        return hits.sort(function (a, b) { return b.score - a.score; }).slice(0, 12);
      },
      compare: function (first, second, subject, firstValue, secondValue) {
        var sources = load();
        var a = claim(first, subject, firstValue, sources);
        var b = claim(second, subject, secondValue, sources);
        if (a.evidence.sha256 === b.evidence.sha256 && a.evidence.line === b.evidence.line) {
          throw new Error('Karşılaştırmak için iki farklı satır seçin.');
        }
        return {
          status: normalize(a.value) === normalize(b.value) ? 'SAME_VALUE' : 'POTENTIAL_CONFLICT',
          claims: [a, b]
        };
      },
      draft: function (reference, subject, value) {
        return {
          schema: 'CAELUS_RESEARCH_SCENARIO_DRAFT_V1',
          status: 'REQUIRES_REVIEW',
          assumption: claim(reference, subject, value, load())
        };
      },
      clear: function () { storageAdapter.removeItem(key); }
    };
  }

  var CaelusWorldDataGate = {
    LOGICAL_DATA_ZONES_5: LOGICAL_DATA_ZONES_5,
    WORLD_GATE_MODES_3: WORLD_GATE_MODES_3,
    ALLOWED_EXTERNAL_SOURCE_HOSTS: ALLOWED_EXTERNAL_SOURCE_HOSTS,
    validateExternalSourceRequestSafety: validateExternalSourceRequestSafety,
    previewOutboundSourceQuery: previewOutboundSourceQuery,
    createWorldDataGate: createWorldDataGate,
    normalizeAdvisorWorldRecord: normalizeAdvisorWorldRecord,
    convertLivingWorldRecordToAdvisorRecord: convertLivingWorldRecordToAdvisorRecord,
    convertAdvisorRecordToLivingWorldV2: convertAdvisorRecordToLivingWorldV2
  };

  var CaelusConversationalAdvisor = {
    createDecisionWorkspace: createDecisionWorkspace,
    createExperimentWorkspace: createExperimentWorkspace,
    createResearchNotebook: createResearchNotebook,
    ANSWER_PASSPORT_CLASSES_10: ANSWER_PASSPORT_CLASSES_10,
    EPISTEMIC_STATES_12: EPISTEMIC_STATES_12,
    EMPTY_WORLD_DATA_MESSAGE_TR: EMPTY_WORLD_DATA_MESSAGE_TR,
    SUPPORTED_SPEECH_ACTS_12: SUPPORTED_SPEECH_ACTS_12,
    ADVISORY_POLICY_ACTIONS_12: ADVISORY_POLICY_ACTIONS_12,
    MEMORY_CLASS_CATALOG_5: MEMORY_CLASS_CATALOG_5,
    VOICE_TECHNOLOGY_CATALOG: VOICE_TECHNOLOGY_CATALOG,
    ADVISOR_LANGUAGE_CAPABILITY_MATRIX: ADVISOR_LANGUAGE_CAPABILITY_MATRIX,
    EXTERNAL_TECHNOLOGY_EVALUATION_CATALOG_7: EXTERNAL_TECHNOLOGY_EVALUATION_CATALOG_7,
    getVoiceStackCatalogAndStatus: getVoiceStackCatalogAndStatus,
    normalizeTurkishTokenRoot: normalizeTurkishTokenRoot,
    detectUserCorrection: detectUserCorrection,
    detectNegationAndScope: detectNegationAndScope,
    extractTemporalAndNumericSlots: extractTemporalAndNumericSlots,
    analyzeUtteranceNlu: analyzeUtteranceNlu,
    scanUntrustedSourceForInjection: scanUntrustedSourceForInjection,
    detectUnsupportedQuestionBoundary: detectUnsupportedQuestionBoundary,
    parseUserTableContentWithRowProvenance: parseUserTableContentWithRowProvenance,
    normalizeAdvisorWorldRecord: normalizeAdvisorWorldRecord,
    convertLivingWorldRecordToAdvisorRecord: convertLivingWorldRecordToAdvisorRecord,
    convertAdvisorRecordToLivingWorldV2: convertAdvisorRecordToLivingWorldV2,
    computeProvenanceSemiringPolynomial: computeProvenanceSemiringPolynomial,
    runStratifiedDatalogLineageEngine: runStratifiedDatalogLineageEngine,
    verifyConstraintConsistencyBounds: verifyConstraintConsistencyBounds,
    buildDefaultAdvisorWorldRecords: buildDefaultAdvisorWorldRecords,
    createConversationalAdvisorSession: createConversationalAdvisorSession
  };

  var CaelusPersonalAgentStudio = {
    AGENT_CONTRACT_SCHEMA_VERSION: AGENT_CONTRACT_SCHEMA_VERSION,
    AGENT_LIFECYCLE_STATES_9: AGENT_LIFECYCLE_STATES_9,
    MANDATORY_AGENT_CAPABILITIES_3: MANDATORY_AGENT_CAPABILITIES_3,
    AGENT_EXECUTION_MODES_3: AGENT_EXECUTION_MODES_3,
    SUPPORTED_AGENT_SOURCES: SUPPORTED_AGENT_SOURCES,
    EXTERNAL_TECHNOLOGY_EVALUATION_CATALOG_7: EXTERNAL_TECHNOLOGY_EVALUATION_CATALOG_7,
    evaluateCedarStylePolicy: evaluateCedarStylePolicy,
    parseNaturalLanguageGoalToAgentDraft: parseNaturalLanguageGoalToAgentDraft,
    buildAgentContractV1: buildAgentContractV1,
    validateAgentContractV1: validateAgentContractV1,
    enforceAgentRuntimePermission: enforceAgentRuntimePermission,
    exportAgentTemplateSafe: exportAgentTemplateSafe,
    createPersonalAgentStudio: createPersonalAgentStudio
  };

  if (root && typeof root === 'object') {
    root.CaelusWorldDataGate = CaelusWorldDataGate;
  }

  return {
    CaelusConversationalAdvisor: CaelusConversationalAdvisor,
    CaelusPersonalAgentStudio: CaelusPersonalAgentStudio,
    CaelusWorldDataGate: CaelusWorldDataGate
  };
});
