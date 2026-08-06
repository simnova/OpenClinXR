import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { assessHumanoidProportions, extractJointsFromGlb } from "./humanoid-proportions-probe.js";

/**
 * PLANTED CONTRACTS (#58) — the shipped parent and nurse are not human-shaped.
 *
 * BISECTED, not guessed. The same probe, run on `peds_anxious_parent.glb` extracted at each revision:
 *
 *   81f235e^   SOUND   handY=0.9200 footY=0.0500   34,048,612 bytes
 *   81f235e    BROKEN  handY=0.1844 footY=0.2014   21,532,396 bytes
 *   89dc231    BROKEN  handY=0.1844 footY=0.2014   ("fix parent/nurse real garment bind pose")
 *   414ac3e    BROKEN  handY=0.1844 footY=0.2014   ("sleeve fit along upper arms")
 *   HEAD       BROKEN  handY=0.1844 footY=0.2014
 *
 * `81f235e` is "re-orchestrate parent/nurse real-garment GLBs". Neither later fix moved the numbers
 * by a digit — two slices of work against a defect nothing was measuring.
 *
 * THE TWO CONTRACTS PULL APART ON PURPOSE, and this is the whole design.
 *
 * A sound body is available for free: restore the `81f235e^` GLBs. But that revision has **no**
 * `realGarmentRegionFromPhenotype` in its rigging report — the sound body predates the garment work
 * entirely. So a revert trades a deformed clothed actor for a sound naked one, and the second
 * contract below refuses it. Meanwhile the status quo keeps the garment and fails the first.
 *
 * Passing both requires a figure that is human-shaped AND still wearing what the phenotype asked for.
 *
 * WHAT THIS DOES NOT DECIDE. `81f235e` changed no pipeline file — only the emitted GLBs and reports.
 * So the export path that produced them already existed and the trigger is not in that diff. Whether
 * the durable fix is a generator change plus re-orchestration, or something narrower, is the
 * implementer's call; record it in the commit. A post-process that corrects joints and leaves the
 * generator to re-break them is a fix that expires — if that is what ships, say so plainly and link
 * the generator work rather than closing the question.
 *
 * NOT ASSERTED: the 12 MB size drop that accompanied the regression. It is correlated with the same
 * re-export and may be a separate simplification. It is a signal, not a contract.
 */

const PUBLIC_HUMANOIDS = "apps/ui-xr/public/generated-humanoids";

const ACTORS = [
  { glb: `${PUBLIC_HUMANOIDS}/peds_anxious_parent.glb`, report: `${PUBLIC_HUMANOIDS}/peds_anxious_parent_rigging_report.json` },
  { glb: `${PUBLIC_HUMANOIDS}/peds_nurse_kevin.glb`, report: `${PUBLIC_HUMANOIDS}/peds_nurse_kevin_rigging_report.json` },
] as const;

function garmentRegion(reportPath: string): unknown {
  if (!existsSync(reportPath)) return undefined;
  const report = JSON.parse(readFileSync(reportPath, "utf8")) as Record<string, unknown>;
  const nested = report["roleClothingMaterialRegions"] as Record<string, unknown> | undefined;
  return report["realGarmentRegionFromPhenotype"] ?? nested?.["realGarmentRegionFromPhenotype"];
}

describe("shipped humanoids are human-shaped and still clothed (#58)", () => {
  it.fails("parent and nurse pass bind-pose proportions in the assets ui-xr actually loads", async () => {
    for (const actor of ACTORS) {
      if (!existsSync(actor.glb)) continue;
      const { joints } = await extractJointsFromGlb(actor.glb);
      const result = assessHumanoidProportions({ joints });
      // Measured today: handY 0.1844 vs footY 0.2014 — hands hang below the feet.
      expect(result.sound, `${actor.glb}: ${result.violations.join("; ")}`).toBe(true);
    }
  }, 60_000);

  it("still carries the phenotype-driven garment, so a revert to the sound-but-naked asset is not a fix", () => {
    // Live guard, not planted: this passes today and must keep passing. `81f235e^` — the only
    // revision with a sound body — has no realGarmentRegionFromPhenotype at all.
    for (const actor of ACTORS) {
      if (!existsSync(actor.report)) continue;
      expect(garmentRegion(actor.report), `${actor.report} lost its garment region`).toBeDefined();
    }
  });
});
