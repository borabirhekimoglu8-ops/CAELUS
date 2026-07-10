#!/usr/bin/env python3
"""Conformance tests for the dependency-free audit Blake3 backend."""

from __future__ import annotations

import json
import unittest
from pathlib import Path

from tools.caelus_blake3 import blake3, digest


ROOT = Path(__file__).resolve().parents[1]


class Blake3ConformanceTests(unittest.TestCase):
    def test_official_empty_and_abc_vectors(self) -> None:
        self.assertEqual(
            blake3(b"").hexdigest(),
            "af1349b9f5f9a1a6a0404dea36dcc949"
            "9bcb25c9adc112b7cc9a93cae41f3262",
        )
        self.assertEqual(
            blake3(b"abc").hexdigest(),
            "6437b3ac38465133ffb63b75273a8db5"
            "48c558465d79db03fd359c6cd5bd9d85",
        )

    def test_multichunk_digest_matches_committed_rust_artifact(self) -> None:
        model_dir = ROOT / "models" / "assurance_v1"
        manifest = json.loads((model_dir / "manifest.json").read_text("utf-8"))
        weights = (model_dir / "weights.bin").read_bytes()
        self.assertGreater(len(weights), 1024)
        self.assertEqual(digest(weights).hex(), manifest["weights_hash"])

    def test_input_type_and_output_size_are_bounded(self) -> None:
        with self.assertRaises(TypeError):
            digest(bytearray(b"abc"))  # type: ignore[arg-type]
        with self.assertRaises(ValueError):
            digest(b"abc", 65)


if __name__ == "__main__":
    unittest.main()
