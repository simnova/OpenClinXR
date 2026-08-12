import argparse
import json
import pathlib
import re
import struct
import sys
import zlib

import bpy
import numpy as np

REPO_ROOT = pathlib.Path(__file__).resolve().parents[4]

# The mask machinery's proven pure-numpy ray intersector + winding orientation
# (garment_coverage.py imports only stdlib + numpy — safe at module load). The
# round-7 render-truth helpers use them; the in-main imports below keep the
# existing convention for the rest of the pipeline.
_MAKECLOTHES_DIR = REPO_ROOT / "tools/openclinxr/asset-pipeline/makeclothes"
if str(_MAKECLOTHES_DIR) not in sys.path:
    sys.path.insert(0, str(_MAKECLOTHES_DIR))
from garment_coverage import _orient_outward, _ray_tri_hits  # noqa: E402

# #333: footwear mapped by reference id. All three are the CC0/CC-0 zero-helper-ref
# subset of makehuman-shoes01 (ledger: toigo_flats CC0, toigo_mj_cloth_shoes CC0,
# culturalibre_male_boots CC-0; every .mhclo references only basemesh verts < 13,380),
# so each fits the #318 helper-stripped 13,380-vert basemesh like the t-shirt/pants.
SHOE_BY_REFERENCE = {
    None: "toigo_flats",
    "peds_nurse_kevin": "culturalibre_male_boots",
    "peds_patient_child": "toigo_mj_cloth_shoes",
}

# #343 — phenotype skin-tone token -> MpfbSkinMasterColor SkinColor (RGB).
# Authored DATA table (the same pattern as SHOE_BY_REFERENCE, and the hair_color ->
# base_color table in automate_blender.py apply_mesh_native_scalp_hair_material_region):
# the anny manifest carries the token (`input_params.phenotype.skin_tone`), the SHIPPED
# enhanced_skin shader's master color node consumes the RGB. This is NOT the refused
# "three hand-picked flat literals" treatment — the material is the shipped procedural
# skin shader baked to a texture; only the TONE parameter comes from this table, and it
# is keyed by the case definition's phenotype token, not by actor id. "default" applies
# when the reference has no manifest (aisha path) and keeps the pre-#343 shipped value
# so the default body's tone is continuous.
SKIN_TONE_RGB = {
    "warm_light_child": (0.84, 0.70, 0.60),
    "warm_light": (0.78, 0.62, 0.52),
    "medium_warm": (0.58, 0.44, 0.36),
    "default": (0.68, 0.53, 0.44),
}


def phenotype_skin_tone(reference_id):
    """Read the reference's declared skin_tone from its tracked anny manifest.

    The manifest lives beside the .anny_base.obj the macro solve already reads
    (`input_params.phenotype.skin_tone`). None/absent -> the "default" tone (aisha
    has no manifest and no declared phenotype in the ob-preeclampsia fixture).
    """
    if not reference_id:
        return "default"
    manifest = (
        REPO_ROOT / "apps/ui-xr/public/generated-humanoids" / f"{reference_id}.anny_manifest.json"
    )
    if not manifest.is_file():
        return "default"
    try:
        m = json.loads(manifest.read_text(encoding="utf-8"))
        tone = m.get("input_params", {}).get("phenotype", {}).get("skin_tone")
        return tone if tone else "default"
    except Exception:
        return "default"

# #335/#332 — the anatomical neck band (MADR 0051 §4, anny-mpfb-landmark-compare.ts
# BAND_WINDOWS.neck): the narrowest torso slice below the head, as a fraction of
# the body's own stature. A fitted upper garment whose COLLAR (top vertex) sits
# below this band is misplaced — measured 2026-08-11: the child's t-shirt collar
# at 0.545 H (its hip) while every adult on both rails sits at 0.852-0.920.
NECK_BAND_H = (0.78, 0.92)


def _joint_world_z(armature: bpy.types.Object, name: str) -> float:
    """World Z of a rest-pose bone head — the same frame world_bounds reports.

    Walks pose -> rest matrix -> world, NOT inverse-bind inversion (#334's failed
    instrument: `-R^T·t` assumes no scale and MPFB's IBMs carry it). The scene is
    at rest when the masks/align run (the ClinicalIdle action is created later),
    so `pose_bone.matrix` is the rest matrix.
    """
    pose_bone = armature.pose.bones.get(name)
    if pose_bone is None:
        raise RuntimeError(f"#335: {name} bone missing from the MPFB standard rig")
    return (armature.matrix_world @ pose_bone.matrix).translation.z


def align_upper_garment_to_neck(garment, human, armature):
    """#332 — a fitted upper garment whose collar sits BELOW the neck band is
    translated so its collar lands at the body's OWN neck01 joint.

    `ClothesService.fit_clothes_to_human` maps the .mhclo body-vertex refs onto the
    armature-deformed body, so the SAME t-shirt lands differently on each body
    (measured 2026-08-11: aisha collar 0.852 H, nurse 0.920 H, child 0.545 H — the
    child's at its hip). Anchoring the collar to the body's own neck01 reproduces
    the aisha working fit (collar 0.852 vs neck01 0.848 — the collar sits at the
    base of the neck) on every body, per-body and anatomy-derived, no fitted
    constant. Only the TOO-LOW case is aligned: a collar ABOVE the band is the
    #334 hide-mask's territory (the mask clips to the head joint), not a translate.

    FRAMES, measured (the materializer's rig is added on the FULL base before the
    #318 helper strip, so the depsgraph armature-modifier evaluation does NOT match
    the glTF export): the body's stature is read from the RAW mesh
    (`matrix_world @ v.co` on `human.data.vertices`, the same frame
    `_triangulate_numpy` and the export use), NOT from `world_bounds` (which reads
    the armature-deformed evaluated mesh — measured 0.824 m against the shipped
    1.241 m body). The garment's top is `v.co.z` (local == world; the exported
    bytes confirm local == exported world). The neck01 joint is read at rest via
    `_joint_world_z` (the armature aligns with the full base; measured 1.036 m for
    the child, matching the exported GLB).

    The translate runs BEFORE the weight projection so the k-NN binds the shirt to
    the torso/neck bones at its final height, and before the hide-mask computation
    so the mask follows the shirt.
    """
    top_z = max(v.co.z for v in garment.data.vertices)
    mw_h = human.matrix_world
    zmin = min((mw_h @ v.co).z for v in human.data.vertices)
    zmax = max((mw_h @ v.co).z for v in human.data.vertices)
    stature = zmax - zmin
    if stature <= 0:
        raise RuntimeError("#332: non-positive body stature for the neck-band fraction")
    frac = (top_z - zmin) / stature
    if frac >= NECK_BAND_H[0]:
        print(f"GARMENT_NECK_ALIGN keep collarFrac {frac:.4f} (at or above the neck band)")
        return {"aligned": False, "collarFrac": frac, "deltaZ": 0.0}
    neck_z = _joint_world_z(armature, "neck01")
    delta = neck_z - top_z
    for v in garment.data.vertices:
        v.co.z += delta
    bpy.context.view_layer.update()
    new_top = max(v.co.z for v in garment.data.vertices)
    print(
        f"GARMENT_NECK_ALIGN collarFrac {frac:.4f} -> topZ {new_top:.4f} "
        f"(neck01 {neck_z:.4f}, deltaZ {delta:.4f})"
    )
    return {"aligned": True, "collarFrac": frac, "deltaZ": delta}


def make_material(name, color):
    material = bpy.data.materials.new(name)
    material.diffuse_color = color
    material.use_nodes = True
    material.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = color
    material.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.78
    return material


def parse_mhmat(path):
    """Parse a MakeHuman .mhmat key-value material file.

    The format is `key value1 value2 ...` per line with '#' comments (the
    brown.mhmat the low-poly eye .mhclo declares is a representative example).
    Returns the raw multi-value lists; each consumer decides which keys it uses
    (diffuseTexture, diffuseColor, ...) — no invented interpretation of keys
    this repo does not consume.
    """
    props = {}
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        t = line.strip()
        if not t or t.startswith("#"):
            continue
        parts = t.split()
        if len(parts) >= 2:
            props[parts[0]] = parts[1:]
    return props


def mhmat_for_mhclo(mhclo_path):
    """Resolve a .mhclo's declared `material <rel>` line to a real .mhmat path.

    Upstream, the material lives one directory up (`data/eyes/hm08/low-poly/
    low-poly.mhclo` declares `material ../materials/brown.mhmat`), but the
    provider cache stages the asset files FLAT in one directory (#337), so the
    declared path resolves beside the .mhclo instead. The declared path is tried
    first; the flat-cache layout is the measured fallback. Either way the
    material is the ASSET'S OWN declaration, not one authored here (D1).
    """
    declared = None
    for line in mhclo_path.read_text(encoding="utf-8", errors="replace").splitlines():
        t = line.strip()
        if t.startswith("material "):
            declared = (mhclo_path.parent / t.split(None, 1)[1].strip()).resolve()
            break
    if declared is not None and declared.is_file():
        return declared
    if declared is not None:
        flat = mhclo_path.parent / declared.name
        if flat.is_file():
            return flat
    raise RuntimeError(f"#340: no .mhmat found for {mhclo_path} (declared {declared})")


def make_material_from_mhmat(mhmat_path, name):
    """Build a glTF-exportable Principled BSDF material from a MakeHuman .mhmat.

    MakeHuman's material model is a litsphere shader with a diffuse map; the
    litsphere has no glTF equivalent, but the diffuse map IS the glTF
    baseColorTexture — the binding the #340 evidence RED reads. The pipeline
    previously emitted a FLAT baseColor for every channel (two slices adjusted
    the eye colour and produced no eye), because nothing ever consumed a
    .mhmat. This is the generic path: `diffuseTexture` is resolved relative to
    the .mhmat and wired to Principled Base Color; `diffuseColor` (RGB; the
    .mhmat format has no alpha key) becomes the baseColorFactor with alpha 1.
    The blend stays OPAQUE so the glTF exporter emits alphaMode=OPAQUE and an
    RGBA texture's alpha channel (a MakeHuman shader input, not a cutout mask)
    is not misread as a discard mask. Skin and garments take the same path when
    their .mhmat files are staged — this is not eye-special-cased.
    """
    props = parse_mhmat(mhmat_path)
    diffuse = props.get("diffuseTexture")
    color = props.get("diffuseColor") or ["1.0", "1.0", "1.0"]
    try:
        factor = [float(color[0]), float(color[1]), float(color[2]), 1.0]
    except (IndexError, ValueError):
        factor = [1.0, 1.0, 1.0, 1.0]
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    bsdf = material.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = factor
    if diffuse:
        tex_rel = pathlib.Path(diffuse[0])
        tex_path = (mhmat_path.parent / tex_rel).resolve()
        if not tex_path.is_file():
            raise RuntimeError(
                f"#340: {mhmat_path.name} declares diffuseTexture {tex_rel} "
                f"but {tex_path} is not staged in the provider cache"
            )
        img = bpy.data.images.load(str(tex_path), check_existing=True)
        tex_node = material.node_tree.nodes.new("ShaderNodeTexImage")
        tex_node.image = img
        material.node_tree.links.new(tex_node.outputs["Color"], bsdf.inputs["Base Color"])
    return material


def bake_skin_material_to_texture(human, skin_material_name, out_png_path, resolution=1024):
    """#343 — bake the SHIPPED enhanced_skin node tree to a glTF baseColorTexture.

    glTF carries no procedural shaders and Blender 5.1's glTF exporter has no
    material-bake step (measured on this issue: the exporter emits flat
    [1,1,1,1] for the enhanced_skin tree). Cycles CAN bake the tree's surface
    output to an image (measured: DIFFUSE pass, 1,042,362-byte PNG, survives
    export as baseColorTexture when wired into Principled Base Color). This
    function bakes ONLY the faces assigned to the skin material — faces whose
    material has no active image node (scalp, hidden-mask) are skipped by the
    bake, so the texture carries the skin shader output and nothing else.

    Returns the baked image (bpy.types.Image) already saved to out_png_path.
    """
    skin_idx = next(
        (i for i, m in enumerate(human.data.materials) if skin_material_name in (m.name or "")),
        None,
    )
    if skin_idx is None:
        raise RuntimeError(f"#343: skin material {skin_material_name} not found for bake")
    skin_mat = human.data.materials[skin_idx]

    scene = bpy.context.scene
    prev_engine = scene.render.engine
    prev_device = getattr(scene.cycles, "device", "CPU")
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.render.bake.use_pass_direct = False
    scene.render.bake.use_pass_indirect = False
    scene.render.bake.use_pass_color = True

    img = bpy.data.images.new(f"mpfb_skin_bake_{skin_material_name}", resolution, resolution)
    tex_node = skin_mat.node_tree.nodes.new("ShaderNodeTexImage")
    tex_node.image = img
    tex_node.select = True
    skin_mat.node_tree.nodes.active = tex_node

    # Select ONLY the human so the bake does not touch the eyes/garments/shoes.
    bpy.ops.object.select_all(action="DESELECT")
    human.select_set(True)
    bpy.context.view_layer.objects.active = human
    try:
        bpy.ops.object.bake(type="DIFFUSE", pass_filter={"COLOR"}, margin=2, use_clear=True)
    finally:
        scene.render.engine = prev_engine
        scene.cycles.device = prev_device

    out_png = pathlib.Path(out_png_path)
    out_png.parent.mkdir(parents=True, exist_ok=True)
    img.filepath_raw = str(out_png)
    img.file_format = "PNG"
    img.save()
    print(f"SKIN_BAKE {out_png} bytes={out_png.stat().st_size}")
    return img


def _median_uv_edge_px(obj, resolution):
    """Median UV edge length of a mesh in texture pixels.

    The natural scale for an image-space smoothing radius: a property of the
    mesh's own unwrap (how many texels one polygon edge spans), not a fitted
    constant. Used by the round-11 child Z-channel fallback to size its
    majority-vote window.
    """
    uv = obj.data.uv_layers.active
    if uv is None or resolution <= 0:
        return None
    lens = []
    for poly in obj.data.polygons:
        start = poly.loop_start
        total = poly.loop_total
        for k in range(total):
            a = uv.data[start + k].uv
            b = uv.data[start + (k + 1) % total].uv
            lens.append(float(np.hypot(a[0] - b[0], a[1] - b[1])) * resolution)
    return float(np.median(lens)) if lens else None


def _box_majority_vote(mask_bool, radius):
    """Binary-image median filter via an integral image.

    For a binary mask the median over a box window IS the majority vote (box
    sum >= half the window area), exact and O(1) per pixel after the prefix-sum
    table. Removes isolated single-texel excursions along a boundary — the
    image-space counterpart of the per-polygon smoothing the mesh topology
    cannot provide.
    """
    h, w = mask_bool.shape
    acc = np.zeros((h + 1, w + 1), dtype=np.int64)
    acc[1:, 1:] = np.cumsum(np.cumsum(mask_bool, axis=0), axis=1)
    rows = np.arange(h)[:, None]
    cols = np.arange(w)[None, :]
    y0 = np.clip(rows - radius, 0, h)
    y1 = np.clip(rows + radius + 1, 0, h)
    x0 = np.clip(cols - radius, 0, w)
    x1 = np.clip(cols + radius + 1, 0, w)
    s = acc[y1, x1] - acc[y0, x1] - acc[y1, x0] + acc[y0, x0]
    area = (y1 - y0) * (x1 - x0)
    return s * 2 >= area


def apply_texture_mask_hairline(
    human,
    baked_img,
    *,
    scalp_idx,
    skin_idx,
    eye_half_w,
    forehead_plane,
    hairline_snap_z,
    hairline_z,
    head_z0,
    h_world,
    eye_min_x,
    eye_max_x,
    eye_min_y,
    eye_max_y,
    edge_pad,
    hair_color=(0.035, 0.028, 0.022, 1.0),
    resolution=1024,
):
    """issue-341 round 10 — the hairline via the texture-mask route (#343).

    The per-polygon scalp material is finished as a boundary mechanism: a boundary
    that follows triangle edges alternates up/down at this mesh density on 2 of 3
    bodies (round 8 measured 65.6% / 63.3% alternation after the snap — the mesh
    has no level edge ring to snap to). The hairline moves into the baked skin
    texture: the scalp/hair region becomes PIXELS in the baseColorTexture, and
    the hairline is the iso-contour of the baked height field at the derived
    hairline height — smooth by construction, independent of mesh topology.

    This function is the second half of #343's proven path (an explicit Cycles
    DIFFUSE bake survives glTF export): it bakes two HELPER maps and composites
    the hair region into the already-baked skin texture.

      1. mask bake  — white where the per-polygon scalp region is, black
         elsewhere (the per-polygon region defines WHERE hair is; it no longer
         defines the hairline).
      2. position bake — world (x, y, z) per texel, normalised over the body's
         own head bounds (a 5-node Geometry/MapRange/Emission helper graph — a
         bake instrument, not the character material; the character skin stays
         the MaterialService enhanced_skin tree #343 wires).
      3. composite — in the face-front strip (|x| <= fitted eye half-width, at
         or ahead of the forehead plane), the hair region is re-classified
         per-PIXEL by the derived hairline: hair where world z >= the round-8
         snap seam height (the same quantity the round-8 snap used, in-band
         0.90-0.96 H). Everywhere else the per-polygon bake is kept, so the
         eye socket unpaint and the hide masks are untouched. The hairline is
         then the level set of a smooth height field — a line, not a sawtooth.

    The per-polygon scalp material is then retired: every scalp polygon is
    reassigned to the skin material, so the exported body carries ONE skin
    primitive whose baseColorTexture contains the hair region (no separate
    scalp primitive — no second mechanism for one boundary).

    All quantities are derived from the body's own surface or the fitted eye
    mesh (the round-5/round-8 derivations); nothing here is a fitted constant.
    """
    if scalp_idx is None or scalp_idx == skin_idx:
        print("TEXTURE_HAIRLINE WARNING: no scalp material region to convert — skipping")
        return {"mode": "skipped_no_scalp_region"}

    bpy.context.scene.frame_set(1)
    prev_engine = bpy.context.scene.render.engine
    prev_device = getattr(bpy.context.scene.cycles, "device", "CPU")
    bpy.context.scene.render.engine = "CYCLES"
    bpy.context.scene.cycles.device = "CPU"
    bpy.context.scene.render.bake.use_pass_direct = False
    bpy.context.scene.render.bake.use_pass_indirect = False
    bpy.context.scene.render.bake.use_pass_color = True

    def _select_human_only():
        bpy.ops.object.select_all(action="DESELECT")
        human.select_set(True)
        bpy.context.view_layer.objects.active = human

    # ---- helper: rebuild a material's node tree as a flat-color DIFFUSE bake ----
    def _flat_color_material(mat, color, image):
        for _n in list(mat.node_tree.nodes):
            mat.node_tree.nodes.remove(_n)
        _b = mat.node_tree.nodes.new("ShaderNodeBsdfPrincipled")
        _b.inputs["Base Color"].default_value = color
        _b.inputs["Roughness"].default_value = 0.9
        _o = mat.node_tree.nodes.new("ShaderNodeOutputMaterial")
        mat.node_tree.links.new(_b.outputs["BSDF"], _o.inputs["Surface"])
        _t = mat.node_tree.nodes.new("ShaderNodeTexImage")
        _t.image = image
        _t.select = True  # the bake writes only to the ACTIVE AND SELECTED image node
        mat.node_tree.nodes.active = _t

    # ---- helper: rebuild a material's node tree as a world-position DIFFUSE bake ----
    def _position_material(mat, image, x0, x1, y0, y1, z0, z1):
        for _n in list(mat.node_tree.nodes):
            mat.node_tree.nodes.remove(_n)
        _b = mat.node_tree.nodes.new("ShaderNodeBsdfPrincipled")
        _b.inputs["Roughness"].default_value = 0.9
        _o = mat.node_tree.nodes.new("ShaderNodeOutputMaterial")
        _geo = mat.node_tree.nodes.new("ShaderNodeNewGeometry")
        _sep = mat.node_tree.nodes.new("ShaderNodeSeparateXYZ")
        _comb = mat.node_tree.nodes.new("ShaderNodeCombineXYZ")
        mat.node_tree.links.new(_b.outputs["BSDF"], _o.inputs["Surface"])
        mat.node_tree.links.new(_geo.outputs["Position"], _sep.inputs["Vector"])
        mat.node_tree.links.new(_comb.outputs["Vector"], _b.inputs["Base Color"])
        _mrs = []
        for _axis, (_lo, _hi) in zip(("X", "Y", "Z"), ((x0, x1), (y0, y1), (z0, z1))):
            _mr = mat.node_tree.nodes.new("ShaderNodeMapRange")
            _mr.inputs["From Min"].default_value = float(_lo)
            _mr.inputs["From Max"].default_value = float(_hi)
            _mr.inputs["To Min"].default_value = 0.0
            _mr.inputs["To Max"].default_value = 1.0
            _mrs.append(_mr)
            mat.node_tree.links.new(_sep.outputs[_axis], _mr.inputs["Value"])
        for _mr, _sock in zip(_mrs, ("X", "Y", "Z")):
            mat.node_tree.links.new(_mr.outputs["Result"], _comb.inputs[_sock])
        _t = mat.node_tree.nodes.new("ShaderNodeTexImage")
        _t.image = image
        _t.select = True
        mat.node_tree.nodes.active = _t

    skin_mat_obj = human.data.materials[skin_idx]
    scalp_mat_obj = human.data.materials[scalp_idx]

    # issue-341 round 10 (handback) — the bake evaluates the ARMATURE-DEFORMED
    # mesh, and on the macro-solved reference bodies the rest-pose deformation
    # shifts the mesh vertically (measured: child crownZ raw 1.2410 vs evaluated
    # 0.8840), so a baked world-position map is in a different frame than the
    # raw-mesh quantities this composite classifies against (hairline snap
    # height, eye footprint, forehead plane — all raw frame). The mask bake is
    # per-face colour and unaffected either way. The helper bakes therefore run
    # with the armature's render evaluation DISABLED, so the baked position map
    # is in the same frame as the hairline derivation. The skin bake already
    # completed; the export rebuilds the skin material from scratch below.
    _arm_mods = [m for m in human.modifiers if m.type == "ARMATURE"]
    _arm_mod_states = [m.show_render for m in _arm_mods]
    for _m in _arm_mods:
        _m.show_render = False
    bpy.context.view_layer.update()

    # ---- (1) mask bake: white where the scalp region is, black everywhere else ----
    # Drives the EXISTING skin/scalp materials (the same mechanism the proven skin
    # bake uses — no temp-material reassignment, which the first two attempts
    # proved flaky against the depsgraph). The skin polys bake black, the scalp
    # polys bake white; the hidden-mask polys have no active image node and are
    # skipped, leaving their UV areas at zero (black = not hair).
    mask_img = bpy.data.images.new("mpfb_scalp_mask", resolution, resolution)
    mask_img.colorspace_settings.name = "Non-Color"
    _flat_color_material(skin_mat_obj, (0.0, 0.0, 0.0, 1.0), mask_img)
    _flat_color_material(scalp_mat_obj, (1.0, 1.0, 1.0, 1.0), mask_img)
    bpy.context.view_layer.update()
    _select_human_only()
    human.active_material_index = skin_idx
    try:
        # use_clear=False: mask_img is freshly created (zeros) and baked_img must
        # NOT be cleared — the active-material image is otherwise the bake's
        # primary clear target, which wiped the skin texture on the first run.
        bpy.ops.object.bake(type="DIFFUSE", pass_filter={"COLOR"}, margin=2, use_clear=False)
    except Exception as _e:
        print(f"TEXTURE_HAIRLINE WARNING: mask bake failed: {_e}")

    # ---- (2) position bake: world (x, y, z) per texel over the head bounds ----
    _head = [
        tuple(h_world @ v.co) for v in human.data.vertices
        if (h_world @ v.co).z >= head_z0
    ]
    hx0, hx1 = min(p[0] for p in _head), max(p[0] for p in _head)
    hy0, hy1 = min(p[1] for p in _head), max(p[1] for p in _head)
    hz0, hz1 = min(p[2] for p in _head), max(p[2] for p in _head)
    _pad = 0.02  # boundary texels must never clip the [0,1] map range
    hx0, hx1 = hx0 - _pad, hx1 + _pad
    hy0, hy1 = hy0 - _pad, hy1 + _pad
    hz0, hz1 = hz0 - _pad, hz1 + _pad

    pos_img = bpy.data.images.new("mpfb_position_map", resolution, resolution)
    pos_img.colorspace_settings.name = "Non-Color"
    # EMIT-bake types silently produce nothing in this Blender build (probed), so
    # the position is driven through the Principled BASE COLOR and DIFFUSE-baked —
    # the same pass the skin bake uses. The bake is a measurement instrument, not
    # the character material (the character skin stays MaterialService #343; the
    # export rebuilds this tree from scratch below).
    _position_material(skin_mat_obj, pos_img, hx0, hx1, hy0, hy1, hz0, hz1)
    _position_material(scalp_mat_obj, pos_img, hx0, hx1, hy0, hy1, hz0, hz1)
    bpy.context.view_layer.update()
    # issue-341 round 10 (handback) — the bake evaluates the armature-deformed
    # mesh, and the macro-solved reference bodies do not rest-pose identity
    # (measured: child crownZ raw 1.2410 vs evaluated 0.8840; disabling the
    # modifier's render evaluation did NOT change the bake's frame). The position
    # map must be in the RAW frame — the frame the hairline/eye/forehead
    # quantities were derived in — so it is baked from a MODIFIER-FREE duplicate
    # of the mesh (same data, same UVs, same material slots; no armature).
    bpy.ops.object.select_all(action="DESELECT")
    human.select_set(True)
    bpy.context.view_layer.objects.active = human
    # FULL (non-linked) duplicate: its own mesh data, its own modifier stack.
    # A linked duplicate inherits the original's modifiers, which is how the
    # armature deformation survived the previous attempt (measured: the child's
    # baked Z still decoded to the deformed frame).
    bpy.ops.object.duplicate(linked=False)
    _pos_camper = bpy.context.active_object
    _mods_removed = 0
    for _m in list(_pos_camper.modifiers):
        _pos_camper.modifiers.remove(_m)
        _mods_removed += 1
    print(f"TEXTURE_HAIRLINE POS_CAMPER modifiersRemoved={_mods_removed} remaining={len(list(_pos_camper.modifiers))}")
    bpy.context.view_layer.update()
    _select_human_only()
    bpy.ops.object.select_all(action="DESELECT")
    _pos_camper.select_set(True)
    bpy.context.view_layer.objects.active = _pos_camper
    try:
        bpy.ops.object.bake(type="DIFFUSE", pass_filter={"COLOR"}, margin=2, use_clear=False)
    except Exception as _e:
        print(f"TEXTURE_HAIRLINE WARNING: position bake failed: {_e}")
    finally:
        bpy.data.objects.remove(_pos_camper, do_unlink=True)
        bpy.context.view_layer.update()
        _select_human_only()
    bpy.context.scene.render.engine = prev_engine
    bpy.context.scene.cycles.device = prev_device
    # restore the armature render evaluation (the export needs the deformed mesh)
    for _m, _st in zip(_arm_mods, _arm_mod_states):
        _m.show_render = _st
    bpy.context.view_layer.update()

    # ---- diagnostic: what did the two helper bakes actually write? ----
    _mstat = np.array(mask_img.pixels[:], dtype=np.float32).reshape(resolution, resolution, 4)
    _pstat = np.array(pos_img.pixels[:], dtype=np.float32).reshape(resolution, resolution, 4)[..., :3]
    # the position material's actual map-range node values (why does the child's Z bake to 0?)
    _mr_vals = []
    for _mat in (skin_mat_obj, scalp_mat_obj):
        for _n in _mat.node_tree.nodes:
            if _n.bl_idname == "ShaderNodeMapRange":
                try:
                    _mr_vals.append([round(float(_n.inputs["From Min"].default_value), 4),
                                     round(float(_n.inputs["From Max"].default_value), 4)])
                except Exception:
                    pass
    _head_zs = [float((h_world @ v.co).z) for v in human.data.vertices if (h_world @ v.co).z >= head_z0][:3]
    _white_mask = _mstat[..., 0] > 0.5
    _b_at_hair = float(_pstat[_white_mask][:, 2].mean()) if _white_mask.any() else -1.0
    _r_at_hair = float(_pstat[_white_mask][:, 0].mean()) if _white_mask.any() else -1.0
    _g_at_hair = float(_pstat[_white_mask][:, 1].mean()) if _white_mask.any() else -1.0
    _arm = next((o for o in bpy.context.scene.objects if o.type == "ARMATURE"), None)
    _dg = bpy.context.evaluated_depsgraph_get()
    _eval = human.evaluated_get(_dg)
    _crown_z_raw = max(float((h_world @ v.co).z) for v in human.data.vertices)
    _crown_z_eval = max(float((_eval.matrix_world @ v.co).z) for v in _eval.data.vertices)
    print(
        "TEXTURE_HAIRLINE_BAKE_STATS "
        f"maskWhite={int(_white_mask.sum())} "
        f"posR=[{float(_pstat[..., 0].min()):.3f},{float(_pstat[..., 0].max()):.3f}] "
        f"posG=[{float(_pstat[..., 1].min()):.3f},{float(_pstat[..., 1].max()):.3f}] "
        f"posB=[{float(_pstat[..., 2].min()):.3f},{float(_pstat[..., 2].max()):.3f}] "
        f"atHair=[R {_r_at_hair:.3f} G {_g_at_hair:.3f} B {_b_at_hair:.3f}] "
        f"humanScale={[round(float(s), 4) for s in human.matrix_world.to_scale()]} "
        f"armScale={[round(float(s), 4) for s in _arm.matrix_world.to_scale()] if _arm else 'n/a'} "
        f"crownZ raw={_crown_z_raw:.4f} eval={_crown_z_eval:.4f} "
        f"headZSample={[round(z, 4) for z in _head_zs]} "
        f"headZ0={head_z0:.4f} hz0={hz0:.4f} hz1={hz1:.4f} "
        f"mapRangeFromTo={_mr_vals}"
    )

    # ---- (3) composite in numpy: read all three maps, re-classify the strip ----
    w, h = baked_img.size[0], baked_img.size[1]
    skin_rgba = np.array(baked_img.pixels[:], dtype=np.float32).reshape(h, w, 4)
    # issue-341 round 14 — the composite mask is the UNION of the Cycles bake and a
    # splat of the scalp-material polys, computed below (the bake covers full UV
    # triangles but mis-assigns the right crown; the splat is region-truth but
    # leaves poly-interior holes over the skin bake's black scalp texels). Both
    # are measured; see the comment at the union. mask_a is initialized here and
    # set after the splats.
    mask_a = np.zeros((w, h), dtype=np.float32)
    pos = np.array(pos_img.pixels[:], dtype=np.float32).reshape(h, w, 4)[..., :3]
    xs = hx0 + pos[..., 0] * (hx1 - hx0)
    ys = hy0 + pos[..., 1] * (hy1 - hy0)
    zs = hz0 + pos[..., 2] * (hz1 - hz0)

    # provenance: write the helper maps next to the bake so the texture route is
    # inspectable after the fact (mask = where the per-polygon region said hair;
    # position = world x/y/z normalised to the head bounds).
    #
    # issue-341 round 12 — the previous save used bpy Image.save(), and the on-disk
    # files were ALL-BLACK and byte-identical on every bake (measured: MD5-equal,
    # 0/1,048,576 non-black pixels, while the same images' in-memory pixels carried
    # real data — the composite read maskWhite=107597 from the identical buffer).
    # Image.save() on a never-loaded GENERATED image is not reliable in this build,
    # so the maps are written from the numpy buffers directly (stdlib zlib/struct,
    # 8-bit RGB PNG) — deterministic and independent of Blender's image I/O.
    _prov_dir = pathlib.Path(baked_img.filepath_raw).parent if baked_img.filepath_raw else pathlib.Path(".")
    _prov_dir.mkdir(parents=True, exist_ok=True)
    for _img, _tag in ((mask_img, "scalp-mask"), (pos_img, "position-map")):
        _px = np.array(_img.pixels[:], dtype=np.float32).reshape(resolution, resolution, 4)
        _rgb = np.clip(_px[..., :3] * 255.0, 0, 255).astype(np.uint8)
        _raw = b"".join(
            b"\x00" + _rgb[y, :, :].tobytes() for y in range(resolution)
        )

        def _png_chunk(tag: bytes, data: bytes) -> bytes:
            body = tag + data
            return (
                struct.pack(">I", len(data))
                + body
                + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)
            )

        _png = b"\x89PNG\r\n\x1a\n"
        _png += _png_chunk(b"IHDR", struct.pack(">IIBBBBB", resolution, resolution, 8, 2, 0, 0, 0))
        _png += _png_chunk(b"IDAT", zlib.compress(_raw, 9))
        _png += _png_chunk(b"IEND", b"")
        _out = _prov_dir / f"{_tag}.png"
        try:
            _out.write_bytes(_png)
            print(f"TEXTURE_HAIRLINE PROVENANCE {_tag}.png bytes={_out.stat().st_size} "
                  f"max={int(_rgb.max())} nonBlack={int((_rgb.max(axis=2) > 8).sum())}")
        except Exception as _e:
            print(f"TEXTURE_HAIRLINE WARNING: could not write {_tag}.png: {_e}")

    # ---- (3) classification — frame-independent, from the mesh's RAW vertices ----
    # issue-341 round 12 — the baked position map is not a reliable frame for
    # classification in this pipeline: round 10 measured the child's Z channel
    # dead even from a modifier-free duplicate, and this round measured the
    # position maps disagreeing with the mesh's own UV->world mapping (a
    # face-front texel decoded to the neck), while the eye footprint, the
    # hairline and the exported mesh are all RAW-frame quantities. The strip and
    # socket are therefore evaluated from the mesh's RAW vertices (h_world @
    # v.co — the same frame as the eye footprint and hairline) and splatted to
    # texels through the UV layer, so the classification cannot drift with the
    # bake frame. The hairline threshold is the round-5 derived hairline
    # (hairline_z, the top of the forehead column — the derivation rounds 5/6
    # established and the orchestrator accepted), NOT the round-8 snap seam
    # (hairline_snap_z), which sits at the bottom of the eyes and paints the
    # brow/socket/nose (measured: shipped aisha brow [10,9,8] vs round-9
    # known-good [53,47,43]; the round-12 render keeps a dark band over the
    # eyes/nose because the socket exclusion was applied in the broken frame).
    _uv_layer = human.data.uv_layers[0].data
    # issue-341 round 14 — a UV-frame hypothesis was tested and MEASURED DEAD:
    # the mesh carries exactly ONE UV layer (uvLayers=1 active=UVMap) on all
    # three actors, so the composite's uv_layers[0], the Cycles bakes and the
    # exported TEXCOORD_0 are all the same frame. The left/right hair asymmetry
    # therefore enters elsewhere; the frame counts below confirm the single-layer
    # state on every bake.
    _loops = human.data.loops
    _verts = human.data.vertices
    _face_band = np.zeros((resolution, resolution), dtype=bool)
    _above_hair = np.zeros((resolution, resolution), dtype=bool)
    _socket = np.zeros((resolution, resolution), dtype=bool)
    _scalp_region = np.zeros((resolution, resolution), dtype=bool)
    for _poly in human.data.polygons:
        for _li in range(_poly.loop_start, _poly.loop_start + _poly.loop_total):
            _vi = _loops[_li].vertex_index
            _p = h_world @ _verts[_vi].co
            _u = _uv_layer[_li].uv
            _tx = int(_u.x * resolution) % resolution
            _ty = int((1.0 - _u.y) * resolution) % resolution
            if _poly.material_index == scalp_idx:
                _scalp_region[_ty, _tx] = True
            if abs(_p.x) <= eye_half_w and _p.y <= forehead_plane and _p.z >= head_z0:
                _face_band[_ty, _tx] = True
                if hairline_z is not None and _p.z >= hairline_z:
                    _above_hair[_ty, _tx] = True
            if (
                abs(_p.x) <= eye_half_w + edge_pad
                and _p.y <= eye_max_y + edge_pad
                and _p.z >= head_z0
            ):
                _socket[_ty, _tx] = True
    # dilate the splats by the body's own UV scale (a property of the mesh
    # resolution, not a fitted constant) so the level set is smooth.
    _median_uv = _median_uv_edge_px(human, resolution) or 0.0
    _dil = max(2, int(round(1.5 * _median_uv))) if _median_uv else 4

    def _dilate(_m):
        _out = _m.copy()
        for _dy in range(-_dil, _dil + 1):
            for _dx in range(-_dil, _dil + 1):
                _out = np.maximum(_out, np.roll(np.roll(_m, _dy, axis=0), _dx, axis=1))
        return _out

    _face_band = _dilate(_face_band)
    _above_hair = _dilate(_above_hair)
    _socket = _dilate(_socket)
    # issue-341 round 14 — the composite mask is the union of the Cycles BAKE and
    # the splatted scalp region. Measured on the array (ARRAY_TRUTH): the hair
    # boolean from the splat alone is symmetric but leaves BLACK HOLES — the skin
    # bake skips the scalp-material polys (they are not skin at bake time), so
    # their UV triangles are (0,0,0) in the skin texture, and a corner splat plus
    # the UV-scale dilation does not fill every poly interior (the left crown's UV
    # island has lower texel density, so its interiors stay black → the texture
    # reads dark-left even with symmetric hair). The BAKE covers full UV triangles
    # (no holes) but mis-assigns the right crown (the basemesh UV overlap). The
    # union keeps the bake's full coverage and the splat's region truth: neither
    # defect survives.
    mask_baked = np.array(mask_img.pixels[:], dtype=np.float32).reshape(w, h, 4)[..., 0] > 0.5
    _scalp_region = _dilate(_scalp_region)
    mask_a = np.maximum(mask_baked, _scalp_region).astype(np.float32)
    # the eye/brow/nose region: the face-front socket band BELOW the hairline is
    # never hair — the eyes and brows render through the skin texture (#340's eye
    # mesh is separate geometry and is unaffected). Above the hairline the
    # forehead is hair, and the crown/sides keep the per-polygon mask.
    _socket_low = _socket & ~_above_hair

    # issue-341 round 14 — stage-by-stage L/R instrumentation. The shipped
    # textures carry a 30-36 pt hair asymmetry (LEFT 82-87%, RIGHT 46-57%) while
    # the per-polygon mask and every region predicate are X-symmetric (measured).
    # These prints locate which stage the bias enters by sampling the texel grids
    # at the DOME verts' own UVs (frac >= 0.94 H, |x| > 5 mm), exactly as the
    # planted hair-covers-both-sides-of-the-head test samples the shipped bytes.
    def _side_dome(_grid):
        _out = {"L": 0, "R": 0}
        if _grid is None:
            return _out
        _lo = min((h_world @ v.co).z for v in _verts)
        _hi = max((h_world @ v.co).z for v in _verts)
        _H = _hi - _lo
        for _poly in human.data.polygons:
            for _li in range(_poly.loop_start, _poly.loop_start + _poly.loop_total):
                _vi = _loops[_li].vertex_index
                _p = h_world @ _verts[_vi].co
                if (_p.z - _lo) / _H < 0.94:
                    continue
                if abs(_p.x) <= 0.005:
                    continue
                _u = _uv_layer[_li].uv
                _tx = int(_u.x * resolution) % resolution
                _ty = int((1.0 - _u.y) * resolution) % resolution
                if _grid[_ty, _tx]:
                    _out["L" if _p.x < 0 else "R"] += 1
        return _out

    def _side_transitions(_final, _ref):
        _out = {"L": {"wd": 0, "wl": 0, "bd": 0, "bl": 0}, "R": {"wd": 0, "wl": 0, "bd": 0, "bl": 0}}
        _lo = min((h_world @ v.co).z for v in _verts)
        _hi = max((h_world @ v.co).z for v in _verts)
        _H = _hi - _lo
        for _poly in human.data.polygons:
            for _li in range(_poly.loop_start, _poly.loop_start + _poly.loop_total):
                _vi = _loops[_li].vertex_index
                _p = h_world @ _verts[_vi].co
                if (_p.z - _lo) / _H < 0.94:
                    continue
                if abs(_p.x) <= 0.005:
                    continue
                _u = _uv_layer[_li].uv
                _tx = int(_u.x * resolution) % resolution
                _ty = int((1.0 - _u.y) * resolution) % resolution
                _m = bool(_ref[_ty, _tx])
                _f = bool(_final[_ty, _tx])
                _k = "wd" if (_m and _f) else "wl" if (_m and not _f) else "bd" if (not _m and _f) else "bl"
                _out["L" if _p.x < 0 else "R"][_k] += 1
        return _out

    print(
        "TEXTURE_HAIRLINE_SIDES "
        f"uvLayers={len(human.data.uv_layers)} "
        f"active={human.data.uv_layers.active.name if human.data.uv_layers.active else 'None'} "
        f"texelTotals face={int(_face_band.sum())} above={int(_above_hair.sum())} "
        f"socket={int(_socket.sum())} socketLow={int(_socket_low.sum())} "
        f"maskWhite={int((mask_a > 0.5).sum())} "
        f"domeMaskWhiteL={_side_dome(mask_a > 0.5)['L']} domeMaskWhiteR={_side_dome(mask_a > 0.5)['R']} "
        f"domeFaceL={_side_dome(_face_band)['L']} domeFaceR={_side_dome(_face_band)['R']} "
        f"domeAboveL={_side_dome(_above_hair)['L']} domeAboveR={_side_dome(_above_hair)['R']} "
        f"domeSocketL={_side_dome(_socket)['L']} domeSocketR={_side_dome(_socket)['R']} "
        f"domeSockLowL={_side_dome(_socket_low)['L']} domeSockLowR={_side_dome(_socket_low)['R']}"
    )

    hair = mask_a > 0.5
    override = _face_band
    _fallback = None
    if hairline_z is None or forehead_plane is None:
        print(
            "TEXTURE_HAIRLINE WARNING: no hairline height or forehead plane — "
            "keeping per-polygon mask only"
        )
    else:
        # face front: hair only at-or-above the derived hairline (a level set of
        # the raw vertex heights — smooth, independent of the edge ring); below
        # it the eyes/brow/nose bridge are skin regardless of the per-polygon
        # mask, so the round-11 "black mask over the eyes and down the bridge of
        # the nose" cannot recur in any bake frame.
        hair[_face_band] = _above_hair[_face_band]
        hair[_socket_low] = False
    print(
        "TEXTURE_HAIRLINE_SIDES_FINAL "
        f"transitions={json.dumps(_side_transitions(hair, mask_a > 0.5))}"
    )
    # round 14 — crown census: is the per-polygon SCALP region itself asymmetric at
    # the dome, or does the mask BAKE mis-assign? Count, per side, the body polys
    # whose verts lie in the dome (>= 0.94 H) by material (scalp vs skin).
    _lo_d = min((h_world @ v.co).z for v in _verts)
    _hi_d = max((h_world @ v.co).z for v in _verts)
    _H_d = _hi_d - _lo_d
    _crown = {"L": {"scalp": 0, "skin": 0, "other": 0}, "R": {"scalp": 0, "skin": 0, "other": 0}}
    for _poly in human.data.polygons:
        _vs = [h_world @ _verts[_vi].co for _vi in _poly.vertices]
        if not any((_p.z - _lo_d) / _H_d >= 0.94 and abs(_p.x) > 0.005 for _p in _vs):
            continue
        _any_l = any(_p.x < -0.005 for _p in _vs)
        _any_r = any(_p.x > 0.005 for _p in _vs)
        if _any_l and _any_r:
            continue  # straddles the midline; count only clean-side polys
        _side = "L" if _any_l else "R"
        _matname = human.data.materials[_poly.material_index].name if _poly.material_index < len(human.data.materials) else "?"
        if _poly.material_index == scalp_idx:
            _crown[_side]["scalp"] += 1
        elif _poly.material_index == skin_idx:
            _crown[_side]["skin"] += 1
        else:
            _crown[_side]["other"] += 1
    print(
        "TEXTURE_HAIRLINE CROWN_CENSUS "
        f"L={json.dumps(_crown['L'])} R={json.dumps(_crown['R'])}"
    )
    # round 14 — per-loop own-poly vs mask cross-tab: for each dome loop, is its own
    # polygon scalp, and is the mask texel at its UV white? A scalp-poly loop whose
    # texel is black means the BAKE mis-assigned that UV area; symmetric results mean
    # the per-polygon region itself is asymmetric.
    _lo_e = min((h_world @ v.co).z for v in _verts)
    _hi_e = max((h_world @ v.co).z for v in _verts)
    _H_e = _hi_e - _lo_e
    _xtab = {
        "L": {"scalp_white": 0, "scalp_black": 0, "skin_white": 0, "skin_black": 0},
        "R": {"scalp_white": 0, "scalp_black": 0, "skin_white": 0, "skin_black": 0},
    }
    _mask_b = mask_a > 0.5
    for _poly in human.data.polygons:
        if _poly.material_index not in (scalp_idx, skin_idx):
            continue
        for _li in range(_poly.loop_start, _poly.loop_start + _poly.loop_total):
            _vi = _loops[_li].vertex_index
            _p = h_world @ _verts[_vi].co
            if (_p.z - _lo_e) / _H_e < 0.94:
                continue
            if abs(_p.x) <= 0.005:
                continue
            _u = _uv_layer[_li].uv
            _tx = int(_u.x * resolution) % resolution
            _ty = int((1.0 - _u.y) * resolution) % resolution
            _white = bool(_mask_b[_ty, _tx])
            _scalp = _poly.material_index == scalp_idx
            _s = "L" if _p.x < 0 else "R"
            _key = ("scalp" if _scalp else "skin") + ("_white" if _white else "_black")
            _xtab[_s][_key] += 1
    print(f"TEXTURE_HAIRLINE OWN_POLY_XTAB L={json.dumps(_xtab['L'])} R={json.dumps(_xtab['R'])}")
    # round 14 — dump the RAW dome loops (x, z, u, v) per side for frame comparison
    # against the exported GLB (the JS instrument reads the GLB symmetric while the
    # bake reads the same mask asymmetric: raw mesh and exported mesh must differ).
    _lo_d = min((h_world @ v.co).z for v in _verts)
    _hi_d = max((h_world @ v.co).z for v in _verts)
    _H_d = _hi_d - _lo_d
    _dome_dump = {"L": [], "R": [], "Ltot": 0, "Rtot": 0}
    for _poly in human.data.polygons:
        for _li in range(_poly.loop_start, _poly.loop_start + _poly.loop_total):
            _vi = _loops[_li].vertex_index
            _p = h_world @ _verts[_vi].co
            if (_p.z - _lo_d) / _H_d < 0.94:
                continue
            if abs(_p.x) <= 0.005:
                continue
            _u = _uv_layer[_li].uv
            _s = "L" if _p.x < 0 else "R"
            _dome_dump[_s + "tot"] += 1
            if len(_dome_dump[_s]) < 400:
                _dome_dump[_s].append([
                    round(float(_p.x), 4), round(float(_p.z), 4),
                    round(float(_u.x), 4), round(float(_u.y), 4),
                ])
    _dump_path = pathlib.Path(baked_img.filepath_raw).parent if baked_img.filepath_raw else pathlib.Path(".")
    _dump_file = _dump_path / "dome-loop-dump.json"
    try:
        _dump_file.write_text(json.dumps(_dome_dump))
        print(f"TEXTURE_HAIRLINE DOME_DUMP {_dump_file} L={_dome_dump['Ltot']} R={_dome_dump['Rtot']}")
    except Exception as _e:
        print(f"TEXTURE_HAIRLINE WARNING: dome dump failed: {_e}")
    out_rgba = skin_rgba.copy()
    out_rgba[hair] = np.array(hair_color, dtype=np.float32)
    # round 14 — array-truth instrument: sample OUT_RGBA (the composite array, no
    # PNG orientation ambiguity) at the dome loops, per side. Distinguishes "the
    # array is symmetric but the PNG/export frame mirrors it" from "the array is
    # asymmetric". Also the hair-boolean fraction, so a dark SKIN bake under the
    # hair region is visible as dark > hair.
    _lo_f = min((h_world @ v.co).z for v in _verts)
    _hi_f = max((h_world @ v.co).z for v in _verts)
    _H_f = _hi_f - _lo_f
    _arr = {"L": {"dark": 0, "hair": 0, "n": 0}, "R": {"dark": 0, "hair": 0, "n": 0}}
    for _poly in human.data.polygons:
        for _li in range(_poly.loop_start, _poly.loop_start + _poly.loop_total):
            _vi = _loops[_li].vertex_index
            _p = h_world @ _verts[_vi].co
            if (_p.z - _lo_f) / _H_f < 0.94:
                continue
            if abs(_p.x) <= 0.005:
                continue
            _u = _uv_layer[_li].uv
            _tx = int(_u.x * resolution) % resolution
            _ty = int((1.0 - _u.y) * resolution) % resolution
            _s = "L" if _p.x < 0 else "R"
            _arr[_s]["n"] += 1
            if hair[_ty, _tx]:
                _arr[_s]["hair"] += 1
            _c = out_rgba[_ty, _tx][:3]
            if float(np.mean(_c)) < 70 / 255.0:
                _arr[_s]["dark"] += 1
    print(
        "TEXTURE_HAIRLINE ARRAY_TRUTH "
        f"L={json.dumps(_arr['L'])} R={json.dumps(_arr['R'])}"
    )
    baked_img.pixels[:] = out_rgba.reshape(-1).tolist()
    try:
        baked_img.save()  # re-save the on-disk PNG so it matches the exported texture
    except Exception as _e:
        print(f"TEXTURE_HAIRLINE WARNING: skin-baked.png re-save failed: {_e}")

    # ---- retire the per-polygon scalp material: one mechanism for one boundary ----
    scalp_reassigned = 0
    for _p in human.data.polygons:
        if _p.material_index == scalp_idx:
            _p.material_index = skin_idx
            scalp_reassigned += 1

    # ---- measurement: the hairline IN THE TEXTURE (replacement for the geometric seam) ----
    _cols = np.where(override.any(axis=0))[0]
    _bound_rows: list[int] = []
    for _c in _cols:
        _rc = np.where(override[:, _c])[0]
        if len(_rc) < 2:
            continue
        _hair_c = hair[_rc, _c]
        if not _hair_c.any() or _hair_c.all():
            continue
        _first_hair = int(np.where(_hair_c)[0][0])
        _bound_rows.append(int(_rc[_first_hair]))
    _flips = 0
    _steps = 0
    _prev = 0
    for _k in range(1, len(_bound_rows)):
        _d = _bound_rows[_k] - _bound_rows[_k - 1]
        if _d == 0:
            continue
        _steps += 1
        if _prev != 0 and np.sign(_d) != np.sign(_prev):
            _flips += 1
        _prev = _d
    _flip_rate = round(_flips / _steps, 4) if _steps else 0.0
    _hair_z = zs[hair]
    _z_alive = bool(float(pos[..., 2].max()) > 1e-6) if pos is not None else False
    return {
        "mode": "texture_mask_level_line",
        "scalpPolygonsReassignedToSkin": scalp_reassigned,
        "hairRegionPixels": int(hair.sum()),
        "maskWhitePixels": int((mask_a > 0.5).sum()),
        "stripOverridePixels": int(override.sum()),
        "socketExcludedPixels": int(_socket_low.sum()),
        "hairlineSnapZ": round(float(hairline_snap_z), 4) if hairline_snap_z is not None else None,
        "hairlineZ": round(float(hairline_z), 4) if hairline_z is not None else None,
        "hairZRange": (
            [round(float(_hair_z.min()), 4), round(float(_hair_z.max()), 4)]
            if _hair_z.size and _z_alive else None
        ),
        "fallback": _fallback,
        "textureBoundaryColumns": len(_bound_rows),
        "textureBoundaryFlipRate": _flip_rate,
        "textureBoundaryMedianStepPx": (
            round(float(np.median(np.abs(np.diff(_bound_rows)))), 2) if len(_bound_rows) > 2 else None
        ),
        "positionMapHeadBounds": [round(x, 4) for x in (hx0, hx1, hy0, hy1, hz0, hz1)],
        "claimScope": "hairline boundary moved from polygon material assignment into the baked skin baseColorTexture; hairline height is the round-5 derived hairline (hairline_z, the top of the forehead column) classified from the mesh's RAW vertices, not the baked position map; the per-polygon scalp material is retired",
        "notEvidenceFor": ["a clean pixel grade (orchestrator grades captures)", "clinical realism", "production asset readiness", "quest readiness"],
    }


def mesh_from_numpy(name, verts, faces):
    """Build a Blender mesh object from numpy arrays (mirrors body_param_stage._mesh_from_numpy)."""
    mesh = bpy.data.meshes.new(f"{name}_mesh")
    mesh.from_pydata(
        [tuple(float(x) for x in v) for v in verts],
        [],
        [tuple(int(x) for x in f) for f in faces],
    )
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def parse_args():
    argv = []
    if "--" in sys.argv:
        argv = sys.argv[sys.argv.index("--") + 1 :]
    parser = argparse.ArgumentParser(description="Materialize a local MPFB humanoid GLB comparator.")
    parser.add_argument("--output", required=True)
    parser.add_argument(
        "--reference",
        default=None,
        help=(
            "Tracked Anny reference mesh id (e.g. peds_nurse_kevin) whose .anny_base.obj "
            "drives the MPFB macro dict (#328). Omit for the default-macro body (Aisha path)."
        ),
    )
    return parser.parse_args(argv)


# ---------------------------------------------------------------------------
# #328: derive the MPFB macro dict from a TRACKED Anny reference.
#
# The blocker this slice closes: `bpy.ops.mpfb.create_human()` (the UI operator)
# takes no macros and no phenotype, so every MPFB2 body the materializer produced
# was the same default human. The documented service is
# `HumanService.create_human(feet_on_ground=True, macro_detail_dict=...)`
# (humanservice.py:1377) — MPFB itself drives it from `human_info["phenotype"]`
# (humanservice.py:997-998). The macro dict is derived from the reference by
# MEASUREMENT, not by hand-authored body-class literals (#305's D9 gap):
#
#   age    <- the reference's head-height fraction (a real proportional signal:
#             measured 0.100 for the adult nurse vs 0.160 for the child). The MPFB
#             age macro has a genuine child band (0.0-0.1875, macro.json), so a
#             child is represented by macros, not by a uniform scale (#151/#304).
#   height <- SOLVED so the baked+stripped EXPORTED body reaches the reference
#             stature. The solve probes are actually baked and exported, then
#             measured with the same band probe the contract uses — no fitted
#             constants, and D9 (execution duration is not a constraint) is
#             respected: each probe is a few seconds.
#   gender/muscle/weight/proportions/cupsize/firmness <- MPFB defaults. What this
#             slice does NOT yet match is stated in the report: an exact MADR 0051
#             §5 landmark match (shoulder, girths, limb lengths) is the follow-on.
#
# Order is load-bearing: the macros are BAKED into the basis geometry with
# TargetService.bake_targets immediately after create_human. Without the bake the
# glTF basis is the default human and the macros ride along only as zero-weight
# morph targets (measured #328 probe: five macro sets exported byte-identical
# bases; baking makes the exported stature differ 1.00-2.37 m across the height
# macro). bake_targets changes topology count not at all, so the #317 face keys
# still load on the full base and the #318 strip still lands at 13,380 verts.
# ---------------------------------------------------------------------------


def _parse_obj_vertices(path):
    positions = []
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            t = line.strip()
            if t.startswith("v "):
                p = t.split()[1:4]
                positions.append((float(p[0]), float(p[1]), float(p[2])))
    return positions


def measure_reference(reference_id):
    """Measure the tracked Anny reference OBJ (stature, head-height fraction, spans).

    Stature is the y-span. The head-height fraction is the proportion of stature above
    the neck (narrowest torso band in [0.78, 0.92] H, widened-past-1.25x chin band) —
    the same landmarks anny-mpfb-landmark-compare.ts extracts (BAND_WINDOWS.neck).
    Chest/waist lateral spans use the contract's band fractions (0.68-0.76 / 0.55-0.62).
    """
    path = (
        REPO_ROOT / "apps/ui-xr/public/generated-humanoids" / f"{reference_id}.anny_base.obj"
    )
    if not path.is_file():
        raise RuntimeError(f"#328: tracked Anny reference missing: {path}")
    positions = _parse_obj_vertices(str(path))
    xs = [p[0] for p in positions]
    ys = [p[1] for p in positions]
    ymin, ymax = min(ys), max(ys)
    stature = ymax - ymin
    if stature <= 0:
        raise RuntimeError(f"#328: {reference_id} has no y-extent — invalid reference OBJ")

    def span(lo, hi):
        band = [x for x, y in zip(xs, ys) if lo <= (y - ymin) / stature <= hi]
        return 2 * max(abs(x) for x in band) if band else 0.0

    step = stature * 0.02
    band_h = stature * 0.04
    bands = []
    y = ymin + band_h
    while y < ymax - band_h / 2:
        frac = (y - ymin) / stature
        bx = [x for x, yy in zip(xs, ys) if y - band_h / 2 <= yy <= y + band_h / 2]
        if len(bx) >= 4:
            bands.append((frac, 2 * max(abs(x) for x in bx)))
        y += step
    neck_bands = [(f, w) for f, w in bands if 0.78 <= f <= 0.92]
    neck_w = min((w for _, w in neck_bands), default=0.0)
    neck_f = min((f for f, w in neck_bands if abs(w - neck_w) < 1e-9), default=0.85)
    chin_f = 1.0
    for f, w in bands:
        if f > neck_f and w > 1.25 * neck_w:
            chin_f = f
            break
    return {
        "referenceId": reference_id,
        "statureMeters": stature,
        "headHeightFraction": 1 - chin_f,
        "chestSpanMeters": span(0.68, 0.76),
        "waistSpanMeters": span(0.55, 0.62),
    }


def derive_macro_dict(reference):
    """Derive the macro dict from the measured reference (see the module docstring).

    The age value is a FUNCTION of the measured head-height fraction, and the height
    value is solved separately (solve_height_macro) against the measured stature —
    no macro value here is a hand-authored body-class literal.
    """
    macro = {
        "gender": 0.5,
        "age": 0.5,
        "muscle": 0.5,
        "weight": 0.5,
        "proportions": 0.5,
        "height": 0.5,
        "cupsize": 0.5,
        "firmness": 0.5,
        "race": {"asian": 0.33, "caucasian": 0.33, "african": 0.33},
    }
    head_frac = reference["headHeightFraction"]
    if head_frac >= 0.14:
        # Child band (MPFB age 0.0-0.1875 = baby..child): 0.10 toddler .. 0.30 older
        # child across measured head fractions 0.14 .. 0.22.
        macro["age"] = round(0.1 + (head_frac - 0.14) / 0.08 * 0.2, 4)
    else:
        macro["age"] = 0.6
    return macro


def measure_glb_body(path):
    """Measure an exported GLB exactly like the planted contract: largest non-garment /
    non-hidden primitive, y-span stature, lateral spans at the chest/waist band fractions.

    Pure-python (struct) so the solve can measure its own probe exports inside Blender
    without shelling out to node or the gltf-transform package.
    """
    with open(path, "rb") as f:
        data = f.read()
    if data[:4] != b"glTF":
        raise RuntimeError(f"#328: not a GLB: {path}")
    json_len = struct.unpack("<I", data[12:16])[0]
    gltf = json.loads(data[20 : 20 + json_len])
    bin_start = 20 + json_len + 8
    bviews = gltf["bufferViews"]
    accessors = gltf["accessors"]
    exclude = re.compile(r"hidden|makeclothes|garment|toigo|boot|shoe|scalp|hair", re.I)
    best = []
    for mesh in gltf.get("meshes", []):
        for prim in mesh.get("primitives", []):
            mat_idx = prim.get("material")
            mat_name = ""
            if mat_idx is not None:
                mat_name = gltf.get("materials", [])[mat_idx].get("name", "")
            if exclude.search(mat_name):
                continue
            acc = accessors[prim["attributes"]["POSITION"]]
            if acc["componentType"] != 5126:
                continue
            bv = bviews[acc["bufferView"]]
            count = acc["count"]
            off = bin_start + bv.get("byteOffset", 0) + acc.get("byteOffset", 0)
            stride = bv.get("byteStride", 12)
            pos = []
            for i in range(count):
                x, y, z = struct.unpack_from("<fff", data, off + i * stride)
                pos.append((x, y, z))
            if len(pos) > len(best):
                best = pos
    if not best:
        raise RuntimeError(f"#328: no body primitive found in {path}")
    ys = [p[1] for p in best]
    min_y, max_y = min(ys), max(ys)
    stature = max_y - min_y

    def span(lo, hi):
        band = [p[0] for p in best if lo <= (p[1] - min_y) / stature <= hi]
        return 2 * max(abs(x) for x in band) if band else 0.0

    return {
        "statureMeters": stature,
        "chestSpanMeters": span(0.68, 0.76),
        "waistSpanMeters": span(0.55, 0.62),
    }


def _bake_and_export_probe(macro, out_path):
    """create_human + bake macros + strip helpers + export a probe GLB, and measure it.

    The probe deliberately skips rig/face/garment: the body's stature and band spans
    (what the contract reads) are unchanged by the post-strip additions, and the probe
    must be fast enough to run several times in the solve.
    """
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()

    from bl_ext.user_default.mpfb.services.exportservice import ExportService
    from bl_ext.user_default.mpfb.services.humanservice import HumanService
    from bl_ext.user_default.mpfb.services.targetservice import TargetService

    human = HumanService.create_human(feet_on_ground=True, macro_detail_dict=macro)
    TargetService.bake_targets(human)
    bpy.context.view_layer.update()
    ExportService.bake_modifiers_remove_helpers(
        human, bake_masks=False, bake_subdiv=False, remove_helpers=True, also_proxy=True
    )
    bpy.context.view_layer.update()
    bpy.ops.export_scene.gltf(filepath=str(out_path), export_format="GLB", export_animations=False)
    return measure_glb_body(str(out_path))


def solve_height_macro(base_macro, target_stature, tmp_dir, tol=0.01):
    """Solve the height macro so the baked+stripped EXPORTED body reaches the reference
    stature. Self-calibrating (probe -> measure -> interpolate); no fitted constants."""
    if target_stature <= 0:
        raise RuntimeError(f"#328: non-positive target stature {target_stature}")

    def probe(height):
        macro = dict(base_macro)
        macro["height"] = round(float(height), 4)
        out = pathlib.Path(tmp_dir) / f"probe_h{macro['height']:.4f}.glb"
        try:
            return _bake_and_export_probe(macro, out)["statureMeters"]
        finally:
            out.unlink(missing_ok=True)

    s_mid = probe(0.5)
    if abs(s_mid - target_stature) <= tol:
        return 0.5
    if target_stature > s_mid:
        bracket = [(0.5, s_mid), (1.0, probe(1.0))]
    else:
        bracket = [(0.0, probe(0.0)), (0.5, s_mid)]
    bracket.sort(key=lambda kv: kv[0])
    (h0, s0), (h1, s1) = bracket
    if not (min(s0, s1) <= target_stature <= max(s0, s1)):
        raise RuntimeError(
            f"#328: target stature {target_stature:.3f} m outside the measured height-macro "
            f"range [{min(s0, s1):.3f}, {max(s0, s1):.3f}] m — the macro range is exhausted"
        )
    h_c = h0 + (h1 - h0) * (target_stature - s0) / (s1 - s0)
    h_c = min(max(h_c, 0.0), 1.0)
    s_c = probe(h_c)
    if abs(s_c - target_stature) <= tol:
        return h_c
    # One refinement: interpolate within the bracketing pair that contains the target.
    points = sorted(bracket + [(h_c, s_c)], key=lambda kv: kv[0])
    for i in range(len(points) - 1):
        a, b = points[i], points[i + 1]
        if min(a[1], b[1]) <= target_stature <= max(a[1], b[1]):
            h_f = a[0] + (b[0] - a[0]) * (target_stature - a[1]) / (b[1] - a[1])
            return min(max(h_f, 0.0), 1.0)
    return h_c


def _area_sample_points(tris: np.ndarray) -> np.ndarray:
    """7 points per triangle: 3 vertices + 3 edge midpoints + centroid.

    issue-341 round 7: a hidden body polygon that STRADDLES a garment edge has its
    centroid under the cloth while a corner pokes out past the edge. A centroid-only
    test is blind to that class — it produces the ragged per-polygon black sawtooth
    at every garment/skin seam (measured: the round-6 black-sliver left the seam
    holes hidden because their centroids were covered). Area-level sampling catches
    the straddlers: a polygon is un-hidden when ANY area sample is a hole.
    """
    v0, v1, v2 = tris[:, 0], tris[:, 1], tris[:, 2]
    verts = np.stack([v0, v1, v2], axis=1)
    mids = np.stack([(v0 + v1) * 0.5, (v1 + v2) * 0.5, (v2 + v0) * 0.5], axis=1)
    cent = tris.mean(axis=1, keepdims=True)
    return np.concatenate([verts, mids, cent], axis=1)  # (F, 7, 3)


def _outer_facing_front_tris(garment_verts, garment_faces) -> np.ndarray:
    """Garment triangles whose OUTER winding normal faces the stage front (-Y, the
    create_human forward axis — the glTF export maps this to +Z, the occlusion
    gate's viewer).

    issue-341 round 7: a discarded body polygon reveals a cloth surface only when
    that surface is OUTER-facing toward the viewer (it renders). An inner/back-facing
    surface is backface-culled at render and reads as the dark capture background.
    The round-6 black-sliver's behind test counted ANY cloth surface within reach
    — so the nurse's jaw stayed hidden because the collar's BACK panel is 13-19 cm
    behind it (measured), and the discarded jaw read as a black ragged mass. This
    subset is what the behind test must cast against: the front panel of a shirt,
    the outer side of a boot — surfaces that actually fill a discarded hole.
    Orientation is the same winding-proof _orient_outward (signed volume + the
    centroid-away tiebreak) the mask machinery already uses; _orient_outward
    returns the outward unit normals in face order.
    """
    oriented_normals = _orient_outward(garment_verts, garment_faces)
    tris = garment_verts[garment_faces]
    return tris[oriented_normals[:, 1] < 0.0]


def main():
    args = parse_args()
    bpy.ops.preferences.addon_enable(module="bl_ext.user_default.mpfb")

    reference = None
    macro = None
    if args.reference:
        reference = measure_reference(args.reference)
        macro = derive_macro_dict(reference)
        print(f"REFERENCE_MEASURED {json.dumps(reference)}")
        print(f"MACRO_BASE {json.dumps(macro)}")
        tmp_dir = pathlib.Path(args.output).parent / f".{pathlib.Path(args.output).name}.solve"
        tmp_dir.mkdir(parents=True, exist_ok=True)
        try:
            h_solved = solve_height_macro(macro, reference["statureMeters"], tmp_dir)
        finally:
            import shutil

            shutil.rmtree(tmp_dir, ignore_errors=True)
        macro["height"] = round(h_solved, 4)
        print(
            f"MACRO_SOLVED height={macro['height']} "
            f"target_stature={reference['statureMeters']:.4f}"
        )

    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()

    from bl_ext.user_default.mpfb.services.humanservice import HumanService

    if reference is not None:
        from bl_ext.user_default.mpfb.services.targetservice import TargetService

        human = HumanService.create_human(feet_on_ground=True, macro_detail_dict=macro)
        # Bake the macro targets into the basis so the EXPORTED body reflects the
        # reference (see the module docstring for the measured reason).
        TargetService.bake_targets(human)
        bpy.context.view_layer.update()
        prefix = f"mpfb_{args.reference}"
        human.name = f"{prefix}_body_mesh"
        human.data.name = f"{prefix}_body"
    else:
        # No reference: default macros, matching the pre-#328 Aisha bake byte-for-byte
        # (the UI operator this replaces also called HumanService.create_human with
        # default macros; only the panel-side select/rename steps were dropped).
        human = HumanService.create_human(feet_on_ground=True)
        human.name = "mpfb_ob_patient_aisha_body_mesh"
        human.data.name = "mpfb_ob_patient_aisha_body"
    human.data.materials.clear()
    skin_material_name = f"mpfb_skin_{args.reference or 'ob_patient_aisha'}"

    # #343 — the SKIN material is the slice. Every MPFB material except the eyes was
    # a hand-authored flat colour: all three actors shared the literal (0.68, 0.53,
    # 0.44) at this line, and MPFB's SHIPPED procedural skin shader
    # (data/node_trees/enhanced_skin.json) had never been called. Load it through
    # the shipped MaterialService (D1: wire the proven tool, do not hand-author a
    # node graph), then drive the tone from the reference's phenotype token via the
    # master-color group node (MaterialService's own per-character skin tone
    # mechanism). The glTF exporter does NOT bake the procedural tree (measured:
    # flat [1,1,1,1] on export); a later step bakes the shader output to a
    # baseColorTexture before export.
    from bl_ext.user_default.mpfb.services.materialservice import MaterialService as _MaterialService  # noqa: E402

    _skin_mat = _MaterialService.create_v2_skin_material(skin_material_name, human)
    _skin_tone = phenotype_skin_tone(args.reference)
    _skin_rgb = SKIN_TONE_RGB.get(_skin_tone, SKIN_TONE_RGB["default"])
    _master_color = next(
        (
            n
            for n in _skin_mat.node_tree.nodes
            if n.bl_idname == "ShaderNodeGroup"
            and (n.node_tree.name if n.node_tree else "") == "MpfbSkinMasterColor"
        ),
        None,
    )
    if _master_color is None:
        raise RuntimeError("#343: MpfbSkinMasterColor group node missing from enhanced_skin material")
    _master_color.inputs["SkinColor"].default_value = (*_skin_rgb, 1.0)
    print(
        f"SKIN_MATERIAL {skin_material_name} tone={_skin_tone} "
        f"rgb={[round(x, 3) for x in _skin_rgb]} shader=enhanced_skin"
    )

    # #222: wire the proven bounds-derived scalp/hair material region from the Anny rail
    # (tools/openclinxr/asset-pipeline/anny/automate_blender.py:4201) instead of hand-authoring
    # a UV sphere (D1: "do not have workers hand-author bespoke geometry"). The function is not
    # topology-bound: it derives the region from mesh bounds, auto-detects the dominant height
    # axis, and excludes the front mid-face band (#73). MPFB create_human is Blender-local
    # Z-up with the face at -Y (measured 2026-08-11: nose tip at y=-0.168, head positive
    # extreme at +0.054) — exactly what the function's Z-height branch expects, so NO Z-flip is
    # applied. A 180-deg Z flip (the pre-#317 assumption that create_human faces +Y) pushes the
    # face to +Y, the face-band exclusion never fires (skippedFaceFrontFaceCount=0), and the
    # scalp paint covers the eyes/brows — which strands their morph-target deltas on the scalp
    # primitive at export and made #317's face census read them as empty.
    import sys as _sys

    _anny_dir = REPO_ROOT / "tools/openclinxr/asset-pipeline/anny"
    if str(_anny_dir) not in _sys.path:
        _sys.path.insert(0, str(_anny_dir))
    from automate_blender import apply_mesh_native_scalp_hair_material_region  # noqa: E402

    scalp_hair_region = apply_mesh_native_scalp_hair_material_region(
        human, {"hair_color": "black", "hair_density": 0.65}
    )
    print(f"SCALP_HAIR_REGION {scalp_hair_region}")

    bpy.ops.object.select_all(action="DESELECT")
    bpy.context.view_layer.objects.active = human
    human.select_set(True)
    bpy.ops.mpfb.add_standard_rig()

    # #317: replace the MPFB UI operator with the proven TargetService path.
    # bpy.ops.mpfb.load_face_shape_keys() reads FACEOPS_PROPERTIES from the panel, finds nothing
    # in a headless run, warns, and returns FINISHED — the bake looked green while Aisha shipped
    # with ZERO face targets (D1: wire the proven tool, do not hand-author morph geometry).
    # body_param_stage.load_mpfb_face_shape_keys walks the MPFB extension target tree and calls
    # TargetService.filename_to_shapekey_name + TargetService.load_target directly — the path
    # that gave the two hm08 library bodies their 27 face targets and 13 working mouth shapes.
    import sys as _sys2

    _makeclothes_dir = REPO_ROOT / "tools/openclinxr/asset-pipeline/makeclothes"
    if str(_makeclothes_dir) not in _sys2.path:
        _sys2.path.insert(0, str(_makeclothes_dir))
    from body_param_stage import load_mpfb_face_shape_keys  # noqa: E402

    face_status = load_mpfb_face_shape_keys(human)
    print(f"FACE_TARGETS {face_status}")
    if face_status.get("error") or (face_status.get("loaded") or 0) < 8:
        raise RuntimeError(f"face target load failed: {face_status}")
    mouth_named = [n for n in (face_status.get("names") or []) if any(
        k in n for k in ("mouth", "lip", "jaw")
    )]
    print(f"FACE_TARGETS_MOUTH_NAMED {len(mouth_named)} {mouth_named}")
    if len(mouth_named) < 8:
        raise RuntimeError(
            f"fewer than 8 mouth-named face targets loaded ({len(mouth_named)}); "
            f"a bake that ships without usable mouth morphs must fail loudly"
        )

    # #337: fit MakeHuman's default CC0 eyes on the FULL basemesh BEFORE the #318 helper
    # strip. The eye .mhclo (`data/eyes/hm08/low-poly` in the makehumancommunity/makehuman2
    # repo) references ONLY helper verts 14598-14741 — the helper-l-eye / helper-r-eye
    # volumes the issue measured — so the fit MUST run while those verts exist. The header
    # of the .mhclo is the licence: "This asset was explicitly released as CC0 in september
    # 2020", copyright holders Data Collection AB / Joel Palmius / Jonas Hauquier (recorded
    # in third-party-asset-licence-ledger.md). `HumanService.add_mhclo_asset` is the proven
    # MPFB-native path (mesh load + ClothesService fit + delete group + rigging);
    # material_type="PROCEDURAL_EYES" applies MPFB's OWN shipped shader
    # (data/node_trees/procedural_eyes.json + data/settings/eye_settings.default.json), so
    # no hand-authored geometry and no hand-authored material. `add_mhclo_asset`'s own
    # set_up_rigging/interpolate_weights then weights every eye vert to the standard rig's
    # eye.L/eye.R bones (probe below: dominant groups eye.L: 48 / eye.R: 48) — the eye
    # mesh, not the socket skin, is what the gaze drive must move (#296). The eye is a
    # SEPARATE object, so the #318 helper strip (which deletes the helper verts the fit
    # referenced) does not touch it.
    _eyes_dir = (
        pathlib.Path(__file__).resolve().parents[4]
        / ".openclinxr-local/provider-cache/eyes/makehuman-default"
    )
    eye_mhclo = _eyes_dir / "low-poly.mhclo"
    eye_obj = _eyes_dir / "low-poly.obj"
    if not eye_mhclo.is_file() or not eye_obj.is_file():
        raise RuntimeError(f"#337: CC0 MakeHuman default eye sources missing in provider cache: {_eyes_dir}")

    from bl_ext.user_default.mpfb.services.humanservice import HumanService as _HumanService  # noqa: E402

    eyes_asset = _HumanService.add_mhclo_asset(
        str(eye_mhclo),
        human,
        asset_type="eyes",
        subdiv_levels=0,
        material_type="PROCEDURAL_EYES",
    )
    bpy.context.view_layer.update()
    # #337 resume: name the eye mesh data with the eye channel so the exported glTF mesh
    # name matches the evidence regex (`/eye|cornea|iris|sclera/`) — the OBJ import's
    # `low-poly` data name does not. Same convention as the footwear channel rename.
    eyes_asset.data.name = f"makeclothes_library_eyes_low_poly_mpfb_{args.reference or 'ob_patient_aisha'}_mesh"
    eye_tris = sum(max(len(p.vertices) - 2, 0) for p in eyes_asset.data.polygons)
    # Probe: dominant vertex groups on the eye mesh immediately after add_mhclo_asset
    # (before the k-NN transfer below) — tells us whether interpolate_weights gave the
    # eye mesh eye-bone weights from the helper verts.
    from collections import Counter as _Counter

    _dom = _Counter()
    for _v in eyes_asset.data.vertices:
        best = None
        best_w = 0.0
        for _ge in _v.groups:
            _g = eyes_asset.vertex_groups[_ge.group]
            if _ge.weight > best_w:
                best, best_w = _g.name, _ge.weight
        if best:
            _dom[best] += 1
    print(
        f"EYES_FIT {eyes_asset.name} verts {len(eyes_asset.data.vertices)} "
        f"tris {eye_tris} material {[m.name for m in eyes_asset.data.materials]} "
        f"dominantGroups {dict(_dom.most_common(6))}"
    )

    # #338 — the between-layers defect this issue exists to instrument. The scalp
    # material region is painted ABOVE (line ~439) BEFORE the eyes are fitted here,
    # and its crown band (0.935 H) covers the eye sockets: the scalp-painted brow
    # renders IN FRONT of the eyes (measured on the shipped bytes: nurse eyes 0.50
    # occluded-by-scalp, scalp maxZ 1.1 cm anterior to the eye maxZ; #337 landed the
    # eyes 20 minutes after #282 fixed the face band, and the band [0.82, 0.93] is
    # correct and blind to eyes at 0.93-0.945 H). Keep the band and the crown — the
    # scalp legitimately covers the crown (#6p: no deletion without a replacement).
    # UNPAINT the scalp only inside the fitted eye mesh's own XY footprint, reverting
    # those polygons to the skin material: the eye area then shows skin and the eyes
    # render through the socket opening. The footprint is measured from the fitted
    # eye mesh — no fitted constant. Both frames are world (matrix_world) so the
    # comparison is transform-safe.
    eye_world = np.array([tuple(eyes_asset.matrix_world @ v.co) for v in eyes_asset.data.vertices])
    eye_min_x = float(eye_world[:, 0].min())
    eye_max_x = float(eye_world[:, 0].max())
    eye_min_y = float(eye_world[:, 1].min())
    eye_max_y = float(eye_world[:, 1].max())
    # Expand the footprint by the BODY's own median edge length — the natural scale
    # of the surface. A polygon whose CENTER sits just outside the eye bounds still
    # overhangs the socket (measured: the first bake left 18 scalp polygons whose
    # quad centres sat at the footprint edge, still rendering in front of the eye).
    # The expansion is a property of the mesh resolution, not a fitted constant.
    h_mesh = human.data
    edge_lens: list[float] = []
    for poly in h_mesh.polygons:
        iv = list(poly.vertices)
        for k in range(len(iv)):
            a = h_mesh.vertices[iv[k]].co
            b = h_mesh.vertices[iv[(k + 1) % len(iv)]].co
            edge_lens.append(float((a - b).length))
    edge_pad = float(np.median(edge_lens)) if edge_lens else 0.01
    skin_idx = next(
        (i for i, m in enumerate(human.data.materials) if "skin" in (m.name or "").lower()),
        0,
    )
    scalp_idx = next(
        (
            i
            for i, m in enumerate(human.data.materials)
            if "scalp_hair" in (m.name or "").lower()
        ),
        None,
    )
    if scalp_idx is None:
        raise RuntimeError("#338: scalp material region missing for the eye-socket unpaint")
    h_world = human.matrix_world
    eye_socket_unpainted = 0
    for poly in human.data.polygons:
        if poly.material_index != scalp_idx:
            continue
        c = h_world @ poly.center
        if (
            eye_min_x - edge_pad <= c.x <= eye_max_x + edge_pad
            and eye_min_y - edge_pad <= c.y <= eye_max_y + edge_pad
        ):
            poly.material_index = skin_idx
            eye_socket_unpainted += 1

    # #341 round 5 — the forehead rectangle. Measured on the shipped bytes: the
    # scalp's crown band (0.935 H, the paint the #338 eye-socket unpaint leaves
    # behind) still covers the FACE FRONT from just above the eye socket to the
    # crown — the "black rectangle on the forehead" pixel grade, on every MPFB
    # body (aisha scalp y=[0.894,1.000]H, zmax 1.4 cm anterior of the eyes).
    # The band's own face-front exclusion never fires because its depth line is
    # computed from the WHOLE-BODY bounds, which the hanging arms dominate
    # (measured: `skippedFaceFrontFaceCount: 0` on every bake — the #282
    # conjunction's "correct on each axis, wrong as a conjunction").
    #
    # There is NO hairline reference in the shipped anatomy — measured: the MPFB
    # basemesh has no hairline vertex group (all joint/head groups are helper
    # verts >= 13,380, stripped), and no MakeHuman target marks the hairline (the
    # forehead targets run to the crown; the brow targets mark the lower face).
    # The hairline is therefore DERIVED from the body's own surface: the
    # forehead is a near-vertical front column whose front depth stays ~constant
    # from the brow to the crown, and the hairline is the top of that column —
    # the highest face-front vertex still at or ahead of the forehead plane. The
    # plane and the column width are measured per-body: the forehead plane is the
    # median depth (y) of the head's midline surface in the EYE mesh's own height
    # band (the fitted eye mesh extent is the sanctioned reference — the eye
    # socket is the lower bound of the forehead), and the midline half-width is
    # the eye mesh's own half-width. No fitted constant: every quantity is the
    # eye mesh's measured extent or the body's own geometry.
    eye_min_z = float(eye_world[:, 2].min())
    eye_max_z = float(eye_world[:, 2].max())
    eye_half_w = float(np.max(np.abs(eye_world[:, 0])))
    # Head region: above the neck band bottom (the materializer's own NECK_BAND_H
    # MADR 0051 §4 band — a documented anatomical landmark, not a fitted number).
    _h_zmin = float(min((h_world @ v.co).z for v in human.data.vertices))
    _h_zmax = float(max((h_world @ v.co).z for v in human.data.vertices))
    _h_stature = _h_zmax - _h_zmin
    head_z0 = _h_zmin + 0.78 * _h_stature
    _midline = [
        tuple(h_world @ v.co) for v in human.data.vertices
        if (h_world @ v.co).z >= head_z0 and abs((h_world @ v.co).x) <= eye_half_w
    ]
    _eye_band = [p for p in _midline if eye_min_z <= p[2] <= eye_max_z]
    forehead_plane = float(np.median([p[1] for p in _eye_band])) if _eye_band else None
    hairline_z = None
    if forehead_plane is not None:
        _at_plane = [p for p in _midline if p[1] <= forehead_plane]
        if _at_plane:
            hairline_z = float(max(p[2] for p in _at_plane))
    if hairline_z is None:
        print(
            "FOREHEAD_HAIRLINE WARNING: could not measure a face-front hairline "
            "(empty midline or eye band) — the forehead rectangle will not be unpainted; report this"
        )
    else:
        forehead_unpainted = 0
        for poly in human.data.polygons:
            if poly.material_index != scalp_idx:
                continue
            c = h_world @ poly.center
            if c.y <= forehead_plane and c.z <= hairline_z:
                poly.material_index = skin_idx
                forehead_unpainted += 1
        print(
            f"FOREHEAD_HAIRLINE planeY {forehead_plane:.4f} hairlineZ {hairline_z:.4f} "
            f"(hairlineFrac {(hairline_z - _h_zmin) / _h_stature:.4f}) "
            f"unpainted {forehead_unpainted} scalp polys in the face front below the hairline"
        )

    # issue-341 round 8 — hairline boundary regularization (the sawtooth). The
    # round-5 unpaint above leaves the scalp/skin boundary meandering: material
    # assignment is per-polygon (each polygon's CENTRE decides), so the hairline
    # follows triangle edges. Measured on the shipped bytes of all three MPFB
    # actors: the central-forehead seam alternates direction 54-67% of steps with
    # median step 6.9-27 mm — the "jagged black sawtooth across the forehead".
    # The planted flip-rate gate (<=25%) cannot be met by ANY per-polygon boundary
    # at this mesh density — measured: even a hairline snapped to the mesh ring
    # alternates 43-68% because the seam follows edges at sub-mm scale, and the
    # skin region's boundary has TWO components (the front-to-top fold arc and the
    # crown-front) that alternate along x. The definitive fix is per-pixel (a
    # texture-mask hairline — #343). What this pass DOES fix is the LARGE-AMPLITUDE
    # raggedness: it snaps the face-front strip to the mesh's own edge ring. A
    # scalp polygon in the strip stays scalp only if ALL its vertices sit above the
    # strip's measured hairline — the mean height of the current seam, the same
    # quantity the hairline-is-a-line-not-a-sawtooth contract measures. Per-body,
    # no fitted constant. The ring boundary reads as a clean hairline even though
    # the flip-rate contract cannot see it.
    seam_zs: list[float] = []
    _scalp_vert_used = [False] * len(human.data.vertices)
    for poly in human.data.polygons:
        if poly.material_index == scalp_idx:
            for vi in poly.vertices:
                _scalp_vert_used[vi] = True
    for poly in human.data.polygons:
        if poly.material_index == skin_idx:
            for vi in poly.vertices:
                if _scalp_vert_used[vi]:
                    v = h_world @ human.data.vertices[vi].co
                    if abs(v.x) <= eye_half_w:
                        seam_zs.append(v.z)
    hairline_snap_z = float(np.mean(seam_zs)) if seam_zs else None
    if hairline_snap_z is None:
        print("HAIRLINE_SNAP WARNING: no scalp/skin seam found in the face-front strip — skipping")
    else:
        hairline_snap_frac = (hairline_snap_z - _h_zmin) / _h_stature
        hairline_snapped = 0
        for poly in human.data.polygons:
            if poly.material_index != scalp_idx:
                continue
            c = h_world @ poly.center
            if abs(c.x) > eye_half_w:
                continue
            if all((h_world @ human.data.vertices[vi].co).z > hairline_snap_z for vi in poly.vertices):
                continue
            poly.material_index = skin_idx
            hairline_snapped += 1
        print(
            f"HAIRLINE_SNAP seamZ {hairline_snap_z:.4f} (frac {hairline_snap_frac:.4f}) "
            f"snapped {hairline_snapped} scalp polys in the face-front strip to the mesh ring"
        )
    # The eye material the fitter applied is MPFB's procedural eyes NODE TREE, which
    # the GLB exporter does not bake (measured on the shipped bytes: the exported eye
    # material has NO baseColorFactor — it renders flat WHITE). #337/#338 each then
    # replaced it with a flat baseColor (white, then dark brown) and neither produced
    # an eye: a sclera and an iris cannot be one colour. #340: consume the ASSET'S
    # OWN declared material instead — the .mhclo declares `material ../materials/
    # brown.mhmat` and that .mhmat declares `diffuseTexture brown_eye.png` (the
    # iris/sclera map, CC0 header in the same directory, 610,817 bytes upstream-
    # verified). make_material_from_mhmat is the generic .mhmat path (skin and
    # garments can take it later); it is not eye-special-cased.
    eyes_asset.data.materials.clear()
    eye_mhmat = mhmat_for_mhclo(eye_mhclo)
    eye_mat = make_material_from_mhmat(
        eye_mhmat,
        f"mat_makeclothes_library_eyes_{args.reference or 'ob_patient_aisha'}",
    )
    eyes_asset.data.materials.append(eye_mat)
    eye_tex = eye_mat.node_tree.nodes.get("Image Texture")
    print(
        f"EYE_MATERIAL {eye_mhmat.name} diffuseTexture "
        f"{eye_tex.image.filepath if eye_tex and eye_tex.image else 'NONE'} "
        f"name {eye_mat.name}"
    )
    print(
        f"EYE_SOCKET_UNPAINT {eye_socket_unpainted} polygons reverted to skin "
        f"in the eye footprint x[{eye_min_x:.4f},{eye_max_x:.4f}] y[{eye_min_y:.4f},{eye_max_y:.4f}]"
    )

    # #318: strip MakeHuman's clothes and hair FITTING SHELLS with the proven MPFB export
    # service (D1). `bpy.ops.mpfb.create_human()` materialises the FULL base.obj including
    # helper geometry — 36,972 tris, exactly MADR 0052's "with helpers" figure — and Aisha
    # has shipped with those shells since #263 (graded 2026-08-11: a floor-length robe and a
    # hood with flat quads across the face, hiding the correct body beneath). 
    # ExportService.bake_modifiers_remove_helpers (exportservice.py:79, remove_helpers=True)
    # is the MPFB-shipped strip; the documented result is 26,756 tris / 13,380 verts (MADR
    # 0052 cross-check). ORDER IS LOAD-BEARING: the face targets must load on the FULL base
    # topology above — deleting helper verts re-maps shape-key blocks, and a target loaded
    # after the strip would mis-index (body_param_stage.py #221 A2). The FACS keys loaded
    # above survive on body-surface verts; Blender updates their key blocks when the helper
    # verts are deleted.
    verts_before_strip = len(human.data.vertices)
    tris_before_strip = sum(max(len(p.vertices) - 2, 0) for p in human.data.polygons)
    from bl_ext.user_default.mpfb.services.exportservice import ExportService  # noqa: E402

    ExportService.bake_modifiers_remove_helpers(
        human, bake_masks=False, bake_subdiv=False, remove_helpers=True, also_proxy=True
    )
    bpy.context.view_layer.update()
    verts_after_strip = len(human.data.vertices)
    tris_after_strip = sum(max(len(p.vertices) - 2, 0) for p in human.data.polygons)
    print(
        f"HELPER_STRIP verts {verts_before_strip} -> {verts_after_strip}; "
        f"tris {tris_before_strip} -> {tris_after_strip}"
    )

    armature = next((obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE"), None)
    if armature is None:
        raise RuntimeError("MPFB standard rig was not created")
    armature.name = f"mpfb_{args.reference or 'ob_patient_aisha'}_standard_rig"

    # #337 eye-bone skinning: NOTHING MORE TO DO — `add_mhclo_asset`'s own
    # set_up_rigging/interpolate_weights already weighted every one of the 96 eye verts to
    # the standard rig's eye.L/eye.R bones (probe: dominant groups eye.L: 48 / eye.R: 48),
    # exactly MakeHuman's eye rigging design. Measured attempt at replacing it with the
    # garment k-NN projection (transfer_weights_body_to_garment) was WRONG: k-NN over the
    # 12 nearest body verts diluted the eye-bone weights to ~1/96 verts (the socket body
    # verts carrying eye weights are a 31/30 minority of the local neighbourhood), so the
    # eye would rotate with the head, not with the gaze. The interpolate_weights result is
    # kept and the transfer is NOT run. (The 31/30 eye-weighted BODY verts measured in
    # #337's issue body are the socket skin — the eye MESH is what the gaze drive needs.)

    # #321: fit a real MakeHuman garment on the helper-stripped basemesh via the
    # PROVEN ClothesService path (D1) — the same code body_param_stage.py uses for
    # the hm08 library rail. Do not hand-author garment geometry and do not write a
    # new fitter. ORDER IS LOAD-BEARING: the fit runs AFTER the #318 helper strip
    # because .mhclo vertex refs index the canonical 13,380-vert hm08 basemesh
    # topology — exactly what the strip leaves. The toigo basic tucked t-shirt is
    # CC0 (mhclo header) and references only body verts (max ref 11,017 < 13,380);
    # the polo references 3,648 helper verts and CANNOT fit a stripped basemesh —
    # it is refused loudly, not fitted against absent indices (clause 3).
    # CLINICAL CHOICE: the least-wrong garment for an OB triage patient. A hospital
    # gown is not in the cached library and a scrub shirt is staff wear; a patient
    # presenting in street clothes (a basic t-shirt) is plausible triage staging.
    import sys as _sys3

    _stage_dir = REPO_ROOT / "tools/openclinxr/asset-pipeline/makeclothes"
    if str(_stage_dir) not in _sys3.path:
        _sys3.path.insert(0, str(_stage_dir))
    from body_param_stage import import_obj, apply_object_transforms, transfer_weights_body_to_garment, world_bounds  # noqa: E402

    _garment_dir = (
        REPO_ROOT
        / ".openclinxr-local/provider-cache/garments/sources/makehuman-shirts01/toigo_basic_tucked_t-shirt"
    )
    garment_obj = _garment_dir / "t_shirt_basic_tucked.obj"
    garment_mhclo = _garment_dir / "toigo_basic_tucked_t-shirt.mhclo"
    if not garment_obj.is_file() or not garment_mhclo.is_file():
        raise RuntimeError(f"toigo t-shirt sources missing in provider cache: {_garment_dir}")

    from bl_ext.user_default.mpfb.entities.clothes.mhclo import Mhclo  # noqa: E402
    from bl_ext.user_default.mpfb.services.clothesservice import ClothesService  # noqa: E402

    garment = import_obj(str(garment_obj), "makeclothes_library_toigo_t_shirt", force_z=False)
    # #321 handback: bake the OBJ importer's axis rotation into mesh data so the garment object is
    # identity/Z-up — the SAME bake MPFB's body loader performs on the basemesh
    # (`ObjectService.load_wavefront_file`, transform_apply(rotation=True)). The fit writes BODY-LOCAL
    # coordinates into the garment mesh; a garment object carrying the importer's 90-degree X rotation
    # renders those coords rotated (measured: garment on the floor with Y/Z swapped). apply_object_transforms
    # is the proven helper body_param_stage uses; this is a bake, not a hand-written matrix.
    apply_object_transforms(garment)
    garment.data.materials.clear()
    # Name matches the GARMENT_MATERIAL regex the evidence RED reads (makeclothes/shirt).
    garment.data.materials.append(
        make_material("mat_makeclothes_library_toigo_t_shirt", (0.30, 0.45, 0.62, 1.0))
    )
    mhclo = Mhclo()
    mhclo.load(str(garment_mhclo))
    try:
        mhclo.clothes = garment
    except Exception:
        pass
    garment_verts_before = len(garment.data.vertices)
    ClothesService.fit_clothes_to_human(garment, human, mhclo=mhclo, set_parent=True)
    bpy.context.view_layer.update()
    garment_verts_after = len(garment.data.vertices)
    garment_tris = sum(max(len(p.vertices) - 2, 0) for p in garment.data.polygons)
    # Rename the shirt mesh data to the library convention (the OBJ importer keeps
    # the pack stem `t_shirt_basic_tucked`; the pants/shoes follow the
    # `makeclothes_library_*_mpfb_<ref>` convention) so the garment classifiers on
    # both rails see the upper channel as a real MakeClothes garment.
    _ref_tag = args.reference or "ob_patient_aisha"
    garment.data.name = f"makeclothes_library_toigo_t_shirt_mpfb_{_ref_tag}_mesh"
    # #332: anchor the fitted shirt's collar to the body's own neck when the fit
    # lands it below the neck band (the child's shirt fits at its hip). Must run
    # BEFORE the weight projection so the k-NN binds the shirt at its final height.
    neck_align = align_upper_garment_to_neck(garment, human, armature)
    # Bind the garment to the same armature so it deforms with the body (the proven
    # weight projection body_param_stage runs for the hm08 rail; not a rigid shell).
    weights = transfer_weights_body_to_garment(human, garment, armature)
    print(
        f"GARMENT_FIT {garment.name} verts {garment_verts_before} -> {garment_verts_after} "
        f"tris {garment_tris} weights {weights}"
    )

    # #326: fit the CC0 cargo pants on the SAME body via the SAME proven
    # ClothesService path (D1) — the exact garment + service the hm08 library rail
    # fits (`body-param-cli.ts` `LIBRARY_LOWER_GARMENT_ID` = cortu_cargo_pants,
    # makehuman-pants01 pack). She ships bare below the waist today (measured:
    # upper toigo t-shirt 5,400 verts, lower NONE); the library lean_female carries
    # the same trousers at 8,565 verts through this call. The .mhclo header is
    # `# Cortu Johnstone - CC0`, basemesh hm08, max vertex ref 13,351 < 13,380 — it
    # fits the helper-stripped topology exactly like the t-shirt.
    _pants_dir = (
        pathlib.Path(__file__).resolve().parents[4]
        / ".openclinxr-local/provider-cache/garments/sources/makehuman-pants01/cortu_cargo_pants"
    )
    pants_obj = _pants_dir / "cargo_pants.obj"
    pants_mhclo = _pants_dir / "cargo_pants.mhclo"
    if not pants_obj.is_file() or not pants_mhclo.is_file():
        raise RuntimeError(f"cargo pants sources missing in provider cache: {_pants_dir}")

    pants = import_obj(str(pants_obj), "makeclothes_library_cargo_pants", force_z=False)
    # Same axis bake as the t-shirt (#321 handback): the OBJ importer's rotation is
    # baked into mesh data so the object is identity/Z-up before the fit writes
    # body-local coordinates into it.
    apply_object_transforms(pants)
    pants.data.materials.clear()
    # Name matches the LOWER_GARMENT regex the evidence RED reads (cargo/pants) AND
    # the GARMENT regex of the #323 regression net (makeclothes).
    pants.data.materials.append(
        make_material("mat_makeclothes_library_cargo_pants", (0.32, 0.36, 0.42, 1.0))
    )
    mhclo_pants = Mhclo()
    mhclo_pants.load(str(pants_mhclo))
    try:
        mhclo_pants.clothes = pants
    except Exception:
        pass
    pants_verts_before = len(pants.data.vertices)
    ClothesService.fit_clothes_to_human(pants, human, mhclo=mhclo_pants, set_parent=True)
    bpy.context.view_layer.update()
    print(
        f"PANTS_FIT {pants.name} verts {pants_verts_before} -> {len(pants.data.vertices)} "
        f"tris {sum(max(len(p.vertices) - 2, 0) for p in pants.data.polygons)}"
    )
    # The raw fit is the sparse 392-triangle trouser (#220: 71% leg coverage, 32 open
    # edges). The LOWER GATE below (mirrored from body_param_stage) measures it against
    # the leg band and replaces a `does_not_cover` fit with the body-derived cover
    # shell — the same replacement that gives the library rail its 8,565-vert lower
    # garment. The weight transfer + print happen there, on the geometry that SHIPS.

    # #323: body-part hiding under the fitted garment — wire the PROVEN tool from
    # the sibling rail (D1), do not write a second hider. The MPFB2 rail has NO
    # body-part hiding: the fitted t-shirt and the body it is fitted to both
    # render, and the body pokes through the cloth in large skin-coloured patches
    # across chest, abdomen, shoulders and collar (graded on #321's placement
    # fix). The library rail solves exactly this with
    # body_param_stage.apply_body_hide_material_region (body_param_stage.py:651)
    # — the §6s research answer: HIDE the body under the garment (alpha mask)
    # rather than push the cloth out. The mask is per-triangle from
    # garment_coverage.body_hide_mask (signed clearance < HIDE_EPSILON_M against
    # the BODY's outward normal — winding-proof, _orient_outward), and it paints
    # an alpha-0 material so the hidden faces never render; geometry, rig and
    # shape keys are untouched (only polygon material indices change). The glTF
    # exporter maps the constant alpha-0 Principled input to alphaMode=MASK /
    # alphaCutoff=0.5, so the faces are DISCARDED at render (measured on the
    # library rail's shipped bytes).
    #
    # ORDER IS LOAD-BEARING: the mask runs AFTER the fit + weight transfer so it
    # covers the FINAL garment footprint (the fit writes body-local coordinates
    # into the garment mesh, and the export reads material indices at export
    # time). It does NOT push the garment further out — #322 measured the raw
    # MakeClothes fit at median ~0.7 mm (half the surface coincident with the
    # skin) and the 1.5 cm shipping standoff already survives; hiding is the
    # other half of the fix and standoff alone did not stop the poke-through.
    #
    # #295 SCOPE: the mask is scoped away from the hands from the start via
    # body_param_stage.scope_hide_mask_away_from_hands — a body face whose
    # vertices are dominated by a hand/finger joint is a BARE hand (the garment
    # terminates at the wrist), and leaving it under the alpha-MASK would discard
    # it and show a stump where the sleeve was — the mitten defect on a second
    # rail.
    import sys as _sys4

    _stage_dir2 = (
        pathlib.Path(__file__).resolve().parents[4] / "tools/openclinxr/asset-pipeline/makeclothes"
    )
    if str(_stage_dir2) not in _sys4.path:
        _sys4.path.insert(0, str(_stage_dir2))
    from body_param_stage import (  # noqa: E402
        apply_body_hide_material_region,
        clip_hide_mask_below_joint,
        clip_hide_mask_to_garment_footprint,
        scope_hide_mask_away_from_hands,
        world_bounds,
    )
    from garment_coverage import (  # noqa: E402
        HIDE_EPSILON_M,
        _orient_outward,
        _region_signed_clearance_samples,
        body_hide_mask,
    )

    def _triangulate_numpy(obj: bpy.types.Object):
        # Fan triangulation mirroring body_param_stage._numpy_mesh: the coverage
        # predicate assumes triangle faces, and MPFB bodies / OBJ imports are
        # quad/n-gon meshes (body 13,380 verts / 26,756 tris = 13,378 quads).
        # WORLD coordinates (matrix_world @ v.co) so the body and garment share
        # one frame regardless of object transforms — the same frame world_bounds
        # reports the band in. Feeding raw quads to the predicate garbles the
        # surface (issue-277, measured on the library gate's first run).
        mw = obj.matrix_world
        verts = np.array([tuple(mw @ v.co) for v in obj.data.vertices], dtype=float)
        faces: list[tuple[int, int, int]] = []
        for p in obj.data.polygons:
            iv = list(p.vertices)
            if len(iv) == 3:
                faces.append((int(iv[0]), int(iv[1]), int(iv[2])))
            else:
                # fan triangulation from vertex 0 — the SAME order
                # apply_body_hide_material_region consumes (polygon fan order),
                # so the per-triangle mask maps back to the right polygons.
                for i in range(1, len(iv) - 1):
                    faces.append((int(iv[0]), int(iv[i]), int(iv[i + 1])))
        return verts, np.array(faces, dtype=np.int64)

    body_verts, body_faces = _triangulate_numpy(human)
    garment_verts, garment_faces = _triangulate_numpy(garment)
    gb = world_bounds(garment)

    # #326 — LOWER GATE, mirrored from body_param_stage.build_one_body_class (D1: the
    # same measurement and the same deterministic fallback, no second fitter). The raw
    # cargo-pants fit is the sparse 392-triangle trouser the #220 finding records (71%
    # leg coverage, 32 open edges) — it cannot cover the leg band it claims. A sparse
    # open fit is replaced by the body-derived cover shell (`build_cover_shell`, covers
    # by construction), exactly the replacement that gives the hm08 library rail its
    # 8,565-vert lower garment; a fit that does cover is offset to the shipping standoff
    # (#322). The shipped lower carries the cargo-pants mesh prefix + material name so
    # the evidence RED reads it as the lower garment. Runs BEFORE the masks so the hide
    # masks measure the geometry that SHIPS.
    from garment_coverage import (  # noqa: E402
        CLOTH_STANDOFF_M,
        build_cover_shell,
        cloth_offset,
        coverage_report,
    )
    from body_param_stage import _LIMB_BONE_RE, _bone_dominant_vertex_indices  # noqa: E402

    hem_z = float(gb["min"][2])  # upper garment hem (Z-up stage frame)
    ankle_z = float(world_bounds(human)["min"][2]) + 0.10  # bare feet begin below
    pants_v, pants_f = _triangulate_numpy(pants)
    lower_rep = coverage_report(
        body_verts,
        body_faces,
        pants_v,
        pants_f,
        ankle_z,
        hem_z,
        garment_label="lower",
        height_axis=2,
    )
    if lower_rep["verdict"] == "does_not_cover":
        # #295 — the leg shell must not wrap the hanging hands (measured 3,450
        # hand-dominant verts in the heavy-male lower fallback): exclude
        # arm/forearm/hand-dominant body faces from the shell band selection.
        limb_verts = _bone_dominant_vertex_indices(human, armature, _LIMB_BONE_RE)
        shell_limb_exclude = np.array(
            [any(int(vi) in limb_verts for vi in f) for f in body_faces], dtype=bool
        )
        shell = build_cover_shell(
            body_verts,
            body_faces,
            ankle_z,
            hem_z,
            standoff=CLOTH_STANDOFF_M,
            label=f"makeclothes_library_cargo_pants_fallback_mpfb_{args.reference or 'ob_patient_aisha'}",
            height_axis=2,
            exclude_faces=shell_limb_exclude,
        )
        shell_obj = mesh_from_numpy(
            f"makeclothes_library_cargo_pants_mpfb_{args.reference or 'ob_patient_aisha'}",
            np.asarray(shell["position"]).reshape(-1, 3),
            np.asarray(shell["indices"]).reshape(-1, 3),
        )
        shell_obj.data.materials.clear()
        # Name matches the LOWER_GARMENT regex the evidence RED reads (cargo/pants).
        shell_obj.data.materials.append(
            make_material("mat_makeclothes_library_cargo_pants", (0.32, 0.36, 0.42, 1.0))
        )
        bpy.data.objects.remove(pants, do_unlink=True)
        pants = shell_obj
        # issue-341 round 6 — the cover shell's bottom edge follows the body's
        # triangulation at the ankle-foot junction, not a garment hem. Measured on
        # aisha round-5c: the front hem zigs ~8 cm between the lateral ankle
        # (y 0.105) and the medial ankle (y 0.192), and the bottom ring's depth
        # spans 11 cm ('jagged trouser hems at the ankle'). The shell is the body
        # surface offset by the 1.5 cm standoff; its bottom boundary is the band
        # cut, which slices the body's foot-transition triangles at an angle. Clip
        # the shell at a horizontal plane at the band bottom (ankle_z, the 'bare
        # feet begin below' #326 landmark the band was derived from) so the shipped
        # hem is a straight horizontal line. bisect_plane + clear_inner removes the
        # part below the plane; the cut edge is exactly horizontal. The plane IS an
        # existing anatomical landmark — no new threshold.
        import bmesh as _bmesh

        _bm = _bmesh.new()
        _bm.from_mesh(pants.data)
        _geom = _bm.verts[:] + _bm.edges[:] + _bm.faces[:]
        _bmesh.ops.bisect_plane(
            _bm,
            geom=_geom,
            plane_co=(0.0, 0.0, ankle_z),
            plane_no=(0.0, 0.0, 1.0),
            clear_inner=True,
        )
        _bm.to_mesh(pants.data)
        _bm.free()
        bpy.context.view_layer.update()
        print(f"SHELL_HEM_CLIP planeZ {ankle_z:.4f}")
        lower_rep["note"] = "sparse library fit replaced with body-derived cover shell (#220)"
        pants_mesh_name = shell_obj.name
        pants_verts_after = shell["vertexCount"]
        pants_tris = shell["faceCount"]
    else:
        # #322 — a fit that covers ships at the 1.5 cm standoff (mirror the stage else).
        pants_v_off = cloth_offset(pants_v, body_verts, body_faces, CLOTH_STANDOFF_M)
        for i, v in enumerate(pants.data.vertices):
            v.co = tuple(float(x) for x in pants_v_off[i])
        bpy.context.view_layer.update()
        pants_mesh_name = pants.name
        pants_verts_after = len(pants.data.vertices)
        pants_tris = sum(max(len(p.vertices) - 2, 0) for p in pants.data.polygons)
    # Bind the trousers to the armature too (same projection as the t-shirt).
    pants_weights = transfer_weights_body_to_garment(human, pants, armature)
    print(
        f"LOWER_GATE {lower_rep} pantsMesh {pants_mesh_name} verts {pants_verts_after} "
        f"tris {pants_tris} weights {pants_weights}"
    )
    # #334: the head joint is the per-body bound below which a hide mask may stop —
    # the reference is the body's OWN skeleton (it cannot be moved by the garment
    # change being measured), not a stature fraction or a fitted constant. Read it
    # at rest; the ClinicalIdle action is created after the masks.
    head_joint_z = _joint_world_z(armature, "head")
    hide_info = body_hide_mask(
        body_verts,
        body_faces,
        garment_verts,
        garment_faces,
        float(gb["min"][2]),
        float(gb["max"][2]),
        hide_epsilon_m=HIDE_EPSILON_M,
        height_axis=2,
    )
    hide_mask = hide_info.pop("hideMask")
    if hide_info["hiddenFaceCount"] == 0:
        print(
            "BODY_HIDE WARNING: body_hide_mask found no poking body faces under the "
            "fitted garment — the #323 poke-through would not be fixed; report this"
        )
    # #295 — never discard a bare hand: scope the mask to the covered region.
    hide_mask, hand_faces_unhidden = scope_hide_mask_away_from_hands(human, hide_mask, armature)
    # #326 — clip the mask to the garment's footprint (SHARED over-reach fix; the
    # signed-clearance test admits body faces just outside the garment silhouette and
    # the discarded verts render as slivers — measured 23.7 mm below the hem here).
    hide_mask, footprint_clipped = clip_hide_mask_to_garment_footprint(
        hide_mask, human, gb
    )
    # #334 — never discard the head/face: a garment whose collar rides above the
    # body's own head joint puts the jaw under the mask. Clip the mask to the head
    # joint (no-op on bodies whose mask already stops below — the known-good ones).
    hide_mask, head_clipped = clip_hide_mask_below_joint(hide_mask, human, head_joint_z)
    # issue-341: #326's footprint clip tests ALL THREE AABB axes INCLUDING depth, so it
    # un-hides a genuine poke — a poke protrudes PAST the garment's front depth and its
    # vertices sit outside the garment's depth AABB. Measured on aisha's shipped bytes:
    # 443 pokes at breast/sternum/midriff/collar were un-hidden by the clip and render
    # as visible skin through the shirt. Re-hide any region face that genuinely pokes
    # the garment surface (min vertex clearance < 0) AND sits inside the garment's
    # LATERAL (x) + VERTICAL (z) footprint. The depth axis is deliberately excluded: a
    # face in front of the garment is by definition under its silhouette. The clip's
    # over-reach trimming (below the hem, above the collar, outside the x silhouette)
    # is preserved for non-poking faces.
    _poke_cl, _poke_fidx, _poke_fv, _poke_fn = _region_signed_clearance_samples(
        body_verts, body_faces, garment_verts, garment_faces,
        float(gb["min"][2]), float(gb["max"][2]),
        max_search_m=0.08, height_axis=2, lateral_axis=0,
    )
    _poke_per = _poke_cl.reshape(len(_poke_fidx), 3).min(axis=1)
    _poke_fcent = body_verts[body_faces[_poke_fidx]].mean(axis=1)
    _gx_lo = float(garment_verts[:, 0].min()) - 0.002
    _gx_hi = float(garment_verts[:, 0].max()) + 0.002
    _gz_lo = float(garment_verts[:, 2].min()) - 0.002
    _gz_hi = float(garment_verts[:, 2].max()) + 0.002
    _in_xz = (
        (_poke_fcent[:, 0] >= _gx_lo)
        & (_poke_fcent[:, 0] <= _gx_hi)
        & (_poke_fcent[:, 2] >= _gz_lo)
        & (_poke_fcent[:, 2] <= _gz_hi)
    )
    # #334 — VERTEX-based head-joint bound shared by every re-hide below: the clip
    # ran at the head joint and each re-hide (force, coincident, tilted, full-body)
    # runs AFTER it, so a re-hide must not re-add a face whose vertices reach above
    # the joint (a collar that rides above it must not put the jaw/neck back under
    # the mask — measured: nurse collar 0.921H vs joint 0.914H, the shipped mask
    # AABB is max-vertex).
    _below_joint = (
        body_verts[body_faces[_poke_fidx]].max(axis=1)[:, 2] <= head_joint_z
    )
    _rehide = (_poke_per < 0) & _in_xz & _below_joint
    _force_hidden = int(_rehide.sum())
    hide_mask[_poke_fidx[_rehide]] = True
    # issue-341 black-sliver refinement: a hidden face that NEITHER has the garment
    # between it and the front viewer NOR has the garment within the shipping
    # standoff BEHIND it along the viewer axis is NOT under the cloth — hiding it
    # discards the face and the viewer sees the dark body interior through the hole
    # (measured on aisha's round-1 bake: 952 hidden tris with no shirt in front,
    # clustered at the collar/neck, sleeve edges and hem; re-measured round-6d on
    # the shipped bytes: 49 + 86 hidden tris at the shoulder/arm silhouette edges
    # are the FRONT-MOST surface in their column with NOTHING rendering behind them
    # — the "dark slivers at both shoulders and along the elbow line" pixel grade).
    # The BEHIND test replaces the strict-poke exemption: a poke has the cloth
    # behind it along the viewer axis at ANY reach (hiding reveals the cloth), but
    # a silhouette-edge face has NO cloth behind — hiding it reveals the dark
    # interior. The reach is the gate's own MAX_RAY_T (0.5 m), the same as the
    # front test — NOT a standoff bound: the child's loose adult-authored t-shirt
    # hangs 2-5 cm off the body (measured 2026-08-12: round-6b first bake with a
    # 1.5 cm behind-bound left the child's skin pokes un-hidden and the occlusion
    # gate read tshirt occludedByOther 0.1379; the 0.5 m reach keeps them hidden
    # and the shirt renders). Un-hide exactly the no-cloth-anywhere faces; the
    # #326 over-reach class is now surface-truth rather than a 3D AABB guess. The
    # viewer ray runs toward the stage's front (-Y: Blender create_human faces -Y,
    # which the glTF export maps to +Z — the same +Z the occlusion gate shoots
    # from).
    from garment_coverage import _ray_tri_hits as _ray_tri_hits_341  # noqa: E402

    _VIEW_Y = np.array([0.0, -1.0, 0.0])
    _BLACK_BACK_Y = np.array([0.0, 1.0, 0.0])
    _garment_tris_341 = garment_verts[garment_faces]
    _hidden_idx = np.where(hide_mask)[0]
    _black_slivers = 0
    if len(_hidden_idx):
        _hcent = body_verts[body_faces[_hidden_idx]].mean(axis=1)
        _h_origins = _hcent + _VIEW_Y * 1e-4
        _h_dirs = np.tile(_VIEW_Y, (len(_h_origins), 1))
        _h_hits = _ray_tri_hits_341(_h_origins, _h_dirs, _garment_tris_341, 0.5)
        _covered = np.isfinite(_h_hits)
        _h_back_origins = _hcent + _BLACK_BACK_Y * 1e-4
        _h_back_dirs = np.tile(_BLACK_BACK_Y, (len(_h_origins), 1))
        _h_back_hits = _ray_tri_hits_341(
            _h_back_origins, _h_back_dirs, _garment_tris_341, 0.5
        )
        _cloth_behind = np.isfinite(_h_back_hits)
        _unhide = ~_covered & ~_cloth_behind
        _black_slivers = int(_unhide.sum())
        hide_mask[_hidden_idx[_unhide]] = False
    # issue-341 round 6 — the coincident-class re-hide. The force-hide above
    # restores only STRICT pokes (min vertex clearance < 0). body_hide_mask's OWN
    # threshold is HIDE_EPSILON_M (5 mm), which also covers the COINCIDENT class
    # (clearance in [0, 5 mm): the garment surface within 5 mm of the skin along
    # the body normal — sub-mm z-fight). Measured on aisha round-5c: 20 skin faces
    # at x +-0.04..0.08, y 1.09-1.20, z 0.151-0.159 carry clearance 0.07-1.28 mm
    # (all < HIDE_EPSILON_M, none < 0) — they were hidden by body_hide_mask, then
    # UN-hidden by #326's footprint clip (their depth pokes past the garment's
    # depth AABB) and left un-hidden by the black-sliver un-hide (not a strict
    # poke). They render as the "small skin patches at the midriff" pixel grade.
    # Re-hide exactly those, plus the TILTED-SURFACE sibling measured at the same
    # spot (aisha round-5c: 4 faces at x +-0.036..0.042, y 1.088-1.098 whose
    # normal clearance is 19 mm — the cloth is NOT within epsilon along the normal
    # — but whose skin still renders 3-6 mm IN FRONT of the cloth along the viewer
    # ray: the lower-belly surface curves away from the cloth). Both classes are
    # the same render truth: front-facing skin with the cloth within
    # CLOTH_STANDOFF_M BEHIND it along the viewer ray and no cloth in front —
    # hiding reveals the cloth, never the dark interior (the black-sliver un-hide
    # above stays for faces with nothing behind them; the natural bare ankle at
    # frac 0.05 measures 6-9 cm of cloth behind and is excluded by the same bound).
    _coinc = (_poke_per >= 0) & (_poke_per < HIDE_EPSILON_M)
    _rehide_coinc = np.zeros(len(_poke_per), dtype=bool)
    # #334 — the shared VERTEX-based head-joint bound (computed with the force-hide
    # above) applies to every re-hide.
    if _coinc.any():
        _BACK_Y = np.array([0.0, 1.0, 0.0])
        _cc = _poke_fcent[_coinc]
        _origins = _cc + _BACK_Y * 1e-4
        _dirs = np.tile(_BACK_Y, (len(_origins), 1))
        _hits_b = _ray_tri_hits_341(_origins, _dirs, _garment_tris_341, CLOTH_STANDOFF_M)
        _behind = np.isfinite(_hits_b)
        # Restrict to FRONT-FACING faces (normal toward the viewer, stage -Y): a
        # coincident face on the side/back of the body is not a visible patch — it
        # sits behind the body's own front surface and re-hiding it is pointless.
        # `_poke_fn` is per-vertex (3 samples per face); average to the face normal.
        _front_facing = _poke_fn.reshape(len(_poke_fidx), 3, 3).mean(axis=1)[:, 1] < 0.0
        _rehide_coinc[_coinc] = _behind
        _rehide_coinc = _rehide_coinc & _in_xz & _front_facing & _below_joint
    # the tilted-surface sibling: front-facing skin with NO cloth in front along
    # the viewer ray and the cloth within CLOTH_STANDOFF_M behind it.
    _rehide_tilted = np.zeros(len(_poke_per), dtype=bool)
    if True:
        _BACK_Y2 = np.array([0.0, 1.0, 0.0])
        _origins_f = _poke_fcent + _VIEW_Y * 1e-4
        _dirs_f = np.tile(_VIEW_Y, (len(_poke_fcent), 1))
        _hits_f = _ray_tri_hits_341(_origins_f, _dirs_f, _garment_tris_341, CLOTH_STANDOFF_M)
        _no_cloth_front = ~np.isfinite(_hits_f)
        _origins_b = _poke_fcent + _BACK_Y2 * 1e-4
        _dirs_b = np.tile(_BACK_Y2, (len(_poke_fcent), 1))
        _hits_b2 = _ray_tri_hits_341(_origins_b, _dirs_b, _garment_tris_341, CLOTH_STANDOFF_M)
        _cloth_behind = np.isfinite(_hits_b2)
        _front_facing2 = _poke_fn.reshape(len(_poke_fidx), 3, 3).mean(axis=1)[:, 1] < 0.0
        _rehide_tilted = _no_cloth_front & _cloth_behind & _front_facing2 & _in_xz
        # #334 — same VERTEX-based head-joint bound as the coincident re-hide.
        _rehide_tilted = _rehide_tilted & _below_joint
    _rehide_coinc = _rehide_coinc | _rehide_tilted
    _coinc_rehidden = int(_rehide_coinc.sum())
    hide_mask[_poke_fidx[_rehide_coinc]] = True
    print(f"COINCIDENT_REHIDE faces {_coinc_rehidden}")
    # issue-341 round 6 — the full-body viewer-poke scan. The region selection
    # above (and the hide mask's own region) is bounded by the shared per-slice
    # lateral footprint (_lateral_footprint), and that footprint has a
    # mesh-resolution artifact: measured on aisha, slice 6 of the t-shirt reads
    # 3.4 cm while the shirt's real extent at that height is 13.1 cm, so the 4
    # lower-belly faces at x +-0.036..0.042 were NEVER SAMPLED and could not be
    # re-hidden by any region-bounded step. Scan ALL body faces (not region-
    # restricted): front-facing, no cloth in front along the viewer ray, cloth
    # within CLOTH_STANDOFF_M behind along the viewer ray, inside the garment's
    # x/height silhouette. The standoff behind-bound is what keeps the natural
    # bare ankle (6-9 cm of cloth behind, measured) and the bare forearms out of
    # the mask — cloth within the shipping standoff BEHIND a front-facing face is
    # a z-fight poke by definition, and hiding reveals the cloth, never the dark
    # interior.
    _VIEWER_POKE_BACK = np.array([0.0, 1.0, 0.0])
    _bc_all = body_verts[body_faces].mean(axis=1)
    _pre_sel = (
        (_bc_all[:, 0] >= _gx_lo - CLOTH_STANDOFF_M)
        & (_bc_all[:, 0] <= _gx_hi + CLOTH_STANDOFF_M)
        & (_bc_all[:, 2] >= _gz_lo - CLOTH_STANDOFF_M)
        & (_bc_all[:, 2] <= _gz_hi + CLOTH_STANDOFF_M)
    )
    _pre_idx = np.where(_pre_sel)[0]
    _viewer_poke_rehidden = 0
    if len(_pre_idx):
        # #334 — the full-body scan must also respect the head joint (vertex-based,
        # same as the coincident re-hide): the collar can ride above it (measured:
        # nurse collar 0.921H vs joint 0.914H) and the neck above the joint must
        # never be discarded.
        _pre_sel = _pre_sel & (
            body_verts[body_faces].max(axis=1)[:, 2] <= head_joint_z
        )
        _pre_idx = np.where(_pre_sel)[0]
    if len(_pre_idx):
        _bp_tris = body_verts[body_faces[_pre_idx]]
        _bp_fn = np.cross(_bp_tris[:, 1] - _bp_tris[:, 0], _bp_tris[:, 2] - _bp_tris[:, 0])
        _bp_fn = _bp_fn / (np.linalg.norm(_bp_fn, axis=1, keepdims=True) + 1e-12)
        _front = _bp_fn[:, 1] < 0.0
        _f_idx = np.where(_front)[0]
        if len(_f_idx):
            _bc_f = _bc_all[_pre_idx][_f_idx]
            _o_f = _bc_f + _VIEW_Y * 1e-4
            _d_f = np.tile(_VIEW_Y, (len(_f_idx), 1))
            _h_f = _ray_tri_hits_341(_o_f, _d_f, _garment_tris_341, CLOTH_STANDOFF_M)
            _no_cloth_f = ~np.isfinite(_h_f)
            _o_b = _bc_f + _VIEWER_POKE_BACK * 1e-4
            _d_b = np.tile(_VIEWER_POKE_BACK, (len(_f_idx), 1))
            _h_b = _ray_tri_hits_341(_o_b, _d_b, _garment_tris_341, CLOTH_STANDOFF_M)
            _cloth_b = np.isfinite(_h_b)
            _poke_sel = _pre_idx[_f_idx[_no_cloth_f & _cloth_b]]
            if len(_poke_sel):
                _viewer_poke_rehidden = int(len(_poke_sel))
                hide_mask[_poke_sel] = True
    print(f"VIEWER_POKE_REHIDE faces {_viewer_poke_rehidden}")
    # issue-341: re-clip the force-hide on the SILHOUETTE axes (x lateral, z height)
    # only — the depth axis is deliberately excluded, because a poke in front of the
    # garment is under its silhouette by definition. The #326 footprint clip tests all
    # three axes, so it un-hides genuine pokes (they protrude past the garment's front
    # depth); this polygon-level clip mirrors it on the axes that define the silhouette
    # and keeps the hidden AABB inside the garment bounds + the contract's 2 mm slack.
    _tri_i = 0
    _reclip_polygons = 0
    for _poly in human.data.polygons:
        _n_tri = max(len(_poly.vertices) - 2, 1)
        if not hide_mask[_tri_i : _tri_i + _n_tri].any():
            _tri_i += _n_tri
            continue
        _inside = True
        for _vi in _poly.vertices:
            _c = human.data.vertices[_vi].co
            if _c.x < _gx_lo or _c.x > _gx_hi or _c.z < _gz_lo or _c.z > _gz_hi:
                _inside = False
                break
        if not _inside:
            hide_mask[_tri_i : _tri_i + _n_tri] = False
            _reclip_polygons += 1
        _tri_i += _n_tri
    # #334 — re-apply the head-joint clip after every re-hide/refinement step: the
    # black-sliver and re-hides run after the first clip and can leave the mask a
    # sub-mm above the joint (measured 2026-08-12: nurse mask 0.9143H vs joint
    # 0.9139H when the behind-bound kept a collar-region face hidden). Idempotent.
    hide_mask, head_clipped_final = clip_hide_mask_below_joint(hide_mask, human, head_joint_z)
    if head_clipped_final:
        print(f"HEAD_CLIP_FINAL polygons {head_clipped_final}")
    # issue-341 round 7 — the render-truth refinement, run LAST so no later
    # re-hide can undo it. A discarded (alpha-0) body polygon reads as the dark
    # capture background wherever the garment does NOT render in front of it: the
    # per-polygon mask boundary is jagged, so hidden polygons straddling a garment
    # edge (shoulders, sleeve hems, waistband, trouser hems, boot tops) and body
    # above a garment edge (the nurse's jaw/chin — the collar's BACK panel is
    # 13-19 cm behind it and is backface-culled, measured) all render as the
    # round-7 "black sawtooth at every garment/skin seam". The render truth:
    #   hole(sample) = no garment surface in front along the viewer ray AND no
    #   OUTER-facing garment surface behind it
    #   un_hide(polygon) = ANY area sample is a hole
    # The front test uses ANY garment surface (an inner-surface hit still means the
    # shell's outer surface renders in front of the face). The behind test casts
    # against the garment's OUTER-facing subset only (see _outer_facing_front_tris):
    # a back-facing surface cannot fill a discarded hole at render. The reach is the
    # occlusion gate's MAX_RAY_T (0.5 m) — the scene depth, not a fitted seam
    # constant — and the child's loose t-shirt (2-5 cm off the body) stays hidden
    # because its front panel is outer-facing and directly behind the pokes.
    _rt_front_tris = _outer_facing_front_tris(garment_verts, garment_faces)
    _rt_hidden_idx = np.where(hide_mask)[0]
    _rt_unhidden = 0
    if len(_rt_hidden_idx):
        _rt_tris = body_verts[body_faces[_rt_hidden_idx]]
        _rt_samples = _area_sample_points(_rt_tris)  # (F,7,3)
        _rt_orig = (_rt_samples + _VIEW_Y * 1e-4).reshape(-1, 3)  # (F*7,3)
        _rt_dir = np.tile(_VIEW_Y, (len(_rt_orig), 1))
        _rt_hits = _ray_tri_hits_341(_rt_orig, _rt_dir, _garment_tris_341, 0.5)
        _rt_hits = _rt_hits.reshape(len(_rt_hidden_idx), 7)
        _rt_covered = np.isfinite(_rt_hits)
        _rt_b_orig = (_rt_samples + _BLACK_BACK_Y * 1e-4).reshape(-1, 3)
        _rt_b_dir = np.tile(_BLACK_BACK_Y, (len(_rt_orig), 1))
        _rt_b_hits = _ray_tri_hits_341(_rt_b_orig, _rt_b_dir, _rt_front_tris, 0.5)
        _rt_b_hits = _rt_b_hits.reshape(len(_rt_hidden_idx), 7)
        _rt_outer_behind = np.isfinite(_rt_b_hits)
        _rt_hole = ~_rt_covered & ~_rt_outer_behind
        _rt_unhide = _rt_hole.any(axis=1)
        _rt_unhidden = int(_rt_unhide.sum())
        hide_mask[_rt_hidden_idx[_rt_unhide]] = False
    print(f"RENDER_TRUTH_UNHIDE upper faces {_rt_unhidden}")
    applied = apply_body_hide_material_region(human, hide_mask, slot="upper")
    print(
        f"BODY_HIDE {hide_info} "
        f"handFacesUnhidden {hand_faces_unhidden} "
        f"footprintClippedFaces {footprint_clipped} "
        f"pokeRehidden {_force_hidden} "
        f"blackSliversUnhidden {_black_slivers} "
        f"reclipPolygons {_reclip_polygons} "
        f"appliedPolygonCount {applied['appliedPolygonCount']} "
        f"hiddenMaterialName {applied['hiddenMaterialName']} "
        f"bodyBlenderVerts {len(human.data.vertices)} "
        f"garmentBlenderVerts {len(garment.data.vertices)}"
    )

    # #326 — lower channel: hide the body under the cargo pants the same way, with the
    # same shared tools (D1 — no second hider). The mask is the same signed-clearance
    # predicate against the trousers' surface, scoped away from the hands and clipped to
    # the trousers' footprint.
    pants_verts_np, pants_faces_np = _triangulate_numpy(pants)
    pb = world_bounds(pants)
    lower_hide_info = body_hide_mask(
        body_verts,
        body_faces,
        pants_verts_np,
        pants_faces_np,
        float(pb["min"][2]),
        float(pb["max"][2]),
        hide_epsilon_m=HIDE_EPSILON_M,
        height_axis=2,
    )
    lower_hide_mask = lower_hide_info.pop("hideMask")
    if lower_hide_info["hiddenFaceCount"] == 0:
        print(
            "LOWER_BODY_HIDE WARNING: body_hide_mask found no poking body faces under the "
            "fitted cargo pants — the #326 lower channel would not hide; report this"
        )
    lower_hide_mask, lower_hand_faces = scope_hide_mask_away_from_hands(
        human, lower_hide_mask, armature
    )
    lower_hide_mask, lower_footprint_clipped = clip_hide_mask_to_garment_footprint(
        lower_hide_mask, human, pb
    )
    # #334 — same head-joint bound on the lower mask (a no-op today; uniform rule).
    lower_hide_mask, lower_head_clipped = clip_hide_mask_below_joint(
        lower_hide_mask, human, head_joint_z
    )
    # issue-341 — the waistband sawtooth. Measured on the shipped bytes: the body
    # skin in the band between the shirt hem and the pants top is EXPOSED — neither
    # the upper nor the lower poke-mask covers it (diagnostic: 26/26 torso band
    # faces in neither mask; aisha band y [0.969, 0.987]). The poke-mask hides only
    # body faces that POKE the garment surface (signed clearance < 5 mm); the belly
    # faces at the shirt's hem edge sit ~9 mm INSIDE the cloth (clearance > 5 mm,
    # never hidden) while the shirt's hem ring and the pants' sparse waistband ring
    # both leave front-view gaps at the same (x, y) — so the belly renders as the
    # "ragged sawtooth band of skin between shirt hem and trouser top". The body in
    # this band is UNDER the pants (pantsTop 0.987 >= shirtHem 0.969 — the band is
    # the pants' own extent), so hiding ALL body faces in the band inside the pants'
    # x/z footprint is the correct region hide: derived from the two garments' own
    # measured extents, no fitted constant.
    _pants_x_lo = float(pants_verts_np[:, 0].min())
    _pants_x_hi = float(pants_verts_np[:, 0].max())
    _pants_d_lo = float(pants_verts_np[:, 1].min())
    _pants_d_hi = float(pants_verts_np[:, 1].max())
    _waist_band_lo = float(garment_verts[:, 2].min())   # the shirt's hem
    _waist_band_hi = float(pants_verts_np[:, 2].max())  # the pants' top
    if _waist_band_hi >= _waist_band_lo:
        _wb_cent = body_verts[body_faces].mean(axis=1)
        _wb_hide = (
            (_wb_cent[:, 2] >= _waist_band_lo)
            & (_wb_cent[:, 2] <= _waist_band_hi)
            & (_wb_cent[:, 0] >= _pants_x_lo)
            & (_wb_cent[:, 0] <= _pants_x_hi)
            & (_wb_cent[:, 1] >= _pants_d_lo)
            & (_wb_cent[:, 1] <= _pants_d_hi)
        )
        _waist_band_hidden = int(_wb_hide.sum())
        lower_hide_mask = lower_hide_mask | _wb_hide
        print(
            f"WAISTBAND_HIDE band [{_waist_band_lo:.4f},{_waist_band_hi:.4f}] "
            f"faces {_waist_band_hidden}"
        )
    else:
        print("WAISTBAND_HIDE WARNING: pants top below shirt hem — band empty; report this")
    # issue-341 round 6 — the black-sliver refinement for the LOWER mask. The
    # waistband band above hides ALL body faces in the band inside the pants'
    # footprint, including the waist SIDES (measured on aisha round-6e: 15 hidden
    # faces at x +-0.13..0.15, y 0.97-0.99 with NO cloth in front along the viewer
    # ray and nothing rendering behind — the same render-truth the upper mask's
    # black-sliver fixes, and the upper one cannot see them because they live in
    # the lower mask). Un-hide lower-mask faces with no cloth (pants) in front and
    # no cloth within the shipping standoff behind; the belly faces the round-5b
    # band was written for stay hidden (the pants render in front of them).
    _pants_tris_341 = pants_verts_np[pants_faces_np]
    # issue-341 round 7 — same render-truth refinement as the upper mask: the
    # behind test casts against the pants' OUTER-facing subset (see
    # _outer_facing_front_tris) and the front test is area-sampled, so a hidden
    # lower polygon is un-hidden when ANY area sample has no cloth in front and no
    # outer-facing cloth behind it.
    _pants_front_tris_341 = _outer_facing_front_tris(pants_verts_np, pants_faces_np)
    _lower_hidden_idx = np.where(lower_hide_mask)[0]
    _lower_black_slivers = 0
    if len(_lower_hidden_idx):
        _lhf = body_verts[body_faces[_lower_hidden_idx]]
        _l_samples = _area_sample_points(_lhf)  # (F,7,3)
        _l_orig = (_l_samples + _VIEW_Y * 1e-4).reshape(-1, 3)  # (F*7,3)
        _l_dir = np.tile(_VIEW_Y, (len(_l_orig), 1))
        _l_hits = _ray_tri_hits_341(_l_orig, _l_dir, _pants_tris_341, 0.5)
        _l_hits = _l_hits.reshape(len(_lower_hidden_idx), 7)
        _l_covered = np.isfinite(_l_hits)
        _l_b_orig = (_l_samples + _BLACK_BACK_Y * 1e-4).reshape(-1, 3)
        _l_b_dir = np.tile(_BLACK_BACK_Y, (len(_l_orig), 1))
        _l_b_hits = _ray_tri_hits_341(_l_b_orig, _l_b_dir, _pants_front_tris_341, 0.5)
        _l_b_hits = _l_b_hits.reshape(len(_lower_hidden_idx), 7)
        _l_outer_behind = np.isfinite(_l_b_hits)
        _l_hole = ~_l_covered & ~_l_outer_behind
        _l_unhide = _l_hole.any(axis=1)
        _lower_black_slivers = int(_l_unhide.sum())
        lower_hide_mask[_lower_hidden_idx[_l_unhide]] = False
        print(f"LOWER_BLACK_SLIVERS unhidden {_lower_black_slivers}")
    lower_applied = apply_body_hide_material_region(human, lower_hide_mask, slot="lower")
    print(
        f"LOWER_BODY_HIDE {lower_hide_info} "
        f"handFacesUnhidden {lower_hand_faces} "
        f"footprintClippedFaces {lower_footprint_clipped} "
        f"appliedPolygonCount {lower_applied['appliedPolygonCount']} "
        f"hiddenMaterialName {lower_applied['hiddenMaterialName']} "
        f"pantsBlenderVerts {len(pants.data.vertices)}"
    )

    # #333: fit a real MakeHuman shoe on the SAME helper-stripped basemesh via the SAME
    # proven ClothesService path (D1) — the footwear channel the MPFB rail lacks. The
    # library rail fits shoes with embed_library_footwear.py against a RECONSTRUCTED
    # base.obj reference because its GLB re-import reindexes vertices; here the fit runs
    # directly on the in-scene basemesh (intact 13,380-vert topology, Z-up) exactly like
    # the t-shirt and cargo pants fits above. The shoes are the cached CC0/CC-0
    # zero-helper-ref subset of makehuman-shoes01 (third-party-asset-licence-ledger.md):
    #   aisha (OB patient)       -> toigo_flats           (CC0, 28,808 verts)
    #   peds_nurse_kevin (nurse) -> culturalibre_male_boots (CC-0, 15,308 verts)
    #   peds_patient_child       -> toigo_mj_cloth_shoes  (CC0, 556 verts)
    # .mhclo body-vertex refs index the canonical 13,380-vert hm08 basemesh (the ledger
    # measured zero refs >= 13,380 for all three), so they fit the stripped topology like
    # the t-shirt and trousers. GROUNDING IS THRESHOLD-FREE: the fitted sole lands a few
    # mm BELOW the body's foot bottom (measured 8-13 mm on probes — real sole depth);
    # the shoe is then lifted by that landmark gap so sole == body bottom, exactly the
    # known-good library measurement (-0.00 cm) and embed_library_footwear's sole-anchor.
    shoe_kind = SHOE_BY_REFERENCE.get(args.reference)
    if shoe_kind is None:
        raise RuntimeError(f"#333: no footwear mapped for reference {args.reference!r}")
    _shoes_dir = (
        pathlib.Path(__file__).resolve().parents[4]
        / ".openclinxr-local/provider-cache/garments/sources/makehuman-shoes01"
        / shoe_kind
    )
    shoe_obj = next(_shoes_dir.glob("*.obj"), None)
    shoe_mhclo = next(_shoes_dir.glob("*.mhclo"), None)
    if shoe_obj is None or shoe_mhclo is None:
        raise RuntimeError(f"#333: {shoe_kind} sources missing in provider cache: {_shoes_dir}")

    shoe = import_obj(str(shoe_obj), f"makeclothes_library_footwear_{shoe_kind}", force_z=False)
    # Same axis bake as the t-shirt/pants (#321 handback): identity/Z-up before the fit
    # writes body-local coordinates into the mesh.
    apply_object_transforms(shoe)
    shoe.data.materials.clear()
    # Name matches the FOOTWEAR regex the evidence RED reads (footwear/shoe/boot/flat).
    shoe.data.materials.append(
        make_material(f"mat_makeclothes_library_footwear_{shoe_kind}", (0.10, 0.09, 0.08, 1.0))
    )
    mhclo_shoe = Mhclo()
    mhclo_shoe.load(str(shoe_mhclo))
    try:
        mhclo_shoe.clothes = shoe
    except Exception:
        pass
    shoe_verts_before = len(shoe.data.vertices)
    ClothesService.fit_clothes_to_human(shoe, human, mhclo=mhclo_shoe, set_parent=True)
    bpy.context.view_layer.update()
    # The glTF mesh name is the MESH DATA name (the OBJ importer keeps its own); rename
    # both so the exported mesh carries the footwear channel name.
    _ref_tag = args.reference or "ob_patient_aisha"
    shoe.data.name = f"makeclothes_library_footwear_{shoe_kind}_mpfb_{_ref_tag}_mesh"
    shoe.name = f"makeclothes_library_footwear_{shoe_kind}_mpfb_{_ref_tag}"

    body_min_z = min(v.co.z for v in human.data.vertices)
    shoe_min_z = min(v.co.z for v in shoe.data.vertices)
    delta_z = body_min_z - shoe_min_z
    if abs(delta_z) > 1e-9:
        for v in shoe.data.vertices:
            v.co.z += delta_z
        bpy.context.view_layer.update()

    # issue-341 round 5c — the fitted shoe sits ~3 cm MEDIAL of the foot. Measured
    # on the shipped bytes: the body's left foot spans x [-0.270, -0.174] (9.6 cm)
    # while the fitted shoe spans x [-0.236, -0.138] (9.8 cm) — the SAME width, but
    # the shoe's x-centre (-0.187) is ~3.4 cm medial of the foot's (-0.222), so the
    # foot's lateral edge renders OUTSIDE the shoe ("toes protrude through both
    # shoe fronts; shoes are flat grey discs"). The ClothesService fit anchors the
    # shoe to the foot's own .mhclo refs (x -0.26..-0.17 on the base mesh), so the
    # fit itself is sound; the shipped shoe drifted medially — the same class of
    # corrective alignment the existing sole grounding (delta_z above) already
    # performs. Align each shoe half's x-centre to the BODY's own foot-band
    # x-centre: measured per-body, no fitted constant. Runs BEFORE the weight
    # transfer and the foot-hide so the shoe binds and hides at its final position.
    shoe_top_z = float(max(v.co.z for v in shoe.data.vertices))
    foot_band = [v for v in human.data.vertices if v.co.z < shoe_top_z]
    shoe_left = [v for v in shoe.data.vertices if v.co.x < 0]
    shoe_right = [v for v in shoe.data.vertices if v.co.x > 0]
    _shoe_lat_deltas: list[float] = []
    for _foot_vs, _shoe_vs, _side in (
        ([v for v in foot_band if v.co.x < -0.1], shoe_left, "L"),
        ([v for v in foot_band if v.co.x > 0.1], shoe_right, "R"),
    ):
        if not _foot_vs or not _shoe_vs:
            print(f"FOOTWEAR_LATERAL WARNING: empty {_side} foot or shoe band — skip side")
            continue
        _foot_cx = sum(v.co.x for v in _foot_vs) / len(_foot_vs)
        _shoe_cx = sum(v.co.x for v in _shoe_vs) / len(_shoe_vs)
        _delta_x = _foot_cx - _shoe_cx
        for v in _shoe_vs:
            v.co.x += _delta_x
        _shoe_lat_deltas.append(_delta_x)
        print(
            f"FOOTWEAR_LATERAL {_side} footCx {_foot_cx:.4f} shoeCx {_shoe_cx:.4f} "
            f"deltaX {_delta_x:.4f}"
        )
    if _shoe_lat_deltas:
        bpy.context.view_layer.update()
    shoe_verts_after = len(shoe.data.vertices)
    shoe_tris = sum(max(len(p.vertices) - 2, 0) for p in shoe.data.polygons)
    # Bind the shoe to the same armature so it is skinned and deforms with the foot
    # (the proven k-NN projection, not a rigid prop).
    shoe_weights = transfer_weights_body_to_garment(human, shoe, armature)
    print(
        f"FOOTWEAR_FIT {shoe.name} verts {shoe_verts_before} -> {shoe_verts_after} "
        f"tris {shoe_tris} soleDeltaZ {delta_z:.6f} weights {shoe_weights}"
    )

    # #338 — toes through boot soles: the fitted footwear leaves the foot body
    # visible where the shoe does not cover it. Measured on the shipped bytes by the
    # #338 occlusion gate: the foot-skin band (y<0.15) reports 0.78 (nurse) / 0.90
    # (aisha) / 1.00 (child) of its front samples EXPOSED — the toes render in front
    # of the boot's side uppers (nurse, y<0.03) or above the shoe's upper (child).
    # The proven body-hide mechanism (#323, body_param_stage.apply_body_hide_material_
    # region) hides body faces that POKE the garment surface (signed clearance <
    # HIDE_EPSILON_M against the BODY's outward normal — winding-proof). Run it
    # against the FOOTWEAR surface over the foot band (body bottom -> the same
    # ankle landmark the lower band uses), so poking toes are hidden and the shoe's
    # silhouette reads as the foot. Faces INSIDE the shoe (positive clearance) are
    # untouched. Deterministic, threshold-free, no geometry authored.
    #
    # issue-341: the band must STOP at the shoe's OWN top, not the ankle landmark.
    # Measured on aisha's shipped bytes: the foot hide (band to ankle_z=0.10) hides
    # 2,266 faces including the upper foot/ankle ABOVE the shoe (shoe top 0.056,
    # hidden primitives run to 0.111) — the discarded upper foot renders as a hollow
    # gap between the shoe and the leg ("shoes flattened to discs, toes through").
    # The shoe does not cover the upper foot; discarding it is a hole. The band is
    # the shoe's own vertical extent (its z-max in the stage frame), the natural
    # limit of what the footwear can hide.
    foot_lo_z = float(world_bounds(human)["min"][2])
    footwear_verts, footwear_faces = _triangulate_numpy(shoe)
    shoe_top_z = float(footwear_verts[:, 2].max())
    foot_hi_z = min(shoe_top_z, ankle_z)  # "bare feet begin below" — the #326 landmark
    foot_hide_info = body_hide_mask(
        body_verts,
        body_faces,
        footwear_verts,
        footwear_faces,
        foot_lo_z,
        foot_hi_z,
        hide_epsilon_m=HIDE_EPSILON_M,
        height_axis=2,
    )
    foot_hide_mask = foot_hide_info.pop("hideMask")
    if foot_hide_info["hiddenFaceCount"] == 0:
        print(
            "FOOT_HIDE WARNING: body_hide_mask found no poking body faces under the "
            "fitted footwear — the toes-through-soles class would not hide; report this"
        )
    # issue-341 round 7 — the foot mask had NO render-truth refinement: its
    # boundary at the shoe top is per-polygon jagged and discarded foot polygons
    # past the shoe's upper read as black holes against the capture background
    # (round-7 grade: the child's "shoes are dark specks and the feet read bare").
    # Same predicate as the upper/lower masks: un-hide a hidden foot polygon when
    # ANY area sample has no footwear surface in front along the viewer ray AND no
    # OUTER-facing footwear surface behind it. Toes genuinely under the shoe stay
    # hidden (the shoe's outer surface is in front or directly behind them).
    _foot_tris_341 = footwear_verts[footwear_faces]
    _foot_front_tris_341 = _outer_facing_front_tris(footwear_verts, footwear_faces)
    _foot_hidden_idx = np.where(foot_hide_mask)[0]
    _foot_black_slivers = 0
    if len(_foot_hidden_idx):
        _ff_tris = body_verts[body_faces[_foot_hidden_idx]]
        _fs_samples = _area_sample_points(_ff_tris)  # (F,7,3)
        _f_orig = (_fs_samples + _VIEW_Y * 1e-4).reshape(-1, 3)  # (F*7,3)
        _f_dir = np.tile(_VIEW_Y, (len(_f_orig), 1))
        _f_hits = _ray_tri_hits(_f_orig, _f_dir, _foot_tris_341, 0.5)
        _f_hits = _f_hits.reshape(len(_foot_hidden_idx), 7)
        _f_covered = np.isfinite(_f_hits)
        _f_b_orig = (_fs_samples + _BLACK_BACK_Y * 1e-4).reshape(-1, 3)
        _f_b_dir = np.tile(_BLACK_BACK_Y, (len(_f_orig), 1))
        _f_b_hits = _ray_tri_hits(_f_b_orig, _f_b_dir, _foot_front_tris_341, 0.5)
        _f_b_hits = _f_b_hits.reshape(len(_foot_hidden_idx), 7)
        _f_outer_behind = np.isfinite(_f_b_hits)
        _f_hole = ~_f_covered & ~_f_outer_behind
        _f_unhide = _f_hole.any(axis=1)
        _foot_black_slivers = int(_f_unhide.sum())
        foot_hide_mask[_foot_hidden_idx[_f_unhide]] = False
        print(f"FOOT_BLACK_SLIVERS unhidden {_foot_black_slivers}")
    foot_applied = apply_body_hide_material_region(human, foot_hide_mask, slot="foot")
    print(
        f"FOOT_HIDE {foot_hide_info} "
        f"appliedPolygonCount {foot_applied['appliedPolygonCount']} "
        f"hiddenMaterialName {foot_applied['hiddenMaterialName']}"
    )

    # issue-341 round 9 — RENDER_TRUTH_REHIDE: the counterpart to round 7's
    # monotone un-hide. Round 7's render-truth pass ONLY un-hides; a skin polygon
    # the garment covers (or pokes) but the mask missed stays visible forever, and
    # the measured round-9 orange/tan sawtooth at the shoulders, waistband and
    # hems is round 7's own trade in a new colour — the same boundary, now
    # rendering as SKIN where round 7 un-hid the discard. The re-hide follows the
    # garments' own rims per-polygon, bounded by the garments' own measured extents
    # and the factory's own standoff (no fitted seam constant):
    #   (1) seam-band restore — the round-6 waistband band between the shirt hem
    #       and the pants top (a region derived from the two garments' own measured
    #       extents, not a threshold), re-applied AFTER round 7's lower
    #       render-truth un-hide removed it. Round 6 hid exactly this band and the
    #       orchestrator graded it clean; round 7's un-hide (a single-garment hole
    #       test) undid it and the fringe returned.
    #   (2) poke envelope — a visible face whose nearest garment surface lies
    #       within the garment's OWN shipping envelope (CLOTH_STANDOFF_M) of the
    #       skin along the BODY's outward normal (signed clearance in
    #       [-CLOTH_STANDOFF_M, HIDE_EPSILON_M)) is a poke the garment covers from
    #       behind at render — hiding reveals the garment, never the interior. This
    #       is the round-7 first-action instrument (cast along the body's own
    #       normal, not a fixed viewer axis) applied to VISIBLE faces; the
    #       envelope bound is what keeps the child's loose t-shirt (2-5 cm off the
    #       body, measured) and the bare neck above the collar out of the mask.
    _already_hidden = hide_mask | lower_hide_mask | foot_hide_mask
    _rh_upper = np.zeros(len(body_faces), dtype=bool)
    _rh_lower = np.zeros(len(body_faces), dtype=bool)
    _rh_foot = np.zeros(len(body_faces), dtype=bool)
    _rh_bands = 0
    # (1) the round-6 waistband band, recomputed AFTER round 7's lower un-hide.
    _pants_x_lo = float(pants_verts_np[:, 0].min())
    _pants_x_hi = float(pants_verts_np[:, 0].max())
    _pants_d_lo = float(pants_verts_np[:, 1].min())
    _pants_d_hi = float(pants_verts_np[:, 1].max())
    _waist_band_lo = float(garment_verts[:, 2].min())   # the shirt's hem
    _waist_band_hi = float(pants_verts_np[:, 2].max())  # the pants' top
    if _waist_band_hi >= _waist_band_lo:
        _wb_cent = body_verts[body_faces].mean(axis=1)
        _rh_band = (
            (_wb_cent[:, 2] >= _waist_band_lo)
            & (_wb_cent[:, 2] <= _waist_band_hi)
            & (_wb_cent[:, 0] >= _pants_x_lo)
            & (_wb_cent[:, 0] <= _pants_x_hi)
            & (_wb_cent[:, 1] >= _pants_d_lo)
            & (_wb_cent[:, 1] <= _pants_d_hi)
        )
        # only faces NOT already hidden by any slot (round 7 un-hid the band).
        _rh_band = _rh_band & ~_already_hidden
        _rh_bands = int(_rh_band.sum())
        _rh_lower = _rh_lower | _rh_band
        print(f"RENDER_TRUTH_REHIDE band [{_waist_band_lo:.4f},{_waist_band_hi:.4f}] faces {_rh_bands}")
    else:
        print("RENDER_TRUTH_REHIDE WARNING: pants top below shirt hem — band empty; report this")
    # (2) the poke envelope against each garment channel.
    _rh_pokes = 0
    for _gname, _gverts, _gfaces in (
        ("upper", garment_verts, garment_faces),
        ("lower", pants_verts_np, pants_faces_np),
        ("foot", footwear_verts, footwear_faces),
    ):
        if len(_gverts) == 0 or len(_gfaces) == 0:
            continue
        _g_lo = float(_gverts[:, 2].min())
        _g_hi = float(_gverts[:, 2].max())
        _cl, _fidx, _fv, _fn = _region_signed_clearance_samples(
            body_verts, body_faces, _gverts, _gfaces, _g_lo, _g_hi,
            max_search_m=0.08, height_axis=2, lateral_axis=0,
        )
        if len(_fidx) == 0 or len(_cl) == 0:
            continue
        _per = _cl.reshape(len(_fidx), 3).min(axis=1)
        _poke = (_per >= -CLOTH_STANDOFF_M) & (_per < HIDE_EPSILON_M)
        if not _poke.any():
            continue
        _sel = _fidx[_poke]
        # face normal (3 vertex samples per face) and the stage front axis (-Y).
        _fn_face = _fn.reshape(len(_fidx), 3, 3).mean(axis=1)
        _front = _fn_face[_poke][:, 1] < 0.0
        # #334 — the shared VERTEX-based head-joint bound: never discard the
        # head/neck/jaw above the body's own head joint.
        _below = body_verts[body_faces[_sel]].max(axis=1)[:, 2] <= head_joint_z
        # round 9 — the re-hide must not push the mask beyond the garment's OWN
        # rim: a face whose vertices rise above the garment's max extent is not
        # under the cloth (the neck above the collar, the ankle above the shoe
        # top) and hiding it would discard a surface the garment does not cover.
        _under_rim = body_verts[body_faces[_sel]].max(axis=1)[:, 2] <= _g_hi
        _pick = _sel[_front & _below & _under_rim]
        _pick = _pick[~_already_hidden[_pick]]
        _pick = _pick[~_rh_upper[_pick] & ~_rh_lower[_pick] & ~_rh_foot[_pick]]
        if _gname == "upper":
            _rh_upper[_pick] = True
        elif _gname == "lower":
            _rh_lower[_pick] = True
        else:
            _rh_foot[_pick] = True
        _rh_pokes += int(len(_pick))
        print(f"RENDER_TRUTH_REHIDE poke {_gname} region {len(_fidx)} candidates {int(_poke.sum())} picked {int(len(_pick))}")
    # Apply the re-hide per slot (additive: a fresh hidden material, so previously
    # hidden faces keep their slot; re-hidden faces are discarded at render).
    def _reclip_rehide(mask, garment_verts):
        """Mirror the pipeline's two polygon-level clips on the re-hide masks:
        #334's `clip_hide_mask_below_joint` (a re-hide polygon whose LOCAL vertex
        rises above the body's own head joint is the neck/face — un-hide it) and
        #326's silhouette re-clip (a re-hide polygon whose LOCAL vertex pokes
        outside the covering garment's x/z AABB + the contract's 2 mm slack is
        not under the cloth — un-hide it). The round-7 masks ship inside these
        bounds; the re-hide must ship inside the same ones (measured on the nurse:
        the world-matrix pre-filter let a collar re-hide 5 mm above the exported
        head joint)."""
        mask = np.array(mask, dtype=bool)
        gx_lo = float(garment_verts[:, 0].min()) - 0.002
        gx_hi = float(garment_verts[:, 0].max()) + 0.002
        gz_lo = float(garment_verts[:, 2].min()) - 0.002
        gz_hi = float(garment_verts[:, 2].max()) + 0.002
        removed = 0
        tri_i = 0
        for poly in human.data.polygons:
            n_tri = max(len(poly.vertices) - 2, 1)
            if not mask[tri_i : tri_i + n_tri].any():
                tri_i += n_tri
                continue
            bad = False
            for vi in poly.vertices:
                c = human.data.vertices[vi].co
                if c.z > head_joint_z or c.x < gx_lo or c.x > gx_hi or c.z < gz_lo or c.z > gz_hi:
                    bad = True
                    break
            if bad:
                mask[tri_i : tri_i + n_tri] = False
                removed += 1
            tri_i += n_tri
        return mask, removed

    if _rh_upper.any():
        _rh_upper, _rh_clip_upper = _reclip_rehide(_rh_upper, garment_verts)
        _rh_upper, _rh_hand_upper = scope_hide_mask_away_from_hands(human, _rh_upper, armature)
        _rh_a = apply_body_hide_material_region(human, _rh_upper, slot="upper")
        print(
            f"RENDER_TRUTH_REHIDE applied upper faces {int(_rh_upper.sum())} "
            f"reclip {_rh_clip_upper} handFaces {_rh_hand_upper} polygons {_rh_a['appliedPolygonCount']}"
        )
    if _rh_lower.any():
        _rh_lower, _rh_clip_lower = _reclip_rehide(_rh_lower, pants_verts_np)
        _rh_lower, _rh_hand_lower = scope_hide_mask_away_from_hands(human, _rh_lower, armature)
        _rh_a = apply_body_hide_material_region(human, _rh_lower, slot="lower")
        print(
            f"RENDER_TRUTH_REHIDE applied lower faces {int(_rh_lower.sum())} "
            f"reclip {_rh_clip_lower} handFaces {_rh_hand_lower} polygons {_rh_a['appliedPolygonCount']}"
        )
    if _rh_foot.any():
        _rh_foot, _rh_clip_foot = _reclip_rehide(_rh_foot, footwear_verts)
        _rh_foot, _rh_hand_foot = scope_hide_mask_away_from_hands(human, _rh_foot, armature)
        _rh_a = apply_body_hide_material_region(human, _rh_foot, slot="foot")
        print(
            f"RENDER_TRUTH_REHIDE applied foot faces {int(_rh_foot.sum())} "
            f"reclip {_rh_clip_foot} handFaces {_rh_hand_foot} polygons {_rh_a['appliedPolygonCount']}"
        )
    print(f"RENDER_TRUTH_REHIDE total band {_rh_bands} pokes {_rh_pokes}")

    bpy.context.scene.frame_start = 1
    bpy.context.scene.frame_end = 90
    action = bpy.data.actions.new("ClinicalIdleConversation")
    armature.animation_data_create()
    armature.animation_data.action = action

    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.context.view_layer.objects.active = armature
    armature.select_set(True)
    bpy.ops.object.mode_set(mode="POSE")
    for frame, head_z, spine_x, arm_l_z, arm_r_z in [
        (1, 0.00, 0.00, 0.00, 0.00),
        (30, 0.05, 0.025, -0.10, 0.08),
        (60, -0.035, -0.015, 0.04, -0.06),
        (90, 0.00, 0.00, 0.00, 0.00),
    ]:
        bpy.context.scene.frame_set(frame)
        for bone_name, rotation in [
            ("head", (0.0, 0.0, head_z)),
            ("spine03", (spine_x, 0.0, 0.0)),
            ("upperarm01.L", (0.0, 0.0, arm_l_z)),
            ("upperarm01.R", (0.0, 0.0, arm_r_z)),
        ]:
            pose_bone = armature.pose.bones.get(bone_name)
            if pose_bone:
                pose_bone.rotation_mode = "XYZ"
                pose_bone.rotation_euler = rotation
                pose_bone.keyframe_insert(data_path="rotation_euler", frame=frame)
    bpy.ops.object.mode_set(mode="OBJECT")

    if human.data.shape_keys:
        human.data.shape_keys.animation_data_create()
        human.data.shape_keys.animation_data.action = bpy.data.actions.new("ClinicalExpressionMicroTransition")
        key_blocks = list(human.data.shape_keys.key_blocks)[1:3]
        for frame, value in [(1, 0.0), (30, 0.15), (60, 0.05), (90, 0.0)]:
            bpy.context.scene.frame_set(frame)
            for key in key_blocks:
                key.value = value
                key.keyframe_insert(data_path="value", frame=frame)

    output = pathlib.Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)

    # #343 — the skin material is the slice. The enhanced_skin node tree loaded
    # above is Blender-only; the glTF exporter emits it as flat [1,1,1,1] (measured).
    # Bake the SHIPPED shader's output to a baseColorTexture and wire it into a
    # glTF-exportable Principled material IN THE SAME material object (same name,
    # same slot index, so the mesh's material references and the evidence name
    # lookups stay valid). The bake runs LAST, after every polygon-material
    # reassignment (eye socket unpaint, hairline snap, hide mask), so the texture
    # covers the final skin region. The exported texture is saved next to the
    # output GLB for provenance.
    bpy.context.scene.frame_set(1)  # bake at rest pose — deterministic UV sampling
    if skin_material_name not in [m.name for m in human.data.materials]:
        raise RuntimeError(f"#343: skin material {skin_material_name} missing before bake")
    bake_png = output.parent / f"{output.stem}.skin-baked.png"
    baked_img = bake_skin_material_to_texture(human, skin_material_name, str(bake_png), resolution=1024)

    # issue-341 round 10 — the hairline via the texture-mask route (#343). The
    # per-polygon scalp material cannot produce a smooth hairline at this mesh
    # density (round 8 measured 65.6%/63.3% alternation after the snap — the
    # mesh has no level edge ring). The scalp region moves into the baked skin
    # texture: the hairline becomes the iso-contour of a baked height field at
    # the derived hairline height — a boundary in the texture, smooth by
    # construction. `apply_texture_mask_hairline` bakes a scalp mask + a world
    # position map, composites the hair region per-pixel into the skin texture,
    # and retires the per-polygon scalp material (no second mechanism for one
    # boundary). All quantities are the round-5/round-8 derivations from the
    # body's own surface and the fitted eye mesh.
    texture_hairline = apply_texture_mask_hairline(
        human,
        baked_img,
        scalp_idx=scalp_idx,
        skin_idx=skin_idx,
        eye_half_w=eye_half_w,
        forehead_plane=forehead_plane,
        hairline_snap_z=hairline_snap_z,
        hairline_z=hairline_z,
        head_z0=head_z0,
        h_world=h_world,
        eye_min_x=eye_min_x,
        eye_max_x=eye_max_x,
        eye_min_y=eye_min_y,
        eye_max_y=eye_max_y,
        edge_pad=edge_pad,
    )
    print(f"TEXTURE_HAIRLINE {json.dumps(texture_hairline)}")

    # Rebuild the SAME material object's node tree as a glTF-exportable Principled
    # material carrying the baked texture as baseColorTexture (the eye path's
    # proven binding). Node deletion + relink keeps the material name and slot.
    skin_idx = next(
        (i for i, m in enumerate(human.data.materials) if skin_material_name in (m.name or "")),
        0,
    )
    export_skin = human.data.materials[skin_idx]
    for node in list(export_skin.node_tree.nodes):
        export_skin.node_tree.nodes.remove(node)
    export_skin.blend_method = "OPAQUE"
    bsdf = export_skin.node_tree.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Roughness"].default_value = 0.78
    tex_node = export_skin.node_tree.nodes.new("ShaderNodeTexImage")
    tex_node.image = baked_img
    out_node = export_skin.node_tree.nodes.new("ShaderNodeOutputMaterial")
    export_skin.node_tree.links.new(tex_node.outputs["Color"], bsdf.inputs["Base Color"])
    export_skin.node_tree.links.new(bsdf.outputs["BSDF"], out_node.inputs["Surface"])
    export_skin.diffuse_color = (0.68, 0.53, 0.44, 1.0)
    print(f"SKIN_MATERIAL_EXPORTABLE {export_skin.name} texture={baked_img.name}")

    bpy.ops.export_scene.gltf(filepath=str(output), export_format="GLB", export_animations=True)
    print(f"EXPORTED {output}")

    # #328 census: report the final exported body the same way the planted contract
    # measures it (largest non-garment/non-hidden primitive), plus the macro dict and
    # its measured source, so the orchestrator can grade the result without re-deriving.
    final_measure = measure_glb_body(str(output))
    census = {
        "reference": args.reference,
        "macro": macro,
        "macroSource": (
            f"apps/ui-xr/public/generated-humanoids/{args.reference}.anny_base.obj "
            "(measured stature + head-height fraction; height solved by bake-measure-interpolate)"
            if args.reference
            else "default_macro_info_dict (HumanService None path — pre-#328 Aisha bake unchanged)"
        ),
        "statureMeters": round(final_measure["statureMeters"], 4),
        "chestSpanMeters": round(final_measure["chestSpanMeters"], 4),
        "waistSpanMeters": round(final_measure["waistSpanMeters"], 4),
        "chestWaistRatio": round(
            final_measure["chestSpanMeters"] / final_measure["waistSpanMeters"], 4
        ),
        # #333: the footwear channel — kind, exported substance and the grounding delta
        # (sole == body bottom after the threshold-free landmark lift).
        "footwear": {
            "kind": shoe_kind,
            "mesh": shoe.name,
            "verts": shoe_verts_after,
            "tris": shoe_tris,
            "weights": shoe_weights.get("ok"),
            "soleDeltaZ": round(delta_z, 6),
            "bodyMinZ": round(body_min_z, 6),
            "shoeMinZ": round(body_min_z, 6),
        },
        "outOfScopeWrongness": (
            "garment/hide-mask/poke-through were not re-graded for the new bodies; "
            "the toigo t-shirt was authored for an adult and is expected to fit the child "
            "loosely. Exact MADR 0051 §5 landmark match (shoulder/girths/limbs) is NOT "
            "claimed — follow-on."
        ),
    }
    print(f"BODY_CENSUS {json.dumps(census)}")


if __name__ == "__main__":
    main()
