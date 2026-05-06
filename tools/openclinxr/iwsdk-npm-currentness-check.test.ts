import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildIwsdkNpmCurrentnessReport,
  main,
  type IwsdkNpmMetadataSnapshot,
  validateIwsdkNpmMetadataSnapshot,
} from "./iwsdk-npm-currentness-check.js";

describe("IWSDK npm currentness check", () => {
  it("exposes currentness scripts in the IWSDK verification lane", async () => {
    const rootPackage = JSON.parse(await readFile("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };

    expect(rootPackage.scripts["iwsdk:npm-currentness"]).toBe(
      "tsx tools/openclinxr/iwsdk-npm-currentness-check.ts",
    );
    expect(rootPackage.scripts["iwsdk:npm-currentness:validate"]).toBe(
      "tsx tools/openclinxr/iwsdk-npm-currentness-check.ts --validate-latest",
    );
    expect(rootPackage.scripts["iwsdk:verify"]).toContain("pnpm iwsdk:npm-currentness:validate");
  });

  it("passes when captured npm metadata matches the known IWSDK package posture", () => {
    const report = buildIwsdkNpmCurrentnessReport({
      generatedAt: "2026-05-06T23:40:00.000Z",
      metadataFile: "docs/openclinxr/iwsdk-npm-metadata-snapshot-2026-05-06.json",
      metadata: metadataSnapshot(),
      repoViteVersion: "8.0.10",
    });

    expect(report).toMatchObject({
      kind: "iwsdk_npm_currentness_check",
      ready: true,
      currentness: {
        passed: true,
        blockers: [],
      },
      repo: {
        viteVersion: "8.0.10",
      },
      packages: [
        {
          name: "@iwsdk/core",
          latest_version: "0.3.1",
          expected_latest_version: "0.3.1",
          license: {
            source: "MIT",
            expected: "MIT",
            accepted: true,
          },
          current: true,
        },
        {
          name: "@iwsdk/vite-plugin-dev",
          latest_version: "0.3.1",
          expected_latest_version: "0.3.1",
          peer_dependencies: {
            vite: "^7.0.0",
          },
          adoption_blockers: [
            "vite_peer_range_does_not_accept_repo_vite_major:@iwsdk/vite-plugin-dev:^7.0.0_vs_8.0.10",
          ],
        },
        {
          name: "@meta-quest/hzdb",
          latest_version: "1.1.0",
          license: {
            source: "UNLICENSED",
            expected: "UNLICENSED",
            accepted: true,
          },
          adoption_blockers: [
            "package_license_requires_legal_procurement_approval:@meta-quest/hzdb:UNLICENSED",
          ],
        },
      ],
    });
  });

  it("blocks when a captured IWSDK package latest version moves beyond the approved snapshot", () => {
    const snapshot = metadataSnapshot();
    snapshot.packages = snapshot.packages.map((entry) =>
      entry.name === "@iwsdk/core" ? { ...entry, latestVersion: "0.3.2" } : entry,
    );

    const report = buildIwsdkNpmCurrentnessReport({
      generatedAt: "2026-05-06T23:40:00.000Z",
      metadataFile: "metadata.json",
      metadata: snapshot,
      repoViteVersion: "8.0.10",
    });

    expect(report.ready).toBe(false);
    expect(report.currentness.blockers).toEqual([
      "npm_latest_version_moved:@iwsdk/core:expected_0.3.1_actual_0.3.2",
    ]);
  });

  it("writes and validates latest currentness reports from the CLI", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "openclinxr-iwsdk-npm-currentness-"));
    const metadataPath = path.join(dir, "iwsdk-npm-metadata-snapshot-2026-05-06.json");
    const outputPath = path.join(dir, "iwsdk-npm-currentness-2026-05-06.json");

    await writeFile(metadataPath, `${JSON.stringify(metadataSnapshot(), null, 2)}\n`, "utf8");

    await main([
      "--metadata-input",
      metadataPath,
      "--generated-at",
      "2026-05-06T23:40:00.000Z",
      "--repo-vite-version",
      "8.0.10",
      "--output",
      outputPath,
    ]);
    const report = JSON.parse(await readFile(outputPath, "utf8")) as ReturnType<typeof buildIwsdkNpmCurrentnessReport>;

    expect(report.ready).toBe(true);
    expect(validateIwsdkNpmMetadataSnapshot(metadataSnapshot())).toEqual({ ok: true });
    await expect(main(["--validate", outputPath])).resolves.toBeUndefined();
  });
});

function metadataSnapshot(): IwsdkNpmMetadataSnapshot {
  return {
    kind: "iwsdk_npm_metadata_snapshot",
    capturedAt: "2026-05-06T23:35:00.000Z",
    source: {
      command: "npm view --json",
      registry: "https://registry.npmjs.org/",
    },
    packages: [
      packageMetadata("@iwsdk/core", "0.3.1", "MIT"),
      packageMetadata("@iwsdk/xr-input", "0.3.1", "MIT"),
      packageMetadata("@iwsdk/locomotor", "0.3.1", "MIT"),
      packageMetadata("@iwsdk/glxf", "0.3.1", "MIT"),
      packageMetadata("@iwsdk/vite-plugin-dev", "0.3.1", "MIT", { vite: "^7.0.0" }),
      packageMetadata("@iwsdk/vite-plugin-gltf-optimizer", "0.3.1", "MIT", { vite: "^7.0.0" }),
      packageMetadata("@iwsdk/vite-plugin-uikitml", "0.3.1", "MIT", { vite: "^7.0.0" }),
      packageMetadata("@iwsdk/vite-plugin-metaspatial", "0.3.1", "MIT", { vite: "^7.0.0" }),
      packageMetadata("@iwsdk/reference", "0.3.2", "MIT"),
      packageMetadata("@meta-quest/hzdb", "1.1.0", "UNLICENSED"),
    ],
  };
}

function packageMetadata(
  name: string,
  latestVersion: string,
  license: string,
  peerDependencies: Record<string, string> = {},
): IwsdkNpmMetadataSnapshot["packages"][number] {
  return {
    name,
    latestVersion,
    license,
    peerDependencies,
    dependencies: {},
    bin: {},
  };
}
