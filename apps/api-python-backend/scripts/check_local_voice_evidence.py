#!/usr/bin/env python3
"""Emit JSON evidence for local-only realtime voice model files."""

from __future__ import annotations

import argparse
import json
import pathlib
import sys
from typing import Any


EVIDENCE_FILE = "openclinxr-local-voice-evidence.json"


def default_cache_dir() -> pathlib.Path:
    return pathlib.Path.home() / ".cache" / "openclinxr" / "realtime-voice"


def json_dump(payload: dict[str, Any]) -> None:
    print(json.dumps(payload, sort_keys=True))


class JsonArgumentParser(argparse.ArgumentParser):
    def error(self, message: str) -> None:
        json_dump(
            {
                "kind": "local_voice_evidence_check_error",
                "error": "argument_error",
                "message": message,
            }
        )
        raise SystemExit(2)


def directory_stats(path: pathlib.Path) -> dict[str, int]:
    file_count = 0
    total_bytes = 0
    for child in path.rglob("*"):
        if not child.is_file():
            continue
        file_count += 1
        total_bytes += child.stat().st_size
    return {"file_count": file_count, "total_bytes": total_bytes}


def read_evidence(model_dir: pathlib.Path) -> dict[str, Any]:
    evidence_path = model_dir / EVIDENCE_FILE
    if not evidence_path.exists():
        return {}
    try:
        payload = json.loads(evidence_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        return {"evidence_error": str(exc)}
    if not isinstance(payload, dict):
        return {"evidence_error": "evidence payload must be a JSON object"}
    return payload


def model_record(model_dir: pathlib.Path) -> dict[str, Any]:
    evidence = read_evidence(model_dir)
    stats = directory_stats(model_dir)
    model_id = evidence.get("model_id") if isinstance(evidence.get("model_id"), str) else model_dir.name
    source_type = evidence.get("source_type") if isinstance(evidence.get("source_type"), str) else "unknown"
    return {
        "model_id": model_id,
        "path": str(model_dir),
        "source_type": source_type,
        "has_evidence": bool(evidence) and "evidence_error" not in evidence,
        "evidence": evidence,
        **stats,
    }


def collect(cache_dir: pathlib.Path) -> dict[str, Any]:
    cache_dir = cache_dir.expanduser()
    models: list[dict[str, Any]] = []
    if cache_dir.exists():
        models = [
            model_record(child)
            for child in sorted(cache_dir.iterdir())
            if child.is_dir()
        ]

    return {
        "kind": "local_voice_evidence_check",
        "cache_dir": str(cache_dir),
        "cache_exists": cache_dir.exists(),
        "ready": any(model["has_evidence"] and model["file_count"] > 1 for model in models),
        "models": models,
    }


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = JsonArgumentParser(description=__doc__)
    parser.add_argument(
        "--cache-dir",
        type=pathlib.Path,
        default=default_cache_dir(),
        help="Local cache directory to inspect.",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)
    json_dump(collect(args.cache_dir))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
