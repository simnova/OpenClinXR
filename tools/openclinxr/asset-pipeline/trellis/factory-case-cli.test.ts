import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  FACTORY_CASE_SCENARIO_IDS,
  factoryCaseReportPath,
  runFactoryCase,
} from "./factory-case-cli.js";

/**
 * factory:case — scenario id → existing-cast inventory.
 *
 * Dry-run only; never starts GPU or Blender. Contracts:
 *  - peds dry-run prints the three current MPFB cast paths
 *  - missing scenario exits non-zero
 *  - psych / OB ids are accepted
 */

const ROOT = process.cwd();
const CLI = "tools/openclinxr/asset-pipeline/trellis/factory-case-cli.ts";

const PEDS = "peds_asthma_parent_anxiety_v1";
const OB = "ob_headache_preeclampsia_triage_v1";
const PSYCH = "psych_suicidal_ideation_safety_v1";

const PEDS_MPFB_PATHS = [
  "apps/ui-xr/public/generated-humanoids/mpfb-peds-patient-child.glb",
  "apps/ui-xr/public/generated-humanoids/mpfb-peds-parent-aisha.glb",
  "apps/ui-xr/public/generated-humanoids/mpfb-peds-nurse-kevin.glb",
] as const;

function tsxBin(): string {
  const local = join(ROOT, "node_modules", ".bin", "tsx");
  return existsSync(local) ? local : "tsx";
}

describe("factory:case CLI", () => {
  it("package.json exposes factory:case", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };
    expect(pkg.scripts?.["factory:case"]).toBe(
      "tsx tools/openclinxr/asset-pipeline/trellis/factory-case-cli.ts",
    );
  });

  it("dry-run of peds prints all three MPFB cast paths", () => {
    const result = runFactoryCase(["--scenario", PEDS, "--dry-run"]);
    expect(result.exitCode).toBe(0);
    expect(result.plan?.mode).toBe("dry-run");
    expect(result.plan?.stations.find((s) => s.id === "trellis_hatch")?.enabled).toBe(false);
    expect(result.plan?.stations.find((s) => s.id === "motion_bind")?.enabled).toBe(false);
    expect(result.plan?.stations.find((s) => s.id === "viseme")?.enabled).toBe(false);
    for (const glb of PEDS_MPFB_PATHS) {
      expect(result.stdout).toContain(glb);
    }
    const actors = result.plan?.actors ?? [];
    expect(actors).toHaveLength(3);
    expect(actors.map((a) => a.assetPath).sort()).toEqual([...PEDS_MPFB_PATHS].sort());
    expect(actors.every((a) => a.exists)).toBe(true);

    const reportPath = factoryCaseReportPath(PEDS);
    expect(existsSync(reportPath)).toBe(true);
    const report = JSON.parse(readFileSync(reportPath, "utf8")) as { scenarioId?: string };
    expect(report.scenarioId).toBe(PEDS);

    const stdout = execFileSync(tsxBin(), [CLI, "--scenario", PEDS, "--dry-run"], {
      encoding: "utf8",
      cwd: ROOT,
    });
    for (const glb of PEDS_MPFB_PATHS) {
      expect(stdout).toContain(glb);
    }
  }, 30_000);

  it("missing scenario exits non-zero", () => {
    const result = runFactoryCase(["--scenario", "not_a_shipped_scenario_v0", "--dry-run"]);
    expect(result.exitCode).not.toBe(0);
    expect(result.report?.status).toBe("unknown_scenario");

    let exitCode = 0;
    try {
      execFileSync(tsxBin(), [CLI, "--scenario", "not_a_shipped_scenario_v0", "--dry-run"], {
        encoding: "utf8",
        cwd: ROOT,
      });
    } catch (err) {
      const e = err as { status?: number };
      exitCode = e.status ?? -1;
    }
    expect(exitCode).not.toBe(0);
  }, 30_000);

  it("psych and OB are accepted ids", () => {
    expect(FACTORY_CASE_SCENARIO_IDS).toEqual(
      expect.arrayContaining([PEDS, OB, PSYCH]),
    );
    for (const scenarioId of [PSYCH, OB]) {
      const result = runFactoryCase(["--scenario", scenarioId, "--dry-run"]);
      expect(result.exitCode).toBe(0);
      expect(result.plan?.scenarioId).toBe(scenarioId);
      expect(result.plan?.actors.length).toBeGreaterThan(0);
      expect(result.report?.status).toBe("ok");
    }
  });
});
