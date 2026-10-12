/**
 * Locomotion proving ground: per-writer leg-pose tap + 6 m vehicle flags.
 *
 * STAGE 1/2 of the loco-ground slice (2026-10-12). Default OFF: only exactly
 * `locoGround=1` / `noStanceLock=1` read true; absent or any other value reads
 * false. Same opt-in `=== "1"` shape as `ccd-stance-lock-query-flag-mod.ts`.
 *
 * WHY THIS IS ONE INTERNAL MODULE. The tap must snapshot the SAME skeleton at
 * three points inside one production frame — after `mixer.update` (the clip's
 * own pose), after the posture pass (clip + posture), at end of frame (after
 * the stance lock / settling writers). Those points live in `animation-loop.ts`
 * (per-slot loop) and `station-bedside-approach-mod.ts`
 * (`applyStationBedsideStanceLock`, which runs after the animation pass in
 * `apps/ui-xr/src/main.ts`). A capture-side `page.evaluate` runs BETWEEN
 * frames and cannot see inside one, so the tap lives here, on the rig, and
 * publishes a ring the capture reads. Nothing here is exported publicly:
 * `public-api.json` is untouched, same discipline as the query-flag mods.
 *
 * THE VEHICLE. `?locoGround=1` lengthens the case-owned bedside approach to a
 * 6 m straight walk (`extendLocoGroundRoute`): the SC-05 walk is 1.2 m, under
 * one gait cycle, all start/stop transient. A new isolated scene in ui-xr was
 * the first option; lengthening the existing harness approach is the smaller
 * change and keeps the FULL production frame loop (mixer, posture pass,
 * claims, stance lock, settling) byte-for-byte, so whatever the tap names is
 * true of the shipped walk. The extension prepends collinear waypoints and
 * moves `intent.start` back along the route; clearance for the added segment
 * is NOT re-vetted (the shipped plan's own violations stand) — recorded in
 * the slice report as not-tested.
 *
 * `?noStanceLock=1` (meaningful only with `locoGround=1`) skips the stance
 * lock so the lock-disabled row isolates clip + root.
 */

export const LOCO_GROUND_ROUTE_METERS = 6;
export const LOCO_GROUND_TAP_RING_LIMIT = 3000;

/** Pure parser, unit-tested without a DOM (tools-side, dist import). */
export function parseLocoGroundEnabled(search: string): boolean {
  return new URLSearchParams(search).get("locoGround") === "1";
}

/** Browser entry read; false anywhere without a location search (node, tools). */
export function readLocoGroundEnabled(): boolean {
  const search = (globalThis as unknown as { window?: { location?: { search?: string } } })
    .window?.location?.search;
  return typeof search === "string" && parseLocoGroundEnabled(search);
}

/** Pure parser, unit-tested without a DOM (tools-side, dist import). */
export function parseLocoGroundNoStanceLock(search: string): boolean {
  return new URLSearchParams(search).get("noStanceLock") === "1";
}

/** Browser entry read; false anywhere without a location search (node, tools). */
export function readLocoGroundNoStanceLock(): boolean {
  const search = (globalThis as unknown as { window?: { location?: { search?: string } } })
    .window?.location?.search;
  return typeof search === "string" && parseLocoGroundNoStanceLock(search);
}

type Xz = { x: number; z: number };
type Xyz = { x: number; y: number; z: number };

/**
 * Extend a resolved approach to a straight LOCO_GROUND_ROUTE_METERS walk.
 *
 * Pure over plain data: `start` moves back along the start->target axis until
 * the route is 6 m, and collinear waypoints at 0.35 m spacing (the shipped
 * `APPROACH_WAYPOINT_SPACING_METERS`) are prepended so the executor's
 * polyline length — the number the walk stops on — matches. Heading radians
 * are copied from the existing first waypoint. Returns null when the route is
 * already long enough (nothing to do) so the caller keeps the shipped plan.
 */
export function extendLocoGroundRoute(input: {
  start: Xyz;
  target: Xyz;
  waypoints: ReadonlyArray<{ position: Xyz; headingRadians: number }>;
  routeMeters?: number;
}): { start: Xyz; waypoints: Array<{ position: Xyz; headingRadians: number }> } | null {
  const routeMeters = input.routeMeters ?? LOCO_GROUND_ROUTE_METERS;
  const dx = input.target.x - input.start.x;
  const dz = input.target.z - input.start.z;
  const length = Math.hypot(dx, dz);
  if (!(length > 0) || length >= routeMeters) return null;
  const unit = { x: dx / length, z: dz / length };
  const start: Xyz = {
    x: input.target.x - unit.x * routeMeters,
    y: input.start.y,
    z: input.target.z - unit.z * routeMeters,
  };
  const first = input.waypoints[0];
  const headingRadians = first?.headingRadians ?? Math.atan2(unit.x, unit.z);
  const firstY = first?.position.y ?? input.start.y;
  const added: Array<{ position: Xyz; headingRadians: number }> = [];
  const extension = routeMeters - length;
  const spacing = 0.35;
  const steps = Math.max(1, Math.ceil(extension / spacing));
  for (let i = steps; i >= 1; i -= 1) {
    const back = (i / steps) * extension;
    added.push({
      position: {
        x: input.start.x - unit.x * back,
        y: firstY,
        z: input.start.z - unit.z * back,
      },
      headingRadians,
    });
  }
  return { start, waypoints: [...added, ...input.waypoints.map((w) => ({ ...w }))] };
}

/** Sanitised (dots stripped, as GLTFLoader loads them) tap bone names. */
const LOCO_GROUND_TAP_BONES = [
  "upperleg01L", "upperleg01R",
  "upperleg02L", "upperleg02R",
  "lowerleg01L", "lowerleg01R",
  "lowerleg02L", "lowerleg02R",
  "footL", "footR",
  "toe1-1L", "toe1-1R",
  "pelvis",
  "root",
] as const;

export type LocoGroundTapPoint = "mixer" | "posture" | "frame";

type TapQuat = [number, number, number, number];

export type LocoGroundTapPose = {
  quat: Partial<Record<string, TapQuat>>;
  toeWorld: { left: Xyz | null; right: Xyz | null };
  slot: { x: number; y: number; z: number; yaw: number } | null;
};

export type LocoGroundTapMeta = {
  tMs: number;
  actorId: string;
  phase: string | null;
  evidenceSampleIndex: number;
  legWeightCurrent: number | null;
  actionTimeSeconds: number | null;
  actionTimeScale: number | null;
  actionPlaying: boolean | null;
  stanceLabel: string | null;
  lockArmed: boolean | null;
  lockStance: string | null;
  lockCorrection: { x: number; z: number } | null;
  heelMissM: number | null;
  actorScale: { x: number; y: number; z: number } | null;
  postureTags: Partial<Record<string, string | null>>;
};

export type LocoGroundTapFrame = {
  frame: number;
  mixer: LocoGroundTapPose;
  posture: LocoGroundTapPose;
  rendered: LocoGroundTapPose;
  meta: LocoGroundTapMeta;
};

type Trio = {
  mixer: LocoGroundTapPose | null;
  posture: LocoGroundTapPose | null;
};

type MinimalNode = {
  name: string;
  quaternion: { x: number; y: number; z: number; w: number };
  matrixWorld: { elements: number[] };
  updateWorldMatrix: (updateParents: boolean, updateChildren: boolean) => void;
  userData: Record<string, unknown>;
  traverse: (visit: (node: MinimalNode) => void) => void;
};

const tapBoneCache = new WeakMap<object, MinimalNode[]>();
const pendingTrio = new WeakMap<object, Trio>();
let tapFrameCounter = 0;

function tapBones(root: MinimalNode): MinimalNode[] {
  const cached = tapBoneCache.get(root);
  if (cached) return cached;
  const wanted = new Set<string>(LOCO_GROUND_TAP_BONES);
  const found: MinimalNode[] = [];
  root.traverse((node) => {
    if (typeof node.name !== "string" || node.name.length === 0) return;
    if (wanted.has(node.name.replaceAll(".", ""))) found.push(node);
  });
  tapBoneCache.set(root, found);
  return found;
}

function findTapBone(cached: MinimalNode[], sanitised: string): MinimalNode | null {
  for (const node of cached) {
    if (node.name.replaceAll(".", "") === sanitised) return node;
  }
  return null;
}

function worldOfNode(node: MinimalNode): Xyz {
  const e = node.matrixWorld.elements;
  return { x: e[12] ?? Number.NaN, y: e[13] ?? Number.NaN, z: e[14] ?? Number.NaN };
}

function snapPose(
  root: MinimalNode,
  actorSlot: { position: Xyz; rotation: { y: number } } | null,
): LocoGroundTapPose {
  const bones = tapBones(root);
  const quat: Partial<Record<string, TapQuat>> = {};
  for (const bone of bones) {
    const q = bone.quaternion;
    quat[bone.name.replaceAll(".", "")] = [q.x, q.y, q.z, q.w];
  }
  const toeL = findTapBone(bones, "toe1-1L");
  const toeR = findTapBone(bones, "toe1-1R");
  // updateWorldMatrix(true, false): parents first, then this node — a correct
  // world read off the CURRENT locals without depending on a fresh render.
  let left: Xyz | null = null;
  let right: Xyz | null = null;
  if (toeL !== null) {
    toeL.updateWorldMatrix(true, false);
    left = worldOfNode(toeL);
  }
  if (toeR !== null) {
    toeR.updateWorldMatrix(true, false);
    right = worldOfNode(toeR);
  }
  return {
    quat,
    toeWorld: { left, right },
    slot: actorSlot === null
      ? null
      : {
        x: actorSlot.position.x,
        y: actorSlot.position.y,
        z: actorSlot.position.z,
        yaw: actorSlot.rotation.y,
      },
  };
}

/**
 * Snapshot one tap point for this frame. Call with the animation slot's
 * `root`/`actorSlot` (as `unknown`; cast here so animation-loop needs no new
 * imports beyond this module). No-op unless `locoGround=1`.
 */
export function snapshotLocoGroundTap(
  slot: unknown,
  point: "mixer" | "posture",
): void {
  if (!readLocoGroundEnabled()) return;
  const root = (slot as { root?: MinimalNode }).root;
  if (!root || typeof root.traverse !== "function") return;
  const actorSlot = (slot as { actorSlot?: { position: Xyz; rotation: { y: number } } }).actorSlot ?? null;
  let trio = pendingTrio.get(root);
  if (!trio) {
    trio = { mixer: null, posture: null };
    pendingTrio.set(root, trio);
  }
  trio[point] = snapPose(root, actorSlot);
}

/**
 * End-of-frame commit: snapshot the rendered pose, attach per-frame meta, and
 * push one record onto the `__openClinXrLocoGroundTap` ring. Called from
 * `applyStationBedsideStanceLock` — after the animation pass AND the stance
 * lock — so `rendered` is what the frame drew. `approach`/`lastFrame` are the
 * station state (as `unknown` for the same reason as above).
 */
export function commitLocoGroundTapFrame(
  slot: unknown,
  approach: unknown,
  lastFrame: { phase?: string; stanceFoot?: string | null } | null,
): void {
  if (!readLocoGroundEnabled()) return;
  const root = (slot as { root?: MinimalNode }).root;
  if (!root || typeof root.traverse !== "function") return;
  const actorSlot = (slot as {
    actorSlot?: { position: Xyz; rotation: { y: number }; scale: { x: number; y: number; z: number } };
  }).actorSlot ?? null;
  const rendered = snapPose(root, actorSlot);
  const trio = pendingTrio.get(root);
  pendingTrio.delete(root);
  if (!trio?.mixer || !trio?.posture) return;
  const rootUserData = (root.userData ?? {}) as Record<string, unknown>;
  const playback = rootUserData["openClinXrLocomotionClipPlayback"] as
    | { playing?: boolean; timeSeconds?: number; timeScale?: number }
    | undefined;
  const legWeight = rootUserData["openClinXrLocomotionLegWeight"] as { current?: number } | undefined;
  const app = (approach ?? {}) as {
    actorId?: string;
    intent?: { physicianActorId?: string };
    lockArmed?: boolean;
    lock?: { stanceFoot?: string | null; correctionMeters?: { x: number; z: number } };
    lastHeelMissM?: number | null;
  };
  const intentActorId = app.intent?.physicianActorId;
  const page = (globalThis as unknown as { window?: Record<string, unknown> }).window
    ?? (globalThis as unknown as Record<string, unknown>);
  const samples = (page["__openClinXrBedsideApproachEvidence"] as { samples?: unknown[] } | undefined)?.samples;
  const bones = tapBones(root);
  const postureTags: Partial<Record<string, string | null>> = {};
  for (const bone of bones) {
    const tag = bone.userData["openClinXrClinicalIdlePosture"];
    postureTags[bone.name.replaceAll(".", "")] = typeof tag === "string" ? tag : null;
  }
  const record: LocoGroundTapFrame = {
    frame: tapFrameCounter,
    mixer: trio.mixer,
    posture: trio.posture,
    rendered,
    meta: {
      tMs: Date.now(),
      actorId: typeof app.actorId === "string"
        ? app.actorId
        : (typeof intentActorId === "string" ? intentActorId : ""),
      phase: lastFrame?.phase ?? null,
      evidenceSampleIndex: samples ? samples.length - 1 : -1,
      legWeightCurrent: typeof legWeight?.current === "number" ? legWeight.current : null,
      actionTimeSeconds: typeof playback?.timeSeconds === "number" ? playback.timeSeconds : null,
      actionTimeScale: typeof playback?.timeScale === "number" ? playback.timeScale : null,
      actionPlaying: typeof playback?.playing === "boolean" ? playback.playing : null,
      stanceLabel: lastFrame?.stanceFoot ?? null,
      lockArmed: typeof app.lockArmed === "boolean" ? app.lockArmed : null,
      lockStance: app.lock?.stanceFoot ?? null,
      lockCorrection: app.lock?.correctionMeters ?? null,
      heelMissM: typeof app.lastHeelMissM === "number" ? app.lastHeelMissM : null,
      actorScale: actorSlot === null
        ? null
        : { x: actorSlot.scale.x, y: actorSlot.scale.y, z: actorSlot.scale.z },
      postureTags,
    },
  };
  tapFrameCounter += 1;
  const ring = (page["__openClinXrLocoGroundTap"] as LocoGroundTapFrame[] | undefined) ?? [];
  ring.push(record);
  while (ring.length > LOCO_GROUND_TAP_RING_LIMIT) ring.shift();
  page["__openClinXrLocoGroundTap"] = ring;
}

/** Test/peer seam: which sanitised bone names the tap records. */
export function locoGroundTapBoneNames(): string[] {
  return [...LOCO_GROUND_TAP_BONES];
}
