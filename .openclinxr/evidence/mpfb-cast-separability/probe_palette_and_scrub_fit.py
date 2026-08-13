# #180 pre-fix probe (run inside Blender): two facts that decide the wiring approach.
# (a) garment_shell_color is importable from the MPFB materializer's rail and returns
#     what for kind=scrub / kind=closed_casual x the three cast roles?
# (b) does ClothesService accept Scrub_Shirt.mhclo against the #318 helper-stripped
#     basemesh, from a single smoke fit (no macro solve, no export)?
import argparse
import json
import pathlib
import sys

import bpy

REPO = pathlib.Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO / "tools/openclinxr/asset-pipeline/anny"))
sys.path.insert(0, str(REPO / "tools/openclinxr/asset-pipeline/makeclothes"))

report = {}

# --- fact (a): the palette function, imported the way the materializer imports
#     automate_blender functions (see materialize_mpfb_humanoid_candidate.py:1606-1608).
from automate_blender import garment_shell_color  # noqa: E402

report["fact_a"] = {
    "importable": True,
    "importPath": "from automate_blender import garment_shell_color (lazy, same as apply_mesh_native_scalp_hair_material_region)",
    "returns": {},
}
for kind in ("scrub", "closed_casual", "tshirt"):
    report["fact_a"]["returns"][kind] = {}
    for role in ("patient", "parent", "nurse"):
        rgb = garment_shell_color(kind, role, {})
        report["fact_a"]["returns"][kind][role] = [round(float(v), 4) for v in rgb]

# --- fact (b): smoke fit of Scrub_Shirt.mhclo on the helper-stripped basemesh.
bpy.ops.preferences.addon_enable(module="bl_ext.user_default.mpfb")
bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete()

from bl_ext.user_default.mpfb.services.humanservice import HumanService  # noqa: E402
from bl_ext.user_default.mpfb.services.targetservice import TargetService  # noqa: E402

human = HumanService.create_human(feet_on_ground=True)
TargetService.bake_targets(human)
bpy.context.view_layer.update()

from bl_ext.user_default.mpfb.services.exportservice import ExportService  # noqa: E402

ExportService.bake_modifiers_remove_helpers(
    human, bake_masks=False, bake_subdiv=False, remove_helpers=True, also_proxy=True
)
bpy.context.view_layer.update()
verts_after_strip = len(human.data.vertices)
tris_after_strip = sum(max(len(p.vertices) - 2, 0) for p in human.data.polygons)
report["fact_b"] = {
    "stripped_verts": verts_after_strip,
    "stripped_tris": tris_after_strip,
}

scrub_dir = REPO / ".openclinxr-local/provider-cache/garments/sources/makehuman-community-scrub-shirt"

from body_param_stage import import_obj, apply_object_transforms  # noqa: E402
from bl_ext.user_default.mpfb.entities.clothes.mhclo import Mhclo  # noqa: E402
from bl_ext.user_default.mpfb.services.clothesservice import ClothesService  # noqa: E402

scrub = import_obj(str(scrub_dir / "Scrub_Shirt.obj"), "makeclothes_library_scrub_shirt", force_z=False)
apply_object_transforms(scrub)
mhclo = Mhclo()
mhclo.load(str(scrub_dir / "Scrub_Shirt.mhclo"))
max_ref = 0
for info in (mhclo.verts or {}).values():
    max_ref = max(max_ref, max(info["verts"]))
report["fact_b"]["mhclo_max_vertex_ref"] = max_ref
report["fact_b"]["fits_13_380_limit"] = max_ref < verts_after_strip

verts_before = len(scrub.data.vertices)
try:
    mhclo.clothes = scrub
except Exception:
    pass
try:
    ClothesService.fit_clothes_to_human(scrub, human, mhclo=mhclo, set_parent=True)
    bpy.context.view_layer.update()
    report["fact_b"]["fit"] = "ok"
    report["fact_b"]["verts_before"] = verts_before
    report["fact_b"]["verts_after"] = len(scrub.data.vertices)
    report["fact_b"]["tris"] = sum(max(len(p.vertices) - 2, 0) for p in scrub.data.polygons)
    report["fact_b"]["parented_to_human"] = scrub.parent is human
    zs = [v.co.z for v in scrub.data.vertices]
    report["fact_b"]["garment_z_span"] = [round(min(zs), 4), round(max(zs), 4)]
except Exception as exc:  # the refused treatment must be loud, not silent
    report["fact_b"]["fit"] = f"THREW: {type(exc).__name__}: {exc}"

argv = []
if "--" in sys.argv:
    argv = sys.argv[sys.argv.index("--") + 1 :]
parser = argparse.ArgumentParser()
parser.add_argument("--output", required=True)
args = parser.parse_args(argv)
out = pathlib.Path(args.output)
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(json.dumps(report, indent=2))
print("PROBE_REPORT", json.dumps(report, indent=2))
