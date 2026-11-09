import assert from "node:assert/strict";
import test from "node:test";
import { importOpenUrl, planOpenSourceQuery, searchOpenSources, textFromMarkup } from "../lib/open-source-connectors.mjs";

function response(body, status = 200, contentType = "application/json", url) {
  const result = new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "content-type": contentType },
  });
  if (url) Object.defineProperty(result, "url", { value: url });
  return result;
}

test("işaretleme ve aktif içerik kanıt metnine taşınmaz", () => {
  assert.equal(textFromMarkup("<h1>Başlık</h1><script>steal()</script><p>Gerçek &amp; veri</p>"), "Başlık Gerçek & veri");
});

test("operasyon sorusu kısa, alan uyumlu ve iki dilli kaynak sorgusuna dönüşür", () => {
  const plan = planOpenSourceQuery("Samos feribot seferleri fırtına nedeniyle 48 saat durursa yolcu ve liman operasyonu nasıl etkilenir?");
  assert.equal(plan.entity, "Samos");
  assert.equal(plan.knowledgeTr, "Samos");
  assert.equal(plan.global, "Samos ferry");
  assert.equal(plan.news, "Samos ferry storm");
  assert.equal(plan.scholarly, null);
  assert.equal(plan.medical, null);
  assert.doesNotMatch(plan.global, /nasıl|etkilenir/i);
  assert.doesNotMatch(plan.global, /Yolcu|Etki/i);
});

test("İngilizce operasyon sorgusu akademik indekse gönderilmez ve varlık yinelenmez", () => {
  const plan = planOpenSourceQuery("Samos ferry storm");
  assert.equal(plan.global, "Samos ferry");
  assert.equal(plan.news, "Samos ferry storm");
  assert.equal(plan.scholarly, null);
  assert.equal(plan.medical, null);
});

test("operasyon alt dizileri normal akademik sorguları yanlış sınıflandırmaz", () => {
  for (const query of [
    "Quarterly report on inflation",
    "Research on livestock nutrition",
    "Support systems in organizations",
  ]) {
    assert.ok(planOpenSourceQuery(query).scholarly, query);
  }
});

test("GDELT sonuç limiti ve kompakt yayın tarihi korunur", async () => {
  const fakeFetch = async (url) => {
    if (String(url).includes("gdeltproject")) {
      return response({ articles: Array.from({ length: 10 }, (_, index) => ({
        url: `https://news.example/${index}`,
        title: `Samos ferry storm ${index}`,
        domain: "news.example",
        seendate: "20260713T103000Z",
      })) });
    }
    return response(String(url).includes("wikidata") ? { search: [] } : { query: { pages: {} } });
  };
  const result = await searchOpenSources("Samos ferry storm", { fetchImpl: fakeFetch, limit: 2 });
  const gdelt = result.hits.filter((hit) => hit.sourceId === "gdelt_news");
  assert.equal(gdelt.length, 2);
  assert.equal(gdelt[0].publishedAt, "2026-07-13T10:30:00.000Z");
});

test("Wikipedia arama sırasını korur ve düzenleme zamanını olay tarihi saymaz", async () => {
  const fakeFetch = async (url) => {
    if (String(url).includes("tr.wikipedia")) {
      return response({ query: { pages: {
        2: { pageid: 2, index: 2, title: "İkinci", extract: "Samos feribot ikinci", touched: "2026-07-13T10:30:00Z" },
        9: { pageid: 9, index: 1, title: "Birinci", extract: "Samos feribot birinci", touched: "2026-07-13T10:31:00Z" },
      } } });
    }
    if (String(url).includes("wikidata")) return response({ search: [] });
    if (String(url).includes("gdeltproject")) return response({ articles: [] });
    return response({ query: { pages: {} } });
  };
  const result = await searchOpenSources("Samos ferry storm", { fetchImpl: fakeFetch, limit: 2 });
  const wikipedia = result.hits.filter((hit) => hit.sourceId === "wikipedia_tr");
  assert.deepEqual(wikipedia.map((hit) => hit.title), ["Birinci", "İkinci"]);
  assert.ok(wikipedia.every((hit) => hit.publishedAt === null));
});

test("bağlayıcı hatası diğer açık kaynakları durdurmaz", async () => {
  const fakeFetch = async (url) => {
    const value = String(url);
    if (value.includes("tr.wikipedia")) throw new TypeError("offline");
    if (value.includes("en.wikipedia")) return response({ query: { pages: { 7: { pageid: 7, title: "Energy", extract: "Energy is conserved.", fullurl: "https://en.wikipedia.org/wiki/Energy" } } } });
    if (value.includes("wikidata")) return response({ search: [{ id: "Q11379", label: "Energy", description: "quantitative property", concepturi: "https://www.wikidata.org/wiki/Q11379" }] });
    if (value.includes("crossref")) return response({ message: { items: [] } });
    if (value.includes("europepmc")) return response({ resultList: { result: [] } });
    return response({ articles: [] });
  };
  const result = await searchOpenSources("energy conservation", {
    fetchImpl: fakeFetch,
    retrievedAt: "2026-07-13T10:00:00.000Z",
  });
  assert.equal(result.failedSources, 1);
  assert.equal(result.successfulSources, 4);
  assert.equal(result.attemptedSources, 5);
  assert.equal(result.skippedSources, 1);
  assert.equal(result.hits.length, 2);
  assert.ok(result.hits.every((hit) => hit.retrievedAt === "2026-07-13T10:00:00.000Z"));
  assert.equal(new Set(result.hits.map((hit) => hit.independenceGroup)).size, 1);
});

test("açık kaynak JSON yanıtları 5 MB sınırında akış açılmadan kapanır", async () => {
  const result = await searchOpenSources("energy conservation", {
    fetchImpl: async () => new Response("{}", {
      headers: { "content-type": "application/json", "content-length": "6000000" },
    }),
  });
  assert.equal(result.failedSources, result.attemptedSources);
  assert.ok(result.reports.filter((item) => !item.skipped).every((item) => /5 MB sınırını/.test(item.error)));
});

test("çağıran iptal ettiğinde kısmi boş sonuç yerine AbortError döner", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    () => searchOpenSources("Samos ferry storm", { signal: controller.signal, fetchImpl: async () => response({}) }),
    (error) => error?.name === "AbortError",
  );
});

test("CORS erişimli URL düz metin kanıtına çevrilir", async () => {
  const hit = await importOpenUrl("https://data.example.org/feed", {
    retrievedAt: "2026-07-13T10:00:00.000Z",
    fetchImpl: async () => response("<article><h1>Port</h1><p>Capacity is 120 vehicles.</p></article>", 200, "text/html"),
  });
  assert.equal(hit.publisher, "data.example.org");
  assert.match(hit.content, /Capacity is 120 vehicles/);
  assert.equal(hit.trustTier, "unrated");
});

test("URL yönlendirmesinde yayıncı ve bağımsızlık son adresten türetilir", async () => {
  const hit = await importOpenUrl("https://trusted-a.example/start", {
    fetchImpl: async () => response("<p>Shared source</p>", 200, "text/html", "https://shared.example/final"),
  });
  assert.equal(hit.publisher, "shared.example");
  assert.equal(hit.independenceGroup, "shared.example");
  assert.equal(hit.uri, "https://shared.example/final");
});

test("Content-Length olmadan 5 MB sınırını aşan URL akışı fail-closed kalır", async () => {
  const chunk = new Uint8Array(1_000_000);
  let sent = 0;
  const stream = new ReadableStream({
    pull(controller) {
      if (sent >= 6) return controller.close();
      sent += 1;
      controller.enqueue(chunk);
    },
  });
  await assert.rejects(
    () => importOpenUrl("https://data.example.org/huge", {
      fetchImpl: async () => new Response(stream, { headers: { "content-type": "text/plain" } }),
    }),
    /5 MB sınırını/,
  );
});

test("URL içe aktarma aktif olmayan protokolü reddeder", async () => {
  await assert.rejects(() => importOpenUrl("file:///etc/passwd"), /HTTP veya HTTPS/);
});
