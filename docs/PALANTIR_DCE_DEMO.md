# CAELUS DCE — Technical Evaluation Demo Contract

CAELUS DCE is presented as a deterministic causal simulation kernel for
auditable pre-action simulation beneath AI agents and digital twins.

## Demo framing

- **Kernel claim:** fixed-point causal propagation, deterministic ticks, signed
  scenario packs, and sealed audit logs.
- **Operator claim:** every proposed action can be replayed before execution and
  compared across the C++ and Rust/no_std engines.
- **Forensics claim:** each run produces a Blake3 hash chain with an ed25519 SEAL;
  verification must include chain integrity, seal signature, fingerprint, and
  optional trusted seal public-key pin.

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
  signature gate logs.
- Simulated: War Room ticker text, scenario prose, UI briefing copy.

Do not imply simulated UI copy is live field telemetry unless it is emitted by
the engine/audit path.

## Evaluation commands

```bash
CAELUS_PRODUCTION=1 ./build.sh
python3 tools/verify_audit_log.py caelus_audit_0000000000000000.log
python3 tests/run_bs_exec_golden.py --binary dist/caelus_os
python3 tests/run_bs_exec_golden.py \
  --binary caelus_core/target/release/caelus_core_repl \
  --reference-binary dist/caelus_os
```

## Signing-key policy

Private signing seeds are not repository artifacts. Only public trust anchors
and signed scenario packs should be committed. Rotating the trust anchor
requires an offline key ceremony, scenario/plugin re-signing, and golden refresh.
