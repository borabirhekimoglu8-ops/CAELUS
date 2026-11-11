/**
 * CAELUS OS — Kapı 4: Dil Eşitliği, Sade Mod Anlaşılırlığı ve Web Interface Guidelines Testi
 * (`tests/test_i18n_and_plain_mode_parity.mjs`)
 *
 * Kapsanan Zorunlu Kriterler (Master Spesifikasyon §2.1, §2.2, §5.1, §5.2, §7.4 + `/web-design-guidelines`):
 * 1. `locales/tr/{common,plain,technical}.json`, `locales/en/{common,plain,technical}.json` ve
 *    `locales/{tr,en}/messages.ftl` arasında %100 1'e 1 anahtar eşitliği, sıfır boş değer.
 * 2. §2.2 zorunlu 9 terim tablosunun `(TR | EN) × (PLAIN | TECHNICAL)` 4 modda birebir doğrulanması.
 * 3. Varsayılan açılış modunun `Sade Mod (Operatör Görünümü)` (`locale="tr"`, `register="plain"`) olması,
 *    ham `state_blake3` yığınlarının varsayılan kart görünümünde gizlenip `[Teknik Kanıtı Gör]` /
 *    `[View Technical Proof]` ile açılması.
 * 4. `EN + PLAIN` modunda ekranın tamamında sıfır Türkçe karakter/kelime sızıntısı ve sıfır çevrilmemiş anahtar.
 * 5. Dil (`TR ↔ EN`) veya anlatım modu (`PLAIN ↔ TECHNICAL`) değiştiğinde model, MCP, Rust CLI ve
 *    canlı WebSocket (`SET_LOCALE_REGISTER` + `ASSISTANT_QUERY`) katmanlarında `state_blake3` özetinin
 *    **0 bit** değişmemesi.
 * 6. Birim (`knot ↔ km/sa (km/h)`, `NM ↔ km`) ve saat (`UTC ↔ Yerel Saat / Local Time`) biçimlendiricilerinin
 *    `Intl.NumberFormat` / `Intl.DateTimeFormat` ile kayıpsız sabit nokta dönüşümü.
 * 7. `/web-design-guidelines` uyumluluk denetimi (`color-scheme`, `:focus-visible`, `@media (pointer: coarse)`
 *    44px dokunma hedefleri, `prefers-reduced-motion`, `overscroll-behavior: contain`, `translate="no"`,
 *    `.wr-skip-link`, `aria-live="polite"`, 0 dış ağ URL'si).
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const require = createRequire(import.meta.url);

const warRoomI18n = require("../ui/war_room_i18n.js");
const sidecarAirlock = require("../ui/sidecar_airlock_mcp.js");
const warRoomCockpit = require("../ui/war_room_cockpit.js");
import { startWarRoomAgUiServer } from "../tools/caelus_ag_ui_ws_server.mjs";

function parseFtlKeys(ftlSource) {
  return String(ftlSource || "")
    .split(/\r?\n/)
    .map((ln) => ln.trim())
    .filter((ln) => ln.length > 0 && !ln.startsWith("#"))
    .map((ln) => {
      const idx = ln.indexOf("=");
      return idx > 0 ? ln.slice(0, idx).trim() : null;
    })
    .filter(Boolean)
    .sort();
}

function stripHtmlTags(html) {
  return String(html || "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function findSidecarBinary() {
  const ext = process.platform === "win32" ? ".exe" : "";
  const candidates = [
    path.join(ROOT, "target", "release", `caelus_sidecar_airlock${ext}`),
    path.join(ROOT, "target", "debug", `caelus_sidecar_airlock${ext}`),
  ];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

function connectWsClient(port, host = "127.0.0.1") {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    const wsKey = crypto.randomBytes(16).toString("base64");
    let upgraded = false;
    let buf = Buffer.alloc(0);
    const messages = [];
    const waiters = [];

    function pushMessage(obj) {
      messages.push(obj);
      for (let i = waiters.length - 1; i >= 0; i--) {
        if (waiters[i].pred(obj, messages)) {
          const w = waiters.splice(i, 1)[0];
          clearTimeout(w.timer);
          w.resolve(obj);
        }
      }
    }

    function sendJson(obj) {
      const payload = Buffer.from(JSON.stringify(obj), "utf8");
      const mask = crypto.randomBytes(4);
      const hdr =
        payload.length < 126
          ? Buffer.from([0x81, 0x80 | payload.length, mask[0], mask[1], mask[2], mask[3]])
          : (() => {
              const b = Buffer.alloc(8);
              b[0] = 0x81;
              b[1] = 0x80 | 126;
              b.writeUInt16BE(payload.length, 2);
              mask.copy(b, 4);
              return b;
            })();
      const masked = Buffer.alloc(payload.length);
      for (let i = 0; i < payload.length; i++) masked[i] = payload[i] ^ mask[i & 3];
      socket.write(Buffer.concat([hdr, masked]));
    }

    socket.on("connect", () => {
      socket.write(
        [
          "GET /ws HTTP/1.1",
          `Host: ${host}:${port}`,
          "Upgrade: websocket",
          "Connection: Upgrade",
          `Sec-WebSocket-Key: ${wsKey}`,
          "Sec-WebSocket-Version: 13",
          "\r\n",
        ].join("\r\n")
      );
    });

    socket.on("data", (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      if (!upgraded) {
        const idx = buf.indexOf("\r\n\r\n");
        if (idx === -1) return;
        const headerStr = buf.subarray(0, idx).toString("utf8");
        if (!headerStr.startsWith("HTTP/1.1 101")) {
          reject(new Error(`WS upgrade failed: ${headerStr}`));
          return;
        }
        upgraded = true;
        buf = buf.subarray(idx + 4);
        resolve({
          messages,
          sendJson,
          waitFor(pred, timeoutMs = 30000) {
            for (const m of messages) {
              if (pred(m, messages)) return Promise.resolve(m);
            }
            return new Promise((res, rej) => {
              const timer = setTimeout(
                () => rej(new Error("WS message wait timed out")),
                timeoutMs
              );
              waiters.push({ pred, resolve: res, timer });
            });
          },
          close() {
            socket.destroy();
          },
        });
      }

      while (buf.length >= 2) {
        const opcode = buf[0] & 0x0f;
        let len = buf[1] & 0x7f;
        let offset = 2;
        if (len === 126) {
          if (buf.length < 4) break;
          len = buf.readUInt16BE(2);
          offset = 4;
        } else if (len === 127) {
          if (buf.length < 10) break;
          len = Number(buf.readBigUInt64BE(2));
          offset = 10;
        }
        if (buf.length < offset + len) break;
        const frameBody = buf.subarray(offset, offset + len);
        buf = buf.subarray(offset + len);
        if (opcode === 0x1) {
          pushMessage(JSON.parse(frameBody.toString("utf8")));
        }
      }
    });

    socket.on("error", (err) => {
      if (!upgraded) reject(err);
    });
  });
}

test("Kapı 4.1: TR & EN JSON ve Project Fluent (.ftl) Sözlüklerinde %100 1'e 1 Anahtar Eşitliği", () => {
  const parity = warRoomI18n.verifyCatalogParity();
  assert.equal(
    parity.ok,
    true,
    `Sözlük anahtar eşitliği hatası: ${(parity.issues || []).join("; ")}`
  );
  assert.ok(parity.commonKeyCount >= 145);
  assert.ok(parity.plainKeyCount >= 95);
  assert.equal(parity.plainKeyCount, parity.technicalKeyCount);

  const trFtl = fs.readFileSync(path.join(ROOT, "locales", "tr", "messages.ftl"), "utf8");
  const enFtl = fs.readFileSync(path.join(ROOT, "locales", "en", "messages.ftl"), "utf8");
  const trFtlKeys = parseFtlKeys(trFtl);
  const enFtlKeys = parseFtlKeys(enFtl);
  assert.ok(trFtlKeys.length >= 20, "messages.ftl en az 20 kanonik anahtar içermeli");
  assert.deepEqual(trFtlKeys, enFtlKeys, "TR ve EN messages.ftl anahtarları birebir eşit olmalı");

  // Gömülü war_room_i18n.js sözlüğü ile diskteki locales/ dosyaları senkron olmalı
  for (const loc of ["tr", "en"]) {
    for (const ns of ["common", "plain", "technical"]) {
      const diskObj = JSON.parse(
        fs.readFileSync(path.join(ROOT, "locales", loc, `${ns}.json`), "utf8")
      );
      assert.deepEqual(
        warRoomI18n.EMBEDDED_LOCALE_CATALOG[loc][ns],
        diskObj,
        `ui/war_room_i18n.js gömülü sözlüğü locales/${loc}/${ns}.json ile senkron olmalı`
      );
    }
  }
});

test("Kapı 4.2: §2.2 Zorunlu Terim Tablosu, §5.1 Geometrik Alarm Rozetleri ve Birim/Saat Dönüştürücüsü", () => {
  // 1) §2.2 Zorunlu 9 Satırlık Sade (Plain) ve Teknik (Technical) Çeviri Eşitliği
  assert.equal(
    warRoomI18n.formatVerdict("GEÇTİ", {}, { locale: "tr", register: "plain" }),
    "Emniyetli — İşleme Uygun"
  );
  assert.equal(
    warRoomI18n.formatVerdict("GEÇTİ", {}, { locale: "en", register: "plain" }),
    "Safe to Proceed"
  );
  assert.match(
    warRoomI18n.formatVerdict("GEÇTİ", { policy_id: "MARITIME_SAFETY_V2" }, { locale: "tr", register: "technical" }),
    /^VERDICT: PASS/
  );

  assert.equal(
    warRoomI18n.formatVerdict("KURAL_İHLALİ", {}, { locale: "tr", register: "plain" }),
    "Emniyet Kuralı Aşıldı — Müdahale Gerekli"
  );
  assert.equal(
    warRoomI18n.formatVerdict("KURAL_İHLALİ", {}, { locale: "en", register: "plain" }),
    "Safety Rule Breached — Action Required"
  );
  assert.match(
    warRoomI18n.formatVerdict("KURAL_İHLALİ", {}, { locale: "en", register: "technical" }),
    /^VERDICT: RULE_BREACH/
  );

  assert.equal(
    warRoomI18n.formatVerdict("KANIT_YETERSİZ", {}, { locale: "tr", register: "plain" }),
    "Tek Kaynaklı Bildirim — Bağımsız Teyit Bekleniyor"
  );
  assert.equal(
    warRoomI18n.formatVerdict("KANIT_YETERSİZ", {}, { locale: "en", register: "plain" }),
    "Single-Source Report — Awaiting Confirmation"
  );
  assert.match(
    warRoomI18n.formatVerdict("KANIT_YETERSİZ", {}, { locale: "en", register: "technical" }),
    /^VERDICT: INSUFFICIENT_EVIDENCE/
  );

  assert.equal(
    warRoomI18n.formatEpistemic("OBSERVATION", { locale: "tr", register: "plain" }),
    "Doğrudan Sensör Ölçümü"
  );
  assert.equal(
    warRoomI18n.formatEpistemic("OBSERVATION", { locale: "en", register: "plain" }),
    "Direct Sensor Reading"
  );
  assert.equal(
    warRoomI18n.formatEpistemic("CLAIM", { locale: "tr", register: "plain" }),
    "Operatör / Kurum Bildirimi"
  );
  assert.equal(
    warRoomI18n.formatEpistemic("CLAIM", { locale: "en", register: "plain" }),
    "Reported Statement"
  );
  assert.equal(
    warRoomI18n.formatEpistemic("HYPOTHESIS", { locale: "tr", register: "plain" }),
    "Hava / Model Tahmini"
  );
  assert.equal(
    warRoomI18n.formatEpistemic("HYPOTHESIS", { locale: "en", register: "plain" }),
    "Model Forecast / Estimate"
  );

  assert.equal(
    warRoomI18n.resolveCanonicalMessage(
      "security.source_equivocation",
      { source_id: "ferry_operator_dispatch", seq_no: "1" },
      { locale: "tr", register: "plain" }
    ),
    "Güvenlik Uyarısı: Kaynak Çelişkili Veri Gönderdi (Engellendi)"
  );
  assert.equal(
    warRoomI18n.resolveCanonicalMessage(
      "security.source_equivocation",
      { source_id: "ferry_operator_dispatch", seq_no: "1" },
      { locale: "en", register: "plain" }
    ),
    "Security Alert: Conflicting Duplicate From Source (Blocked)"
  );

  assert.equal(
    warRoomI18n.resolveCanonicalMessage("temporal.bitemporal_slice", {}, { locale: "tr", register: "plain" }),
    "Olay Anı / Sistemin Öğrendiği An"
  );
  assert.equal(
    warRoomI18n.resolveCanonicalMessage("temporal.bitemporal_slice", {}, { locale: "en", register: "plain" }),
    "Happened At / Received At"
  );

  assert.equal(
    warRoomI18n.resolveCanonicalMessage("counterfactual.branch_delta", {}, { locale: "tr", register: "plain" }),
    'Alternatif Senaryo Denemesi ("Ya Şöyle Olursa?")'
  );
  assert.equal(
    warRoomI18n.resolveCanonicalMessage("counterfactual.branch_delta", {}, { locale: "en", register: "plain" }),
    "What-If Scenario Simulation"
  );

  // 2) §5.1 Alarm Geometrisi + Yerelleştirilmiş Etiket
  assert.equal(warRoomI18n.formatAlarmBadge("CRITICAL", { locale: "tr" }), "▲ KRİTİK");
  assert.equal(warRoomI18n.formatAlarmBadge("CRITICAL", { locale: "en" }), "▲ CRITICAL");
  assert.equal(warRoomI18n.formatAlarmBadge("KANIT_YETERSİZ", { locale: "tr" }), "◌ TEYİT BEKLİYOR");
  assert.equal(warRoomI18n.formatAlarmBadge("KANIT_YETERSİZ", { locale: "en" }), "◌ AWAITING CONFIRMATION");

  // 3) Kayıpsız Sabit Nokta Birim Dönüşümü (`14.2 kn` -> `26,3 km/sa` / `26.3 km/h`, `5.0 NM` -> `9,3 km` / `9.3 km`)
  assert.equal(warRoomI18n.formatFpSpeedKn("14200000", { locale: "tr", speedUnit: "kn" }), "14,2 kn");
  assert.equal(warRoomI18n.formatFpSpeedKn("14200000", { locale: "tr", speedUnit: "kmh" }), "26,3 km/sa");
  assert.equal(warRoomI18n.formatFpSpeedKn("14200000", { locale: "en", speedUnit: "kmh" }), "26.3 km/h");
  assert.equal(warRoomI18n.formatFpDistanceNm("5000000", { locale: "tr", distanceUnit: "km" }), "9,3 km");
  assert.equal(warRoomI18n.formatFpDistanceNm("5000000", { locale: "en", distanceUnit: "km" }), "9.3 km");
  assert.equal(warRoomI18n.formatClockMs("1762849500000", { locale: "en", clockMode: "UTC" }), "08:25:00 UTC");
  assert.match(warRoomI18n.formatClockMs("1762849500000", { locale: "tr", clockMode: "LOCAL" }), /Yerel Saat$/);
  assert.match(warRoomI18n.formatClockMs("1762849500000", { locale: "en", clockMode: "LOCAL" }), /Local Time$/);
});

test("Kapı 4.3: Varsayılan Sade Mod Açılışı, Sıfır Kırma Dil Sızıntısı, [Teknik Kanıtı Gör] Çekmecesi ve 0-Bit state_blake3 Değişmezliği", () => {
  const cockpit = warRoomCockpit.createWarRoomCockpitModel();

  // Varsayılan açılış modu kesinlikle Türkçe + Sade Mod olmalı
  assert.equal(cockpit.state.locale, "tr");
  assert.equal(cockpit.state.register, "plain");

  const baselineT2Blake3 = cockpit.state.sliceSync.slice.state_blake3;
  assert.equal(baselineT2Blake3.length, 64);

  // TR + PLAIN görünümde ham state_blake3 kart gövdesinde gizli olmalı, ancak çelişki (+15,0 dk vs +35,0 dk) yan yana korunmalı
  const snapTrPlain = warRoomCockpit.renderCockpitZonesSnapshot(cockpit);
  assert.ok(snapTrPlain.topBarHtml.includes("Emniyet Kuralı Aşıldı — Müdahale Gerekli"));
  assert.ok(snapTrPlain.topBarHtml.includes("✓ Denetim Mührü Doğrulandı"));
  assert.ok(!snapTrPlain.dockHtml.includes("state_blake3:"), "Sade Mod kartlarında ham state_blake3 varsayılan olarak gizli olmalı");
  assert.ok(snapTrPlain.dockHtml.includes("Teknik Kanıtı Gör"));
  assert.ok(snapTrPlain.dockHtml.includes("+15,0 dk"));
  assert.ok(snapTrPlain.dockHtml.includes("+35,0 dk"));

  // Nedensel akış şeridi Sade TR metnini içermeli
  cockpit.state.stageMode = "GRAPH";
  const snapTrPlainGraph = warRoomCockpit.renderCockpitZonesSnapshot(cockpit);
  assert.ok(snapTrPlainGraph.stageHtml.includes("Liman Rampası Arızası (+35 dk)"));
  assert.ok(snapTrPlainGraph.stageHtml.includes("Emniyetli Yanaşma Süresi Aşıldı"));

  // Kart bazlı `[Teknik Kanıtı Gör]` açıldığında state_blake3 ve branch_state_blake3 görünmeli
  cockpit.toggleCardProof("coa-20261111-01");
  const snapWithProofDrawer = warRoomCockpit.renderCockpitZonesSnapshot(cockpit);
  assert.ok(snapWithProofDrawer.dockHtml.includes("state_blake3:"));
  assert.ok(snapWithProofDrawer.dockHtml.includes("branch_state_blake3:"));
  cockpit.toggleCardProof("coa-20261111-01");

  // Dil (`L`: TR -> EN) değiştiğinde state_blake3 0 bit değişmeli ve ekran %100 İngilizce olmalı!
  cockpit.setLocale("en");
  assert.equal(
    cockpit.state.sliceSync.slice.state_blake3,
    baselineT2Blake3,
    "TR -> EN dil geçişi state_blake3 özetini 0 bit bile değiştiremez"
  );

  cockpit.state.stageMode = "MAP";
  const snapEnPlainMap = warRoomCockpit.renderCockpitZonesSnapshot(cockpit);
  cockpit.state.stageMode = "GRAPH";
  const snapEnPlainGraph = warRoomCockpit.renderCockpitZonesSnapshot(cockpit);

  assert.ok(snapEnPlainMap.topBarHtml.includes("Safety Rule Breached — Action Required"));
  assert.ok(snapEnPlainGraph.stageHtml.includes("Port Ramp Fault (+35 min)"));
  assert.ok(snapEnPlainGraph.stageHtml.includes("Safe Berthing Window Exceeded"));
  assert.ok(snapEnPlainMap.dockHtml.includes("View Technical Proof"));
  assert.ok(snapEnPlainMap.dockHtml.includes("Show on Map"));
  assert.ok(snapEnPlainMap.dockHtml.includes("Simulate Option"));
  assert.ok(snapEnPlainMap.dockHtml.includes("Approve &amp; Sign"));

  // EN + PLAIN modda tüm görünür metinlerde sıfır Türkçe karakter (`ğüşöçıİĞÜŞÖÇ`) ve sıfır çevrilmemiş anahtar olmalı!
  const visibleEnText = [
    stripHtmlTags(snapEnPlainMap.topBarHtml),
    stripHtmlTags(snapEnPlainMap.stageHtml),
    stripHtmlTags(snapEnPlainGraph.stageHtml),
    stripHtmlTags(snapEnPlainMap.dockHtml),
    stripHtmlTags(snapEnPlainMap.conductorHtml),
    stripHtmlTags(snapEnPlainMap.sealModalHtml),
  ].join(" ");

  const turkishCharsMatch = visibleEnText.match(/[ğüşöçıİĞÜŞÖÇ]/g) || [];
  assert.deepEqual(
    turkishCharsMatch,
    [],
    `EN + PLAIN görünümde Türkçe karakter sızıntısı bulundu: ${turkishCharsMatch.join(", ")} | Metin: ${visibleEnText}`
  );
  assert.ok(
    !/\b(?:topbar|stage|map|graph|conductor|table|dock|conflict|agent|card|assistant|seal_modal)\.[a-z0-9_]+\b/i.test(
      visibleEnText
    ),
    "Görünür arayüzde çevrilmemiş ham sözlük anahtarı bulunmamalı"
  );

  // Sadelik (`S`: PLAIN -> TECHNICAL) geçişinde de state_blake3 0 bit değişmeli
  cockpit.setRegister("technical");
  assert.equal(
    cockpit.state.sliceSync.slice.state_blake3,
    baselineT2Blake3,
    "PLAIN -> TECHNICAL geçişi state_blake3 özetini 0 bit bile değiştiremez"
  );
  const snapEnTech = warRoomCockpit.renderCockpitZonesSnapshot(cockpit);
  assert.ok(snapEnTech.topBarHtml.includes("state_blake3:"));
  assert.ok(snapEnTech.topBarHtml.includes("VERDICT: RULE_BREACH"));

  cockpit.setLocale("tr");
  assert.equal(cockpit.state.sliceSync.slice.state_blake3, baselineT2Blake3);
});

test("Kapı 4.4: MCP, Rust Sidecar CLI ve Canlı WebSocket (SET_LOCALE_REGISTER + Çok Dilli Asistan) 0-Bit Kanıtı", async () => {
  const mcp = sidecarAirlock.createSidecarAirlockMcpController({
    forcePureJsFallback: process.env.CAELUS_WASM_ONLY === "1",
  });

  const combos = [
    { locale: "tr", register: "plain" },
    { locale: "en", register: "plain" },
    { locale: "tr", register: "technical" },
    { locale: "en", register: "technical" },
  ];
  const hashes = new Set();
  for (const c of combos) {
    const out = mcp.invokeAirlockTool({
      toolName: "caelus_explain_outcome",
      arguments: {
        batch_path: "scenarios/pilot_aegean_ferry_airlock/events.airlock.ndjson",
        manifest_path: "configs/source_manifest.json",
        cutoff_learned_at_ms: warRoomCockpit.T2_CUTOFF_MS,
        locale: c.locale,
        register: c.register,
      },
    });
    assert.equal(out.ok, true);
    assert.equal(out.msg_id, "verdict.rule_breach");
    assert.ok(typeof out.localized_explanation === "string" && out.localized_explanation.length > 10);
    hashes.add(out.state_blake3);
  }
  assert.equal(hashes.size, 1, "4 (TR|EN)x(PLAIN|TECHNICAL) MCP çağrısı tek bir özdeş state_blake3 üretmeli");

  // Derlenmiş Rust ikilisi varsa doğrudan CLI `--locale` ve `--register` bayraklarını da doğrula
  const sidecarBin = findSidecarBinary();
  if (sidecarBin && process.env.CAELUS_WASM_ONLY !== "1") {
    const manifestPath = path.join(ROOT, "configs", "source_manifest.json");
    const batchPath = path.join(ROOT, "scenarios", "pilot_aegean_ferry_airlock", "events.airlock.ndjson");
    const cliTrPlain = JSON.parse(
      execFileSync(
        sidecarBin,
        [
          "explain",
          "--batch",
          batchPath,
          "--manifest",
          manifestPath,
          "--cutoff-ms",
          warRoomCockpit.T2_CUTOFF_MS,
          "--locale",
          "tr",
          "--register",
          "plain",
        ],
        { encoding: "utf8", windowsHide: true }
      )
    );
    const cliEnPlain = JSON.parse(
      execFileSync(
        sidecarBin,
        [
          "explain",
          "--batch",
          batchPath,
          "--manifest",
          manifestPath,
          "--cutoff-ms",
          warRoomCockpit.T2_CUTOFF_MS,
          "--locale",
          "en",
          "--register",
          "plain",
        ],
        { encoding: "utf8", windowsHide: true }
      )
    );
    assert.equal(cliTrPlain.state_blake3, cliEnPlain.state_blake3);
    assert.equal(cliTrPlain.verdict_text, "Emniyet Kuralı Aşıldı — Müdahale Gerekli");
    assert.equal(cliEnPlain.verdict_text, "Safety Rule Breached — Action Required");
  }

  // Canlı AG-UI WebSocket üzerinden `SET_LOCALE_REGISTER` ve çok dilli `ASSISTANT_QUERY`
  const srv = await startWarRoomAgUiServer({
    port: 0,
    mode: "offline",
    initialCutoffMs: warRoomCockpit.T2_CUTOFF_MS,
    forcePureJsFallback: process.env.CAELUS_WASM_ONLY === "1",
  });
  let ws = null;
  try {
    ws = await connectWsClient(srv.port);
    const syncTr = await ws.waitFor((m) => m.msg_type === "SLICE_STATE_SYNC");
    assert.equal(syncTr.locale, "tr");
    assert.equal(syncTr.register, "plain");

    ws.messages.length = 0;
    ws.sendJson({
      cmd: "SET_LOCALE_REGISTER",
      cutoff_learned_at_ms: warRoomCockpit.T2_CUTOFF_MS,
      locale: "en",
      register: "plain",
    });
    const syncEn = await ws.waitFor((m) => m.msg_type === "SLICE_STATE_SYNC" && m.locale === "en");
    const cardEn = await ws.waitFor((m) => m.msg_type === "ACTION_APPROVAL_CARD" && m.locale === "en");
    assert.equal(syncEn.slice.state_blake3, syncTr.slice.state_blake3);
    assert.ok(cardEn.title.includes("Option A: Divert to Alternate Berth (Berth-B)"));

    ws.sendJson({
      cmd: "ASSISTANT_QUERY",
      cutoff_learned_at_ms: warRoomCockpit.T2_CUTOFF_MS,
      locale: "en",
      register: "plain",
      query: "What happens if we use the alternate berth option?",
    });
    const replyEn = await ws.waitFor((m) => m.msg_type === "ASSISTANT_EVIDENCE_REPLY" && m.locale === "en");
    assert.equal(replyEn.state_blake3, syncTr.slice.state_blake3);
    assert.ok(replyEn.structured_answer.includes("Safety Rule Breached — Action Required"));
    assert.ok(replyEn.structured_answer.includes("Safe to Proceed"));
    assert.equal(/[ğüşöçıİĞÜŞÖÇ]/.test(replyEn.structured_answer), false);
    assert.ok(Array.isArray(replyEn.focus_chips) && replyEn.focus_chips.length >= 3);

    // `/locales/en/plain.json` statik servis kontrolü
    const httpRes = await fetch(`${srv.httpUrl}/locales/en/plain.json`);
    assert.equal(httpRes.status, 200);
    const enPlainHttp = await httpRes.json();
    assert.equal(enPlainHttp["verdict.GEÇTİ"], "Safe to Proceed");
  } finally {
    if (ws) ws.close();
    await srv.close();
  }
});

test("Kapı 4.5: /web-design-guidelines Erişilebilirlik, Odak, Dokunmatik ve Tipografi Denetimi", () => {
  const tokensCss = fs.readFileSync(path.join(ROOT, "ui", "tokens.css"), "utf8");
  const cockpitJs = fs.readFileSync(path.join(ROOT, "ui", "war_room_cockpit.js"), "utf8");
  const indexHtml = fs.readFileSync(path.join(ROOT, "ui", "index.html"), "utf8");

  assert.ok(tokensCss.includes("color-scheme: dark"), "Dusk/Night temalarında color-scheme: dark bulunmalı");
  assert.ok(tokensCss.includes("color-scheme: light"), "Day temasında color-scheme: light bulunmalı");
  assert.ok(tokensCss.includes("prefers-reduced-motion: reduce"), "prefers-reduced-motion desteği bulunmalı");
  assert.ok(tokensCss.includes("@media (pointer: coarse)"), "Dokunmatik 44x44px hedef kuralı bulunmalı");
  assert.ok(tokensCss.includes("overscroll-behavior: contain"), "Modal ve kaydırma kaplarında overscroll-behavior: contain bulunmalı");
  assert.ok(tokensCss.includes(".wr-skip-link"), "Ana içeriğe atlama bağlantısı (.wr-skip-link) bulunmalı");
  assert.ok(!/transition\s*:\s*all\b/i.test(tokensCss), "transition: all yasaktır");

  assert.ok(cockpitJs.includes('aria-live="polite"'), "Canlı hüküm ve asistan bölgelerinde aria-live=polite bulunmalı");
  assert.ok(cockpitJs.includes('translate="no"'), "Kriptografik özetler ve kimliklerde translate=no bulunmalı");
  assert.ok(cockpitJs.includes('autocomplete="off"'), "Komut ve sorgu girdilerinde autocomplete=off bulunmalı");
  assert.ok(indexHtml.includes('src="war_room_i18n.js"'), "ui/index.html içinde war_room_i18n.js yüklenmeli");
});
