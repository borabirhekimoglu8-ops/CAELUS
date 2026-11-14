//! Stdio / Socket `rmcp` MCP Bridge for `caelus_atlas`.
//!
//! Exposes read-only zero-copy `LEAP`, 4-Gate Suitability, `Oxigraph` SPO SPARQL,
//! `XTDB` bitemporal history, and `O(Delta)` manifest status tools over JSON-RPC 2.0,
//! with all 64-bit integers encoded as decimal ASCII strings (CAELUS Axiom 2).

use crate::leap_search::{LeapEntityKind, LivingAtlas};
use crate::serde_i64_str::{i64_str, u64_str};
use rmcp::model::{object, Tool, ToolAnnotations};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs;
use std::path::Path;
use std::sync::Arc;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AtlasMcpConnectorSpec {
    pub id: String,
    pub transport: String,
    pub command: String,
    pub args: Vec<String>,
    pub endpoint: String,
    pub scopes: Vec<String>,
}

#[derive(Debug, Serialize)]
struct AtlasDeltaStatusPayload {
    #[serde(with = "u64_str")]
    vessel_count: u64,
    #[serde(with = "u64_str")]
    iacs_count: u64,
    #[serde(with = "u64_str")]
    port_count: u64,
    #[serde(with = "u64_str")]
    smdg_count: u64,
    #[serde(with = "u64_str")]
    company_count: u64,
    #[serde(with = "u64_str")]
    country_count: u64,
    #[serde(with = "u64_str")]
    regulation_count: u64,
    #[serde(with = "u64_str")]
    built_unix_s: u64,
    #[serde(with = "u64_str")]
    total_mapped_bytes: u64,
}

#[derive(Debug, Serialize)]
struct FourGateRpcPayload {
    imo: u32,
    mmsi: u32,
    origin_unlocode: String,
    dest_unlocode: String,
    gate1_legal_class_pi: bool,
    gate2_physical_ukc_air: bool,
    gate3_strait_eca_cabotage: bool,
    gate4_net_tce_profitable: bool,
    all_gates_passed: bool,
    primary_failure: String,
    squat_mm: u32,
    ukc_margin_mm: i32,
    air_draft_margin_mm: i32,
    #[serde(with = "u64_str")]
    voyage_hours_milli: u64,
    #[serde(with = "u64_str")]
    fuel_burn_kg: u64,
    #[serde(with = "u64_str")]
    co2_kg: u64,
    #[serde(with = "i64_str")]
    ets_cost_cents: i64,
    #[serde(with = "i64_str")]
    net_voyage_cashflow_cents: i64,
    #[serde(with = "i64_str")]
    net_tce_per_day_cents: i64,
    composite_score_bp: u16,
}

#[must_use]
pub fn embedded_atlas_connectors() -> Vec<AtlasMcpConnectorSpec> {
    vec![
        AtlasMcpConnectorSpec {
            id: "oxigraph-living-atlas".to_string(),
            transport: "stdio".to_string(),
            command: "caelus-mcp-atlas".to_string(),
            args: vec![
                "--mmap-dir".to_string(),
                "./data/atlas_mmap".to_string(),
                "--zero-copy-rkyv".to_string(),
            ],
            endpoint: String::new(),
            scopes: vec!["atlas:read".to_string(), "sparql:read".to_string()],
        },
        AtlasMcpConnectorSpec {
            id: "opensanctions-gleif-delta".to_string(),
            transport: "stdio".to_string(),
            command: "caelus-mcp-compliance".to_string(),
            args: Vec::new(),
            endpoint: String::new(),
            scopes: vec![
                "vessel:read".to_string(),
                "ubo:read".to_string(),
                "sanctions:verify".to_string(),
            ],
        },
        AtlasMcpConnectorSpec {
            id: "equasis-iacs-pi-compliance".to_string(),
            transport: "stdio".to_string(),
            command: "caelus-mcp-class-pi".to_string(),
            args: Vec::new(),
            endpoint: String::new(),
            scopes: vec![
                "iacs:read".to_string(),
                "blue_card:verify_feb20".to_string(),
                "psc:read".to_string(),
            ],
        },
        AtlasMcpConnectorSpec {
            id: "port-erp-tos".to_string(),
            transport: "tcp".to_string(),
            command: String::new(),
            args: Vec::new(),
            endpoint: "127.0.0.1:9410".to_string(),
            scopes: vec!["berth:read".to_string()],
        },
        AtlasMcpConnectorSpec {
            id: "nmea2000-ais-vhf".to_string(),
            transport: "stdio".to_string(),
            command: "caelus-mcp-nmea".to_string(),
            args: Vec::new(),
            endpoint: "127.0.0.1:10110".to_string(),
            scopes: vec!["ais:read".to_string()],
        },
    ]
}

fn parse_string_array(raw: &str) -> Vec<String> {
    let trimmed = raw.trim().trim_start_matches('[').trim_end_matches(']');
    trimmed
        .split(',')
        .map(|s| s.trim().trim_matches('"').to_string())
        .filter(|s| !s.is_empty())
        .collect()
}

/// Parses `mcp-connectors/config/atlas_mcp.toml` if present, falling back cleanly otherwise.
#[must_use]
pub fn load_atlas_mcp_connectors(path: Option<&Path>) -> Vec<AtlasMcpConnectorSpec> {
    let default_p = Path::new("mcp-connectors/config/atlas_mcp.toml");
    let target = path.unwrap_or(default_p);
    let Ok(text) = fs::read_to_string(target) else {
        return embedded_atlas_connectors();
    };
    let mut out = Vec::new();
    let mut cur: Option<AtlasMcpConnectorSpec> = None;

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
            cur = Some(AtlasMcpConnectorSpec {
                id: String::new(),
                transport: "stdio".to_string(),
                command: String::new(),
                args: Vec::new(),
                endpoint: String::new(),
                scopes: Vec::new(),
            });
            continue;
        }
        if let (Some(ref mut item), Some((k, v))) = (&mut cur, line.split_once('=')) {
            let val = v.trim();
            match k.trim() {
                "id" => item.id = val.trim_matches('"').to_string(),
                "transport" => item.transport = val.trim_matches('"').to_string(),
                "command" => item.command = val.trim_matches('"').to_string(),
                "args" => item.args = parse_string_array(val),
                "endpoint" => item.endpoint = val.trim_matches('"').to_string(),
                "scopes" => item.scopes = parse_string_array(val),
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
        embedded_atlas_connectors()
    } else {
        out
    }
}

/// Builds the `rmcp::model::Tool` catalog exported by `caelus-mcp-atlas`.
#[must_use]
pub fn build_atlas_rmcp_tools() -> Vec<Tool> {
    let ro = ToolAnnotations::new().read_only(true).destructive(false);

    vec![
        Tool::new(
            "atlas_leap_lookup",
            "Sub-millisecond LEAP search across 100,000+ vessels, UN/LOCODE ports, companies, countries, and maritime regulations.",
            Arc::new(object(json!({
                "type": "object",
                "properties": { "query": { "type": "string" } },
                "required": ["query"]
            }))),
        )
        .with_annotations(ro.clone()),
        Tool::new(
            "atlas_evaluate_four_gates",
            "Deterministic 4-Gate Vessel-to-Route Suitability (Legal/IACS/P&I, Physical UKC/AirDraft, Strait/ECA/Cabotage, Net TCE).",
            Arc::new(object(json!({
                "type": "object",
                "properties": {
                    "imo": { "type": "integer" },
                    "origin_unlocode": { "type": "string" },
                    "dest_unlocode": { "type": "string" }
                },
                "required": ["imo", "origin_unlocode", "dest_unlocode"]
            }))),
        )
        .with_annotations(ro.clone()),
        Tool::new(
            "atlas_sparql_subgraph",
            "Materializes active 1-2 hop RDF subgraph from spo_graph.rkyv into Pure-Rust Oxigraph and runs SPARQL 1.1 SELECT/ASK.",
            Arc::new(object(json!({
                "type": "object",
                "properties": {
                    "root_iri": { "type": "string" },
                    "sparql": { "type": "string" }
                },
                "required": ["root_iri", "sparql"]
            }))),
        )
        .with_annotations(ro.clone()),
        Tool::new(
            "atlas_xtdb_history",
            "Returns non-destructive XTDB bitemporal valid_time/tx_time history for vessel, port, or regulation keys.",
            Arc::new(object(json!({
                "type": "object",
                "properties": { "entity_key": { "type": "string" } },
                "required": ["entity_key"]
            }))),
        )
        .with_annotations(ro.clone()),
        Tool::new(
            "atlas_delta_status",
            "Returns mapped zero-copy archive entity counts, build timestamp, and mapped byte size.",
            Arc::new(object(json!({
                "type": "object",
                "properties": {}
            }))),
        )
        .with_annotations(ro),
    ]
}

fn rpc_ok(id: Value, result: Value) -> String {
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "result": result
    })
    .to_string()
}

fn rpc_err(id: Value, code: i64, message: &str) -> String {
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "error": {
            "code": code,
            "message": message
        }
    })
    .to_string()
}

/// Processes one JSON-RPC 2.0 request line over stdio using `rmcp` tool schemas and `LivingAtlas`.
#[must_use]
pub fn handle_mcp_jsonrpc_line(atlas: &LivingAtlas, line: &str) -> Option<String> {
    let Ok(req) = serde_json::from_str::<Value>(line.trim()) else {
        return Some(rpc_err(Value::Null, -32700, "Parse error"));
    };
    let id = req.get("id").cloned().unwrap_or(Value::Null);
    let method = req.get("method").and_then(Value::as_str).unwrap_or("");
    let params = req.get("params").cloned().unwrap_or_else(|| json!({}));

    // Notifications without id do not require a reply
    if id.is_null() && method.starts_with("notifications/") {
        return None;
    }

    match method {
        "initialize" => Some(rpc_ok(
            id,
            json!({
                "protocolVersion": "2024-11-05",
                "capabilities": { "tools": { "listChanged": false } },
                "serverInfo": { "name": "caelus-mcp-atlas", "version": "0.9.1" }
            }),
        )),
        "tools/list" => {
            let tools = build_atlas_rmcp_tools();
            Some(rpc_ok(id, json!({ "tools": tools })))
        }
        "tools/call" => {
            let name = params.get("name").and_then(Value::as_str).unwrap_or("");
            let args = params
                .get("arguments")
                .cloned()
                .unwrap_or_else(|| json!({}));
            let payload_res: Result<Value, String> = match name {
                "atlas_leap_lookup" => {
                    let q = args.get("query").and_then(Value::as_str).unwrap_or("");
                    match atlas.leap_search(q) {
                        Ok(Some(hit)) => Ok(json!({
                            "found": true,
                            "kind": match hit.kind {
                                LeapEntityKind::Vessel => "vessel",
                                LeapEntityKind::Port => "port",
                                LeapEntityKind::Company => "company",
                                LeapEntityKind::Country => "country",
                                LeapEntityKind::Regulation => "regulation",
                            },
                            "entity_key": hit.entity_key,
                            "primary_label": hit.primary_label,
                            "secondary_label": hit.secondary_label,
                            "lat_microdeg": hit.lat_microdeg.map(|v| v.to_string()),
                            "lon_microdeg": hit.lon_microdeg.map(|v| v.to_string()),
                            "unlocode": hit.unlocode,
                            "imo": hit.imo,
                            "mmsi": hit.mmsi,
                            "flag_iso2": hit.flag_iso2,
                            "iacs_member": hit.iacs_member,
                            "elapsed_us": hit.elapsed_us.to_string(),
                        })),
                        Ok(None) => Ok(json!({ "found": false, "query": q })),
                        Err(e) => Err(e),
                    }
                }
                "atlas_evaluate_four_gates" => {
                    let imo = args
                        .get("imo")
                        .and_then(|v| {
                            v.as_u64()
                                .or_else(|| v.as_str().and_then(|s| s.parse::<u64>().ok()))
                        })
                        .and_then(|n| u32::try_from(n).ok())
                        .unwrap_or(0);
                    let origin = args
                        .get("origin_unlocode")
                        .and_then(Value::as_str)
                        .unwrap_or("TRSEF");
                    let dest = args
                        .get("dest_unlocode")
                        .and_then(Value::as_str)
                        .unwrap_or("GRSMI");
                    match atlas.evaluate_vessel_on_ports(imo, origin, dest) {
                        Ok(Some((res, _route))) => {
                            let body = FourGateRpcPayload {
                                imo: res.imo,
                                mmsi: res.mmsi,
                                origin_unlocode: origin.to_string(),
                                dest_unlocode: dest.to_string(),
                                gate1_legal_class_pi: res.gate1_legal_class_pi,
                                gate2_physical_ukc_air: res.gate2_physical_ukc_air,
                                gate3_strait_eca_cabotage: res.gate3_strait_eca_cabotage,
                                gate4_net_tce_profitable: res.gate4_net_tce_profitable,
                                all_gates_passed: res.all_gates_passed,
                                primary_failure: format!("{:?}", res.primary_failure),
                                squat_mm: res.squat_mm,
                                ukc_margin_mm: res.ukc_margin_mm,
                                air_draft_margin_mm: res.air_draft_margin_mm,
                                voyage_hours_milli: res.voyage_hours_milli,
                                fuel_burn_kg: res.fuel_burn_kg,
                                co2_kg: res.co2_kg,
                                ets_cost_cents: res.ets_cost_cents,
                                net_voyage_cashflow_cents: res.net_voyage_cashflow_cents,
                                net_tce_per_day_cents: res.net_tce_per_day_cents,
                                composite_score_bp: res.composite_score_bp,
                            };
                            serde_json::to_value(body).map_err(|e| format!("json err: {e}"))
                        }
                        Ok(None) => Err(format!(
                            "Vessel IMO {imo} or ports {origin}/{dest} not found"
                        )),
                        Err(e) => Err(e),
                    }
                }
                "atlas_sparql_subgraph" => {
                    let root_iri = args.get("root_iri").and_then(Value::as_str).unwrap_or("");
                    let sparql = args
                        .get("sparql")
                        .and_then(Value::as_str)
                        .unwrap_or("SELECT ?p ?o WHERE { ?s ?p ?o . } LIMIT 32");
                    atlas
                        .query_subject_sparql(root_iri, sparql)
                        .map(|rows| json!({ "root_iri": root_iri, "rows": rows }))
                }
                "atlas_xtdb_history" => {
                    let key = args
                        .get("entity_key")
                        .and_then(Value::as_str)
                        .unwrap_or("atlas:global_fleet");
                    atlas
                        .load_bitemporal_history(key)
                        .and_then(|events| {
                            serde_json::to_value(events).map_err(|e| format!("xtdb json: {e}"))
                        })
                        .map(|events| json!({ "entity_key": key, "events": events }))
                }
                "atlas_delta_status" => {
                    let st = atlas.stats();
                    let payload = AtlasDeltaStatusPayload {
                        vessel_count: st.vessel_count,
                        iacs_count: st.iacs_count,
                        port_count: st.port_count,
                        smdg_count: st.smdg_count,
                        company_count: st.company_count,
                        country_count: st.country_count,
                        regulation_count: st.regulation_count,
                        built_unix_s: st.built_unix_s,
                        total_mapped_bytes: st.total_mapped_bytes,
                    };
                    serde_json::to_value(payload).map_err(|e| format!("status json: {e}"))
                }
                _ => Err(format!("Unknown tool: {name}")),
            };

            match payload_res {
                Ok(val) => Some(rpc_ok(
                    id,
                    json!({
                        "content": [{
                            "type": "text",
                            "text": val.to_string()
                        }],
                        "structuredContent": val,
                        "isError": false
                    }),
                )),
                Err(msg) => Some(rpc_ok(
                    id,
                    json!({
                        "content": [{
                            "type": "text",
                            "text": msg
                        }],
                        "isError": true
                    }),
                )),
            }
        }
        _ => Some(rpc_err(id, -32601, "Method not found")),
    }
}
