/**
 * #237 TRELLIS Metal per-subject process isolation — one fresh OS process per subject.
 *
 * #235: ecg-cart exported successfully in a shared process; wall-clock and bedside-monitor
 * failed with MPS OOM (~113 GiB accumulated). This module spawns a FRESH Python child_process
 * for each subject, so no torch MPS context is ever reused across subjects.
 *
 * Each subject gets its own:
 *  - child_process.execFile of run_bake_isolated.py
 *  - fresh Python venv process (trellis2-apple)
 *  - exit after export — context freed by OS
 *
 * After bake: runs gltf-transform simplify post-opt on every exported GLB.
 *
10→ * Header IMMUTABLE — append ## FIXED (#237).
 */

/**
 * ## FIXED (#273) — live TRELLIS bake is now opt-in.
 *
 * The bake cache lives under .openclinxr/evidence/ (gitignored), absent by design
 * in every git worktree. The default suite (pnpm test:tools -> vitest run tools/)
 * reaches this module, so any worker running a broad test command used to pay a
 * multi-hour bake from scratch. trellisLiveBakeGate() now refuses a NEW bake unless
 * TRELLIS_LIVE_BAKE_OPT_IN=1 (proven by trellis-live-bake-gate.test.ts via an
 * injected runner — no spawn path); an existing usable bake-measure.json cache is
 * still always used when present, and the opt-in path still reaches runBakeProcess.
 */

import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { simplify } from "@gltf-transform/functions";
import { MeshoptSimplifier } from "meshoptimizer";

const __dirname = path.resolve(fileURLToPath(import.meta.url), "..");
const REPO_ROOT = path.resolve(__dirname, "../../..");

// ---------------------------------------------------------------------------
// Types (match planted test contract)
// ---------------------------------------------------------------------------

export type SubjectVerdict =
  | "mesh_exported"
  | "runs_but_over_budget"
  | "blocked_build"
  | "inconclusive_blocked";

export type SubjectRow = {
  subjectId: string;
  displayName: string;
  verdict: SubjectVerdict;
  verdictReason: string;
  processIsolation: "fresh_subprocess" | "same_process" | "unknown";
  rawTriangleCount: number | null;
  postOptTriangleCount: number | null;
  exportPath: string | null;
  postOptPath: string | null;
  exportBytes: number | null;
  postOptBytes: number | null;
  wallClockS: number | null;
  stages: Record<string, unknown>;
};

export type IsolationReport = {
  schemaVersion: "openclinxr.trellis-subject-isolation.v1";
  issue: "237";
  factoryStep: "equipment_generate";
  generatedAt: string;
  isolationMode: string;
  subjects: SubjectRow[];
  claimScope: string[];
  notEvidenceFor: string[];
};

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const ISSUE_237_DIR = path.resolve(REPO_ROOT, ".openclinxr/evidence/issue-237");
const REPORT_PATH = path.join(ISSUE_237_DIR, "isolation-report.json");
const ISOLATION_LOG_PATH = path.join(ISSUE_237_DIR, "isolation-log.json");

// Input images from #232 packs (in #235 worktree — gitignored, absolute reference)
const PACKS_235_BASE =
  "/Users/patrick/.grok/worktrees/src-openclinxr/issue-235/.openclinxr/evidence/issue-232";

const TRELLIS_ROOT = path.resolve(
  process.env.HOME ?? "/Users/patrick",
  ".openclinxr-tools/trellis2-apple/src",
);
const VENV_PYTHON = path.resolve(
  process.env.HOME ?? "/Users/patrick",
  ".openclinxr-tools/trellis2-apple/venv/bin/python3",
);
const WEIGHTS_PATH = path.resolve(
  process.env.HOME ?? "/Users/patrick",
  "ComfyUI/models/trellis2",
);
const DINOV3_PATH = path.resolve(
  process.env.HOME ?? "/Users/patrick",
  "ComfyUI/models/dinov3",
);

// Previously OOM-class subjects from #235 (the two that failed in shared process)
const SUBJECTS: Array<{
  subjectId: string;
  displayName: string;
  inputImage: string;
}> = [
  {
    subjectId: "wall-clock",
    displayName: "wall clinical / exam-room analog clock",
    inputImage: path.join(PACKS_235_BASE, "wall-clock", "front.png"),
  },
  {
    subjectId: "bedside-monitor",
    displayName: "multi-parameter bedside monitor",
    inputImage: path.join(PACKS_235_BASE, "bedside-monitor", "front.png"),
  },
];

// ---------------------------------------------------------------------------
// #273 live-bake gate — the bake cache is gitignored, so a live bake must be opt-in
// ---------------------------------------------------------------------------

export const TRELLIS_LIVE_BAKE_OPT_IN_ENV = "TRELLIS_LIVE_BAKE_OPT_IN";

export type TrellisLiveBakeDecision =
  | "refuse_opt_in_required"
  | "allow_live_bake"
  | "use_cache";

/**
 * Pure decision table for #273.
 *
 *   { optIn:false, cachePresent:false } -> "refuse_opt_in_required"
 *   { optIn:true,  cachePresent:false } -> "allow_live_bake"  // COUNTERWEIGHT
 *   { optIn:false, cachePresent:true  } -> "use_cache"
 *
 * The middle row is the counterweight: the live bake must stay openable or this
 * closes by deleting #237's coverage (the #40 mistake).
 */
export function trellisLiveBakeGate(input: {
  optIn: boolean;
  cachePresent: boolean;
}): TrellisLiveBakeDecision {
  if (input.cachePresent) return "use_cache";
  if (input.optIn) return "allow_live_bake";
  return "refuse_opt_in_required";
}

/** True when the caller explicitly opted into a live TRELLIS bake. */
export function isTrellisLiveBakeOptedIn(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[TRELLIS_LIVE_BAKE_OPT_IN_ENV] === "1";
}

// ---------------------------------------------------------------------------
// GLB triangle counting
// ---------------------------------------------------------------------------

async function countTriangles(glbPath: string): Promise<number> {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const doc = await io.read(glbPath);
  let tris = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const indices = prim.getIndices();
      if (indices) {
        tris += indices.getCount() / 3;
      } else {
        const pos = prim.getAttribute("POSITION");
        if (pos) tris += pos.getCount() / 3;
      }
    }
  }
  return Math.round(tris);
}

// ---------------------------------------------------------------------------
// Post-opt: gltf-transform simplify with meshoptimizer
// ---------------------------------------------------------------------------

async function runPostOpt(inputPath: string, outputPath: string): Promise<number> {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const doc = await io.read(inputPath);

  await MeshoptSimplifier.ready;
  await doc.transform(
    simplify({
      simplifier: MeshoptSimplifier,
      ratio: 0.10,
      error: 0.002,
      lockBorder: true,
    }),
  );

  mkdirSync(path.dirname(outputPath), { recursive: true });
  await io.write(outputPath, doc);

  return countTriangles(outputPath);
}

// ---------------------------------------------------------------------------
// Spawn a single-subject Python bake in a fresh OS process
// ---------------------------------------------------------------------------

interface BakeResult {
  subjectId: string;
  displayName?: string;
  verdict: string;
  verdictReason?: string;
  stages?: Record<string, unknown>;
  rawTriangleCount?: number | null;
  exportPath?: string | null;
  exportBytes?: number | null;
  texturedPbr?: string;
  wallClockS?: number | null;
  processIsolation?: string;
  claimScope?: string[];
  notEvidenceFor?: string[];
}

/**
 * A bake runner: given a subject, its output dir and the ambient env, produce a
 * BakeResult. The production implementation is `runBakeProcess` (a fresh Python
 * subprocess per subject — the #237 isolation guarantee). Tests inject a stub so
 * the #273 wiring can be proven without any path that can spawn a real bake.
 */
type RunBake = (
  subject: { subjectId: string; displayName: string; inputImage: string },
  outputDir: string,
  env: NodeJS.ProcessEnv,
) => Promise<BakeResult>;

interface SpawnPythonBakeDeps {
  /** Injected bake runner (tests). Defaults to runBakeProcess (execFile). */
  runBake?: RunBake;
  /** Injected ambient env (tests). Defaults to process.env. */
  env?: NodeJS.ProcessEnv;
  /** Injected output dir (tests). Defaults to ISSUE_237_DIR/<subjectId>. */
  outputDir?: string;
}

/**
 * Production bake runner — the ONLY place a Python TRELLIS process is spawned.
 * One fresh child_process per subject (the #237 isolation guarantee).
 */
function runBakeProcess(
  subject: { subjectId: string; displayName: string; inputImage: string },
  outputDir: string,
  env: NodeJS.ProcessEnv,
): Promise<BakeResult> {
  return new Promise((resolve, reject) => {
    const scriptPath = path.resolve(__dirname, "blender/run_bake_isolated.py");

    const args = [
      scriptPath,
      "--subject-id", subject.subjectId,
      "--display-name", subject.displayName,
      "--input-image", subject.inputImage,
      "--output-dir", outputDir,
      "--weights-path", WEIGHTS_PATH,
      "--dinov3-path", DINOV3_PATH,
      "--trellis-root", TRELLIS_ROOT,
    ];

    console.log(`\n[ISOLATION] Spawning fresh process for ${subject.subjectId}...`);
    console.log(`[ISOLATION]   Python: ${VENV_PYTHON}`);
    console.log(`[ISOLATION]   Input:  ${subject.inputImage}`);
    console.log(`[ISOLATION]   Output: ${outputDir}`);

    const child = execFile(
      VENV_PYTHON,
      args,
      {
        cwd: TRELLIS_ROOT,
        env: {
          ...env,
          PYTHONUNBUFFERED: "1",
          PYTORCH_ENABLE_MPS_FALLBACK: "1",
        },
        timeout: 3_600_000, // 60 min per subject (shape gen is slow)
        maxBuffer: 10 * 1024 * 1024, // 10 MB stdout
      },
      (err, stdout, stderr) => {
        if (stdout) console.log(stdout);
        if (stderr) console.error(stderr);

        // Read bake-measure.json regardless of exit code
        const measurePath = path.join(outputDir, "bake-measure.json");
        if (existsSync(measurePath)) {
          try {
            const raw = readFileSync(measurePath, "utf-8");
            const result = JSON.parse(raw) as BakeResult;
            console.log(`[ISOLATION] ${subject.subjectId}: verdict=${result.verdict}, ` +
              `tris=${result.rawTriangleCount ?? "null"}, time=${result.wallClockS ?? "?"}s`);
            resolve(result);
          } catch (parseErr) {
            reject(new Error(`Failed to parse bake-measure.json for ${subject.subjectId}: ${parseErr}`));
          }
        } else if (err) {
          // No output — write a blocked entry manually
          const blocked: BakeResult = {
            subjectId: subject.subjectId,
            verdict: "blocked_build",
            verdictReason: `Child process failed (exit ${err.message ?? "unknown"}). No bake-measure.json written.`,
            processIsolation: "fresh_subprocess",
            stages: {},
          };
          writeFileSync(measurePath, JSON.stringify(blocked, null, 2) + "\n");
          resolve(blocked);
        } else {
          reject(new Error(`No bake-measure.json for ${subject.subjectId} and no error reported`));
        }
      },
    );

    child.on("error", (spawnErr) => {
      console.error(`[ISOLATION] Failed to spawn ${subject.subjectId}: ${spawnErr.message}`);
      const measurePath = path.join(outputDir, "bake-measure.json");
      const blocked: BakeResult = {
        subjectId: subject.subjectId,
        verdict: "blocked_build",
        verdictReason: `Failed to spawn Python process: ${spawnErr.message}`,
        processIsolation: "fresh_subprocess",
        stages: {},
      };
      writeFileSync(measurePath, JSON.stringify(blocked, null, 2) + "\n");
      resolve(blocked);
    });
  });
}

/**
 * Per-subject bake entry. #273: the bake cache lives under .openclinxr/evidence/
 * (gitignored), so it is absent by design in every git worktree; without a gate,
 * any worker running a broad test command paid a multi-hour TRELLIS bake from
 * scratch. A NEW bake is refused unless TRELLIS_LIVE_BAKE_OPT_IN=1, while the
 * #237 live-bake path stays reachable (the counterweight). An existing usable
 * bake-measure.json is always used (idempotent) — the gate only decides whether
 * a NEW bake may start.
 */
export function spawnPythonBake(
  subject: { subjectId: string; displayName: string; inputImage: string },
  deps: SpawnPythonBakeDeps = {},
): Promise<BakeResult> {
  const outputDir = deps.outputDir ?? path.join(ISSUE_237_DIR, subject.subjectId);
  const env = deps.env ?? process.env;
  mkdirSync(outputDir, { recursive: true });

  // Existing usable bake-measure.json → use cache (skip re-bake).
  const existingMeasure = path.join(outputDir, "bake-measure.json");
  if (existsSync(existingMeasure)) {
    try {
      const raw = readFileSync(existingMeasure, "utf-8");
      const existing = JSON.parse(raw) as BakeResult;
      const verdict = existing.verdict;
      if (verdict === "mesh_exported" || verdict === "runs_but_over_budget" || verdict === "blocked_build") {
        console.log(`[ISOLATION] ${subject.subjectId}: existing bake found (verdict=${verdict}) — skipping re-bake`);
        return Promise.resolve(existing);
      }
      // inconclusive_blocked — falls through to the gate (may re-bake on opt-in)
      console.log(`[ISOLATION] ${subject.subjectId}: existing bake is inconclusive — re-baking`);
    } catch {
      // corrupt — falls through to the gate
      console.log(`[ISOLATION] ${subject.subjectId}: existing bake-measure.json corrupt — re-baking`);
    }
  }

  // #273: a live bake (new Python process) requires explicit opt-in. No usable
  // cache exists here — a usable one returned above — so the gate's cachePresent
  // input is false at this point and the gate decides refuse vs allow.
  const decision = trellisLiveBakeGate({
    optIn: isTrellisLiveBakeOptedIn(env),
    cachePresent: false,
  });

  if (decision === "refuse_opt_in_required") {
    // Deliberately NOT persisted to bake-measure.json: an opt-in re-run must
    // still be able to bake this subject rather than read a stale "refused" cache.
    const refused: BakeResult = {
      subjectId: subject.subjectId,
      verdict: "blocked_build",
      verdictReason:
        `Live TRELLIS bake refused: set ${TRELLIS_LIVE_BAKE_OPT_IN_ENV}=1 to opt in ` +
        `(no cached bake-measure.json in this tree)`,
      processIsolation: "fresh_subprocess",
      stages: {},
    };
    console.log(`[ISOLATION] ${subject.subjectId}: live bake refused — ${TRELLIS_LIVE_BAKE_OPT_IN_ENV}=1 required`);
    return Promise.resolve(refused);
  }

  // decision === "allow_live_bake"
  return (deps.runBake ?? runBakeProcess)(subject, outputDir, env);
}

// ---------------------------------------------------------------------------
// Main inspect function (called by vitest contract)
// ---------------------------------------------------------------------------

let cached: IsolationReport | null = null;

export async function inspectTrellisMetalSubjectIsolation(): Promise<IsolationReport> {
  if (cached) return cached;

  mkdirSync(ISSUE_237_DIR, { recursive: true });
  await MeshoptSimplifier.ready;

  // --- Phase 1: Bake each subject in a fresh OS process (serial for safety) ---
  const bakeResults: BakeResult[] = [];

  for (const subject of SUBJECTS) {
    // Check input image exists
    if (!existsSync(subject.inputImage)) {
      console.warn(`[ISOLATION] Input image missing for ${subject.subjectId}: ${subject.inputImage} — skipping`);
      bakeResults.push({
        subjectId: subject.subjectId,
        verdict: "blocked_build",
        verdictReason: `Input image not found at ${subject.inputImage}`,
        processIsolation: "fresh_subprocess",
        stages: {},
      });
      continue;
    }

    try {
      const result = await spawnPythonBake(subject);
      bakeResults.push(result);
    } catch (err) {
      console.error(`[ISOLATION] ${subject.subjectId}: unexpected error: ${err}`);
      bakeResults.push({
        subjectId: subject.subjectId,
        verdict: "blocked_build",
        verdictReason: `Unexpected error: ${String(err)}`,
        processIsolation: "fresh_subprocess",
        stages: {},
      });
    }

    // Brief pause between subjects to let the OS fully reclaim memory
    console.log(`[ISOLATION] Pausing 5s before next subject...`);
    await new Promise((r) => setTimeout(r, 5000));
  }

  // --- Phase 2: Post-opt each exported mesh ---
  const subjects: SubjectRow[] = [];

  for (const bake of bakeResults) {
    const subjectId = bake.subjectId;
    const displayName = bake.displayName ?? subjectId;
    const rawTris = bake.rawTriangleCount ?? null;
    const exportPath = bake.exportPath ?? null;
    const exportBytes = bake.exportBytes ?? null;

    let verdict: SubjectVerdict;
    if (bake.verdict === "mesh_exported") {
      verdict = "mesh_exported";
    } else if (bake.verdict === "blocked_build" || bake.verdict === "blocked_model") {
      verdict = "blocked_build";
    } else {
      verdict = "inconclusive_blocked";
    }

    let postOptTris: number | null = null;
    let postOptPath: string | null = null;
    let postOptBytes: number | null = null;

    if (verdict === "mesh_exported" && exportPath && existsSync(exportPath)) {
      try {
        const optDir = path.join(ISSUE_237_DIR, subjectId);
        mkdirSync(optDir, { recursive: true });
        const optGlb = path.join(optDir, `${subjectId}-postopt.glb`);
        postOptTris = await runPostOpt(exportPath, optGlb);
        postOptPath = optGlb;
        postOptBytes = existsSync(optGlb) ? statSync(optGlb).size : null;

        // MADR 0050: if still over 180k after post-opt, mark runs_but_over_budget
        if (postOptTris > 180_000) {
          verdict = "runs_but_over_budget";
        }
      } catch (err) {
        console.warn(`[ISOLATION] Post-opt failed for ${subjectId}: ${err}`);
      }
    }

    subjects.push({
      subjectId,
      displayName,
      verdict,
      verdictReason: bake.verdictReason ??
        `Bake verdict: ${bake.verdict}, raw tris: ${rawTris}, post-opt: ${postOptTris}`,
      processIsolation: "fresh_subprocess",
      rawTriangleCount: rawTris,
      postOptTriangleCount: postOptTris,
      exportPath,
      postOptPath,
      exportBytes,
      postOptBytes,
      wallClockS: bake.wallClockS ?? null,
      stages: (bake.stages as Record<string, unknown>) ?? {},
    });
  }

  // --- Phase 3: If ALL subjects are still blocked, write isolation-log.json ---
  const exported = subjects.filter(
    (s) => s.verdict === "mesh_exported" || s.verdict === "runs_but_over_budget",
  );
  if (exported.length === 0) {
    const oomLog = {
      note: "All subjects remain blocked under fresh-subprocess isolation",
      processIsolation: "fresh_subprocess",
      generatedAt: new Date().toISOString(),
      subjects: subjects.map((s) => ({
        subjectId: s.subjectId,
        verdict: s.verdict,
        verdictReason: s.verdictReason,
        stages: s.stages,
      })),
    };
    writeFileSync(ISOLATION_LOG_PATH, JSON.stringify(oomLog, null, 2) + "\n");
    console.log(`[ISOLATION] All subjects blocked — wrote isolation-log.json`);
  }

  // --- Assemble report ---
  const report: IsolationReport = {
    schemaVersion: "openclinxr.trellis-subject-isolation.v1",
    issue: "237",
    factoryStep: "equipment_generate",
    generatedAt: new Date().toISOString(),
    isolationMode: "fresh_subprocess_per_subject",
    subjects,
    claimScope: [
      "TRELLIS Metal per-subject process isolation — fresh OS process (child_process.execFile) per subject",
      "No shared torch MPS context across subjects (process exit frees GPU memory)",
      "per-subject raw and post-opt triangle counts (MADR 0050)",
      "gltf-transform simplify via meshoptimizer post-opt on every exported mesh",
      "MIT model + MIT Metal packages + local DINOv3",
      "factory_step equipment_generate input material pipeline",
    ],
    notEvidenceFor: [
      "Quest 3 readiness",
      "clinical accuracy or device equivalence claims",
      "production adoption into learner runtime",
      "replacement of parametric equipment builders",
      "exam equivalence or clinical validity",
    ],
  };

  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + "\n");
  console.log(`[ISOLATION] Report written to ${REPORT_PATH}`);
  cached = report;
  return report;
}
