#!/usr/bin/env python3
"""Install local-only realtime voice model files and emit JSON evidence."""

from __future__ import annotations

import argparse
import json
import pathlib
import shutil
import sys
import time
from typing import Any
from urllib.parse import urlparse

from local_voice_candidates import APPROVED_MODEL_IDS

EVIDENCE_FILE = "openclinxr-local-voice-evidence.json"


def default_cache_dir() -> pathlib.Path:
    return pathlib.Path.home() / ".cache" / "openclinxr" / "realtime-voice"


def json_dump(payload: dict[str, Any]) -> None:
    print(json.dumps(payload, sort_keys=True))


class JsonArgumentParser(argparse.ArgumentParser):
    def error(self, message: str) -> None:
        json_dump(
            {
                "kind": "local_voice_model_install_error",
                "error": "argument_error",
                "message": message,
            }
        )
        raise SystemExit(2)


def is_remote_source(value: str) -> bool:
    parsed = urlparse(value)
    return parsed.scheme in {"http", "https", "ftp", "s3", "gs"}


def model_storage_name(model_id: str) -> str:
    parts = model_id.strip().split("/")
    if (
        not model_id.strip()
        or model_id.startswith("/")
        or "\\" in model_id
        or any(part in {"", ".", ".."} for part in parts)
    ):
        raise ValueError("model_id must be a non-empty relative identifier")
    return "__".join(parts)


def source_stats(path: pathlib.Path) -> dict[str, int]:
    if path.is_file():
        return {"file_count": 1, "total_bytes": path.stat().st_size}

    file_count = 0
    total_bytes = 0
    for child in path.rglob("*"):
        if not child.is_file():
            continue
        file_count += 1
        total_bytes += child.stat().st_size
    return {"file_count": file_count, "total_bytes": total_bytes}


def copy_local_source(source: pathlib.Path, target: pathlib.Path) -> None:
    if source.is_dir():
        shutil.copytree(source, target, dirs_exist_ok=False)
        return

    target.mkdir(parents=True, exist_ok=False)
    shutil.copy2(source, target / source.name)


def build_evidence(
    *,
    model_id: str,
    source: pathlib.Path,
    target_dir: pathlib.Path,
    stats: dict[str, int],
) -> dict[str, Any]:
    return {
        "model_id": model_id,
        "source": str(source.resolve()),
        "source_type": "local_source_copy",
        "target_dir": str(target_dir),
        "installed_at_unix": int(time.time()),
        **stats,
    }


def plan_install(
    *,
    cache_dir: pathlib.Path,
    model_id: str,
    source: pathlib.Path | None,
    dry_run: bool,
) -> dict[str, Any]:
    cache_dir = cache_dir.expanduser()
    storage_name = model_storage_name(model_id)
    target_dir = cache_dir / storage_name
    source_value = str(source.expanduser().resolve()) if source is not None else None
    actions: list[dict[str, Any]] = []

    if source is None:
        actions.append({"action": "would_require_local_source" if dry_run else "missing_local_source"})
    else:
        actions.append(
            {
                "action": "would_copy_local_source" if dry_run else "copy_local_source",
                "from": source_value,
                "to": str(target_dir),
            }
        )
        actions.append(
            {
                "action": "would_write_evidence" if dry_run else "write_evidence",
                "path": str(target_dir / EVIDENCE_FILE),
            }
        )

    return {
        "kind": "local_voice_model_install",
        "cache_dir": str(cache_dir),
        "target_dir": str(target_dir),
        "model_id": model_id,
        "approved_model_ids": APPROVED_MODEL_IDS,
        "storage_name": storage_name,
        "source": source_value,
        "dry_run": dry_run,
        "installed": False,
        "actions": actions,
    }


def install(
    *,
    cache_dir: pathlib.Path,
    model_id: str,
    source: pathlib.Path | None,
    dry_run: bool,
) -> tuple[int, dict[str, Any]]:
    try:
        payload = plan_install(cache_dir=cache_dir, model_id=model_id, source=source, dry_run=dry_run)
    except ValueError as exc:
        return 2, {
            "kind": "local_voice_model_install",
            "cache_dir": str(cache_dir.expanduser()),
            "model_id": model_id,
            "approved_model_ids": APPROVED_MODEL_IDS,
            "dry_run": dry_run,
            "installed": False,
            "error": str(exc),
        }

    if model_id not in APPROVED_MODEL_IDS:
        payload["error"] = "model_id is not in the approved local realtime voice candidate list"
        return 2, payload

    if source is not None and is_remote_source(str(source)):
        payload["error"] = "remote sources are not allowed"
        return 2, payload

    if dry_run:
        return 0, payload
    if source is None:
        payload["error"] = "real installs require --source pointing at an existing local file or directory"
        return 2, payload

    source = source.expanduser()
    if not source.exists():
        payload["error"] = "source does not exist"
        return 2, payload

    target_dir = pathlib.Path(payload["target_dir"])
    if target_dir.exists():
        payload["error"] = "target model directory already exists"
        return 2, payload

    stats = source_stats(source)
    target_dir.parent.mkdir(parents=True, exist_ok=True)
    copy_local_source(source, target_dir)
    evidence = build_evidence(
        model_id=model_id,
        source=source,
        target_dir=target_dir,
        stats=stats,
    )
    (target_dir / EVIDENCE_FILE).write_text(
        json.dumps(evidence, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    payload["installed"] = True
    payload["evidence"] = evidence
    return 0, payload


def parse_args(argv: list[str]) -> argparse.Namespace:
    normalized_argv = argv[1:] if argv[:1] == ["--"] else argv
    parser = JsonArgumentParser(description=__doc__)
    parser.add_argument(
        "--cache-dir",
        type=pathlib.Path,
        default=default_cache_dir(),
        help="Local cache directory for realtime voice models.",
    )
    parser.add_argument("--model-id", required=True, help="Local model identifier, for example moshi-mlx.")
    parser.add_argument("--source", type=pathlib.Path, help="Existing local file or directory to copy.")
    parser.add_argument("--dry-run", action="store_true", help="Plan the install without creating files.")
    return parser.parse_args(normalized_argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)
    code, payload = install(
        cache_dir=args.cache_dir,
        model_id=args.model_id,
        source=args.source,
        dry_run=args.dry_run,
    )
    json_dump(payload)
    return code


if __name__ == "__main__":
    raise SystemExit(main())
