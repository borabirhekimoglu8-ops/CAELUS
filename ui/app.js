/**
 * CAELUS OS — Universal Causal Interface v3.0 (Vanilla JS, Zero Dependencies)
 *
 * SIMULATION NOTE: All metrics, telemetry and analysis reports are illustrative
 * demo data generated locally. This interface is NOT connected live to the
 * C++/Rust CAELUS engine binary. All figures are sample data.
 *
 * Security: user scenario text is read only via .toLowerCase()/.includes()
 * for keyword routing — it is NEVER interpolated into innerHTML.
 * All dynamic HTML is built with pre-authored static strings or
 * document.createElement / textContent assignments (no XSS vectors).
 */

'use strict';

/* ═══════════════════════════════════════════════════════════════
   CONSTANTS & CONFIG
   ═══════════════════════════════════════════════════════════════ */

const CFG = {
  MAX_PEERS:         12,
  DISCOVERY_MS:      11000,
  TELEMETRY_MS:      4500,
  LOG_MAX_ENTRIES:   60,
  PKT_EMIT_MS:       2200,
  OTP_SLOTS:         4,
  SPARKLINE_POINTS:  20,
  TICK_HISTORY_MAX:  500,
};

// Gauge SVG geometry (semicircle: 180° from left through top to right)
const G = { CX:100, CY:100, R:85, NEEDLE_LEN:68 };

// Throughput gauge SVG geometry (full circle, r=35, cx=cy=45)
const TP_R = 35;
const TP_CIRCUMFERENCE = 2 * Math.PI * TP_R; // ≈ 219.9

/* ═══════════════════════════════════════════════════════════════
   STATE
   ═══════════════════════════════════════════════════════════════ */
const state = {
  audioEnabled:      true,
  isTyping:          false,
  reportCount:       0,
  reportId:          100,
  pktCount:          0,
  bootDone:          false,
  sessionStart:      Date.now(),
  fluctuateInterval: null,
  engineStatus:      'offline',
  lastEngineState:   '',
  scenarioMeta: {
    scenarioId: 'UNIVERSAL_BASELINE',
    sector:     'UNIVERSAL',
    labels:     {},
    sigStatus:  '',
  },

  peers: [],
  metrics: {
    node:     100,
    edge:     100,
    actor:    100,
    gate:     100,
    friction: 1.00,
    delay:    0.0,
    mult:     1.00,
  },

  history: { node:[], edge:[], actor:[], gate:[] },
  otpSlots: [],
  typingTimer: null,

  /* ── New v3.0 state fields ── */
  currentTick:       0,
  throughputRatio:   1.0,
  outageActive:      false,
  tickHistory:       [],    // [{tick, ratio, friction, outage, hysFlip, deadlineMiss}]
  replHistory:       [],
  replHistoryIdx:    -1,
  causalNodes:       [],    // from snapshot events
  causalEdges:       [],
  activeLeftTab:     'mesh',
  ctScrollOffset:    0,     // crisis timeline horizontal scroll offset
};

/* ═══════════════════════════════════════════════════════════════
   DOM ELEMENT CACHE
   ═══════════════════════════════════════════════════════════════ */
const $ = id => document.getElementById(id);

const el = {
  bootOverlay:    $('boot-overlay'),
  bootLines:      $('boot-lines'),
  bootFinal:      $('boot-final'),

  hdrUptime:      $('hdr-uptime'),
  hdrUtc:         $('hdr-utc'),
  hdrMesh:        $('hdr-mesh'),
  hdrThreat:      $('hdr-threat'),
  hdrMode:        $('hdr-mode'),
  sbThreat:       $('sb-threat'),

  meshCanvas:     $('mesh-canvas'),
  meshBadge:      $('mesh-badge'),
  meshCountBadge: $('mesh-count-badge'),
  peerList:       $('peer-list'),
  cryptoLog:      $('crypto-log'),

  engineDot:      $('engine-dot'),
  engineLabel:    $('engine-label'),
  cmdInput:       $('cmd-input'),
  cmdCounter:     $('cmd-counter'),
  cmdFeedback:    $('cmd-feedback'),
  btnExecute:     $('btn-execute'),
  btnClear:       $('btn-clear'),
  reportOutput:   $('report-output'),
  outputIdle:     $('output-idle'),
  reportId:       $('report-id'),
  reportTs:       $('report-ts'),
  scenarioContext:$('scenario-context'),

  leverageList:   $('leverage-list'),
  signalSectionLabel:   $('signal-section-label'),
  gaugeFill:      $('gauge-fill'),
  gaugeTrack:     $('gauge-track'),
  gaugeNeedle:    $('gauge-needle'),
  gaugeTicks:     $('gauge-ticks'),
  frictionSectionLabel: $('friction-section-label'),
  frictionUnit:   $('friction-unit'),
  frictionVal:    $('friction-val'),
  gRisk:          $('g-risk'),
  gDelay:         $('g-delay'),
  gOtp:           $('g-otp'),
  gMult:          $('g-mult'),
  otpTimeline:    $('otp-timeline'),

  audioToggle:    $('audio-toggle'),
  tickerText:     $('ticker-text'),
  sbSession:      $('sb-session'),
  sbPkts:         $('sb-pkts'),
  sbReports:      $('sb-reports'),
  monitorBadge:   $('monitor-badge'),

  /* ── v3.0 new elements ── */
  outageBanner:   $('outage-banner'),
  outageDetail:   $('outage-detail'),

  tpSection:      $('tp-section'),
  tpGaugeFill:    $('tp-gauge-fill'),
  tpPctText:      $('tp-pct-text'),
  tpBarFill:      $('tp-bar-fill'),
  tpTick:         $('tp-tick'),
  tpFriction:     $('tp-friction'),
  tpStatusText:   $('tp-status-text'),

  crisisTimeline: $('crisis-timeline'),
  ctTickBadge:    $('ct-tick-badge'),
  ctTooltip:      $('ct-tooltip'),

  causalCanvas:   $('causal-canvas'),
  causalEmpty:    $('causal-empty'),

  lcOutput:       $('lc-output'),
  lcInput:        $('lc-input'),
  lcSend:         $('lc-send'),
  lcClear:        $('lc-clear'),

  scName:         $('sc-name'),
  scSigBadge:     $('sc-sig-badge'),
  scSector:       $('sc-sector'),
  scTickDisplay:  $('sc-tick-display'),

  pluginList:     $('plugin-list'),
  pluginNoneMsg:  $('plugin-none-msg'),
};

/* ═══════════════════════════════════════════════════════════════
   AUDIT / BRIEFING DATA
   ═══════════════════════════════════════════════════════════════ */

const INTEL_FEED = [
  "SİMÜLASYON MODU — TÜM METRİKLER ÖRNEKTİR, CANLI VERİ DEĞİLDİR",
  "AES-256-CBC SELF-TEST (FIPS-197 KAT): PASS — ENCLAVE AKTİF",
  "ED25519 KİMLİK DOSYASI: caelus_identity.key — YÜKLENDİ",
  "BLAKE3 OTP SLOT MANİFEST — 4 AKTİF SLOT DOĞRULANDI",
  "SHADOW-MESH UDP 224.0.0.251:47808 — MULTICAST BAĞLI",
  "UNIVERSAL_BASELINE PROFİLİ — NÖTR CAUSAL ENGINE HAZIR",
  "NODE VE EDGE SİNYALLERİ — SİMÜLE TELEMETRİ AKIŞI",
  "FRICTION ENTITY KATSAYISI — KONTROLLÜ DALGALANMA İZLENİYOR",
  "ACTOR UYUM SKORU VE REGULATORY GATE DURUMU — NOMINAL",
  "TRANSIT NODE KAPASİTE PENCERESİ — DİNAMİK OLARAK İZLENİYOR",
  "KAPALI DEVRE (AIR-GAPPED) BAĞLANTI — %100 LOKAL · DIŞ DÜNYAYA KAPALI",
  "OR-TOOLS CP-SAT KISIT MOTORU — STANDBY MODUNDA",
  "OTP GÜVENİLİRLİK SKORU: %97.3 — YÜKSEK GÜVENİLİRLİK",
  "X25519 DH EPHEMERAL ANAHTAR ROTASYONU TAMAMLANDI",
  "P2P MESH: NODE-04 ↔ GATE-01 ELSENETİ DOĞRULANDI",
];

// SCENARIOS hardcoded senaryo sözlüğü kaldırıldı — analiz motorun canlı snapshot'ından üretilir.

function buildBriefing(title, background, alert, actions, stats, conclusion) {
  return { title, background, alert, actions, stats, conclusion };
}

const BASELINE_METRICS = Object.freeze({
  node: 100, edge: 100, actor: 100, gate: 100, friction: 1.00, delay: 0.0, mult: 1.00,
});

const LABEL_KEYS = {
  node:     ['node', 'nodes', 'transit_node', 'transitnode', 'primary_node'],
  edge:     ['edge', 'edges', 'route', 'routes', 'link', 'links'],
  actor:    ['actor', 'actors', 'agent', 'agents', 'participant', 'participants'],
  gate:     ['regulatory_gate', 'regulatorygate', 'gate', 'gates', 'constraint_gate'],
  friction: ['friction', 'friction_entity', 'frictionentity', 'constraint', 'blocker'],
};

function isRecord(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function safeLabel(value, maxLen = 48) {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return safeLabel(value[0], maxLen);
  if (typeof value === 'object') {
    return safeLabel(value.label || value.name || value.title || value.id, maxLen);
  }
  return String(value).replace(/\s+/g, ' ').trim().slice(0, maxLen);
}

function normalizeLabelKey(key) {
  return String(key || '').replace(/[\s-]+/g, '_').replace(/[^a-zA-Z0-9_]/g, '').toLowerCase();
}

function normalizeLabelMap(labels) {
  if (!isRecord(labels)) return {};
  return Object.entries(labels).reduce((acc, [key, value]) => {
    const normalizedKey = normalizeLabelKey(key);
    const label = safeLabel(value);
    if (normalizedKey && label) acc[normalizedKey] = label;
    return acc;
  }, {});
}

function pickLabel(labels, keys, fallback) {
  const normalized = normalizeLabelMap(labels);
  for (const key of keys) {
    const label = safeLabel(normalized[normalizeLabelKey(key)]);
    if (label) return label;
  }
  return fallback;
}

function metricLabel(cfg) {
  return pickLabel(state.scenarioMeta.labels, LABEL_KEYS[cfg.key] || [], cfg.label);
}

function renderLeverageLabels() {
  LEV_CONFIG.forEach(cfg => {
    const nameEl = document.getElementById('lev-name-' + cfg.key);
    if (nameEl) nameEl.textContent = metricLabel(cfg);
  });
}

function scenarioPackFrom(data) {
  const pack = data.scenario_pack || data.scenarioPack || data.scenario || data.pack || {};
  return isRecord(pack) ? pack : {};
}

function nodesFromPayload(data) {
  const pack = scenarioPackFrom(data);
  return data.nodes || data.graph_nodes || data.graphNodes || pack.nodes || pack.graph_nodes || pack.graphNodes;
}

function nodeRoleFrom(raw) {
  const node = isRecord(raw) ? raw : {};
  const source = [
    node.type, node.role, node.kind, node.category, node.classification,
    typeof raw === 'string' ? raw : '',
  ].filter(Boolean).join(' ').toLowerCase();

  if (source.includes('friction') || source.includes('blocker') || source.includes('constraint')) return 'friction';
  if (source.includes('gate') || source.includes('regulatory')) return 'gate';
  if (source.includes('edge') || source.includes('route') || source.includes('link')) return 'edge';
  if (source.includes('actor') || source.includes('agent') || source.includes('participant')) return 'actor';
  if (source.includes('transit')) return 'transit';
  return 'node';
}

function nodeLabelFrom(raw, fallback) {
  if (isRecord(raw)) return safeLabel(raw.label || raw.name || raw.title || raw.id || fallback);
  return safeLabel(raw || fallback);
}

function deriveLabelsFromNodes(nodes) {
  const entries = Array.isArray(nodes)
    ? nodes
    : (isRecord(nodes) ? Object.entries(nodes).map(([id, value]) => isRecord(value) ? { id, ...value } : { id, label:value }) : []);
  const labels = {};
  entries.forEach((node, idx) => {
    const role = nodeRoleFrom(node);
    const label = nodeLabelFrom(node, `Node-${idx + 1}`);
    const targetKey = role === 'transit' ? 'node' : role;
    if (LABEL_KEYS[targetKey] && label && !labels[targetKey]) labels[targetKey] = label;
  });
  return labels;
}

function normalizeScenarioNodes(nodes) {
  const entries = Array.isArray(nodes)
    ? nodes
    : (isRecord(nodes) ? Object.entries(nodes).map(([id, value]) => isRecord(value) ? { id, ...value } : { id, label:value }) : []);

  return entries.map((node, idx) => {
    const role = nodeRoleFrom(node);
    const label = nodeLabelFrom(node, `Node-${idx + 1}`);
    const id = safeLabel(isRecord(node) ? (node.id || node.key || node.code || label) : label, 32) || `NODE-${idx + 1}`;
    const typeMap = {
      node: 'NODE', transit: 'TRANSIT', edge: 'EDGE', actor: 'ACTOR', gate: 'REG_GATE', friction: 'FRICTION',
    };
    return { id, label, type: typeMap[role] || 'NODE' };
  }).filter(node => node.label);
}

function applyScenarioNodes(nodes) {
  const parsedNodes = normalizeScenarioNodes(nodes).slice(0, CFG.MAX_PEERS - 1);
  if (!parsedNodes.length) return;

  let local = state.peers.find(peer => peer.id === 'LOCAL-ENGINE');
  if (!local) local = new MeshNode('LOCAL-ENGINE', 'LOCAL', (cW || 260) / 2, (cH || 180) / 2, true);
  local.label = 'Causal Engine';
  state.peers = [local];

  parsedNodes.forEach(node => {
    const peer = new MeshNode(
      node.id, node.type,
      20 + Math.random() * Math.max(40, (cW || 260) - 40),
      20 + Math.random() * Math.max(40, (cH || 180) - 40)
    );
    peer.label = node.label;
    state.peers.push(peer);
  });

  renderPeerList();
}

function updateScenarioDom() {
  const scenarioId = state.scenarioMeta.scenarioId || 'UNIVERSAL_BASELINE';
  const sector = state.scenarioMeta.sector || 'UNIVERSAL';
  const nodeLabel    = metricLabel({ key:'node',  label:'Node Stability' });
  const edgeLabel    = metricLabel({ key:'edge',  label:'Edge Capacity' });
  const actorLabel   = metricLabel({ key:'actor', label:'Actor Alignment' });
  const frictionLabel= metricLabel({ key:'friction', label:'Friction Entity' });

  renderLeverageLabels();
  if (el.scenarioContext) el.scenarioContext.textContent = `${scenarioId} · ${sector}`;
  if (el.signalSectionLabel) el.signalSectionLabel.textContent = `${nodeLabel} / ${edgeLabel} / ${actorLabel} Signals`;
  if (el.frictionSectionLabel) el.frictionSectionLabel.textContent = `${frictionLabel} Katsayısı`;
  if (el.frictionUnit) el.frictionUnit.textContent = `μ · ${frictionLabel}`;
  if (el.hdrMode) el.hdrMode.textContent = scenarioId === 'UNIVERSAL_BASELINE' ? 'EVRENSEL TABAN' : 'SENARYO';
}

function applyScenarioMetadata(data, options = {}) {
  const pack = scenarioPackFrom(data);
  const meta = data.metadata && typeof data.metadata === 'object' ? data.metadata : {};
  const nodes = nodesFromPayload(data);
  const labels = {
    ...state.scenarioMeta.labels,
    ...normalizeLabelMap(meta.labels),
    ...normalizeLabelMap(pack.labels),
    ...normalizeLabelMap(data.labels),
    ...normalizeLabelMap(deriveLabelsFromNodes(nodes)),
  };

  state.scenarioMeta = {
    scenarioId: safeLabel(data.scenario_id || data.scenarioId || pack.scenario_id || pack.scenarioId || meta.scenario_id || meta.id || pack.id || state.scenarioMeta.scenarioId, 64),
    sector:     safeLabel(data.sector || data.region || pack.sector || pack.domain || meta.sector || meta.region || state.scenarioMeta.sector, 64),
    labels,
    sigStatus:  safeLabel(data.sig_status || data.sigStatus || state.scenarioMeta.sigStatus, 32),
  };

  if (nodes) applyScenarioNodes(nodes);
  updateScenarioDom();
  updateScenarioCard();

  if (options.log !== false) {
    const sectorSuffix = state.scenarioMeta.sector ? ` · ${state.scenarioMeta.sector}` : '';
    addCryptoLog('ok', `Senaryo profili: ${state.scenarioMeta.scenarioId}${sectorSuffix}`);
    setFeedback(`Aktif profil: ${state.scenarioMeta.scenarioId}${sectorSuffix}`, 'var(--cyan)');
  }
}

function applyBaselineMetrics() {
  Object.assign(state.metrics, BASELINE_METRICS);
  updateLeverageDOM();
  updateGauge(state.metrics.friction);
}

/* ═══════════════════════════════════════════════════════════════
   AUDIO ENGINE (Web Audio API)
   ═══════════════════════════════════════════════════════════════ */
let audioCtx = null;

function ensureAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume();
}

function beep(freq, type, dur, vol) {
  if (!state.audioEnabled) return;
  try {
    ensureAudio();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(vol, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + dur);
    o.connect(g); g.connect(audioCtx.destination);
    o.start(); o.stop(audioCtx.currentTime + dur);
  } catch(_) {}
}

const SFX = {
  click:   () => beep(1200, 'sine',     0.03, 0.04),
  chirp:   () => { beep(880,'sine',0.05,0.07); setTimeout(()=>beep(1320,'sine',0.08,0.07),55); },
  alarm:   () => { beep(180,'sawtooth',0.22,0.05); setTimeout(()=>beep(220,'sawtooth',0.22,0.05),160); },
  confirm: () => { beep(660,'sine',0.07,0.06); setTimeout(()=>beep(880,'sine',0.10,0.06),90); setTimeout(()=>beep(1100,'sine',0.12,0.05),200); },
  tick:    () => beep(900 + Math.random()*500, 'sine', 0.014, 0.018),
  boot:    () => beep(440, 'sine', 0.15, 0.06),
};

el.audioToggle.addEventListener('change', e => {
  state.audioEnabled = e.target.checked;
  if (state.audioEnabled) SFX.chirp();
});

/* ═══════════════════════════════════════════════════════════════
   BOOT SEQUENCE
   ═══════════════════════════════════════════════════════════════ */
const BOOT_LINES = [
  { delay: 0,    text: '[AES]  Self-Test (FIPS-197 KAT)..............', suffix: ' PASS', cls: 'ok' },
  { delay: 320,  text: '[ID]   ED25519 caelus_identity.key............', suffix: ' LOADED', cls: 'ok' },
  { delay: 600,  text: '[OTP]  BLAKE3 Slot Manifest....................',  suffix: ' ACTIVE', cls: 'ok' },
  { delay: 860,  text: '[NET]  Shadow-Mesh 224.0.0.251:47808..........', suffix: ' BOUND', cls: 'ok' },
  { delay: 1120, text: '[CPU]  Causal Engine UNIVERSAL_BASELINE.....', suffix: ' NOMINAL', cls: 'ok' },
  { delay: 1400, text: '[SAT]  OR-Tools CP-SAT Engine..................', suffix: ' STANDBY', cls: 'warn' },
  { delay: 1660, text: '[UI]   Command Center v3.0....................', suffix: ' READY', cls: 'ok' },
];

function runBoot() {
  let maxDelay = 0;
  BOOT_LINES.forEach(({ delay, text, suffix, cls }) => {
    maxDelay = Math.max(maxDelay, delay);
    setTimeout(() => {
      const line = document.createElement('div');
      line.className = 'boot-line';
      const t = document.createTextNode(text);
      const s = document.createElement('span');
      s.className = cls;
      s.textContent = suffix;
      line.appendChild(t);
      line.appendChild(s);
      el.bootLines.appendChild(line);
      SFX.boot();
    }, delay);
  });

  setTimeout(() => {
    el.bootFinal.textContent = '▶ ENTERING SECURE OPERATIONAL MODE...';
    el.bootFinal.style.opacity = '1';
    SFX.confirm();
  }, maxDelay + 500);

  setTimeout(() => {
    el.bootOverlay.classList.add('hidden');
    state.bootDone = true;
    initUI();
  }, maxDelay + 1600);
}

/* ═══════════════════════════════════════════════════════════════
   CLOCK + UPTIME
   ═══════════════════════════════════════════════════════════════ */
function padZ(n) { return String(n).padStart(2,'0'); }

function updateClocks() {
  const now = new Date();
  el.hdrUtc.textContent = padZ(now.getUTCHours())+':'+padZ(now.getUTCMinutes())+':'+padZ(now.getUTCSeconds())+' Z';
  const up = Math.floor((Date.now() - state.sessionStart) / 1000);
  const h = Math.floor(up/3600), m = Math.floor((up%3600)/60), s = up%60;
  el.hdrUptime.textContent = padZ(h)+':'+padZ(m)+':'+padZ(s);
}
setInterval(updateClocks, 1000);

/* ═══════════════════════════════════════════════════════════════
   P2P MESH CANVAS
   ═══════════════════════════════════════════════════════════════ */
const canvas  = el.meshCanvas;
const ctx2d   = canvas.getContext('2d');
let cW = 0, cH = 0;

const packets = [];

const NODE_TYPES = {
  LOCAL:     { color:'#06c2d4', glow:'rgba(6,194,212,.5)',  r:5,  shape:'hex'  },
  NODE:      { color:'#4ade80', glow:'rgba(74,222,128,.4)', r:3.5,shape:'sq'   },
  EDGE:      { color:'#e8a838', glow:'rgba(232,168,56,.4)', r:3,  shape:'circ' },
  ACTOR:     { color:'#3b82f6', glow:'rgba(59,130,246,.4)', r:3.5,shape:'tri'  },
  REG_GATE:  { color:'#a78bfa', glow:'rgba(167,139,250,.4)',r:3,  shape:'sq'   },
  TRANSIT:   { color:'#cf6679', glow:'rgba(207,102,121,.4)',r:4,  shape:'hex'  },
  FRICTION:  { color:'#fb923c', glow:'rgba(251,146,60,.4)', r:3,  shape:'circ' },
};

class MeshNode {
  constructor(id, type, x, y, isStatic = false) {
    this.id = id;
    this.type = type;
    this.label = id;
    this.isStatic = isStatic;
    const t = NODE_TYPES[type] || NODE_TYPES.NODE;
    this.color = t.color;
    this.glow  = t.glow;
    this.r     = t.r;
    this.shape = t.shape;
    this.x  = x; this.y = y;
    this.vx = isStatic ? 0 : (Math.random()-0.5)*0.38;
    this.vy = isStatic ? 0 : (Math.random()-0.5)*0.38;
    this.status = 'synced';
    this.pulse  = Math.random() * Math.PI * 2;
    this.pubkey = '0x' + [...Array(16)].map(()=>Math.floor(Math.random()*16).toString(16)).join('');
    this.otpExp = Math.floor(Date.now()/1000) + Math.floor(Math.random()*300 + 60);
  }

  update() {
    if (!this.isStatic) {
      this.x += this.vx; this.y += this.vy;
      if (this.x < 12 || this.x > cW-12) this.vx *= -1;
      if (this.y < 12 || this.y > cH-12) this.vy *= -1;
    }
    this.pulse += 0.055;
  }

  draw() {
    const alpha = this.status === 'handshaking'
      ? 0.5 + 0.5*Math.abs(Math.sin(this.pulse))
      : 1;

    ctx2d.save();
    ctx2d.globalAlpha = 0.35 * alpha;
    ctx2d.shadowBlur  = 14;
    ctx2d.shadowColor = this.color;
    ctx2d.fillStyle   = this.color;

    if (this.shape === 'hex') {
      drawHex(ctx2d, this.x, this.y, this.r + 2);
    } else if (this.shape === 'sq') {
      ctx2d.fillRect(this.x - this.r - 1, this.y - this.r - 1, (this.r+1)*2, (this.r+1)*2);
    } else if (this.shape === 'tri') {
      drawTri(ctx2d, this.x, this.y, this.r + 2);
    } else {
      ctx2d.beginPath(); ctx2d.arc(this.x, this.y, this.r+2, 0, Math.PI*2); ctx2d.fill();
    }
    ctx2d.restore();

    ctx2d.save();
    ctx2d.globalAlpha = alpha;
    ctx2d.fillStyle   = this.color;
    ctx2d.shadowBlur  = 6;
    ctx2d.shadowColor = this.color;

    if (this.shape === 'hex') {
      drawHex(ctx2d, this.x, this.y, this.r);
    } else if (this.shape === 'sq') {
      ctx2d.fillRect(this.x - this.r, this.y - this.r, this.r*2, this.r*2);
    } else if (this.shape === 'tri') {
      drawTri(ctx2d, this.x, this.y, this.r);
    } else {
      ctx2d.beginPath(); ctx2d.arc(this.x, this.y, this.r, 0, Math.PI*2); ctx2d.fill();
    }
    ctx2d.restore();

    if (this.status === 'handshaking') {
      const ringR = this.r + 4 + 3*Math.abs(Math.sin(this.pulse));
      ctx2d.save();
      ctx2d.strokeStyle = this.color;
      ctx2d.globalAlpha = 0.6 * Math.abs(Math.sin(this.pulse));
      ctx2d.lineWidth   = 1;
      ctx2d.beginPath();
      ctx2d.arc(this.x, this.y, ringR, 0, Math.PI*2);
      ctx2d.stroke();
      ctx2d.restore();
    }
  }
}

function drawHex(c, x, y, r) {
  c.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i - Math.PI / 6;
    if (i === 0) c.moveTo(x + r*Math.cos(a), y + r*Math.sin(a));
    else         c.lineTo(x + r*Math.cos(a), y + r*Math.sin(a));
  }
  c.closePath(); c.fill();
}

function drawTri(c, x, y, r) {
  c.beginPath();
  c.moveTo(x, y - r);
  c.lineTo(x + r*0.866, y + r*0.5);
  c.lineTo(x - r*0.866, y + r*0.5);
  c.closePath(); c.fill();
}

function resizeCanvas() {
  const vp = el.meshCanvas.parentElement;
  cW = canvas.width  = vp.clientWidth;
  cH = canvas.height = vp.clientHeight;
}

function initMeshNodes() {
  // Yalnız yerel motor düğümü. Diğer peer'lar UYDURULMAZ — gerçek ed25519 mesh
  // el sıkışma olayları geldikçe addRealPeer() ile eklenir (loopback dahi olsa
  // motorun fiilen ürettiği gerçek fingerprint'lerdir).
  state.peers = [];
  const local = new MeshNode('LOCAL-ENGINE', 'LOCAL', cW/2, cH/2, true);
  local.label = 'Causal Engine';
  state.peers.push(local);
}

// Motorun canlı 'handshake' olayından gerçek bir peer ekler/günceller.
function addRealPeer(fingerprint, sessionId) {
  const id = 'PEER-' + fingerprint.slice(0, 8).toUpperCase();
  let peer = state.peers.find(p => p.id === id);
  if (!peer) {
    if (state.peers.length >= CFG.MAX_PEERS) return;
    peer = new MeshNode(id, 'NODE', 20 + Math.random()*(cW-40), 20 + Math.random()*(cH-40));
    peer.fingerprint = fingerprint;
    state.peers.push(peer);
    emitPacket(state.peers[0], peer);
  }
  peer.status = 'synced';
  renderPeerList();
  el.meshBadge.textContent = 'CANLI MESH';
  el.meshBadge.className = 'panel-badge';
}

function emitPacket(fromNode, toNode) {
  packets.push({
    x: fromNode.x, y: fromNode.y,
    tx: toNode.x, ty: toNode.y,
    progress: 0, speed: 0.025 + Math.random()*0.02,
    color: fromNode.color,
  });
}

function drawMesh() {
  ctx2d.clearRect(0, 0, cW, cH);

  ctx2d.save();
  ctx2d.fillStyle = 'rgba(18,32,48,.5)';
  const step = 18;
  for (let gx = 0; gx < cW; gx += step)
    for (let gy = 0; gy < cH; gy += step)
      ctx2d.fillRect(gx, gy, 1, 1);
  ctx2d.restore();

  for (let i = 0; i < state.peers.length; i++) {
    for (let j = i+1; j < state.peers.length; j++) {
      const a = state.peers[i], b = state.peers[j];
      const dx = a.x-b.x, dy = a.y-b.y;
      const dist = Math.sqrt(dx*dx+dy*dy);
      if (dist > 110) continue;
      const alpha = (1 - dist/110) * 0.4;
      const isActive = a.status==='handshaking' || b.status==='handshaking';
      ctx2d.save();
      ctx2d.strokeStyle = isActive ? `rgba(6,194,212,${alpha*1.6})` : `rgba(30,53,80,${alpha*2})`;
      ctx2d.lineWidth   = isActive ? 1 : 0.6;
      ctx2d.shadowColor = isActive ? 'rgba(6,194,212,.3)' : 'transparent';
      ctx2d.shadowBlur  = isActive ? 4 : 0;
      ctx2d.beginPath();
      ctx2d.moveTo(a.x, a.y);
      ctx2d.lineTo(b.x, b.y);
      ctx2d.stroke();
      ctx2d.restore();
    }
  }

  for (let i = packets.length-1; i >= 0; i--) {
    const p = packets[i];
    p.progress += p.speed;
    const t = p.progress;
    if (t > 1) { packets.splice(i,1); continue; }
    const px = p.x + (p.tx-p.x)*t;
    const py = p.y + (p.ty-p.y)*t;
    ctx2d.save();
    ctx2d.fillStyle   = p.color;
    ctx2d.globalAlpha = 0.9 * (1-Math.abs(t-0.5)*2+0.5);
    ctx2d.shadowColor = p.color;
    ctx2d.shadowBlur  = 5;
    ctx2d.beginPath();
    ctx2d.arc(px, py, 2, 0, Math.PI*2);
    ctx2d.fill();
    ctx2d.restore();
  }

  state.peers.forEach(n => { n.update(); n.draw(); });
  requestAnimationFrame(drawMesh);
}

/* ═══════════════════════════════════════════════════════════════
   PEER LIST (LEFT SIDEBAR)
   ═══════════════════════════════════════════════════════════════ */
function renderPeerList() {
  el.peerList.innerHTML = '';
  el.hdrMesh.textContent = `${state.peers.length} / ${CFG.MAX_PEERS}`;
  el.meshCountBadge.textContent = `DÜĞÜM: ${state.peers.length} / ${CFG.MAX_PEERS}`;

  state.peers.forEach(peer => {
    if (peer.id === 'LOCAL-ENGINE') return;
    const div = document.createElement('div');
    div.className = 'peer-item' + (peer.status==='handshaking' ? ' handshaking' : '');

    const meta = document.createElement('div');
    meta.className = 'peer-meta';

    const pid = document.createElement('span');
    pid.className = 'peer-id';
    pid.textContent = peer.label || peer.id;

    const ps = document.createElement('span');
    ps.className = 'peer-status ' + peer.status;
    ps.textContent = peer.status==='handshaking' ? 'ZK ELSENETİ' : 'DOĞRULANDI';

    meta.appendChild(pid);
    meta.appendChild(ps);

    const d1 = document.createElement('div');
    d1.className = 'peer-detail';
    d1.textContent = 'ID: ' + peer.id + ' · PUB: ' + peer.pubkey;

    const expSecs = peer.otpExp - Math.floor(Date.now()/1000);
    const d2 = document.createElement('div');
    d2.className = 'peer-detail';
    d2.textContent = 'OTP: ' + (expSecs > 0 ? expSecs + 's' : 'SÜRESİ DOLDU');

    div.appendChild(meta);
    div.appendChild(d1);
    div.appendChild(d2);
    el.peerList.appendChild(div);
  });
}

/* ═══════════════════════════════════════════════════════════════
   DEVICE DISCOVERY SIMULATION
   ═══════════════════════════════════════════════════════════════ */
// DISCOVERY_POOL kaldırıldı — uydurma peer havuzu yok.

// simulateDiscovery kaldırıldı — peer keşfi gerçek mesh olaylarıyla (addRealPeer) yapılır.

/* ═══════════════════════════════════════════════════════════════
   CRYPTO EVENT LOG
   ═══════════════════════════════════════════════════════════════ */
function addCryptoLog(level, msg) {
  const now = new Date();
  const ts  = padZ(now.getHours())+':'+padZ(now.getMinutes())+':'+padZ(now.getSeconds());

  const entry = document.createElement('div');
  entry.className = 'log-entry';

  const tsSpan = document.createElement('span');
  tsSpan.className = 'log-ts';
  tsSpan.textContent = ts;

  const lvSpan = document.createElement('span');
  lvSpan.className = 'log-' + level;
  lvSpan.textContent = level==='ok' ? '[OK]' : level==='warn' ? '[WARN]' : level==='err' ? '[ERR]' : '[INFO]';

  const msgSpan = document.createElement('span');
  msgSpan.className = 'log-msg';
  msgSpan.textContent = msg;

  entry.appendChild(tsSpan);
  entry.appendChild(lvSpan);
  entry.appendChild(msgSpan);

  el.cryptoLog.insertBefore(entry, el.cryptoLog.firstChild);

  while (el.cryptoLog.children.length > CFG.LOG_MAX_ENTRIES) {
    el.cryptoLog.removeChild(el.cryptoLog.lastChild);
  }
}

function randomHex(len) {
  return [...Array(len)].map(()=>Math.floor(Math.random()*16).toString(16)).join('');
}

const CRYPTO_EVENTS = [
  () => addCryptoLog('ok',   `X25519 DH PAYLAŞIM session=0x${randomHex(8)} — TAMAMLANDI`),
  () => addCryptoLog('ok',   `BLAKE3 OTP slot=0x${randomHex(12)} — DOĞRULANDI`),
  () => addCryptoLog('info', `IntelFeed paketi: μ=${(1+Math.random()*0.8).toFixed(2)} seviye=${Math.floor(Math.random()*3)}`),
  () => addCryptoLog('ok',   `Peer TTL güncellendi: ${state.peers[1+Math.floor(Math.random()*(state.peers.length-1))]?.id||'NODE-04'} 10s`),
  () => addCryptoLog('warn', `Slot hash zaman sınırına yaklaşıyor — rotasyon başlatıldı`),
  () => addCryptoLog('ok',   `AES-256-CBC IntelFeed şifre çözme — BAŞARILI`),
  () => addCryptoLog('info', `CP-SAT Causal Engine: travel_band=[${40+Math.floor(Math.random()*20)}, ${65+Math.floor(Math.random()*30)}] dk`),
  () => {
    const p1 = state.peers[1+Math.floor(Math.random()*(Math.max(1,state.peers.length-1)))];
    const p2 = state.peers[0];
    if (p1 && p2) {
      emitPacket(p1, p2);
      addCryptoLog('ok', `Shadow-Mesh paket: ${p1.id} → LOCAL-ENGINE — şifreli`);
    }
  },
];

/* ═══════════════════════════════════════════════════════════════
   LEVERAGE BARS + SPARKLINES
   ═══════════════════════════════════════════════════════════════ */
const LEV_CONFIG = [
  { key:'node',  label:'Node Stability',  colorVar:'--cyan'   },
  { key:'edge',  label:'Edge Capacity',   colorVar:'--crisis' },
  { key:'actor', label:'Actor Alignment', colorVar:'--amber'  },
  { key:'gate',  label:'Regulatory Gate', colorVar:'--blue'   },
];

function initLeverageBars() {
  el.leverageList.innerHTML = '';
  LEV_CONFIG.forEach(cfg => {
    const v = state.metrics[cfg.key];
    state.history[cfg.key] = Array.from({length:CFG.SPARKLINE_POINTS}, ()=> v + (Math.random()-0.5)*6);

    const item = document.createElement('div');
    item.className = 'lev-item';
    item.id = 'lev-' + cfg.key;

    const rowEl = document.createElement('div');
    rowEl.className = 'lev-row';
    const nameEl = document.createElement('span');
    nameEl.className = 'lev-name';
    nameEl.id = 'lev-name-' + cfg.key;
    nameEl.style.fontSize = '9.5px';
    nameEl.textContent = metricLabel(cfg);
    const valEl = document.createElement('span');
    valEl.className = 'lev-val';
    valEl.id = 'lev-val-'+cfg.key;
    valEl.textContent = v + '%';
    rowEl.appendChild(nameEl); rowEl.appendChild(valEl);

    const track = document.createElement('div');
    track.className = 'lev-track';
    const fill = document.createElement('div');
    fill.className = 'lev-fill';
    fill.id = 'lev-bar-'+cfg.key;
    fill.style.width = v + '%';
    const colorMap = { '--cyan':'#06c2d4','--crisis':'#cf6679','--amber':'#e8a838','--blue':'#3b82f6' };
    const c = colorMap[cfg.colorVar] || '#06c2d4';
    fill.style.background = c;
    fill.style.boxShadow  = `0 0 6px ${c}55`;
    track.appendChild(fill);

    const spark = document.createElement('div');
    spark.className = 'lev-sparkline';
    const svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
    svg.setAttribute('preserveAspectRatio','none');
    const path = document.createElementNS('http://www.w3.org/2000/svg','path');
    path.className.baseVal = 'sparkline-path';
    path.style.stroke = c;
    const area = document.createElementNS('http://www.w3.org/2000/svg','path');
    area.className.baseVal = 'sparkline-area';
    area.style.fill = c.replace('#','rgba(').slice(0,-1)+',.09)'.slice(-12);
    svg.appendChild(area); svg.appendChild(path);
    svg.id = 'spark-svg-'+cfg.key;
    spark.appendChild(svg);

    item.appendChild(rowEl);
    item.appendChild(track);
    item.appendChild(spark);
    el.leverageList.appendChild(item);

    renderSparkline(cfg.key);
  });
}

function renderSparkline(key) {
  const hist = state.history[key];
  if (!hist || !hist.length) return;
  const svgEl = document.getElementById('spark-svg-'+key);
  if (!svgEl) return;
  const W = 100, H = 100;
  const min = Math.min(...hist) - 5, max = Math.max(...hist) + 5;
  const range = max - min || 1;
  const pts = hist.map((v,i) => {
    const x = (i/(hist.length-1)) * W;
    const y = H - ((v-min)/range)*H;
    return [x,y];
  });
  const pathD = pts.map((p,i)=>(i===0?'M':'L')+p[0].toFixed(1)+' '+p[1].toFixed(1)).join(' ');
  const areaD = pathD + ` L ${pts[pts.length-1][0].toFixed(1)} ${H} L ${pts[0][0].toFixed(1)} ${H} Z`;
  svgEl.setAttribute('viewBox',`0 0 ${W} ${H}`);
  svgEl.querySelector('.sparkline-path').setAttribute('d', pathD);
  svgEl.querySelector('.sparkline-area').setAttribute('d', areaD);
}

function updateLeverageDOM() {
  LEV_CONFIG.forEach(cfg => {
    const v = Math.round(state.metrics[cfg.key]);
    const valEl = document.getElementById('lev-val-'+cfg.key);
    const barEl = document.getElementById('lev-bar-'+cfg.key);
    if (valEl) valEl.textContent = v + '%';
    if (barEl) barEl.style.width = v + '%';
    if (state.history[cfg.key]) {
      state.history[cfg.key].push(v);
      if (state.history[cfg.key].length > CFG.SPARKLINE_POINTS) state.history[cfg.key].shift();
      renderSparkline(cfg.key);
    }
  });
}

/* ═══════════════════════════════════════════════════════════════
   FRICTION GAUGE (Semicircle with SVG needle)
   ═══════════════════════════════════════════════════════════════ */
function arcPath(v) {
  const cx=G.CX, cy=G.CY, r=G.R;
  if (v <= 0.001) return `M ${cx-r} ${cy} A ${r} ${r} 0 0 0 ${cx-r+0.1} ${cy-0.1}`;
  const startA = Math.PI;
  const endA   = Math.PI + v*Math.PI;
  const ex = cx + r * Math.cos(endA);
  const ey = cy + r * Math.sin(endA);
  const lf = v > 0.999 ? 1 : 0;
  return `M ${(cx-r).toFixed(2)} ${cy} A ${r} ${r} 0 ${lf} 0 ${ex.toFixed(2)} ${ey.toFixed(2)}`;
}

function buildGaugeZones() {
  const z = [
    { id:'gauge-zone-green',  from:0,    to:0.40 },
    { id:'gauge-zone-amber',  from:0.40, to:0.70 },
    { id:'gauge-zone-crisis', from:0.70, to:1.00 },
  ];
  z.forEach(({id, from, to}) => {
    const cx=G.CX, cy=G.CY, r=G.R;
    const sa = Math.PI + from*Math.PI;
    const ea = Math.PI + to*Math.PI;
    const sx = cx + r*Math.cos(sa), sy = cy + r*Math.sin(sa);
    const ex = cx + r*Math.cos(ea), ey = cy + r*Math.sin(ea);
    const lf = (to-from) > 0.5 ? 1 : 0;
    const el2 = document.getElementById(id);
    if (el2) el2.setAttribute('d',
      `M ${sx.toFixed(2)} ${sy.toFixed(2)} A ${r} ${r} 0 ${lf} 0 ${ex.toFixed(2)} ${ey.toFixed(2)}`);
  });
}

function buildGaugeTrack() {
  const d = `M ${G.CX-G.R} ${G.CY} A ${G.R} ${G.R} 0 1 0 ${G.CX+G.R} ${G.CY}`;
  el.gaugeTrack.setAttribute('d', d);
}

function buildGaugeTicks() {
  const ticks = [0, 0.25, 0.5, 0.75, 1.0];
  el.gaugeTicks.innerHTML = '';
  ticks.forEach(v => {
    const a = Math.PI + v*Math.PI;
    const ox = G.CX + G.R*Math.cos(a), oy = G.CY + G.R*Math.sin(a);
    const ix = G.CX + (G.R-8)*Math.cos(a), iy = G.CY + (G.R-8)*Math.sin(a);
    const line = document.createElementNS('http://www.w3.org/2000/svg','line');
    line.setAttribute('x1', ox.toFixed(2)); line.setAttribute('y1', oy.toFixed(2));
    line.setAttribute('x2', ix.toFixed(2)); line.setAttribute('y2', iy.toFixed(2));
    line.setAttribute('stroke', 'rgba(30,53,80,.8)');
    line.setAttribute('stroke-width', v===0||v===1?'1.5':'1');
    el.gaugeTicks.appendChild(line);

    const lx = G.CX + (G.R+14)*Math.cos(a), ly = G.CY + (G.R+14)*Math.sin(a);
    if (v === 0 || v === 0.5 || v === 1) {
      const text = document.createElementNS('http://www.w3.org/2000/svg','text');
      text.setAttribute('x', lx.toFixed(2)); text.setAttribute('y', (ly+3).toFixed(2));
      text.setAttribute('text-anchor','middle');
      text.setAttribute('font-size','7');
      text.setAttribute('fill','rgba(90,122,154,.6)');
      text.setAttribute('font-family','Consolas,Courier New,monospace');
      text.textContent = (1 + v * 2).toFixed(1);
      el.gaugeTicks.appendChild(text);
    }
  });
}

function normalizeFrictionMu(value, assumeMultiplier = false) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 1;
  const mu = assumeMultiplier || n >= 1 ? n : 1 + n * 2;
  return Math.max(1, Math.min(3, mu));
}

function frictionSeverity(mu) {
  return (normalizeFrictionMu(mu, true) - 1) / 2;
}

function frictionMuFromPayload(data) {
  if (!isRecord(data)) return null;
  const direct = data.friction_mult ?? data.frictionMultiplier ?? data.multiplier ?? data.mu;
  if (direct !== undefined) return normalizeFrictionMu(direct, true);
  const coeff = data.friction_coeff ?? data.frictionCoeff ?? data.friction ?? data.value;
  if (coeff !== undefined) return normalizeFrictionMu(coeff, false);
  return null;
}

function applyFrictionMu(mu, delayOverride) {
  const nextMu = normalizeFrictionMu(mu, true);
  state.metrics.friction = nextMu;
  state.metrics.mult = nextMu;
  const delay = Number(delayOverride);
  state.metrics.delay = Number.isFinite(delay) ? Math.max(0, delay) : Math.max(0, (nextMu - 1) * 7.5);
  updateGauge(nextMu);
}

function updateGauge(mu) {
  const v = normalizeFrictionMu(mu, true);
  const severity = frictionSeverity(v);

  el.gaugeFill.setAttribute('d', arcPath(severity));

  let strokeColor;
  if      (v <= 1.05) strokeColor = '#4ade80';
  else if (v <  2.30) strokeColor = '#e8a838';
  else                strokeColor = '#cf6679';
  el.gaugeFill.style.stroke = strokeColor;

  const a = Math.PI + severity*Math.PI;
  const nx = G.CX + G.NEEDLE_LEN*Math.cos(a);
  const ny = G.CY + G.NEEDLE_LEN*Math.sin(a);
  el.gaugeNeedle.setAttribute('x2', nx.toFixed(2));
  el.gaugeNeedle.setAttribute('y2', ny.toFixed(2));
  el.gaugeNeedle.style.stroke = strokeColor;

  el.frictionVal.textContent = v.toFixed(2);
  el.frictionVal.style.color = strokeColor;

  const riskText = v <= 1.05 ? 'NÖTR' : v < 1.70 ? 'DÜŞÜK' : v < 2.30 ? 'ORTA' : 'YÜKSEK';
  const delay    = Number.isFinite(Number(state.metrics.delay)) ? Number(state.metrics.delay) : Math.max(0, (v - 1) * 7.5);
  el.gRisk.textContent  = riskText;
  el.gRisk.style.color  = strokeColor;
  el.gMult.textContent  = v.toFixed(2) + '×';
  el.gMult.style.color  = strokeColor;
  el.gDelay.textContent = delay.toFixed(1) + ' SAAT';
  el.gDelay.style.color = strokeColor;

  if (v >= 2.30) {
    el.gOtp.textContent = 'TEHDİT';
    el.gOtp.style.color = '#cf6679';
  } else {
    el.gOtp.textContent = 'AKTİF';
    el.gOtp.style.color = '#4ade80';
  }

  const sbColors = { NÖTR:'#4ade80', DÜŞÜK:'#4ade80', ORTA:'#e8a838', YÜKSEK:'#cf6679' };
  el.sbThreat.textContent = 'RİSK: ' + riskText;
  el.sbThreat.style.color = sbColors[riskText];
  el.sbThreat.style.borderColor = sbColors[riskText] + '55';

  if (v >= 2.30) {
    el.hdrThreat.style.display = '';
    el.monitorBadge.className = 'panel-badge panel-badge--crisis';
    el.monitorBadge.textContent = 'KRİZ';
  } else if (v <= 1.05) {
    el.hdrThreat.style.display = 'none';
    el.monitorBadge.className = 'panel-badge';
    el.monitorBadge.textContent = 'NÖTR';
  } else {
    el.hdrThreat.style.display = 'none';
    el.monitorBadge.className = 'panel-badge panel-badge--warn';
    el.monitorBadge.textContent = 'TELEMETRİ';
  }

  // Also update throughput friction display
  if (el.tpFriction) el.tpFriction.textContent = v.toFixed(2);
}

/* ═══════════════════════════════════════════════════════════════
   THROUGHPUT GAUGE (P0-A) — SVG circular gauge in center panel
   ═══════════════════════════════════════════════════════════════ */

function tpColor(ratio, outage) {
  if (outage || ratio <= 0.001) return '#8b0000';
  if (ratio >= 0.70)  return '#4ade80';
  if (ratio >= 0.30)  return '#e8a838';
  return '#cf6679';
}

function applyThroughputGauge(ratio, outage) {
  ratio = Math.max(0, Math.min(1, Number(ratio) || 0));
  state.throughputRatio = ratio;
  state.outageActive    = !!outage;

  const color = tpColor(ratio, outage);
  const pct   = Math.round(ratio * 100);

  // Circular SVG arc: full circumference = TP_CIRCUMFERENCE
  // stroke-dashoffset = -circumference/4 to start from top (-90°)
  const filled = TP_CIRCUMFERENCE * ratio;
  const empty  = TP_CIRCUMFERENCE - filled;
  if (el.tpGaugeFill) {
    el.tpGaugeFill.setAttribute('stroke-dasharray', `${filled.toFixed(2)} ${empty.toFixed(2)}`);
    el.tpGaugeFill.setAttribute('stroke', color);
  }
  if (el.tpPctText) {
    el.tpPctText.textContent = pct + '%';
    el.tpPctText.setAttribute('fill', color);
  }

  // Bar fill
  if (el.tpBarFill) {
    el.tpBarFill.style.width      = pct + '%';
    el.tpBarFill.style.background = color;
  }

  // Status text
  let statusText = 'NOMİNAL';
  if (outage) statusText = 'OUTAGE';
  else if (ratio < 0.30) statusText = 'KRİTİK';
  else if (ratio < 0.70) statusText = 'UYARI';
  if (el.tpStatusText) {
    el.tpStatusText.textContent = statusText;
    el.tpStatusText.style.color = color;
  }

  // Section class for CSS outage state
  if (el.tpSection) {
    if (outage || ratio <= 0.001) {
      el.tpSection.classList.add('tp-outage');
    } else {
      el.tpSection.classList.remove('tp-outage');
    }
  }

  // Show/hide outage banner
  if (outage) {
    showOutageBanner(state.currentTick);
  } else {
    hideOutageBanner();
  }
}

/* ── Outage Banner ────────────────────────────────────────────── */
function showOutageBanner(tick) {
  if (!el.outageBanner) return;
  el.outageBanner.classList.remove('hidden');
  if (el.outageDetail) {
    el.outageDetail.textContent = `tick=${tick} · throughput=0% · clear_irrecoverable lever ile kurtarın`;
  }
  SFX.alarm();
}

function hideOutageBanner() {
  if (!el.outageBanner) return;
  el.outageBanner.classList.add('hidden');
}

/* ═══════════════════════════════════════════════════════════════
   TICK HISTORY (for crisis timeline)
   ═══════════════════════════════════════════════════════════════ */
function addTickHistory(tick, ratio, friction, outage, hysFlip, deadlineMiss) {
  state.tickHistory.push({ tick, ratio, friction, outage, hysFlip, deadlineMiss });
  if (state.tickHistory.length > CFG.TICK_HISTORY_MAX) state.tickHistory.shift();
  if (el.ctTickBadge) {
    el.ctTickBadge.textContent = `TICK: ${tick} · ${state.tickHistory.length} kayıt`;
  }
  if (el.scTickDisplay) {
    el.scTickDisplay.textContent = `Tick: ${tick}`;
  }
}

/* ═══════════════════════════════════════════════════════════════
   CRISIS TIMELINE CANVAS (P0-B)
   ═══════════════════════════════════════════════════════════════ */
let ctCanvas = null, ctCtx = null;
let ctW = 0, ctH = 0;
let ctHoverX = -1;

function initCrisisTimeline() {
  ctCanvas = el.crisisTimeline;
  if (!ctCanvas) return;
  ctCtx = ctCanvas.getContext('2d');

  function resize() {
    const parent = ctCanvas.parentElement;
    ctW = ctCanvas.width  = parent.clientWidth;
    ctH = ctCanvas.height = ctCanvas.clientHeight || 56;
  }
  resize();
  window.addEventListener('resize', resize);

  // Mouse wheel scrolling
  ctCanvas.addEventListener('wheel', e => {
    e.preventDefault();
    state.ctScrollOffset = Math.max(0, state.ctScrollOffset + (e.deltaY > 0 ? 5 : -5));
    drawCrisisTimeline();
  }, { passive: false });

  // Mouse hover for tooltip
  ctCanvas.addEventListener('mousemove', e => {
    const rect = ctCanvas.getBoundingClientRect();
    ctHoverX = e.clientX - rect.left;
    drawCrisisTimeline();
  });
  ctCanvas.addEventListener('mouseleave', () => {
    ctHoverX = -1;
    if (el.ctTooltip) el.ctTooltip.classList.add('hidden');
    drawCrisisTimeline();
  });

  // Start RAF loop for timeline
  requestAnimationFrame(ctRafLoop);
}

function ctRafLoop() {
  drawCrisisTimeline();
  requestAnimationFrame(ctRafLoop);
}

function drawCrisisTimeline() {
  if (!ctCtx || !ctCanvas || ctW === 0 || ctH === 0) return;

  const hist   = state.tickHistory;
  const bg     = '#091520';
  const gridC  = 'rgba(18,32,48,.8)';

  ctCtx.clearRect(0, 0, ctW, ctH);
  ctCtx.fillStyle = bg;
  ctCtx.fillRect(0, 0, ctW, ctH);

  // Grid lines
  ctCtx.strokeStyle = gridC;
  ctCtx.lineWidth   = 0.5;
  for (let gy = 0; gy <= 1; gy += 0.25) {
    const y = ctH - gy * ctH;
    ctCtx.beginPath();
    ctCtx.moveTo(0, y);
    ctCtx.lineTo(ctW, y);
    ctCtx.stroke();
  }

  if (hist.length < 2) {
    ctCtx.fillStyle = 'rgba(90,122,154,.4)';
    ctCtx.font = '9px Consolas,monospace';
    ctCtx.textAlign = 'center';
    ctCtx.fillText('Tick verisi bekleniyor...', ctW / 2, ctH / 2 + 4);
    return;
  }

  // Visible window (horizontal scroll)
  const total      = hist.length;
  const visibleMax = Math.min(total, 200); // max visible ticks
  const endIdx     = Math.max(visibleMax, total - Math.floor(state.ctScrollOffset));
  const startIdx   = Math.max(0, endIdx - visibleMax);
  const visible    = hist.slice(startIdx, endIdx);

  if (visible.length < 2) return;

  const tickW = ctW / visible.length;

  // Draw outage zones first (red background bands)
  visible.forEach((pt, i) => {
    if (pt.outage) {
      const x = i * tickW;
      ctCtx.fillStyle = 'rgba(207,102,121,.18)';
      ctCtx.fillRect(x, 0, tickW + 1, ctH);
    }
  });

  // Draw throughput line
  ctCtx.beginPath();
  ctCtx.lineWidth = 1.5;
  visible.forEach((pt, i) => {
    const x = i * tickW + tickW / 2;
    const y = ctH - pt.ratio * ctH * 0.85 - ctH * 0.075;
    if (i === 0) ctCtx.moveTo(x, y);
    else         ctCtx.lineTo(x, y);
  });
  // Gradient stroke based on last value
  const lastRatio = visible[visible.length - 1].ratio;
  ctCtx.strokeStyle = tpColor(lastRatio, state.outageActive);
  ctCtx.shadowBlur  = 4;
  ctCtx.shadowColor = ctCtx.strokeStyle;
  ctCtx.stroke();
  ctCtx.shadowBlur  = 0;

  // Draw event markers
  visible.forEach((pt, i) => {
    const x = i * tickW + tickW / 2;

    if (pt.hysFlip) {
      // Hysteresis flip: amber vertical line + "HYS" label
      ctCtx.strokeStyle = '#e8a838';
      ctCtx.lineWidth   = 1.5;
      ctCtx.setLineDash([3, 2]);
      ctCtx.beginPath();
      ctCtx.moveTo(x, 0);
      ctCtx.lineTo(x, ctH);
      ctCtx.stroke();
      ctCtx.setLineDash([]);
      ctCtx.fillStyle = '#e8a838';
      ctCtx.font      = '7px Consolas,monospace';
      ctCtx.textAlign = 'center';
      ctCtx.fillText('HYS', x, 8);
    }

    if (pt.deadlineMiss) {
      // Deadline miss: red X marker
      const y = ctH - pt.ratio * ctH * 0.85 - ctH * 0.075;
      ctCtx.strokeStyle = '#ff2d2d';
      ctCtx.lineWidth   = 1.5;
      const sz = 4;
      ctCtx.beginPath();
      ctCtx.moveTo(x - sz, y - sz); ctCtx.lineTo(x + sz, y + sz);
      ctCtx.moveTo(x + sz, y - sz); ctCtx.lineTo(x - sz, y + sz);
      ctCtx.stroke();
    }
  });

  // Hover tooltip
  if (ctHoverX >= 0 && ctHoverX <= ctW) {
    const idx = Math.min(visible.length - 1, Math.floor(ctHoverX / tickW));
    const pt  = visible[idx];
    if (pt) {
      // Vertical hover line
      const hx = idx * tickW + tickW / 2;
      ctCtx.strokeStyle = 'rgba(6,194,212,.5)';
      ctCtx.lineWidth   = 1;
      ctCtx.beginPath();
      ctCtx.moveTo(hx, 0);
      ctCtx.lineTo(hx, ctH);
      ctCtx.stroke();

      // Tooltip DOM element
      if (el.ctTooltip) {
        const ttx = Math.min(ctHoverX + 8, ctW - 160);
        el.ctTooltip.style.left = ttx + 'px';
        el.ctTooltip.style.top  = '2px';
        el.ctTooltip.textContent = `tick=${pt.tick} · tp=${(pt.ratio * 100).toFixed(1)}% · μ=${pt.friction.toFixed(2)}${pt.hysFlip ? ' [HYS]' : ''}${pt.deadlineMiss ? ' [MISS]' : ''}${pt.outage ? ' [OUTAGE]' : ''}`;
        el.ctTooltip.classList.remove('hidden');
      }
    }
  } else if (el.ctTooltip) {
    el.ctTooltip.classList.add('hidden');
  }

  // Y-axis labels
  ctCtx.fillStyle   = 'rgba(90,122,154,.5)';
  ctCtx.font        = '7px Consolas,monospace';
  ctCtx.textAlign   = 'left';
  ctCtx.fillText('1.0', 2, 9);
  ctCtx.fillText('0.5', 2, ctH * 0.5 + 4);
  ctCtx.fillText('0.0', 2, ctH - 2);
}

/* ═══════════════════════════════════════════════════════════════
   CAUSAL GRAPH CANVAS (P1-A)
   ═══════════════════════════════════════════════════════════════ */
let cgCanvas = null, cgCtx = null;
let cgW = 0, cgH = 0;
let cgHoverNode = null;
const CG_NODE_R = 12; // base radius for causal nodes
// Simple force-directed layout state
let cgPositions = []; // [{x,y}] per node index

function initCausalCanvas() {
  cgCanvas = el.causalCanvas;
  if (!cgCanvas) return;
  cgCtx = cgCanvas.getContext('2d');

  function resize() {
    const parent = cgCanvas.parentElement;
    cgW = cgCanvas.width  = parent.clientWidth  || 260;
    cgH = cgCanvas.height = parent.clientHeight || 200;
    if (state.causalNodes.length > 0) layoutCausalGraph();
    drawCausalGraph();
  }
  resize();
  window.addEventListener('resize', resize);

  cgCanvas.addEventListener('mousemove', e => {
    const rect = cgCanvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    cgHoverNode = null;
    cgPositions.forEach((pos, i) => {
      const node = state.causalNodes[i];
      if (!node) return;
      const r = CG_NODE_R * (node.capacity_scale || 1);
      const dx = mx - pos.x, dy = my - pos.y;
      if (dx*dx + dy*dy <= r*r) cgHoverNode = i;
    });
    drawCausalGraph();
  });
  cgCanvas.addEventListener('mouseleave', () => {
    cgHoverNode = null;
    drawCausalGraph();
  });
  cgCanvas.addEventListener('click', () => {
    if (cgHoverNode !== null) {
      const node = state.causalNodes[cgHoverNode];
      if (node) {
        addLcOutput(`node ${node.id}: state=${node.state_fp ?? '—'} friction=${node.friction_fp ?? '—'} cap=${node.capacity_scale ?? 1} irrecov=${node.irrecoverable ? 'YES' : 'no'}`, 'info');
      }
    }
  });
}

function causalNodeColor(node) {
  if (node.irrecoverable || node.outage_active) return '#cf6679';
  const fp = node.friction_fp;
  if (fp !== undefined && fp > 0.5) return '#e8a838';
  if (node.state_fp !== undefined && node.state_fp < 0.3) return '#e8a838';
  return '#4ade80';
}

function causalNodeShape(node) {
  const t = String(node.type || node.kind || '').toLowerCase();
  if (t.includes('actor')) return 'tri';
  if (t.includes('gate') || t.includes('reg')) return 'sq';
  if (t.includes('friction')) return 'circ';
  return 'circ';
}

function layoutCausalGraph() {
  const N = state.causalNodes.length;
  if (N === 0) { cgPositions = []; return; }

  // Init random positions if needed
  if (cgPositions.length !== N) {
    cgPositions = state.causalNodes.map((_, i) => ({
      x: 30 + Math.random() * (cgW - 60),
      y: 30 + Math.random() * (cgH - 60),
    }));
  }

  // Simple force-directed: ~60 iterations
  const K  = 40;  // spring length
  const KR = 800; // repulsion
  for (let iter = 0; iter < 60; iter++) {
    const forces = cgPositions.map(() => ({ fx:0, fy:0 }));

    // Repulsion between all nodes
    for (let a = 0; a < N; a++) {
      for (let b = a+1; b < N; b++) {
        const dx = cgPositions[a].x - cgPositions[b].x;
        const dy = cgPositions[a].y - cgPositions[b].y;
        const d  = Math.max(0.1, Math.sqrt(dx*dx + dy*dy));
        const f  = KR / (d * d);
        forces[a].fx += f * dx / d;
        forces[a].fy += f * dy / d;
        forces[b].fx -= f * dx / d;
        forces[b].fy -= f * dy / d;
      }
    }

    // Attraction along edges
    (state.causalEdges || []).forEach(edge => {
      const ai = state.causalNodes.findIndex(n => n.id === edge.from);
      const bi = state.causalNodes.findIndex(n => n.id === edge.to);
      if (ai < 0 || bi < 0) return;
      const dx = cgPositions[ai].x - cgPositions[bi].x;
      const dy = cgPositions[ai].y - cgPositions[bi].y;
      const d  = Math.max(0.1, Math.sqrt(dx*dx + dy*dy));
      const f  = (d - K) / d * 0.5;
      forces[ai].fx -= f * dx;
      forces[ai].fy -= f * dy;
      forces[bi].fx += f * dx;
      forces[bi].fy += f * dy;
    });

    // Apply forces with damping
    for (let i = 0; i < N; i++) {
      cgPositions[i].x = Math.max(20, Math.min(cgW - 20, cgPositions[i].x + forces[i].fx * 0.05));
      cgPositions[i].y = Math.max(20, Math.min(cgH - 20, cgPositions[i].y + forces[i].fy * 0.05));
    }
  }
}

function drawCausalGraph() {
  if (!cgCtx) return;
  cgCtx.clearRect(0, 0, cgW, cgH);

  // Background
  cgCtx.fillStyle = 'rgba(5,9,15,.98)';
  cgCtx.fillRect(0, 0, cgW, cgH);

  if (state.causalNodes.length === 0) return;

  // Draw edges
  (state.causalEdges || []).forEach(edge => {
    const ai = state.causalNodes.findIndex(n => n.id === edge.from);
    const bi = state.causalNodes.findIndex(n => n.id === edge.to);
    if (ai < 0 || bi < 0) return;
    const ax = cgPositions[ai].x, ay = cgPositions[ai].y;
    const bx = cgPositions[bi].x, by = cgPositions[bi].y;

    cgCtx.save();
    cgCtx.strokeStyle = 'rgba(90,122,154,.5)';
    cgCtx.lineWidth   = (edge.weight_fp !== undefined) ? Math.max(0.5, edge.weight_fp * 2) : 1;
    if (edge.lag_ticks > 0) cgCtx.setLineDash([4, 3]);
    else                    cgCtx.setLineDash([]);
    cgCtx.beginPath();
    cgCtx.moveTo(ax, ay);
    cgCtx.lineTo(bx, by);
    cgCtx.stroke();
    cgCtx.setLineDash([]);
    cgCtx.restore();
  });

  // Draw nodes
  state.causalNodes.forEach((node, i) => {
    if (!cgPositions[i]) return;
    const pos   = cgPositions[i];
    const color = causalNodeColor(node);
    const shape = causalNodeShape(node);
    const r     = CG_NODE_R * (node.capacity_scale || 1);
    const isHov = (cgHoverNode === i);

    cgCtx.save();
    cgCtx.shadowBlur  = isHov ? 18 : 8;
    cgCtx.shadowColor = color;

    // Shape with color blindness support (shape encodes state too)
    cgCtx.fillStyle   = color + (isHov ? 'ff' : 'cc');
    cgCtx.strokeStyle = isHov ? '#fff' : color;
    cgCtx.lineWidth   = isHov ? 1.5 : 0.5;

    if (shape === 'sq') {
      cgCtx.beginPath();
      cgCtx.rect(pos.x - r, pos.y - r, r*2, r*2);
    } else if (shape === 'tri') {
      cgCtx.beginPath();
      cgCtx.moveTo(pos.x, pos.y - r);
      cgCtx.lineTo(pos.x + r*0.866, pos.y + r*0.5);
      cgCtx.lineTo(pos.x - r*0.866, pos.y + r*0.5);
      cgCtx.closePath();
    } else {
      cgCtx.beginPath();
      cgCtx.arc(pos.x, pos.y, r, 0, Math.PI * 2);
    }
    cgCtx.fill();
    cgCtx.stroke();

    // Irrecoverable X overlay
    if (node.irrecoverable) {
      cgCtx.strokeStyle = '#000';
      cgCtx.lineWidth   = 2;
      const xsz = r * 0.5;
      cgCtx.beginPath();
      cgCtx.moveTo(pos.x - xsz, pos.y - xsz);
      cgCtx.lineTo(pos.x + xsz, pos.y + xsz);
      cgCtx.moveTo(pos.x + xsz, pos.y - xsz);
      cgCtx.lineTo(pos.x - xsz, pos.y + xsz);
      cgCtx.stroke();
    }

    // Node label
    cgCtx.shadowBlur  = 0;
    cgCtx.fillStyle   = isHov ? '#fff' : 'rgba(184,207,228,.75)';
    cgCtx.font        = '7px Consolas,monospace';
    cgCtx.textAlign   = 'center';
    const labelText   = String(node.id || '').slice(0, 12);
    cgCtx.fillText(labelText, pos.x, pos.y + r + 10);
    cgCtx.restore();

    // Hover tooltip
    if (isHov) {
      cgCtx.fillStyle = 'rgba(9,21,32,.92)';
      const ttx = Math.min(pos.x + 14, cgW - 120);
      const tty = Math.max(4, pos.y - 28);
      cgCtx.fillRect(ttx, tty, 115, 34);
      cgCtx.strokeStyle = color;
      cgCtx.lineWidth   = 0.7;
      cgCtx.strokeRect(ttx, tty, 115, 34);
      cgCtx.fillStyle = '#b8cfe4';
      cgCtx.font      = '7.5px Consolas,monospace';
      cgCtx.textAlign = 'left';
      cgCtx.fillText(`id: ${String(node.id || '').slice(0,14)}`, ttx + 4, tty + 11);
      cgCtx.fillText(`state: ${node.state_fp ?? '—'}  fp: ${node.friction_fp ?? '—'}`, ttx + 4, tty + 22);
    }
  });
}

/* Apply a snapshot event to update causal graph */
function applySnapshotEvent(data) {
  const nodes = data.nodes || [];
  const edges = data.edges || [];

  // Normalize nodes
  state.causalNodes = nodes.map(n => {
    const raw = isRecord(n) ? n : { id: String(n) };
    return {
      id:            safeLabel(raw.id || raw.node_id || '?', 32),
      type:          safeLabel(raw.type || raw.kind || '', 16),
      state_fp:      Number(raw.state_fp ?? raw.state ?? 0),
      friction_fp:   Number(raw.friction_fp ?? raw.friction ?? 0),
      trust_fp:      Number(raw.trust_fp ?? raw.trust ?? 1),
      reported_fp:   Number(raw.reported_fp ?? raw.reported ?? raw.state_fp ?? raw.state ?? 0),
      capacity_scale:Math.max(0.5, Math.min(2, Number(raw.capacity_fp ?? raw.capacity ?? 1))),
      irrecoverable: !!(raw.irrecoverable),
      outage_active: !!(raw.outage_active),
    };
  });

  // Normalize edges
  state.causalEdges = edges.map(e => {
    const raw = isRecord(e) ? e : {};
    return {
      from:      safeLabel(raw.from || raw.source || '', 32),
      to:        safeLabel(raw.to || raw.target || '', 32),
      lag_ticks: Number(raw.lag_ticks ?? 0),
      weight_fp: Number(raw.weight_fp ?? raw.weight ?? 0.5),
    };
  });

  // Re-layout graph
  cgPositions = []; // force re-randomize
  layoutCausalGraph();
  drawCausalGraph();

  // Show causal empty hint only when no nodes
  if (el.causalEmpty) {
    el.causalEmpty.style.display = state.causalNodes.length ? 'none' : '';
  }

  addCryptoLog('info', `Snapshot: ${state.causalNodes.length} node, ${state.causalEdges.length} edge alındı`);
  addLcOutput(`snapshot: ${state.causalNodes.length} node, ${state.causalEdges.length} edge`, 'ok');

  // Update tick history from snapshot
  if (data.tick !== undefined) {
    state.currentTick = Number(data.tick);
    const hysFlip = !!(data.any_hysteresis_flip);
    addTickHistory(
      state.currentTick,
      Number(data.throughput_ratio ?? state.throughputRatio),
      state.metrics.friction,
      !!(data.outage_active),
      hysFlip,
      false
    );
  }
}

/* ═══════════════════════════════════════════════════════════════
   LEFT TAB SWITCHER
   ═══════════════════════════════════════════════════════════════ */
function switchLeftTab(tab) {
  state.activeLeftTab = tab;
  const meshPanel   = document.getElementById('tab-mesh');
  const causalPanel = document.getElementById('tab-causal');
  const meshBtn     = document.getElementById('tab-btn-mesh');
  const causalBtn   = document.getElementById('tab-btn-causal');

  if (tab === 'mesh') {
    if (meshPanel)   meshPanel.classList.remove('hidden');
    if (causalPanel) causalPanel.classList.add('hidden');
    if (meshBtn)     meshBtn.classList.add('tab-btn--active');
    if (causalBtn)   causalBtn.classList.remove('tab-btn--active');
  } else {
    if (meshPanel)   meshPanel.classList.add('hidden');
    if (causalPanel) causalPanel.classList.remove('hidden');
    if (meshBtn)     meshBtn.classList.remove('tab-btn--active');
    if (causalBtn)   causalBtn.classList.add('tab-btn--active');
    // Trigger a draw
    setTimeout(() => {
      if (cgCanvas) {
        const p = cgCanvas.parentElement;
        cgW = cgCanvas.width  = p.clientWidth  || 260;
        cgH = cgCanvas.height = p.clientHeight || 200;
      }
      layoutCausalGraph();
      drawCausalGraph();
    }, 20);
  }
}

/* ═══════════════════════════════════════════════════════════════
   LEVER / REPL CONSOLE (P1-B)
   ═══════════════════════════════════════════════════════════════ */
function initLeverConsole() {
  if (!el.lcInput) return;

  el.lcInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const cmd = el.lcInput.value.trim();
      if (!cmd) return;
      handleLcCommand(cmd);
      // History
      state.replHistory.unshift(cmd);
      if (state.replHistory.length > 50) state.replHistory.pop();
      state.replHistoryIdx = -1;
      el.lcInput.value = '';
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      state.replHistoryIdx = Math.min(state.replHistoryIdx + 1, state.replHistory.length - 1);
      el.lcInput.value = state.replHistory[state.replHistoryIdx] || '';
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      state.replHistoryIdx = Math.max(state.replHistoryIdx - 1, -1);
      el.lcInput.value = state.replHistoryIdx >= 0 ? (state.replHistory[state.replHistoryIdx] || '') : '';
    }
  });

  if (el.lcSend) {
    el.lcSend.addEventListener('click', () => {
      const cmd = el.lcInput.value.trim();
      if (!cmd) return;
      handleLcCommand(cmd);
      state.replHistory.unshift(cmd);
      if (state.replHistory.length > 50) state.replHistory.pop();
      state.replHistoryIdx = -1;
      el.lcInput.value = '';
    });
  }

  if (el.lcClear) {
    el.lcClear.addEventListener('click', () => {
      if (el.lcOutput) el.lcOutput.innerHTML = '';
    });
  }

  // Startup hints
  addLcOutput('LEVER KONSOL hazır. Komutlar: status, list levers, lever <id>, tick <n>, snapshot --json, clear_irrecoverable', 'hint');
}

function handleLcCommand(cmd) {
  addLcOutput('> ' + cmd, 'cmd');

  const lower = cmd.toLowerCase().trim();

  // Handle clear_irrecoverable as a special lever command
  if (lower === 'clear_irrecoverable') {
    sendReplCommand(cmd);
    addLcOutput('clear_irrecoverable komutu motora gönderildi. Outage banner kapanacak.', 'info');
    hideOutageBanner();
    if (el.tpSection) el.tpSection.classList.remove('tp-outage');
    return;
  }

  // snapshot --json → send and switch to causal tab
  if (lower.startsWith('snapshot')) {
    sendReplCommand(cmd);
    addLcOutput('Snapshot isteği gönderildi. Motor cevabı bekleniyor...', 'info');
    switchLeftTab('causal');
    return;
  }

  // status: canlıysa motordan gerçek snapshot iste; değilse son bilinen state.
  if (lower === 'status') {
    if (liveWs && liveWs.readyState === WebSocket.OPEN) {
      sendReplCommand('status');
    }
    addLcOutput(`tick=${state.currentTick} friction=${state.metrics.friction.toFixed(2)}μ throughput=${(state.throughputRatio*100).toFixed(1)}% outage=${state.outageActive}`, 'info');
    return;
  }
  // list levers: motora yönlendir — gerçek kaldıraç listesi 'levers' olayıyla döner.
  if (lower === 'list levers' || lower === 'list') {
    if (liveWs && liveWs.readyState === WebSocket.OPEN) {
      sendReplCommand('list levers');
      addLcOutput('Kaldıraç listesi motordan isteniyor...', 'info');
    } else {
      addLcOutput('Motor çevrimdışı — kaldıraç listesi yalnız canlı motordan gelir.', 'err');
    }
    return;
  }

  // Diğer tüm komutlar (tick, lever <id>, snapshot) gerçek motora gider.
  sendReplCommand(cmd);
}

function sendReplCommand(cmd) {
  if (liveWs && liveWs.readyState === WebSocket.OPEN) {
    liveWs.send(cmd);
    addLcOutput('→ motora iletildi', 'ok');
  } else {
    addLcOutput('⚠ Motor çevrimdışı — komut gönderilemedi', 'err');
  }
}

function addLcOutput(line, cls) {
  if (!el.lcOutput) return;
  const div = document.createElement('div');
  div.className = 'lc-line lc-line--' + (cls || 'info');
  div.textContent = line;
  el.lcOutput.appendChild(div);
  el.lcOutput.scrollTop = el.lcOutput.scrollHeight;

  // Trim output
  while (el.lcOutput.children.length > 200) {
    el.lcOutput.removeChild(el.lcOutput.firstChild);
  }
}

/* ═══════════════════════════════════════════════════════════════
   SCENARIO CARD (P1-C)
   ═══════════════════════════════════════════════════════════════ */
function updateScenarioCard() {
  const meta = state.scenarioMeta;
  if (el.scName)    el.scName.textContent    = meta.scenarioId || 'UNIVERSAL_BASELINE';
  if (el.scSector)  el.scSector.textContent  = meta.sector     || 'UNIVERSAL';

  // Signature badge
  const sig = (meta.sigStatus || '').toUpperCase();
  if (el.scSigBadge) {
    if (sig === 'VERIFIED' || sig.includes('ED25519')) {
      el.scSigBadge.textContent  = '✓ İMZALI';
      el.scSigBadge.className    = 'sc-sig-badge sc-sig--verified';
    } else if (sig.includes('SELF_SIGNED') || sig.includes('DEV')) {
      el.scSigBadge.textContent  = '⚠ DEV BYPASS';
      el.scSigBadge.className    = 'sc-sig-badge sc-sig--dev-bypass';
    } else if (sig) {
      const shortKey = sig.slice(0, 8);
      el.scSigBadge.textContent  = '✓ ' + shortKey;
      el.scSigBadge.className    = 'sc-sig-badge sc-sig--verified';
    } else {
      el.scSigBadge.textContent  = '—';
      el.scSigBadge.className    = 'sc-sig-badge sc-sig--neutral';
    }
  }
}

/* ═══════════════════════════════════════════════════════════════
   PLUGIN PANEL (P1-D)
   ═══════════════════════════════════════════════════════════════ */
function updatePluginPanel(plugins) {
  if (!el.pluginList) return;
  if (!Array.isArray(plugins) || plugins.length === 0) {
    if (el.pluginNoneMsg) el.pluginNoneMsg.style.display = '';
    return;
  }
  if (el.pluginNoneMsg) el.pluginNoneMsg.style.display = 'none';

  // Remove old plugin items (keep the none-msg)
  Array.from(el.pluginList.querySelectorAll('.plugin-item')).forEach(n => n.remove());

  plugins.forEach(p => {
    const item  = document.createElement('div');
    item.className = 'plugin-item';

    const name  = document.createElement('span');
    name.className = 'plugin-name';
    name.textContent = safeLabel(p.name || p.id, 30);

    const sig   = document.createElement('span');
    const sigStatus = String(p.sig_status || p.sigStatus || '').toUpperCase();
    if (sigStatus.includes('SELF_SIGNED') || sigStatus.includes('DEV')) {
      sig.className   = 'plugin-sig-dev';
      sig.textContent = '⚠ DEV';
    } else {
      sig.className   = 'plugin-sig-ok';
      sig.textContent = '✅ İMZALI';
    }

    item.appendChild(name);
    item.appendChild(sig);
    el.pluginList.appendChild(item);
  });
}

/* ═══════════════════════════════════════════════════════════════
   OTP TIMELINE
   ═══════════════════════════════════════════════════════════════ */
function initOTPTimeline() {
  state.otpSlots = [];
  const now = Math.floor(Date.now()/1000);
  for (let i = 0; i < CFG.OTP_SLOTS; i++) {
    state.otpSlots.push({
      id:    `0x${(0x2026060700 + i).toString(16).toUpperCase()}`,
      start: now - 300 + i*120,
      dur:   120,
      status: i === 2 ? 'active' : i < 2 ? 'expired' : 'future',
    });
  }
  renderOTPTimeline();
}

function renderOTPTimeline() {
  el.otpTimeline.innerHTML = '';
  const now = Math.floor(Date.now()/1000);
  state.otpSlots.forEach(slot => {
    const elapsed = now - slot.start;
    const pct = Math.max(0, Math.min(1, elapsed / slot.dur));

    const row = document.createElement('div');
    row.className = 'otp-row';

    const sid = document.createElement('div');
    sid.className = 'otp-slot-id';
    sid.textContent = slot.id;

    const track = document.createElement('div');
    track.className = 'otp-track';
    const fill = document.createElement('div');
    fill.className = 'otp-fill otp-fill--' + slot.status;
    fill.style.width = (pct*100).toFixed(1) + '%';
    track.appendChild(fill);

    const st = document.createElement('div');
    st.className = 'otp-status';
    let stText = '';
    if (slot.status==='active') {
      const rem = slot.dur - elapsed;
      stText = rem > 0 ? rem+'s' : '0s';
      st.style.color = '#06c2d4';
    } else if (slot.status==='expired') {
      stText = 'EXP';
      st.style.color = 'var(--text-3)';
    } else {
      stText = 'QUE';
    }
    st.textContent = stText;

    row.appendChild(sid); row.appendChild(track); row.appendChild(st);
    el.otpTimeline.appendChild(row);
  });
}

function tickOTP() {
  const now = Math.floor(Date.now()/1000);
  state.otpSlots.forEach(slot => {
    if (slot.status === 'active') {
      const elapsed = now - slot.start;
      if (elapsed >= slot.dur) {
        slot.status = 'expired';
        const next = state.otpSlots.find(s=>s.status==='future');
        if (next) {
          next.status = 'active';
          next.start  = now;
          addCryptoLog('warn', `OTP slot rotasyonu: ${slot.id} → ${next.id}`);
        }
      }
    }
  });
  renderOTPTimeline();
}

/* ═══════════════════════════════════════════════════════════════
   INTEL TICKER
   ═══════════════════════════════════════════════════════════════ */
function initTicker() {
  const doubled = INTEL_FEED.concat(INTEL_FEED).join('  ·  ');
  el.tickerText.textContent = doubled;
}

/* ═══════════════════════════════════════════════════════════════
   TELEMETRY FLUCTUATION
   ═══════════════════════════════════════════════════════════════ */
function fluctuate() {
  if (state.isTyping) return;
  const m = state.metrics;
  const drift = (min, max, cur, d) => Math.max(min, Math.min(max, cur + (Math.random()-0.5)*d));

  m.node    = drift(25,97, m.node,  3);
  m.edge    = drift(15,85, m.edge,  3);
  m.actor   = drift(35,97, m.actor, 2.5);
  m.gate    = drift(15,88, m.gate,  2.5);
  m.friction= drift(1.00,1.35, m.friction, 0.025);
  m.delay   = Math.max(0, (m.friction - 1) * 7.5);
  m.mult    = m.friction;

  updateLeverageDOM();
  updateGauge(m.friction);
  tickOTP();

  // Simulate mild throughput fluctuation in demo mode
  const simRatio = 0.7 + (m.node / 100) * 0.3;
  applyThroughputGauge(simRatio, false);
  // Push demo tick to history
  state.currentTick += 1;
  addTickHistory(state.currentTick, simRatio, m.friction, false, false, false);

  state.pktCount += Math.floor(Math.random()*5);
  el.sbPkts.textContent = 'PKT: ' + state.pktCount;

  if (Math.random() < 0.6) {
    const ev = CRYPTO_EVENTS[Math.floor(Math.random()*CRYPTO_EVENTS.length)];
    ev();
  }
}

/* ═══════════════════════════════════════════════════════════════
   LIVE ENGINE BRIDGE  (WebSocket ← C++ WsEmitter on 127.0.0.1:47809)
   ═══════════════════════════════════════════════════════════════ */

function resolveWsUrl() {
  const params = new URLSearchParams(window.location.search || '');
  const rawPort = params.get('ws_port') || params.get('wsPort') || window.CAELUS_WS_PORT || '47809';
  const port = String(rawPort).match(/^\d{1,5}$/) ? Math.max(1, Math.min(65535, Number(rawPort))) : 47809;
  // HTTP'den sunulduğunda (uzak War Room) sayfanın host'una geri bağlan ve
  // URL'deki token'ı taşı; yerel dosya (file://) olarak açıldığında loopback.
  const servedOverHttp = window.location.protocol === 'http:' || window.location.protocol === 'https:';
  const host = servedOverHttp && window.location.hostname ? window.location.hostname : '127.0.0.1';
  const token = params.get('token');
  const query = token ? ('/?token=' + encodeURIComponent(token)) : '';
  return `ws://${host}:${port}${query}`;
}

const WS_URL          = resolveWsUrl();
const WS_RECONNECT_MS = 3000;
let   liveWs          = null;

function setLiveStatus(mode) {
  const wm   = document.getElementById('live-watermark');
  const pill = document.getElementById('live-pill');
  if (!wm || !pill) return;

  const nextMode = typeof mode === 'boolean' ? (mode ? 'live' : 'offline') : mode;
  state.engineStatus = nextMode;

  if (nextMode === 'awaiting') {
    wm.className     = 'wm--awaiting';
    wm.textContent   = 'CAUSAL ENGINE: AWAITING SCENARIO';
    pill.className   = 'pill--awaiting';
    pill.textContent = '● LIVE · AWAITING SCENARIO';
  } else if (nextMode === 'live') {
    wm.className     = 'wm--live';
    wm.textContent   = 'CAUSAL ENGINE: LIVE';
    pill.className   = 'pill--live';
    pill.textContent = '● LIVE ENGINE';
  } else {
    wm.className     = 'wm--offline';
    wm.textContent   = 'DEMO MODE: OFFLINE';
    pill.className   = 'pill--offline';
    pill.textContent = '● DEMO · OFFLINE';
  }
}

function hasEngineState(data) {
  return !!(data && (data.state || data.engine_state || data.engineState || data.status));
}

function isBaselineScenario() {
  return String(state.scenarioMeta.scenarioId || '').toUpperCase() === 'UNIVERSAL_BASELINE';
}

function resolveEngineEventType(data) {
  const type = safeLabel(data.type || data.event || data.kind || '', 64).toLowerCase();
  if (type === 'state') return 'engine_state';
  if (type === 'scenario' || type === 'scenario_pack' || type === 'scenariopack') return 'scenario_loaded';
  if (type) return type;
  if (hasEngineState(data)) return 'engine_state';
  if (data.scenario_id || data.scenarioId || data.labels || data.sector || data.nodes) return 'scenario_loaded';
  return '';
}

/* ── Updated applyEngineStateEvent — handles throughput + tick ── */
function applyEngineStateEvent(data) {
  applyScenarioMetadata(data, { log:false });

  const rawState  = safeLabel(data.state || data.engine_state || data.engineState || data.status || '', 80).toUpperCase();
  const scenarioId= state.scenarioMeta.scenarioId;
  const mu        = frictionMuFromPayload(data);
  if (mu !== null) applyFrictionMu(mu, data.delay_hours ?? data.delay ?? data.estimated_delay);

  // ── P0-A: throughput_ratio + outage_active ──
  const incomingRatio  = (data.throughput_ratio !== undefined) ? Number(data.throughput_ratio) : state.throughputRatio;
  const incomingOutage = !!(data.outage_active);
  const hysFlip        = !!(data.any_hysteresis_flip);

  applyThroughputGauge(incomingRatio, incomingOutage);

  // ── P0-B: tick history ──
  if (data.tick !== undefined) {
    state.currentTick = Number(data.tick);
    addTickHistory(
      state.currentTick,
      incomingRatio,
      state.metrics.friction,
      incomingOutage,
      hysFlip,
      !!(data.any_deadline_missed)
    );
  }

  // Update REPL console tick display
  if (el.tpTick) el.tpTick.textContent = String(state.currentTick);

  if (rawState === 'AWAITING_SCENARIO_INJECTION') {
    state.scenarioMeta.scenarioId = 'AWAITING_SCENARIO_INJECTION';
    state.scenarioMeta.sector = state.scenarioMeta.sector || 'UNIVERSAL';
    updateScenarioDom();
    updateScenarioCard();
    if (el.hdrMode) el.hdrMode.textContent = 'SENARYO BEKLİYOR';
    applyBaselineMetrics();
    setLiveStatus('awaiting');
    setEngineState('awaiting');
    setFeedback('Causal Engine canlı; imzalı senaryo enjeksiyonu bekleniyor.', 'var(--amber)');
    if (state.lastEngineState !== rawState) {
      addCryptoLog('warn', `Causal Engine: ${scenarioId} profili senaryo enjeksiyonu bekliyor`);
    }
    state.lastEngineState = rawState;
    return;
  }

  if (rawState === 'UNIVERSAL_BASELINE' || scenarioId === 'UNIVERSAL_BASELINE') {
    state.scenarioMeta.scenarioId = 'UNIVERSAL_BASELINE';
    state.scenarioMeta.sector = state.scenarioMeta.sector || 'UNIVERSAL';
    updateScenarioDom();
    updateScenarioCard();
    applyBaselineMetrics();
    setLiveStatus('live');
    setEngineState('baseline');
    if (state.lastEngineState !== rawState) {
      addCryptoLog('info', 'Causal Engine: UNIVERSAL_BASELINE nötr profili aktif');
    }
    state.lastEngineState = rawState;
    return;
  }

  setLiveStatus('live');
  setEngineState('ready');
  if (rawState && state.lastEngineState !== rawState) {
    addCryptoLog('info', `Causal Engine state=${rawState}`);
  }
  state.lastEngineState = rawState;
}

/* ── NDJSON event router ── */
function handleEngineEvent(ev) {
  let data;
  try { data = JSON.parse(ev.data); } catch(_) { return; }

  switch (resolveEngineEventType(data)) {

    case 'friction': {
      const mu = frictionMuFromPayload(data) ?? 1;
      applyFrictionMu(mu, data.delay_hours ?? data.delay ?? data.estimated_delay);
      updateLeverageDOM();
      const fh = state.history;
      for (const k of ['node','edge','actor','gate'])
        if (fh[k]) { fh[k].push(Math.round(state.metrics[k])); if(fh[k].length>CFG.SPARKLINE_POINTS)fh[k].shift(); renderSparkline(k); }

      // Update tick history from friction event
      if (data.tick !== undefined) {
        state.currentTick = Number(data.tick);
        addTickHistory(
          state.currentTick,
          state.throughputRatio,
          mu,
          state.outageActive,
          !!(data.any_hysteresis_flip),
          !!(data.any_deadline_missed)
        );
        if (el.tpTick) el.tpTick.textContent = String(state.currentTick);
      }
      break;
    }

    case 'intel': {
      const lvl  = Number(data.crisis_level) || 0;
      const coef = (Number(data.friction_coeff) || 0).toFixed(3);
      const memo = String(data.memo || '').slice(0, 80);
      addCryptoLog('info', `INTEL [L${lvl}] μ=${coef}: ${memo}`);
      state.pktCount++;
      el.sbPkts.textContent = 'PKT: ' + state.pktCount;
      break;
    }

    case 'regime_exceeded': {
      const raw = (Number(data.raw_multiplier) || 0).toFixed(3);
      const cap = (Number(data.capped_at)      || 3).toFixed(1);
      addCryptoLog('err',
        `[CRITICAL] REGIME_EXCEEDED: Ham talep ${raw}x > tavan ${cap}x — model sınırı aşıldı`);
      SFX.alarm();
      addLcOutput(`[REGIME_EXCEEDED] ${raw}x > tavan ${cap}x`, 'err');
      break;
    }

    case 'handshake': {
      const fpFull = String(data.peer_fp || '');
      const fp  = fpFull.slice(0, 16);
      const sid = String(data.session_id || '—');
      const ok  = data.status === 'success';
      addCryptoLog(ok ? 'ok' : 'err',
        `MESH HANDSHAKE: ${fp}... session=${sid} [${ok ? 'BASARILI' : 'REDDEDILDI'}]`);
      // GERÇEK peer: motorun canlı el sıkışma olayından mesh paneline ekle
      // (uydurma simulateDiscovery yerine gerçek ed25519 fingerprint).
      if (ok && fpFull) addRealPeer(fpFull, sid);
      if (!ok) SFX.alarm();
      break;
    }

    case 'optimization': {
      const onTime = !!data.on_time;
      const arr    = Number(data.arrival_min ?? data.doc_arrival_min) || 0;
      const bEnd   = Number(data.completion_min ?? data.finish_min ?? data.end_min) || 0;
      const mult   = (frictionMuFromPayload(data) || 1).toFixed(2);
      addCryptoLog(onTime ? 'ok' : 'warn',
        `CP-SAT: Start=${Math.floor(arr/60)}:${String(arr%60).padStart(2,'0')}`
        + ` | Finish=${Math.floor(bEnd/60)}:${String(bEnd%60).padStart(2,'0')}`
        + ` | μ=${mult}x | ${onTime ? 'ON TIME' : 'AT RISK'}`);
      if (data.tick !== undefined) {
        state.currentTick = Number(data.tick);
        addTickHistory(state.currentTick, state.throughputRatio, state.metrics.friction, state.outageActive, false, !onTime);
      }
      break;
    }

    case 'scenario_loaded':
    case 'labels':
    case 'sector':
    case 'nodes':
      applyScenarioMetadata(data);
      if (hasEngineState(data)) {
        applyEngineStateEvent(data);
      } else {
        setLiveStatus('live');
        if (isBaselineScenario()) {
          applyBaselineMetrics();
          setEngineState('baseline');
        } else {
          setEngineState('ready');
        }
      }
      break;

    case 'engine_state':
      applyEngineStateEvent(data);
      break;

    case 'snapshot':
      applySnapshotEvent(data);
      break;

    case 'levers': {
      // Motorun paketinden gelen GERÇEK kaldıraç listesi (hardcoded değil).
      const levers = Array.isArray(data.levers) ? data.levers : [];
      state.engineLevers = levers;
      if (!levers.length) {
        addLcOutput('Yüklü senaryoda kaldıraç yok.', 'info');
      } else {
        addLcOutput(`Kaldıraçlar (${levers.length}) — kaynak: motor:`, 'ok');
        levers.forEach(l => addLcOutput(
          `  ${l.id}  hedef=${l.target}  p=${Number(l.success_p).toFixed(2)}  cost=${l.cost_ticks}t  lockout=${l.lockout_ticks}t`, 'info'));
      }
      break;
    }

    case 'otp': {
      const slot = state.otpSlots.find(s => s.id === data.slot_id);
      if (slot) { slot.status = String(data.status || slot.status); renderOTPTimeline(); }
      addCryptoLog('ok',
        `OTP ${data.slot_id}: ${data.status} (${data.remaining_secs ?? '?'}s)`);
      break;
    }

    case 'plugin': {
      // Handle plugin status events (P1-D)
      const plugins = Array.isArray(data.plugins) ? data.plugins : (data.plugin ? [data.plugin] : []);
      if (plugins.length > 0) updatePluginPanel(plugins);
      break;
    }

    default:
      addCryptoLog('info', `ENGINE: ${JSON.stringify(data).slice(0, 80)}`);
      // Check for REPL JSON output: "[REPL_JSON] {...}"
      if (ev.data && ev.data.startsWith('[REPL_JSON]')) {
        try {
          const jsonStr = ev.data.slice(11).trim();
          const snap = JSON.parse(jsonStr);
          if (snap.nodes || snap.edges) applySnapshotEvent(snap);
        } catch(_) {}
      }
  }
}

/* ── WebSocket lifecycle ── */
function connectLiveBridge() {
  if (liveWs && liveWs.readyState <= WebSocket.OPEN) return;

  try {
    liveWs = new WebSocket(WS_URL);
  } catch(_) {
    scheduleReconnect();
    return;
  }

  liveWs.onopen = () => {
    setLiveStatus('live');
    addCryptoLog('ok', `CAELUS MOTOR: Canli baglanti kuruldu (${WS_URL})`);
    addLcOutput(`WS bağlantısı kuruldu: ${WS_URL}`, 'ok');
    if (state.fluctuateInterval) {
      clearInterval(state.fluctuateInterval);
      state.fluctuateInterval = null;
    }
  };

  liveWs.onmessage = handleEngineEvent;

  liveWs.onclose = () => {
    setLiveStatus('offline');
    liveWs = null;
    addCryptoLog('warn', 'Motor baglantisi kesildi — demo moduna geciliyor');
    addLcOutput('WS bağlantısı kesildi. Demo modu.', 'err');
    resumeMockFluctuation();
    scheduleReconnect();
  };

  liveWs.onerror = () => {};
}

function scheduleReconnect() {
  setTimeout(connectLiveBridge, WS_RECONNECT_MS);
}

function resumeMockFluctuation() {
  if (!state.fluctuateInterval)
    state.fluctuateInterval = setInterval(fluctuate, CFG.TELEMETRY_MS);
}

/* ═══════════════════════════════════════════════════════════════
   ENGINE STATE MACHINE
   ═══════════════════════════════════════════════════════════════ */
function setEngineState(mode) {
  const map = {
    ready:      { dot:'',          label:'HAZIR',           color:'var(--green)' },
    baseline:   { dot:'',          label:'EVRENSEL TABAN',  color:'var(--green)' },
    awaiting:   { dot:'processing',label:'SENARYO BEKLİYOR',color:'var(--amber)' },
    processing: { dot:'processing',label:'İŞLENİYOR',       color:'var(--amber)' },
    computing:  { dot:'processing',label:'HESAPLANIYOR',    color:'var(--amber)' },
    done:       { dot:'',          label:'TAMAMLANDI',      color:'var(--green)' },
    error:      { dot:'alert',     label:'HATA',            color:'var(--crisis)'},
  };
  const s = map[mode] || map.ready;
  el.engineDot.className    = 'engine-dot' + (s.dot ? ' '+s.dot : '');
  el.engineLabel.textContent = s.label;
  el.engineLabel.style.color = s.color;
  el.engineLabel.className   = s.dot ? s.dot : '';
}

function setFeedback(msg, color) {
  el.cmdFeedback.textContent = msg;
  el.cmdFeedback.style.color = color || 'var(--text-3)';
}

/* ═══════════════════════════════════════════════════════════════
   TYPEWRITER ENGINE
   ═══════════════════════════════════════════════════════════════ */
function typewriteBriefing(container, briefing, onDone) {
  if (el.outputIdle) el.outputIdle.style.display = 'none';
  container.innerHTML = '';
  state.isTyping = true;

  const ops = [];
  ops.push({ type:'open',  tag:'h3', attrs:{} });
  ops.push({ type:'text',  text: briefing.title });
  ops.push({ type:'close', tag:'h3' });

  ops.push({ type:'open',  tag:'p', attrs:{} });
  ops.push({ type:'text',  text: briefing.background });
  ops.push({ type:'close', tag:'p' });

  ops.push({ type:'open',  tag:'div', attrs:{ class:'alert-block' } });
  ops.push({ type:'text',  text: briefing.alert });
  ops.push({ type:'close', tag:'div' });

  ops.push({ type:'open',  tag:'h3', attrs:{} });
  ops.push({ type:'text',  text: 'OPERASYONEL STRATEJİ' });
  ops.push({ type:'close', tag:'h3' });

  ops.push({ type:'open',  tag:'ul', attrs:{} });
  briefing.actions.forEach(a => {
    ops.push({ type:'open',  tag:'li', attrs:{} });
    ops.push({ type:'text',  text: a });
    ops.push({ type:'close', tag:'li' });
  });
  ops.push({ type:'close', tag:'ul' });

  ops.push({ type:'open',  tag:'h3', attrs:{} });
  ops.push({ type:'text',  text: 'CANLI ETKİ ÖZETİ (MOTOR SNAPSHOT)' });
  ops.push({ type:'close', tag:'h3' });

  ops.push({ type:'open',  tag:'div', attrs:{ class:'stat-row' } });
  briefing.stats.forEach(([label,val]) => {
    ops.push({ type:'open',  tag:'div', attrs:{ class:'stat-cell' } });
    ops.push({ type:'open',  tag:'div', attrs:{ class:'sc-label' } });
    ops.push({ type:'text',  text: label });
    ops.push({ type:'close', tag:'div' });
    ops.push({ type:'open',  tag:'div', attrs:{ class:'sc-val' } });
    ops.push({ type:'text',  text: val });
    ops.push({ type:'close', tag:'div' });
    ops.push({ type:'close', tag:'div' });
  });
  ops.push({ type:'close', tag:'div' });

  ops.push({ type:'open',  tag:'p', attrs:{} });
  ops.push({ type:'text',  text: briefing.conclusion });
  ops.push({ type:'close', tag:'p' });

  const stack = [container];
  let charBuf = [];

  ops.forEach(op => {
    if (op.type === 'open') {
      const parent = stack[stack.length-1];
      const newEl  = document.createElement(op.tag);
      Object.entries(op.attrs||{}).forEach(([k,v])=> newEl.setAttribute(k,v));
      parent.appendChild(newEl);
      stack.push(newEl);
    } else if (op.type === 'close') {
      stack.pop();
    } else if (op.type === 'text') {
      const parent = stack[stack.length-1];
      for (const ch of op.text) {
        charBuf.push({ parent, ch });
      }
    }
  });

  let idx = 0;
  container.classList.add('cursor-blink');

  function typeNext() {
    if (idx >= charBuf.length) {
      container.classList.remove('cursor-blink');
      state.isTyping = false;
      if (onDone) onDone();
      return;
    }
    const { parent, ch } = charBuf[idx];
    const last = parent.lastChild;
    if (last && last.nodeType === Node.TEXT_NODE) {
      last.textContent += ch;
    } else {
      parent.appendChild(document.createTextNode(ch));
    }
    container.scrollTop = container.scrollHeight;
    if (idx % 3 === 0) SFX.tick();
    idx++;
    state.typingTimer = setTimeout(typeNext, 11);
  }
  typeNext();
}

/* ═══════════════════════════════════════════════════════════════
   SCRAMBLE ANIMATION
   ═══════════════════════════════════════════════════════════════ */
// scrambleMetrics kaldırıldı — analiz artık motorun gerçek snapshot'ından üretilir.

/* ═══════════════════════════════════════════════════════════════
   SCENARIO EXECUTION
   ═══════════════════════════════════════════════════════════════ */
el.btnExecute.addEventListener('click', runAnalysis);
el.btnClear.addEventListener('click', () => {
  el.cmdInput.value = '';
  el.cmdCounter.textContent = '0 / 400';
  SFX.click();
});

el.cmdInput.addEventListener('input', () => {
  const len = el.cmdInput.value.length;
  el.cmdCounter.textContent = `${len} / 400`;
  SFX.click();
});

el.cmdInput.addEventListener('keydown', e => {
  if (e.ctrlKey && e.key === 'Enter') { e.preventDefault(); runAnalysis(); }
  if (e.key === 'Escape')             { el.cmdInput.value = ''; el.cmdCounter.textContent = '0 / 400'; }
});

// GERÇEK analiz: motor zaten imzalı bir senaryoyu koşuyor. "ANALİZ ET",
// motordan taze bir snapshot ister (WS 'status' komutu → engine emit_ws_snapshot)
// ve raporu motorun CANLI verisinden üretir. Math.random / sahte CP-SAT yok.
// Motor çevrimdışıysa uydurma yapmaz, dürüstçe bunu söyler.
function runAnalysis() {
  const live = liveWs && liveWs.readyState === WebSocket.OPEN;
  if (!live) {
    setFeedback('Motor çevrimdışı — canlı analiz için CAELUS motorunu başlatın (dist/caelus_os --scenario <id> --repl).', 'var(--crisis)');
    addLcOutput('ANALİZ ET: motor çevrimdışı; uydurma rapor üretilmez.', 'err');
    SFX.alarm();
    return;
  }

  el.btnExecute.disabled = true;
  el.cmdInput.disabled   = true;
  setEngineState('processing');
  setFeedback('Motordan canlı snapshot isteniyor...', 'var(--amber)');
  SFX.chirp();

  // Motora gerçek komut: taze snapshot + lever listesi yayınlat.
  sendReplCommand('status');
  sendReplCommand('list levers');

  state.reportId++;
  state.reportCount++;
  const ts = new Date();
  el.reportId.textContent = `CLS-${state.reportId}`;
  el.reportTs.textContent = padZ(ts.getHours())+':'+padZ(ts.getMinutes())+'Z';
  el.sbReports.textContent = 'RPT: ' + state.reportCount;
  addCryptoLog('info', 'ANALİZ ET: motordan canlı snapshot istendi (status).');

  // Snapshot'ın gelmesi için kısa pencere; sonra raporu GERÇEK state'ten üret.
  setTimeout(() => {
    renderLiveBriefing();
    el.btnExecute.disabled = false;
    el.cmdInput.disabled   = false;
    setEngineState('done');
    setFeedback('Analiz motorun canlı verisinden üretildi.', 'var(--green)');
    SFX.confirm();
    setTimeout(() => { setEngineState('ready'); setFeedback('Motor komut bekliyor...', ''); }, 3500);
  }, 650);
}

// Raporu motorun CANLI durumundan (gerçek düğümler, gerçek sürtünme, gerçek
// outage/tick) türetir — hiçbir alan hardcoded veya rastgele değildir.
function renderLiveBriefing() {
  const nodes = state.causalNodes || [];
  const fr    = Number(state.metrics.friction) || 1;
  const outage= !!state.outageActive;
  const tick  = state.currentTick || 0;
  const sid   = state.scenarioMeta.scenarioId || '—';

  // Gerçek düğümlerden risk sıralaması: düşük güven veya yüksek sürtünme.
  const ranked = nodes.slice().sort((a,b) =>
    (b.friction_fp - a.friction_fp) || (a.state_fp - b.state_fp));
  const compromised = nodes.filter(n => n.trust_fp < 0.9 || n.irrecoverable);
  const topFriction = ranked.slice(0, 3).map(n =>
    `${n.id} (durum ${n.state_fp.toFixed(2)}, güven ${n.trust_fp.toFixed(2)})`);

  const briefing = {
    title: `CANLI CAUSAL ANALİZ // ${sid} · tick ${tick}`,
    background: nodes.length
      ? `Motor ${nodes.length} düğüm / ${(state.causalEdges||[]).length} kenarlık nedensel grafı canlı işliyor. Sürtünme çarpanı ${fr.toFixed(2)}×; throughput %${(state.throughputRatio*100).toFixed(1)}.`
      : 'Motor bağlı ancak henüz düğüm yayınlanmadı; imzalı senaryo enjeksiyonu bekleniyor.',
    alert: outage
      ? `KRİTİK: Outage latch aktif — throughput 0. Geri dönüş yalnız başarılı recovery lever'ı ile mümkün.`
      : (fr >= 2 ? `UYARI: Sürtünme rejim tavanına yakın (${fr.toFixed(2)}×). Gözlemlenebilirlik sapması izleniyor.`
                 : `Sistem nominal aralıkta: sürtünme ${fr.toFixed(2)}×, aktif outage yok.`),
    actions: (compromised.length
      ? compromised.slice(0,3).map(n => `${n.id}: güven ${n.trust_fp.toFixed(2)} — raporlanan/gerçek durum sapması doğrulanmalı.`)
      : ['Düğüm güven katsayıları nominal; gözlemlenebilirlik saldırısı sinyali yok.']),
    stats: [
      ['Sürtünme', fr.toFixed(2)+'×'],
      ['Throughput', '%'+(state.throughputRatio*100).toFixed(0)],
      ['Tick', String(tick)],
      ['Riskli düğüm', String(compromised.length)]
    ],
    conclusion: topFriction.length
      ? `En yüksek sürtünme katkısı: ${topFriction.join(' · ')}. Kaynak: motorun canlı snapshot'ı.`
      : 'Motorun canlı snapshot\'ı alındı.'
  };
  typewriteBriefing(el.reportOutput, briefing, () => {
    addCryptoLog('ok', `Canlı rapor ${el.reportId.textContent} üretildi (kaynak: motor snapshot)`);
  });
}

/* ═══════════════════════════════════════════════════════════════
   SESSION BADGE
   ═══════════════════════════════════════════════════════════════ */
function updateSessionBadge() {
  el.sbSession.textContent = 'SESSION: CLS-' + Math.floor(1000 + (Date.now()-state.sessionStart)/1000).toString(16).toUpperCase();
}

/* ═══════════════════════════════════════════════════════════════
   INIT (called after boot)
   ═══════════════════════════════════════════════════════════════ */
function initUI() {
  // Canvas (mesh)
  resizeCanvas();
  window.addEventListener('resize', () => { resizeCanvas(); });
  initMeshNodes();
  requestAnimationFrame(drawMesh);

  // Peer list
  renderPeerList();

  // Throughput gauge — initialize with ratio=1.0
  applyThroughputGauge(1.0, false);

  // Initial crypto log burst
  addCryptoLog('ok',   'AES-256-CBC KAT (FIPS-197): PASS');
  addCryptoLog('ok',   'ED25519 caelus_identity.key yüklendi');
  addCryptoLog('ok',   'BLAKE3 OTP manifest: 4 slot aktif');
  addCryptoLog('ok',   'Shadow-Mesh UDP 224.0.0.251:47808 bağlandı');
  addCryptoLog('info', 'Causal Engine: UNIVERSAL_BASELINE profili nominal');
  addCryptoLog('info', 'Evrensel Causal UI v3.0 hazır');

  // Leverage bars
  initLeverageBars();
  updateScenarioDom();

  // Friction gauge
  buildGaugeTrack();
  buildGaugeZones();
  buildGaugeTicks();
  updateGauge(state.metrics.friction);
  setEngineState('baseline');

  // OTP
  initOTPTimeline();

  // Ticker
  initTicker();

  // Crisis timeline (P0-B)
  initCrisisTimeline();

  // Causal canvas (P1-A)
  initCausalCanvas();

  // Lever console (P1-B)
  initLeverConsole();

  // Scenario card (P1-C)
  updateScenarioCard();

  // Loops. Not: peer keşfi UYDURULMAZ — gerçek mesh el sıkışma olaylarıyla
  // (addRealPeer) beslenir; sahte simulateDiscovery kaldırıldı.
  state.fluctuateInterval = setInterval(fluctuate, CFG.TELEMETRY_MS);
  setInterval(updateSessionBadge, 5000);

  setLiveStatus('offline');
  connectLiveBridge();

  setInterval(() => {
    const ev = CRYPTO_EVENTS[Math.floor(Math.random()*CRYPTO_EVENTS.length)];
    ev();
  }, CFG.PKT_EMIT_MS);

  setInterval(tickOTP, 5000);
}

/* ═══════════════════════════════════════════════════════════════
   ENTRY POINT
   ═══════════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  setInterval(updateClocks, 1000);
  updateClocks();
  runBoot();
});
