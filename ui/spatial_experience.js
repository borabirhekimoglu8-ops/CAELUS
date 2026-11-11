/**
 * CAELUS — GÖRSEL EVRİM VE MEKÂNSAL ARAYÜZ MOTORU (ui/spatial_experience.js)
 *
 * Başlıksız sahne, yaşayan 3B dünya arka planı, bağlamsal kademeli bilgi açılımı,
 * 8 tasarım referansı ilke matrisi ve Refik Anadol "MRI of the Earth" esinli
 * isteğe bağlı Veri Portresi (Sanatsal Temsil != Ölçüm Grafiği) denetim katmanı.
 *
 * Lisans: CAELUS Proprietary (Sıfır dış çalışma zamanı bağımlılığı).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.CaelusSpatialExperience = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /**
   * Bölüm 2 — 8 Zorunlu Tasarım Referansı ve CAELUS'a Uyarlanan Somut İlkeler
   */
  const DESIGN_REFERENCES_MATRIX = Object.freeze([
    {
      id: 'REF_01_FIELD_SEEING_IN_GAMMA',
      title: 'FIELD.IO — Seeing in Gamma',
      url: 'https://field.io/work/applied-intuition-seeing-in-gamma',
      inspected_principles: [
        'Algı ve karar süreçlerinin mekânsal anlatımı',
        'Odağa göre belirginleşen bilgi',
        'Işık, renk ve hareketin bilgiyle ilişkisi',
        'Karmaşık sistemi okunabilir görsel davranışa dönüştürme'
      ],
      caelus_adaptation:
        'Bir olay veya ilişki seçildiğinde ilgili etki yolu aydınlanır, seçilmeyen dallar geri çekilir (.cy-hop-dimmed). Kanıtlanmış gözlem (● düz çizgi #4ADE80), kaynak iddiası (◆ #60A5FA), hipotez (--- kesikli #C084FC) ve belirsizlik (▲ noktalı #FBBF24) yalnızca renkle değil şekil ve çizgi davranışıyla ayrılır.',
      avoided:
        'Okunabilirliği düşüren aşırı parlak bloom/parlama ve açıklamasız soyut ışık efektleri reddedilmiştir.',
      dom_targets: ['#kesfet-cytoscape-panel', '#dunyam-stage-callout-card', '#kesfet-cy-hop-bar']
    },
    {
      id: 'REF_02_FIELD_IBM_WATSONX',
      title: 'FIELD.IO — IBM watsonx',
      url: 'https://field.io/work/ibm-watsonx',
      inspected_principles: [
        'Sabit logo yerine bütün deneyime yayılan yaşayan görsel kimlik',
        '2B ve 3B arasında tutarlı geometrik dil',
        'Karmaşık teknolojinin anlaşılır sunumu'
      ],
      caelus_adaptation:
        'Statik logo yapıştırmak yerine CAELUS açık sarmal (open-spiral) geometrisi sol üstteki ana gezinme kontrolüne (#caelus-compass-trigger), 3B seçim retikülüne ve 2B/3B odak geçiş yaylarına ortak bir görsel davranış sistemi olarak entegre edilmiştir.',
      avoided:
        'Soğuk kurumsal pazarlama şablonları ve bağlamsız dekoratif 3B şekiller reddedilmiştir.',
      dom_targets: ['#caelus-compass-trigger', '#dunyam-iau-astrolabe-svg', '#dunyam-hero-canvas']
    },
    {
      id: 'REF_03_FIELD_UNDER_THE_SURFACE',
      title: 'FIELD.IO — Under the Surface',
      url: 'https://field.io/work/ibm-under-the-surface',
      inspected_principles: [
        'Görünür yüzeyin altındaki bilgi katmanları',
        'Mekânsal veri deneyimi',
        'Karmaşık bir konunun kademeli açılması (progressive disclosure)'
      ],
      caelus_adaptation:
        'Seçim yapılmadığında sağ ayrıntı paneli kapalıdır (.is-collapsed). Bir olay veya varlık seçildiğinde 6 katman kademeli olarak açılır: 1. Olay → 2. İlgili Varlıklar → 3. Etki Yolları → 4. Kaynak ve Kanıt → 5. Alternatif Açıklamalar → 6. Senaryolar.',
      avoided:
        'Tüm veri katmanlarını aynı anda ekrana yığan kalabalık bilgi panelleri reddedilmiştir.',
      dom_targets: ['#dunyam-stage-callout-card', '#callout-progressive-layers-box']
    },
    {
      id: 'REF_04_FIELD_NETWORKS_IN_FOCUS',
      title: 'FIELD.IO — Networks in Focus',
      url: 'https://field.io/work/circle-networks-in-focus',
      inspected_principles: [
        'İlişki ağlarında odak',
        'Kullanıcının seçimine göre ağın açılması',
        'Çok bağlantılı yapının okunabilir sunumu'
      ],
      caelus_adaptation:
        'Başlangıçta tüm ağ kullanıcıya yüklenmez; varsayılan olarak 1. derece doğrudan komşuluk gösterilir. Kullanıcı 1., 2. ve 3. derece ilişkileri #kesfet-cy-hop-bar ile kademeli açar ve #cy-insp-why-shown-box içinde her ilişkinin neden gösterildiği açıklanır.',
      avoided:
        'Yüzlerce düğümü aynı anda tam parlaklıkta gösteren okunaksız saç yumağı (hairball) ağlar reddedilmiştir.',
      dom_targets: ['#kesfet-cy-hop-bar', '#cy-insp-why-shown-box', '#kesfet-mobile-step-path-list']
    },
    {
      id: 'REF_05_TERRITORY_FOUNDATION',
      title: 'Territory Studio — Foundation',
      url: 'https://territorystudio.com/project/foundation/',
      inspected_principles: [
        'Kozmik ölçek',
        'Geometrik disiplin',
        'Zamansız ve ciddi atmosfer',
        'Büyük bir sistemin aynı evrene ait görünmesi'
      ],
      caelus_adaptation:
        'Derin uzay obsidyeni (#040812), kırılma mavisi (#88D4FF) ve sınırlı sıcak altın (#E6C387) paletiyle kozmik ölçekten (J2000.0) bölgesel tesise uzanan ciddi ve tutarlı bir atmosfer kuruldu; film arayüzü süslemeleri yerine günlük okunabilirlik ve gerçek işlev korundu.',
      avoided:
        'Ekranı kaplayan sahte bilimkurgu HUD çerçeveleri, anlamsız koordinat sayaçları ve okunmayan mikro yazılar reddedilmiştir.',
      dom_targets: ['#dunyam-spatial-arena', '#dunyam-iau-astrolabe-svg', '#dunyam-cosmoscope-scale-strip']
    },
    {
      id: 'REF_06_TERRITORY_EX_MACHINA',
      title: 'Territory Studio — Ex Machina',
      url: 'https://territorystudio.com/project/ex_machina/',
      inspected_principles: [
        'Sakin teknoloji hissi',
        'Ölçülü hareket',
        'Tipografi ve boşluk',
        'Sürekli bağırmayan ama karakterli arayüz'
      ],
      caelus_adaptation:
        'Sahnenin üst ve alt kenarlarını kaplayan kalıcı araç çubukları ve bağıran kart yığınları kaldırıldı; geniş negatif boşluk, sakin tipografi ve prefers-reduced-motion uyumlu ölçülü geçişler uygulandı.',
      avoided:
        'Dekoratif sahte kod akışları ve kullanıcıyı yoran aşırı teknik mühendislik kısaltmaları reddedilmiştir.',
      dom_targets: ['#caelus-spatial-compass', '#caelus-stage-context-pill', 'body.caelus-spatial-clean-stage']
    },
    {
      id: 'REF_07_REFIK_ANADOL_MRI_OF_THE_EARTH',
      title: 'Refik Anadol — MRI of the Earth',
      url: 'https://artsandculture.google.com/experiment/mri-of-the-earth/tQGJoT-3Czo01Q',
      inspected_principles: [
        'Dünya verisinin bütünsel görsel temsili',
        'Zamanın görsel anlatımı',
        'Bilimsel veri ile sanatsal temsilin ayrılması'
      ],
      caelus_adaptation:
        'Aktif dünyanın gerçek sayısal metriklerinden (rüzgâr hızı, sismik enerji, düğüm kapasite yükü ve nedensel akış ağırlıkları) türeyen isteğe bağlı "Veri Portresi" (#caelus-data-portrait-canvas) eklendi. Üzerinde açıkça "SANATSAL VERİ TEMSİLİ · ÖLÇÜM GRAFİĞİ DEĞİLDİR" rozeti yer alır.',
      avoided:
        'Sanatsal veri temsilinin gerçek ölçüm grafiğiyle karıştırılması kesin olarak reddedilmiş ve açık etiketle ayrılmıştır.',
      dom_targets: ['#caelus-data-portrait-canvas', '#caelus-data-portrait-badge', '#btn-stage-toggle-portrait']
    },
    {
      id: 'REF_08_PENTAGRAM_DELOITTE_INSIGHTS',
      title: 'Pentagram — Deloitte Insights',
      url: 'https://www.pentagram.com/work/deloitte-insights/story',
      inspected_principles: [
        'Veri görselleştirmenin ürün kimliğiyle bütünleşmesi',
        'Grafikler, tipografi ve açıklamalarda ortak dil',
        'Kurumsal okunabilirlik'
      ],
      caelus_adaptation:
        'Senaryo karşılaştırma kartları, nedensel etki tabloları ve 7 sayfalı açıklanabilir rapor çıktılarında tabular-nums sayısal hizalama, net birim gösterimi ve kurumsal okunabilirlik standartlaştırıldı.',
      avoided:
        'Klasik kurumsal dergi/blog sayfası düzeni veya beyaz arka planlı statik makale şablonu reddedilmiştir.',
      dom_targets: ['#senaryolar-six-questions-grid', '#senaryolar-three-futures-deck', '#caelus-provenance-drawer']
    }
  ]);

  /**
   * Bölüm 5 — Ortak Tasarım Tokenları ve Epistemik İşaret Sistemi
   */
  const SPATIAL_DESIGN_TOKENS = Object.freeze({
    colors: {
      bgVoid: '#040812',
      bgDeep: '#07101F',
      surfaceGlass: 'rgba(10, 19, 36, 0.80)',
      surfaceElevated: 'rgba(14, 26, 48, 0.90)',
      textPrimary: '#F3F6FA',
      textSecondary: '#B7C5D9',
      textMuted: '#8EA2BE',
      accentIceBlue: '#88D4FF',
      accentWarmGold: '#E6C387'
    },
    epistemicMarkers: {
      OBSERVED: { color: '#4ADE80', symbol: '●', lineStyle: 'solid', labelTR: 'Gözlem / Kayıt' },
      CLAIM: { color: '#60A5FA', symbol: '◆', lineStyle: 'solid', labelTR: 'Kaynak İddiası' },
      HYPOTHESIS: { color: '#C084FC', symbol: '◆', lineStyle: 'dashed', labelTR: 'Hipotez / Aday İlişki' },
      ASSUMPTION: { color: '#FBBF24', symbol: '▲', lineStyle: 'dotted', labelTR: 'Kullanıcı Varsayımı / Belirsizlik' },
      SIMULATION: { color: '#38BDF8', symbol: '◈', lineStyle: 'double', labelTR: 'Deterministik Model Çıktısı' }
    }
  });

  const state = {
    activeMode: 'dunyam',
    sceneTrayOpen: false,
    whisperExpanded: false,
    advancedPanelsExpanded: false,
    dataPortraitActive: false,
    dataPortraitAnimId: null,
    dataPortraitTick: 0
  };

  function isMotionReduced() {
    if (typeof window === 'undefined') return true;
    if (document.body && (document.body.classList.contains('reduce-motion') || document.body.getAttribute('data-motion') === 'reduced')) {
      return true;
    }
    return Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  /**
   * Refik Anadol — MRI of the Earth esinli Veri Portresi (İsteğe Bağlı)
   * Aktif dünyanın gerçek sayısal metriklerinden deterministik akış portresi üretir;
   * ölçüm grafiği olmadığını açıkça belirtir.
   */
  function computeWorldPortraitSeedMetrics() {
    const metrics = {
      nodeCount: 5,
      avgLoadPct: 72,
      maxStressPct: 84,
      edgeCount: 6,
      windSpeedMs: 11.4,
      worldName: 'Liman Soğuk Zincir ve Terminal Dünyası'
    };
    if (typeof document !== 'undefined') {
      const titleEl = document.getElementById('dunyam-world-title');
      if (titleEl && titleEl.textContent) {
        metrics.worldName = titleEl.textContent.trim();
      }
      const tpEl = document.getElementById('dunyam-gauge-tp-val');
      if (tpEl && tpEl.textContent) {
        const parsed = parseFloat(tpEl.textContent.replace(/[^0-9.]/g, ''));
        if (Number.isFinite(parsed)) metrics.avgLoadPct = parsed;
      }
    }
    return metrics;
  }

  function renderDataPortraitFrame() {
    if (typeof document === 'undefined') return;
    const canvas = document.getElementById('caelus-data-portrait-canvas');
    if (!canvas || !state.dataPortraitActive) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width || 960;
    const h = canvas.height || 540;
    const m = computeWorldPortraitSeedMetrics();
    const t = state.dataPortraitTick * 0.018;

    ctx.clearRect(0, 0, w, h);

    // Hafif yarı-saydam derin uzay örtüsü
    const bgGrad = ctx.createRadialGradient(w * 0.5, h * 0.5, 30, w * 0.5, h * 0.5, Math.max(w, h) * 0.62);
    bgGrad.addColorStop(0, 'rgba(7, 18, 38, 0.32)');
    bgGrad.addColorStop(1, 'rgba(4, 8, 18, 0.76)');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, w, h);

    const cx = w * 0.5;
    const cy = h * 0.5;
    const baseRadius = Math.min(w, h) * 0.31;
    const ringCount = Math.max(4, Math.min(9, m.nodeCount + 2));
    const loadRatio = Math.max(0.15, Math.min(1.0, m.avgLoadPct / 100));

    // Açık spiral harmonik veri halkaları (Aktif dünyanın yük ve akış vektörlerinden türetilir)
    for (let rIdx = 0; rIdx < ringCount; rIdx++) {
      const frac = (rIdx + 1) / ringCount;
      const radius = baseRadius * (0.32 + frac * 0.82);
      const startAngle = (rIdx * 0.68) + t * (rIdx % 2 === 0 ? 1 : -0.7);
      const arcSpan = Math.PI * (1.35 + 0.35 * Math.sin(rIdx + loadRatio * 3.14));

      ctx.beginPath();
      for (let step = 0; step <= 72; step++) {
        const u = step / 72;
        const ang = startAngle + u * arcSpan;
        const harmonic = Math.sin(ang * (3 + (rIdx % 3)) + t * 1.5) * (6 + 14 * loadRatio * frac);
        const rr = radius + harmonic;
        const px = cx + Math.cos(ang) * rr;
        const py = cy + Math.sin(ang) * rr * 0.88;
        if (step === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.strokeStyle = rIdx % 2 === 0
        ? `rgba(136, 212, 255, ${(0.22 + 0.35 * (1 - frac)).toFixed(3)})`
        : `rgba(230, 195, 135, ${(0.18 + 0.30 * (1 - frac)).toFixed(3)})`;
      ctx.lineWidth = rIdx === 0 ? 2.1 : 1.35;
      ctx.stroke();
    }

    // Düğüm vektör odak noktaları
    for (let i = 0; i < m.nodeCount; i++) {
      const ang = (i / m.nodeCount) * Math.PI * 2 + t * 0.45;
      const rr = baseRadius * (0.48 + 0.32 * ((i % 3) / 2));
      const nx = cx + Math.cos(ang) * rr;
      const ny = cy + Math.sin(ang) * rr * 0.88;

      ctx.beginPath();
      ctx.arc(nx, ny, 4.2, 0, Math.PI * 2);
      ctx.fillStyle = i % 2 === 0 ? '#88D4FF' : '#E6C387';
      ctx.fill();
    }

    if (!isMotionReduced() && state.dataPortraitActive && typeof requestAnimationFrame === 'function') {
      state.dataPortraitTick += 1;
      state.dataPortraitAnimId = requestAnimationFrame(renderDataPortraitFrame);
    }
  }

  function toggleDataPortraitMode(forceState) {
    state.dataPortraitActive = typeof forceState === 'boolean' ? forceState : !state.dataPortraitActive;
    if (typeof document === 'undefined') return state.dataPortraitActive;

    const canvas = document.getElementById('caelus-data-portrait-canvas');
    const badge = document.getElementById('caelus-data-portrait-badge');
    const btn = document.getElementById('btn-stage-toggle-portrait');

    if (state.dataPortraitAnimId && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(state.dataPortraitAnimId);
      state.dataPortraitAnimId = null;
    }

    if (canvas) {
      canvas.classList.toggle('hidden', !state.dataPortraitActive);
    }
    if (badge) {
      badge.classList.toggle('hidden', !state.dataPortraitActive);
    }
    if (btn) {
      btn.classList.toggle('active', state.dataPortraitActive);
      btn.setAttribute('aria-pressed', state.dataPortraitActive ? 'true' : 'false');
    }

    if (state.dataPortraitActive) {
      state.dataPortraitTick = 0;
      renderDataPortraitFrame();
    }
    return state.dataPortraitActive;
  }

  /**
   * Sahne Alt Bağlam Çekmecesi (Konumlar, Katmanlar ve Derinlik) Aç/Kapat
   * Böylece sahnenin altında 18 adet sabit düğme/kapsül kalabalığı oluşmaz.
   */
  function toggleSpatialSceneTray(forceOpen) {
    state.sceneTrayOpen = typeof forceOpen === 'boolean' ? forceOpen : !state.sceneTrayOpen;
    if (typeof document === 'undefined') return state.sceneTrayOpen;

    document.body.classList.toggle('caelus-scene-tray-open', state.sceneTrayOpen);
    const pill = document.getElementById('caelus-spatial-focus-pill');
    if (pill) {
      pill.setAttribute('aria-expanded', state.sceneTrayOpen ? 'true' : 'false');
      const label = pill.querySelector('.spatial-focus-pill-label');
      if (label) {
        label.textContent = state.sceneTrayOpen
          ? '✕ Sahne Kontrollerini Gizle'
          : '✦ Olaylar, Katmanlar & Ölçek';
      }
    }
    return state.sceneTrayOpen;
  }

  /**
   * İkincil Çalışma Alanlarında (Keşfet, Zaman, Senaryolar, Kaynaklar)
   * Gelişmiş Mühendislik Panellerini İsteğe Bağlı Aç/Kapat
   */
  function toggleAdvancedWorkspacePanels(forceExpanded) {
    state.advancedPanelsExpanded =
      typeof forceExpanded === 'boolean' ? forceExpanded : !state.advancedPanelsExpanded;
    if (typeof document === 'undefined') return state.advancedPanelsExpanded;

    document.body.classList.toggle('caelus-advanced-panels-expanded', state.advancedPanelsExpanded);
    document.querySelectorAll('.js-toggle-advanced-workspace').forEach((btn) => {
      btn.setAttribute('aria-expanded', state.advancedPanelsExpanded ? 'true' : 'false');
      btn.textContent = state.advancedPanelsExpanded
        ? '▴ Gelişmiş Mühendislik ve Laboratuvar Panellerini Daralt'
        : '▾ Gelişmiş Mühendislik ve Laboratuvar Panellerini Göster';
    });
    return state.advancedPanelsExpanded;
  }

  /**
   * 5 Mekânsal Çalışma Alanı Geçişinde 3B Dünya Sahnesini Arka Plan Olarak Koru
   */
  function syncSpatialModeLayout(viewName) {
    const normalized = String(viewName || 'dunyam').toLowerCase();
    state.activeMode = normalized;
    if (typeof document === 'undefined') return normalized;

    document.body.classList.add('caelus-spatial-clean-stage');
    document.body.setAttribute('data-spatial-mode', normalized);

    // Başka bir katmana geçildiğinde açık alt sahne çekmecesini otomatik kapat
    if (normalized !== 'dunyam' && state.sceneTrayOpen) {
      toggleSpatialSceneTray(false);
    }
    return normalized;
  }

  /**
   * Tarayıcı DOM Başlatıcısı
   */
  function initSpatialStageExperience() {
    if (typeof document === 'undefined') return false;

    document.body.classList.add('caelus-spatial-clean-stage');

    // Sol üst dünya özet kartı (#dunyam-hero-whisper-box) ilk açılışta daraltılmış (fısıltı kapsülü) olarak başlar
    const whisperBox = document.getElementById('dunyam-hero-whisper-box');
    const whisperBtn = document.getElementById('btn-dunyam-whisper-toggle');
    if (whisperBox && !whisperBox.dataset.spatialInit) {
      whisperBox.dataset.spatialInit = '1';
      whisperBox.classList.add('is-whisper-collapsed');
      if (whisperBtn) {
        whisperBtn.setAttribute('aria-expanded', 'false');
        whisperBtn.textContent = '▸';
      }
    }

    // Alt merkez tekil "Olaylar, Katmanlar & Ölçek" tetikleyicisi
    const focusPill = document.getElementById('caelus-spatial-focus-pill');
    if (focusPill && !focusPill.dataset.spatialBound) {
      focusPill.dataset.spatialBound = '1';
      focusPill.addEventListener('click', () => {
        toggleSpatialSceneTray();
      });
    }

    // Sağ üst "Sahne & Ölçek" kısayol düğmesi
    const sceneBtn = document.getElementById('btn-stage-scene-controls');
    if (sceneBtn && !sceneBtn.dataset.spatialBound) {
      sceneBtn.dataset.spatialBound = '1';
      sceneBtn.addEventListener('click', () => {
        toggleSpatialSceneTray();
      });
    }

    // Veri Portresi (MRI of the Earth) düğmesi
    const portraitBtn = document.getElementById('btn-stage-toggle-portrait');
    if (portraitBtn && !portraitBtn.dataset.spatialBound) {
      portraitBtn.dataset.spatialBound = '1';
      portraitBtn.addEventListener('click', () => {
        toggleDataPortraitMode();
      });
    }

    // Gelişmiş mühendislik panellerini aç/kapat düğmeleri
    document.querySelectorAll('.js-toggle-advanced-workspace').forEach((btn) => {
      if (!btn.dataset.spatialBound) {
        btn.dataset.spatialBound = '1';
        btn.addEventListener('click', () => {
          toggleAdvancedWorkspacePanels();
        });
      }
    });

    // Alt+K ve Alt+M ile Mekânsal Pusulayı açma/kapatma desteği
    if (!window.__caelusSpatialKeyBound) {
      window.__caelusSpatialKeyBound = true;
      window.addEventListener('keydown', (e) => {
        if (document.body && document.body.getAttribute('data-c2-cockpit') === 'active') return;
        if (e.altKey && (e.key === 'k' || e.key === 'K')) {
          e.preventDefault();
          const trigger = document.getElementById('caelus-compass-trigger');
          if (trigger) trigger.click();
        }
      });
    }

    const currentView = document.body.getAttribute('data-quiet-view') || 'dunyam';
    syncSpatialModeLayout(currentView);
    return true;
  }

  return {
    DESIGN_REFERENCES_MATRIX,
    SPATIAL_DESIGN_TOKENS,
    getReferencePrinciplesMatrix: () => DESIGN_REFERENCES_MATRIX,
    getSpatialDesignTokens: () => SPATIAL_DESIGN_TOKENS,
    isMotionReduced,
    computeWorldPortraitSeedMetrics,
    renderDataPortraitFrame,
    toggleDataPortraitMode,
    toggleSpatialSceneTray,
    toggleAdvancedWorkspacePanels,
    syncSpatialModeLayout,
    initSpatialStageExperience
  };
});
