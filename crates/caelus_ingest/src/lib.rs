#![deny(unsafe_code)]

pub mod feeds;
pub mod mmap_ring;

pub use feeds::{
    collect_ingest_snapshot, default_ring_path, load_or_init_offline_ring, FeedDescriptor, FeedKind,
};
pub use mmap_ring::{
    read_ring_zero_copy, write_ring_snapshot, ArchivedIngestSnapshot, IngestPin, MmapRingView,
};
