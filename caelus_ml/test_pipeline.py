#!/usr/bin/env python3
"""Standard-library tests for deterministic neural training/export helpers."""

from __future__ import annotations

import pathlib
import struct
import sys
import tempfile
import unittest


sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import train_v1  # noqa: E402


class TrainingPipelineTests(unittest.TestCase):
    def test_negative_division_truncates_toward_zero(self) -> None:
        self.assertEqual(train_v1.trunc_div(-7, 3), -2)
        self.assertEqual(train_v1.trunc_div(7, 3), 2)
        self.assertEqual(train_v1.trunc_div(-1, 2), 0)

    def test_frozen_architecture_has_exact_runtime_shape(self) -> None:
        weights, biases = train_v1.initialize_frozen_weights()
        self.assertEqual(len(weights), train_v1.WEIGHT_COUNT)
        self.assertEqual(len(biases), train_v1.BIAS_COUNT)
        self.assertTrue(any(weights))
        self.assertTrue(all(-127 <= value <= 127 for value in weights))

    def test_observer_features_withhold_authoritative_state(self) -> None:
        node = {
            "node_kind": 1,
            "capacity_fp": train_v1.FP,
            "authoritative_state_fp": 900_000,
            "reported_state_fp": 200_000,
            "trust_fp": 750_000,
            "missing_mask": 0,
            "incoming_flow_fp": 20_000,
            "outgoing_flow_fp": 10_000,
            "queue_utilization_fp": 200_000,
            "deadline_distance_fp": 500_000,
            "hysteresis_distance_fp": 600_000,
            "outage_latched_fp": 0,
            "intel_risk_fp": 100_000,
            "state_history_fp": [800_000] * 8,
            "reported_history_fp": [
                100_000,
                110_000,
                120_000,
                130_000,
                140_000,
                150_000,
                180_000,
                190_000,
            ],
        }
        expected = train_v1.encode_observation_features(node)
        node["authoritative_state_fp"] = 0
        node["state_history_fp"] = [0] * 8
        self.assertEqual(train_v1.encode_observation_features(node), expected)
        self.assertEqual(expected[0], 200_000)
        self.assertEqual(expected[1], 150_000)

    def test_rollout_split_policy_is_fixed(self) -> None:
        self.assertEqual(train_v1.expected_split_for_rollout(0), "test")
        self.assertEqual(train_v1.expected_split_for_rollout(1), "validation")
        self.assertEqual(train_v1.expected_split_for_rollout(9), "train")
        self.assertEqual(train_v1.expected_split_for_rollout(10), "test")

    def test_strict_json_rejects_duplicate_keys(self) -> None:
        with self.assertRaises(ValueError):
            train_v1.strict_json_loads(b'{"schema_version":1,"schema_version":1}', "row")
        with self.assertRaises(ValueError):
            train_v1.strict_json_loads(b'{"value":NaN}', "row")

    def test_exclusive_publication_never_overwrites(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = pathlib.Path(directory) / "artifact"
            path.write_bytes(b"original")
            with self.assertRaises(FileExistsError):
                train_v1.publish_bytes_exclusive(path, b"replacement")
            self.assertEqual(path.read_bytes(), b"original")

    def test_export_header_and_payload_are_exact(self) -> None:
        weights, biases = train_v1.initialize_frozen_weights()
        with tempfile.TemporaryDirectory() as directory:
            path = pathlib.Path(directory) / "weights.bin"
            train_v1.export_weights(path, weights, biases)
            data = path.read_bytes()
        self.assertEqual(
            len(data),
            train_v1.HEADER_BYTES
            + train_v1.WEIGHT_COUNT
            + train_v1.BIAS_COUNT * 4,
        )
        self.assertEqual(data[:8], b"CAELNN1\0")
        self.assertEqual(struct.unpack_from("<I", data, 20)[0], train_v1.HIDDEN)
        self.assertEqual(
            struct.unpack_from("<Q", data, 40)[0],
            train_v1.WEIGHT_COUNT + train_v1.BIAS_COUNT * 4,
        )


if __name__ == "__main__":
    unittest.main()
