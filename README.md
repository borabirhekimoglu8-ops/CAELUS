# CAELUS OS (Pure-Rust Edition)

**100% Pure Rust, offline-first, deterministic maritime/air/space command & Living Global Atlas system with Zero-WDDM software rasterization (`winit + softbuffer + tiny-skia`), zero WebView, zero JavaScript/TypeScript, and zero Python runtime layers.**

`caelus_core` enforces `#![forbid(unsafe_code)]` and `#![deny(clippy::unwrap_used, clippy::expect_used, clippy::panic)]`, isolating the deterministic decision engine from the software-rasterized cartographic shell, the Living Atlas zero-copy `rkyv + memmap2` store, MCP bridges, and the zero-GPU terminal UI.

## Workspace Architecture (`Cargo.toml`)

| Crate | Role | Key Dependencies |
|---|---|---|
| `crates/caelus_core` | Synchronous & headless decision core: CfC cell, Active Inference EFE planner, P-bit Ising annealer, E-Graph, Darwinian evolver, HAL estimator, `RingBuffer<T, 256>`, `HeadlessCoreHandle`, pure-std Ed25519 + SHA-512, 4-Gate Vessel-to-Route Matcher, and telemetry parsers | **Zero external dependencies (`std` only)** |
| `crates/caelus_ingest` | 17-feed live & offline cached telemetry ingestor with 64-byte aligned `rkyv + memmap2` ring buffer | `caelus_core`, `memmap2`, `reqwest`, `rkyv`, `serde`, `serde_json` |
| `crates/caelus_graph` | XTDB bitemporal comparison, Pure-Rust `oxigraph` RDF/SPARQL store, and streaming UN/LOCODE + SMDG index | `caelus_core`, `oxigraph`, `rkyv`, `serde`, `serde_json` |
| `crates/caelus_mcp` | `rmcp` bridge, 7-connector registry, One-Way Glass Wall `Z3` policy gate, and Proof-to-Prose DNV/EMSA handover | `caelus_core`, `caelus_graph`, `rmcp`, `serde`, `serde_json` |
| `crates/caelus_atlas` | Living Global Maritime Database (`100k+` vessels, `110k+` ports, `60k+` IACS records): sharded `rkyv + memmap2` store, `< 1 ms` `LEAP` lookup, `Oxigraph` SPO, `XTDB` bitemporal log, `O(Delta)` sync, and `caelus-atlas-sync` / `caelus-mcp-atlas` binaries | `caelus_core`, `memmap2`, `oxigraph`, `reqwest`, `rkyv`, `rmcp`, `serde`, `serde_json` |
| `crates/caelus_daemon` | Headless zero-GPU decision daemon (`--headless --ticks N`) + Sentinel + Ingest Ring sync | `caelus_core`, `caelus_ingest` |
| `crates/caelus_ui` | Zero-WDDM software-rasterized spatial shell (`winit + softbuffer + tiny-skia + usvg/resvg`), Warm Swiss Cartography, `Ctrl+K` / `/` `LEAP`, 8-way Radial Menu, and `XTDB` dual-clock dial | `caelus_atlas`, `caelus_core`, `caelus_ingest`, `caelus_graph`, `caelus_mcp`, `winit`, `softbuffer`, `tiny-skia`, `usvg`, `resvg`, `rayon` |
| `crates/caelus_tui` | Zero-GPU Field & SSH terminal UI (`--once` snapshot or interactive) | `caelus_core`, `ratatui`, `crossterm` |

## Build, Verify & Run

```powershell
cargo fmt --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace --locked
cargo build --workspace --release --locked

# Launch Zero-WDDM Desktop Shell
cargo run -p caelus_ui --release --locked

# Headless smoke & CLI runners
cargo run -p caelus_ui --release --locked -- --smoke-test
cargo run -p caelus_daemon --release --locked -- --headless --ticks 4 --pier-b
cargo run -p caelus_tui --release --locked -- --once
```
