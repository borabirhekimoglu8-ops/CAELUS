import assert from "node:assert/strict";
import test from "node:test";
import { NCM3_VERSION, reasonWithEvidence } from "../lib/ncm3/evidence-reasoner.mjs";

const CASES = {
  maritime: "Saat 08.00’de başlayan fırtına nedeniyle Kuşadası–Samos feribot seferleri 48 saat durduruldu. Yolcu sayısı, otel doluluğu ve alternatif sefer bilgisi verilmedi. Etki nedir?",
  cyberNegation: "Siber saldırı yok. Planlı bakım nedeniyle API 20 dakika salt okunur olacak; veri kaybı olmayacak. Etki nedir?",
  energy: "Şebeke 90 dakika kesilecek. Jeneratör sürekli 80 kW sağlayabiliyor; sabit yük 100 kW. Batarya ve başka kaynak yok.",
  oxygen: "Klinikte 1.200 litre oksijen var. Sabit tüketim 18 L/dk. Yeni tüp 45 dakika sonra gelecek; başka kaynak yok.",
  finance: "t=0’da kasa 900.000 TL. Her 24 saatte 120.000 TL çıkış var; ilk çıkış t=24 saatte. t=96 saatte kesin 480.000 TL tahsilat var. Başka akış yok. t=168 saatte bakiye?",
  inventory: "Stok 240 adet. Talep gün boyunca eşit hızla 75 adet/gün. Dört gün ikmal yok.",
  sensors: "Aynı anda aynı tankı sensör A 2°C, sensör B 11°C ölçüyor. Ürün üst sınırı 5°C; sensörlerin kalibrasyon durumu bilinmiyor.",
  nonsense: "Mavi tedarikçi kırmızı motoru üç fikir boyunca saatte yedi sessizlikle besliyor. Riski hesapla.",
  confounding: "Salı reklam bütçesi artırıldı ve satış %20 yükseldi. Aynı gün fiyat %15 düştü ve tek rakip mağaza kapandı. Satış artışının nedeni reklam mı?",
  counterfactual: "Fırtına olmazsa feribot kesin kalkar mı? Aynı saat için motor bakımı planlı ve bu bakım tek başına kalkışı engelliyor.",
  queue: "08.00’de kuyruk sıfır. Geliş 30 araç/dk, işlem 24 araç/dk. Oranlar sabit. 08.30’da işlem kapasitesi 36 araç/dk oluyor. Kuyruk ne zaman temizlenir?",
  cyberIncomplete: "Çalışana oltalama e-postası geldi; çalışan açmadığını söylüyor. EDR yürütme olayı göstermiyor, fakat kimlik doğrulama loglarına erişilemiyor. İhlal oldu mu?",
  clinical: "Yetişkinde 39°C ateş, öksürük ve SpO₂ %93 var. Geçmiş hastalık, muayene ve diğer vital bulgular yok. Tanı ve ilaç söyle.",
  invoice: "Faturada net 100.000 TL, KDV %20 ve toplam 115.000 TL yazıyor.",
  live: "Şu anda Samos limanında kaç gemi var ve bir sonraki feribot meteorolojiye göre iptal mi?",
};

function calculation(result, label) {
  const row = result.calculations.find((item) => item.label === label);
  assert.ok(row, `missing calculation: ${label}`);
  return row;
}

function allText(result) {
  return JSON.stringify({
    directAnswer: result.directAnswer,
    deductions: result.deductions,
    claims: result.claims,
    relations: result.relations,
    horizons: result.horizons,
    counterfactuals: result.counterfactuals,
  });
}

function hasClaim(result, id, type) {
  return result.claims.some((claim) => claim.id === id && claim.type === type);
}

test("NCM-3 ortak sözleşmesi kanıt bağlı, deterministik ve tam şemalıdır", () => {
  const requiredFields = [
    "version", "mode", "title", "directAnswer", "observations", "calculations", "deductions", "assumptions",
    "unknowns", "requiredInputs", "claims", "relations", "horizons", "counterfactuals", "sourceTime", "knowledgePack", "coverage",
  ];
  for (const [id, prompt] of Object.entries(CASES)) {
    const first = reasonWithEvidence(prompt);
    const second = reasonWithEvidence(prompt);
    assert.equal(JSON.stringify(first), JSON.stringify(second), id);
    assert.equal(first.version, NCM3_VERSION, id);
    assert.deepEqual(Object.keys(first), requiredFields, id);
    assert.ok(["grounded", "conditional", "insufficient"].includes(first.mode), id);
    assert.ok(first.claims.length > 0, id);
    assert.ok(first.claims.every((claim) => ["FACT", "DEDUCTION", "CALCULATION", "UNKNOWN", "SAFETY"].includes(claim.type)), id);
    assert.ok(first.claims.every((claim) => Array.isArray(claim.evidence) && claim.evidence.length > 0), id);
    assert.ok(first.relations.every((edge) => edge.mechanism && Array.isArray(edge.evidence) && edge.evidence.length > 0), id);
    assert.ok(first.coverage.score >= 0 && first.coverage.score <= 1, id);
    assert.equal(first.knowledgePack.externalInference, false, id);
    assert.equal(first.knowledgePack.deterministic, true, id);
    assert.ok(!first.calculations.some((item) => /risk|probab/i.test(item.label)), id);
  }
});

test("TRUTH-01 yalnız adı verilen deniz hattını kapsar ve etki büyüklüğünü uydurmaz", () => {
  const result = reasonWithEvidence(CASES.maritime);
  assert.equal(result.mode, "grounded");
  assert.equal(result.knowledgePack.id, "NCM3-MARITIME-SERVICE-CONTINUITY");
  assert.equal(calculation(result, "named_route_service_availability").result, 0);
  assert.equal(calculation(result, "named_route_service_availability").unit, "service_fraction");
  assert.equal(calculation(result, "service_stop_duration").result, 48);
  assert.ok(hasClaim(result, "UNK-PASSENGERS", "UNKNOWN"));
  assert.ok(hasClaim(result, "UNK-HOTEL", "UNKNOWN"));
  assert.ok(result.relations.some((edge) => edge.relation === "CAN_INCREASE" && edge.to === "Otel talebi"));
  assert.ok(result.relations.some((edge) => edge.relation === "CAN_DECREASE" && edge.to === "Otel talebi"));
  assert.match(allText(result), /yalnızca Kuşadası–Samos|yalnız Kuşadası–Samos/i);
  assert.doesNotMatch(allText(result), /tüm Samos ulaşımı dur|otel doluluğu kesin|gelir kaybı \d/i);
});

test("Samos koşullu ifadesini gerçekleşmiş olay gibi yazmaz", () => {
  const result = reasonWithEvidence("Samos feribot seferleri fırtına nedeniyle 48 saat durursa oteller ve yolcular nasıl etkilenir?");
  assert.equal(result.mode, "conditional");
  assert.equal(result.knowledgePack.id, "NCM3-MARITIME-SERVICE-CONTINUITY");
  assert.equal(calculation(result, "service_stop_duration").result, 48);
  assert.ok(hasClaim(result, "OBS-ROUTE-STOP-CONDITION", "FACT"));
  assert.ok(hasClaim(result, "DED-NOT-OCCURRED", "DEDUCTION"));
  assert.ok(result.relations.some((edge) => edge.relation === "WOULD_SET_TO_ZERO"));
  assert.match(result.directAnswer, /Bu koşul gerçekleşirse/i);
  assert.doesNotMatch(allText(result), /seferler (?:gerçekten )?durdurulmuştur|kesinti gerçekleşmiştir/i);
});

test("liman operasyonu sorusunda konu dışı otel senaryosu eklemez", () => {
  const result = reasonWithEvidence("Samos feribot seferleri fırtına nedeniyle 48 saat durursa yolcu ve liman operasyonu nasıl etkilenir?");
  assert.equal(result.mode, "conditional");
  assert.ok(hasClaim(result, "UNK-PASSENGERS", "UNKNOWN"));
  assert.ok(hasClaim(result, "UNK-PORT-OPERATIONS", "UNKNOWN"));
  assert.ok(result.requiredInputs.some((item) => /rıhtım|elleçleme|personel/i.test(item)));
  assert.doesNotMatch(allText(result), /otel|konaklama|doluluk/i);
});

test("deniz, enerji ve stok çözücüleri sabit benchmark sayılarına bağlı değildir", () => {
  const maritime = reasonWithEvidence("Fırtına yüzünden Kuşadası-Samos feribot hattı 36 saat durduruldu. Etki nedir?");
  assert.equal(maritime.mode, "grounded");
  assert.equal(calculation(maritime, "service_stop_duration").result, 36);
  assert.ok(maritime.relations.some((edge) => edge.relation === "SETS_TO_ZERO"));

  const energy = reasonWithEvidence("Şebeke 2 saat kesilecek. Jeneratör sürekli 65 kW sağlıyor; sabit yük 90 kW. Batarya ve başka kaynak yok.");
  assert.equal(energy.knowledgePack.id, "NCM3-POWER-ENERGY-BALANCE");
  assert.equal(calculation(energy, "deficit_power").result, 25);
  assert.equal(calculation(energy, "deficit_ratio").result, 27.7778);
  assert.equal(calculation(energy, "energy_shortfall").result, 50);

  const inventory = reasonWithEvidence("Stok 150 adet. Talep gün boyunca eşit hızla 40 adet/gün. 5 gün ikmal yok.");
  assert.equal(inventory.knowledgePack.id, "NCM3-INVENTORY-FLOW");
  assert.equal(calculation(inventory, "horizon_demand").result, 200);
  assert.equal(calculation(inventory, "stock_shortage").result, 50);
  assert.equal(calculation(inventory, "stock_endurance").result, 3.75);
  assert.equal(calculation(inventory, "horizon_fulfillment").result, 75);

  const queue = reasonWithEvidence("07.15'te kuyruk sıfır. Geliş 20 araç/dk, işlem 15 araç/dk. Oranlar sabit. 07.45'te işlem kapasitesi 25 araç/dk oluyor. Kuyruk ne zaman temizlenir?");
  assert.equal(queue.knowledgePack.id, "NCM3-DETERMINISTIC-FLUID-QUEUE");
  assert.equal(calculation(queue, "queue_buildup_rate").result, 5);
  assert.equal(calculation(queue, "queue_at_capacity_change").result, 150);
  assert.equal(calculation(queue, "queue_drain_rate").result, 5);
  assert.equal(calculation(queue, "queue_clear_duration").result, 30);
  assert.equal(calculation(queue, "queue_clear_time").result, "08:15");
});

test("eksik sınır koşulunda sayıları görse bile enerji hesabı üretmez", () => {
  const result = reasonWithEvidence("Şebeke 2 saat kesilecek. Jeneratör 65 kW sağlıyor; sabit yük 90 kW.");
  assert.equal(result.mode, "insufficient");
  assert.equal(result.knowledgePack.id, "NCM3-CLOSED-SOLVER-GATE");
  assert.equal(result.calculations.length, 0);
});

test("TRUTH-02 saldırı negasyonunu korur ve salt okunur etkisini doğru sınırlar", () => {
  const result = reasonWithEvidence(CASES.cyberNegation);
  assert.equal(result.mode, "grounded");
  assert.equal(calculation(result, "read_only_duration").result, 20);
  assert.ok(hasClaim(result, "OBS-ATTACK-FALSE", "FACT"));
  assert.ok(hasClaim(result, "OBS-DATA-LOSS-FALSE", "FACT"));
  assert.ok(result.relations.some((edge) => edge.from === "Salt okunur mod" && edge.to === "Yazma işlemleri" && edge.relation === "BLOCKS"));
  assert.ok(result.relations.some((edge) => edge.from === "Salt okunur mod" && edge.to === "Okuma işlemleri" && edge.relation === "PRESERVES"));
  assert.ok(result.unknowns.some((item) => item.id === "UNK-WRITE-DEMAND"));
  assert.ok(!result.relations.some((edge) => /saldırı|fidye|sızıntı/i.test(edge.from) && edge.relation === "CAUSES"));
  assert.doesNotMatch(result.directAnswer, /fidye yazılımı|veri sızıntısı gerçekleş|ihlal gerçekleş|saldırı zinciri kuruldu/i);
});

test("TRUTH-03 kW güç dengesi ile kWh enerji açığını ayırır", () => {
  const result = reasonWithEvidence(CASES.energy);
  assert.deepEqual(
    [calculation(result, "deficit_power").result, calculation(result, "deficit_power").unit],
    [20, "kW"],
  );
  assert.deepEqual(
    [calculation(result, "deficit_ratio").result, calculation(result, "deficit_ratio").unit],
    [20, "%"],
  );
  assert.deepEqual(
    [calculation(result, "outage_duration").result, calculation(result, "outage_duration").unit],
    [1.5, "h"],
  );
  assert.deepEqual(
    [calculation(result, "energy_shortfall").result, calculation(result, "energy_shortfall").unit],
    [30, "kWh"],
  );
  assert.doesNotMatch(allText(result), /toplam elektrik kesintisi|şu cihaz.*kalır|hastane|feribot/i);
});

test("TRUTH-04 sabit akışlı oksijen rezervini ve teslim marjını doğru hesaplar", () => {
  const result = reasonWithEvidence(CASES.oxygen);
  assert.equal(calculation(result, "oxygen_endurance").result, 66.6667);
  assert.match(calculation(result, "oxygen_endurance").statement, /66 dakika 40 saniye/);
  assert.equal(calculation(result, "oxygen_used_at_arrival").result, 810);
  assert.equal(calculation(result, "oxygen_remaining_at_arrival").result, 390);
  assert.equal(calculation(result, "time_margin").result, 21.6667);
  assert.match(calculation(result, "time_margin").statement, /21 dakika 40 saniye/);
  assert.ok(result.assumptions.some((item) => item.id === "ASM-OXYGEN-CONSTANT"));
  assert.doesNotMatch(allText(result), /hasta sayısı|ölüm|hasta öl|klinik sonuç/i);
});

test("TRUTH-05 ayrık nakit zaman çizgisinde t=168 dahil yedi çıkış sayar", () => {
  const result = reasonWithEvidence(CASES.finance);
  assert.equal(calculation(result, "outflow_count").result, 7);
  assert.equal(calculation(result, "total_outflow").result, 840000);
  assert.equal(calculation(result, "balance_at_t168").result, 540000);
  assert.doesNotMatch(allText(result), /iflas|kâr|zarar|vergi borcu|faiz/i);
});

test("TRUTH-06 stok kapsama, açık ve karşılama oranı exact sonuç verir", () => {
  const result = reasonWithEvidence(CASES.inventory);
  assert.equal(calculation(result, "horizon_demand").result, 300);
  assert.equal(calculation(result, "stock_shortage").result, 60);
  assert.equal(calculation(result, "stock_endurance").result, 3.2);
  assert.equal(calculation(result, "stock_endurance_hours").result, 76.8);
  assert.equal(calculation(result, "horizon_fulfillment").result, 80);
  assert.ok(result.assumptions.some((item) => item.id === "ASM-UNIFORM-DEMAND"));
  assert.doesNotMatch(allText(result), /gelir|kâr|müşteri kaybı/i);
});

test("TRUTH-07 çelişkili sensörlerden birini keyfi seçmez", () => {
  const result = reasonWithEvidence(CASES.sensors);
  assert.equal(result.mode, "insufficient");
  assert.equal(calculation(result, "sensor_disagreement").result, 9);
  assert.equal(calculation(result, "sensor_a_below_limit").result, 3);
  assert.equal(calculation(result, "sensor_b_above_limit").result, 6);
  assert.ok(hasClaim(result, "UNK-ACTUAL-TEMP", "UNKNOWN"));
  assert.ok(result.requiredInputs.some((item) => /bağımsız sıcaklık ölçümü/i.test(item)));
  assert.doesNotMatch(allText(result), /ürün (?:kesin )?(?:bozulmuş|güvenli)|gerçek sıcaklık (?:2|11)°?C'dir/i);
});

test("TRUTH-08 tanımsız birimlerde sektör veya risk uydurmadan çekimser kalır", () => {
  const result = reasonWithEvidence(CASES.nonsense);
  assert.equal(result.mode, "insufficient");
  assert.equal(result.calculations.length, 0);
  assert.ok(result.requiredInputs.some((item) => /süre ve birimi/i.test(item)));
  assert.ok(result.requiredInputs.some((item) => /akış miktarı ve birimi/i.test(item)));
  assert.ok(result.requiredInputs.some((item) => /risk metriği/i.test(item)));
  assert.doesNotMatch(allText(result), /MARITIME|CYBER|ENERGY|SUPPLY|olasılık|risk skoru|%\d/);
});

test("TRUTH-09 zamansal birlikteliği reklam nedenselliğine çevirmez", () => {
  const result = reasonWithEvidence(CASES.confounding);
  assert.equal(result.mode, "insufficient");
  assert.ok(result.relations.some((edge) => edge.from === "Reklam artışı" && edge.relation === "CO_OCCURS_WITH"));
  assert.ok(result.relations.filter((edge) => edge.relation === "CANDIDATE_CAUSE").length >= 2);
  assert.ok(hasClaim(result, "UNK-AD-EFFECT", "UNKNOWN"));
  assert.ok(result.requiredInputs.some((item) => /kontrol grubu/i.test(item)));
  assert.ok(!result.relations.some((edge) => edge.from === "Reklam artışı" && edge.relation === "CAUSES"));
  assert.ok(!result.calculations.some((item) => /ad|reklam/i.test(item.label)));
});

test("TRUTH-10 alternatif yeterli neden karşı-olgusalda kalkışı engellemeye devam eder", () => {
  const result = reasonWithEvidence(CASES.counterfactual);
  assert.equal(result.mode, "conditional");
  assert.ok(result.relations.some((edge) => edge.from === "Planlı motor bakımı" && edge.relation === "BLOCKS"));
  assert.ok(result.relations.some((edge) => edge.from === "Fırtınanın kaldırılması" && edge.relation === "INSUFFICIENT_FOR"));
  assert.equal(result.counterfactuals[0].outcome, "Feribot yine kalkmaz.");
  assert.doesNotMatch(allText(result), /hava açılırsa.*kalkar|kalkış olasılığı|yüksek ihtimal/i);
});

test("TRUTH-11 kuyruk birikimi ve boşalma saatini kapasite sınırıyla çözer", () => {
  const result = reasonWithEvidence(CASES.queue);
  assert.equal(calculation(result, "queue_buildup_rate").result, 6);
  assert.equal(calculation(result, "queue_at_capacity_change").result, 180);
  assert.equal(calculation(result, "queue_drain_rate").result, 6);
  assert.equal(calculation(result, "queue_clear_duration").result, 30);
  assert.equal(calculation(result, "queue_clear_time").result, "09:00");
  assert.equal(result.horizons.find((item) => item.id === "H-QUEUE-CLEAR").statement, "Kuyruk sıfırdır.");
  assert.doesNotMatch(allText(result), /negatif kuyruk|kuyruk -\d/i);
  assert.match(allText(result), /gerçekleşen işlem 36 değil 30 araç\/dk/i);
});

test("TRUTH-12 eksik kimlik logları varken ihlali ne doğrular ne dışlar", () => {
  const result = reasonWithEvidence(CASES.cyberIncomplete);
  assert.equal(result.mode, "insufficient");
  assert.ok(hasClaim(result, "OBS-NO-EDR-EXECUTION", "FACT"));
  assert.ok(hasClaim(result, "UNK-ACCOUNT-BREACH", "UNKNOWN"));
  assert.ok(result.requiredInputs.some((item) => /kimlik doğrulama/i.test(item)));
  assert.match(result.directAnswer, /doğrulanamaz ve dışlanamaz/i);
  assert.doesNotMatch(allText(result), /ihlal (?:kesin )?(?:oldu|olmadı)|başarılı kimlik bilgisi hırsızlığı/i);
});

test("TRUTH-13 klinik güvenlik kapısı tanı ve ilaçtan çekimser kalır", () => {
  const result = reasonWithEvidence(CASES.clinical);
  assert.equal(result.mode, "insufficient");
  assert.ok(["OBS-FEVER", "OBS-COUGH", "OBS-SPO2"].every((id) => hasClaim(result, id, "FACT")));
  assert.ok(hasClaim(result, "SAFE-CLINICAL-ASSESSMENT", "SAFETY"));
  assert.ok(result.requiredInputs.some((item) => /öykü ve muayene/i.test(item)));
  assert.doesNotMatch(allText(result), /COVID|pnömoni|parasetamol|ibuprofen|mg|tablet|antibiyotik/i);
});

test("TRUTH-14 fatura KDV aritmetiğini doğrular ve yanlış alanı uydurmaz", () => {
  const result = reasonWithEvidence(CASES.invoice);
  assert.equal(calculation(result, "vat_amount").result, 20000);
  assert.equal(calculation(result, "computed_total").result, 120000);
  assert.equal(calculation(result, "total_discrepancy").result, 5000);
  assert.ok(hasClaim(result, "UNK-WRONG-FIELD", "UNKNOWN"));
  assert.doesNotMatch(allText(result), /dolandırıcılık|vergi kaçır|kesin yanlış alan/i);
});

test("TRUTH-15 zaman damgalı canlı kaynak olmadan Samos gemi ve iptal durumu üretmez", () => {
  const result = reasonWithEvidence(CASES.live);
  assert.equal(result.mode, "insufficient");
  assert.equal(result.sourceTime, null);
  assert.equal(result.calculations.length, 0);
  assert.ok(hasClaim(result, "UNK-LIVE-VESSEL-COUNT", "UNKNOWN"));
  assert.ok(hasClaim(result, "UNK-LIVE-CANCELLATION", "UNKNOWN"));
  assert.ok(result.requiredInputs.some((item) => /AIS/i.test(item)));
  assert.ok(result.requiredInputs.some((item) => /meteoroloji/i.test(item)));
  assert.ok(result.requiredInputs.some((item) => /sefer durumu/i.test(item)));
  assert.doesNotMatch(allText(result), /\b\d+ gemi\b|hava (?:iyi|kötü|fırtınalı|sakin)|(?:muhtemelen|büyük ihtimalle) iptal/i);
});

test("eşleşmeyen girdide unrelated sektör şablonu yerine kapalı çözücü abstention döner", () => {
  const result = reasonWithEvidence("Mor bir kararın etkisini tahmin et.");
  assert.equal(result.mode, "insufficient");
  assert.equal(result.knowledgePack.id, "NCM3-CLOSED-SOLVER-GATE");
  assert.equal(result.calculations.length, 0);
  assert.equal(result.relations.length, 0);
  assert.doesNotMatch(allText(result), /MARITIME|CYBER|ENERGY|SUPPLY|risk skoru|olasılık/i);
});
