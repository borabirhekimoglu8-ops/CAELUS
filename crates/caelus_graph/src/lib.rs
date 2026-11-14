#![forbid(unsafe_code)]

//! CAELUS OS Bitemporal Graph, Pure-Rust Oxigraph SPO Store, and Streaming
//! UN/LOCODE + SMDG Terminal Index.
//!
//! Designed for sub-45 MiB footprint: CSV registries stream line-by-line via
//! `BufReader` and Oxigraph stores are constructed lazily on demand.

pub mod spo_store;
pub mod unlocode_smdg;
pub mod xtdb_bitemporal;

pub use spo_store::{build_maritime_spo_store, query_sparql_count, query_sparql_summary};
pub use unlocode_smdg::{
    default_smdg_path, default_unlocode_path, search_smdg_streaming, search_unlocode_streaming,
    SmdgTerminalEntry, UnLocodeEntry,
};
pub use xtdb_bitemporal::{
    compare_branches, default_desk_snapshot_path, load_desk_snapshot, save_desk_snapshot,
    BitemporalEvent, BranchComparison, BranchId, PinnedDossier, XtdbDeskStateSnapshot,
};
