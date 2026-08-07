import { describe, expect, it } from "vitest";

/**
 * PLANTED CONTRACTS (#168) — `ecg-cart-12-lead.glb` is **not an assembled object**. Found by grading
 * pixels in the isolated harness (#163) on assets nobody had ever looked at.
 *
 * TWO REDs FLIP. The third is a COUNTERWEIGHT — the IV pole and the sixteen parametric equipment
 * kinds must be unaffected.
 *
 * ## FIXED (#168)
 * - Generator placement in `medical-equipment-artifacts.ts` reassembled the ECG cart so casters,
 *   cabinet, screen, shelf, and lead bundle share world-matrix contact after glTF export.
 * - Cause was **placement numbers**, not Blender Z-up / glTF Y-up confusion (IV pole uses the same
 *   export path and was already assembled). Rejected: parametric rewrite of the cart; commissioning
 *   the six absent PROVENANCE GLBs.
 * - `equipment-assembly-integrity.ts` measures every `REAL_EQUIPMENT_GLTF_BY_ID` entry with baked
 *   world matrices; ground plane = asset lowest part; tolerance 0.08 m; contact/adjacency only.
 * - PROVENANCE.md corrected to the two present GLBs (false hashes for six never-shipped files removed).
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * WHAT THE RENDER SHOWS — this is the primary evidence and it is unambiguous
 *
 * `.openclinxr/evidence/glb-grade-capture/2026-08-07T22-24-40Z/assets/ecg-cart-12-lead/three_quarter_lit.png`
 *
 *  - the **cart body** floats roughly a metre above the ground
 *  - the **screen** floats free above the body, attached to nothing
 *  - a **shelf** projects from nothing
 *  - **four casters** sit correctly ON the ground plane, a metre below the cart they belong to
 *
 * The grounded casters are the tell. This is not a whole object at the wrong height; it is a set of
 * primitives that were never assembled.
 *
 * **`iv-pole-with-pump.glb`, rendered in the same pass, is FINE** — pole, grounded cross base,
 * hanger, pump box. So this is not "our equipment is crude". One of the two real equipment GLBs is
 * broken and the other is not.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * MY NUMERIC ATTEMPT FAILED. DO NOT REPEAT IT.
 *
 * I tried to confirm the gaps from the glTF and **applied node translation without node scale**, so
 * every part measured as exactly 1.000 m tall and the gap computation was meaningless. I did not
 * write a second probe (§6s) and neither should you without reading this first.
 *
 * The correct shape, from a peer round: **bake the world matrix (T × R × S) per part**, then compare
 * each part's AABB bottom against a common ground plane, plus XZ footprint overlap between the body
 * and the caster group.
 *
 * **Contact and adjacency are enough. Do NOT invent a topology predicate.** Connected-component count
 * says "8 parts" for a legitimately multi-part cart, and §6t records five separate gates in this repo
 * that died on body-relative geometric proxies. This is a *placement* question, not a *topology* one.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * WHY NOTHING CAUGHT IT
 *
 * The GLB loads, has geometry, and passes every file-level check. `glb-grade-capture`'s self-check
 * reported `agrees: true` — it compares two whole-document AABBs, and a pile of disconnected parts has
 * a perfectly consistent bounding box. That is §6e's stated blind spot, the same one that let #56's
 * collapsed torsos and #67's head-down figures through.
 *
 * **This contract is the gate that should have existed.** It must catch the class, not just this
 * asset — it runs over every entry in `REAL_EQUIPMENT_GLTF_BY_ID`.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THE GENERATOR IS OURS — this is a fix, not a sculpt
 *
 * `tools/openclinxr/evidence/medical-equipment-artifacts.ts` (590 lines) emits Blender Python and is
 * the recorded source in `PROVENANCE.md`. So the cart is repo-authored by code we own.
 *
 * **A LEAD, NOT A CONCLUSION.** `:445` places wheels via
 * `cylinder(f"ecg_cart_wheel_{index}_{y}", (x, y, 0.15), …)` — an embedded Blender Python f-string,
 * so that `0.15` is Blender's **Z**, and Blender is Z-up while glTF is Y-up. This project has paid for
 * that confusion twice (#67, #156). **I have NOT confirmed this is the cause. Trace it yourself and
 * do not take my hypothesis as fact** — my last three guesses in geometry areas were each withdrawn.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * A SECOND, SMALLER DEFECT IN THE SAME DIRECTORY
 *
 * `PROVENANCE.md` declares **eight** GLBs with SHA-256 hashes. **Two exist.** The missing six were
 * never in git history and are not gitignored, and none was ever in `REAL_EQUIPMENT_GLTF_BY_ID` — peds
 * asthma already renders parametric substitutes for its stretcher and parent chair.
 *
 * **The false hashes are the defect, not the missing assets.** A provenance record that certifies
 * absent content reads as an audit trail and is not one, which matters in a repo that runs MADR 0016
 * manifests and licence allowlists.
 *
 * **Correct the ledger to describe what is actually here. Do NOT commission the six** — that is a
 * product decision and it is not this slice.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * DECISIONS THAT ARE YOURS. Name each in the commit message with what you rejected.
 *  - **Fix the generator, or replace the cart with a parametric builder.** Sixteen other equipment
 *    kinds already use parametric builders and they work. The generator is ours and diffable, so
 *    fixing it is viable too. **I lean fix-the-generator** because it keeps one path rather than two,
 *    and I am not certain.
 *  - **Where the ground plane comes from** in your measurement — the lowest part, y=0, or a declared
 *    base. Say which and why a different choice would change the verdict.
 *  - **What tolerance counts as "sharing a ground plane".** A caster and a cart foot need not be
 *    identical; a metre of air is not a tolerance question. Pick a number and say what it admits.
 *  - **Whether the assembly check runs over all `REAL_EQUIPMENT_GLTF_BY_ID` entries or all GLBs in the
 *    directory.** Today those are the same two files. They may not stay the same.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * WHY THE THREE PULL APART
 *
 * (1) demands every real equipment GLB be an assembled object, and is satisfiable by deleting the
 * broken cart from `REAL_EQUIPMENT_GLTF_BY_ID` so nothing is checked. (2) forbids that by naming the
 * cart specifically and requiring its parts to share a ground plane and footprint. (3) is green today
 * and forbids buying either by breaking the IV pole or the sixteen parametric mounts.
 *
 * SIGNATURE IS THE IMPLEMENTER'S CHOICE. These read `inspectEquipmentAssemblyIntegrity()`. What must
 * not change: measurements come from the EXPORTED glTF with **world matrices baked**, and every entry
 * in `REAL_EQUIPMENT_GLTF_BY_ID` is enumerated rather than listed.
 *
 * CALIBRATION — `.openclinxr/evidence/issue-168/pre-fix.json` BEFORE any product edit, one row per
 * part of each real equipment GLB: part name, world AABB min/max, and the gap to the nearest part
 * below it. **The pre-fix row for the cart must reproduce the disconnection the render shows.** If it
 * does not, STOP — my reading of the image is wrong and I want to know that before anything else.
 *
 * REQUIRED, the observable half: re-render the cart through
 * `tools/openclinxr/evidence/model-vetting-glb-grade-capture.ts --glb <path>` after the fix and leave
 * the images for me to grade. Do not write another capture script.
 *
 * IN-SCOPE VISUAL — answer EVERY line. Do not replace with a sentence:
 *     cart_assembled:     yes | parts_floating | not_visible
 *     casters_under_body: yes | no | not_visible
 *     reads_as_ecg_cart:  yes | no
 *     iv_pole_unchanged:  yes | no
 *
 * IF SATISFYING A CONTRACT HERE MAKES THE PRODUCT VISIBLY WORSE, SAY SO IN YOUR REPORT — and then
 * satisfy it anyway.
 *
 * IF ANY PROOF CANNOT PASS AS WRITTEN, OR PASSES TRIVIALLY AGAINST THE OBSERVED RANGE, OR ASSERTS THE
 * OPPOSITE DIRECTION FROM THE DEFECT, SAY SO IN YOUR REPORT.
 *
 * SCOPE: whether a real equipment GLB's parts form one object, and whether PROVENANCE.md describes
 * what exists. Says NOTHING about equipment realism, the parametric builders' appearance, generation
 * (#164), or the rooms.
 */

const load = async () => import("./equipment-assembly-integrity.js") as Promise<Record<string, unknown>>;

type PartPlacement = {
  name: string;
  /** World-space AABB after baking T x R x S down the node chain. */
  worldMin: { x: number; y: number; z: number };
  worldMax: { x: number; y: number; z: number };
};

type EquipmentAssembly = {
  equipmentId: string;
  assetPath: string;
  parts: PartPlacement[];
  /** Lowest world Y across all parts — the asset's own ground contact. */
  groundY: number;
  /** Largest vertical air gap between a part's bottom and the nearest part below it. */
  largestVerticalGapMeters: number;
  /** Parts whose XZ footprint does not overlap any other part's. Orphans. */
  disconnectedPartNames: string[];
  /** True when every part is within tolerance of touching another, forming one object. */
  isAssembled: boolean;
};

type Inspect = () => Promise<{
  real: EquipmentAssembly[];
  /** Parametric mount kinds still resolving, so the fix did not delete the fallback path. */
  parametricKindCount: number;
  /** GLBs PROVENANCE.md declares, and how many exist on disk. */
  provenanceDeclaredCount: number;
  provenancePresentCount: number;
}>;

/** A metre of air is not a tolerance question. This admits ordinary part seams and nothing else. */
const MAX_VERTICAL_GAP_METERS = 0.08;

describe("real equipment GLBs are assembled objects (#168)", () => {
  it("every real equipment GLB is an assembled object", async () => {
    // The render shows the ECG cart's body a metre above its own grounded casters. The GLB loads,
    // has geometry, and glb-grade-capture's whole-document AABB self-check said agrees: true.
    const mod = await load();
    const inspect = mod["inspectEquipmentAssemblyIntegrity"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    expect(report.real.length, "no real equipment GLB was inspected").toBeGreaterThan(1);

    const broken: string[] = [];
    for (const a of report.real) {
      if (!a.isAssembled) {
        broken.push(
          `${a.equipmentId}: largest vertical gap ${a.largestVerticalGapMeters.toFixed(3)}m; `
          + `orphan parts: ${a.disconnectedPartNames.join(", ") || "none"}`,
        );
      }
    }
    expect(broken, `equipment that is not one object:\n${broken.join("\n")}`).toHaveLength(0);
  }, 900_000);

  it("the ECG cart's parts share a ground plane and footprint", async () => {
    // Kills the cheap satisfaction of the first contract: dropping the cart from
    // REAL_EQUIPMENT_GLTF_BY_ID so nothing is checked. The cart is named here specifically.
    const mod = await load();
    const inspect = mod["inspectEquipmentAssemblyIntegrity"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    const cart = report.real.find((a) => /ecg/iu.test(a.equipmentId) || /ecg/iu.test(a.assetPath));
    expect(cart, "the ECG cart is no longer a real equipment GLB — it was removed rather than fixed")
      .toBeDefined();

    expect(cart!.parts.length, "the cart has no parts to check").toBeGreaterThan(2);
    expect(
      cart!.largestVerticalGapMeters,
      `the cart has ${cart!.largestVerticalGapMeters.toFixed(3)}m of air between parts`,
    ).toBeLessThanOrEqual(MAX_VERTICAL_GAP_METERS);
    expect(
      cart!.disconnectedPartNames,
      `cart parts with no footprint overlap: ${cart!.disconnectedPartNames.join(", ")}`,
    ).toHaveLength(0);
  }, 900_000);

  it("the IV pole and the parametric mounts are unaffected (COUNTERWEIGHT)", async () => {
    // The IV pole renders correctly today and must keep doing so; the sixteen parametric kinds are
    // the fallback that six PROVENANCE-declared-but-absent assets already rely on.
    const mod = await load();
    const inspect = mod["inspectEquipmentAssemblyIntegrity"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    const pole = report.real.find((a) => /iv[_-]?pole|iv_stand/iu.test(`${a.equipmentId} ${a.assetPath}`));
    expect(pole, "the IV pole stopped being a real equipment GLB").toBeDefined();
    expect(pole!.isAssembled, "the IV pole was broken by this change").toBe(true);

    expect(report.parametricKindCount, "the parametric equipment fallback shrank").toBeGreaterThan(10);

    // PROVENANCE.md must describe what exists (two real GLBs only after #168 ledger fix).
    expect(
      report.provenanceDeclaredCount,
      `PROVENANCE.md declares ${report.provenanceDeclaredCount} GLBs but ${report.provenancePresentCount} exist`,
    ).toBe(report.provenancePresentCount);
  }, 900_000);
});
