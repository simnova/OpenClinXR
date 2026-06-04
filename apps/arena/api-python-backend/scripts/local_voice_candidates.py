"""Approved local realtime voice model candidates for developer-only evidence."""

from __future__ import annotations

from copy import deepcopy
from typing import Any


APPROVED_PROPOSAL = "proposals/approved/proposal-local-realtime-voice-model-inference.md"


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


APPROVED_MODEL_CANDIDATES = {
    "kyutai/moshiko-mlx-q4": {
        "model_id": "kyutai/moshiko-mlx-q4",
        "storage_name": model_storage_name("kyutai/moshiko-mlx-q4"),
        "runtime_role": "full_duplex_dialog",
        "approved_proposal": APPROVED_PROPOSAL,
        "posture": "local_research_only",
        "minimum_total_bytes": 100_000_000,
        "required_config_files": ["config.json"],
        "weight_file_extensions": [".bin", ".pt", ".safetensors"],
    },
    "mlx-community/Qwen3-TTS-12Hz-0.6B-Base-4bit": {
        "model_id": "mlx-community/Qwen3-TTS-12Hz-0.6B-Base-4bit",
        "storage_name": model_storage_name("mlx-community/Qwen3-TTS-12Hz-0.6B-Base-4bit"),
        "runtime_role": "streaming_tts_fallback",
        "approved_proposal": APPROVED_PROPOSAL,
        "posture": "local_research_only",
        "minimum_total_bytes": 100_000_000,
        "required_config_files": ["config.json"],
        "weight_file_extensions": [".bin", ".pt", ".safetensors"],
    },
}

APPROVED_MODEL_IDS = list(APPROVED_MODEL_CANDIDATES)


def approved_candidate_metadata(model_id: str) -> dict[str, Any] | None:
    candidate = APPROVED_MODEL_CANDIDATES.get(model_id)
    return deepcopy(candidate) if candidate else None
