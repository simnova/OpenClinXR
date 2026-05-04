import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import {
  buildIwsdkWorkspacePostureReport,
  type IwsdkWorkspacePostureReport,
} from "./iwsdk-workspace-posture-check.js";

const execFileAsync = promisify(execFile);

describe("IWSDK workspace posture checker", () => {
  it("scores an approved first-slice sidecar workspace as posture-ready", async () => {
    const workspaceRoot = await createWorkspaceFixture({
      sidecarDependencies: {
        "@iwsdk/core": "0.3.1",
        "@iwsdk/xr-input": "0.3.1",
      },
      rootPackage: postureReadyRootPackage(),
    });

    expect(await buildIwsdkWorkspacePostureReport({
      generatedAt: "2026-05-04T00:00:00.000Z",
      workspaceRoot,
      sidecarInstallApproved: true,
    })).toMatchObject({
      generatedAt: "2026-05-04T00:00:00.000Z",
      workspaceRoot,
      result: {
        ready: true,
        sidecarStatus: "present_approved",
        blockers: [],
        reviewWarnings: [],
      },
    });
  });

  it("reports production leakage, blocked packages, and missing controls from workspace files", async () => {
    const workspaceRoot = await createWorkspaceFixture({
      rootPackage: {
        scripts: {
          "iwsdk:verify": "pnpm --filter @openclinxr/iwsdk-spike test",
          "iwsdk:reference:warmup": "npx iwsdk reference warmup",
        },
      },
      productionDependencies: {
        "@iwsdk/core": "0.3.1",
      },
      sidecarDependencies: {
        "@iwsdk/reference": "0.3.1",
      },
      lockfileText: "/@meta-quest/hzdb@1.1.0:\n",
    });
    await mkdir(path.join(workspaceRoot, "apps/ui-xr/src"), { recursive: true });
    await writeFile(
      path.join(workspaceRoot, "apps/ui-xr/src/runtime.tsx"),
      "import '@iwsdk/xr-input';\nexport { controller } from '@iwsdk/core';\n",
      "utf8",
    );

    const report = await buildIwsdkWorkspacePostureReport({
      generatedAt: "2026-05-04T00:00:00.000Z",
      workspaceRoot,
      sidecarInstallApproved: true,
    });

    expect(report.result).toEqual({
      ready: false,
      sidecarStatus: "present_approved",
      blockers: [
        "dependency_outside_iwsdk_sidecar:apps/ui-xr/package.json:dependencies.@iwsdk/core",
        "source_import_outside_iwsdk_sidecar:apps/ui-xr/src/runtime.tsx:@iwsdk/xr-input",
        "source_import_outside_iwsdk_sidecar:apps/ui-xr/src/runtime.tsx:@iwsdk/core",
        "blocked_script_action:package.json:scripts.iwsdk:reference:warmup:iwsdk_reference_warmup",
        "@iwsdk/reference:blocked_package",
        "blocked_package_in_lockfile:@meta-quest/hzdb",
        "missing_package_manager_control_pin_three_override",
        "missing_package_manager_control_record_pnpm_audit",
        "missing_package_manager_control_record_license_policy_report",
        "iwsdk_workspace_posture_not_in_verify",
      ],
      reviewWarnings: [],
    });
  });

  it("exposes a CLI and includes it in the IWSDK verification lane", async () => {
    const rootPackage = JSON.parse(await readFile("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(rootPackage.scripts["iwsdk:workspace:posture"]).toBe(
      "tsx tools/openclinxr/iwsdk-workspace-posture-check.ts",
    );
    expect(rootPackage.scripts["iwsdk:verify"]).toContain("pnpm iwsdk:workspace:posture");

    const tempDir = await mkdtemp(path.join(os.tmpdir(), "openclinxr-iwsdk-workspace-posture-"));
    const outputPath = path.join(tempDir, "report.json");
    const { stdout } = await execFileAsync(
      path.resolve("node_modules/.bin/tsx"),
      ["tools/openclinxr/iwsdk-workspace-posture-check.ts", "--output", outputPath],
      { encoding: "utf8", timeout: 15000 },
    );
    const report = JSON.parse(await readFile(outputPath, "utf8")) as IwsdkWorkspacePostureReport;

    expect(stdout).toContain(`Wrote ${outputPath}`);
    expect(report.result.ready).toBe(true);
    expect(report.result.sidecarStatus).toBe("absent_contract_only");
  });
});

async function createWorkspaceFixture(input: {
  rootPackage: Record<string, unknown>;
  productionDependencies?: Record<string, string>;
  sidecarDependencies?: Record<string, string>;
  lockfileText?: string;
}): Promise<string> {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "openclinxr-iwsdk-posture-fixture-"));
  await writeFile(path.join(workspaceRoot, "pnpm-workspace.yaml"), "packages:\n  - \"apps/*\"\n", "utf8");
  await writeJson(path.join(workspaceRoot, "package.json"), input.rootPackage);
  await writeFile(path.join(workspaceRoot, "pnpm-lock.yaml"), input.lockfileText ?? "lockfileVersion: '9.0'\n", "utf8");

  if (input.productionDependencies) {
    await writeJson(path.join(workspaceRoot, "apps/ui-xr/package.json"), {
      name: "@openclinxr/ui-xr",
      dependencies: input.productionDependencies,
    });
  }

  if (input.sidecarDependencies) {
    await writeJson(path.join(workspaceRoot, "apps/ui-xr-iwsdk-spike/package.json"), {
      name: "@openclinxr/ui-xr-iwsdk-spike",
      dependencies: input.sidecarDependencies,
    });
  }

  return workspaceRoot;
}

function postureReadyRootPackage(): Record<string, unknown> {
  return {
    scripts: {
      "iwsdk:verify": "pnpm iwsdk:workspace:posture && pnpm security:audit && pnpm security:licenses",
      "security:audit": "pnpm audit --audit-level=high",
      "security:licenses": "tsx tools/openclinxr/check-license-policy.ts",
    },
    pnpm: {
      overrides: {
        three: "0.184.0",
      },
    },
  };
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
