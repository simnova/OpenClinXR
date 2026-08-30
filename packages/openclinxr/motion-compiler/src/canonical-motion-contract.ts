/**
 * THE CANONICAL MOTION CLIP CONTRACT — the single wire format below `compileMotionProgram`.
 *
 * WHY THIS FILE EXISTS AT ALL, stated plainly because it is a correction to how I was working.
 *
 * Five review rounds each found the same generator: I was patching one file at a time against a
 * concept that several files independently redeclared. Each amendment closed the shape visible in
 * front of me while a sibling plant restated "the same" type with its own structure, so the
 * assertions proved equality against their LOCAL fixture rather than equivalence across the seam a
 * worker will actually implement.
 *
 * The last instance was the sharpest. The keystone froze rotation values as tuples `[x, y, z, w]`;
 * M2 froze the identical concept as objects `{x, y, z, w}`. Property name and semantics agreed, so
 * both plants read as consistent. A worker implementing M2 literally returns object quaternions and
 * `compileMotionProgram` expects tuples — which is the original three-signature adapter defect one
 * level lower, reintroduced by the very amendment that closed it above.
 *
 * So: ONE exported contract, imported by every plant. A plant that redeclares `CompiledMotionTrack`
 * structurally is reintroducing the defect and should be rejected in review.
 *
 * ── The distinction that keeps this from being two instruments with one blindness ──
 *
 * A shared WIRE FORMAT is correct to centralise: agreement is the whole point, and two plants
 * disagreeing about representation is the defect. A shared ORACLE is not: M2's forward-kinematic
 * check must stay independent of the compiler, because an oracle sharing code with the thing it
 * measures agrees with it when both are wrong. This file holds the format and the format's
 * validator. It holds no measurement.
 *
 * ── This file is part of the planted contract ──
 *
 * `violationsInTracks` is the standing form of destructive probes that were previously run by hand
 * and deleted. The keystone asserts it REJECTS a table of known-bad tracks, so weakening a rule here
 * turns that assertion red rather than turning the suite green. Amend the rules only by adding.
 *
 * ROTATION SEMANTICS ARE FROZEN AS ABSOLUTE NODE-LOCAL — the value a glTF rotation channel carries
 * directly, requiring no conversion at bake. The property name carries the meaning so it cannot be
 * re-guessed from a bare "rotation"; bind-relative deltas and absolute values differ silently on
 * every bone with a non-identity bind rotation.
 */

export const CLIP_SCHEMA_VERSION = "openclinxr.compiled-motion-clip.v1";

export type Vec3Tuple = readonly [number, number, number];
export type QuatTuple = readonly [number, number, number, number];

export const TRACK_PROPERTIES = ["rotationAbsoluteNodeLocal", "translationAbsoluteNodeLocal"] as const;
export type TrackProperty = (typeof TRACK_PROPERTIES)[number];

/**
 * Interpolation is EXPLICIT because the sampled values encode minimum jerk, and a writer that
 * assumes CUBICSPLINE produces motion nobody authored.
 */
export type CompiledMotionTrack =
  | {
      property: "rotationAbsoluteNodeLocal";
      boneName: string;
      canonicalLandmark: string;
      interpolation: "LINEAR";
      times: readonly number[];
      values: readonly QuatTuple[];
    }
  | {
      property: "translationAbsoluteNodeLocal";
      boneName: string;
      canonicalLandmark: string;
      interpolation: "LINEAR";
      times: readonly number[];
      values: readonly Vec3Tuple[];
    };

const UNIT_TOLERANCE = 1e-6;

/** The shape a not-yet-written compiler might actually return. Every field is suspect. */
type LooseTrack = {
  property?: unknown;
  boneName?: unknown;
  canonicalLandmark?: unknown;
  interpolation?: unknown;
  times?: unknown;
  values?: unknown;
};

/**
 * Every violation the track value space admits, as strings. Empty means valid.
 *
 * Takes `readonly unknown[]` deliberately: the caller is checking output from a compiler that does
 * not exist yet, and a validator that only accepts already-well-typed input cannot catch the case it
 * is written for.
 */
export function violationsInTracks(tracks: readonly unknown[]): string[] {
  const out: string[] = [];
  const seenKeys = new Set<string>();

  for (const [index, raw] of tracks.entries()) {
    if (typeof raw !== "object" || raw === null) {
      out.push(`track ${index}: not an object`);
      continue;
    }
    const t = raw as LooseTrack;
    const property = t.property;
    const boneName = typeof t.boneName === "string" ? t.boneName : `<track ${index}>`;
    const key = `${boneName}::${String(property)}`;

    // CLOSED property set. An unknown property previously fell into the translation branch and was
    // validated AS a translation — a silent misclassification rather than a refusal.
    if (typeof property !== "string" || !(TRACK_PROPERTIES as readonly string[]).includes(property)) {
      out.push(`${key}: unknown track property "${String(property)}"`);
      continue;
    }
    if (typeof t.boneName !== "string" || t.boneName.length === 0) out.push(`track ${index}: missing boneName`);
    if (typeof t.canonicalLandmark !== "string" || t.canonicalLandmark.length === 0) {
      out.push(`${key}: missing canonicalLandmark — a bone name alone does not survive a rig change`);
    }
    if (t.interpolation !== "LINEAR") {
      out.push(`${key}: interpolation must be explicit "LINEAR"; the writer must not guess`);
    }
    if (seenKeys.has(key)) out.push(`${key}: two tracks address the same bone and property — ambiguous at bake`);
    seenKeys.add(key);

    const times = t.times;
    const values = t.values;
    if (!Array.isArray(times) || !Array.isArray(values)) {
      out.push(`${key}: times and values must both be arrays`);
      continue;
    }
    if (times.length === 0) out.push(`${key}: a track with no samples is not a track`);
    if (times.length !== values.length) out.push(`${key}: ${times.length} times against ${values.length} values`);

    for (const [i, t_] of times.entries()) {
      if (typeof t_ !== "number" || !Number.isFinite(t_)) {
        out.push(`${key}: non-finite time at ${i}`);
        continue;
      }
      // NON-NEGATIVE. A negative-only secondary track previously passed whenever another track
      // supplied the positive maximum duration.
      if (t_ < 0) out.push(`${key}: negative timestamp ${t_}`);
      const prior = times[i - 1];
      if (i > 0 && typeof prior === "number" && !(t_ > prior)) {
        out.push(`${key}: times not strictly increasing at ${i}`);
      }
    }

    const arity = property === "rotationAbsoluteNodeLocal" ? 4 : 3;
    for (const [i, v] of values.entries()) {
      if (!Array.isArray(v)) {
        out.push(`${key}: sample ${i} is not a tuple — the wire format is [x, y, z${arity === 4 ? ", w" : ""}]`);
        continue;
      }
      // TUPLE SHAPE CLOSED. A five-component "quaternion" previously passed every other check.
      if (v.length !== arity) out.push(`${key}: sample ${i} must have exactly ${arity} components, has ${v.length}`);
      if (!v.every((c) => typeof c === "number" && Number.isFinite(c))) {
        out.push(`${key}: non-finite component in sample ${i}`);
        continue;
      }
      if (property !== "rotationAbsoluteNodeLocal" || v.length !== 4) continue;

      const q = v as number[];
      const norm = Math.hypot(q[0]!, q[1]!, q[2]!, q[3]!);
      if (Math.abs(norm - 1) > UNIT_TOLERANCE) out.push(`${key}: quaternion ${i} not unit (|q|=${norm})`);

      // FIRST-SAMPLE CANONICAL SIGN. Sign continuity alone did not close this: negating EVERY
      // quaternion in a track leaves all adjacent dot products positive, so the whole track passed
      // and two runs emitting q and -q throughout were both valid and not byte-equal.
      if (i === 0 && !isSignCanonical(q)) {
        out.push(`${key}: first sample is not sign-canonical (w<0, or w=0 with a negative leading component)`);
      }
      const prev = values[i - 1];
      if (i > 0 && Array.isArray(prev) && prev.length === 4) {
        const p = prev as number[];
        const dot = q[0]! * p[0]! + q[1]! * p[1]! + q[2]! * p[2]! + q[3]! * p[3]!;
        if (dot < 0) out.push(`${key}: quaternion sign flips between samples ${i - 1} and ${i} — breaks byte determinism`);
      }
    }
  }
  return out;
}

function isSignCanonical(q: readonly number[]): boolean {
  const [x, y, z, w] = [q[0]!, q[1]!, q[2]!, q[3]!];
  if (w !== 0) return w > 0;
  if (x !== 0) return x > 0;
  if (y !== 0) return y > 0;
  return z >= 0;
}

/**
 * Deterministic serialisation order: two identical compiles must produce byte-identical output.
 */
export function trackOrderKeys(tracks: readonly CompiledMotionTrack[]): string[] {
  return tracks.map((t) => `${t.boneName}::${t.property}`);
}
