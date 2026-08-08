import { describe, expect, it } from "vitest";

/**
 * PLANTED CONTRACTS (#180a). The telehealth patient and his daughter wear byte-identical materials.
 *
 * `adult_male_street_casual.glb` (patient) and `ed_chest_pain_spouse_adult.glb` (family) both carry
 * `openclinxr_real_garment_casual_top_phenotype_L0` at `0.42, 0.36, 0.40` and
 * `..._open_cardigan_phenotype_L1` at `0.62, 0.28, 0.38`. Not similar — **identical**.
 *
 * ## FIXED (#180a)
 * - colour is f(role, kind, fabricPalette) via garment_shell_color + _FABRIC_PALETTE_KIND_COLORS
 * - inspectGarmentPaletteRoleSource reads exported glTF baseColorFactor
 * - rebake: adult_male_street_casual → olive; peds_nurse pocket → teal_scrubs_peds_shift
 * - all three contracts flipped from it.fails → it
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THE CAUSE IS TRACED AND VERIFIED. Do not re-derive it; DO confirm it.
 *
 * `tools/openclinxr/asset-pipeline/anny/automate_blender.py` hardcodes the visible colour **by garment
 * KIND**, with no role input at all:
 *
 *     :2890  gown_color = (0.15, 0.55, 0.82, 1.0)   # kind == "gown"
 *     :2904  gown_color = (0.62, 0.28, 0.38, 1.0)   # kind == "open_front"
 *     :2916  gown_color = (0.05, 0.48, 0.52, 1.0)   # kind == "scrub"
 *     :2945  gown_color = (0.42, 0.36, 0.40, 1.0)   # kind == "closed_casual"
 *
 * A patient and a family member who both wear `casual_top + open_cardigan` therefore get identical
 * materials **by construction**. This is not drift and not an assignment bug — #96 made the wardrobe
 * role-distinct and that still holds. It is a kind→colour map with no role override.
 *
 * **And the intent already exists and is thrown away.** `phenotype.fabricPalette` is written into
 * provenance at `automate_blender.py:3924` and never reaches a BSDF anywhere. The rebake presets
 * already author three distinct palettes as strings —
 * `"hospital_gown_blue_pattern"`, `"teal_scrubs_and_white_badge"`, `"muted_rose_and_neutral"`
 * (`rebake_role_wardrobe_blender_only.py:160,224,287`) — and the pipeline discards all three.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * MY PROPOSAL WAS REJECTED BY A PEER ROUND AND IT WAS RIGHT. Disclosed so you do not rebuild it.
 *
 * I proposed a reserved patient palette asserted by a perceptual colour-distance floor. **Do not build
 * that.** The falsifier is decisive: gown↔scrub is **already ΔE₀₀ ≈ 20**, about twenty times the lab
 * JND, and I grade that pair as illegible at encounter distance. Any ΔE floor low enough to be
 * meaningful greens the exact pair the issue is about. That is the sixth green-on-illegible gate this
 * repo has recorded, caught before it was written.
 *
 * There is also no transferable threshold to borrow. CIEDE2000 and CAM16-UCS are lab side-by-side
 * patch metrics; APCA and WCAG are text-on-background lightness metrics. **No published number answers
 * "distinguishable at 3.4 m under PBR and a headset tone map."** Anyone offering one is inventing a
 * product number, and §7a says an invented number becomes the design target.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * SO THIS SLICE IS THE IDENTITY HALF ONLY, AND IT IS DELIBERATELY SMALL
 *
 * **In scope:** break the kind→colour monopoly so colour is a function of role and palette as well as
 * kind, and rebake so that no two co-present actors share a primary garment material.
 *
 * **OUT of scope, and this is not a deferral to be quietly closed:** whether gown↔scrub is legible at
 * encounter distance. That is #180b and it is **blocked on evidence, not on effort** — it needs a
 * contact sheet at encounter distance under harness lights before anyone decides whether the fix is
 * palette contrast, accessory markers, or silhouette. Do not touch it here, and do not "improve" the
 * gown or scrub colours on the way past: contract (3) forbids it.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * DECISIONS THAT ARE YOURS. Name each in the commit message with what you rejected.
 *  - **What colour is a function of.** `f(role, kind, fabricPalette)` is the peer's shape and my
 *    preference. A role override table on top of the kind map is simpler and also defensible. Say
 *    which and why.
 *  - **Whether `fabricPalette` becomes a real input or stays descriptive.** The three preset strings
 *    read like intent; turning free text into colour needs a mapping that someone maintains. A named
 *    enum is an option.
 *  - **Which body changes.** The patient, the family member, or both. Only one has to move for them to
 *    differ, and which one moves is a product judgement.
 *  - **Whether the badge markers get promoted.** `add_role_clothing_markers` already authors badge
 *    cubes and stamps them `claimScope: procedural…not_production` — the pipeline knows the convention
 *    and then discounts it. Promoting them is a legitimate answer to legibility and it belongs in
 *    #180b, not here. If you touch it, say so loudly.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THE REGENERATION PATH IS `rebake_role_wardrobe_blender_only.py`. NOT `orchestrate_character.py`.
 *
 * The full orchestration imports `anny`, which is absent in a worktree, and it does not fail — it
 * silently emits ~0.8 MB stub GLBs that pass every file check. #73 paid ~40 turns for that. All six
 * `.anny_base.obj` bases are TRACKED under `apps/ui-xr/public/generated-humanoids/` and Blender is at
 * `/opt/homebrew/bin/blender`.
 *
 * Rebaked GLBs land TRACKED, with provenance per MADR 0016. A slice whose product bytes live only in a
 * worktree certifies a tree nobody will have again (#64).
 *
 * CALIBRATION — `.openclinxr/evidence/issue-180a/pre-fix.json` BEFORE any product edit: every shipped
 * humanoid, its role, its garment kinds, and each primary garment material's name and
 * `baseColorFactor`, read from the exported glTF. Expected shape: **`closed_casual` produces
 * `0.42,0.36,0.40` on both the street patient and both family bodies.** Record the mechanism per row.
 *
 * SIGNATURE IS YOURS. These read `inspectGarmentPaletteRoleSource()`. What must not change: colours are
 * read from the **exported glTF**, never from the Python source or from provenance metadata — #94
 * records provenance greening over bare geometry, and the whole point here is that metadata already
 * claims three palettes the meshes do not have.
 *
 * IN-SCOPE REPORT — answer EVERY line. Do not replace with a sentence:
 *     colour_source_is_role_aware:   yes | no
 *     patient_family_materials_differ: yes | no | not_applicable:<why>
 *     bodies_rebaked:                <list>
 *     gown_scrub_colours_unchanged:  yes | no
 *     badge_markers_touched:         yes | no
 *
 * **If satisfying a contract here will make the product visibly worse, say so — and then satisfy it
 * anyway.** A patient and a family member in obviously clashing colours is a legitimate outcome of
 * this slice; legibility beats harmony and #180b will judge the aesthetics.
 *
 * IF ANY PROOF CANNOT PASS AS WRITTEN, OR PASSES TRIVIALLY AGAINST THE OBSERVED RANGE, OR ASSERTS THE
 * OPPOSITE DIRECTION FROM THE DEFECT, SAY SO IN YOUR REPORT rather than silently running a corrected
 * version.
 *
 * No new `eslint-disable`, `@ts-ignore`, `@ts-expect-error` or `OPENCLAW_SKIP_HOOKS` in source paths —
 * merge-kill fails the land regardless of the comment justifying it.
 *
 * SCOPE: no two co-present actors share a primary garment material, and garment colour is chosen with
 * role as an input. Says NOTHING about whether any pair is legible at encounter distance (#180b),
 * about clinical costume realism, about Quest readiness, or about learner performance.
 */

const load = async () =>
  import("./garment-palette-role-source.js") as Promise<Record<string, unknown>>;

type GarmentMaterial = {
  materialName: string;
  garmentKind: string;
  layerIndex: number;
  baseColorFactor: [number, number, number];
};

type BodyRow = {
  assetPath: string;
  /** The role this body is cast as, from the real casting API. */
  role: string;
  /** Primary (outermost) garment material, which is what a learner sees. */
  primary: GarmentMaterial | null;
  allGarmentMaterials: GarmentMaterial[];
  /** Provenance's claimed palette — recorded to show whether it reached the mesh. */
  declaredFabricPalette: string | null;
};

type CoPresencePair = {
  scenarioId: string;
  actorA: string;
  actorB: string;
  roleA: string;
  roleB: string;
  /** True when both actors' primary garment materials have identical baseColorFactor. */
  primaryColorsIdentical: boolean;
  colorA: [number, number, number] | null;
  colorB: [number, number, number] | null;
};

type Report = {
  bodies: BodyRow[];
  /** Every pair of actors that appear in the same scenario, enumerated from what ships. */
  coPresencePairs: CoPresencePair[];
  /** True when garment colour selection reads role, not only garment kind. */
  colourSourceIsRoleAware: boolean;
  claimScope: string;
  notEvidenceFor: string[];
};

type Inspect = () => Promise<Report>;

/** The shipped gown and scrub colours. This slice must NOT move them — see contract (3). */
const GOWN = [0.15, 0.55, 0.82] as const;
const SCRUB = [0.05, 0.48, 0.52] as const;
const EPS = 0.005;

const near = (a: readonly number[], b: readonly number[]): boolean =>
  a.length === b.length && a.every((v, i) => Math.abs(v - b[i]!) < EPS);

describe("garment colour is chosen with role, not garment kind alone (#180a)", () => {
  it("no two co-present actors share a primary garment material", async () => {
    // The telehealth patient and his daughter are byte-identical: casual_top 0.42,0.36,0.40 and
    // open_cardigan 0.62,0.28,0.38 on both. A learner cannot tell which figure is the patient, and
    // this half of that is pure identity — no threshold, no perceptual metric.
    const mod = await load();
    const inspect = mod["inspectGarmentPaletteRoleSource"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    expect(report.coPresencePairs.length, "no co-present actor pairs were enumerated")
      .toBeGreaterThan(0);

    const collisions = report.coPresencePairs
      .filter((p) => p.primaryColorsIdentical)
      .map((p) => `${p.scenarioId}: ${p.actorA}(${p.roleA}) == ${p.actorB}(${p.roleB}) at `
        + `[${(p.colorA ?? []).join(", ")}]`);
    expect(collisions, `co-present actors share a primary garment material:\n${collisions.join("\n")}`)
      .toHaveLength(0);
  }, 900_000);

  it("colour selection reads role, not garment kind alone", async () => {
    // automate_blender.py:2890-2963 picks the visible colour from `kind` with no role input, and
    // phenotype.fabricPalette is written to provenance at :3924 and never reaches a BSDF. Three
    // distinct palettes are authored as strings and all three are discarded.
    //
    // Without this, the identity fix above is one hardcoded hex away from regressing the moment
    // another role is assigned an existing garment kind.
    const mod = await load();
    const inspect = mod["inspectGarmentPaletteRoleSource"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    expect(
      report.colourSourceIsRoleAware,
      "garment colour is still a pure function of garment kind — a second role assigned an existing "
      + "kind would collide again",
    ).toBe(true);

    // Every body must record what palette its provenance claims, so the metadata-vs-mesh gap stays
    // visible rather than being quietly closed by deleting the field.
    for (const body of report.bodies) {
      expect(
        body.declaredFabricPalette,
        `${body.assetPath} records no declared fabricPalette`,
      ).toBeTruthy();
    }
  }, 900_000);

  it("the gown and scrub colours are untouched (COUNTERWEIGHT)", async () => {
    // The cheap way to make everything "differ" is to start nudging hexes across the board. The
    // gown/scrub pair is #180b's subject and is BLOCKED ON EVIDENCE — a contact sheet at encounter
    // distance has to exist before anyone decides whether the fix is palette, markers or silhouette.
    // Moving those two colours here would pre-empt that decision with an unmeasured guess.
    const mod = await load();
    const inspect = mod["inspectGarmentPaletteRoleSource"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();

    const gowns = report.bodies.flatMap((b) => b.allGarmentMaterials)
      .filter((m) => /gown/iu.test(m.garmentKind) || /gown/iu.test(m.materialName));
    expect(gowns.length, "no gown material found in any shipped body").toBeGreaterThan(0);
    for (const g of gowns) {
      expect(
        near(g.baseColorFactor, GOWN),
        `${g.materialName} moved to [${g.baseColorFactor.join(", ")}] — the gown colour is #180b's `
        + `subject and must not be changed here`,
      ).toBe(true);
    }

    const scrubs = report.bodies.flatMap((b) => b.allGarmentMaterials)
      .filter((m) => /scrub_top/iu.test(m.materialName));
    expect(scrubs.length, "no scrub top material found in any shipped body").toBeGreaterThan(0);
    for (const s of scrubs) {
      expect(
        near(s.baseColorFactor, SCRUB),
        `${s.materialName} moved to [${s.baseColorFactor.join(", ")}] — same reason`,
      ).toBe(true);
    }

    expect(report.notEvidenceFor.join(" ").toLowerCase()).toContain("clinical");
  }, 900_000);
});
