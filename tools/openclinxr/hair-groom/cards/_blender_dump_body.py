"""Dump the pinned body + clothing mesh triangles (world space).

Runs inside Blender background mode. Reads: the pinned body GLB.
Writes: E/body-geo.npz (concatenated verts float64 (N,3), tris int64
(M,3), triMesh int64 (M,) index into meshNames, bodySha256) +
E/blender-opened-dump.txt.

Only the library hair object (name carries both 'library' and 'hair')
is hidden from render/viewport and excluded (asserted, mirroring the
S1 spikes station); clothing stays visible and joins the clearance set.
Deterministic: objects sorted by name.
"""
from __future__ import annotations

import argparse
import hashlib
import sys
from pathlib import Path

import bpy
import numpy as np

E = Path("/Users/patrick/.grok/worktrees/src-openclinxr/hair-light2/tools/openclinxr/evidence/hair-cards0")
ROOT = Path("/Users/patrick/.grok/worktrees/src-openclinxr/hair-light2")


def cli():
    p = argparse.ArgumentParser()
    p.add_argument("--glb", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--opened", required=True)
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    return p.parse_args(argv)


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main():
    args = cli()
    glb = Path(args.glb)
    opened = [str(Path(__file__).resolve()), str(glb.resolve())]
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(glb))
    imported = sorted(
        [o for o in bpy.data.objects if o not in before], key=lambda o: o.name)
    meshes = [o for o in imported if o.type == "MESH"]
    topper = [o for o in meshes if "library" in o.name.lower()
              and "hair" in o.name.lower()]
    if not topper:
        raise RuntimeError("ASSERT FAIL: no library hair object found to exclude")
    for o in topper:
        o.hide_render = True
        o.hide_viewport = True
    keep = sorted([o for o in meshes if o not in topper],
                  key=lambda o: o.name)
    # The GLB carries a 2 m environment proxy ('Icosphere', 42 verts,
    # bbox +-1 m): not body, excluded from clearance and hidden so it
    # can never occlude a render.
    env = [o for o in keep if o.name.lower() == "icosphere"]
    for o in env:
        o.hide_render = True
        o.hide_viewport = True
    keep = [o for o in keep if o not in env]
    if [o.name for o in meshes if "hair" in o.name.lower()
            and not o.hide_render]:
        raise RuntimeError("ASSERT FAIL: hair object still visible")
    bpy.context.view_layer.update()
    vall, tall, tmesh, names = [], [], [], []
    for mi, o in enumerate(keep):
        M = o.matrix_world
        v = np.array([M @ vc.co for vc in o.data.vertices], dtype=np.float64)
        o.data.calc_loop_triangles()
        t = np.array([tuple(vv for vv in tr.vertices)
                      for tr in o.data.loop_triangles], dtype=np.int64)
        off = sum(len(vv) for vv in vall)
        vall.append(v)
        tall.append(t + off)
        tmesh.append(np.full(len(t), mi, dtype=np.int64))
        names.append(o.name)
    verts = np.ascontiguousarray(np.vstack(vall))
    tris = np.ascontiguousarray(np.vstack(tall))
    tri_mesh = np.ascontiguousarray(np.concatenate(tmesh))
    # Clearance-enforcing set: skin + head details. Loose garments are
    # excluded from the numeric clearance (hair rests on cloth; the
    # cloth is open, so unsigned distance cannot certify either side);
    # garment proximity is reported separately and checked visually.
    garments = ("pants", "shirt", "shoe")
    clear = np.array([0 if any(g in n.lower() for g in garments) else 1
                      for n in names], dtype=np.int64)
    out = Path(args.out)
    np.savez(str(out),
             verts=verts,
             tris=tris,
             triMesh=tri_mesh,
             clearGroup=np.ascontiguousarray(clear[tri_mesh]),
             meshNames=np.array(names),
             topperHidden=np.array(sorted(o.name for o in topper)),
             bodySha256=np.array(sha256(glb)))
    opened.append(str(out.resolve()))
    Path(args.opened).write_text("\n".join(sorted(set(opened))) + "\n")
    print("BODY_DUMP meshes=%d verts=%d tris=%d topper=%s" % (
        len(keep), len(verts), len(tris),
        sorted(o.name for o in topper)), flush=True)


if __name__ == "__main__":
    main()
