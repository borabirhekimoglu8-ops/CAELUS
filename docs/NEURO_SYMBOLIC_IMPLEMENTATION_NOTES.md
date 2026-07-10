# CAELUS Neuro-Symbolic Runtime — Implementation Notes

This is the engineering decision log for the implemented neural layer.  It is
not a claim of operational certification or real-world predictive accuracy.

## Baseline (2026-07-10)

- Toolchain: Rust/Cargo 1.83.0, GCC 13.3.0, C++17.
- Active tests before neural changes: root Rust 25, `caelus_core` 17
  (`1` exhaustive test intentionally ignored), C++ 19 cases / 94 assertions.
- Linux production binary: 3,795 KiB.
- Baseline CI stopped at the external audit verifier because the Python
  `blake3` package was missing.  All preceding tests and the production build
  passed.  Existing warnings: one platform-specific unused Rust constant, one
  unnecessary `mut`, and the documented static-glibc linker warnings.
- No neural model, neural runtime, ONNX runtime, training pipeline, or WASM
  target existed.  The existing “neuro-symbolic” label was therefore ahead of
  the implementation.

## Phase 1 — Contract and data model

Decision:

- Introduce a dedicated `CAELUS_NEURAL_ABI_V1` data contract; do not extend or
  overload the executable native plugin ABI.
- Use only fixed-width integers and fixed-point scale `1,000,000` across the
  production neural boundary.
- Keep neural estimates in separate output structures.  The contract exposes
  no direct writable reference to `Node::state_fp`, outage latch, deadline, or
  hysteresis state.
- Bound V1 to 64 nodes, 256 edges, 64 levers, 8 history ticks, 16 normalized
  node features, and hidden width 32.  Larger/incompatible inputs are rejected,
  not truncated.
- Missing values use an explicit bit mask.  Zero never silently means
  “missing”.
- Range validators reject malformed inputs/outputs; they do not silently clamp
  neural values.
- The pointer-bearing C structure is an in-process, same-target ABI view, not a
  persisted or network wire format.  The caller owns arrays for the complete
  inference call; `input_ranges_valid` validates every non-empty span before
  any dereference.  Persisted model data uses a separately specified byte
  format.
- V1 allows at most one trust proposal per node.  Validation applies the
  trusted policy limit and checks the resulting trust value before acceptance,
  preventing many individually bounded proposals from accumulating past the
  policy.

Locations:

- C++ contract: `include/neural_contract.h`
- no_std Rust mirror: `caelus_core/src/neural_contract.rs`
- Regression tests: `tests/test_causal_engine.cpp` and Rust module tests
