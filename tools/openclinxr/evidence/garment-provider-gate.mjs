import fs from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve('/Volumes/files/src/openclinxr');
const argValue = (name, fallback = null) => {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};

const workOrderPath = argValue('--work-order');
const outputPath = argValue('--output', 'docs/openclinxr/garment-provider-gate-2026-05-27.json');
if (!workOrderPath) throw new Error('--work-order is required');

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(path.resolve(root, filePath), 'utf8'));
}

const registry = await readJson('tools/openclinxr/garment-provider-registry.json');
const workOrder = await readJson(workOrderPath);
const provider = registry.providers.find((entry) => entry.providerId === workOrder.providerId);
const sourceProvider = registry.providers.find((entry) => entry.providerId === workOrder.preferredSourceLibraries?.[0]);
const licenseRecord = workOrder.licenseRecord ? await readJson(workOrder.licenseRecord) : null;
const requiredLicenseFields = ['sourceUrl', 'license', 'author', 'redistributionPermission', 'sourceFileHash', 'assetFilePath'];
const licenseRecordComplete = Boolean(licenseRecord)
  && requiredLicenseFields.every((field) => typeof licenseRecord[field] === 'string' && licenseRecord[field].length > 0)
  && licenseRecord.status === 'source_extracted_and_hashed_ready_for_provider_gate';

const failures = [];
if (!provider) failures.push('fitting_provider_missing');
if (!sourceProvider) failures.push('source_provider_missing');
if (!workOrder.sourceGarment) failures.push('source_garment_missing');
if (!workOrder.licenseRecord) failures.push('license_record_missing');
if (sourceProvider?.status?.includes('blocked') && !licenseRecordComplete) failures.push(`source_provider_blocked:${sourceProvider.status}`);
if (workOrder.licenseRecord && !licenseRecordComplete) failures.push('license_record_incomplete');
if (sourceProvider?.requiresApproval) failures.push('source_provider_requires_approval');
if (workOrder.fallbackSource) failures.push('procedural_or_hand_authored_fallback_present');
if (workOrder.approvedEntrypoint !== 'tools/openclinxr/garment-ingest-and-fit.mjs') failures.push('approved_ingestion_entrypoint_missing');

const result = {
  schemaVersion: '2026-05-27',
  claimBoundary: 'garment provider gate only; not production, Quest, clinical, legal, or scoring readiness',
  workOrder: path.relative(root, path.resolve(root, workOrderPath)),
  providerId: workOrder.providerId,
  sourceProviderId: workOrder.preferredSourceLibraries?.[0] ?? null,
  licenseRecord: workOrder.licenseRecord ?? null,
  licenseRecordComplete,
  pass: failures.length === 0,
  failures,
  promotionDecision: failures.length === 0 ? 'candidate_can_run_fit_and_visual_gate' : 'blocked_before_fit_or_promotion',
  requiredEntrypoint: 'tools/openclinxr/garment-ingest-and-fit.mjs',
  recommendedDefault: 'If blocked, do not materialize/promote garment; continue cache/scoring/provider integration work.'
};

await fs.mkdir(path.dirname(path.resolve(root, outputPath)), { recursive: true });
await fs.writeFile(path.resolve(root, outputPath), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ outputPath, pass: result.pass, failures }, null, 2));
