import assert from 'node:assert/strict';
import test from 'node:test';

await import('../ui/scenario_compiler.js');

const compiler = globalThis.CaelusScenarioCompiler;

test('serbest metin aynı ScenarioPack çıktısını deterministik üretir', () => {
  assert.ok(compiler);
  const text = 'Samos feribot seferleri fırtına nedeniyle 48 saat durursa liman ve yolcu operasyonu ne olur?';
  const first = compiler.compile(text);
  const second = compiler.compile(text);

  assert.deepEqual(first.pack, second.pack);
  assert.equal(first.analysis.fingerprint, second.analysis.fingerprint);
  assert.match(first.pack.id, /^USR-MARITIME_LOGISTICS-[0-9A-F]{8}$/);
  assert.equal(first.pack.sector, 'MARITIME_LOGISTICS');
  assert.equal(first.pack.meta.synopsis, text);
});

test('üretilen paket gerçek motor şemasının düğüm, kenar, kaldıraç ve eşiklerini taşır', () => {
  const { pack, analysis } = compiler.compile('Bir hastanede ilaç stoğu biter ve hasta kuyruğu iki katına çıkarsa');
  const model = pack.extended_causal_model;

  assert.equal(pack.sector, 'HEALTH');
  assert.equal(model.nodes.length, 6);
  assert.ok(model.edges.length >= 8);
  assert.equal(model.levers.length, 4);
  assert.equal(model.feedback_loops.length, 1);
  assert.equal(model.hysteresis.length, 2);
  assert.equal(model.hard_deadlines.length, 1);
  assert.ok(analysis.leverNarratives.every(item => item.includes(':')));
  assert.ok(JSON.stringify(pack).length < 512 * 1024);
});

test('farklı alanlardaki girdiler farklı ve konuya bağlı modeller üretir', () => {
  const cyber = compiler.compile('Şirket sunucusuna siber saldırı olur ve müşteri verisi sızarsa');
  const space = compiler.compile('Uydu yörüngede enerji kaybeder ve görev iletişimi kesilirse');

  assert.equal(cyber.pack.sector, 'CYBER_TECH');
  assert.equal(space.pack.sector, 'SPACE');
  assert.notEqual(cyber.pack.id, space.pack.id);
  assert.ok(cyber.pack.extended_causal_model.nodes.some(node => node.label.includes('Sunucusuna')));
  assert.ok(space.pack.extended_causal_model.nodes.some(node => node.label.includes('Uydu')));
});
