"""Replay Round 3 sampling exactly; capture decode before any export treatment.

Run with the Round-3 interpreter through GpuJobService. Sampling, preprocessing,
and decode remain owned by the pinned image-to-3dlab script.
"""
import hashlib
import importlib.util
import json
import sys
import time
from pathlib import Path

root = Path(__file__).resolve().parent
case = root.parent
scratch = Path(sys.argv[1]).resolve()
scratch.mkdir(parents=True, exist_ok=True)
script = Path('/Users/patrick/.openclinxr-tools/image-to-3dlab/scripts/trellis_space_generate.py')
spec = importlib.util.spec_from_file_location('round3_generator', script)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
provenance = json.loads((case / 'round3/raw/trellis2/provenance.json').read_text())
original = json.loads((case / 'round3/raw/trellis2/ecg-cart.json').read_text())
for stage in ('sparse_structure', 'shape_slat', 'tex_slat'):
    assert module.DEMO_PARAMS[stage] == original['params'][stage]
seed = provenance['parameters']['seed']
assert seed == 42
input_path = case / 'inputs/ecg-cart-oracle-matted.png'
assert hashlib.sha256(input_path.read_bytes()).hexdigest() == provenance['inputSha256']

class Captured(Exception):
    pass

def capture(vertices, faces, attrs, coords, attr_layout, res, output_path, **kwargs):
    import torch
    checkpoint = scratch / 'decoded-mesh.pt'
    torch.save(dict(vertices=vertices, faces=faces, attrs=attrs, coords=coords,
                    layout=attr_layout, voxel_size=1.0 / res, seed=seed, steps=12), checkpoint)
    report = dict(schemaVersion='openclinxr.ecg-cart-round5b-generation.v1',
                  sourceProvenance='../round3/raw/trellis2/provenance.json',
                  seed=seed, resolution=res, pipelineType='1024_cascade',
                  attention='sdpa', sparseAttention='sdpa', loadRemBg=False,
                  inputSha256=provenance['inputSha256'],
                  samplerParams={stage: module.DEMO_PARAMS[stage] for stage in
                                 ('sparse_structure', 'shape_slat', 'tex_slat')},
                  generatorScriptSha256=hashlib.sha256(script.read_bytes()).hexdigest(),
                  labCommit=provenance['labCommit'], rawFaces=len(faces),
                  checkpoint=str(checkpoint),
                  checkpointSha256=hashlib.sha256(checkpoint.read_bytes()).hexdigest(),
                  originalDecodeSha256=hashlib.sha256((scratch / 'ecg-cart_decode.pt').read_bytes()).hexdigest(),
                  generationSeconds=time.time()-started,
                  export='captured before pre-cap, decimation, UV unwrap or bake')
    (root / 'generation.json').write_text(json.dumps(report, indent=2)+'\n')
    print(json.dumps(report), flush=True)
    raise Captured()

module._bake_export = capture
started = time.time()
try:
    module.main([str(input_path), str(scratch / 'ecg-cart.glb'), '--seed', str(seed),
                 '--resolution', '1024', '--texture-size', '2048',
                 '--sparse-attn-backend', 'sdpa'])
except Captured:
    print('Round 3 sampling replay captured successfully before export.', flush=True)
