#!/usr/bin/env python3
"""Build and run the deterministic CAELUS symbolic dataset generator.

This wrapper is training-only. The production CAELUS binary does not invoke
Python and does not depend on this script.
"""

from __future__ import annotations

import argparse
import pathlib
import subprocess
import sys


ROOT = pathlib.Path(__file__).resolve().parents[1]
CORE_MANIFEST = ROOT / "caelus_core" / "Cargo.toml"


def assert_clean_checkout() -> None:
    status = subprocess.run(
        ["git", "status", "--porcelain=v1", "--untracked-files=all"],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    if status.stdout:
        raise SystemExit(
            "refusing to record Git provenance outside a clean checkout"
        )


def current_commit() -> str:
    assert_clean_checkout()
    result = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    return result.stdout.strip()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Generate deterministic neural JSONL from caelus_core"
    )
    parser.add_argument("--output", required=True, type=pathlib.Path)
    parser.add_argument("--manifest", required=True, type=pathlib.Path)
    parser.add_argument("--samples", type=int, default=220)
    parser.add_argument("--seed", default="0xCAE105DEADBEEF00")
    parser.add_argument(
        "--engine-commit",
        help="provenance identifier (defaults to git HEAD)",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    commit = current_commit()
    if args.engine_commit is not None and args.engine_commit != commit:
        raise SystemExit("--engine-commit does not match the clean repository HEAD")
    for path in (args.output, args.manifest):
        parent = path.resolve().parent
        if not parent.is_dir():
            raise SystemExit(f"parent directory does not exist: {parent}")
        if path.exists():
            raise SystemExit(f"refusing to overwrite existing file: {path}")

    command = [
        "cargo",
        "run",
        "--locked",
        "--offline",
        "--manifest-path",
        str(CORE_MANIFEST),
        "--features",
        "std",
        "--bin",
        "caelus_neural_dataset",
        "--release",
    ]
    command.extend(
        [
            "--",
            "--output",
            str(args.output),
            "--manifest",
            str(args.manifest),
            "--samples",
            str(args.samples),
            "--seed",
            args.seed,
            "--engine-commit",
            commit,
        ]
    )
    try:
        subprocess.run(command, cwd=ROOT, check=True)
        assert_clean_checkout()
    except BaseException:
        # Never leave an apparently valid artifact after source provenance
        # changed during generation.
        args.output.unlink(missing_ok=True)
        args.manifest.unlink(missing_ok=True)
        raise
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except subprocess.CalledProcessError as error:
        print(f"dataset generation failed: {error}", file=sys.stderr)
        raise SystemExit(error.returncode) from error
