import assert from "node:assert/strict";
import test from "node:test";
import { compileNeuralScenario, observeTemporalSnapshot } from "../lib/neurocausal.mjs";

const PROMPTS = {
  maritime: "Samos feribot seferleri fırtına nedeniyle 48 saat durursa yolcu, otel ve liman operasyonu nasıl etkilenir?",
  cyber: "Fidye yazılımı kimlik sunucularını şifreler fakat yedekler sağlam kalırsa ilk 6 saatte hangi servisler etkilenir?",
  energy: "Aşırı sıcak nedeniyle elektrik talebi %30 artar ve iki trafo devre dışı kalırsa 24 saatte hastane beslemesi nasıl korunur?",
  health: "Hastanede oksijen tedariki iki gün kesilirse önce ameliyatlar, ardından ambulans yönlendirmesi ve çevre hastanelerin doluluğu nasıl değişir?",
  cross: "Liman vinç yazılımına siber saldırı olurken fırtına feribotları geciktirirse 72 saatte gıda sevkiyatı nasıl etkilenir?",
  negation: "Siber saldırı yok. Planlı bakım nedeniyle API 20 dakika salt okunur olacak; müşteri verisi kaybolmayacak. Etki nedir?",
  short: "Liman yükleme sistemi 30 dakika kesilirse ne olur?",
  long: "Liman yükleme sistemi 3 hafta kesilirse ne olur?",
  protected: "Veri merkezinde şebeke 8 saat kesilir; yedek jeneratör devreye girerse servisler nasıl ilerler?",
  unprotected: "Veri merkezinde şebeke 8 saat kesilir; yedek jeneratör devreye girmezse servisler nasıl ilerler?",
  finance: "Merkez bankası faiz artırınca kur düşer; ancak ithalat finansmanı daralırsa iki ay sonra liman hacmi ve KOBİ iflasları nasıl etkilenir?",
  supply: "Boğazdaki sis Ro-Ro geçişini 18 saat durdurursa otomotiv fabrikasının stok tamponu ve vardiyası nasıl etkilenir?",
};

test("NCM-2 tek alan benchmarkında doğru bağlamı korur", () => {
  const expected = { maritime: "MARITIME", cyber: "CYBER", energy: "ENERGY", health: "HEALTH", finance: "FINANCE", supply: "SUPPLY" };
  for (const [key, sector] of Object.entries(expected)) {
    const result = compileNeuralScenario(PROMPTS[key]);
    assert.equal(result.analysis.sector, sector, key);
    assert.ok(result.analysis.concepts.length >= 6, key);
    assert.ok(result.analysis.strongestRelations.every((edge) => edge.mechanism && edge.evidence.length), key);
  }
});

test("çapraz alan gözlemcisi siber, denizcilik ve tedarik dallarını birlikte taşır", () => {
  const result = compileNeuralScenario(PROMPTS.cross);
  assert.deepEqual(new Set(result.analysis.activeDomains), new Set(["MARITIME", "CYBER", "SUPPLY"]));
  assert.ok(result.analysis.concepts.includes("Liman vinç yazılımı"));
  assert.ok(result.analysis.concepts.includes("Gıda sevkiyatı"));
  assert.ok(result.analysis.strongestRelations.some((edge) => edge.from.includes("Saldırı") || edge.from.includes("Fırtına")));
  assert.ok(result.analysis.gateAudit.graphDepth >= 3);
});

test("negasyon aktif kriz üretmez ve planlı kısa bakımı düşük riskte tutar", () => {
  const result = compileNeuralScenario(PROMPTS.negation);
  assert.ok(result.analysis.severity < 0.30);
  assert.ok(result.analysis.observerProposal.situation.negatedEvents.includes("ATTACK"));
  assert.ok(!result.analysis.strongestRelations.some((edge) => edge.from.startsWith("Saldırı")));
  assert.ok(result.analysis.horizons.at(-1).expected.risk < 0.35);
});

test("süre ölçeği kısa kesintiyi üç haftalık kesintiden ayırır", () => {
  const short = compileNeuralScenario(PROMPTS.short);
  const long = compileNeuralScenario(PROMPTS.long);
  assert.equal(short.analysis.sector, "MARITIME");
  assert.equal(long.analysis.sector, "MARITIME");
  assert.ok(long.analysis.severity - short.analysis.severity >= 0.25);
  assert.ok(long.analysis.horizons.at(-1).expected.risk - short.analysis.horizons.at(-1).expected.risk >= 0.20);
});

test("yedek jeneratör karşı-olgusu risk sıralamasını değiştirir", () => {
  const protectedCase = compileNeuralScenario(PROMPTS.protected);
  const failedCase = compileNeuralScenario(PROMPTS.unprotected);
  assert.ok(failedCase.analysis.severity - protectedCase.analysis.severity >= 0.20);
  assert.ok(failedCase.analysis.horizons[0].expected.risk - protectedCase.analysis.horizons[0].expected.risk >= 0.20);
  assert.notDeepEqual(protectedCase.analysis.counterfactuals, failedCase.analysis.counterfactuals);
});

test("çıktı özgül kavram, zaman ufku, karşı-olgusal ve görünür varsayım taşır", () => {
  const result = compileNeuralScenario(PROMPTS.maritime);
  const banned = new Set(["Saat", "Durursa", "Ederken", "Devam", "Olursa", "Nedeniyle"]);
  assert.ok(result.analysis.concepts.every((concept) => !banned.has(concept)));
  assert.ok(["Samos", "Feribot seferleri", "Fırtına", "Yolcu", "Otel", "Liman"].every((concept) => result.analysis.concepts.includes(concept)));
  assert.equal(result.analysis.horizons.length, 3);
  assert.equal(result.analysis.counterfactuals.length, 3);
  assert.ok(result.analysis.assumptions.length >= 3);
  assert.ok(result.analysis.unknowns.length >= 3);
  assert.doesNotMatch(result.analysis.executiveSummary, /öğrenilmiş bir etkileşim grafiği kuruldu/i);
});

test("aynı girdi byte düzeyinde deterministiktir", () => {
  const outputs = Array.from({ length: 5 }, () => JSON.stringify(compileNeuralScenario(PROMPTS.cross)));
  assert.equal(new Set(outputs).size, 1);
});

test("temporal observer authoritative paketi değiştirmeden snapshot gözlemler", () => {
  const original = compileNeuralScenario(PROMPTS.maritime);
  const packBefore = structuredClone(original.pack);
  const snapshot = {
    tick: 11,
    nodes: original.pack.extended_causal_model.nodes.map((node, index) => ({ id: node.id, state: 0.22 + index * 0.05 })),
  };
  const observed = observeTemporalSnapshot(original, snapshot);
  assert.deepEqual(observed.pack, packBefore);
  assert.equal(observed.analysis.observerTick, 11);
  assert.notDeepEqual(observed.analysis.horizons, original.analysis.horizons);
});
