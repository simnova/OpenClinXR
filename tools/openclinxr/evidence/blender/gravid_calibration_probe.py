"""#509/#581 calibration probe — headless Blender.

Derives the localized gravid target, then sweeps weights through the REAL
path (create_human -> TargetService.load_target -> bake into basis ->
strip helpers -> export GLB) and measures the contract's bands on each
exported body. Writes one JSON artifact; no product edit is implied by the
chosen weight — production wiring passes weeks and this module maps it.
"""
import json
import pathlib
import sys

REPO = pathlib.Path(__file__).resolve().parents[4]
sys.path.insert(0, str(REPO / "tools/openclinxr/asset-pipeline/makeclothes"))

import bpy  # noqa: E402

from pregnancy_target import (  # noqa: E402
    ABDOMEN_BAND,
    apply_case_driven_gravid_morph,
    bake_gravid_morph_into_basis,
    derive_localized_gravid_target,
)

OUT_DIR = REPO / ".openclinxr/evidence/issue-581"
MPFB_ROOT = REPO / ".openclinxr-local/provider-cache/mpfb/extracted"
WEIGHTS = [0.40, 0.60, 0.85]
MIN_RATIO = 1.476


def measure_bands(glb_path: pathlib.Path) -> dict:
    import struct
    from collections import defaultdict

    data = glb_path.read_bytes()
    magic, _ver, _total = struct.unpack_from("<I4sI", data, 0)
    assert magic == 0x46546C67
    pos = 12
    jchunk_len, jchunk_type = struct.unpack_from("<I4s", data, pos)
    doc = json.loads(data[pos + 8 : pos + 8 + jchunk_len])
    pos += 8 + jchunk_len
    bchunk_len, bchunk_type = struct.unpack_from("<I4s", data, pos)
    bin_data = data[pos + 8 : pos + 8 + bchunk_len]

    out = {}
    for mesh in doc.get("meshes", []):
        name = mesh.get("name", "")
        prim = mesh["primitives"][0]
        acc = doc["accessors"][prim["attributes"]["POSITION"]]
        bv = doc["bufferViews"][acc["bufferView"]]
        off = bv.get("byteOffset", 0) + acc.get("byteOffset", 0)
        count = acc["count"]
        raw = bin_data[off : off + count * 12]
        ys = [struct.unpack_from("<f", raw, i * 12 + 4)[0] for i in range(count)]
        xs = [struct.unpack_from("<f", raw, i * 12)[0] for i in range(count)]
        zs = [struct.unpack_from("<f", raw, i * 12 + 8)[0] for i in range(count)]
        miny, maxy = min(ys), max(ys)
        h = maxy - miny
        xlim = h * 0.06

        def band(lo, hi):
            z0, z1, n = 1e9, -1e9, 0
            for i in range(count):
                yf = (ys[i] - miny) / h
                if lo <= yf <= hi and abs(xs[i]) <= xlim:
                    n += 1
                    z0 = min(z0, zs[i])
                    z1 = max(z1, zs[i])
            return (z1 - z0) * 1000 if n > 20 else float("nan")

        out[name] = {
            "chest": band(0.62, 0.70),
            "abdomen": band(0.50, 0.58),
            "hip": band(0.44, 0.50),
            "statureMeters": h,
        }
    return out


def probe_weight(weight: float, target_path: pathlib.Path, out_glb: pathlib.Path) -> dict:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()
    from bl_ext.user_default.mpfb.services.exportservice import ExportService
    from bl_ext.user_default.mpfb.services.humanservice import HumanService
    from bl_ext.user_default.mpfb.services.targetservice import TargetService

    human = HumanService.create_human(feet_on_ground=True)
    res = apply_case_driven_gravid_morph(
        human, weeks=34, target_path=target_path, weight_override=weight
    )
    bake_gravid_morph_into_basis(human)
    bpy.context.view_layer.update()
    ExportService.bake_modifiers_remove_helpers(
        human, bake_masks=False, bake_subdiv=False, remove_helpers=True, also_proxy=True
    )
    bpy.context.view_layer.update()
    if out_glb.exists():
        out_glb.unlink()
    bpy.ops.export_scene.gltf(filepath=str(out_glb), export_format="GLB", export_animations=False)
    bands = measure_bands(out_glb)
    # The probe body is the only (or largest) mesh in the export; pick by vertex count.
    key = max(bands, key=lambda k: bands[k].get("statureMeters", 0))
    b = bands[key]
    ratio = b["abdomen"] / b["chest"]
    return {
        "weight": weight,
        "meshName": key,
        **{k: round(v, 1) for k, v in b.items() if k != "statureMeters"},
        "statureMeters": round(b["statureMeters"], 3),
        "abdomenOverChest": round(ratio, 3),
        "clearsThreshold": ratio >= MIN_RATIO,
        "loadResult": {k: v for k, v in res.items() if k != "reason"},
    }


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    bpy.ops.preferences.addon_enable(module="bl_ext.user_default.mpfb")
    target_path = OUT_DIR / "derived-gravid-abdomen.target"
    derivation = derive_localized_gravid_target(MPFB_ROOT, target_path)
    print("DERIVATION " + json.dumps(derivation))

    rows = []
    for w in WEIGHTS:
        g = OUT_DIR / f"probe-w{int(w * 100)}.glb"
        row = probe_weight(w, target_path, g)
        rows.append(row)
        print(f"SWEEP w={w} abdomen/chest={row['abdomenOverChest']} chest={row['chest']} "
              f"abdomen={row['abdomen']} hip={row['hip']} clears={row['clearsThreshold']}")

    chosen = next((r for r in rows if r["clearsThreshold"]), None)
    report = {
        "schemaVersion": "openclinxr.gravid-target-calibration.v1",
        "derivation": derivation,
        "threshold": MIN_RATIO,
        "weightsSwept": WEIGHTS,
        "sweep": rows,
        "chosenWeight": chosen["weight"] if chosen else None,
        "verdict": (
            f"weight {chosen['weight']} clears {MIN_RATIO} with "
            f"chest delta {round(chosen['chest'] - 189, 1)} mm"
            if chosen
            else "no swept weight clears the derived threshold"
        ),
    }
    (OUT_DIR / "calibration.json").write_text(json.dumps(report, indent=1), encoding="utf-8")
    print("CALIBRATION_WRITTEN " + str(OUT_DIR / "calibration.json"))


main()
