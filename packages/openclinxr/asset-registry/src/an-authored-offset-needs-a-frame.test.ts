import { describe, expect, it } from "vitest";
import { composeSupportedActorWorldPosition } from "./index.js";

/**
 * Brief §3, "Authored intent versus resolved placement". Three of its requirements had no
 * implementation, and each fails silently rather than loudly:
 *
 *   "For standing, name a floor anchor; `none` is not itself a frame."
 *   "Missing or ambiguous authored supports, malformed offsets and violated hard constraints block
 *    candidate acceptance/promotion."
 *   "do not multiply metre offsets by GLB scale again"
 *
 * The standing branch RETURNED the resolved position and dropped the offset, so an author saw a
 * value in the case and no movement in the runtime with nothing saying why. NaN and Infinity are
 * `typeof "number"`, so the shape check admitted them, and a non-finite component propagates
 * through the anchor addition into a position that compares false against every bound.
 */

const ANCHOR = { x: 1.25, y: 0.62, z: -0.4 };
const RESOLVED = { x: 3, y: 0, z: 2 };

function compose(posture: "standing" | "seated" | "supine", offset?: { x: number; y: number; z: number }) {
  return composeSupportedActorWorldPosition({
    posture,
    fixtureAnchor: ANCHOR,
    resolvedPosition: RESOLVED,
    ...(offset ? { authoredOffsetMeters: offset } : {}),
  });
}

describe("an authored offset needs a frame, and a malformed one is refused", () => {
  it("(1) a STANDING actor with an authored offset is REFUSED — `none` is not a frame", () => {
    const result = compose("standing", { x: 0.4, y: 0, z: 0 });
    expect(result).toMatchObject({ refused: true });
    expect((result as { reason: string }).reason).toMatch(/not a frame/u);
  });

  it("(2) COUNTERWEIGHT: a standing actor with NO offset, and with an all-zero one, still resolves", () => {
    // Refusing every standing actor would satisfy clause (1) and break the runtime. An explicit
    // zero offset is authoring that asks for nothing, which is not the same as authoring nonsense.
    expect(compose("standing")).toEqual(RESOLVED);
    expect(compose("standing", { x: 0, y: 0, z: 0 })).toEqual(RESOLVED);
  });

  it("(3) a MALFORMED offset is refused on every axis, and names the axis", () => {
    for (const axis of ["x", "y", "z"] as const) {
      for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
        const offset = { x: 0, y: 0, z: 0, [axis]: bad } as unknown as { x: number; y: number; z: number };
        const result = compose("supine", offset);
        expect(result, `${axis}=${String(bad)}`).toMatchObject({ refused: true });
        // y=NaN would otherwise be caught by the normal-offset clause and blamed on the wrong rule.
        expect((result as { reason: string }).reason).toMatch(/malformed/u);
      }
    }
  });

  it("(4) the offset is added in the anchor's own metres — no scale factor anywhere", () => {
    // "do not multiply metre offsets by GLB scale again". An exact equality is the whole test: any
    // scale term, including 1.0 today, would make this an approximate check tomorrow.
    const composed = compose("supine", { x: 0.4, y: 0, z: -0.05 });
    expect(composed).toEqual({ x: ANCHOR.x + 0.4, y: ANCHOR.y, z: ANCHOR.z - 0.05 });
  });

  it("(5) the normal-offset refusal still stands, and it is a DIFFERENT refusal from a malformed one", () => {
    const result = compose("seated", { x: 0, y: 0.05, z: 0 });
    expect(result).toMatchObject({ refused: true });
    expect((result as { reason: string }).reason).toMatch(/nonzero normal/u);
    expect((result as { reason: string }).reason).not.toMatch(/malformed/u);
  });
});
