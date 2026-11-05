/** C28: which cast actor the learner's typed text addresses. Pure, so the shell and the tests share one rule. */

export interface AddressedActorInput {
  actorIds: readonly string[];
  /** The actor in the learner's view cone, if any. */
  gazedActorId?: string | undefined;
  /** The actor whose server turn played last. */
  lastSpokeActorId?: string | undefined;
  /** The actor the learner's last send addressed. */
  lastAddressedActorId?: string | undefined;
}

/** Gaze, then last speaker, then last addressed, then the first cast actor; ids outside the cast are ignored. */
export function pickAddressedActor(input: AddressedActorInput): string | undefined {
  for (const candidate of [input.gazedActorId, input.lastSpokeActorId, input.lastAddressedActorId]) {
    if (candidate !== undefined && input.actorIds.includes(candidate)) return candidate;
  }
  return input.actorIds[0];
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** What the shell reports about the learner's view: eye, view axis and each cast actor's head position. */
export interface GazeView {
  eye: Vec3;
  forward: Vec3;
  actors: ReadonlyArray<Vec3 & { actorId: string }>;
}

/** The actor nearest the view axis within maxAngleDeg of it; undefined when none is, or the view axis has no length. */
export function gazedActorId(
  eye: Vec3,
  forward: Vec3,
  actors: ReadonlyArray<Vec3 & { actorId: string }>,
  maxAngleDeg = 30,
): string | undefined {
  const forwardLength = Math.hypot(forward.x, forward.y, forward.z);
  if (forwardLength === 0) return undefined;
  const minCos = Math.cos((maxAngleDeg * Math.PI) / 180);
  let best: { actorId: string; cos: number } | undefined;
  for (const actor of actors) {
    const dx = actor.x - eye.x;
    const dy = actor.y - eye.y;
    const dz = actor.z - eye.z;
    const length = Math.hypot(dx, dy, dz);
    if (length === 0) continue;
    const cos = (dx * forward.x + dy * forward.y + dz * forward.z) / (length * forwardLength);
    if (cos >= minCos && (best === undefined || cos > best.cos)) best = { actorId: actor.actorId, cos };
  }
  return best?.actorId;
}
