import fs from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve('/Volumes/files/src/openclinxr');
const argValue = (name, fallback = null) => {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};

const providerGatePath = argValue('--provider-gate', 'docs/openclinxr/garment-provider-gate-ob-reom-2026-05-27.json');
const scorecardPath = argValue('--scorecard', 'docs/openclinxr/humanoid-source-bplus-scorecard-2026-05-27.json');
const outputPath = argValue('--output', 'docs/openclinxr/garment-promotion-gate-ob-reom-2026-05-27.json');
const requiredScore = Number(argValue('--required-score', '87'));
const archetypeEvidencePath = argValue('--archetype-evidence');
const requiredArchetypes = (argValue('--required-archetypes', 'child_small,child_average,adult_thin,adult_average,adult_overweight,adult_tall,adult_short') ?? '')
  .split(',')
  .map((entry) => entry.trim())
  .filter(Boolean);

async function readJson(relativePath) {
  return JSON.parse(await fs.readFile(path.resolve(root, relativePath), 'utf8'));
}

const providerGate = await readJson(providerGatePath);
const scorecard = await readJson(scorecardPath);
const archetypeEvidence = archetypeEvidencePath ? await readJson(archetypeEvidencePath) : null;
const current = scorecard.currentBest ?? {};
const score = Number(current.score ?? 0);
const failures = [];
if (!providerGate.pass) failures.push('provider_gate_failed');
if (score < requiredScore) failures.push(`score_below_required:${score}<${requiredScore}`);
if (current.passesBPlus !== true) failures.push('bplus_flag_not_true');
if (!archetypeEvidence) {
  failures.push('body_archetype_evidence_missing');
} else {
  const archetypeResults = new Map((archetypeEvidence.archetypes ?? []).map((entry) => [entry.id, entry]));
  for (const archetypeId of requiredArchetypes) {
    const result = archetypeResults.get(archetypeId);
    if (!result) {
      failures.push(`body_archetype_missing:${archetypeId}`);
      continue;
    }
    if (result.pass !== true) failures.push(`body_archetype_failed:${archetypeId}`);
    if (Number(result.score ?? 0) < requiredScore) failures.push(`body_archetype_score_below_required:${archetypeId}:${Number(result.score ?? 0)}<${requiredScore}`);
  }
}

const result = {
  schemaVersion: '2026-05-27',
  claimBoundary: 'promotion gate metadata only; not production, Quest, clinical, legal, or scoring readiness',
  providerGate: providerGatePath,
  scorecard: scorecardPath,
  archetypeEvidence: archetypeEvidencePath,
  requiredArchetypes,
  requiredScore,
  observedScore: score,
  pass: failures.length === 0,
  failures,
  promotionDecision: failures.length === 0 ? 'eligible_for_runtime_candidate_review' : 'do_not_promote_keep_as_candidate_evidence_only',
  requiredEntrypoint: 'tools/openclinxr/garment-ingest-and-fit.mjs',
  cacheReusePolicy: failures.length === 0 ? 'may_mark_cache_entry_reuse_allowed_after_human_review' : 'cache_entry_metadata_only_no_runtime_reuse',
  nextAction: failures.includes('provider_gate_failed')
    ? 'complete source garment/license allowlist before fit/promotion'
    : failures.some((failure) => failure.startsWith('body_archetype_'))
      ? 'run garment fitting and screenshot scoring across required child/adult/body-size archetypes before reuse promotion'
    : 'improve candidate visual score before runtime replacement'
};

await fs.mkdir(path.dirname(path.resolve(root, outputPath)), { recursive: true });
await fs.writeFile(path.resolve(root, outputPath), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ outputPath, pass: result.pass, failures }, null, 2));
