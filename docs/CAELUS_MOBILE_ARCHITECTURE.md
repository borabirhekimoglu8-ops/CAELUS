# CAELUS Mobile — Architecture

CAELUS Mobile turns the deterministic causal engine into a native,
offline-first iPhone/iPad product.  The simulation engine, signature
verification, neural inference, audit chain, persistence, and report
generation all execute on the device.  There is no server, no account, no
telemetry, and no WebView; the mobile app is a full CAELUS node, not a
remote control.

This document describes what is implemented and how it fits together.  The
companion migration report (`CAELUS_MOBILE_MIGRATION_REPORT.md`) records
the phase-by-phase status, limitations, and exact commands.

## 1. Layering

```
┌─────────────────────────────────────────────────────────────┐
│  SwiftUI app (platforms/ios/App + CAELUSMobileUI)           │
│  iPhone TabView shell · iPad NavigationSplitView shell      │
│  Command Center · Causal Map · Levers · Neural · Audit ·    │
│  History · Reports · Settings · Diagnostics                 │
├─────────────────────────────────────────────────────────────┤
│  CAELUSMobileCore (Swift, platform-independent)             │
│  EngineController actor · snapshot DTOs · checkpoint store  │
│  scenario/model library · security policy · report builder  │
│  map layout · audit browser · key-protection registry       │
├─────────────────────────────────────────────────────────────┤
│  Stable C ABI  (include/mobile/caelus_mobile.h, v1)         │
│  src/mobile/caelus_mobile_bridge.cpp                        │
├──────────────────────────────┬──────────────────────────────┤
│  Shared C++ causal engine    │  Shared Rust components      │
│  include/causal_engine.h     │  audit chain (Blake3),       │
│  scenario_pack.h, neural_*   │  ed25519 identity + seals,   │
│  (same sources as desktop)   │  deterministic neural runtime│
└──────────────────────────────┴──────────────────────────────┘
```

Rules enforced by construction:

- Swift never touches C++ classes or Rust structs; everything crosses the
  versioned C ABI.
- There is exactly one engine implementation.  The mobile bridge compiles
  the same headers the desktop binary compiles; the audited neural tick
  sequence is shared through `include/neural_tick_runner.h`, so desktop
  and mobile hosts cannot drift.
- The engine is never rewritten in Swift.  Swift-side logic is limited to
  presentation derivations (summaries, layout, formatting) that are
  unit-tested on Linux against real engine output.

## 2. Stable C ABI (v1)

`include/mobile/caelus_mobile.h` defines the complete mobile surface:

- Opaque handle (`CaelusMobileEngine`), fixed-width integers, explicit
  buffer lengths, explicit status codes (`CAELUS_MOBILE_OK`,
  `E_INVALID_ARGUMENT`, `E_ABI_MISMATCH`, `E_SCENARIO_REJECTED`,
  `E_MODEL_REJECTED`, `E_LIFECYCLE`, `E_BUSY`, `E_AUDIT_FAILURE`, …).
- No exceptions or Rust panics cross the boundary (`guarded()` wrapper +
  liveness registry); no C++ standard-library types in signatures.
- Two-call buffer pattern for every variable-size output (probe with
  NULL → `E_BUFFER_TOO_SMALL` + exact size → fetch).
- Handle lifecycle: create → load scenario → (optional) load neural model
  → tick/apply-lever/snapshot/checkpoint → seal → destroy.  Misuse is a
  typed `E_LIFECYCLE` error, never UB.  A global liveness registry makes
  double-destroy and use-after-destroy deterministic failures.
- Stateless helpers: `blake3`, model-signature verification against the
  compiled-in anchor, and `trusted_anchors_json` so the UI renders the
  exact public keys the binary enforces.
- Platform key protection: `caelus_mobile_register_key_protection_v1`
  registers protect/unprotect callbacks; the Rust identity layer wraps
  the device identity seed through them (Keychain-held AES-GCM key on
  iOS).  Raw private keys never surface into Swift.

Host-side coverage: `tests/test_mobile_bridge.cpp` (20 cases / 407
assertions) exercises NULLs, invalid lengths, buffer sizing, tamper
rejection, determinism, checkpoint corruption, audit seal, `E_BUSY`
concurrency, and ABI version mismatch against the real Rust staticlib.

## 3. Build strategy

| Artifact | Script | Output |
|---|---|---|
| iOS XCFramework (device + simulator) | `tools/build_ios_core.sh` (macOS + Xcode + rustup) | `dist/ios/CaelusCore.xcframework` + SHA-256 manifest |
| Linux host archives for Swift tests | `tools/build_host_bridge.sh [--with-tests]` | `dist/host/libcaelus_host_bridge.a`, `libcaelus_network.a` |
| Desktop binary (unchanged) | `build.sh` / `build.bat` | `dist/caelus_os` |

Details:

- Rust staticlib cross-compiles for `aarch64-apple-ios`,
  `aarch64-apple-ios-sim`, `x86_64-apple-ios`; on Apple targets the
  `blake3` crate uses its pure-Rust backend (`Cargo.toml` target-specific
  feature) so no Apple C cross-toolchain is needed for the Rust side.
- The C++ bridge builds per-slice with `xcrun clang++ -std=c++17`; the
  script merges Rust + C++ into one static library per slice, verifies
  all exported ABI symbols, builds the XCFramework, and emits checksums.
- The SwiftPM package (`platforms/ios/CAELUSMobile/Package.swift`) adds
  no linker flags on Apple platforms (Xcode links the XCFramework); on
  Linux the test and demo targets link `dist/host` so XCTest runs against
  the real native core.

## 4. SwiftUI application

`platforms/ios/App` is a thin `@main` target plus an XcodeGen spec
(`project.yml`).  Every feature lives in the Swift package:

- `CAELUSMobileCore` (no SwiftUI, Linux-tested):
  - `EngineController` — actor owning one native session; serialises all
    ABI calls; maps status codes to typed `CaelusMobileError`s.
  - `EngineSnapshot` — Codable DTOs of `CAELUS_MOBILE_SNAPSHOT_V1`
    (nodes/edges/levers/hysteresis/loops/scenario/neural/audit).
  - `CheckpointStore` — atomic (POSIX `rename`) versioned checkpoint
    persistence with retention and iOS file protection.
  - `ScenarioStore` — sanitized, size-capped library of imported
    scenario/model packages (bytes stay untrusted until engine
    verification).
  - `SecurityPolicy` + `CriticalActionGate` — which actions require
    user-intent confirmation; fail-closed `DenyAllAuthorizer` default.
  - `KeyProtectionRegistry` + `KeychainKeyProtection` — CryptoKit AES-GCM
    wrap of the identity seed, wrapping key in the Keychain
    (`AfterFirstUnlockThisDeviceOnly`).
  - `CommandCenterBuilder`, `CausalMapLayoutBuilder`, `AuditBrowser`,
    `ExecutiveReportBuilder` — pure presentation derivations.
- `CAELUSMobileUI` (SwiftUI, compiled on Apple platforms only):
  - iPhone shell: five tabs (Command, Map, Levers, Neural, More).
  - iPad shell: three-column `NavigationSplitView` with the causal map as
    the persistent detail column.
  - `AppModel` — sandbox layout, boot, restore-on-launch, imports,
    policy persistence.  `SessionViewModel` — live snapshot/audit state,
    auto-advance, checkpoint triggers, gated lever application.
  - Scene-phase integration: background → audited `APP_LIFECYCLE` event +
    checkpoint; foreground → audited event + refresh.

## 5. Neural architecture on mobile

Two modes, strictly separated, both behind the shared Neural Gate:

1. **Deterministic assurance (implemented end-to-end).**  The signed
   INT8/INT64 fixed-point runtime compiled into the core (identical C++
   and Rust implementations, differential-tested).  Same model package
   format, same ed25519 anchor, same gate policy as desktop.  This is the
   default neural mode of CAELUS Mobile and is exercised by the mobile
   BS-01 demo and the Swift test suite on Linux.
2. **Core ML advisory (scaffolded, disabled by default).**  The ABI's
   stateless `caelus_mobile_verify_model_signature_v1` lets the Swift
   layer verify a signed Core ML package against the pinned neural anchor
   before ever compiling it; advisory outputs would enter the engine only
   through the same bounded-proposal path.  No Core ML model ships in
   this repository and no cross-device bit-determinism is claimed for
   Core ML execution.  Until a signed Core ML package exists the mode is
   absent from the UI (not mocked).

Neural output can never clear the outage latch, bypass deadlines, modify
protected thresholds, override signature policy, or touch audit history —
the authority-commit path re-validates every bounded proposal against the
symbolic invariants before applying it, and every decision is audited.

## 6. Security model

- **Trust anchors** — scenario and neural-model ed25519 public keys are
  compiled into the native core; the Settings screen renders them via
  `trusted_anchors_json` so UI and binary cannot disagree.  Rotation =
  new build (documented, deliberate).
- **Key domains** — scenario signing, neural-model signing, audit seal
  identity, and device identity are separate keys; nothing is reused
  across domains.
- **Device identity** — created on first launch; the seed is wrapped by
  a Keychain-protected key (Secure Enclave hardware-backing is used by
  iOS transparently where available for the Keychain item) and never
  crosses into SwiftUI as raw bytes.
- **User intent** — Face ID / Touch ID / passcode confirmation for
  configurable critical actions (high-impact levers, exports, restores,
  imports, session reset).  Biometrics confirm intent only; signature
  verification is unconditional regardless of policy.
- **File protection** — checkpoints, imported packages, audit segments,
  and the identity file live in Application Support with
  `completeUntilFirstUserAuthentication` protection.
- **No secrets in UserDefaults**; policy JSON contains no key material.

## 7. Persistence and lifecycle

Checkpoints are produced by the native core as versioned, Blake3
integrity-hashed envelopes binding: format + engine version, scenario ID
+ hash, model binding, tick, PRNG state (hex), full graph state,
hysteresis/loop/lever state, outage latch, audit chain head, and session
identity.  The Swift `CheckpointStore` adds atomic placement, sidecar
metadata, retention, and file protection.  Restore re-verifies scenario
and model signatures, then validates the envelope binding fail-closed
(`CHECKPOINT_RESTORED` audited; neural temporal history restarts with
explicit missing-data masks — re-observed, never fabricated).

Checkpoint triggers: session start, scenario load, lever application,
configurable tick interval, background transition, before export, model
change, manual.

## 8. Audit integration

The append-only Blake3 chain + ed25519 SEAL model is unchanged.  Mobile
adds `APP_LIFECYCLE` (background/foreground/terminating) events plus the
standard SESSION_START/SCENARIO_*/NEURAL_*/LEVER_*/CHECKPOINT_*/
REPORT_EXPORTED/SESSION_END set.  The audit screen shows chain status,
seal latch, session identity, scenario/model hashes, and a browsable
event list, and states the guarantee precisely: tamper-evident, not
deletion-proof — deletion resistance requires exporting to independent
custody.  Exports verify with `tools/verify_audit_log.py` (including
pinned neural-model identity semantics).

## 9. Offline guarantee

The app performs no networking: no sockets are opened by the Swift
layer, the bridge, or the engine in mobile configuration (the desktop
WebSocket War Room emitter is not compiled into the mobile bridge).
Normal operation — scenario load, ticks, neural assurance, levers,
checkpoints, audit, reports — works in airplane mode.  Data leaves the
device only through the user-invoked share sheet.

## 10. Mobile plugin policy

No downloaded native plugins, no dynamic third-party dylibs, no remote
code, no JIT.  Built-in modules are compiled into the app (deterministic
solver, scenario loader, neural observer, reporters, exporters).  Signed
scenarios and neural models are pure data, verified before use.  The
desktop native-plugin ABI is not part of the mobile bridge or the
XCFramework.

## 11. Testing

| Layer | Location | Runs on |
|---|---|---|
| C ABI bridge (20 cases / 407 asserts) | `tests/test_mobile_bridge.cpp` | Linux/macOS CI |
| Swift core + presentation (42 tests) | `platforms/ios/CAELUSMobile/Tests` | Linux CI (against real core), macOS |
| Mobile BS-01 end-to-end (25 steps) | `Sources/CaelusMobileDemo` | Linux CI, macOS |
| Audit export verification | `tools/verify_audit_log.py` | Linux CI |
| XCUITest smoke (launch/session/tabs) | `platforms/ios/App/UITests` | macOS + simulator only |
| Desktop suites (unchanged) | `ci.sh` / `ci.bat` | Linux/Windows |

## 12. Exact build commands

Linux (everything except Apple-only steps):

```bash
./ci.sh                                  # full desktop + mobile host CI
tools/build_host_bridge.sh --with-tests  # bridge archives + C++ ABI tests
cd platforms/ios/CAELUSMobile
swift build && swift test                # 42 tests vs real native core
swift run caelus-mobile-demo             # BS-01 mobile end-to-end
```

macOS (Apple-only steps; Xcode 15+, rustup targets
`aarch64-apple-ios{,-sim}`, optionally `x86_64-apple-ios`):

```bash
tools/build_ios_core.sh                  # dist/ios/CaelusCore.xcframework
brew install xcodegen
cd platforms/ios/App && xcodegen generate
xcodebuild -project CAELUSMobile.xcodeproj \
    -scheme CAELUSMobileApp \
    -destination 'platform=iOS Simulator,name=iPhone 15' \
    build test
```
