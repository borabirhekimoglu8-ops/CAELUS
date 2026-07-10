# caelus-bs01-synthetic-v1 1.0.0

## Intended use

Compact offline CAELUS Neural V1 observer for deterministic assurance tests and
the BS-01 synthetic observability demonstration. The deterministic symbolic
engine remains authoritative.

## Architecture

- 16 fixed-point node features and 8-tick history
- 32-unit structured projection
- two graph message-passing layers
- true-state, anomaly, confidence, OOD, trust-delta, outage-horizon, and lever heads
- INT8 weights, INT32 biases, INT64 accumulation, denominator 64

The encoder/message layers are deterministic structured features. Output heads
are fitted with Decimal ridge regression and quantized using round-half-even.

## Provenance

- Dataset Blake3: `4d4f7181b41883f6bf99a832d669e60f6ff01dbf2b4c149d279cf7a4379195f8`
- Training configuration SHA-256: `149a372ee5c3d2ca59b7b7de5a771ee745e29cf1c80008effd710ac33601c6be`
- Weights Blake3: `3b1ecdc41038c6814c95b8a253482d2fd5271142ab9c106633151aecc24d473f`
- Trusted signer identity: `0ec496d12fa6fdd536d7978741d5f002631b70e55da0ee5ce49b72261f8e4db2`
- Synthetic samples: 220
- Symbolic engine commit/provenance: `483a4c4f6930a167a5cd0200df8e939eb4cc1477`

## Synthetic test metrics

- True-state ratio MAE (fixed-point): 180785
- Telemetry anomaly MAE (fixed-point): 32276
- Lever top-1 accuracy (fixed-point): 772727
- Quantized coefficient clipping count: 20

See `training_metrics.json` for all split, outage, calibration, synthetic
confidence/OOD policy-target, and robustness metrics.

## Limitations and prohibited claims

True-state, telemetry-anomaly, and outage labels are derived from the
deterministic symbolic simulation. Lever effectiveness is an explicitly
synthetic score over dynamic counterfactual outage, friction, and throughput,
not a direct engine measurement. Confidence, OOD, and trust-delta labels are
synthetic policy targets, not measured ground truth. Feature salience is
magnitude ranking, not causal attribution. These metrics are not evidence of
real-port predictive accuracy, simulation fidelity to a specific operator,
operational certification, or cross-platform determinism of any ONNX/advisory
implementation. This model may only propose bounded actions through the Neural
Gate.
