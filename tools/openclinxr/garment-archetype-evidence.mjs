import fs from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve('/Volumes/files/src/openclinxr');
const argValue = (name, fallback = null) => {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};
const argValues = (name) => {
  const values = [];
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] === name && process.argv[index + 1]) values.push(process.argv[index + 1]);
  }
  return values;
};

const outputPath = argValue('--output', 'docs/openclinxr/garment-archetype-evidence-2026-05-27.json');
const semanticGarmentKey = argValue('--semantic-garment-key', 'garment:unknown');
const requiredScore = Number(argValue('--required-score', '87'));
const requiredArchetypes = (argValue('--required-archetypes', 'child_small,child_average,adult_thin,adult_average,adult_overweight,adult_tall,adult_short') ?? '')
  .split(',')
  .map((entry) => entry.trim())
  .filter(Boolean);
const entries = argValues('--entry');

async function readJsonMaybe(relativePath) {
  if (!relativePath) return null;
  try {
    return JSON.parse(await fs.readFile(path.resolve(root, relativePath), 'utf8'));
  } catch (error) {
    return { readError: error instanceof Error ? error.message : String(error) };
  }
}

const observed = [];
for (const entry of entries) {
  const [id, measurementPath, scorecardPath, screenshotPath] = entry.split('=');
  if (!id || !measurementPath) throw new Error(`Invalid --entry value: ${entry}`);
  const measurement = await readJsonMaybe(measurementPath);
  const scorecard = await readJsonMaybe(scorecardPath);
  const score = Number(scorecard?.currentBest?.score ?? scorecard?.score ?? 0);
  const pass = Boolean(measurement && !measurement.readError && scorecard && !scorecard.readError && score >= requiredScore);
  observed.push({
    id,
    measurementPath,
    scorecardPath: scorecardPath || null,
    screenshotPath: screenshotPath || null,
    score,
    pass,
    failures: [
      ...(measurement?.readError ? [`measurement_read_error:${measurement.readError}`] : []),
      ...(!scorecardPath ? ['scorecard_missing'] : []),
      ...(scorecard?.readError ? [`scorecard_read_error:${scorecard.readError}`] : []),
      ...(score < requiredScore ? [`score_below_required:${score}<${requiredScore}`] : []),
    ],
    bodyMeasurements: measurement && !measurement.readError ? {
      height: measurement.height,
      width: measurement.width,
      depth: measurement.depth,
      targetTorso: measurement.targetTorso,
    } : null,
  });
}

const byId = new Map(observed.map((entry) => [entry.id, entry]));
const archetypes = requiredArchetypes.map((id) => byId.get(id) ?? {
  id,
  pass: false,
  score: 0,
  failures: ['archetype_evidence_missing'],
  measurementPath: null,
  scorecardPath: null,
  screenshotPath: null,
  bodyMeasurements: null,
});
const failures = archetypes.flatMap((entry) => entry.pass ? [] : entry.failures.map((failure) => `${entry.id}:${failure}`));
const result = {
  schemaVersion: '2026-05-27',
  claimBoundary: 'adaptive garment archetype evidence only; not production, Quest, clinical, legal, or scoring readiness',
  semanticGarmentKey,
  requiredScore,
  requiredArchetypes,
  pass: failures.length === 0,
  failures,
  archetypes,
  promotionUse: 'Pass this file to tools/openclinxr/garment-promotion-gate.mjs --archetype-evidence before shared-cache/runtime reuse.',
};

await fs.mkdir(path.dirname(path.resolve(root, outputPath)), { recursive: true });
await fs.writeFile(path.resolve(root, outputPath), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ outputPath, pass: result.pass, failureCount: failures.length }, null, 2));
