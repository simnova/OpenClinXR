"""Collect Round 5b measurements and reproducible manifest from run receipts."""
import hashlib
import importlib.util
import json
import re
from pathlib import Path

root = Path(__file__).resolve().parent
case = root.parent
spec = importlib.util.spec_from_file_location('topology', case / 'round5/measure-topology.py')
topology = importlib.util.module_from_spec(spec)
spec.loader.exec_module(topology)

def read(path):
    return json.loads(path.read_text())

def execution(name):
    receipt = read(root / 'executions' / f'{name}.json')
    assert receipt['code'] == 0
    rss = re.search(r'(\d+)\s+maximum resident set size', receipt['stderr'])
    assert rss, name
    return dict(wallSeconds=receipt['wallSeconds'], peakRssBytes=int(rss.group(1)),
                receipt=f'executions/{name}.json')

ious = read(root / 'silhouette-iou.json')['values']
generation = read(root / 'generation.json')
original = read(case / 'round3/raw/trellis2/provenance.json')
model_config = read(Path('/Users/patrick/.cache/huggingface/hub/models--microsoft--TRELLIS.2-4B/snapshots') /
                    original['weightRevisions']['trellis2'] / 'pipeline.json')
generation['effectiveSamplerParams'] = {
    stage: {**model_config['args'][stage+'_sampler']['params'], **params}
    for stage, params in generation['samplerParams'].items()
}
budget = read(root / 'budget/report.json')
raw = read(root / 'raw/report.json')
metrics = topology.measure(root / 'budget/ecg-cart.glb')
metrics.update(path='budget/ecg-cart.glb', bytes=budget['bytes'],
               glbMiB=budget['bytes']/1048576, decodedTextureMiB=2,
               silhouetteIou=ious['r5b'], sha256=budget['sha256'])
assert metrics['triangles'] <= 40000, metrics
assert metrics['decodedTextureMiB'] <= 16, metrics
raw_metrics = topology.measure(root / 'raw/ecg-cart.glb')
raw_metrics.update(path='raw/ecg-cart.glb', bytes=raw['bytes'],
                   decodedTextureMiB=32, silhouetteIou=ious['r5b_raw'],
                   sha256=raw['sha256'])
records = {name: execution(name) for name in ('generation', 'best', 'raw')}
manifest = dict(
    schemaVersion='openclinxr.trellis2-ecg-cart-round5b.v1',
    status='evidence candidate; coordinator grade pending; MADR 0059 Decision unchanged',
    generation=generation,
    revisions={key: original[key] for key in ('labCommit', 'spaceCommit', 'applePortPin', 'weightRevisions')},
    sourceRound3Provenance='../round3/raw/trellis2/provenance.json',
    sourceRound3Manifest='../round3/raw/trellis2/ecg-cart.json',
    postprocessRunner='../round5/process-treatment.py',
    postprocessRunnerSha256=hashlib.sha256((case/'round5/process-treatment.py').read_bytes()).hexdigest(),
    postprocessInterpreter='/Users/patrick/.openclinxr-tools/trellis2-apple/venv/bin/python3',
    pipelineOrder=['CPU trimesh.repair.fill_holes on full-resolution mesh',
                   'position weld at five decimal places',
                   '0.01% face-share island filter with >=10% non-main guard',
                   'to_glb decimation target 40000 before UV unwrap',
                   'UV unwrap', '512px PBR bake'],
    treatment=budget['treatment'], result=metrics, rawGradeExport=raw_metrics,
    execution=records, remesh=False,
    cameraFreeze='../../../../../tools/openclinxr/asset-pipeline/trellis/ecg-cart-camera-freeze.json',
    normalizeExtent=0.9682512283325195,
    evidence=read(root/'evidence-layout.json'),
    featureVerification=read(root/'visual-verification.json'),
    checkpointRetention='local ignored .openclinxr/round5b-replay-20261001; retained for exact postprocess replay',
    notEvidenceFor=['Quest readiness', 'clinical accuracy', 'runtime adoption', 'coordinator adoption decision'],
)
(root/'recommended-manifest.json').write_text(json.dumps(manifest, indent=2)+'\n')
(root/'measurements.json').write_text(json.dumps(dict(
    budget=metrics, raw=raw_metrics, execution=records, treatment=budget['treatment'],
    comparisonIou=ious, visualVerification='visual-verification.json'), indent=2)+'\n')
print(json.dumps(dict(metrics=metrics, execution=records)))
