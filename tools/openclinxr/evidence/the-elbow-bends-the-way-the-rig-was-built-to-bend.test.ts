import { describe, expect, it } from "vitest";
import { NodeIO } from "@gltf-transform/core";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { mpfbForearmIdleEuler } from "../../../apps/ui-xr/src/clinical-idle-posture.js";

/*
 * ## FIXED (#0): the runtime now applies bind-relative forearm flexion on the MPFB2 rail.
 * The idle bend is `MPFB_IDLE_FORELARM_BEND_FRACTION` (0.6) of the bone's own bind bend
 * about local X, so `appliedForearm` below now derives from each bind row via the exported
 * `mpfbForearmIdleEuler` instead of the Anny absolute map (which the fix retired for MPFB).
 * `clinical-idle-posture.ts` adds `MPFB_CLINICAL_IDLE_ARM_HANG` (upper arm / hand / head from
 * the Anny set, NO forearm entries) and `applyGeneratedHumanoidClinicalIdlePosture` applies
 * `mpfbForearmIdleEuler` per bone from the pristine bind captured at the load-time call.
 * Clauses (1) and (2) flipped from `it.fails`; (3)-(5) counterweights unchanged.
 */


/**
 * OBSERVABLE: the operator, looking at the oncology capture on 2026-08-25, said the figure's arms
 * appear backwards. Measured rather than guessed, and this is what the numbers say.
 *
 * MECHANISM (verified in code, #642):
 *   - `clinical-idle-posture.ts` carries THREE calibrated euler sets — Anny (the fallback),
 *     LIBRARY (hm08, #219, flipped Z), MIXAMO (#307, swings on local X).
 *   - The library tag is set at `main.ts:6965` ONLY for `/body-param-.*-library\.glb/i`, and the
 *     mixamo branch needs a `mixamorig:` bone prefix. Shipped MPFB2 actors are `mpfb-*.glb` with
 *     bones `upperarm01.L / lowerarm01.L / wrist.L`, so they match NEITHER and take the Anny set.
 *   - `resolveRotationMap` (`pose-bone-runtime.ts:69`) remaps bone NAMES only; the rotation VALUE
 *     passes through untouched, and every entry is `absolute: true`, so `applyBoneEuler` REPLACES
 *     the bind rotation rather than composing with it.
 *
 * THE DEFECT, MEASURED — do not re-derive this. MPFB2 ships an A-pose bind with the elbow already
 * flexed. `lowerarm01.L` bind on `mpfb-clinical-nurse-adult` is `(0.359,-0.011,-0.008,0.933)`, a
 * +42 deg bend about local X. The Anny map sets that bone to `x = -0.18` (~-10 deg). The orientation
 * delta is 54.8 deg about axis `[-0.96, 0.03, 0.28]` — almost pure X, the flexion axis itself. The
 * elbow is posed roughly 55 deg opposite to the direction the rig bends.
 *
 * AND THE POPULATION IS NOT UNIFORM, which is the half I got wrong first and a peer round corrected:
 * I sampled two actors, found identical binds, and inferred one constant would do. Measured across
 * the shipped set there are SIX distinct `lowerarm01.L` binds among 11 MPFB-rigged GLBs. So a fourth
 * ABSOLUTE euler table would erase per-actor differences exactly as the Anny one does; the fix has
 * to be bind-relative. Clause (5) pins that population fact so the cheap fix cannot look correct.
 *
 * WHY TWO GREEN CONTRACTS MISSED IT: `idle-arm-hang` bounds wrist DROP, `arm-abduction-ceiling`
 * bounds wrist LATERAL. An arm reversed about its own flexion axis has identical drop and identical
 * lateral, so both pass by construction — the quantity-versus-shape failure in
 * PROTO_VERIFY_DELEGATION section 11s. This contract bounds the SIGN of the bend, which is the shape.
 *
 * claimScope: that the forearm rotation the runtime applies bends the elbow in the same direction the
 *   rig's own bind pose bends it, for every distinct shipped MPFB bind.
 * notEvidenceFor: whether the resulting arm looks natural (that is a pixel grade), the upper-arm or
 *   wrist rotations, the Anny / hm08 / mixamo rails, or any non-MPFB actor.
 */

const REPO = join(import.meta.dirname, "../../..");
const HUMANOIDS = join(REPO, "apps/ui-xr/public/generated-humanoids");

type Q = { x: number; y: number; z: number; w: number };

/**
 * Signed rotation about local X — the MPFB2 elbow's flexion axis, established by the bind pose
 * itself being X-dominant (0.359 on x against 0.011/0.008 on y/z). Not a chosen axis: the bind's own
 * dominant component picks it, and clause (4) refuses a bind that is too straight to pick one.
 */
const signedBendAboutX = (q: Q): number => 2 * Math.atan2(q.x, q.w);

const fromEulerXYZ = (x: number, y: number, z: number): Q => {
  const c1 = Math.cos(x / 2), c2 = Math.cos(y / 2), c3 = Math.cos(z / 2);
  const s1 = Math.sin(x / 2), s2 = Math.sin(y / 2), s3 = Math.sin(z / 2);
  return {
    x: s1 * c2 * c3 + c1 * s2 * s3,
    y: c1 * s2 * c3 - s1 * c2 * s3,
    z: c1 * c2 * s3 + s1 * s2 * c3,
    w: c1 * c2 * c3 - s1 * s2 * s3,
  };
};

type BindRow = { asset: string; bone: string; bind: Q };

let cached: BindRow[] | null = null;
async function mpfbForearmBinds(): Promise<BindRow[]> {
  if (cached) return cached;
  const io = new NodeIO();
  const rows: BindRow[] = [];
  for (const file of readdirSync(HUMANOIDS).filter((n) => n.endsWith(".glb"))) {
    let doc;
    try { doc = await io.read(join(HUMANOIDS, file)); } catch { continue; }
    for (const node of doc.getRoot().listNodes()) {
      const bone = node.getName().replaceAll(".", "");
      if (bone !== "lowerarm01L" && bone !== "lowerarm01R") continue;
      const r = node.getRotation() as unknown as number[];
      rows.push({ asset: file.replace(/\.glb$/, ""), bone, bind: { x: r[0]!, y: r[1]!, z: r[2]!, w: r[3]! } });
    }
  }
  cached = rows;
  return rows;
}

/** What the runtime applies to an MPFB2 forearm: the bind-relative idle euler (#0). */
const appliedForearm = (r: BindRow): Q => {
  const e = mpfbForearmIdleEuler(r.bind);
  return fromEulerXYZ(e.x ?? 0, e.y ?? 0, e.z ?? 0);
};

describe("the elbow bends the way the rig was built to bend", () => {
  it("(1) every shipped MPFB forearm is posed in the SAME direction its bind pose bends", async () => {
    const rows = await mpfbForearmBinds();
    expect(rows.length, "no MPFB forearm bones were found — the fixture proves nothing").toBeGreaterThan(0);

    const reversed = rows
      .map((r) => ({ r, bindBend: signedBendAboutX(r.bind), liveBend: signedBendAboutX(appliedForearm(r)) }))
      .filter((m) => Math.sign(m.bindBend) !== Math.sign(m.liveBend))
      .map((m) => `${m.r.asset}/${m.r.bone}: bind ${(m.bindBend * 180 / Math.PI).toFixed(1)}deg `
        + `-> posed ${(m.liveBend * 180 / Math.PI).toFixed(1)}deg`);

    expect(reversed, `elbows posed against their own bind bend:\n${reversed.join("\n")}`).toEqual([]);
  });

  it("(2) the posed elbow keeps a real bend, not a straight stick", async () => {
    // DEAD ZONE. Stops the sign clause being bought by flattening the arm to ~0, which has no sign
    // to be wrong. The floor is the smallest bend in the shipped BIND population, halved — sourced
    // from the rigs themselves, never from the post-fix numbers.
    const rows = await mpfbForearmBinds();
    const minBindBend = Math.min(...rows.map((r) => Math.abs(signedBendAboutX(r.bind))));
    const floor = minBindBend / 2;
    expect(floor, "the bind population must supply a real floor").toBeGreaterThan(0.05);

    const straight = rows
      .filter((r) => Math.abs(signedBendAboutX(appliedForearm(r))) < floor)
      .map((r) => `${r.asset}/${r.bone}`);
    expect(straight, `elbows posed flatter than half the smallest shipped bind bend:\n${straight.join("\n")}`)
      .toEqual([]);
  });

  it("(3) COUNTERWEIGHT: a deliberately reversed forearm FAILS the sign test", async () => {
    // Refuses a clause that cannot fail. Reverse only the bend, leave everything else alone.
    const rows = await mpfbForearmBinds();
    const sample = rows[0]!;
    const flipped: Q = { x: -sample.bind.x, y: sample.bind.y, z: sample.bind.z, w: sample.bind.w };
    expect(Math.sign(signedBendAboutX(flipped)), "a reversed forearm must read as reversed")
      .not.toBe(Math.sign(signedBendAboutX(sample.bind)));
  });

  it("(4) COUNTERWEIGHT: the bind reference is not too straight to define a direction", async () => {
    // A near-zero bind bend has no meaningful sign, so clause (1) would be noise. Every shipped MPFB
    // bind must carry a real bend for the reference to mean anything.
    const rows = await mpfbForearmBinds();
    const tooStraight = rows
      .filter((r) => Math.abs(signedBendAboutX(r.bind)) < 0.10)
      .map((r) => `${r.asset}/${r.bone} = ${(signedBendAboutX(r.bind) * 180 / Math.PI).toFixed(1)}deg`);
    expect(tooStraight, `bind bends too small to define a direction:\n${tooStraight.join("\n")}`).toEqual([]);
  });

  it("(5) VACUITY GUARD: the shipped binds are NOT uniform, so one constant cannot serve them", async () => {
    // The fact that makes a bind-RELATIVE fix necessary rather than a fourth absolute table. I first
    // sampled two actors, found them identical, and inferred a constant would do; a peer round
    // measured the population and refuted it. This clause keeps that refutation enforced.
    const rows = await mpfbForearmBinds();
    const distinct = new Set(rows.map((r) => `${r.bind.x.toFixed(3)},${r.bind.y.toFixed(3)},${r.bind.z.toFixed(3)},${r.bind.w.toFixed(3)}`));
    expect(distinct.size, "if every shipped bind were identical, an absolute table would be defensible")
      .toBeGreaterThan(1);
  });
});
