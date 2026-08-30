import { describe, expect, it } from "vitest";

import { planted } from "./planted.js";
import {
  GUARD_MOTION_REGIONS,
  MOTION_REGION_GUARD_CHEST_L,
  MOTION_REGION_GUARD_CHEST_R,
  MOTION_REGION_GUARD_RLQ,
  REGION_ANCHOR_SPACE,
} from "./plant-motion-regions.js";

/**
 * **OBSERVABLE: M2 consumes `SkeletonProfile.regionAnchors` and nothing produces them.**
 *
 * Card tsk_e5b1a3efad002aef. Found by two reviewers in sequence on 2026-08-30: the first said a
 * bind-pose point is not a body region and needs a named owner; the second said the owner is
 * UPSTREAM of M2, not a later contact-surfaces successor, because M2 is the consumer.
 *
 * ## MEASURED ON HEAD — do not re-derive. This block is IMMUTABLE.
 *
 * At 8d7f045a, every `regionAnchors` value in the tree is computed by one fixture helper:
 *
 *     armProfile(): anchor(dx, dy, dz) = shoulder + (dx, dy, dz) * (upperArmLen + forearmLen)
 *
 * Three rig families, five regions each, all from that expression. M1b (tsk_9f1009a2642f18bf)
 * derives bind transforms from real rig assets and will NOT produce anchors — bind transforms are
 * joint placements, and an anchor is a point on the body a hand must arrive at.
 *
 * Without a producer between M1b and M2, the M2 worker has three options and all three are bad:
 * invent anchors, keep the constructed fixtures and call three-rig support proven, or derive them
 * through an API nobody owns. The middle one is the failure M2's own header already warns about.
 *
 * ## WHAT IS ALREADY DECIDED, so this card does not re-litigate it
 *
 * The SPACE is `bind_world_metres` — the same space as `bindFrame`, the space the FK oracle
 * accumulates into. Profiles carry `regionAnchorSpace` beside the anchors so a consumer can refuse a
 * frame it does not implement, and M2 does. This card must honour that, not choose it.
 *
 * ## NOT TESTED, deliberately
 *
 * Surface normals, closest-point behaviour, penetration depth and orientation tolerance — those are
 * tsk_67cafb96802a06bc, and they are what a SURFACE adds on top of a point. Solving, retargeting,
 * baking. And the open question this card must answer rather than assume: whether a production
 * `SkeletonProfile` read from a shipped GLB can carry anchors at all, or whether they belong on a
 * separate mesh-derived record that references the profile.
 */

const PRODUCER_MODULE = "./region-anchors.js";

/** Resolve to an ABSOLUTE url so an absent module reports its real path, not a mangled one. */
function plantModule(specifier: string): string {
  return new URL(specifier, import.meta.url).href;
}

type Vec3 = { x: number; y: number; z: number };

type FkJoint = {
  boneName: string;
  parentBoneName?: string;
  bindLocalPosition: Vec3;
  bindLocalQuaternion: { x: number; y: number; z: number; w: number };
};

/** What M1b is expected to produce: joints and bind frame, and NO anchors. */
type RigAsset = {
  rigFingerprint: string;
  effectorBone: string;
  joints: readonly FkJoint[];
  bindFrame: Readonly<Record<string, Vec3>>;
  /** Body extent in bind world metres, which is what a real asset can supply and a joint cannot. */
  bodyExtent: { minY: number; maxY: number; halfWidth: number; halfDepth: number };
};

/**
 * PROFILE OUT, NOT MAP OUT — and that is the whole join.
 *
 * The first draft returned `{ regionAnchorSpace, regionAnchors }`. Both plants would then have
 * landed green with NOTHING requiring the compile path to call this: M2 compiles a
 * `SkeletonProfile` that already has anchors, so two workers could finish both cards and leave the
 * fixture helper as the only source of the numbers the guard actually sees. Same class as a second
 * compile entry, one step later. Found on the fourth review pass, before either card was dispatched.
 *
 * So the producer emits the PROFILE the compile path consumes. There is no separate assembly step
 * where a fixture can slip back in, and clause (6) checks the rig half is the asset's own.
 */
type ProducedProfile = {
  rigFingerprint: string;
  effectorBone: string;
  joints: readonly FkJoint[];
  bindFrame: Readonly<Record<string, Vec3>>;
  regionAnchorSpace: string;
  regionAnchors: Readonly<Record<string, Vec3>>;
};

type ProducerModule = {
  deriveSkeletonProfile?: (asset: RigAsset, regions: readonly string[]) => ProducedProfile;
};

async function loadProducer(): Promise<ProducerModule | undefined> {
  try {
    return (await import(/* @vite-ignore */ plantModule(PRODUCER_MODULE))) as ProducerModule;
  } catch {
    return undefined;
  }
}

const IDENTITY = { x: 0, y: 0, z: 0, w: 1 };

/**
 * Two assets of DIFFERENT SIZE, same topology. Size is the whole point: an anchor derived from the
 * asset must move with it, and a hardcoded table cannot do that.
 */
function rigAsset(rigFingerprint: string, scale: number): RigAsset {
  const shoulder: Vec3 = { x: 0.18 * scale, y: 1.38 * scale, z: 0 };
  const elbow: Vec3 = { x: shoulder.x, y: shoulder.y - 0.28 * scale, z: 0 };
  const wrist: Vec3 = { x: elbow.x, y: elbow.y - 0.26 * scale, z: 0 };
  const joints: FkJoint[] = [
    { boneName: "spine", bindLocalPosition: { x: 0, y: 1.05 * scale, z: 0 }, bindLocalQuaternion: IDENTITY },
    { boneName: "chest", parentBoneName: "spine", bindLocalPosition: { x: 0, y: 0.23 * scale, z: 0 }, bindLocalQuaternion: IDENTITY },
    { boneName: "upper_armR", parentBoneName: "chest", bindLocalPosition: { x: 0.18 * scale, y: 0.10 * scale, z: 0 }, bindLocalQuaternion: IDENTITY },
    { boneName: "forearmR", parentBoneName: "upper_armR", bindLocalPosition: { x: 0, y: -0.28 * scale, z: 0 }, bindLocalQuaternion: IDENTITY },
    { boneName: "handR", parentBoneName: "forearmR", bindLocalPosition: { x: 0, y: -0.26 * scale, z: 0 }, bindLocalQuaternion: IDENTITY },
  ];
  return {
    rigFingerprint,
    effectorBone: "handR",
    joints,
    bindFrame: {
      spine: { x: 0, y: 1.05 * scale, z: 0 },
      chest: { x: 0, y: 1.28 * scale, z: 0 },
      upper_armR: shoulder,
      forearmR: elbow,
      handR: wrist,
    },
    bodyExtent: { minY: 0, maxY: 1.72 * scale, halfWidth: 0.22 * scale, halfDepth: 0.14 * scale },
  };
}

const ADULT = rigAsset("asset_adult", 1.0);
const CHILD = rigAsset("asset_child", 0.72);

function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/**
 * The SHOULDER, which is what the arm rotates about — corrected 2026-08-30 while probing.
 *
 * Clause (2) first measured reach from the bind HAND position and refused a contralateral chest
 * anchor 0.581 m away against 0.540 m of arm. That bound is wrong kinematically: the hand does not
 * travel from where it hangs, it swings about the shoulder, and every cross-body target would have
 * been rejected as unreachable. The honest satisfiability probe caught it — an evasion probe never
 * would have, because a cheating implementation is not trying to reach anything.
 */
function shoulderOf(asset: RigAsset): Vec3 {
  return asset.bindFrame["upper_armR"]!;
}

/** Arm reach on this asset, used as an INPUT-referenced bound rather than a fraction of any output. */
function armReach(asset: RigAsset): number {
  return (
    distance(asset.bindFrame["upper_armR"]!, asset.bindFrame["forearmR"]!) +
    distance(asset.bindFrame["forearmR"]!, asset.bindFrame["handR"]!)
  );
}

describe("the region anchors come from a real asset", () => {
  planted("(1) RED: anchors are DERIVED FROM THE ASSET — two sizes give two answers", async () => {
    // The whole point. A hardcoded table keyed by region id is the per-region pose table this factory
    // exists to remove, and it satisfies every presence check ever written.
    const producer = await loadProducer();
    expect(
      typeof producer?.deriveSkeletonProfile,
      `${PRODUCER_MODULE} must export deriveSkeletonProfile — nothing produces regionAnchors today`,
    ).toBe("function");
    const derive = producer!.deriveSkeletonProfile!;

    const adult = derive(ADULT, GUARD_MOTION_REGIONS);
    const child = derive(CHILD, GUARD_MOTION_REGIONS);

    expect(adult.regionAnchorSpace, "the producer must declare the space it emits").toBe(REGION_ANCHOR_SPACE);
    expect(child.regionAnchorSpace).toBe(REGION_ANCHOR_SPACE);

    for (const region of GUARD_MOTION_REGIONS) {
      const a = adult.regionAnchors[region];
      const c = child.regionAnchors[region];
      expect(a, `no anchor derived for ${region} on the adult asset`).toBeDefined();
      expect(c, `no anchor derived for ${region} on the child asset`).toBeDefined();
      // The child is 72% of the adult, so an anchor that tracks the body cannot land in one place.
      // Floor referenced to the SIZE DIFFERENCE of the assets, not to any observed output.
      const sizeDelta = ADULT.bodyExtent.maxY - CHILD.bodyExtent.maxY;
      expect(
        distance(a!, c!),
        `${region} anchored to the same point on a 1.00 and a 0.72 scale body — the anchors are a table, not a derivation`,
      ).toBeGreaterThan(sizeDelta * 0.1);
    }
  });

  planted("(2) RED: every derived anchor is REACHABLE on its own asset", async () => {
    // An anchor the arm cannot reach makes the guard fail and the SOLVER get blamed. This is the
    // cheapest way for a derivation to be wrong in a way that looks like someone else's bug.
    //
    // Measured from the SHOULDER, not the bind hand: the arm swings about the shoulder, and a
    // hand-relative bound rejects every cross-body target. See `shoulderOf`.
    const producer = await loadProducer();
    expect(typeof producer?.deriveSkeletonProfile, `${PRODUCER_MODULE} must export deriveSkeletonProfile`).toBe("function");

    for (const asset of [ADULT, CHILD]) {
      const { regionAnchors } = producer!.deriveSkeletonProfile!(asset, GUARD_MOTION_REGIONS);
      const reach = armReach(asset);
      const from = shoulderOf(asset);
      for (const region of GUARD_MOTION_REGIONS) {
        const anchor = regionAnchors[region]!;
        expect(
          distance(from, anchor),
          `${asset.rigFingerprint}: ${region} sits ${distance(from, anchor).toFixed(3)} m from the shoulder, beyond its ${reach.toFixed(3)} m of arm`,
        ).toBeLessThanOrEqual(reach);
      }
    }
  });

  planted("(3) RED: the declared space is HONOURED, checked against the asset's own bind frame", async () => {
    // `regionAnchorSpace` is a string until something proves the numbers are in that frame. The
    // discriminator: bind-world anchors sit inside the asset's own body extent, which is expressed in
    // the same frame as `bindFrame`. Chest-relative or node-local values would not.
    const producer = await loadProducer();
    expect(typeof producer?.deriveSkeletonProfile, `${PRODUCER_MODULE} must export deriveSkeletonProfile`).toBe("function");

    for (const asset of [ADULT, CHILD]) {
      const { regionAnchors } = producer!.deriveSkeletonProfile!(asset, GUARD_MOTION_REGIONS);
      const e = asset.bodyExtent;
      for (const region of GUARD_MOTION_REGIONS) {
        const a = regionAnchors[region]!;
        expect(
          a.y >= e.minY && a.y <= e.maxY,
          `${asset.rigFingerprint}: ${region} at y=${a.y.toFixed(3)} is outside the body (${e.minY}..${e.maxY.toFixed(3)}) — these are not ${REGION_ANCHOR_SPACE}`,
        ).toBe(true);
        expect(
          Math.abs(a.x) <= e.halfWidth * 1.5 && Math.abs(a.z) <= e.halfDepth * 2,
          `${asset.rigFingerprint}: ${region} at x=${a.x.toFixed(3)} z=${a.z.toFixed(3)} is off the torso — these are not ${REGION_ANCHOR_SPACE}`,
        ).toBe(true);
        // TIGHTENED after a reviewer noted the AABB alone is weak: a SMALL chest-relative offset
        // sits inside minY..maxY and passes. A standing body's torso anchors are ~0.6-0.8 of its
        // height above the floor in bind world; a chest-relative one is a few centimetres from zero.
        expect(
          a.y,
          `${asset.rigFingerprint}: ${region} at y=${a.y.toFixed(3)} is near the origin on a ${e.maxY.toFixed(2)} m body — that is an offset from some bone, not ${REGION_ANCHOR_SPACE}`,
        ).toBeGreaterThan(e.maxY * 0.25);
      }
    }
  });

  planted("(4) RED: a region with no derivable anchor is REFUSED, never defaulted", async () => {
    // A silent default is a WRONG anchor nobody can see: the guard solves cleanly and the hand
    // arrives somewhere else on the body. Refusal is the only outcome a reader can act on.
    const producer = await loadProducer();
    expect(typeof producer?.deriveSkeletonProfile, `${PRODUCER_MODULE} must export deriveSkeletonProfile`).toBe("function");
    expect(
      () => producer!.deriveSkeletonProfile!(ADULT, ["motion_region_that_no_asset_can_place"]),
      "an underivable region returned quietly — a defaulted anchor solves cleanly and puts the hand in the wrong place",
    ).toThrow();
  });

  planted("(5) RED: two regions sharing a nearest joint still get DIFFERENT anchors", async () => {
    // COUNTERWEIGHT to (1), (2) and (3), all of which are satisfied by returning the bind position of
    // some nearby JOINT: that scales with the asset, is trivially reachable, and sits inside the body
    // extent — while encoding nothing about the region.
    //
    // Left and right chest share `chest` as their nearest joint. If they anchor to the same point,
    // the derivation is reading the skeleton and ignoring the region.
    const producer = await loadProducer();
    expect(typeof producer?.deriveSkeletonProfile, `${PRODUCER_MODULE} must export deriveSkeletonProfile`).toBe("function");

    const { regionAnchors } = producer!.deriveSkeletonProfile!(ADULT, [
      MOTION_REGION_GUARD_CHEST_L,
      MOTION_REGION_GUARD_CHEST_R,
      MOTION_REGION_GUARD_RLQ,
    ]);
    const left = regionAnchors[MOTION_REGION_GUARD_CHEST_L]!;
    const right = regionAnchors[MOTION_REGION_GUARD_CHEST_R]!;
    expect(
      distance(left, right),
      "left and right chest anchored to one point — the derivation returns a joint position and ignores the region",
    ).toBeGreaterThan(ADULT.bodyExtent.halfWidth * 0.5);
  });

  planted("(6) RED: the producer emits the PROFILE the compile path consumes, carrying the asset's own rig", async () => {
    // THE JOIN. Without this, both cards land green and the compile path still receives a fixture:
    // a producer that returns a bare anchor MAP leaves someone to merge it onto a profile by hand,
    // and "someone" is `armProfile()` in the plants today.
    //
    // The rig half must be the ASSET'S OWN, unchanged, so the producer cannot quietly substitute a
    // skeleton of its own while the anchors look right.
    const producer = await loadProducer();
    expect(typeof producer?.deriveSkeletonProfile, `${PRODUCER_MODULE} must export deriveSkeletonProfile`).toBe("function");

    const profile = producer!.deriveSkeletonProfile!(ADULT, GUARD_MOTION_REGIONS);
    expect(profile.rigFingerprint, "the produced profile is not for the asset it was given").toBe(ADULT.rigFingerprint);
    expect(profile.effectorBone, "the produced profile names a different effector").toBe(ADULT.effectorBone);
    expect(profile.joints, "the produced profile does not carry the asset's own joint chain").toEqual(ADULT.joints);
    expect(profile.bindFrame, "the produced profile does not carry the asset's own bind frame").toEqual(ADULT.bindFrame);
    expect(profile.regionAnchorSpace, "the produced profile does not declare its anchor space").toBe(REGION_ANCHOR_SPACE);
    for (const region of GUARD_MOTION_REGIONS) {
      expect(profile.regionAnchors[region], `the produced profile has no anchor for ${region}`).toBeDefined();
    }
  });

  it("(7) LIVE: nothing in the tree produces anchors today — this is the measurement, not a hypothesis", async () => {
    // Passes on arrival, fails independently of the REDs. If a producer appears under another name,
    // this clause turns red and the card's premise needs re-reading rather than the fix being assumed.
    expect(
      (await loadProducer())?.deriveSkeletonProfile,
      "something now exports deriveSkeletonProfile — re-read this card's premise before implementing it",
    ).toBeUndefined();
  });
});
