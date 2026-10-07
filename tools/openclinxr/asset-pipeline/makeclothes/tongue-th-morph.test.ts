/**
 * Tongue interdental TH (operator option C): the tongue mesh carries a
 * single viseme_TH morph target whose tip lands between the incisors, and
 * the runtime drives it by name with zero delta on every other viseme.
 *
 * (1) The shipped tongue mesh carries exactly ["viseme_TH"] (VEC3 x253).
 * (2) The runtime wire (applyDialogueVisemeTimelineToRoot, the same call the
 *     stills session uses) writes influence 1 on the tongue viseme_TH for a
 *     TH cue and 0 for every other isolated viseme — no tongue-specific
 *     runtime branch exists; traversal + name resolution already cover it.
 * (3) The producer solve re-derives the gates from the git pre-image:
 *     253 verts, tip residual <= 0.5 mm, all clearances > 0, 0 inversions.
 *
 * claimScope: tongue TH placement and its runtime reach. notEvidenceFor:
 *   pixels (the stills session grades those), clinical validity.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";
import { applyDialogueVisemeTimelineToRoot } from "@openclinxr/xr-dialogue/viseme-runtime";
import { planRimSeat } from "./seat-teeth-on-lip-rim.ts";
import { loadProducerPreimage, readProducerReceipt } from "./producer-preimage.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../../../..");
const GLB_REL = "apps/ui-xr/public/generated-humanoids/mpfb-peds-parent-aisha.glb";
const RECEIPT_REL = `${GLB_REL.slice(0, -".glb".length)}.provenance.json`;
const ISOLATED = ["sil", "PP", "FF", "TH", "DD", "kk", "CH", "SS", "nn", "RR", "aa", "E", "I", "O", "U"];

describe("tongue interdental TH", () => {
  it("(1) the shipped tongue mesh carries exactly one viseme_TH target", async () => {
    const doc = await new NodeIO().read(path.join(REPO, GLB_REL));
    const tongues = doc.getRoot().listMeshes().filter((mesh) => /tongue/i.test(mesh.getName()));
    expect(tongues.length).toBe(1);
    const tongue = tongues[0];
    if (!tongue) throw new Error("tongue mesh missing");
    expect((tongue.getExtras() as { targetNames?: string[] } | null)?.targetNames).toEqual(["viseme_TH"]);
    const prim = tongue.listPrimitives()[0];
    if (!prim) throw new Error("tongue primitive missing");
    expect(prim.listTargets().length).toBe(1);
    const accessor = prim.listTargets()[0]?.getAttribute("POSITION");
    expect(accessor?.getCount()).toBe(253);
    expect(accessor?.getComponentType()).toBe(5126);
  });

  it("(2) the runtime wire drives tongue viseme_TH by name, zero elsewhere", () => {
    for (const viseme of ISOLATED) {
      const influences = [0];
      const root = {
        traverse(callback: (object: unknown) => void): void {
          callback({
            name: "openclinxr_fitted_tongue_probe_mesh",
            morphTargetDictionary: { viseme_TH: 0 },
            morphTargetInfluences: influences,
          });
        },
        userData: {} as Record<string, unknown>,
      };
      const result = applyDialogueVisemeTimelineToRoot(root, {
        phonemeSequence: ["sil"],
        progress: 0.5,
        bakedCues: [{ phoneme: viseme, atSecond: 0, durationSeconds: 1, intensity: 1 }],
      });
      expect(result.appliedMeshCount).toBe(1);
      expect(influences[0]).toBe(viseme === "TH" ? 1 : 0);
    }
  });

  it("(3) the producer solve re-derives the gates from the git pre-image", async () => {
    const pre = readProducerReceipt(REPO, RECEIPT_REL);
    const preTmp = loadProducerPreimage(REPO, GLB_REL, pre.preImageSha256, pre.preImageBytes);
    const { plan, newTongueTh } = await planRimSeat(preTmp, 3.743, false, 1.25, 4.215, true);
    const tongue = plan.tongueTh;
    expect(tongue.targetName).toBe("viseme_TH");
    expect(tongue.tongueVerts).toBe(253);
    expect(tongue.fullWeightVerts).toBeGreaterThan(0);
    expect(tongue.tipResidualMm).toBeLessThanOrEqual(0.5);
    expect(tongue.minClearanceUpperMm).toBeGreaterThan(0);
    expect(tongue.minClearanceLowerMm).toBeGreaterThan(0);
    expect(tongue.minClearanceLipMm).toBeGreaterThan(0);
    expect(tongue.invertedTris).toBe(0);
    expect(newTongueTh.length).toBe(253 * 3);
  }, 300_000);
});
