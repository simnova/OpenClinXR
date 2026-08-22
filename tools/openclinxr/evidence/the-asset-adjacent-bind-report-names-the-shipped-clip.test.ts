import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NodeIO } from "@gltf-transform/core";

/**
 * OBSERVABLE: the provenance file shipped beside an asset describes the asset it sits next to.
 *
 * MEASURED 2026-08-22, do not re-derive. The peds parent's shipped GLB carries, read with NodeIO:
 *   ClinicalIdleConversation                411 channels / 137 rotation / 137 nodes
 *   openclinxr_retarget_seated_talking_cc0  411 channels / 137 rotation / 137 nodes
 *   ClinicalExpressionMicroTransition         1 channel
 *
 * The report shipping beside it says `clipName: openclinxr_retarget_cmu_07_01_walk`,
 * `sourceClip: .../cmu_07_01_walk.bvh`, `generatedAt: 2026-08-18T11:45:15Z`. That clip is NOT in the
 * file. Presence and placement are fine; PROVENANCE is what fails, and it fails silently.
 *
 * MECHANISM, checked before writing it down — NOT "regeneration was skipped":
 *   motion-bind-cli.ts:181-182 passes `--report` straight to `motion_bind_stage`, so that stage always
 *   writes its report beside its GLB. The real shape is TWO STAGES WRITING ONE OUTPUT GLB:
 *     motion_bind_stage       -> ...motion-bind-report.json  (08-18, walk)
 *     seated_clip_bind_stage  -> tools/openclinxr/evidence/seated-clip-bind-report.json (08-22, seated)
 *   Both declare the same `outputGlb`. Only the older one owns the asset-adjacent filename, so the
 *   newer bake's provenance lands in an evidence path nobody reads as the asset's record.
 *
 * KNOWN-GOOD COLUMN: the seated stage's own report. It names the clip the GLB actually carries, so
 * the correct value already exists in the tree — this is a routing defect, not a measurement one.
 *
 * claimScope: whether the bind report shipped beside a humanoid GLB names an animation that GLB contains.
 * notEvidenceFor: whether the clip plays, whether the pose is right, or any runtime behaviour.
 */

/**
 * ## FIXED (#572)
 *
 * Writer fixed, not the file. `seated_clip_bind_stage.py` now derives its default report path from
 * `--output` (the `.glb` suffix replaced by `-report.json`, the exact filename
 * `motion-bind-cli.ts:39-42` ships beside this same GLB and the name `factory-case-cli.ts`
 * `motionBindOutputs()` emits for the actor), so a rebake without `--report` can no longer fork its
 * provenance into `tools/openclinxr/evidence/`. The stage's measured record for the shipped 08-22 bake
 * was relocated to the asset-adjacent filename; `tools/openclinxr/evidence/seated-clip-bind-report.json`
 * is retained as the enriched record consumed by `a-seated-clinical-clip-drives-the-mpfb-rig.test.ts:43`.
 * Both stages now agree on the clip in the GLB.
 */

const ROOT = join(import.meta.dirname, "../../..");
const GLB = join(ROOT, "apps/ui-xr/public/xr-assets/humanoids/candidates/mpfb-peds-parent-aisha.motion-bind.glb");
const ADJACENT = join(ROOT, "apps/ui-xr/public/xr-assets/humanoids/candidates/mpfb-peds-parent-aisha.motion-bind-report.json");
const SEATED = join(ROOT, "tools/openclinxr/evidence/seated-clip-bind-report.json");

async function clipNamesInGlb(): Promise<string[]> {
  const doc = await new NodeIO().read(GLB);
  return doc.getRoot().listAnimations().map((a) => a.getName());
}
const readJson = (p: string): Record<string, unknown> => JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>;

describe("the asset-adjacent bind report names the shipped clip", () => {
  it("(0) VACUITY GUARD: the GLB is readable and carries more than one animation", async () => {
    // Without this, (1) could go green by the GLB losing its animations rather than the report being
    // routed correctly.
    const names = await clipNamesInGlb();
    expect(names.length, "animations in the shipped parent GLB").toBeGreaterThan(1);
    expect(names, "the seated clip is the one under discussion").toContain("openclinxr_retarget_seated_talking_cc0");
  });

  it("(1) the report beside the asset names a clip the asset contains", async () => {
    const names = await clipNamesInGlb();
    const declared = String(readJson(ADJACENT)["clipName"] ?? "");
    expect(
      names,
      `the adjacent report declares "${declared}", which is not in the GLB — every consumer reading `
        + "provenance beside this asset is told the parent walks when she sits",
    ).toContain(declared);
  });

  it("(2) COUNTERWEIGHT: the two stages claiming this GLB agree on its clip", async () => {
    // Refuses a hand-edit of the JSON. Editing the adjacent file alone satisfies (1) and leaves the
    // seated stage still writing its record to an evidence path, so the next rebake re-forks them.
    const adjacent = String(readJson(ADJACENT)["clipName"] ?? "");
    const seated = String(readJson(SEATED)["clipName"] ?? "");
    expect(seated, "the known-good column: the seated stage already records the right clip").toBe(
      "openclinxr_retarget_seated_talking_cc0",
    );
    expect(
      adjacent,
      "both stages declare the same outputGlb; they must not disagree about what is in it",
    ).toBe(seated);
  });
});
