"""Explicit Tara factory-skin recipe. One id, job-root confinement, no other actors."""
import hashlib
import json
import uuid
from pathlib import Path

RECIPE_ID = "tara-cc0-final-rest-v1"
MATERIAL_NAME = "mpfb_skin_peds_anxious_parent"
OUTPUT_STEM = "mpfb-peds-parent-aisha"


def repo_root():
    # factory-finish/ -> skin/ -> asset-pipeline/ -> openclinxr/ -> tools/ -> repo
    return Path(__file__).resolve().parents[5]


def authored_path():
    return Path(__file__).resolve().parent / "tara-cc0-v1.json"


def require_recipe(recipe_id):
    if recipe_id != RECIPE_ID:
        raise RuntimeError(f"unsupported skin recipe {recipe_id!r}")
    return recipe_id


def bake_settings(data):
    """Validated graph/tool settings. Callers pass this dict; they do not read DERMAL_*."""
    bake = data.get("bake") if isinstance(data, dict) else None
    if not isinstance(bake, dict):
        raise RuntimeError("authored recipe missing bake graph settings")
    resolution = bake.get("resolution")
    if (
        not isinstance(resolution, list)
        or len(resolution) != 2
        or not isinstance(resolution[0], int)
        or not isinstance(resolution[1], int)
        or resolution[0] != resolution[1]
        or resolution[0] < 1
    ):
        raise RuntimeError("authored bake resolution must be a positive square")
    if bake.get("frequencyUnits") != "authored-texture-frequency":
        raise RuntimeError("authored frequencyUnits must be authored-texture-frequency")
    cycles = bake.get("cycles") if isinstance(bake.get("cycles"), dict) else {}
    dermal = bake.get("dermal") if isinstance(bake.get("dermal"), dict) else {}
    tools = bake.get("tools") if isinstance(bake.get("tools"), dict) else {}
    for key in ("device", "samples", "margin", "normalSpace"):
        if key not in cycles:
            raise RuntimeError(f"authored bake cycles missing {key}")
    for key in ("cellTexels", "bumpStrength", "voronoiFeature", "voronoiRandomness", "rampValley", "rampPeak"):
        if key not in dermal:
            raise RuntimeError(f"authored bake dermal missing {key}")
    if tools.get("mpfbModule") != "bl_ext.user_default.mpfb":
        raise RuntimeError("authored recipe mpfb module is not the installed addon")
    if cycles["normalSpace"] != "TANGENT":
        raise RuntimeError("authored normal space must be TANGENT")
    if cycles["device"] not in ("CPU", "GPU"):
        raise RuntimeError("authored cycles device must be CPU or GPU")
    if not isinstance(cycles["samples"], int) or not isinstance(cycles["margin"], int):
        raise RuntimeError("authored cycles samples and margin must be integers")
    return {
        "resolution": [resolution[0], resolution[1]],
        "frequencyUnits": "authored-texture-frequency",
        "cycles": {
            "device": cycles["device"],
            "samples": cycles["samples"],
            "margin": cycles["margin"],
            "normalSpace": cycles["normalSpace"],
        },
        "dermal": {
            "cellTexels": float(dermal["cellTexels"]),
            "bumpStrength": float(dermal["bumpStrength"]),
            "voronoiFeature": str(dermal["voronoiFeature"]),
            "voronoiRandomness": float(dermal["voronoiRandomness"]),
            "rampValley": float(dermal["rampValley"]),
            "rampPeak": float(dermal["rampPeak"]),
        },
        "tools": {"mpfbModule": "bl_ext.user_default.mpfb"},
    }


def bake_fingerprint(settings):
    payload = json.dumps(settings, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def load_authored():
    path = authored_path()
    data = json.loads(path.read_text(encoding="utf-8"))
    if data.get("id") != RECIPE_ID:
        raise RuntimeError(f"authored recipe id mismatch in {path}")
    if data.get("materialName") != MATERIAL_NAME:
        raise RuntimeError("authored recipe material mismatch")
    if data.get("outputStem") != OUTPUT_STEM:
        raise RuntimeError("authored recipe output stem mismatch")
    bake_settings(data)
    return data, path


RESERVATION_NAME = "reservation.json"


def _load_reservation(attempt):
    marker = Path(attempt).resolve() / RESERVATION_NAME
    if not marker.is_file():
        raise RuntimeError(f"reservation marker missing: {marker}")
    try:
        reservation = json.loads(marker.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"reservation marker is not json: {exc}") from exc
    if not isinstance(reservation, dict):
        raise RuntimeError("reservation marker is not an object")
    return reservation


def _require_uuid4(value, attempt_name):
    if not isinstance(value, str) or value == attempt_name:
        raise RuntimeError("reservation runId must be a UUID4, not the attempt basename")
    try:
        parsed = uuid.UUID(value)
    except ValueError as exc:
        raise RuntimeError(f"reservation runId is not a UUID: {value}") from exc
    if parsed.version != 4 or str(parsed) != value:
        raise RuntimeError(f"reservation runId is not canonical UUID4: {value}")
    return value


def reserve_attempt(job_root, attempt):
    """Create one empty reserved attempt with a new UUID4 run id. Refuse a directory that already exists."""
    job = Path(job_root).resolve()
    attempt = Path(attempt).resolve()
    if not job.is_dir():
        raise RuntimeError(f"skin job root does not exist: {job}")
    if not attempt.is_relative_to(job):
        raise RuntimeError(f"path outside job root: {attempt}")
    if attempt.exists():
        raise RuntimeError(f"refusing to reuse skin attempt {attempt}")
    attempt.mkdir(parents=False)
    run_id = str(uuid.uuid4())
    payload = {
        "schema": "openclinxr.factory-skin-attempt-reservation.v1",
        "attempt": attempt.name,
        "runId": run_id,
        "jobRoot": str(job),
    }
    marker = attempt / RESERVATION_NAME
    marker.write_text(json.dumps(payload) + "\n", encoding="utf-8")
    return marker


def assert_reserved_attempt(job_root, attempt):
    """A selected replay may enter a reserved attempt. A used or tampered attempt is refused."""
    job = confine(job_root, attempt)
    attempt = Path(attempt).resolve()
    if not attempt.is_dir() or not (attempt / RESERVATION_NAME).is_file():
        raise RuntimeError(f"skin attempt is not reserved: {attempt}")
    used = sorted(path.name for path in attempt.iterdir() if path.name != RESERVATION_NAME)
    if used:
        raise RuntimeError(f"refusing used skin attempt {attempt}: {used}")
    reservation = _load_reservation(attempt)
    if reservation.get("schema") != "openclinxr.factory-skin-attempt-reservation.v1":
        raise RuntimeError("reservation schema mismatch")
    if reservation.get("attempt") != attempt.name:
        raise RuntimeError("reservation attempt name mismatch")
    if reservation.get("jobRoot") != str(job):
        raise RuntimeError("reservation jobRoot mismatch")
    _require_uuid4(reservation.get("runId"), attempt.name)
    return job


def get_run_id(attempt):
    """Return the persisted UUID4 run id. Fail closed on a missing or tampered marker."""
    attempt = Path(attempt).resolve()
    reservation = _load_reservation(attempt)
    return _require_uuid4(reservation.get("runId"), attempt.name)


def confine(job_root, *paths):
    job = Path(job_root).resolve()
    if not job.is_dir():
        raise RuntimeError(f"skin job root does not exist: {job}")
    for raw in paths:
        resolved = Path(raw).resolve()
        if not resolved.is_relative_to(job):
            raise RuntimeError(f"path outside job root: {resolved}")
    return job
