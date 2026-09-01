#!/usr/bin/env tsx
/**
 * #238 Factory CLI: pnpm factory:trellis:bake --subject <id>
 *
 * Wraps run_bake_isolated.py (#237) as a stable factory station so operators
 * and agents invoke `pnpm factory:trellis:bake --subject wall-clock`, not ad-hoc
 * shell scripts under evidence/.
 *
 * Each invocation spawns a **fresh OS subprocess** per subject — no shared
 * torch MPS context across subjects (the isolation guarantee from #237).
 *
 * Multi-view (#255 + operator pack spec 2026-08-10): subject registry lists
 * all pack views; liveBake/dry-run pass every existing PNG as repeated
 * `--input-image`. run_bake_isolated.py concatenates embeddings when N>1.
 * front.png remains first (canonical). Missing views are skipped; only-front
 * packs stay single-view compatible.
 *
 * --dry-run    prints JSON plan (no GPU)
 * --validate-latest  reads last bake report without re-baking (COUNTERWEIGHT)
 *
 * Header IMMUTABLE — append ## FIXED (#238). Multi-view append 2026-08-10.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const REPO_ROOT = path.resolve(import.meta.dirname ?? __dirname, "../../../..");

const EVIDENCE_ROOT = path.join(REPO_ROOT, ".openclinxr", "evidence");

/** Default output root for trellis bakes — overridable via OPENCLINXR_TRELLIS_OUT. */
function trellisOutRoot(): string {
  return process.env.OPENCLINXR_TRELLIS_OUT ?? path.join(EVIDENCE_ROOT, "trellis-bake");
}

const VENV_PYTHON = path.resolve(
  process.env.HOME ?? "/Users/patrick",
  ".openclinxr-tools/trellis2-apple/venv/bin/python3",
);
const TRELLIS_ROOT = path.resolve(
  process.env.HOME ?? "/Users/patrick",
  ".openclinxr-tools/trellis2-apple/src",
);
const WEIGHTS_PATH = path.resolve(
  process.env.HOME ?? "/Users/patrick",
  "ComfyUI/models/trellis2",
);
const DINOV3_PATH = path.resolve(
  process.env.HOME ?? "/Users/patrick",
  "ComfyUI/models/dinov3",
);

const RUN_BAKE_SCRIPT = path.join(
  REPO_ROOT,
  "tools/openclinxr/evidence/blender/run_bake_isolated.py",
);

// ---------------------------------------------------------------------------
// Subject registry — maps subject ids to multi-view pack paths
// ---------------------------------------------------------------------------

/** Preferred 4-view pack filenames (front first = canonical). */
const STANDARD_VIEW_NAMES = [
  "front.png",
  "side.png",
  "three_quarter_left.png",
  "three_quarter_right.png",
] as const;

interface SubjectEntry {
  subjectId: string;
  displayName: string;
  /**
   * Relative paths under the packs root. front.png must be first (canonical).
   * liveBake/dry-run pass every path that exists; missing views are skipped.
   */
  viewRels: string[];
}

/**
 * Pack source resolution order:
 *  1. OPENCLINXR_TRELLIS_PACKS env var (absolute path to packs root)
 *  2. .openclinxr/evidence/issue-232/ in this repo (local packs)
 *  3. Absolute fallback to #235 worktree packs (#237 used this)
 */
function resolvePackPath(rel: string): string {
  const env = process.env.OPENCLINXR_TRELLIS_PACKS;
  if (env) return path.join(env, rel);

  const tracked = path.join(REPO_ROOT, "tools/openclinxr/asset-pipeline/trellis/packs", rel);
  if (existsSync(tracked)) return tracked;

  const local = path.join(EVIDENCE_ROOT, "issue-232", rel);
  if (existsSync(local)) return local;

  // Absolute fallback — #235 worktree packs (gitignored, may not exist in all worktrees)
  return path.join(
    "/Users/patrick/.grok/worktrees/src-openclinxr/issue-235",
    ".openclinxr/evidence/issue-232",
    rel,
  );
}

/** Build standard 4-view rels for a pack folder name. */
function packViewRels(folder: string): string[] {
  return STANDARD_VIEW_NAMES.map((name) => `${folder}/${name}`);
}

/**
 * Resolve existing pack images for a subject (absolute paths, front-first order).
 * Filters out missing files so incomplete packs degrade to single-view.
 */
function resolveExistingViewPaths(entry: SubjectEntry): string[] {
  return entry.viewRels
    .map((rel) => resolvePackPath(rel))
    .filter((p) => existsSync(p));
}

const KNOWN_SUBJECTS: SubjectEntry[] = [
  {
    subjectId: "wall-clock",
    displayName: "wall clinical / exam-room analog clock",
    viewRels: packViewRels("wall-clock"),
  },
  {
    subjectId: "bedside-monitor",
    displayName: "multi-parameter bedside monitor",
    viewRels: packViewRels("bedside-monitor"),
  },
  {
    subjectId: "ecg-cart",
    displayName: "12-lead ECG cart",
    viewRels: packViewRels("ecg-cart"),
  },
  {
    subjectId: "ecg-cart-imagine-box",
    displayName: "12-lead ECG cart Imagine-box hard-surface 4-view (not PACK_A #232)",
    viewRels: packViewRels("ecg-cart-imagine-box"),
  },
  {
    // Stab E midband kit (parametric) → clean Blender 4-view pack → TRELLIS multi-view.
    // Pack root: OPENCLINXR_TRELLIS_PACKS=.openclinxr/evidence/trellis-packs
    subjectId: "ecg-cart-midband",
    displayName: "12-lead ECG cart midband kit (Stab E)",
    viewRels: packViewRels("ecg-cart-midband"),
  },
  {
    // 6-view experiment: top, left, right, bottom, ¾ top-left-front, ¾ bottom-right-back.
    subjectId: "ecg-cart-midband-6view",
    displayName: "12-lead ECG cart midband kit 6-view (cardinal+oblique)",
    viewRels: [
      "ecg-cart-midband-6view/top.png",
      "ecg-cart-midband-6view/left.png",
      "ecg-cart-midband-6view/right.png",
      "ecg-cart-midband-6view/bottom.png",
      "ecg-cart-midband-6view/three_quarter_top_left_front.png",
      "ecg-cart-midband-6view/three_quarter_bottom_right_back.png",
    ],
  },
  {
    // Fidelity experiment: ONLY two eye-level ¾ views; no post-opt; goal output≈input kit.
    subjectId: "ecg-cart-midband-2tq",
    displayName: "12-lead ECG cart midband kit 2× three-quarter (fidelity)",
    viewRels: [
      "ecg-cart-midband-2tq/three_quarter_left.png",
      "ecg-cart-midband-2tq/three_quarter_right.png",
    ],
  },
  {
    // Fidelity: ONLY high ¾ top-left-front + low ¾ bottom-right-back (no post-opt).
    subjectId: "ecg-cart-midband-2oblique",
    displayName: "12-lead ECG cart midband kit high-TLF + low-BRB (fidelity)",
    viewRels: [
      "ecg-cart-midband-2oblique/three_quarter_top_left_front.png",
      "ecg-cart-midband-2oblique/three_quarter_bottom_right_back.png",
    ],
  },
  {
    subjectId: "iv-pole",
    displayName: "IV pole equipment",
    viewRels: packViewRels("iv_pole_equipment"),
  },
  {
    subjectId: "o2-port",
    displayName: "wall oxygen port equipment",
    viewRels: packViewRels("oxygen_wall_port_equipment"),
  },
  {
    // Escape-hatch subjects: single upper-¾ ALPHA view (no standard 4-view pack).
    // Pack root: OPENCLINXR_TRELLIS_PACKS=.openclinxr/evidence/trellis-packs
    subjectId: "iv-pole-escape",
    displayName: "IV pole (escape-hatch) — single upper-¾ ALPHA view",
    viewRels: ["iv-pole-escape/three_quarter_upper_alpha.png"],
  },
  {
    subjectId: "bedside-monitor-escape",
    displayName: "Bedside monitor (escape-hatch) — single upper-¾ ALPHA view",
    viewRels: ["bedside-monitor-escape/three_quarter_upper_alpha.png"],
  },
  {
    subjectId: "wall-clock-escape",
    displayName: "Wall clock (escape-hatch) — single upper-¾ ALPHA view",
    viewRels: ["wall-clock-escape/three_quarter_upper_alpha.png"],
  },
  {
    subjectId: "o2-port-escape",
    displayName: "O2 port (escape-hatch) — single upper-¾ ALPHA view",
    viewRels: ["o2-port-escape/three_quarter_upper_alpha.png"],
  },
  {
    subjectId: "iv-pump-escape",
    displayName: "IV pump (escape-hatch) — single upper-¾ ALPHA view",
    viewRels: ["iv-pump-escape/three_quarter_upper_alpha.png"],
  },
  {
    subjectId: "fetal-monitor-escape",
    displayName: "Fetal monitor (escape-hatch) — single upper-¾ ALPHA view",
    viewRels: ["fetal-monitor-escape/three_quarter_upper_alpha.png"],
  },
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SamplerKnobs {
  steps?: number;
  guidance_strength?: number;
  guidance_rescale?: number;
  rescale_t?: number;
  guidance_interval?: [number, number];
}

interface SamplerOverrides {
  ss: Partial<SamplerKnobs>;
  shape: Partial<SamplerKnobs>;
  tex: Partial<SamplerKnobs>;
}

/** #662 flags the caller actually set (null = leave the pipeline default in place). */
interface NumericFlags {
  seed: number | null;
  decimationTarget: number | null;
  textureSize: number | null;
}

interface DryRunPlan {
  subjectId: string;
  displayName: string;
  processIsolation: "fresh_subprocess";
  /** Canonical front (first resolved view), for backward-compatible consumers. */
  inputImagePath: string | null;
  /** All resolved pack views (front first). Empty if no images on disk. */
  inputImagePaths: string[];
  viewCount: number;
  conditioning: "single-view" | "multi-view" | "no-images";
  outputDir: string;
  venvPython: string;
  trellisRoot: string;
  weightsPath: string;
  dinov3Path: string;
  seed: number | null;
  hfDemo: boolean;
  remesh: boolean;
  noRemesh: boolean;
  decimationTarget: number | null;
  textureSize: number | null;
  samplerOverrides: SamplerOverrides;
  mode: "dry-run";
}

interface BakeMeasure {
  subjectId?: string;
  displayName?: string;
  verdict?: string;
  verdictReason?: string;
  rawTriangleCount?: number | null;
  exportPath?: string | null;
  exportBytes?: number | null;
  wallClockS?: number | null;
  stages?: Record<string, unknown>;
}

interface ValidateResult {
  subjectId?: string;
  status: "valid" | "missing_report" | "missing_subject_dir";
  rawTriangleCount?: number | null;
  exportBytes?: number | null;
  verdict?: string;
  reportPath?: string;
}

// ---------------------------------------------------------------------------
// --help
// ---------------------------------------------------------------------------

const HELP_TEXT = `factory:trellis:bake — TRELLIS Metal single-subject isolated bake

USAGE
  pnpm factory:trellis:bake --subject <id>       Full GPU bake (fresh subprocess per subject)
  pnpm factory:trellis:bake --subject <id> --dry-run   Print JSON plan, no GPU
  pnpm factory:trellis:bake --validate-latest          Read last bake report without re-baking
  pnpm factory:trellis:bake --help                      This help

  pnpm factory:trellis:bake:validate                    Alias for --validate-latest

FLAGS
  --seed <n>        Explicit seed (default: deterministic derivation from subject id)
  --hf-demo         Record + pass HF Space demo sampler params
  --remesh          Space-order remesh: simplify(16_777_216) then remesh band=1 project=0
  --no-remesh       Force remesh off (default)

SAMPLER KNOBS (#662 — all optional; only passed values override the pipeline defaults;
run_bake_isolated.py merges them over pipeline.json, user value wins):
  --ss-steps <n>                  sparse structure sampler steps (default 12)
  --ss-guidance-strength <f>      ss guidance strength (default 7.5)
  --ss-guidance-rescale <f>       ss guidance rescale (default 0.7)
  --ss-guidance-interval <lo hi>  ss guidance interval (default 0.6 1.0)
  --ss-rescale-t <f>              ss t rescale (default 5.0)
  --shape-steps <n>               shape slat steps (default 12)
  --shape-guidance-strength <f>   shape guidance strength (default 7.5)
  --shape-guidance-rescale <f>    shape guidance rescale (default 0.5)
  --shape-guidance-interval <lo hi>  shape guidance interval (default 0.6 1.0)
  --shape-rescale-t <f>           shape t rescale (default 3.0)
  --tex-steps <n>                 texture slat steps (default 12)
  --tex-guidance-strength <f>     tex guidance strength (default 1.0)
  --tex-guidance-rescale <f>      tex guidance rescale (default 0.0)
  --tex-guidance-interval <lo hi>  tex guidance interval (default 0.6 0.9)
  --tex-rescale-t <f>             tex t rescale (default 3.0)

EXPORT (#662 — previously declared in Python but not forwarded by this CLI):
  --decimation-target <n>         Final decimation target faces (default 300000)
  --texture-size <n>              Baked texture resolution (default 2048)

The bake records the effective merged sampler table in bake-measure.json under
"effectiveSamplerParams"; explicit overrides are echoed under "samplerOverrides".
--hf-demo keeps writing "samplerParams" exactly as before.

SUBJECTS
  wall-clock, bedside-monitor, ecg-cart, ecg-cart-imagine-box, ecg-cart-midband, ecg-cart-midband-6view,
  ecg-cart-midband-2tq, ecg-cart-midband-2oblique, iv-pole, o2-port,
  iv-pole-escape, bedside-monitor-escape, wall-clock-escape, o2-port-escape,
  iv-pump-escape, fetal-monitor-escape
  (2tq = eye-level ¾; 2oblique = high TLF + low BRB; grade raw export)
  (-escape = single three_quarter_upper_alpha.png, OPENCLINXR_TRELLIS_PACKS pack)

MULTI-VIEW
  Pack layout under OPENCLINXR_TRELLIS_PACKS (default .openclinxr/evidence/issue-232/<subject>/):
    front.png, side.png, three_quarter_left.png, three_quarter_right.png
  All existing views are passed as repeated --input-image to run_bake_isolated.py.
  N>1 → multi-view conditioning (sequence-concat embeddings, #255). Only front → single-view.

ISOLATION
  Each subject runs in a fresh OS subprocess via run_bake_isolated.py (#237).
  No shared torch MPS context — GPU memory reclaimed by OS after each exit.

OUTPUT
  Evidence written under .openclinxr/evidence/trellis-bake/<subject>/
  Override with OPENCLINXR_TRELLIS_OUT env var.

ENVIRONMENT
  OPENCLINXR_TRELLIS_OUT     Output root (default: .openclinxr/evidence/trellis-bake)
  OPENCLINXR_TRELLIS_PACKS   Pack image root (default: .openclinxr/evidence/issue-232)
`;

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

interface ParsedArgs {
  subject: string | null;
  dryRun: boolean;
  validateLatest: boolean;
  help: boolean;
  seed: number | null;
  hfDemo: boolean;
  remesh: boolean;
  noRemesh: boolean;
  decimationTarget: number | null;
  textureSize: number | null;
  samplerOverrides: SamplerOverrides;
  invalid: string[];
}

/**
 * #662: the fifteen TRELLIS sampler knobs, three samplers x five knobs each.
 * Each is optional; only explicitly passed values are forwarded to Python, which
 * merges them over the pipeline defaults (user wins). `kind` drives argv typing:
 * "int" for steps, "float" for guidance/rescale knobs.
 */
const SAMPLER_FLAGS = [
  { group: "ss", flag: "--ss-steps", knob: "steps", kind: "int" },
  { group: "ss", flag: "--ss-guidance-strength", knob: "guidance_strength", kind: "float" },
  { group: "ss", flag: "--ss-guidance-rescale", knob: "guidance_rescale", kind: "float" },
  { group: "ss", flag: "--ss-rescale-t", knob: "rescale_t", kind: "float" },
  { group: "shape", flag: "--shape-steps", knob: "steps", kind: "int" },
  { group: "shape", flag: "--shape-guidance-strength", knob: "guidance_strength", kind: "float" },
  { group: "shape", flag: "--shape-guidance-rescale", knob: "guidance_rescale", kind: "float" },
  { group: "shape", flag: "--shape-rescale-t", knob: "rescale_t", kind: "float" },
  { group: "tex", flag: "--tex-steps", knob: "steps", kind: "int" },
  { group: "tex", flag: "--tex-guidance-strength", knob: "guidance_strength", kind: "float" },
  { group: "tex", flag: "--tex-guidance-rescale", knob: "guidance_rescale", kind: "float" },
  { group: "tex", flag: "--tex-rescale-t", knob: "rescale_t", kind: "float" },
] as const;

const SAMPLER_INTERVAL_FLAGS = [
  { group: "ss", flag: "--ss-guidance-interval" },
  { group: "shape", flag: "--shape-guidance-interval" },
  { group: "tex", flag: "--tex-guidance-interval" },
] as const;

function parseNumericFlag(argv: string[], iRef: { i: number }, flagName: string,
                          invalid: string[], integer: boolean): number | null {
  const next = argv[iRef.i + 1];
  if (next === undefined) {
    invalid.push(`${flagName} requires a value`);
    return null;
  }
  const n = Number(next);
  if (!Number.isFinite(n)) {
    invalid.push(`${flagName} requires a number, got: ${next}`);
    return null;
  }
  if (integer && !Number.isInteger(n)) {
    invalid.push(`${flagName} requires an integer, got: ${next}`);
    return null;
  }
  iRef.i++;
  return n;
}

function parseArgs(argv: string[]): ParsedArgs {
  const result: ParsedArgs = {
    subject: null,
    dryRun: false,
    validateLatest: false,
    help: false,
    seed: null,
    hfDemo: false,
    remesh: false,
    noRemesh: false,
    decimationTarget: null,
    textureSize: null,
    samplerOverrides: { ss: {}, shape: {}, tex: {} },
    invalid: [],
  };
  const iRef = { i: 0 };
  while (iRef.i < argv.length) {
    const a = argv[iRef.i];
    if (a === "--help" || a === "-h") {
      result.help = true;
    } else if (a === "--dry-run") {
      result.dryRun = true;
    } else if (a === "--validate-latest") {
      result.validateLatest = true;
    } else if (a === "--hf-demo") {
      result.hfDemo = true;
    } else if (a === "--remesh") {
      result.remesh = true;
    } else if (a === "--no-remesh") {
      result.noRemesh = true;
    } else if (a === "--subject") {
      const next = argv[iRef.i + 1];
      if (next !== undefined) { result.subject = next; iRef.i++; }
      else result.invalid.push("--subject requires a value");
    } else if (a === "--seed") {
      result.seed = parseNumericFlag(argv, iRef, "--seed", result.invalid, true);
    } else if (a === "--decimation-target") {
      result.decimationTarget = parseNumericFlag(argv, iRef, "--decimation-target", result.invalid, true);
    } else if (a === "--texture-size") {
      result.textureSize = parseNumericFlag(argv, iRef, "--texture-size", result.invalid, true);
    } else if (SAMPLER_INTERVAL_FLAGS.some((f) => f.flag === a)) {
      // guidance_interval takes TWO floats: LO HI.
      const lo = parseNumericFlag(argv, iRef, `${a} LO`, result.invalid, false);
      let hi: number | null = null;
      if (lo !== null) hi = parseNumericFlag(argv, iRef, `${a} HI`, result.invalid, false);
      if (lo !== null && hi !== null) {
        const group = SAMPLER_INTERVAL_FLAGS.find((f) => f.flag === a)!.group;
        result.samplerOverrides[group].guidance_interval = [lo, hi];
      }
    } else if (SAMPLER_FLAGS.some((f) => f.flag === a)) {
      const def = SAMPLER_FLAGS.find((f) => f.flag === a)!;
      const n = parseNumericFlag(argv, iRef, a, result.invalid, def.kind === "int");
      if (n !== null) result.samplerOverrides[def.group][def.knob] = n;
    } else if (a.startsWith("-")) {
      result.invalid.push(`unknown flag: ${a}`);
    }
    iRef.i++;
  }
  return result;
}

/** #662: push the sampler overrides + orphaned numeric knobs into the Python argv. */
function pushBakeFlags(argv: string[], args: ParsedArgs): void {
  for (const f of SAMPLER_FLAGS) {
    const v = args.samplerOverrides[f.group][f.knob];
    if (v != null) argv.push(f.flag, String(v));
  }
  for (const f of SAMPLER_INTERVAL_FLAGS) {
    const iv = args.samplerOverrides[f.group].guidance_interval;
    if (iv) argv.push(f.flag, String(iv[0]), String(iv[1]));
  }
  // #662 gap fix: both were declared in run_bake_isolated.py but never forwarded
  // by this CLI before — unreachable from the factory station despite existing.
  if (args.decimationTarget != null) argv.push("--decimation-target", String(args.decimationTarget));
  if (args.textureSize != null) argv.push("--texture-size", String(args.textureSize));
}

// ---------------------------------------------------------------------------
// Dry-run — JSON plan, no GPU
// ---------------------------------------------------------------------------

function dryRunPlan(subjectId: string, args: ParsedArgs): string {
  const entry = KNOWN_SUBJECTS.find((s) => s.subjectId === subjectId);
  if (!entry) {
    process.stderr.write(`Unknown subject: ${subjectId}. Known: ${KNOWN_SUBJECTS.map((s) => s.subjectId).join(", ")}\n`);
    process.exit(2);
  }

  const inputImagePaths = resolveExistingViewPaths(entry);
  const viewCount = inputImagePaths.length;
  const outputDir = path.join(trellisOutRoot(), subjectId);
  const remesh = args.remesh && !args.noRemesh;

  // #662: the dry-run plan shows the exact extra argv a live bake would push.
  const plannedArgv: string[] = [];
  pushBakeFlags(plannedArgv, args);

  const plan: DryRunPlan = {
    subjectId: entry.subjectId,
    displayName: entry.displayName,
    processIsolation: "fresh_subprocess",
    inputImagePath: inputImagePaths[0] ?? null,
    inputImagePaths,
    viewCount,
    conditioning:
      viewCount === 0 ? "no-images" : viewCount === 1 ? "single-view" : "multi-view",
    outputDir,
    venvPython: VENV_PYTHON,
    trellisRoot: TRELLIS_ROOT,
    weightsPath: WEIGHTS_PATH,
    dinov3Path: DINOV3_PATH,
    seed: args.seed,
    hfDemo: args.hfDemo,
    remesh,
    noRemesh: args.noRemesh,
    decimationTarget: args.decimationTarget,
    textureSize: args.textureSize,
    samplerOverrides: args.samplerOverrides,
    mode: "dry-run",
  };

  if (plannedArgv.length > 0) {
    (plan as DryRunPlan & { extraArgv: string[] }).extraArgv = plannedArgv;
  }

  return JSON.stringify(plan, null, 2);
}

// ---------------------------------------------------------------------------
// Live bake — spawns fresh subprocess (GPU path; only when explicitly requested)
// ---------------------------------------------------------------------------

function liveBake(subjectId: string, args: ParsedArgs): void {
  const entry = KNOWN_SUBJECTS.find((s) => s.subjectId === subjectId);
  if (!entry) {
    process.stderr.write(`Unknown subject: ${subjectId}. Known: ${KNOWN_SUBJECTS.map((s) => s.subjectId).join(", ")}\n`);
    process.exit(2);
  }

  const inputImagePaths = resolveExistingViewPaths(entry);
  if (inputImagePaths.length === 0) {
    process.stderr.write(
      `No input images found for subject ${subjectId}. Expected pack under OPENCLINXR_TRELLIS_PACKS or .openclinxr/evidence/issue-232/${subjectId}/ with front.png (+ optional side / three_quarter_*).\n`,
    );
    process.exit(2);
  }

  if (inputImagePaths.length === 1) {
    process.stdout.write(
      `[factory:trellis:bake] ${subjectId}: only 1 view found — single-view bake\n`,
    );
  } else {
    process.stdout.write(
      `[factory:trellis:bake] ${subjectId}: ${inputImagePaths.length} views → multi-view conditioning\n`,
    );
  }

  const outputDir = path.join(trellisOutRoot(), subjectId);
  mkdirSync(outputDir, { recursive: true });

  process.stdout.write(
    `[factory:trellis:bake] Starting ${subjectId} (fresh subprocess, isolation mode)...\n`,
  );

  const argv: string[] = [
    RUN_BAKE_SCRIPT,
    "--subject-id",
    subjectId,
    "--display-name",
    entry.displayName,
    "--output-dir",
    outputDir,
    "--weights-path",
    WEIGHTS_PATH,
    "--dinov3-path",
    DINOV3_PATH,
    "--trellis-root",
    TRELLIS_ROOT,
  ];
  if (args.seed != null) argv.push("--seed", String(args.seed));
  if (args.hfDemo) argv.push("--hf-demo");
  if (args.remesh) argv.push("--remesh");
  if (args.noRemesh) argv.push("--no-remesh");
  pushBakeFlags(argv, args);
  for (const img of inputImagePaths) {
    argv.push("--input-image", img);
  }

  const t0 = Date.now();
  const result = execFileSync(VENV_PYTHON, argv, {
    encoding: "utf8",
    cwd: REPO_ROOT,
    // #255 measured a 1-view bake at 1371.9s wall clock (shape gen 1231.6s +
    // export 137.2s). Multi-view may run longer; 3.6Ms (1h) still fails fast on wedged GPU.
    timeout: 3_600_000,
    env: {
      ...process.env,
      PYTHONUNBUFFERED: "1",
      PYTORCH_ENABLE_MPS_FALLBACK: "1",
    },
    maxBuffer: 10 * 1024 * 1024,
  });
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  process.stdout.write(result);
  process.stdout.write(`\n[factory:trellis:bake] ${subjectId} completed in ${elapsed}s\n`);

  const reportPath = path.join(outputDir, "bake-measure.json");
  if (existsSync(reportPath)) {
    const raw = JSON.parse(readFileSync(reportPath, "utf8")) as BakeMeasure;
    process.stdout.write(`  verdict: ${raw.verdict}\n`);
    if (raw.rawTriangleCount != null) process.stdout.write(`  triangles: ${raw.rawTriangleCount}\n`);
    if (raw.exportBytes != null) process.stdout.write(`  export bytes: ${raw.exportBytes}\n`);
  }
}

// ---------------------------------------------------------------------------
// --validate-latest — read last bake report without re-baking (COUNTERWEIGHT)
// ---------------------------------------------------------------------------

function validateLatest(): void {
  const outRoot = trellisOutRoot();

  // Collect reports across all subject directories under the output root
  const results: ValidateResult[] = [];

  for (const entry of KNOWN_SUBJECTS) {
    const subjectDir = path.join(outRoot, entry.subjectId);
    const reportPath = path.join(subjectDir, "bake-measure.json");

    if (!existsSync(subjectDir)) {
      results.push({
        subjectId: entry.subjectId,
        status: "missing_subject_dir",
        reportPath,
      });
      continue;
    }

    if (!existsSync(reportPath)) {
      results.push({
        subjectId: entry.subjectId,
        status: "missing_report",
        reportPath,
      });
      continue;
    }

    try {
      const raw = JSON.parse(readFileSync(reportPath, "utf8")) as BakeMeasure;
      results.push({
        subjectId: raw.subjectId ?? entry.subjectId,
        status: "valid",
        rawTriangleCount: raw.rawTriangleCount ?? null,
        exportBytes: raw.exportBytes ?? null,
        verdict: raw.verdict,
        reportPath,
      });
    } catch (err) {
      results.push({
        subjectId: entry.subjectId,
        status: "missing_report",
        reportPath,
      });
    }
  }

  const validCount = results.filter((r) => r.status === "valid").length;
  const missingCount = results.filter((r) => r.status !== "valid").length;

  process.stdout.write(JSON.stringify({
    generatedAt: new Date().toISOString(),
    subjectCount: results.length,
    validCount,
    missingCount,
    subjects: results,
  }, null, 2));
  process.stdout.write("\n");

  // Report summary
  process.stdout.write(`validate-latest: ${validCount} valid, ${missingCount} missing\n`);

  if (validCount === 0) {
    process.stdout.write("validate-latest: no valid bake reports found — run a bake first or check subject dirs\n");
  }

  // Exit 0 even with missing reports — this is a counterweight, not a gate failure.
  // Exit 2 only if the CLI itself failed (invalid args, etc.), not because data is absent.
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    process.stdout.write(HELP_TEXT);
    return;
  }

  if (args.invalid.length > 0) {
    process.stderr.write(`Invalid arguments: ${args.invalid.join(", ")}\n`);
    process.stderr.write(HELP_TEXT);
    process.exit(2);
  }

  // --validate-latest takes precedence
  if (args.validateLatest) {
    validateLatest();
    return;
  }

  // --subject required for all other modes
  if (!args.subject) {
    process.stderr.write("--subject <id> is required (use --help for subjects)\n");
    process.stderr.write(HELP_TEXT);
    process.exit(2);
  }

  // --dry-run: JSON plan, no GPU
  if (args.dryRun) {
    process.stdout.write(dryRunPlan(args.subject, args));
    process.stdout.write("\n");
    return;
  }

  // Live bake — spawns fresh subprocess with GPU
  // NOTE: This path requires the trellis2-apple venv, model weights, and input images.
  // In a worktree without gitignored assets, this will block with a missing-image error
  // from run_bake_isolated.py — which is correct behavior.
  liveBake(args.subject, args);
}

const invokedAsCli =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (invokedAsCli) {
  main();
}
