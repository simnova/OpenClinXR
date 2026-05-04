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
      writeSidecarLockfileImporter: true,
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

  it("blocks sidecar IWSDK dependencies when the lockfile lacks the sidecar importer", async () => {
    const workspaceRoot = await createWorkspaceFixture({
      sidecarDependencies: {
        "@iwsdk/core": "0.3.1",
        "@iwsdk/xr-input": "0.3.1",
      },
      rootPackage: postureReadyRootPackage(),
    });

    const report = await buildIwsdkWorkspacePostureReport({
      generatedAt: "2026-05-04T00:00:00.000Z",
      workspaceRoot,
      sidecarInstallApproved: true,
    });

    expect(report.result).toMatchObject({
      ready: false,
      blockers: ["missing_iwsdk_sidecar_lockfile_importer"],
    });
  });

  it("blocks stale IWSDK sidecar lockfile importers when the sidecar app is absent", async () => {
    const workspaceRoot = await createWorkspaceFixture({
      rootPackage: postureReadyRootPackage(),
      writeSidecarLockfileImporter: true,
    });

    const report = await buildIwsdkWorkspacePostureReport({
      generatedAt: "2026-05-04T00:00:00.000Z",
      workspaceRoot,
    });

    expect(report.result).toMatchObject({
      ready: false,
      blockers: ["iwsdk_sidecar_lockfile_importer_without_sidecar_app"],
    });
  });

  it("blocks IWSDK npm alias specifiers that would bypass package-name scanning", async () => {
    const workspaceRoot = await createWorkspaceFixture({
      rootPackage: postureReadyRootPackage(),
      productionDependencies: {
        "local-iwsdk-core": "npm:@iwsdk/core@0.3.1",
      },
    });

    const report = await buildIwsdkWorkspacePostureReport({
      generatedAt: "2026-05-04T00:00:00.000Z",
      workspaceRoot,
    });

    expect(report.detected.dependencies).toEqual([
      {
        manifestPath: "apps/ui-xr/package.json",
        field: "dependencies",
        name: "local-iwsdk-core",
        version: "npm:@iwsdk/core@0.3.1",
      },
    ]);
    expect(report.result.blockers).toEqual([
      "dependency_outside_iwsdk_sidecar:apps/ui-xr/package.json:dependencies.local-iwsdk-core",
      "iwsdk_alias_specifier_not_allowed:apps/ui-xr/package.json:dependencies.local-iwsdk-core:@iwsdk/core",
    ]);
  });

  it("blocks sidecar coupling to production UI app internals", async () => {
    const workspaceRoot = await createWorkspaceFixture({
      rootPackage: postureReadyRootPackage(),
      sidecarDependencies: {
        "@iwsdk/core": "0.3.1",
        "@iwsdk/xr-input": "0.3.1",
        "@openclinxr/ui-xr": "workspace:*",
      },
      writeSidecarLockfileImporter: true,
    });
    await mkdir(path.join(workspaceRoot, "apps/ui-xr/src"), { recursive: true });
    await mkdir(path.join(workspaceRoot, "apps/ui-xr-iwsdk-spike/src"), { recursive: true });
    await writeFile(
      path.join(workspaceRoot, "apps/ui-xr/src/runtime-state.ts"),
      "export const smokePlan = 'production';\n",
      "utf8",
    );
    await writeFile(
      path.join(workspaceRoot, "apps/ui-xr-iwsdk-spike/src/main.ts"),
      [
        "import { smokePlan } from '../../ui-xr/src/runtime-state.js';",
        "import { AdminApp } from '@openclinxr/ui-xr';",
        "void smokePlan;",
        "void AdminApp;",
        "",
      ].join("\n"),
      "utf8",
    );

    const report = await buildIwsdkWorkspacePostureReport({
      generatedAt: "2026-05-04T00:00:00.000Z",
      workspaceRoot,
      sidecarInstallApproved: true,
    });

    expect(report.detected.sidecarProductionUiCouplings).toEqual([
      {
        filePath: "apps/ui-xr-iwsdk-spike/package.json",
        specifier: "@openclinxr/ui-xr",
      },
      {
        filePath: "apps/ui-xr-iwsdk-spike/src/main.ts",
        specifier: "../../ui-xr/src/runtime-state.js",
      },
      {
        filePath: "apps/ui-xr-iwsdk-spike/src/main.ts",
        specifier: "@openclinxr/ui-xr",
      },
    ]);
    expect(report.result.blockers).toEqual([
      "sidecar_coupling_to_production_ui:apps/ui-xr-iwsdk-spike/package.json:@openclinxr/ui-xr",
      "sidecar_coupling_to_production_ui:apps/ui-xr-iwsdk-spike/src/main.ts:../../ui-xr/src/runtime-state.js",
      "sidecar_coupling_to_production_ui:apps/ui-xr-iwsdk-spike/src/main.ts:@openclinxr/ui-xr",
    ]);
  });

  it("blocks IWSDK references in root package-manager controls", async () => {
    const workspaceRoot = await createWorkspaceFixture({
      rootPackage: {
        ...postureReadyRootPackage(),
        catalog: {
          "local-iwsdk-core": "npm:@iwsdk/core@0.3.1",
        },
        pnpm: {
          overrides: {
            three: "0.184.0",
            "@iwsdk/xr-input": "0.3.1",
          },
        },
      },
    });

    const report = await buildIwsdkWorkspacePostureReport({
      generatedAt: "2026-05-04T00:00:00.000Z",
      workspaceRoot,
    });

    expect(report.detected.packageManagerReferences).toEqual([
      {
        manifestPath: "package.json",
        location: "pnpm.overrides.@iwsdk/xr-input",
        packageName: "@iwsdk/xr-input",
        specifier: "0.3.1",
      },
      {
        manifestPath: "package.json",
        location: "catalog.local-iwsdk-core",
        packageName: "@iwsdk/core",
        specifier: "npm:@iwsdk/core@0.3.1",
      },
    ]);
    expect(report.result.blockers).toEqual([
      "iwsdk_package_manager_reference_not_allowed:package.json:pnpm.overrides.@iwsdk/xr-input:@iwsdk/xr-input",
      "iwsdk_package_manager_reference_not_allowed:package.json:catalog.local-iwsdk-core:@iwsdk/core",
    ]);
  });

  it("blocks IWSDK references in pnpm workspace catalogs", async () => {
    const workspaceRoot = await createWorkspaceFixture({
      rootPackage: postureReadyRootPackage(),
      workspaceYamlText: [
        "packages:",
        "  - \"apps/*\"",
        "catalog:",
        "  local-iwsdk-core: npm:@iwsdk/core@0.3.1",
        "",
      ].join("\n"),
    });

    const report = await buildIwsdkWorkspacePostureReport({
      generatedAt: "2026-05-04T00:00:00.000Z",
      workspaceRoot,
    });

    expect(report.detected.packageManagerReferences).toEqual([
      {
        manifestPath: "pnpm-workspace.yaml",
        location: "catalog.local-iwsdk-core",
        packageName: "@iwsdk/core",
        specifier: "npm:@iwsdk/core@0.3.1",
      },
    ]);
    expect(report.result.blockers).toEqual([
      "iwsdk_package_manager_reference_not_allowed:pnpm-workspace.yaml:catalog.local-iwsdk-core:@iwsdk/core",
    ]);
  });

  it("blocks stale allowed IWSDK packages in the lockfile when the sidecar app is absent", async () => {
    const workspaceRoot = await createWorkspaceFixture({
      rootPackage: postureReadyRootPackage(),
      lockfileText: "/@iwsdk/core@0.3.1:\n/@iwsdk/xr-input@0.3.1:\n",
    });

    const report = await buildIwsdkWorkspacePostureReport({
      generatedAt: "2026-05-04T00:00:00.000Z",
      workspaceRoot,
    });

    expect(report.detected.lockfilePackageNames).toEqual(["@iwsdk/core", "@iwsdk/xr-input"]);
    expect(report.result.blockers).toEqual([
      "iwsdk_package_in_lockfile_without_sidecar_app:@iwsdk/core",
      "iwsdk_package_in_lockfile_without_sidecar_app:@iwsdk/xr-input",
    ]);
  });

  it("blocks quoted pnpm lockfile IWSDK package keys", async () => {
    const workspaceRoot = await createWorkspaceFixture({
      rootPackage: postureReadyRootPackage(),
      lockfileText: [
        "'@iwsdk/core@0.3.1':",
        "'@meta-quest/hzdb@1.1.0':",
        "'@img/sharp-libvips-linux-x64@1.0.4':",
        "",
      ].join("\n"),
    });

    const report = await buildIwsdkWorkspacePostureReport({
      generatedAt: "2026-05-04T00:00:00.000Z",
      workspaceRoot,
    });

    expect(report.detected.lockfilePackageNames).toEqual([
      "@iwsdk/core",
      "@meta-quest/hzdb",
      "@img/sharp-libvips-linux-x64",
    ]);
    expect(report.result.blockers).toEqual([
      "iwsdk_package_in_lockfile_without_sidecar_app:@iwsdk/core",
      "blocked_package_in_lockfile:@meta-quest/hzdb",
      "blocked_transitive_package_in_lockfile:@img/sharp-libvips-linux-x64",
    ]);
  });

  it("blocks approved sidecar dependencies when the lockfile importer lacks matching IWSDK entries", async () => {
    const workspaceRoot = await createWorkspaceFixture({
      sidecarDependencies: {
        "@iwsdk/core": "0.3.1",
        "@iwsdk/xr-input": "0.3.1",
      },
      rootPackage: postureReadyRootPackage(),
      lockfileText: [
        "lockfileVersion: '9.0'",
        "",
        "importers:",
        "",
        "  apps/ui-xr-iwsdk-spike:",
        "    dependencies:",
        "      react:",
        "        specifier: 19.2.3",
        "        version: 19.2.3",
        "",
      ].join("\n"),
    });

    const report = await buildIwsdkWorkspacePostureReport({
      generatedAt: "2026-05-04T00:00:00.000Z",
      workspaceRoot,
      sidecarInstallApproved: true,
    });

    expect(report.detected.sidecarLockfileImporterPresent).toBe(true);
    expect(report.detected.sidecarLockfilePackageNames).toEqual([]);
    expect(report.result.blockers).toEqual([
      "missing_iwsdk_sidecar_lockfile_dependency:apps/ui-xr-iwsdk-spike:@iwsdk/core",
      "missing_iwsdk_sidecar_lockfile_dependency:apps/ui-xr-iwsdk-spike:@iwsdk/xr-input",
    ]);
  });

  it("does not accept placeholder audit and license scripts as sidecar controls", async () => {
    const workspaceRoot = await createWorkspaceFixture({
      sidecarDependencies: {
        "@iwsdk/core": "0.3.1",
        "@iwsdk/xr-input": "0.3.1",
      },
      writeSidecarLockfileImporter: true,
      rootPackage: {
        scripts: {
          "iwsdk:verify": "pnpm iwsdk:workspace:posture && pnpm security:audit && pnpm security:licenses",
          "security:audit": "echo pnpm audit",
          "security:licenses": "true",
        },
        pnpm: {
          overrides: {
            three: "0.184.0",
          },
        },
      },
    });

    const report = await buildIwsdkWorkspacePostureReport({
      generatedAt: "2026-05-04T00:00:00.000Z",
      workspaceRoot,
      sidecarInstallApproved: true,
    });

    expect(report.detected.packageManagerControls).toMatchObject({
      auditScriptPresent: false,
      licenseScriptPresent: false,
    });
    expect(report.result.blockers).toEqual([
      "missing_package_manager_control_record_pnpm_audit",
      "missing_package_manager_control_record_license_policy_report",
    ]);
  });

  it("reports production leakage, blocked packages, and missing controls from workspace files", async () => {
    const workspaceRoot = await createWorkspaceFixture({
      rootPackage: {
        scripts: {
          "iwsdk:verify": "pnpm --filter @openclinxr/iwsdk-spike test",
          "iwsdk:reference:warmup": "pnpm dlx @iwsdk/reference@0.3.2 iwsdk-reference warmup",
        },
      },
      productionDependencies: {
        "@iwsdk/core": "0.3.1",
      },
      sidecarDependencies: {
        "@iwsdk/reference": "0.3.1",
      },
      lockfileText: "importers:\n\n  apps/ui-xr-iwsdk-spike:\n/@meta-quest/hzdb@1.1.0:\n/@img/sharp-libvips-linux-x64@1.0.4:\n",
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
        "blocked_transitive_package_in_lockfile:@img/sharp-libvips-linux-x64",
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
  workspaceYamlText?: string;
  writeSidecarLockfileImporter?: boolean;
}): Promise<string> {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "openclinxr-iwsdk-posture-fixture-"));
  await writeFile(
    path.join(workspaceRoot, "pnpm-workspace.yaml"),
    input.workspaceYamlText ?? "packages:\n  - \"apps/*\"\n",
    "utf8",
  );
  await writeJson(path.join(workspaceRoot, "package.json"), input.rootPackage);
  await writeFile(
    path.join(workspaceRoot, "pnpm-lock.yaml"),
    input.lockfileText ?? buildFixtureLockfile(input.writeSidecarLockfileImporter),
    "utf8",
  );

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

function buildFixtureLockfile(writeSidecarLockfileImporter = false): string {
  if (!writeSidecarLockfileImporter) {
    return "lockfileVersion: '9.0'\n";
  }

  return [
    "lockfileVersion: '9.0'",
    "",
    "importers:",
    "",
    "  apps/ui-xr-iwsdk-spike:",
    "    dependencies:",
    "      '@iwsdk/core':",
    "        specifier: 0.3.1",
    "        version: 0.3.1(three@0.184.0)",
    "      '@iwsdk/xr-input':",
    "        specifier: 0.3.1",
    "        version: 0.3.1(three@0.184.0)",
    "",
  ].join("\n");
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
