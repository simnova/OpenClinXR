import { describe, expect, it } from "vitest";

/**
 * PLANTED CONTRACTS (#90) — one measurement that turns a foundational fork into a decision.
 *
 * ALL THREE ARE `it.fails` AND ALL THREE FLIP TO `it(`. They are not all REDs:
 *   (1) and (2) are REDs — the probe does not exist.
 *   (3) is a COUNTERWEIGHT — it asserts something ALREADY TRUE that this slice must not disturb
 *       (the shipped Anny humanoids keep loading with their 23-joint runtime rig). It is `it.fails`
 *       only because the module is absent; a plain `it(` would redden main for the dispatch window.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * THE FORK, AND WHY IT IS NOT A REFACTOR
 *
 * #78 closed as a clean negative: no local AI pipeline produces fitted garment geometry on Anny.
 * The reason is narrow and specific:
 *
 *     MakeHuman basemesh  →  MakeClothes fit succeeds in ~0.03 s
 *     Anny base           →  ValueError: The provided object is not a basemesh
 *                            19,158 verts (MakeHuman)  vs  13,686 verts (Anny)
 *
 * The gate is `object_type == Basemesh` (`objectservice.py:325-327`), and `ClothesService` scales on
 * FIXED MakeHuman vertex indices (`clothesservice.py:19-99`). It is not "any human mesh".
 *
 * So the question is not "can we generate clothes" but WHICH BODY WE BUILD ON — and nobody has made
 * that choice explicitly. Keeping Anny means hand-authored garments indefinitely (~245 float and
 * ~145 int literals in the shape core, `automate_blender.py:1989-2500`, with `garmentLayers` only
 * selecting a branch at `:1676-1684`). The operator has ruled against that direction: the AI
 * approach is a factory approach, hand-adapting is not.
 *
 * DOING NEITHER IS ALSO A CHOICE, and it is the one currently in effect by default.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * WHAT A PEER ROUND ALREADY SETTLED — do not re-derive these
 *
 * THE SKELETON IS NOT THE BARRIER, which was the biggest unknown when this issue was filed.
 * `runtime_bone_map.json` declares `sourceRig: "anny.create_fullbody_model(rig=default) MakeHuman-style
 * labels"` with `runtimeSubsetCount: 23`. Our bone naming already IS MakeHuman-style, and all 61 map
 * primaries and weight sources are a subset of MPFB's `rig.default` (163 bones) with ZERO missing.
 * MPFB skeletons are selectable, not fixed — but only `rig.default` aligns; `game_engine` (53 bones)
 * overlaps on `pelvis` and `head` alone and would need a different map.
 *
 * THE PROXY ROUTE IS A PROJECT, NOT A FLAG. Fitting on MakeHuman and transferring to Anny re-opens
 * exactly the correspondence problem SMPLitex died on — 6,890 vs 13,686 verts, 3 of 24 joint names
 * shared. There is no transfer path in the tree. Do not build one here.
 *
 * WHAT ANNY UNIQUELY GIVES, and it is real: an Apache-2.0 parametric path with a common
 * infant→elder topology, a fully wired generation factory, and every shipped humanoid. Its own
 * source claims explicitly EXCLUDE clothing. It is `lanes: ["human_base_mesh"]`; `makehuman_outputs`
 * is `lanes: ["human_base_mesh", "clothing"]` with `approvalBlockers: []`.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * THE ONE THING NOBODY HAS MEASURED, AND IT MAY DECIDE EVERYTHING
 *
 * #78 never fitted a real garment — its successful control was a UV sphere with synthetic `Mhclo`
 * vertices, which proves the fit API executes and nothing about garments. The local cache holds only
 * a street `makehuman-shirts01` and a locally-authored clinical top. **No scrub or gown `.mhclo`
 * exists locally.** Community clinical assets appear to exist (scrubs, surgical masks) but their
 * licence and fit are unverified, and fashion "gown" packs are not hospital gowns.
 *
 * If the CC0 ecosystem has no usable clinical wear, switching bases buys a fitting pipeline with
 * nothing to fit, and the fork collapses. THAT is the measurement this slice exists to make.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * THE DELIVERABLE IS A DECISION WITH EVIDENCE PLUS A MADR. A NEGATIVE CLOSES THIS SUCCESSFULLY:
 * "no CC0 clinical garment exists under an acceptable licence, here is what was searched" is a
 * result and it settles the fork toward keeping Anny. So is "the scrub fits and the rig collapses
 * cleanly, here are the captures" — which settles it the other way. DO NOT ADOPT ANYTHING and do not
 * regenerate a single shipped humanoid in this slice.
 *
 * LICENCE IS A HARD GATE, NOT A PREFERENCE. MADR 0016's posture is outputs-only: reviewed CC0
 * outputs may be used; MakeHuman/MPFB SOURCE is AGPL/GPL and must not be embedded or shipped. If a
 * candidate garment's licence cannot be established from its own distribution, record it as
 * `blocked` with what you found — DO NOT guess, and do not download anything whose terms you cannot
 * read. Licence calls belong to Patrick.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * WHY THE THREE PULL APART. (1) is about GARMENTS EXISTING and is satisfiable while the rig is
 * unusable. (2) is about the RIG COLLAPSING and is satisfiable with no garment in sight. (3) forbids
 * buying either by disturbing what already ships.
 *
 * SIGNATURE IS THE IMPLEMENTER'S CHOICE. These read `probeMakeHumanBaseViability()`. Change the call
 * sites and say why if a different shape is better. What must not change: a garment claim carries the
 * asset's own licence string and a triangle count from the fitted result, the rig claim compares
 * against the live `runtime_bone_map` rather than a hardcoded list, and no shipped asset is modified.
 *
 * EVERY CANDIDATE GARMENT IS `fitted` WITH MEASUREMENTS OR `blocked` WITH A REASON. Silence about one
 * is how a search nobody ran gets filed as one — this repo produced a fabricated `score.json` once
 * (#17). And every enum here has an escape value with required free text, because a closed
 * vocabulary with no room for the honest outcome forces a misreport (§7c, learned on #78).
 *
 * SCOPE: whether MakeHuman topology could host our runtime rig and whether licensable clinical
 * garments exist for it. Says NOTHING about whether any garment looks right — that is a render I
 * grade — nor whether it is clinically appropriate, which needs a clinician and is not claimed.
 *
 * IN-SCOPE VERDICT required in your report: one line per candidate garment, "X was ___". If you
 * produce a render I will grade it; say what you think it looks like first. Separately name any
 * out-of-scope wrongness you saw — the object and what it looks like, not the word "deformed".
 */

const load = async () =>
  import("./makehuman-base-viability.js") as Promise<Record<string, unknown>>;

type GarmentCandidate = {
  candidateId: string;
  status: "fitted" | "blocked" | "other";
  /** Required when blocked or other — the actual error, licence clause, or situation. */
  reason?: string;
  /** The asset's own declared licence, read from its distribution. Never inferred. */
  licenseString?: string;
  isClinicalWear?: boolean;
  measurements?: Record<string, number | string>;
};

type RigCollapse = {
  /** Names produced by collapsing the MakeHuman default rig through our existing map. */
  collapsedJointNames: string[];
  /** Names the live runtime_bone_map declares — read from the file, not hardcoded here. */
  runtimeMapJointNames: string[];
  missingFromMakeHuman: string[];
};

type Probe = () => Promise<{
  garments: GarmentCandidate[];
  rig: RigCollapse;
  shippedHumanoidJointCounts: Record<string, number>;
}>;

describe("MakeHuman topology could host our factory (#90)", () => {
  it("a real clinical garment is either fitted with measurements or blocked with its licence", async () => {
    // #78's control was a UV sphere. This demands a REAL `.mhclo` and, if it cannot be obtained
    // under an acceptable licence, says so explicitly — which is a legitimate result that settles
    // the fork toward keeping Anny.
    const mod = await load();
    const probe = mod["probeMakeHumanBaseViability"] as Probe | undefined;
    expect(probe).toBeTypeOf("function");

    const report = await probe!();
    expect(report.garments.length, "no garment candidate was even considered").toBeGreaterThan(0);

    const clinical = report.garments.filter((g) => g.isClinicalWear === true);
    expect(
      clinical.length,
      "no CLINICAL garment candidate was considered — street clothing does not settle this",
    ).toBeGreaterThan(0);

    for (const g of report.garments) {
      expect(["fitted", "blocked", "other"]).toContain(g.status);
      if (g.status === "fitted") {
        expect(String(g.licenseString ?? ""), `${g.candidateId} fitted with no licence recorded`).not.toHaveLength(0);
        expect(
          Object.keys(g.measurements ?? {}).length,
          `${g.candidateId} fitted but carries no measurement — a claim with no numbers is a narrative`,
        ).toBeGreaterThan(0);
      } else {
        expect(String(g.reason ?? ""), `${g.candidateId} is ${g.status} with no reason`).not.toHaveLength(0);
      }
    }
  }, 3_600_000);

  it("the MakeHuman default rig collapses to the same 23 runtime joints we already use", async () => {
    // The peer round measured 0 missing against MPFB `rig.default`, because runtime_bone_map already
    // declares MakeHuman-style labels. This proves it end-to-end rather than by name comparison.
    const mod = await load();
    const probe = mod["probeMakeHumanBaseViability"] as Probe | undefined;
    expect(probe).toBeTypeOf("function");

    const report = await probe!();
    expect(report.rig.runtimeMapJointNames.length, "the live runtime_bone_map was not read").toBeGreaterThan(0);
    expect(
      report.rig.missingFromMakeHuman,
      `runtime joints absent from the MakeHuman default rig: ${report.rig.missingFromMakeHuman.join(", ")}`,
    ).toHaveLength(0);
    expect(report.rig.collapsedJointNames.length, "the collapse produced no joints").toBe(
      report.rig.runtimeMapJointNames.length,
    );
  }, 3_600_000);

  it("every shipped humanoid still carries its 23-joint runtime rig (COUNTERWEIGHT — already true)", async () => {
    // Nothing in this slice may touch what ships. An investigation that regenerates a humanoid to
    // make its own point has changed the thing it was measuring.
    const mod = await load();
    const probe = mod["probeMakeHumanBaseViability"] as Probe | undefined;
    expect(probe).toBeTypeOf("function");

    const report = await probe!();
    const counts = Object.entries(report.shippedHumanoidJointCounts);
    expect(counts.length, "no shipped humanoid was inspected").toBeGreaterThan(0);
    for (const [name, jointCount] of counts) {
      expect(jointCount, `${name} no longer has a 23-joint runtime rig`).toBe(23);
    }
  }, 3_600_000);
});
