/**
 * Re-derive run-report.json stage pins from the merged code (card tsk_3dc1802d0ca2b36c).
 *
 * Method (same as the report's own rederived.method): two fixture-scale runs
 * of runReplayChain on the tracked manifest (derive size 512, placeholder
 * GLB pin); run1 == run2 on every stage output; the report's stageShas take
 * run1's values. Only beard/detail/browform outputs may change (the merged
 * skin-card flags + the brow_form final); any other changed stage refuses
 * (merge fallout beyond this card — record, do not pin).
 *
 * No static import reaches across the package boundary (architecture
 * freeze): run.js is imported at runtime by path, the same pattern as the
 * station-skin-int flag test. Shas flow from measured files into the
 * report; no value is typed by hand.
 *
 * Usage: pnpm exec tsx tools/openclinxr/evidence/station-skin-int/rederive_run_report.ts
 * (cwd = workspace root).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const CARD = "tsk_3dc1802d0ca2b36c";
const CHAIN = "tools/openclinxr/asset-pipeline/skin/face-replay/chain-manifest.json";
const FIXTURE_ALBEDO = "tools/openclinxr/asset-pipeline/skin/face-replay/fixtures/base-good-A.png";
const REPORT = "packages/openclinxr/stations/face-realism/src/run-report.json";
// Stages whose bytes this card's merged code may change (standalone beard
// gains --vermilion-mask, detail gains --beard-weight, browform reads the
// detail output). Derived from the manifest output_paths below, never
// listed by file name here beyond this comment.
const MAY_CHANGE_STAGES = new Set(["beard_shadow", "detail_bands", "brow_form"]);

function repoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 12; i += 1) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    dir = dirname(dir);
  }
  throw new Error("workspace root (pnpm-workspace.yaml) not found");
}

type RunModule = {
  prepareFixtureReplayDir: (outDir: string, albedo: string, size: number) => { glbFile: string; albedoFile: string };
  runReplayChain: (opts: {
    subject: string;
    manifestFile: string;
    glbFile: string;
    albedoFile: string;
    storeDir: string;
    skipAo: boolean;
    skipStages: string[];
  }) => { finalSha256: string | null; stageShas: Record<string, string>; executedChainStages: string[] };
};

async function main(): Promise<void> {
  const root = repoRoot();
  const runMod = (await import(
    pathToFileURL(join(root, "packages/openclinxr/stations/face-realism/src/run.js")).href
  )) as RunModule;

  const chain = JSON.parse(readFileSync(join(root, CHAIN), "utf8")) as {
    stages: Array<{ name: string; parameters: Record<string, unknown>; output_paths: Record<string, string> }>;
    subjects: Record<string, Record<string, unknown>>;
  };
  const stageToFile = new Map<string, string>();
  for (const stage of chain.stages) {
    const files = Object.values(stage.output_paths ?? {});
    if (files.length > 0) stageToFile.set(stage.name, files[0] as string);
  }

  const runOnce = (): { stageShas: Record<string, string>; executedChainStages: string[]; outDir: string } => {
    const doc = JSON.parse(JSON.stringify(chain)) as typeof chain;
    const first = doc.stages[0];
    const aisha = doc.subjects["aisha"];
    if (first === undefined || aisha === undefined) throw new Error("manifest missing first stage or aisha: refused");
    first.parameters["size"] = 512;
    aisha["glb_sha256"] = "PLACEHOLDER_GLB_SHA256";
    const outDir = join(tmpdir(), `rederive-run-report-${process.pid}-${Math.round(Math.random() * 1e9)}`);
    mkdirSync(outDir, { recursive: true });
    const manifestFile = join(outDir, "man512.json");
    writeFileSync(manifestFile, JSON.stringify(doc));
    const staged = runMod.prepareFixtureReplayDir(outDir, FIXTURE_ALBEDO, 512);
    const result = runMod.runReplayChain({
      subject: "aisha",
      manifestFile,
      glbFile: staged.glbFile,
      albedoFile: staged.albedoFile,
      storeDir: outDir,
      skipAo: true,
      skipStages: [],
    });
    return { stageShas: result.stageShas, executedChainStages: result.executedChainStages, outDir };
  };

  const runA = runOnce();
  const runB = runOnce();
  const names = Object.keys(runA.stageShas).sort();
  const noise = names.filter((name) => runA.stageShas[name] !== runB.stageShas[name]);
  if (noise.length > 0) throw new Error(`refused: fixture run1 != run2 on ${noise.join(",")}`);

  const report = JSON.parse(readFileSync(join(root, REPORT), "utf8")) as {
    executedStages: string[];
    stageShas: Record<string, string>;
    rederived: unknown;
  };
  const oldKeys = Object.keys(report.stageShas).sort();
  const missing = oldKeys.filter((name) => !(name in runA.stageShas));
  if (missing.length > 0) {
    throw new Error(`refused: tracked stage files missing from the run (${missing.join(",")})`);
  }
  const extra = names.filter((name) => !(name in report.stageShas));
  if (JSON.stringify(runA.executedChainStages) !== JSON.stringify(report.executedStages)) {
    throw new Error(
      `refused: executed stages changed (${report.executedStages.join(",")} vs ${runA.executedChainStages.join(",")})`,
    );
  }
  const fileToStage = new Map<string, string>();
  for (const [stage, file] of stageToFile) fileToStage.set(file, stage);
  const changed = oldKeys.filter((name) => runA.stageShas[name] !== report.stageShas[name]);
  const unexpected = changed.filter((name) => !MAY_CHANGE_STAGES.has(fileToStage.get(name) ?? ""));
  if (unexpected.length > 0) {
    throw new Error(
      `refused: unexpected stage output change beyond this card on ${unexpected
        .map((name) => `${fileToStage.get(name)}:${name}`)
        .join(",")}: record, do not pin`,
    );
  }

  for (const name of changed) report.stageShas[name] = runA.stageShas[name] as string;
  report.rederived = {
    date: "2026-10-19",
    method:
      "two fixture-scale runs of runReplayChain on the merged manifest (size 512, placeholder GLB pin), run1 == run2 on every stage output",
    why:
      `station-skin-int ${CARD}: merged detail (beard-weight/underlip spare) + beard (vermilion union) + brow_form final changed standalone bytes; re-pinned from the merged code`,
    changed: changed.map((name) => `${fileToStage.get(name)}:${name}`),
    noise: "run1 == run2 on every stage output",
  };
  const serialized = JSON.stringify(report);
  // Formatting guard: the tracked file is single-line compact JSON.
  if (!readFileSync(join(root, REPORT), "utf8").includes("\n")) {
    writeFileSync(join(root, REPORT), serialized);
  } else {
    writeFileSync(join(root, REPORT), `${serialized}\n`);
  }
  console.log(`rederived ${REPORT}: changed ${changed.length} (${changed.join(",")}); noise none; unpinned run outputs: ${extra.join(",")}`);
}

void main().then(
  () => undefined,
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  },
);
