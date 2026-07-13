import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { compileNeuralScenario, NEURO_MODEL_INFO, runNeuralInference } from "../lib/neurocausal.mjs";

const developmentPreviewMeta =
  /<meta(?=[^>]*\bname=["']codex-preview["'])(?=[^>]*\bcontent=["']development["'])[^>]*>/i;

async function renderHome() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("mobil kanıt arayüzü ve geliştirme metadatası render edilir", async () => {
  const response = await renderHome();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, developmentPreviewMeta);
  assert.match(html, /CAELUS/);
  assert.match(html, /NCM/);
  assert.match(html, /GROUNDED CAUSAL ENGINE/);
  assert.match(html, /KANIT MOTORU YEREL/);
  assert.match(html, /BULUT KAPALI/);
  assert.match(html, /TRUTH GATE \+ WASM/);
  assert.match(html, /Kanıta bağlı analiz yap/);
  assert.doesNotMatch(html, /SİNİR AĞI CİHAZDA/);
  assert.doesNotMatch(html, /window\.location\.replace\("\/caelus\.html"\)/);
});

test("NCM-3 aynı girdide deterministiktir ve yalnız desteklenen bilgi paketini açar", () => {
  const maritime = "Saat 08.00’de başlayan fırtına nedeniyle Kuşadası–Samos feribot seferleri 48 saat durduruldu. Yolcu sayısı, otel doluluğu ve alternatif sefer bilgisi verilmedi. Etki nedir?";
  const cyber = "Siber saldırı yok. Planlı bakım nedeniyle API 20 dakika salt okunur olacak; veri kaybı olmayacak. Etki nedir?";
  const first = compileNeuralScenario(maritime);
  const replay = compileNeuralScenario(maritime);
  const other = compileNeuralScenario(cyber);

  assert.deepEqual(first, replay);
  assert.equal(first.analysis.cloudUsed, false);
  assert.equal(first.pack.meta.generated_by, "CAELUS_LOCAL_NCM3_EVIDENCE_REASONER");
  assert.equal(first.pack.meta.reasoner_model, NEURO_MODEL_INFO.version);
  assert.equal(first.pack.meta.neural_model, NEURO_MODEL_INFO.semanticEncoderVersion);
  assert.equal(first.pack.meta.truth_mode, "grounded");
  assert.equal(first.pack.meta.calibrated_probability_available, false);
  assert.equal(first.pack.meta.observer_authority, "ADVISORY_ONLY");
  assert.equal(first.pack.meta.engine_authority, "RUST_WASM");
  assert.equal(first.pack.meta.answer_authority, "NCM3_EVIDENCE_REASONER");
  assert.equal(first.pack.meta.wasm_role, "SCENARIOPACK_STATE_VALIDATOR");
  assert.equal(first.pack.extended_causal_model.nodes.length, 6);
  assert.ok(first.pack.extended_causal_model.edges.length >= 6);
  assert.equal(first.pack.extended_causal_model.levers.length, 0);
  assert.equal(first.analysis.sector, "MARITIME");
  assert.equal(other.analysis.sector, "CYBER");
  assert.notEqual(first.analysis.scenarioId, other.analysis.scenarioId);
  assert.notEqual(first.analysis.sector, other.analysis.sector);
  assert.ok(first.analysis.strongestRelations.length > 0);
  assert.ok(first.analysis.strongestRelations.every((relation) => relation.from && relation.to && relation.evidence.length));
  assert.ok(first.analysis.horizons.every((horizon) => horizon.calibrated === false));
  assert.ok(first.analysis.counterfactuals.every((branch) => branch.calibrated === false));
  assert.equal(first.analysis.gateAudit.accepted, true);
});

test("yerel anlamsal kodlayıcı danışmandır; Truth Gate eşleşmeyen çıktıyı reddeder", () => {
  const prompt = "Mor bir kararın etkisini tahmin et.";
  const output = runNeuralInference(prompt);
  const compiled = compileNeuralScenario(prompt);
  assert.equal(output.model, NEURO_MODEL_INFO.semanticEncoderVersion);
  assert.equal(Array.isArray(output.latent), true);
  assert.equal(output.latent.length, NEURO_MODEL_INFO.hiddenUnits);
  assert.equal(output.nodeStates.length, 6);
  assert.equal(output.edgeStrengths.length, 8);
  assert.equal(output.leverSuccess.length, 4);
  assert.equal(compiled.analysis.grounding.mode, "insufficient");
  assert.equal(compiled.analysis.gateAudit.accepted, false);
  assert.equal(compiled.analysis.strongestRelations.length, 0);
  assert.equal(compiled.pack.extended_causal_model.levers.length, 0);
});

test("kanıta bağlı ScenarioPack gerçek Rust/WASM çekirdeğinde çalışır", async () => {
  const wasm = await readFile(new URL("../public/caelus_wasm.wasm", import.meta.url));
  const { instance } = await WebAssembly.instantiate(wasm, {});
  const ex = instance.exports;
  const pack = compileNeuralScenario("Şebeke 90 dakika kesilecek. Jeneratör sürekli 80 kW sağlayabiliyor; sabit yük 100 kW. Batarya ve başka kaynak yok.").pack;
  assert.equal(pack.meta.generated_by, "CAELUS_LOCAL_NCM3_EVIDENCE_REASONER");
  assert.equal(pack.meta.knowledge_pack, "NCM3-POWER-ENERGY-BALANCE");
  const bytes = new TextEncoder().encode(JSON.stringify(pack));
  assert.ok(bytes.length < ex.cae_buf_cap());
  new Uint8Array(ex.memory.buffer).set(bytes, ex.cae_buf());
  assert.equal(ex.cae_load(bytes.length), 0);
  ex.cae_tick(5);
  const length = ex.cae_snapshot();
  const pointer = ex.cae_buf();
  const snapshot = JSON.parse(new TextDecoder().decode(new Uint8Array(ex.memory.buffer).slice(pointer, pointer + length)));
  assert.equal(snapshot.tick, 5);
  assert.equal(snapshot.nodes.length, 6);
  const groundedEdgeCount = pack.extended_causal_model.edges.filter((edge) => edge.to).length;
  assert.ok(groundedEdgeCount > 0);
  assert.equal(snapshot.edges.length, groundedEdgeCount);
});

test("çevrimdışı paket gerekli yerel varlıkları taşır", async () => {
  const [serviceWorker, manifest, wasm] = await Promise.all([
    readFile(new URL("../public/sw.js", import.meta.url), "utf8"),
    readFile(new URL("../public/manifest.webmanifest", import.meta.url), "utf8"),
    readFile(new URL("../public/caelus_wasm.wasm", import.meta.url)),
  ]);
  assert.match(serviceWorker, /caelus-grounded-mobile-v7-ncm3-truth/);
  assert.match(serviceWorker, /clients\.matchAll/);
  assert.match(serviceWorker, /client\.navigate\(client\.url\)/);
  assert.match(serviceWorker, /caelus_wasm\.wasm/);
  assert.equal(JSON.parse(manifest).display, "standalone");
  assert.ok(wasm.byteLength > 90_000);
});
