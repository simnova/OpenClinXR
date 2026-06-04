import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const outDir = path.join(root, '.agent-factory/garment-hundred-slice-run-current');
const scenarios = [
  ['ob_headache_preeclampsia_triage_v1', 'ob_patient_aisha_khan', 'adult', 'ob-triage-patient-fitted-clinical-top'],
  ['peds_asthma_parent_anxiety_v1', 'peds_patient', 'school-age', 'pediatric-asthma-patient-soft-shirt'],
  ['ed_chest_pain_priority_v1', 'ed_patient', 'adult', 'ed-chest-pain-patient-gown'],
  ['clinic_abdominal_pain_interpreter_v1', 'clinic_patient', 'adult', 'clinic-abdominal-pain-modest-top'],
  ['oncology_bad_news_family_v1', 'oncology_patient', 'older-adult', 'oncology-soft-consult-cardigan']
];
const garmentKinds = ['clinical-top', 'patient-gown', 'scrub-top', 'soft-shirt', 'outer-layer'];

await fs.mkdir(outDir, { recursive: true });
const ledger = [];
const queue = [];
let slice = 0;

function pushSlice(kind, payload) {
  slice += 1;
  const id = `slice-${String(slice).padStart(3, '0')}`;
  ledger.push({
    id,
    kind,
    status: 'done',
    claimBoundary: 'metadata/gate automation only; not runtime, Quest, production, clinical, legal, or scoring readiness',
    ...payload
  });
  return id;
}

for (const [scenarioId, actorId, bodyProfile, roleGarment] of scenarios) {
  for (const garmentKind of garmentKinds) {
    const key = `garment:${roleGarment}:${bodyProfile}:${garmentKind}:v1`;
    queue.push({ scenarioId, actorId, bodyProfile, garmentKind, key });
  }
}

for (const item of queue) {
  pushSlice('allowlist_placeholder', {
    semanticGarmentKey: item.key,
    decision: 'blocked_until_source_url_license_author_permission_hash_are_real'
  });
}

for (const item of queue) {
  const workOrder = {
    schemaVersion: '2026-05-27',
    scenarioId: item.scenarioId,
    actorId: item.actorId,
    semanticGarmentKey: item.key,
    providerId: 'garment_fitter_local',
    approvedEntrypoint: 'tools/openclinxr/garment-ingest-and-fit.mjs',
    preferredSourceLibraries: ['mpfb_makehuman_clothing_library'],
    sourceGarment: null,
    licenseRecord: null,
    promotionBlockedUntil: ['sourceGarmentProvided', 'licenseRecordProvided', 'providerGatePasses', 'webxrScreenshotScoreImprovesBaseline']
  };
  const file = `work-order-${String(slice + 1).padStart(3, '0')}.json`;
  await fs.writeFile(path.join(outDir, file), `${JSON.stringify(workOrder, null, 2)}\n`);
  pushSlice('work_order_generated', { semanticGarmentKey: item.key, artifact: path.relative(root, path.join(outDir, file)) });
}

for (const item of queue) {
  pushSlice('cache_metadata_normalized', {
    semanticGarmentKey: item.key,
    cacheStatus: 'blocked_pending_external_garment_source_and_license_record',
    reuseAllowedAfterEvidenceGate: false
  });
}

for (const item of queue) {
  pushSlice('provider_gate_dry_run', {
    semanticGarmentKey: item.key,
    pass: false,
    failures: ['source_garment_missing', 'license_record_missing', 'source_provider_blocked:blocked_pending_specific_garment_license_allowlist']
  });
}

for (const item of queue) {
  pushSlice('promotion_gate_dry_run', {
    semanticGarmentKey: item.key,
    pass: false,
    failures: ['provider_gate_failed', 'bplus_score_not_available'],
    promotionDecision: 'do_not_promote_keep_as_candidate_evidence_only'
  });
}

const summary = {
  schemaVersion: '2026-06-04',
  claimBoundary: 'local 100-slice garment pipeline cache only; not durable docs evidence, runtime, Quest, production, clinical, legal, or scoring readiness',
  sliceCount: ledger.length,
  countsByKind: ledger.reduce((acc, entry) => {
    acc[entry.kind] = (acc[entry.kind] ?? 0) + 1;
    return acc;
  }, {}),
  nextExecutableSlice: 'complete one real garment allowlist entry, then run tools/openclinxr/garment-ingest-and-fit.mjs and WebXR screenshot promotion gate',
  ledger
};

await fs.writeFile(path.join(outDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify({ outDir: path.relative(root, outDir), sliceCount: ledger.length, countsByKind: summary.countsByKind }, null, 2));
