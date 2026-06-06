import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildCagematchOutputHome,
  buildGeneratedOutputHome,
  ensureCagematchOutputHome,
  ensureGeneratedOutputHome,
} from "./generated-output-home.js";

describe("generated output home", () => {
  it("exposes a source-controlled script for fresh-checkout local output setup", async () => {
    const rootPackage = JSON.parse(await readFile("package.json", "utf8")) as { scripts: Record<string, string> };

    expect(rootPackage.scripts["asset:cagematch:init-output-home"]).toBe("tsx tools/openclinxr/evidence/generated-output-home.ts");
  });

  it("keeps cagematch outputs local-only with an ignored public mirror", () => {
    const home = buildCagematchOutputHome("anny skin track a pbr", "2026-06-06");

    expect(home).toMatchObject({
      schemaVersion: "openclinxr.cagematch-output-home.v1",
      lane: "anny-skin-track-a-pbr",
      runId: "2026-06-06",
      localArtifactDir: ".openclinxr/asset-production/cagematch/anny-skin-track-a-pbr/2026-06-06",
      localEvidenceDir: ".openclinxr/evidence/cagematch/anny-skin-track-a-pbr/2026-06-06",
      publicMirrorDir: "apps/arena/model-vetting-studio/public/cagematch/anny-skin-track-a-pbr/2026-06-06",
      publicMirrorUrlPath: "/cagematch/anny-skin-track-a-pbr/2026-06-06",
      gitSourceControlled: false,
      runtimePromotionAllowed: false,
    });
    expect(home.generatedOutputPolicyPath).toBe("docs/openclinxr/generated-output-storage-policy-2026-06-06.md");
  });

  it("creates output roots on a fresh local checkout", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "openclinxr-output-home-"));
    const cwd = process.cwd();
    try {
      process.chdir(tempDir);
      const root = await ensureGeneratedOutputHome(buildGeneratedOutputHome());
      const cagematch = await ensureCagematchOutputHome(buildCagematchOutputHome("skin", "run"));

      expect(root.gitSourceControlled).toBe(false);
      await expect(stat(path.join(tempDir, root.assetProductionRoot)).then((item) => item.isDirectory())).resolves.toBe(true);
      await expect(stat(path.join(tempDir, root.evidenceRoot)).then((item) => item.isDirectory())).resolves.toBe(true);
      await expect(stat(path.join(tempDir, cagematch.localArtifactDir)).then((item) => item.isDirectory())).resolves.toBe(true);
      await expect(stat(path.join(tempDir, cagematch.localEvidenceDir)).then((item) => item.isDirectory())).resolves.toBe(true);
      await expect(stat(path.join(tempDir, cagematch.publicMirrorDir)).then((item) => item.isDirectory())).resolves.toBe(true);
    } finally {
      process.chdir(cwd);
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
