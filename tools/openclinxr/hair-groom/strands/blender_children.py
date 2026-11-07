"""Blender Essentials hair children station.

Builds interpolated child strands from field-traced guides using Blender's
shipped procedural hair node groups (Attach / Interpolate / Clump / Noise /
Shrinkwrap / Smooth / Set Hair Curve Profile). Exports the evaluated
curves to the station npz format (points, radii) read by render_studio.py
and the scorer.

hair-groom16 (body-cleared guides, no Shrinkwrap, bounded outside pass):
- STEP 1 GUIDE CLEARANCE (body_clear.clear_guides, station-owned): every
  guides-8a sample closer than 2 mm to the exact body SDF is projected
  out to 2 mm along the SDF gradient, then each guide is re-smoothed
  (length, root and first take-off sample kept) and re-projected. This
  fixes the upstream defect groom15 measured: the guides themselves sit
  inside the body (skull-SDF min -6.0 mm parietal, -10.1 mm temple),
  so every child inherits the penetration and no Shrinkwrap setting
  gives depth and collision at once.
- CHILDREN: 3 depth classes (tertiles of each guide's own max skull
  SDF, one Interpolate modifier per class) + Clump + Noise +
  Smooth 0.15 x 1. NO Shrinkwrap (it flattened depth: groom15 parietal
  p50 4.58 mm shrink on vs 5.82 mm shrink off).
- STEP 2 OUTSIDE PASS (body_clear.outside_pass): each child sample with
  SDF < 0.5 mm is moved out to 0.5 mm along the gradient; per-child max
  move recorded. Bounded: <= 2% of children may move > 3 mm.

Run:
  /Applications/Blender.app/Contents/MacOS/Blender --background --python \
    tools/openclinxr/hair-groom/strands/blender_children.py -- \
    --guides <guides.npz> --out <strands.npz> [--density 3900000] [--seed 7]
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np
import bpy

REPO = Path("/Users/patrick/.grok/worktrees/src-openclinxr/hair-tgt2")
sys.path.insert(0, str(REPO / "tools/openclinxr/evidence/hair-scene"))

import hair_scene

sys.path.insert(0, str(Path(__file__).resolve().parent))
import body_clear as BC  # noqa: E402
import height_transfer as HT  # noqa: E402
from children import sdf_sampler  # noqa: E402

ASSET_BLEND = "/Applications/Blender.app/Contents/Resources/5.1/datafiles/assets/nodes/procedural_hair_node_assets.blend"
SDFP = REPO / "tools/openclinxr/evidence/hair-cage1/body-exact-sdf.npz"
GROUPS = ("Attach Hair Curves to Surface", "Interpolate Hair Curves",
          "Clump Hair Curves", "Hair Curves Noise",
          "Shrinkwrap Hair Curves",
          "Smooth Hair Curves",
          "Set Hair Curve Profile")


def load_groups():
    with bpy.data.libraries.load(ASSET_BLEND, link=False) as (src, dest):
        dest.node_groups = [name for name in GROUPS if name in src.node_groups]
    return {name: bpy.data.node_groups[name] for name in GROUPS}


def input_socket(group, name, socket_type=None):
    matches = [item for item in group.interface.items_tree
               if getattr(item, "in_out", "") == "INPUT"
               and item.name == name
               and (socket_type is None
                    or getattr(item, "socket_type", "") == socket_type)]
    if len(matches) != 1:
        raise RuntimeError("input lookup %r type=%r returned %d"
                           % (name, socket_type, len(matches)))
    return matches[0]


def set_input(modifier, group, name, value, socket_type=None,
              attribute_name=None):
    socket = input_socket(group, name, socket_type)
    key = socket.identifier
    if attribute_name is not None:
        modifier[key + "_use_attribute"] = True
        modifier[key + "_attribute_name"] = attribute_name
    else:
        written = value
        if socket.socket_type == "NodeSocketMenu" and isinstance(value, str):
            menu_values = {"Object": int(modifier.get(key, 0)),
                           "Poisson Disk": 1}
            written = menu_values.get(value, value)
        modifier[key] = written
    return key


def head_to_world(pts_head, crown):
    pts = np.asarray(pts_head, dtype=np.float64)
    world = np.empty_like(pts)
    world[..., 0] = pts[..., 0] / 1000.0
    world[..., 1] = float(crown[1]) - pts[..., 1] / 1000.0
    world[..., 2] = float(crown[2]) - pts[..., 2] / 1000.0
    return world


def scalp_mask(head, guide_roots=None):
    verts = list(head.data.vertices)
    world = np.asarray([list(head.matrix_world @ v.co) for v in verts])
    if guide_roots is not None and len(guide_roots) > 0:
        gr = np.asarray(guide_roots, dtype=np.float64)
        # nearest guide root distance per vertex
        inside, outside = [], []
        # chunk to keep memory modest
        chunk = 512
        for start in range(0, len(verts), chunk):
            end = min(start + chunk, len(verts))
            d = np.linalg.norm(world[start:end, None, :] - gr[None, :, :], axis=2)
            nearest = d.min(axis=1)
            for i in range(start, end):
                if nearest[i - start] <= 0.015:
                    inside.append(verts[i].index)
                else:
                    outside.append(verts[i].index)
    else:
        zs = [p[2] for p in world]
        crown_z = max(zs)
        eye_objects = [o for o in bpy.data.objects
                       if "eye" in o.name.lower() and o.type == "MESH"]
        brow_z = (sum(o.matrix_world.translation.z for o in eye_objects)
                  / len(eye_objects)) if eye_objects else crown_z - 0.11
        hairline_z = brow_z + 0.62 * (crown_z - brow_z)
        adjacency = [[] for _ in verts]
        for edge in head.data.edges:
            a, b = edge.vertices
            adjacency[a].append(b)
            adjacency[b].append(a)
        crown_idx = max(verts, key=lambda v: (head.matrix_world @ v.co).z).index
        component = {crown_idx}
        stack = [crown_idx]
        while stack:
            cur = stack.pop()
            for nb in adjacency[cur]:
                if nb not in component:
                    component.add(nb)
                    stack.append(nb)
        inside, outside = [], []
        for idx_v, v in enumerate(verts):
            w = world[idx_v]
            if v.index in component and w[2] >= hairline_z:
                inside.append(v.index)
            else:
                outside.append(v.index)
    group = head.vertex_groups.new(name="OCLX_scalp_mask")
    if inside:
        group.add(inside, 1.0, "REPLACE")
    if outside:
        group.add(outside, 0.0, "REPLACE")
    return group, inside, outside


def max_guide_sdf(guides_w):
    """Per-guide max finite skull-SDF over the guide's own points."""
    from children import sdf_sampler
    sample, _ = sdf_sampler(np.load(str(SDFP), allow_pickle=True))
    flat = guides_w.reshape(-1, 3)
    vals, inside = sample(flat)
    vals = np.where(inside, vals, np.nan).reshape(guides_w.shape[:2])
    out = np.full(guides_w.shape[0], -1e9, dtype=np.float64)
    with np.errstate(invalid="ignore"):
        for i in range(guides_w.shape[0]):
            v = vals[i][np.isfinite(vals[i])]
            if v.size:
                out[i] = float(v.max())
    return out


def new_guide_object(name, guides_w):
    n = guides_w.shape[0]
    p = guides_w.shape[1]
    data = bpy.data.hair_curves.new(name)
    data.add_curves([p] * n)
    flat = np.ascontiguousarray(guides_w, dtype=np.float32).reshape(-1, 3)
    data.attributes["position"].data.foreach_set("vector", flat.ravel())
    obj = bpy.data.objects.new(name, data)
    bpy.context.scene.collection.objects.link(obj)
    obj.matrix_world = __import__("mathutils").Matrix.Identity(4)
    return obj


def find_colliders(head, spec):
    """Return the ordered collider object list for the shrinkwrap chain."""
    if spec:
        tokens = [t.strip().lower() for t in spec.split(",") if t.strip()]
        out = []
        for tok in tokens:
            for o in bpy.data.objects:
                if o.type == "MESH" and tok in o.name.lower():
                    out.append(o)
                    break
        return out
    out = [head]
    want = ("human", "t_shirt", "jeans", "shoes")
    picked = set()
    for key in want:
        for o in bpy.data.objects:
            if o.type != "MESH" or o in picked:
                continue
            low = o.name.lower()
            if key == "human" and (low == "human" or "collision_basemesh" in low):
                out.append(o)
                picked.add(o)
                break
            if key != "human" and key in low:
                out.append(o)
                picked.add(o)
                break
    return out


def build_stack(groups, head, uv_name, guides_w, density, seed, args,
                mask_attr, colliders, name, with_effects=True):
    """Build one guide object + Attach/Interpolate/Clump/Noise/Shrink/Smooth.

    with_effects=False builds Attach+Interpolate only (the reference for
    the hair-groom18 Clump/Noise displacement measurement).
    """
    obj = new_guide_object(name, guides_w)

    g = groups["Attach Hair Curves to Surface"]
    mod = obj.modifiers.new("attach", "NODES")
    mod.node_group = g
    set_input(mod, g, "Surface Input Type", "Object")
    set_input(mod, g, "Surface", head, socket_type="NodeSocketObject")
    set_input(mod, g, "Surface UV Map", None, attribute_name=uv_name)
    set_input(mod, g, "Surface Rest Position", False)
    set_input(mod, g, "Sample Attachment UV", True)
    set_input(mod, g, "Snap to Surface", bool(args.attach_snap))
    set_input(mod, g, "Align to Surface Normal", False)
    set_input(mod, g, "Blend along Curve", float(args.attach_blend))

    g = groups["Interpolate Hair Curves"]
    mod = obj.modifiers.new("interp", "NODES")
    mod.node_group = g
    set_input(mod, g, "Surface Input Type", "Object")
    set_input(mod, g, "Surface", head, socket_type="NodeSocketObject")
    set_input(mod, g, "Surface UV Map", None, attribute_name=uv_name)
    set_input(mod, g, "Surface Rest Position", False)
    set_input(mod, g, "Follow Surface Normal", bool(args.follow_surface_normal))
    set_input(mod, g, "Part by Mesh Islands", bool(args.part_by_islands))
    set_input(mod, g, "Interpolation Guides", int(args.interp_guides))
    set_input(mod, g, "Distance to Guides", float(args.distance_to_guides))
    set_input(mod, g, "Distribution Method", "Poisson Disk")
    set_input(mod, g, "Density", float(density))
    mk = input_socket(g, "Density Mask").identifier
    mod[mk + "_use_attribute"] = True
    mod[mk + "_attribute_name"] = mask_attr
    set_input(mod, g, "Viewport Amount", 1.0)
    set_input(mod, g, "Seed", seed)

    if not args.skip_clump and with_effects:
        g = groups["Clump Hair Curves"]
        mod = obj.modifiers.new("clump", "NODES")
        mod.node_group = g
        set_input(mod, g, "Factor", float(args.clump_factor))
        set_input(mod, g, "Shape", 0.5)
        set_input(mod, g, "Seed", seed)

    if not args.skip_noise and with_effects:
        g = groups["Hair Curves Noise"]
        mod = obj.modifiers.new("noise", "NODES")
        mod.node_group = g
        set_input(mod, g, "Factor", 0.1)
        set_input(mod, g, "Distance", 0.002)
        set_input(mod, g, "Seed", seed)

    if not args.skip_shrink and with_effects:
        # Chained collision-only Shrinkwrap: one modifier per collider,
        # Above Surface 0.0 (push out of, never pull toward the skull).
        g = groups["Shrinkwrap Hair Curves"]
        for ci, col in enumerate(colliders):
            mod = obj.modifiers.new("shrink%d" % ci, "NODES")
            mod.node_group = g
            set_input(mod, g, "Surface Input Type", "Object")
            set_input(mod, g, "Surface", col, socket_type="NodeSocketObject")
            set_input(mod, g, "Factor", 1.0)
            set_input(mod, g, "Offset Distance", float(args.shrink_offset))
            set_input(mod, g, "Above Surface", float(args.above_surface))
            set_input(mod, g, "Smoothing Steps", int(args.smooth_steps))
            set_input(mod, g, "Lock Roots", True)

    if not args.skip_smooth and with_effects:
        g = groups["Smooth Hair Curves"]
        mod = obj.modifiers.new("smooth", "NODES")
        mod.node_group = g
        set_input(mod, g, "Amount", float(args.smooth_amount))
        set_input(mod, g, "Shape", 0.0)
        set_input(mod, g, "Iterations", int(args.smooth_iters))
        set_input(mod, g, "Weight", 0.5)
        set_input(mod, g, "Lock Tips", True)
        set_input(mod, g, "Preserve Length", True)

    return obj


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--guides", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--density", type=float, default=3900000.0)
    parser.add_argument("--seed", type=int, default=7)
    parser.add_argument("--scalp-roots", default="/Users/patrick/.grok/worktrees/src-openclinxr/hair-tgt2/tools/openclinxr/evidence/hair-scalp1/roots.npz")
    parser.add_argument("--part-by-islands", type=int, default=1)
    parser.add_argument("--clump-factor", type=float, default=0.2)
    parser.add_argument("--lateral-keep", type=float, default=0.0)
    parser.add_argument("--root-band", type=float, default=0.070)
    parser.add_argument("--sideburn-tuck", type=int, default=1)
    parser.add_argument("--skip-drape", type=int, default=1)
    parser.add_argument("--clear-guides", type=int, default=1)
    parser.add_argument("--clearance-mm", type=float, default=2.0)
    parser.add_argument("--clear-thresh-mm", type=float, default=2.0)
    parser.add_argument("--clear-gate-mm", type=float, default=1.5)
    parser.add_argument("--guides-out", default="")
    parser.add_argument("--outside-pass", type=int, default=1)
    parser.add_argument("--outside-target-mm", type=float, default=0.5)
    parser.add_argument("--outside-thresh-mm", type=float, default=0.5)
    parser.add_argument("--move-report", default="")
    parser.add_argument("--falsifier-report", default="")
    parser.add_argument("--height-transfer", type=int, default=0)
    parser.add_argument("--min-target-mm", type=float, default=0.5)
    parser.add_argument("--ht-report", default="")
    parser.add_argument("--disp-report", default="")
    parser.add_argument("--above-surface", type=float, default=0.0)
    parser.add_argument("--shrink-offset", type=float, default=0.001)
    parser.add_argument("--smooth-steps", type=int, default=2)
    parser.add_argument("--smooth-amount", type=float, default=0.15)
    parser.add_argument("--smooth-iters", type=int, default=1)
    parser.add_argument("--depth-classes", type=int, default=3)
    parser.add_argument("--interp-guides", type=int, default=3)
    parser.add_argument("--distance-to-guides", type=float, default=1.0)
    parser.add_argument("--follow-surface-normal", type=int, default=0)
    parser.add_argument("--attach-snap", type=int, default=1)
    parser.add_argument("--attach-blend", type=float, default=0.0)
    parser.add_argument("--colliders", default="")
    parser.add_argument("--skip-clump", type=int, default=0)
    parser.add_argument("--skip-noise", type=int, default=0)
    parser.add_argument("--skip-shrink", type=int, default=1)
    parser.add_argument("--skip-smooth", type=int, default=0)
    parser.add_argument("--pinna", default="/Users/patrick/.grok/worktrees/src-openclinxr/hair-tgt2/tools/openclinxr/evidence/hair-hull3/workspace/ear_pinna.npz")
    parser.add_argument("--use-profile", type=int, default=0)
    parser.add_argument("--profile-radius", type=float, default=0.00004)
    args = parser.parse_args(argv)

    handle = hair_scene.build_scene()
    head = handle.head

    gdoc = np.load(args.guides, allow_pickle=True)
    crown = np.asarray(gdoc["crown"], dtype=np.float64)
    curves_head = np.asarray(gdoc["curves_head"], dtype=np.float64)
    guides_w = head_to_world(curves_head, crown)
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import guide_drape as _GD
    if not int(args.skip_drape):
        guides_w, drape_stats = _GD.collapse_lateral(
            guides_w, crown, keep=float(args.lateral_keep),
            root_band_m=float(args.root_band))
        print("DRAPE_PREP %s" % (drape_stats,), flush=True)
    else:
        print("DRAPE_PREP skipped (skip-drape=1)", flush=True)
    if int(args.sideburn_tuck):
        _pd = np.load(args.pinna, allow_pickle=True)
        guides_w, tuck_stats = _GD.tuck_sideburn(
            guides_w, _pd["xyz"], _pd["idx_earXpos"], _pd["idx_earXneg"])
        print("TUCK_PREP %s" % (tuck_stats,), flush=True)

    # ---- STEP 1: body-clear the guides (station-owned, deterministic) ----
    guide_clear_stats = None
    if int(args.clear_guides):
        _sdfdoc = np.load(str(SDFP), allow_pickle=True)
        _gsample, _ = sdf_sampler(_sdfdoc)
        guides_w, guide_clear_stats = BC.clear_guides(
            guides_w, _gsample, clearance_mm=float(args.clearance_mm),
            thresh_mm=float(args.clear_thresh_mm),
            gate_mm=float(args.clear_gate_mm))
        print("GUIDE_CLEAR %s" % (guide_clear_stats,), flush=True)
        if not guide_clear_stats["pass"]:
            print("WARN guide-clear gate not met", flush=True)
        if args.guides_out:
            _gp = Path(args.guides_out)
            _gp.parent.mkdir(parents=True, exist_ok=True)
            gh = np.empty_like(guides_w)
            gh[..., 0] = guides_w[..., 0] * 1000.0
            gh[..., 1] = (float(crown[1]) - guides_w[..., 1]) * 1000.0
            gh[..., 2] = (float(crown[2]) - guides_w[..., 2]) * 1000.0
            np.savez(_gp, curves_head=gh, curves_world=guides_w,
                     crown=np.asarray(crown, dtype=np.float64),
                     nGuides=int(guides_w.shape[0]),
                     pointsPerGuide=int(guides_w.shape[1]))
            _gj = _gp.with_suffix(".json")
            _gj.write_text(__import__("json").dumps(
                {"guideClearStats": guide_clear_stats}, indent=1) + "\n")
            print("GUIDES_OUT %s" % (_gp,), flush=True)

    uv_name = head.data.uv_layers[0].name
    groups = load_groups()
    _sr = np.load(args.scalp_roots, allow_pickle=True)
    scalp_roots_w = np.asarray(_sr["xyz"], dtype=np.float64)
    mask_group, inside, outside = scalp_mask(head, scalp_roots_w)
    mask_attr = "OCLX_scalp_mask"

    colliders = find_colliders(head, args.colliders)
    print("COLLIDERS %s" % ([c.name for c in colliders],), flush=True)

    # Depth classes: tertiles of each guide's own max skull SDF.
    gm = max_guide_sdf(guides_w)
    n_cls = max(int(args.depth_classes), 1)
    order = np.argsort(gm, kind="stable")
    cls_of = np.empty(len(gm), dtype=np.int64)
    cuts = []
    if n_cls > 1:
        edges = [np.percentile(gm, 100.0 * k / n_cls) for k in range(1, n_cls)]
        cuts = [round(float(e), 3) for e in edges]
        cls_of[order] = np.minimum(
            np.searchsorted(edges, gm[order], side="right"), n_cls - 1)
    else:
        cls_of[:] = 0
    counts = [int((cls_of == k).sum()) for k in range(n_cls)]
    print("DEPTH_CUTS %s counts=%s" % (cuts, counts), flush=True)

    objs = []
    shares = []
    for k in range(n_cls):
        sub = guides_w[cls_of == k]
        if len(sub) == 0:
            continue
        share = len(sub) / len(guides_w)
        shares.append((k, share, len(sub)))
        objs.append(build_stack(groups, head, uv_name, sub,
                                args.density * share, args.seed, args,
                                mask_attr, colliders, "OCLX_guides_c%d" % k))
    print("CLASS_SHARES %s" % (shares,), flush=True)

    def evaluate(o):
        bpy.context.view_layer.update()
        deps = bpy.context.evaluated_depsgraph_get()
        bpy.context.view_layer.update()
        return o.evaluated_get(deps).data

    def obj_points(o):
        de = evaluate(o)
        cs = list(de.curves)
        if not cs:
            return np.zeros((0, 0, 3), dtype=np.float32)
        out = np.zeros((len(cs), len(cs[0].points), 3), dtype=np.float32)
        for i, c in enumerate(cs):
            for j, pt in enumerate(c.points):
                out[i, j] = pt.position[:]
        return out

    # ---- Clump+Noise displacement measurement (groom18) ----
    # Reference = Attach+Interpolate only; the difference IS the Clump
    # and Noise displacement (card: Clump <= 8 mm, Noise small).
    if args.disp_report:
        ref_objs = []
        for k in range(n_cls):
            sub = guides_w[cls_of == k]
            if len(sub) == 0:
                continue
            share = len(sub) / len(guides_w)
            ref_objs.append(build_stack(
                groups, head, uv_name, sub, args.density * share,
                args.seed, args, mask_attr, colliders,
                "OCLX_ref_c%d" % k, with_effects=False))
        per_cls = []
        all_d = []
        for k, (o, ro) in enumerate(zip(objs, ref_objs)):
            fa = obj_points(o)
            ra = obj_points(ro)
            if fa.shape != ra.shape:
                per_cls.append({"class": k, "shapeMismatch": [list(fa.shape),
                                                              list(ra.shape)]})
                continue
            d = np.linalg.norm(fa.astype(np.float64)
                               - ra.astype(np.float64), axis=2) * 1000.0
            all_d.append(d.ravel())
            per_cls.append({
                "class": k, "nChildren": int(fa.shape[0]),
                "dispMm_p50": round(float(np.percentile(d, 50)), 4),
                "dispMm_p90": round(float(np.percentile(d, 90)), 4),
                "dispMm_p99": round(float(np.percentile(d, 99)), 4),
                "dispMm_max": round(float(d.max()), 4)})
            del fa, ra, d
        ad = (np.concatenate(all_d) if all_d else np.zeros(0))
        disp_stats = {
            "note": "Clump+Noise displacement vs Attach+Interpolate reference",
            "clumpFactor": float(args.clump_factor),
            "noiseFactor": 0.1, "noiseDistanceMm": 2.0,
            "perClass": per_cls,
            "allMm": {"p50": round(float(np.percentile(ad, 50)), 4)
                      if ad.size else 0.0,
                      "p90": round(float(np.percentile(ad, 90)), 4)
                      if ad.size else 0.0,
                      "p99": round(float(np.percentile(ad, 99)), 4)
                      if ad.size else 0.0,
                      "max": round(float(ad.max()), 4) if ad.size else 0.0},
            "clumpBoundMm": 8.0,
            "pass": bool(ad.size and float(ad.max()) <= 8.0)}
        _dp = Path(args.disp_report)
        _dp.parent.mkdir(parents=True, exist_ok=True)
        _dp.write_text(__import__("json").dumps(disp_stats, indent=1) + "\n")
        print("DISP_REPORT %s" % (disp_stats["allMm"],), flush=True)
        for _o in ref_objs:
            bpy.data.objects.remove(_o, do_unlink=True)

    all_curves = []
    cls_idx = []
    for o in objs:
        de = evaluate(o)
        for c in de.curves:
            all_curves.append(c)
            cls_idx.append(o.name)
    counts = [len(c.points) for c in all_curves]
    from collections import Counter
    target_pc = Counter(counts).most_common(1)[0][0]
    keep = [c for c in all_curves if len(c.points) == target_pc]
    if not keep:
        raise RuntimeError("no curves with target point count")
    n_curves = len(keep)
    pc = target_pc
    points = np.zeros((n_curves, pc, 3), dtype=np.float32)
    for i, c in enumerate(keep):
        for j, pt in enumerate(c.points):
            points[i, j] = pt.position[:]

    radii = np.full((n_curves, pc), 0.00004, dtype=np.float32)
    print("PROFILE_FALLBACK manual radii kept (profile node unused)", flush=True)

    # ---- STEP 2: bounded outside pass (station-owned) ----
    child_move_mm = np.zeros(n_curves, dtype=np.float32)
    outside_stats = None
    falsifier = None
    if int(args.outside_pass):
        _osdf, _ = sdf_sampler(np.load(str(SDFP), allow_pickle=True))
        points, child_move_mm, outside_stats = BC.outside_pass(
            points.astype(np.float64), _osdf,
            target_mm=float(args.outside_target_mm),
            thresh_mm=float(args.outside_thresh_mm))
        points = points.astype(np.float32)
        print("OUTSIDE_PASS %s" % (outside_stats,), flush=True)
        pre_frac = outside_stats["preInsideFracSamples"]
        if pre_frac > 0.10:
            # FALSIFIER: the Interpolate blend itself cuts through the skull
            # between outside guides. Report fraction + bands and stop.
            falsifier = {
                "triggered": True,
                "preInsideFracSamples": pre_frac,
                "preChildrenWithInside": outside_stats[
                    "preChildrenWithInside"],
                "preChildInsideFracMax": outside_stats[
                    "preChildInsideFracMax"],
                "note": ">10% of children enter the body before the "
                        "outside pass: Interpolate cuts through the skull "
                        "between outside guides.",
            }
            print("FALSIFIER_TRIGGERED %s" % (falsifier,), flush=True)
        if args.move_report:
            _mp = Path(args.move_report)
            _mp.parent.mkdir(parents=True, exist_ok=True)
            _mp.write_text(__import__("json").dumps(
                {"outsidePass": outside_stats,
                 "guideClearStats": guide_clear_stats,
                 "falsifier": falsifier}, indent=1) + "\n")
            print("MOVE_REPORT %s" % (_mp,), flush=True)
        if args.falsifier_report and falsifier:
            Path(args.falsifier_report).write_text(
                __import__("json").dumps(falsifier, indent=1) + "\n")

    # ---- STEP 2 (groom18): SDF height transfer (station-owned) ----
    ht_stats = None
    if int(args.height_transfer):
        _hsdf, _ = sdf_sampler(np.load(str(SDFP), allow_pickle=True))
        _pre = BC.sample_mm(_hsdf, points[:, 1:, :].reshape(-1, 3))
        _fin = int(np.isfinite(_pre).sum())
        _ins = int(np.nansum(_pre < 0.0))
        _pre_stats = {"insideSamplesSge1": _ins, "finite": _fin,
                      "insideFracSge1": round(_ins / max(_fin, 1), 6)}
        points, _mv, _pc, ht_stats = HT.transfer(
            points.astype(np.float64), guides_w, _hsdf,
            min_mm=float(args.min_target_mm))
        points = points.astype(np.float32)
        child_move_mm = _pc.astype(np.float32)
        ht_stats["preInside"] = _pre_stats
        print("HEIGHT_TRANSFER %s" % (ht_stats,), flush=True)
        if args.ht_report:
            _hp = Path(args.ht_report)
            _hp.parent.mkdir(parents=True, exist_ok=True)
            _hp.write_text(__import__("json").dumps(ht_stats, indent=1) + "\n")
            print("HT_REPORT %s" % (_hp,), flush=True)

    roots = points[:, 0, :].astype(np.float32)
    guide_idx = np.zeros(n_curves, dtype=np.int32)

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    np.savez(out_path, points=points, radii=radii, roots=roots,
             guide_idx=guide_idx, child_move_mm=child_move_mm)
    print("BLENDER_CHILDREN_DONE curves=%d points=%d radius_min=%.3g radius_max=%.3g"
          % (n_curves, pc, float(radii.min()), float(radii.max())),
          flush=True)


if __name__ == "__main__":
    main()
