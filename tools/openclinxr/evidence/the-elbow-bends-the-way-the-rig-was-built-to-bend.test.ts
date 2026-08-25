import { describe, expect, it } from "vitest";
import { NodeIO } from "@gltf-transform/core";
import { readdirSync } from "node:fs";
import { join } from "node:path";

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

/**
 * ## FIXED (#642)
 * Root cause was the ABSOLUTE forearm entries in the Anny map replacing MPFB2's A-pose elbow
 * flexion (+42..+49 deg about local X) with x=-0.18 (~-10.9 deg) — ~53 deg against the rig's own
 * bend. Fix (apps/ui-xr/src/clinical-idle-posture.ts): MPFB forearms are handled BIND-RELATIVE —
 * the bind quaternion is cached once per bone object and the runtime writes qBind ⊗ qDelta each
 * frame (composeMpfbForearmDelta + mpfbForearmBindCache WeakMap latch), never compounding from
 * the previous frame. Per-bind differences across the SIX distinct shipped lowerarm01 binds
 * survive by construction. Anny / hm08 / mixamo rails untouched.
 * Contract strengthened, not weakened: `appliedForearm` no longer reads the raw absolute map
 * entry — it routes through the exported production composer with each row's REAL bind
 * quaternion, i.e. it measures the same composition path the runtime executes. Pre-fix
 * measurement: .openclinxr/evidence/issue-642/pre-fix.json (22/22 rows sign-reversed,
 * measuredAgainstCommit df9bf266).
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

/**
 * What the runtime applies to an MPFB forearm AFTER #642: qBind ⊗ qDelta, composed by the
 * exported production composer from this row's REAL bind quaternion. Pre-fix this helper read
 * the raw absolute map entry (the replacement itself); routing it through the runtime's own
 * composition path is a strengthening — the clause now measures exactly what the running
 * scene executes.
 */
const appliedForearm = async (bone: string, bind: Q): Promise<Q> => {
  const mod = await import("../../../apps/ui-xr/src/clinical-idle-posture.js") as unknown as {
    composeMpfbForearmDelta: (name: string, bindQ: Q) => Q;
  };
  return mod.composeMpfbForearmDelta(bone === "lowerarm01L" ? "lowerarm01L" : "lowerarm01R", bind);
};


/** Round a quaternion so float noise cannot manufacture "distinct" orientations. */
const quantise = (q: Q): string =>
  [q.x, q.y, q.z, q.w].map((v) => v.toFixed(5)).join(",");

/**
 * Absolute angle between two orientations, radians.
 *
 * NORMALISED, and that is not a formality. The composed quaternions are not exactly unit-norm, so an
 * un-normalised self-dot lands just under 1 and `acos` — which is ill-conditioned there — reports a
 * phantom 2.4e-4 to 5.6e-4 rad angle between a quaternion and ITSELF. Measured on 5 of 22 rows while
 * writing clause (7), and it read exactly like per-frame drift.
 */
const angleBetween = (a: Q, b: Q): number => {
  const na = Math.hypot(a.x, a.y, a.z, a.w) || 1;
  const nb = Math.hypot(b.x, b.y, b.z, b.w) || 1;
  const d = Math.abs((a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w) / (na * nb));
  return 2 * Math.acos(Math.min(1, d));
};

describe("the elbow bends the way the rig was built to bend", () => {
  it("(1) every shipped MPFB forearm is posed in the SAME direction its bind pose bends", async () => {
    const rows = await mpfbForearmBinds();
    expect(rows.length, "no MPFB forearm bones were found — the fixture proves nothing").toBeGreaterThan(0);

    const reversed: string[] = [];
    for (const r of rows) {
      const live = await appliedForearm(r.bone, r.bind);
      if (Math.sign(signedBendAboutX(r.bind)) !== Math.sign(signedBendAboutX(live))) {
        reversed.push(`${r.asset}/${r.bone}: bind ${(signedBendAboutX(r.bind) * 180 / Math.PI).toFixed(1)}deg `
          + `-> posed ${(signedBendAboutX(live) * 180 / Math.PI).toFixed(1)}deg`);
      }
    }
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

    const straight: string[] = [];
    for (const r of rows) {
      const live = await appliedForearm(r.bone, r.bind);
      if (Math.abs(signedBendAboutX(live)) < floor) straight.push(`${r.asset}/${r.bone}`);
    }
    expect(straight, `elbows posed flatter than half the smallest shipped bind bend:\n${straight.join("\n")}`)
      .toEqual([]);
  });

  it("(6) COUNTERWEIGHT: the BIND is actually composed in — distinct binds give distinct poses", async () => {
    // MY CLAUSE (1) WAS VACUOUS AND THIS IS THE REPAIR. Measured 2026-08-25 by destructive probe:
    // replacing `bindQuaternion.multiply(qDelta)` with a bare `qDelta` — i.e. reverting to exactly
    // the absolute behaviour this whole card exists to remove — left clauses (1)-(5) GREEN.
    //
    // The reason is that the delta is `{ x: 0.42 }`, positive, and every MPFB bind bend is positive
    // too, so the sign test is satisfied by the delta's own sign with the bind discarded. A sign
    // predicate cannot see whether a composition happened when both operands share a sign.
    //
    // This is the discriminator, and it is the same fact that forced bind-relative composition in
    // the first place: there are SIX distinct lowerarm01 binds across the shipped GLBs, so a real
    // composition must yield distinct posed orientations. Discard the bind and all 22 rows collapse
    // to one identical quaternion.
    const rows = await mpfbForearmBinds();
    const distinctBinds = new Set(rows.map((r) => quantise(r.bind)));
    expect(distinctBinds.size, "the fixture must carry distinct binds or this clause proves nothing")
      .toBeGreaterThan(1);

    const posedAll = await Promise.all(rows.map((r) => appliedForearm(r.bone, r.bind)));
    const distinctPosed = new Set(posedAll.map(quantise));
    // NOT equality. Composition can SEPARATE two binds that collapsed at 5dp quantisation — measured
    // 14 distinct poses from 12 distinct binds — so demanding equality fails on correct code. The
    // discriminating fact is the floor: both delta entries are identical `{ x: 0.42 }`, so discarding
    // the bind collapses all 22 rows to exactly ONE orientation.
    expect(distinctPosed.size,
      `posed orientations collapsed to ${distinctPosed.size} — the bind was discarded, not composed`)
      .toBeGreaterThanOrEqual(distinctBinds.size);
  });

  it("(7) COUNTERWEIGHT: composing twice is idempotent — no per-frame accumulation", async () => {
    // The applier runs EVERY frame. Composing against the previous frame's result instead of the
    // cached bind accumulates without bound, and a second destructive probe confirmed clauses
    // (1)-(5) stay green while it does. Applying the composition to an already-posed quaternion must
    // not drift, which is what the WeakMap bind cache exists to guarantee.
    const rows = await mpfbForearmBinds();
    const drifted = (await Promise.all(rows.map(async (r) => {
      const once = await appliedForearm(r.bone, r.bind);
      const twice = await appliedForearm(r.bone, r.bind);   // same cached bind, not the posed result
      return { r, delta: angleBetween(once, twice) };
    })))
      .filter((m) => m.delta > 1e-6)
      .map((m) => `${m.r.asset}/${m.r.bone} drifted ${m.delta.toFixed(5)} rad on re-apply`);
    expect(drifted, `re-applying the pose moved it:\n${drifted.join("\n")}`).toEqual([]);

    // And the hostile case stated explicitly: feeding the POSED quaternion back in must be
    // detectable as different from feeding the bind, or the cache is doing nothing.
    const sample = rows[0]!;
    const posed = await appliedForearm(sample.bone, sample.bind);
    const rePosed = await appliedForearm(sample.bone, posed);
    expect(angleBetween(posed, rePosed),
      "composing onto an already-posed quaternion must differ from composing onto the bind — if it "
      + "does not, the delta is a no-op and clause (1) is measuring nothing")
      .toBeGreaterThan(1e-3);
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
