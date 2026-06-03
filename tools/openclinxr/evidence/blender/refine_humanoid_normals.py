import argparse
import json
import os
import bpy

parser = argparse.ArgumentParser()
parser.add_argument('--input', required=True)
parser.add_argument('--output', required=True)
parser.add_argument('--report', required=True)
import sys
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
args = parser.parse_args(argv)

bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete()

bpy.ops.import_scene.gltf(filepath=args.input)
mesh_count = 0
weighted_normal_count = 0
smooth_poly_count = 0
for obj in bpy.context.scene.objects:
    if obj.type != 'MESH':
        continue
    mesh_count += 1
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    for poly in obj.data.polygons:
        if not poly.use_smooth:
            poly.use_smooth = True
            smooth_poly_count += 1
    if 'openclinxr_weighted_normal_refine' not in obj.modifiers:
        modifier = obj.modifiers.new('openclinxr_weighted_normal_refine', 'WEIGHTED_NORMAL')
        modifier.keep_sharp = True
        modifier.weight = 50
        weighted_normal_count += 1
    obj['openClinXrPostAnnyRefine'] = 'blender_weighted_normals_no_geometry_deformation'
    obj.select_set(False)

os.makedirs(os.path.dirname(args.output), exist_ok=True)
bpy.ops.export_scene.gltf(
    filepath=args.output,
    export_format='GLB',
    export_animations=True,
    export_skins=True,
    export_morph=True,
    export_yup=True,
)

report = {
    'schemaVersion': 'openclinxr.blender-humanoid-normal-refine.v1',
    'input': args.input,
    'output': args.output,
    'meshCount': mesh_count,
    'weightedNormalModifierCount': weighted_normal_count,
    'smoothPolygonCount': smooth_poly_count,
    'claimBoundaries': {
        'notEvidenceFor': ['aaa_humanoid_realism', 'quest_readiness', 'production_readiness', 'clinical_validity', 'scoring_validity']
    }
}
os.makedirs(os.path.dirname(args.report), exist_ok=True)
with open(args.report, 'w', encoding='utf-8') as f:
    json.dump(report, f, indent=2)
    f.write('\n')
