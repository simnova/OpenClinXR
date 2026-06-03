import argparse
import json
import pathlib
import sys

import bpy
from mathutils import Vector


def import_asset(path):
    suffix = path.suffix.lower()
    if suffix in {'.glb', '.gltf'}:
        bpy.ops.import_scene.gltf(filepath=str(path))
    else:
        raise RuntimeError(f'Unsupported humanoid asset format: {path}')


def mesh_world_bounds(obj):
    corners = [obj.matrix_world @ Vector(corner) for corner in obj.bound_box]
    mins = Vector((min(c.x for c in corners), min(c.y for c in corners), min(c.z for c in corners)))
    maxs = Vector((max(c.x for c in corners), max(c.y for c in corners), max(c.z for c in corners)))
    return mins, maxs


def combined_bounds(meshes):
    mins = []
    maxs = []
    for mesh in meshes:
        mesh_min, mesh_max = mesh_world_bounds(mesh)
        mins.append(mesh_min)
        maxs.append(mesh_max)
    return (
        Vector((min(v.x for v in mins), min(v.y for v in mins), min(v.z for v in mins))),
        Vector((max(v.x for v in maxs), max(v.y for v in maxs), max(v.z for v in maxs))),
    )


def body_meshes():
    ignored = ('tearline', 'eye', 'lash', 'brow', 'hair', 'teeth', 'tongue')
    meshes = []
    for obj in bpy.context.scene.objects:
        if obj.type != 'MESH':
            continue
        name = obj.name.lower()
        if any(token in name for token in ignored):
            continue
        meshes.append(obj)
    return meshes


def main():
    parser = argparse.ArgumentParser(description='Extract humanoid body measurements for adaptive garment fitting.')
    parser.add_argument('--humanoid', required=True)
    parser.add_argument('--archetype-id', required=True)
    parser.add_argument('--output', required=True)
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
    args = parser.parse_args(argv)

    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete()
    import_asset(pathlib.Path(args.humanoid))
    meshes = body_meshes()
    if not meshes:
        raise RuntimeError('No body meshes found for measurement extraction')

    body_min, body_max = combined_bounds(meshes)
    size = body_max - body_min
    measurements = {
        'schemaVersion': '2026-05-27',
        'claimBoundary': 'body measurement extraction for garment fitting only; not clinical, demographic, or scoring readiness',
        'archetypeId': args.archetype_id,
        'humanoid': args.humanoid,
        'bodyMeshCount': len(meshes),
        'bodyBoundsMin': [body_min.x, body_min.y, body_min.z],
        'bodyBoundsMax': [body_max.x, body_max.y, body_max.z],
        'height': size.z,
        'width': size.x,
        'depth': size.y,
        'targetTorso': {
            'center': [(body_min.x + body_max.x) * 0.5, (body_min.y + body_max.y) * 0.5, body_min.z + size.z * 0.61],
            'size': [max(size.x * 1.12, 0.18), max(size.y * 1.08, 0.08), max(size.z * 0.34, 0.34)],
            'neckApproxZ': body_min.z + size.z * 0.83,
            'hipApproxZ': body_min.z + size.z * 0.43,
            'shoulderApproxZ': body_min.z + size.z * 0.72
        },
        'requiredForPromotion': True,
        'nextUse': 'Feed these measurements into adaptive garment scaling/clearance before shrinkwrap for each child/adult/body-size archetype.'
    }
    output = pathlib.Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(measurements, indent=2) + '\n')


if __name__ == '__main__':
    main()
