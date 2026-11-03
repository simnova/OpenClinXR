#!/usr/bin/env python3
"""
#480 L4 — bake a first-party clinical gown onto the current MPFB patient.

Loads the tracked isolated-subject precedent `mpfb-viseme-inspect.glb` (D3/D4, 137-joint
MPFB rail, jaw + eyes + face targets) and invokes the PROVEN Anny-rail gown builder
`automate_blender.apply_role_clothing_material_regions` with
`phenotype.garmentLayers = ["hospital_gown"]` ON AN MPFB MESH — the rail-trap clause (2)
forbids copying the 23-joint Anny gowned body.

The gown builder authors geometry in body-local Y-up (height on Y). The shipped GLB is
glTF Y-up, and Blender's glTF importer converts it to Z-up local data (height on Z). So the
body is copied and rotated -90 deg about X directly in mesh data (bmesh), the gown kind is
invoked on the copy (so the builder's painting/footwear side effects touch only the
discardable copy, not the shipped body surface), and the produced gown + declaration meshes
are rotated back +90 deg about X, re-parented to the real body, and the builder's
Anny-rail footwear slippers are discarded (the MPFB body already wears fitted toigo flats).

REGENERATION PATH (SS6r): Blender-only, on the existing shipped base GLB. It does NOT run
`orchestrate_character` (which, without the `anny` package, silently emits ~0.8 MB stubs).
The existing garment station supplies material and declaration provenance. A regular clinical-gown
cage replaces its damaged surface-derived shell, with body-section fitting and anatomically
restricted weight transfer. It has a below-hip skirt and short sleeves; it is first-party geometry.

Run:
  blender --background --python tools/openclinxr/evidence/blender/bake_mpfb_gown_inspect.py -- \
      --input-glb apps/ui-xr/public/generated-humanoids/mpfb-viseme-inspect.glb \
      --output-glb apps/ui-xr/public/generated-humanoids/mpfb-gown-inspect.glb
"""

import argparse
import json
import math
import pathlib
import re
import subprocess
import sys
import tempfile

import bpy
from mathutils import Matrix

REPO_ROOT = pathlib.Path(__file__).resolve().parents[4]

RLQ_CLIP_NAME = "openclinxr_role_patient_guard_withdraw_rlq"
MATERIALIZER = "tools/openclinxr/evidence/materialize-guard-withdraw-clip.ts"


def _glb_animation_names(glb_path: pathlib.Path) -> list:
    """Read animation names from a GLB JSON chunk without Blender."""
    data = glb_path.read_bytes()
    if data[:4] != b"glTF":
        raise RuntimeError(f"not a GLB: {glb_path}")
    json_len = int.from_bytes(data[12:16], "little")
    gltf = json.loads(data[20:20 + json_len].decode("utf-8"))
    return [a.get("name") for a in gltf.get("animations", [])]


def rematerialize_rlq_clip(exported_glb: pathlib.Path, report_path: pathlib.Path | None = None, provenance_path: pathlib.Path | None = None, provenance_root: pathlib.Path | None = None) -> dict | None:
    """Re-run the RLQ materializer over a Blender-exported GLB (pure postprocess).

    Skips exports that carry no RLQ-named clip (actors without an existing/required
    RLQ response are preserved untouched). Otherwise the materializer disposes the
    same-name clip (a possible idle duplicate from the glTF round-trip) and
    re-injects the genuine 9-channel rotation-only flinch, preserving all other GLB
    payload. Backup and default report live in a unique job-local temp dir, never in
    the public generated-humanoids tree. Raises on failure without touching
    provenance (fail closed before any acceptance bookkeeping)."""
    if RLQ_CLIP_NAME not in _glb_animation_names(exported_glb):
        print(f"RLQ_SKIP no {RLQ_CLIP_NAME!r} clip in {exported_glb}; preserving actor untouched")
        return None
    job_dir = pathlib.Path(tempfile.mkdtemp(prefix="rlq-rematerialize-"))
    backup = job_dir / (exported_glb.stem + ".pre-rlq.bak.glb")
    report = report_path if report_path is not None else job_dir / (exported_glb.stem + ".rlq-rematerialize-report.json")
    tool = REPO_ROOT / MATERIALIZER
    cmd = ["pnpm", "exec", "tsx", str(tool), "--glb", str(exported_glb),
         "--out", str(exported_glb), "--backup", str(backup),
         "--report", str(report)]
    if provenance_path is not None:
        cmd += ["--provenance", str(provenance_path)]
    if provenance_root is not None:
        cmd += ["--provenance-root", str(provenance_root)]
    proc = subprocess.run(
        cmd,
        cwd=str(REPO_ROOT), capture_output=True, text=True, timeout=300,
    )
    print(proc.stdout)
    if proc.returncode != 0:
        raise RuntimeError(f"RLQ rematerialization failed: {proc.stderr[-2000:]}")
    print(f"RLQ_REPORT {report}")
    return json.loads(report.read_text())

_ANNY_DIR = REPO_ROOT / "tools/openclinxr/asset-pipeline/anny"
if str(_ANNY_DIR) not in sys.path:
    sys.path.insert(0, str(_ANNY_DIR))

from automate_blender import (  # noqa: E402
    apply_role_clothing_material_regions,
)

GEN = REPO_ROOT / "apps/ui-xr/public/generated-humanoids"

# #487: a gowned body never wears trousers. The source MPFB inspect GLB already carries
# makeclothes_library_cargo_pants as a separate mesh object; it passes through the export
# untouched unless removed. Classify on name AND a vertex floor, never name alone — the
# 3-vertex declaration markers must never count as a garment.
LOWER_GARMENT_RE = re.compile(r"(cargo_pants|_pants|trouser)", re.IGNORECASE)
# The viseme input wears a fitted casual T-shirt under the gown region. The new draped
# cage stands 18-25 mm off the body and is slimmer than the old conformal wrap, so the
# retained shirt pokes past the gown at the chest/shoulders (D5-after still). A hospital
# gown is the patient's upper layer; #746 removed the same REDUNDANT_TSHIRT_NODE from
# the adult gown asset for the same intersection. Name AND vertex floor, never name alone.
UPPER_REDUNDANT_RE = re.compile(r"(toigo_t_shirt|_t_shirt)", re.IGNORECASE)
MIN_REAL_GARMENT_VERTS = 100


def _strip_lower_garments(body):
    """Remove any real lower garment from the imported scene before the gown is baked.

    The gown builder operates on a copy of the body surface only and never touches the
    pre-existing cargo_pants object, so it survives to export and pokes through the skirt
    (#485: +16.6 mm on 56% of thigh-band vertices)."""
    for o in list(bpy.context.scene.objects):
        if o.type != "MESH" or o is body:
            continue
        if len(o.data.vertices) < MIN_REAL_GARMENT_VERTS:
            continue
        if not LOWER_GARMENT_RE.search(o.name):
            continue
        print(f"STRIP_LOWER_GARMENT {o.name!r} verts={len(o.data.vertices)}")
        bpy.data.objects.remove(o, do_unlink=True)


def _strip_redundant_upper_garments(body):
    """Remove the retained casual T-shirt the viseme input wears under the gown region.

    Same phase as _strip_lower_garments (before the `before` snapshot, so the builder
    and the kept/discard split never see it). The builder operates on a body-surface
    copy and never touches this object, so without this strip it survives to export
    and pokes through the slimmer draped cage (#746 precedent on the adult gown asset).
    """
    for o in list(bpy.context.scene.objects):
        if o.type != "MESH" or o is body:
            continue
        if len(o.data.vertices) < MIN_REAL_GARMENT_VERTS:
            continue
        if not UPPER_REDUNDANT_RE.search(o.name):
            continue
        print(f"STRIP_REDUNDANT_UPPER {o.name!r} verts={len(o.data.vertices)}")
        bpy.data.objects.remove(o, do_unlink=True)


def _strip_existing_gown():
    """Remove a gown the INPUT already carries before the builder re-bakes one.

    The regeneration path runs `--input-glb` on a previously gowned asset (the #684
    shape: input == the shipped cast asset), and the builder emits a NEW gown mesh. The
    input's gown object is not in the builder's `created` set, so without this strip it
    survives to export and the GLB carries two overlapping hospital gowns — the old
    conformal shell (3419 verts, normal-dot ~0.99) and the new draped one, which
    confounds every normal-dot contract on the shipped asset (#686).

    The OBJECTS are removed here; the orphaned MESH DATA blocks must be purged too,
    or Blender auto-renames the rebuilt gown to `..._mesh.001` and the canonical
    mesh name (openclinxr_real_garment_peds_upper_v1_mesh) that the shipped-asset
    instruments read disappears (#714)."""
    for o in list(bpy.context.scene.objects):
        if o.type != "MESH":
            continue
        if "real_garment" not in o.name.lower():
            continue
        print(f"STRIP_EXISTING_GOWN {o.name!r} verts={len(o.data.vertices)}")
        bpy.data.objects.remove(o, do_unlink=True)
    for m in list(bpy.data.meshes):
        if "real_garment" not in m.name.lower():
            continue
        print(f"PURGE_GOWN_MESH_DATA {m.name!r} verts={len(m.vertices)}")
        bpy.data.meshes.remove(m, do_unlink=True)


def _find_body():
    # The body is the *_body mesh (the eyes/gaze helper is *_body_mesh.low-poly). Name-based,
    # not vertex-count: the fitted toigo flats shoe imports at 115k verts, more than the body.
    for o in bpy.context.scene.objects:
        if o.type == "MESH" and o.name.endswith("_body"):
            return o
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    if not meshes:
        raise RuntimeError("no mesh objects after import")
    return max(meshes, key=lambda o: len(o.data.materials))


def _find_armature():
    for o in bpy.context.scene.objects:
        if o.type == "ARMATURE":
            return o
    raise RuntimeError("no armature after import")


def _rotate_mesh_data(obj, rx_rad):
    """Rotate the mesh data vertices about local X (bakes into the data, bypasses object
    transform / parenting / armature-modifier interference)."""
    import bmesh

    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.rotate(bm, verts=bm.verts, matrix=Matrix.Rotation(rx_rad, 4, "X"))
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()


def _weld_by_position(obj, dist=0.0001):
    """Merge coincident vertices. The shipped MPFB body is split by glTF material seams
    (8 material regions exported as non-welded primitives -> 99 face-adjacency components);
    the Anny gown builder's chest-seed flood-fill assumes a single connected body surface.
    Welding the coincident seam verts restores the canonical 13,380-vert single surface."""
    import bmesh

    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.verts.ensure_lookup_table()
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=dist)
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()


def _local_bounds(o):
    xs = [v.co.x for v in o.data.vertices]
    ys = [v.co.y for v in o.data.vertices]
    zs = [v.co.z for v in o.data.vertices]
    return (
        round(min(xs), 3), round(max(xs), 3),
        round(min(ys), 3), round(max(ys), 3),
        round(min(zs), 3), round(max(zs), 3),
    )


def _new_objects_after(before_names):
    return [o for o in bpy.context.scene.objects if o.name not in before_names]


def _replace_with_clean_clinical_gown(garment, body_copy, armature):
    """Replace the damaged subdivided body shell with a small, regular clinical-gown cage.

    The prior surface-derived mesh repeatedly subdivided glTF seam-split triangles, producing the
    visible shard field even when its decorative fold displacement was disabled. This topology is
    authored from regular cross-section rings, then receives weights from the same fitted patient
    body. It deliberately keeps the existing first-party material and avoids external garment bytes.
    """
    source_materials = list(garment.data.materials)
    group_names = {group.index: group.name for group in body_copy.vertex_groups}

    def anatomical_weights(vertex, sleeve=False, shoulder=False):
        def permitted(name):
            if shoulder:
                return name.startswith(("spine", "neck", "shoulder", "clavicle", "upperarm01"))
            # Non-sleeve torso set must include the breast bones: measured 2026-11-03
            # (raycast ground truth on gown-rebake6: 501/90 skin-first rays at torso
            # front, x +/-0.13, z 1.17-1.28; defect-box body verts dominant-grouped
            # spine02 77 / breast.L 18 / breast.R 16) the section() rings fit only
            # spine/pelvis/upperleg/neck-weighted verts, so the chest cage hugged the
            # ribcage +18 mm ease while breast-weighted surface projects further and
            # poked through the shell. Including breast.* grows the chest rings to
            # enclose the full anatomical section and gives the chest cage verts
            # breast-bone weights in the spatial transfer below.
            return ("arm" in name or "clavicle" in name or "shoulder" in name) if sleeve else (
                name.startswith(("spine", "pelvis", "upperleg", "neck", "breast")))
        return [(group_names[entry.group], float(entry.weight)) for entry in vertex.groups
                if entry.group in group_names and permitted(group_names[entry.group]) and entry.weight > 1e-6]

    torso_sources = [vertex for vertex in body_copy.data.vertices
                     if sum(weight for _, weight in anatomical_weights(vertex)) > 0.5]
    arm_sources = [vertex for vertex in body_copy.data.vertices
                   if sum(weight for _, weight in anatomical_weights(vertex, True)) > 0.5]
    shoulder_sources = [vertex for vertex in body_copy.data.vertices
                        if sum(weight for name, weight in anatomical_weights(vertex, shoulder=True)
                               if name.startswith(("shoulder", "clavicle", "upperarm01"))) > 0.2]

    def shoulder_cap(position):
        # First-hit diagnostic locates the exposed deltoid at y=1.416–1.446, |x|=.147–.188.
        # Only this collar/shoulder region may inherit proximal upper-arm weights; the mid-torso
        # must still reject the distant T-pose arms that caused the original inflated cage.
        return 1.36 <= position.y <= 1.50 and abs(position.x) >= 0.11

    def section(y, fallback_x, fallback_z):
        sources = torso_sources + shoulder_sources if y >= 1.36 else torso_sources
        band = [vertex.co for vertex in sources if abs(float(vertex.co.y) - y) <= 0.035]
        if not band:
            raise RuntimeError(f"no anatomical body section at gown height {y}")
        # Fit the torso rather than a T-pose arm-span. The skirt gets modest ease over both thighs.
        ease = 0.025 if y < 1.05 else 0.018
        rx = max(abs(float(p.x)) for p in band) + ease
        rz = max(abs(float(p.z)) for p in band) + ease
        # Independent x/z extrema do not define an enclosing ellipse: a thigh's diagonal surface
        # can lie outside both-axis-fitted radii. Enclose every anatomical section sample.
        scale = max(1.0, max(math.hypot(float(p.x) / rx, float(p.z) / rz) for p in band))
        return rx * scale, rz * scale

    ring_anchors = [
        (0.56, 0.29, 0.18),
        (0.70, 0.29, 0.18),
        (0.88, 0.28, 0.18),
        (1.05, 0.26, 0.17),
        (1.22, 0.27, 0.18),
        (1.38, 0.29, 0.18),
        (1.49, 0.14, 0.11),
    ]
    # Twenty-five millimetre vertical sampling and 64 angular samples keep the silhouette smooth
    # and make every below-hip band a real closed loop rather than a sparsely sampled polygon.
    ring_spec = []
    ring_y = ring_anchors[0][0]
    while ring_y <= ring_anchors[-1][0] + 1e-6:
        upper = next((row for row in ring_anchors if row[0] >= ring_y), ring_anchors[-1])
        upper_index = ring_anchors.index(upper)
        lower = ring_anchors[max(0, upper_index - 1)]
        span = max(1e-6, upper[0] - lower[0])
        t = min(1.0, max(0.0, (ring_y - lower[0]) / span))
        ring_spec.append((
            ring_y,
            lower[1] + (upper[1] - lower[1]) * t,
            lower[2] + (upper[2] - lower[2]) * t,
        ))
        ring_y += 0.025
    segments = 82
    verts = []
    faces = []
    rings = []
    for y, fallback_x, fallback_z in ring_spec:
        rx, rz = section(y, fallback_x, fallback_z)
        ring = []
        for i in range(segments):
            angle = 2.0 * math.pi * i / segments
            ring.append(len(verts))
            verts.append((rx * math.cos(angle), y, rz * math.sin(angle)))
        rings.append(ring)
    for a, b in zip(rings, rings[1:]):
        for i in range(segments):
            j = (i + 1) % segments
            faces.append((a[i], a[j], b[j], b[i]))
    torso_vertex_count = len(verts)
    bridge_sources = {}

    # Short exam sleeves in the bind T pose. They overlap the shoulder ring so the rendered shell
    # is continuous; weight transfer binds them to the nearest upper-arm surface.
    for side in (-1.0, 1.0):
        sleeve_rings = []
        for step, x_abs in enumerate((0.22, 0.255, 0.29, 0.325, 0.36, 0.395)):
            band = [vertex.co for vertex in arm_sources if abs(float(vertex.co.x) - side * x_abs) <= 0.02]
            if not band:
                raise RuntimeError(f"no anatomical arm section at sleeve x={side * x_abs}")
            center_y = (min(p.y for p in band) + max(p.y for p in band)) / 2
            radius_y = (max(p.y for p in band) - min(p.y for p in band)) / 2 + 0.018
            radius_z = max(abs(p.z) for p in band) + 0.018
            scale = max(1.0, max(math.hypot((p.y - center_y) / radius_y, p.z / radius_z) for p in band))
            radius_y *= scale
            radius_z *= scale
            ring = []
            for i in range(24):
                angle = 2.0 * math.pi * i / 24
                ring.append(len(verts))
                verts.append((side * x_abs, center_y + radius_y * math.cos(angle), radius_z * math.sin(angle)))
            sleeve_rings.append(ring)
        for a, b in zip(sleeve_rings, sleeve_rings[1:]):
            for i in range(24):
                j = (i + 1) % 24
                # Reverse the left sleeve so both components face outward.
                face = (a[i], a[j], b[j], b[i])
                faces.append(tuple(reversed(face)) if side < 0 else face)

        # Stitch the proximal sleeve to the existing torso vertices. Separate overlapping tubes
        # opened a 14–28 mm shoulder seam when the torso was fitted properly. Shared anchor and
        # sleeve indices make this one continuous garment, with two blended transition rings.
        # Anchors must be DISTINCT: two adjacent sleeve stations sharing one torso vertex
        # collapse their quad to a triangle covering only the sleeve-side half, leaving a
        # sightline slit to the body (front/back of each arm root). Greedy nearest-unused
        # spreads anchors to neighbouring torso verts (mm-scale); the candidate pool is the
        # whole torso side, so exhaustion is impossible. Deterministic: fixed station order,
        # min() keeps the lowest torso index on ties.
        inner = sleeve_rings[0]
        candidates = [index for index in range(torso_vertex_count) if side * verts[index][0] > 0]
        anchors = []
        used_anchors = set()
        for sleeve_index in inner:
            target = verts[sleeve_index]
            anchor = min(
                (index for index in candidates if index not in used_anchors),
                key=lambda index: sum((verts[index][axis] - target[axis]) ** 2
                                      for axis in range(3)),
            )
            used_anchors.add(anchor)
            anchors.append(anchor)
        bridge_rings = [anchors]
        for blend in (1 / 3, 2 / 3):
            ring = []
            for anchor, sleeve_index in zip(anchors, inner):
                index = len(verts)
                ring.append(index)
                verts.append(tuple(verts[anchor][axis] * (1 - blend) + verts[sleeve_index][axis] * blend
                                   for axis in range(3)))
                bridge_sources[index] = (anchor, sleeve_index, blend)
            bridge_rings.append(ring)
        bridge_rings.append(inner)
        for a, b in zip(bridge_rings, bridge_rings[1:]):
            for index in range(24):
                following = (index + 1) % 24
                face = (a[index], a[following], b[following], b[index])
                face = tuple(dict.fromkeys(face))
                if len(face) >= 3:
                    faces.append(tuple(reversed(face)) if side < 0 else face)

    # Seal sightline lips around the sleeve roots. The bridge band shares torso VERTS
    # with the torso tube but not torso EDGES: every band-side edge is boundary, and
    # where the straight band edge chords across the curving tube (up to ~10 cm at the
    # outer arm root, measured in the shipped GLB) the gap shows the body through it.
    # Web each in-box boundary edge to its nearest torso vert. Existing verts only, so
    # weights and materials ride along; the web stands across the slit, occludes it,
    # and reads as a fold gusset. Cuffs (|x|~0.395), neck (y~1.485) and hem (y~0.56)
    # lie outside the seal box and are untouched. Deterministic: fixed edge order,
    # linear scan keeps the lowest torso index on ties.
    _SEAL_X_MIN, _SEAL_X_MAX, _SEAL_Y_MIN, _SEAL_Y_MAX = 0.10, 0.30, 1.08, 1.48
    _edge_use: dict[tuple[int, int], int] = {}
    for _f in faces:
        _n = len(_f)
        for _k in range(_n):
            _e = (min(_f[_k], _f[(_k + 1) % _n]), max(_f[_k], _f[(_k + 1) % _n]))
            _edge_use[_e] = _edge_use.get(_e, 0) + 1
    _lips = []
    for (_a, _b), _c in _edge_use.items():
        if _c != 1:
            continue
        _mx = (verts[_a][0] + verts[_b][0]) / 2.0
        _my = (verts[_a][1] + verts[_b][1]) / 2.0
        if not (_SEAL_X_MIN <= abs(_mx) <= _SEAL_X_MAX and _SEAL_Y_MIN <= _my <= _SEAL_Y_MAX):
            continue
        _lips.append((_a, _b))
    for (_a, _b) in _lips:
        _mx = (verts[_a][0] + verts[_b][0]) / 2.0
        _my = (verts[_a][1] + verts[_b][1]) / 2.0
        _mz = (verts[_a][2] + verts[_b][2]) / 2.0
        _best = None
        _best_d = None
        for _i in range(torso_vertex_count):
            if _i == _a or _i == _b:
                continue
            _d = (
                (verts[_i][0] - _mx) ** 2
                + (verts[_i][1] - _my) ** 2
                + (verts[_i][2] - _mz) ** 2
            )
            if _best_d is None or _d < _best_d:
                _best_d = _d
                _best = _i
        if _best is None:
            raise RuntimeError("no torso vert to seal a sleeve-root lip")
        faces.append((_a, _b, _best))
    print(f"SEAL_SLEEVE_ROOT lips={len(_lips)}")

    mesh = bpy.data.meshes.new("openclinxr_real_garment_hospital_gown_mesh")
    mesh.from_pydata(verts, [], faces)
    mesh.update(calc_edges=True)
    mesh["sourceRecipe"] = "tools/openclinxr/evidence/blender/bake_mpfb_gown_inspect.py#regular-clinical-gown-cage"
    mesh["garmentClass"] = "gown"
    mesh["licence"] = "first-party OpenClinXR procedural geometry"
    mesh["torsoVertexCount"] = torso_vertex_count
    mesh["weightingMethod"] = "anatomical-region-restricted-nearest-body; normalized; no neutral fallback"
    mesh["shoulderSeamMethod"] = "shared torso/sleeve topology with two anatomically blended transition rings"
    mesh["shoulderCapRegion"] = {"yMin": 1.36, "yMax": 1.50, "absXMin": 0.11}
    for material in source_materials:
        mesh.materials.append(material)
    old_mesh = garment.data
    garment.data = mesh
    garment.name = "openclinxr_real_garment_from_phenotype_hospital_gown"
    for polygon in mesh.polygons:
        polygon.use_smooth = True
    # The regular cage has no source-vertex correspondence. A bounded spatial transfer silently
    # left 292 vertices unweighted and assigned torso sides to arms. Search the full anatomically
    # appropriate source set; fail rather than exporting a neutral-bone fallback.
    from mathutils.kdtree import KDTree
    while garment.vertex_groups:
        garment.vertex_groups.remove(garment.vertex_groups[0])
    trees = []
    for sources in (torso_sources, arm_sources, shoulder_sources):
        tree = KDTree(len(sources))
        for index, vertex in enumerate(sources):
            tree.insert(vertex.co, index)
        tree.balance()
        trees.append(tree)
    skin_rows = {}
    for index, vertex in enumerate(mesh.vertices):
        if index in bridge_sources:
            continue
        sleeve = index >= torso_vertex_count
        shoulder = not sleeve and shoulder_cap(vertex.co)
        source_index = 2 if shoulder else int(sleeve)
        sources = (torso_sources, arm_sources, shoulder_sources)[source_index]
        _, nearest_index, _ = trees[source_index].find(vertex.co)
        weights = sorted(anatomical_weights(sources[nearest_index], sleeve, shoulder), key=lambda row: -row[1])[:4]
        total = sum(weight for _, weight in weights)
        if total <= 0:
            raise RuntimeError(f"gown vertex {index} has no anatomical weight")
        skin_rows[index] = {name: weight / total for name, weight in weights}
    for index, (anchor, sleeve_index, blend) in bridge_sources.items():
        weights = {}
        for name, weight in skin_rows[anchor].items():
            weights[name] = weights.get(name, 0) + weight * (1 - blend)
        for name, weight in skin_rows[sleeve_index].items():
            weights[name] = weights.get(name, 0) + weight * blend
        strongest = sorted(weights.items(), key=lambda row: -row[1])[:4]
        total = sum(weight for _, weight in strongest)
        skin_rows[index] = {name: weight / total for name, weight in strongest}
    for index, weights in skin_rows.items():
        for name, weight in weights.items():
            group = garment.vertex_groups.get(name) or garment.vertex_groups.new(name=name)
            group.add([index], weight, "REPLACE")
    if old_mesh.users == 0:
        bpy.data.meshes.remove(old_mesh)
    print(
        f"CLEAN_CLINICAL_GOWN verts={len(mesh.vertices)} faces={len(mesh.polygons)} "
        f"rings={len(rings)} sleeves=2"
    )


HIDDEN_MAT_PREFIX = "openclinxr_hidden_"


def _clear_stale_body_hide_materials(body):
    """Return stale alpha-MASK polys to skin so the shell-driven re-hide starts clean.

    The body arrives from mpfb-viseme-inspect.glb carrying hide assignments sized for
    the OLD footprint (jeans-era lower + conformal-wrap upper). The new draped cage
    covers a different footprint, so the stale mask both hides skin the gown no longer
    covers (legs below the hem) and is measured against the wrong shell. Every polygon
    carrying an openclinxr_hidden_* material is reassigned to the mpfb_skin_* slot;
    hidden slots are then dropped and surviving indices remapped. Painted lower-region
    polys are never hidden-material polys (paint and hide are separate slots), so the
    #73/#124 lower-paint counterweights are untouched — verified by the open-front
    counterweight clause after the bake.
    """
    skin_idx = next(
        (i for i, m in enumerate(body.data.materials) if m is not None and m.name.startswith("mpfb_skin")),
        None,
    )
    if skin_idx is None:
        raise RuntimeError("no mpfb_skin_* material slot on the imported body")
    hidden = {m.name for m in body.data.materials if m is not None and m.name.startswith(HIDDEN_MAT_PREFIX)}
    if not hidden:
        print("CLEAR_STALE_HIDE no stale hidden materials")
        return {"clearedPolygons": 0, "droppedSlots": 0}
    cleared = 0
    for poly in body.data.polygons:
        mat = body.data.materials[poly.material_index]
        if mat is not None and mat.name in hidden:
            poly.material_index = skin_idx
            cleared += 1
    kept = [m for m in body.data.materials if m is None or not m.name.startswith(HIDDEN_MAT_PREFIX)]
    remap = {}
    new_index = 0
    for old_index, m in enumerate(body.data.materials):
        if m is None or not m.name.startswith(HIDDEN_MAT_PREFIX):
            remap[old_index] = new_index
            new_index += 1
    dropped = len(body.data.materials) - len(kept)
    body.data.materials.clear()
    for m in kept:
        body.data.materials.append(m)
    for poly in body.data.polygons:
        poly.material_index = remap[poly.material_index]
    print(f"CLEAR_STALE_HIDE cleared={cleared} droppedSlots={dropped}")
    return {"clearedPolygons": cleared, "droppedSlots": dropped}


def _rehide_body_under_gown(body, gown, armature):
    """Paint a fresh body-part-hiding mask driven by the NEW gown shell.

    Wired, not authored (D1): the proven materialize chain — garment_coverage.
    body_hide_mask (signed clearance < HIDE_EPSILON_M against the garment surface;
    faces with no garment within reach are NOT hidden) + garment_ops.
    scope_hide_mask_away_from_hands (#295) + clip_hide_mask_to_garment_footprint
    (#326, 1.5 mm slack, inside the 2 mm gate) + clip_hide_mask_below_joint (#334)
    + apply_body_hide_material_region (alpha-0 slot "gown"). The issue-341
    poke/sliver refinements are shirt-specific (sub-mm conformal fits); the draped
    cage stands 18-25 mm off the body, so no coincident class exists to refine.

    Frame: the imported body, gown (re-parented with identity inverse) and armature
    are all at identity, so local coords ARE world coords (same convention the clips
    assume). Fail closed otherwise — a wrong-frame mask is worse than none.
    """
    import numpy as _np

    _MAKECLOTHES_DIR = REPO_ROOT / "tools/openclinxr/asset-pipeline/makeclothes"
    _BODY_PARAM_DIR = REPO_ROOT / "packages/openclinxr/factory-stations/src/body_param"
    for _p in (str(_MAKECLOTHES_DIR), str(_BODY_PARAM_DIR)):
        if _p not in sys.path:
            sys.path.insert(0, _p)
    from garment_coverage import HIDE_EPSILON_M, body_hide_mask  # noqa: E402
    from garment_ops import (  # noqa: E402
        apply_body_hide_material_region,
        clip_hide_mask_below_joint,
        clip_hide_mask_to_garment_footprint,
        scope_hide_mask_away_from_hands,
    )

    for _o in (body, gown, armature):
        _mw = _o.matrix_world
        for _r in range(4):
            for _c in range(4):
                _want = 1.0 if _r == _c else 0.0
                if abs(_mw[_r][_c] - _want) > 1e-6:
                    raise RuntimeError(
                        f"gown re-hide needs identity transform: {_o.name} "
                        f"matrix_world[{_r}][{_c}]={_mw[_r][_c]}"
                    )

    def _triangulate(obj):
        # Fan triangulation mirroring materialize _triangulate_numpy: the coverage
        # predicate consumes triangles, and apply_body_hide_material_region maps the
        # mask back in polygon fan order, so both must agree.
        verts = _np.array([tuple(v.co) for v in obj.data.vertices], dtype=float)
        faces: list[tuple[int, int, int]] = []
        for _p in obj.data.polygons:
            _iv = list(_p.vertices)
            if len(_iv) == 3:
                faces.append((_iv[0], _iv[1], _iv[2]))
            else:
                for _i in range(1, len(_iv) - 1):
                    faces.append((_iv[0], _iv[_i], _iv[_i + 1]))
        return verts, _np.array(faces, dtype=_np.int64)

    _body_verts, _body_faces = _triangulate(body)
    _gown_verts, _gown_faces = _triangulate(gown)
    _gmin = _gown_verts.min(axis=0)
    _gmax = _gown_verts.max(axis=0)
    _gb = {"min": [float(_v) for _v in _gmin], "max": [float(_v) for _v in _gmax]}
    _info = body_hide_mask(
        _body_verts,
        _body_faces,
        _gown_verts,
        _gown_faces,
        float(_gmin[2]),
        float(_gmax[2]),
        hide_epsilon_m=HIDE_EPSILON_M,
        height_axis=2,
    )
    _mask = _info.pop("hideMask")
    _mask, _hands = scope_hide_mask_away_from_hands(body, _mask, armature)
    _mask, _footprint = clip_hide_mask_to_garment_footprint(_mask, body, _gb)
    _pose_head = armature.pose.bones.get("head")
    if _pose_head is None:
        raise RuntimeError("head bone missing from the MPFB standard rig")
    _head_z = float((armature.matrix_world @ _pose_head.matrix).translation.z)
    _mask, _headcut = clip_hide_mask_below_joint(_mask, body, _head_z)
    _rep = apply_body_hide_material_region(body, _mask, slot="gown")
    print(
        f"GOWN_REHIDE regionFaces={_info.get('regionFaceCount')} "
        f"rawHidden={_info.get('hiddenFaceCount')} handsUnhidden={_hands} "
        f"footprintClipped={_footprint} headClipped={_headcut} applied={_rep.get('appliedPolygonCount')} "
        f"slot={_rep.get('hiddenMaterialName')} epsilonM={HIDE_EPSILON_M}"
    )
    return _rep


# Black definition shared with the proven atlas hole fill
# (tools/openclinxr/evidence/blender/inpaint_skin_atlas_throat.py SKIN_MIN_MAXC):
# texels darker than this are atlas background or unbaked voids, never skin.
SKIN_HOLE_BLACK_MAXC = 16 / 255


def _restore_unbaked_skin_texels(body):
    """Fill unbaked-black texels under the body's skin-primitive UVs with the texture's own skin median.

    The viseme input bakes its skin albedo while the jeans-era lower + old-wrap upper faces are
    hidden, leaving black (unbaked) holes in the leg/pelvis islands. The gown re-hide unhides the
    legs, exposing those holes as black skin in every runtime (three.js samples the same texels
    EEVEE does). The old shipped full-leg albedos belong to an older body generation (3219 vs
    7598 verts, different UV layouts), so no shipped source can be position-copied; the fill is
    the median of the texture's own covered non-black texels — the same principle as the proven
    inpaint_skin_atlas_throat hole fill (black = max(R,G,B) < 16, neighbor-skin median, never
    invented detail; the normal map still carries pore detail). Deterministic: median of a fixed
    texel set. No geometry, material assignment, or hidden-region semantics change; hidden faces
    stay hidden (their discarded texels are filled identically and harmlessly).
    """
    import numpy as _np

    skin_idx = next(
        (i for i, m in enumerate(body.data.materials) if m is not None and m.name.startswith("mpfb_skin")),
        None,
    )
    if skin_idx is None:
        raise RuntimeError("no mpfb_skin_* material slot on the imported body")
    mat = body.data.materials[skin_idx]
    if mat.use_nodes is False or mat.node_tree is None:
        raise RuntimeError("skin material has no node tree")
    bsdf = next((n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
    if bsdf is None:
        raise RuntimeError("skin material has no Principled node")
    base_links = bsdf.inputs["Base Color"].links
    if not base_links or base_links[0].from_node.type != "TEX_IMAGE":
        raise RuntimeError("skin Base Color is not image-driven")
    img = base_links[0].from_node.image
    if img is None:
        raise RuntimeError("skin Base Color image missing")
    w, h = int(img.size[0]), int(img.size[1])
    if w <= 0 or h <= 0:
        raise RuntimeError(f"skin image has no pixels: {img.name}")
    # foreach_get/foreach_set exchange float32 buffers (float64 raises
    # "incorrect sequence item type"); compute in float64 on a copy.
    raw = _np.zeros(w * h * 4, dtype=_np.float32)
    img.pixels.foreach_get(raw)
    px = raw.astype(_np.float64).reshape(h, w, 4)
    uv_layer = body.data.uv_layers.active or (body.data.uv_layers[0] if body.data.uv_layers else None)
    if uv_layer is None:
        raise RuntimeError("body mesh has no UV layer")
    covered = _np.zeros((h, w), dtype=bool)
    # UVs are 0..1; rasterize in PIXEL space (a prior round mixed frames and
    # covered zero texels, silently filling nothing — fail closed on that).
    for poly in body.data.polygons:
        if poly.material_index != skin_idx:
            continue
        lu = _np.array([uv_layer.data[li].uv[:] for li in poly.loop_indices], dtype=_np.float64)
        lu[:, 0] *= w
        lu[:, 1] *= h
        for _i in range(1, len(lu) - 1):
            tri = lu[[0, _i, _i + 1]]
            xs = tri[:, 0]
            ys = tri[:, 1]
            x0 = max(0, int(_np.floor(xs.min())))
            x1 = min(w - 1, int(_np.ceil(xs.max())))
            y0 = max(0, int(_np.floor(ys.min())))
            y1 = min(h - 1, int(_np.ceil(ys.max())))
            if x1 < x0 or y1 < y0:
                continue
            gx, gy = _np.meshgrid(_np.arange(x0, x1 + 1), _np.arange(y0, y1 + 1))
            # Barycentric edge signs (consistent winding => same sign inside).
            d1 = (gy - tri[1, 1]) * (tri[2, 0] - tri[1, 0]) - (gx - tri[1, 0]) * (tri[2, 1] - tri[1, 1])
            d2 = (gy - tri[2, 1]) * (tri[0, 0] - tri[2, 0]) - (gx - tri[2, 0]) * (tri[0, 1] - tri[2, 1])
            d0 = (gy - tri[0, 1]) * (tri[1, 0] - tri[0, 0]) - (gx - tri[0, 0]) * (tri[1, 1] - tri[0, 1])
            inside = ((d0 >= 0) & (d1 >= 0) & (d2 >= 0)) | ((d0 <= 0) & (d1 <= 0) & (d2 <= 0))
            covered[y0 : y1 + 1, x0 : x1 + 1] |= inside
    black = px[:, :, :3].max(axis=2) < SKIN_HOLE_BLACK_MAXC
    holes = black & covered
    hole_n = int(holes.sum())
    covered_n = int(covered.sum())
    print(
        f"SKIN_TEXEL_DEBUG image={img.name} {w}x{h} skinPolys="
        f"{sum(1 for p in body.data.polygons if p.material_index == skin_idx)} "
        f"covered={covered_n} black={int(black.sum())} holes={hole_n}"
    )
    if covered_n == 0:
        raise RuntimeError("skin UV rasterization covered zero texels; refusing a vacuous fill")
    if hole_n == 0:
        print("SKIN_TEXEL_RESTORE holes=0 (atlas already complete)")
        return {"holesFilled": 0}
    ring = covered & ~black
    ring_n = int(ring.sum())
    if ring_n == 0:
        raise RuntimeError("no covered non-black skin texels to sample the fill from")
    fill = _np.median(px[ring][:, :3].astype(_np.float64), axis=0)
    if float(fill.max()) < SKIN_HOLE_BLACK_MAXC:
        raise RuntimeError("skin fill median is near-black; refusing to write black as fill")
    px[holes, :3] = fill
    img.pixels.foreach_set(px.reshape(-1).astype(_np.float32))
    img.update()
    print(
        f"SKIN_TEXEL_RESTORE holes={hole_n} ringTexels={ring_n} "
        f"fillRGB=({fill[0]:.3f},{fill[1]:.3f},{fill[2]:.3f}) image={img.name} {w}x{h}"
    )
    return {"holesFilled": hole_n, "ringTexels": ring_n, "fillRGB": [float(v) for v in fill]}


def main() -> None:
    ap = argparse.ArgumentParser(description="#480 bake MPFB gown inspect GLB")
    ap.add_argument("--input-glb", default=str(GEN / "mpfb-viseme-inspect.glb"))
    ap.add_argument("--output-glb", default=str(GEN / "mpfb-gown-inspect.glb"))
    ap.add_argument("--rlq-report", default=str(GEN / "bake-rlq-rematerialize-report.json"))
    ap.add_argument("--rlq-provenance", default="")
    args = ap.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:])

    bpy.ops.wm.read_factory_settings(use_empty=True)
    for o in list(bpy.context.scene.objects):
        bpy.data.objects.remove(o, do_unlink=True)

    bpy.ops.import_scene.gltf(filepath=str(REPO_ROOT / args.input_glb))
    bpy.context.view_layer.update()

    body = _find_body()
    armature = _find_armature()
    print(f"IMPORTED body={body.name!r} verts={len(body.data.vertices)} armature={armature.name!r}")
    print(f"BODY_LOCAL x={_local_bounds(body)}")

    _strip_lower_garments(body)
    _strip_redundant_upper_garments(body)
    _strip_existing_gown()
    bpy.context.view_layer.update()

    before = {o.name for o in bpy.context.scene.objects}

    # Clean, unparented Y-up body copy. The builder reads local Y as height; the real body
    # stays untouched (Z-up, shipped skin/hide materials intact). No parent, no armature
    # modifier, no shape keys: bmesh from_mesh/to_mesh inside the builder drops/corrupts
    # shape keys, and a parented+modifier copy defeats direct vertex rotation.
    body_copy = body.copy()
    body_copy.data = body.data.copy()
    bpy.context.collection.objects.link(body_copy)
    body_copy.name = f"{body.name}__gown_bake_copy"
    body_copy.data.name = f"{body.name}__gown_bake_copy"
    body_copy.parent = None
    body_copy.matrix_parent_inverse = Matrix.Identity(4)
    body_copy.modifiers.clear()
    if body_copy.data.shape_keys is not None:
        body_copy.shape_key_clear()
    _rotate_mesh_data(body_copy, -math.pi / 2.0)
    _weld_by_position(body_copy)
    bpy.context.view_layer.update()
    print(f"BODY_COPY_YUP x={_local_bounds(body_copy)} verts={len(body_copy.data.vertices)}")

    # Invoke the existing gown kind on the MPFB body copy — the D1 wiring point. The swept
    # #200 parameter set (0.42 sleeve, 0.32 hem) and the locked gown colour are the
    # builder's own; nothing is re-swept or re-authored here.
    phenotype = {
        "garmentLayers": ["hospital_gown"],
        "clothing_style": "clinical_exam_hospital_gown_chest_pain",
        "clothing_color": "soft_blue",
        "fabricPalette": "hospital_gown_blue_pattern",
        "role_visual_cue": "ed_chest_pain_patient",
        "skin_tone": "warm_medium",
        "hair_color": "brown",
        "eye_color": "brown",
    }
    result = apply_role_clothing_material_regions(body_copy, "patient", phenotype, armature)
    bpy.context.view_layer.update()
    print("GOWN_BUILDER_RESULT " + json.dumps({k: result.get(k) for k in (
        "realGarmentLayers", "declaredUpperGarmentLayers", "declaredUpperGarmentLayerCount",
        "lowerFaceCount", "armFaceCount", "skippedTorsoPaintBecauseRealGarment",
    ) if k in result}, default=str))

    for obj in _new_objects_after(before):
        if obj.type == "MESH" and "real_garment_from_phenotype_hospital_gown" in obj.name:
            _replace_with_clean_clinical_gown(obj, body_copy, armature)
            break

    created = _new_objects_after(before)
    print(f"CREATED_OBJECTS {[o.name for o in created]}")

    # Keep only the gown shell + declaration micro-tri. Rotate them back to Z-up local data
    # and re-home onto the real body + real rig. The Anny-rail footwear slippers and the
    # discardable painted body copy are dropped (the MPFB body already wears toigo flats).
    kept = []
    discard = []
    for obj in created:
        if obj.type != "MESH":
            continue
        name = obj.name.lower()
        if "real_garment" in name or "declared_upper_layers" in name:
            _rotate_mesh_data(obj, math.pi / 2.0)
            obj.parent = body
            obj.matrix_parent_inverse = Matrix.Identity(4)
            # Re-point the armature modifier to the real rig (belt-and-braces; it already
            # points there because the real armature was passed as arm_obj).
            for mod in obj.modifiers:
                if mod.type == "ARMATURE":
                    mod.object = armature
            kept.append(obj)
        else:
            discard.append(obj)

    # Re-parent first, THEN delete the discarded copies (deleting a parent while children
    # still reference it raises a StructRNA ReferenceError).
    for obj in discard:
        bpy.data.objects.remove(obj, do_unlink=True)
    bpy.context.view_layer.update()

    for obj in kept:
        print(f"KEPT {obj.name!r} x={_local_bounds(obj)}")

    # The stale viseme-input hide mask is sized for the old footprint (jeans-era
    # lower, conformal-wrap upper, T-shirt). Clear it and re-drive the mask from
    # the new draped shell, or legs stay masked below the hem and the chest keeps
    # the old wrap's hide assignment. Runs on the FINAL parented shell pre-export.
    gown_obj = next(
        (o for o in kept if o.type == "MESH" and "real_garment_from_phenotype_hospital_gown" in o.name),
        None,
    )
    if gown_obj is None:
        raise RuntimeError("gown shell missing before re-hide")
    _clear_stale_body_hide_materials(body)
    bpy.context.view_layer.update()
    _rehide_body_under_gown(body, gown_obj, armature)
    bpy.context.view_layer.update()

    # The re-hide unhides the legs, exposing unbaked-black holes the viseme input
    # carries in its skin albedo (baked while those faces were hidden). Fill them
    # from the texture's own skin before export, or every runtime shows black legs.
    _restore_unbaked_skin_texels(body)
    bpy.context.view_layer.update()

    bpy.ops.object.select_all(action="SELECT")
    out = REPO_ROOT / args.output_glb
    out.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=str(out),
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_materials="EXPORT",
        export_image_format="AUTO",
        export_skins=True,
        export_morph=True,
        export_texcoords=True,
        export_normals=True,
        export_extras=True,
    )
    print(f"EXPORTED {out} {out.stat().st_size} bytes")
    rlq_provenance = pathlib.Path(args.rlq_provenance) if args.rlq_provenance else None
    rlq_report = rematerialize_rlq_clip(out, REPO_ROOT / args.rlq_report if args.rlq_report else None, rlq_provenance)
    if rlq_report is not None:
        print(f"RLQ_REMATERIALIZED {json.dumps({k: rlq_report.get(k) for k in ('animationName', 'appliedNodeCount', 'appliedNodes')}, default=str)}")


if __name__ == "__main__":
    main()
