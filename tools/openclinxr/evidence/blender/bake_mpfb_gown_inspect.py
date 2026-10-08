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
import sys

import bpy
from mathutils import Matrix

REPO_ROOT = pathlib.Path(__file__).resolve().parents[4]
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
            return ("arm" in name or "clavicle" in name or "shoulder" in name) if sleeve else (
                name.startswith(("spine", "pelvis", "upperleg", "neck")))
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
        inner = sleeve_rings[0]
        candidates = [index for index in range(torso_vertex_count) if side * verts[index][0] > 0]
        anchors = []
        for sleeve_index in inner:
            target = verts[sleeve_index]
            anchor = min(candidates, key=lambda index: sum((verts[index][axis] - target[axis]) ** 2
                                                          for axis in range(3)))
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


def main() -> None:
    ap = argparse.ArgumentParser(description="#480 bake MPFB gown inspect GLB")
    ap.add_argument("--input-glb", default=str(GEN / "mpfb-viseme-inspect.glb"))
    ap.add_argument("--output-glb", default=str(GEN / "mpfb-gown-inspect.glb"))
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


if __name__ == "__main__":
    main()
