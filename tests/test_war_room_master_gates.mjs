/**
 * CAELUS OS — Master Mimari Doğrulama Kapıları Test Paketi (`test_war_room_master_gates.mjs`)
 *
 * Kapsanan Zorunlu Kapılar (§6.1 – §6.6):
 * - Faz 0: `.agent/skills/caelus-axioms/SKILL.md` mühürlü kurallar kontrolü
 * - Kapı 2 & 3: Çift-Zamanlı `T1 (08:10) -> KANIT_YETERSİZ`, `08:15 SOURCE_EQUIVOCATION -> 0-Bit State`,
 *               `T2 (08:25) -> KURAL_İHLALİ` ve No-Lookahead (gelecek olayları varken/yokken bit-özdeş `state_blake3`)
 * - Kapı 4: Epistemik Çelişki Koruma (`ferry_operator_dispatch +15.0 dk CLAIM` vs `ais_terrestrial_aegean +35.0 dk OBSERVATION` yan yana)
 * - Kapı 5: `> 2^53 - 1` (`"9007199254740993"`) 64-bit tam sayı sınır koruması:
 *           Sidecar -> MCP -> WebSocket (`CAELUS_AG_UI_V1`) -> War Room Kokpit Tablosu sıfır bit kaybı + tırnaksız JSON reddi
 * - Kapı 6: %100 Hava Boşluklu (Air-Gapped) UI varlık taraması (`0` dış CDN / Google Fonts / harita karo URL'si),
 *           OpenBridge `Day/Dusk/Night`, `AUDITOR` T1 kilidi ve Operatör `Ed25519` Eylem Kartı imzasının
 *           `audit_log.rs` zincirine mühürlenip `caelus_verify_audit` ikilisiyle doğrulanması (`Exit Code 0`).
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const require = createRequire(import.meta.url);

const sidecarAirlock = require("../ui/sidecar_airlock_mcp.js");
const agUiEngine = require("../ui/war_room_ag_ui_engine.js");
const warRoomCockpit = require("../ui/war_room_cockpit.js");
import { startWarRoomAgUiServer } from "../tools/caelus_ag_ui_ws_server.mjs";

function findVerifyAuditBinary() {
  const ext = process.platform === "win32" ? ".exe" : "";
  const candidates = [
    path.join(ROOT, "target", "release", `caelus_verify_audit${ext}`),
    path.join(ROOT, "target", "debug", `caelus_verify_audit${ext}`),
  ];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

/**
 * Node 18/20/22/24 uyumlu sıfır bağımlılıklı RFC 6455 WebSocket test istemcisi.
 */
function connectWsTestClient(port, host = "127.0.0.1") {
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

    function sendText(rawStr) {
      const payload = Buffer.from(rawStr, "utf8");
      const mask = crypto.randomBytes(4);
      let hdr;
      if (payload.length < 126) {
        hdr = Buffer.alloc(6);
        hdr[0] = 0x81;
        hdr[1] = 0x80 | payload.length;
        mask.copy(hdr, 2);
      } else {
        hdr = Buffer.alloc(8);
        hdr[0] = 0x81;
        hdr[1] = 0x80 | 126;
        hdr.writeUInt16BE(payload.length, 2);
        mask.copy(hdr, 4);
      }
      const masked = Buffer.alloc(payload.length);
      for (let i = 0; i < payload.length; i++) {
        masked[i] = payload[i] ^ mask[i & 3];
      }
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
          reject(new Error(`WS el sıkışma hatası: ${headerStr}`));
          return;
        }
        upgraded = true;
        buf = buf.subarray(idx + 4);
        resolve({
          messages,
          sendText,
          waitFor(pred, timeoutMs = 6000) {
            for (const m of messages) {
              if (pred(m, messages)) return Promise.resolve(m);
            }
            return new Promise((resWait, rejWait) => {
              const timer = setTimeout(
                () => rejWait(new Error("WebSocket mesaj bekleme zaman aşımı")),
                timeoutMs
              );
              waiters.push({ pred, resolve: resWait, timer });
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

test("Faz 0 & Kapı 6: A-1/A-2/A-3 mimari yasaları ve %100 Hava Boşluklu UI dosyaları (0 dış URL, 0 transition:all)", () => {
  const axiomPath = path.join(ROOT, ".agent", "skills", "caelus-axioms", "SKILL.md");
  assert.ok(fs.existsSync(axiomPath), ".agent/skills/caelus-axioms/SKILL.md mevcut olmalı");
  const axiomText = fs.readFileSync(axiomPath, "utf8");
  assert.ok(axiomText.includes("A-1 Determinizm"));
  assert.ok(axiomText.includes("2^53 - 1"));
  assert.ok(axiomText.includes("A-2 Fail-Closed"));
  assert.ok(axiomText.includes("A-3 Hava Boşluklu"));

  // Yeni War Room UI varlıklarında sıfır dış CDN / Google Fonts / çevrimiçi karo URL'si
  const airGappedUiFiles = [
    "ui/tokens.css",
    "ui/war_room_i18n.js",
    "ui/sidecar_airlock_mcp.js",
    "ui/war_room_ag_ui_engine.js",
    "ui/war_room_cockpit.js",
  ];
  for (const rel of airGappedUiFiles) {
    const content = fs.readFileSync(path.join(ROOT, rel), "utf8");
    const extUrls = content.match(/https?:\/\/(?!127\.0\.0\.1|localhost)[^\s"'`)]+/gi) || [];
    assert.deepEqual(
      extUrls,
      [],
      `${rel} içinde harici ağ URL'si bulunmamalı, bulunan: ${extUrls.join(", ")}`
    );
  }

  const indexHtml = fs.readFileSync(path.join(ROOT, "ui", "index.html"), "utf8");
  assert.ok(indexHtml.includes('id="caelus-war-room-cockpit-shell"'));
  assert.ok(!/<(?:script|link|img|iframe)\b[^>]+(?:src|href)=["']https?:\/\//i.test(indexHtml));
  assert.ok(!/@import\s+url\(["']?https?:\/\//i.test(indexHtml));

  const tokensCss = fs.readFileSync(path.join(ROOT, "ui", "tokens.css"), "utf8");
  assert.ok(tokensCss.includes('[data-ob-theme="dusk"]'));
  assert.ok(tokensCss.includes('[data-ob-theme="night"]'));
  assert.ok(tokensCss.includes('[data-ob-theme="day"]'));
  assert.ok(tokensCss.includes("--bg-canvas: #0b1017"));
  assert.ok(tokensCss.includes("--status-critical: #ff3b30"));
  assert.ok(tokensCss.includes("--status-insufficient: #64d2ff"));
  assert.ok(tokensCss.includes("--epistemic-observation: #2dd4bf"));
  assert.ok(tokensCss.includes("--epistemic-claim: #f59e0b"));
  assert.ok(tokensCss.includes("--epistemic-hypothesis: #a78bfa"));
  assert.ok(tokensCss.includes("tabular-nums"));
  assert.ok(!/transition\s*:\s*all\b/i.test(tokensCss), "tokens.css içinde transition: all yasaktır");
});

test("Kapı 2, 3 & 4: T1 <-> T2 Time Conductor, No-Lookahead Bit-Özdeşliği, 08:15 0-Bit Karantina ve Epistemik Çelişki Koruma", () => {
  const manifestJson = fs.readFileSync(path.join(ROOT, "configs", "source_manifest.json"), "utf8");
  const fullBatchNdjson = fs.readFileSync(
    path.join(ROOT, "scenarios", "pilot_aegean_ferry_airlock", "events.airlock.ndjson"),
    "utf8"
  );

  const cockpit = warRoomCockpit.createWarRoomCockpitModel({
    pilotBundle: { manifest_json: manifestJson, batch_ndjson: fullBatchNdjson },
    initialCutoffMs: warRoomCockpit.T1_CUTOFF_MS,
  });

  // 1) T1 = 08:10 (1762848600000) -> KANIT_YETERSİZ + AUDITOR imza kilidi + gelecek satırları gri/kilitli
  assert.equal(cockpit.state.sliceSync.slice.verdict, "KANIT_YETERSİZ");
  const t1HashWithFuture = cockpit.state.sliceSync.slice.state_blake3;
  assert.equal(t1HashWithFuture.length, 64);

  const t1Rows = cockpit.getDecoratedTelemetryRows();
  const futureRowsAtT1 = t1Rows.filter((r) => r.is_future);
  assert.ok(futureRowsAtT1.length >= 4, "T1 kesitinde T2 olayları gelecek kesiti olarak işaretlenmeli");
  assert.ok(
    futureRowsAtT1.every((r) => r.temporal_status_tr === "Henüz Öğrenilmedi (Gelecek Kesiti)")
  );

  // AUDITOR T1'de operatör imzasını reddetmeli (Fail-Closed)
  const blockedSealAtT1 = cockpit.signAndSealActionCardLocal("coa-20261111-01");
  assert.equal(blockedSealAtT1.ok, false);
  assert.equal(blockedSealAtT1.errorCode, "ERR_AUDITOR_FAIL_CLOSED_INSUFFICIENT_EVIDENCE");

  // No-Lookahead kanıtı: T1 sonrası satırlar fiziksel olarak silindiğinde T1 state_blake3 bit-özdeş kalmalı!
  const onlyUpToT1Lines =
    fullBatchNdjson
      .trim()
      .split(/\r?\n/)
      .filter((ln) => BigInt(JSON.parse(ln).learned_at_ms) <= BigInt(warRoomCockpit.T1_CUTOFF_MS))
      .join("\n") + "\n";
  const cockpitWithoutFuture = warRoomCockpit.createWarRoomCockpitModel({
    pilotBundle: { manifest_json: manifestJson, batch_ndjson: onlyUpToT1Lines },
    initialCutoffMs: warRoomCockpit.T1_CUTOFF_MS,
  });
  assert.equal(
    cockpitWithoutFuture.state.sliceSync.slice.state_blake3,
    t1HashWithFuture,
    "No-Lookahead ihlali: gelecekteki olayların varlığı T1 state_blake3 özetini değiştiremez"
  );

  // 2) Kapı 2: 08:15 (1762848900000) -> Bozuk imza, yetkisiz event_kind, >2^62 taşma ve SOURCE_EQUIVOCATION
  //    girdileri karantinaya alınır ve temiz kesite kıyasla state_blake3 üzerinde 0-bit değişim yaratır!
  cockpit.setCutoffMs(warRoomCockpit.TAMPER_CHECK_MS);

  const cleanBatchWithoutTamper =
    fullBatchNdjson
      .trim()
      .split(/\r?\n/)
      .filter((ln) => !ln.includes("ev_103_equivocation"))
      .join("\n") + "\n";
  const cleanCockpitAt0815 = warRoomCockpit.createWarRoomCockpitModel({
    pilotBundle: { manifest_json: manifestJson, batch_ndjson: cleanBatchWithoutTamper },
    initialCutoffMs: warRoomCockpit.TAMPER_CHECK_MS,
  });
  assert.equal(
    cockpit.state.sliceSync.slice.state_blake3,
    cleanCockpitAt0815.state.sliceSync.slice.state_blake3,
    "Karantinaya alınan SOURCE_EQUIVOCATION paketi state_blake3 üzerinde 0-bit değişim yaratmalı"
  );

  // Ek negatif saldırı vektörleri (bozuk imza + yetkisiz event_kind + |val| > 2^62 taşması)
  const firstLineObj = JSON.parse(cleanBatchWithoutTamper.trim().split(/\r?\n/)[0]);
  const badSigLine = JSON.stringify({
    ...firstLineObj,
    sig: firstLineObj.sig.slice(0, -4) + "ffff",
  });
  const unauthKindLine = JSON.stringify({
    ...firstLineObj,
    header: firstLineObj.header.replace("|DELAY_NOTICE|", "|UNAUTHORIZED_WEAPON_CMD|"),
  });
  const overflow2Pow62Line = JSON.stringify({
    ...firstLineObj,
    payload_raw: '{"entity_id":"FERRY_AEGEAN_01","fp_scale":1000000,"rounding":"HALF_EVEN","metrics":{"delay_min_fp":"4611686018427387905"}}',
  });
  const multiAttackBatch =
    fullBatchNdjson +
    badSigLine +
    "\n" +
    unauthKindLine +
    "\n" +
    overflow2Pow62Line +
    "\n";
  const multiAttackCockpitAt0815 = warRoomCockpit.createWarRoomCockpitModel({
    pilotBundle: { manifest_json: manifestJson, batch_ndjson: multiAttackBatch },
    initialCutoffMs: warRoomCockpit.TAMPER_CHECK_MS,
  });
  assert.equal(
    multiAttackCockpitAt0815.state.sliceSync.slice.state_blake3,
    cleanCockpitAt0815.state.sliceSync.slice.state_blake3,
    "Bozuk imza, yetkisiz event_kind, |val| > 2^62 taşması ve SOURCE_EQUIVOCATION state_blake3 özetini 0-bit değiştirmeli"
  );

  // 3) T2 = 08:25 (1762849500000) -> KURAL_İHLALİ + ADS-B bayatlama + yan yana çelişki koruma
  cockpit.setCutoffMs(warRoomCockpit.T2_CUTOFF_MS);
  assert.equal(cockpit.state.sliceSync.slice.verdict, "KURAL_İHLALİ");
  assert.notEqual(cockpit.state.sliceSync.slice.state_blake3, t1HashWithFuture);

  const stalenessAtT2 = cockpit.computeSourceStalenessStrip();
  const adsbPill = stalenessAtT2.find((p) => p.code === "ADS-B");
  assert.ok(adsbPill);
  assert.equal(adsbPill.freshness, "STALE", "T2'de >120sn yaşlı ADS-B verisi STALE olmalı");

  // Kapı 4: +15.0 dk CLAIM vs +35.0 dk OBSERVATION yan yana silinmeden korunmalı
  const conflicts = cockpit.state.sliceSync.slice.active_conflicts;
  assert.ok(conflicts.length >= 1, "T2'de kaynak çelişkisi aktif olmalı");
  assert.equal(conflicts[0].min_fp_val, "15000000");
  assert.equal(conflicts[0].max_fp_val, "35000000");

  const assertions = cockpit.state.sliceSync.slice.active_assertions;
  const claimEv = assertions.find((a) => a.source_id === "ferry_operator_dispatch");
  const obsEv = assertions.find((a) => a.source_id === "ais_terrestrial_aegean");
  assert.ok(claimEv && obsEv, "Her iki kaynak da aktif kanıt listesinde yer almalı");
  assert.equal(claimEv.epistemic_status, "CLAIM");
  assert.equal(claimEv.fp_val, "15000000");
  assert.equal(obsEv.epistemic_status, "OBSERVATION");
  assert.equal(obsEv.fp_val, "35000000");
});

test("Kapı 5 & 6: Canlı AG-UI WebSocket Akışı, > 2^53 - 1 Kayıpsız String Turu ve Ed25519 Audit Mühürleme", async () => {
  const tmpAuditDir = fs.mkdtempSync(path.join(os.tmpdir(), "caelus-master-gate-audit-"));
  const auditLogPath = path.join(tmpAuditDir, "gate6_operator_seal_audit.log");
  let srv = null;
  let client = null;

  try {
    srv = await startWarRoomAgUiServer({
      port: 0, // Çakışmasız yerel loopback portu
      liveMode: false,
      auditLogPath,
      initialCutoffMs: warRoomCockpit.T2_CUTOFF_MS,
      forcePureJsFallback: process.env.CAELUS_WASM_ONLY === "1",
    });

    client = await connectWsTestClient(srv.port, "127.0.0.1");

    // 1) İlk bağlantıda 4 uzman ajanın zarfları akmalı
    const initialSync = await client.waitFor((m) => m.msg_type === "SLICE_STATE_SYNC");
    await client.waitFor((m) => m.msg_type === "EVENT_ANOMALY_FLAGGED" && m.agent_id === "SENTINEL");
    await client.waitFor((m) => m.msg_type === "STRESS_THRESHOLD_ALERT" && m.agent_id === "RED_TEAM");
    await client.waitFor(
      (_, all) => all.filter((x) => x.msg_type === "ACTION_APPROVAL_CARD").length >= 2
    );

    assert.equal(initialSync.slice.verdict, "KURAL_İHLALİ");

    // 2) Kapı 5: > 2^53 - 1 ("9007199254740993") Sidecar -> MCP -> WS -> War Room Kokpit kayıpsız string kontrolü
    const precisionAssertion = initialSync.slice.active_assertions.find(
      (a) => a.event_id === "ev_106"
    );
    assert.ok(precisionAssertion, "ev_106 aktif kesitte bulunmalı");
    assert.equal(typeof precisionAssertion.seq_no, "string");
    assert.equal(precisionAssertion.seq_no, "9007199254740993");

    const uiCockpit = warRoomCockpit.createWarRoomCockpitModel();
    uiCockpit.applyAgUiEnvelopes(client.messages);
    const uiEv106Row = uiCockpit
      .getDecoratedTelemetryRows()
      .find((r) => r.event_id === "ev_106");
    assert.ok(uiEv106Row);
    assert.equal(typeof uiEv106Row.seq_no, "string");
    assert.equal(uiEv106Row.seq_no, "9007199254740993");
    assert.equal(uiEv106Row.exceeds_ieee754_safe_int, true);

    // Tırnaksız > 2^53 - 1 JSON sayısı gönderildiğinde deterministik sınır hatasıyla reddedilmeli
    client.sendText('{"cmd":"EVALUATE_SLICE","cutoff_learned_at_ms":9007199254740993}');
    const boundaryErr = await client.waitFor((m) => m.msg_type === "PROTOCOL_BOUNDARY_ERROR");
    assert.equal(boundaryErr.error.errorCode, "MCP_64BIT_DECIMAL_STRING_REQUIRED");

    // 3) Kanıt-bağlı Komuta Asistanı sorgusu (`ASSISTANT_QUERY` -> `ASSISTANT_EVIDENCE_REPLY`)
    client.sendText(
      JSON.stringify({
        cmd: "ASSISTANT_QUERY",
        cutoff_learned_at_ms: warRoomCockpit.T2_CUTOFF_MS,
        query: "BERTH_02 rıhtım karşı-olgu stres testi ve çelişen kaynaklar nedir?",
      })
    );
    const assistantReply = await client.waitFor((m) => m.msg_type === "ASSISTANT_EVIDENCE_REPLY");
    assert.ok(assistantReply.mcp_tools_invoked.includes("caelus_run_counterfactual_branch"));
    assert.equal(assistantReply.state_blake3, initialSync.slice.state_blake3);

    // 4) Kapı 6: Operatör Ed25519 İmzası -> `SIGN_ACTION_CARD` -> `audit_log.rs` -> `caelus_verify_audit`
    const signedLocal = uiCockpit.signAndSealActionCardLocal("coa-20261111-01");
    assert.equal(signedLocal.ok, true);
    assert.equal(signedLocal.operator_pubkey.length, 64);
    assert.equal(signedLocal.operator_sig.length, 128);

    client.sendText(
      JSON.stringify({
        cmd: "SIGN_ACTION_CARD",
        card_id: signedLocal.card_id,
        scenario_id: signedLocal.scenario_id,
        verdict_context: signedLocal.verdict_context,
        state_blake3: signedLocal.state_blake3,
        branch_state_blake3: signedLocal.branch_state_blake3,
        approved_at_ms: signedLocal.approved_at_ms,
        operator_pubkey: signedLocal.operator_pubkey,
        operator_sig: signedLocal.operator_sig,
      })
    );

    const sealedAck = await client.waitFor((m) => m.msg_type === "OPERATOR_CARD_SEALED");
    assert.equal(sealedAck.card_id, "coa-20261111-01");
    assert.equal(sealedAck.operator_pubkey, signedLocal.operator_pubkey);
    assert.equal(sealedAck.audit_chain_verified, true);

    const auditContent = fs.readFileSync(auditLogPath, "utf8");
    assert.ok(
      auditContent.includes("OPERATOR_ACTION_CARD_APPROVED"),
      "Denetim günlüğünde OPERATOR_ACTION_CARD_APPROVED kaydı bulunmalı"
    );
    assert.ok(auditContent.includes(signedLocal.operator_sig));

    const verifyBin = findVerifyAuditBinary();
    if (process.env.CAELUS_WASM_ONLY === "1") {
      const expectedPayload = sidecarAirlock.buildOperatorActionCardSigningPayload({
        card_id: signedLocal.card_id,
        scenario_id: signedLocal.scenario_id,
        verdict_context: signedLocal.verdict_context,
        state_blake3: signedLocal.state_blake3,
        branch_state_blake3: signedLocal.branch_state_blake3,
        approved_at_ms: signedLocal.approved_at_ms,
      });
      assert.equal(
        sidecarAirlock.ed25519VerifyMessageHex(
          expectedPayload,
          signedLocal.operator_pubkey,
          signedLocal.operator_sig
        ),
        true
      );
    } else {
      assert.ok(verifyBin, "caelus_verify_audit ikilisi derlenmiş olmalı");
      const verifyOut = execFileSync(verifyBin, [auditLogPath], {
        encoding: "utf8",
        windowsHide: true,
      });
      assert.ok(verifyOut.length >= 0);
    }
  } finally {
    if (client) client.close();
    if (srv) await srv.close();
    fs.rmSync(tmpAuditDir, { recursive: true, force: true });
  }
});

test("Kapı 7: Tüm Giriş Noktaları (ws_emitter.h, ui_payload.h, dist/index.html, dist/sw.js) War Room Kokpit Bütünlüğü", () => {
  const wsEmitterH = fs.readFileSync(path.join(ROOT, "include", "ws_emitter.h"), "utf8");
  for (const allowedAsset of [
    "/tokens.css",
    "/war_room_i18n.js",
    "/sidecar_airlock_mcp.js",
    "/war_room_ag_ui_engine.js",
    "/war_room_cockpit.js",
  ]) {
    assert.ok(
      wsEmitterH.includes(`"${allowedAsset}"`),
      `include/ws_emitter.h statik HTTP izin listesinde ${allowedAsset} bulunmalı`
    );
  }

  const cockpitSrc = fs.readFileSync(path.join(ROOT, "ui", "war_room_cockpit.js"), "utf8");
  assert.ok(cockpitSrc.includes("state_blake3:"));
  assert.ok(cockpitSrc.includes("audit_head:"));
  assert.ok(cockpitSrc.includes('data-replay-speed="1"'));
  assert.ok(cockpitSrc.includes('data-replay-speed="10"'));
  assert.ok(cockpitSrc.includes('data-focus-evidence='));
  assert.ok(cockpitSrc.includes("Δ Emniyet/Risk:"));
  assert.ok(cockpitSrc.includes('data-map-engine="MAPLIBRE_DECK"'));
  assert.ok(cockpitSrc.includes('data-map-engine="CESIUM_3D"'));

  const distIndexPath = path.join(ROOT, "dist", "index.html");
  if (fs.existsSync(distIndexPath)) {
    const distHtml = fs.readFileSync(distIndexPath, "utf8");
    assert.ok(distHtml.includes('id="caelus-war-room-cockpit-shell"'));
    assert.ok(distHtml.includes("mountWarRoomCockpitDom"));
    assert.ok(distHtml.includes("CAELUS_AIRLOCK_PILOT_BUNDLE"));
  }
  const distSwPath = path.join(ROOT, "dist", "sw.js");
  if (fs.existsSync(distSwPath)) {
    const swJs = fs.readFileSync(distSwPath, "utf8");
    assert.ok(!swJs.includes('"caelus-local"'), "dist/sw.js sabit caelus-local önbellek adı kullanmamalı");
  }
});

test("Kapı 8: Canlı HTTP Sunucuları (AG-UI + C++ caelus_os ikilisi + %TEMP%/caelus_ui.html) Uçtan Uca War Room Doğrulaması", async () => {
  // 8A) AG-UI HTTP + WS sunucusu canlı HTTP varlık servisi & legacy REPL probe toleransı
  const agSrv = await startWarRoomAgUiServer({
    port: 0,
    mode: "offline",
    forcePureJsFallback: process.env.CAELUS_WASM_ONLY === "1",
  });
  let agWs = null;
  try {
    for (const relUrl of [
      "/",
      "/tokens.css",
      "/war_room_i18n.js",
      "/sidecar_airlock_mcp.js",
      "/war_room_ag_ui_engine.js",
      "/war_room_cockpit.js",
      "/api/health",
    ]) {
      const r = await fetch(`${agSrv.httpUrl}${relUrl}`);
      assert.equal(r.status, 200, `AG-UI sunucusu ${relUrl} için 200 OK dönmeli`);
      const body = await r.text();
      assert.ok(body.length > 20);
    }

    agWs = await connectWsTestClient(agSrv.port);
    await agWs.waitFor((m) => m.msg_type === "SLICE_STATE_SYNC");
    agWs.sendText("load_world");
    agWs.sendText("status");
    agWs.sendText(JSON.stringify({ cmd: "EVALUATE_SLICE", cutoff_learned_at_ms: warRoomCockpit.T2_CUTOFF_MS }));
    await agWs.waitFor(
      (m, all) =>
        all.filter((x) => x.msg_type === "SLICE_STATE_SYNC").length >= 2
    );
    const boundaryErrs = agWs.messages.filter((m) => m.msg_type === "PROTOCOL_BOUNDARY_ERROR");
    assert.equal(boundaryErrs.length, 0, "Eski REPL düz metin yoklamaları PROTOCOL_BOUNDARY_ERROR üretmemeli");
  } finally {
    if (agWs) agWs.close();
    await agSrv.close();
  }

  // 8B) Derlenmiş C++ tek-ikili (dist/caelus_os[.exe]) canlı HTTP rotaları + %TEMP%/caelus_ui.html gömülü kokpit testi
  const exeName = process.platform === "win32" ? "caelus_os.exe" : "caelus_os";
  const exePath = path.join(ROOT, "dist", exeName);
  if (process.env.CAELUS_WASM_ONLY === "1" || !fs.existsSync(exePath)) return;

  const freePort = await new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
    s.on("error", reject);
  });

  const tmpUiDir = fs.mkdtempSync(path.join(os.tmpdir(), "caelus-cpp-ui-e2e-"));
  const childEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k.toUpperCase() === "TEMP" || k.toUpperCase() === "TMP") continue;
    childEnv[k] = v;
  }
  childEnv.CAELUS_WS_PORT = String(freePort);
  childEnv.CAELUS_STATIC_ROOT = path.join(ROOT, "ui");
  childEnv.TEMP = tmpUiDir;
  childEnv.TMP = tmpUiDir;

  const scenarioPath = path.join(ROOT, "scenarios", "BS-01_SAHTE_UFUK.json");
  const child = spawn(exePath, ["--scenario", scenarioPath, "--repl"], {
    cwd: tmpUiDir,
    env: childEnv,
    stdio: ["pipe", "ignore", "ignore"],
    windowsHide: true,
  });

  try {
    let rootHtml = "";
    for (let attempt = 0; attempt < 60; attempt++) {
      try {
        const r = await fetch(`http://127.0.0.1:${freePort}/`);
        if (r.status === 200) {
          rootHtml = await r.text();
          break;
        }
      } catch (_) {}
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.ok(rootHtml.includes('id="caelus-war-room-cockpit-shell"'), "C++ / rotası War Room kokpit kabuğunu içermeli");
    assert.ok(rootHtml.includes("mountWarRoomCockpitDom"), "C++ / rotası gömülü war_room_cockpit.js içermeli");
    assert.ok(rootHtml.includes("CAELUS_AIRLOCK_PILOT_BUNDLE"), "C++ / rotası gömülü pilot verisini içermeli");

    for (const assetPath of [
      "/tokens.css",
      "/sidecar_airlock_mcp.js",
      "/war_room_ag_ui_engine.js",
      "/war_room_cockpit.js",
    ]) {
      const res = await fetch(`http://127.0.0.1:${freePort}${assetPath}`);
      assert.equal(res.status, 200, `C++ ws_emitter.h ${assetPath} için 200 OK dönmeli (404 olmamalı)`);
    }

    const extractedHtmlPath = path.join(tmpUiDir, "caelus_ui.html");
    if (fs.existsSync(extractedHtmlPath)) {
      const extractedHtml = fs.readFileSync(extractedHtmlPath, "utf8");
      assert.ok(extractedHtml.includes("mountWarRoomCockpitDom"), "%TEMP%/caelus_ui.html gömülü kokpiti içermeli");
    }
  } finally {
    try {
      child.stdin.write("quit\n");
      child.stdin.end();
    } catch (_) {}
    await new Promise((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      const killTimer = setTimeout(() => {
        try {
          child.kill();
        } catch (_) {}
        setTimeout(done, 400);
      }, 2500);
      child.once("close", () => {
        clearTimeout(killTimer);
        done();
      });
    });
    try {
      fs.rmSync(tmpUiDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch (_) {}
  }
});


