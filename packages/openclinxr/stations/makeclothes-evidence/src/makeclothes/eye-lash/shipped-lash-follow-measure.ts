import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import {
  add,
  aggregateMesh,
  barycentric,
  closest,
  connectedCards,
  connectedComponents,
  counterweights,
  dot,
  exactMedian,
  interpolateUpperHull,
  matched,
  mutateGlbCopy,
  norm,
  pct,
  rayInside,
  sub,
  target,
  unit,
  upperHull,
  vecs,
} from "./shipped-lash-follow-geometry.js";
import {
  ACTORS,
  CLOSURE,
  GLB_DIR,
  MOVE_EPS_M,
  PRESERVED_F4,
  RED_QUADS,
  REPORT_PATH,
  ROOT,
  UP_AXIS,
  WELD_TOLERANCE_M,
  type ActorMeasurement,
  type Distribution,
  type EnvelopeCard,
  type EnvelopeSummary,
  type F4Diagnostic,
  type HullVertex,
  type Mutation,
  type RegionTri,
  type Side,
  type SideMeasurement,
  type Tri,
  type V3,
} from "./shipped-lash-follow-types.js";

export { exactMedian, interpolateUpperHull, upperHull };
export { ACTORS, REPORT_PATH };
export type { ActorMeasurement, HullVertex, Mutation, SideMeasurement };
export async function measureActor(file: string, mutation: Mutation = "none"): Promise<ActorMeasurement> {
  const path = join(GLB_DIR, file);
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const shippedBytes = readFileSync(path);
  let effectiveBytes: Uint8Array<ArrayBufferLike> = new Uint8Array(shippedBytes);
  let doc = await io.readBinary(effectiveBytes);
  let mutationProof: ActorMeasurement["mutationProof"];
  if (mutation !== "none") {
    const mutated = await mutateGlbCopy(io, doc, file, mutation);
    doc = mutated.doc;
    effectiveBytes = mutated.bytes;
    mutationProof = mutated.proof;
  }
  const baseBytes = execFileSync("git", ["show", `origin/main:apps/ui-xr/public/generated-humanoids/${file}`], { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 });
  const base = await io.readBinary(new Uint8Array(baseBytes));
  const { body, lash } = matched(doc, file);
  const { lash: baseLash } = matched(base, file);
  const bodyMesh = body.getMesh()!, lashMesh = lash.getMesh()!, lashPrim = lashMesh.listPrimitives()[0]!;
  const names = (bodyMesh.getExtras() as { targetNames?: string[] }).targetNames ?? [];
  const lashNames = (lashMesh.getExtras() as { targetNames?: string[] } | null)?.targetNames ?? [];
  const aggregateBody = aggregateMesh(bodyMesh, names);
  const B = aggregateBody.points, idx = aggregateBody.indices;
  const L = vecs(lashPrim.getAttribute("POSITION")!);
  const mins: V3 = [Math.min(...L.map((p) => p[0])) - 0.02, Math.min(...L.map((p) => p[1])) - 0.02, Math.min(...L.map((p) => p[2])) - 0.02];
  const maxs: V3 = [Math.max(...L.map((p) => p[0])) + 0.02, Math.max(...L.map((p) => p[1])) + 0.02, Math.max(...L.map((p) => p[2])) + 0.02];
  const intersectsBox = (tri: Tri) => [0, 1, 2].every((axis) =>
    Math.max(...tri.map((p) => p[axis]!)) >= mins[axis]!
    && Math.min(...tri.map((p) => p[axis]!)) <= maxs[axis]!,
  );
  const nearbyTris: Array<{ tri: Tri; ids: [number, number, number]; triId: number }> = [];
  for (let i = 0; i + 2 < idx.length; i += 3) {
    const ids: [number, number, number] = [Number(idx[i]), Number(idx[i + 1]), Number(idx[i + 2])];
    const tri: Tri = [B[ids[0]]!, B[ids[1]]!, B[ids[2]]!];
    if (intersectsBox(tri)) nearbyTris.push({ tri, ids, triId: i / 3 });
  }
  const eyeNode = doc.getRoot().listNodes().filter((n) => n.getMesh() && /eye/i.test(`${n.getName()} ${n.getMesh()?.getName()}`) && !/eyelash|eyebrow/i.test(`${n.getName()} ${n.getMesh()?.getName()}`));
  if (eyeNode.length !== 1) throw new Error(`${file}: CW3 eyeball/cornea match count ${eyeNode.length}`);
  const eyeMesh = eyeNode[0]?.getMesh();
  if (!eyeMesh) throw new Error(`${file}: CW3 eyeball/cornea mesh missing`);
  const aggregateEye = aggregateMesh(eyeMesh);
  const eyePoints = aggregateEye.points;
  const eyeShells = connectedComponents(eyePoints.length, aggregateEye.indices);
  if (eyeShells.length !== 2) throw new Error(`${file}: CW3 expected two connected eye shells, found ${eyeShells.length}`);
  const basePosition = baseLash.getMesh()?.listPrimitives()[0]?.getAttribute("POSITION");
  if (!basePosition) throw new Error(`${file}: CW3 origin/main lash POSITION missing`);
  const basePoints = vecs(basePosition);
  const cards = connectedCards(lashPrim);
  const basePrim = baseLash.getMesh()?.listPrimitives()[0];
  if (!basePrim) throw new Error(`${file}: CW3 origin/main lash primitive missing`);
  const baseCards = connectedCards(basePrim);
  if (cards.length !== baseCards.length || cards.some((card, index) =>
    card.indices.join(",") !== baseCards[index]?.indices.join(","))) {
    throw new Error(`${file}: G3 connected-component topology differs from origin/main`);
  }
  const bodyDeltas = {} as Record<Side, V3[]>;
  const regions = {} as Record<Side, RegionTri[]>;
  const ownRegionCounts = {} as Record<Side, { r6: number; r7: number }>;
  const eyeCentres = {} as Record<Side, V3>;
  const eyeProofAabbs = {} as Record<Side, { min: V3; max: V3 }>;
  const eyeTrisBySide = {} as Record<Side, Tri[]>;
  for (const side of ["left", "right"] as const) {
    const delta = aggregateBody.deltas[CLOSURE[side]];
    if (!delta) throw new Error(`${file} ${side}: CW3 body closure target missing`);
    bodyDeltas[side] = delta;
    const moving = delta.map((d) => norm(d) > MOVE_EPS_M);
    const movingIds = moving.map((value, index) => ({ value, index })).filter(({ value }) => value).map(({ index }) => index);
    const sideSign = movingIds.reduce((sum, id) => sum + B[id]![0], 0) >= 0 ? 1 : -1;
    const matchingShells = eyeShells.filter((shell) =>
      shell.reduce((sum, index) => sum + eyePoints[index]![0], 0) / shell.length * sideSign > 0,
    );
    if (matchingShells.length !== 1) throw new Error(`${file} ${side}: connected eye-shell side matches ${matchingShells.length}`);
    const ownShell = matchingShells[0]!, ownShellSet = new Set(ownShell);
    const ownEye = ownShell.map((index) => eyePoints[index]!);
    if (ownEye.length < 10) throw new Error(`${file} ${side}: eye shell has ${ownEye.length} side verts`);
    const eyeCentre = [0, 1, 2].map((axis) => ownEye.reduce((sum, point) => sum + point[axis]!, 0) / ownEye.length) as V3;
    const eyeMin = [0, 1, 2].map((axis) => Math.min(...ownEye.map((point) => point[axis]!))) as V3;
    const eyeMax = [0, 1, 2].map((axis) => Math.max(...ownEye.map((point) => point[axis]!))) as V3;
    eyeCentres[side] = eyeCentre;
    eyeProofAabbs[side] = { min: eyeMin, max: eyeMax };
    eyeTrisBySide[side] = [];
    for (let i = 0; i + 2 < aggregateEye.indices.length; i += 3) {
      const ids = [aggregateEye.indices[i]!, aggregateEye.indices[i + 1]!, aggregateEye.indices[i + 2]!] as const;
      if (ids.every((index) => ownShellSet.has(index))) eyeTrisBySide[side].push([
        eyePoints[ids[0]]!, eyePoints[ids[1]]!, eyePoints[ids[2]]!,
      ]);
    }
    const selected: RegionTri[] = [];
    for (let i = 0; i + 2 < idx.length; i += 3) {
      const ids: [number, number, number] = [Number(idx[i]), Number(idx[i + 1]), Number(idx[i + 2])];
      const tri: Tri = [B[ids[0]]!, B[ids[1]]!, B[ids[2]]!];
      const centroid = [0, 1, 2].map((axis) => tri.reduce((sum, point) => sum + point[axis]!, 0) / 3) as V3;
      if (ids.some((v) => moving[v]) && centroid[UP_AXIS] > eyeCentre[UP_AXIS]) selected.push({ tri, ids, triId: i / 3, lid: "upper" });
      const insideEyeAabb = [0, 1, 2].every((axis) => centroid[axis]! >= eyeMin[axis]! && centroid[axis]! <= eyeMax[axis]!);
      if (insideEyeAabb && centroid[UP_AXIS] < eyeCentre[UP_AXIS]) selected.push({ tri, ids, triId: i / 3, lid: "lower" });
    }
    if (!selected.length) throw new Error(`${file} ${side}: CW3 no closure-region triangles at epsilon ${MOVE_EPS_M}m`);
    regions[side] = selected;
    ownRegionCounts[side] = {
      r6: selected.filter(({ ids, lid }) => lid === "upper" && ids.every((v) => moving[v])).length,
      r7: selected.filter(({ lid }) => lid === "upper").length,
    };
    if (!(regions[side].some(({ lid }) => lid === "upper") && regions[side].some(({ lid }) => lid === "lower"))) {
      throw new Error(`${file} ${side}: CW3 glTF y-up split did not produce upper and lower regions`);
    }
  }
  const eyeLine = sub(eyeCentres.right, eyeCentres.left);
  eyeLine[UP_AXIS] = 0;
  const horizontalAxis = unit(eyeLine);
  const hulls = {} as Record<Side, { points: HullVertex[] }>;
  for (const side of ["left", "right"] as const) {
    const project = (point: V3) => dot(sub(point, eyeCentres[side]), horizontalAxis);
    const moving = B.map((point, vertexId) => ({
      vertexId, point, x: project(point), dy: bodyDeltas[side][vertexId]![UP_AXIS],
    })).filter(({ point, dy }) => point[UP_AXIS] > eyeCentres[side][UP_AXIS] && Math.abs(dy) > MOVE_EPS_M);
    const points = upperHull(moving.map(({ vertexId, x, dy }) => ({
      vertexId, x, dyMm: dy * 1000, source: "body" as const,
    })));
    hulls[side] = { points };
  }
  const distanceTo = (point: V3, tris: Tri[]) => tris.reduce((best, tri) =>
    Math.min(best, norm(sub(point, closest(point, tri)))), Number.POSITIVE_INFINITY);
  const meanPoint = (indices: number[], points: V3[]): V3 => [0, 1, 2].map((axis) =>
    indices.reduce((sum, index) => sum + points[index]![axis]!, 0) / indices.length,
  ) as V3;
  const cardBindings = baseCards.map((baseCard, index) => {
    const rootCandidates = baseCard.indices.map((vertexIndex) => ({
      vertexIndex,
      distance: Math.min(...(["left", "right"] as const).flatMap((regionSide) =>
        regions[regionSide].map(({ tri }) => norm(sub(basePoints[vertexIndex]!, closest(basePoints[vertexIndex]!, tri)))),
      )),
    })).sort((a, b) => a.distance - b.distance || a.vertexIndex - b.vertexIndex);
    const rootIndices = rootCandidates.slice(0, Math.ceil(baseCard.indices.length / 2)).map(({ vertexIndex }) => vertexIndex).sort((a, b) => a - b);
    const rootCentroid = meanPoint(rootIndices, basePoints);
    const side = (["left", "right"] as const).map((candidateSide) => ({
      side: candidateSide,
      distance: distanceTo(rootCentroid, regions[candidateSide].map(({ tri }) => tri)),
    })).sort((a, b) => a.distance - b.distance || a.side.localeCompare(b.side))[0]!.side;
    const lid: "upper" | "lower" = rootCentroid[UP_AXIS] > eyeCentres[side][UP_AXIS] ? "upper" : "lower";
    const ownRegions = regions[side].filter((region) => region.lid === lid);
    let bound: { rootVertexIndex: number; region: RegionTri; regionIndex: number; point: V3; distance: number } | null = null;
    for (const rootVertexIndex of rootIndices) {
      const basePoint = basePoints[rootVertexIndex]!;
      for (const [regionIndex, region] of ownRegions.entries()) {
        const point = closest(basePoint, region.tri);
        const distance = norm(sub(basePoint, point));
        const translatedRootUp = rootCentroid[UP_AXIS] + point[UP_AXIS] - basePoint[UP_AXIS];
        const preservesClass = lid === "upper"
          ? translatedRootUp > eyeCentres[side][UP_AXIS]
          : translatedRootUp <= eyeCentres[side][UP_AXIS];
        if (!preservesClass) continue;
        if (!bound || distance < bound.distance || (distance === bound.distance && rootVertexIndex < bound.rootVertexIndex)) {
          bound = { rootVertexIndex, region, regionIndex, point, distance };
        }
      }
    }
    if (!bound) throw new Error(`${file} card ${index}: no own ${side} ${lid} region triangle`);
    const weights = barycentric(bound.point, bound.region.tri);
    const donor = bound.region.ids.map((id) => bodyDeltas[side][id]!);
    const donorDelta: V3 = [0, 1, 2].map((axis) => donor.reduce((sum, d, i) => sum + d[axis]! * weights[i]!, 0)) as V3;
    return { card: cards[index]!, index, rootIndices, side, lid, ...bound, donorDelta, snapM: bound.distance };
  });
  const closedNearby = Object.fromEntries((["left", "right"] as const).map((side) => [side, nearbyTris.map(({ ids }) =>
    ids.map((id) => add(B[id]!, bodyDeltas[side][id]!)) as Tri,
  )])) as Record<Side, Tri[]>;
  const restNearby = nearbyTris.map(({ tri }) => tri);
  const sides = {} as Record<Side, SideMeasurement>;
  for (const side of ["left", "right"] as const) {
    const sideCards = cardBindings.filter((binding) => binding.side === side);
    const lashDelta = target(lashPrim, lashNames, CLOSURE[side]);
    const isPreservedF4 = (binding: typeof sideCards[number]) =>
      (PRESERVED_F4[file]?.[side] ?? []).includes(binding.index);
    const cardDeltas = lashDelta ? sideCards.map(({ card }) => meanPoint(card.indices, lashDelta)) : [];
    const nonMovingCards = lashDelta ? cardDeltas.filter((d) => norm(d) <= MOVE_EPS_M).length : sideCards.length;
    const upperCards = sideCards.filter(({ lid }) => lid === "upper");
    const lowerCards = sideCards.filter(({ lid }) => lid === "lower");
    const lowerRootIndices = lowerCards.flatMap(({ rootIndices }) => rootIndices);
    const eyeAabb = eyeProofAabbs[side];
    const project = (point: V3) => dot(sub(point, eyeCentres[side]), horizontalAxis);
    const measureEnvelope = (bindings: typeof sideCards): EnvelopeSummary => {
      const hull = hulls[side];
      if (hull.points.some(({ source }) => source !== "body")) throw new Error(`${file} ${side}: hull vertex is not a body vertex`);
      const interpolate = (x: number): number | null => interpolateUpperHull(hull.points, x);
      const rows: EnvelopeCard[] = bindings.map((binding) => {
        const rootCentroidX = project(meanPoint(binding.rootIndices, basePoints));
        const rootDyMm = lashDelta
          ? binding.rootIndices.reduce((sum, index) => sum + lashDelta[index]![UP_AXIS], 0) * 1000 / binding.rootIndices.length
          : 0;
        const marginDyMm = interpolate(rootCentroidX);
        if (marginDyMm === null) return {
          cardId: binding.index, rootCentroidX, rootDyMm: Number(rootDyMm.toFixed(6)), marginDyMm: null,
          travelPct: null, sameDirection: false,
          noMarginReason: "card root centroid x is outside moving upper-lid hull span",
        };
        const travel = marginDyMm ? 100 * rootDyMm / marginDyMm : 0;
        return {
          cardId: binding.index, rootCentroidX, rootDyMm: Number(rootDyMm.toFixed(6)), marginDyMm: Number(marginDyMm.toFixed(6)),
          travelPct: Number(travel.toFixed(3)), sameDirection: rootDyMm * marginDyMm > 0,
        };
      });
      const valid = rows.filter((row): row is EnvelopeCard & { travelPct: number } => row.travelPct !== null);
      const values = valid.map((row) => row.travelPct);
      return {
        hullVertexCount: hull.points.length,
        hullVertices: hull.points.map((point) => ({ ...point, x: Number(point.x.toFixed(9)), dyMm: Number(point.dyMm.toFixed(6)) })),
        count: valid.length, p10: pct(values, .1),
        p50: values.length ? Number(exactMedian(values).toFixed(3)) : 0,
        p90: pct(values, .9),
        under80: valid.filter((row) => row.travelPct < 80).map((row) => row.cardId),
        over120: valid.filter((row) => row.travelPct > 120).map((row) => row.cardId),
        noMargin: rows.filter((row) => row.travelPct === null).map((row) => row.cardId),
        sameDirection: valid.every((row) => row.sameDirection), cards: rows,
      };
    };
    const g1Upper = measureEnvelope(upperCards);
    const g1Lower = measureEnvelope(lowerCards);
    const lashMeanDyMm = g1Upper.cards.length
      ? g1Upper.cards.reduce((sum, row) => sum + row.rootDyMm, 0) / g1Upper.cards.length : 0;
    const lidMarginMeanDyMm = g1Upper.cards.filter((row) => row.marginDyMm !== null)
      .reduce((sum, row) => sum + row.marginDyMm!, 0) / Math.max(1, g1Upper.count);
    const lowerLashMeanDyMm = lashDelta && lowerRootIndices.length
      ? lowerRootIndices.reduce((sum, index) => sum + lashDelta[index]![UP_AXIS], 0) * 1000 / lowerRootIndices.length : 0;
    const travelPct = g1Upper.p50;
    const snaps = sideCards.map(({ snapM }) => snapM * 1000);
    const closed = lashDelta ? L.map((p, i) => add(p, lashDelta[i] ?? [0, 0, 0])) : L;
    const g2 = sideCards.map((binding) => {
      const restRoot = L[binding.rootVertexIndex]!;
      const closedRoot = closed[binding.rootVertexIndex]!;
      const restOwn = regions[side].filter(({ lid }) => lid === binding.lid).map(({ tri }) => tri);
      const closedOwn = regions[side].filter(({ lid }) => lid === binding.lid).map(({ ids }) =>
        ids.map((id) => add(B[id]!, bodyDeltas[side][id]!)) as Tri,
      );
      return {
        restOwn: distanceTo(restRoot, restOwn) * 1000,
        restGeneral: distanceTo(restRoot, restNearby) * 1000,
        closedOwn: distanceTo(closedRoot, closedOwn) * 1000,
        closedGeneral: distanceTo(closedRoot, closedNearby[side]) * 1000,
      };
    });
    const mismatches = sideCards.filter((binding) => {
      if (!lashDelta) return true;
      const expected = isPreservedF4(binding) ? [0, 0, 0] as V3 : binding.donorDelta;
      return binding.card.indices.some((index) => norm(sub(lashDelta[index]!, expected)) > 2e-6);
    }).map(({ index }) => index);
    const flagged = sideCards.filter(isPreservedF4).map(({ index }) => index);
    const f4Diagnostic: F4Diagnostic[] = sideCards.filter(isPreservedF4).map((binding) => {
      const nearest = nearbyTris.map((candidate) => ({
        candidate,
        distance: Math.min(...binding.rootIndices.map((rootIndex) =>
          norm(sub(basePoints[rootIndex]!, closest(basePoints[rootIndex]!, candidate.tri))),
        )),
      })).sort((a, b) => a.distance - b.distance || a.candidate.triId - b.candidate.triId)[0];
      if (!nearest) throw new Error(`${file} ${side} card ${binding.index}: no general body triangle`);
      const ids = nearest.candidate.ids;
      const centroidY = ids.reduce((sum, id) => sum + B[id]![UP_AXIS], 0) / 3;
      const movingCount = ids.filter((id) => norm(bodyDeltas[side][id]!) > MOVE_EPS_M).length;
      return {
        cardId: binding.index,
        nearestGeneralBodyTriId: nearest.candidate.triId,
        closureMeanAbsDyMm: Number((ids.reduce((sum, id) => sum + Math.abs(bodyDeltas[side][id]![UP_AXIS]), 0) * 1000 / 3).toFixed(6)),
        centroid: centroidY > eyeCentres[side][UP_AXIS] ? "above" : "below",
        distanceToRootBandMm: Number((nearest.distance * 1000).toFixed(6)),
        movement: movingCount === 3 ? "all" : movingCount === 0 ? "static" : "some",
      };
    });
    const f4DiagnosticSummary = Object.fromEntries(
      (["above", "below"] as const).flatMap((height) =>
        (["all", "some", "static"] as const).map((movement) => [
          `${height}_${movement}`,
          f4Diagnostic.filter((row) => row.centroid === height && row.movement === movement).length,
        ]),
      ),
    );
    const weakCandidates = upperCards.flatMap((binding) => {
      const measured = g1Upper.cards.find(({ cardId }) => cardId === binding.index);
      if (!measured || measured.travelPct === null || measured.marginDyMm === null) return [];
      const beforeTravelPct = measured.travelPct;
      const marginDyMm = measured.marginDyMm;
      return regions[side].filter(({ lid, ids }) =>
        lid === "upper" && ids.filter((id) => norm(bodyDeltas[side][id]!) > MOVE_EPS_M).length === 1,
      ).flatMap((region) => {
        const movingId = region.ids.find((id) => norm(bodyDeltas[side][id]!) > MOVE_EPS_M);
        if (movingId === undefined) return [];
        const movingVertexDyMm = bodyDeltas[side][movingId]![UP_AXIS] * 1000;
        if (!(Math.abs(movingVertexDyMm) < .1 * Math.abs(marginDyMm))) return [];
        const seats = binding.rootIndices.flatMap((rootVertexIndex) => {
          const point = closest(basePoints[rootVertexIndex]!, region.tri);
          const translatedRootUp = meanPoint(binding.rootIndices, basePoints)[UP_AXIS]
            + point[UP_AXIS] - basePoints[rootVertexIndex]![UP_AXIS];
          if (!(translatedRootUp > eyeCentres[side][UP_AXIS])) return [];
          const weights = barycentric(point, region.tri);
          const donor = region.ids.map((id) => bodyDeltas[side][id]!);
          const donorDelta: V3 = [0, 1, 2].map((axis) =>
            donor.reduce((sum, delta, i) => sum + delta[axis]! * weights[i]!, 0),
          ) as V3;
          return [{
            rootVertexIndex,
            point,
            weights,
            donorDelta,
            distance: norm(sub(basePoints[rootVertexIndex]!, point)),
          }];
        }).sort((a, b) => a.distance - b.distance || a.rootVertexIndex - b.rootVertexIndex);
        const seat = seats[0];
        if (!seat) return [];
        const afterTravelPct = 100 * (seat.donorDelta[UP_AXIS] * 1000) / marginDyMm;
        if (!(afterTravelPct < 80)) return [];
        return [{
          distance: seat.distance,
          cardId: binding.index,
          beforeTriId: binding.region.triId,
          afterTriId: region.triId,
          beforeTravelPct,
          afterTravelPct: Number(afterTravelPct.toFixed(3)),
          beforeUnder80: beforeTravelPct < 80,
          afterUnder80: afterTravelPct < 80,
          movingVertexId: movingId,
          movingVertexDyMm: Number(movingVertexDyMm.toFixed(6)),
          hullDyMm: Number(marginDyMm.toFixed(6)),
          seatRootVertexId: seat.rootVertexIndex,
          seatBarycentric: seat.weights.map((value) => Number(value.toFixed(9))) as V3,
        }];
      });
    }).sort((a, b) => Number(a.beforeUnder80) - Number(b.beforeUnder80)
      || a.distance - b.distance || a.cardId - b.cardId || a.afterTriId - b.afterTriId);
    const g1Counterweight = weakCandidates.length ? (({ distance: _distance, ...probe }) => probe)(weakCandidates[0]!) : null;
    const r3ByCard = sideCards.map(({ card, index }) => {
      const mainRest = card.indices.filter((i) => rayInside(basePoints[i]!, eyeTrisBySide[side])).length;
      const mainClosed = mainRest;
      const patchedRest = card.indices.filter((i) => rayInside(L[i]!, eyeTrisBySide[side])).length;
      const patchedClosed = card.indices.filter((i) => rayInside(closed[i]!, eyeTrisBySide[side])).length;
      return { cardId: index, mainRest, mainClosed, patchedRest, patchedClosed };
    });
    const eyeballInsideMainRest = r3ByCard.reduce((sum, row) => sum + row.mainRest, 0);
    const eyeballInsideMainClosed = r3ByCard.reduce((sum, row) => sum + row.mainClosed, 0);
    const eyeballInsideRest = r3ByCard.reduce((sum, row) => sum + row.patchedRest, 0);
    const eyeballInsideClosed = r3ByCard.reduce((sum, row) => sum + row.patchedClosed, 0);
    const r3NoNewPenetration = r3ByCard.every((row) => row.patchedRest <= row.mainRest && row.patchedClosed <= row.mainClosed);
    const cardsBase = sideCards.filter(({ index }) => index < baseCards.length).length;
    const cardsKeep = sideCards.length;
    const sameDirection = g1Upper.sameDirection;
    const patchedClass = new Map(sideCards.map((binding) => [binding.index,
      meanPoint(binding.rootIndices, L)[UP_AXIS] > eyeCentres[side][UP_AXIS] ? "upper" : "lower",
    ]));
    const classChangedCardIds = sideCards.filter((binding) => patchedClass.get(binding.index) !== binding.lid).map(({ index }) => index);
    const distribution = (values: number[]): Distribution => ({ p50: pct(values, 0.5), p90: pct(values, 0.9), max: pct(values, 1) });
    const allG2Under1 = g2.every((row) => row.restOwn <= 1 && row.restGeneral <= 1 && row.closedOwn <= 1 && row.closedGeneral <= 1);
    sides[side] = {
      cardsBase, cardsKeep, keepRatio: cardsBase ? cardsKeep / cardsBase : 0,
      rawUpperCards: upperCards.length, rawLowerCards: lowerCards.length,
      upperCards: [...patchedClass.values()].filter((value) => value === "upper").length,
      lowerCards: [...patchedClass.values()].filter((value) => value === "lower").length,
      classChangedCardIds,
      flaggedByClass: {
        upper: sideCards.filter((binding) => binding.lid === "upper" && isPreservedF4(binding)).map(({ index }) => index),
        lower: sideCards.filter((binding) => binding.lid === "lower" && isPreservedF4(binding)).map(({ index }) => index),
      },
      flaggedOver4_55mmCount: flagged.length, flaggedOver4_55mmCardIds: flagged,
      seatFollowMismatchCards: mismatches,
      snap: distribution(snaps),
      g2RestOwnRegion: distribution(g2.map(({ restOwn }) => restOwn)),
      g2RestGeneralBody: distribution(g2.map(({ restGeneral }) => restGeneral)),
      g2ClosedOwnRegion: distribution(g2.map(({ closedOwn }) => closedOwn)),
      g2ClosedGeneralBody: distribution(g2.map(({ closedGeneral }) => closedGeneral)),
      cardsOver1mmRestOwnRegion: g2.filter(({ restOwn }) => restOwn > 1).length,
      cardsOver1mmRestGeneralBody: g2.filter(({ restGeneral }) => restGeneral > 1).length,
      cardsOver1mmClosedOwnRegion: g2.filter(({ closedOwn }) => closedOwn > 1).length,
      cardsOver1mmClosedGeneralBody: g2.filter(({ closedGeneral }) => closedGeneral > 1).length,
      lidMarginVerts: g1Upper.count,
      bodyPrimitiveCount: bodyMesh.listPrimitives().length,
      boundaryLoopCount: 0,
      eyeOpeningLoopVerts: 0,
      eyeOpeningLoopStatus: "no-eye-opening-loop",
      marginMode: "moving-upper-lid-upper-hull",
      horizontalAxis,
      ownRegionTriCountR6: ownRegionCounts[side].r6,
      ownRegionTriCountR7: ownRegionCounts[side].r7,
      g1Upper,
      g1Lower,
      f4Diagnostic,
      f4DiagnosticSummary,
      g1TallyExcluded: file === "mpfb-clinical-physician-adult.glb",
      g1Counterweight,
      eyeCentre: eyeCentres[side], lowerProofAabb: eyeAabb,
      lashMeanDyMm: Number(lashMeanDyMm.toFixed(3)), lidMarginMeanDyMm: Number(lidMarginMeanDyMm.toFixed(3)),
      lowerLashMeanDyMm: Number(lowerLashMeanDyMm.toFixed(3)),
      travelPct: Number(travelPct.toFixed(1)), sameDirection, targetPresent: Boolean(lashDelta), nonMovingCards,
      eyeballInsideMainRest, eyeballInsideMainClosed, eyeballInsideRest, eyeballInsideClosed,
      r3NoNewPenetration, r3ByCard,
      pass: flagged.length === 0 && mismatches.length === 0 && classChangedCardIds.length === 0
        && g1Upper.count > 0 && g1Upper.p50 >= 80 && g1Upper.p50 <= 120
        && sameDirection && allG2Under1 && cardsKeep / cardsBase >= 0.95
        && r3NoNewPenetration,
    };
  }
  return { actor: basename(file, ".glb"), inputSha256: createHash("sha256").update(effectiveBytes).digest("hex"), lashMesh: lashMesh.getName(), bodyMesh: bodyMesh.getName(), sides, counterweights: counterweights(doc, base, file), ...(mutationProof ? { mutationProof } : {}) };
}

export async function measureAllAndWrite(): Promise<ActorMeasurement[]> {
  const actors: ActorMeasurement[] = [];
  for (const file of ACTORS) actors.push(await measureActor(file));
  writeFileSync(REPORT_PATH, `${JSON.stringify({
    schemaVersion: "openclinxr.shipped-lash-follow-report.v6",
    measurement: {
      closureDeltaEpsilonM: MOVE_EPS_M,
      boundaryWeldToleranceM: WELD_TOLERANCE_M,
      cardModel: "index-connected components; root band is the nearest ceil(component vertices / 2) to the closure-defined region union",
      lidRegion: "raw glTF y-up (axis 1 required): raw card class is root-band centroid above/below the matching connected eye-shell centroid; upper region is triangles with at least one moving vertex and centroid above eye centroid; lower region is unchanged; exact same own-region triangle seats and follows",
      g2: "point-to-triangle root-anchor gaps at closure weights 0 and 1 against both deformed own-region triangles and the general body surface intersecting the lash-local 20 mm proof AABB",
      g1: "form points (horizontal-axis x, abs(dy)) from moving upper-lid body vertices (abs(dy)>1e-6m, above eye centroid); take the monotone-chain upper convex hull and linearly interpolate its magnitude at each card root-centroid x, with sign from hull vertex dy; outside hull span is no_margin; measurable-card p50 is the true median (average middle pair for even N), p10/p90 retain lower-index percentile behavior; upper median must be 80..120 and every measurable card same-direction; with the hull as margin, the upper bound mainly guards the x2 closure probe and an overshooting target; lower cards are report-only",
      physicianExclusion: "mpfb-clinical-physician-adult L/R measured and reported but excluded from G1 tally (2 sides, 54 F4 cards) pending tsk_5427053465726368 because closure 1 folds the body lids into the socket",
      f4: ">4.55 mm is report-only: card remains at original position with zero closure delta; unreviewed flags fail acceptance",
      inside: "odd ray parity per connected eye shell; per-card origin/main at both weights is the baseline and patched counts must not increase",
      counterweights: "sha256 over semantic/type/component/count-framed accessor bytes per primitive; every named body target semantic is compared to origin/main",
    },
    redQuads: RED_QUADS,
    g1Tally: { sidesCounted: 22, sidesTotal: 24, excludedActor: "mpfb-clinical-physician-adult", excludedF4CardCount: 54 },
    actors,
  }, null, 2)}\n`);
  return actors;
}
