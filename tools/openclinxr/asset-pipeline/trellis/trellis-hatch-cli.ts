#!/usr/bin/env tsx
/**
 * factory:trellis:hatch — text prompt + Imagine pack → remesh bake → optimize → pack.
 *
 * Composes three existing factory stations into one deterministic hatch station so
 * an operator (or dark-factory tick) goes from a text prompt to an optimized GLB with
 * one command. It does NOT generate the Imagine pack itself (no image_gen from the
 * CLI): the imagine-trellis role produces `three_quarter_upper_alpha.png` into
 * `trellis-packs/<id>-escape/`, and this station refuses with `imagine_required`
 * (exit 3) when that pack is absent.
 *
 * Stations (reused, not re-implemented):
 *   bake     run_bake_isolated.py --seed 42 --hf-demo --remesh   (#237 / #238)
 *   optimize tools/openclinxr/asset-pipeline/trellis/iterate-optimize.ts
 *   pack     tools/openclinxr/asset-pipeline/trellis/trellis-pack-cli.ts
 *
 * --dry-run prints a JSON plan and never starts GPU.
 *
 * Header IMMUTABLE — append ## FIXED (date).
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const REPO_ROOT = path.resolve(import.meta.dirname ?? __dirname, "../../../..");

const EVIDENCE_ROOT = path.join(REPO_ROOT, ".openclinxr", "evidence");

/** Imagine pack root (trellis-packs/<id>-escape/). Overridable via OPENCLINXR_TRELLIS_PACKS. */
function packsRoot(): string {
  return process.env.OPENCLINXR_TRELLIS_PACKS ?? path.join(EVIDENCE_ROOT, "trellis-packs");
}

/** Hatch evidence root (trellis-escape-hatch/<id>/). Overridable via OPENCLINXR_TRELLIS_HATCH. */
function hatchRoot(): string {
  return process.env.OPENCLINXR_TRELLIS_HATCH ?? path.join(EVIDENCE_ROOT, "trellis-escape-hatch");
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
const OPTIMIZE_SCRIPT = path.join(
  REPO_ROOT,
  "tools/openclinxr/asset-pipeline/trellis/iterate-optimize.ts",
);
const PACK_SCRIPT = path.join(
  REPO_ROOT,
  "tools/openclinxr/asset-pipeline/trellis/trellis-pack-cli.ts",
);

const DEFAULT_SEED = 42;

/** Short thick-volume preamble applied when the prompt lacks black-void / chunky cues. */
const THICK_VOLUME_PREAMBLE =
  "Thick chunky primitive volumes; isolated on a flat solid pure black void (RGB 0 0 0); single elevated upper three-quarter view. ";

/** Resolve the tsx runner: local node_modules/.bin first, then package CLI, then PATH. */
function findTsx(): string {
  const local = path.join(REPO_ROOT, "node_modules", ".bin", "tsx");
  if (existsSync(local)) return local;
  try {
    const pkg = require.resolve("tsx/package.json");
    return path.join(path.dirname(pkg), "dist", "cli.cjs");
  } catch {
    return "tsx";
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ParsedArgs {
  subject: string | null;
  prompt: string | null;
  dryRun: boolean;
  help: boolean;
  seed: number;
  invalid: string[];
}

interface HatchReport {
  schemaVersion: "openclinxr.trellis-hatch-report.v1";
  subjectId: string;
  escapeSubjectId: string;
  prompt: string;
  thickVolumePreambleApplied: boolean;
  status: "imagine_required" | "complete" | "blocked";
  descriptionPath: string | null;
  inputImagePath: string | null;
  bakeGlbPath: string | null;
  bakeMeasurePath: string | null;
  rawTriangleCount: number | null;
  optimizeDir: string | null;
  championGlbPath: string | null;
  championTriangleCount: number | null;
  meshoptGlbPath: string | null;
  meshoptTriangleCount: number | null;
  meshoptBytes: number | null;
  error: string | null;
  measuredAt: string;
  claimScope: string[];
  notEvidenceFor: string[];
}

interface HatchDryRunPlan {
  subjectId: string;
  escapeSubjectId: string;
  mode: "dry-run";
  thickVolumePreambleApplied: boolean;
  inputImagePath: string | null;
  inputImageSource: "hatch_pack" | "imagine_pack" | null;
  bake: {
    script: string;
    subjectId: string;
    seed: number;
    hfDemo: true;
    remesh: true;
    outputDir: string;
  };
  optimize: { script: string; input: string; outDir: string };
  pack: { script: string; input: string; output: string };
  steps: ["remesh_bake", "optimize", "pack"];
}

// ---------------------------------------------------------------------------
// Help
// ---------------------------------------------------------------------------

const HELP_TEXT = `factory:trellis:hatch — text prompt + Imagine pack → remesh bake → optimize → pack

USAGE
  pnpm factory:trellis:hatch --subject <id> --prompt "..." [--seed 42]
  pnpm factory:trellis:hatch --subject <id> --dry-run
  pnpm factory:trellis:hatch --help

FLAGS
  --subject <id>   Base subject id (escape pack is <id>-escape)
  --prompt "<text>" Imagine prompt (thick-volume preamble added if missing black void / chunky)
  --seed <n>       Bake seed (default 42)
  --dry-run        Print JSON plan only — never starts GPU

BEHAVIOR
  1. Write .openclinxr/evidence/trellis-escape-hatch/<id>/pack/description.md
  2. If the PNG (hatch pack/three_quarter_upper_alpha.png OR
     trellis-packs/<id>-escape/three_quarter_upper_alpha.png) is missing:
     write hatch-report.json status=imagine_required and exit 3 (no fake PNG).
  3. Bake --seed 42 --hf-demo --remesh (fresh subprocess)
  4. Optimize (iterate-optimize) → champion.glb
  5. Pack (gltfpack) → champion-meshopt.glb
  6. Write hatch-report.json with paths + triangle counts

ENVIRONMENT
  OPENCLINXR_TRELLIS_PACKS  Imagine pack root (default .openclinxr/evidence/trellis-packs)
  OPENCLINXR_TRELLIS_HATCH  Hatch evidence root (default .openclinxr/evidence/trellis-escape-hatch)
`;

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): ParsedArgs {
  const result: ParsedArgs = {
    subject: null,
    prompt: null,
    dryRun: false,
    help: false,
    seed: DEFAULT_SEED,
    invalid: [],
  };
  let i = 0;
  while (i < argv.length) {
    const a = argv[i];
    if (a === "--help" || a === "-h") {
      result.help = true;
    } else if (a === "--dry-run") {
      result.dryRun = true;
    } else if (a === "--subject") {
      i++;
      if (i < argv.length) result.subject = argv[i];
      else result.invalid.push("--subject requires a value");
    } else if (a === "--prompt") {
      i++;
      if (i < argv.length) result.prompt = argv[i];
      else result.invalid.push("--prompt requires a value");
    } else if (a === "--seed") {
      i++;
      if (i < argv.length) {
        const n = Number(argv[i]);
        if (Number.isFinite(n)) result.seed = n;
        else result.invalid.push(`--seed requires a number, got: ${argv[i]}`);
      } else {
        result.invalid.push("--seed requires a value");
      }
    } else if (a.startsWith("-")) {
      result.invalid.push(`unknown flag: ${a}`);
    }
    i++;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Prompt / paths helpers
// ---------------------------------------------------------------------------

function needsThickVolumePreamble(prompt: string): boolean {
  const p = prompt.toLowerCase();
  return !p.includes("black void") && !p.includes("chunky");
}

function finalPrompt(prompt: string): { text: string; preambleApplied: boolean } {
  const preambleApplied = needsThickVolumePreamble(prompt);
  return { text: preambleApplied ? THICK_VOLUME_PREAMBLE + prompt : prompt, preambleApplied };
}

/** Resolve the input PNG: hatch pack copy first, then the Imagine pack mirror. */
function resolveInputPng(subjectId: string): { path: string | null; source: "hatch_pack" | "imagine_pack" | null } {
  const subjectDir = path.join(hatchRoot(), subjectId);
  const hatchPng = path.join(subjectDir, "pack", "three_quarter_upper_alpha.png");
  if (existsSync(hatchPng)) return { path: hatchPng, source: "hatch_pack" };

  const imaginePng = path.join(packsRoot(), `${subjectId}-escape`, "three_quarter_upper_alpha.png");
  if (existsSync(imaginePng)) return { path: imaginePng, source: "imagine_pack" };

  return { path: null, source: null };
}

function descriptionPath(subjectId: string): string {
  return path.join(hatchRoot(), subjectId, "pack", "description.md");
}

function writeDescription(subjectId: string, prompt: string): string {
  const { text, preambleApplied } = finalPrompt(prompt);
  const descPath = descriptionPath(subjectId);
  mkdirSync(path.dirname(descPath), { recursive: true });
  const content = `# ${subjectId} — TRELLIS escape-hatch hero (factory:trellis:hatch)

**Subject:** ${subjectId}
**View:** single elevated upper three-quarter
**Input class:** black-void product shot → border-only alpha
**Thick-volume preamble applied:** ${preambleApplied ? "yes" : "no (prompt already has black void / chunky)"}

## Optimized Imagine prompt

${text}

## Pack files

- \`three_quarter_upper_alpha.png\` — border-black flood key, RGBA
- Mirror: \`.openclinxr/evidence/trellis-packs/${subjectId}-escape/three_quarter_upper_alpha.png\`

## claimScope / notEvidenceFor

- **claimScope:** TRELLIS.2 single-view conditioning image for a ${subjectId} escape-hatch bake
- **notEvidenceFor:** clinical accuracy, Quest readiness, exam SSOT, kit replacement, usable GLB (bake not yet graded)
`;
  writeFileSync(descPath, content);
  return descPath;
}

function hatchReportPath(subjectId: string): string {
  return path.join(hatchRoot(), subjectId, "hatch-report.json");
}

function baseReport(subjectId: string, prompt: string): HatchReport {
  const { text, preambleApplied } = finalPrompt(prompt);
  return {
    schemaVersion: "openclinxr.trellis-hatch-report.v1",
    subjectId,
    escapeSubjectId: `${subjectId}-escape`,
    prompt: text,
    thickVolumePreambleApplied: preambleApplied,
    status: "blocked",
    descriptionPath: descriptionPath(subjectId),
    inputImagePath: null,
    bakeGlbPath: null,
    bakeMeasurePath: null,
    rawTriangleCount: null,
    optimizeDir: null,
    championGlbPath: null,
    championTriangleCount: null,
    meshoptGlbPath: null,
    meshoptTriangleCount: null,
    meshoptBytes: null,
    error: null,
    measuredAt: new Date().toISOString(),
    claimScope: [
      "TRELLIS Metal image→shape→mesh→GLB on Apple Silicon",
      "reuses existing bake/optimize/pack stations (no new remesher or optimizer)",
      "not evidence for Quest readiness or clinical accuracy",
    ],
    notEvidenceFor: ["Quest 3 readiness", "clinical accuracy", "exam SSOT", "kit replacement"],
  };
}

function readJson<T>(p: string): T | null {
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as T;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Dry-run — JSON plan, no GPU
// ---------------------------------------------------------------------------

function dryRunPlan(subjectId: string, prompt: string, seed: number): string {
  const { preambleApplied } = finalPrompt(prompt);
  const input = resolveInputPng(subjectId);
  const subjectDir = path.join(hatchRoot(), subjectId);
  const escapeSubjectId = `${subjectId}-escape`;
  const bakeOutputDir = path.join(subjectDir, escapeSubjectId);
  const bakeGlb = path.join(bakeOutputDir, `${escapeSubjectId}.glb`);
  const optimizeDir = path.join(subjectDir, "optimize");
  const championGlb = path.join(optimizeDir, "champion.glb");
  const meshoptGlb = path.join(optimizeDir, "champion-meshopt.glb");

  const plan: HatchDryRunPlan = {
    subjectId,
    escapeSubjectId,
    mode: "dry-run",
    thickVolumePreambleApplied: preambleApplied,
    inputImagePath: input.path,
    inputImageSource: input.source,
    bake: {
      script: RUN_BAKE_SCRIPT,
      subjectId: escapeSubjectId,
      seed,
      hfDemo: true,
      remesh: true,
      outputDir: bakeOutputDir,
    },
    optimize: { script: OPTIMIZE_SCRIPT, input: bakeGlb, outDir: optimizeDir },
    pack: { script: PACK_SCRIPT, input: championGlb, output: meshoptGlb },
    steps: ["remesh_bake", "optimize", "pack"],
  };

  return JSON.stringify(plan, null, 2);
}

// ---------------------------------------------------------------------------
// Live hatch — bake → optimize → pack
// ---------------------------------------------------------------------------

function liveHatch(subjectId: string, prompt: string, seed: number): void {
  const descPath = writeDescription(subjectId, prompt);
  process.stdout.write(`[factory:trellis:hatch] ${subjectId}: description → ${descPath}\n`);

  const input = resolveInputPng(subjectId);
  const report = baseReport(subjectId, prompt);
  report.descriptionPath = descPath;

  if (!input.path) {
    report.status = "imagine_required";
    report.error =
      "No input PNG. Generate trellis-packs/<id>-escape/three_quarter_upper_alpha.png (imagine-trellis role) or place pack/three_quarter_upper_alpha.png in the hatch dir. No PNG is fabricated here.";
    writeReport(report);
    process.stderr.write(
      `[factory:trellis:hatch] ${subjectId}: imagine_required — missing three_quarter_upper_alpha.png\n`,
    );
    process.exit(3);
  }
  report.inputImagePath = input.path;

  const escapeSubjectId = `${subjectId}-escape`;
  const subjectDir = path.join(hatchRoot(), subjectId);
  const bakeOutputDir = path.join(subjectDir, escapeSubjectId);
  const bakeGlb = path.join(bakeOutputDir, `${escapeSubjectId}.glb`);
  const bakeMeasurePath = path.join(bakeOutputDir, "bake-measure.json");
  const optimizeDir = path.join(subjectDir, "optimize");
  const championGlb = path.join(optimizeDir, "champion.glb");
  const meshoptGlb = path.join(optimizeDir, "champion-meshopt.glb");

  report.bakeGlbPath = bakeGlb;
  report.bakeMeasurePath = bakeMeasurePath;
  report.optimizeDir = optimizeDir;
  report.championGlbPath = championGlb;
  report.meshoptGlbPath = meshoptGlb;

  mkdirSync(bakeOutputDir, { recursive: true });

  try {
    // ── 1. Bake (fresh subprocess) ─────────────────────────────────────────
    process.stdout.write(
      `[factory:trellis:hatch] ${subjectId}: bake ${escapeSubjectId} (remesh, seed ${seed}, source ${input.source})...\n`,
    );
    const bakeArgv: string[] = [
      RUN_BAKE_SCRIPT,
      "--subject-id",
      escapeSubjectId,
      "--display-name",
      subjectId,
      "--input-image",
      input.path,
      "--output-dir",
      bakeOutputDir,
      "--seed",
      String(seed),
      "--hf-demo",
      "--remesh",
      "--weights-path",
      WEIGHTS_PATH,
      "--dinov3-path",
      DINOV3_PATH,
      "--trellis-root",
      TRELLIS_ROOT,
    ];
    const tBake = Date.now();
    const bakeOut = execFileSync(VENV_PYTHON, bakeArgv, {
      encoding: "utf8",
      cwd: REPO_ROOT,
      timeout: 3_600_000,
      env: { ...process.env, PYTHONUNBUFFERED: "1", PYTORCH_ENABLE_MPS_FALLBACK: "1" },
      maxBuffer: 10 * 1024 * 1024,
    });
    process.stdout.write(bakeOut);
    process.stdout.write(
      `[factory:trellis:hatch] ${subjectId}: bake completed in ${((Date.now() - tBake) / 1000).toFixed(1)}s\n`,
    );

    const bakeMeasure = readJson<{ rawTriangleCount?: number | null; exportBytes?: number | null }>(
      bakeMeasurePath,
    );
    if (bakeMeasure?.rawTriangleCount != null) {
      report.rawTriangleCount = bakeMeasure.rawTriangleCount;
    }

    // ── 2. Optimize (iterate-optimize) ─────────────────────────────────────
    const tsxBin = findTsx();
    process.stdout.write(`[factory:trellis:hatch] ${subjectId}: optimize → ${optimizeDir}\n`);
    execFileSync(tsxBin, [OPTIMIZE_SCRIPT, "--input", bakeGlb, "--out", optimizeDir], {
      stdio: "inherit",
      cwd: REPO_ROOT,
      timeout: 3_600_000,
    });

    const iterationReport = readJson<{ champion?: { triangleCount?: number } | null }>(
      path.join(optimizeDir, "iteration-report.json"),
    );
    if (iterationReport?.champion?.triangleCount != null) {
      report.championTriangleCount = iterationReport.champion.triangleCount;
    }

    // ── 3. Pack (gltfpack delivery) ────────────────────────────────────────
    process.stdout.write(`[factory:trellis:hatch] ${subjectId}: pack → ${meshoptGlb}\n`);
    execFileSync(tsxBin, [PACK_SCRIPT, "--input", championGlb, "--out", meshoptGlb], {
      stdio: "inherit",
      cwd: REPO_ROOT,
      timeout: 3_600_000,
    });

    const packReport = readJson<{ outputTriangleCount?: number | null; outputBytes?: number | null }>(
      path.join(optimizeDir, "champion-meshopt.pack-report.json"),
    );
    if (packReport?.outputTriangleCount != null) {
      report.meshoptTriangleCount = packReport.outputTriangleCount;
    }
    if (packReport?.outputBytes != null) {
      report.meshoptBytes = packReport.outputBytes;
    }

    report.status = "complete";
    writeReport(report);
    process.stdout.write(
      `[factory:trellis:hatch] ${subjectId}: complete — raw ${report.rawTriangleCount ?? "?"} → champion ${report.championTriangleCount ?? "?"} → meshopt ${report.meshoptTriangleCount ?? "?"}\n`,
    );
  } catch (err) {
    report.status = "blocked";
    report.error = err instanceof Error ? err.message : String(err);
    writeReport(report);
    process.stderr.write(`[factory:trellis:hatch] ${subjectId}: blocked — ${report.error}\n`);
    process.exit(2);
  }
}

function writeReport(report: HatchReport): void {
  const p = hatchReportPath(report.subjectId);
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(report, null, 2) + "\n");
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

  if (!args.subject) {
    process.stderr.write("--subject <id> is required (use --help)\n");
    process.stderr.write(HELP_TEXT);
    process.exit(2);
  }
  if (!args.prompt) {
    process.stderr.write("--prompt \"<text>\" is required (use --help)\n");
    process.stderr.write(HELP_TEXT);
    process.exit(2);
  }

  if (args.dryRun) {
    // Dry-run still enforces the imagine-required gate so the plan is honest
    // about whether a GPU run could proceed.
    const input = resolveInputPng(args.subject);
    if (!input.path) {
      writeDescription(args.subject, args.prompt);
      const report = baseReport(args.subject, args.prompt);
      report.status = "imagine_required";
      report.inputImagePath = null;
      report.error =
        "No input PNG. Generate trellis-packs/<id>-escape/three_quarter_upper_alpha.png (imagine-trellis role) or place pack/three_quarter_upper_alpha.png in the hatch dir. No PNG is fabricated here.";
      writeReport(report);
      process.stderr.write(
        `[factory:trellis:hatch] ${args.subject}: imagine_required — missing three_quarter_upper_alpha.png\n`,
      );
      process.exit(3);
    }
    process.stdout.write(dryRunPlan(args.subject, args.prompt, args.seed));
    process.stdout.write("\n");
    return;
  }

  liveHatch(args.subject, args.prompt, args.seed);
}

main();
