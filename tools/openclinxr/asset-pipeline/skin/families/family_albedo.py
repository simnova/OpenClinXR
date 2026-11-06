#!/usr/bin/env python3
"""Tone-keyed photographic family albedo resolver (st-vitphys).

bpy-free: pathlib + hashlib + json only, so both the Blender materializer
(tools/openclinxr/evidence/blender/materialize_mpfb_humanoid_candidate.py)
and the post-export byte stage
(tools/openclinxr/asset-pipeline/skin/families/apply_family_skin_albedo.py)
resolve through this ONE module and cannot drift.

deep_warm resolves to the deep family PNG. The row is selected from the
families manifest (manifest.json beside this module) with tone-check.py's
predicate: family == "deep" AND status != "staged" — so a staged candidate
row (e.g. r9) is never picked up by the producer. The manifest row supplies
family_path + family_sha256; the file sha is verified on every resolve.
No store path or sha is hardcoded here (a second declaration of the
manifest row already drifted once). Unmapped tones return None so the
caller keeps the tint-only bake. SKIN_TONE_RGB["deep_warm"] in the
materializer stays as the fallback tint and is NOT removed.
"""

import hashlib
import json
import pathlib

# Tone -> family name. Family rows (path + sha) come from the manifest.
SKIN_FAMILY_BY_TONE = {
    "deep_warm": "deep",
}

_MANIFEST_PATH = pathlib.Path(__file__).with_name("manifest.json")

# Producer resize recipe (mirrors the materializer's SKIN_FAMILY_ALBEDO_
# REPLACES_BAKE block): family PNG -> RGB -> LANCZOS -> 1024x1024, saved
# with Pillow's default PNG encoder. Both paths must use these constants.
FAMILY_BAKE_SIZE = (1024, 1024)
FAMILY_RESAMPLE_FILTER = "LANCZOS"


def _manifest_deep_row():
    """Return the selectable deep family row (status != 'staged')."""
    manifest = json.loads(_MANIFEST_PATH.read_text())
    rows = manifest.get("families", [])
    selectable = [
        r
        for r in rows
        if r.get("family") == "deep" and r.get("status") != "staged"
    ]
    if not selectable:
        raise RuntimeError(
            "st-vitphys: no selectable deep family row "
            "(family 'deep', status != 'staged') in "
            f"{_MANIFEST_PATH}"
        )
    if len(selectable) > 1:
        raise RuntimeError(
            "st-vitphys: more than one selectable deep family row: "
            + ", ".join(
                f"{r.get('family_path')}:{r.get('status')}" for r in selectable
            )
        )
    return selectable[0]


def resolve_family_albedo(tone):
    """Return (path, sha256) for a tone-keyed family albedo, or None.

    Verifies the file sha against the manifest row sha; a mismatch
    raises loudly (never silently falls back to the tint path). An unmapped
    tone returns None so the caller keeps the tint-only bake. A tone key
    removed from the table (e.g. a destructive probe) therefore REFUSES
    here instead of baking light. A missing/unreadable source file FAILS,
    never skips.
    """
    family = SKIN_FAMILY_BY_TONE.get(tone)
    if not family:
        return None
    if family != "deep":
        raise RuntimeError(f"st-vitphys: no family-row selector for {family!r}")
    row = _manifest_deep_row()
    path = pathlib.Path(row["family_path"])
    if not path.is_file():
        raise RuntimeError(f"st-vitphys: family albedo missing: {path}")
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    if digest != row["family_sha256"]:
        raise RuntimeError(
            f"st-vitphys: family albedo sha mismatch for tone {tone!r}: "
            f"file {digest[:12]}, manifest {row['family_sha256'][:12]} "
            f"({path})"
        )
    return (path, row["family_sha256"])


def family_albedo_bake_bytes(path):
    """Render the family PNG to bake-size PNG bytes (producer recipe)."""
    from PIL import Image as _PILImage

    src = _PILImage.open(str(path)).convert("RGB")
    if tuple(src.size) != tuple(FAMILY_BAKE_SIZE):
        src = src.resize(
            (FAMILY_BAKE_SIZE[0], FAMILY_BAKE_SIZE[1]), _PILImage.LANCZOS
        )
    import io as _io

    buf = _io.BytesIO()
    src.save(buf, format="PNG")
    return buf.getvalue()
