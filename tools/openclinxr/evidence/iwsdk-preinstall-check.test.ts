import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import {
  buildIwsdkPreInstallProposalReport,
  defaultIwsdkFirstSlicePreInstallProposal,
  type IwsdkPreInstallProposalReport,
} from "./iwsdk-preinstall-check.js";

const execFileAsync = promisify(execFile);

describe("IWSDK preinstall checker", () => {
  it("reports a ready first-slice package proposal without touching the lockfile", () => {
    const report = buildIwsdkPreInstallProposalReport({
      generatedAt: "2026-05-04T00:00:00.000Z",
      proposal: defaultIwsdkFirstSlicePreInstallProposal(),
    });
    const coreSelection = report.proposal.selectedPackages.find((selectedPackage) => selectedPackage.name === "@iwsdk/core");

    expect(report.verdict).toEqual({
      readyToInstallInSidecar: true,
      blockers: [],
      reviewWarnings: [],
      missingPackageManagerControls: [],
    });
    expect(report.policy.allowedFirstSlicePackages).toEqual(["@iwsdk/core", "@iwsdk/xr-input"]);
    expect(coreSelection?.transitivePackages).toEqual([
      "@babylonjs/havok",
      "@iwsdk/glxf",
      "@iwsdk/locomotor",
      "@iwsdk/xr-input",
      "@pmndrs/handle",
      "@pmndrs/pointer-events",
      "@pmndrs/uikit",
      "@pmndrs/uikitml",
      "@preact/signals-core",
      "elics",
      "three",
      "three-mesh-bvh",
    ]);
    expect(coreSelection?.transitivePackageLicenses).toMatchObject({
      "@babylonjs/havok": "Apache-2.0",
      "@iwsdk/glxf": "MIT",
      "@iwsdk/locomotor": "MIT",
      "@iwsdk/xr-input": "MIT",
      "@pmndrs/uikit": "MIT",
      three: "MIT",
    });
  });

  it("keeps a committed first-slice proposal fixture in sync with the default no-install report", async () => {
    const fixturePath = path.resolve("docs/openclinxr/iwsdk-first-slice-preinstall-proposal.json");
    const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
    const output = path.join(
      await mkdtemp(path.join(os.tmpdir(), "openclinxr-iwsdk-fixture-report-")),
      "report.json",
    );

    expect(fixture).toEqual(defaultIwsdkFirstSlicePreInstallProposal());

    await execFileAsync(
      path.resolve("node_modules/.bin/tsx"),
      ["tools/openclinxr/iwsdk-preinstall-check.ts", "--proposal", fixturePath, "--output", output],
      { encoding: "utf8", timeout: 15000 },
    );

    const report = JSON.parse(await readFile(output, "utf8")) as IwsdkPreInstallProposalReport;
    expect(report.proposal).toEqual(fixture);
    expect(report.verdict).toMatchObject({
      readyToInstallInSidecar: true,
      blockers: [],
      reviewWarnings: [],
    });
  });

  it("keeps the committed Phase 2 devtools proposal fixture blocked until explicit approval", async () => {
    const fixturePath = path.resolve("docs/openclinxr/iwsdk-phase2-devtools-preinstall-proposal.json");
    const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
    const report = buildIwsdkPreInstallProposalReport({
      generatedAt: "2026-05-04T00:00:00.000Z",
      proposal: fixture,
    });

    expect(report.proposal.selectedPackages).toEqual([
      {
        name: "@iwsdk/vite-plugin-dev",
        version: "0.3.1",
        license: "MIT",
        transitivePackages: [],
      },
    ]);
    expect(report.verdict).toEqual({
      readyToInstallInSidecar: false,
      blockers: ["@iwsdk/vite-plugin-dev:not_allowed_in_first_slice"],
      reviewWarnings: ["@iwsdk/vite-plugin-dev:review_required_package"],
      missingPackageManagerControls: [],
    });
  });

  it("allows the committed Phase 2 devtools proposal fixture with explicit approval", async () => {
    const fixturePath = path.resolve("docs/openclinxr/iwsdk-phase2-devtools-preinstall-proposal.json");
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "openclinxr-iwsdk-phase2-preinstall-"));
    const output = path.join(tempDir, "phase2-devtools-preinstall-report.json");

    await execFileAsync(
      path.resolve("node_modules/.bin/tsx"),
      [
        "tools/openclinxr/iwsdk-preinstall-check.ts",
        "--proposal",
        fixturePath,
        "--approved-phase2-devtools",
        "--output",
        output,
      ],
      { encoding: "utf8", timeout: 15000 },
    );

    const report = JSON.parse(await readFile(output, "utf8")) as IwsdkPreInstallProposalReport;
    expect(report.verdict).toEqual({
      readyToInstallInSidecar: true,
      blockers: [],
      reviewWarnings: [],
      missingPackageManagerControls: [],
    });
  });

  it("blocks package proposals with missing controls, blocked packages, and blocked license paths", () => {
    const report = buildIwsdkPreInstallProposalReport({
      generatedAt: "2026-05-04T00:00:00.000Z",
      proposal: {
        selectedPackages: [
          { name: "@iwsdk/core", version: "^0.3.1", license: "MIT", transitivePackages: [] },
          { name: "@meta-quest/hzdb", version: "1.1.0", license: "UNLICENSED", transitivePackages: [] },
        ],
        packageManagerControls: ["pin_exact_versions"],
      },
    });

    expect(report.verdict.readyToInstallInSidecar).toBe(false);
    expect(report.verdict.blockers).toEqual([
      "@iwsdk/core:version_not_exact",
      "@meta-quest/hzdb:blocked_package",
      "@meta-quest/hzdb:blocked_license_UNLICENSED",
      "missing_package_manager_control_pin_three_override",
      "missing_package_manager_control_record_pnpm_audit",
      "missing_package_manager_control_record_license_policy_report",
    ]);
  });

  it("exposes a package-managed CLI that exits nonzero for blocked proposals", async () => {
    const rootPackage = JSON.parse(await readFile("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(rootPackage.scripts["iwsdk:preinstall"]).toBe("tsx tools/openclinxr/iwsdk-preinstall-check.ts");
    expect(rootPackage.scripts["iwsdk:preinstall:fixture"]).toBe(
      "tsx tools/openclinxr/iwsdk-preinstall-check.ts --proposal docs/openclinxr/iwsdk-first-slice-preinstall-proposal.json",
    );
    expect(rootPackage.scripts["iwsdk:verify"]).toContain("pnpm iwsdk:preinstall:fixture");

    const dir = await mkdtemp(path.join(os.tmpdir(), "openclinxr-iwsdk-proposal-"));
    const proposalPath = path.join(dir, "proposal.json");
    await writeFile(
      proposalPath,
      `${JSON.stringify({
        selectedPackages: [
          {
            name: "@iwsdk/vite-plugin-gltf-optimizer",
            version: "0.3.1",
            license: "MIT",
            transitivePackages: ["@img/sharp-libvips-darwin-arm64"],
          },
        ],
        packageManagerControls: ["pin_exact_versions", "pin_three_override"],
      })}\n`,
      "utf8",
    );

    try {
      await execFileAsync(
        path.resolve("node_modules/.bin/tsx"),
        ["tools/openclinxr/iwsdk-preinstall-check.ts", "--proposal", proposalPath],
        { encoding: "utf8", timeout: 15000 },
      );
      throw new Error("Expected IWSDK preinstall checker to reject the proposal");
    } catch (error) {
      const failedRun = error as { code: number; stdout: string };
      const report = JSON.parse(failedRun.stdout) as IwsdkPreInstallProposalReport;

      expect(failedRun.code).toBe(1);
      expect(report.verdict.blockers).toEqual([
        "@iwsdk/vite-plugin-gltf-optimizer:not_allowed_in_first_slice",
        "@iwsdk/vite-plugin-gltf-optimizer:blocked_transitive_@img/sharp-libvips-darwin-arm64",
        "missing_package_manager_control_record_pnpm_audit",
        "missing_package_manager_control_record_license_policy_report",
      ]);
      expect(report.verdict.reviewWarnings).toEqual([
        "@iwsdk/vite-plugin-gltf-optimizer:review_required_package",
      ]);
    }
  });
});
