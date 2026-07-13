# CAELUS NCM-3 Mobile

iPhone-first, evidence-bound causal reasoning runtime with local inference and an optional public-source ingestion mesh.

- **No LLM and no cloud inference:** the answer path runs in the browser and can operate without a network connection. Online synchronization only downloads public evidence to the device; it does not send data to an inference service.
- **Open Evidence Mesh:** registered CORS-capable adapters query Turkish/English Wikipedia, Wikidata, Crossref, Europe PMC, and GDELT. A generic URL importer covers additional CORS-readable HTTP(S) sources. One failed adapter does not stop the others.
- **Local Source Vault:** iPhone file upload and drag/drop support XLSX, CSV, TSV, JSON, JSONL, TXT, and Markdown. Files are parsed in the browser and are not uploaded by CAELUS.
- **Logic filter:** normalized records receive deterministic source/freshness scores, stable fingerprints, deduplication, publisher-independence checks, negation/numeric-conflict detection, token retrieval, and a preserved source locator.
- **NCM-3 evidence ledger:** every visible claim is classified as an input fact, deterministic calculation, local-rule deduction, explicit unknown, or safety boundary.
- **Fail-closed Truth Gate:** an unsupported prompt does not receive a fabricated sector, causal chain, action, live fact, or probability. The engine instead lists the inputs needed for a grounded answer.
- **Deterministic local solvers:** unit-aware power/energy, constant-flow reserve, discrete cash-flow, inventory, queue, invoice, and sensor-conflict calculations are backed by local knowledge packs. Causal attribution, counterfactual sufficiency, cyber evidence, clinical safety, live-data, and maritime continuity rules are also bounded by explicit evidence.
- **Advisory neural router:** the small local semantic encoder can propose routing features, but it is not a factual source and does not generate the final answer.
- **Explicit authority boundary:** the NCM-3 evidence reasoner owns the visible answer and exact arithmetic; Rust/WebAssembly validates the ScenarioPack schema and owns only package/state execution. The advisory encoder is never a factual source.
- **Mobile and offline-first:** safe-area layout, touch-sized controls, a dedicated Sources tab, evidence ledger, update-safe PWA cache, local assets, and cached/user-loaded evidence when offline.

Live production: https://caelus-universal-war-room.borabirhekimoglu8.chatgpt.site

## Verify

```bash
npm run install:ci
npm run build
npm run lint
node --test tests/*.test.mjs
```

## Truth boundary

Deterministic means repeatable; it does not by itself mean correct. CAELUS can promote a retrieved statement only when a primary source, independent publishers, or an explicitly user-supplied file passes the Truth Gate. Weak single sources and unresolved contradictions remain visible but are not selected as fact.

An iPhone PWA cannot scrape arbitrary sites that refuse browser CORS access. Those sources can be added through a CORS-enabled API/feed or uploaded as a local file. CAELUS intentionally has no server proxy because that would move private evidence through a cloud service. Previously downloaded and user-loaded evidence remains usable offline.

CAELUS is not AGI and no finite connector list can equal every public source on the internet. The adapter registry and URL/file path make coverage extensible without changing the symbolic authority boundary. The semantic observer remains advisory; the evidence reasoner owns answer claims, while the Rust/WASM kernel is the ScenarioPack and state validator.
