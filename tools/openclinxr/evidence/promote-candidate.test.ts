/**
 * Unit tests for promote-candidate deploy helpers.
 * Uses os.tmpdir() fixtures only — does not depend on .openclinxr.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyDeployCopy,
  parseArgs,
  promotionRecordFileName,
} from "./promote-candidate.js";
import { deployTargetsForManifest } from "../../../packages/openclinxr/arena/model-vetting/src/pipeline-candidate.js";

const cleanupDirs: string[] = [];

afterEach(async () => {
  for (const dir of cleanupDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
});

describe("applyDeployCopy", () => {
  it("copies source GLB to BOTH deploy targets under a temp repo root", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "promote-deploy-"));
    cleanupDirs.push(root);

    const sourceRel = "source/fixture.glb";
    const sourceAbs = path.join(root, sourceRel);
    await mkdir(path.dirname(sourceAbs), { recursive: true });
    await writeFile(sourceAbs, Buffer.from("glTF-fixture-bytes"));

    const manifestId = "fixture_manifest";
    const deployTargets = deployTargetsForManifest(manifestId);
    expect(deployTargets).toHaveLength(2);

    const result = await applyDeployCopy({
      repoRoot: root,
      sourceGlbPath: sourceRel,
      deployTargets,
    });

    expect(result.sourceExists).toBe(true);
    expect(result.results).toHaveLength(2);
    expect(result.results.every((r) => r.status === "copied")).toBe(true);

    for (const target of deployTargets) {
      const destAbs = path.join(root, target);
      const bytes = await readFile(destAbs);
      expect(bytes.toString()).toBe("glTF-fixture-bytes");
    }
  });

  it("skips copy (no throw) when source GLB is missing", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "promote-skip-"));
    cleanupDirs.push(root);

    const deployTargets = deployTargetsForManifest("missing_src");
    const result = await applyDeployCopy({
      repoRoot: root,
      sourceGlbPath: "does/not/exist.glb",
      deployTargets,
    });

    expect(result.sourceExists).toBe(false);
    expect(result.results.every((r) => r.status === "skipped_missing_source")).toBe(true);
  });
});

describe("promote-candidate argument + filename helpers", () => {
  it("parses flags and value pairs", () => {
    const args = parseArgs(["--candidate-id", "g/a", "--apply-copy", "--reason", "best"]);
    expect(args["candidate-id"]).toBe("g/a");
    expect(args["apply-copy"]).toBe(true);
    expect(args["reason"]).toBe("best");
  });
  it("builds a filesystem-safe record filename", () => {
    const name = promotionRecordFileName("photoreal/nurse_winner", "2026-08-03T21:00:00.000Z");
    expect(name).not.toContain("/");
    expect(name).not.toContain(":");
    expect(name.endsWith(".json")).toBe(true);
    expect(name).toContain("photoreal_nurse_winner");
  });
});
