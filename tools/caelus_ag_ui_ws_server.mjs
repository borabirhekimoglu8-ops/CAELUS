#!/usr/bin/env node
/**
 * CAELUS OS — `CAELUS_AG_UI_V1` Loopback WebSocket & Air-Gapped War Room Server
 *
 * Katman 2 & Katman 4 (Master Spesifikasyon §3.2, §4.2, §5):
 * - Varsayılan adres: `127.0.0.1:47809` (`ws://127.0.0.1:47809` + `http://127.0.0.1:47809`).
 * - Sıfır harici npm bağımlılığı: yerleşik `node:http` + RFC 6455 WebSocket + geri-basınç
 *   (`socket.bufferedAmount` su seviyesi kuyruğu).
 * - Tüm gelen/giden JSON çerçevelerinde 64-bit ondalık ASCII `string` sınır denetimi.
 * - `--offline` (varsayılan): `scenarios/pilot_aegean_ferry_airlock/events.airlock.ndjson`
 * - `--live`: `Open-Meteo Marine API` + `OpenSky` (+ `AISSTREAM_API_KEY` varsa `AISStream.io`)
 *   verilerini `caelus_sidecar_airlock ingest-adapter` üzerinden sabit noktaya çevirip imzalar.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");

const sidecarAirlock = require(path.join(REPO_ROOT, "ui", "sidecar_airlock_mcp.js"));
const agUiEngine = require(path.join(REPO_ROOT, "ui", "war_room_ag_ui_engine.js"));

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const BACKPRESSURE_HIGH_WATERMARK = 512 * 1024;

const MIME_BY_EXT = Object.freeze({
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".wasm": "application/wasm",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".ndjson": "application/x-ndjson; charset=utf-8",
});

function deterministicSeedHex(domainLabel) {
  return sidecarAirlock.blake3Hex(domainLabel);
}

function encodeWsTextFrame(utf8Str) {
  const payload = Buffer.from(utf8Str, "utf8");
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x81; // FIN + text
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, payload]);
}

function encodeWsControlFrame(opcode, payloadBuf = Buffer.alloc(0)) {
  const len = Math.min(payloadBuf.length, 125);
  const header = Buffer.from([0x80 | (opcode & 0x0f), len]);
  return Buffer.concat([header, payloadBuf.subarray(0, len)]);
}

function tryConsumeWsFrame(buffer) {
  if (buffer.length < 2) return null;
  const firstByte = buffer[0];
  const secondByte = buffer[1];
  const opcode = firstByte & 0x0f;
  const masked = (secondByte & 0x80) !== 0;
  let payloadLen = secondByte & 0x7f;
  let offset = 2;

  if (payloadLen === 126) {
    if (buffer.length < 4) return null;
    payloadLen = buffer.readUInt16BE(2);
    offset = 4;
  } else if (payloadLen === 127) {
    if (buffer.length < 10) return null;
    const bigLen = buffer.readBigUInt64BE(2);
    if (bigLen > 16n * 1024n * 1024n) {
      throw new Error("WS frame exceeds 16 MiB safety cap");
    }
    payloadLen = Number(bigLen);
    offset = 10;
  }

  const maskLen = masked ? 4 : 0;
  if (buffer.length < offset + maskLen + payloadLen) return null;

  let maskKey = null;
  if (masked) {
    maskKey = buffer.subarray(offset, offset + 4);
    offset += 4;
  }
  const data = Buffer.from(buffer.subarray(offset, offset + payloadLen));
  if (masked && maskKey) {
    for (let i = 0; i < data.length; i++) {
      data[i] ^= maskKey[i & 3];
    }
  }
  return {
    opcode,
    payload: data,
    remaining: buffer.subarray(offset + payloadLen),
  };
}

function fetchHttpsText(urlStr, timeoutMs = 6000) {
  return new Promise((resolve, reject) => {
    const req = https.get(urlStr, { timeout: timeoutMs }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    });
    req.on("timeout", () => {
      req.destroy(new Error("HTTPS request timeout"));
    });
    req.on("error", reject);
  });
}

export async function startWarRoomAgUiServer(options = {}) {
  const host = options.host || "127.0.0.1";
  const port =
    options.port !== undefined
      ? Number(options.port)
      : Number(process.env.CAELUS_WAR_ROOM_PORT || 47809);
  const liveModeRequested = Boolean(options.liveMode);
  const repoRoot = options.repoRootDir || REPO_ROOT;
  const uiDir = path.join(repoRoot, "ui");

  const defaultManifestPath =
    options.manifestPath || path.join(repoRoot, "configs", "source_manifest.json");
  const defaultBatchPath =
    options.batchPath ||
    path.join(repoRoot, "scenarios", "pilot_aegean_ferry_airlock", "events.airlock.ndjson");
  const defaultMetaPath = path.join(
    repoRoot,
    "scenarios",
    "pilot_aegean_ferry_airlock",
    "pilot_scenario_meta.json"
  );

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "caelus-war-room-ws-"));
  const activeBatchPath = path.join(workDir, "session_events.airlock.ndjson");
  const activeAuditLogPath =
    options.auditLogPath || path.join(workDir, "war_room_session_audit.ndjson");

  fs.copyFileSync(defaultBatchPath, activeBatchPath);

  const orchestrator = agUiEngine.createWarRoomAgUiOrchestrator({
    repoRootDir: repoRoot,
    sidecarBinaryPath: options.sidecarBinaryPath || null,
    forcePureJsFallback: Boolean(options.forcePureJsFallback),
  });

  let activeMode = liveModeRequested ? "LIVE_AIRLOCK" : "OFFLINE_REPLAY";
  let currentCutoffMs = String(options.initialCutoffMs || "1762849500000");
  let liveSeqWx = 100;
  let liveSeqOsky = 100;
  let livePollTimer = null;

  // İlk kesit değerlendirmesini audit_log.rs zincirine mühürle
  const auditSeedHex = deterministicSeedHex("CAELUS_WAR_ROOM_AUDIT_ANCHOR_2026_Q4");
  orchestrator.airlockMcp.invokeAirlockTool({
    toolName: "caelus_evaluate_slice",
    arguments: {
      batch_path: activeBatchPath,
      manifest_path: defaultManifestPath,
      cutoff_learned_at_ms: currentCutoffMs,
      scenario_id: "AEGEAN_FERRY_01",
      policy_id: "MARITIME_SAFETY_V2",
      audit_log_path: activeAuditLogPath,
      audit_seed: auditSeedHex,
      det_clock: true,
    },
  });

  const clients = new Set();

  function enqueueEnvelope(client, envelopeObj) {
    if (client.closed) return;
    const serialized = JSON.stringify(envelopeObj);
    // Çıkış sınırında da 64-bit tırnaksız sayı ihlali olmadığından emin ol
    const viol = sidecarAirlock.detectUnquoted64BitViolationInRawJson(serialized);
    if (viol) {
      return;
    }
    const frame = encodeWsTextFrame(serialized);
    if (
      client.queue.length > 0 ||
      client.socket.bufferedAmount >= BACKPRESSURE_HIGH_WATERMARK
    ) {
      // Geri-basınç: kuyruk doluysa eski SLICE_STATE_SYNC paketini en yenisiyle birleştir
      if (envelopeObj.msg_type === "SLICE_STATE_SYNC") {
        client.queue = client.queue.filter((item) => item.msgType !== "SLICE_STATE_SYNC");
      }
      if (client.queue.length < 128) {
        client.queue.push({ msgType: envelopeObj.msg_type, frame });
      }
      return;
    }
    client.socket.write(frame);
  }

  function flushClientQueue(client) {
    while (
      !client.closed &&
      client.queue.length > 0 &&
      client.socket.bufferedAmount < BACKPRESSURE_HIGH_WATERMARK
    ) {
      const next = client.queue.shift();
      client.socket.write(next.frame);
    }
  }

  function broadcastEnvelopes(envelopes) {
    for (const c of clients) {
      for (const env of envelopes) {
        enqueueEnvelope(c, env);
      }
    }
  }

  function buildFullSliceEnvelopes(cutoffMsStr) {
    const res = orchestrator.orchestrateSliceStream({
      batch_path: activeBatchPath,
      manifest_path: defaultManifestPath,
      cutoff_learned_at_ms: String(cutoffMsStr),
      scenario_id: "AEGEAN_FERRY_01",
      policy_id: "MARITIME_SAFETY_V2",
      audit_log_path: activeAuditLogPath,
      audit_seed: auditSeedHex,
      det_clock: true,
    });
    if (!res.ok) {
      return [
        {
          protocol: "CAELUS_AG_UI_V1",
          msg_type: "AIRLOCK_ERROR",
          error: res.error,
        },
      ];
    }
    return res.envelopes.map((env) =>
      env.msg_type === "SLICE_STATE_SYNC"
        ? { ...env, airlock_mode: activeMode, audit_log_path: activeAuditLogPath }
        : env
    );
  }

  async function pollLiveAdaptersOnce() {
    const bin = orchestrator.airlockMcp.findNativeSidecarBinary();
    if (!bin) return;
    const nowMs = String(Date.now());
    let appendedAny = false;

    try {
      const wxJson = await fetchHttpsText(
        "https://marine-api.open-meteo.com/v1/marine?latitude=38.1954&longitude=26.8371&current=wave_height,wave_period,ocean_current_velocity"
      );
      const wxIn = path.join(workDir, "live_wx_in.json");
      const wxOut = path.join(workDir, "live_wx_out.ndjson");
      fs.writeFileSync(wxIn, wxJson, "utf8");
      const wxSeed = deterministicSeedHex("CAELUS_SOURCE_OPEN_METEO_MARINE_ENSEMBLE_2026_Q4");
      execFileSync(
        bin,
        [
          "ingest-adapter",
          "--adapter",
          "open_meteo",
          "--input",
          wxIn,
          "--output",
          wxOut,
          "--source-id",
          "open_meteo_marine_ensemble",
          "--key-id",
          "wx-key-2026-q4",
          "--seed",
          wxSeed,
          "--learned-at-ms",
          nowMs,
          "--start-seq",
          String(liveSeqWx++),
        ],
        { windowsHide: true, timeout: 8000 }
      );
      const signedLines = fs.readFileSync(wxOut, "utf8");
      if (signedLines.trim().length > 0) {
        fs.appendFileSync(activeBatchPath, signedLines, "utf8");
        appendedAny = true;
      }
    } catch (_) {
      // Ağ erişimi yoksa fail-closed: bozuk veri eklenmez, çevrimdışı kesit korunur
    }

    try {
      const oskyJson = await fetchHttpsText(
        "https://opensky-network.org/api/states/all?lamin=37.6&lomin=26.4&lamax=38.4&lomax=27.2"
      );
      const oskyIn = path.join(workDir, "live_osky_in.json");
      const oskyOut = path.join(workDir, "live_osky_out.ndjson");
      fs.writeFileSync(oskyIn, oskyJson, "utf8");
      const oskySeed = deterministicSeedHex("CAELUS_SOURCE_OPENSKY_AEGEAN_ADSB_2026_Q4");
      execFileSync(
        bin,
        [
          "ingest-adapter",
          "--adapter",
          "opensky",
          "--input",
          oskyIn,
          "--output",
          oskyOut,
          "--source-id",
          "opensky_aegean_adsb",
          "--key-id",
          "osky-key-2026-q4",
          "--seed",
          oskySeed,
          "--learned-at-ms",
          nowMs,
          "--start-seq",
          String(liveSeqOsky++),
        ],
        { windowsHide: true, timeout: 8000 }
      );
      const signedLines = fs.readFileSync(oskyOut, "utf8");
      if (signedLines.trim().length > 0) {
        fs.appendFileSync(activeBatchPath, signedLines, "utf8");
        appendedAny = true;
      }
    } catch (_) {
      // OpenSky hız sınırı veya çevrimdışı durum: mevcut kesit korunur
    }

    if (appendedAny) {
      currentCutoffMs = nowMs;
      broadcastEnvelopes(buildFullSliceEnvelopes(currentCutoffMs));
    }
  }

  function handleClientCommand(client, rawText) {
    const trimmedRaw = String(rawText || "").trim();
    if (
      trimmedRaw === "load_world" ||
      trimmedRaw === "status" ||
      trimmedRaw === "list levers" ||
      trimmedRaw.startsWith("scenario ") ||
      trimmedRaw.startsWith("load_json ")
    ) {
      return;
    }
    const rawViol = sidecarAirlock.detectUnquoted64BitViolationInRawJson(rawText);
    if (rawViol) {
      enqueueEnvelope(client, {
        protocol: "CAELUS_AG_UI_V1",
        msg_type: "PROTOCOL_BOUNDARY_ERROR",
        error: rawViol,
      });
      return;
    }
    let msg;
    try {
      msg = JSON.parse(rawText);
    } catch (err) {
      enqueueEnvelope(client, {
        protocol: "CAELUS_AG_UI_V1",
        msg_type: "PROTOCOL_BOUNDARY_ERROR",
        error: { errorCode: "INVALID_JSON", messageTr: String(err.message || err) },
      });
      return;
    }

    const boundary = sidecarAirlock.validate64BitMcpArguments(msg);
    if (!boundary.ok) {
      enqueueEnvelope(client, {
        protocol: "CAELUS_AG_UI_V1",
        msg_type: "PROTOCOL_BOUNDARY_ERROR",
        error: boundary,
      });
      return;
    }

    const cmd = String(msg.cmd || msg.type || "");
    if (cmd === "EVALUATE_SLICE") {
      const targetCutoff = String(msg.cutoff_learned_at_ms || currentCutoffMs);
      currentCutoffMs = targetCutoff;
      const envs = buildFullSliceEnvelopes(targetCutoff);
      for (const env of envs) enqueueEnvelope(client, env);
      return;
    }

    if (cmd === "RUN_COUNTERFACTUAL") {
      const cfRes = orchestrator.airlockMcp.invokeAirlockTool({
        toolName: "caelus_run_counterfactual_branch",
        arguments: {
          batch_path: activeBatchPath,
          manifest_path: defaultManifestPath,
          base_cutoff_ms: String(msg.base_cutoff_ms || currentCutoffMs),
          branch_id: String(msg.branch_id || "cf_interactive"),
          interventions: Array.isArray(msg.interventions) ? msg.interventions : [],
          scenario_id: "AEGEAN_FERRY_01",
          policy_id: "MARITIME_SAFETY_V2",
          advisor_template: "STRATEGIST",
        },
      });
      enqueueEnvelope(client, {
        protocol: "CAELUS_AG_UI_V1",
        msg_type: "COUNTERFACTUAL_BRANCH_RESULT",
        result: cfRes,
      });
      return;
    }

    if (cmd === "SIGN_ACTION_CARD") {
      const sealRes = orchestrator.sealOperatorActionCard({
        audit_log_path: activeAuditLogPath,
        card_id: String(msg.card_id || ""),
        scenario_id: String(msg.scenario_id || "AEGEAN_FERRY_01"),
        verdict_context: String(msg.verdict_context || "KURAL_İHLALİ"),
        state_blake3: String(msg.state_blake3 || ""),
        branch_state_blake3: String(msg.branch_state_blake3 || ""),
        approved_at_ms: String(msg.approved_at_ms || currentCutoffMs),
        operator_pubkey: msg.operator_pubkey ? String(msg.operator_pubkey) : undefined,
        operator_sig: msg.operator_sig ? String(msg.operator_sig) : undefined,
        operator_seed: msg.operator_seed ? String(msg.operator_seed) : undefined,
        audit_seed: auditSeedHex,
      });
      if (!sealRes.ok) {
        enqueueEnvelope(client, {
          protocol: "CAELUS_AG_UI_V1",
          msg_type: "ACTION_CARD_SEAL_REJECTED",
          card_id: String(msg.card_id || ""),
          error: sealRes,
        });
        return;
      }
      broadcastEnvelopes([
        {
          protocol: "CAELUS_AG_UI_V1",
          msg_type: "OPERATOR_CARD_SEALED",
          card_id: sealRes.card_id,
          operator_pubkey: sealRes.operator_pubkey,
          operator_sig: sealRes.operator_sig,
          audit_chain_head: sealRes.audit_chain_head,
          audit_seal_pubkey: sealRes.audit_seal_pubkey,
          audit_chain_verified: Boolean(sealRes.audit_chain_verified),
          audit_log_path: activeAuditLogPath,
        },
      ]);
      return;
    }

    if (cmd === "ASSISTANT_QUERY") {
      const ans = orchestrator.answerEvidenceBoundQuery({
        batch_path: activeBatchPath,
        manifest_path: defaultManifestPath,
        cutoff_learned_at_ms: String(msg.cutoff_learned_at_ms || currentCutoffMs),
        scenario_id: "AEGEAN_FERRY_01",
        policy_id: "MARITIME_SAFETY_V2",
        audit_log_path: activeAuditLogPath,
        audit_seed: auditSeedHex,
        det_clock: true,
        query: String(msg.query || ""),
      });
      if (ans.ok) {
        enqueueEnvelope(client, ans.envelope);
      } else {
        enqueueEnvelope(client, {
          protocol: "CAELUS_AG_UI_V1",
          msg_type: "AIRLOCK_ERROR",
          error: ans.error,
        });
      }
      return;
    }

    enqueueEnvelope(client, {
      protocol: "CAELUS_AG_UI_V1",
      msg_type: "PROTOCOL_BOUNDARY_ERROR",
      error: { errorCode: "UNKNOWN_WS_COMMAND", messageTr: `Bilinmeyen komut: ${cmd}` },
    });
  }

  const server = http.createServer((req, res) => {
    const reqUrl = new URL(req.url || "/", `http://${host}:${port}`);
    const pathname = decodeURIComponent(reqUrl.pathname);

    if (pathname === "/api/health") {
      const body = JSON.stringify({
        ok: true,
        protocol: "CAELUS_AG_UI_V1",
        bind: host,
        port: server.address()?.port || port,
        mode: activeMode,
        clients: clients.size,
      });
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      res.end(body);
      return;
    }

    if (pathname === "/api/pilot-bundle") {
      const manifestJson = fs.readFileSync(defaultManifestPath, "utf8");
      const batchNdjson = fs.readFileSync(activeBatchPath, "utf8");
      const metaObj = fs.existsSync(defaultMetaPath)
        ? JSON.parse(fs.readFileSync(defaultMetaPath, "utf8"))
        : null;
      const body = JSON.stringify({
        ok: true,
        mode: activeMode,
        manifest_json: manifestJson,
        batch_ndjson: batchNdjson,
        meta: metaObj,
      });
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      res.end(body);
      return;
    }

    const relPath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
    if (relPath.includes("\0") || relPath.includes("..")) {
      res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Forbidden");
      return;
    }
    const candidate = path.resolve(uiDir, relPath);
    if (!candidate.startsWith(path.resolve(uiDir))) {
      res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Forbidden");
      return;
    }
    if (!fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not Found");
      return;
    }
    const ext = path.extname(candidate).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME_BY_EXT[ext] || "application/octet-stream",
      "Cache-Control": "no-cache",
      "X-Content-Type-Options": "nosniff",
    });
    res.end(fs.readFileSync(candidate));
  });

  server.on("upgrade", (req, socket) => {
    const upgradeHeader = String(req.headers.upgrade || "").toLowerCase();
    const wsKey = req.headers["sec-websocket-key"];
    if (upgradeHeader !== "websocket" || typeof wsKey !== "string" || wsKey.length === 0) {
      socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
      socket.destroy();
      return;
    }

    const acceptKey = crypto
      .createHash("sha1")
      .update(wsKey + WS_GUID)
      .digest("base64");

    socket.write(
      [
        "HTTP/1.1 101 Switching Protocols",
        "Upgrade: websocket",
        "Connection: Upgrade",
        `Sec-WebSocket-Accept: ${acceptKey}`,
        "\r\n",
      ].join("\r\n")
    );
    socket.setNoDelay(true);

    const client = {
      socket,
      queue: [],
      recvBuf: Buffer.alloc(0),
      closed: false,
    };
    clients.add(client);

    socket.on("drain", () => flushClientQueue(client));

    socket.on("data", (chunk) => {
      if (client.closed) return;
      client.recvBuf = Buffer.concat([client.recvBuf, chunk]);
      try {
        while (true) {
          const parsed = tryConsumeWsFrame(client.recvBuf);
          if (!parsed) break;
          client.recvBuf = parsed.remaining;
          if (parsed.opcode === 0x8) {
            client.closed = true;
            socket.end(encodeWsControlFrame(0x8));
            clients.delete(client);
            break;
          } else if (parsed.opcode === 0x9) {
            socket.write(encodeWsControlFrame(0x0a, parsed.payload));
          } else if (parsed.opcode === 0x1) {
            handleClientCommand(client, parsed.payload.toString("utf8"));
          }
        }
      } catch (_) {
        client.closed = true;
        clients.delete(client);
        socket.destroy();
      }
    });

    const cleanupClient = () => {
      client.closed = true;
      clients.delete(client);
    };
    socket.on("close", cleanupClient);
    socket.on("error", cleanupClient);

    // Bağlantı kurulur kurulmaz aktif kesitin 4 uzman ajan zarflarını yayınla
    const initialEnvelopes = buildFullSliceEnvelopes(currentCutoffMs);
    for (const env of initialEnvelopes) {
      enqueueEnvelope(client, env);
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.removeListener("error", reject);
      resolve();
    });
  });

  if (liveModeRequested) {
    pollLiveAdaptersOnce();
    livePollTimer = setInterval(() => {
      pollLiveAdaptersOnce();
    }, Number(options.livePollIntervalMs || 30000));
    if (livePollTimer.unref) livePollTimer.unref();
  }

  const boundPort = server.address().port;
  return {
    host,
    port: boundPort,
    wsUrl: `ws://${host}:${boundPort}`,
    httpUrl: `http://${host}:${boundPort}`,
    auditLogPath: activeAuditLogPath,
    batchPath: activeBatchPath,
    close: () =>
      new Promise((resolve) => {
        if (livePollTimer) clearInterval(livePollTimer);
        for (const c of clients) {
          c.closed = true;
          try {
            c.socket.destroy();
          } catch (_) {
            // ignore
          }
        }
        clients.clear();
        server.close(() => {
          if (!options.auditLogPath) {
            try {
              fs.rmSync(workDir, { recursive: true, force: true });
            } catch (_) {
              // ignore
            }
          }
          resolve();
        });
      }),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  const argv = process.argv.slice(2);
  const liveMode = argv.includes("--live");
  let portArg = undefined;
  const pIdx = argv.indexOf("--port");
  if (pIdx >= 0 && argv[pIdx + 1]) {
    portArg = Number(argv[pIdx + 1]);
  }
  let cutoffArg = "1762849500000";
  const cIdx = argv.indexOf("--cutoff-ms");
  if (cIdx >= 0 && argv[cIdx + 1]) {
    cutoffArg = String(argv[cIdx + 1]);
  }

  startWarRoomAgUiServer({
    port: portArg,
    liveMode,
    initialCutoffMs: cutoffArg,
  })
    .then((srv) => {
      process.stdout.write(
        JSON.stringify({
          ok: true,
          service: "CAELUS_WAR_ROOM_AG_UI_SERVER",
          protocol: "CAELUS_AG_UI_V1",
          mode: liveMode ? "LIVE_AIRLOCK" : "OFFLINE_REPLAY",
          httpUrl: srv.httpUrl,
          wsUrl: srv.wsUrl,
          auditLogPath: srv.auditLogPath,
        }) + "\n"
      );
      const shutdown = () => {
        srv.close().then(() => process.exit(0));
      };
      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);
    })
    .catch((err) => {
      process.stderr.write(`WAR ROOM SERVER ERROR: ${String(err && err.message ? err.message : err)}\n`);
      process.exit(1);
    });
}
