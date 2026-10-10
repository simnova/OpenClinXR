"""Bake a tangent normal on one imported final GLB held in armature REST.

Texture-only. The source GLB is not rewritten. Positions recorded for the basis
are read from the depsgraph-evaluated mesh after pose_position is set to REST,
then matched back onto each glTF POSITION accessor in file order. Graph settings
come only from the authored bake config passed on the command line.
"""
import hashlib
import json
import math
import os
import struct
import sys
from pathlib import Path

import bpy

DERMAL_ENV_REFUSED = "ambient DERMAL_* environment is not a bake input"
# tara-20261009T185843Z body.001, REST, identity matrix, same 80268-loop order:
# source vs evaluated custom normals, local and world, max component 0.00029767,
# max angle 0.03426402 deg. The limits sit about 3x above that roundoff and
# about 30x below a 1 deg change. A substantial rotation must still refuse.
NORMAL_COMPONENT_TOLERANCE = 1e-3
NORMAL_ANGLE_TOLERANCE_DEG = 0.1
UV_COMPONENT_TOLERANCE = 1e-6


def _args():
    argv = sys.argv[sys.argv.index("--") + 1 :]
    out = {}
    i = 0
    while i < len(argv):
        key = argv[i]
        if not key.startswith("--"):
            raise RuntimeError(f"unexpected bake arg {key}")
        if i + 1 >= len(argv):
            raise RuntimeError(f"missing value for {key}")
        out[key[2:]] = argv[i + 1]
        i += 2
    for name in ("source", "out-dir", "job-root", "config"):
        if name not in out:
            raise RuntimeError(f"missing --{name}")
    return out


def _sha(data):
    return hashlib.sha256(data).hexdigest()


def _confine(job, *paths):
    job = Path(job).resolve()
    resolved = []
    for raw in paths:
        path = Path(raw).resolve()
        if not path.is_relative_to(job):
            raise RuntimeError(f"bake path outside job root: {path}")
        resolved.append(path)
    return job, resolved


def _refuse_ambient_dermal_env():
    present = sorted(key for key in os.environ if key.startswith("DERMAL_"))
    if present:
        raise RuntimeError(f"{DERMAL_ENV_REFUSED}: {present}")


def _load_config(path):
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    dermal = data.get("dermal") or {}
    cycles = data.get("cycles") or {}
    for key in ("cellTexels", "bumpStrength", "voronoiFeature", "voronoiRandomness", "rampValley", "rampPeak"):
        if key not in dermal:
            raise RuntimeError(f"bake config missing dermal.{key}")
    for key in ("device", "samples", "margin", "normalSpace"):
        if key not in cycles:
            raise RuntimeError(f"bake config missing cycles.{key}")
    resolution = data.get("resolution")
    if not isinstance(resolution, list) or len(resolution) != 2 or int(resolution[0]) != int(resolution[1]):
        raise RuntimeError("bake config resolution must be a square")
    if data.get("frequencyUnits") != "authored-texture-frequency":
        raise RuntimeError("bake config frequencyUnits must be authored-texture-frequency")
    if (data.get("tools") or {}).get("mpfbModule") != "bl_ext.user_default.mpfb":
        raise RuntimeError("bake config mpfb module is not bl_ext.user_default.mpfb")
    if cycles["normalSpace"] != "TANGENT":
        raise RuntimeError("bake config normalSpace must be TANGENT")
    return data


def _read_vec3_rows(blob, document, accessor_index):
    accessor = document["accessors"][accessor_index]
    if accessor["componentType"] != 5126 or accessor["type"] != "VEC3" or "sparse" in accessor:
        raise RuntimeError("unsupported POSITION layout")
    view = document["bufferViews"][accessor["bufferView"]]
    offset = view.get("byteOffset", 0) + accessor.get("byteOffset", 0)
    stride = view.get("byteStride", 12)
    return [
        struct.unpack_from("<fff", blob, offset + i * stride) for i in range(accessor["count"])
    ]


def _read_scalar_indices(blob, document, accessor_index):
    accessor = document["accessors"][accessor_index]
    if accessor["type"] != "SCALAR" or "sparse" in accessor:
        raise RuntimeError("unsupported index layout")
    fmt = {5121: "B", 5123: "H", 5125: "I"}.get(accessor["componentType"])
    if fmt is None:
        raise RuntimeError("unsupported index layout")
    view = document["bufferViews"][accessor["bufferView"]]
    offset = view.get("byteOffset", 0) + accessor.get("byteOffset", 0)
    size = struct.calcsize(fmt)
    return [
        struct.unpack_from("<" + fmt, blob, offset + i * size)[0]
        for i in range(accessor["count"])
    ]


def glb_positions(raw):
    length = struct.unpack_from("<I", raw, 12)[0]
    document = json.loads(raw[20 : 20 + length])
    blob = raw[28 + length :]
    found = {}
    for mesh_index, mesh in enumerate(document["meshes"]):
        for prim_index, prim in enumerate(mesh["primitives"]):
            rows = _read_vec3_rows(blob, document, prim["attributes"]["POSITION"])
            # Khronos glTF-Blender-IO mesh.py:422-426: one vertex per
            # np.unique(indices), then POSITION at those sorted unique indices.
            used = sorted(set(_read_scalar_indices(blob, document, prim["indices"])))
            found[f"{mesh_index}:{prim_index}"] = [rows[i] for i in used]
    return found


def _with_evaluated_mesh(obj, reader):
    """Read the depsgraph mesh and always free it, including on reader failure."""
    depsgraph = bpy.context.evaluated_depsgraph_get()
    evaluated = obj.evaluated_get(depsgraph)
    mesh = evaluated.to_mesh(preserve_all_data_layers=True, depsgraph=depsgraph)
    try:
        return reader(evaluated, mesh)
    finally:
        evaluated.to_mesh_clear()


def _coords(obj, world):
    def read(evaluated, mesh):
        matrix = evaluated.matrix_world
        coords = []
        for vert in mesh.vertices:
            co = matrix @ vert.co if world else vert.co
            coords.append(blender_to_gltf(co))
        return coords

    return _with_evaluated_mesh(obj, read)


def _loop_uv(layer):
    digest = hashlib.sha256()
    count = 0
    for loop in layer.data:
        digest.update(struct.pack("<ff", float(loop.uv.x), float(loop.uv.y)))
        count += 1
    return {"name": layer.name, "loops": count, "sha256": digest.hexdigest()}


def _unit_tuple(vector):
    x, y, z = float(vector[0]), float(vector[1]), float(vector[2])
    length = math.sqrt(x * x + y * y + z * z)
    if length == 0:
        return (0.0, 0.0, 0.0)
    return (x / length, y / length, z / length)


def compare_normals(source, evaluated, component_tol=NORMAL_COMPONENT_TOLERANCE, angle_tol=NORMAL_ANGLE_TOLERANCE_DEG):
    """Same-space corner normals. Count or a real angular change refuses."""
    if len(source) != len(evaluated):
        raise RuntimeError(f"custom normal count {len(source)} != evaluated {len(evaluated)}")
    max_comp = 0.0
    max_deg = 0.0
    for left, right in zip(source, evaluated):
        a = _unit_tuple(left)
        b = _unit_tuple(right)
        max_comp = max(max_comp, abs(a[0] - b[0]), abs(a[1] - b[1]), abs(a[2] - b[2]))
        dot = max(-1.0, min(1.0, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))
        max_deg = max(max_deg, math.degrees(math.acos(dot)))
    report = {
        "count": len(source),
        "maxComponent": max_comp,
        "maxAngleDeg": max_deg,
        "componentTolerance": component_tol,
        "angleToleranceDeg": angle_tol,
        "space": "caller-supplied same coordinate space",
    }
    if max_comp > component_tol or max_deg > angle_tol:
        raise RuntimeError(f"evaluated custom normals diverge from source: {report}")
    return report


def compare_uv(source, evaluated, tolerance=UV_COMPONENT_TOLERANCE):
    if len(source) != len(evaluated):
        raise RuntimeError(f"UV loop count {len(source)} != evaluated {len(evaluated)}")
    worst = 0.0
    for left, right in zip(source, evaluated):
        worst = max(worst, abs(float(left[0]) - float(right[0])), abs(float(left[1]) - float(right[1])))
    if worst > tolerance:
        raise RuntimeError(f"UV loops diverge by {worst} (limit {tolerance})")
    return {"count": len(source), "maxComponent": worst, "tolerance": tolerance}


def _world_normals(matrix_world, mesh):
    """Corner normals in one world space. matrix_world is the mesh's object matrix."""
    normal_matrix = matrix_world.to_3x3().inverted().transposed()
    vectors = []
    for corner in getattr(mesh, "corner_normals", []):
        transformed = normal_matrix @ corner.vector
        vectors.append((float(transformed.x), float(transformed.y), float(transformed.z)))
    return vectors


def _uv_loops(mesh):
    if not mesh.uv_layers:
        return []
    return [(float(loop.uv.x), float(loop.uv.y)) for loop in mesh.uv_layers[0].data]


def _capture_evaluated_surface(obj):
    def read(evaluated, mesh):
        return {
            "name": obj.name,
            "normals": _world_normals(evaluated.matrix_world, mesh),
            "uvLoops": _uv_loops(mesh),
            "custom": bool(getattr(mesh, "has_custom_normals", False)),
        }

    return _with_evaluated_mesh(obj, read)


def _audit_joined_bake(order, body):
    """Compare the bake object after join with the pre-join parts in join order."""
    snapshots = [_capture_evaluated_surface(obj) for obj in order]
    if len(order) > 1:
        bpy.ops.object.join()
        body = bpy.context.view_layer.objects.active
        bpy.context.view_layer.update()
    joined = _capture_evaluated_surface(body)
    expected_normals = [normal for snap in snapshots for normal in snap["normals"]]
    expected_uv = [loop for snap in snapshots for loop in snap["uvLoops"]]
    if any(snap["custom"] for snap in snapshots) and not joined["custom"]:
        raise RuntimeError(f"{body.name} join dropped custom normals from the bake object")
    report = {
        "joinOrder": [snap["name"] for snap in snapshots],
        "partCount": len(order),
        "normals": compare_normals(expected_normals, joined["normals"]),
        "uv": compare_uv(expected_uv, joined["uvLoops"]),
        "bakeObject": joined["name"],
    }
    return body, report


def _surface_audit(obj, require):
    """Observe evaluated UV and custom normals. Skin meshes must preserve both."""

    def read(_evaluated, mesh):
        evaluated_uv = [_loop_uv(layer) for layer in mesh.uv_layers]
        source_uv = [_loop_uv(layer) for layer in obj.data.uv_layers]
        source_loops = _uv_loops(obj.data)
        evaluated_loops = _uv_loops(mesh)
        source_normals = _world_normals(obj.matrix_world, obj.data)
        evaluated_normals = _world_normals(_evaluated.matrix_world, mesh)
        source_custom = bool(getattr(obj.data, "has_custom_normals", False))
        evaluated_custom = bool(getattr(mesh, "has_custom_normals", False))
        uv_report = None
        normal_report = None
        if require and not evaluated_uv:
            raise RuntimeError(f"{obj.name} evaluated skin mesh has no UV")
        if require:
            uv_report = compare_uv(source_loops, evaluated_loops)
        if require and source_custom:
            if not evaluated_custom:
                raise RuntimeError(f"{obj.name} evaluated mesh dropped source custom normals")
            normal_report = compare_normals(source_normals, evaluated_normals)
        return {
            "name": obj.name,
            "skin": require,
            "sourceVertices": len(obj.data.vertices),
            "evaluatedVertices": len(mesh.vertices),
            "uv": evaluated_uv,
            "sourceUv": source_uv,
            "uvReport": uv_report,
            "sourceCustomNormals": source_custom,
            "evaluatedCustomNormals": evaluated_custom,
            "normalReport": normal_report,
            "preserved": uv_report is not None or not require,
        }

    return _with_evaluated_mesh(obj, read)


def blender_to_gltf(co):
    """Inverse of the glTF importer's Z-up map. File POSITION accessors stay Y-up."""
    return (float(co[0]), float(co[2]), -float(co[1]))


def match_gltf_primitives(reference, pools):
    """Match one evaluated mesh to each file mesh, including multi-primitive bodies."""
    groups = {}
    order = []
    for key, points in reference.items():
        mesh_index, _prim = key.split(":")
        groups.setdefault(mesh_index, []).append((key, points))
        if mesh_index not in order:
            order.append(mesh_index)
    used = set()
    evaluated = {}
    for mesh_index in order:
        parts = groups[mesh_index]
        flat = [point for _key, points in parts for point in points]
        hit = None
        hit_name = None
        for name, coords in pools:
            if name in used:
                continue
            if _same(flat, coords):
                hit = coords
                hit_name = name
                break
        if hit is None:
            raise RuntimeError(
                f"REST evaluation has no mesh whose glTF-space vertices match file mesh {mesh_index} "
                f"({len(flat)} vertices across {len(parts)} primitives)"
            )
        used.add(hit_name)
        cursor = 0
        for key, points in parts:
            evaluated[key] = [list(point) for point in hit[cursor : cursor + len(points)]]
            cursor += len(points)
    return evaluated


def _same(a, b):
    if len(a) != len(b):
        return False
    for left, right in zip(a, b):
        if any(abs(x - y) > 1e-6 for x, y in zip(left, right)):
            return False
    return True


def _match_positions(reference, meshes):
    pools = []
    for obj in meshes:
        local = _coords(obj, world=False)
        world = _coords(obj, world=True)
        pools.append((obj.name, local))
        if world != local:
            pools.append((obj.name + "#world", world))
    return match_gltf_primitives(reference, pools)


def _rest_parity(armatures, meshes, posed):
    """An imported action must move the evaluated mesh when REST is applied."""
    posed_mode = [row for row in armatures if row.get("importedAction") and row.get("originalPosePosition") != "REST"]
    if not posed_mode:
        return {"status": "no-posed-action", "changedMeshes": []}
    changed = []
    for obj in meshes:
        rest = _coords(obj, world=False)
        if posed.get(obj.name) != rest:
            changed.append(obj.name)
    if not changed:
        raise RuntimeError(
            "REST parity failed: imported action did not change any evaluated mesh, "
            "so the readout is not a live depsgraph evaluation"
        )
    return {"status": "posed-action-differs-from-rest", "changedMeshes": changed}


def _load_detail_config(materializer, config):
    import ast

    import numpy as np

    tree = ast.parse(Path(materializer).read_text(encoding="utf-8"))
    names = {"_body_world_z_bounds", "_walk_group_instances", "configure_skin_normal_detail"}
    selected = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name in names]
    dermal = config["dermal"]
    namespace = {
        "bpy": bpy,
        "np": np,
        "json": json,
        "DERMAL_CELL_TEXELS": float(dermal["cellTexels"]),
        "DERMAL_BUMP_STRENGTH": float(dermal["bumpStrength"]),
        "DERMAL_VORONOI_FEATURE": str(dermal["voronoiFeature"]),
        "DERMAL_VORONOI_RANDOMNESS": float(dermal["voronoiRandomness"]),
        "DERMAL_RAMP_VALLEY": float(dermal["rampValley"]),
        "DERMAL_RAMP_PEAK": float(dermal["rampPeak"]),
    }
    exec(compile(ast.Module(body=selected, type_ignores=[]), str(materializer), "exec"), namespace)
    return namespace["configure_skin_normal_detail"]


def _observe_mpfb(expected_module):
    import importlib

    module = importlib.import_module(expected_module)
    info = getattr(module, "bl_info", None) or {}
    version = info.get("version")
    if version is None:
        raise RuntimeError(f"mpfb version was not observable from {expected_module}.bl_info")
    observed = ".".join(str(part) for part in version) if isinstance(version, (tuple, list)) else str(version)
    return {"module": expected_module, "version": observed, "name": info.get("name")}


def _is_skin(obj):
    return any(
        material and (material.name.startswith("mpfb_skin_") or material.name.startswith("openclinxr_hidden_"))
        for material in obj.data.materials
    )


def main():
    _refuse_ambient_dermal_env()
    args = _args()
    job, (source, out_dir, config_path) = _confine(args["job-root"], args["source"], args["out-dir"], args["config"])
    if not source.is_file():
        raise RuntimeError(f"missing final REST source {source}")
    config = _load_config(config_path)
    out_dir.mkdir(parents=True, exist_ok=True)
    raw = source.read_bytes()
    reference = glb_positions(raw)
    repo = Path(__file__).resolve().parents[5]
    materializer = repo / "tools/openclinxr/evidence/blender/materialize_mpfb_humanoid_candidate.py"
    configure = _load_detail_config(materializer, config)
    bpy.ops.preferences.addon_enable(module="bl_ext.user_default.mpfb")
    observed_mpfb = _observe_mpfb(config["tools"]["mpfbModule"])
    from bl_ext.user_default.mpfb.entities.nodemodel.v2.materials.nodewrapperskin import NodeWrapperSkin

    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    bpy.ops.import_scene.gltf(filepath=str(source))
    armatures = []
    for obj in bpy.context.scene.objects:
        if obj.type != "ARMATURE":
            continue
        action = obj.animation_data.action.name if obj.animation_data and obj.animation_data.action else None
        armatures.append({"name": obj.name, "originalPosePosition": obj.data.pose_position, "importedAction": action})
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    if not meshes:
        raise RuntimeError("import produced no meshes")
    posed = {obj.name: _coords(obj, world=False) for obj in meshes}
    for obj in armatures:
        armature = bpy.data.objects[obj["name"]]
        armature.data.pose_position = "REST"
    bpy.context.view_layer.update()
    surface = [_surface_audit(obj, _is_skin(obj)) for obj in meshes]
    if not any(row["skin"] for row in surface):
        raise RuntimeError("no skin body part on the imported final source")
    evaluated = _match_positions(reference, meshes)
    parity = _rest_parity(armatures, meshes, posed)
    parts = [obj for obj in meshes if _is_skin(obj)]
    if not parts:
        raise RuntimeError("no skin body part on the imported final source")
    bpy.ops.object.select_all(action="DESELECT")
    for obj in parts:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    selected = [obj for obj in bpy.context.selected_objects if obj.type == "MESH"]
    order = [parts[0]] + [obj for obj in selected if obj != parts[0]]
    body, joined_audit = _audit_joined_bake(order, parts[0])
    mat = bpy.data.materials.new("tara_final_rest_enhanced")
    mat.use_nodes = True
    NodeWrapperSkin.pre_create_instance(mat.node_tree)
    body.data.materials.clear()
    body.data.materials.append(mat)
    for poly in body.data.polygons:
        poly.material_index = 0
    resolution = int(config["resolution"][0])
    detail = configure(mat, body, resolution=resolution)
    dermal = config["dermal"]
    if float(detail["dermalBumpStrength"]) != float(dermal["bumpStrength"]):
        raise RuntimeError("configured dermal bump strength diverges from authored settings")
    if detail["dermalVoronoiFeature"] != dermal["voronoiFeature"]:
        raise RuntimeError("configured voronoi feature diverges from authored settings")
    if float(detail["dermalCellTexels"]) != float(dermal["cellTexels"]):
        raise RuntimeError("configured dermal cell size diverges from authored settings")
    cycles = config["cycles"]
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = cycles["device"]
    scene.cycles.samples = int(cycles["samples"])
    scene.render.bake.normal_space = cycles["normalSpace"]
    margin = int(cycles["margin"])
    scene.render.bake.margin = margin
    image = bpy.data.images.new("tara_final_rest_normal", resolution, resolution, alpha=False, float_buffer=False)
    image.colorspace_settings.name = "Non-Color"
    image.generated_color = (0.5, 0.5, 1, 1)
    tex = mat.node_tree.nodes.new("ShaderNodeTexImage")
    tex.image = image
    for node in mat.node_tree.nodes:
        node.select = False
    tex.select = True
    mat.node_tree.nodes.active = tex
    bpy.ops.object.select_all(action="DESELECT")
    body.select_set(True)
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.bake(type="NORMAL", margin=margin, use_clear=True)
    normal_path = out_dir / "final-rest-normal.png"
    image.filepath_raw = str(normal_path)
    image.file_format = "PNG"
    image.save()
    if source.read_bytes() != raw:
        raise RuntimeError("source GLB bytes changed during the texture bake")
    if not normal_path.is_file():
        raise RuntimeError("baked normal was not written")
    normal = normal_path.read_bytes()
    if normal[:8] != b"\x89PNG\r\n\x1a\n":
        raise RuntimeError("baked normal is not a PNG")
    basis = {
        "sourceSha256": _sha(raw),
        "evaluatedRestPositions": evaluated,
        "blenderVersion": bpy.app.version_string,
        "evaluationMode": "REST",
        "armaturesExplicitRest": armatures,
        "restParity": parity,
        "surfaceAudit": surface,
        "joinedBakeAudit": joined_audit,
        "coordinateSource": "depsgraph-evaluated-mesh",
        "coordinateSpace": "glTF-Y-up via blender (x, z, -y)",
    }
    basis_path = out_dir / "basis.json"
    basis_path.write_text(json.dumps(basis), encoding="utf-8")
    manifest = {
        "asset": str(source),
        "assetSha256": _sha(raw),
        "normalSha256": _sha(normal),
        "normalPath": str(normal_path),
        "basisPath": str(basis_path),
        "blender": bpy.app.version_string,
        "mpfb": observed_mpfb,
        "evaluationMode": "REST",
        "resolution": [resolution, resolution],
        "frequencyUnits": "authored-texture-frequency",
        "outputScope": "tangent normal texture only; source GLB bytes not modified",
        "detail": detail,
        "authoredBake": config,
        "jobRoot": str(job),
    }
    manifest_path = out_dir / "bake-manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(
        "BAKE_RESULT "
        + json.dumps(
            {
                "normalSha256": manifest["normalSha256"],
                "assetSha256": manifest["assetSha256"],
                "blender": manifest["blender"],
                "mpfb": observed_mpfb["version"],
            }
        )
    )


if __name__ == "__main__":
    main()
