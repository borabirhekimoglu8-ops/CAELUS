import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

await import('../ui/scenario_compiler.js');
const compiler = globalThis.CaelusScenarioCompiler;

const wasmPath = new URL('../caelus_wasm/target/wasm32-unknown-unknown/release/caelus_wasm.wasm', import.meta.url);
const wasmBytes = await readFile(wasmPath);

async function bootWith(text, ticks) {
  const { instance } = await WebAssembly.instantiate(wasmBytes, {});
  const ex = instance.exports;
  const bytes = new TextEncoder().encode(JSON.stringify(compiler.compile(text).pack));
  assert.ok(bytes.length < ex.cae_buf_cap());
  new Uint8Array(ex.memory.buffer).set(bytes, ex.cae_buf());
  assert.equal(ex.cae_load(bytes.length), 0);
  ex.cae_tick(ticks);

  const readBuffer = length => {
    const ptr = ex.cae_buf();
    return new TextDecoder().decode(new Uint8Array(ex.memory.buffer).slice(ptr, ptr + length));
  };

  const snapshot = JSON.parse(readBuffer(ex.cae_snapshot()));
  const levers = JSON.parse(readBuffer(ex.cae_levers()));
  return { snapshot, levers };
}

test('serbest metin paketi gerçek WASM motorda yüklenir ve tick ilerletir', async () => {
  const text = 'Samos feribot seferleri fırtına nedeniyle 48 saat durursa liman ve yolcu operasyonu ne olur?';
  const expected = compiler.compile(text);
  const first = await bootWith(text, 4);
  const second = await bootWith(text, 4);

  assert.equal(first.snapshot.scenario_id, expected.pack.id);
  assert.equal(first.snapshot.tick, 4);
  assert.equal(first.snapshot.nodes.length, 6);
  assert.equal(first.snapshot.edges.length, 5);
  assert.ok(first.snapshot.clamped_friction > 1);
  assert.equal(first.levers.levers.length, 4);
  assert.deepEqual(first, second);
});
