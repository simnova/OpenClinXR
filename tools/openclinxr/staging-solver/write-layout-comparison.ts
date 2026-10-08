import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { GateReading } from "../evidence/station-capture/gate-geometry.js";
import { scoreLayoutGate } from "./layout-quality.js";

type ResultFile = { cases: Record<string, { realGate: GateReading | null }> };
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const COMPARISON = path.join(ROOT, "docs/openclinxr/staging-solver/comparison");

function readJson(file: string): ResultFile {
  return JSON.parse(readFileSync(file, "utf8")) as ResultFile;
}

function sha256(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function main(): void {
  const beforeFile = path.join(COMPARISON, "before-results.json");
  const afterFile = path.join(COMPARISON, "after-results.json");
  const beforeCases = readJson(beforeFile).cases;
  const afterCases = readJson(afterFile).cases;
  const scenarioIds = [...new Set([...Object.keys(beforeCases), ...Object.keys(afterCases)])].sort();
  const cases = Object.fromEntries(scenarioIds.map((scenarioId) => {
    const beforeGate = beforeCases[scenarioId]?.realGate;
    const afterGate = afterCases[scenarioId]?.realGate;
    if (!beforeGate || !afterGate) throw new Error(`${scenarioId}: before and after must contain a real runtime gate`);
    const before = scoreLayoutGate(beforeGate), after = scoreLayoutGate(afterGate);
    return [scenarioId, {
      before,
      after,
      delta: Number((after.score - before.score).toFixed(2)),
      gateRegression: before.gatePass && !after.gatePass,
    }];
  }));
  const caseRows = Object.values(cases);
  const average = (key: "before" | "after") => Number((caseRows.reduce((sum, row) => sum + row[key].score, 0) / caseRows.length).toFixed(2));
  const auditDir = path.join(ROOT, "docs/openclinxr/room-layout-audit-2026-10-08");
  const views = Object.fromEntries([
    ["perspectiveBeforeAfter", "all-rooms-perspective-before-after.png"],
    ["overheadAfter", "all-rooms-overhead.png"],
    ["isometricAfter", "all-rooms-isometric.png"],
  ].map(([name, relative]) => [name, {
    path: path.relative(COMPARISON, path.join(auditDir, relative)),
    sha256: sha256(path.join(auditDir, relative)),
  }]));
  const report = {
    schemaVersion: "openclinxr.staging-layout-comparison.v2",
    scoreDefinition: "40 containment + 40 crown/chest visibility + 10 facing + 10 near-camera occlusion",
    aggregate: {
      scenarioCount: caseRows.length,
      beforePasses: caseRows.filter((row) => row.before.gatePass).length,
      afterPasses: caseRows.filter((row) => row.after.gatePass).length,
      beforeAverageScore: average("before"),
      afterAverageScore: average("after"),
      gateRegressions: caseRows.filter((row) => row.gateRegression).length,
    },
    cases,
    views,
  };
  writeFileSync(path.join(COMPARISON, "all-rooms-score.json"), `${JSON.stringify(report, null, 2)}\n`);
}

main();
