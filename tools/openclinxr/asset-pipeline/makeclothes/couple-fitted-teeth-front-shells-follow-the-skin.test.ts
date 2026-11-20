import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { afterEach, describe, expect, it } from "vitest";
import {
  CLEAR_BAND_M,
  FRONT_SHELL_ABS_X_M,
  FRONT_SHELL_Z_BAND_M,
  frontShellIndices,
  JAW_WEIGHT_MIN,
  jawWeightSum,
  planTeethVisemeTargets,
  teethSkinOrNull,
} from "./couple-fitted-teeth-to-lip-viseme.ts";

// tsk_09ebec711d102e62 (store/aisha-parity/teeth-visemes/shells/red):
// the shipped coupler refused mpfb-ob-patient-aisha with "lower front shell
// is not entirely jaw-weighted", so her fitted teeth carried no planned visemes.
// F1 made the front shells follow the skin (weight-filtered rows); R1 now
// pins that Aisha plans, and CW1 pins the no-op on actors that already planned.
// Aisha's new shells are upper 34 / lower 228.
// OPEN (parent-aisha): provenance UNKNOWN; its front band carries mid weights
// (jaw 0.1-0.5 on 286 vertices, S0b), so no weight-filtered shell can seat it;
// card it only if a learner-visible defect is measured.
// KNOWN LIMIT: callers of frontShellIndices/lowerLipInnerRim without skin keep the old y-only rule (out of this card's write roots):
// - tools/.../makeclothes/rim-seat-transfer.ts
// - tools/.../makeclothes/seat-teeth-on-lip-rim.ts
// - tools/.../makeclothes/tongue-th-morph.ts
// - packages/openclinxr/stations/mouth-executor/src/lip-rim.ts (own copy of the old rule)
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../../../..");
const SHIPPED = path.join(REPO, "apps/ui-xr/public/generated-humanoids");
const VISEMES = ["viseme_aa", "viseme_E", "viseme_I", "viseme_O", "viseme_U", "viseme_FF", "viseme_PP"];
const KNOWN_GOOD = [
  "mpfb-clinical-nurse-adult",
  "mpfb-clinical-physician-adult",
  "mpfb-family-partner-adult",
  "mpfb-gown-adult-patient",
  "mpfb-gown-ed-robert-hayes",
  "mpfb-peds-nurse-kevin",
  "mpfb-peds-patient-child",
  "mpfb-street-adult-male",
] as const;
const ALL_TEN = [...KNOWN_GOOD, "mpfb-ob-patient-aisha", "mpfb-peds-parent-aisha"] as const;

// mpfb-peds-parent-aisha is excluded from planning assertions: its shipped GLB
// carries 7 teeth targets but the shipped coupler refuses it (S0a), so its
// targets did not come from this coupler and are no known-good. CW2b still
// checks its shells are weight-pure.

// WHY (counterweight): the selection change must be a no-op wherever the old
// rule worked, so every planned delta must match the shipped morph target bit
// for bit on all 8 actors the shipped coupler plans. Object.is (not !==) so a
// -0/+0 sign flip counts as differing.
function differingFloats(planned: ArrayLike<number>, shipped: ArrayLike<number>): number {
  if (planned.length !== shipped.length) throw new Error(`length ${planned.length} vs ${shipped.length}`);
  let differing = 0;
  for (let i = 0; i < planned.length; i += 1) {
    if (!Object.is(planned[i] ?? 0, shipped[i] ?? 0)) differing += 1;
  }
  return differing;
}

// oldYOnlyShells lives in this test (not production) because it is the
// pre-fix rule kept only as a measurement reference: CW2a diffs the shipped
// selection against it, and PROBE a plants it back in memory. It is a copy
// of the old frontShellIndices (y rows, then the same x/z pick, no weights).
function oldYOnlyShells(positions: Float32Array): { upper: number[]; lower: number[] } {
  const count = positions.length / 3;
  const ys: number[] = [];
  for (let vertex = 0; vertex < count; vertex += 1) ys.push(positions[vertex * 3 + 1] ?? 0);
  const sorted = [...ys].sort((a, b) => a - b);
  const mid =
    sorted.length % 2 === 0
      ? ((sorted[sorted.length / 2 - 1] ?? 0) + (sorted[sorted.length / 2] ?? 0)) / 2
      : (sorted[Math.floor(sorted.length / 2)] ?? 0);
  const upperRow: number[] = [];
  const lowerRow: number[] = [];
  for (let vertex = 0; vertex < count; vertex += 1) {
    const y = ys[vertex] ?? 0;
    if (y > mid + CLEAR_BAND_M) upperRow.push(vertex);
    else if (y < mid - CLEAR_BAND_M) lowerRow.push(vertex);
  }
  const pick = (row: number[]): number[] => {
    let maxZ = -Infinity;
    for (const vertex of row) maxZ = Math.max(maxZ, positions[vertex * 3 + 2] ?? 0);
    return row.filter(
      (vertex) =>
        Math.abs(positions[vertex * 3] ?? 0) <= FRONT_SHELL_ABS_X_M &&
        (positions[vertex * 3 + 2] ?? 0) >= maxZ - FRONT_SHELL_Z_BAND_M,
    );
  };
  return { upper: pick(upperRow), lower: pick(lowerRow) };
}

type TeethSkinRead = {
  positions: Float32Array;
  joints: ArrayLike<number>;
  weights: ArrayLike<number>;
  jawIndex: number;
  headIndex: number;
};

async function readTeethSkin(glb: string): Promise<TeethSkinRead> {
  const doc = await new NodeIO().read(glb);
  const teeth = doc.getRoot().listMeshes().find((mesh) => /fitted_teeth/i.test(mesh.getName()));
  if (!teeth) throw new Error(`${glb}: no fitted teeth mesh`);
  const prim = teeth.listPrimitives()[0];
  if (!prim) throw new Error(`${glb}: no teeth primitive`);
  const positions = Float32Array.from(prim.getAttribute("POSITION")?.getArray() ?? []);
  const joints = prim.getAttribute("JOINTS_0")?.getArray();
  const weightArray = prim.getAttribute("WEIGHTS_0")?.getArray();
  if (!joints || !weightArray) throw new Error(`${glb}: teeth skin missing`);
  const skinJoints = doc.getRoot().listNodes().find((node) => node.getMesh() === teeth)?.getSkin()?.listJoints() ?? [];
  const jawIndex = skinJoints.findIndex((joint) => joint.getName() === "jaw");
  const headIndex = skinJoints.findIndex((joint) => joint.getName() === "head");
  if (jawIndex < 0 || headIndex < 0) throw new Error(`${glb}: teeth skin has no jaw/head joint`);
  return { positions, joints, weights: Float32Array.from(weightArray), jawIndex, headIndex };
}

// Scratch module copy under the test's own temp dir: vi.spyOn on the module
// namespace cannot intercept planTeethVisemeTargets' internal
// frontShellIndices call (same-module local binding, no production seam), so
// each probe copies the coupler source to a temp dir, applies a textual plant,
// and imports the copy. The temp dir sits under HERE so bare imports resolve
// via the repo node_modules. Returns before/after plant lines for the log.
async function loadPatchedCoupler(
  tag: string,
  replacements: [string, string][],
): Promise<{
  plan: typeof planTeethVisemeTargets;
  shells: typeof frontShellIndices;
  before: string[];
  after: string[];
  dir: string;
}> {
  const src = readFileSync(path.join(HERE, "couple-fitted-teeth-to-lip-viseme.ts"), "utf8");
  let patched = src;
  const before: string[] = [];
  const after: string[] = [];
  for (const [from, to] of replacements) {
    const occurrences = patched.split(from).length - 1;
    if (occurrences !== 1) throw new Error(`probe ${tag}: plant occurs ${occurrences}x (expected 1): ${from.slice(0, 80)}`);
    before.push(from);
    after.push(to);
    patched = patched.replace(from, to);
  }
  const dir = path.join(HERE, `.probe-tmp-${process.pid}-${tag}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `probe-${tag}-coupler.ts`);
  writeFileSync(file, patched);
  try {
    const mod = (await import(`${pathToFileURL(file).href}?t=${Date.now()}`)) as {
      planTeethVisemeTargets: typeof planTeethVisemeTargets;
      frontShellIndices: typeof frontShellIndices;
    };
    return { plan: mod.planTeethVisemeTargets, shells: mod.frontShellIndices, before, after, dir };
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}

describe("front shells follow the skin", () => {
  // D4: scratch-module cleanup is armed here, before any scratch copy is
  // written: every probe/tie temp dir under HERE is swept after each test, so
  // a mid-test throw cannot leave one behind (call-site try/finally stays).
  afterEach(() => {
    for (const entry of readdirSync(HERE)) {
      if (entry.startsWith(".probe-tmp-")) rmSync(path.join(HERE, entry), { recursive: true, force: true });
    }
  });

  it("plans all 7 teeth visemes for mpfb-ob-patient-aisha", async () => {
    const plan = await planTeethVisemeTargets(path.join(SHIPPED, "mpfb-ob-patient-aisha.glb"));
    expect(plan.targets.map((target) => target.name)).toEqual(VISEMES);
    expect(plan.targets.filter((target) => target.name === "viseme_aa")).toHaveLength(1);
    const kevin = await planTeethVisemeTargets(path.join(SHIPPED, "mpfb-peds-nurse-kevin.glb"));
    const maxAbs = (delta: Float32Array): number => {
      let max = 0;
      for (let i = 0; i < delta.length; i += 1) max = Math.max(max, Math.abs(delta[i] ?? 0));
      return max;
    };
    const kevinByName = new Map(kevin.targets.map((target) => [target.name, maxAbs(target.delta)]));
    for (const target of plan.targets) {
      process.stdout.write(
        `aisha ${target.name} max|delta|=${maxAbs(target.delta).toFixed(6)} kevin=${(kevinByName.get(target.name) ?? NaN).toFixed(6)}\n`,
      );
    }
  }, 120_000);

  it("CW1 guards shipped target bytes: plans bit-identical deltas to the shipped teeth morphs on all 8 coupled actors", async () => {
    const io = new NodeIO();
    const perActor: { actor: string; differing: number; floats: number }[] = [];
    for (const actor of KNOWN_GOOD) {
      const glb = path.join(SHIPPED, `${actor}.glb`);
      const plan = await planTeethVisemeTargets(glb);
      // D3: the planned target list must be exactly the 7 shipped names in
      // order before any delta is compared (a subset or zero targets would
      // otherwise pass the float loop vacuously).
      expect(plan.targets.map((target) => target.name)).toEqual(VISEMES);
      const doc = await io.read(glb);
      const teeth = doc.getRoot().listMeshes().find((mesh) => /fitted_teeth/i.test(mesh.getName()));
      if (!teeth) throw new Error(`${actor}: no fitted teeth mesh`);
      const names = (teeth.getExtras() as { targetNames?: string[] }).targetNames ?? [];
      const targets = teeth.listPrimitives()[0]!.listTargets();
      let differing = 0;
      let floats = 0;
      const perViseme: [string, number][] = [];
      for (const target of plan.targets) {
        const index = names.indexOf(target.name);
        if (index < 0) throw new Error(`${actor}: no teeth ${target.name}`);
        const shipped = targets[index]?.getAttribute("POSITION")?.getArray();
        if (!shipped) throw new Error(`${actor}: no POSITION for ${target.name}`);
        const count = differingFloats(target.delta, shipped);
        perViseme.push([target.name, count]);
        differing += count;
        floats += target.delta.length;
      }
      perActor.push({ actor, differing, floats });
      process.stdout.write(`${actor} differing=${differing} floats=${floats} ${JSON.stringify(perViseme)}\n`);
    }
    process.stdout.write(`known-good ${JSON.stringify(perActor)}\n`);
    expect(perActor.filter((row) => row.differing !== 0)).toEqual([]);
  }, 300_000);

  // WHY (selection no-op claim is about the SHELL SETS): CW1 guards shipped
  // target bytes but the planned deltas are shell-independent constants
  // (JAW_BY_VISEME/HEAD_MEAN over jawWeighted/headWeighted sets), so CW1
  // cannot see a shell change. CW3 asserts the sets directly.
  it("CW3: the skin-aware shells equal the old y-only shells on all 8 coupled actors", async () => {
    for (const actor of KNOWN_GOOD) {
      const skin = await readTeethSkin(path.join(SHIPPED, `${actor}.glb`));
      const fresh = frontShellIndices(skin.positions, {
        joints: skin.joints,
        weights: skin.weights,
        jawIndex: skin.jawIndex,
        headIndex: skin.headIndex,
      });
      const old = oldYOnlyShells(skin.positions);
      const sorted = (indices: number[]): number[] => [...indices].sort((a, b) => a - b);
      process.stdout.write(
        `${actor} upper old/new=${old.upper.length}/${fresh.upper.length} lower old/new=${old.lower.length}/${fresh.lower.length}\n`,
      );
      expect(sorted(fresh.upper)).toEqual(sorted(old.upper));
      expect(sorted(fresh.lower)).toEqual(sorted(old.lower));
    }
  }, 180_000);

  it("CW2a: every lower-shell vertex the new rule drops on Aisha is head-driven", async () => {
    const glb = path.join(SHIPPED, "mpfb-ob-patient-aisha.glb");
    const skin = await readTeethSkin(glb);
    const old = oldYOnlyShells(skin.positions);
    const fresh = frontShellIndices(skin.positions, {
      joints: skin.joints,
      weights: skin.weights,
      jawIndex: skin.jawIndex,
      headIndex: skin.headIndex,
    });
    expect(fresh.upper.length).toBe(34);
    expect(fresh.lower.length).toBe(228);
    process.stdout.write(`aisha old upper/lower=${old.upper.length}/${old.lower.length} new upper/lower=${fresh.upper.length}/${fresh.lower.length}\n`);
    const freshLower = new Set(fresh.lower);
    const excluded = old.lower.filter((vertex) => !freshLower.has(vertex)).sort((a, b) => a - b);
    const nonHead = excluded.filter(
      (vertex) => jawWeightSum(skin.joints, skin.weights, vertex, skin.headIndex) < JAW_WEIGHT_MIN,
    );
    process.stdout.write(`aisha excluded-from-lower count=${excluded.length} indices=${JSON.stringify(excluded)}\n`);
    expect(excluded.length).toBe(18);
    expect(nonHead).toEqual([]);
  }, 120_000);

  it("CW2b: every shell vertex is majority-weighted to its arch on all 10 actors", async () => {
    for (const actor of ALL_TEN) {
      const skin = await readTeethSkin(path.join(SHIPPED, `${actor}.glb`));
      const shells = frontShellIndices(skin.positions, {
        joints: skin.joints,
        weights: skin.weights,
        jawIndex: skin.jawIndex,
        headIndex: skin.headIndex,
      });
      const badLower = shells.lower.filter(
        (vertex) => jawWeightSum(skin.joints, skin.weights, vertex, skin.jawIndex) < JAW_WEIGHT_MIN,
      );
      const badUpper = shells.upper.filter(
        (vertex) => jawWeightSum(skin.joints, skin.weights, vertex, skin.headIndex) < JAW_WEIGHT_MIN,
      );
      process.stdout.write(
        `${actor} upper=${shells.upper.length} lower=${shells.lower.length} badUpper=${badUpper.length} badLower=${badLower.length}\n`,
      );
      expect(shells.upper.length).toBeGreaterThan(0);
      expect(shells.lower.length).toBeGreaterThan(0);
      expect(badUpper).toEqual([]);
      expect(badLower).toEqual([]);
    }
  }, 180_000);

  it("UNIT a-synth: an exact 50/50 tie in the front band belongs to neither shell", () => {
    // 3 upper (head), 3 lower (2 jaw + 1 tie), 3 mid-band; x=0 z=0.10 front.
    const ys = [0.02, 0.02, 0.02, -0.02, -0.02, -0.02, 0, 0, 0];
    const positions = new Float32Array(9 * 3);
    for (let vertex = 0; vertex < 9; vertex += 1) {
      positions[vertex * 3] = 0;
      positions[vertex * 3 + 1] = ys[vertex] ?? 0;
      positions[vertex * 3 + 2] = 0.1;
    }
    const jawIndex = 3;
    const headIndex = 7;
    const joints = new Uint16Array(9 * 4);
    const weights = new Float32Array(9 * 4);
    const setSkin = (vertex: number, joint: number, weight: number, joint2 = 0, weight2 = 0): void => {
      joints[vertex * 4] = joint;
      weights[vertex * 4] = weight;
      joints[vertex * 4 + 1] = joint2;
      weights[vertex * 4 + 1] = weight2;
    };
    for (const vertex of [0, 1, 2]) setSkin(vertex, headIndex, 1);
    for (const vertex of [3, 4]) setSkin(vertex, jawIndex, 1);
    setSkin(5, jawIndex, 0.5, headIndex, 0.5);
    for (const vertex of [6, 7, 8]) setSkin(vertex, jawIndex, 1);
    const shells = frontShellIndices(positions, { joints, weights, jawIndex, headIndex });
    process.stdout.write(`synth-tie upper=${JSON.stringify(shells.upper)} lower=${JSON.stringify(shells.lower)} ties=${shells.ties}\n`);
    expect(shells.ties).toBe(1);
    expect([...shells.upper].sort((a, b) => a - b)).toEqual([0, 1, 2]);
    expect([...shells.lower].sort((a, b) => a - b)).toEqual([3, 4]);
  });

  it("UNIT a-plan: a planted 50/50 tie on a coupled actor still plans 7 targets", async () => {
    const dir = path.join(HERE, `.probe-tmp-${process.pid}-tie`);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    try {
      const src = path.join(SHIPPED, "mpfb-peds-nurse-kevin.glb");
      const srcSkin = await readTeethSkin(src);
      const srcShells = frontShellIndices(srcSkin.positions, {
        joints: srcSkin.joints,
        weights: srcSkin.weights,
        jawIndex: srcSkin.jawIndex,
        headIndex: srcSkin.headIndex,
      });
      // Interior by z so the row max (and the upper shell) is untouched: the
      // lower shell must lose exactly this vertex.
      const byZ = [...srcShells.lower].sort(
        (a, b) => (srcSkin.positions[a * 3 + 2] ?? 0) - (srcSkin.positions[b * 3 + 2] ?? 0),
      );
      const tieVertex = byZ[Math.floor(byZ.length / 2)] ?? byZ[0] ?? 0;
      const doc = await new NodeIO().read(src);
      const teeth = doc.getRoot().listMeshes().find((mesh) => /fitted_teeth/i.test(mesh.getName()));
      const prim = teeth?.listPrimitives()[0];
      const jointsAttr = prim?.getAttribute("JOINTS_0");
      const weightsAttr = prim?.getAttribute("WEIGHTS_0");
      if (!jointsAttr || !weightsAttr) throw new Error("kevin teeth skin attributes missing");
      const joints = jointsAttr.getArray();
      const weights = weightsAttr.getArray();
      if (!joints || !weights) throw new Error("kevin teeth skin arrays missing");
      joints[tieVertex * 4] = srcSkin.jawIndex;
      joints[tieVertex * 4 + 1] = srcSkin.headIndex;
      joints[tieVertex * 4 + 2] = 0;
      joints[tieVertex * 4 + 3] = 0;
      weights[tieVertex * 4] = 0.5;
      weights[tieVertex * 4 + 1] = 0.5;
      weights[tieVertex * 4 + 2] = 0;
      weights[tieVertex * 4 + 3] = 0;
      const tempGlb = path.join(dir, "tie-kevin.glb");
      await new NodeIO().write(tempGlb, doc);
      // Prove the plant persisted (no vacuous pass): re-read weights + shells.
      const tempSkin = await readTeethSkin(tempGlb);
      expect(jawWeightSum(tempSkin.joints, tempSkin.weights, tieVertex, tempSkin.jawIndex)).toBe(0.5);
      expect(jawWeightSum(tempSkin.joints, tempSkin.weights, tieVertex, tempSkin.headIndex)).toBe(0.5);
      const tempShells = frontShellIndices(tempSkin.positions, {
        joints: tempSkin.joints,
        weights: tempSkin.weights,
        jawIndex: tempSkin.jawIndex,
        headIndex: tempSkin.headIndex,
      });
      expect(tempShells.upper).not.toContain(tieVertex);
      expect(tempShells.lower).not.toContain(tieVertex);
      const plan = await planTeethVisemeTargets(tempGlb);
      process.stdout.write(
        `tie-plan vertex=${tieVertex} upper=${plan.upperCount} lower=${plan.lowerCount} targets=${plan.targets.length}\n`,
      );
      expect(plan.targets.map((target) => target.name)).toEqual(VISEMES);
      expect(plan.upperCount).toBe(srcShells.upper.length);
      expect(plan.lowerCount).toBe(srcShells.lower.length - 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);

  it("UNIT b: the measure-path skin is null when a joint name is missing", () => {
    const joints = new Uint16Array([3, 7, 0, 0]);
    const weights = new Float32Array([1, 0, 0, 0]);
    expect(teethSkinOrNull(joints, weights, -1, 7)).toBeNull();
    expect(teethSkinOrNull(joints, weights, 3, -1)).toBeNull();
    const skin = teethSkinOrNull(joints, weights, 3, 7);
    if (!skin) throw new Error("expected a skin when both joints are found");
    expect(skin.jawIndex).toBe(3);
    expect(skin.headIndex).toBe(7);
    expect(jawWeightSum(skin.joints, skin.weights, 0, skin.jawIndex)).toBe(1);
  });

  it("PROBE a: the old y-only selection planted in memory is rejected by the shell guard", async () => {
    const oldCall = `const shells = frontShellIndices(pose.teethPos, {
    joints: pose.teethJoints,
    weights: pose.teethWeights,
    jawIndex,
    headIndex,
  });`;
    const { plan, before, after, dir } = await loadPatchedCoupler("a", [[oldCall, "const shells = frontShellIndices(pose.teethPos);"]]);
    try {
      process.stdout.write(`plant before: ${JSON.stringify(before)}\nplant after: ${JSON.stringify(after)}\n`);
      await expect(plan(path.join(SHIPPED, "mpfb-ob-patient-aisha.glb"))).rejects.toThrow(
        "lower front shell is not entirely jaw-weighted",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);

  it("PROBE b: a broader no-y rule is flagged on at least one coupled actor", async () => {
    const oldFilter = `  let ties = 0;
  if (skin) {
    const jawSum = (vertex: number): number => jawWeightSum(skin.joints, skin.weights, vertex, skin.jawIndex);
    const headSum = (vertex: number): number => jawWeightSum(skin.joints, skin.weights, vertex, skin.headIndex);
    for (const vertex of [...upperRow, ...lowerRow]) {
      if (jawSum(vertex) >= JAW_WEIGHT_MIN && headSum(vertex) >= JAW_WEIGHT_MIN) ties += 1;
    }
    upperRow = upperRow.filter(
      (vertex) => headSum(vertex) >= JAW_WEIGHT_MIN && jawSum(vertex) < JAW_WEIGHT_MIN,
    );
    lowerRow = lowerRow.filter(
      (vertex) => jawSum(vertex) >= JAW_WEIGHT_MIN && headSum(vertex) < JAW_WEIGHT_MIN,
    );
  }`;
    const broadFilter = `  let ties = 0;
  if (skin) {
    // PROBE B plant: front band AND weight split, no y rule.
    let probeMaxZ = -Infinity;
    for (let vertex = 0; vertex < count; vertex += 1) probeMaxZ = Math.max(probeMaxZ, positions[vertex * 3 + 2] ?? 0);
    const probeBand: number[] = [];
    for (let vertex = 0; vertex < count; vertex += 1) {
      if (Math.abs(positions[vertex * 3] ?? 0) <= FRONT_SHELL_ABS_X_M && (positions[vertex * 3 + 2] ?? 0) >= probeMaxZ - FRONT_SHELL_Z_BAND_M) probeBand.push(vertex);
    }
    upperRow = probeBand.filter(
      (vertex) => jawWeightSum(skin.joints, skin.weights, vertex, skin.headIndex) >= JAW_WEIGHT_MIN,
    );
    lowerRow = probeBand.filter(
      (vertex) => jawWeightSum(skin.joints, skin.weights, vertex, skin.jawIndex) >= JAW_WEIGHT_MIN,
    );
  }`;
    const { plan, shells: probeShells, before, after, dir } = await loadPatchedCoupler("b", [[oldFilter, broadFilter]]);
    try {
      process.stdout.write(`plant before: ${JSON.stringify(before)}\nplant after: ${JSON.stringify(after)}\n`);
      const io = new NodeIO();
      const flagged: { actor: string; outcome: string }[] = [];
      const shellFlagged: { actor: string; upperAdded: number; upperRemoved: number; lowerAdded: number; lowerRemoved: number }[] = [];
      for (const actor of KNOWN_GOOD) {
        const glb = path.join(SHIPPED, `${actor}.glb`);
        // CW3-style shell check against the broad no-y rule: the plant must
        // move shell membership on at least the actors CW3 would flag.
        const skin = await readTeethSkin(glb);
        const probeShell = probeShells(skin.positions, {
          joints: skin.joints,
          weights: skin.weights,
          jawIndex: skin.jawIndex,
          headIndex: skin.headIndex,
        });
        const old = oldYOnlyShells(skin.positions);
        const diffSet = (planted: number[], baseline: number[]): { added: number; removed: number } => {
          const plantedSet = new Set(planted);
          const baselineSet = new Set(baseline);
          return {
            added: planted.filter((vertex) => !baselineSet.has(vertex)).length,
            removed: baseline.filter((vertex) => !plantedSet.has(vertex)).length,
          };
        };
        const upperDiff = diffSet(probeShell.upper, old.upper);
        const lowerDiff = diffSet(probeShell.lower, old.lower);
        process.stdout.write(
          `${actor} probe-b shells upper old/new=${old.upper.length}/${probeShell.upper.length} (+${upperDiff.added}/-${upperDiff.removed}) lower old/new=${old.lower.length}/${probeShell.lower.length} (+${lowerDiff.added}/-${lowerDiff.removed})\n`,
        );
        if (upperDiff.added + upperDiff.removed + lowerDiff.added + lowerDiff.removed > 0) {
          shellFlagged.push({
            actor,
            upperAdded: upperDiff.added,
            upperRemoved: upperDiff.removed,
            lowerAdded: lowerDiff.added,
            lowerRemoved: lowerDiff.removed,
          });
        }
        try {
          const planned = await plan(glb);
          const doc = await io.read(glb);
          const teeth = doc.getRoot().listMeshes().find((mesh) => /fitted_teeth/i.test(mesh.getName()));
          const names = (teeth!.getExtras() as { targetNames?: string[] }).targetNames ?? [];
          const targets = teeth!.listPrimitives()[0]!.listTargets();
          let differing = 0;
          for (const target of planned.targets) {
            const shipped = targets[names.indexOf(target.name)]?.getAttribute("POSITION")?.getArray();
            if (!shipped) throw new Error(`${actor}: no POSITION for ${target.name}`);
            differing += differingFloats(target.delta, shipped);
          }
          process.stdout.write(`${actor} probe-b differing=${differing}\n`);
          if (differing !== 0) flagged.push({ actor, outcome: `${differing} differing floats` });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          process.stdout.write(`${actor} probe-b rejected: ${message}\n`);
          flagged.push({ actor, outcome: `rejected: ${message}` });
        }
      }
      process.stdout.write(`probe-b flagged ${JSON.stringify(flagged)}\n`);
      process.stdout.write(`probe-b shell-flagged ${JSON.stringify(shellFlagged)}\n`);
      expect(flagged.length).toBeGreaterThan(0);
      expect(shellFlagged.length).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 300_000);
});
