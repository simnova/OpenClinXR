export type AxisAlignedBox = { min: [number, number, number]; max: [number, number, number] };

export type ActorVisibilityOccluder = {
  box: AxisAlignedBox;
  actorId: string | null;
  name: string;
};

export type ActorVisibilityReading = {
  actorId: string;
  crownVisible: boolean;
  visibleSampleCount: number;
  sampleCount: 5;
  visible: boolean;
  blockedSamples: Array<{ sample: string; blockedBy: string }>;
};

export const ACTOR_VISIBILITY_METHOD =
  "camera rays to crown, chest, pelvis, left foot and right foot; visible mesh world-AABB intersections; own actor excluded; crown plus 3/4 other samples required";

type Point = [number, number, number];

function samplesFor(box: AxisAlignedBox, recumbent = false): Array<{ name: string; point: Point }> {
  const width = box.max[0] - box.min[0];
  const height = box.max[1] - box.min[1];
  const depth = box.max[2] - box.min[2];
  const cx = (box.min[0] + box.max[0]) / 2;
  const cz = (box.min[2] + box.max[2]) / 2;
  if (recumbent) {
    const top = box.max[1] - height * 0.08;
    const alongX = width >= depth;
    const point = (fraction: number, minorOffset = 0): Point => alongX
      ? [box.min[0] + width * fraction, top, cz + depth * minorOffset]
      : [cx + width * minorOffset, top, box.min[2] + depth * fraction];
    return [
      { name: "crown", point: point(0.1) },
      { name: "chest", point: point(0.32) },
      { name: "pelvis", point: point(0.58) },
      { name: "left_foot", point: point(0.88, -0.18) },
      { name: "right_foot", point: point(0.88, 0.18) },
    ];
  }
  return [
    { name: "crown", point: [cx, box.min[1] + height * 0.9, cz] },
    { name: "chest", point: [cx, box.min[1] + height * 0.65, cz] },
    { name: "pelvis", point: [cx, box.min[1] + height * 0.42, cz] },
    { name: "left_foot", point: [box.min[0] + width * 0.25, box.min[1] + height * 0.12, cz] },
    { name: "right_foot", point: [box.min[0] + width * 0.75, box.min[1] + height * 0.12, cz] },
  ];
}

function segmentHit(box: AxisAlignedBox, origin: Point, target: Point): number {
  let first = 0;
  let last = 1;
  for (let axis = 0; axis < 3; axis += 1) {
    const delta = target[axis] - origin[axis];
    if (Math.abs(delta) < 1e-12) {
      if (origin[axis] < box.min[axis] || origin[axis] > box.max[axis]) return Infinity;
      continue;
    }
    let near = (box.min[axis] - origin[axis]) / delta;
    let far = (box.max[axis] - origin[axis]) / delta;
    if (near > far) [near, far] = [far, near];
    first = Math.max(first, near);
    last = Math.min(last, far);
    if (last < first) return Infinity;
  }
  return last > 1e-6 && first < 0.98 ? Math.max(first, 0) : Infinity;
}

export function measureActorVisibility(
  origin: Point,
  actor: { id: string; box: AxisAlignedBox; recumbent?: boolean },
  occluders: readonly ActorVisibilityOccluder[],
): ActorVisibilityReading {
  const blockedSamples: ActorVisibilityReading["blockedSamples"] = [];
  let visibleSampleCount = 0;
  for (const sample of samplesFor(actor.box, actor.recumbent === true)) {
    let nearest = Infinity;
    let blockedBy = "";
    for (const occluder of occluders) {
      if (occluder.actorId === actor.id) continue;
      if (origin.every((value, axis) => value >= occluder.box.min[axis]! && value <= occluder.box.max[axis]!)) continue;
      const hit = segmentHit(occluder.box, origin, sample.point);
      if (hit < nearest) {
        nearest = hit;
        blockedBy = occluder.name;
      }
    }
    if (nearest === Infinity) visibleSampleCount += 1;
    else blockedSamples.push({ sample: sample.name, blockedBy });
  }
  const crownVisible = !blockedSamples.some((sample) => sample.sample === "crown");
  return {
    actorId: actor.id,
    crownVisible,
    visibleSampleCount,
    sampleCount: 5,
    visible: crownVisible && visibleSampleCount >= 4,
    blockedSamples,
  };
}

/** Browser-safe copy used inside Playwright's page context. Keep pinned by the unit test. */
export const ACTOR_VISIBILITY_BROWSER_FUNCTION_SOURCE = String.raw`function (origin, actor, occluders) {
  const box = actor.box;
  const width = box.max[0] - box.min[0], height = box.max[1] - box.min[1], depth = box.max[2] - box.min[2];
  const cx = (box.min[0] + box.max[0]) / 2, cz = (box.min[2] + box.max[2]) / 2;
  let samples = [
    { name: "crown", point: [cx, box.min[1] + height * 0.9, cz] },
    { name: "chest", point: [cx, box.min[1] + height * 0.65, cz] },
    { name: "pelvis", point: [cx, box.min[1] + height * 0.42, cz] },
    { name: "left_foot", point: [box.min[0] + width * 0.25, box.min[1] + height * 0.12, cz] },
    { name: "right_foot", point: [box.min[0] + width * 0.75, box.min[1] + height * 0.12, cz] }
  ];
  if (actor.recumbent === true) {
    const top = box.max[1] - height * 0.08, alongX = width >= depth;
    const point = function (fraction, minorOffset) {
      return alongX
        ? [box.min[0] + width * fraction, top, cz + depth * minorOffset]
        : [cx + width * minorOffset, top, box.min[2] + depth * fraction];
    };
    samples = [
      { name: "crown", point: point(0.1, 0) },
      { name: "chest", point: point(0.32, 0) },
      { name: "pelvis", point: point(0.58, 0) },
      { name: "left_foot", point: point(0.88, -0.18) },
      { name: "right_foot", point: point(0.88, 0.18) }
    ];
  }
  const hit = function (candidate, target) {
    let first = 0, last = 1;
    for (let axis = 0; axis < 3; axis++) {
      const delta = target[axis] - origin[axis];
      if (Math.abs(delta) < 1e-12) {
        if (origin[axis] < candidate.min[axis] || origin[axis] > candidate.max[axis]) return Infinity;
        continue;
      }
      let near = (candidate.min[axis] - origin[axis]) / delta;
      let far = (candidate.max[axis] - origin[axis]) / delta;
      if (near > far) { const swap = near; near = far; far = swap; }
      if (near > first) first = near;
      if (far < last) last = far;
      if (last < first) return Infinity;
    }
    return last > 1e-6 && first < 0.98 ? Math.max(first, 0) : Infinity;
  };
  const blockedSamples = [];
  let visibleSampleCount = 0;
  for (let s = 0; s < samples.length; s++) {
    let nearest = Infinity, blockedBy = "";
    for (let i = 0; i < occluders.length; i++) {
      const occluder = occluders[i];
      if (occluder.actorId === actor.id) continue;
      if (origin[0] >= occluder.box.min[0] && origin[0] <= occluder.box.max[0]
        && origin[1] >= occluder.box.min[1] && origin[1] <= occluder.box.max[1]
        && origin[2] >= occluder.box.min[2] && origin[2] <= occluder.box.max[2]) continue;
      const distance = hit(occluder.box, samples[s].point);
      if (distance < nearest) { nearest = distance; blockedBy = occluder.name; }
    }
    if (nearest === Infinity) visibleSampleCount++;
    else blockedSamples.push({ sample: samples[s].name, blockedBy: blockedBy });
  }
  const crownVisible = !blockedSamples.some(function (sample) { return sample.sample === "crown"; });
  return {
    actorId: actor.id, crownVisible: crownVisible, visibleSampleCount: visibleSampleCount,
    sampleCount: 5, visible: crownVisible && visibleSampleCount >= 4, blockedSamples: blockedSamples
  };
}`;
