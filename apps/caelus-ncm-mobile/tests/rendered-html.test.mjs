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

test("mobil ana ekran ve geliştirme metadatası render edilir", async () => {
  const response = await renderHome();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, developmentPreviewMeta);
  assert.match(html, /CAELUS/);
  assert.match(html, /NCM/);
  assert.match(html, /SİNİR AĞI CİHAZDA/);
  assert.match(html, /BULUT KAPALI/);
  assert.match(html, /Yerel modeli çalıştır/);
  assert.doesNotMatch(html, /window\.location\.replace\("\/caelus\.html"\)/);
});

test("eğitilmiş yerel model aynı girdide deterministik, farklı alanda ayrışan çıktı verir", () => {
  const maritime = "Samos feribot seferleri fırtına nedeniyle 48 saat durursa liman ve yolcu operasyonu ne olur?";
  const cyber = "Şirket sunucusuna siber saldırı olur ve müşteri verileri sızarsa servis zinciri nasıl çöker?";
  const first = compileNeuralScenario(maritime);
  const replay = compileNeuralScenario(maritime);
  const other = compileNeuralScenario(cyber);

  assert.deepEqual(first, replay);
  assert.equal(first.analysis.cloudUsed, false);
  assert.equal(first.pack.meta.generated_by, "CAELUS_LOCAL_NEUROCAUSAL_MODEL");
  assert.equal(first.pack.meta.neural_model, NEURO_MODEL_INFO.version);
  assert.equal(first.pack.extended_causal_model.nodes.length, 6);
  assert.ok(first.pack.extended_causal_model.edges.length >= 10);
  assert.equal(first.pack.extended_causal_model.levers.length, 4);
  assert.equal(first.analysis.sector, "MARITIME");
  assert.equal(other.analysis.sector, "CYBER");
  assert.notEqual(first.analysis.scenarioId, other.analysis.scenarioId);
  assert.notEqual(first.analysis.sector, other.analysis.sector);
  assert.ok(first.analysis.strongestRelations.every((relation) => relation.from && relation.to));
});

test("sinir ağı gerçek ağırlıklarla çok görevli çıkarım yapar", () => {
  const output = runNeuralInference("Uydu enerji sistemi arızalanır ve görev penceresi 12 saat içinde kapanırsa");
  assert.equal(output.model, NEURO_MODEL_INFO.version);
  assert.equal(output.architecture, NEURO_MODEL_INFO.architecture);
  assert.equal(Array.isArray(output.latent), true);
  assert.equal(output.latent.length, NEURO_MODEL_INFO.hiddenUnits);
  assert.equal(output.nodeStates.length, 6);
  assert.equal(output.edgeStrengths.length, 8);
  assert.equal(output.leverSuccess.length, 4);
});

test("nöro-nedensel paket gerçek Rust/WASM çekirdeğinde çalışır", async () => {
  const wasm = await readFile(new URL("../public/caelus_wasm.wasm", import.meta.url));
  const { instance } = await WebAssembly.instantiate(wasm, {});
  const ex = instance.exports;
  const pack = compileNeuralScenario("Elektrik şebekesi deprem nedeniyle 24 saat kesilirse hastane ve iletişim altyapısı nasıl etkilenir?").pack;
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
  assert.ok(snapshot.edges.length >= 6);
});

test("çevrimdışı paket gerekli yerel varlıkları taşır", async () => {
  const [serviceWorker, manifest, wasm] = await Promise.all([
    readFile(new URL("../public/sw.js", import.meta.url), "utf8"),
    readFile(new URL("../public/manifest.webmanifest", import.meta.url), "utf8"),
    readFile(new URL("../public/caelus_wasm.wasm", import.meta.url)),
  ]);
  assert.match(serviceWorker, /caelus-neurocausal-mobile-v3/);
  assert.match(serviceWorker, /caelus_wasm\.wasm/);
  assert.equal(JSON.parse(manifest).display, "standalone");
  assert.ok(wasm.byteLength > 90_000);
});
