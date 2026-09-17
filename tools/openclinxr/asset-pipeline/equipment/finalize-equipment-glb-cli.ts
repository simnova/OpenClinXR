#!/usr/bin/env tsx
/**
 * CLI wrapper for finalize-equipment-glb.ts — the post-promote cleanup station
 * for medical-equipment GLBs (dedup duplicate texture/material datablocks,
 * remove zero-area triangles, compact orphaned vertices, prune the result).
 *
 * Usage:
 *   pnpm exec tsx tools/openclinxr/asset-pipeline/equipment/finalize-equipment-glb-cli.ts \
 *     --source apps/ui-xr/public/xr-assets/medical-equipment/exam-table-sketchfab-ccby.glb \
 *     --target apps/ui-xr/public/xr-assets/medical-equipment/exam-table-sketchfab-ccby.glb
 *
 * Prints the measured before/after report as JSON on stdout. Exits 1 if source
 * is missing. Writing target == source is supported (in-place finalize); the
 * source bytes are fully read into memory before target is touched.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { finalizeEquipmentGlbFile } from "./finalize-equipment-glb.js";

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]!;
    if (!key.startsWith("--")) throw new Error(`expected --flag, got ${key}`);
    out[key.slice(2)] = argv[i + 1] ?? "";
  }
  return out;
}

function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const source = args.source;
  const target = args.target ?? source;
  if (!source) throw new Error("--source is required");
  if (!existsSync(source)) {
    console.error(`source not found: ${source}`);
    process.exit(1);
  }

  const shaBefore = sha256(readFileSync(source));
  const report = await finalizeEquipmentGlbFile(source, target!);
  const shaAfter = sha256(readFileSync(target!));

  console.log(
    JSON.stringify(
      {
        source,
        target,
        shaBefore,
        shaAfter,
        changed: shaBefore !== shaAfter,
        ...report,
        bytesSavedPct: report.bytesBefore > 0
          ? Math.round((1 - report.bytesAfter / report.bytesBefore) * 1000) / 10
          : 0,
      },
      null,
      2,
    ),
  );
}

await main();
