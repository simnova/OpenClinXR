#!/usr/bin/env tsx
/**
 * #256 — batch equipment reference packs (factory_step: equipment_generate).
 *
 * Renders the PACK step for every equipment id that still resolves parametric
 * (`PARAMETRIC_KINDS` in apps/ui-xr/src/station-equipment.ts — enumerated from
 * what ships, never hardcoded). ONE dev-server boot + ONE browser for the whole
 * batch (#7b: 35 cold boots is the mistake, not the number of ids).
 *
 * Usage:
 *   pnpm factory:equipment:pack-batch                # all 35 parametric ids
 *   pnpm factory:equipment:pack-batch -- --ids=a,b   # subset (smoke / resume)
 *   pnpm factory:equipment:pack-batch -- --out=.openclinxr/evidence/issue-256
 *
 * Writes <out>/packs/<equipmentId>/{front,side,three_quarter_left,
 * three_quarter_right,back}.png + contact-sheet.png + parametric-source.glb,
 * plus <out>/pack-manifest.json and <out>/pack-batch-report.json.
 *
 * Does NOT bake. Does NOT register subjects in KNOWN_SUBJECTS. Packs only.
 *
 * Header IMMUTABLE — append ## FIXED (#256).
 */

import {
  renderEquipmentReferencePackBatch,
  type CaptureView,
} from "./isolated-subject-harness.js";
import { listDeclaredEquipmentBuilderArms } from "../../../apps/ui-xr/src/station-equipment.js";

function parseArgs(argv: string[]): { ids?: string[]; out?: string; views?: string[] } {
  const out: { ids?: string[]; out?: string; views?: string[] } = {};
  for (const arg of argv) {
    if (arg.startsWith("--ids=")) {
      out.ids = arg.slice("--ids=".length).split(",").map((s) => s.trim()).filter(Boolean);
    } else if (arg.startsWith("--out=")) {
      out.out = arg.slice("--out=".length);
    } else if (arg.startsWith("--views=")) {
      out.views = arg.slice("--views=".length).split(",").map((s) => s.trim()).filter(Boolean);
    }
  }
  return out;
}

async function main(): Promise<void> {
  const { ids, out, views } = parseArgs(process.argv.slice(2));
  // Enumerate from the ships-set (PARAMETRIC_KINDS) unless explicitly overridden.
  const allIds = listDeclaredEquipmentBuilderArms();
  const equipmentIds = ids ?? allIds;

  const run = await renderEquipmentReferencePackBatch({
    equipmentIds,
    ...(out ? { outputRoot: out } : {}),
    ...(views ? { views: views as CaptureView[] } : {}),
  });

  const summary = {
    factoryStep: run.factoryStep,
    requested: equipmentIds.length,
    produced: run.packs.length,
    skipped: run.skipped,
    parametricIdsTotal: allIds.length,
    devServerBoots: run.devServerBoots,
    browserLaunches: run.browserLaunches,
    wallClockMs: run.wallClockMs,
    packManifestPath: run.packManifestPath,
    reportPath: run.reportPath,
  };
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

main().catch((err) => {
  process.stderr.write(`equipment-pack-batch: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exitCode = 1;
});
