"""Case-declared pregnancy -> localized gravid abdomen morph (#509/#581).

The OB case fixture declares "34 weeks pregnant"
(packages/openclinxr/scenario-fixtures/src/ob-preeclampsia.ts persona brief);
before this module nothing in the humanoid pipeline consumed it (measured,
planted contract tools/openclinxr/evidence/the-case-declared-pregnancy-reaches-a-vertex.test.ts).

MEASURED 2026-08-21 (orchestrator, reproduced by worker against base.obj):
MakeHuman's stock stomach-pregnant-incr target carries 607 vertex deltas of
which 238 land in the CHEST stature band (.62-.70) and 163 in the ABDOMEN band
(.50-.58). Applied whole it widens the mid-torso (the counterweight-forbidden
"obese figure": chest +72 mm at weight 1.0) and can never clear the contract's
derived abdomen/chest threshold of 1.476.

THE DERIVATION (D1 — wire the proven tool, author nothing):
keep only the deltas MakeHuman itself authored for ABDOMEN-band vertices and
drop the rest. Every retained displacement vector is upstream MakeHuman data,
byte-read from the provider-cache target; the filter selects WHERE it applies,
it does not invent geometry. The result loads through MPFB's own
TargetService.load_target (the same service the pipeline already drives for
macros and face keys) and is baked into the body basis like the macros are
(materialize main(): "bake_targets immediately after create_human").

Band edges: [0.500, 0.600) of stature. The chest counterweight band starts at
0.62 and the hip counterweight band ends at 0.50, so a kept delta can touch
neither (verified per-vertex in derive_localized_gravid_target's report).

claimScope: case-declared gestational age reaching the generated body's
abdomen region.
notEvidenceFor: clinical accuracy of the silhouette, fundal height, or
gestational-age estimation from a rendered figure.
"""

from __future__ import annotations

import gzip
import json
from pathlib import Path

import bpy  # provided by the Blender host process; not resolvable by plain Python LSP

# Abdomen window in stature fraction. Chest band (.62-.70) and hip band
# (.44-.50) — the two counterweight surfaces — are outside it by construction.
ABDOMEN_BAND = (0.500, 0.600)

# Post-displacement guards (#581 round 2, measured): a kept delta whose vertex
# lands OUTSIDE the abdomen window AFTER the weighted displacement drags
# protected-band surface across the measurement boundary. At weight 0.85 the
# unguarded set moved the contract's hip reading 6.2 mm (limit 4) not by
# growing the hip but by pulling the waist-front extreme DOWN out of the hip
# band. Guard rule derived from the counterweights themselves: keep a delta
# only when the displaced vertex stays strictly inside
# (HIP_GUARD, CHEST_GUARD) — i.e. a gravid abdomen must never displace
# hip- or chest-band surface, even transitively.
HIP_GUARD = 0.505
CHEST_GUARD = 0.615

STOMACH_PREGNANT_INCR = "data/targets/stomach/stomach-pregnant-incr.target.gz"
BASE_OBJ = "data/3dobjs/base.obj"


def _base_mesh_stature(mpfb_root: Path) -> tuple[list[tuple[float, float, float]], float, float]:
    """Read MakeHuman base.obj vertex positions (its native units and Y-up frame)."""
    obj = mpfb_root / BASE_OBJ
    if not obj.is_file():
        raise RuntimeError(f"#509: MakeHuman base mesh missing: {obj}")
    verts: list[tuple[float, float, float]] = []
    with open(obj, encoding="utf-8") as fh:
        for line in fh:
            if line.startswith("v "):
                parts = line.split()
                verts.append((float(parts[1]), float(parts[2]), float(parts[3])))
    if len(verts) < 13000:
        raise RuntimeError(f"#509: implausibly small base.obj ({len(verts)} verts): {obj}")
    ys = [v[1] for v in verts]
    return verts, min(ys), max(ys)


def derive_localized_gravid_target(
    mpfb_root: Path, out_path: Path, *, weight: float = 0.85
) -> dict:
    """Write an abdomen-localized .target built ONLY from MakeHuman's own deltas.

    weight is the production morph weight (weeks/40) — the post-displacement
    guards must evaluate the displacement at the weight that will actually be
    applied. Returns a report with the per-band disposition of every stock
    delta so the filter's effect is auditable without re-running Blender.
    """
    src = mpfb_root / STOMACH_PREGNANT_INCR
    if not src.is_file():
        raise RuntimeError(f"#509: stock pregnancy target missing: {src}")
    verts, min_y, max_y = _base_mesh_stature(mpfb_root)
    stature = max_y - min_y
    if stature <= 0:
        raise RuntimeError("#509: degenerate base.obj stature")

    kept: list[str] = []
    report_counts: dict[str, int] = {
        "kept_abdomen_band": 0,
        "dropped_chest_band": 0,
        "dropped_hip_band": 0,
        "dropped_other_band": 0,
        "dropped_post_displacement_guard": 0,
    }
    kept_max_frac = 0.0
    kept_min_frac = 1.0
    with gzip.open(src, "rt", encoding="utf-8") as fh:
        for line in fh:
            parts = line.split()
            if len(parts) != 4:
                continue
            idx = int(parts[0])
            dx, dy, dz = float(parts[1]), float(parts[2]), float(parts[3])
            y_frac = (verts[idx][1] - min_y) / stature
            in_window = ABDOMEN_BAND[0] <= y_frac < ABDOMEN_BAND[1]
            if not in_window:
                if 0.62 <= y_frac <= 0.70:
                    report_counts["dropped_chest_band"] += 1
                elif 0.44 <= y_frac <= 0.50:
                    report_counts["dropped_hip_band"] += 1
                else:
                    report_counts["dropped_other_band"] += 1
                continue
            # Post-displacement guard (see HIP_GUARD/CHEST_GUARD): the vertex's
            # weighted-displaced position must stay inside the guarded window.
            y_after = y_frac + weight * dy / stature
            if not (HIP_GUARD < y_after < CHEST_GUARD):
                report_counts["dropped_post_displacement_guard"] += 1
                continue
            kept.append(line if line.endswith("\n") else line + "\n")
            report_counts["kept_abdomen_band"] += 1
            kept_max_frac = max(kept_max_frac, y_frac)
            kept_min_frac = min(kept_min_frac, y_frac)

    if report_counts["kept_abdomen_band"] == 0:
        raise RuntimeError("#509: derivation kept zero deltas — band edges do not match base.obj")
    if report_counts["dropped_chest_band"] == 0:
        raise RuntimeError(
            "#509: stock target carried no chest-band deltas; the localization premise is stale"
        )

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text("".join(kept), encoding="utf-8")

    return {
        "sourceTarget": str(src),
        "derivedTarget": str(out_path),
        "baseMeshVerts": len(verts),
        "stockDeltaTotal": sum(report_counts.values()),
        "bandDisposition": report_counts,
        "keptStatureFractionRange": [round(kept_min_frac, 4), round(kept_max_frac, 4)],
        "abdomenBand": list(ABDOMEN_BAND),
        "postDisplacementGuards": [HIP_GUARD, CHEST_GUARD],
        "derivationWeight": round(weight, 4),
    }


def apply_case_driven_gravid_morph(
    human,
    *,
    weeks: float | None,
    target_path: Path,
    weight_override: float | None = None,
) -> dict:
    """Load the localized target onto the MPFB basemesh at the case-driven weight.

    weeks=None (no declared pregnancy) is a no-op — actors whose case declares
    no pregnancy are untouched BY CONSTRUCTION, which is what keeps the
    three non-pregnant counterweight actors byte-stable.

    Weight semantics: gestational-weeks/40 (full-term = 1.0). weight_override
    exists only for the recorded calibration sweep; production bakes pass the
    weeks value alone.
    """
    if weeks is None:
        return {"applied": False, "reason": "no declared pregnancy for this actor"}
    if not target_path.is_file():
        raise RuntimeError(f"#509: derived gravid target missing: {target_path}")

    weight = float(weight_override) if weight_override is not None else float(weeks) / 40.0
    if not 0.0 < weight <= 1.0:
        raise RuntimeError(f"#509: gravid morph weight {weight} outside (0, 1]")

    from bl_ext.user_default.mpfb.services.targetservice import TargetService  # noqa: E402

    shape_key = TargetService.load_target(human, str(target_path), weight=weight)
    bpy.context.view_layer.update()

    return {
        "applied": True,
        "weeks": float(weeks),
        "weight": round(weight, 4),
        "shapeKey": shape_key.name if shape_key is not None else None,
        "targetPath": str(target_path),
    }


def bake_gravid_morph_into_basis(human) -> None:
    """Fold ONLY the gravid morph into the basis via MPFB's own bulk bake.

    MEASURED 2026-08-22, two rounds:

    Round 1 — TargetService.bake_targets folds EVERY key: aisha's default $md-*
    macro keys baked in too, moving hip/stature/head far outside the gravid
    bands (hip reading −6.2 mm at morph weight ~0.001) and failing the planted
    hip counterweight. The macro bake is not a no-op on this path.

    Round 2 — a hand vertex-loop + shape_key_remove (basis += key delta, drop
    the key) is silently wiped downstream: ExportService.bake_modifiers_remove_helpers
    runs TargetService.reapply_all_details when any non-viseme key exists, and
    the rebuild path resets the edited basis back to the macro-defined body
    (measured: post-strip fingerprint identical to the weeks=0 control).

    Round 3 (this) — zero every other key's value, call MPFB's own
    TargetService.bake_targets so the mix (= pristine macros + gravid only)
    becomes the basis, then restore every key's prior value. Face/expression/
    viseme keys ride at their original values on the new basis; the materializer's
    post-strip MACRO_KEYS_REMOVED guard deletes re-added $md keys exactly as it
    does on the weeks=0 path. D1: the deformation still flows through MPFB's
    service; only the VALUES are staged around its call.
    """
    key_blocks = list(human.data.shape_keys.key_blocks) if human.data.shape_keys else []
    gravid = next((kb for kb in key_blocks if kb.name == "derived-gravid-abdomen"), None)
    if gravid is None:
        raise RuntimeError(
            "#581: derived-gravid-abdomen key not found — apply_case_driven_gravid_morph "
            "must run before bake_gravid_morph_into_basis"
        )
    restored: list[tuple[object, float]] = []
    for kb in key_blocks:
        if kb.name == "derived-gravid-abdomen":
            continue
        if abs(kb.value) > 1e-9:
            restored.append((kb, kb.value))
            kb.value = 0.0
    # Bake at the key's own case-driven value (weeks/40), NOT 1.0 — measured round 3:
    # baking at 1.0 overshoots the calibration-swept weight and inflates the abdomen
    # reading past the graded treatment row. The mix = pristine macros + gravid at
    # its own value; other keys contribute nothing (zeroed).

    from bl_ext.user_default.mpfb.services.targetservice import TargetService  # noqa: E402

    TargetService.bake_targets(human)

    for kb, value in restored:
        kb.value = value
    bpy.context.view_layer.update()


if __name__ == "__main__":  # pragma: no cover - manual inspection helper
    import sys

    root = Path(sys.argv[sys.argv.index("--") + 1]) if "--" in sys.argv else Path.cwd()
    print(json.dumps(derive_localized_gravid_target(root, Path("/tmp/derived-gravid.target")), indent=1))
