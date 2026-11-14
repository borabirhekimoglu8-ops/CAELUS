#![forbid(unsafe_code)]

//! CAELUS OS MCP Bridge (`rmcp`), One-Way Glass Wall `Z3` Mutation Gate,
//! `dev-mcp` Runtime Isolation, and `Proof-to-Prose` + `DNV/EMSA` Handover Generator.

pub mod connectors;
pub mod handover;
pub mod z3_gate;

pub use connectors::{
    build_rmcp_tool_catalog, default_dev_mcp_path, default_mcp_connectors_path,
    dispatch_guarded_mcp_call, load_dev_connector_ids, load_production_connectors,
    GuardedMcpEnvelope, McpConnectorSpec, TransportKind,
};
pub use handover::{
    build_dnv_emsa_audit_bundle, generate_proof_to_prose_60s, DnvEmsaAuditBundle,
    ShiftHandoverBrief,
};
pub use z3_gate::{
    default_z3_policy_path, evaluate_mutation_gate, verify_z3_smt2_policy_text, Z3GateVerdict,
};
