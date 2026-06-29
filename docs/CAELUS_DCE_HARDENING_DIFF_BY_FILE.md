# CAELUS DCE Hardening Diff Summary by File

This document summarizes the full hardening diff file by file. For each changed
file it records:

1. what changed
2. why it changed
3. whether it affects determinism/security/build/demo/docs
4. which test covers it
5. any remaining risk

---

## `.gitignore`

1. **What changed**
   - Added ignores for:
     - `target/`
     - `caelus_core/target/`
     - logs/temp files
     - `dist/caelus_os`
     - `tools/caelus_signing.key`

2. **Why**
   - Prevent build artifacts and private signing material from being committed.

3. **Affects**
   - Security
   - Build hygiene

4. **Covered by**
   - `git status --short`
   - Local secret/string scan

5. **Remaining risk**
   - Historical commits may still contain the old signing key.

---

## `CMakeLists.txt`

1. **What changed**
   - Added `CAELUS_PRODUCTION` CMake option.
   - Added root include path.
   - Added production-mode compile definition.
   - Added production-mode summary output.

2. **Why**
   - CMake/IDE builds must not silently ship dev bypasses.
   - Linux/CMake builds needed root-relative includes.

3. **Affects**
   - Build
   - Security

4. **Covered by**
   - `CAELUS_PRODUCTION=1 ./build.sh`
   - Production bypass string scan

5. **Remaining risk**
   - CMake path itself was not fully built in final validation; build.sh path was validated.

---

## `Cargo.lock`

1. **What changed**
   - Pinned transitive dependencies:
     - `base64ct` downgraded to `1.6.0`
     - `blake3` downgraded to `1.8.2`
     - compatible `constant_time_eq`/`cpufeatures` resolution

2. **Why**
   - Current cloud Rust toolchain is Rust/Cargo 1.83.
   - Newer transitive versions require Rust edition 2024 / Rust 1.85+.

3. **Affects**
   - Build
   - Linux readiness

4. **Covered by**
   - `cargo test`
   - `CAELUS_PRODUCTION=1 ./build.sh`
   - `./ci.sh`

5. **Remaining risk**
   - When toolchain moves to Rust 1.85+, pins can be revisited.

---

## `build.sh`

1. **What changed**
   - Added `CAELUS_PRODUCTION=1` support.
   - Passes `-DCAELUS_PRODUCTION`.
   - Passes `-DCAELUS_EMBEDDED_UI=1`.
   - Adds repo root include path.
   - Fixes Linux linker args using bash array.
   - Hard-fails binary size over 50 MB.

2. **Why**
   - Linux production builds previously retained dev bypasses and failed on include/link issues.

3. **Affects**
   - Build
   - Security
   - Demo readiness

4. **Covered by**
   - `CAELUS_PRODUCTION=1 ./build.sh`
   - `./ci.sh`
   - Production bypass string scan

5. **Remaining risk**
   - Static glibc link emits warnings for `getaddrinfo`, `getpwuid_r`, `dlopen`.

---

## `caelus_core/src/bin/caelus_core_repl.rs`

1. **What changed**
   - Added `throughput_ratio_fp` to JSON snapshots.
   - Added `--json-stdout`.
   - Supports prefixless JSON output.
   - Keeps `[REPL_JSON]` compatibility by default.

2. **Why**
   - Rust harness must match C++ JSON surface for live differential tests.
   - Fixed-point throughput is needed for deterministic comparison.

3. **Affects**
   - Determinism
   - JSON readiness
   - Rust/C++ equivalence

4. **Covered by**
   - `cargo test --manifest-path caelus_core/Cargo.toml --features std`
   - `tests/run_bs_exec_golden.py --binary caelus_core/... --reference-binary dist/caelus_os`
   - `./ci.sh`

5. **Remaining risk**
   - Rust harness still does not perform scenario signature verification; it is engine-equivalence only.

---

## `caelus_core/src/engine.rs`

1. **What changed**
   - `remaining_lockout` now decays per tick.
   - `cost_ticks` now creates cooldown.
   - Added `throughput_ratio_fp`.
   - `throughput_ratio` derives from fixed-point ratio.
   - Added `inject_intel_fp`.
   - Removed unsafe/wrapping tick cast behavior.
   - Added safe absolute-difference logic.
   - Updated tests for lockout/cost behavior.

2. **Why**
   - Rust engine must mirror corrected C++ semantics.
   - Fixes determinism and behavior correctness risks.

3. **Affects**
   - Determinism
   - Rust/C++ equivalence
   - Fixed-point correctness

4. **Covered by**
   - Rust unit tests
   - Invariant sweep
   - Rust↔C++ live differential
   - `./ci.sh`

5. **Remaining risk**
   - Behavior changed versus old golden semantics; downstream consumers relying on permanent lockout must update.

---

## `caelus_core/src/lib.rs`

1. **What changed**
   - Updated fidelity contract comments.
   - Removed references to preserving old `remaining_lockout` and tick-cast bugs.

2. **Why**
   - Documentation needed to match corrected engine semantics.

3. **Affects**
   - Docs
   - Determinism contract

4. **Covered by**
   - Review
   - Rust/C++ differential tests indirectly validate the stated contract.

5. **Remaining risk**
   - None significant; comment-only.

---

## `caelus_core/tests/invariant_sweep.rs`

1. **What changed**
   - Updated throughput invariant to check `throughput_ratio_fp`.
   - `throughput_ratio` expected value now comes from fixed-point ratio.

2. **Why**
   - Old invariant expected raw double division.

3. **Affects**
   - Determinism
   - Test coverage

4. **Covered by**
   - `cargo test --manifest-path caelus_core/Cargo.toml --features std`

5. **Remaining risk**
   - One large exhaustive test remains intentionally ignored.

---

## `caelus_core/tests/narrowed_model.rs`

1. **What changed**
   - Rustfmt-only formatting changes.

2. **Why**
   - `cargo fmt` normalized formatting.

3. **Affects**
   - Test formatting only

4. **Covered by**
   - `cargo test --manifest-path caelus_core/Cargo.toml --features std`

5. **Remaining risk**
   - None.

---

## `ci.bat`

1. **What changed**
   - Added deterministic audit log cleanup.
   - Added audit verifier step.
   - Resets audit log before each determinism run.

2. **Why**
   - Prevent append-only audit logs from making deterministic CI nondeterministic.
   - Ensure audit chain/SEAL verification is part of CI.

3. **Affects**
   - CI
   - Determinism
   - Security

4. **Covered by**
   - Logic mirrored by passing `./ci.sh`
   - Windows batch not run in Linux environment.

5. **Remaining risk**
   - Windows CI path still needs actual Windows execution.

---

## `ci.sh`

1. **What changed**
   - New Linux CI script.
   - Runs:
     - root Rust tests
     - `caelus_core` tests
     - C++ doctest
     - Linux production build
     - production bypass string scan
     - determinism double-run
     - audit verification
     - C++ golden
     - Rust↔C++ live differential

2. **Why**
   - No Linux CI existed.
   - Required for Linux build readiness and technical evaluation credibility.

3. **Affects**
   - Build
   - Security
   - Determinism
   - Rust/C++ equivalence

4. **Covered by**
   - `./ci.sh` passed fully.

5. **Remaining risk**
   - Requires Python `blake3` module installed in environment.

---

## `core_engine.cpp`

1. **What changed**
   - Added `--json-stdout`.
   - Added `throughput_ratio_fp` to JSON.
   - Escaped audit `SESSION_START` and `SESSION_END` strings.
   - Uses `inject_intel_fp` for packet path.
   - Stabilized det-mode audit identity with fixed test `CAELUS_IDENTITY_KEY_HEX`.
   - Removed production help text leak for plugin bypass.
   - Updated signing key comments.

2. **Why**
   - Improve JSON readiness.
   - Remove double from compute path.
   - Make audit chain deterministic in `--det-mode`.
   - Ensure prod binary does not contain dev bypass strings.

3. **Affects**
   - Determinism
   - Security
   - JSON readiness
   - Demo readiness

4. **Covered by**
   - `./ci.sh`
   - Production bypass string scan
   - C++ golden snapshots
   - Rust↔C++ live differential
   - Audit verification

5. **Remaining risk**
   - Fixed test identity is safe for det-mode, but must never be used outside test mode.

---

## `docs/CAELUS_DCE_HARDENING_RAPORU.md`

1. **What changed**
   - Added full Turkish hardening report.

2. **Why**
   - User requested a complete copy/paste-ready file.

3. **Affects**
   - Docs

4. **Covered by**
   - Commit/push verification.

5. **Remaining risk**
   - Must be kept updated if further hardening changes land.

---

## `docs/PALANTIR_DCE_DEMO.md`

1. **What changed**
   - Added technical evaluation demo contract.
   - Defines kernel/operator/forensics claims.
   - Separates verified vs simulated surfaces.
   - Adds evaluation commands and signing-key policy.

2. **Why**
   - Improve Palantir-style technical credibility and demo framing.

3. **Affects**
   - Demo
   - Docs

4. **Covered by**
   - Documentation review.
   - Evaluation commands align with passing CI.

5. **Remaining risk**
   - Demo scenarios are still mostly Turkish/localized; document reframes but does not replace them.

---

## `include/causal_engine.h`

1. **What changed**
   - Added `throughput_ratio_fp`.
   - Added lockout decay in `tick()`.
   - Added `cost_ticks` cooldown behavior.
   - Added `inject_intel_fp`.
   - Fixed safe absolute difference.
   - Removed risky `int32_t` tick comparisons.
   - Throughput now computed with fixed-point division.

2. **Why**
   - Fix determinism/semantic risks in C++ source of truth.

3. **Affects**
   - Determinism
   - Fixed-point correctness
   - Engine behavior

4. **Covered by**
   - C++ doctest
   - C++ golden snapshots
   - Rust↔C++ live differential
   - `./ci.sh`

5. **Remaining risk**
   - Behavior changed for lever timing; scenario expectations were refreshed.

---

## `include/scenario_pack.h`

1. **What changed**
   - Updated key ceremony comments.
   - Private seed is now described as offline/repo-external.

2. **Why**
   - Prevent docs/comments from encouraging committed private key usage.

3. **Affects**
   - Security
   - Docs

4. **Covered by**
   - Local secret/string scan
   - Scenario signature gate still covered by existing tests/golden.

5. **Remaining risk**
   - Actual production key rotation was not performed.

---

## `include/ws_emitter.h`

1. **What changed**
   - Added JSON escape helper.
   - Escaped `scenario_loaded` and `engine_state` strings.
   - Added signature status fields to `scenario_loaded`:
     - `sig_status`
     - `signature_path`

2. **Why**
   - Prevent invalid JSON from scenario/state strings.
   - Let UI/consumers distinguish verified scenario loading.

3. **Affects**
   - Security
   - JSON readiness
   - Demo readiness

4. **Covered by**
   - Compile through `./ci.sh`
   - C++ build/golden indirectly.

5. **Remaining risk**
   - UI visual behavior was not browser-verified.

---

## `src/bin/caelus_sign_scenario.rs`

1. **What changed**
   - Usage examples now reference `/secure/offline/caelus_signing.key`.

2. **Why**
   - Avoid encouraging repo-local private signing key storage.

3. **Affects**
   - Security
   - Docs/help text

4. **Covered by**
   - `cargo test`
   - signer tests

5. **Remaining risk**
   - Real key ceremony and rotation still required for production.

---

## `src/network/mesh_auth.rs`

1. **What changed**
   - Rustfmt-only formatting change.

2. **Why**
   - `cargo fmt` normalized formatting.

3. **Affects**
   - None functionally

4. **Covered by**
   - `cargo test`

5. **Remaining risk**
   - Existing warning remains for Windows-only DPAPI constant on Linux.

---

## `tests/run_bs_exec_golden.py`

1. **What changed**
   - Platform-aware default binary.
   - Accepts prefixless JSON.
   - Added `--reference-binary`.
   - Added live normalized snapshot comparison.
   - Added `throughput_ratio_fp` to normalization.
   - Refreshed expected hashes.

2. **Why**
   - Move from static/indirect equivalence to live C++↔Rust differential validation.

3. **Affects**
   - Determinism
   - Rust/C++ equivalence
   - JSON readiness
   - CI

4. **Covered by**
   - C++ golden run
   - Rust↔C++ live differential
   - `./ci.sh`

5. **Remaining risk**
   - Still compares selected normalized fields, not every possible runtime side effect.

---

## `tests/test_causal_engine.cpp`

1. **What changed**
   - Added tests for:
     - lockout expiry
     - cost tick cooldown
     - fixed-point throughput ratio
   - Updated blank slate assertion for `throughput_ratio_fp`.

2. **Why**
   - C++ test coverage was weaker than Rust.
   - Needed direct coverage for corrected engine semantics.

3. **Affects**
   - Determinism
   - Fixed-point behavior
   - Engine correctness

4. **Covered by**
   - C++ doctest: 12 cases / 69 assertions
   - `./ci.sh`

5. **Remaining risk**
   - C++ still lacks Rust-level randomized invariant sweep.

---

## `tools/caelus_signing.key`

1. **What changed**
   - Deleted from repo.

2. **Why**
   - Private signing seed must not be committed.

3. **Affects**
   - Security

4. **Covered by**
   - Local secret/string scan
   - `.gitignore` prevents re-add.

5. **Remaining risk**
   - Key may still exist in Git history.
   - Production should rotate trust anchor and re-sign artifacts.

---

## `tools/verify_audit_log.py`

1. **What changed**
   - Verifies SEAL fingerprint against pubkey.
   - Added optional `--trusted-pubkey-hex`.
   - Supports appended sealed sessions.
   - Improved SEAL verification call path.

2. **Why**
   - Prior verifier only checked mathematical signature validity.
   - Needed stronger “who sealed this?” verification.

3. **Affects**
   - Security
   - Audit/forensics
   - CI

4. **Covered by**
   - Clean audit verification
   - `./ci.sh`

5. **Remaining risk**
   - Requires Python `blake3` module in environment.
   - Trusted pubkey pin is optional, not mandatory by default.

---

# Overall Remaining Risks

- Historical Git history may still contain the removed private signing key.
- Real production key rotation was not performed.
- Windows `ci.bat` changes were not executed in this Linux environment.
- CMake production path was updated but not fully built in final validation.
- UI changes were not visually browser-tested.
- Audit trusted pubkey pin is optional; operators must supply it for strict identity policy.
- Python `blake3` dependency must be present for audit verification.
