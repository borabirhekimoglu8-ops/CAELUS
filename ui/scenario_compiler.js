/**
 * CAELUS Universal Scenario Compiler
 *
 * Serbest metni, herhangi bir ağ/LLM çağrısı yapmadan, deterministik bir
 * ScenarioPack'e dönüştürür. Aynı metin her cihazda aynı kimliği, grafı,
 * başlangıç durumunu ve kaldıraçları üretir; hesaplama yine gerçek WASM
 * caelus_core tarafından yürütülür.
 */
(function attachScenarioCompiler(root) {
  'use strict';

  const STOP_WORDS = new Set([
    'acaba','ama','ancak','artik','bana','bazı','bazi','ben','bence','bile','bir','biri','biz','bu','buna','bunu',
    'cok','daha','de','da','diye','en','fakat','gibi','icin','ile','ise','ki','mi','mu','mı','mü','nasil','neden',
    'ne','olarak','olan','oldu','olur','sanki','sey','sonra','su','şu','ve','veya','ya','yani','yaz','yazdim',
    'the','a','an','and','or','but','for','from','in','into','of','on','to','with','what','when','where','why','how',
    'is','are','be','will','would','should','could','this','that','these','those','my','our','your','their','scenario',
    'senaryo','analiz','et','olursa','oldugunda','hakkinda','ilgili','uzerine','nedeniyle','sonucu','durumunda'
  ]);

  const RISK_WORDS = [
    'kriz','risk','savas','saldiri','cokus','iflas','yangin','deprem','firtina','iptal','gecikme','kapanma','kesinti',
    'ambargo','abluka','grev','salgın','salgin','hack','siber','ariza','kayip','kıtlık','kitlik','tehdit','acil',
    'crisis','war','attack','collapse','bankruptcy','outage','delay','strike','shortage','threat','emergency'
  ];

  const PROFILES = [
    {
      id:'MARITIME_LOGISTICS', label:'DENİZCİLİK / LİMAN',
      keywords:['liman','gemi','feribot','ferry','sefer','yolcu','konteyner','kargo','rihtim','iskele','deniz','port','ship','vessel','customs','gumruk'],
      roles:[
        ['OPERASYON','Operasyon akışı','Service'], ['TRAFIK','Trafik ve talep','Queue'],
        ['KAPASITE','Liman kapasitesi','Buffer'], ['MEVZUAT','Gümrük / mevzuat kapısı','Gate'],
        ['AKTOR','Dış aktör baskısı','Adversary'], ['KRITIK_YUK','Zaman kritik yük','Perishable']
      ],
      levers:['Kapasiteyi yeniden dağıt','Trafiği önceliklendir','Ortak doğrulama masası kur','Kritik yükü korumaya al']
    },
    {
      id:'AVIATION', label:'HAVACILIK',
      keywords:['ucak','ucus','havayolu','havalimani','pist','slot','airport','airline','flight','aviation'],
      roles:[
        ['OPERASYON','Uçuş operasyonu','Service'], ['TRAFIK','Slot ve trafik kuyruğu','Queue'],
        ['KAPASITE','Filo / pist kapasitesi','Buffer'], ['MEVZUAT','Emniyet ve otorite kapısı','Gate'],
        ['AKTOR','Dış operasyon baskısı','Adversary'], ['KRITIK_YUK','Zaman kritik bağlantı','Perishable']
      ],
      levers:['Kapasiteyi yeniden planla','Slot önceliği uygula','Otoriteyle ortak karar kur','Kritik bağlantıyı koru']
    },
    {
      id:'SUPPLY_CHAIN', label:'TEDARİK / ÜRETİM',
      keywords:['tedarik','lojistik','depo','stok','fabrika','uretim','üretim','sevkiyat','supplier','supply','warehouse','inventory','factory','shipment'],
      roles:[
        ['OPERASYON','Üretim akışı','Service'], ['TRAFIK','Sipariş kuyruğu','Queue'],
        ['KAPASITE','Stok tamponu','Buffer'], ['MEVZUAT','Tedarik kapısı','Gate'],
        ['AKTOR','Tedarikçi baskısı','Adversary'], ['KRITIK_YUK','Bozulabilir / kritik stok','Perishable']
      ],
      levers:['Kapasiteyi dengele','Öncelik sırası kur','Alternatif tedarik aç','Kritik stoğu koru']
    },
    {
      id:'FINANCE', label:'FİNANS / PİYASA',
      keywords:['banka','faiz','kur','doviz','döviz','enflasyon','borsa','likidite','kredi','yatirim','finance','bank','market','currency','inflation','liquidity'],
      roles:[
        ['OPERASYON','Finansal akış','Service'], ['TRAFIK','Talep / işlem kuyruğu','Queue'],
        ['KAPASITE','Likidite tamponu','Buffer'], ['MEVZUAT','Düzenleyici kapı','Gate'],
        ['AKTOR','Piyasa aktörü baskısı','Adversary'], ['KRITIK_YUK','Vade kritik yükümlülük','Perishable']
      ],
      levers:['Likiditeyi yeniden dağıt','İşlem önceliği koy','Düzenleyici güven hattı aç','Vade riskini korumaya al']
    },
    {
      id:'CYBER_TECH', label:'SİBER / TEKNOLOJİ',
      keywords:['siber','hack','sunucu','veri','yazilim','yazılım','api','ag','ağ','ransomware','server','data','software','network','cyber','database'],
      roles:[
        ['OPERASYON','Servis sürekliliği','Service'], ['TRAFIK','İstek / olay kuyruğu','Queue'],
        ['KAPASITE','Yedek kapasite','Buffer'], ['MEVZUAT','Kimlik ve güvenlik kapısı','Gate'],
        ['AKTOR','Tehdit aktörü','Adversary'], ['KRITIK_YUK','Kritik veri penceresi','Perishable']
      ],
      levers:['Yedek kapasiteye geçir','Olayları önceliklendir','Güven zincirini yenile','Kritik veriyi izole et']
    },
    {
      id:'HEALTH', label:'SAĞLIK',
      keywords:['hastane','hasta','ilac','ilaç','saglik','sağlık','salgın','doktor','ambulans','hospital','patient','medicine','health','epidemic'],
      roles:[
        ['OPERASYON','Klinik hizmet akışı','Service'], ['TRAFIK','Hasta kuyruğu','Queue'],
        ['KAPASITE','Yatak / malzeme tamponu','Buffer'], ['MEVZUAT','Klinik güvenlik kapısı','Gate'],
        ['AKTOR','Dış sağlık baskısı','Adversary'], ['KRITIK_YUK','Zaman kritik hasta / ilaç','Perishable']
      ],
      levers:['Kapasiteyi yeniden dağıt','Triyajı güçlendir','Ortak klinik karar kur','Kritik vakayı koru']
    },
    {
      id:'ENERGY', label:'ENERJİ / ALTYAPI',
      keywords:['enerji','elektrik','petrol','dogalgaz','doğalgaz','gaz','sebeke','şebeke','santral','energy','power','oil','grid','plant'],
      roles:[
        ['OPERASYON','Enerji arz akışı','Service'], ['TRAFIK','Talep yükü','Queue'],
        ['KAPASITE','Rezerv kapasite','Buffer'], ['MEVZUAT','Şebeke güvenlik kapısı','Gate'],
        ['AKTOR','Dış arz baskısı','Adversary'], ['KRITIK_YUK','Kesinti kritik altyapı','Perishable']
      ],
      levers:['Rezervi devreye al','Talebi önceliklendir','Şebeke adalarını ayır','Kritik altyapıyı koru']
    },
    {
      id:'SPACE', label:'UZAY / YÜKSEK TEKNOLOJİ',
      keywords:['uzay','uydu','roket','yorunge','yörünge','mars','astronot','space','satellite','rocket','orbit','mission'],
      roles:[
        ['OPERASYON','Görev akışı','Service'], ['TRAFIK','Komut / görev kuyruğu','Queue'],
        ['KAPASITE','Enerji ve itki tamponu','Buffer'], ['MEVZUAT','Görev emniyet kapısı','Gate'],
        ['AKTOR','Yörünge / dış tehdit','Adversary'], ['KRITIK_YUK','Fırlatma / temas penceresi','Perishable']
      ],
      levers:['Görev kaynaklarını yeniden dağıt','Komutları önceliklendir','Emniyet moduna geç','Kritik pencereyi koru']
    },
    {
      id:'PUBLIC_SECURITY', label:'KAMU / JEOPOLİTİK',
      keywords:['devlet','savas','savaş','secim','seçim','bakanlik','bakanlık','ulke','ülke','sinir','sınır','diplomasi','ordu','guvenlik','güvenlik','government','war','election','border','diplomacy','security'],
      roles:[
        ['OPERASYON','Stratejik hedef akışı','Service'], ['TRAFIK','Toplumsal / operasyonel baskı','Queue'],
        ['KAPASITE','Kurumsal kapasite tamponu','Buffer'], ['MEVZUAT','Hukuki / siyasi karar kapısı','Gate'],
        ['AKTOR','Rakip aktör baskısı','Adversary'], ['KRITIK_YUK','Zaman kritik insani yük','Perishable']
      ],
      levers:['Kaynakları ana hedefe yoğunlaştır','Baskıyı kademelendir','Doğrulanmış ortak kanal aç','İnsani eşiği koru']
    },
    {
      id:'BUSINESS', label:'İŞ / KURUMSAL',
      keywords:['sirket','şirket','musteri','müşteri','satis','satış','pazar','birlesme','birleşme','operasyon','gelir','company','customer','sales','business','revenue','merger'],
      roles:[
        ['OPERASYON','Ana iş akışı','Service'], ['TRAFIK','Müşteri / iş kuyruğu','Queue'],
        ['KAPASITE','Kaynak tamponu','Buffer'], ['MEVZUAT','Yönetişim kapısı','Gate'],
        ['AKTOR','Rakip / paydaş baskısı','Adversary'], ['KRITIK_YUK','Zaman kritik taahhüt','Perishable']
      ],
      levers:['Kaynağı yeniden dağıt','İş kuyruğunu önceliklendir','Paydaş mutabakatı kur','Kritik taahhüdü koru']
    },
    {
      id:'UNIVERSAL', label:'EVRENSEL', keywords:[],
      roles:[
        ['OPERASYON','Ana sonuç akışı','Service'], ['TRAFIK','Talep ve baskı kuyruğu','Queue'],
        ['KAPASITE','Kaynak tamponu','Buffer'], ['MEVZUAT','Karar / kısıt kapısı','Gate'],
        ['AKTOR','Dış aktör baskısı','Adversary'], ['KRITIK_YUK','Zaman kritik unsur','Perishable']
      ],
      levers:['Kaynağı ana sonuca yönlendir','Darboğazı önceliklendir','Güven ve doğrulama hattı kur','Zaman kritik unsuru koru']
    }
  ];

  function fold(value) {
    return String(value || '')
      .replace(/İ/g, 'I').replace(/ı/g, 'i')
      .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  function hash32(value) {
    const bytes = new TextEncoder().encode(String(value || ''));
    let h = 0x811c9dc5;
    for (const byte of bytes) {
      h ^= byte;
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
  }

  function hex32(value) {
    return (value >>> 0).toString(16).toUpperCase().padStart(8, '0');
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function slug(value, fallback) {
    const out = fold(value).replace(/\s+/g, '_').replace(/^_+|_+$/g, '').slice(0, 22).toUpperCase();
    return out || fallback;
  }

  function titleCase(value) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    if (!text) return '';
    return text.charAt(0).toLocaleUpperCase('tr-TR') + text.slice(1);
  }

  function extractConcepts(text) {
    const words = String(text || '').match(/[A-Za-z0-9À-žĞğÜüŞşİıÖöÇç]+/g) || [];
    const seen = new Set();
    const concepts = [];
    for (const word of words) {
      const key = fold(word);
      if (key.length < 3 || STOP_WORDS.has(key) || seen.has(key) || /^\d+$/.test(key)) continue;
      seen.add(key);
      concepts.push({ key, label:titleCase(word).slice(0, 28) });
      if (concepts.length === 6) break;
    }
    return concepts;
  }

  function selectProfile(normalized) {
    let selected = PROFILES[PROFILES.length - 1];
    let best = 0;
    for (const profile of PROFILES.slice(0, -1)) {
      let score = 0;
      const seenKeywords = new Set();
      for (const keyword of profile.keywords) {
        const needle = fold(keyword);
        if (!needle || seenKeywords.has(needle)) continue;
        seenKeywords.add(needle);
        if (needle && (` ${normalized} `).includes(` ${needle} `)) score += 3;
        else if (needle && normalized.includes(needle)) score += 2;
      }
      if (score > best) {
        best = score;
        selected = profile;
      }
    }
    return selected;
  }

  function makeNode(id, label, kind, state, weight, options) {
    const opts = options || {};
    return {
      id,
      label,
      kind,
      capacity_fp: 1000000,
      state_fp: state,
      weight_fp: weight,
      reported_state_fp: opts.reportedState ?? state,
      trust_fp: opts.trust ?? 1000000,
      deadline_tick: opts.deadline ?? -1,
      irrecoverable: false,
      notes: opts.notes || label
    };
  }

  function compile(text) {
    const sourceText = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 400);
    if (sourceText.length < 4) throw new Error('Senaryo için en az 4 karakterlik bir durum yazın.');

    const normalized = fold(sourceText);
    const fingerprint = hex32(hash32(normalized));
    const profile = selectProfile(normalized);
    let concepts = extractConcepts(sourceText);
    if (!concepts.length) concepts = [{ key:'hedef', label:'Ana hedef' }];

    const riskHits = RISK_WORDS.reduce((n, word) => n + (normalized.includes(fold(word)) ? 1 : 0), 0);
    const severity = clamp(0.48 + riskHits * 0.07 + ((hash32(normalized + ':severity') % 19) / 100), 0.48, 0.91);
    const scenarioId = `USR-${profile.id}-${fingerprint}`;
    const excerpt = sourceText.length > 150 ? `${sourceText.slice(0, 147)}…` : sourceText;
    const title = `Evrensel Senaryo — ${excerpt}`;

    const baseStates = [0.54, 0.68, 0.44, 0.57, 0.51, 0.63];
    const weights = [280000, 320000, 220000, 300000, 240000, 190000];
    const nodes = profile.roles.map((role, index) => {
      const concept = concepts[index % concepts.length];
      const jitter = ((hash32(`${normalized}:node:${index}`) % 120001) - 60000) / 1000000;
      const state = clamp(baseStates[index] + severity * 0.18 + jitter, 0.20, 0.94);
      const id = `${slug(concept.key, `KAVRAM${index + 1}`)}_${role[0]}`;
      const label = `${concept.label} · ${role[1]}`;
      const hidden = index === 4 || (index === 3 && riskHits > 1);
      return makeNode(id, label, role[2], Math.round(state * 1000000), weights[index], {
        reportedState: hidden ? Math.round(clamp(state - 0.24, 0.08, 0.90) * 1000000) : Math.round(state * 1000000),
        trust: hidden ? 720000 : 1000000,
        deadline: index === 5 ? 144 : -1,
        notes: `${role[1]} | Girdi: ${excerpt}`
      });
    });

    const ids = nodes.map(node => node.id);
    const edges = [
      { from:ids[1], to:ids[0], multiplier_fp:1250000, lag_ticks:1, active:true },
      { from:ids[2], to:ids[0], multiplier_fp:650000, lag_ticks:0, active:true },
      { from:ids[3], to:ids[0], multiplier_fp:1100000, lag_ticks:2, active:true },
      { from:ids[4], to:ids[3], multiplier_fp:820000, lag_ticks:1, active:true },
      { from:ids[5], to:ids[0], multiplier_fp:900000, lag_ticks:0, active:true },
      { from:ids[0], to:'', multiplier_fp:280000, lag_ticks:0, active:true },
      { from:ids[1], to:'', multiplier_fp:350000, lag_ticks:0, active:true },
      { from:ids[3], to:'', multiplier_fp:300000, lag_ticks:0, active:true },
      { from:ids[4], to:'', multiplier_fp:200000, lag_ticks:0, active:true },
      { from:ids[5], to:'', multiplier_fp:180000, lag_ticks:0, active:true }
    ];

    const targetIndexes = [2, 1, 3, 5];
    const levers = profile.levers.map((label, index) => {
      const targetIndex = targetIndexes[index];
      const code = slug(label, `KALDIRAC${index + 1}`).slice(0, 26);
      return {
        id:`L-0${index + 1}_${code}`,
        label,
        target:nodes[targetIndex].label,
        success_p_fp:[820000, 760000, 700000, 880000][index],
        cost_ticks:[4, 6, 8, 3][index],
        lockout_ticks:[12, 18, 24, 8][index],
        on_success:{
          target_node_id:ids[targetIndex],
          state_delta_fp:[-180000, -240000, -210000, -300000][index],
          trust_delta_fp:index === 2 ? 220000 : 0,
          friction_delta_fp:[-80000, -110000, -90000, -130000][index],
          clear_irrecoverable:index === 3
        },
        on_failure:{
          target_node_id:ids[targetIndex],
          state_delta_fp:[30000, 50000, 40000, 60000][index],
          trust_delta_fp:index === 2 ? -50000 : 0,
          friction_delta_fp:30000,
          clear_irrecoverable:false
        },
        notes:`${label} — ${excerpt}`
      };
    });

    const labels = {
      node:nodes[0].label,
      edge:nodes[1].label,
      actor:nodes[4].label,
      regulatory_gate:nodes[3].label,
      friction:`${concepts[0].label} baskısı`
    };

    const pack = {
      schema_version:'2.0',
      id:scenarioId,
      blackswan_class:'user_defined_universal',
      sector:profile.id,
      labels,
      min_caelus_engine:'2.0',
      meta:{
        title,
        region:'USER_DEFINED',
        tick_minutes:15,
        horizon_hours:72,
        synopsis:sourceText,
        generated_by:'CAELUS_DETERMINISTIC_SCENARIO_COMPILER',
        compiler_fingerprint:fingerprint,
        severity:Number(severity.toFixed(2))
      },
      extended_causal_model:{
        nodes,
        edges,
        feedback_loops:[{
          id:`FL-${fingerprint}-BASKI`,
          path:[ids[1], ids[4], ids[3]],
          gain_fp:1120000 + Math.round(severity * 120000)
        }],
        levers,
        hysteresis:[
          { id:`HYST-${fingerprint}-ESIK`, threshold_tick:48, reversible:true, permanent_loss_fp:0 },
          { id:`HYST-${fingerprint}-KALICI`, threshold_tick:96, reversible:false, permanent_loss_fp:180000 }
        ],
        hard_deadlines:[{
          node_id:ids[5], at_tick:144, label:`${ids[5]}_DEADLINE`,
          notes:'Kullanıcı senaryosundan türetilen zaman kritik eşik.'
        }]
      }
    };

    return {
      pack,
      analysis:{
        sourceText,
        fingerprint,
        scenarioId,
        sector:profile.id,
        sectorLabel:profile.label,
        title,
        synopsis:`${profile.label} bağlamında ${concepts.map(item => item.label).join(', ')} kavramları arasında nedensel model kuruldu.`,
        concepts:concepts.map(item => item.label),
        severity:Number(severity.toFixed(2)),
        nodeLabels:Object.fromEntries(nodes.map(node => [node.id, node.label])),
        leverNarratives:levers.map(lever => `${lever.label}: ${lever.target}`)
      }
    };
  }

  root.CaelusScenarioCompiler = Object.freeze({ compile, fold, hash32, profiles:PROFILES.map(p => ({ id:p.id, label:p.label })) });
})(typeof window !== 'undefined' ? window : globalThis);
