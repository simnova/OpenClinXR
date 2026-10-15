"""facefit2 basis dump (Blender, foreground only).

Dumps, for card tsk_3cff39ffc572d85d:
  faces.npy               triangulated hm08 faces (int64 [F,3])
  basis_meta.json         MPFB versions, base hash check, stem lists
  offsets_asym_macro.npz  sparse shape-key deltas (truth) for 62 asym
                          (MPFB 2.0.18 data) + 6 universal macro targets

Mesh comes from the active MPFB addon human (hm08, CC0). Asym/macro
.target files are read from the MPFB 2.0.18 data dir; deltas are Blender
shape-key truth (file-index parsing is wrong topology -- see prior spike
facefit/RESULT.md line 1).

Run foreground:
  Blender --background --python \
    tools/openclinxr/evidence/face-fit/dump_facefit2_basis.py
"""

import glob
import hashlib
import json
import os

import bpy
import numpy as np

OUT = "/Users/patrick/.grok/worktrees/src-openclinxr/facefit2/tools/openclinxr/evidence/face-fit"
STORE = os.environ.get("OPENCLINXR_ASSET_STORE",
                       "/Volumes/files/openclinxr-assets/store/face-fit")
MPFB_218 = "/Users/patrick/Library/Application Support/Blender/5.2/extensions/user_default/mpfb/data/targets"
MPFB_215_INIT = "/Users/patrick/Library/Application Support/Blender/5.1/extensions/user_default/mpfb/__init__.py"
MPFB_218_INIT = "/Users/patrick/Library/Application Support/Blender/5.2/extensions/user_default/mpfb/__init__.py"
MPFB_218_MANIFEST = "/Users/patrick/Library/Application Support/Blender/5.2/extensions/user_default/mpfb/blender_manifest.toml"

MACRO_STEMS = [
    "universal-male-young-averagemuscle-averageweight",
    "universal-female-young-averagemuscle-averageweight",
    "universal-male-young-averagemuscle-maxweight",
    "universal-male-young-averagemuscle-minweight",
    "universal-female-young-averagemuscle-maxweight",
    "universal-female-young-averagemuscle-minweight",
]


def read_version(init_path):
    for line in open(init_path, encoding="utf-8", errors="replace"):
        s = line.strip()
        if s.startswith('"version"') and "2, 0" in s:
            return s.split(":", 1)[1].strip().rstrip(",")
    return "unknown"


def main():
    bpy.ops.preferences.addon_enable(module="bl_ext.user_default.mpfb")
    from bl_ext.user_default.mpfb.services.humanservice import HumanService
    from bl_ext.user_default.mpfb.services.targetservice import TargetService

    human = HumanService.create_human(feet_on_ground=True)
    bpy.context.view_layer.update()
    n = len(human.data.vertices)
    print("FF2_BASE_VERTS %d" % n)
    base = np.array([tuple(v.co) for v in human.data.vertices], dtype=np.float64)
    base_hash = hashlib.sha256(base.tobytes()).hexdigest()
    print("FF2_BASE_HASH %s" % base_hash)

    # triangulated faces (hm08 mesh, CC0)
    mesh = human.data
    mesh.calc_loop_triangles()
    faces = np.array([tuple(t.vertices) for t in mesh.loop_triangles], dtype=np.int64)
    print("FF2_FACES %d" % faces.shape[0])
    os.makedirs(STORE, exist_ok=True)
    np.save(os.path.join(STORE, "faces.npy"), faces)

    asym_files = sorted(glob.glob(os.path.join(MPFB_218, "asym", "*.target.gz")))
    asym_stems = [os.path.basename(p)[:-len(".target.gz")] for p in asym_files]
    print("FF2_ASYM_N %d" % len(asym_stems))

    macro_files = []
    for stem in MACRO_STEMS:
        p = os.path.join(MPFB_218, "macrodetails", stem + ".target.gz")
        assert os.path.isfile(p), "missing macro target: " + p
        macro_files.append(p)
    print("FF2_MACRO_N %d" % len(macro_files))

    jobs = [("asym", p) for p in asym_files] + [("macrodetails", p) for p in macro_files]
    out = {}
    BATCH = 16
    for bi in range(0, len(jobs), BATCH):
        batch = jobs[bi:bi + BATCH]
        names = {}
        for sub, path in batch:
            name = TargetService.filename_to_shapekey_name(os.path.basename(path), encode_name=False)
            TargetService.load_target(human, str(path), weight=0.0, name=name)
            stem = os.path.basename(path)[:-len(".target.gz")]
            names[stem] = name
        bpy.context.view_layer.update()
        sk = human.data.shape_keys
        bdata = sk.key_blocks["Basis"].data
        for sub, path in batch:
            stem = os.path.basename(path)[:-len(".target.gz")]
            kb = sk.key_blocks.get(names[stem])
            if kb is None:
                print("FF2_MISSING " + stem)
                continue
            idx = []
            dl = []
            for i in range(n):
                dx = kb.data[i].co.x - bdata[i].co.x
                dy = kb.data[i].co.y - bdata[i].co.y
                dz = kb.data[i].co.z - bdata[i].co.z
                if dx * dx + dy * dy + dz * dz > 1e-12:
                    idx.append(i)
                    dl.append((dx, dy, dz))
            out[stem + "__idx"] = np.array(idx, dtype=np.int64)
            out[stem] = np.array(dl, dtype=np.float64)
            print("FF2_SK %s n=%d max=%.4f" % (stem, len(idx), float(np.abs(np.array(dl)).max()) if dl else 0))
        for sub, path in batch:
            try:
                kb = sk.key_blocks.get(names[os.path.basename(path)[:-len(".target.gz")]])
                if kb is not None:
                    sk.key_blocks.remove(kb)
            except Exception as e:  # noqa: BLE001
                print("FF2_RMFAIL %s %s" % (path, e))
        bpy.context.view_layer.update()
    np.savez_compressed(os.path.join(STORE, "offsets_asym_macro.npz"), **out)

    meta = {
        "blender": "5.1.1",
        "mpfb_runtime_init": MPFB_215_INIT,
        "mpfb_runtime_version": read_version(MPFB_215_INIT),
        "mpfb_target_data": MPFB_218,
        "mpfb_target_version_init": read_version(MPFB_218_INIT),
        "mpfb_target_manifest": open(MPFB_218_MANIFEST, encoding="utf-8").read().splitlines()[2],
        "nVerts": n,
        "baseHash": base_hash,
        "nFaces": int(faces.shape[0]),
        "asymStems": asym_stems,
        "macroStems": MACRO_STEMS,
    }
    with open(os.path.join(OUT, "basis_meta.json"), "w", encoding="utf-8") as fh:
        json.dump(meta, fh, indent=1)
    print("FF2_DUMP_DONE asym=%d macro=%d faces=%d" % (len(asym_stems), len(MACRO_STEMS), faces.shape[0]))


main()
