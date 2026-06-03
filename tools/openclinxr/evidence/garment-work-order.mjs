import fs from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve('/Volumes/files/src/openclinxr');
const registryPath = path.join(root, 'tools/openclinxr/garment-provider-registry.json');
const argValue = (name, fallback = null) => {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};
const outputPath = process.argv.includes('--output')
  ? path.resolve(root, process.argv[process.argv.indexOf('--output') + 1])
  : path.join(root, 'docs/openclinxr/garment-work-order-ob-reom-2026-05-27.json');
const scenarioId = argValue('--scenario-id', 'ob_headache_preeclampsia_triage_v1');
const actorId = argValue('--actor-id', 'ob_patient_aisha_khan');
const garmentKey = argValue('--garment-key', 'garment:ob-triage-patient-fitted-clinical-top:adult:teal:v1');
const humanoid = argValue('--humanoid', 'apps/ui-xr/public/xr-assets/humanoids/candidates/charmorph-reom-ob-patient-candidate.glb');
const candidate = argValue('--candidate', '.openclinxr-local/provider-cache/garments/generated/reom-ob-patient-fitted-clinical-top.glb');
const sourceLibrary = argValue('--source-library', 'mpfb_makehuman_clothing_library');
const sourceGarment = argValue('--source-garment', null);
const licenseRecord = argValue('--license-record', null);

const registry = JSON.parse(await fs.readFile(registryPath, 'utf8'));
const provider = registry.providers.find((entry) => entry.providerId === 'garment_fitter_local');
if (!provider) throw new Error('garment_fitter_local provider missing');

const workOrder = {
  schemaVersion: '2026-05-27',
  claimBoundary: 'local garment work order only; not production, Quest, clinical, scoring, or licensing readiness',
  scenarioId,
  actorId,
  semanticGarmentKey: garmentKey,
  providerId: provider.providerId,
  providerStatus: provider.status,
  approvedEntrypoint: 'tools/openclinxr/garment-ingest-and-fit.mjs',
  inputHumanoid: humanoid,
  preferredSourceLibraries: [sourceLibrary],
  sourceGarment,
  licenseRecord,
  fallbackSource: null,
  generationPolicy: 'external_garment_source_required_no_hand_authored_or_procedural_fallback_promotion',
  promotionBlockedUntil: [
    'sourceGarmentProvided',
    'licenseRecordProvided',
    'providerGatePasses',
    'webxrScreenshotScoreImprovesBaseline'
  ],
  outputCandidate: candidate,
  visualGate: {
    baselineGrade: 'B',
    baselineScore: 84,
    targetGrade: 'B+',
    screenshot: 'docs/openclinxr/screenshots/ui-xr-ob-humanoid-source-reom-local-fitted-garment-face-pose-2026-05-27.png',
    criteria: ['fit', 'clipping', 'silhouette', 'role_match', 'material_believability', 'pose_compatibility']
  },
  nextAction: 'Source a license-compatible MPFB/MakeHuman garment mesh, fit it with tools/openclinxr/blender/fit_garment_to_humanoid.py --garment, then rerun WebXR-only comparator.'
};

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify(workOrder, null, 2)}\n`);
console.log(JSON.stringify({ outputPath: path.relative(root, outputPath), providerId: workOrder.providerId, semanticGarmentKey: workOrder.semanticGarmentKey }, null, 2));
