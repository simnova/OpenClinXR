import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve('/Volumes/files/src/openclinxr');
const nodeBin = '/Users/patrick/.nvm/versions/node/v24.15.0/bin/node';
const blenderBin = '/opt/homebrew/bin/blender';
const argValue = (name, fallback = null) => {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};

const workOrderPath = argValue('--work-order');
const gateOutput = argValue('--gate-output', 'docs/openclinxr/garment-provider-gate-ingest-2026-05-27.json');
if (!workOrderPath) throw new Error('--work-order is required');

const workOrder = JSON.parse(await fs.readFile(path.resolve(root, workOrderPath), 'utf8'));
const gate = spawnSync(nodeBin, [
  'tools/openclinxr/garment-provider-gate.mjs',
  '--work-order', workOrderPath,
  '--output', gateOutput
], { cwd: root, encoding: 'utf8' });
if (gate.status !== 0) {
  process.stdout.write(gate.stdout);
  process.stderr.write(gate.stderr);
  process.exit(gate.status ?? 1);
}
const gateResult = JSON.parse(await fs.readFile(path.resolve(root, gateOutput), 'utf8'));
if (!gateResult.pass) {
  console.log(JSON.stringify({
    status: 'blocked_before_fit',
    gateOutput,
    failures: gateResult.failures,
    nextAction: gateResult.recommendedDefault
  }, null, 2));
  process.exit(0);
}

const fit = spawnSync(blenderBin, [
  '--background',
  '--python', 'tools/openclinxr/blender/fit_garment_to_humanoid.py',
  '--',
  '--humanoid', workOrder.inputHumanoid,
  '--garment', workOrder.sourceGarment,
  '--license-record', workOrder.licenseRecord,
  '--output', workOrder.outputCandidate,
  ...(workOrder.bodyMeasurements ? ['--body-measurements', workOrder.bodyMeasurements] : []),
  '--garment-offset-x', String(workOrder.fitTransform?.offset?.[0] ?? 0),
  '--garment-offset-y', String(workOrder.fitTransform?.offset?.[1] ?? 0),
  '--garment-offset-z', String(workOrder.fitTransform?.offset?.[2] ?? 0),
  '--garment-rotation-x', String(workOrder.fitTransform?.rotation?.[0] ?? 0),
  '--garment-rotation-y', String(workOrder.fitTransform?.rotation?.[1] ?? 0),
  '--garment-rotation-z', String(workOrder.fitTransform?.rotation?.[2] ?? 0),
  '--garment-scale-x', String(workOrder.fitTransform?.scale?.[0] ?? 1),
  '--garment-scale-y', String(workOrder.fitTransform?.scale?.[1] ?? 1),
  '--garment-scale-z', String(workOrder.fitTransform?.scale?.[2] ?? 1),
  '--garment-material-r', String(workOrder.materialFallback?.rgba?.[0] ?? 0.08),
  '--garment-material-g', String(workOrder.materialFallback?.rgba?.[1] ?? 0.33),
  '--garment-material-b', String(workOrder.materialFallback?.rgba?.[2] ?? 0.38),
  '--garment-material-a', String(workOrder.materialFallback?.rgba?.[3] ?? 1),
  '--shrinkwrap-offset', String(workOrder.fitTransform?.shrinkwrapOffset ?? 0.055)
], { cwd: root, encoding: 'utf8' });

process.stdout.write(fit.stdout);
process.stderr.write(fit.stderr);
if (fit.status !== 0) process.exit(fit.status ?? 1);
if (/Traceback|RuntimeError|Error:/u.test(`${fit.stdout}\n${fit.stderr}`)) {
  console.error('Blender reported an error despite zero exit status; treating garment ingestion as failed.');
  process.exit(1);
}
console.log(JSON.stringify({
  status: 'fit_complete',
  outputCandidate: workOrder.outputCandidate,
  gateOutput
}, null, 2));
