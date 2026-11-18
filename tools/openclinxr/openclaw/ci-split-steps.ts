/**
 * ci-split-steps.ts — one turbo-declaration walker + run-command-to-step
 * resolver shared by the CI-SPLIT-READERS assertions (both split-step
 * readers). Test files import this module; it registers no tests itself.
 *
 * THIN-C2: the split steps moved from ci.yml `verify` to nightly.yml
 * `slow-suites`. Names keep the CI-SPLIT-READERS prefix (both readers
 * share them); paths and job lookup point at nightly.yml.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

/** First split-step name in nightly.yml slow-suites. */
export const CI_SPLIT_TOOL_STEP = "Test tools";
/** Second split-step name in nightly.yml slow-suites. */
export const CI_SPLIT_PACKAGES_STEP = "Test packages";

/** Minimal shape of a nightly.yml slow-suites step consumed by the readers. */
export type CiSplitStep = { name?: unknown; run?: unknown; env?: unknown };

/** Turbo declaration texts consumed by the resolver. */
export type TurboDeclarations = { rootTurboJson: string; packageTurboJsons: string[] };

/** Repo root derived from this module file location. */
export function ciSplitRepoRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
}

/** Default absolute path of the slow-suites workflow file (THIN-C2: nightly.yml). */
export function ciSplitYmlPath(root: string = ciSplitRepoRoot()): string {
  return join(root, ".github", "workflows", "nightly.yml");
}

/** Parse slow-suites steps out of nightly.yml text (default: the real file). */
export function readCiSplitVerifySteps(
  yamlText: string = readFileSync(ciSplitYmlPath(), "utf8"),
): CiSplitStep[] {
  const doc = parseYaml(yamlText) as { jobs?: Record<string, { steps?: CiSplitStep[] }> };
  const verify = doc?.jobs?.["slow-suites"];
  if (!verify || !Array.isArray(verify.steps)) throw new Error("[ci-split-readers] nightly.yml has no slow-suites job steps");
  // Fail closed on an empty step list too: downstream "no SAMPLE/SEED set"
  // assertions would otherwise pass vacuously on [].
  if (verify.steps.length === 0) throw new Error("[ci-split-readers] nightly.yml slow-suites has no steps");
  return verify.steps;
}

/** Find a slow-suites step by exact name, throwing when absent. */
export function findCiSplitStep(steps: CiSplitStep[], name: string): CiSplitStep {
  const step = steps.find((s) => s.name === name);
  if (!step) throw new Error(`nightly.yml slow-suites has no step "${name}"`);
  return step;
}

/** Load the live turbo declarations (root plus packages tree). */
export function loadTurboDeclarations(root: string = ciSplitRepoRoot()): TurboDeclarations {
  const rootTurboJson = readFileSync(join(root, "turbo.json"), "utf8");
  const packageTurboJsons: string[] = [];
  const stack = [join(root, "packages")];
  for (;;) {
    const dir = stack.pop();
    if (dir === undefined) break;
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      if (ent.isDirectory()) {
        if (ent.name !== "node_modules") stack.push(join(dir, ent.name));
      }
      else if (ent.name === "turbo.json") packageTurboJsons.push(readFileSync(join(dir, ent.name), "utf8"));
    }
  }
  return { rootTurboJson, packageTurboJsons };
}

/** Env sets collected from turbo declarations. */
export type TurboEnvSets = { globalEnv: string[]; toolsEnv: string[]; packagesTestEnv: string[] };

/** Collect env sets from turbo declaration texts (default: the live repo). */
export function collectTurboEnv(declarations: TurboDeclarations = loadTurboDeclarations()): TurboEnvSets {
  const turbo = JSON.parse(declarations.rootTurboJson) as {
    globalEnv?: unknown;
    tasks?: Record<string, { env?: unknown }>;
  };
  const globalEnv = Array.isArray(turbo.globalEnv)
    ? turbo.globalEnv.filter((e): e is string => typeof e === "string")
    : [];
  const toolsEnv = new Set<string>();
  for (const [taskName, task] of Object.entries(turbo.tasks ?? {})) {
    if (taskName.startsWith("//#test:tools:") && Array.isArray(task?.env)) {
      for (const e of task.env) if (typeof e === "string") toolsEnv.add(e);
    }
  }
  const packagesTestEnv = new Set<string>();
  for (const text of declarations.packageTurboJsons) {
    const pkg = JSON.parse(text) as { tasks?: Record<string, { env?: unknown }> };
    const env = pkg?.tasks?.["test"]?.env;
    if (Array.isArray(env)) for (const e of env) if (typeof e === "string") packagesTestEnv.add(e);
  }
  return { globalEnv, toolsEnv: [...toolsEnv], packagesTestEnv: [...packagesTestEnv] };
}

/** True when a step run is a turbo test entrypoint. */
export function isTurboTestEntrypointRun(run: unknown): boolean {
  return typeof run === "string" && (run.includes("pnpm test:tools") || run.includes("pnpm packages:test"));
}

/** Derive expected step names for one var from turbo + step runs. */
export function expectedStepsForVar(
  varName: string,
  yamlText: string = readFileSync(ciSplitYmlPath(), "utf8"),
  declarations: TurboDeclarations = loadTurboDeclarations(),
): string[] {
  const steps = readCiSplitVerifySteps(yamlText);
  const env = collectTurboEnv(declarations);
  const out: string[] = [];
  for (const step of steps) {
    const name = String(step.name);
    const run = typeof step.run === "string" ? step.run : "";
    const isToolsRun = run.includes("pnpm test:tools");
    const isPackagesRun = run.includes("pnpm packages:test");
    if (!isToolsRun && !isPackagesRun) continue;
    if (env.globalEnv.includes(varName)) {
      out.push(name);
      continue;
    }
    if (isToolsRun && env.toolsEnv.includes(varName)) out.push(name);
    else if (isPackagesRun && env.packagesTestEnv.includes(varName)) out.push(name);
  }
  return out;
}
