#!/usr/bin/env python3
"""Train/export the compact CAELUS deterministic neural V1 model.

The training path is deliberately offline and standard-library-only. It uses a
deterministic Decimal ridge fit for the output heads and exports the exact INT8
weights/INT32 biases consumed by the C++ and Rust assurance runtimes.
"""

from __future__ import annotations

import argparse
import collections
import datetime
import decimal
import hashlib
import json
import os
import pathlib
import re
import stat
import struct
import subprocess
import sys
import tempfile
from typing import Any, Iterable, Sequence


ROOT = pathlib.Path(__file__).resolve().parents[1]
CORE_MANIFEST = ROOT / "caelus_core" / "Cargo.toml"
DEFAULT_TRUSTED_SIGNER_FILE = ROOT / "tools" / "caelus_neural_trusted_pubkey.txt"
FP = 1_000_000
DENOMINATOR = 64
FEATURES = 16
HIDDEN = 32
WEIGHT_COUNT = 4_899
BIAS_COUNT = 105
HEADER_BYTES = 48
I64_MIN = -(1 << 63)
I64_MAX = (1 << 63) - 1
I32_MIN = -(1 << 31)
I32_MAX = (1 << 31) - 1
MAX_ARTIFACT_BYTES = 64 * 1024 * 1024
MAX_DATASET_LINE_BYTES = 1_000_000
MAX_MANIFEST_BYTES = 1_000_000
CASES = (
    "normal",
    "queue_buildup",
    "buffer_saturation",
    "perishable_decay",
    "deadline_pressure",
    "hysteresis_entry",
    "hysteresis_exit",
    "latched_outage",
    "recovery_success",
    "recovery_failure",
    "false_telemetry",
    "delayed_telemetry",
    "missing_telemetry",
    "corrupted_telemetry",
    "trust_degradation",
    "adversarial_reporting",
    "feedback_loop",
    "edge_delay",
    "capacity_degradation",
    "traffic_spike",
    "multiple_failures",
    "saturating_boundary",
)

W_INPUT = 0
W_MESSAGE0_SELF = 512
W_MESSAGE0_NEIGHBOR = 1_536
W_MESSAGE1_SELF = 2_560
W_MESSAGE1_NEIGHBOR = 3_584
W_NODE_HEADS = 4_608
W_OUTAGE_HEADS = 4_768
W_LEVER_HEAD = 4_864

B_INPUT = 0
B_MESSAGE0 = 32
B_MESSAGE1 = 64
B_NODE_HEADS = 96
B_OUTAGE_HEADS = 101
B_LEVER_HEAD = 104

MISSING_REPORTED_STATE = 1 << 0
MISSING_STATE_HISTORY = 1 << 1
MISSING_REPORTED_HISTORY = 1 << 2
MISSING_FLOW = 1 << 3
MISSING_DEADLINE = 1 << 4
MISSING_HYSTERESIS = 1 << 5
MISSING_INTEL = 1 << 6
KNOWN_MISSING_MASK = (1 << 7) - 1

NODE_TARGETS = (
    "true_state_ratio_fp",
    "telemetry_anomaly_fp",
    "confidence_policy_target_fp",
    "ood_policy_target_fp",
    "trust_delta_policy_target_fp",
)
OPERATORS = (
    "integer_linear",
    "integer_message_sum",
    "bias_add",
    "clamped_relu",
    "hard_sigmoid",
    "mean_pool",
)
HEX_32 = re.compile(r"^[0-9a-f]{64}$")


def canonical_json(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def sha256_json(value: Any) -> str:
    return hashlib.sha256(canonical_json(value).encode("ascii")).hexdigest()


def strict_json_loads(data: bytes, label: str) -> Any:
    def reject_duplicates(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
        result: dict[str, Any] = {}
        for key, value in pairs:
            if key in result:
                raise ValueError(f"{label} contains duplicate key {key!r}")
            result[key] = value
        return result

    try:
        text = data.decode("utf-8", errors="strict")
    except UnicodeDecodeError as error:
        raise ValueError(f"{label} is not valid UTF-8") from error
    def reject_nonfinite(value: str) -> None:
        raise ValueError(f"{label} contains non-finite number {value}")

    return json.loads(
        text,
        object_pairs_hook=reject_duplicates,
        parse_constant=reject_nonfinite,
    )


def require_exact_keys(value: dict[str, Any], expected: set[str], label: str) -> None:
    actual = set(value)
    if actual != expected:
        unknown = sorted(actual - expected)
        missing = sorted(expected - actual)
        raise ValueError(f"{label} keys mismatch: unknown={unknown}, missing={missing}")


def read_bounded_regular_file(path: pathlib.Path, maximum: int, label: str) -> bytes:
    try:
        path_metadata = os.lstat(path)
    except OSError as error:
        raise ValueError(f"cannot stat {label}: {error}") from error
    if stat.S_ISLNK(path_metadata.st_mode):
        raise ValueError(f"{label} must not be a symbolic link")
    if not stat.S_ISREG(path_metadata.st_mode):
        raise ValueError(f"{label} must be a regular file")
    flags = os.O_RDONLY
    flags |= getattr(os, "O_CLOEXEC", 0)
    flags |= getattr(os, "O_BINARY", 0)
    flags |= getattr(os, "O_NOFOLLOW", 0)
    try:
        descriptor = os.open(path, flags)
    except OSError as error:
        raise ValueError(f"cannot open {label}: {error}") from error
    try:
        metadata = os.fstat(descriptor)
        if not stat.S_ISREG(metadata.st_mode):
            raise ValueError(f"{label} must be a regular file")
        if metadata.st_size <= 0 or metadata.st_size > maximum:
            raise ValueError(f"{label} must contain 1..{maximum} bytes")
        chunks: list[bytes] = []
        total = 0
        while True:
            chunk = os.read(descriptor, min(64 * 1024, maximum - total + 1))
            if not chunk:
                break
            total += len(chunk)
            if total > maximum:
                raise ValueError(f"{label} grew beyond {maximum} bytes")
            chunks.append(chunk)
        if total != metadata.st_size:
            raise ValueError(f"{label} changed while being read")
        return b"".join(chunks)
    finally:
        os.close(descriptor)


def publish_bytes_exclusive(path: pathlib.Path, data: bytes) -> None:
    descriptor, temporary_name = tempfile.mkstemp(
        dir=path.parent, prefix=f".{path.name}.", suffix=".tmp"
    )
    temporary = pathlib.Path(temporary_name)
    try:
        if hasattr(os, "fchmod"):
            os.fchmod(descriptor, 0o600)
        offset = 0
        while offset < len(data):
            written = os.write(descriptor, data[offset:])
            if written <= 0:
                raise OSError("short write while publishing artifact")
            offset += written
        os.fsync(descriptor)
        os.close(descriptor)
        descriptor = -1
        os.link(temporary, path)
    finally:
        if descriptor >= 0:
            os.close(descriptor)
        try:
            temporary.unlink()
        except FileNotFoundError:
            pass


def publish_text_exclusive(
    path: pathlib.Path, text: str, *, encoding: str = "utf-8"
) -> None:
    publish_bytes_exclusive(path, text.encode(encoding))


def trunc_div(numerator: int, denominator: int) -> int:
    if denominator <= 0:
        raise ValueError("positive denominator required")
    magnitude = abs(numerator) // denominator
    return -magnitude if numerator < 0 else magnitude


def sat_i64(value: int) -> int:
    return max(I64_MIN, min(I64_MAX, value))


def fp_mul(left: int, right: int) -> int:
    return sat_i64(trunc_div(left * right, FP))


def fp_div(left: int, right: int) -> int:
    if right == 0:
        return 0
    return sat_i64(trunc_div(left * FP, right))


def hard_sigmoid(value: int) -> int:
    return max(0, min(FP, trunc_div(sat_i64(value + FP), 2)))


def linear(
    values: Sequence[int],
    weights: Sequence[int],
    bias: int,
    denominator: int = DENOMINATOR,
) -> int:
    if len(values) != len(weights):
        raise ValueError("linear shape mismatch")
    accumulator = int(bias)
    for value, weight in zip(values, weights):
        accumulator = sat_i64(accumulator + int(value) * int(weight))
    return trunc_div(accumulator, denominator)


def initialize_frozen_weights() -> tuple[list[int], list[int]]:
    weights = [0] * WEIGHT_COUNT
    biases = [0] * BIAS_COUNT
    for hidden in range(HIDDEN):
        if hidden < FEATURES:
            weights[W_INPUT + hidden * FEATURES + hidden] = DENOMINATOR
        else:
            first = hidden - FEATURES
            second = (first + 5) % FEATURES
            weights[W_INPUT + hidden * FEATURES + first] = DENOMINATOR // 2
            weights[W_INPUT + hidden * FEATURES + second] = DENOMINATOR // 2
    for self_base, neighbor_base in (
        (W_MESSAGE0_SELF, W_MESSAGE0_NEIGHBOR),
        (W_MESSAGE1_SELF, W_MESSAGE1_NEIGHBOR),
    ):
        for hidden in range(HIDDEN):
            weights[self_base + hidden * HIDDEN + hidden] = 56
            weights[neighbor_base + hidden * HIDDEN + hidden] = 8
    return weights, biases


def hidden_forward(sample: dict[str, Any], weights: Sequence[int], biases: Sequence[int]) -> list[list[int]]:
    nodes = sample["nodes"]
    hidden: list[list[int]] = []
    for node in nodes:
        features = checked_int_vector(node["features_fp"], FEATURES, "features_fp", -FP, FP)
        row = []
        for output in range(HIDDEN):
            start = W_INPUT + output * FEATURES
            value = linear(
                features,
                weights[start : start + FEATURES],
                biases[B_INPUT + output],
            )
            row.append(max(0, min(FP, value)))
        hidden.append(row)

    for layer in range(2):
        message = [[0] * HIDDEN for _ in hidden]
        incoming = [0] * len(hidden)
        for edge in sample["edges"]:
            if int(edge["active"]) == 0:
                continue
            source = checked_index(edge["source_index"], len(hidden), "edge source")
            destination = checked_index(edge["destination_index"], len(hidden), "edge destination")
            multiplier = checked_int(edge["multiplier_fp"], 0, 4 * FP, "edge multiplier")
            delay = checked_int(edge["delay_ticks"], 0, 1_000_000, "edge delay")
            delay_factor = fp_div(FP, (delay + 1) * FP)
            for index in range(HIDDEN):
                contribution = fp_mul(fp_mul(hidden[source][index], multiplier), delay_factor)
                message[destination][index] = sat_i64(
                    message[destination][index] + contribution
                )
            incoming[destination] += 1
        for node_index, count in enumerate(incoming):
            if count:
                message[node_index] = [
                    trunc_div(value, count) for value in message[node_index]
                ]

        self_base, neighbor_base, bias_base = (
            (W_MESSAGE0_SELF, W_MESSAGE0_NEIGHBOR, B_MESSAGE0)
            if layer == 0
            else (W_MESSAGE1_SELF, W_MESSAGE1_NEIGHBOR, B_MESSAGE1)
        )
        next_hidden = [[0] * HIDDEN for _ in hidden]
        for node_index in range(len(hidden)):
            for output in range(HIDDEN):
                self_start = self_base + output * HIDDEN
                neighbor_start = neighbor_base + output * HIDDEN
                value = linear(
                    hidden[node_index] + message[node_index],
                    weights[self_start : self_start + HIDDEN]
                    + weights[neighbor_start : neighbor_start + HIDDEN],
                    biases[bias_base + output],
                )
                next_hidden[node_index][output] = max(0, min(FP, value))
        hidden = next_hidden
    return hidden


def pooled_hidden(hidden: Sequence[Sequence[int]]) -> list[int]:
    if not hidden:
        raise ValueError("empty graph")
    return [
        trunc_div(sum(row[index] for row in hidden), len(hidden))
        for index in range(HIDDEN)
    ]


def checked_int(value: Any, minimum: int, maximum: int, label: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise ValueError(f"{label} must be an integer")
    if value < minimum or value > maximum:
        raise ValueError(f"{label} outside [{minimum}, {maximum}]: {value}")
    return value


def checked_index(value: Any, length: int, label: str) -> int:
    return checked_int(value, 0, length - 1, label)


def checked_int_vector(
    value: Any, length: int, label: str, minimum: int, maximum: int
) -> list[int]:
    if not isinstance(value, list) or len(value) != length:
        raise ValueError(f"{label} must contain {length} integers")
    return [checked_int(item, minimum, maximum, label) for item in value]


def encode_observation_features(node: dict[str, Any]) -> list[int]:
    """Mirror FEATURE_SCHEMA_V1 without exposing symbolic authority.

    Authoritative state and state history are carried in the row as supervised
    labels/audit evidence, but this encoder intentionally reads only reported
    telemetry, telemetry-derived flow/utilization, policy distances, and
    missingness.
    """

    capacity = checked_int(node.get("capacity_fp"), 1, FP, "node capacity")
    missing = checked_int(node.get("missing_mask"), 0, KNOWN_MISSING_MASK, "missing mask")
    trust = checked_int(node.get("trust_fp"), 0, FP, "node trust")
    reported = checked_int(node.get("reported_state_fp"), 0, capacity, "reported state")
    history = checked_int_vector(
        node.get("reported_history_fp"),
        8,
        "reported history",
        0,
        FP if missing & MISSING_REPORTED_HISTORY else capacity,
    )

    feature = [0] * FEATURES
    reported_missing = bool(missing & MISSING_REPORTED_STATE)
    reported_ratio = 0 if reported_missing else fp_div(reported, capacity)
    feature[0] = reported_ratio
    feature[1] = fp_mul(reported_ratio, trust)
    feature[2] = trust
    if not (missing & MISSING_REPORTED_HISTORY):
        newest = history[-1]
        oldest = history[0]
        feature[3] = fp_div(newest, capacity)
        feature[4] = fp_div(oldest, capacity)
        feature[5] = fp_div(sat_i64(newest - oldest), capacity)
        if not reported_missing:
            feature[6] = fp_div(sat_i64(reported - newest), capacity)
    if not (missing & MISSING_FLOW):
        feature[7] = max(
            -FP,
            min(FP, checked_int(node.get("incoming_flow_fp"), -4 * FP, 4 * FP, "incoming flow")),
        )
        feature[8] = max(
            -FP,
            min(FP, checked_int(node.get("outgoing_flow_fp"), -4 * FP, 4 * FP, "outgoing flow")),
        )
    feature[9] = checked_int(node.get("queue_utilization_fp"), 0, FP, "queue utilization")
    if not (missing & MISSING_DEADLINE):
        feature[10] = checked_int(
            node.get("deadline_distance_fp"), -FP, FP, "deadline distance"
        )
    if not (missing & MISSING_HYSTERESIS):
        feature[11] = checked_int(
            node.get("hysteresis_distance_fp"), -FP, FP, "hysteresis distance"
        )
    feature[12] = checked_int(node.get("outage_latched_fp"), 0, FP, "outage latch")
    if not (missing & MISSING_INTEL):
        feature[13] = checked_int(node.get("intel_risk_fp"), 0, FP, "intel risk")
    feature[14] = (missing & KNOWN_MISSING_MASK).bit_count() * FP // 7
    feature[15] = checked_int(node.get("node_kind"), 0, 5, "node kind") * FP // 5
    return feature


def expected_split_for_rollout(rollout_id: int) -> str:
    remainder = rollout_id % 10
    if remainder == 0:
        return "test"
    if remainder == 1:
        return "validation"
    return "train"


def validate_sample(sample: Any) -> dict[str, Any]:
    if not isinstance(sample, dict) or sample.get("schema_version") != 1:
        raise ValueError("dataset row schema_version must be 1")
    require_exact_keys(
        sample,
        {
            "schema_version",
            "rollout_id",
            "split",
            "case",
            "seed",
            "tick",
            "scenario_id",
            "scenario_hash",
            "nodes",
            "edges",
            "levers",
            "outage_horizons_fp",
            "time_to_outage_ticks",
        },
        "dataset row",
    )
    rollout_id = checked_int(sample.get("rollout_id"), 0, 4_095, "rollout_id")
    if sample.get("split") != expected_split_for_rollout(rollout_id):
        raise ValueError("split does not match rollout_id_mod_10 policy")
    checked_int(sample.get("seed"), 0, (1 << 64) - 1, "rollout seed")
    checked_int(sample.get("tick"), 0, (1 << 64) - 1, "tick")
    for field, maximum in (("scenario_id", 63), ("case", 63)):
        value = sample.get(field)
        if (
            not isinstance(value, str)
            or not value
            or len(value) > maximum
            or not value.isascii()
        ):
            raise ValueError(f"{field} must be non-empty bounded ASCII")
    if not isinstance(sample.get("scenario_hash"), str) or not HEX_32.fullmatch(
        sample["scenario_hash"]
    ):
        raise ValueError("scenario_hash must be 64 lowercase hex characters")

    nodes = sample.get("nodes")
    edges = sample.get("edges")
    levers = sample.get("levers")
    if not isinstance(nodes, list) or not 1 <= len(nodes) <= 64:
        raise ValueError("node count outside 1..64")
    if not isinstance(edges, list) or len(edges) > 256:
        raise ValueError("edge count exceeds 256")
    if not isinstance(levers, list) or len(levers) > 64:
        raise ValueError("lever count exceeds 64")
    outage_labels = checked_int_vector(
        sample.get("outage_horizons_fp"), 3, "outage labels", 0, FP
    )
    if outage_labels != sorted(outage_labels):
        raise ValueError("latched outage horizon labels must be monotonic")
    checked_int(sample.get("time_to_outage_ticks"), -1, 64, "time to outage")

    for index, node in enumerate(nodes):
        if not isinstance(node, dict) or node.get("node_index") != index:
            raise ValueError("node indices must be contiguous")
        require_exact_keys(
            node,
            {
                "node_index",
                "node_id",
                "node_kind",
                "capacity_fp",
                "authoritative_state_fp",
                "reported_state_fp",
                "trust_fp",
                "missing_mask",
                "incoming_flow_fp",
                "outgoing_flow_fp",
                "queue_utilization_fp",
                "deadline_distance_fp",
                "hysteresis_distance_fp",
                "outage_latched_fp",
                "intel_risk_fp",
                "state_history_fp",
                "reported_history_fp",
                "features_fp",
                "labels",
                "salient_feature_indices_by_magnitude",
            },
            "node",
        )
        node_id = node.get("node_id")
        if (
            not isinstance(node_id, str)
            or not node_id
            or len(node_id) > 63
            or any(ord(character) < 0x21 or ord(character) > 0x7E for character in node_id)
        ):
            raise ValueError("node_id must be bounded printable non-space ASCII")
        capacity = checked_int(node.get("capacity_fp"), 1, FP, "node capacity")
        authority = checked_int(
            node.get("authoritative_state_fp"), 0, capacity, "authoritative state"
        )
        reported = checked_int(node.get("reported_state_fp"), 0, capacity, "reported state")
        missing = checked_int(node.get("missing_mask"), 0, KNOWN_MISSING_MASK, "missing mask")
        checked_int(node.get("trust_fp"), 0, FP, "node trust")
        checked_int_vector(
            node.get("state_history_fp"),
            8,
            "state history",
            0,
            FP if missing & MISSING_STATE_HISTORY else capacity,
        )
        checked_int_vector(
            node.get("reported_history_fp"),
            8,
            "reported history",
            0,
            FP if missing & MISSING_REPORTED_HISTORY else capacity,
        )
        expected_utilization = (
            0
            if missing & MISSING_REPORTED_STATE
            else max(0, min(FP, fp_div(reported, capacity)))
        )
        if node.get("queue_utilization_fp") != expected_utilization:
            raise ValueError("queue utilization must be telemetry-derived")
        features = checked_int_vector(
            node.get("features_fp"), FEATURES, "features", -FP, FP
        )
        if features != encode_observation_features(node):
            raise ValueError("features do not match FEATURE_SCHEMA_V1 encoding")
        labels = node.get("labels")
        if not isinstance(labels, dict):
            raise ValueError("node labels missing")
        require_exact_keys(labels, {"true_state_fp", *NODE_TARGETS}, "node labels")
        for target in NODE_TARGETS[:-1]:
            checked_int(labels.get(target), 0, FP, target)
        checked_int(labels.get(NODE_TARGETS[-1]), -50_000, 50_000, NODE_TARGETS[-1])
        if labels.get("true_state_fp") != authority:
            raise ValueError("true-state label must match symbolic authority")
        expected_ratio = max(0, min(FP, fp_div(authority, capacity)))
        if labels.get("true_state_ratio_fp") != expected_ratio:
            raise ValueError("true-state ratio label is inconsistent")
        expected_anomaly = max(0, min(FP, fp_div(abs(authority - reported), capacity)))
        if labels.get("telemetry_anomaly_fp") != expected_anomaly:
            raise ValueError("telemetry anomaly label is inconsistent")
        salient = node.get("salient_feature_indices_by_magnitude")
        expected_salient = sorted(
            range(FEATURES), key=lambda feature_index: (-abs(features[feature_index]), feature_index)
        )[:3]
        if salient != expected_salient:
            raise ValueError("feature salience list is inconsistent")

    parsed_edges: list[tuple[int, int, int, int, int]] = []
    for edge in edges:
        if not isinstance(edge, dict):
            raise ValueError("edge must be an object")
        require_exact_keys(
            edge,
            {
                "source_index",
                "destination_index",
                "delay_ticks",
                "multiplier_fp",
                "active",
            },
            "edge",
        )
        source = checked_index(edge.get("source_index"), len(nodes), "edge source")
        destination = checked_index(
            edge.get("destination_index"), len(nodes), "edge destination"
        )
        delay = checked_int(edge.get("delay_ticks"), 0, 1_000_000, "edge delay")
        multiplier = checked_int(edge.get("multiplier_fp"), 0, 4 * FP, "edge multiplier")
        active = checked_int(edge.get("active"), 0, 1, "edge active")
        parsed_edges.append((source, destination, delay, multiplier, active))

    expected_incoming = [0] * len(nodes)
    expected_outgoing = [0] * len(nodes)
    for source, destination, _delay, multiplier, active in parsed_edges:
        if not active or int(nodes[source]["missing_mask"]) & MISSING_REPORTED_STATE:
            continue
        source_ratio = fp_div(
            int(nodes[source]["reported_state_fp"]), int(nodes[source]["capacity_fp"])
        )
        contribution = fp_mul(fp_mul(source_ratio, multiplier), 50_000)
        expected_incoming[destination] = sat_i64(
            expected_incoming[destination] + contribution
        )
        expected_outgoing[source] = sat_i64(expected_outgoing[source] + contribution)
    for index, node in enumerate(nodes):
        missing = int(node["missing_mask"])
        expected_in = 0 if missing & MISSING_FLOW else max(
            -4 * FP, min(4 * FP, expected_incoming[index])
        )
        expected_out = 0 if missing & MISSING_FLOW else max(
            -4 * FP, min(4 * FP, expected_outgoing[index])
        )
        if node.get("incoming_flow_fp") != expected_in or node.get("outgoing_flow_fp") != expected_out:
            raise ValueError("flow features do not match telemetry-derived graph flow")

    for index, lever in enumerate(levers):
        if not isinstance(lever, dict) or lever.get("lever_index") != index:
            raise ValueError("lever indices must be contiguous")
        require_exact_keys(
            lever,
            {
                "lever_index",
                "lever_id",
                "success_probability_fp",
                "cost_ticks",
                "remaining_lockout",
                "available",
                "effectiveness_fp",
            },
            "lever",
        )
        lever_id = lever.get("lever_id")
        if (
            not isinstance(lever_id, str)
            or not lever_id
            or len(lever_id) > 63
            or any(ord(character) < 0x21 or ord(character) > 0x7E for character in lever_id)
        ):
            raise ValueError("lever_id must be bounded printable non-space ASCII")
        checked_int(lever.get("success_probability_fp"), 0, FP, "lever success probability")
        checked_int(lever.get("cost_ticks"), 0, (1 << 31) - 1, "lever cost")
        checked_int(lever.get("remaining_lockout"), 0, (1 << 31) - 1, "lever lockout")
        checked_int(lever.get("available"), 0, 1, "lever availability")
        checked_int(lever.get("effectiveness_fp"), 0, FP, "lever effectiveness")
    return sample


def read_dataset(data: bytes) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    if not data.endswith(b"\n"):
        raise ValueError("dataset must end with a newline")
    for line_number, line in enumerate(data.splitlines(), 1):
        if len(line) > MAX_DATASET_LINE_BYTES:
            raise ValueError(f"dataset line {line_number} exceeds 1 MB")
        if not line.strip():
            raise ValueError(f"empty dataset line {line_number}")
        rows.append(validate_sample(strict_json_loads(line, f"dataset line {line_number}")))
        if len(rows) > 4_096:
            raise ValueError("dataset exceeds V1 training row limit")
    if not rows:
        raise ValueError("dataset is empty")
    rollout_ids = [row.get("rollout_id") for row in rows]
    if len(set(rollout_ids)) != len(rollout_ids):
        raise ValueError("duplicate rollout_id would risk split leakage")
    if sorted(rollout_ids) != list(range(len(rows))):
        raise ValueError("rollout_id values must be contiguous from zero")
    for split in ("train", "validation", "test"):
        if not any(row["split"] == split for row in rows):
            raise ValueError(f"dataset has no {split} rows")
    return rows


def rust_blake3_bytes(data: bytes) -> tuple[str, int]:
    command = [
        "cargo",
        "run",
        "--quiet",
        "--locked",
        "--offline",
        "--release",
        "--manifest-path",
        str(CORE_MANIFEST),
        "--features",
        "std",
        "--bin",
        "caelus_neural_hash",
        "--",
        "--stdin",
    ]
    result = subprocess.run(
        command,
        cwd=ROOT,
        check=True,
        capture_output=True,
        input=data,
    )
    try:
        fields = result.stdout.decode("ascii", errors="strict").strip().split()
    except UnicodeDecodeError as error:
        raise RuntimeError("hash helper output is not ASCII") from error
    if len(fields) != 2 or not HEX_32.fullmatch(fields[0]):
        raise RuntimeError(f"unexpected hash helper output: {result.stdout!r}")
    return fields[0], int(fields[1])


def target_to_preactivation(target_fp: int, sigmoid: bool) -> decimal.Decimal:
    value = decimal.Decimal(target_fp) / decimal.Decimal(FP)
    return value * 2 - 1 if sigmoid else value


def fit_ridge(
    examples: Sequence[tuple[Sequence[int], int, decimal.Decimal]],
    *,
    sigmoid_target: bool,
    ridge: decimal.Decimal,
) -> tuple[list[int], int, int]:
    if not examples:
        raise ValueError("cannot fit an empty head")
    dimension = len(examples[0][0])
    size = dimension + 1
    matrix = [[decimal.Decimal(0) for _ in range(size)] for _ in range(size)]
    vector = [decimal.Decimal(0) for _ in range(size)]
    scale = decimal.Decimal(FP)
    for features_fp, target_fp, row_weight in examples:
        if len(features_fp) != dimension:
            raise ValueError("inconsistent training feature width")
        row = [decimal.Decimal(1)] + [
            decimal.Decimal(value) / scale for value in features_fp
        ]
        target = target_to_preactivation(target_fp, sigmoid_target)
        for left in range(size):
            vector[left] += row_weight * row[left] * target
            for right in range(size):
                matrix[left][right] += row_weight * row[left] * row[right]
    for index in range(1, size):
        matrix[index][index] += ridge

    for column in range(size):
        pivot = max(range(column, size), key=lambda row: abs(matrix[row][column]))
        if matrix[pivot][column] == 0:
            matrix[pivot][column] = ridge
        if pivot != column:
            matrix[column], matrix[pivot] = matrix[pivot], matrix[column]
            vector[column], vector[pivot] = vector[pivot], vector[column]
        divisor = matrix[column][column]
        for item in range(column, size):
            matrix[column][item] /= divisor
        vector[column] /= divisor
        for row in range(size):
            if row == column:
                continue
            factor = matrix[row][column]
            if factor == 0:
                continue
            for item in range(column, size):
                matrix[row][item] -= factor * matrix[column][item]
            vector[row] -= factor * vector[column]

    clipping = 0
    quantized_weights: list[int] = []
    for coefficient in vector[1:]:
        raw = int(
            (coefficient * DENOMINATOR).to_integral_value(
                rounding=decimal.ROUND_HALF_EVEN
            )
        )
        clipped = max(-127, min(127, raw))
        clipping += int(raw != clipped)
        quantized_weights.append(clipped)
    raw_bias = int(
        (vector[0] * FP * DENOMINATOR).to_integral_value(
            rounding=decimal.ROUND_HALF_EVEN
        )
    )
    bias = max(I32_MIN, min(I32_MAX, raw_bias))
    clipping += int(raw_bias != bias)
    return quantized_weights, bias, clipping


def class_weights(targets: Iterable[int]) -> dict[int, decimal.Decimal]:
    counts = collections.Counter(1 if target >= FP // 2 else 0 for target in targets)
    total = sum(counts.values())
    return {
        label: decimal.Decimal(total) / decimal.Decimal(2 * max(1, count))
        for label, count in counts.items()
    }


def train_heads(
    samples: Sequence[dict[str, Any]],
    weights: list[int],
    biases: list[int],
    ridge: decimal.Decimal,
) -> int:
    train_samples = [sample for sample in samples if sample["split"] == "train"]
    hidden_cache = [(sample, hidden_forward(sample, weights, biases)) for sample in train_samples]
    clipping = 0

    for head_index, target_name in enumerate(NODE_TARGETS):
        examples: list[tuple[Sequence[int], int, decimal.Decimal]] = []
        for sample, hidden in hidden_cache:
            for node_index, node in enumerate(sample["nodes"]):
                examples.append(
                    (
                        hidden[node_index],
                        int(node["labels"][target_name]),
                        decimal.Decimal(1),
                    )
                )
        head_weights, bias, clipped = fit_ridge(
            examples,
            sigmoid_target=head_index < 4,
            ridge=ridge,
        )
        start = W_NODE_HEADS + head_index * HIDDEN
        weights[start : start + HIDDEN] = head_weights
        biases[B_NODE_HEADS + head_index] = bias
        clipping += clipped

    for horizon in range(3):
        targets = [int(sample["outage_horizons_fp"][horizon]) for sample in train_samples]
        balance = class_weights(targets)
        examples = []
        for (sample, hidden), target in zip(hidden_cache, targets):
            label = 1 if target >= FP // 2 else 0
            examples.append((pooled_hidden(hidden), target, balance[label]))
        head_weights, bias, clipped = fit_ridge(
            examples,
            sigmoid_target=True,
            ridge=ridge,
        )
        start = W_OUTAGE_HEADS + horizon * HIDDEN
        weights[start : start + HIDDEN] = head_weights
        biases[B_OUTAGE_HEADS + horizon] = bias
        clipping += clipped

    lever_examples: list[tuple[Sequence[int], int, decimal.Decimal]] = []
    for sample, hidden in hidden_cache:
        pooled = pooled_hidden(hidden)
        for lever in sample["levers"]:
            cost_denominator = (int(lever["cost_ticks"]) + 1) * FP
            feature = pooled + [
                int(lever["success_probability_fp"]),
                FP if int(lever["available"]) else 0,
                fp_div(FP, cost_denominator),
            ]
            lever_examples.append(
                (
                    feature,
                    int(lever["effectiveness_fp"]),
                    decimal.Decimal(1),
                )
            )
    head_weights, bias, clipped = fit_ridge(
        lever_examples,
        sigmoid_target=True,
        ridge=ridge,
    )
    weights[W_LEVER_HEAD : W_LEVER_HEAD + HIDDEN + 3] = head_weights
    biases[B_LEVER_HEAD] = bias
    return clipping + clipped


def predict_sample(
    sample: dict[str, Any], weights: Sequence[int], biases: Sequence[int]
) -> dict[str, Any]:
    hidden = hidden_forward(sample, weights, biases)
    pooled = pooled_hidden(hidden)
    node_predictions: list[list[int]] = []
    for node_hidden in hidden:
        values = []
        for head in range(5):
            start = W_NODE_HEADS + head * HIDDEN
            raw = linear(
                node_hidden,
                weights[start : start + HIDDEN],
                biases[B_NODE_HEADS + head],
            )
            values.append(hard_sigmoid(raw) if head < 4 else max(-50_000, min(50_000, raw)))
        node_predictions.append(values)
    outage = []
    for head in range(3):
        start = W_OUTAGE_HEADS + head * HIDDEN
        outage.append(
            hard_sigmoid(
                linear(
                    pooled,
                    weights[start : start + HIDDEN],
                    biases[B_OUTAGE_HEADS + head],
                )
            )
        )
    lever_scores = []
    for lever in sample["levers"]:
        feature = pooled + [
            int(lever["success_probability_fp"]),
            FP if int(lever["available"]) else 0,
            fp_div(FP, (int(lever["cost_ticks"]) + 1) * FP),
        ]
        lever_scores.append(
            hard_sigmoid(
                linear(
                    feature,
                    weights[W_LEVER_HEAD : W_LEVER_HEAD + HIDDEN + 3],
                    biases[B_LEVER_HEAD],
                )
            )
        )
    return {"nodes": node_predictions, "outage": outage, "levers": lever_scores}


def calibration_error(predictions: Sequence[tuple[int, int]]) -> int:
    if not predictions:
        return 0
    total_error = 0
    for bin_index in range(5):
        lower = bin_index * FP // 5
        upper = (bin_index + 1) * FP // 5
        bucket = [
            (prediction, target)
            for prediction, target in predictions
            if lower <= prediction <= (upper if bin_index == 4 else upper - 1)
        ]
        if not bucket:
            continue
        mean_prediction = sum(item[0] for item in bucket) // len(bucket)
        mean_target = sum(item[1] for item in bucket) // len(bucket)
        total_error += abs(mean_prediction - mean_target) * len(bucket)
    return total_error // len(predictions)


def evaluate(
    samples: Sequence[dict[str, Any]],
    weights: Sequence[int],
    biases: Sequence[int],
) -> dict[str, Any]:
    metrics: dict[str, Any] = {}
    for split in ("train", "validation", "test"):
        selected = [sample for sample in samples if sample["split"] == split]
        node_errors = {name: [] for name in NODE_TARGETS}
        outage_pairs: list[list[tuple[int, int]]] = [[], [], []]
        lever_correct = 0
        lever_total = 0
        robustness_errors: list[int] = []
        for sample in selected:
            prediction = predict_sample(sample, weights, biases)
            for node_index, node in enumerate(sample["nodes"]):
                for head_index, target_name in enumerate(NODE_TARGETS):
                    target = int(node["labels"][target_name])
                    error = abs(prediction["nodes"][node_index][head_index] - target)
                    node_errors[target_name].append(error)
                    if sample["case"] in {
                        "missing_telemetry",
                        "multiple_failures",
                        "saturating_boundary",
                    }:
                        robustness_errors.append(error)
            for horizon in range(3):
                outage_pairs[horizon].append(
                    (
                        prediction["outage"][horizon],
                        int(sample["outage_horizons_fp"][horizon]),
                    )
                )
            if sample["levers"]:
                predicted_best = max(
                    range(len(prediction["levers"])),
                    key=lambda index: (prediction["levers"][index], -index),
                )
                actual_best = max(
                    range(len(sample["levers"])),
                    key=lambda index: (
                        int(sample["levers"][index]["effectiveness_fp"]),
                        -index,
                    ),
                )
                lever_correct += int(predicted_best == actual_best)
                lever_total += 1
        split_metrics: dict[str, Any] = {
            "samples": len(selected),
            "node_mae_fp": {
                name: sum(errors) // max(1, len(errors))
                for name, errors in node_errors.items()
            },
            "lever_top1_accuracy_fp": lever_correct * FP // max(1, lever_total),
            "robustness_node_mae_fp": sum(robustness_errors)
            // max(1, len(robustness_errors)),
            "outage": [],
        }
        for pairs in outage_pairs:
            correct = sum(
                int((prediction >= FP // 2) == (target >= FP // 2))
                for prediction, target in pairs
            )
            brier = sum((prediction - target) ** 2 for prediction, target in pairs)
            split_metrics["outage"].append(
                {
                    "accuracy_fp": correct * FP // max(1, len(pairs)),
                    "brier_fp": brier // max(1, len(pairs)) // FP,
                    "calibration_error_fp": calibration_error(pairs),
                }
            )
        metrics[split] = split_metrics
    return metrics


def export_weights(
    path: pathlib.Path, weights: Sequence[int], biases: Sequence[int]
) -> bytes:
    if len(weights) != WEIGHT_COUNT or len(biases) != BIAS_COUNT:
        raise ValueError("V1 tensor counts do not match runtime layout")
    if any(value < -127 or value > 127 for value in weights):
        raise ValueError("INT8 weight outside supported symmetric range")
    if any(value < I32_MIN or value > I32_MAX for value in biases):
        raise ValueError("INT32 bias outside supported range")
    payload_bytes = WEIGHT_COUNT + BIAS_COUNT * 4
    header = b"CAELNN1\0" + struct.pack(
        "<IIIIIIIIQ",
        1,
        0x01020304,
        FEATURES,
        HIDDEN,
        2,
        WEIGHT_COUNT,
        BIAS_COUNT,
        0,
        payload_bytes,
    )
    if len(header) != HEADER_BYTES:
        raise AssertionError("invalid V1 header size")
    payload = bytearray(header)
    payload.extend(value & 0xFF for value in weights)
    for bias in biases:
        payload.extend(struct.pack("<i", bias))
    data = bytes(payload)
    publish_bytes_exclusive(path, data)
    return data


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Train/export CAELUS Neural V1")
    parser.add_argument("--dataset", required=True, type=pathlib.Path)
    parser.add_argument("--dataset-manifest", required=True, type=pathlib.Path)
    parser.add_argument("--output-dir", required=True, type=pathlib.Path)
    parser.add_argument("--signer-identity", required=True)
    parser.add_argument(
        "--trusted-signer-file",
        type=pathlib.Path,
        default=DEFAULT_TRUSTED_SIGNER_FILE,
        help="public-key pin that signer_identity must match",
    )
    parser.add_argument("--model-id", default="caelus-bs01-synthetic-v1")
    parser.add_argument("--model-version", default="1.0.0")
    parser.add_argument("--created-utc", required=True)
    # Ridge 1.0 is the calibrated V1 default.  The previous 0.01 default
    # clipped many INT8 coefficients and materially degraded the exported
    # fixed-point heads even when the pre-quantized fit looked reasonable.
    parser.add_argument("--ridge", default="1")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    decimal.getcontext().prec = 50
    try:
        output_metadata = os.lstat(args.output_dir)
    except OSError as error:
        raise SystemExit(f"cannot stat output directory: {error}") from error
    if stat.S_ISLNK(output_metadata.st_mode) or not stat.S_ISDIR(output_metadata.st_mode):
        raise SystemExit(f"output directory does not exist: {args.output_dir}")
    if not HEX_32.fullmatch(args.signer_identity):
        raise SystemExit("--signer-identity must be 64 lowercase hex characters")
    trusted_signer = (
        read_bounded_regular_file(
            args.trusted_signer_file, 128, "trusted signer file"
        )
        .decode("ascii", errors="strict")
        .strip()
    )
    if not HEX_32.fullmatch(trusted_signer):
        raise SystemExit("trusted signer file must contain exactly 64 lowercase hex characters")
    if args.signer_identity != trusted_signer:
        raise SystemExit("--signer-identity does not match the selected trusted signer pin")
    for value, label, maximum in (
        (args.model_id, "model id", 63),
        (args.model_version, "model version", 31),
        (args.created_utc, "created timestamp", 32),
    ):
        if (
            not value
            or len(value) > maximum
            or not value.isascii()
            or any(ord(character) < 0x21 or ord(character) > 0x7E for character in value)
        ):
            raise SystemExit(
                f"{label} must be non-empty printable non-space ASCII and at most {maximum} bytes"
            )
    try:
        parsed_created_utc = datetime.datetime.strptime(
            args.created_utc, "%Y-%m-%dT%H:%M:%SZ"
        )
    except ValueError as error:
        raise SystemExit("--created-utc must use canonical YYYY-MM-DDTHH:MM:SSZ") from error
    if parsed_created_utc.strftime("%Y-%m-%dT%H:%M:%SZ") != args.created_utc:
        raise SystemExit("--created-utc is not a canonical UTC timestamp")
    try:
        ridge = decimal.Decimal(args.ridge)
    except decimal.InvalidOperation as error:
        raise SystemExit(f"invalid ridge value: {args.ridge}") from error
    if ridge <= 0 or ridge > 1:
        raise SystemExit("--ridge must be in (0, 1]")

    output_paths = {
        "weights": args.output_dir / "weights.bin",
        "manifest": args.output_dir / "manifest.json",
        "metrics": args.output_dir / "training_metrics.json",
        "training": args.output_dir / "training_manifest.json",
        "model_card": args.output_dir / "MODEL_CARD.md",
    }
    existing = [str(path) for path in output_paths.values() if path.exists()]
    if existing:
        raise SystemExit(f"refusing to overwrite existing artifacts: {', '.join(existing)}")

    dataset_manifest_data = read_bounded_regular_file(
        args.dataset_manifest, MAX_MANIFEST_BYTES, "dataset manifest"
    )
    dataset_manifest = strict_json_loads(dataset_manifest_data, "dataset manifest")
    if not isinstance(dataset_manifest, dict):
        raise SystemExit("dataset manifest must be a JSON object")
    require_exact_keys(
        dataset_manifest,
        {
            "schema_version",
            "generator",
            "generator_version",
            "engine",
            "engine_commit",
            "build_profile",
            "rng",
            "seed",
            "sample_count",
            "feature_schema_version",
            "history_ticks",
            "split_policy",
            "observer_feature_policy",
            "label_sources",
            "parameter_ranges",
            "cases",
            "dataset_blake3",
            "dataset_bytes",
        },
        "dataset manifest",
    )
    if dataset_manifest.get("schema_version") != 1:
        raise SystemExit("unsupported dataset manifest schema")
    dataset_data = read_bounded_regular_file(
        args.dataset, MAX_ARTIFACT_BYTES, "dataset"
    )
    dataset_hash, dataset_size = rust_blake3_bytes(dataset_data)
    if dataset_hash != dataset_manifest.get("dataset_blake3"):
        raise SystemExit("dataset Blake3 does not match its manifest")
    if dataset_size != dataset_manifest.get("dataset_bytes"):
        raise SystemExit("dataset byte count does not match its manifest")
    expected_manifest_fields = {
        "generator": "caelus_neural_dataset",
        "generator_version": 1,
        "engine": "caelus_core::CausalEngine",
        "build_profile": "release",
        "rng": "xoshiro256**-splitmix64",
        "feature_schema_version": 1,
        "history_ticks": 8,
        "split_policy": "rollout_id_mod_10:test=0,validation=1,train=2..9",
        "observer_feature_policy": "telemetry_only_authority_withheld_v1",
    }
    for field, expected in expected_manifest_fields.items():
        if dataset_manifest.get(field) != expected:
            raise SystemExit(f"dataset manifest field {field!r} is incompatible")
    checked_int(dataset_manifest.get("seed"), 0, (1 << 64) - 1, "manifest seed")
    checked_int(dataset_manifest.get("sample_count"), 1, 4_096, "manifest sample count")
    checked_int(
        dataset_manifest.get("dataset_bytes"),
        1,
        MAX_ARTIFACT_BYTES,
        "manifest dataset bytes",
    )
    if not isinstance(dataset_manifest.get("dataset_blake3"), str) or not HEX_32.fullmatch(
        dataset_manifest["dataset_blake3"]
    ):
        raise SystemExit("dataset manifest Blake3 is malformed")
    cases = dataset_manifest.get("cases")
    if cases != list(CASES):
        raise SystemExit("dataset manifest case catalogue is incompatible")
    expected_parameter_ranges = {
        "state_fp": [0, FP],
        "edge_multiplier_fp": [0, 4 * FP],
        "delay_ticks": [0, 7],
        "future_horizons": [4, 16, 64],
    }
    if dataset_manifest.get("parameter_ranges") != expected_parameter_ranges:
        raise SystemExit("dataset manifest parameter ranges are incompatible")
    engine_commit = dataset_manifest.get("engine_commit")
    if (
        not isinstance(engine_commit, str)
        or len(engine_commit) != 40
        or any(
            not (character.isdigit() or "a" <= character <= "f")
            for character in engine_commit
        )
    ):
        raise SystemExit("dataset manifest has invalid engine_commit provenance")
    expected_label_sources = {
        "true_state": "symbolic_engine",
        "telemetry_anomaly": "symbolic_state_vs_reported_telemetry",
        "future_outage": "dynamic_symbolic_counterfactual",
        "lever_effectiveness": "synthetic_dynamic_counterfactual_score",
        "confidence_ood_trust": "deterministic_synthetic_policy_targets",
        "salience": "feature_magnitude_not_causal_attribution",
    }
    if dataset_manifest.get("label_sources") != expected_label_sources:
        raise SystemExit("dataset label-source provenance is incompatible")
    samples = read_dataset(dataset_data)
    if len(samples) != dataset_manifest.get("sample_count"):
        raise SystemExit("dataset row count does not match its manifest")
    if len(samples) < 220:
        raise SystemExit("training requires at least 220 rollouts for per-split case coverage")
    expected_cases = set(cases)
    for split in ("train", "validation", "test"):
        observed_cases = {sample["case"] for sample in samples if sample["split"] == split}
        if observed_cases != expected_cases:
            raise SystemExit(f"{split} split does not cover the complete case catalogue")

    training_config = {
        "trainer": "caelus_decimal_ridge_v1",
        "decimal_precision": 50,
        "ridge": str(ridge),
        "weight_scale_denominator": DENOMINATOR,
        "frozen_encoder": "structured_input_projection_and_two_message_layers",
        "trained_heads": list(NODE_TARGETS) + [
            "outage_short",
            "outage_medium",
            "outage_long",
            "lever_effectiveness",
        ],
        "split_policy": dataset_manifest["split_policy"],
        "class_imbalance": "inverse_binary_frequency_for_outage_heads",
        "quantization": "round_half_even_then_symmetric_int8_clip",
        "seed": dataset_manifest["seed"],
        "observer_feature_policy": dataset_manifest["observer_feature_policy"],
        "label_sources": dataset_manifest["label_sources"],
    }
    training_config_hash = sha256_json(training_config)

    weights, biases = initialize_frozen_weights()
    clipping_count = train_heads(samples, weights, biases, ridge)
    metrics = evaluate(samples, weights, biases)
    metrics["quantization"] = {
        "coefficient_clipping_count": clipping_count,
        "weight_min": min(weights),
        "weight_max": max(weights),
        "bias_min": min(biases),
        "bias_max": max(biases),
    }
    weights_data = export_weights(output_paths["weights"], weights, biases)
    weights_hash, weights_size = rust_blake3_bytes(weights_data)

    manifest = {
        "manifest_version": 1,
        "neural_abi_version": 0x00010000,
        "feature_schema_version": 1,
        "output_schema_version": 1,
        "model_id": args.model_id,
        "model_version": args.model_version,
        "architecture_id": "caelus_temporal_mp_int8_v1",
        "weight_format": "int8_le_v1",
        "accumulator_format": "int64",
        "fixed_point_scale": FP,
        "rounding_policy": "toward_zero",
        "saturation_policy": "explicit_int64_saturating",
        "history_ticks": 8,
        "input_features": FEATURES,
        "hidden_dimensions": HIDDEN,
        "message_passing_layers": 2,
        "engine_version_min": 20_000,
        "engine_version_max": 20_000,
        "scenario_schema_min": 200,
        "scenario_schema_max": 200,
        "training_dataset_hash": dataset_hash,
        "training_config_hash": training_config_hash,
        # V1 preserves this legacy field as the weights hash. Runtime identity
        # separately commits Blake3(manifest_hash || weights_hash).
        "model_hash": weights_hash,
        "weights_hash": weights_hash,
        "weights_size": weights_size,
        "weight_count": WEIGHT_COUNT,
        "bias_count": BIAS_COUNT,
        "operators": list(OPERATORS),
        "quantization": {
            "weight_dtype": "int8",
            "accumulator_dtype": "int64",
            "weight_scale_denominator": DENOMINATOR,
            "activation_min_fp": 0,
            "activation_max_fp": FP,
        },
        "creation_metadata": {
            "created_utc": args.created_utc,
            "generator": "caelus_ml/train_v1.py",
            "synthetic_only": True,
        },
        "signer_identity": args.signer_identity,
        "external_data": [],
    }
    publish_text_exclusive(
        output_paths["manifest"], canonical_json(manifest) + "\n", encoding="ascii"
    )
    publish_text_exclusive(
        output_paths["metrics"],
        json.dumps(metrics, indent=2, sort_keys=True) + "\n",
        encoding="ascii",
    )
    training_manifest = {
        "schema_version": 1,
        "dataset_path": args.dataset.name,
        "dataset_manifest_path": args.dataset_manifest.name,
        "dataset_blake3": dataset_hash,
        "dataset_bytes": dataset_size,
        "dataset_generator": dataset_manifest["generator"],
        "dataset_generator_version": dataset_manifest["generator_version"],
        "engine_commit": dataset_manifest["engine_commit"],
        "signer_identity": args.signer_identity,
        "training_config": training_config,
        "training_config_sha256": training_config_hash,
        "weights_blake3": weights_hash,
        "weights_bytes": weights_size,
        "metrics_file": output_paths["metrics"].name,
    }
    publish_text_exclusive(
        output_paths["training"],
        json.dumps(training_manifest, indent=2, sort_keys=True) + "\n",
        encoding="ascii",
    )
    test_metrics = metrics["test"]
    model_card = f"""# {args.model_id} {args.model_version}

## Intended use

Compact offline CAELUS Neural V1 observer for deterministic assurance tests and
the BS-01 synthetic observability demonstration. The deterministic symbolic
engine remains authoritative.

## Architecture

- 16 fixed-point node features and 8-tick history
- 32-unit structured projection
- two graph message-passing layers
- true-state, anomaly, confidence, OOD, trust-delta, outage-horizon, and lever heads
- INT8 weights, INT32 biases, INT64 accumulation, denominator {DENOMINATOR}

The encoder/message layers are deterministic structured features. Output heads
are fitted with Decimal ridge regression and quantized using round-half-even.

## Provenance

- Dataset Blake3: `{dataset_hash}`
- Training configuration SHA-256: `{training_config_hash}`
- Weights Blake3: `{weights_hash}`
- Trusted signer identity: `{args.signer_identity}`
- Synthetic samples: {len(samples)}
- Symbolic engine commit/provenance: `{dataset_manifest["engine_commit"]}`

## Synthetic test metrics

- True-state ratio MAE (fixed-point): {test_metrics["node_mae_fp"]["true_state_ratio_fp"]}
- Telemetry anomaly MAE (fixed-point): {test_metrics["node_mae_fp"]["telemetry_anomaly_fp"]}
- Lever top-1 accuracy (fixed-point): {test_metrics["lever_top1_accuracy_fp"]}
- Quantized coefficient clipping count: {clipping_count}

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
"""
    publish_text_exclusive(output_paths["model_card"], model_card, encoding="utf-8")
    print(
        json.dumps(
            {
                "dataset_blake3": dataset_hash,
                "training_config_sha256": training_config_hash,
                "weights_blake3": weights_hash,
                "weights_bytes": weights_size,
                "samples": len(samples),
                "test_true_state_mae_fp": test_metrics["node_mae_fp"][
                    "true_state_ratio_fp"
                ],
            },
            sort_keys=True,
        )
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, KeyError, json.JSONDecodeError) as error:
        print(f"training/export failed: {error}", file=sys.stderr)
        raise SystemExit(2) from error
    except subprocess.CalledProcessError as error:
        print(f"artifact hashing failed: {error}", file=sys.stderr)
        raise SystemExit(error.returncode) from error
