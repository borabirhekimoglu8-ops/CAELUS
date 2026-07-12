#!/usr/bin/env node

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const INPUT = 144;
const HIDDEN = 48;
const SECTORS = [
  "MARITIME", "AVIATION", "SUPPLY", "FINANCE", "CYBER",
  "HEALTH", "ENERGY", "SPACE", "SECURITY", "BUSINESS", "UNIVERSAL",
];
const EXTRA = 1 + 6 + 8 + 4 + 6;
const OUTPUT = SECTORS.length + EXTRA;

const lexicon = {
  MARITIME: ["liman", "gemi", "feribot", "sefer", "yolcu", "rıhtım", "iskele", "deniz", "konteyner", "gümrük", "port", "ship", "ferry", "vessel"],
  AVIATION: ["uçak", "uçuş", "havayolu", "havalimanı", "pist", "slot", "terminal", "airport", "airline", "flight", "aviation"],
  SUPPLY: ["tedarik", "lojistik", "depo", "stok", "fabrika", "üretim", "sevkiyat", "supply", "warehouse", "inventory", "factory", "shipment"],
  FINANCE: ["banka", "faiz", "kur", "döviz", "enflasyon", "borsa", "likidite", "kredi", "finance", "bank", "market", "currency", "liquidity"],
  CYBER: ["siber", "hack", "sunucu", "veri", "yazılım", "api", "ağ", "fidye", "server", "database", "network", "cyber", "ransomware"],
  HEALTH: ["hastane", "hasta", "ilaç", "sağlık", "salgın", "doktor", "ambulans", "hospital", "patient", "medicine", "health", "epidemic"],
  ENERGY: ["enerji", "elektrik", "petrol", "doğalgaz", "şebeke", "santral", "trafo", "energy", "power", "grid", "plant", "pipeline"],
  SPACE: ["uzay", "uydu", "roket", "yörünge", "mars", "astronot", "görev", "space", "satellite", "rocket", "orbit", "mission"],
  SECURITY: ["devlet", "savaş", "seçim", "sınır", "diplomasi", "ordu", "güvenlik", "kriz", "government", "war", "border", "diplomacy", "security"],
  BUSINESS: ["şirket", "müşteri", "satış", "pazar", "birleşme", "operasyon", "gelir", "personel", "company", "customer", "business", "revenue", "merger"],
  UNIVERSAL: ["sistem", "kaynak", "karar", "süreç", "hedef", "durum", "etki", "system", "resource", "decision", "process", "impact"],
};

const crisis = ["kriz", "saldırı", "çöküş", "yangın", "deprem", "fırtına", "iptal", "kesinti", "abluka", "grev", "salgın", "hack", "arıza", "kayıp", "tehdit", "acil"];
const templates = [
  "{a} nedeniyle {b} 48 saat durursa operasyon ne olur",
  "{a} kapasitesi düşerken {b} talebi hızla artarsa",
  "{a} arızası {b} üzerinde zincirleme etki yaratırsa",
  "{a} ve {b} aynı anda baskı altına girerse hangi eşik aşılır",
  "{a} kesintisi sonrası kritik {b} nasıl korunur",
  "{a} başarısız olur ve {b} güveni azalırsa senaryo",
  "{a} üzerindeki dış baskı {b} akışını iki gün geciktirirse",
  "{a} normale dönmezse {b} için en güçlü müdahale nedir",
];

let seed = 0x5cae1;
function random() {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 0x100000000;
}
function rand(min, max) { return min + (max - min) * random(); }
function matrix(rows, cols, scale) {
  return Array.from({ length: rows }, () => Array.from({ length: cols }, () => rand(-scale, scale)));
}
function vector(size) { return Array(size).fill(0); }

function fold(value) {
  return String(value).replace(/İ/g, "I").replace(/ı/g, "i").normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
function hash(value, salt = 0) {
  let h = (0x811c9dc5 ^ salt) >>> 0;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}
function features(text) {
  const normalized = fold(text);
  const tokens = normalized.split(/\s+/).filter(Boolean);
  const x = vector(INPUT);
  for (const token of tokens) {
    const bucket = hash(token) % 96;
    x[bucket] += (hash(token, 17) & 1) ? 1 : -1;
    const padded = `_${token}_`;
    for (let i = 0; i < padded.length - 2; i += 1) {
      const tri = padded.slice(i, i + 3);
      const triBucket = 96 + (hash(tri, 29) % 24);
      x[triBucket] += (hash(tri, 47) & 1) ? 0.35 : -0.35;
    }
  }
  const norm = Math.sqrt(x.reduce((sum, n) => sum + n * n, 0)) || 1;
  for (let i = 0; i < 120; i += 1) x[i] /= norm;
  SECTORS.forEach((sector, index) => {
    const anchors = lexicon[sector].map(fold);
    const hits = tokens.filter((token) => anchors.some((anchor) => token === anchor || token.startsWith(anchor) || anchor.startsWith(token))).length;
    x[120 + index] = Math.min(1, hits / 4);
  });
  x[131] = Math.min(1, tokens.length / 24);
  x[132] = /\d/.test(normalized) ? 1 : 0;
  x[133] = /saat|gun|hafta|dakika|hour|day|week/.test(normalized) ? 1 : 0;
  x[134] = crisis.some((word) => normalized.includes(fold(word))) ? 1 : 0;
  x[135] = /acil|kritik|derhal|emergency|critical/.test(normalized) ? 1 : 0;
  x[136] = /uluslararasi|sinir|global|international|border/.test(normalized) ? 1 : 0;
  x[137] = /art|yuksel|buyu|increase|surge/.test(normalized) ? 1 : 0;
  x[138] = /dur|kes|iptal|cok|fail|stop|cancel/.test(normalized) ? 1 : 0;
  x[139] = /azal|dus|kayip|reduce|drop|loss/.test(normalized) ? 1 : 0;
  x[140] = Math.min(1, new Set(tokens).size / 20);
  x[141] = Math.min(1, normalized.length / 300);
  x[142] = Math.min(1, crisis.filter((word) => normalized.includes(fold(word))).length / 3);
  x[143] = 1;
  return x;
}

function targetFor(sectorIndex, risk, sampleHash) {
  const y = vector(OUTPUT);
  y[sectorIndex] = 1;
  let cursor = SECTORS.length;
  y[cursor++] = Math.min(0.96, 0.35 + risk * 0.43 + (sampleHash % 13) / 100);
  for (let i = 0; i < 6; i += 1) y[cursor++] = Math.min(0.95, 0.28 + risk * 0.42 + ((sampleHash >>> (i * 3)) & 7) / 30);
  for (let i = 0; i < 8; i += 1) y[cursor++] = Math.min(0.98, 0.20 + risk * 0.48 + (((sampleHash + sectorIndex * 97 + i * 31) >>> 2) & 15) / 50);
  for (let i = 0; i < 4; i += 1) y[cursor++] = Math.max(0.42, Math.min(0.92, 0.84 - risk * 0.18 + (((sampleHash + i * 53) >>> 3) & 7) / 50));
  for (let i = 0; i < 6; i += 1) y[cursor++] = Math.min(0.95, 0.18 + risk * 0.54 + (((sampleHash + i * 71) >>> 4) & 7) / 40);
  return y;
}

const samples = [];
for (let s = 0; s < SECTORS.length; s += 1) {
  const sector = SECTORS[s];
  const words = lexicon[sector];
  for (let i = 0; i < 180; i += 1) {
    const a = words[Math.floor(random() * words.length)];
    const b = words[Math.floor(random() * words.length)];
    const template = templates[Math.floor(random() * templates.length)];
    const risk = i % 3 === 0 ? 1 : (i % 3 === 1 ? 0.62 : 0.28);
    const riskWord = risk > 0.8 ? crisis[Math.floor(random() * crisis.length)] : "baskı";
    const text = `${template.replace("{a}", a).replace("{b}", b)} ${riskWord}`;
    samples.push({ x: features(text), y: targetFor(s, risk, hash(text)) });
  }
}

const w1 = matrix(HIDDEN, INPUT, Math.sqrt(6 / (INPUT + HIDDEN)));
const b1 = vector(HIDDEN);
const w2 = matrix(OUTPUT, HIDDEN, Math.sqrt(6 / (HIDDEN + OUTPUT)));
const b2 = vector(OUTPUT);

function sigmoid(v) { return 1 / (1 + Math.exp(-Math.max(-18, Math.min(18, v)))); }
function softmax(values) {
  const max = Math.max(...values);
  const exp = values.map((v) => Math.exp(v - max));
  const total = exp.reduce((a, b) => a + b, 0);
  return exp.map((v) => v / total);
}

const rate = 0.045;
for (let epoch = 0; epoch < 220; epoch += 1) {
  for (let i = samples.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [samples[i], samples[j]] = [samples[j], samples[i]];
  }
  for (const sample of samples) {
    const hidden = w1.map((row, h) => Math.tanh(row.reduce((sum, weight, k) => sum + weight * sample.x[k], b1[h])));
    const raw = w2.map((row, o) => row.reduce((sum, weight, h) => sum + weight * hidden[h], b2[o]));
    const probabilities = softmax(raw.slice(0, SECTORS.length));
    const outputs = raw.map((v, o) => o < SECTORS.length ? probabilities[o] : sigmoid(v));
    const d2 = vector(OUTPUT);
    for (let o = 0; o < OUTPUT; o += 1) {
      if (o < SECTORS.length) d2[o] = outputs[o] - sample.y[o];
      else d2[o] = (outputs[o] - sample.y[o]) * outputs[o] * (1 - outputs[o]) * 0.55;
    }
    const dh = vector(HIDDEN);
    for (let h = 0; h < HIDDEN; h += 1) {
      let sum = 0;
      for (let o = 0; o < OUTPUT; o += 1) sum += w2[o][h] * d2[o];
      dh[h] = sum * (1 - hidden[h] * hidden[h]);
    }
    for (let o = 0; o < OUTPUT; o += 1) {
      for (let h = 0; h < HIDDEN; h += 1) w2[o][h] -= rate * d2[o] * hidden[h];
      b2[o] -= rate * d2[o];
    }
    for (let h = 0; h < HIDDEN; h += 1) {
      for (let k = 0; k < INPUT; k += 1) w1[h][k] -= rate * dh[h] * sample.x[k];
      b1[h] -= rate * dh[h];
    }
  }
}

let correct = 0;
for (const sample of samples) {
  const hidden = w1.map((row, h) => Math.tanh(row.reduce((sum, weight, k) => sum + weight * sample.x[k], b1[h])));
  const logits = w2.slice(0, SECTORS.length).map((row, o) => row.reduce((sum, weight, h) => sum + weight * hidden[h], b2[o]));
  const predicted = logits.indexOf(Math.max(...logits));
  const expected = sample.y.slice(0, SECTORS.length).indexOf(1);
  if (predicted === expected) correct += 1;
}

const rounded = (value) => Number(value.toFixed(6));
const model = {
  version: "NCM-1.1.0",
  architecture: "SEMANTIC_HASH_ENCODER_144_TANH_48_MULTITASK_GRAPH_HEAD",
  input: INPUT,
  hidden: HIDDEN,
  sectors: SECTORS,
  semanticLexicon: Object.fromEntries(SECTORS.map((sector) => [sector, lexicon[sector].map(fold)])),
  w1: w1.map((row) => row.map(rounded)),
  b1: b1.map(rounded),
  w2: w2.map((row) => row.map(rounded)),
  b2: b2.map(rounded),
};
const target = resolve("lib/neuro-weights.mjs");
writeFileSync(target, `// Generated by scripts/train-neurocausal.mjs — deterministic local neural weights.\nexport const NEURO_WEIGHTS = ${JSON.stringify(model)};\n`);
console.log(`trained ${samples.length} local samples · accuracy ${(correct / samples.length * 100).toFixed(2)}% · ${target}`);
