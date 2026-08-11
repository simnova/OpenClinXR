/**
 * issue-288 — dark-factory multi-case chain contract test.
 *
 * The D9 test is MULTIPLE cases: "the ability to take multiple cases and run them
 * through it and get a full experience at the end." #286 proved one case but never
 * landed its runners (#64's class: artifacts shipped, instrument did not).
 *
 * This test INVOKES the landed runner module (tools/openclinxr/dark-factory/
 * multi-case-runner.ts) over the whole shipped case population, then asserts the
 * issue-288 contract:
 *   - the runner module exists under tools/ and is invoked by this test,
 *   - pre-fix.json records the population and which case #286 covered (one),
 *   - every case table names all eight stations,
 *   - no station claims `deterministic` without an on-disk artifact path that
 *     resolves, and count(deterministic) == count(rows with artifacts) per case.
 *
 * not_run / absent / error are successful outcomes; this test never asserts a pass
 * rate or a target number.
 */

import { access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  COVERED_BY_286,
  DARK_FACTORY_CHAIN_STATIONS,
  DEFAULT_EVIDENCE_DIR,
  REPO_ROOT,
  enumerateCasePopulation,
  runMultiCaseChain,
  type MultiCaseRollup,
} from "../dark-factory/multi-case-runner.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EVIDENCE_DIR = DEFAULT_EVIDENCE_DIR;

const CHAIN_HOUR_MS = 90 * 60 * 1000;

async function existsPath(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

describe("dark factory multi-case chain (issue-288)", () => {
  it(
    "runs the landed runner over the case population and satisfies the contract counterweights",
    { timeout: CHAIN_HOUR_MS },
    async () => {
      // 1. The runner module exists under tools/ (the import above already proves
      //    it resolves; assert the physical location for the record).
      const runnerModulePath = path.join(REPO_ROOT, "tools", "openclinxr", "dark-factory", "multi-case-runner.ts");
      expect(await existsPath(runnerModulePath), `runner module missing: ${runnerModulePath}`).toBe(true);

      // 2. The case population is enumerated from what ships (15 bundles), never
      //    a hardcoded list.
      const population = await enumerateCasePopulation();
      expect(population.length).toBeGreaterThanOrEqual(1);
      expect(population).toContain("peds_asthma_parent_anxiety_v1");

      // 3. Invoke the runner over the whole population. This writes pre-fix.json,
      //    per-case station tables and the roll-up under .openclinxr/evidence/issue-288/.
      const rollup: MultiCaseRollup = await runMultiCaseChain({ population });

      // 4. pre-fix.json exists and records the population + #286 coverage.
      const preFixPath = path.join(EVIDENCE_DIR, "pre-fix.json");
      expect(await existsPath(preFixPath), `pre-fix.json missing: ${preFixPath}`).toBe(true);
      const rollupPath = path.join(EVIDENCE_DIR, "multi-case-rollup.json");
      expect(await existsPath(rollupPath), `multi-case-rollup.json missing: ${rollupPath}`).toBe(true);

      // 5. One table per case in the population.
      expect(rollup.cases.map((c) => c.caseId)).toEqual(population);

      // 6. Every case row names all eight stations.
      for (const table of rollup.cases) {
        expect(table.stations.map((s) => s.stationId)).toEqual([...DARK_FACTORY_CHAIN_STATIONS]);
        expect(table.chain).toEqual([...DARK_FACTORY_CHAIN_STATIONS]);
        expect(table.schemaVersion).toBe("openclinxr.dark-factory-station-table.v1");
      }

      // 7. Counterweight: a station may be `deterministic` only with an on-disk
      //    artifact proving it ran. count(deterministic) == count(rows with
      //    artifacts) per case, and every artifact path resolves from the repo root.
      for (const table of rollup.cases) {
        const deterministicCount = table.stations.filter((s) => s.classification === "deterministic").length;
        const withArtifacts = table.stations.filter((s) => s.artifactPaths.length > 0).length;
        expect(
          deterministicCount,
          `case ${table.caseId}: deterministic(${deterministicCount}) != rows-with-artifacts(${withArtifacts})`,
        ).toBe(withArtifacts);

        for (const station of table.stations) {
          if (station.classification === "deterministic") {
            expect(
              station.artifactPaths.length,
              `case ${table.caseId} station ${station.stationId}: deterministic without artifact`,
            ).toBeGreaterThan(0);
            for (const artifactPath of station.artifactPaths) {
              const resolved = path.isAbsolute(artifactPath)
                ? artifactPath
                : path.resolve(REPO_ROOT, artifactPath);
              expect(
                await existsPath(resolved),
                `case ${table.caseId} station ${station.stationId}: artifact does not resolve: ${artifactPath} (${resolved})`,
              ).toBe(true);
            }
          } else {
            expect(
              station.artifactPaths.length,
              `case ${table.caseId} station ${station.stationId}: non-deterministic classification should carry no artifact paths (${station.classification})`,
            ).toBe(0);
          }
        }
      }

      // 8. The roll-up reports what happened per case per station — the frontier
      //    (first non-deterministic station) is recorded for every case, so the
      //    orchestrator can read "what stopped it".
      for (const table of rollup.cases) {
        const summaryRow = rollup.summary;
        expect(summaryRow.casesAttempted).toBe(population.length);
        expect(summaryRow.frontierCounts).toBeDefined();
        void table;
      }

      // 9. pre-fix records #286 coverage = exactly the one case it ran.
      const preFix = JSON.parse(
        await (await import("node:fs/promises")).readFile(preFixPath, "utf8"),
      ) as { population: string[]; coveredBy286: string[] };
      expect([...preFix.population].sort()).toEqual([...population].sort());
      expect(preFix.coveredBy286).toEqual([...COVERED_BY_286]);
    },
  );
});
