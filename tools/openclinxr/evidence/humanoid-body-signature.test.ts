import { describe, expect, it } from "vitest";

/**
 * PLANTED CONTRACTS (#276) — a DIAGNOSIS slice, not a fix.
 *
 * The deliverable is which of (a)-(d) is true about why six of eight shipped humanoids
 * share one body, plus a staleness guard so the artifact cannot rot the way #166/#273 did.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THE DEFECT, MEASURED ON MAIN (2026-08-10) — recompute, do not copy from this header
 *
 * Every GLB under apps/ui-xr/public/generated-humanoids/, largest mesh, @gltf-transform NodeIO:
 *
 *   26,692 t / 13,876 v / H=1.76m  ->  4: adult_male_street_casual, ed_chest_pain_adult_cast,
 *                                       ed_chest_pain_nurse_adult, peds_nurse_kevin
 *   26,692 t / 13,872 v / H=1.66m  ->  2: ed_chest_pain_spouse_adult, peds_anxious_parent
 *   36,972 t / 22,030 v            ->  1: mpfb-ob-patient-aisha
 *   27,420 t / 14,268 v / H=1.25m  ->  1: peds_patient_child
 *
 * SIX ADULTS, TWO BODIES. Order-invariant body signatures: nurse==kevin and spouse==parent are
 * byte-identical; the other two group-A assets differ by ~7 µm mean (garment-offset noise).
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THE DIAGNOSIS (see rail-diagnosis.json for the full evidence) — case (c)
 *
 * The Anny rail HAS a phenotype→geometry path (generate_mesh.py::build_real_anny_body runs the
 * real Anny model with phenotype_kwargs), so (a) is false. It is not "invoked but produces no
 * delta" — every shipped Anny GLB provenance records generatorMode
 * blender_only_rebake_on_tracked_real_anny_base_obj_v1 and notRun=[anny_forward_pass,
 * orchestrate_character, ...]; the rebake script copies one of TWO tracked base OBJs per actor
 * and never re-runs the forward pass, so (b) is false. hm08 bodies ARE castable (the ED spouse
 * resolves to the body-param MakeClothes library GLB), so (d) is false. Therefore (c): the path
 * exists but casting points six actors at prebuilt assets built from one (two) prebuilt body.
 *
 * These contracts are the staleness guard: they go RED the moment the shipped bodies change,
 * on purpose, so a future fix that makes bodies distinct forces the artifact to be regenerated.
 */

import {
  DIAGNOSIS_CASES,
  readPreFixArtifact,
  readRailDiagnosisArtifact,
  scanShippedHumanoidBodies,
} from "./humanoid-body-signature.js";

const ADULT_ANNY_GLBS = [
  "adult_male_street_casual.glb",
  "ed_chest_pain_adult_cast.glb",
  "ed_chest_pain_nurse_adult.glb",
  "ed_chest_pain_spouse_adult.glb",
  "peds_anxious_parent.glb",
  "peds_nurse_kevin.glb",
];

describe("humanoid body signature (#276)", () => {
  it("recomputes every GLB signature live and the pre-fix.json artifact still matches (staleness guard)", async () => {
    const { assets } = await scanShippedHumanoidBodies();
    expect(assets.length, "scanned no GLBs under generated-humanoids/").toBeGreaterThan(0);

    const preFix = readPreFixArtifact();
    expect(preFix, "pre-fix.json missing — run the module once to write it").not.toBeNull();

    const byFile = new Map(preFix!.assets.map((a) => [a.file, a]));
    const mismatches: string[] = [];
    for (const live of assets) {
      const recorded = byFile.get(live.file);
      if (!recorded) {
        mismatches.push(`${live.file}: present in live scan, absent from artifact`);
        continue;
      }
      if (recorded.triangles !== live.triangles) {
        mismatches.push(`${live.file}: triangles ${recorded.triangles} != live ${live.triangles}`);
      }
      if (recorded.vertices !== live.vertices) {
        mismatches.push(`${live.file}: vertices ${recorded.vertices} != live ${live.vertices}`);
      }
      if (recorded.largestMeshName !== live.largestMeshName) {
        mismatches.push(
          `${live.file}: largestMeshName "${recorded.largestMeshName}" != live "${live.largestMeshName}"`,
        );
      }
      if (recorded.bodySha256 !== live.bodySha256) {
        mismatches.push(`${live.file}: body geometry sha changed (${recorded.bodySha256} != ${live.bodySha256})`);
      }
      if (recorded.bodyClassKey !== live.bodyClassKey) {
        mismatches.push(`${live.file}: body-class key ${recorded.bodyClassKey} != live ${live.bodyClassKey}`);
      }
    }
    for (const recorded of preFix!.assets) {
      if (!byFile.has(recorded.file)) {
        mismatches.push(`${recorded.file}: present in artifact, absent from live scan`);
      }
    }
    expect(
      mismatches,
      `signature table went stale — regenerate .openclinxr/evidence/issue-276/pre-fix.json and update the diagnosis:\n${mismatches.join("\n")}`,
    ).toEqual([]);
  }, 180_000);

  it("the six adult Anny assets still share no more than two body classes (the fact the diagnosis is anchored to)", async () => {
    const { assets, groups } = await scanShippedHumanoidBodies();
    const adult = assets.filter((a) => ADULT_ANNY_GLBS.includes(a.file));
    expect(adult.length, "expected six adult Anny GLBs in the scan").toBe(6);

    const adultClasses = new Set(adult.map((a) => a.bodyClassKey));
    expect(
      adultClasses.size,
      `six adults resolve to ${adultClasses.size} body classes — bodies became distinct. This is the fix landing; ` +
        `regenerate the artifacts and update rail-diagnosis.json instead of widening this assertion.`,
    ).toBeLessThanOrEqual(2);

    // The classes are distinct topologies/statures (never a uniform scale of one mesh).
    const adultGroups = groups.filter((g) =>
      adult.some((a) => a.bodyClassKey === g.bodyClassKey),
    );
    for (const g of adultGroups) {
      expect(
        g.vertices,
        `adult group ${g.bodyClassKey} vertex count — a uniform-scale look-alike must not slip through`,
      ).toBeGreaterThan(10_000);
    }
  }, 180_000);

  it("rail-diagnosis.json names exactly one of (a)-(d), with evidence excluding the other three", async () => {
    const diag = readRailDiagnosisArtifact();
    expect(diag, "rail-diagnosis.json missing — run the module once to write it").not.toBeNull();

    const { case: diagnosisCase, label } = diag!.diagnosis;
    expect(DIAGNOSIS_CASES, `diagnosis.case "${diagnosisCase}" must be one of ${DIAGNOSIS_CASES.join(", ")}`).toContain(
      diagnosisCase,
    );
    expect(label?.length ?? 0).toBeGreaterThan(40);

    // Exactly one case: the other three each carry a ruled-out reason with evidence.
    const excluded = DIAGNOSIS_CASES.filter((c) => c !== diagnosisCase);
    expect(
      Object.keys(diag!.excludes).sort(),
      "excludes must cover the other three cases",
    ).toEqual([...excluded].sort());
    for (const other of excluded) {
      const entry = diag!.excludes[other as "a" | "b" | "d"];
      expect(entry?.ruledOutBy?.length ?? 0, `case ${other}: missing ruledOutBy`).toBeGreaterThan(20);
      expect(entry?.evidence?.length ?? 0, `case ${other}: missing evidence`).toBeGreaterThan(0);
    }

    // Counterweight: no uniform-scale escape hatch.
    expect(diag!.counterweight?.toLowerCase().includes("scale") ?? false, "counterweight must forbid uniform scaling").toBe(true);
    expect(diag!.notRun?.includes("anny_forward_pass") ?? false, "notRun must record anny_forward_pass").toBe(true);
  }, 30_000);
});
