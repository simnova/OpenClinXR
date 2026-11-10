import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { repoRoot } from "@openclinxr/factory-station-core/runner";
import { applyBlinkClosureToRoot } from "@openclinxr/xr-dialogue/evidence-viseme";
// The runtime package owns `three`; this direct loader is used only to prove its public
// blink entrypoint against actual shipped GLB bytes without a browser.
// @ts-expect-error three's examples path has no declaration in this package's dependency graph.
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { beforeAll, describe, expect, it } from "vitest";
import { ACTORS, type ActorMeasurement, exactMedian, type HullVertex, interpolateUpperHull, measureActor, measureAllAndWrite, upperHull } from "./shipped-lash-follow-measure.js";

// LOOP BOUND (super-ceo, 2026-11-09): where the r8 hull G1 disagrees with native 1:1 mid-blink crops, the
// crops decide and G1 is report-only for that side. Each entry names its crop verdict. A side not listed
// here must still pass G1; adding a side needs a graded crop pair, never a widened band.
const VISIBILITY_RESTORE = "remove this entry when tsk_7b0d1bcf69bf7cb6 (visibility) lands; widening the 80..120 band is wrong";
const CROP_DECIDED_G1: Record<string, { verdict: string; restore: string }> = {
  "mpfb-clinical-nurse-adult:right": { verdict: "excluded: visibility (williams-R-c0.5-d007 crops show specks only; tsk_7b0d1bcf69bf7cb6)", restore: VISIBILITY_RESTORE },
  "mpfb-family-partner-adult:right": { verdict: "crop PASS (anna-R-c0.5-d012: skin band gone, strands on margin)", restore: "remove this entry when the hull G1 p50 for this side reads 80..120; widening the 80..120 band is wrong" },
  "mpfb-gown-adult-patient:right": { verdict: "excluded: visibility (shares the Hayes bake; robert-R-c0.5-d012 specks only; tsk_7b0d1bcf69bf7cb6)", restore: VISIBILITY_RESTORE },
  "mpfb-gown-ed-robert-hayes:right": { verdict: "excluded: visibility (robert-R-c0.5-d012 specks only; tsk_7b0d1bcf69bf7cb6)", restore: VISIBILITY_RESTORE },
};
// The physician is excluded from the G1/G2 tally (lids fold at closure 1, lashes buried).
const PHYSICIAN_RESTORE = "remove this exclusion when tsk_5427053465726368 (physician closure) lands; widening the 80..120 band is wrong";

let measured: ActorMeasurement[] = [];
beforeAll(async () => { measured = await measureAllAndWrite(); }, 600_000);

describe("the shipped MPFB lashes follow the lid", () => {
  it("enumerates the CARD's exact 12 shipped MPFB actors", () => {
    expect(ACTORS).toHaveLength(12);
    expect(new Set(ACTORS).size).toBe(12);
    expect(exactMedian([70, 90, 110, 150]), "even-N card p50 uses average middle pair").toBe(100);
  });

  it("G1 upper-hull fixtures and COUNTERWEIGHT stay conservative", () => {
    const p = (vertexId: number, x: number, dyMm: number): HullVertex => ({ vertexId, x, dyMm, source: "body" });
    const sparse = upperHull([p(0, 0, -6), p(1, 0.3, -8), p(2, 0.6, -6)]);
    const dense = upperHull([
      p(0, 0, -6), p(1, 0.3, -8), p(2, 0.6, -6),
      ...Array.from({ length: 21 }, (_, i) => p(3 + i, 0.05 + i * 0.025, -2)),
    ]);
    expect(dense).toEqual(sparse);
    expect(interpolateUpperHull(sparse, 0.15), "card narrower than vertex spacing interpolates").toBeCloseTo(-7, 12);
    expect(interpolateUpperHull(sparse, 0.61), "outside hull span is no_margin").toBeNull();
    const staticFixture = [p(0, 0, -6), p(1, 0.3, 0), p(2, 0.6, -6)].filter(({ dyMm }) => Math.abs(dyMm) > 0.001);
    expect(upperHull(staticFixture).map(({ vertexId }) => vertexId), "static vertex is absent from the moving point set fixture").toEqual([0, 2]);
    const notchVert = p(1, 0.5, -2);
    const notchHull = upperHull([p(0, 0, -8), notchVert, p(2, 1, -8)]);
    const hullValue = interpolateUpperHull(notchHull, notchVert.x)!;
    console.log("COUNTERWEIGHT hull notch", { hullValue, notchVertValue: notchVert.dyMm });
    expect(Math.abs(hullValue)).toBeGreaterThan(Math.abs(notchVert.dyMm));
    expect(Math.abs(100 * -4 / hullValue), "hull over-read pushes travelPct down conservatively").toBeLessThan(Math.abs(100 * -4 / notchVert.dyMm));
  });

  it("F1-F5, G1-G3, R3 and CW1-CW3 hold actor-by-actor and side-by-side", () => {
    const failures: string[] = [];
    for (const actor of measured) {
      if (!actor.counterweights.bodyMorphsByteEqual) failures.push(`${actor.actor}: CW1 body morph accessor bytes differ from the pre-follow baseline (BASELINE_REF)`);
      if (!actor.counterweights.nonLashMeshesHashEqual) failures.push(`${actor.actor}: CW2 non-lash primitive accessor hash differs from the pre-follow baseline (BASELINE_REF)`);
      for (const side of ["left", "right"] as const) {
        const r = actor.sides[side];
        if (r.upperCards !== r.rawUpperCards || r.lowerCards !== r.rawLowerCards || r.classChangedCardIds.length) failures.push(`${actor.actor} ${side}: P1 raw class counts ${r.rawUpperCards}/${r.rawLowerCards} -> ${r.upperCards}/${r.lowerCards}, changed=${r.classChangedCardIds.join(",")}`);
        if (r.seatFollowMismatchCards.length) failures.push(`${actor.actor} ${side}: F1 seatTri==followTri/own-region closure mismatch cards=${r.seatFollowMismatchCards.join(",")}`);
        const expectedF4 = actor.actor === "mpfb-clinical-physician-adult" ? (side === "left" ? 30 : 24) : ({
          "mpfb-gown-adult-patient:right": 2,
          "mpfb-gown-ed-robert-hayes:right": 2,
          "mpfb-peds-nurse-kevin:right": 1,
        } as Record<string, number>)[`${actor.actor}:${side}`] ?? 0;
        if (r.flaggedOver4_55mmCount !== expectedF4) failures.push(`${actor.actor} ${side}: F4 expected ${expectedF4} zero-delta/unreviewed cards, got=${r.flaggedOver4_55mmCardIds.join(",")}`);
        const cropDecided = CROP_DECIDED_G1[`${actor.actor}:${side}`];
        if (r.g1TallyExcluded !== (actor.actor === "mpfb-clinical-physician-adult")) failures.push(`${actor.actor} ${side}: G1/G2 tally exclusion=${r.g1TallyExcluded} but only the physician is excluded; ${PHYSICIAN_RESTORE}`);
        if (r.marginMode !== "moving-upper-lid-upper-hull") failures.push(`${actor.actor} ${side}: G1 wrong margin mode=${r.marginMode}`);
        // With the hull as margin, the 120 upper bound mainly guards the x2 closure probe and an overshooting target.
        else if (cropDecided !== undefined) { if (!(r.g1Upper.count > 0)) failures.push(`${actor.actor} ${side}: G1 crop-decided side (${cropDecided.verdict}) has no measurable hull roots; ${cropDecided.restore}`); }
        else if (!r.g1TallyExcluded && !(r.g1Upper.count > 0 && r.g1Upper.p50 >= 80 && r.g1Upper.p50 <= 120 && r.g1Upper.sameDirection)) failures.push(`${actor.actor} ${side}: G1 hullVertices=${r.g1Upper.hullVertexCount} count=${r.g1Upper.count}, p50=${r.g1Upper.p50}, sameDirection=${r.g1Upper.sameDirection}, under80=${r.g1Upper.under80.join(",")}, over120=${r.g1Upper.over120.join(",")}, no_margin=${r.g1Upper.noMargin.join(",")}`);
        // G2: the listed F4 fit-defect cards stay zero-delta (ruling: listed, not snapped), so a side carries EXACTLY
        // its expectedF4 cards over 1 mm (max of the four counts): more is a new defect, fewer means the entry is stale.
        if (!r.g1TallyExcluded) {
          const over1 = Math.max(r.cardsOver1mmRestOwnRegion, r.cardsOver1mmRestGeneralBody, r.cardsOver1mmClosedOwnRegion, r.cardsOver1mmClosedGeneralBody);
          const counts = `restOwn=${r.cardsOver1mmRestOwnRegion} restGeneral=${r.cardsOver1mmRestGeneralBody} closedOwn=${r.cardsOver1mmClosedOwnRegion} closedGeneral=${r.cardsOver1mmClosedGeneralBody}`;
          if (over1 > expectedF4) failures.push(`${actor.actor} ${side}: G2 >1mm ${counts} exceeds the allowance ${expectedF4}${cropDecided ? `; ${cropDecided.restore}` : ""}`);
          else if (over1 < expectedF4) failures.push(`${actor.actor} ${side}: G2 >1mm ${counts} is below the allowance ${expectedF4}: lower the entry to ${over1}`);
        }
        if (r.keepRatio < 0.95) failures.push(`${actor.actor} ${side}: G3 keepRatio=${r.keepRatio}`);
        if (!r.r3NoNewPenetration) failures.push(`${actor.actor} ${side}: R3 new penetration main=${r.eyeballInsideMainRest}/${r.eyeballInsideMainClosed} patched=${r.eyeballInsideRest}/${r.eyeballInsideClosed}`);
      }
    }
    expect(failures, failures.join("\n")).toEqual([]);
  });

  it("R1 loads a shipped GLB and the public blink path drives lashes only while canonical target names remain", async () => {
    const file = join(repoRoot(), "apps/ui-xr/public/generated-humanoids/mpfb-ob-patient-aisha.glb");
    // Keep the shipped geometry/morph bytes but remove materials from this in-memory
    // transport copy: Node has no DOM image decoder and R1 is a morph-wire test.
    const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
    const shipped = await io.readBinary(new Uint8Array(readFileSync(file)));
    for (const mesh of shipped.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) prim.setMaterial(null);
    const bytes = await io.writeBinary(shipped);
    const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "");
    const meshes: Array<{ name: string; morphTargetDictionary?: Record<string, number>; morphTargetInfluences?: number[] }> = [];
    gltf.scene.traverse((o: object) => { if ("morphTargetDictionary" in o) meshes.push(o as typeof meshes[number]); });
    const lashMesh = meshes.find((m) => /eyelash/i.test(m.name));
    expect(lashMesh, "Aisha lash mesh loaded by GLTFLoader").toBeDefined();
    if (!lashMesh!.morphTargetInfluences?.length) {
      console.log("R1 pending owner bake: shipped Aisha lash has no closure targets; G1 is the binding RED");
      return;
    }
    const before = lashMesh!.morphTargetInfluences?.slice() ?? [];
    const driven = applyBlinkClosureToRoot(gltf.scene, 0.75);
    expect(driven.appliedTargetCount).toBeGreaterThanOrEqual(4);
    expect(lashMesh!.morphTargetInfluences).not.toEqual(before);
    const saved = { ...lashMesh!.morphTargetDictionary };
    lashMesh!.morphTargetDictionary = Object.fromEntries(Object.entries(saved).map(([k, v]) => [`renamed_${k}`, v]));
    lashMesh!.morphTargetInfluences = lashMesh!.morphTargetInfluences!.map(() => 0);
    const renamed = applyBlinkClosureToRoot(gltf.scene, 1);
    expect(lashMesh!.morphTargetInfluences.every((x) => x === 0), "renamed lash targets are not driven").toBe(true);
    expect(renamed.appliedTargetCount, "split body primitives still contribute closure targets").toBeGreaterThanOrEqual(2);
    expect(driven.appliedTargetCount - renamed.appliedTargetCount, "canonical lash names contribute two targets").toBe(2);
    lashMesh!.morphTargetDictionary = saved;
  });

  it("P1-P3 and the G1 body-vertex counterweight detect their own substitutions", async () => {
    const file = "mpfb-ob-patient-aisha.glb";
    const base = await measureActor(file);
    console.log("P0 restore", file, base.sides.left.travelPct, base.sides.right.travelPct);
    for (const side of ["left", "right"] as const) {
      expect(base.sides[side].targetPresent, `${file} ${side}: P0 canonical target prerequisite`).toBe(true);
      expect(base.sides[side].marginMode, `${file} ${side}: P0 hull mode`).toBe("moving-upper-lid-upper-hull");
      expect(base.sides[side].g1Upper.hullVertices.every((row) => row.source === "body"), `${file} ${side}: G1 hull vertices are body vertices`).toBe(true);
      const measurable = base.sides[side].g1Upper.cards.find((row) => row.travelPct !== null && Math.abs(row.rootDyMm) > 1e-9);
      if (measurable) {
        const trivialPct = 100 * measurable.rootDyMm / measurable.rootDyMm;
        console.log(`G1 counterweight own-root substitution before/after ${side}`, measurable.travelPct, trivialPct, "REFUSED marginSource=lash-root");
        expect(trivialPct).toBe(100);
        expect(base.sides[side].g1Upper.hullVertices.every(({ source }) => source === "body")).toBe(true);
      }
      const weak = base.sides[side].g1Counterweight;
      expect(weak, `${file} ${side}: r7 exactly-one-moving-vertex counterweight candidate`).not.toBeNull();
      if (weak) {
        console.log(`G1 one-moving-vert re-seat before/after ${side}`, weak);
        expect(weak.afterTravelPct).toBeLessThan(80);
        expect(weak.afterUnder80).toBe(true);
      }
      expect(base.sides[side].seatFollowMismatchCards, `${file} ${side}: P0 F1 prerequisite`).toEqual([]);
    }
    const stripped = await measureActor(file, "strip");
    console.log("P1 in-memory GLB strip before/after", file, stripped.mutationProof);
    expect(stripped.mutationProof?.beforeTargetMatches, `${file}: P1 before closure-target matches`).toBe(2);
    expect(stripped.mutationProof?.afterTargetMatches, `${file}: P1 after closure-target matches`).toBe(0);
    expect(stripped.mutationProof?.afterSha256, `${file}: P1 serialized GLB bytes changed`).not.toBe(stripped.mutationProof?.beforeSha256);
    for (const side of ["left", "right"] as const) {
      expect(stripped.sides[side].targetPresent, `${file} ${side}: P1 target missing`).toBe(false);
      expect(stripped.sides[side].travelPct, `${file} ${side}: P1 missing target has zero travel`).toBe(0);
    }
    for (const side of ["left", "right"] as const) {
      const doubled = await measureActor(file, `double-${side}`);
      console.log(`P2 in-memory GLB ${side} target x2 before/after`, file, doubled.mutationProof, doubled.sides[side].travelPct);
      expect(doubled.mutationProof?.beforeTargetMatches).toBe(2);
      expect(doubled.mutationProof?.afterTargetMatches).toBe(2);
      expect(doubled.mutationProof?.afterSha256, `${file} ${side}: P2 serialized GLB bytes changed`).not.toBe(doubled.mutationProof?.beforeSha256);
      expect(doubled.mutationProof?.targetDeltaAfterSha256, `${file} ${side}: P2 serialized target delta accessor changed`).not.toBe(doubled.mutationProof?.targetDeltaBeforeSha256);
      const baseDy = base.sides[side].lashMeanDyMm;
      const doubledDy = doubled.sides[side].lashMeanDyMm;
      expect(doubledDy, `${file} ${side}: P2 upper-root dy follows the serialized x2 mutation`).toBeCloseTo(baseDy * 2, 2);
      if (Math.abs(baseDy) > 1e-9) {
        expect(doubledDy, `${file} ${side}: P2 exact-band measured quantity changes non-vacuously`).not.toBeCloseTo(baseDy, 6);
      } else {
        expect(doubled.mutationProof?.afterSha256, `${file} ${side}: P2 zero-band pairing still proves serialized target delta mutation`).not.toBe(doubled.mutationProof?.beforeSha256);
      }
    }
    for (const side of ["left", "right"] as const) {
      const brow = await measureActor(file, `brow-${side}`);
      console.log(`P3 in-memory GLB ${side} one-card brow bind before/after`, file, brow.mutationProof, brow.sides[side].nonMovingCards);
      expect(brow.mutationProof?.beforeTargetMatches).toBe(2);
      expect(brow.mutationProof?.afterTargetMatches).toBe(2);
      expect(brow.mutationProof?.afterSha256, `${file} ${side}: P3 serialized GLB bytes changed`).not.toBe(brow.mutationProof?.beforeSha256);
      expect(brow.mutationProof?.browTriangleIds?.[side], `${file}: P3 ${side} brow triangle identified`).toHaveLength(3);
      expect(brow.sides[side].targetPresent, `${file} ${side}: P3 target remains present`).toBe(true);
      expect(brow.sides[side].seatFollowMismatchCards.length, `${file} ${side}: P3 catches a card whose closure no longer equals its own seat triangle`).toBeGreaterThanOrEqual(1);
    }
    const restored = await measureActor(file);
    console.log("P0 restored", file, restored.sides.left.travelPct, restored.sides.right.travelPct);
    expect(restored, `${file}: P0 exact measurement restored despite intentional acceptance RED`).toEqual(base);
  }, 600_000);
});
