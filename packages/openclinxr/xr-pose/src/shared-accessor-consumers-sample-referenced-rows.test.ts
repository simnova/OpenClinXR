/**
 * S1c INPUT-1 cross-mesh double-count: guards (C1/C2) + RED (C3a/C3b).
 * Fixture values below are illustrative, not specification (hand-built
 * in-memory SkinnedMesh pairs sharing ONE position BufferAttribute, mirroring
 * three.js prim splitting; precedents shared-attribute-index-union.test.ts:19-30
 * carrier(), supine-support-contact.test.ts:9-35 rig()).
 * C1/C2 are guards (plain it): they pass today and must FAIL when their
 * protected lines are removed (verified by destructive probes under E).
 * C3a/C3b are RED (it.fails): they fail while the skin-cache / hand-rest
 * paths double-count cross-mesh shared rows, and pass once each shared row is
 * visited exactly once. Hidden-material siblings are legitimately visited
 * (skin under garment = real support geometry): no test asserts their exclusion.
 */
import { Vector3 } from "three";
import { buildPatientStretcher } from "@openclinxr/xr-station";
import { describe, expect, it } from "vitest";
import { measureSupineSupportRegions } from "./supine-support-contact.js";
import { resolveSupportSampleRows } from "./supine-support-skin-cache.js";
import { ownLimbRows } from "./supine-shared-position-rows.js";
import { applyContactAwareSupineArms } from "./supine-hand-rest.js";
import { measureGarmentLane } from "./supine-garment-lane.js";
import { correctGarmentAgainstSupport } from "./ward-garment-support.js";
import {
  allFlatPlanes,
  buildPair,
  wardPlane,
  type RowXYZ,
} from "./__fixtures__/shared-accessor-rows.js";

const GARMENT_A = "openclinxr_real_garment_test_gown_A";
const GARMENT_B = "openclinxr_real_garment_test_gown_B";
const LANE_A = "lane_test_gown_A";
const LANE_B = "lane_test_gown_B";

describe("shared-accessor consumers sample referenced rows (illustrative fixtures)", () => {
  it("C1 guard: hidden garment B leaves A's correction and shared row 2 unchanged (protects ward-garment-support.ts:32-36 ensureCloned)", () => {
    const rows: RowXYZ[] = [[0, 1, 0], [0, -0.01, 0], [0, -0.05, 0]];
    const base = {
      rows,
      aName: GARMENT_A,
      aIndex: [0, 1],
      bIndex: [1, 2],
      boneNames: ["b0"],
      hideB: true as const,
    };
    const withB = buildPair({ ...base, bName: GARMENT_B });
    const withoutB = buildPair({ ...base, bName: null });
    const planes = [wardPlane()];
    const resultWith = correctGarmentAgainstSupport(withB.A, planes);
    const resultWithout = correctGarmentAgainstSupport(withoutB.A, planes);
    // Guard: B's presence alone must not move A's result (holds today and post-fix).
    expect(resultWith).toEqual(resultWithout);
    // ensureCloned (ward-garment-support.ts:32-36) absorbs the write in a private
    // clone, so the SHARED row 2 stays at rest even though the read loop visits it.
    expect(withB.position.getY(2)).toBeCloseTo(-0.05, 6);
  });

  it("C2 guard: hidden garment B under both conventions leaves A's lane unchanged (protects supine-garment-lane.ts:18 ancestor-visible; :20 mesh-material and :31 per-triangle material gates are redundant for opacity 0, removing both fails this guard)", () => {
    // A triangle [0,1,3] (outer lateral 0.2); B triangle [1,2,3] reaches lateral
    // 10, so it WOULD move the lane if either gate let it through.
    const rows: RowXYZ[] = [[0.5, 0, 0.1], [0.6, 0, 0.2], [0.5, 1, 10], [0.5, 1, 0.15]];
    const base = { rows, aName: LANE_A, aIndex: [0, 1, 3], bIndex: [1, 2, 3], boneNames: ["b0"] };
    const hand = [new Vector3(0.4, 0, 0), new Vector3(0.6, 0, 0)];
    const forward = new Vector3(1, 0, 0);
    const lateral = new Vector3(0, 0, 1);
    const alone = buildPair({ ...base, bName: null });
    const laneAlone = measureGarmentLane(alone.root, hand, forward, lateral);
    expect(laneAlone.triangles).toBe(1);
    const hiddenMaterial = buildPair({ ...base, bName: LANE_B, hideB: true });
    expect(measureGarmentLane(hiddenMaterial.root, hand, forward, lateral)).toEqual(laneAlone);
    const invisible = buildPair({ ...base, bName: LANE_B });
    invisible.B!.visible = false;
    expect(measureGarmentLane(invisible.root, hand, forward, lateral)).toEqual(laneAlone);
  });

  it.fails("C3a RED: skin-cache cross-mesh overlap emits each pelvis row once (3 samples, not 4)", () => {
    const rows: RowXYZ[] = [[0, 0.05, 0], [0, 0.06, 0], [0, 0.07, 0]];
    const fixture = buildPair({
      rows,
      aName: "mpfb_test_body_A",
      aIndex: [0, 1],
      bName: "mpfb_test_body_B",
      bIndex: [1, 2],
      boneNames: ["pelvis"],
    });
    const regions = measureSupineSupportRegions(fixture.root, allFlatPlanes() as never);
    expect(regions.pelvis.samples).toBe(3);
    // Union counterweights (hold today and post-fix): drop-all-shared-rows would
    // claim {0,2} (row 1 missing); first-mesh-only would claim {0,1} (row 2 lost).
    const claimed = new Set<number>();
    for (const mesh of [fixture.A, fixture.B!] as const) {
      for (const row of resolveSupportSampleRows(mesh as never, true, [mesh.material])) {
        if (row.region === "pelvis") claimed.add(row.index);
      }
    }
    expect(claimed.size).toBe(3);
    expect(claimed.has(1)).toBe(true);
    expect(claimed.has(2)).toBe(true);
  });

  it.fails("C3b RED: hand-rest cross-mesh overlap emits each hand row once (hand.total 3, not 4)", () => {
    const rows: RowXYZ[] = [[0.2, 0.02, 0.0], [0.2, 0.03, 0.01], [0.2, 0.04, -0.01]];
    const fixture = buildPair({
      rows,
      aName: "mpfb_test_body_A",
      aIndex: [0, 1],
      bName: "mpfb_test_body_B",
      bIndex: [1, 2],
      boneNames: ["wristL", "upper_armL", "forearmL", "handL"],
      boneAt: {
        wristL: [0.2, 0.05, 0.0],
        upper_armL: [0.2, 0.05, -0.25],
        forearmL: [0.25, 0.05, -0.1],
        handL: [0.2, 0.05, 0.0],
      },
    });
    const bed = buildPatientStretcher({ slotId: "patient", position: { x: 0, y: 0, z: 0 }, trimColor: 0, inclineDegrees: 0 });
    const candidates = applyContactAwareSupineArms(fixture.root, bed);
    const left = candidates.find((row) => row.side === "L");
    expect(left).toBeDefined();
    expect(left!.hand.total).toBe(3);
    // Union counterweights (hold today and post-fix): drop-all-shared-rows would
    // claim {0,2} (row 1 missing); first-mesh-only would claim {0,1} (row 2 lost).
    const claimed = new Set<number>();
    for (const mesh of [fixture.A, fixture.B!] as const) {
      for (const index of ownLimbRows(fixture.root, mesh as never) ?? []) claimed.add(index);
    }
    expect(claimed.size).toBe(3);
    expect(claimed.has(1)).toBe(true);
    expect(claimed.has(2)).toBe(true);
  });
});
