# CAELUS Mobile — Migration Report

Status record of the desktop→mobile conversion: what was done, in which
order, what is proven by which test, and what remains blocked on Apple
tooling.  Statuses are exactly one of **complete**, **partial**,
**blocked** — nothing blocked is reported as passed.

## 1. Baseline (before the mobile work)

- Desktop-oriented C++17 engine + Rust workspace; browser War Room over a
  local WebSocket; Linux/Windows builds; no mobile code of any kind.
- Toolchain: Rust/Cargo 1.83, GCC 13.3, Python 3.12; Swift not present.
- Suites: root Rust tests, `caelus_core` tests, C++ unit tests, golden
  matrix, C++↔Rust differentials, BS-01 neural demo, security negatives,
  audit verification — all green via `./ci.sh`.
- Linux production binary ~3.8 MiB.

## 2. What was built, in commit order

1. **Shared-core enablers** (`feat(core)`): `EngineStateV1`
   export/restore on `CausalEngine`; `ScenarioPack.load_from_memory`;
   `NeuralModelLoader.load_from_memory`; shared audited neural tick
   runner (`include/neural_tick_runner.h`) so desktop and mobile hosts
   run the identical sequence; Rust `caelus_keymgmt_register` FFI for
   OS-native key protection.
2. **Stable mobile C ABI** (`feat(mobile)`):
   `include/mobile/caelus_mobile.h` + `src/mobile/caelus_mobile_bridge.cpp`
   — versioned, opaque-handle, fail-closed bridge over engine, scenario,
   neural, checkpoint, audit, identity; 20-case host test suite.
3. **Apple target support** (`build(ios)`): `tools/build_ios_core.sh`
   (Rust staticlib per Apple slice, pure-Rust Blake3 on Apple targets,
   C++ bridge per slice, symbol audit, XCFramework, checksums).
4. **Host bridge for Linux CI** (`feat(mobile)`):
   `tools/build_host_bridge.sh` + compiled-in trust-anchor export ABI.
5. **Swift core module** (`feat(mobile)`): EngineController actor, DTOs,
   checkpoint store, scenario/model library, security policy + gate,
   Keychain key protection, session restorer, report builder — 42 XCTest
   cases running on Linux against the real native core, plus the 25-step
   BS-01 mobile demo executable.
6. **SwiftUI application** (`feat(mobile)`): iPhone/iPad shells, all
   twelve feature screens, XcodeGen app project, XCUITest smoke suite.
7. **CI + documentation** (this change): mobile stages in `ci.sh`,
   architecture + migration docs.

## 3. Requirement matrix

| # | Requirement | Status | Implementation | Proof (test) | Remaining limitation |
|---|---|---|---|---|---|
| 1 | Native SwiftUI iPhone app | partial | `platforms/ios/App`, `CAELUSMobileUI` (tabs, 12 screens) | Swift package builds on Linux; view logic derivations unit-tested (`CoreLogicTests`, `PresentationTests`) | SwiftUI view code compiles only on Apple platforms; Xcode build/UI run not executed in this Linux environment |
| 2 | Native adaptive iPad interface | partial | `RegularWidthShell` (three-column split view, persistent causal map) | same as #1 | same as #1 |
| 3 | Real C++ engine inside the app | complete | XCFramework packaging of the same `include/` sources; no fork | `tests/test_mobile_bridge.cpp` (real engine); `EngineControllerTests` on Linux | — |
| 4 | Rust security/audit inside the app | complete | Rust staticlib in every slice; audit/identity/verification via FFI | bridge tests: audit chain, seal, tamper rejection | — |
| 5 | No desktop companion required | complete | all operations through the embedded core | 25-step demo runs with no desktop binary | — |
| 6 | Signed scenarios load locally | complete | `load_from_memory` + pinned anchor | `testScenarioLoadsAndSnapshotDecodes`; demo step 4 | — |
| 7 | Invalid scenarios rejected | complete | ed25519 over canonical critical fields | `testTamperedScenarioIsRejectedWithTypedError` (signed-region tamper); bridge tamper tests; demo step 5 | — |
| 8 | Signed neural models load locally | complete | model package verification vs pinned neural anchor | `testNeuralModelLoadsAndGateRuns`; demo step 8 | — |
| 9 | Invalid neural models rejected | complete | manifest/hash/signature checks, fail-closed | bridge model-tamper tests; demo step 9 | — |
| 10 | Deterministic ticks locally | complete | same fixed-point engine | `testDeterministicReplayProducesIdenticalSnapshots`; bridge determinism test | — |
| 11 | Levers execute locally | complete | `caelus_mobile_apply_lever_v1` | lever tests + demo step 17 | — |
| 12 | Outage latch/recovery locally | complete | shared engine logic | golden + demo state transitions | — |
| 13 | Neural advisory locally (Core ML) | blocked (scaffolding complete) | signature gate for Core ML packages via stateless ABI verify; advisory mode absent from UI until a signed package exists | signature helper tested (`testModelSignatureHelper…`, bridge crypto tests) | no Core ML model in repo; Core ML runtime integration requires macOS/Xcode; deliberately NOT mocked |
| 14 | Deterministic neural assurance locally | complete | fixed-point INT8/INT64 runtime in core (C++↔Rust differential-tested) | neural differential; demo steps 8–16 through the mobile stack | — |
| 15 | Neural outputs through the Neural Gate | complete | shared `neural_tick_runner.h` used by the bridge | gate decisions in demo audit export; `testNeuralModelLoadsAndGateRuns` | — |
| 16 | Symbolic-only fallback works | complete | sessions without model; gate fallback path | symbolic-only Swift tests; desktop fallback suite | — |
| 17 | Checkpoint/restore correct | complete | native envelope + `CheckpointStore` + `SessionRestorer` | checkpoint round-trip, corruption, binding-mismatch tests; demo steps 19–22 | neural temporal history restarts with missing-data masks after restore (designed, documented) |
| 18 | Audit events hash-chained | complete | shared Blake3 chain + mobile `APP_LIFECYCLE` events | `testAuditSurfaceAndLifecycleNotes`; verifier run in CI | — |
| 19 | Session seals produced/verified | complete | `caelus_mobile_seal_session_v1` + ed25519 seal | seal tests; `verify_audit_log.py` on demo export | — |
| 20 | Reports via iOS share sheet | partial | `ReportsView` ShareLink (report/snapshot/audit); deterministic builder | report determinism tested on Linux | share-sheet interaction itself requires a device/simulator run |
| 21 | Airplane-mode operation | complete | no networking in bridge/engine/UI data flows | bridge include audit (no sockets); demo runs in offline sandbox | claim re-verifiable on device via Instruments network profile |
| 22 | No downloaded native plugin execution | complete | mobile policy: built-ins only; plugin loader not in bridge/XCFramework | XCFramework symbol audit; policy documented | — |
| 23 | Desktop core tests keep passing | complete | no divergent fork; shared headers | full `./ci.sh` green (see §5) | — |
| 24 | C++↔Rust deterministic tests keep passing | complete | untouched differential suites | `run_neural_differential.py`, REPL differential in CI | — |
| 25 | Reproducible mobile build instructions | complete | architecture doc §12; scripts pin targets and verify symbols | `build_host_bridge.sh` in CI; `build_ios_core.sh` structure-checked | `build_ios_core.sh` end-to-end run requires macOS |
| 26 | No critical feature mocked | complete | Core ML advisory intentionally absent rather than mocked; all shipped paths hit the real core | Linux tests run against the real staticlib, not stubs | — |
| 27 | Docs distinguish complete/partial/blocked | complete | this report | — | — |

## 4. iOS-blocked validations (exact commands)

This environment is Linux; anything requiring Xcode was implemented and
structure-verified but **not executed**.  Run on macOS (Xcode 15+):

```bash
# 1. Native core for Apple targets (device + simulator slices,
#    symbol audit, XCFramework, SHA-256 manifest):
tools/build_ios_core.sh

# 2. Generate + build + test the app project:
brew install xcodegen
cd platforms/ios/App
xcodegen generate
xcodebuild -project CAELUSMobile.xcodeproj -scheme CAELUSMobileApp \
    -destination 'platform=iOS Simulator,name=iPhone 15' build test

# 3. Swift package tests on macOS (same tests that pass on Linux):
cd ../CAELUSMobile && swift test
```

Not validated on-device (therefore not claimed): SwiftUI rendering,
Face ID prompts, Keychain/Secure Enclave behaviour, share-sheet flows,
Core ML execution, Dynamic Type/VoiceOver audits, performance numbers on
Apple hardware.

## 5. Verification state on Linux (executed)

- `./ci.sh` — full desktop suite + mobile stages (host bridge + C++ ABI
  tests, Swift build + 42 tests, BS-01 mobile demo, demo audit
  verification with pinned neural identity).
- C ABI bridge: 20 doctest cases / 407 assertions.
- Swift: 42 XCTest cases against the real native core.
- Mobile demo: 25 steps, sealed audit export verified by
  `tools/verify_audit_log.py`.

## 6. Known limitations and risks

1. **Apple-platform compilation of the SwiftUI layer is unverified
   here.**  The `#if os(iOS)` UI sources are lexed but not type-checked
   on Linux.  Mitigations: standard-API-only SwiftUI, all state logic
   pushed into the Linux-tested core module.  First `xcodebuild` run may
   surface mechanical fixes.
2. **Core ML advisory mode ships as scaffolding only** (signature gate +
   mode taxonomy + UI labelling).  Enabling it requires producing and
   signing a Core ML package and an Xcode integration pass; until then
   the app runs deterministic assurance or symbolic-only.
3. **Neural history after restore** is re-observed with explicit
   missing-data masks rather than persisted — deterministic and honest,
   but neural outputs immediately after restore can differ from an
   uninterrupted run (symbolic state is bit-exact; asserted by tests).
4. **Audit deletion resistance** is not claimed: local chains are
   tamper-evident; deletion resistance requires exported custody.
5. **Key rotation** for compiled-in anchors means shipping a new build;
   there is no runtime trust-store mutation by design (smaller attack
   surface on mobile).
6. **Performance numbers on Apple hardware are not published** — only
   Linux-host figures exist (BS-01 tick ≪ 1 ms through the full Swift →
   C ABI → core stack; demo end-to-end < 1 s).  Device measurements are
   part of the macOS validation pass.
