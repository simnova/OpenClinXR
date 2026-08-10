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
 * --dry-run    prints JSON plan (no GPU)
 * --validate-latest  reads last bake report without re-baking (COUNTERWEIGHT)
 *
 * Header IMMUTABLE — append ## FIXED (#238).
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

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
// Subject registry — maps subject ids to input images
// ---------------------------------------------------------------------------

interface SubjectEntry {
  subjectId: string;
  displayName: string;
  /** Relative path under the packs directory (or absolute fallback). */
  frontImageRel: string;
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

  const local = path.join(EVIDENCE_ROOT, "issue-232", rel);
  if (existsSync(local)) return local;

  // Absolute fallback — #235 worktree packs (gitignored, may not exist in all worktrees)
  return path.join(
    "/Users/patrick/.grok/worktrees/src-openclinxr/issue-235",
    ".openclinxr/evidence/issue-232",
    rel,
  );
}

const KNOWN_SUBJECTS: SubjectEntry[] = [
  {
    subjectId: "wall-clock",
    displayName: "wall clinical / exam-room analog clock",
    frontImageRel: "wall-clock/front.png",
  },
  {
    subjectId: "bedside-monitor",
    displayName: "multi-parameter bedside monitor",
    frontImageRel: "bedside-monitor/front.png",
  },
  {
    subjectId: "ecg-cart",
    displayName: "12-lead ECG cart",
    frontImageRel: "ecg-cart/front.png",
  },
  {
    subjectId: "iv-pole",
    displayName: "IV pole equipment",
    frontImageRel: "iv_pole_equipment/front.png",
  },
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DryRunPlan {
  subjectId: string;
  displayName: string;
  processIsolation: "fresh_subprocess";
  inputImagePath: string;
  outputDir: string;
  venvPython: string;
  trellisRoot: string;
  weightsPath: string;
  dinov3Path: string;
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

SUBJECTS
  wall-clock, bedside-monitor, ecg-cart, iv-pole  (#232 packs + #262 parametric-render pack)

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
  invalid: string[];
}

function parseArgs(argv: string[]): ParsedArgs {
  const result: ParsedArgs = { subject: null, dryRun: false, validateLatest: false, help: false, invalid: [] };
  let i = 0;
  while (i < argv.length) {
    const a = argv[i];
    if (a === "--help" || a === "-h") {
      result.help = true;
    } else if (a === "--dry-run") {
      result.dryRun = true;
    } else if (a === "--validate-latest") {
      result.validateLatest = true;
    } else if (a === "--subject") {
      i++;
      if (i < argv.length) result.subject = argv[i];
      else result.invalid.push("--subject requires a value");
    } else if (a.startsWith("-")) {
      result.invalid.push(`unknown flag: ${a}`);
    }
    i++;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Dry-run — JSON plan, no GPU
// ---------------------------------------------------------------------------

function dryRunPlan(subjectId: string): string {
  const entry = KNOWN_SUBJECTS.find((s) => s.subjectId === subjectId);
  if (!entry) {
    process.stderr.write(`Unknown subject: ${subjectId}. Known: ${KNOWN_SUBJECTS.map((s) => s.subjectId).join(", ")}\n`);
    process.exit(2);
  }

  const inputImagePath = resolvePackPath(entry.frontImageRel);
  const outputDir = path.join(trellisOutRoot(), subjectId);

  const plan: DryRunPlan = {
    subjectId: entry.subjectId,
    displayName: entry.displayName,
    processIsolation: "fresh_subprocess",
    inputImagePath,
    outputDir,
    venvPython: VENV_PYTHON,
    trellisRoot: TRELLIS_ROOT,
    weightsPath: WEIGHTS_PATH,
    dinov3Path: DINOV3_PATH,
    mode: "dry-run",
  };

  return JSON.stringify(plan, null, 2);
}

// ---------------------------------------------------------------------------
// Live bake — spawns fresh subprocess (GPU path; only when explicitly requested)
// ---------------------------------------------------------------------------

function liveBake(subjectId: string): void {
  const entry = KNOWN_SUBJECTS.find((s) => s.subjectId === subjectId);
  if (!entry) {
    process.stderr.write(`Unknown subject: ${subjectId}. Known: ${KNOWN_SUBJECTS.map((s) => s.subjectId).join(", ")}\n`);
    process.exit(2);
  }

  const inputImagePath = resolvePackPath(entry.frontImageRel);
  const outputDir = path.join(trellisOutRoot(), subjectId);
  mkdirSync(outputDir, { recursive: true });

  process.stdout.write(`[factory:trellis:bake] Starting ${subjectId} (fresh subprocess, isolation mode)...\n`);

  const t0 = Date.now();
  const result = execFileSync(
    VENV_PYTHON,
    [
      RUN_BAKE_SCRIPT,
      "--subject-id", subjectId,
      "--display-name", entry.displayName,
      "--input-image", inputImagePath,
      "--output-dir", outputDir,
      "--weights-path", WEIGHTS_PATH,
      "--dinov3-path", DINOV3_PATH,
      "--trellis-root", TRELLIS_ROOT,
    ],
    {
      encoding: "utf8",
      cwd: REPO_ROOT,
      // #255 measured a 1-view bake at 1371.9s wall clock (shape gen 1231.6s +
      // export 137.2s). The prior 600s cap killed every real bake; 3.6Ms (1h)
      // leaves headroom while still failing fast on a wedged GPU process.
      timeout: 3_600_000,
      env: {
        ...process.env,
        PYTHONUNBUFFERED: "1",
        PYTORCH_ENABLE_MPS_FALLBACK: "1",
      },
      maxBuffer: 10 * 1024 * 1024,
    },
  );
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
    process.stdout.write(dryRunPlan(args.subject));
    process.stdout.write("\n");
    return;
  }

  // Live bake — spawns fresh subprocess with GPU
  // NOTE: This path requires the trellis2-apple venv, model weights, and input images.
  // In a worktree without gitignored assets, this will block with a missing-image error
  // from run_bake_isolated.py — which is correct behavior.
  liveBake(args.subject);
}

main();
