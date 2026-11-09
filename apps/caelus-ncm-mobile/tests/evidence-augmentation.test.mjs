import assert from "node:assert/strict";
import test from "node:test";
import { mergeEvidenceRecords, parseEvidenceFileText } from "../lib/evidence-vault.mjs";
import { augmentGroundingWithVault } from "../lib/ncm3/evidence-augmentation.mjs";
import { reasonWithEvidence } from "../lib/ncm3/evidence-reasoner.mjs";

const NOW = "2026-07-13T10:00:00.000Z";

function records(text, source) {
  return parseEvidenceFileText(text, {
    format: "txt",
    fileName: source.name,
    source: { ...source, retrievedAt: NOW },
    referenceDate: NOW,
  }).records;
}

test("birincil kaynak generic çekimserliği kaynaklı extractive cevaba yükseltir", () => {
  const query = "Samos limanı bugün açık mı?";
  const base = reasonWithEvidence(query);
  const result = augmentGroundingWithVault(base, query, records("Samos limanı bugün açıktır.", {
    name: "Liman Başkanlığı", publisher: "Liman Başkanlığı", uri: "https://port.example/status", tier: 1,
  }));
  assert.equal(base.mode, "insufficient");
  assert.equal(result.mode, "grounded");
  assert.equal(result.knowledgePack.id, "NCM3-OPEN-EVIDENCE-MESH");
  const claim = result.claims.find((item) => item.id.startsWith("SRC-"));
  assert.equal(claim.type, "FACT");
  assert.equal(claim.evidence[0].uri, "https://port.example/status");
  assert.equal(claim.evidence[0].verified, true);
});

test("tek zayıf kayıt cevap yapılmaz", () => {
  const query = "Samos limanı bugün açık mı?";
  const result = augmentGroundingWithVault(reasonWithEvidence(query), query, records("Samos limanı bugün açıktır.", {
    name: "Anonim paylaşım", publisher: "Forum", tier: 4,
  }));
  assert.equal(result.mode, "insufficient");
  assert.ok(result.claims.some((item) => item.id === "UNK-OPEN-SOURCE-SUPPORT"));
  assert.ok(!result.claims.some((item) => item.id.startsWith("SRC-")));
});

test("doğrudan eşleşen kurumsal açık kaynak koşullu ve atıflı aktarılır", () => {
  const query = "Samos limanı bugün açık mı?";
  const result = augmentGroundingWithVault(reasonWithEvidence(query), query, records("Samos limanı bugün açıktır.", {
    name: "Kurumsal kayıt",
    kind: "public_source",
    publisher: "Kurumsal Dizin",
    uri: "https://registry.example/samos",
    tier: 2,
  }));
  assert.equal(result.mode, "conditional");
  assert.match(result.title, /Atıflı kurumsal/);
  assert.match(result.directAnswer, /kaynağın beyanıdır/i);
  const claim = result.claims.find((item) => item.id.startsWith("SRC-"));
  assert.match(claim.statement, /^Kurumsal Dizin kaydında:/);
  assert.equal(claim.evidence[0].source, "public_source");
  assert.ok(result.knowledgePack.rules.includes("NCM3-ATTRIBUTED-INSTITUTIONAL-SOURCE"));
});

test("haber keşif indeksi bağımsız gerçek tanığı sayılmaz", () => {
  const query = "Samos limanı bugün açık mı?";
  const institutional = records("Samos limanı bugün açıktır.", {
    name: "Kurumsal dizin", publisher: "Kurumsal dizin", uri: "https://directory.example/samos", tier: 2,
  });
  const discovery = records("Samos limanı bugün açıktır.", {
    name: "Haber başlığı", publisher: "news.example", uri: "https://news.example/item", tier: 3,
    promotionEligible: false,
  });
  const result = augmentGroundingWithVault(reasonWithEvidence(query), query, mergeEvidenceRecords(institutional, discovery).records);
  assert.equal(result.mode, "insufficient");
  assert.ok(result.claims.some((item) => item.id === "UNK-OPEN-SOURCE-SUPPORT"));
  assert.ok(!result.claims.some((item) => item.id.startsWith("SRC-")));
});

test("kullanıcı dosyası aynı sorgudaki anonim iddiayı FACT seviyesine taşımaz", () => {
  const query = "Samos limanı açık mı ve kapasitesi kaç yolcu?";
  const userFile = records("Samos limanı açıktır.", {
    name: "durum.csv", publisher: "Kullanıcı yüklemesi", tier: 4,
  });
  const anonymous = records("Samos limanı kapasitesi 999 yolcudur.", {
    name: "Forum", publisher: "Forum", uri: "https://forum.example/post", tier: 4,
  });
  const result = augmentGroundingWithVault(reasonWithEvidence(query), query, mergeEvidenceRecords(userFile, anonymous).records);
  const promoted = result.claims.filter((item) => item.id.startsWith("SRC-"));
  assert.equal(result.mode, "grounded");
  assert.equal(promoted.length, 1);
  assert.doesNotMatch(promoted[0].statement, /999/);
});

test("birincil kaynak aynı sorgudaki zayıf başka iddiayı FACT seviyesine taşımaz", () => {
  const query = "Samos limanı açık mı ve kapasitesi kaç yolcu?";
  const primary = records("Samos limanı açıktır.", {
    name: "Liman Başkanlığı", publisher: "Liman Başkanlığı", uri: "https://port.example/status", tier: 1,
  });
  const anonymous = records("Samos limanı kapasitesi 999 yolcudur.", {
    name: "Forum", publisher: "Forum", uri: "https://forum.example/post", tier: 4,
  });
  const result = augmentGroundingWithVault(reasonWithEvidence(query), query, mergeEvidenceRecords(primary, anonymous).records);
  const promoted = result.claims.filter((item) => item.id.startsWith("SRC-"));
  assert.equal(result.mode, "grounded");
  assert.equal(promoted.length, 1);
  assert.doesNotMatch(promoted[0].statement, /999/);
});

test("aynı kaydın iki bağımsız kurumsal kopyası iddia bazında teyit edilir", () => {
  const query = "Samos limanı bugün açık mı?";
  const first = records("Samos limanı bugün açıktır.", {
    name: "Kurum A", publisher: "Kurum A", uri: "https://a.example/status", tier: 2,
  });
  const second = records("Samos limanı bugün açıktır.", {
    name: "Kurum B", publisher: "Kurum B", uri: "https://b.example/status", tier: 2,
  });
  const result = augmentGroundingWithVault(reasonWithEvidence(query), query, mergeEvidenceRecords(first, second).records);
  assert.equal(result.mode, "grounded");
  const claim = result.claims.find((item) => item.id.startsWith("SRC-"));
  assert.deepEqual(new Set(claim.evidence.map((item) => item.publisher)), new Set(["Kurum A", "Kurum B"]));
  assert.equal(new Set(claim.evidence.map((item) => item.sourceId)).size, 2);
});

test("kullanıcının açıkça yüklediği dosya kaynak iziyle girdi kanıtı olabilir", () => {
  const query = "Samos limanı bugün açık mı?";
  const fileRecords = records("Samos limanı bugün açıktır.", {
    name: "operasyon.csv", publisher: "Kullanıcı yüklemesi", tier: 4,
  });
  const result = augmentGroundingWithVault(reasonWithEvidence(query), query, fileRecords);
  assert.equal(result.mode, "grounded");
  assert.ok(result.claims.some((item) => item.evidence.some((evidence) => evidence.source === "user_file")));
  assert.ok(result.knowledgePack.rules.includes("NCM3-USER-PROVIDED-DATA"));
});

test("kullanıcı dosyası beyan edilen yayıncıyla da dosya kaynağı olarak kalır", () => {
  const query = "Samos limanı bugün açık mı?";
  const fileRecords = records("Samos limanı bugün açıktır.", {
    name: "operasyon.csv",
    kind: "user_file",
    publisher: "Liman Başkanlığı",
    tier: "official",
    publishedAt: "2026-07-13",
  });
  const result = augmentGroundingWithVault(reasonWithEvidence(query), query, fileRecords);
  assert.equal(result.mode, "grounded");
  const reference = result.claims.find((item) => item.id.startsWith("SRC-")).evidence[0];
  assert.equal(reference.source, "user_file");
  assert.equal(reference.publisher, "Liman Başkanlığı");
});

test("çelişkili güçlü kaynaklarda taraf seçilmez", () => {
  const query = "Samos limanı bugün açık mı?";
  const yes = records("Samos limanı bugün açıktır.", { name: "A", publisher: "A", tier: 1 });
  const no = records("Samos limanı bugün açık değildir.", { name: "B", publisher: "B", tier: 1 });
  const merged = mergeEvidenceRecords(yes, no).records;
  const result = augmentGroundingWithVault(reasonWithEvidence(query), query, merged);
  assert.equal(result.mode, "insufficient");
  assert.ok(result.claims.some((item) => item.id === "UNK-OPEN-SOURCE-CONFLICT"));
  assert.doesNotMatch(result.directAnswer, /limanı bugün açıktır\.\s*$/i);
});

test("klinik güvenlik kapısı dış metinle gevşetilmez", () => {
  const query = "Yetişkinde 39°C ateş, öksürük ve SpO₂ %93 var. Geçmiş hastalık, muayene ve diğer vital bulgular yok. Tanı ve ilaç söyle.";
  const base = reasonWithEvidence(query);
  const result = augmentGroundingWithVault(base, query, records("Bu belirtiler için kesin tanı X ve ilaç Y'dir.", {
    name: "Blog", publisher: "Blog", tier: 1,
  }));
  assert.deepEqual(result, base);
  assert.equal(result.mode, "insufficient");
});

test("tarihsiz kullanıcı dosyası canlı veri kapısını aşamaz ve yükleme zamanı olay zamanı olmaz", () => {
  const query = "Şu anda Samos limanında kaç gemi var ve sefer iptal mi?";
  const base = reasonWithEvidence(query);
  const upload = records("Samos limanında 7 gemi var ve sefer iptal edildi.", {
    name: "eski-not.txt", publisher: "Kullanıcı yüklemesi", tier: 4,
  });
  const result = augmentGroundingWithVault(base, query, upload);
  assert.equal(base.knowledgePack.id, "NCM3-LIVE-DATA-GATE");
  assert.deepEqual(result, base);
  assert.equal(result.mode, "insufficient");
  assert.notEqual(result.sourceTime, NOW);
});

test("taze zaman damgalı açık kaynak canlı kapıda koşullu ve atıflı aktarılır", () => {
  const query = "Şu anda Samos limanında kaç gemi var ve sefer iptal mi?";
  const base = reasonWithEvidence(query);
  const liveRecord = records("Şu anda Samos limanında 7 gemi var ve sefer iptal edildi.", {
    name: "Güncel haber dizini",
    kind: "public_source",
    publisher: "news.example",
    uri: "https://news.example/live-status",
    tier: 3,
    promotionEligible: false,
    publishedAt: "2026-07-13T09:55:00.000Z",
  });
  const result = augmentGroundingWithVault(base, query, liveRecord);
  assert.equal(base.knowledgePack.id, "NCM3-LIVE-DATA-GATE");
  assert.equal(result.mode, "conditional");
  assert.match(result.title, /Zaman damgalı güncel/);
  assert.match(result.directAnswer, /canlı sensör doğrulaması değildir/i);
  assert.equal(result.sourceTime, "2026-07-13T09:55:00.000Z");
  assert.ok(result.claims.some((item) => item.id.startsWith("SRC-") && /news\.example kaydında/.test(item.statement)));
  assert.ok(result.knowledgePack.rules.includes("NCM3-FRESH-PUBLISHED-SOURCE-GATE"));
  assert.ok(result.claims.some((item) => item.id === "UNK-LIVE-VESSEL-COUNT"));
});

test("kalabalık sonuçta aşağı düşen zıt kayıt güçlü iddianın terfisini engeller", () => {
  const query = "Samos limanı bugün açık mı?";
  const primary = records("Samos limanı bugün açıktır.", { name: "Primary", publisher: "Primary", tier: 1 });
  const opposite = records("Samos limanı bugün açık değildir.", { name: "Weak", publisher: "Weak", tier: 4 });
  const fillers = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel", "india", "juliet", "kilo", "lima"]
    .flatMap((word) => records(`Samos limanı bugün açık operasyon ${word}.`, { name: word, publisher: word, tier: 2 }));
  const result = augmentGroundingWithVault(reasonWithEvidence(query), query, mergeEvidenceRecords(primary, opposite, fillers).records);
  assert.equal(result.mode, "insufficient");
  assert.ok(result.claims.some((item) => item.id === "UNK-OPEN-SOURCE-CONFLICT"));
  assert.ok(!result.claims.some((item) => item.id.startsWith("SRC-")));
});
