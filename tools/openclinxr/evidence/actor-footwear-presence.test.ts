import { describe, expect, it } from "vitest";

/**
 * PLANTED CONTRACTS (#188). Three REDs. All three flip.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THE DEFECT, MEASURED — glTF-Transform NodeIO over the exported files. Trust these; do not re-derive.
 *
 * Every mesh in all seven shipped humanoids, 2026-08-08:
 *
 *   adult_male_street_casual    declared_upper_layers__casual_top+open_cardigan | anny_base
 *                               | peds_upper_v1__under_casual_top | peds_upper_v1
 *   ed_chest_pain_adult_cast    declared_upper_layers__hospital_gown | anny_base | peds_upper_v1
 *   ed_chest_pain_nurse_adult   declared_upper_layers__scrub_top+scrub_pocket | anny_base
 *                               | peds_upper_v1 | peds_upper_v1__under_scrub_top
 *   ed_chest_pain_spouse_adult  (same shape as street_casual)
 *   peds_anxious_parent         (same shape as street_casual)
 *   peds_nurse_kevin            (same shape as nurse_adult)
 *   peds_patient_child          declared_upper_layers__short_sleeve_exam_tshirt | anny_base
 *                               | peds_upper_v1
 *
 * NO mesh matching /shoe|boot|foot|sock|sandal/ exists in ANY of the seven. Footwear reaches ZERO
 * figures. The issue previously said "exactly one" — that was wrong and is corrected at the source.
 *
 * A learner in a ward station sees barefoot clinicians.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * WHAT IS ALREADY TRUE — do not re-derive, do not "discover" these
 *
 *  - The armature HAS foot bones: `foot.L` / `foot.R`, automate_blender.py:701, built by `make_leg`.
 *  - The body HAS feet to derive from. Peer measured ~2214 verts below yn<0.08 on the adult cast.
 *    VERIFY THIS YOURSELF on each asset before deriving — I have not reproduced the number.
 *  - Lower-body clothing is PAINT, deliberately. automate_blender.py:2647-2648 says so in as many
 *    words: "#73: skip body-mesh top/trim paint when real garment mesh will cover the torso.
 *    Keep lower/pants fill (no pants shell)."
 *  - #199 (the body has no forearm) is an ARM finding. It does not apply to legs.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * SCOPE — footwear ONLY. This is deliberate and a peer round argued me down from more.
 *
 * I proposed a full lower-body geometry channel (trousers + skirt + shoes across seven assets).
 * The peer's ranked verdict was that this inflates one slice into hem/waist coordination, weight
 * painting, #73 paint-removal and seven regenerations at once. Footwear is the visible defect and
 * the separable one.
 *
 * DO NOT add trousers, skirts or any lower-body shell in this slice. If you believe footwear cannot
 * be done without one, say so in your report and stop — that is a successful finding.
 *
 * LEG PAINT STAYS. Shoes cover feet, not calves. Do not touch the lower paint path.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * IF A RED HERE IS AN INSTRUMENT ARTIFACT rather than a product defect, say so and stop. That
 * closes this issue successfully. Do not weaken any assertion to reach green.
 *
 * §6t WARNING — five shoulder-coverage gates were defeated in this repo and one round ended with
 * the product tuned to fit a lying gate. The defeating class is DETACHED geometry: presence and
 * proximity metrics all pass on a free-floating fragment. Contract (2) below bounds POSITION and
 * SIZE rather than mere presence, and the pixel grade is REQUIRED because "reads as a shoe" is not
 * machine-checkable. Do not add a sixth scalar gate and call it proven.
 *
 * THE CAUSE OF THE ABSENCE IS NOT A MYSTERY — nothing generates footwear. This is additive work,
 * not a diagnosis. Do not spend turns looking for a bug.
 */

const ASSET_DIR = "apps/ui-xr/public/generated-humanoids";

type Inspect = () => Promise<{
  assets: {
    assetPath: string;
    footwearMeshNames: string[];
    footwearTriangles: number;
    footwearMinY: number;
    footwearMaxY: number;
    bodyMinY: number;
    bodyMaxY: number;
    footBoneWeightedFraction: number;
    lowerPaintTriangles: number;
  }[];
}>;

const load = () =>
  import("./actor-footwear-presence.js") as Promise<Record<string, unknown>>;

describe("a shipped figure is not barefoot on a ward floor (#188)", () => {
  it("every shipped humanoid carries footwear geometry", async () => {
    const mod = await load();
    const inspect = mod["inspectActorFootwearPresence"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    expect(report.assets.length, "no shipped humanoids were inspected").toBeGreaterThan(0);

    const bare = report.assets
      .filter((a) => a.footwearMeshNames.length === 0)
      .map((a) => a.assetPath.replace(`${ASSET_DIR}/`, ""));
    expect(bare, `figures with no footwear mesh at all:\n${bare.join("\n")}`).toEqual([]);
  }, 900_000);

  it("the footwear is ON THE FEET and is shoe-sized, not a floating fragment", async () => {
    // §6t: presence is defeated by detached geometry. Bound position and size, not existence.
    // A shoe sits in the bottom ~10% of the figure and is a real volume, not a shard.
    const mod = await load();
    const inspect = mod["inspectActorFootwearPresence"] as Inspect;
    const report = await inspect();

    const wrong: string[] = [];
    for (const a of report.assets) {
      const name = a.assetPath.replace(`${ASSET_DIR}/`, "");
      const height = a.bodyMaxY - a.bodyMinY;
      if (height <= 0) {
        wrong.push(`${name}: body height ${height} is not positive`);
        continue;
      }
      const topFrac = (a.footwearMaxY - a.bodyMinY) / height;
      if (topFrac > 0.14) {
        wrong.push(`${name}: footwear reaches ${(topFrac * 100).toFixed(1)}% of body height — not a shoe`);
      }
      if (a.footwearMinY < a.bodyMinY - 0.02) {
        wrong.push(`${name}: footwear sinks ${(a.bodyMinY - a.footwearMinY).toFixed(3)}m below the body`);
      }
      if (a.footwearTriangles < 60) {
        wrong.push(`${name}: ${a.footwearTriangles} triangles is a shard, not a shoe`);
      }
      if (a.footBoneWeightedFraction < 0.9) {
        wrong.push(
          `${name}: only ${(a.footBoneWeightedFraction * 100).toFixed(1)}% of footwear verts are `
          + `weighted to foot.L/foot.R — it will not move with the leg`,
        );
      }
    }
    expect(wrong, `footwear that is not on a foot:\n${wrong.join("\n")}`).toEqual([]);
  }, 900_000);

  it("leg paint survives and no lower shell was added (COUNTERWEIGHT)", async () => {
    // Shoes cover feet, not calves. automate_blender.py:2647-2648 keeps lower/pants fill on purpose.
    // Removing it, or adding a trouser shell, is out of scope for #188 and would reopen #73 below
    // the waist — a contract that deletes a mechanism must say what replaces it (§6p). Nothing here
    // replaces leg paint.
    const mod = await load();
    const inspect = mod["inspectActorFootwearPresence"] as Inspect;
    const report = await inspect();

    const broken: string[] = [];
    for (const a of report.assets) {
      const name = a.assetPath.replace(`${ASSET_DIR}/`, "");
      if (a.lowerPaintTriangles <= 0) {
        broken.push(`${name}: lower paint was removed — shoes do not replace trousers`);
      }
      const shells = a.footwearMeshNames.filter((n) => /trouser|pant|skirt|legging|lower_garment/i.test(n));
      if (shells.length > 0) {
        broken.push(`${name}: a lower-body shell was added: ${shells.join(",")}`);
      }
    }
    expect(broken, `the counterweight broke:\n${broken.join("\n")}`).toEqual([]);
  }, 900_000);
});
