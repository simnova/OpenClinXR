// Face-realism station shared internals: stage record types, landed-script
// paths, and the subprocess helpers every stage runs through.
//
// Case data lives only in case-inputs.json next to this file. These helpers
// name no case: every per-case value is read from that record at runtime.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { repoRoot } from "@openclinxr/factory-station-core/runner";

export type ChainStage = {
  name?: unknown;
  script?: unknown;
  kind?: unknown;
  type?: unknown;
  parameters?: unknown;
};

export type StageIO = { path: string; sha256: string };

export type StageGate = {
  pass: boolean;
  detail: string;
  knownGood?: { name: string; expected: string; expectedSource: string; actual: string };
};

export type StageRecord = {
  stage: number;
  name: string;
  script: string;
  argv: string[];
  driver?: string;
  note?: string;
  inputs: StageIO[];
  outputs: StageIO[];
  byproducts?: StageIO[];
  unchainedInputs: Array<{ path: string; sha256: string; prevStageOutputs: StageIO[] }>;
  ran: boolean;
  blocked: boolean;
  blockReason?: string;
  blocked_by?: string;
  wanted?: string;
  gate: StageGate;
  wallSeconds: number;
  extra?: Record<string, unknown>;
};

/** Landed stage scripts, relative to the repo root. */
export const TONE_CHECK_REL = "tools/openclinxr/asset-pipeline/skin/families/tone-check.py";
export const TONE_REPORT_REL = "tools/openclinxr/asset-pipeline/skin/families/tone-report.json";
export const FAMILIES_DIR_REL = "tools/openclinxr/asset-pipeline/skin/families";
export const STAGE2_DRIVER_REL =
  "packages/openclinxr/stations/face-realism/src/drivers/stage2_apply_layers.py";
export const MATERIALIZE_REL =
  "tools/openclinxr/evidence/blender/materialize_mpfb_humanoid_candidate.py";
export const LID_CONFORM_DIR_REL = "tools/openclinxr/asset-pipeline/realism-head/lid-conform";
export const POSITION_DRIVER_REL =
  "packages/openclinxr/stations/face-realism/src/drivers/stage4_position_shas.py";
export const COMPOSE_REL =
  "tools/openclinxr/asset-pipeline/skin/face-replay/face_replay_compose.py";
export const COLOUR_REL =
  "tools/openclinxr/asset-pipeline/skin/face-replay/face_replay_colour.py";
export const BEARD_REL =
  "tools/openclinxr/asset-pipeline/skin/face-replay/beard_shadow.py";
export const FIT_REL = "tools/openclinxr/evidence/face-fit/fit_facefit2.py";
export const FIT_DIR_REL = "tools/openclinxr/evidence/face-fit";
export const SHAPE_REL = "tools/openclinxr/evidence/face-shape-clauses/shape_clauses.py";
export const FACE_GATE_MODEL_REL = "tools/openclinxr/evidence/landmarks/models/face_landmarker.task";
export const RUN_REPORT_REL = "packages/openclinxr/stations/face-realism/src/run-report.json";
export const R2_REPORT_REL =
  "tools/openclinxr/evidence/second-subject/second-subject-r2-report.json";
export const R3_REPORT_REL =
  "tools/openclinxr/evidence/second-subject/second-subject-r3-report.json";
export const CASE_INPUTS_REL =
  "packages/openclinxr/stations/face-realism/src/case-inputs.json";

/** Asset-store roots. Large files live here; tracked JSON cites store paths + sha256. */
export const ASSET_STORE_ROOT = "/Volumes/files/openclinxr-assets/store";

/**
 * The 12 package test files allowed to skip when the machine-local store is
 * absent, each with its sentinel(s): every store path the file reads before
 * its first assertion, as paths relative under the store root. The table lives
 * in the sibling asset-store-gate.json data file (this station's G4 rule
 * refuses case-id literals in non-test .ts), loaded once at module load.
 * Adding a file requires editing that data file (the ratchet): an unlisted
 * caller of skipIfStoreAbsent fails loudly instead of skipping.
 */
export const GATED_FILES: Record<string, string | readonly string[]> = JSON.parse(
  readFileSync(
    path.join(repoRoot(), "packages/openclinxr/stations/face-realism/src/asset-store-gate.json"),
    "utf8",
  ),
) as Record<string, string | readonly string[]>;

const STORE_ENV_VAR = "OPENCLINXR_ASSET_STORE";
const STORE_REQUIRE_ENV_VAR = "OPENCLINXR_REQUIRE_ASSET_STORE";
const printedSkips = new Set<string>();

/**
 * Resolve the asset-store root: OPENCLINXR_ASSET_STORE when set non-empty
 * (must be absolute, else throw), otherwise the machine-local literal.
 * Pure: it never checks existence; skipIfStoreAbsent does that.
 */
export function resolveAssetStoreRoot(): string {
  const env = process.env[STORE_ENV_VAR];
  if (env !== undefined && env !== "") {
    if (!path.isAbsolute(env)) {
      throw new Error(`[asset-store] refusing non-absolute ${STORE_ENV_VAR}: ${env}`);
    }
    return env;
  }
  return ASSET_STORE_ROOT;
}

/**
 * The ONLY store-skip mechanism: a pure predicate over the resolved root.
 * Returns true when ANY of the file's sentinels is absent under the root
 * (after printing exactly one `SKIP STORE <file>: asset store absent: <root>`
 * line per file). Throws when the file is not in GATED_FILES, and throws
 * (instead of skipping) when OPENCLINXR_REQUIRE_ASSET_STORE=1.
 */
export function skipIfStoreAbsent(file: string): boolean {
  const entry = GATED_FILES[file];
  if (entry === undefined) {
    throw new Error(`[asset-store] ${file} calls the store gate but is not listed in GATED_FILES`);
  }
  const root = resolveAssetStoreRoot();
  const sentinels = typeof entry === "string" ? [entry] : entry;
  if (sentinels.every((s) => existsSync(path.join(root, s)))) return false;
  if (process.env[STORE_REQUIRE_ENV_VAR] === "1") {
    throw new Error(`asset store required but absent: ${root}`);
  }
  if (!printedSkips.has(file)) {
    printedSkips.add(file);
    console.log(`SKIP STORE ${file}: asset store absent: ${root}`);
  }
  return true;
}

/** Python always runs through the repo-pinned interpreter. The mise trust
 * dir is the current checkout (module-anchored repoRoot), never a
 * machine-local literal: the shared-checkout path does not exist on CI. */
function misePythonArgv(): string[] {
  return ["exec", "-C", repoRoot(), "--", "python3"];
}

/**
 * Subprocess env with model credentials stripped so a model call fails
 * loudly instead of silently succeeding off stored keys.
 */
export function sanitizedFaceRealismEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    const low = key.toLowerCase();
    if (
      low.includes("openai") ||
      low.includes("anthropic") ||
      low.includes("xai") ||
      low.includes("grok") ||
      low.includes("imagine") ||
      low.includes("replicate") ||
      low.includes("hugging") ||
      low.includes("together") ||
      low.includes("cohere") ||
      low.includes("gemini") ||
      low.includes("bedrock")
    ) {
      continue;
    }
    out[key] = value;
  }
  return out;
}

export function sha256Bytes(raw: Buffer): string {
  return createHash("sha256").update(raw).digest("hex");
}

export function sha256File(absPath: string): string {
  return sha256Bytes(readFileSync(absPath));
}

export function runMisePython(args: string[], timeoutMs: number): string {
  const raw = execFileSync("mise", [...misePythonArgv(), ...args], {
    cwd: repoRoot(),
    env: sanitizedFaceRealismEnv(),
    timeout: timeoutMs,
  });
  return String(raw);
}

export function resolveBlender(): string {
  const fromEnv = process.env["OPENCLINXR_BLENDER"];
  if (typeof fromEnv === "string" && fromEnv.length > 0 && existsSync(fromEnv)) return fromEnv;
  for (const cand of ["/opt/homebrew/bin/blender", "/usr/local/bin/blender"]) {
    if (existsSync(cand)) return cand;
  }
  return "blender";
}

export function readJsonFile(absPath: string): Record<string, unknown> {
  return JSON.parse(readFileSync(absPath, "utf8")) as Record<string, unknown>;
}

export function digString(doc: Record<string, unknown>, keys: string[]): string {
  let node: unknown = doc;
  for (const key of keys) {
    if (node === null || typeof node !== "object" || !(key in (node as Record<string, unknown>))) {
      throw new Error(`known-good lookup missed key ${key} (see ${R2_REPORT_REL} / ${RUN_REPORT_REL})`);
    }
    node = (node as Record<string, unknown>)[key];
  }
  if (typeof node !== "string" || node.length === 0) {
    throw new Error(`known-good at ${keys.join(".")} is not a string`);
  }
  return node;
}

export function loadCaseRecord(caseId: string): Record<string, unknown> {
  const doc = readJsonFile(path.join(repoRoot(), CASE_INPUTS_REL)) as {
    cases?: Record<string, Record<string, unknown>>;
  };
  const rec = doc.cases?.[caseId];
  if (rec === undefined) {
    throw new Error(`case inputs hold no record for the planned case (see ${CASE_INPUTS_REL})`);
  }
  return rec;
}

export function caseValue<T>(rec: Record<string, unknown>, key: string): T {
  const entry = rec[key] as { value?: unknown } | undefined;
  if (entry === undefined || entry === null || typeof entry !== "object" || !("value" in entry)) {
    throw new Error(`case record entry ${key} has no value (see ${CASE_INPUTS_REL})`);
  }
  return (entry as { value: T }).value;
}

export function entryString(node: unknown, ...keys: string[]): string {
  let current: unknown = node;
  for (const key of keys) {
    if (current === null || typeof current !== "object" || !(key in (current as Record<string, unknown>))) {
      throw new Error(`case record entry ${keys.join(".")} missing (see ${CASE_INPUTS_REL})`);
    }
    current = (current as Record<string, unknown>)[key];
  }
  if (typeof current !== "string") {
    throw new Error(`case record entry ${keys.join(".")} is not a string (see ${CASE_INPUTS_REL})`);
  }
  return current;
}

/**
 * CARD tsk_27220fbaeb48dab4: per-case brow form argv for the stage-4 bake.
 * A texture case ships the painted albedo brow alone, so the station passes
 * --brow-form texture to the materializer. A mesh case (or an absent
 * brow_form) keeps the current behaviour: no flag. Names no case; the value
 * comes from case-inputs.json cases.<caseId>.brow_form.
 */
export function browFormArgv(caseRec: Record<string, unknown>): string[] {
  const entry = caseRec["brow_form"] as { value?: unknown } | undefined;
  const form =
    entry !== undefined && entry !== null && typeof entry === "object" ? entry.value : undefined;
  return form === "texture" ? ["--brow-form", "texture"] : [];
}

export function pngOutputs(dir: string): StageIO[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((entry) => entry.endsWith(".png"))
    .sort()
    .map((entry) => {
      const abs = path.join(dir, entry);
      return { path: abs, sha256: sha256File(abs) };
    });
}

export function runPositionDriver(glbAbs: string): {
  body: string;
  positionSha256: Record<string, string>;
} {
  const driver = path.join(repoRoot(), POSITION_DRIVER_REL);
  const stdout = runMisePython(
    [driver, "--lid-conform-dir", path.join(repoRoot(), LID_CONFORM_DIR_REL), "--glb", glbAbs],
    300_000,
  );
  return JSON.parse(stdout) as { body: string; positionSha256: Record<string, string> };
}

export function emptyStageRecord(stage: number, name: string): StageRecord {
  return {
    stage,
    name,
    script: "",
    argv: [],
    inputs: [],
    outputs: [],
    unchainedInputs: [],
    ran: false,
    blocked: false,
    gate: { pass: false, detail: "not run" },
    wallSeconds: 0,
  };
}
