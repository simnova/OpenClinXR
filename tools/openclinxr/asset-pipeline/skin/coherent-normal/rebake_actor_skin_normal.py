#!/usr/bin/env python3
"""st-vitfacet r7b: tracked normal-only skin rebake for ONE actor stem.

Promoted from the untracked r7 evidence script (r7_rebake.py): reference
bodies are built exactly as materialize main builds them, then
bake_skin_normal_to_texture bakes at 1024. Differences vs r7_rebake.py:
(1) E-path constants are CLI args (--actor-stem, --out); (2) there is NO
assignment of DERMAL_SEED anywhere in this file — the seed reaches the bake
through materialize's own tracked default for the stem it is given
(_resolve_dermal_seed(stem) -> _dermal_seed_for_stem(output stem)), so a
rebake through tracked tools reproduces the R7 bytes; DERMAL_SEED env set
refuses loudly instead of silently shadowing the stem; (3) this producer
writes the PNG, the bake JSON, AND the rebind-report JSON (recipe string
keeps -seed<v> exactly as R7 provenance carries it, e.g.
...ramp0-1-seed5.19; seed0-nostem is recorded only when no stem is available,
which cannot happen here since --actor-stem is required); the generator names
this tracked command plus the tracked rebind stage.

Run: blender --background --python <this file> -- --actor-stem <stem> --out <png>
Known stems: mpfb-clinical-nurse-adult, mpfb-clinical-physician-adult,
mpfb-peds-nurse-kevin, mpfb-street-adult-male, mpfb-viseme-inspect,
mpfb-gown-inspect. Unknown stems refuse loudly.
"""
import argparse
import hashlib
import importlib.util
import json
import os
import pathlib
import struct
import sys

import bpy
import numpy as np

REPO_ROOT = pathlib.Path(__file__).resolve().parents[5]
GEN_HUMANOIDS = REPO_ROOT / "apps/ui-xr/public/generated-humanoids"

bpy.ops.preferences.addon_enable(module="bl_ext.user_default.mpfb")
assert "bl_ext.user_default.mpfb" in bpy.context.preferences.addons
print("MPFB_ADDON enabled", flush=True)

from bl_ext.user_default.mpfb.services.humanservice import HumanService  # noqa: E402
from bl_ext.user_default.mpfb.services.materialservice import MaterialService  # noqa: E402
from bl_ext.user_default.mpfb.services.targetservice import TargetService  # noqa: E402

_spec = importlib.util.spec_from_file_location(
    "rebake_actor_skin_normal_materialize",
    str(REPO_ROOT / "tools/openclinxr/evidence/blender/materialize_mpfb_humanoid_candidate.py"),
)
assert _spec is not None and _spec.loader is not None
mod = importlib.util.module_from_spec(_spec)
sys.modules[_spec.name] = mod
_spec.loader.exec_module(mod)

print("DERMAL_DEFAULTS " + json.dumps({
    "cell": mod.DERMAL_CELL_TEXELS, "strength": mod.DERMAL_BUMP_STRENGTH,
    "feature": mod.DERMAL_VORONOI_FEATURE, "randomness": mod.DERMAL_VORONOI_RANDOMNESS,
    "ramp": [mod.DERMAL_RAMP_VALLEY, mod.DERMAL_RAMP_PEAK]}), flush=True)
assert mod.DERMAL_BUMP_STRENGTH == 0.8, "DERMAL_BUMP_STRENGTH default moved"
assert mod.DERMAL_CELL_TEXELS == 6.0
assert mod.DERMAL_VORONOI_FEATURE == "F1"
assert mod.DERMAL_VORONOI_RANDOMNESS == 0.85
assert (mod.DERMAL_RAMP_VALLEY, mod.DERMAL_RAMP_PEAK) == (0.0, 1.0)
# r7b: the stem is the tracked seed source — an explicit env seed would shadow
# it, so refuse instead of baking bytes the stem default would not reproduce.
if os.environ.get("DERMAL_SEED") not in (None, ""):
    raise SystemExit("REFUSE: DERMAL_SEED env is set; unset it so the seed "
                     "comes from materialize's tracked stem default")

CODE_SHA = hashlib.sha256(
    (REPO_ROOT / "tools/openclinxr/evidence/blender/materialize_mpfb_humanoid_candidate.py").read_bytes()
).hexdigest()[:16]

# Actor stem -> measured reference (None = default-macro body). Never the
# reference id as seed source: nurse and physician share ed_chest_pain_nurse_adult.
ACTOR_REFERENCE = {
    "mpfb-clinical-nurse-adult": "ed_chest_pain_nurse_adult",
    "mpfb-clinical-physician-adult": "ed_chest_pain_nurse_adult",
    "mpfb-peds-nurse-kevin": "peds_nurse_kevin",
    "mpfb-street-adult-male": "adult_male_street_casual",
    "mpfb-viseme-inspect": None,
    "mpfb-gown-inspect": None,
}
# Actor stem -> skin material substring in the shipped GLB (for the receipt).
ACTOR_SKIN_SUB = {
    "mpfb-clinical-nurse-adult": "mpfb_skin_ed_chest_pain_nurse_adult",
    "mpfb-clinical-physician-adult": "mpfb_skin_ward_delirium_senior_resident_adult",
    "mpfb-peds-nurse-kevin": "mpfb_skin_peds_nurse_kevin",
    "mpfb-street-adult-male": "mpfb_skin_adult_male_street_casual",
    "mpfb-viseme-inspect": "mpfb_skin_ob_patient_aisha",
    "mpfb-gown-inspect": "mpfb_skin_ob_patient_aisha",
}


def _parse_cli():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--actor-stem", required=True)
    ap.add_argument("--out", required=True)
    return ap.parse_args(argv)


ARGS = _parse_cli()
ACTOR_STEM = ARGS.actor_stem
if ACTOR_STEM not in ACTOR_REFERENCE:
    raise SystemExit(f"unknown actor stem {ACTOR_STEM!r}; want {sorted(ACTOR_REFERENCE)}")
OUT_PNG = pathlib.Path(ARGS.out)
OUT_PNG.parent.mkdir(parents=True, exist_ok=True)
BAKE_JSON = OUT_PNG.parent / f"{ACTOR_STEM}.bake.json"
REBIND_REPORT_JSON = OUT_PNG.parent / f"{ACTOR_STEM}.rebind-report.json"

# r7b: NO mod.DERMAL_SEED assignment (the r7 defect). The seed below is read
# through materialize's tracked default only.
SEED = mod._dermal_seed_for_stem(ACTOR_STEM)
print(f"REBAKE_SEED actor={ACTOR_STEM} seed={SEED:.2f} source=tracked-stem-default", flush=True)


def wipe():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()


def make_skin(human, subject, reference):
    skin_name = f"mpfb_skin_{subject}"
    stem = mod.SKIN_MHMAT_BY_REFERENCE.get(reference) if reference else None
    mhmat = mod.resolve_skins01_mhmat(stem) if stem else None
    mat = MaterialService.create_v2_skin_material(
        skin_name, human, mhmat_file=str(mhmat) if mhmat else None)
    tone = mod.phenotype_skin_tone(reference)
    rgb = mod.SKIN_TONE_RGB[tone]
    master = next((n for n in mat.node_tree.nodes
                   if n.bl_idname == "ShaderNodeGroup"
                   and (n.node_tree.name if n.node_tree else "") == "MpfbSkinMasterColor"), None)
    assert master is not None, "master color node missing"
    master.inputs["SkinColor"].default_value = (*rgb, 1.0)
    print(f"SKIN_MATERIAL {skin_name} tone={tone} mhmat={mhmat}", flush=True)
    return skin_name


def recipe_now(seed):
    return {"feature": mod.DERMAL_VORONOI_FEATURE, "cell": mod.DERMAL_CELL_TEXELS,
            "randomness": mod.DERMAL_VORONOI_RANDOMNESS,
            "ramp": [mod.DERMAL_RAMP_VALLEY, mod.DERMAL_RAMP_PEAK], "seed": seed}


def recipe_string(seed, stem):
    base = "dermal-F1-6tex-randomness0.85-strength0.8-ramp0-1"
    if stem not in (None, ""):
        return f"{base}-seed{seed:.2f}"
    return f"{base}-seed0-nostem"


def build_reference_body(reference):
    ref = mod.measure_reference(reference)
    macro = mod.derive_macro_dict(ref)
    macro["gender"] = mod._case_gender_macro_for_reference(reference)
    sdir = OUT_PNG.parent / f".solve-{reference}"
    sdir.mkdir(parents=True, exist_ok=True)
    try:
        h = mod.solve_height_macro(macro, ref["statureMeters"], sdir)
    finally:
        import shutil
        shutil.rmtree(sdir, ignore_errors=True)
    macro["height"] = round(h, 4)
    print(f"MACRO_SOLVED {reference} {json.dumps(macro)} "
          f"target={ref['statureMeters']:.4f}", flush=True)
    wipe()
    human = HumanService.create_human(feet_on_ground=True, macro_detail_dict=macro)
    TargetService.bake_targets(human)
    bpy.context.view_layer.update()
    return human, macro, ref["statureMeters"]


def bake_key(human, skin_name, key, actor, recipe, seed, macro=None, reference=None, stature=None):
    bpy.ops.object.select_all(action="DESELECT")
    human.select_set(True)
    bpy.context.view_layer.objects.active = human
    bpy.ops.object.shade_smooth()
    img = mod.bake_skin_normal_to_texture(
        human, skin_name, str(OUT_PNG), resolution=1024, stem=actor)
    w, h = img.size
    px = np.array(img.pixels[:], dtype=np.float64).reshape(h, w, 4) * 255.0
    r = px[..., 0]
    report = {"key": key, "actor": actor, "recipe": recipe, "dermalSeed": seed,
              "strength": mod.DERMAL_BUMP_STRENGTH,
              "reference": reference, "macro": macro, "statureMeters": stature,
              "codeSha": CODE_SHA, "bakeCode": "bake_skin_normal_to_texture",
              "meanR": round(float(r.mean()), 3), "sdR": round(float(r.std()), 3),
              "sha256": hashlib.sha256(OUT_PNG.read_bytes()).hexdigest()}
    BAKE_JSON.write_text(json.dumps(report, indent=1))
    print(f"REBAKE_BAKED {json.dumps(report)}", flush=True)
    return report


REFERENCE = ACTOR_REFERENCE[ACTOR_STEM]
if REFERENCE is not None:
    _human, _macro, _stature = build_reference_body(REFERENCE)
    _skin = make_skin(_human, REFERENCE, REFERENCE)
else:
    wipe()
    _human = HumanService.create_human(feet_on_ground=True)
    bpy.context.view_layer.update()
    _skin = make_skin(_human, "ob_patient_aisha", None)
    _macro, _stature = None, None

BAKE_REPORT = bake_key(_human, _skin, ACTOR_STEM, ACTOR_STEM, recipe_now(SEED), SEED,
                       _macro, REFERENCE, _stature)

# Rebind receipt (what rebind_baked_skin_normal.py consumes): the shipped GLB
# is the bake input and the rebind target, so its sha anchors both fields.
SRC_GLB = GEN_HUMANOIDS / f"{ACTOR_STEM}.glb"
if not SRC_GLB.is_file():
    raise SystemExit(f"REFUSE: shipped src GLB missing: {SRC_GLB}")
_src = SRC_GLB.read_bytes()
_src_sha = hashlib.sha256(_src).hexdigest()
_jl, = struct.unpack("<I", _src[12:16])
_j = json.loads(_src[20:20 + _jl])
_skin_sub = ACTOR_SKIN_SUB[ACTOR_STEM]
_si = next(i for i, m in enumerate(_j["materials"]) if _skin_sub in (m.get("name") or ""))
_body_mesh = next(m["name"] for m in _j["meshes"]
                 for p in m.get("primitives", []) if p.get("material") == _si)
_recipe_str = recipe_string(SEED, ACTOR_STEM)
_macro_out = BAKE_REPORT["macro"] or {"source": "mpfb_default_create_human_no_macro_dict"}
_note = (f"per-actor seeded bake (dermalSeed={SEED:.2f} from output stem): "
         f"same reference body as r3 but a rephased dermal field, map bytes unique")
_rebind = {
    "actor": ACTOR_STEM, "bodyKey": ACTOR_STEM, "sharedNote": _note,
    "bakeInputGlb": f"apps/ui-xr/public/generated-humanoids/{ACTOR_STEM}.glb",
    "bakeInputGlbFullSha": _src_sha, "inputGlbFullSha": _src_sha,
    "outputPngSha": BAKE_REPORT["sha256"], "recipe": _recipe_str,
    "meshSurfaceBake": True,
    "blenderRuntime": f"Blender {bpy.app.version_string}, Cycles CPU, TANGENT normal bake",
    "generator": (
        "tools/openclinxr/asset-pipeline/skin/coherent-normal/rebake_actor_skin_normal.py: "
        f"mise exec -- blender --background --python "
        f"tools/openclinxr/asset-pipeline/skin/coherent-normal/rebake_actor_skin_normal.py "
        f"-- --actor-stem {ACTOR_STEM} --out {OUT_PNG.name} ; "
        "rebind via tools/openclinxr/asset-pipeline/skin/coherent-normal/"
        f"rebind_baked_skin_normal.py stage skin-normal-baked-rebind --recipe {_recipe_str}"),
    "bakeCode": "bake_skin_normal_to_texture",
    "dermal": BAKE_REPORT["recipe"], "strength": BAKE_REPORT["strength"],
    "macro": _macro_out, "statureMeters": BAKE_REPORT["statureMeters"],
    "vsha": CODE_SHA, "bodyMesh": _body_mesh, "bodyMeshBase": _body_mesh,
}
REBIND_REPORT_JSON.write_text(json.dumps(_rebind, indent=1))
print(f"REBIND_REPORT actor={ACTOR_STEM} recipe={_recipe_str} bodyMesh={_body_mesh}", flush=True)
print("REBAKE_DONE", flush=True)
