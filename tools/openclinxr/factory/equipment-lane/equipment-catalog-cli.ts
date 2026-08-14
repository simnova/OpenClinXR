/**
 * Equipment catalogue CLI — inventory / validate / report (MADR 0055).
 *
 *   pnpm factory:equipment:catalog:inventory
 *   pnpm factory:equipment:catalog:validate
 *   pnpm factory:equipment:catalog:report
 *   pnpm factory:equipment:catalog:loop   # inventory + validate + report (OpenClaw tick)
 */

import { mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { rebuildEquipmentCatalog, catalogPath, REPO_ROOT } from "./inventory.js";
import { validateEquipmentCatalog } from "./validate.js";
import type { EquipmentCatalogDocument } from "./types.js";

async function writeCatalog(doc: EquipmentCatalogDocument): Promise<string> {
  const p = catalogPath(REPO_ROOT);
  await mkdir(path.dirname(p), { recursive: true });
  await writeFile(p, JSON.stringify(doc, null, 2) + "\n", "utf8");
  return p;
}

async function loadCatalog(): Promise<EquipmentCatalogDocument> {
  const p = catalogPath(REPO_ROOT);
  if (!existsSync(p)) {
    throw new Error(`catalogue missing; run inventory first: ${p}`);
  }
  return JSON.parse(await readFile(p, "utf8")) as EquipmentCatalogDocument;
}

function printReport(doc: EquipmentCatalogDocument): void {
  console.log(`# Equipment catalogue report`);
  console.log(`schema: ${doc.schemaVersion}`);
  console.log(`measuredAt: ${doc.measuredAt}`);
  console.log(`scenarios: ${doc.scenarioCount}  equipment rows: ${doc.equipmentCount}`);
  console.log(`lanes:`, doc.summary.byLane);
  console.log(`runtimeSource:`, doc.summary.byRuntimeSource);
  console.log(`gltf missing: ${doc.summary.gltfMissingOnDisk.length}`);
  console.log(`unmapped prose: ${doc.unmappedProse.length}`);
  console.log(`scenarios with unmapped: ${doc.summary.scenariosWithUnmappedProse.join(", ") || "(none)"}`);
  console.log(`\n## By blueprint (resolved equipment count)`);

  const byScenario = new Map<string, string[]>();
  for (const row of doc.rows) {
    for (const sid of row.scenarioIds) {
      const arr = byScenario.get(sid) ?? [];
      arr.push(row.equipmentId);
      byScenario.set(sid, arr);
    }
  }
  for (const sid of [...byScenario.keys()].sort()) {
    const ids = byScenario.get(sid)!.sort();
    console.log(`- ${sid}: ${ids.length} → ${ids.join(", ")}`);
  }

  if (doc.unmappedProse.length) {
    console.log(`\n## Unmapped prose (top 20)`);
    for (const u of doc.unmappedProse.slice(0, 20)) {
      console.log(`- "${u.prose}" ← ${u.scenarioIds.join(", ")}`);
    }
  }

  console.log(`\n## Lane samples`);
  for (const lane of ["bank", "modular_kit", "thin_parametric"] as const) {
    const sample = doc.rows.filter((r) => r.lane === lane).slice(0, 8).map((r) => r.equipmentId);
    console.log(`- ${lane}: ${sample.join(", ")}${doc.summary.byLane[lane] > 8 ? "…" : ""}`);
  }
}

async function maybeMongoProject(doc: EquipmentCatalogDocument): Promise<void> {
  const uri = process.env.MONGODB_URI ?? process.env.OPENCLINXR_MONGODB_URI;
  if (!uri) {
    console.log("[catalog] Mongo projection skipped (no MONGODB_URI)");
    return;
  }
  try {
    // Dynamic import so CI without mongodb driver still runs inventory. The driver is only
    // resolvable from tools via the data-mongodb package's re-export (pnpm: bare `mongodb`
    // is not resolvable from tools/).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod = (await import("../../../../packages/openclinxr/data-mongodb/src/index.js").catch(() => null)) as {
      MongoClient: new (uri: string) => {
        connect: () => Promise<unknown>;
        db: () => {
          collection: (name: string) => {
            deleteMany: (q: object) => Promise<unknown>;
            insertMany: (docs: object[]) => Promise<unknown>;
            updateOne: (q: object, u: object, o?: object) => Promise<unknown>;
          };
        };
        close: () => Promise<unknown>;
      };
    } | null;
    if (!mod) {
      console.log("[catalog] Mongo projection skipped (mongodb package not resolvable)");
      return;
    }
    const client = new mod.MongoClient(uri);
    await client.connect();
    const col = client.db().collection("equipment_asset_catalog_v1");
    await col.deleteMany({ schemaVersion: doc.schemaVersion });
    if (doc.rows.length) {
      await col.insertMany(
        doc.rows.map((row) => ({
          ...row,
          schemaVersion: doc.schemaVersion,
          catalogMeasuredAt: doc.measuredAt,
        })),
      );
    }
    await col.updateOne(
      { catalogMeta: true },
      {
        $set: {
          catalogMeta: true,
          schemaVersion: doc.schemaVersion,
          measuredAt: doc.measuredAt,
          equipmentCount: doc.equipmentCount,
          scenarioCount: doc.scenarioCount,
          summary: doc.summary,
        },
      },
      { upsert: true },
    );
    await client.close();
    console.log(`[catalog] Mongo projection ok → equipment_asset_catalog_v1 (${doc.rows.length} rows)`);
  } catch (e) {
    console.warn("[catalog] Mongo projection failed (non-fatal):", e instanceof Error ? e.message : e);
  }
}

async function main(): Promise<void> {
  const cmd = process.argv[2] ?? "loop";

  if (cmd === "inventory" || cmd === "loop") {
    const doc = rebuildEquipmentCatalog(REPO_ROOT);
    const p = await writeCatalog(doc);
    console.log(`[catalog] inventory wrote ${p} (${doc.equipmentCount} rows, ${doc.unmappedProse.length} unmapped prose)`);
    await maybeMongoProject(doc);
    if (cmd === "inventory") {
      process.exit(0);
    }
  }

  if (cmd === "validate" || cmd === "loop") {
    const doc = await loadCatalog();
    const result = validateEquipmentCatalog(doc);
    for (const e of result.errors) console.error(`ERROR: ${e}`);
    for (const w of result.warnings) console.warn(`WARN: ${w}`);
    console.log(
      `[catalog] validate ${result.ok ? "OK" : "FAIL"} errors=${result.errors.length} warnings=${result.warnings.length}`,
    );
    if (cmd === "validate") {
      process.exit(result.ok ? 0 : 2);
    }
    if (!result.ok && cmd === "loop") {
      process.exit(2);
    }
  }

  if (cmd === "report" || cmd === "loop") {
    const doc = await loadCatalog();
    printReport(doc);
    const reportPath = path.join(REPO_ROOT, "docs/openclinxr/equipment-catalog-report.md");
    const byScenario = new Map<string, string[]>();
    for (const row of doc.rows) {
      for (const sid of row.scenarioIds) {
        const arr = byScenario.get(sid) ?? [];
        arr.push(`${row.equipmentId} (${row.lane}/${row.runtimeSource})`);
        byScenario.set(sid, arr);
      }
    }
    const lines = [
      `# Equipment catalogue report`,
      ``,
      `MADRs: ${doc.madr.join(", ")} · schema \`${doc.schemaVersion}\``,
      ``,
      `- measuredAt: ${doc.measuredAt}`,
      `- scenarios: ${doc.scenarioCount}`,
      `- equipment rows: ${doc.equipmentCount}`,
      `- lanes: ${JSON.stringify(doc.summary.byLane)}`,
      `- runtimeSource: ${JSON.stringify(doc.summary.byRuntimeSource)}`,
      `- unmapped prose: ${doc.unmappedProse.length}`,
      `- gltf missing on disk: ${doc.summary.gltfMissingOnDisk.length}`,
      ``,
      `## Blueprints (14 scenario-bank cases)`,
      ``,
      ...[...byScenario.keys()]
        .sort()
        .flatMap((sid) => [
          `### ${sid}`,
          ``,
          ...(byScenario.get(sid) ?? []).sort().map((x) => `- ${x}`),
          ``,
        ]),
      `## Bank lane`,
      ``,
      ...doc.rows
        .filter((r) => r.lane === "bank")
        .map((r) => `- \`${r.equipmentId}\` → \`${r.gltfFileName}\``),
      ``,
      `## Modular kit lane`,
      ``,
      ...doc.rows
        .filter((r) => r.lane === "modular_kit")
        .map((r) => `- \`${r.equipmentId}\` recipe=\`${r.kitRecipeId}\` — ${r.notes || ""}`),
      ``,
      "## Next gaps (priority)",
      "",
      "- Deck surfaces still thin_parametric: hospital_bed, stretcher, pediatric_stretcher, post_op_bed (prefer lane-1 bank GLB when licence-green mid-band exists)",
      "- ECG modular kit pending merge from feature/equipment-kit-approach-b",
      "- Weak prose maps (curtains/signs to whiteboard; medication cart to ECG class) need dedicated ids or honest props",
      "",
      `claimScope: ${doc.claimScope}`,
      `notEvidenceFor: ${doc.notEvidenceFor.join(", ")}`,
      "",
    ];
    await writeFile(reportPath, lines.join("\n"), "utf8");
    console.log(`[catalog] report → ${reportPath}`);
  }

  if (!["inventory", "validate", "report", "loop"].includes(cmd)) {
    console.error(`unknown command ${cmd}; use inventory|validate|report|loop`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
