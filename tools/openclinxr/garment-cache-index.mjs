import fs from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve('/Volumes/files/src/openclinxr');
const indexPath = path.join(root, '.openclinxr-local/provider-cache/garments/garment-cache-index.json');
const workOrderPath = process.argv.includes('--work-order')
  ? path.resolve(root, process.argv[process.argv.indexOf('--work-order') + 1])
  : null;

const emptyIndex = {
  schemaVersion: '2026-05-27',
  claimBoundary: 'local garment cache metadata only; not production, Quest, clinical, scoring, or licensing readiness',
  maxEntries: 24,
  entries: []
};

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
}

function sortLru(entries) {
  return [...entries].sort((a, b) => String(b.lastUsedAt).localeCompare(String(a.lastUsedAt)));
}

const index = await readJson(indexPath, emptyIndex);
if (workOrderPath) {
  const workOrder = await readJson(workOrderPath, null);
  if (!workOrder?.semanticGarmentKey) {
    throw new Error(`Work order missing semanticGarmentKey: ${workOrderPath}`);
  }
  const now = new Date().toISOString();
  const existing = index.entries.find((entry) => entry.semanticGarmentKey === workOrder.semanticGarmentKey);
  if (existing) {
    existing.lastUsedAt = now;
    existing.useCount = (existing.useCount ?? 0) + 1;
    existing.latestWorkOrder = path.relative(root, workOrderPath);
  } else {
    index.entries.push({
      semanticGarmentKey: workOrder.semanticGarmentKey,
      providerId: workOrder.providerId,
      sourceLibraries: workOrder.preferredSourceLibraries ?? [],
      outputCandidate: workOrder.outputCandidate,
      approvedEntrypoint: workOrder.approvedEntrypoint ?? 'tools/openclinxr/garment-ingest-and-fit.mjs',
      licenseRecord: workOrder.licenseRecord ?? null,
      sourceGarment: workOrder.sourceGarment ?? null,
      latestWorkOrder: path.relative(root, workOrderPath),
      useCount: 1,
      firstUsedAt: now,
      lastUsedAt: now,
      status: workOrder.sourceGarment && workOrder.licenseRecord ? 'candidate_ready_for_provider_gate' : 'blocked_pending_external_garment_source_and_license_record'
    });
  }
}

index.entries = sortLru(index.entries).slice(0, index.maxEntries);
await fs.mkdir(path.dirname(indexPath), { recursive: true });
await fs.writeFile(indexPath, `${JSON.stringify(index, null, 2)}\n`);
console.log(JSON.stringify({ indexPath: path.relative(root, indexPath), entries: index.entries.length }, null, 2));
