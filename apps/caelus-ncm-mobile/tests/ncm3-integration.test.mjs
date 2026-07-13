import assert from "node:assert/strict";
import test from "node:test";
import { compileNeuralScenario, observeTemporalSnapshot } from "../lib/neurocausal.mjs";

const PROMPTS = {
  maritime: "Saat 08.00’de başlayan fırtına nedeniyle Kuşadası–Samos feribot seferleri 48 saat durduruldu. Yolcu sayısı, otel doluluğu ve alternatif sefer bilgisi verilmedi. Etki nedir?",
  cyber: "Siber saldırı yok. Planlı bakım nedeniyle API 20 dakika salt okunur olacak; veri kaybı olmayacak. Etki nedir?",
  energy: "Şebeke 90 dakika kesilecek. Jeneratör sürekli 80 kW sağlayabiliyor; sabit yük 100 kW. Batarya ve başka kaynak yok.",
  nonsense: "Mavi tedarikçi kırmızı motoru üç fikir boyunca saatte yedi sessizlikle besliyor. Riski hesapla.",
  live: "Şu anda Samos limanında kaç gemi var ve bir sonraki feribot meteorolojiye göre iptal mi?",
};

function calculation(result, label) {
  const item = result.analysis.grounding.calculations.find((candidate) => candidate.label === label);
  assert.ok(item, `missing calculation: ${label}`);
  return item;
}

test("NCM-3 desteklenen kapalı çözücüde birim ve aritmetiği korur", () => {
  const result = compileNeuralScenario(PROMPTS.energy);

  assert.equal(result.analysis.model, "NCM-3.0.0");
  assert.equal(result.analysis.sector, "ENERGY");
  assert.equal(result.analysis.grounding.mode, "grounded");
  assert.equal(result.analysis.grounding.knowledgePack.id, "NCM3-POWER-ENERGY-BALANCE");
  assert.deepEqual(
    [calculation(result, "deficit_power").result, calculation(result, "deficit_power").unit],
    [20, "kW"],
  );
  assert.deepEqual(
    [calculation(result, "energy_shortfall").result, calculation(result, "energy_shortfall").unit],
    [30, "kWh"],
  );
  assert.equal(result.analysis.gateAudit.accepted, true);
  assert.equal(result.pack.meta.engine_authority, "RUST_WASM");
  assert.equal(result.pack.meta.answer_authority, "NCM3_EVIDENCE_REASONER");
  assert.equal(result.pack.meta.wasm_role, "SCENARIOPACK_STATE_VALIDATOR");
  assert.equal(result.pack.meta.neural_model, result.analysis.semanticEncoder);
});

test("kanıt paketi kalibre edilmemiş dinamik durum veya sahte deadline üretmez", () => {
  for (const prompt of [PROMPTS.energy, PROMPTS.maritime, PROMPTS.nonsense]) {
    const result = compileNeuralScenario(prompt);
    const model = result.pack.extended_causal_model;
    assert.ok(model.nodes.every((node) => node.state_fp === 0 && node.deadline_tick === -1));
    assert.ok(model.edges.every((edge) => edge.multiplier_fp === 0));
    assert.deepEqual(model.hard_deadlines, []);
    assert.equal(result.analysis.severity, 0);
    assert.equal(result.analysis.observerProposal.usedForAnswer, false);
  }
});

test("gerçekleşmiş denizcilik kesintisi etki büyüklüğü uydurmaz", () => {
  const result = compileNeuralScenario(PROMPTS.maritime);
  const grounding = result.analysis.grounding;
  const text = JSON.stringify(grounding);

  assert.equal(result.analysis.sector, "MARITIME");
  assert.equal(grounding.mode, "grounded");
  assert.equal(grounding.knowledgePack.id, "NCM3-MARITIME-SERVICE-CONTINUITY");
  assert.equal(calculation(result, "service_stop_duration").result, 48);
  assert.ok(grounding.unknowns.some((item) => item.id === "UNK-PASSENGERS"));
  assert.ok(grounding.unknowns.some((item) => item.id === "UNK-HOTEL"));
  assert.doesNotMatch(text, /otel doluluğu kesin|gelir kaybı \d|risk skoru|olasılık yüzde/i);
  assert.equal(result.pack.meta.calibrated_probability_available, false);
  assert.equal(result.pack.extended_causal_model.levers.length, 0);
});

test("negasyon saldırı zincirine çevrilmez", () => {
  const result = compileNeuralScenario(PROMPTS.cyber);
  const grounding = result.analysis.grounding;

  assert.equal(result.analysis.sector, "CYBER");
  assert.equal(grounding.mode, "grounded");
  assert.ok(grounding.claims.some((claim) => claim.id === "OBS-ATTACK-FALSE" && claim.type === "FACT"));
  assert.ok(grounding.claims.some((claim) => claim.id === "OBS-DATA-LOSS-FALSE" && claim.type === "FACT"));
  assert.ok(!grounding.relations.some((edge) => /saldırı|fidye|sızıntı/i.test(edge.from) && edge.relation === "CAUSES"));
  assert.doesNotMatch(grounding.directAnswer, /fidye yazılımı|ihlal gerçekleşti|veri sızıntısı gerçekleşti/i);
});

test("eşleşmeyen ve tanımsız girdi fail-closed kalır", () => {
  const result = compileNeuralScenario(PROMPTS.nonsense);

  assert.equal(result.analysis.sector, "UNIVERSAL");
  assert.equal(result.analysis.grounding.mode, "insufficient");
  assert.equal(result.analysis.grounding.coverage.abstained, true);
  assert.equal(result.analysis.gateAudit.accepted, false);
  assert.equal(result.analysis.strongestRelations.length, 0);
  assert.equal(result.analysis.horizons.length, 0);
  assert.equal(result.analysis.counterfactuals.length, 0);
  assert.equal(result.pack.extended_causal_model.levers.length, 0);
  assert.doesNotMatch(result.analysis.executiveSummary, /MARITIME|CYBER|ENERGY|SUPPLY|%\d/);
});

test("zaman damgalı kaynak yoksa canlı durum uydurulmaz", () => {
  const result = compileNeuralScenario(PROMPTS.live);
  const grounding = result.analysis.grounding;

  assert.equal(grounding.mode, "insufficient");
  assert.equal(grounding.sourceTime, null);
  assert.equal(grounding.knowledgePack.id, "NCM3-LIVE-DATA-GATE");
  assert.ok(grounding.requiredInputs.some((item) => /AIS/i.test(item)));
  assert.ok(grounding.requiredInputs.some((item) => /meteoroloji/i.test(item)));
  assert.doesNotMatch(grounding.directAnswer, /\b\d+ gemi\b|muhtemelen iptal|büyük ihtimalle iptal/i);
});

test("aynı girdi byte düzeyinde deterministiktir", () => {
  const outputs = Array.from({ length: 5 }, () => JSON.stringify(compileNeuralScenario(PROMPTS.energy)));
  assert.equal(new Set(outputs).size, 1);
});

test("snapshot gözlemi otoriteli paketi ve kanıta bağlı cevabı değiştirmez", () => {
  const original = compileNeuralScenario(PROMPTS.maritime);
  const packBefore = structuredClone(original.pack);
  const groundingBefore = structuredClone(original.analysis.grounding);
  const horizonsBefore = structuredClone(original.analysis.horizons);
  const counterfactualsBefore = structuredClone(original.analysis.counterfactuals);
  const snapshot = {
    tick: 11,
    nodes: original.pack.extended_causal_model.nodes.map((node, index) => ({ id: node.id, state: 0.22 + index * 0.05 })),
  };
  const observed = observeTemporalSnapshot(original, snapshot);

  assert.deepEqual(observed.pack, packBefore);
  assert.deepEqual(observed.analysis.grounding, groundingBefore);
  assert.deepEqual(observed.analysis.horizons, horizonsBefore);
  assert.deepEqual(observed.analysis.counterfactuals, counterfactualsBefore);
  assert.equal(observed.analysis.observerTick, 11);
});

test("arayüze aktarılan ufuk ve karşı-olgular kalibre yüzde iddiası taşımaz", () => {
  for (const prompt of [PROMPTS.maritime, PROMPTS.cyber, PROMPTS.energy]) {
    const result = compileNeuralScenario(prompt);
    assert.ok(result.analysis.horizons.every((item) => item.calibrated === false));
    assert.ok(result.analysis.horizons.every((item) => item.expected.risk === 0 && item.expected.throughput === 0));
    assert.ok(result.analysis.counterfactuals.every((item) => item.calibrated === false));
    assert.ok(result.analysis.counterfactuals.every((item) => item.risk === 0 && item.throughput === 0));
  }
});
