#!/usr/bin/env python3
"""Emit JSON evidence for local-only realtime voice model files."""

from __future__ import annotations

import argparse
import json
import pathlib
import sys
from typing import Any

from local_voice_candidates import APPROVED_MODEL_IDS, approved_candidate_metadata, model_storage_name

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
    has_evidence = bool(evidence) and "evidence_error" not in evidence
    approved = model_id in APPROVED_MODEL_IDS
    expected_storage_name = expected_storage_name_for(model_id)
    storage_name_matches = expected_storage_name == model_dir.name
    candidate = approved_candidate_metadata(model_id)
    candidate_matches = evidence.get("candidate") == candidate if candidate is not None else False
    source_type_allowed = source_type == "local_source_copy"
    blockers = [
        None if approved else "model_id_not_approved_for_local_realtime_voice_spike",
        None if has_evidence else "model_evidence_file_missing_or_invalid",
        None if source_type_allowed else "model_source_type_not_local_source_copy",
        None if storage_name_matches else "model_storage_name_mismatch",
        None if candidate_matches else "model_candidate_metadata_missing_or_mismatched",
        None if stats["file_count"] > 1 else "model_file_count_under_2",
    ]
    ready = approved and has_evidence and source_type_allowed and storage_name_matches and candidate_matches and stats["file_count"] > 1
    return {
        "model_id": model_id,
        "path": str(model_dir),
        "source_type": source_type,
        "expected_storage_name": expected_storage_name,
        "approved": approved,
        "has_evidence": has_evidence,
        "ready": ready,
        "blockers": [blocker for blocker in blockers if blocker is not None],
        "evidence": evidence,
        **stats,
    }


def expected_storage_name_for(model_id: str) -> str | None:
    try:
        return model_storage_name(model_id)
    except ValueError:
        return None


def support_directory_record(directory: pathlib.Path) -> dict[str, Any]:
    return {
        "path": str(directory),
        "name": directory.name,
        "reason": "runtime_support_venv_not_model_weights",
        **directory_stats(directory),
    }


def is_support_directory(path: pathlib.Path) -> bool:
    return path.name in {"venv", ".venv"} or path.name.endswith("-venv")


def collect(cache_dir: pathlib.Path) -> dict[str, Any]:
    cache_dir = cache_dir.expanduser()
    models: list[dict[str, Any]] = []
    support_directories: list[dict[str, Any]] = []
    if cache_dir.exists():
        models = [
            model_record(child)
            for child in sorted(cache_dir.iterdir())
            if child.is_dir() and not is_support_directory(child)
        ]
        support_directories = [
            support_directory_record(child)
            for child in sorted(cache_dir.iterdir())
            if child.is_dir() and is_support_directory(child)
        ]

    return {
        "kind": "local_voice_evidence_check",
        "cache_dir": str(cache_dir),
        "approved_model_ids": APPROVED_MODEL_IDS,
        "cache_exists": cache_dir.exists(),
        "ready": any(model["ready"] for model in models),
        "models": models,
        "support_directories": support_directories,
    }


def parse_args(argv: list[str]) -> argparse.Namespace:
    normalized_argv = argv[1:] if argv[:1] == ["--"] else argv
    parser = JsonArgumentParser(description=__doc__)
    parser.add_argument(
        "--cache-dir",
        type=pathlib.Path,
        default=default_cache_dir(),
        help="Local cache directory to inspect.",
    )
    parser.add_argument(
        "--output",
        type=pathlib.Path,
        help="Optional JSON output file for committed local evidence.",
    )
    return parser.parse_args(normalized_argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)
    payload = collect(args.cache_dir)
    if args.output is not None:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    json_dump(payload)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
