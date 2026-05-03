import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildOpenClinXrCjsAliasMap,
  createOpenClinXrAzureFunctionsRolldownConfig,
  prepareOpenClinXrAzureFunctionsDeploy,
  summarizeRolldownAdoption,
} from "./index.js";

const tempRootPrefix = path.join(os.tmpdir(), "openclinxr-config-rolldown-");

describe("OpenClinXR Rolldown config adoption", () => {
  afterEach(async () => {
    await cleanupTempRepos();
  });

  it("creates an Azure Functions bundle config shaped after Cellix config-rolldown", async () => {
    const config = await createOpenClinXrAzureFunctionsRolldownConfig({
      appPackageName: "@apps/api",
      repoRoot: await createTempRepo({
        "apps/api/package.json": JSON.stringify(
          {
            name: "@apps/api",
            version: "1.0.0",
            dependencies: {
              "@openclinxr/domain": "workspace:*",
              hono: "4.12.16",
              "definitely-missing-package": "1.0.0",
            },
          },
          null,
          2,
        ),
        "packages/openclinxr/domain/package.json": JSON.stringify(
          {
            name: "@openclinxr/domain",
            version: "0.1.0",
            dependencies: {
              vitest: "4.1.5",
            },
          },
          null,
          2,
        ),
      }),
    });

    expect(config).toMatchObject({
      input: "./dist/index.js",
      platform: "node",
      treeshake: true,
      external: [/^node:/, "@azure/functions-core"],
      output: {
        dir: "deploy/dist",
        format: "esm",
        sourcemap: true,
      },
    });
    expect(config.resolve.alias.hono).toContain("hono");
    expect(config.resolve.alias.vitest).toContain("vitest");
    expect(config.resolve.alias).not.toHaveProperty("definitely-missing-package");
    expect(config.transform.define.__dirname).toBe("import.meta.dirname");
    expect(config.output.banner).toContain("globalThis.require");

    const defaultHandler = vi.fn();
    config.onLog?.(
      "warn",
      {
        code: "EVAL",
        message: "Uses eval in @protobufjs/inquire/index.js",
      },
      defaultHandler,
    );
    expect(defaultHandler).not.toHaveBeenCalled();

    config.onLog?.(
      "warn",
      {
        code: "OTHER",
        message: "keep this warning",
      },
      defaultHandler,
    );
    expect(defaultHandler).toHaveBeenCalledTimes(1);
  });

  it("throws when the requested workspace package cannot be found", async () => {
    await expect(
      buildOpenClinXrCjsAliasMap({
        repoRoot: await createTempRepo({}),
        appPackageName: "@apps/missing",
      }),
    ).rejects.toThrow("Workspace package not found: @apps/missing");
  });

  it("prepares the deploy artifact for Azure Functions", async () => {
    const appDir = await createTempRepo({
      "package.json": JSON.stringify(
        {
          name: "@openclinxr/api",
          version: "0.1.0",
        },
        null,
        2,
      ),
      "host.json": JSON.stringify({ version: "2.0" }, null, 2),
      ".funcignore": "*.ts\nnode_modules/typescript/\n",
      "deploy/dist/index.js": "export const handler = () => 'ok';\n",
    });

    await prepareOpenClinXrAzureFunctionsDeploy({ appDir });

    const copiedHostJson = await fs.readFile(path.join(appDir, "deploy/host.json"), "utf8");
    const copiedFuncIgnore = await fs.readFile(path.join(appDir, "deploy/.funcignore"), "utf8");
    const deployPackageJson = JSON.parse(await fs.readFile(path.join(appDir, "deploy/package.json"), "utf8")) as Record<
      string,
      unknown
    >;

    expect(JSON.parse(copiedHostJson)).toEqual({ version: "2.0" });
    expect(copiedFuncIgnore).toBe("*.ts\nnode_modules/typescript/\n");
    expect(deployPackageJson).toEqual({
      name: "@openclinxr/api",
      version: "0.1.0",
      private: true,
      type: "module",
      main: "dist/index.js",
    });
  });

  it("fails deploy preparation when the bundle entry is missing", async () => {
    const appDir = await createTempRepo({
      "package.json": JSON.stringify({ name: "@openclinxr/api", version: "0.1.0" }, null, 2),
      "host.json": JSON.stringify({ version: "2.0" }, null, 2),
    });

    await expect(prepareOpenClinXrAzureFunctionsDeploy({ appDir })).rejects.toThrow(
      "Run the app build before prepare:deploy.",
    );
  });

  it("documents why OpenClinXR owns a local config before copying Cellix config packages", () => {
    expect(summarizeRolldownAdoption()).toEqual({
      candidateCellixPackage: "@cellix/config-rolldown",
      localPackage: "@openclinxr/config-rolldown",
      status: "workspace_alias_and_deploy_prep_spike",
      reason:
        "OpenClinXR keeps a project-owned Rolldown wrapper while validating latest Rolldown compatibility, workspace alias resolution, and Azure Functions deploy artifact prep against its own package layout.",
    });
  });
});

async function createTempRepo(files: Record<string, string>): Promise<string> {
  const repoRoot = await fs.mkdtemp(tempRootPrefix);
  await fs.mkdir(path.join(repoRoot, "apps"), { recursive: true });
  await fs.mkdir(path.join(repoRoot, "packages"), { recursive: true });

  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = path.join(repoRoot, relativePath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, content);
  }

  return repoRoot;
}

async function cleanupTempRepos(): Promise<void> {
  const entries = await fs.readdir(os.tmpdir(), { withFileTypes: true });
  await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && entry.name.startsWith(path.basename(tempRootPrefix)))
      .map((entry) => fs.rm(path.join(os.tmpdir(), entry.name), { recursive: true, force: true })),
  );
}
