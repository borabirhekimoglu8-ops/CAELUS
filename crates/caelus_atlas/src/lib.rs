//! `caelus_atlas`: CAELUS OS Living Global Maritime Database & Fleet Intelligence.
//!
//! Provides zero-copy page-granular `rkyv + memmap2` vessel/port/company/country/regulation
//! storage (`< 1 ms` `LEAP` prefix/ID queries, `< 40 MiB` UI RSS), Pure-Rust `Oxigraph`
//! on-demand active subgraph SPARQL, `XTDB` bitemporal history, `E-Graph + Z3` regulatory
//! contradiction checking, `O(Delta)` conditional HTTP/SPARQL ingestion, and `rmcp` MCP serving.

#![deny(unsafe_code)]

pub mod bitemporal_xtdb;
pub mod delta_sync;
pub mod fleet_schema;
pub mod leap_search;
pub mod live_ingest;
pub mod mcp_bridge;
pub mod mmap_store;
pub mod rule_verifier;
pub mod serde_i64_str;
pub mod spo_graph;

pub use delta_sync::{default_mmap_dir, sync_and_build_atlas, DeltaSyncReport};
pub use leap_search::{
    ports_to_route_spec, vessel_to_match_input, LeapEntityKind, LeapLookupResult, LivingAtlas,
};
pub use live_ingest::default_cache_dir;
pub use mmap_store::AtlasManifestStats;
