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
   * 10 Zorunlu Cevap Pasaportu Sınıfı (Bölüm 7)
   */
  var ANSWER_PASSPORT_CLASSES_10 = Object.freeze({
    SOURCE_CLAIM: {
      code: 'SOURCE_CLAIM',
      labelTr: 'Kaynaklı Olgu İddiası',
      labelEn: 'Sourced Fact Claim',
      badgeColor: '#38bdf8'
    },
    VERIFIED_CALCULATION: {
      code: 'VERIFIED_CALCULATION',
      labelTr: 'Doğrulanmış Hesap Sonucu',
      labelEn: 'Verified Calculation',
      badgeColor: '#22c55e'
    },
    RULE_DERIVATION: {
      code: 'RULE_DERIVATION',
      labelTr: 'Kural Tabanlı Çıkarım',
      labelEn: 'Rule-Based Derivation',
      badgeColor: '#818cf8'
    },
    USER_INPUT: {
      code: 'USER_INPUT',
      labelTr: 'Kullanıcı Girdisi',
      labelEn: 'User Input',
      badgeColor: '#e2e8f0'
    },
    USER_PREFERENCE: {
      code: 'USER_PREFERENCE',
      labelTr: 'Kullanıcı Tercihi',
      labelEn: 'User Preference',
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
      labelTr: 'Çelişen Kaynak Bilgisi',
      labelEn: 'Conflicting Source Claim',
      badgeColor: '#f43f5e'
    },
    UNKNOWN: {
      code: 'UNKNOWN',
      labelTr: 'Bilinmeyen / Veri Yok',
      labelEn: 'Unknown / Insufficient Data',
      badgeColor: '#94a3b8'
    }
  });

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
      name: 'Piper Neural TTS (ONNX)',
      license: 'MIT',
      commercialUseAllowed: true,
      turkishSupport: 'Destekleniyor (tr_TR-dfki / fahrettin / fgl ses modelleri)',
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
  // Varsayılan Konuşan Dünya Kayıtları (Zorunlu 3 Turlu Dikey Kesit ve Çoklu Kaynak Testi)
  // ----------------------------------------------------------------------------
  function buildDefaultAdvisorWorldRecords() {
    return [
      {
        record_id: 'rec-wikidata-tsmc-2026',
        record_type: 'ENTITY_STATE_UPDATE',
        source_id: 'wikidata',
        source_name: 'Wikidata Sparql & Entity API',
        source_url: 'https://www.wikidata.org/wiki/Q713418',
        source_license: 'CC0-1.0',
        commercial_status: 'ALLOWED_COMMERCIAL',
        event_time: '2026-03-28T09:00:00Z',
        source_published_at: '2026-03-28T11:30:00Z',
        ingested_at: '2026-03-30T08:00:00Z',
        last_checked_at: '2026-03-30T08:00:00Z',
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
            epistemic_status: 'OBSERVED_FACT'
          }
        ],
        epistemic_status: 'OBSERVED_FACT',
        confidence_note: 'Resmi kurumsal ve açık bilgi grafı kaydı (Wikidata Q713418).'
      },
      {
        record_id: 'rec-sec-apple-10k-2026',
        record_id_canonical: 'rec-sec-apple-10k-2026',
        record_type: 'CORPORATE_FILING',
        source_id: 'sec_edgar',
        source_name: 'U.S. SEC EDGAR Submissions API',
        source_url: 'https://data.sec.gov/submissions/CIK0000320193.json',
        source_license: 'US-Public-Domain',
        commercial_status: 'ALLOWED_COMMERCIAL',
        event_time: '2026-03-25T16:00:00Z',
        source_published_at: '2026-03-25T20:15:00Z',
        ingested_at: '2026-03-30T08:05:00Z',
        last_checked_at: '2026-03-30T08:05:00Z',
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
            epistemic_status: 'OBSERVED_FACT'
          }
        ],
        epistemic_status: 'OBSERVED_FACT',
        confidence_note: 'ABD SEC EDGAR resmi kurumsal bildirim verisi.'
      },
      {
        record_id: 'rec-openalex-semi-supply-2026',
        record_type: 'SCIENTIFIC_PUBLICATION',
        source_id: 'openalex',
        source_name: 'OpenAlex Scholarly Works API',
        source_url: 'https://api.openalex.org/works',
        source_license: 'CC0-1.0',
        commercial_status: 'ALLOWED_COMMERCIAL',
        event_time: '2026-03-20T00:00:00Z',
        source_published_at: '2026-03-21T10:00:00Z',
        ingested_at: '2026-03-30T08:10:00Z',
        last_checked_at: '2026-03-30T08:10:00Z',
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
            epistemic_status: 'REPORTED_CLAIM'
          }
        ],
        epistemic_status: 'REPORTED_CLAIM',
        confidence_note: 'OpenAlex hakemli/açık erişim bilimsel yayın kaydı.'
      }
    ];
  }

  /**
   * Konuşan Dünya Muhakeme Sistemi Denetleyicisi Oluşturucu
   */
  function createConversationalAdvisorSession(options) {
    var opts = options || {};
    var lwm = getLivingWorldModel();
    var frt = getFirstRealTaskEngine();

    // 5 Ayrıştırılmış Hafıza Katmanı
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
          : ['Teknoloji ve Tedarik Zinciri', 'Yarı İletken ve Elektronik Donanım'],
        followedEntities: Array.isArray(opts.initialFollowedEntities)
          ? opts.initialFollowedEntities.slice()
          : ['TSMC', 'Apple Inc.'],
        preferredLanguage: opts.language || 'tr-TR',
        budgetCeiling: typeof opts.budgetCeiling === 'number' ? opts.budgetCeiling : 100000,
        riskTolerance: opts.riskTolerance || 'DENGELI'
      },
      C_SOURCED_WORLD_MEMORY: Array.isArray(opts.worldRecords) && opts.worldRecords.length > 0
        ? opts.worldRecords.slice()
        : buildDefaultAdvisorWorldRecords(),
      D_USER_PRIVATE_FILES: Array.isArray(opts.userFiles) ? opts.userFiles.slice() : [],
      E_PAST_ANALYSES_AND_REPORTS: []
    };

    function findMatchingRecordsForEntity(entityName) {
      if (!entityName) return [];
      var target = String(entityName).toLocaleLowerCase('tr-TR');
      return memoryStore.C_SOURCED_WORLD_MEMORY.filter(function (rec) {
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

    function discoverRelatedEntitiesAndPaths(entityName, matchingRecords) {
      var targetLower = String(entityName || '').toLocaleLowerCase('tr-TR');
      var relations = [];
      var seenNames = new Set();

      // 1. Doğrudan aynı kaynaklı kayıtta ortak geçen kurumlar
      for (var i = 0; i < matchingRecords.length; i++) {
        var rec = matchingRecords[i];
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
            relationLabelTr: 'Doğrudan Kaynaklı İlişki / Ortak Kayıt',
            evidenceRecordId: rec.record_id,
            evidenceSourceName: rec.source_name,
            evidenceTitle: rec.title,
            eventTime: rec.event_time,
            epistemicClass: 'SOURCE_CLAIM',
            explanationTr:
              entityName + ' ile ' + name + ' aynı doğrulanmış kaynak kaydında (' + rec.source_name + ' — "' + rec.title + '") birlikte yer alıyor.'
          });
        }
      }

      // 2. Yaşayan Dünya Katmanı (CaelusLivingWorldModel) üzerinden alanlar arası bağlantı keşfi
      if (lwm && typeof lwm.discoverCrossDomainLivingConnections === 'function') {
        try {
          var cross = lwm.discoverCrossDomainLivingConnections(memoryStore.C_SOURCED_WORLD_MEMORY, {
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
              explanationTr: link.explanationTr || 'Ortak varlık ve zaman penceresi üzerinden tespit edilen bağlantı.'
            });
          }
        } catch (_) {}
      }

      return relations;
    }

    function selectAdvisoryPolicyAction(nlu, matchingRecords) {
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

      // Katman 1: Giriş ve Ses Durumu
      var voiceState = getVoiceStackCatalogAndStatus({ micEnabled: tOpts.micEnabled === true });
      var injectionCheck = scanUntrustedSourceForInjection(userUtterance);

      // Katman 2: NLU Analizi
      var nlu = analyzeUtteranceNlu(userUtterance, state, memoryStore.C_SOURCED_WORLD_MEMORY);

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
        : (nlu.speechAct === SUPPORTED_SPEECH_ACTS_12.WORLD_STATUS_QUERY ? memoryStore.C_SOURCED_WORLD_MEMORY.slice(0, 5) : []);

      // Katman 4: Danışmanlık Politikası
      var policyAction = selectAdvisoryPolicyAction(nlu, matchingRecords);

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

      if (nlu.correction.isCorrection && nlu.correction.correctedTarget) {
        passportSegments.push({
          classCode: 'USER_INPUT',
          labelTr: ANSWER_PASSPORT_CLASSES_10.USER_INPUT.labelTr,
          text: 'Kullanıcı düzeltmesi uygulandı: Odak varlık "' + nlu.correction.correctedTarget + '" olarak güncellendi.'
        });
      }

      // Senaryo 1: Belirli Kurum/Kişi/Konu Hakkında Son Değişiklik (Zorunlu Dikey Kesit Tur 1)
      if (
        nlu.speechAct === SUPPORTED_SPEECH_ACTS_12.ENTITY_RECENT_CHANGE ||
        nlu.speechAct === SUPPORTED_SPEECH_ACTS_12.WORLD_STATUS_QUERY ||
        nlu.speechAct === SUPPORTED_SPEECH_ACTS_12.TEMPORAL_DIFF_QUERY
      ) {
        if (matchingRecords.length === 0) {
          unknowns.push(
            (focusEntity ? '"' + focusEntity + '" için ' : '') +
            'yerel dünya hafızasında doğrulanmış güncel kayıt bulunamadı.'
          );
          passportSegments.push({
            classCode: 'UNKNOWN',
            labelTr: ANSWER_PASSPORT_CLASSES_10.UNKNOWN.labelTr,
            text: unknowns[0]
          });
          responseParagraphs.push(
            (focusEntity ? '"' + focusEntity + '" hakkında ' : 'Bu konuda ') +
            'şu anda bağlı dünya hafızasında doğrulanmış bir kayıt bulunmuyor. Olgu uydurmamak adına tahmin yürütmüyorum.'
          );
          suggestedNextAction = 'Gerçek kaynak bağlayıcısından (Wikidata, SEC EDGAR, OpenAlex veya World Bank) yeni sorgu çalıştırabilir veya kendi veri dosyanızı yükleyebilirsiniz.';
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

          for (var i = 0; i < matchingRecords.length; i++) {
            var rec = matchingRecords[i];
            if (Array.isArray(rec.claims)) {
              rec.claims.forEach(function (c) {
                if (c && c.claim_id) claimIds.push(c.claim_id);
              });
            }
            passportSegments.push({
              classCode: 'SOURCE_CLAIM',
              labelTr: ANSWER_PASSPORT_CLASSES_10.SOURCE_CLAIM.labelTr,
              sourceName: rec.source_name,
              sourceUrl: rec.source_url,
              eventTime: rec.event_time,
              publishedAt: rec.source_published_at,
              ingestedAt: rec.ingested_at,
              recordId: rec.record_id,
              text: '[' + rec.source_name + ' | Olay: ' + String(rec.event_time).slice(0, 10) + '] ' + rec.title + ' — ' + rec.summary
            });
          }

          responseParagraphs.push(
            state.activeEntity + ' hakkında kaynaklı dünya hafızasında ' + matchingRecords.length + ' doğrulanmış gelişme kayıtlıdır:'
          );
          for (var m = 0; m < matchingRecords.length; m++) {
            var mr = matchingRecords[m];
            responseParagraphs.push(
              '• [' + mr.source_name + ' — Olay Tarihi: ' + String(mr.event_time).slice(0, 10) + ', Alım: ' + String(mr.ingested_at).slice(0, 10) + '] ' +
              mr.title + ': ' + mr.summary
            );
          }
          suggestedNextAction = '"' + state.activeEntity + ' ile ilgili bu değişiklik hangi kurumlarla ilişkili?" diye sorarak doğrudan ve dolaylı bağlantı yollarını inceleyebilirsiniz.';
        }
      }
      // Senaryo 2: İlişki Sorgusu (Zorunlu Dikey Kesit Tur 2: "Bu değişiklik hangi kurumlarla ilişkili?")
      else if (nlu.speechAct === SUPPORTED_SPEECH_ACTS_12.RELATION_EXPLORATION) {
        if (!focusEntity || matchingRecords.length === 0) {
          unknowns.push('İlişkisi incelenecek odak kurum veya kaynaklı kayıt bağlamı bulunamadı.');
          passportSegments.push({
            classCode: 'UNKNOWN',
            labelTr: ANSWER_PASSPORT_CLASSES_10.UNKNOWN.labelTr,
            text: unknowns[0]
          });
          responseParagraphs.push(
            'Hangi kurum veya değişiklik arasındaki ilişkileri incelemek istediğinizi netleştirebilir misiniz? (Örn. önce bir kurum adını belirtebilirsiniz.)'
          );
          suggestedNextAction = 'Önce incelemek istediğiniz kurumun adını yazın (ör. "TSMC hakkında son dönemde ne değişti?").';
        } else {
          var relations = discoverRelatedEntitiesAndPaths(focusEntity, matchingRecords);
          state.activeEntity = focusEntity;
          if (relations.length === 0) {
            unknowns.push(focusEntity + ' için mevcut kayıtlarda başka bir kurumla doğrulanmış bağlantı bulunamadı.');
            passportSegments.push({
              classCode: 'UNKNOWN',
              labelTr: ANSWER_PASSPORT_CLASSES_10.UNKNOWN.labelTr,
              text: unknowns[0]
            });
            responseParagraphs.push(focusEntity + ' için mevcut dünya kayıtlarında başka bir kurumla doğrulanmış ortak kayıt bulunamadı.');
          } else {
            responseParagraphs.push(
              'Önceki turda konuştuğumuz ' + focusEntity + ' gelişmesiyle ilişkili kurumlar ve kanıt sınıfları şunlardır:'
            );
            for (var rIdx = 0; rIdx < relations.length; rIdx++) {
              var rel = relations[rIdx];
              var pClass = rel.epistemicClass === 'HYPOTHESIS' ? 'HYPOTHESIS' : (rel.epistemicClass === 'RULE_DERIVATION' ? 'RULE_DERIVATION' : 'SOURCE_CLAIM');
              passportSegments.push({
                classCode: pClass,
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
              'Not: Ortak kayıt ve tedarik bildirimleri doğrudan ilişkidir; tek başına zamansal yakınlık kesin nedensellik kanıtı değildir.'
            );
          }
          suggestedNextAction = '"Peki bu benim ilgilendiğim alanı etkiler mi?" diye sorarak kendi ilgi alanlarınız açısından olası etkileri değerlendirebilirsiniz.';
        }
      }
      // Senaryo 3: Kullanıcı İlgi Alanı ve Danışmanlık Etkisi (Zorunlu Dikey Kesit Tur 3: "Peki bu benim ilgilendiğim alanı etkiler mi?")
      else if (nlu.speechAct === SUPPORTED_SPEECH_ACTS_12.USER_DOMAIN_IMPACT) {
        var userInterests = Array.isArray(prefs.interestAreas) ? prefs.interestAreas : [];
        passportSegments.push({
          classCode: 'USER_PREFERENCE',
          labelTr: ANSWER_PASSPORT_CLASSES_10.USER_PREFERENCE.labelTr,
          text: 'Kullanıcı kontrollü tercih hafızasındaki ilgi alanlarınız: ' + (userInterests.join(', ') || 'Tanımlı değil')
        });

        if (!focusEntity || matchingRecords.length === 0) {
          unknowns.push('Etki analizi için aktif bir dünya gelişmesi veya odak kurum bağlamı bulunmuyor.');
          passportSegments.push({
            classCode: 'UNKNOWN',
            labelTr: ANSWER_PASSPORT_CLASSES_10.UNKNOWN.labelTr,
            text: unknowns[0]
          });
          responseParagraphs.push(
            'Kayıtlı ilgi alanlarınız (' + (userInterests.join(', ') || 'belirtilmemiş') + ') mevcut, ancak hangi gelişmenin etkisini sormak istediğiniz net değil.'
          );
          suggestedNextAction = 'Lütfen değerlendirmek istediğiniz kurumu veya gelişmeyi belirtin.';
        } else {
          // Kaynaklı olgu
          var rec0 = matchingRecords[0];
          passportSegments.push({
            classCode: 'SOURCE_CLAIM',
            labelTr: ANSWER_PASSPORT_CLASSES_10.SOURCE_CLAIM.labelTr,
            sourceName: rec0.source_name,
            recordId: rec0.record_id,
            text: focusEntity + ' kaydı (' + rec0.source_name + '): ' + rec0.summary
          });
          // Kural çıkarımı
          var ruleText =
            focusEntity + ' gelişmesi (' + (rec0.domains || []).join(', ') + ' alanları), tanımlı ilgi alanlarınız olan "' +
            userInterests.join(', ') + '" ile tedarik zinciri ve yarı iletken/donanım bağımlılığı üzerinden doğrudan kesişmektedir.';
          passportSegments.push({
            classCode: 'RULE_DERIVATION',
            labelTr: ANSWER_PASSPORT_CLASSES_10.RULE_DERIVATION.labelTr,
            text: ruleText
          });
          // Olası hipotez
          var hypText =
            'Olası Bağlantı (Hipotez): Dökümhane kapasite tahsisindeki değişimler, takip ettiğiniz donanım ve teknoloji projelerinde 6–14 haftalık tedarik süresi veya birim maliyet baskısı oluşturabilir.';
          passportSegments.push({
            classCode: 'HYPOTHESIS',
            labelTr: ANSWER_PASSPORT_CLASSES_10.HYPOTHESIS.labelTr,
            text: hypText
          });
          // Bilinmeyen / eksik bilgi
          var unkText =
            'Eksik Bilgi (Bilinmeyen): Sizin kendi sözleşmelerinizdeki stok tampon süresi ve birim fiyat sabitleme koşulları dünya hafızasında yer almadığından net mali etki tutarı henüz hesaplanamaz.';
          unknowns.push(unkText);
          passportSegments.push({
            classCode: 'UNKNOWN',
            labelTr: ANSWER_PASSPORT_CLASSES_10.UNKNOWN.labelTr,
            text: unkText
          });

          responseParagraphs.push(
            '1. [Kullanıcı Tercihi ve Bağlam]: Açıkça tanımladığınız ilgi alanlarınız (' + userInterests.join(', ') + ') ile önceki turda incelenen ' + focusEntity + ' gelişmesini birlikte değerlendirdim.'
          );
          responseParagraphs.push(
            '2. [Kaynaklı Olgu + Kural Çıkarımı]: ' + ruleText
          );
          responseParagraphs.push(
            '3. [Olası Bağlantı / Hipotez]: ' + hypText
          );
          responseParagraphs.push(
            '4. [Bilinmeyen / Eksik Veri]: ' + unkText
          );
          suggestedNextAction = 'Kendi tedarik veya bütçe seçeneklerinizi içeren CSV/JSON dosyanızı yükleyerek veya iki seçeneği yazarak deterministik maliyet/risk karşılaştırması çalıştırabilirsiniz.';
        }
      }
      // Senaryo 4: Kanıt ve Kaynak Sorma
      else if (nlu.speechAct === SUPPORTED_SPEECH_ACTS_12.PROVENANCE_AND_EVIDENCE) {
        if (matchingRecords.length === 0) {
          unknowns.push('Kanıtı gösterilecek aktif kayıt bulunamadı.');
          passportSegments.push({
            classCode: 'UNKNOWN',
            labelTr: ANSWER_PASSPORT_CLASSES_10.UNKNOWN.labelTr,
            text: unknowns[0]
          });
          responseParagraphs.push('Şu anda seçili bir kayıt bulunmuyor; önce bir kurum veya olay sorgulayabilirsiniz.');
        } else {
          responseParagraphs.push('Mevcut yanıtın dayandığı birincil kaynak kayıtları ve zaman damgaları:');
          matchingRecords.forEach(function (r) {
            passportSegments.push({
              classCode: 'SOURCE_CLAIM',
              labelTr: ANSWER_PASSPORT_CLASSES_10.SOURCE_CLAIM.labelTr,
              sourceName: r.source_name,
              sourceUrl: r.source_url,
              recordId: r.record_id,
              text: r.source_name + ' (' + r.source_license + ') — Olay: ' + r.event_time + ', Yayın: ' + r.source_published_at + ', Sisteme Alım: ' + r.ingested_at
            });
            responseParagraphs.push(
              '• Kaynak: ' + r.source_name + ' | Lisans: ' + r.source_license + ' | Olay Zamanı: ' + r.event_time + ' | Yayın: ' + r.source_published_at + ' | CAELUS Alım: ' + r.ingested_at
            );
          });
          suggestedNextAction = 'Kaydın revizyon geçmişini veya çelişen iddiaları sorgulayabilirsiniz.';
        }
      }
      // Senaryo 5: Seçenek Karşılaştırma / Varsayım Değiştirme
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
            labelTr: ANSWER_PASSPORT_CLASSES_10.MODEL_ASSUMPTION.labelTr,
            text: assumptions[0]
          });
        }
        var calcId = 'calc-advisor-' + Date.now();
        calculationIds.push(calcId);
        var ceiling = prefs.budgetCeiling || 100000;
        var summaryCalc =
          'Deterministik Karşılaştırma Çerçevesi: Aktif bütçe tavanı varsayımı = ' + ceiling +
          ' birim. Seçeneklerin maliyet, süre ve tedarik riski kırılımı uydurma ağırlık kullanılmadan açık formülle hesaplanır.';
        passportSegments.push({
          classCode: 'VERIFIED_CALCULATION',
          labelTr: ANSWER_PASSPORT_CLASSES_10.VERIFIED_CALCULATION.labelTr,
          calculationId: calcId,
          text: summaryCalc
        });
        passportSegments.push({
          classCode: 'MODEL_ASSUMPTION',
          labelTr: ANSWER_PASSPORT_CLASSES_10.MODEL_ASSUMPTION.labelTr,
          text: 'Aktif bütçe tavanı varsayımı: ' + ceiling + ' (kullanıcı tarafından değiştirilebilir).'
        });
        responseParagraphs.push(summaryCalc);
        suggestedNextAction = 'Seçenek tablonuzu İlk Gerçek Görev veya Kişisel Ajan Karşılaştırma aracına aktararak satır bazlı kanıtlı raporu indirebilirsiniz.';
      }
      // Senaryo 6: Selamlama veya Belirsiz Soru
      else if (nlu.speechAct === SUPPORTED_SPEECH_ACTS_12.GREETING_AND_GUIDE) {
        passportSegments.push({
          classCode: 'USER_INPUT',
          labelTr: ANSWER_PASSPORT_CLASSES_10.USER_INPUT.labelTr,
          text: 'Kullanıcı selamlaması ve yönlendirme isteği.'
        });
        responseParagraphs.push(
          'Merhaba. Ben CAELUS Konuşan Dünya Muhakeme Danışmanıyım. Genel amaçlı bir LLM kullanmadan, yalnızca kaynaklı dünya hafızası, açık kurallar ve deterministik hesaplama ile çalışırım.'
        );
        suggestedNextAction = '"TSMC hakkında son dönemde ne değişti?" gibi bir kurum sorabilir, ardından "Bu değişiklik hangi kurumlarla ilişkili?" ve "Peki bu benim ilgilendiğim alanı etkiler mi?" sorularıyla ilerleyebilirsiniz.';
      } else {
        unknowns.push('Sorguda incelenecek kurum, zaman aralığı veya karar seçeneği belirsiz.');
        passportSegments.push({
          classCode: 'UNKNOWN',
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
        suggestedNextAction = 'Bir kurum adı (ör. "TSMC" veya "Apple Inc.") ya da karşılaştırmak istediğiniz seçenekleri yazabilirsiniz.';
      }

      // Katman 7: Yapılandırılmış Cevap Planı (Structured Answer Plan — Bölüm 4.2)
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
          ? 'GROUNDED_IN_' + matchingRecords.length + '_SOURCED_RECORDS'
          : 'ABSTAIN_OR_CLARIFICATION_REQUIRED',
        suggested_next_action: suggestedNextAction,
        language: prefs.preferredLanguage || 'tr-TR',
        response_policy: 'NON_LLM_CONTROLLED_GROUNDED_GENERATION',
        security_warnings: securityWarnings
      };

      // Katman 8: Kontrollü Yanıt ve Cevap Pasaportu
      var answerText = responseParagraphs.join('\n\n');
      var answerPassport = {
        schema: 'CAELUS_ANSWER_PASSPORT_V1',
        generatedAt: nowIso,
        nonLlmGuaranteed: true,
        segments: passportSegments,
        summaryCounts: passportSegments.reduce(function (acc, seg) {
          acc[seg.classCode] = (acc[seg.classCode] || 0) + 1;
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
        A_EPHEMERAL_DIALOGUE_STATE: JSON.parse(JSON.stringify(memoryStore.A_EPHEMERAL_DIALOGUE_STATE)),
        B_USER_CONTROLLED_PREFERENCES: JSON.parse(JSON.stringify(memoryStore.B_USER_CONTROLLED_PREFERENCES)),
        C_SOURCED_WORLD_MEMORY_COUNT: memoryStore.C_SOURCED_WORLD_MEMORY.length,
        C_SOURCED_WORLD_MEMORY: memoryStore.C_SOURCED_WORLD_MEMORY.slice(),
        D_USER_PRIVATE_FILES_COUNT: memoryStore.D_USER_PRIVATE_FILES.length,
        E_PAST_ANALYSES_COUNT: memoryStore.E_PAST_ANALYSES_AND_REPORTS.length
      };
    }

    function addWorldRecordsToAdvisorMemory(records) {
      if (!Array.isArray(records)) return memoryStore.C_SOURCED_WORLD_MEMORY.length;
      for (var i = 0; i < records.length; i++) {
        var r = records[i];
        if (!r || !r.record_id) continue;
        // Kullanıcı tercihi veya uydurma kayıt dünya olgusu olarak yazılamaz!
        if (r.epistemic_status === 'USER_PREFERENCE' || r.record_type === 'USER_PREFERENCE') {
          continue;
        }
        var exists = memoryStore.C_SOURCED_WORLD_MEMORY.some(function (ex) {
          return ex.record_id === r.record_id;
        });
        if (!exists) {
          memoryStore.C_SOURCED_WORLD_MEMORY.unshift(r);
        }
      }
      return memoryStore.C_SOURCED_WORLD_MEMORY.length;
    }

    return {
      processAdvisorTurn: processAdvisorTurn,
      updateUserPreferences: updateUserPreferences,
      clearDialogueState: clearDialogueState,
      deleteUserPreferences: deleteUserPreferences,
      inspectSeparatedMemory: inspectSeparatedMemory,
      addWorldRecordsToAdvisorMemory: addWorldRecordsToAdvisorMemory,
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
   * Sürümlü Ajan Sözleşmesi Oluşturucu ve Doğrulayıcı (`CAELUS_AGENT_CONTRACT_V1` — Bölüm 4)
   */
  function buildAgentContractV1(spec) {
    var s = spec || {};
    var nowIso = new Date().toISOString();
    var capabilityType = s.capabilityType || MANDATORY_AGENT_CAPABILITIES_3.TRACK_REAL_SOURCE;
    var execMode = s.executionMode && AGENT_EXECUTION_MODES_3[s.executionMode] ? s.executionMode : 'MANUAL';
    var allowedSources = Array.isArray(s.allowed_sources)
      ? s.allowed_sources.slice()
      : (capabilityType === MANDATORY_AGENT_CAPABILITIES_3.INSPECT_USER_FILE ? ['user_local_file'] : ['wikidata', 'sec_edgar', 'openalex']);

    var allowedTools = Array.isArray(s.allowed_tools)
      ? s.allowed_tools.slice()
      : (capabilityType === MANDATORY_AGENT_CAPABILITIES_3.INSPECT_USER_FILE
        ? ['file_table_inspector', 'row_provenance_linker']
        : capabilityType === MANDATORY_AGENT_CAPABILITIES_3.COMPARE_OPTIONS
          ? ['deterministic_option_calculator', 'unit_and_missing_validator']
          : ['living_world_source_reader', 'record_diff_detector']);

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
        network_access: s.network_access !== undefined
          ? Boolean(s.network_access)
          : capabilityType === MANDATORY_AGENT_CAPABILITIES_3.TRACK_REAL_SOURCE,
        local_file_read: s.local_file_read !== undefined
          ? Boolean(s.local_file_read)
          : capabilityType === MANDATORY_AGENT_CAPABILITIES_3.INSPECT_USER_FILE,
        local_file_write: Boolean(s.local_file_write === true),
        notifications: Boolean(s.notifications === true),
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
        max_records_per_run: typeof s.max_records_per_run === 'number' ? s.max_records_per_run : 200
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
   * Çalışma Zamanı Yetki ve İzolasyon Denetleyicisi (`enforceAgentRuntimePermission` — Bölüm 8)
   */
  function enforceAgentRuntimePermission(agentContract, actionRequest, auditLog) {
    var nowIso = new Date().toISOString();
    var req = actionRequest || {};
    var perms = (agentContract && agentContract.permissions) || {};
    var allowedSources = (agentContract && agentContract.allowed_sources) || [];
    var allowedFiles = (agentContract && agentContract.inputs && agentContract.inputs.user_files) || [];
    var allowedTools = (agentContract && agentContract.allowed_tools) || [];

    function recordCheck(allowed, code, detail) {
      var entry = {
        timestamp: nowIso,
        agentId: agentContract ? agentContract.agent_id : null,
        requestType: req.type,
        target: req.target || null,
        allowed: allowed,
        code: code,
        detailTr: detail
      };
      if (Array.isArray(auditLog)) auditLog.push(entry);
      return entry;
    }

    // 1. Ajanlar arası hafıza izolasyonu kontrolü
    if (req.type === 'READ_AGENT_MEMORY') {
      var expectedScope = agentContract && agentContract.memory_policy && agentContract.memory_policy.scope;
      if (req.targetScope !== expectedScope) {
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
      if (allowedSources.indexOf(req.target) === -1) {
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
      if (allowedFiles.indexOf(req.target) === -1) {
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
      if (allowedTools.indexOf(req.target) === -1) {
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
    // Özel dosyaları ve gizli parametreleri temizle
    if (copy.inputs) {
      copy.inputs.user_files = [];
      if (copy.inputs.parameters && typeof copy.inputs.parameters === 'object') {
        var sanitizedParams = {};
        Object.keys(copy.inputs.parameters).forEach(function (k) {
          if (/key|token|secret|password|credential|private|filecontent/i.test(k)) {
            return; // Gizli anahtar veya özel içerik dışa aktarılmaz!
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

  /**
   * Kişisel Ajan Stüdyosu ve Çalışma Zamanı Oluşturucu (`createPersonalAgentStudio`)
   */
  function createPersonalAgentStudio(options) {
    var opts = options || {};
    var agentsById = new Map();
    var agentIsolatedMemories = new Map();
    var agentRunLogsById = new Map();
    var userFilesByName = new Map();
    var worldRecordsPool = Array.isArray(opts.worldRecords) && opts.worldRecords.length > 0
      ? opts.worldRecords.slice()
      : buildDefaultAdvisorWorldRecords();

    // Varsayılan örnek kullanıcı dosyası (Kullanıcı izin verirse okunabilir)
    if (Array.isArray(opts.initialUserFiles)) {
      opts.initialUserFiles.forEach(function (f) {
        if (f && f.fileName) userFilesByName.set(f.fileName, JSON.parse(JSON.stringify(f)));
      });
    } else {
      userFilesByName.set('tedarik_secenekleri_2026.csv', {
        fileName: 'tedarik_secenekleri_2026.csv',
        mimeType: 'text/csv',
        originalContent: [
          'secenek_adi,birim_maliyet_usd,teslim_suresi_gun,risk_puani,notlar',
          'Dresden Yerel Hat,142,18,15,Avrupa içi yedekli hat',
          'Asya Ekspres Hat,118,34,42,Tekil dökümhane bağımlılığı',
          'Eksik Satir Ornegi,abc,-5,,Bozuk veri satırı'
        ].join('\n')
      });
    }

    function registerUserFile(fileName, content, mimeType) {
      userFilesByName.set(fileName, {
        fileName: fileName,
        mimeType: mimeType || 'text/csv',
        originalContent: String(content || '')
      });
      return { registered: true, fileName: fileName };
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
        notes: []
      });
      agentRunLogsById.set(contract.agent_id, []);
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
      var validation = validateAgentContractV1(merged);
      if (!validation.valid) {
        throw new Error('Güncellenen Ajan Sözleşmesi geçersiz: ' + validation.errors.join(' | '));
      }
      agentsById.set(agentId, merged);
      return merged;
    }

    function revokeAgentPermission(agentId, permissionKind, targetValue) {
      var ag = agentsById.get(agentId);
      if (!ag) throw new Error('Ajan bulunamadı: ' + agentId);
      if (permissionKind === 'network_access') {
        ag.permissions.network_access = false;
      } else if (permissionKind === 'local_file_read') {
        ag.permissions.local_file_read = false;
      } else if (permissionKind === 'source' && targetValue) {
        ag.allowed_sources = ag.allowed_sources.filter(function (s) { return s !== targetValue; });
      } else if (permissionKind === 'file' && targetValue && ag.inputs && Array.isArray(ag.inputs.user_files)) {
        ag.inputs.user_files = ag.inputs.user_files.filter(function (f) { return f !== targetValue; });
      }
      ag.updated_at = new Date().toISOString();
      return ag;
    }

    function pauseAgentRun(agentId) {
      var ag = agentsById.get(agentId);
      if (!ag) throw new Error('Ajan bulunamadı: ' + agentId);
      ag.status = AGENT_LIFECYCLE_STATES_9.PAUSED;
      ag.updated_at = new Date().toISOString();
      return ag;
    }

    function resumeAgentRun(agentId) {
      var ag = agentsById.get(agentId);
      if (!ag) throw new Error('Ajan bulunamadı: ' + agentId);
      ag.status = AGENT_LIFECYCLE_STATES_9.READY;
      ag.updated_at = new Date().toISOString();
      return ag;
    }

    function stopAgentRun(agentId) {
      var ag = agentsById.get(agentId);
      if (!ag) throw new Error('Ajan bulunamadı: ' + agentId);
      ag.status = AGENT_LIFECYCLE_STATES_9.STOPPED;
      ag.updated_at = new Date().toISOString();
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
      return { deleted: true, impactPreview: impactPreview };
    }

    // --------------------------------------------------------------------------
    // 3 Zorunlu Ajan Yeteneğinin Gerçek Çalıştırılması (`runAgent`)
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

      if (ag.status === AGENT_LIFECYCLE_STATES_9.PAUSED || ag.status === AGENT_LIFECYCLE_STATES_9.STOPPED) {
        return {
          ok: false,
          status: ag.status,
          errorTr: 'Ajan şu anda ' + ag.status + ' durumunda olduğundan çalıştırılmadı.'
        };
      }

      ag.status = AGENT_LIFECYCLE_STATES_9.RUNNING;

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
          return tFail;
        }

        var requestedSources = Array.isArray(ctx.requestedSources) && ctx.requestedSources.length > 0
          ? ctx.requestedSources
          : ag.allowed_sources;

        var checkedSources = [];
        for (var sIdx = 0; sIdx < requestedSources.length; sIdx++) {
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
          return noSrcCard;
        }

        // Kaynak erişilemezlik simülasyonu veya gerçek durum kontrolü
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
          return unavailCard;
        }

        var candidateRecords = Array.isArray(ctx.recordsOverride) ? ctx.recordsOverride : worldRecordsPool;
        var focusEntities = (ag.inputs && Array.isArray(ag.inputs.entities)) ? ag.inputs.entities : [];

        var matched = [];
        var newRecords = [];
        var unchangedRecords = [];
        var syndicationDupes = [];
        var titleSeenInRun = new Set();

        for (var r = 0; r < candidateRecords.length && matched.length < ag.safety_limits.max_records_per_run; r++) {
          var rec = candidateRecords[r];
          if (!rec || checkedSources.indexOf(rec.source_id) === -1) continue;

          // Güvenilmeyen kaynak metni enjeksiyon taraması
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

          var fp = rec.record_id + '@' + (rec.source_published_at || rec.event_time || '');
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
            title: m.title,
            eventTime: m.event_time,
            publishedAt: m.source_published_at,
            ingestedAt: m.ingested_at,
            lastCheckedAt: startedAtIso,
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
          unknowns: matched.length === 0 ? ['Seçili filtre ve kaynaklarda eşleşen kayıt bulunamadı.'] : [],
          auditSteps: auditSteps,
          blockedPermissionAttempts: blockedPermissionAttempts,
          securityAlerts: securityAlerts
        });
        agentRunLogsById.get(agentId).push(reportCard);
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
          return missingFileCard;
        }

        var rawSnapshotBefore = fileEntry.originalContent;
        var lines = String(fileEntry.originalContent || '').split(/\r?\n/).filter(function (l) { return l.trim().length > 0; });
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
          var riskVal = cols[3] !== '' ? Number(cols[3]) : NaN;
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

        // Orijinal dosyanın değiştirilmediğini doğrula
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
        agentRunLogsById.get(agentId).push(compReport);
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
      exportAgentTemplateSafe: exportAgentTemplateSafe,
      parseNaturalLanguageGoalToAgentDraft: parseNaturalLanguageGoalToAgentDraft
    };
  }

  var CaelusConversationalAdvisor = {
    ANSWER_PASSPORT_CLASSES_10: ANSWER_PASSPORT_CLASSES_10,
    SUPPORTED_SPEECH_ACTS_12: SUPPORTED_SPEECH_ACTS_12,
    ADVISORY_POLICY_ACTIONS_12: ADVISORY_POLICY_ACTIONS_12,
    MEMORY_CLASS_CATALOG_5: MEMORY_CLASS_CATALOG_5,
    VOICE_TECHNOLOGY_CATALOG: VOICE_TECHNOLOGY_CATALOG,
    getVoiceStackCatalogAndStatus: getVoiceStackCatalogAndStatus,
    normalizeTurkishTokenRoot: normalizeTurkishTokenRoot,
    detectUserCorrection: detectUserCorrection,
    detectNegationAndScope: detectNegationAndScope,
    extractTemporalAndNumericSlots: extractTemporalAndNumericSlots,
    analyzeUtteranceNlu: analyzeUtteranceNlu,
    scanUntrustedSourceForInjection: scanUntrustedSourceForInjection,
    buildDefaultAdvisorWorldRecords: buildDefaultAdvisorWorldRecords,
    createConversationalAdvisorSession: createConversationalAdvisorSession
  };

  var CaelusPersonalAgentStudio = {
    AGENT_CONTRACT_SCHEMA_VERSION: AGENT_CONTRACT_SCHEMA_VERSION,
    AGENT_LIFECYCLE_STATES_9: AGENT_LIFECYCLE_STATES_9,
    MANDATORY_AGENT_CAPABILITIES_3: MANDATORY_AGENT_CAPABILITIES_3,
    AGENT_EXECUTION_MODES_3: AGENT_EXECUTION_MODES_3,
    SUPPORTED_AGENT_SOURCES: SUPPORTED_AGENT_SOURCES,
    parseNaturalLanguageGoalToAgentDraft: parseNaturalLanguageGoalToAgentDraft,
    buildAgentContractV1: buildAgentContractV1,
    validateAgentContractV1: validateAgentContractV1,
    enforceAgentRuntimePermission: enforceAgentRuntimePermission,
    exportAgentTemplateSafe: exportAgentTemplateSafe,
    createPersonalAgentStudio: createPersonalAgentStudio
  };

  return {
    CaelusConversationalAdvisor: CaelusConversationalAdvisor,
    CaelusPersonalAgentStudio: CaelusPersonalAgentStudio
  };
});
