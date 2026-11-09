#!/usr/bin/env python3
"""Exact file-backed C++↔Rust neural assurance differential gate."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import re
import signal
import stat
import subprocess
import sys
import threading
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MODEL = ROOT / "models" / "assurance_v1"
DEFAULT_GOLDEN = ROOT / "tests" / "golden" / "neural_v1_differential.json"
MAX_OUTPUT_BYTES = 1_000_000
MAX_PROCESS_STREAM_BYTES = 2_000_000
MAX_PROCESS_STDIN_BYTES = 64 * 1024
HEX_32 = re.compile(r"^[0-9a-f]{64}$")


def strict_json(data: bytes, label: str) -> dict[str, Any]:
    if len(data) == 0 or len(data) > MAX_OUTPUT_BYTES:
        raise ValueError(f"{label} output must contain 1..{MAX_OUTPUT_BYTES} bytes")
    try:
        text = data.decode("utf-8", errors="strict")
    except UnicodeDecodeError as error:
        raise ValueError(f"{label} output is not UTF-8") from error

    def reject_duplicates(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
        output: dict[str, Any] = {}
        for key, value in pairs:
            if key in output:
                raise ValueError(f"{label} output contains duplicate key {key!r}")
            output[key] = value
        return output

    def reject_number(value: str) -> None:
        raise ValueError(f"{label} output contains unsupported number {value}")

    value = json.loads(
        text,
        object_pairs_hook=reject_duplicates,
        parse_float=reject_number,
        parse_constant=reject_number,
    )
    if not isinstance(value, dict):
        raise ValueError(f"{label} output must be a JSON object")
    return value


def absolute_without_symlinks(path: Path, label: str) -> Path:
    absolute = Path(os.path.abspath(os.fspath(path)))
    parts = absolute.parts
    if not parts:
        raise ValueError(f"{label} path is empty")
    current = Path(parts[0])
    for index, component in enumerate(parts[1:], start=1):
        current /= component
        try:
            metadata = os.lstat(current)
        except FileNotFoundError:
            raise
        if stat.S_ISLNK(metadata.st_mode):
            raise ValueError(f"{label} path must not traverse symlinks")
    return absolute


def read_bounded_regular(path: Path, label: str, maximum: int) -> bytes:
    path = absolute_without_symlinks(path, label)
    flags = os.O_RDONLY | getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_BINARY", 0)
    flags |= getattr(os, "O_NOFOLLOW", 0)
    descriptor = os.open(path, flags)
    try:
        metadata = os.fstat(descriptor)
        if not stat.S_ISREG(metadata.st_mode):
            raise ValueError(f"{label} must be a regular file")
        if metadata.st_size <= 0 or metadata.st_size > maximum:
            raise ValueError(f"{label} size is outside 1..{maximum} bytes")
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


def require_executable(path: Path, label: str) -> Path:
    path = absolute_without_symlinks(path, label)
    metadata = os.stat(path, follow_symlinks=False)
    if not stat.S_ISREG(metadata.st_mode) or metadata.st_size <= 0:
        raise ValueError(f"{label} must be a non-empty regular file")
    if os.name != "nt" and not os.access(path, os.X_OK):
        raise ValueError(f"{label} is not executable")
    return path


def hermetic_environment(extra: dict[str, str] | None = None) -> dict[str, str]:
    allowed = (
        "SYSTEMROOT",
        "WINDIR",
        "TEMP",
        "TMP",
        "TMPDIR",
    )
    environment = {key: os.environ[key] for key in allowed if key in os.environ}
    environment.update(
        {
            "LC_ALL": "C",
            "LANG": "C",
            "RUST_BACKTRACE": "0",
        }
    )
    if extra:
        environment.update(extra)
    return environment


def assign_windows_kill_job(process: subprocess.Popen[bytes]) -> Any:
    if os.name != "nt":
        return None
    import ctypes
    from ctypes import wintypes

    class IoCounters(ctypes.Structure):
        _fields_ = [
            ("ReadOperationCount", ctypes.c_ulonglong),
            ("WriteOperationCount", ctypes.c_ulonglong),
            ("OtherOperationCount", ctypes.c_ulonglong),
            ("ReadTransferCount", ctypes.c_ulonglong),
            ("WriteTransferCount", ctypes.c_ulonglong),
            ("OtherTransferCount", ctypes.c_ulonglong),
        ]

    class BasicLimitInformation(ctypes.Structure):
        _fields_ = [
            ("PerProcessUserTimeLimit", ctypes.c_longlong),
            ("PerJobUserTimeLimit", ctypes.c_longlong),
            ("LimitFlags", wintypes.DWORD),
            ("MinimumWorkingSetSize", ctypes.c_size_t),
            ("MaximumWorkingSetSize", ctypes.c_size_t),
            ("ActiveProcessLimit", wintypes.DWORD),
            ("Affinity", ctypes.c_size_t),
            ("PriorityClass", wintypes.DWORD),
            ("SchedulingClass", wintypes.DWORD),
        ]

    class ExtendedLimitInformation(ctypes.Structure):
        _fields_ = [
            ("BasicLimitInformation", BasicLimitInformation),
            ("IoInfo", IoCounters),
            ("ProcessMemoryLimit", ctypes.c_size_t),
            ("JobMemoryLimit", ctypes.c_size_t),
            ("PeakProcessMemoryUsed", ctypes.c_size_t),
            ("PeakJobMemoryUsed", ctypes.c_size_t),
        ]

    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.CreateJobObjectW.argtypes = [wintypes.LPVOID, wintypes.LPCWSTR]
    kernel32.CreateJobObjectW.restype = wintypes.HANDLE
    kernel32.SetInformationJobObject.argtypes = [
        wintypes.HANDLE,
        ctypes.c_int,
        wintypes.LPVOID,
        wintypes.DWORD,
    ]
    kernel32.SetInformationJobObject.restype = wintypes.BOOL
    kernel32.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
    kernel32.AssignProcessToJobObject.restype = wintypes.BOOL

    job = kernel32.CreateJobObjectW(None, None)
    if not job:
        raise OSError(ctypes.get_last_error(), "CreateJobObjectW failed")
    information = ExtendedLimitInformation()
    information.BasicLimitInformation.LimitFlags = 0x00002000
    configured = kernel32.SetInformationJobObject(
        job, 9, ctypes.byref(information), ctypes.sizeof(information)
    )
    assigned = configured and kernel32.AssignProcessToJobObject(
        job, wintypes.HANDLE(process._handle)  # type: ignore[attr-defined]
    )
    if not assigned:
        error = ctypes.get_last_error()
        kernel32.CloseHandle(job)
        raise OSError(error, "cannot assign differential process to kill-on-close job")
    return job


def close_windows_handle(handle: Any) -> None:
    if os.name == "nt" and handle:
        import ctypes

        ctypes.WinDLL("kernel32", use_last_error=True).CloseHandle(handle)


def resume_windows_process(process: subprocess.Popen[bytes]) -> None:
    if os.name != "nt":
        return
    import ctypes
    from ctypes import wintypes

    ntdll = ctypes.WinDLL("ntdll", use_last_error=True)
    ntdll.NtResumeProcess.argtypes = [wintypes.HANDLE]
    ntdll.NtResumeProcess.restype = ctypes.c_long
    status = ntdll.NtResumeProcess(
        wintypes.HANDLE(process._handle)  # type: ignore[attr-defined]
    )
    if status != 0:
        raise OSError(status, "NtResumeProcess failed")


def run_bounded(
    command: list[str],
    label: str,
    environment: dict[str, str],
    *,
    timeout: int = 60,
    stdin_data: bytes | None = None,
    working_directory: Path = ROOT,
) -> tuple[bytes, bytes]:
    if stdin_data is not None and len(stdin_data) > MAX_PROCESS_STDIN_BYTES:
        raise RuntimeError(
            f"{label} stdin exceeds {MAX_PROCESS_STDIN_BYTES} bytes"
        )
    creation_flags = 0
    start_new_session = os.name != "nt"
    if os.name == "nt":
        creation_flags = (
            getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
            | getattr(subprocess, "CREATE_SUSPENDED", 0x00000004)
        )
    process = subprocess.Popen(
        command,
        cwd=working_directory,
        env=environment,
        stdin=subprocess.PIPE if stdin_data is not None else subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        start_new_session=start_new_session,
        creationflags=creation_flags,
    )
    job_handle = None
    try:
        job_handle = assign_windows_kill_job(process)
        resume_windows_process(process)
    except OSError:
        close_windows_handle(job_handle)
        process.kill()
        process.wait(timeout=10)
        raise
    assert process.stdout is not None
    assert process.stderr is not None
    stdout = bytearray()
    stderr = bytearray()
    overflow: list[str] = []
    stdin_errors: list[str] = []
    termination_lock = threading.Lock()

    def terminate() -> None:
        nonlocal job_handle
        with termination_lock:
            if os.name != "nt":
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
            else:
                close_windows_handle(job_handle)
                job_handle = None
                if process.poll() is None:
                    process.kill()

    def drain(stream: Any, target: bytearray, stream_name: str) -> None:
        while True:
            chunk = stream.read(4096)
            if not chunk:
                return
            target.extend(chunk)
            if len(target) > MAX_PROCESS_STREAM_BYTES:
                overflow.append(stream_name)
                terminate()
                return

    def feed_stdin() -> None:
        assert process.stdin is not None
        try:
            process.stdin.write(stdin_data or b"")
            process.stdin.flush()
        except BrokenPipeError:
            pass
        except OSError as error:
            stdin_errors.append(str(error))
        finally:
            try:
                process.stdin.close()
            except OSError:
                pass

    threads = [
        threading.Thread(
            target=drain, args=(process.stdout, stdout, "stdout"), daemon=True
        ),
        threading.Thread(
            target=drain, args=(process.stderr, stderr, "stderr"), daemon=True
        ),
    ]
    if stdin_data is not None:
        threads.append(threading.Thread(target=feed_stdin, daemon=True))
    for thread in threads:
        thread.start()
    try:
        return_code = process.wait(timeout=timeout)
    except subprocess.TimeoutExpired as error:
        terminate()
        process.wait(timeout=10)
        raise RuntimeError(f"{label} timed out") from error
    finally:
        terminate()
        for thread in threads:
            thread.join(timeout=10)
        process.stdout.close()
        process.stderr.close()

    if overflow:
        raise RuntimeError(f"{label} exceeded bounded {'/'.join(overflow)}")
    if stdin_errors:
        raise RuntimeError(f"{label} stdin write failed: {stdin_errors[0]}")
    if return_code != 0:
        detail = bytes(stderr[:8192]).decode("utf-8", errors="replace").strip()
        raise RuntimeError(f"{label} failed with exit {return_code}: {detail}")
    return bytes(stdout), bytes(stderr)


def require_exact_keys(value: dict[str, Any], expected: set[str], label: str) -> None:
    if set(value) != expected:
        raise ValueError(
            f"{label} keys mismatch: unknown={sorted(set(value) - expected)}, "
            f"missing={sorted(expected - set(value))}"
        )


def require_int(value: Any, label: str, minimum: int, maximum: int) -> int:
    if type(value) is not int or not minimum <= value <= maximum:
        raise ValueError(f"{label} must be an integer in {minimum}..{maximum}")
    return value


def validate_output(value: dict[str, Any], label: str) -> dict[str, Any]:
    require_exact_keys(
        value,
        {
            "schema_version",
            "runtime_status",
            "saturation_count",
            "tick",
            "feature_schema_version",
            "model_hash",
            "scenario_hash",
            "input_hash",
            "nodes",
            "proposals",
            "lever_scores",
        },
        label,
    )
    if require_int(value["schema_version"], f"{label}.schema_version", 1, 1) != 1:
        raise AssertionError("unreachable")
    require_int(value["runtime_status"], f"{label}.runtime_status", 0, 0)
    require_int(value["saturation_count"], f"{label}.saturation_count", 0, 2**32 - 1)
    require_int(value["tick"], f"{label}.tick", 8, 8)
    require_int(
        value["feature_schema_version"], f"{label}.feature_schema_version", 1, 1
    )
    for field in ("model_hash", "scenario_hash", "input_hash"):
        if not isinstance(value[field], str) or not HEX_32.fullmatch(value[field]):
            raise ValueError(f"{label}.{field} must be 64 lowercase hex characters")
    if value["scenario_hash"] != "11" * 32:
        raise ValueError(f"{label}.scenario_hash does not identify the fixture")

    nodes = value["nodes"]
    proposals = value["proposals"]
    lever_scores = value["lever_scores"]
    if not isinstance(nodes, list) or len(nodes) != 2:
        raise ValueError(f"{label}.nodes must contain exactly two entries")
    if not isinstance(proposals, list) or len(proposals) != 2:
        raise ValueError(f"{label}.proposals must contain exactly two entries")
    if not isinstance(lever_scores, list) or len(lever_scores) != 1:
        raise ValueError(f"{label}.lever_scores must contain exactly one entry")

    node_keys = {
        "node_index",
        "estimated_true_state_fp",
        "telemetry_anomaly_score_fp",
        "confidence_fp",
        "out_of_distribution_score_fp",
        "outage_probability_short_fp",
        "outage_probability_medium_fp",
        "outage_probability_long_fp",
    }
    probability_fields = node_keys - {"node_index", "estimated_true_state_fp"}
    for index, node in enumerate(nodes):
        if not isinstance(node, dict):
            raise ValueError(f"{label}.nodes[{index}] must be an object")
        require_exact_keys(node, node_keys, f"{label}.nodes[{index}]")
        require_int(node["node_index"], f"{label}.nodes[{index}].node_index", index, index)
        require_int(
            node["estimated_true_state_fp"],
            f"{label}.nodes[{index}].estimated_true_state_fp",
            0,
            1_000_000,
        )
        for field in probability_fields:
            require_int(node[field], f"{label}.nodes[{index}].{field}", 0, 1_000_000)

    proposal_keys = {
        "kind",
        "node_index",
        "proposed_delta_fp",
        "authorized_min_fp",
        "authorized_max_fp",
    }
    for index, proposal in enumerate(proposals):
        if not isinstance(proposal, dict):
            raise ValueError(f"{label}.proposals[{index}] must be an object")
        require_exact_keys(proposal, proposal_keys, f"{label}.proposals[{index}]")
        require_int(proposal["kind"], f"{label}.proposals[{index}].kind", 1, 1)
        require_int(
            proposal["node_index"],
            f"{label}.proposals[{index}].node_index",
            index,
            index,
        )
        minimum = require_int(
            proposal["authorized_min_fp"],
            f"{label}.proposals[{index}].authorized_min_fp",
            -50_000,
            0,
        )
        maximum = require_int(
            proposal["authorized_max_fp"],
            f"{label}.proposals[{index}].authorized_max_fp",
            0,
            50_000,
        )
        require_int(
            proposal["proposed_delta_fp"],
            f"{label}.proposals[{index}].proposed_delta_fp",
            minimum,
            maximum,
        )

    score = lever_scores[0]
    if not isinstance(score, dict):
        raise ValueError(f"{label}.lever_scores[0] must be an object")
    require_exact_keys(score, {"lever_index", "score_fp"}, f"{label}.lever_scores[0]")
    require_int(score["lever_index"], f"{label}.lever_scores[0].lever_index", 0, 0)
    require_int(score["score_fp"], f"{label}.lever_scores[0].score_fp", 0, 1_000_000)
    return value


def run_cpp(binary: Path, model_directory: Path, label: str) -> dict[str, Any]:
    stdout, stderr = run_bounded(
        [str(binary), str(model_directory)],
        label,
        hermetic_environment(),
        timeout=30,
    )
    if stderr:
        raise RuntimeError(f"{label} emitted unexpected stderr")
    return validate_output(strict_json(stdout, label), label)


def run_rust(
    binary: Path, model_directory: Path, label: str
) -> dict[str, Any]:
    stdout, stderr = run_bounded(
        [
            str(binary),
            str(model_directory / "manifest.json"),
            str(model_directory / "weights.bin"),
        ],
        label,
        hermetic_environment(),
        timeout=30,
    )
    if stderr:
        raise RuntimeError(f"{label} emitted unexpected stderr")
    return validate_output(strict_json(stdout, label), label)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cpp-binary", type=Path, required=True)
    parser.add_argument("--rust-binary", type=Path, required=True)
    parser.add_argument("--model-dir", type=Path, default=DEFAULT_MODEL)
    parser.add_argument("--golden", type=Path, default=DEFAULT_GOLDEN)
    arguments = parser.parse_args()

    cpp_binary = require_executable(arguments.cpp_binary, "C++ reference binary")
    rust_binary = require_executable(arguments.rust_binary, "Rust reference binary")
    model_directory = absolute_without_symlinks(
        arguments.model_dir, "model directory"
    )
    if not model_directory.is_dir():
        raise ValueError("model directory must be a directory")
    read_bounded_regular(model_directory / "manifest.json", "model manifest", 64 * 1024)
    read_bounded_regular(
        model_directory / "weights.bin", "model weights", 16 * 1024 * 1024
    )
    read_bounded_regular(model_directory / "model.sig", "model signature", 512)

    cpp_first = run_cpp(cpp_binary, model_directory, "C++ neural reference")
    cpp_second = run_cpp(cpp_binary, model_directory, "C++ neural reference replay")
    rust_first = run_rust(rust_binary, model_directory, "Rust neural reference")
    rust_second = run_rust(
        rust_binary, model_directory, "Rust neural reference replay"
    )

    if cpp_first != cpp_second:
        raise RuntimeError("C++ deterministic replay diverged")
    if rust_first != rust_second:
        raise RuntimeError("Rust deterministic replay diverged")
    if cpp_first != rust_first:
        raise RuntimeError(
            "C++ and Rust neural outputs diverged\n"
            f"C++:\n{json.dumps(cpp_first, indent=2, sort_keys=True)}\n"
            f"Rust:\n{json.dumps(rust_first, indent=2, sort_keys=True)}"
        )

    expected = validate_output(
        strict_json(
            read_bounded_regular(
                arguments.golden, "neural differential golden", MAX_OUTPUT_BYTES
            ),
            "neural differential golden",
        ),
        "neural differential golden",
    )
    if cpp_first != expected:
        raise RuntimeError("neural differential output changed; review the fixture")

    print(
        "neural differential: PASS "
        f"input={cpp_first['input_hash']} model={cpp_first['model_hash']}"
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, RuntimeError) as error:
        print(f"neural differential: FAIL: {error}", file=sys.stderr)
        raise SystemExit(1)
