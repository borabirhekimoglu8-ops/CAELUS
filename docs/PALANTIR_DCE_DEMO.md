# CAELUS DCE — Technical Evaluation Demo Contract

CAELUS DCE is presented as a deterministic causal simulation kernel for
auditable pre-action simulation beneath AI agents and digital twins.

## Demo framing

- **Kernel claim:** fixed-point causal propagation, deterministic ticks, signed
  scenario packs, and sealed audit logs.
- **Operator claim:** every proposed action can be replayed before execution and
  compared across the C++ and Rust/no_std engines.
- **Forensics claim:** each run produces a Blake3 hash chain with an ed25519 SEAL;
  verification includes chain integrity, seal signature, and fingerprint. For a
  defensible "who sealed this?" guarantee you MUST also pin the seal public key
  (`--trusted-pubkey-hex`). Without the pin, the verifier only proves the log is
  internally self-consistent — an attacker who re-seals a forged log with their
  own key would still pass. Always run the pinned form in an evaluation; the CI
  (`ci.sh` / `ci.bat`) pins the deterministic det-mode signer by default.

## Domain-neutral scenario position

The bundled BS scenarios are concrete stress packs. For external technical
evaluations, describe them as neutral graph patterns:

| Pack | Neutral pattern | Avoid leading with |
| --- | --- | --- |
| `BS-01_SAHTE_UFUK` | observability attack against a capacity graph | local-language port drama |
| `BS-02_GOLGE_ARSIV` | organizational/knowledge continuity shock | named executive narrative |
| `BS-03_KUM_SAATI` | deadline-driven cascading lockout | geography-specific logistics |

## Verified vs simulated surfaces

- Verified: REPL JSON snapshots, CDET block, golden hashes, audit verification,
  signature gate logs. The `scenario_loaded` event's `sig_status` is the REAL
  gate result (`VERIFIED` only for an ed25519 signature matching the pinned
  trust anchor; `DEV_TRUST_BYPASS` / `SELF_SIGNED_DEV` otherwise) — it is never
  a hardcoded "VERIFIED".
- Simulated: War Room ticker text, scenario prose, UI briefing copy.

Do not imply simulated UI copy is live field telemetry unless it is emitted by
the engine/audit path.

## Evaluation commands

```bash
CAELUS_PRODUCTION=1 ./build.sh

# Audit: ALWAYS pin the seal public key (det-mode signer is deterministic).
python3 tools/verify_audit_log.py caelus_audit_0000000000000000.log \
  --trusted-pubkey-hex acdcc8494d458f44a7aaac1d6a84ec624daee88436db2ae26e67ba645a106228

# Positive path (bit-bit C++ vs Rust equivalence):
python3 tests/run_bs_exec_golden.py --binary dist/caelus_os
python3 tests/run_bs_exec_golden.py \
  --binary caelus_core/target/release/caelus_core_repl \
  --reference-binary dist/caelus_os

# Negative path (must FAIL CLOSED): tampered scenario, dev-signed scenario,
# forged/altered audit log, and wrong seal-key pin are all rejected.
python3 tests/run_security_negative.py --binary dist/caelus_os
```

## Known evaluation-facing limits

- **C++ property testing:** the Rust core has a randomized `invariant_sweep`;
  the C++ engine currently has targeted doctests only (no equivalent fuzz/property
  sweep). C++-specific UB/overflow modes are therefore less exhaustively covered.
- **Static glibc warnings:** the Linux production link emits `getaddrinfo` /
  `getpwuid_r` / `dlopen` "statically linked applications require ... glibc"
  warnings. The binary is effectively glibc-host-coupled; treat "single static
  binary" as "single self-contained binary for a matching glibc host", not as a
  fully portable static executable.
- **UI is not visually verified:** signature/escaping changes are validated at
  the kernel/CLI/CI layer, not by visual UI inspection.

## Signing-key policy

Private signing seeds are not repository artifacts. Only public trust anchors
and signed scenario packs should be committed. Rotating the trust anchor
requires an offline key ceremony, scenario/plugin re-signing, and golden refresh.
