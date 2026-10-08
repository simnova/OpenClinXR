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
  const scenarioId = "peds_fever_v1";
  const beforeGate = readJson(beforeFile).cases[scenarioId]?.realGate;
  const afterGate = readJson(afterFile).cases[scenarioId]?.realGate;
  if (!beforeGate || !afterGate) throw new Error("before and after must both contain a real runtime gate");
  const before = scoreLayoutGate(beforeGate), after = scoreLayoutGate(afterGate);
  const views = Object.fromEntries(["before", "after"].flatMap((phase) => ["overhead", "isometric"].map((view) => {
    const relative = `${phase}-${scenarioId}-${view}.png`;
    return [`${phase}-${view}`, { path: relative, sha256: sha256(path.join(COMPARISON, relative)) }];
  })));
  const report = {
    schemaVersion: "openclinxr.staging-layout-comparison.v1",
    scenarioId,
    scoreDefinition: "40 containment + 40 crown/chest visibility + 10 facing + 10 near-camera occlusion",
    before,
    after,
    delta: Number((after.score - before.score).toFixed(2)),
    views,
  };
  writeFileSync(path.join(COMPARISON, "score.json"), `${JSON.stringify(report, null, 2)}\n`);
}

main();
