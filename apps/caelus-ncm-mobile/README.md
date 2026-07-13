# CAELUS NCM Mobile

iPhone-first, fully local neurocausal scenario engine.

- **No LLM and no cloud inference:** all interpretation and forecasting run in the browser.
- **NCM-2 temporal observer:** deterministic frame parsing, typed semantic graphs, negation and duration handling, cross-domain causal links, and fixed-point temporal message passing.
- **Neural Gate:** advisory relations are admitted only after evidence, polarity, lag, confidence, acyclicity, and deterministic-budget checks.
- **Rust/WASM authority:** the observer proposes; the deterministic Rust/WebAssembly core validates and executes the ScenarioPack.
- **Decision depth:** three time horizons, baseline/intervention/worst-case branches, visible assumptions, unknowns, signals, and contextual actions.
- **Mobile and offline-first:** safe-area layout, 44 px touch targets, live ticks, causal graph, PWA service worker, and local assets.

Live production: https://caelus-universal-war-room.borabirhekimoglu8.chatgpt.site

## Verify

```bash
npm ci
npm run build
npm run lint
```

The engine is deterministic and cross-sector, but it is not a general-purpose language model or AGI. Its observer remains advisory and the symbolic Rust/WASM kernel remains the final authority.
