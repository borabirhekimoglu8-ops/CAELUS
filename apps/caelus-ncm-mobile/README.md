# CAELUS NCM Mobile

iPhone-first, fully local neuro-causal CAELUS application.

- **No LLM and no cloud inference:** the trained NCM-1.1 model runs in the browser.
- **Real neural model:** 144 semantic-hash inputs, 48 tanh hidden units and multi-task heads for sector, node state, graph edges, interventions and temporal dynamics.
- **Real CAELUS core:** generated ScenarioPacks are validated and executed by the Rust/WebAssembly engine.
- **Live and offline-first:** deterministic ticks, causal graph, intervention lockouts, PWA service worker and iPhone safe-area layout.

Live production: https://caelus-universal-war-room.borabirhekimoglu8.chatgpt.site

## Verify

```bash
npm ci
npm run build
npm run lint
```

Retrain deterministic local weights with:

```bash
node scripts/train-neurocausal.mjs
```

The model is compact and domain-bounded; it is a real on-device neural inference system, not a general-purpose language model.
