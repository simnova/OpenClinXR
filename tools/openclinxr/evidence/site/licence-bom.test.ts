import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import {
  buildLicenceBom,
  buildLicensePolicyReportFromInventory,
  LICENCE_BOM_BUILD_TIME_TOOLS,
} from "../check-license-policy.js";

const rootDir = process.cwd();
const bomPath = path.join(rootDir, "docs", "site", "data", "licence-bom.json");

type LicenceBomFile = {
  schema: string;
  generatedFrom: string;
  packageCount: number;
  packages: Array<{ name: string; version: string; license: string; scope: string }>;
  buildTimeTools: Array<{ name: string; license: string; use: string; redistributed: boolean; source: string }>;
};

function readBom(): LicenceBomFile {
  return JSON.parse(readFileSync(bomPath, "utf8")) as LicenceBomFile;
}

function readLiveInventory(): Record<string, Array<{ name: string; versions: string[]; paths?: string[] }>> {
  const stdout = execFileSync("pnpm", ["licenses", "list", "--json"], { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
  return JSON.parse(stdout) as Record<string, Array<{ name: string; versions: string[]; paths?: string[] }>>;
}

it("known-good: the MPFB build-time tool row records GPL-3.0-or-later, build-time use, no redistribution, with a MADR line that states it", () => {
  expect(LICENCE_BOM_BUILD_TIME_TOOLS).toHaveLength(4);
  const tool = LICENCE_BOM_BUILD_TIME_TOOLS[0];
  expect(tool?.license).toBe("GPL-3.0-or-later");
  expect(tool?.use).toBe("build-time");
  expect(tool?.redistributed).toBe(false);
  expect(tool?.source).toMatch(/^docs\/madr\/0044-makeclothes-with-anny-as-reference-cagematch\.md:\d+$/);

  const lineNumber = Number(tool?.source.split(":").at(-1));
  const madrLines = readFileSync(
    path.join(rootDir, "docs", "madr", "0044-makeclothes-with-anny-as-reference-cagematch.md"),
    "utf8",
  ).split("\n");
  const citedLine = madrLines[lineNumber - 1];
  if (citedLine === undefined) {
    throw new Error(`MADR citation points past end of file: ${tool?.source}`);
  }
  if (!citedLine.includes("GPL-3.0-or-later")) {
    throw new Error(`MADR cited line ${lineNumber} does not state GPL-3.0-or-later: ${citedLine}`);
  }

  const bom = readBom();
  expect(bom.buildTimeTools).toEqual(LICENCE_BOM_BUILD_TIME_TOOLS);
});

it("known-good: the anny and certifi build-time tool rows record CI-only use with no redistribution", () => {
  expect(LICENCE_BOM_BUILD_TIME_TOOLS).toHaveLength(4);
  const anny = LICENCE_BOM_BUILD_TIME_TOOLS[1];
  expect(anny?.name).toBe("anny 0.6.0");
  expect(anny?.license).toBe("Apache-2.0");
  expect(anny?.use).toBe("build-time");
  expect(anny?.redistributed).toBe(false);
  expect(anny?.source).toContain("https://github.com/naver/anny@v0.6.0");
  expect(anny?.source).toContain("72104cac8242d1735ec06433b65bec5e26953ce7");
  expect(anny?.source).toContain("1d459b13c9650c763d6351ce21ad3b02433c80131195cf9d908de4fbc213cf27");

  const certifi = LICENCE_BOM_BUILD_TIME_TOOLS[2];
  expect(certifi?.name).toBe("certifi 2026.10.23");
  expect(certifi?.license).toBe("MPL-2.0");
  expect(certifi?.use).toBe("build-time");
  expect(certifi?.redistributed).toBe(false);
  expect(certifi?.source).toContain("not distributed");
  expect(certifi?.source).toContain("file-level copyleft, CI-only via requests");

  const bom = readBom();
  expect(bom.buildTimeTools).toEqual(LICENCE_BOM_BUILD_TIME_TOOLS);
});

it("known-good: the scipy build-time tool row records the bundled GPL/LGPL runtime licences with operator approval", () => {
  expect(LICENCE_BOM_BUILD_TIME_TOOLS).toHaveLength(4);
  const scipy = LICENCE_BOM_BUILD_TIME_TOOLS[3];
  expect(scipy?.name).toBe("scipy 1.18.0");
  expect(scipy?.license).toBe("BSD-3-Clause AND GPL-3.0-or-later WITH GCC-exception-3.1 AND LGPL-2.1-or-later");
  expect(scipy?.use).toBe("build-time");
  expect(scipy?.redistributed).toBe(false);
  expect(scipy?.source).toContain("https://pypi.org/project/scipy/");
  expect(scipy?.source).toContain("libgfortran (GPL-3.0-or-later WITH GCC-exception-3.1)");
  expect(scipy?.source).toContain("libquadmath (LGPL-2.1-or-later)");
  expect(scipy?.source).toContain("not distributed");
  expect(scipy?.source).toContain("I approve scipy for CI usage,");

  const bom = readBom();
  expect(bom.buildTimeTools).toEqual(LICENCE_BOM_BUILD_TIME_TOOLS);
});

it("counterweight: the committed BOM package list length matches its packageCount and the live policy-report count", () => {
  const bom = readBom();
  expect(bom.schema).toBe("openclinxr.licence-bom.v1");
  expect(bom.packages.length).toBe(bom.packageCount);

  const inventory = readLiveInventory();
  const report = buildLicensePolicyReportFromInventory(inventory);
  expect(report.packageCount).toBe(bom.packageCount);
}, 180_000);

it("negative: an AGPL fixture package is still listed in the BOM while the policy report blocks it", () => {
  const fixture = {
    "AGPL-3.0-only": [{ name: "some-agpl-package", versions: ["1.0.0"], paths: [] }],
    MIT: [{ name: "some-mit-package", versions: ["2.0.0"], paths: [] }],
  };

  const bom = buildLicenceBom(fixture);
  expect(bom.packageCount).toBe(2);
  expect(bom.packages).toContainEqual({ name: "some-agpl-package", version: "1.0.0", license: "AGPL-3.0-only", scope: "dependency" });

  const report = buildLicensePolicyReportFromInventory(fixture);
  expect(report.packageCount).toBe(2);
  expect(report.verdict.passed).toBe(false);
  expect(report.blockedFindings).toEqual([expect.objectContaining({ name: "some-agpl-package", license: "AGPL-3.0-only" })]);
});

it("freshness: regenerating the BOM through the CLI gives bytes equal to the committed file", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "licence-bom-"));
  const tempBomPath = path.join(tempDir, "licence-bom.json");
  try {
    execFileSync(
      "pnpm",
      ["exec", "tsx", path.join("tools", "openclinxr", "evidence", "check-license-policy.ts"), "--bom", tempBomPath],
      { encoding: "utf8", cwd: rootDir, maxBuffer: 20 * 1024 * 1024 },
    );
  } catch (error) {
    // The checker exits 1 when the live inventory carries blocked findings;
    // the BOM file is still written before that verdict, so only tolerate exit 1.
    if ((error as { status?: number }).status !== 1) {
      throw error;
    }
  }
  const committed = readFileSync(bomPath, "utf8");
  const regenerated = readFileSync(tempBomPath, "utf8");
  expect(
    regenerated,
    "licence BOM is stale: regenerate with pnpm exec tsx tools/openclinxr/evidence/check-license-policy.ts --bom docs/site/data/licence-bom.json and commit it with the dependency change",
  ).toBe(committed);
}, 180_000);
