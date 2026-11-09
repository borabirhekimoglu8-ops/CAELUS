#!/usr/bin/env node
/**
 * CAELUS Özel MCP Sunucusu (Standalone JSON-RPC 2.0 & Programatik Köprü)
 *
 * Parça 3 (Bölüm 3.3):
 * CAELUS'un kendi dünya hafızasını, hipotezlerini, bilgi açıklarını ve
 * duyarlılık analizlerini dış ajanlara kontrollü ve en az yetki (least-privilege)
 * ilkesiyle açan MCP sunucusu.
 */

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const discoveryEngine = require(path.join(__dirname, "..", "ui", "discovery_value_engine.js"));

export function createStandaloneCaelusMcpJsonRpcHandler(options = {}) {
  const mcpServer = discoveryEngine.createCaelusMcpServer(options);

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
      return {
        jsonrpc: "2.0",
        id,
        result: {
          tools: mcpServer.toolsCatalog,
        },
      };
    }

    if (method === "tools/call") {
      const toolName = params.name || "";
      const args = params.arguments || {};
      const callerRole = params.callerRole || mcpServer.defaultRole;
      const callRes = mcpServer.invokeTool({
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

  return {
    mcpServer,
    handleJsonRpcRequest,
  };
}

// CLI / Stdio modu (--self-test veya JSON-RPC stdin)
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
    process.stdout.write(
      JSON.stringify(
        {
          selfTestPassed:
            Array.isArray(listResp.result?.tools) &&
            listResp.result.tools.length === 11 &&
            Boolean(callResp.result?.structuredResult),
          toolCount: listResp.result?.tools?.length || 0,
          topRankedUnknownId:
            callResp.result?.structuredResult?.rankedNeeds?.[0]?.variableId || null,
        },
        null,
        2
      ) + "\n"
    );
  } else {
    const rawInput = fs.readFileSync(0, "utf8").trim();
    if (rawInput) {
      const req = JSON.parse(rawInput);
      const resp = handler.handleJsonRpcRequest(req);
      process.stdout.write(JSON.stringify(resp, null, 2) + "\n");
    }
  }
}
