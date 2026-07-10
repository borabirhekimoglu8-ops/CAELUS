# CAELUS Neural V1 — Offline Training Toolchain

This directory is isolated from the production runtime. Python is used only to
orchestrate deterministic dataset generation and fit/export quantized output
heads. `dist/caelus_os` does not load Python, NumPy, PyTorch, Node.js, or a
network service.

## Reproducible flow

```bash
python3 caelus_ml/generate_dataset.py \
  --output /tmp/caelus-neural.jsonl \
  --manifest /tmp/caelus-neural.dataset.json \
  --samples 220 \
  --seed 0xCAE105DEADBEEF00

cargo run --locked --offline --release --bin caelus_sign_model -- \
  --key /secure/offline/caelus_neural_signing.key \
  --print-public-key

mkdir /tmp/caelus-model-v1
python3 caelus_ml/train_v1.py \
  --dataset /tmp/caelus-neural.jsonl \
  --dataset-manifest /tmp/caelus-neural.dataset.json \
  --output-dir /tmp/caelus-model-v1 \
  --signer-identity <64-lowercase-hex-public-key> \
  --created-utc 2026-07-10T00:00:00Z

cargo run --locked --offline --release --bin caelus_sign_model -- \
  --manifest /tmp/caelus-model-v1/manifest.json \
  --weights /tmp/caelus-model-v1/weights.bin \
  --key /secure/offline/caelus_neural_signing.key \
  --output /tmp/caelus-model-v1/model.sig \
  --write
```

The signer refuses to overwrite `model.sig`. Private seeds must remain outside
the repository with owner-only permissions.

## Dataset and training semantics

- Ground truth comes from `caelus_core::CausalEngine`, using the same fixed-point
  and deterministic RNG rules as the reference symbolic engine. True state,
  anomaly, and outage-horizon labels are engine-derived. Lever effectiveness is
  an explicitly synthetic score over dynamic counterfactual engine outcomes.
  Confidence, OOD, and trust-delta heads use explicitly named deterministic
  synthetic policy targets; neither category is measured ground truth.
- One rollout stays entirely in train, validation, or test to prevent temporal
  and graph leakage. The trainer recomputes the split from `rollout_id` and
  rejects non-contiguous or inconsistent rows. The 220-rollout minimum cycles
  every split through all 22 synthetic cases.
- Cases include normal flow, queue/buffer pressure, deadlines, hysteresis,
  outage/recovery, false/delayed/missing/corrupted telemetry, feedback, delay,
  capacity degradation, traffic spikes, simultaneous failures, and saturation
  boundaries.
- Future outage and lever-effectiveness labels are produced by cloned symbolic
  counterfactual simulations that continue the selected case dynamics.
- Authoritative state and history are retained as labels and audit evidence but
  are deliberately withheld from `CAELUS_FEATURE_SCHEMA_V1`. Observer features
  use reported telemetry, reported history summaries, telemetry-derived graph
  flow/utilization, trust, policy distances, missingness, and intel risk. This
  prevents the hidden-state head from learning an identity copy of symbolic
  state.
- The first V1 model uses a fixed structured graph encoder and deterministically
  fitted Decimal ridge output heads. Export is INT8 weights, INT32 biases, and
  an explicit denominator of 64.
- Metrics are calculated with the deployed V1 integer value semantics after
  quantization. Cross-language runtime parity must be established by the
  C++↔Rust neural differential suite before a package is accepted for assurance.

The generated model card intentionally describes all results as synthetic.
Synthetic performance is not real-world operational accuracy or certification.
Feature salience is an absolute-magnitude ranking and is not represented as
causal attribution.

## Dependencies

- Rust/Cargo toolchain supported by the repository (including Rust 1.83)
- Python 3.10 or newer, standard library only

No package installation or network access is required after the repository's
Rust crates are available in the local Cargo cache.

The dataset wrapper records only a clean repository `HEAD`; it refuses dirty
tracked trees or a caller-supplied commit that differs from `HEAD`. Cargo
invocations use `--locked --offline`.
