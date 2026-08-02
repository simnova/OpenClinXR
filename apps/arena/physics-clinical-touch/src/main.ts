/**
 * physics-clinical-touch — arena headless cagematch entry.
 *
 * AD-5: Runnable arena app that emits §9 / AD-4 evidence headless.
 * Outputs to public/cagematch/physics-clinical-touch/<date>/
 *
 * Usage:
 *   npx tsx src/main.ts                     # default: 2026-08-02
 *   npx tsx src/main.ts --date 2026-08-02   # explicit date
 *   npx tsx src/main.ts --help
 */

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Import from the contract package
import { runMeasuredMetrics } from "@openclinxr/physics-touch-contract";

// ---------------------------------------------------------------------------
// Directory resolution
// ---------------------------------------------------------------------------

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, "..");
const PUBLIC_DIR = path.join(APP_ROOT, "public");
const CAGEMATCH_BASE = path.join(PUBLIC_DIR, "cagematch", "physics-clinical-touch");

// R3 evidence path (for PNG copy into cagematch tree)
const R3_EVIDENCE_DIR = path.resolve(
  APP_ROOT,
  "../../../.openclinxr/evidence/physics-clinical-touch/2026-08-02-uixr-bind",
);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** model-vetting-report.v1 field shapes for registry entry. */
type RegistryEntry = {
  schemaVersion: "openclinxr.model-vetting-registry.v1";
  kind: "physics_clinical_touch_cagematch";
  generatedAt: string;

  engine: {
    id: "rapier";
    version: string;
  };

  promotionStatus: false;
  realismGrade: "B";
  notEvidenceFor: readonly string[];

  artifacts: {
    reportJson: string;
    registryJson: string;
    pngs: string[];
  };

  metrics: {
    stepCostMsP50: number;
    stepCostMsP95: number;
    contactStabilityMm: number;
    poseReturnErrorDeg: number;
    jointExplosionRate: number;
    frameBudgetHeadroomMs: number;
    replayEquivalence: boolean;
    snapshotSupport: boolean;
    licenceClean: boolean;
    garmentCoherenceGrade: "B";
  };
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseArgs(): { date: string; help: boolean } {
  const args = process.argv.slice(2);
  const result = { date: "2026-08-02", help: false };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--help" || args[i] === "-h") {
      result.help = true;
    } else if (args[i] === "--date" || args[i] === "-d") {
      result.date = args[++i] ?? "2026-08-02";
    }
  }

  return result;
}

function printHelp(): void {
  process.stdout.write(`physics-clinical-touch — arena headless cagematch entry

Usage:
  npx tsx src/main.ts [options]

Options:
  --date, -d   Date string for output dir (default: 2026-08-02)
  --help, -h   Show this message

Output:
  public/cagematch/physics-clinical-touch/<date>/
    report.json    — measured metrics report (AD-4)
    registry.json  — model-vetting-report.v1 registry entry
    *.png          — garment/anatomy evidence (copied from R3)
`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs();
  if (args.help) {
    printHelp();
    return;
  }

  const outputDir = path.join(CAGEMATCH_BASE, args.date);
  process.stdout.write(`[physics-clinical-touch] Output dir: ${outputDir}\n`);

  // 1. Ensure output directory exists
  await fsp.mkdir(outputDir, { recursive: true });

  // 2. Run measured metrics (real Rapier WASM engine)
  process.stdout.write("[physics-clinical-touch] Running measured metrics (real Rapier WASM)...\n");
  const startTime = Date.now();
  const metricsReport = await runMeasuredMetrics(42);
  const elapsed = Date.now() - startTime;
  process.stdout.write(`[physics-clinical-touch] Metrics collected in ${elapsed}ms\n`);

  // 3. Write report.json
  const reportPath = path.join(outputDir, "report.json");
  await fsp.writeFile(reportPath, JSON.stringify(metricsReport, null, 2) + "\n", "utf8");
  process.stdout.write(`[physics-clinical-touch] Wrote report.json (${(await fsp.stat(reportPath)).size} bytes)\n`);

  // 4. Copy R3 PNGs into cagematch tree
  const pngCopies: string[] = [];
  try {
    const r3Files = await fsp.readdir(R3_EVIDENCE_DIR);
    const pngFiles = r3Files.filter((f) => f.endsWith(".png"));

    for (const png of pngFiles) {
      const srcPath = path.join(R3_EVIDENCE_DIR, png);
      const dstPath = path.join(outputDir, png);
      await fsp.copyFile(srcPath, dstPath);
      pngCopies.push(png);
    }
    process.stdout.write(`[physics-clinical-touch] Copied ${pngFiles.length} PNG(s) from R3 evidence\n`);
  } catch (err) {
    process.stdout.write(`[physics-clinical-touch] WARNING: R3 PNG copy failed (${String(err)}). Continuing without PNGs.\n`);
  }

  // Update garmentCoherence PNG paths in report
  metricsReport.garmentCoherence.pngPaths = pngCopies;
  await fsp.writeFile(reportPath, JSON.stringify(metricsReport, null, 2) + "\n", "utf8");

  // 5. Build registry.json entry with model-vetting-report.v1 shapes
  const registryEntry: RegistryEntry = {
    schemaVersion: "openclinxr.model-vetting-registry.v1",
    kind: "physics_clinical_touch_cagematch",
    generatedAt: new Date().toISOString(),

    engine: {
      id: "rapier",
      version: "0.19.3",
    },

    promotionStatus: false,
    realismGrade: "B",
    notEvidenceFor: [
      "clinical_validity",
      "exam_equivalence",
      "scoring",
      "learner_readiness",
    ],

    artifacts: {
      reportJson: "report.json",
      registryJson: "registry.json",
      pngs: pngCopies,
    },

    metrics: {
      stepCostMsP50: metricsReport.stepCostMs.p50.value,
      stepCostMsP95: metricsReport.stepCostMs.p95.value,
      contactStabilityMm: metricsReport.contactStability.value,
      poseReturnErrorDeg: metricsReport.poseReturnError.value,
      jointExplosionRate: metricsReport.jointExplosionRate.value,
      frameBudgetHeadroomMs: metricsReport.frameBudgetHeadroom.value,
      replayEquivalence: metricsReport.replayEquivalence.value,
      snapshotSupport: metricsReport.snapshotSupport.value,
      licenceClean: metricsReport.licenceClean.value,
      garmentCoherenceGrade: "B",
    },
  };

  const registryPath = path.join(outputDir, "registry.json");
  await fsp.writeFile(registryPath, JSON.stringify(registryEntry, null, 2) + "\n", "utf8");
  process.stdout.write(`[physics-clinical-touch] Wrote registry.json (${(await fsp.stat(registryPath)).size} bytes)\n`);

  // 6. Summary
  const reportStat = await fsp.stat(reportPath);
  const registryStat = await fsp.stat(registryPath);

  process.stdout.write(`
╔══════════════════════════════════════════════════════════════╗
║  physics-clinical-touch cagematch — R5 evidence complete     ║
╠══════════════════════════════════════════════════════════════╣
║  report.json:   ${String(reportStat.size).padStart(6)} bytes                                ║
║  registry.json: ${String(registryStat.size).padStart(6)} bytes                                ║
║  PNGs:          ${String(pngCopies.length).padStart(6)} files                                ║
╠══════════════════════════════════════════════════════════════╣
║  stepCostMs p50:       ${String(metricsReport.stepCostMs.p50.value).padEnd(8)} ms            ║
║  stepCostMs p95:       ${String(metricsReport.stepCostMs.p95.value).padEnd(8)} ms            ║
║  frameBudgetHeadroom:  ${String(metricsReport.frameBudgetHeadroom.value).padEnd(8)} ms            ║
║  contactStability:     ${String(metricsReport.contactStability.value).padEnd(8)} mm            ║
║  poseReturnError:      ${String(metricsReport.poseReturnError.value).padEnd(8)} °             ║
║  jointExplosionRate:   ${String(metricsReport.jointExplosionRate.value).padEnd(8)}             ║
║  replayEquivalence:    ${String(metricsReport.replayEquivalence.value).padEnd(8)}                ║
║  snapshotSupport:      ${String(metricsReport.snapshotSupport.value).padEnd(8)}                ║
║  licenceClean:         ${String(metricsReport.licenceClean.value).padEnd(8)}                ║
║  garmentCoherence:     ${metricsReport.garmentCoherence.grade.padEnd(8)}                ║
╚══════════════════════════════════════════════════════════════╝
`);

  process.stdout.write("[physics-clinical-touch] Done.\n");
}

main().catch((err) => {
  process.stderr.write(`[physics-clinical-touch] FATAL: ${String(err)}\n${err instanceof Error ? err.stack : ""}\n`);
  process.exit(1);
});
