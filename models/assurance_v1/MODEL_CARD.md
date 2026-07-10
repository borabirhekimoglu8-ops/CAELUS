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

- Dataset Blake3: `d6df489c205f6bb0fcca2c2563efe7c96bbfd16ce120a4b869c643c28e75a25d`
- Training configuration SHA-256: `100ac9e34aa3f2de4ce30b340dd6fadd090c53de6b6a7eb41c852d696d7ec986`
- Weights Blake3: `c11832e19712e8abd0b8610a573588126356dcc46a6625156cd09588da76b863`
- Trusted signer identity: `c8527f9105465967aea81d07514ea11f597f32fedc7d6f8f9e7d182f999fc51f`
- Synthetic samples: 220
- Symbolic engine commit/provenance: `cded4bcff930f1547962394ccbd6879faa570be8`

## Synthetic test metrics

- True-state ratio MAE (fixed-point): 54488
- Telemetry anomaly MAE (fixed-point): 37988
- Lever top-1 accuracy (fixed-point): 772727
- Quantized coefficient clipping count: 2

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
