//! Universal 7-Connector `rmcp` Registry + `dev-mcp` End-User Runtime Isolation
//! + Axiom A-2 Stringified Integer Envelopes.

use crate::z3_gate::Z3GateVerdict;
use caelus_graph::xtdb_bitemporal::i64_str;
use rmcp::model::{object, Tool, ToolAnnotations};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TransportKind {
    Stdio,
    Tcp,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct McpConnectorSpec {
    pub id: String,
    pub transport: TransportKind,
    pub command: String,
    pub endpoint: String,
    pub scopes: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GuardedMcpEnvelope {
    #[serde(with = "i64_str")]
    pub request_seq: i64,
    pub connector_id: String,
    pub scope: String,
    pub mutation_requested: bool,
    pub gate_verdict: Z3GateVerdict,
    pub transport: TransportKind,
}

const DEFAULT_DEV_IDS: [&str; 3] = ["chrome-devtools-mcp", "playwright-mcp", "mcp-nixos"];

#[must_use]
pub fn default_mcp_connectors_path() -> PathBuf {
    PathBuf::from("mcp-connectors")
        .join("config")
        .join("mcp_connectors.toml")
}

#[must_use]
pub fn default_dev_mcp_path() -> PathBuf {
    PathBuf::from("mcp-connectors")
        .join("config")
        .join("dev_mcp.toml")
}

#[must_use]
pub fn embedded_production_connectors() -> Vec<McpConnectorSpec> {
    vec![
        McpConnectorSpec {
            id: "anytype-local-e2ee".to_string(),
            transport: TransportKind::Stdio,
            command: "caelus-mcp-anytype".to_string(),
            endpoint: String::new(),
            scopes: vec![
                "objects:read".to_string(),
                "dossiers:write_approved".to_string(),
            ],
        },
        McpConnectorSpec {
            id: "documenso-signing".to_string(),
            transport: TransportKind::Tcp,
            command: String::new(),
            endpoint: "127.0.0.1:9420".to_string(),
            scopes: vec![
                "contracts:prepare_envelope".to_string(),
                "signatures:glass_wall_approved".to_string(),
            ],
        },
        McpConnectorSpec {
            id: "github".to_string(),
            transport: TransportKind::Stdio,
            command: "caelus-mcp-github".to_string(),
            endpoint: String::new(),
            scopes: vec![
                "repo:read".to_string(),
                "pr:draft_only_until_approved".to_string(),
            ],
        },
        McpConnectorSpec {
            id: "google-workspace".to_string(),
            transport: TransportKind::Stdio,
            command: "caelus-mcp-workspace".to_string(),
            endpoint: String::new(),
            scopes: vec![
                "drive:read".to_string(),
                "keep:read_write_approved".to_string(),
                "gmail:draft_only".to_string(),
                "calendar:read".to_string(),
            ],
        },
        McpConnectorSpec {
            id: "vortex-oxigraph-xtdb".to_string(),
            transport: TransportKind::Stdio,
            command: "caelus-mcp-local-graph".to_string(),
            endpoint: String::new(),
            scopes: vec!["sparql:read".to_string(), "xtdb:branch_compare".to_string()],
        },
        McpConnectorSpec {
            id: "port-erp-tos".to_string(),
            transport: TransportKind::Tcp,
            command: String::new(),
            endpoint: "127.0.0.1:9410".to_string(),
            scopes: vec![
                "berth_slots:read".to_string(),
                "tariff_envelope:simulate".to_string(),
            ],
        },
        McpConnectorSpec {
            id: "nmea2000-ais-vhf".to_string(),
            transport: TransportKind::Stdio,
            command: "caelus-mcp-nmea".to_string(),
            endpoint: "127.0.0.1:10110".to_string(),
            scopes: vec!["nmea:read".to_string()],
        },
    ]
}

fn parse_toml_string(val: &str) -> String {
    val.trim().trim_matches('"').to_string()
}

fn parse_toml_array(val: &str) -> Vec<String> {
    let inner = val.trim().trim_start_matches('[').trim_end_matches(']');
    inner
        .split(',')
        .map(parse_toml_string)
        .filter(|s| !s.is_empty())
        .collect()
}

/// Parses `mcp_connectors.toml` without adding heavy TOML parser dependencies.
#[must_use]
pub fn load_production_connectors(path: Option<&Path>) -> Vec<McpConnectorSpec> {
    let target = path
        .map(Path::to_path_buf)
        .unwrap_or_else(default_mcp_connectors_path);
    let Ok(text) = fs::read_to_string(target) else {
        return embedded_production_connectors();
    };

    let mut out = Vec::new();
    let mut cur: Option<McpConnectorSpec> = None;

    for raw_line in text.lines() {
        let line = raw_line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if line == "[[connector]]" {
            if let Some(prev) = cur.take() {
                if !prev.id.is_empty() {
                    out.push(prev);
                }
            }
            cur = Some(McpConnectorSpec {
                id: String::new(),
                transport: TransportKind::Stdio,
                command: String::new(),
                endpoint: String::new(),
                scopes: Vec::new(),
            });
            continue;
        }
        if line.starts_with('[') {
            if let Some(prev) = cur.take() {
                if !prev.id.is_empty() {
                    out.push(prev);
                }
            }
            continue;
        }
        if let (Some(ref mut item), Some((k, v))) = (&mut cur, line.split_once('=')) {
            let key = k.trim();
            match key {
                "id" => item.id = parse_toml_string(v),
                "transport" => {
                    item.transport = if parse_toml_string(v).eq_ignore_ascii_case("tcp") {
                        TransportKind::Tcp
                    } else {
                        TransportKind::Stdio
                    };
                }
                "command" => item.command = parse_toml_string(v),
                "endpoint" => item.endpoint = parse_toml_string(v),
                "scopes" => item.scopes = parse_toml_array(v),
                _ => {}
            }
        }
    }
    if let Some(last) = cur.take() {
        if !last.id.is_empty() {
            out.push(last);
        }
    }

    if out.is_empty() {
        embedded_production_connectors()
    } else {
        out
    }
}

/// Parses `dev_mcp.toml` connector IDs so runtime always isolates and blocks them.
#[must_use]
pub fn load_dev_connector_ids(path: Option<&Path>) -> Vec<String> {
    let target = path
        .map(Path::to_path_buf)
        .unwrap_or_else(default_dev_mcp_path);
    let Ok(text) = fs::read_to_string(target) else {
        return DEFAULT_DEV_IDS.iter().map(|s| (*s).to_string()).collect();
    };
    let mut ids = Vec::new();
    let mut in_dev = false;
    for raw_line in text.lines() {
        let line = raw_line.trim();
        if line == "[[dev_connector]]" {
            in_dev = true;
            continue;
        }
        if in_dev {
            if let Some((k, v)) = line.split_once('=') {
                if k.trim() == "id" {
                    ids.push(parse_toml_string(v));
                }
            }
        }
    }
    if ids.is_empty() {
        DEFAULT_DEV_IDS.iter().map(|s| (*s).to_string()).collect()
    } else {
        ids
    }
}

/// Constructs `rmcp::model::Tool` definitions for all production connectors.
#[must_use]
pub fn build_rmcp_tool_catalog(specs: &[McpConnectorSpec]) -> Vec<Tool> {
    specs
        .iter()
        .map(|spec| {
            let schema = Arc::new(object(serde_json::json!({
                "type": "object",
                "properties": {
                    "scope": { "type": "string" },
                    "requestSeq": { "type": "string" }
                },
                "required": ["scope", "requestSeq"]
            })));
            let read_only = !spec
                .scopes
                .iter()
                .any(|s| s.contains("write") || s.contains("sign"));
            let desc = format!(
                "CAELUS MCP bridge '{}' ({:?}), scopes: [{}]",
                spec.id,
                spec.transport,
                spec.scopes.join(", ")
            );
            Tool::new(spec.id.clone(), desc, schema).with_annotations(
                ToolAnnotations::new()
                    .read_only(read_only)
                    .destructive(!read_only),
            )
        })
        .collect()
}

/// Returns `true` when an MCP scope performs a state mutation requiring Z3 + Shisa Kanko.
#[must_use]
pub fn scope_requires_mutation(scope: &str) -> bool {
    let s = scope.to_ascii_lowercase();
    s.contains("write")
        || s.contains("sign")
        || s.contains("draft")
        || s.contains("commit")
        || s.contains("mutate")
}

/// Dispatches an end-user MCP request while blocking `dev-mcp` connectors and unapproved mutations.
pub fn dispatch_guarded_mcp_call(
    connector_id: &str,
    scope: &str,
    request_seq: i64,
    gate: Z3GateVerdict,
) -> Result<GuardedMcpEnvelope, String> {
    let dev_ids = load_dev_connector_ids(None);
    if dev_ids.iter().any(|id| id == connector_id) || DEFAULT_DEV_IDS.contains(&connector_id) {
        return Err(format!("DEV_MCP_RUNTIME_FORBIDDEN: {connector_id}"));
    }

    let specs = load_production_connectors(None);
    let Some(spec) = specs.into_iter().find(|c| c.id == connector_id) else {
        return Err(format!("UNKNOWN_CONNECTOR: {connector_id}"));
    };

    let mutation = scope_requires_mutation(scope);
    if mutation && (!gate.mutation_requested || !gate.allowed) {
        return Err(format!("Z3_GATE_DENIED: {}", gate.reason_code));
    }
    if !gate.allowed {
        return Err(format!("Z3_GATE_DENIED: {}", gate.reason_code));
    }

    Ok(GuardedMcpEnvelope {
        request_seq,
        connector_id: spec.id,
        scope: scope.to_string(),
        mutation_requested: mutation,
        gate_verdict: gate,
        transport: spec.transport,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::z3_gate::evaluate_mutation_gate;
    use caelus_core::i18n_seven::GlassWallStage;

    #[test]
    fn loads_all_7_production_connectors_and_isolates_dev_mcp() {
        let root_cfg = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("..")
            .join("mcp-connectors")
            .join("config")
            .join("mcp_connectors.toml");
        let root_dev = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("..")
            .join("mcp-connectors")
            .join("config")
            .join("dev_mcp.toml");

        let specs = load_production_connectors(Some(&root_cfg));
        assert_eq!(specs.len(), 7, "Expected all 7 production MCP connectors");

        let tools = build_rmcp_tool_catalog(&specs);
        assert_eq!(tools.len(), 7);

        let dev_ids = load_dev_connector_ids(Some(&root_dev));
        assert_eq!(dev_ids.len(), 3);

        let ro_gate = evaluate_mutation_gate(
            false,
            GlassWallStage::PersonalWorkspace,
            false,
            false,
            false,
        );
        for dev_id in &dev_ids {
            let err = dispatch_guarded_mcp_call(dev_id, "read", 1, ro_gate.clone())
                .expect_err("dev-mcp must be rejected in runtime");
            assert!(err.starts_with("DEV_MCP_RUNTIME_FORBIDDEN"));
        }

        let read_env =
            dispatch_guarded_mcp_call("port-erp-tos", "berth_slots:read", 42, ro_gate.clone())
                .expect("read-only TOS allowed");
        let json = serde_json::to_string(&read_env).expect("json");
        assert!(
            json.contains("\"request_seq\":\"42\""),
            "Axiom A-2 stringified i64"
        );

        // Mutation blocked under PersonalWorkspace, allowed under signed FieldMission
        assert!(dispatch_guarded_mcp_call(
            "documenso-signing",
            "signatures:glass_wall_approved",
            9,
            ro_gate
        )
        .is_err());

        let approved_gate =
            evaluate_mutation_gate(true, GlassWallStage::FieldMission, true, false, false);
        let ok_env = dispatch_guarded_mcp_call(
            "documenso-signing",
            "signatures:glass_wall_approved",
            10,
            approved_gate,
        )
        .expect("signed FieldMission mutation allowed");
        assert!(ok_env.mutation_requested);
    }
}
