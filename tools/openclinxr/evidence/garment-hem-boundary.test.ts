import { describe, expect, it } from "vitest";

/**
 * PLANTED CONTRACTS (#124) — the garment hem is sawn off at a height threshold, so its lower edge is a
 * staircase through body triangles rather than a hem, and on some figures it stops above the painted
 * lower clothing and leaves bare skin.
 *
 * TWO REDs FLIP. The third is a COUNTERWEIGHT — #121's shoulder coverage and #73's lower paint must
 * both survive. It is `it.fails` only because the module is absent.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THIS IS THE EIGHTH CONTRACT IN THIS AREA. SIX OF THE FIRST SEVEN PASSED ON THEIR OWN TARGET.
 *
 * So the framing was attacked before it was written, and a peer round named the four ways this one
 * would die. **None of them are used here:**
 *
 *   - a `bot_y` floor or any other height fraction — a longer rag is still a rag
 *   - "hem covers the hips" presence — that is the coverage class that failed six times
 *   - a solidify rim — #121 already learned it re-splits on glTF export into micro-islands
 *     (`automate_blender.py:1877-1878` records the decision to drop it)
 *   - weight transfer alone — real, but invisible in a still, and the hem is not
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * WHY THIS ONE IS MORE CHECKABLE THAN COVERAGE WAS — and where it still is not
 *
 * Coverage failed because presence is not wornness and a detached blade satisfies presence. A hem is
 * different: the boundary IS the set of edges left after the cut, so its regularity is a topological
 * fact rather than an aesthetic one.
 *
 *   machine can bound: one primary closed boundary loop; bounded turn angle along it; no single-vertex
 *                      spikes; no bare skin band between mesh hem and painted lower region
 *   machine cannot say: whether it reads as a finished, sewn hem
 *
 * **The pixel grade still closes this and it is mine.** If you satisfy both contracts and the hem
 * still looks torn, SAY SO — that is the most useful report available.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THE DEFECT, TRACED — verified against the tree
 *
 * `automate_blender.py:1736-1738`  `if y < bot_y: continue` — a hard vertex delete on body topology.
 *                                  No boundary loop is rebuilt afterwards.
 * `automate_blender.py:2174,2325,2336`  `bot_y` is a body-height fraction: 0.46 default, ~0.31–0.32
 *                                  for gown and open-front kinds, ~0.48 scrub.
 * `automate_blender.py:1703-1708`  lower-body clothing is deliberate PAINTED TEXTURE, kept on purpose
 *                                  (#73). So a bare midriff is a GAP between two systems.
 *
 * **Why the neck and arm holes came out clean from the same algorithm** — this is the key insight and
 * it is not magic. Those cuts are landmark-aligned: the neck is a radial band around a landmark
 * (`:1739-1743`), the arm follows the shoulder→elbow segment (`:1745-1757`). Both approximate a
 * cylinder around an axis, and the surrounding topology flows that way. The hem is a **global
 * horizontal plane through mid-torso** — the worst place on a body mesh to expect a clean loop,
 * because the triangles there are not oriented to one.
 *
 * Production practice is a designed hem: a seam or retopologised edge loop along the hemline, often
 * with thickness. A height-threshold delete on dense organic topology is a crop, not a hem.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THE MIDRIFF IS A TWO-SYSTEM GAP, NOT A SHORT GARMENT
 *
 * The mesh hem and the painted lower region are set independently, so nothing guarantees they meet.
 * Lowering `bot_y` alone is the wrong fix and #73 already recorded the other wrong fix: removing the
 * paint where a real garment exists left a figure topless under an open cardigan.
 *
 * What is needed is one waistline governing BOTH — mesh hem at or below the paint's top edge, with a
 * small overlap, varying by garment kind because a gown and a tee do not end in the same place.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * DECISIONS THAT ARE YOURS. Name each in the commit message with what you rejected.
 *  - How the hem is built. A planar bisect with a welded boundary loop, a landmark-aligned cut like
 *    the neck and arm, or something else. The peer round's reading is that landmark-vs-plane is the
 *    distinction that matters; I am not certain enough to mandate it.
 *  - Whether the hem gets thickness, and if so how, given that solidify's rim broke the glTF export
 *    once already. If you reintroduce it, prove the export is still one component.
 *  - Where the shared waistline lives and what drives it — a landmark, a fraction, or per-kind data.
 *  - Whether the open-front kinds need a different boundary rule. A cardigan's boundary is legitimately
 *    not one closed loop, and contract (1) must not punish that; say how you distinguished it.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * KNOB DIRECTION — I do not know it, and I am saying so rather than guessing
 *
 * A previous slice lost its entire product thrash discovering the sign of a rotation I had named
 * without a direction. I do not know whether a cleaner hem comes from cutting higher, cutting lower,
 * or not cutting on a plane at all. Budget a probe rather than assuming.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * WHY THE THREE PULL APART
 *
 * (1) demands a regular boundary and is satisfiable by a clean cut that stops above the waist. (2)
 * forbids that by requiring the hem to meet the painted region. (3) is green today and forbids buying
 * either by pulling the garment back off the shoulders (#121) or by deleting the lower paint (#73).
 *
 * SIGNATURE IS THE IMPLEMENTER'S CHOICE. These read `inspectGarmentHemBoundary()`. What must not
 * change: measurements come from the EXPORTED glTF via NodeIO, and every shipped humanoid is
 * enumerated rather than listed.
 *
 * REQUIRED, the observable half: re-capture psych and ward and state what the hems look like.
 *
 * IN-SCOPE VISUAL, as separate slots you must fill:
 *     IN-SCOPE VISUAL: hem edge ___ ; midriff ___ ; shoulders still ___
 * and: CONTRACT_MET_VISUAL: still_wrong | improved_not_natural | reads_as_finished | other:<text>
 *
 * IF ANY PROOF CANNOT PASS AS WRITTEN, OR PASSES TRIVIALLY AGAINST THE OBSERVED RANGE, OR ASSERTS THE
 * OPPOSITE DIRECTION FROM THE DEFECT, SAY SO IN YOUR REPORT.
 *
 * SCOPE: the garment's lower boundary and whether it meets the painted lower clothing. Says NOTHING
 * about skin weights — #121 kept heuristic painting and that is a separate slice, invisible in a still
 * and real under animation — nor about whether the garment is clinically appropriate.
 */

const load = async () => import("./garment-hem-boundary.js") as Promise<Record<string, unknown>>;

type HemBoundary = {
  assetPath: string;
  garmentMeshName: string;
  garmentKind: string;
  /** Closed boundary loops on the garment mesh. A closed top has one at the hem plus neck and cuffs. */
  hemLoopCount: number;
  /** Vertices on the lowest boundary loop. */
  hemLoopVertexCount: number;
  /**
   * Regularity of the hem loop: the loop's own length divided by the circumference of its convex
   * outline. A clean hem is near 1; a staircase through triangle soup is much larger.
   */
  hemPerimeterRatio: number;
  /** Sharpest turn between consecutive hem edges, in degrees. A saw has spikes. */
  hemMaxTurnDegrees: number;
  /** Lowest garment vertex, and the top of the painted lower region, in the same world frame. */
  hemLowestY: number;
  paintedLowerTopY: number;
  /** #121's guarantee and #73's, for the counterweight. */
  shoulderSpannedByOneComponent: boolean;
  hasPaintedLowerRegion: boolean;
};
type Inspect = () => Promise<{ assets: HemBoundary[] }>;

/** A staircase boundary is much longer than its own outline. Derived from geometry, not taste. */
const MAX_HEM_PERIMETER_RATIO = 1.35;
/** A spike is a near-reversal between consecutive edges. */
const MAX_HEM_TURN_DEGREES = 100;

describe("the garment ends in a hem, and the hem meets the trousers (#124)", () => {
  it("the hem boundary is regular, not a staircase", async () => {
    // The hem is a hard y-threshold delete on body topology, so the boundary is whatever polyline the
    // surviving triangles happen to make. Ratio and turn angle bound that; a height floor does not.
    const mod = await load();
    const inspect = mod["inspectGarmentHemBoundary"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    expect(report.assets.length, "no shipped humanoids were inspected").toBeGreaterThan(0);

    const ragged: string[] = [];
    for (const a of report.assets) {
      expect(a.hemLoopVertexCount, `${a.assetPath} found no hem boundary at all`).toBeGreaterThan(0);
      if (a.hemPerimeterRatio > MAX_HEM_PERIMETER_RATIO) {
        ragged.push(`${a.assetPath} ${a.garmentMeshName}: hem perimeter ratio ${a.hemPerimeterRatio.toFixed(2)}`);
      }
      if (a.hemMaxTurnDegrees > MAX_HEM_TURN_DEGREES) {
        ragged.push(`${a.assetPath} ${a.garmentMeshName}: hem spike of ${a.hemMaxTurnDegrees.toFixed(0)}deg`);
      }
    }
    expect(ragged, `hems that are sawn rather than finished:\n${ragged.join("\n")}`).toHaveLength(0);
  }, 900_000);

  it("no bare skin band between the hem and the painted lower clothing", async () => {
    // Kills the cheap satisfaction of the first contract: a clean hem cut high on the torso is still a
    // bare midriff. The two systems are set independently and nothing makes them meet.
    const mod = await load();
    const inspect = mod["inspectGarmentHemBoundary"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    const gaps: string[] = [];
    for (const a of report.assets) {
      if (!a.hasPaintedLowerRegion) continue;
      if (a.hemLowestY > a.paintedLowerTopY) {
        gaps.push(
          `${a.assetPath} ${a.garmentKind}: hem ends at y=${a.hemLowestY.toFixed(3)} `
          + `but the painted lower clothing starts at y=${a.paintedLowerTopY.toFixed(3)}`,
        );
      }
    }
    expect(gaps, `bare skin between the top and the trousers:\n${gaps.join("\n")}`).toHaveLength(0);
  }, 900_000);

  /**
   * ## FIXED (#124)
   * Hem: planar snap of verts below shared waist + Laplacian smooth on boundary (not height-fraction
   * floor; not solidify rim; not coverage-presence). bmesh.ops.bisect_plane rejected — on Blender 5.1
   * even cut-only deleted the lower band. Past-cuff arm cuts gated to true-sleeve lateral so short
   * scrubs no longer face-disconnect the mid-torso. Paint: lower claims shared waist before
   * skip_torso_paint continues past is_top overlap. Face-flood (not edge-flood) matches glTF
   * triangle connectivity.
   */
  it("#121's shoulders and #73's lower paint both survive (COUNTERWEIGHT)", async () => {
    // Two ways to buy a clean hem cheaply: pull the garment back off the shoulders, or delete the
    // painted lower clothing so there is nothing to meet. Both have already happened once each.
    const mod = await load();
    const inspect = mod["inspectGarmentHemBoundary"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    for (const a of report.assets) {
      expect(a.shoulderSpannedByOneComponent, `${a.assetPath} lost #121's shoulder coverage`).toBe(true);
      expect(a.hasPaintedLowerRegion, `${a.assetPath} lost #73's painted lower clothing`).toBe(true);
    }
  }, 900_000);
});
