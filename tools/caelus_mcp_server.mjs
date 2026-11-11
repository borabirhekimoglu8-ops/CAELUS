#!/usr/bin/env node
/**
 * CAELUS Özel MCP Sunucusu (Standalone JSON-RPC 2.0 & Programatik Köprü)
 *
 * Parça 3 (Bölüm 3.3) + PR-1 Sidecar Airlock (§4 & §7.3):
 * CAELUS'un kendi dünya hafızasını, hipotezlerini, bilgi açıklarını,
 * duyarlılık analizlerini ve çift zamanlı Sidecar Airlock kesit değerlendiricisini
 * dış ajanlara kontrollü, 64-bit dizge korumalı ve en az yetki (least-privilege)
 * ilkesiyle açan MCP sunucusu.
 */

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const discoveryEngine = require(path.join(__dirname, "..", "ui", "discovery_value_engine.js"));
const firstTaskEngine = require(path.join(__dirname, "..", "ui", "first_real_task_engine.js"));
const livingWorldEngine = require(path.join(__dirname, "..", "ui", "living_world_model.js"));
const sidecarAirlockEngine = require(path.join(__dirname, "..", "ui", "sidecar_airlock_mcp.js"));

export function createStandaloneCaelusMcpJsonRpcHandler(options = {}) {
  const mcpServer = discoveryEngine.createCaelusMcpServer(options);
  const firstTaskMcp = firstTaskEngine.createFirstRealTaskMcpController({
    allowExport: options.allowExport !== false,
    defaultCaseId: options.defaultCaseId || "VAKA_A",
  });
  const livingWorldMcp = livingWorldEngine.createLivingWorldMcpController({
    allowSchedulerControl: Boolean(options.allowSchedulerControl),
    allowExport: options.allowExport !== false,
    records: options.livingWorldRecords || [],
  });
  const airlockMcp = sidecarAirlockEngine.createSidecarAirlockMcpController({
    repoRootDir: options.repoRootDir || path.resolve(__dirname, ".."),
    sidecarBinaryPath: options.sidecarBinaryPath || null,
    forcePureJsFallback: Boolean(options.forcePureJsFallback),
  });

  const firstTaskToolNames = new Set(firstTaskMcp.toolsCatalog.map((t) => t.name));
  const livingWorldToolNames = new Set(livingWorldMcp.toolsCatalog.map((t) => t.name));
  const airlockToolNames = new Set(airlockMcp.toolsCatalog.map((t) => t.name));

  const combinedToolsCatalog = [
    ...mcpServer.toolsCatalog,
    ...firstTaskMcp.toolsCatalog,
    ...livingWorldMcp.toolsCatalog,
    ...airlockMcp.toolsCatalog,
  ];

  function handleJsonRpcRequest(rpcRequest) {
    const id = rpcRequest && rpcRequest.id !== undefined ? rpcRequest.id : null;
    const method = rpcRequest && rpcRequest.method ? String(rpcRequest.method) : "";
    const params = (rpcRequest && rpcRequest.params) || {};

    if (method === "initialize") {
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "2024-11-05",
          serverInfo: {
            name: mcpServer.serverId,
            version: mcpServer.version,
          },
          capabilities: {
            tools: { listChanged: false },
          },
        },
      };
    }

    if (method === "tools/list") {
      const includeAll =
        Boolean(options.includeFirstRealTaskTools) ||
        Boolean(options.includeLivingWorldTools) ||
        Boolean(options.includeAirlockTools) ||
        params.scope === "all" ||
        params.includeFirstRealTaskTools === true ||
        params.includeLivingWorldTools === true ||
        params.includeAirlockTools === true;
      return {
        jsonrpc: "2.0",
        id,
        result: {
          tools: includeAll ? combinedToolsCatalog : mcpServer.toolsCatalog,
          firstRealTaskTools: firstTaskMcp.toolsCatalog,
          livingWorldTools: livingWorldMcp.toolsCatalog,
          airlockTools: airlockMcp.toolsCatalog,
          advisorTaskTemplates: airlockMcp.advisorTaskTemplates,
          mcpInteropBindings: airlockMcp.mcpInteropBindings,
          combinedToolsCatalog,
          discoveryToolsCount: mcpServer.toolsCatalog.length,
          firstRealTaskToolsCount: firstTaskMcp.toolsCatalog.length,
          livingWorldToolsCount: livingWorldMcp.toolsCatalog.length,
          airlockToolsCount: airlockMcp.toolsCatalog.length,
        },
      };
    }

    if (method === "tools/call") {
      const toolName = params.name || "";
      const args = params.arguments || {};
      const callerRole = params.callerRole || mcpServer.defaultRole;

      // PR-1 §3.2 & §4: JSON/MCP sınırında 64-bit dizge (`string`) bütünlük kapısı
      if (livingWorldToolNames.has(toolName) || airlockToolNames.has(toolName)) {
        const boundaryCheck = sidecarAirlockEngine.validate64BitMcpArguments(args);
        if (!boundaryCheck.ok) {
          return {
            jsonrpc: "2.0",
            id,
            error: {
              code: -32602,
              message: boundaryCheck.messageTr,
              data: boundaryCheck,
            },
          };
        }
      }

      const callRes = airlockToolNames.has(toolName)
        ? airlockMcp.invokeAirlockTool({
          toolName,
          callerRole,
          arguments: args,
        })
        : livingWorldToolNames.has(toolName)
          ? livingWorldMcp.invokeLivingWorldMcpTool({
            toolName,
            callerRole,
            arguments: args,
          })
        : firstTaskToolNames.has(toolName)
          ? firstTaskMcp.invokeFirstTaskTool({
              toolName,
              callerRole,
              arguments: args,
            })
          : livingWorldToolNames.has(toolName)
            ? livingWorldMcp.invokeLivingWorldMcpTool({
                toolName,
                callerRole,
                arguments: args,
              })
            : mcpServer.invokeTool({
                toolName,
                callerRole,
                arguments: args,
              });
      if (!callRes.ok) {
        return {
          jsonrpc: "2.0",
          id,
          error: {
            code: -32000,
            message: callRes.messageTr || callRes.errorCode || "MCP tool execution blocked or failed.",
            data: callRes,
          },
        };
      }
      return {
        jsonrpc: "2.0",
        id,
        result: {
          content: [
            {
              type: "text",
              text: JSON.stringify(callRes, null, 2),
            },
          ],
          structuredResult: callRes,
        },
      };
    }

    return {
      jsonrpc: "2.0",
      id,
      error: {
        code: -32601,
        message: `Method not found: ${method}`,
      },
    };
  }

  function handleRawJsonRpcText(rawText) {
    const rawViol = sidecarAirlockEngine.detectUnquoted64BitViolationInRawJson(rawText);
    if (rawViol) {
      let parsedId = null;
      const idMatch = /"id"\s*:\s*("[^"]*"|-?[0-9]+)/.exec(rawText);
      if (idMatch) {
        try {
          parsedId = JSON.parse(idMatch[1]);
        } catch (_) {
          parsedId = null;
        }
      }
      return {
        jsonrpc: "2.0",
        id: parsedId,
        error: {
          code: -32602,
          message: rawViol.messageTr,
          data: rawViol,
        },
      };
    }
    let req;
    try {
      req = JSON.parse(rawText);
    } catch (err) {
      return {
        jsonrpc: "2.0",
        id: null,
        error: {
          code: -32700,
          message: `Parse error: ${String(err && err.message ? err.message : err)}`,
        },
      };
    }
    return handleJsonRpcRequest(req);
  }

  return {
    mcpServer,
    firstTaskMcp,
    livingWorldMcp,
    airlockMcp,
    combinedToolsCatalog,
    handleJsonRpcRequest,
    handleRawJsonRpcText,
  };
}

// CLI / Stdio modu (--self-test, --stdio-ndjson veya tekil/çoklu JSON-RPC stdin)
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  const handler = createStandaloneCaelusMcpJsonRpcHandler({ allowWrite: false });
  if (process.argv.includes("--self-test")) {
    const listResp = handler.handleJsonRpcRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
    });
    const callResp = handler.handleJsonRpcRequest({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "rank_information_needs",
        arguments: { method: "caelus_decision_sensitivity" },
      },
    });
    const callFirstTaskResp = handler.handleJsonRpcRequest({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "inspect_imported_dataset",
        arguments: { caseId: "VAKA_A" },
      },
    });
    const callLivingWorldResp = handler.handleJsonRpcRequest({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: {
        name: "list_living_world_sources",
        arguments: {},
      },
    });
    const unsafeNumGuardResp = handler.handleRawJsonRpcText(
      '{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"caelus_evaluate_slice","arguments":{"cutoff_learned_at_ms":9007199254740993}}}'
    );
    const callCounterfactualResp = handler.handleJsonRpcRequest({
      jsonrpc: "2.0",
      id: 6,
      method: "tools/call",
      params: {
        name: "caelus_run_counterfactual_branch",
        arguments: {
          base_cutoff_ms: "1762849500000",
          branch_id: "cf_01",
          interventions: [{ target_id: "BERTH_02", override_field: "status", fp_val: "0" }],
        },
      },
    });
    process.stdout.write(
      JSON.stringify(
        {
          selfTestPassed:
            Array.isArray(listResp.result?.tools) &&
            listResp.result.tools.length === 11 &&
            Array.isArray(listResp.result?.firstRealTaskTools) &&
            listResp.result.firstRealTaskTools.length === 10 &&
            Array.isArray(listResp.result?.livingWorldTools) &&
            listResp.result.livingWorldTools.length === 9 &&
            Array.isArray(listResp.result?.airlockTools) &&
            listResp.result.airlockTools.length === 4 &&
            Boolean(callResp.result?.structuredResult) &&
            Boolean(callFirstTaskResp.result?.structuredResult?.ok) &&
            Boolean(callLivingWorldResp.result?.structuredResult?.ok) &&
            Boolean(callCounterfactualResp.result?.structuredResult?.ok) &&
            Boolean(unsafeNumGuardResp.error),
          toolCount: listResp.result?.combinedToolsCatalog?.length || 0,
          discoveryToolsCount: listResp.result?.discoveryToolsCount || 0,
          firstRealTaskToolsCount: listResp.result?.firstRealTaskToolsCount || 0,
          livingWorldToolsCount: listResp.result?.livingWorldToolsCount || 0,
          airlockToolsCount: listResp.result?.airlockToolsCount || 0,
          nativeSidecarAvailable: Boolean(handler.airlockMcp.findNativeSidecarBinary()),
          counterfactualVerdictTransition: callCounterfactualResp.result?.structuredResult
            ? `${callCounterfactualResp.result.structuredResult.base_verdict}->${callCounterfactualResp.result.structuredResult.branch_verdict}`
            : null,
          topRankedUnknownId:
            callResp.result?.structuredResult?.rankedNeeds?.[0]?.variableId || null,
          inspectedDatasetId:
            callFirstTaskResp.result?.structuredResult?.dataset_id || null,
          livingWorldSourcesCount:
            callLivingWorldResp.result?.structuredResult?.sources?.length || 0,
        },
        null,
        2
      ) + "\n"
    );
  } else if (process.argv.includes("--stdio-ndjson")) {
    const rl = readline.createInterface({
      input: process.stdin,
      crlfDelay: Infinity,
    });
    rl.on("line", (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      const resp = handler.handleRawJsonRpcText(trimmed);
      process.stdout.write(JSON.stringify(resp) + "\n");
    });
  } else {
    const rawInput = fs.readFileSync(0, "utf8").trim();
    if (rawInput) {
      const nonEmptyLines = rawInput
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
      if (nonEmptyLines.length > 1 && nonEmptyLines.every((l) => l.startsWith("{") && l.endsWith("}"))) {
        for (const line of nonEmptyLines) {
          const resp = handler.handleRawJsonRpcText(line);
          process.stdout.write(JSON.stringify(resp) + "\n");
        }
      } else {
        const resp = handler.handleRawJsonRpcText(rawInput);
        process.stdout.write(JSON.stringify(resp, null, 2) + "\n");
      }
    }
  }
}
