# CAELUS NCM-3 Mobile

iPhone-first, fully local, evidence-bound causal reasoning runtime.

- **No LLM and no cloud inference:** the answer path runs in the browser and can operate without a network connection.
- **NCM-3 evidence ledger:** every visible claim is classified as an input fact, deterministic calculation, local-rule deduction, explicit unknown, or safety boundary.
- **Fail-closed Truth Gate:** an unsupported prompt does not receive a fabricated sector, causal chain, action, live fact, or probability. The engine instead lists the inputs needed for a grounded answer.
- **Deterministic local solvers:** unit-aware power/energy, constant-flow reserve, discrete cash-flow, inventory, queue, invoice, and sensor-conflict calculations are backed by local knowledge packs. Causal attribution, counterfactual sufficiency, cyber evidence, clinical safety, live-data, and maritime continuity rules are also bounded by explicit evidence.
- **Advisory neural router:** the small local semantic encoder can propose routing features, but it is not a factual source and does not generate the final answer.
- **Explicit authority boundary:** the NCM-3 evidence reasoner owns the visible answer and exact arithmetic; Rust/WebAssembly validates the ScenarioPack schema and owns only package/state execution. The advisory encoder is never a factual source.
- **Mobile and offline-first:** safe-area layout, touch-sized controls, evidence ledger, update-safe PWA cache, local assets, and no remote runtime dependency.

Live production: https://caelus-universal-war-room.borabirhekimoglu8.chatgpt.site

## Verify

```bash
npm run install:ci
npm run build
npm run lint
node --test tests/ncm3-truth.test.mjs tests/ncm3-integration.test.mjs tests/rendered-html.test.mjs
```

## Truth boundary

Deterministic means repeatable; it does not by itself mean correct. CAELUS can make an exact claim only when the user input and a matching local knowledge pack support that claim. It deliberately abstains outside that closed-world scope. In particular, an offline build cannot know current vessel, weather, market, or operational state unless a time-stamped local source is supplied.

CAELUS is not AGI and does not contain universal world knowledge. Broader offline coverage requires reviewed, versioned local knowledge packs and representative validation data. The semantic observer remains advisory; the evidence reasoner owns answer claims, while the Rust/WASM kernel is the ScenarioPack and state validator.
