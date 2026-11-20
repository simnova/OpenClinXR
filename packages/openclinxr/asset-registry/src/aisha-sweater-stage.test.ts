import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  AISHA_SWEATER_NECKLINE_BAND,
  AISHA_SWEATER_SHOULDER_REGIONS,
  AISHA_SWEATER_STAGE_ACTOR,
  AISHA_SWEATER_STAGE_HIDDEN_INDICES_SHA256,
  AISHA_SWEATER_STAGE_KEPT_INDICES_SHA256,
  type AishaSweaterSplitWitness,
  aishaSweaterFaceKey,
  aishaSweaterRegionOf,
  isAishaSweaterStageSplit,
} from "./aisha-sweater-stage.js";

/**
 * AISHA-SWEATER-POKE-THROUGH lever test (tsk_4c6a7143f7dff5e0, LEVER round).
 *
 * The shipped Aisha carries the sweater-stage split: the posed-converged
 * body-skin triangles showing through the green sweater at both shoulders
 * moved back under the hide mask (patch-prim-in-place) by
 * tools/openclinxr/asset-pipeline/makeclothes/rehide-aisha-shoulder-skin.py,
 * replayed through tools/.../humanoid-chain/manifests/
 * mpfb-ob-patient-aisha.post-export.json by the real run-chain loader.
 *
 * RED at HEAD (f7720c26): ./aisha-sweater-stage.js does not exist yet, so the
 * import above fails and every case below refuses. GREEN after S3: the live
 * GLB carries the pinned kept/hidden pair whose sorted-index union equals the
 * pre-stage prim0, CW-A (V-neck opening band visible-face superset) and CW-B
 * (every newly hidden face under a shirt-covered shoulder region) hold.
 *
 * Plants (S5): (1) manifest without the stage, replayed -> split case fails;
 * (2) one extra non-poking triangle hidden -> CW-A or CW-B fails; (3) split
 * predicate fed a wrong union -> split case fails; (5) whole V-neck band
 * re-hidden -> CW-A fails.
 */

const GLB_REL = "apps/ui-xr/public/generated-humanoids/mpfb-ob-patient-aisha.glb";
/** Pre-stage tree: the pinned pre-image the derivation replays from. */
const BASELINE_REF = "f772d0c26";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", "..", "..");
const LIVE_GLB = join(REPO_ROOT, GLB_REL);

/** The indexed glTF data used by the live and baseline fixtures. */
interface FixturePrimitive {
  attributes: Record<string, number> & { POSITION: number };
  indices: number;
  material: number;
  targets?: Array<Record<string, number>>;
}

interface FixtureMesh {
  name: string;
  primitives: FixturePrimitive[];
}

interface FixtureDocument {
  accessors: Array<{
    bufferView: number;
    byteOffset?: number;
    componentType: number;
    count: number;
    type: string;
  }>;
  bufferViews: Array<{ byteOffset?: number; byteStride?: number }>;
  materials: Array<{ name: string }>;
  meshes: FixtureMesh[];
}

interface FixtureGlb {
  doc: FixtureDocument;
  binary: Buffer;
}

function sha256(bytes: Uint8Array | Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function readGlb(path: string): FixtureGlb {
  const buf = readFileSync(path);
  const jsonLen = buf.readUInt32LE(12);
  const doc = JSON.parse(buf.subarray(20, 20 + jsonLen).toString("utf8")) as FixtureDocument;
  const binLen = buf.readUInt32LE(20 + jsonLen);
  const binary = buf.subarray(20 + jsonLen + 8, 20 + jsonLen + 8 + binLen);
  return { doc, binary };
}

function readBaselineGlb(): FixtureGlb {
  const buf = execFileSync("git", ["show", `${BASELINE_REF}:${GLB_REL}`], {
    cwd: REPO_ROOT,
    maxBuffer: 256 * 1024 * 1024,
  }) as Buffer;
  const jsonLen = buf.readUInt32LE(12);
  const doc = JSON.parse(buf.subarray(20, 20 + jsonLen).toString("utf8")) as FixtureDocument;
  const binLen = buf.readUInt32LE(20 + jsonLen);
  const binary = buf.subarray(20 + jsonLen + 8, 20 + jsonLen + 8 + binLen);
  return { doc, binary };
}

function indexArray(doc: FixtureDocument, binary: Buffer, accIdx: number): number[] {
  const acc = doc.accessors[accIdx]!;
  const view = doc.bufferViews[acc.bufferView]!;
  const start = (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  const n: number = acc.count;
  if (acc.type !== "SCALAR") throw new Error(`accessor ${accIdx} is not SCALAR`);
  if (acc.componentType === 5123) {
    return Array.from(new Uint16Array(binary.buffer, binary.byteOffset + start, n));
  }
  if (acc.componentType === 5125) {
    return Array.from(new Uint32Array(binary.buffer, binary.byteOffset + start, n));
  }
  throw new Error(`accessor ${accIdx} has non-index componentType ${acc.componentType}`);
}

function positionArray(doc: FixtureDocument, binary: Buffer, accIdx: number): Float32Array {
  const acc = doc.accessors[accIdx]!;
  const view = doc.bufferViews[acc.bufferView]!;
  const start = (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  const n: number = acc.count;
  if (acc.type !== "VEC3" || acc.componentType !== 5126) {
    throw new Error(`accessor ${accIdx} is not VEC3 float`);
  }
  // The Aisha body interleaves vertex attributes (POSITION view byteStride
  // 52); honor the stride like the E9 nurse-test `dec` helper does.
  const stride: number = view.byteStride ?? 12;
  if (stride === 12) {
    return new Float32Array(binary.buffer, binary.byteOffset + start, n * 3);
  }
  const out = new Float32Array(n * 3);
  const dv = new DataView(binary.buffer, binary.byteOffset);
  for (let i = 0; i < n; i += 1) {
    out[i * 3] = dv.getFloat32(start + i * stride, true);
    out[i * 3 + 1] = dv.getFloat32(start + i * stride + 4, true);
    out[i * 3 + 2] = dv.getFloat32(start + i * stride + 8, true);
  }
  return out;
}

function requireMaterial(mats: string[], index: number, role: string): string {
  const name = mats[index];
  if (typeof name !== "string") throw new Error(`${role} prim material index ${index} has no name`);
  return name;
}

function bodyMesh(doc: FixtureDocument): FixtureMesh {
  const meshes = doc.meshes.filter(
    (m) =>
      typeof m.name === "string" &&
      m.name.endsWith("_body") &&
      m.primitives.some((p) => doc.materials[p.material]?.name?.includes("hidden")),
  );
  if (meshes.length !== 1) throw new Error(`expected one body mesh, found ${meshes.length}`);
  return meshes[0]!;
}

function witnessOf(live: FixtureGlb, base: FixtureGlb): AishaSweaterSplitWitness {
  const liveBody = bodyMesh(live.doc);
  const baseBody = bodyMesh(base.doc);
  const liveMats = live.doc.materials.map((m) => m.name);
  const baseMats = base.doc.materials.map((m) => m.name);
  const skinMat = "mpfb_skin_ob_patient_aisha_v1";
  const liveSkinIdx = liveBody.primitives.findIndex((p) => liveMats[p.material] === skinMat);
  const baseSkinIdx = baseBody.primitives.findIndex((p) => baseMats[p.material] === skinMat);
  if (liveSkinIdx < 0 || baseSkinIdx < 0) throw new Error("skin prim missing");
  const liveSkin = liveBody.primitives[liveSkinIdx]!;
  const baseSkin = baseBody.primitives[baseSkinIdx]!;
  // The stage appends exactly one hidden prim reusing the skin prim's
  // accessors; it is the only hidden prim with the skin prim's POSITION.
  const skinPos = liveSkin.attributes.POSITION;
  const hiddenCands = liveBody.primitives.filter(
    (p) => liveMats[p.material]!.startsWith("openclinxr_hidden_") && p.attributes.POSITION === skinPos,
  );
  if (hiddenCands.length !== 1) throw new Error(`expected one stage hidden prim, found ${hiddenCands.length}`);
  const hidden = hiddenCands[0]!;
  const keptIdx = indexArray(live.doc, live.binary, liveSkin.indices);
  const hiddenIdx = indexArray(live.doc, live.binary, hidden.indices);
  const baselineIdx = indexArray(base.doc, base.binary, baseSkin.indices);
  const rawSha = (g: FixtureGlb, accIdx: number): string => {
    const acc = g.doc.accessors[accIdx]!;
    const view = g.doc.bufferViews[acc.bufferView]!;
    const start = (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
    const elem = acc.componentType === 5123 ? 2 : 4;
    return sha256(g.binary.subarray(start, start + acc.count * elem));
  };
  const attrOf = (p: FixturePrimitive): Record<string, number> => ({ ...p.attributes });
  const targetsOf = (p: FixturePrimitive): ReadonlyArray<Record<string, number>> =>
    (p.targets ?? []).map((t) => ({ ...t }));
  return {
    keptIndicesSha256: rawSha(live, liveSkin.indices),
    hiddenIndicesSha256: rawSha(live, hidden.indices),
    keptSortedIndices: [...keptIdx].sort((a, b) => a - b),
    hiddenSortedIndices: [...hiddenIdx].sort((a, b) => a - b),
    baselineSortedIndices: [...baselineIdx].sort((a, b) => a - b),
    keptAttrAccessors: attrOf(liveSkin),
    hiddenAttrAccessors: attrOf(hidden),
    baselineAttrAccessors: attrOf(baseSkin),
    keptTargetAccessors: targetsOf(liveSkin),
    hiddenTargetAccessors: targetsOf(hidden),
    baselineTargetAccessors: targetsOf(baseSkin),
    keptMaterialIndex: liveSkin.material,
    hiddenMaterialIndex: hidden.material,
    baselineMaterialIndex: baseSkin.material,
    keptMaterial: requireMaterial(liveMats, liveSkin.material, "kept skin"),
    hiddenMaterial: requireMaterial(liveMats, hidden.material, "hidden"),
    baselineMaterial: requireMaterial(baseMats, baseSkin.material, "baseline skin"),
  };
}

describe("aisha sweater stage (shoulder poke-through rehide)", () => {
  it("the shipped Aisha carries the pinned sweater-stage split", () => {
    expect(AISHA_SWEATER_STAGE_ACTOR, "stage actor pin").toBe("mpfb-ob-patient-aisha");
    const live = readGlb(LIVE_GLB);
    const base = readBaselineGlb();
    const w = witnessOf(live, base);
    console.log("sweater-stage pins", {
      kept: w.keptIndicesSha256,
      hidden: w.hiddenIndicesSha256,
      keptTris: w.keptSortedIndices.length / 3,
      hiddenTris: w.hiddenSortedIndices.length / 3,
      baselineTris: w.baselineSortedIndices.length / 3,
    });
    expect(w.keptIndicesSha256, "kept pin").toBe(AISHA_SWEATER_STAGE_KEPT_INDICES_SHA256);
    expect(w.hiddenIndicesSha256, "hidden pin").toBe(AISHA_SWEATER_STAGE_HIDDEN_INDICES_SHA256);
    expect(isAishaSweaterStageSplit(w), "live pair is the pinned split").toBe(true);
  });

  /** One visible band face: stable identity + bind-space centroid + verts. */
  type BandFace = { key: string; centroid: readonly [number, number, number]; verts: readonly number[] };

  /**
   * Visible body faces inside the V-neck opening band, multiplicity-kept
   * (coincident faces stay distinct entries; a Set would merge them).
   * Band rule (bind metres; provenance: SELECTION.json `band` block, r1 STATE:
   * floorY = min neck-vert y above the cuff-top max y 1.2656; lateralGate =
   * max neck-vert |x|, the opening halfwidth; distanceMm = 12 covers the 87
   * opening-adjacent faces + margin). Centroid = mean of all 3 vertices.
   */
  const bandFacesOf = (g: FixtureGlb): { faces: BandFace[]; neckEdges: number } => {
      const body = bodyMesh(g.doc);
      const mats = g.doc.materials.map((m) => m.name);
      const skin = body.primitives.find((p) => mats[p.material] === "mpfb_skin_ob_patient_aisha_v1")!;
      const pos = positionArray(g.doc, g.binary, skin.attributes.POSITION);
      const idx = indexArray(g.doc, g.binary, skin.indices);
      const shirt = g.doc.meshes.find((m) => m.name.includes("toigo_t_shirt"))!;
      const shirtPos = positionArray(g.doc, g.binary, shirt.primitives[0]!.attributes.POSITION);
      const shirtIdx = indexArray(g.doc, g.binary, shirt.primitives[0]!.indices);
      // Neckline boundary edges: shirt edges with one face, midpoint above
      // the band floor and inside the lateral gate (the printed rule).
      const edgeCount = new Map<string, number>();
      const edgeMid = new Map<string, [number, number, number]>();
      const key2 = (a: number, b: number): string => (a < b ? `${a}_${b}` : `${b}_${a}`);
      for (let t = 0; t < shirtIdx.length; t += 3) {
        const tri = [shirtIdx[t]!, shirtIdx[t + 1]!, shirtIdx[t + 2]!];
        for (let e = 0; e < 3; e += 1) {
          const k = key2(tri[e]!, tri[(e + 1) % 3]!);
          edgeCount.set(k, (edgeCount.get(k) ?? 0) + 1);
          if (!edgeMid.has(k)) {
            edgeMid.set(k, [
              (shirtPos[tri[e]! * 3]! + shirtPos[tri[(e + 1) % 3]! * 3]!) / 2,
              (shirtPos[tri[e]! * 3 + 1]! + shirtPos[tri[(e + 1) % 3]! * 3 + 1]!) / 2,
              (shirtPos[tri[e]! * 3 + 2]! + shirtPos[tri[(e + 1) % 3]! * 3 + 2]!) / 2,
            ]);
          }
        }
      }
      const neckEdges: Array<[number, number, number]> = [];
      for (const [k, c] of edgeCount) {
        if (c !== 1) continue;
        const mid = edgeMid.get(k)!;
        if (
          mid[1] > AISHA_SWEATER_NECKLINE_BAND.floorY &&
          Math.abs(mid[0]) < AISHA_SWEATER_NECKLINE_BAND.lateralGate
        ) {
          neckEdges.push(mid);
        }
      }
      expect(neckEdges.length, "neckline boundary edge count is stable").toBeGreaterThan(0);
      const faces: BandFace[] = [];
      const d2max = AISHA_SWEATER_NECKLINE_BAND.distanceMm ** 2;
      for (let t = 0; t < idx.length; t += 3) {
        const cx = (pos[idx[t]! * 3]! + pos[idx[t + 1]! * 3]! + pos[idx[t + 2]! * 3]!) / 3;
        const cy = (pos[idx[t]! * 3 + 1]! + pos[idx[t + 1]! * 3 + 1]! + pos[idx[t + 2]! * 3 + 1]!) / 3;
        const cz = (pos[idx[t]! * 3 + 2]! + pos[idx[t + 1]! * 3 + 2]! + pos[idx[t + 2]! * 3 + 2]!) / 3;
        let inside = false;
        for (const e of neckEdges) {
          const dx = (cx - e[0]) * 1000;
          const dy = (cy - e[1]) * 1000;
          const dz = (cz - e[2]) * 1000;
          if (dx * dx + dy * dy + dz * dz < d2max) {
            inside = true;
            break;
          }
        }
        if (inside) {
          const verts = [
            pos[idx[t]! * 3]!, pos[idx[t]! * 3 + 1]!, pos[idx[t]! * 3 + 2]!,
            pos[idx[t + 1]! * 3]!, pos[idx[t + 1]! * 3 + 1]!, pos[idx[t + 1]! * 3 + 2]!,
            pos[idx[t + 2]! * 3]!, pos[idx[t + 2]! * 3 + 1]!, pos[idx[t + 2]! * 3 + 2]!,
          ];
          faces.push({ key: aishaSweaterFaceKey(verts), centroid: [cx, cy, cz], verts });
        }
      }
      return { faces, neckEdges: neckEdges.length };
    };

  /**
   * CW-A comparison: after keeps every baseline band face (multiset
   * superset). Refuses loudly: empty baseline, zero baseline matches, or any
   * lost face (names the first missing identities).
   */
  const assertBandSuperset = (before: BandFace[], after: BandFace[]): { matched: number; missing: string[] } => {
    if (before.length === 0) throw new Error("CW-A refused: baseline neckline band is empty (0 faces)");
    const have = new Map<string, number>();
    for (const f of after) have.set(f.key, (have.get(f.key) ?? 0) + 1);
    const need = new Map<string, number>();
    for (const f of before) need.set(f.key, (need.get(f.key) ?? 0) + 1);
    const missing: string[] = [];
    let matched = 0;
    for (const [k, n] of need) {
      const h = have.get(k) ?? 0;
      matched += Math.min(h, n);
      for (let i = h; i < n; i += 1) missing.push(k);
    }
    if (matched === 0) throw new Error(`CW-A refused: 0 of ${before.length} baseline band faces match after`);
    if (missing.length > 0) {
      throw new Error(`CW-A refused: ${missing.length} band faces lost, e.g. ${missing.slice(0, 2).join(" ; ")}`);
    }
    return { matched, missing };
  };

  it("CW-A: the V-neck opening band keeps every visible face (after superset of before)", () => {
    const live = readGlb(LIVE_GLB);
    const base = readBaselineGlb();
    const before = bandFacesOf(base);
    const after = bandFacesOf(live);
    expect(before.faces.length, "baseline band is non-empty").toBeGreaterThan(0);
    console.log("CW-A neckline band", {
      rule: AISHA_SWEATER_NECKLINE_BAND,
      neckEdges: after.neckEdges,
      before: before.faces.length,
      after: after.faces.length,
    });
    const { matched } = assertBandSuperset(before.faces, after.faces);
    expect(matched, "baseline band faces matched after").toBe(before.faces.length);
  });

  it("CW-A refuses an empty or zero-match baseline band", () => {
    const live = readGlb(LIVE_GLB);
    const after = bandFacesOf(live);
    expect(() => assertBandSuperset([], after.faces)).toThrow(/baseline neckline band is empty/);
    expect(() => assertBandSuperset(after.faces, [])).toThrow(/0 of .* baseline band faces match/);
  });

  it("CW-A names the face a known-bad shift removes", () => {
    // Illustrative non-spec offset: +7.3 mm in X moves one band face off its
    // pinned position; the comparison must fail naming that face as missing.
    const live = readGlb(LIVE_GLB);
    const base = readBaselineGlb();
    const before = bandFacesOf(base).faces;
    const afterFaces = bandFacesOf(live).faces;
    expect(before.length, "baseline band is non-empty").toBeGreaterThan(0);
    const keyCounts = new Map<string, number>();
    for (const f of afterFaces) keyCounts.set(f.key, (keyCounts.get(f.key) ?? 0) + 1);
    const victim = afterFaces.find((f) => keyCounts.get(f.key) === 1);
    expect(victim, "a unique band face exists for the known-bad probe").toBeDefined();
    const moved = [...victim!.verts];
    moved[0]! += 0.0073;
    moved[3]! += 0.0073;
    moved[6]! += 0.0073;
    const movedCentroid: readonly [number, number, number] = [
      victim!.centroid[0] + 0.0073,
      victim!.centroid[1],
      victim!.centroid[2],
    ];
    console.log("CW-A known-bad substitution", {
      faceKey: victim!.key,
      beforeCentroid: victim!.centroid,
      afterCentroid: movedCentroid,
      shiftMm: 7.3,
    });
    const mutated: BandFace[] = [
      { key: aishaSweaterFaceKey(moved), centroid: movedCentroid, verts: moved },
      ...afterFaces.filter((f) => f !== victim),
    ];
    let err = "";
    try {
      assertBandSuperset(before, mutated);
    } catch (e) {
      err = (e as Error).message;
    }
    expect(err, "known-bad shift fails loudly").toContain("band faces lost");
    expect(err, "the shifted face is named as missing").toContain(victim!.key);
  });

  it("CW-B: every newly hidden face lies in a shirt-covered shoulder region (region check)", () => {
    // Region check (not a garment-coverage proof): bind-space XY centroids of
    // the newly hidden tris must fall inside the shirt-covered shoulder boxes
    // (CW-B shoulder regions, from shirt anatomy); the measured split is
    // pinned at exactly shoulderL 10 / shoulderR 10 / other 0.
    const live = readGlb(LIVE_GLB);
    const liveBody = bodyMesh(live.doc);
    const mats = live.doc.materials.map((m) => m.name);
    const liveSkin = liveBody.primitives.find((p) => mats[p.material] === "mpfb_skin_ob_patient_aisha_v1")!;
    const hidden = liveBody.primitives.filter(
      (p) => mats[p.material]!.startsWith("openclinxr_hidden_") && p.attributes.POSITION === liveSkin.attributes.POSITION,
    )[0]!;
    const pos = positionArray(live.doc, live.binary, liveSkin.attributes.POSITION);
    const hiddenIdx = indexArray(live.doc, live.binary, hidden.indices);
    // Newly hidden = hidden-prim tris (their centroids classify the region).
    const counts: { shoulderL: number; shoulderR: number; other: number } = { shoulderL: 0, shoulderR: 0, other: 0 };
    for (let t = 0; t < hiddenIdx.length; t += 3) {
      const cx = (pos[hiddenIdx[t]! * 3]! + pos[hiddenIdx[t + 1]! * 3]! + pos[hiddenIdx[t + 2]! * 3]!) / 3;
      const cy = (pos[hiddenIdx[t]! * 3 + 1]! + pos[hiddenIdx[t + 1]! * 3 + 1]! + pos[hiddenIdx[t + 2]! * 3 + 1]!) / 3;
      const region = aishaSweaterRegionOf([cx, cy], AISHA_SWEATER_SHOULDER_REGIONS);
      counts[region] = (counts[region] ?? 0) + 1;
    }
    console.log("CW-B hidden-face regions", { regions: AISHA_SWEATER_SHOULDER_REGIONS, counts });
    expect(counts, "measured hidden-face region split").toEqual({ shoulderL: 10, shoulderR: 10, other: 0 });
  });
});
