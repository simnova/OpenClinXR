import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { applyNamedSpeechVisemes } from "@openclinxr/xr-dialogue/package-viseme";
import {
  AA_MECHANISM_POSES,
  jawAngleVsBindQuat,
  loadHeadlessScene,
  measureTeethAaContribution,
  poseAndMeasureTongue,
  probeTongueAaMechanism,
  type AaMechanismPose,
  type AaMechanismPoseRow,
  type AaMechanismReport,
  type HeadlessScene,
  type JointWeight,
  type TeethAaContribution,
  type Vec3Mm,
} from "./index.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "..");
const GLBS: Record<string, string> = {
  "mpfb-ob-patient-aisha": join(REPO_ROOT, "apps/ui-xr/public/generated-humanoids/mpfb-ob-patient-aisha.glb"),
  "mpfb-peds-nurse-kevin": join(REPO_ROOT, "apps/ui-xr/public/generated-humanoids/mpfb-peds-nurse-kevin.glb"),
  "mpfb-clinical-physician-adult": join(
    REPO_ROOT,
    "apps/ui-xr/public/generated-humanoids/mpfb-clinical-physician-adult.glb",
  ),
};
/**
 * STATED (c5/F3): clause probe log sink. Writes to S0_EVIDENCE_DIR/probe.log
 * (created recursively) only when S0_EVIDENCE_DIR is set; otherwise the same
 * lines go to stdout, so a checkout without the evidence dir still passes.
 */
function probeLog(line: string): void {
  const dir = process.env["S0_EVIDENCE_DIR"];
  if (!dir) {
    console.log(line);
    return;
  }
  mkdirSync(dir, { recursive: true });
  appendFileSync(join(dir, "probe.log"), line.endsWith("\n") ? line : `${line}\n`);
}

/** STATED (S0b): same-index displacement of two head-local positions, mm. */
function dispMm(atAa: Vec3Mm, atBind: Vec3Mm): Vec3Mm {
  return [atAa[0] - atBind[0], atAa[1] - atBind[1], atAa[2] - atBind[2]];
}

/**
 * STATED (S0b) derivations per actor, from one AaMechanismReport:
 * - tipDisp = aaTipAtBindIndexMm - bind.tipPosMm (SAME tip vertex at both poses;
 *   the aa argmax index is reported separately as aa.tipIndex).
 * - crownDisp = aaCrownAtBindIndexMm - bind.crownPosMm (SAME crown vertex).
 * - dispDiff = tipDisp - crownDisp (gap change explained by co-motion vs split).
 */
function deriveS0b(report: AaMechanismReport): {
  tipDisp: Vec3Mm;
  crownDisp: Vec3Mm;
  dispDiff: Vec3Mm;
} {
  const tipDisp = dispMm(report.aaTipAtBindIndexMm, report.bind.tipPosMm);
  const crownDisp = dispMm(report.aaCrownAtBindIndexMm, report.bind.crownPosMm);
  const dispDiff: Vec3Mm = [tipDisp[0] - crownDisp[0], tipDisp[1] - crownDisp[1], tipDisp[2] - crownDisp[2]];
  return { tipDisp, crownDisp, dispDiff };
}

/** Explicit full matrix refresh: scene graph first, then every skeleton. */
function refreshScene(scene: HeadlessScene): void {
  scene.root.updateMatrixWorld(true);
  for (const mesh of [scene.body, scene.teeth, scene.tongue] as const) mesh?.skeleton.update();
  scene.root.updateMatrixWorld(true);
}

/** STATED (c4, coordinator cap52): clause-(3) split threshold on the teeth contribution. */
const CONTRIB_SPLIT_MM = 0.05;

/**
 * STATED (c4, coordinator cap52): clause-(3) relation. For one actor,
 * (fitted teeth mesh has a viseme_aa morph target) <=> (teeth contribution <
 * -0.05), contribution = shipped dispDiffZ - delta-zeroed dispDiffZ (DEF1).
 * TOL 0.05 = landed R1 TOL (the-tongue-channel-reads test, "R1 fresh-read"). The
 * relation holds before AND after a product fix (never an inverted guard): it
 * asserts neither who has targets nor any actor's value as a fixture fact.
 */
function checkClause3(asset: string, contrib: TeethAaContribution): void {
  const split = contrib.contribution < -CONTRIB_SPLIT_MM;
  expect(
    split,
    `${asset}: teeth viseme_aa present=${contrib.present} but contribution=${contrib.contribution}`,
  ).toBe(contrib.present);
}

/** STATED (c3 probe helper): max absolute value of a morph-target delta buffer. */
function maxAbsDelta(delta: ArrayLike<number>): number {
  let best = 0;
  for (let index = 0; index < delta.length; index += 1) {
    const magnitude = Math.abs(delta[index] ?? 0);
    if (magnitude > best) best = magnitude;
  }
  return best;
}

/** STATED (c4 probe): zero the teeth viseme_aa delta in memory, KEEP the dictionary entry. */
function zeroTeethAaDeltaKeepDict(scene: HeadlessScene): void {
  const targetIndex = scene.teeth.targetNames.indexOf("viseme_aa");
  if (targetIndex < 0) return;
  scene.teeth.targetDeltas[targetIndex]?.fill(0);
}

/** STATED (c4 probe): drop the teeth viseme_aa dictionary + targetNames entries AND zero the delta. */
function dropTeethAaEntry(scene: HeadlessScene): void {
  const targetIndex = scene.teeth.targetNames.indexOf("viseme_aa");
  const delta = targetIndex >= 0 ? scene.teeth.targetDeltas[targetIndex] : undefined;
  delta?.fill(0);
  scene.teeth.targetNames = scene.teeth.targetNames.filter((name) => name !== "viseme_aa");
  const dict = scene.teeth.skinned.morphTargetDictionary;
  if (dict) delete dict["viseme_aa"];
}

describe("tongue channel names why the tongue leads the crown at open visemes", () => {
  it("P2: every aa row carries activeTargetName viseme_aa and a jaw angle > 0", async () => {
    for (const [asset, glbPath] of Object.entries(GLBS)) {
      const report = await probeTongueAaMechanism(glbPath);
      expect(report.aa.activeTargetName, `${asset}/aa activeTargetName`).toBe("viseme_aa");
      expect(report.aa.jawAngleRad, `${asset}/aa jaw angle rad`).toBeGreaterThan(0);
      // A2 instrument-miss record: morph keys ride along on every row.
      expect(report.bind.activeTargetName, `${asset}/bind activeTargetName`).toBeNull();
    }
  }, 180000);

  it("P1: the fresh-scene bind row equals the landed channel bind value within 0.05 mm", async () => {
    // TOL = the landed R1 test tolerance (the-tongue-channel-reads test, "R1 fresh-read").
    const TOL_MM = 0.05;
    for (const [asset, glbPath] of Object.entries(GLBS)) {
      const report = await probeTongueAaMechanism(glbPath);
      const helperBindMm = report.bind.tipPosMm[2] - report.bind.crownPosMm[2];
      const landedScene = await loadHeadlessScene(glbPath);
      const landed = poseAndMeasureTongue(landedScene, "bind").tongueTipMinusIncisorZMm;
      expect(
        Math.abs(helperBindMm - landed),
        `${asset}/bind helper ${helperBindMm} vs landed ${landed}`,
      ).toBeLessThanOrEqual(TOL_MM);
    }
  }, 180000);

  it("clause (3): teeth viseme_aa presence matches the contribution split on every actor", async () => {
    // Known-good column: Kevin shipped -5.556, zeroed -0.509, contribution
    // -5.047; physician MEASURED and printed below; Aisha 0 targets,
    // contribution 0 by construction. The relation alone holds today and
    // after Aisha gains targets: no assertion that Aisha has 0 targets, nor
    // on any actor's presence or value as a fixture fact.
    for (const [asset, glbPath] of Object.entries(GLBS)) {
      const contrib = await measureTeethAaContribution(glbPath);
      console.log(`CONTRIB_JSON ${JSON.stringify({ asset, ...contrib })}`);
      checkClause3(asset, contrib);
    }
  }, 180000);

  it("clause (3) destructive probe: zeroing teeth viseme_aa delta on Kevin (dict kept) zeroes the contribution and flags kevin; revert passes", async () => {
    const asset = "mpfb-peds-nurse-kevin";
    const glbPath = GLBS[asset] ?? "";
    const base = await measureTeethAaContribution(glbPath);
    expect(base.present, `${asset} baseline has teeth viseme_aa`).toBe(true);
    const round3 = (value: number): number => Math.round(value * 1000) / 1000;

    // Fresh scene: max |delta| of the teeth viseme_aa target before the plant.
    const probeScene = await loadHeadlessScene(glbPath);
    const probeIndex = probeScene.teeth.targetNames.indexOf("viseme_aa");
    expect(probeIndex, `${asset} teeth viseme_aa index`).toBeGreaterThanOrEqual(0);
    const probeDelta = probeScene.teeth.targetDeltas[probeIndex];
    if (!probeDelta) throw new Error("teeth viseme_aa delta missing");
    const deltaBefore = maxAbsDelta(probeDelta);

    // Plant: zero teeth viseme_aa delta, KEEP the dictionary entry (in-memory
    // only; GLBs are never edited). Presence still reads true while the
    // morph's geometry contribution is gone. The plant records its own
    // driven-scene after-value (bind scene runs first, driven scene last).
    // STATED (c5/F2): the plant must keep the dictionary entry (presence still
    // true) while the geometry delta reads exactly 0; either half missing
    // would still reproduce the flag for the wrong reason.
    let plantAfter = -1;
    let plantDictHas = false;
    let plantNamesHas = false;
    const recordingPlant = (scene: HeadlessScene): void => {
      zeroTeethAaDeltaKeepDict(scene);
      const targetIndex = scene.teeth.targetNames.indexOf("viseme_aa");
      const delta = targetIndex >= 0 ? scene.teeth.targetDeltas[targetIndex] : undefined;
      if (delta) plantAfter = maxAbsDelta(delta);
      plantDictHas = scene.teeth.skinned.morphTargetDictionary?.["viseme_aa"] !== undefined;
      plantNamesHas = scene.teeth.targetNames.includes("viseme_aa");
    };
    const planted = await measureTeethAaContribution(glbPath, { plant: recordingPlant });
    expect(planted.present, "planted shipped leg still present").toBe(true);
    expect(plantDictHas, "planted scene dict still has viseme_aa").toBe(true);
    expect(plantNamesHas, "planted scene targetNames still has viseme_aa").toBe(true);
    expect(plantAfter, "planted scene max|delta| reads 0").toBe(0);
    const deltaAfter = plantAfter;
    probeLog(
      `clause-3 destructive probe (kevin aa): delta zeroed, dict kept, ` +
        `present=${planted.present} max|delta| ${round3(deltaBefore)}->${round3(deltaAfter)} ` +
        `contribution ${round3(base.contribution)}->${round3(planted.contribution)} ` +
        `(shipped ${round3(planted.shippedDispDiffZ)}, zeroed ${round3(planted.zeroedDispDiffZ)})\n`,
    );
    probeLog(
      `clause-3 destructive probe (kevin aa): plant verified dict=${plantDictHas ? "kept" : "absent"} ` +
        `targetNames=${plantNamesHas ? "kept" : "absent"} max|delta|=${plantAfter}\n`,
    );
    // The relation must FLAG kevin: present=true but the contribution is ~0
    // (jaw-only residual cancels), so the biconditional fails naming kevin.
    let flagged: unknown = null;
    try {
      checkClause3(asset, planted);
    } catch (error) {
      flagged = error;
    }
    expect(flagged, "planted kevin mismatch flags the relation").not.toBeNull();
    expect(String(flagged), "flag names kevin").toContain("kevin");
    probeLog(
      `clause-3 destructive probe (kevin aa): relation flags kevin as expected ` +
        `(present=${planted.present}, contribution=${round3(planted.contribution)})\n`,
    );

    // Revert the in-memory plant; a fresh measurement passes the relation again.
    const reverted = await measureTeethAaContribution(glbPath);
    checkClause3(asset, reverted);
    probeLog(
      `clause-3 destructive probe (kevin aa): reverted (plant dropped); ` +
        `fresh measurement passes relation (present=${reverted.present}, ` +
        `contribution=${round3(reverted.contribution)})\n`,
    );
  }, 180000);

  it("clause (3) consistency: dropping the dictionary entry on Kevin reads absent and holds", async () => {
    const asset = "mpfb-peds-nurse-kevin";
    const glbPath = GLBS[asset] ?? "";
    const round3 = (value: number): number => Math.round(value * 1000) / 1000;
    // Documented consistency row (must PASS): entry dropped + delta zeroed ->
    // present=false, contribution ~0, not split -> relation holds.
    // STATED (c5/F2): consistency requires the FULL plant — dict entry gone
    // AND targetNames entry gone AND delta reads 0. Either half alone
    // reproduces present=false/contribution=0 for the wrong reason (review).
    let dropDictHas = true;
    let dropNamesHas = true;
    let dropMaxAbs = -1;
    let dropPreHas = false;
    let dropPreMaxAbs = -1;
    const recordingDrop = (scene: HeadlessScene): void => {
      const preIndex = scene.teeth.targetNames.indexOf("viseme_aa");
      const preDelta = preIndex >= 0 ? scene.teeth.targetDeltas[preIndex] : undefined;
      dropPreHas = preDelta !== undefined;
      dropPreMaxAbs = preDelta ? maxAbsDelta(preDelta) : 0;
      dropTeethAaEntry(scene);
      dropDictHas = scene.teeth.skinned.morphTargetDictionary?.["viseme_aa"] !== undefined;
      dropNamesHas = scene.teeth.targetNames.includes("viseme_aa");
      dropMaxAbs = preDelta ? maxAbsDelta(preDelta) : 0;
    };
    const dropped = await measureTeethAaContribution(glbPath, { plant: recordingDrop });
    expect(dropPreHas, "pre-plant teeth viseme_aa delta exists (else vacuous pass)").toBe(true);
    expect(dropPreMaxAbs, "pre-plant max|delta| > 0 (else vacuous pass)").toBeGreaterThan(0);
    expect(dropped.present, "dropped entry reads absent").toBe(false);
    expect(dropDictHas, "dropped scene dict has no viseme_aa").toBe(false);
    expect(dropNamesHas, "dropped scene targetNames has no viseme_aa").toBe(false);
    expect(dropMaxAbs, "dropped scene max|delta| reads 0").toBe(0);
    checkClause3(asset, dropped);
    probeLog(
      `clause-3 consistency probe (kevin aa): dictionary entry dropped + delta zeroed, ` +
        `present=${dropped.present} contribution=${round3(dropped.contribution)} ` +
        `(shipped ${round3(dropped.shippedDispDiffZ)}, zeroed ${round3(dropped.zeroedDispDiffZ)}) relation holds\n`,
    );
    probeLog(
      `clause-3 consistency probe (kevin aa): pre-plant max|delta|=${dropPreMaxAbs} ` +
        `present before drop, plant verified dict=${dropDictHas ? "kept" : "absent"} ` +
        `targetNames=${dropNamesHas ? "kept" : "absent"} max|delta|=${dropMaxAbs}\n`,
    );
  }, 180000);

  it("rounding guard: a ~1% Kevin teeth delta still splits on unrounded math", async () => {
    // STATED (c5/F1, c6/N1+N3): scale the Kevin teeth viseme_aa delta so the
    // contribution lands on TARGET_MM = -0.0505 (half the 0.001 mm rounding
    // step past TOL 0.05). Contribution is linear in the delta scale (teeth
    // morph and skinning are linear; tip does not read the teeth delta), so
    // unrounded math lands on TARGET_MM for any asset, while rounding to
    // 0.001 mm yields values on a 0.001 grid (-0.050/-0.051), 0.0005 from TARGET.
    const asset = "mpfb-peds-nurse-kevin";
    const glbPath = GLBS[asset] ?? "";
    const base = await measureTeethAaContribution(glbPath);
    expect(base.present, `${asset} baseline has teeth viseme_aa`).toBe(true);
    const TARGET_MM = -0.0505;
    const scale = TARGET_MM / base.contribution;
    const scalePlant = (scene: HeadlessScene): void => {
      const targetIndex = scene.teeth.targetNames.indexOf("viseme_aa");
      const delta = targetIndex >= 0 ? scene.teeth.targetDeltas[targetIndex] : undefined;
      if (!delta) return;
      for (let index = 0; index < delta.length; index += 1) {
        delta[index] = (delta[index] ?? 0) * scale;
      }
    };
    const contrib = await measureTeethAaContribution(glbPath, { plant: scalePlant });
    const err = Math.abs(contrib.contribution - TARGET_MM);
    probeLog(
      `rounding guard (kevin aa): scale=${scale} contribution=${contrib.contribution} ` +
        `target=${TARGET_MM} |error|=${err} split=${contrib.contribution < -CONTRIB_SPLIT_MM}\n`,
    );
    if (err > 1e-6) {
      probeLog(
        `rounding guard linearity residual |contribution - TARGET_MM|=${err} exceeds 1e-6 ` +
          `(linearity premise); bound stays 1e-4\n`,
      );
    }
    expect(contrib.present, "scaled leg still present").toBe(true);
    expect(err, `scaled contribution within 1e-4 of TARGET_MM`).toBeLessThan(1e-4);
    checkClause3(asset, contrib);
    probeLog(
      `rounding guard (kevin aa): scale=${scale} contribution=${contrib.contribution} split=true\n`,
    );
  }, 600000);

  it("non-vacuous: planting jaw angle 0 at aa makes the P2 jaw condition fail", async () => {
    const glbPath = GLBS["mpfb-ob-patient-aisha"] ?? "";
    const scene = await loadHeadlessScene(glbPath);
    const bindQuat = scene.jawBone.quaternion.clone();
    const drive = applyNamedSpeechVisemes(
      {
        root: scene.root,
        activeSpeech: { phonemeSequence: ["AA"], startedAtMs: 0, durationMs: 1000 },
      },
      500,
    );
    expect(drive.appliedMeshCount).toBeGreaterThan(0);
    refreshScene(scene);
    const savedAaQuat = scene.jawBone.quaternion.clone();
    const before = jawAngleVsBindQuat(scene, bindQuat);
    expect(before, "aa jaw angle before planting").toBeGreaterThan(0);
    // Destructive plant: override the jaw to bind AFTER the drive.
    scene.jawBone.quaternion.copy(bindQuat);
    refreshScene(scene);
    const after = jawAngleVsBindQuat(scene, bindQuat);
    probeLog(
      `destructive jaw-zero probe (aisha aa): activeTargetName=${drive.activeTargetName} ` +
        `jawAngleBefore=${before} jawAngleAfter=${after}\n`,
    );
    expect(after, "planted jaw angle reads 0").toBe(0);
    // Clause (1)'s jaw condition is now false: the assertion is sensitive to the jaw.
    expect(after > 0, "P2 jaw condition fails under the planted zero").toBe(false);
    // Revert the plant (in-memory scene only; GLBs are never edited).
    scene.jawBone.quaternion.copy(savedAaQuat);
    refreshScene(scene);
    expect(jawAngleVsBindQuat(scene, bindQuat), "jaw angle restored after revert").toBeGreaterThan(0);
  }, 120000);

  it("S0b: report per-actor tip/crown displacements (no threshold on Aisha)", async () => {
    // S0a helper shape: the probe covers exactly bind + viseme_aa, in order.
    expect([...AA_MECHANISM_POSES] satisfies AaMechanismPose[]).toEqual(["bind", "viseme_aa"]);
    for (const [asset, glbPath] of Object.entries(GLBS)) {
      const report = await probeTongueAaMechanism(glbPath);
      const bindRow: AaMechanismPoseRow = report.bind;
      // Brief S0a: the tip row carries its top-3 skin joints with weights.
      const tipJoints: JointWeight[] = bindRow.tipTopJoints;
      expect(tipJoints, `${asset} tip top-3 joints`).toHaveLength(3);
      const { tipDisp, crownDisp, dispDiff } = deriveS0b(report);
      console.log(
        `S0B_JSON ${JSON.stringify({ asset, bind: report.bind, aa: report.aa, aaTipAtBindIndexMm: report.aaTipAtBindIndexMm, aaCrownAtBindIndexMm: report.aaCrownAtBindIndexMm, tipDisp, crownDisp, dispDiff })}`,
      );
      expect(Number.isFinite(tipDisp[2]), `${asset} tipDisp finite`).toBe(true);
      expect(Number.isFinite(crownDisp[2]), `${asset} crownDisp finite`).toBe(true);
    }
  }, 180000);
});
