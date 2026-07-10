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
- Training configuration SHA-256: `8c7bd4f3aaa7acaca74cbf698629a640555e7dca077d78c7809e225c85365534`
- Weights Blake3: `44609fc02d32b3ec250b621b5833f03791a83b9a5d3337878e22aa1480c2807c`
- Trusted signer identity: `c8527f9105465967aea81d07514ea11f597f32fedc7d6f8f9e7d182f999fc51f`
- Synthetic samples: 220
- Symbolic engine commit/provenance: `1ce832496d58482192228780ca562dfeb9d33ec0`

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
