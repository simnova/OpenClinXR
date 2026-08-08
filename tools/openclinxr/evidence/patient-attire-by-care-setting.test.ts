import { describe, expect, it } from "vitest";

/**
 * ## FIXED (#160)
 * - EnvironmentId → patientWardrobeClass table (street_casual | inpatient_gown).
 * - Male street body adult_male_street_casual.glb via blender-only rebake.
 * - Both pickAdultGlb copies care-setting-conditioned; content-hash + geometry class.
 *
 * PLANTED CONTRACTS (#160). The telehealth patient is at home, on a chair, in a hospital gown.
 *
 * `pickAdultGlb` prefers `ED_ADULT_CAST_GLB` first for every role `"patient"`, and that body's upper
 * garment is `openclinxr_real_garment_hospital_gown_phenotype_L0` (base colour 0.15, 0.55, 0.82).
 * Twelve of the fourteen bank scenarios are pool-assigned — only ED chest pain and peds asthma have
 * explicit cast tables — so **every adult patient in the bank wears an ED gown**, including the one
 * sitting in their own living room. Confirmed in the shipped room capture, not only in the code.
 *
 * TWO REDs FLIP. The third is a COUNTERWEIGHT and is `it.fails` only because the module is absent.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THERE ARE **TWO** COPIES OF `pickAdultGlb`. MISS ONE AND THE LEARNER STILL SEES THE GOWN.
 *
 *   packages/openclinxr/asset-registry/src/actor-casting.ts:129-130
 *   apps/ui-xr/src/humanoid-runtime-asset-url.ts:81-85
 *
 * Both hold the same preference list and both must change. A peer round found this and I verified it
 * in the tree — the second one is easy to miss because the first is the one that reads like the SSOT.
 * Contract (1) asserts they AGREE, so fixing one alone fails.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * POOL REASSIGNMENT ALONE CANNOT FIX THIS — THE ASSET DOES NOT EXIST
 *
 * The adult pool is five bodies: gown (ED cast), scrubs ×2 (ED nurse, peds nurse), casual top + open
 * cardigan ×2 (ED spouse, peds parent). **There is no male street-clothed body.** Telehealth ships a
 * patient AND a family member, family already claims the street meshes, and reassigning would either
 * break within-scenario content distinctness or put Luis Martinez on a female-presenting body. Both
 * are worse than the gown.
 *
 * So this slice must PRODUCE one asset.
 *
 * **THE REGENERATION PATH IS `rebake_role_wardrobe_blender_only.py`. NOT `orchestrate_character.py`.**
 * The full orchestration imports `anny`, which is absent in a worktree, and it does not fail — it
 * silently emits ~0.8 MB stub GLBs that pass every file check. #73 paid ~40 turns for that lesson.
 * All six `.anny_base.obj` bases are TRACKED under `apps/ui-xr/public/generated-humanoids/`, Blender
 * is at `/opt/homebrew/bin/blender`, and the blender-only rebake is the path #94 and #96 used.
 *
 * There is no existing rebake target for a male street patient — the street shells are on the FEMALE
 * base. Producing one is the product work in this slice.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THE CONTRACT ASSERTS CONTENT, NOT LABELS — THIS REPO HAS PAID FOR THAT TWICE
 *
 * `clothingLayer` in the factory runtime bundles is a role→string map that already says
 * `"patient_gown"` for every patient. Renaming it changes nothing a learner sees. `declared_upper_layers__*`
 * meshes are one-triangle layer-count markers (#73) and are excluded from real-shell checks. Provenance
 * `wardrobeTags.garmentLayers` can green over bare geometry (#94).
 *
 * **Assert the resolved GLB's content**: a different content hash from the gown cast, and real garment
 * geometry whose class is street rather than gown. Do not assert on names, labels, or declared markers.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * WHERE CARE SETTING COMES FROM — DECIDED, WITH THE REJECTED OPTIONS
 *
 * Nothing in the tree carries a care-setting concept today. Verified: `EnvironmentSchema` has an id
 * and no attire class; `EnvironmentShellDescriptor` has geometry, colours, fixtures and zones;
 * `ActorCard` has role and dialogue and no garment field; `phenotype.garmentLayers` exists only on
 * assets, never on a bank actor.
 *
 * **Ship an explicit `environmentId -> patientWardrobeClass` table** — the shape #44 used for shells
 * and #81 used for posture. Rejected: a new scenario field (duplicates what the environment already
 * means, and costs a schema change plus 14 fixtures); a pattern match on `environmentId` substrings as
 * the SSOT (this repo already has FOUR placement sources from exactly that habit — a pattern match is
 * acceptable only as a fallback for unknown ids, and it must be named as one).
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * SCOPE THE ASSET WORK. DO NOT GENERATE A WARDROBE FOR FOURTEEN STATIONS.
 *
 * One new blender-only male street body, wired for telehealth. Clinic/primary-care may share it if
 * you judge that right — say so. **ED, ward, stepdown and postop keep the gown**, and the counterweight
 * enforces that. A psych "exam gown / paper gown" intermediate class is a SECOND asset and is out of
 * scope; if you think the class list needs it, say so in your report and ship without it.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THE ASSET MUST HAVE A LAND PATH
 *
 * `apps/ui-xr/public/generated-humanoids/` is TRACKED, unlike `public/cagematch/`. Commit the new GLB,
 * its `.anny_base.obj` if the rebake produces one, and a provenance manifest per MADR 0016. A slice
 * whose product bytes live only in a worktree certifies a tree nobody will have again (#64).
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * DECISIONS THAT ARE YOURS. Name each in the commit message with what you rejected.
 *  - **The wardrobe class vocabulary.** `home_street | clinic | inpatient_gown | ed_gown` is a
 *    suggestion, not a specification. Fewer classes is fine if the mapping is honest.
 *  - **Which base the new body is rebaked from.** `peds_nurse_kevin.anny_base.obj` is an adult male
 *    base; there may be a better choice.
 *  - **Whether clinic and primary care get street clothes or stay gowned.** Both are defensible.
 *  - **What happens to the factory `clothingLayer` role map.** Updating it keeps the metadata honest;
 *    leaving it makes it a lie. If you leave it, say so explicitly rather than silently.
 *
 * REVIEWER- AND LEARNER-FACING STRINGS ARE NOT YOURS TO INVENT. A wardrobe class name is internal and
 * fine. Anything a learner reads is not.
 *
 * CALIBRATION — `.openclinxr/evidence/issue-160/pre-fix.json` BEFORE any product edit: for every bank
 * scenario, the patient actor id, the GLB both resolvers return, its content hash, its real garment
 * mesh names and their base colours, and the environment id. Expected defect shape: **all twelve
 * pool-assigned patients resolve to the same gown body.** Record the mechanism per row, not only the
 * value.
 *
 * SIGNATURE IS YOURS. These read `inspectPatientAttireByCareSetting()`. What must not change: both
 * resolvers are exercised, stations are enumerated from what ships, and garment class is read from the
 * exported glTF rather than from a label.
 *
 * REQUIRED, the observable half: re-capture the telehealth room. The patient at home must not be in a
 * hospital gown, and I will grade that image.
 *
 * IN-SCOPE VISUAL — answer EVERY line. Do not replace with a sentence:
 *     telehealth_patient_gowned:  yes | no | not_visible
 *     patient_reads_as_at_home:   yes | no | not_visible
 *     ed_patient_still_gowned:    yes | no | not_checked
 *     new_body_intact:            yes | torn | not_visible
 *     figure_distinguishable:     yes | no | not_visible
 *
 * IF SATISFYING A CONTRACT HERE WILL MAKE THE PRODUCT VISIBLY WORSE, SAY SO — AND THEN SATISFY IT
 * ANYWAY. IF ANY PROOF CANNOT PASS AS WRITTEN, OR PASSES TRIVIALLY AGAINST THE OBSERVED RANGE, SAY SO
 * IN YOUR REPORT rather than silently running a corrected version.
 *
 * SCOPE: patient attire is conditioned on care setting, and a body exists to make that true for
 * telehealth. Says NOTHING about clinical dress-code correctness, about staff attire, about whether the
 * gown and the scrubs are distinguishable at viewing distance (a separate defect, deliberately not
 * folded in), or about the other twelve stations' wardrobe beyond keeping gowns where gowns belong.
 */

const load = async () =>
  import("./patient-attire-by-care-setting.js") as Promise<Record<string, unknown>>;

type GarmentShell = {
  meshName: string;
  materialName: string;
  baseColor: [number, number, number];
  triangleCount: number;
};

type PatientAttireRow = {
  scenarioId: string;
  environmentId: string;
  patientActorId: string;
  /** From packages/openclinxr/asset-registry/src/actor-casting.ts */
  registryResolvedGlb: string;
  /** From apps/ui-xr/src/humanoid-runtime-asset-url.ts — the SECOND copy. */
  runtimeResolvedGlb: string;
  contentHash: string;
  /** Real garment shells read from the exported glTF, never from labels or declared markers. */
  garmentShells: GarmentShell[];
  /** The class this station's setting calls for. */
  declaredWardrobeClass: string;
  /** What the resolved asset actually is, read from geometry. */
  measuredWardrobeClass: string;
};

type Report = {
  rows: PatientAttireRow[];
  /** Content hash of the ED gown body, so "not the gown" is a content claim. */
  gownBodyContentHash: string;
  claimScope: string;
  notEvidenceFor: string[];
};

type Inspect = () => Promise<Report>;

const TELEHEALTH = "telehealth_diabetes_health_literacy_v1";
const ED_CHEST_PAIN = "ed_chest_pain_priority_v1";

describe("patient attire follows the care setting (#160)", () => {
  it("the telehealth patient is not wearing a hospital gown at home", async () => {
    // Every pool-assigned patient draws ED_ADULT_CAST_GLB first, so the man sitting in his own living
    // room is dressed for an emergency department. Asserted on CONTENT: a different body, with garment
    // geometry whose class is not gown. Renaming clothingLayer must not satisfy this.
    const mod = await load();
    const inspect = mod["inspectPatientAttireByCareSetting"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    const home = report.rows.find((r) => r.scenarioId === TELEHEALTH);
    expect(home, `${TELEHEALTH} was not measured`).toBeTruthy();

    expect(
      home!.contentHash,
      "the telehealth patient is byte-identical to the ED gown body",
    ).not.toBe(report.gownBodyContentHash);
    expect(
      home!.measuredWardrobeClass,
      `telehealth patient measures as "${home!.measuredWardrobeClass}" — read from glTF geometry, `
      + `not from a label`,
    ).not.toMatch(/gown/iu);
    expect(
      home!.measuredWardrobeClass,
      `measured class "${home!.measuredWardrobeClass}" does not match the declared class `
      + `"${home!.declaredWardrobeClass}" for this setting`,
    ).toBe(home!.declaredWardrobeClass);
    expect(home!.garmentShells.length, "the new body has no real garment shell at all")
      .toBeGreaterThan(0);
  }, 900_000);

  it("both copies of the cast resolver agree, for every station", async () => {
    // pickAdultGlb exists TWICE — actor-casting.ts:129-130 and humanoid-runtime-asset-url.ts:81-85.
    // Fixing the registry alone leaves the learner looking at the old body, and nothing today would
    // catch that.
    const mod = await load();
    const inspect = mod["inspectPatientAttireByCareSetting"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    expect(report.rows.length, "fewer stations enumerated than the bank ships")
      .toBeGreaterThanOrEqual(14);

    const disagreements = report.rows
      .filter((r) => r.registryResolvedGlb !== r.runtimeResolvedGlb)
      .map((r) => `${r.scenarioId}: registry=${r.registryResolvedGlb} runtime=${r.runtimeResolvedGlb}`);
    expect(disagreements, `the two cast resolvers disagree:\n${disagreements.join("\n")}`)
      .toHaveLength(0);

    // Every row must carry a declared class — silence is how a station gets missed.
    for (const row of report.rows) {
      expect(
        row.declaredWardrobeClass.length,
        `${row.scenarioId} has no declared wardrobe class for environment ${row.environmentId}`,
      ).toBeGreaterThan(0);
    }
  }, 900_000);

  it("gowned settings still get gowns, and nobody shares a body (COUNTERWEIGHT)", async () => {
    // Two cheap satisfactions this forbids: dress EVERY patient in street clothes, or reassign the
    // telehealth patient onto the family member's street body — which would break within-scenario
    // content distinctness and put a male actor on a female-presenting mesh.
    const mod = await load();
    const inspect = mod["inspectPatientAttireByCareSetting"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();

    const ed = report.rows.find((r) => r.scenarioId === ED_CHEST_PAIN);
    expect(ed, `${ED_CHEST_PAIN} was not measured`).toBeTruthy();
    expect(
      ed!.measuredWardrobeClass,
      `the ED patient now measures as "${ed!.measuredWardrobeClass}" — an emergency department `
      + `patient belongs in a gown and this slice may not undress the whole bank`,
    ).toMatch(/gown/iu);

    // At least one inpatient-class station must still be gowned, enumerated rather than named, so the
    // counterweight does not rest on ED alone.
    const gowned = report.rows.filter((r) => /gown/iu.test(r.measuredWardrobeClass));
    expect(
      gowned.length,
      "only one station is gowned — the wardrobe class table has collapsed toward street clothes",
    ).toBeGreaterThanOrEqual(2);

    // Nobody may be handed a body already claimed by another actor in the same scenario, and no new
    // body may be a copy of an existing one wearing a new name.
    const hashes = report.rows.map((r) => r.contentHash);
    expect(new Set(hashes).size, "every patient in the bank resolves to the same body")
      .toBeGreaterThan(1);

    expect(report.notEvidenceFor.join(" ").toLowerCase()).toContain("clinical");
  }, 900_000);
});
