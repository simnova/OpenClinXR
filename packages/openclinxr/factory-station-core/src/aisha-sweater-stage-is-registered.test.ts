import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { POST_EXPORT_STAGE_REGISTRY } from "./runner.js";

/**
 * AISHA-SWEATER-POKE-THROUGH stage registration (tsk_4c6a7143f7dff5e0).
 *
 * The sweater-stage hide move runs as a registered post-export tool
 * (tools/openclinxr/asset-pipeline/makeclothes/rehide-aisha-shoulder-skin.py,
 * E9 rehide-poking-skin.py precedent) replayed through the NEW manifest
 * tools/.../humanoid-chain/manifests/mpfb-ob-patient-aisha.post-export.json
 * by the real run-chain loader (FINALIZE-2 precedent, MADR 0067).
 *
 * RED at HEAD (f7720c26): no registry entry and no manifest exist, so both
 * cases refuse. Plant (S5.4): registry entry removed -> this file fails.
 */

const TOOL = "tools/openclinxr/asset-pipeline/makeclothes/rehide-aisha-shoulder-skin.py";
const MANIFEST_REL =
  "tools/openclinxr/asset-pipeline/humanoid-chain/manifests/mpfb-ob-patient-aisha.post-export.json";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", "..", "..");

describe("aisha sweater stage is registered", () => {
  it("registers the aisha rehide tool with the E9 mutation contract", () => {
    const stage = POST_EXPORT_STAGE_REGISTRY[TOOL];
    expect(stage, `registry carries ${TOOL}`).toBeDefined();
    expect(stage?.mutates).toEqual(["body-primitive-indices", "hidden-skin-indices"]);
    expect(stage?.preserves).toEqual(["vertex-attributes", "morph-targets"]);
  });

  it("ships a post-export manifest naming the registered tool", () => {
    const path = join(REPO_ROOT, MANIFEST_REL);
    expect(existsSync(path), `manifest exists at ${MANIFEST_REL}`).toBe(true);
    const raw = JSON.parse(readFileSync(path, "utf8")) as {
      actorId: string;
      stages: Array<{ id: string; tool: string; postExport?: boolean }>;
    };
    expect(raw.actorId, "manifest actor").toBe("mpfb-ob-patient-aisha");
    // Mirrors run-chain validateManifest: every postExport stage's tool must
    // be registered (the real loader enforces this again at S3 replay).
    const postExport = raw.stages.filter((s) => s.postExport === true);
    expect(postExport.length, "manifest carries post-export stages").toBeGreaterThan(0);
    for (const stage of postExport) {
      expect(
        POST_EXPORT_STAGE_REGISTRY[stage.tool],
        `stage ${stage.id} tool is registered: ${stage.tool}`,
      ).toBeDefined();
    }
    expect(
      postExport.some((s) => s.tool === TOOL),
      `manifest replays ${TOOL}`,
    ).toBe(true);
  });
});
