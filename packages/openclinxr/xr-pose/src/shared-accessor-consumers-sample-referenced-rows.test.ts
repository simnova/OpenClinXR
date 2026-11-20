/**
 * S1e shared-accessor cross-mesh double-count: guards (C1/C2) + RED (C3a/C3b),
 * observed ONLY through the package public entrypoint (`./index.js`) plus
 * three.js / node:fs reads of geometry and userData. Fixture values below are
 * illustrative, not specification (hand-built in-memory SkinnedMesh pairs
 * sharing ONE position BufferAttribute, mirroring three.js prim splitting;
 * precedent: carrier() in shared-attribute-index-union.test.ts).
 * C1/C2 are guards (plain it): they pass today and must FAIL when their
 * protected code is removed (verified by destructive probes under E).
 * C3a/C3b are RED: they fail while the skin-cache / hand-rest paths
 * double-count cross-mesh shared rows, and pass once each shared row is
 * visited exactly once. Hidden-material siblings are legitimately visited
 * (skin under garment = real support geometry): no test asserts their exclusion.
 * F1 (no-boneInverses fallback double-claim) and F4 (fast aggregation claim)
 * pin the fast path through the public plant solve: F1 fails while the
 * fallback claims before aggregating (0 fast samples, blind solve); F4 fails
 * while the :315 aggregation claim is removed (double emission shifts the
 * solve). Both assert the emitted sample count and the gap.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Group, MeshBasicMaterial, SkinnedMesh, Vector3, type Matrix4 } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { buildPatientStretcher } from "@openclinxr/xr-station";
import { describe, expect, it } from "vitest";
import {
  applyAndPlantSupineOnDeck,
  measureBackToDeckGap,
  reapplySupineHeadToStoredPillow,
  resolveSharedAttributeRows,
} from "./index.js";
import {
  buildPair,
  type RowXYZ,
} from "./__fixtures__/shared-accessor-rows.js";

const GARMENT_A = "openclinxr_real_garment_test_gown_A";
const GARMENT_B = "openclinxr_real_garment_test_gown_B";

function worldY(mesh: SkinnedMesh, index: number): number {
  return mesh.getVertexPosition(index, new Vector3()).applyMatrix4(mesh.matrixWorld).y;
}

/** Per-mesh carriers over a shared POSITION set for the public union helper. */
function unionOfPair(position: { count: number }, meshes: Array<SkinnedMesh>): Set<number> {
  const carriers = meshes.map((mesh) => {
    const index = mesh.geometry.index;
    if (!index) throw new Error("unionOfPair: mesh without index");
    return {
      set: position,
      index: { count: index.count, getX: (i: number): number => index.getX(i) },
      vertexCount: position.count,
    };
  });
  const resolution = resolveSharedAttributeRows(carriers).get(position);
  if (!resolution) throw new Error("unionOfPair: no resolution for the shared set");
  return new Set(resolution.union);
}

describe("shared-accessor consumers sample referenced rows (illustrative fixtures)", () => {
  it("C1 guard: hidden garment B leaves A's public correction and the shared original unchanged (protects ensureCloned in ward-garment-support.ts)", () => {
    // Rows sit just under the deck top in world Y after plant (0.53); the
    // public reapply correction lifts them along the deck normal, which is
    // local Z in the supine basis (local Y maps to world X), so every row
    // corrects to deckTop + MIN_GAP (worldY 0.552) by WRITING local Z.
    // Comparing only local Y can never see the write: the guard snapshots
    // and compares full local triples.
    const rows: RowXYZ[] = [[0, 0.56, 0], [0, 0.53, 0], [0, 0.49, 0]];
    const triple = (position: { getX(i: number): number; getY(i: number): number; getZ(i: number): number }, i: number): number[] => [
      position.getX(i),
      position.getY(i),
      position.getZ(i),
    ];
    const run = (includeB: boolean): { corrected: number[]; shared: number[][]; rest: number[][] } => {
      const fixture = buildPair({
        rows,
        aName: GARMENT_A,
        aIndex: [0, 1],
        bName: includeB ? GARMENT_B : null,
        bIndex: [1, 2],
        boneNames: ["b0", "upperleg01.L"],
        hideB: true,
      });
      const rest = [0, 1, 2].map((i) => triple(fixture.position, i));
      const bed = buildPatientStretcher({ slotId: "patient", position: { x: 0, y: 0, z: 0 }, trimColor: 0, inclineDegrees: 0 });
      applyAndPlantSupineOnDeck(fixture.root, { deckTopWorldY: 0.55, deckCenter: { x: 0, z: 0 }, stretcher: bed });
      reapplySupineHeadToStoredPillow(fixture.root);
      return {
        corrected: [0, 1, 2].map((i) => worldY(fixture.A, i)),
        shared: [0, 1, 2].map((i) => triple(fixture.position, i)),
        rest,
      };
    };
    const withoutB = run(false);
    const withB = run(true);
    // B's presence alone must not move A's corrected result (holds today and post-fix).
    expect(withB.corrected).toEqual(withoutB.corrected);
    // The public correction ran (rows now sit at deckTop + MIN_GAP, not at plant rest).
    for (const y of withB.corrected) expect(y).toBeCloseTo(0.552, 4);
    // ensureCloned in ward-garment-support.ts absorbs the writes in a private
    // clone, so the SHARED original stays at rest even though the read loop visits it.
    // Full triples: without the clone A's write lands local Z (0 -> 0.022) in
    // the shared attribute, which a Y-only read can never see.
    expect(withB.shared).toEqual(withB.rest);
    expect(withB.shared).toEqual(withoutB.shared);
  });

  it("C2 guard: hidden/invisible garment duplicate leaves the accepted public lane unchanged (protects the ancestor-visible, mesh-material and per-triangle gates in supine-garment-lane.ts)", async () => {
    // The fixture is checked in beside the package: resolve it from
    // import.meta.url only (no ambient SA_GLB_DIR: a stale export directory
    // would ENOENT or test a different GLB under the same filename).
    const glbDir = fileURLToPath(new URL("../../../../apps/ui-xr/public/generated-humanoids", import.meta.url));
    const loadChild = async (): Promise<Group> => {
      const bytes = readFileSync(join(glbDir, "mpfb-peds-patient-child.glb"));
      const jsonLength = bytes.readUInt32LE(12);
      const json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString());
      const binLength = bytes.readUInt32LE(20 + jsonLength);
      json.buffers[0].uri = `data:application/octet-stream;base64,${bytes.subarray(28 + jsonLength, 28 + jsonLength + binLength).toString("base64")}`;
      for (const material of json.materials) {
        delete material.normalTexture; delete material.occlusionTexture; delete material.emissiveTexture;
        delete material.pbrMetallicRoughness?.baseColorTexture;
        delete material.pbrMetallicRoughness?.metallicRoughnessTexture;
      }
      json.images = []; json.textures = [];
      const platform = globalThis as unknown as { ProgressEvent?: typeof Event };
      if (!platform.ProgressEvent) platform.ProgressEvent = class extends Event {};
      return (await new GLTFLoader().parseAsync(JSON.stringify(json), "")).scene as Group;
    };
    const bed = buildPatientStretcher({ slotId: "patient", position: { x: 0, y: 0, z: 0 }, trimColor: 0, inclineDegrees: 0 });
    const laneBeforeOf = async (variant: "alone" | "hidden" | "invisible"): Promise<{ accepted: boolean; lane: { triangles: number; separation: number | null; shift: number; buffer: number }; status: string }> => {
      const root = await loadChild();
      if (variant !== "alone") {
        const target = root.getObjectByName("makeclothes_library_cargo_pants_mpfb_peds_patient_child") as SkinnedMesh;
        const material = variant === "hidden"
          ? new MeshBasicMaterial({ color: 0xff0000, transparent: true, opacity: 0, alphaTest: 0.5 })
          : (target.material as MeshBasicMaterial).clone();
        const dup = new SkinnedMesh(target.geometry, material);
        dup.name = `${target.name}_test_dup_B`;
        if (variant === "invisible") dup.visible = false;
        dup.bindMode = target.bindMode;
        dup.bind(target.skeleton, target.bindMatrix as Matrix4);
        dup.position.copy(target.position); dup.quaternion.copy(target.quaternion); dup.scale.copy(target.scale);
        target.parent!.add(dup);
      }
      const parent = new Group(); parent.scale.setScalar(0.82); parent.add(root); parent.updateMatrixWorld(true);
      applyAndPlantSupineOnDeck(root, { stretcher: bed, deckTopWorldY: 0.55, deckCenter: { x: 0, z: 0 } });
      const candidates = root.userData["openClinXrSupineHandCandidate"] as Array<{
        side: string; accepted?: boolean; unresolved: string | null;
        garmentLane?: { before: { triangles: number; separation: number | null; shift: number; buffer: number }; status: string };
      }>;
      const left = candidates.find((row) => row.side === "L");
      expect(left, `${variant} left candidate`).toBeDefined();
      expect(left!.accepted, `${variant} left candidate accepted`).toBe(true);
      expect(left!.garmentLane, `${variant} left lane present`).toBeDefined();
      return { accepted: left!.accepted!, lane: left!.garmentLane!.before, status: left!.garmentLane!.status };
    };
    const alone = await laneBeforeOf("alone");
    const hidden = await laneBeforeOf("hidden");
    const invisible = await laneBeforeOf("invisible");
    // The duplicate shares the garment's triangles exactly, so counting it would
    // double the lane triangle tally: equality proves both gates skip it.
    expect(hidden.lane.triangles).toBe(alone.lane.triangles);
    expect(hidden.lane.separation).toBeCloseTo(alone.lane.separation!, 8);
    expect(hidden.lane.shift).toBeCloseTo(alone.lane.shift, 8);
    expect(hidden.lane.buffer).toBeCloseTo(alone.lane.buffer, 8);
    expect(invisible.lane.triangles).toBe(alone.lane.triangles);
    expect(invisible.lane.separation).toBeCloseTo(alone.lane.separation!, 8);
    expect(invisible.lane.shift).toBeCloseTo(alone.lane.shift, 8);
    expect(invisible.lane.buffer).toBeCloseTo(alone.lane.buffer, 8);
  }, 120_000);

  it("C3a RED: skin-cache cross-mesh overlap emits each lumbar row once (public gap bit-equal to the disjoint control)", () => {
    const rows: RowXYZ[] = [];
    for (let i = 0; i < 13; i += 1) rows.push([0, 0.55 + i * 0.001, 0]);
    const bed = buildPatientStretcher({ slotId: "patient", position: { x: 0, y: 0, z: 0 }, trimColor: 0, inclineDegrees: 0 });
    const overlap = buildPair({
      rows,
      aName: "mpfb_test_body_A",
      aIndex: [0, 1, 2, 3, 4, 5, 6],
      bName: "mpfb_test_body_B",
      bIndex: [6, 7, 8, 9, 10, 11, 12],
      boneNames: ["spine02"],
    });
    const control = buildPair({
      rows,
      aName: "mpfb_test_body_A",
      aIndex: [0, 1, 2, 3, 4, 5, 6],
      bName: "mpfb_test_body_B",
      bIndex: [7, 8, 9, 10, 11, 12],
      boneNames: ["spine02"],
    });
    const overlapGap = measureBackToDeckGap(overlap.root, bed);
    const controlGap = measureBackToDeckGap(control.root, bed);
    // Post-fix the duplicate emission is gone, so the overlap multiset is the
    // control multiset in the same order: bit-equal. Pre-fix the extra copy of
    // the shared (non-minimum) row promotes the 8th-percentile one slot up.
    expect(overlapGap).toBe(controlGap);
    expect(controlGap).toBeCloseTo(0, 4);
    // Union counterweight (public helper): the shared row is claimed by both
    // carriers yet carried once; drop-all-shared-rows would lose row 6.
    const union = unionOfPair(overlap.position, [overlap.A, overlap.B!]);
    expect(union.size).toBe(13);
    expect(union.has(6)).toBe(true);
  });

  it("C3b RED: hand-rest cross-mesh overlap emits each hand row once (public candidate hand.total 4, not 5)", () => {
    const rows: RowXYZ[] = [[0.2, 0.02, 0.0], [0.2, 0.03, 0.01], [0.2, 0.04, -0.01], [0.2, 0.025, 0.02]];
    const fixture = buildPair({
      rows,
      aName: "mpfb_test_body_A",
      aIndex: [0, 1, 3],
      bName: "mpfb_test_body_B",
      bIndex: [1, 2],
      boneNames: ["wristL", "upper_armL", "forearmL", "handL", "upperleg01.L"],
      boneAt: {
        wristL: [0.2, 0.05, 0.0],
        upper_armL: [0.2, 0.05, -0.25],
        forearmL: [0.25, 0.05, -0.1],
        handL: [0.2, 0.05, 0.0],
      },
    });
    const bed = buildPatientStretcher({ slotId: "patient", position: { x: 0, y: 0, z: 0 }, trimColor: 0, inclineDegrees: 0 });
    applyAndPlantSupineOnDeck(fixture.root, { deckTopWorldY: 0.55, deckCenter: { x: 0.2, z: 0 }, stretcher: bed });
    const candidates = fixture.root.userData["openClinXrSupineHandCandidate"] as Array<{
      side: string; hand: { total: number };
    }>;
    const left = candidates.find((row) => row.side === "L");
    expect(left, "left candidate present").toBeDefined();
    // Row 1 is emitted by both meshes yet counted once (pre-fix it is counted
    // twice, total 5); the store is unconditional so no acceptance is needed.
    expect(left!.hand.total).toBe(4);
    // Union counterweight (public helper): rows 1 and 2 are present in the
    // partition; first-mesh-only would lose row 2, drop-all-shared would lose row 1.
    const union = unionOfPair(fixture.position, [fixture.A, fixture.B!]);
    expect(union.size).toBe(4);
    expect(union.has(1)).toBe(true);
    expect(union.has(2)).toBe(true);
  });

  it("F1: no-boneInverses fallback emits every private row once (public plant Resolved, counts match the point path)", () => {
    // supine-support-skin-cache.ts fallback (no skeleton.boneInverses) claimed
    // each row before computing its gap, then aggregateSupportEntry claimed it
    // again and dropped it: the fast path emitted 0 samples (blind plant
    // solve) while the point path emitted all 4 per region. The fix claims
    // exactly once (aggregation), so both paths agree.
    // World map of the supine basis (observed): height is local Z, body axis
    // is local Y. Body rows sit at deck+0.02; occiput rows sit head-on-pillow
    // high (gap ~+0.03, over the 0.025 band) so plant-without-solve leaves
    // Resolved false while the working fast path pulls the root into the band.
    const boneNames = ["root", "spine02", "chest", "head", "foot.L", "foot.R", "upperleg01.L"];
    const rows: RowXYZ[] = [];
    const boneForRow: number[] = [];
    const push = (bone: number, lx: number, ly: number, lz: number): void => {
      rows.push([lx, ly, lz]);
      boneForRow.push(bone);
    };
    for (let i = 0; i < 4; i += 1) push(0, 0.0, 0.0 + i * 0.004, 0.0 + i * 0.001);
    for (let i = 0; i < 4; i += 1) push(1, 0.005, 0.2 + i * 0.004, 0.0 + i * 0.001);
    for (let i = 0; i < 4; i += 1) push(2, 0.01, 0.35 + i * 0.004, 0.0 + i * 0.001);
    for (let i = 0; i < 4; i += 1) push(3, 0.015, 0.59 + i * 0.004, 0.09 + i * 0.001);
    for (let i = 0; i < 4; i += 1) push(4, 0.02, -0.3 + i * 0.004, 0.0 + i * 0.001);
    for (let i = 0; i < 4; i += 1) push(5, 0.025, -0.3 + i * 0.004, 0.0 + i * 0.001);
    const fixture = buildPair({
      rows, aName: "test_support_shell_F1", aIndex: rows.map((_, i) => i),
      bName: null, bIndex: [], boneNames, boneForRow,
    });
    // Plain structural skeleton (bones, no update, no boneInverses) selects
    // the no-skeleton fast fallback; the custom getVertexPosition works
    // without boneInverses. The non-body name keeps the hand-rest/garment
    // traversals off this mesh while support still measures it.
    (fixture.A as unknown as { skeleton: unknown }).skeleton = { bones: fixture.A.skeleton.bones };
    (fixture.A as unknown as { getVertexPosition: unknown }).getVertexPosition =
      (index: number, target: { fromBufferAttribute: (a: unknown, i: number) => unknown }) =>
        target.fromBufferAttribute(fixture.position, index);
    const bed = buildPatientStretcher({ slotId: "patient", position: { x: 0, y: 0, z: 0 }, trimColor: 0, inclineDegrees: 0 });
    applyAndPlantSupineOnDeck(fixture.root, { stretcher: bed, deckTopWorldY: 0.55, deckCenter: { x: 0, z: 0 } });
    const finalMetrics = fixture.root.userData["openClinXrSupineArticulatedSupport"] as Record<string, {
      samples: number; contactGapMeters: number | null; minGapMeters: number | null;
    }>;
    // The fast-fed solve ran: pre-fix the blind solve never moved the root
    // (Resolved false, root.y 0.57); post-fix it settles into the band.
    expect(fixture.root.userData["openClinXrSupineArticulatedSupportResolved"]).toBe(true);
    expect(fixture.root.position.y).toBeCloseTo(0.555, 4);
    // Emitted sample count agrees on both paths: 4 per region.
    for (const region of ["pelvis", "lumbar", "thorax", "heelL", "heelR", "occiput"]) {
      expect(finalMetrics[region]!.samples, `${region} samples`).toBe(4);
    }
    expect(finalMetrics["pelvis"]!.contactGapMeters).toBeCloseTo(0.005, 4);
    expect(finalMetrics["occiput"]!.contactGapMeters).toBeCloseTo(0.015, 4);
  });

  it("F4: fast aggregation emits each shared overlap row once (public plant gap matches the deduped solve)", () => {
    // C3a pins the point path only: removing the fast aggregation claim
    // (skin-cache :315) leaves C3a green while the fast path double-emits the
    // overlap row and shifts the solve. This case goes through the fast path
    // (public plant solve on an MPFB2 overlap pair) and asserts the emitted
    // sample count and the gap: with :315 removed the root settles 0.01 lower
    // and every regional gap reads 0.01 lower.
    const boneNames = ["root", "spine02", "chest", "head", "foot.L", "foot.R", "upperleg01.L"];
    const rows: RowXYZ[] = [];
    const boneForRow: number[] = [];
    // 13 rows per region (C3a shape: the 1-row overlap shifts the fast 8th
    // percentile one slot); j=0 is a low outlier so the shift reads 0.01.
    const localY = [0.0, 0.2, 0.35, 0.59, -0.3, -0.3];
    const localZ = [0.0, 0.0, 0.0, 0.09, 0.0, 0.0];
    for (let region = 0; region < 6; region += 1) {
      for (let j = 0; j < 13; j += 1) {
        const lz = j === 0 ? localZ[region]! - 0.01 : localZ[region]! + (j - 1) * 0.001;
        rows.push([0.005 * region, localY[region]! + j * 0.001, lz]);
        boneForRow.push(region);
      }
    }
    const aIndex: number[] = [];
    const bIndex: number[] = [];
    for (let region = 0; region < 6; region += 1) {
      for (let j = 0; j <= 6; j += 1) aIndex.push(region * 13 + j);
      for (let j = 6; j <= 12; j += 1) bIndex.push(region * 13 + j);
    }
    const fixture = buildPair({
      rows, aName: "mpfb_test_body_F4A", aIndex,
      bName: "mpfb_test_body_F4B", bIndex, boneNames, boneForRow,
    });
    const bed = buildPatientStretcher({ slotId: "patient", position: { x: 0, y: 0, z: 0 }, trimColor: 0, inclineDegrees: 0 });
    applyAndPlantSupineOnDeck(fixture.root, { stretcher: bed, deckTopWorldY: 0.55, deckCenter: { x: 0, z: 0 } });
    const finalMetrics = fixture.root.userData["openClinXrSupineArticulatedSupport"] as Record<string, {
      samples: number; contactGapMeters: number | null; minGapMeters: number | null;
    }>;
    expect(fixture.root.userData["openClinXrSupineArticulatedSupportResolved"]).toBe(true);
    // Emitted sample count: the 13-row union per region, overlap claimed once.
    for (const region of ["pelvis", "lumbar", "thorax", "heelL", "heelR", "occiput"]) {
      expect(finalMetrics[region]!.samples, `${region} samples`).toBe(13);
    }
    // Deduped-solve gaps: :315 removed settles 0.01 lower on every region.
    expect(fixture.root.position.y).toBeCloseTo(0.565, 4);
    expect(finalMetrics["pelvis"]!.contactGapMeters).toBeCloseTo(0.005, 4);
    expect(finalMetrics["lumbar"]!.contactGapMeters).toBeCloseTo(0.005, 4);
    expect(finalMetrics["occiput"]!.contactGapMeters).toBeCloseTo(0.015, 4);
    // Union counterweight (public helper): the overlap row is carried once.
    const union = unionOfPair(fixture.position, [fixture.A, fixture.B!]);
    expect(union.size).toBe(78);
  });
});
