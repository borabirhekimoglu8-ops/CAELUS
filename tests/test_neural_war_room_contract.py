#!/usr/bin/env python3
"""Static contract checks for dependency-free Neural War Room rendering."""

from __future__ import annotations

import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class NeuralWarRoomContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.html = (ROOT / "ui" / "index.html").read_text("utf-8")
        cls.javascript = (ROOT / "ui" / "app.js").read_text("utf-8")

    def test_neural_panel_exposes_authority_distinctions(self) -> None:
        for element_id in (
            "neural-card",
            "neural-gate",
            "neural-mode",
            "neural-model",
            "neural-fallback",
            "neural-node-list",
            "neural-levers",
        ):
            self.assertIn(f'id="{element_id}"', self.html)
        self.assertIn("Reported telemetry", self.html)
        self.assertIn("neural estimate", self.html)
        self.assertIn("authoritative symbolic state", self.html)
        self.assertIn("Rejected estimates are not applied", self.html)

    def test_router_handles_neural_observations(self) -> None:
        self.assertIn("case 'neural_observation':", self.javascript)
        self.assertIn("applyNeuralObservation(data);", self.javascript)
        self.assertIn("function applyNeuralObservation(data)", self.javascript)

    def test_authoritative_int64_values_use_bigint_formatting(self) -> None:
        start = self.javascript.index("function applyNeuralObservation(data)")
        end = self.javascript.index("/* ═", start)
        renderer = self.javascript[start:end]
        self.assertIn(
            "formatFixedPoint(rawNode.authoritative_state_fp)", renderer
        )
        self.assertIn("formatFixedPercent(rawNode.trust_fp)", renderer)
        self.assertNotIn("Number(rawNode.authoritative_state_fp)", renderer)
        self.assertNotIn("Number(rawNode.reported_state_fp)", renderer)

    def test_rejected_outputs_are_visually_distinct(self) -> None:
        self.assertIn("neural--accepted", self.html)
        self.assertIn("neural--rejected", self.html)
        self.assertIn("neural--unsafe", self.html)
        self.assertIn("Neural estimate (rejected)", self.javascript)
        self.assertIn("No neural mutation committed", self.javascript)

    def test_accepted_rendering_requires_trust_and_symbolic_commit(self) -> None:
        start = self.javascript.index("function applyNeuralObservation(data)")
        end = self.javascript.index("/* ═", start)
        renderer = self.javascript[start:end]
        self.assertIn("modelTrusted", renderer)
        self.assertIn("authorityCommitted", renderer)
        self.assertIn("runtimeStatus === 'OK'", renderer)
        self.assertIn("data.fallback === false", renderer)
        self.assertIn("acceptedBounded", renderer)
        self.assertIn("acceptedAdvisory", renderer)
        self.assertIn("UNSAFE PAYLOAD IGNORED", renderer)
        self.assertNotIn("data.evidence_id", renderer)
        self.assertNotIn("state.scenarioMeta.scenarioId =", renderer)


if __name__ == "__main__":
    unittest.main()
