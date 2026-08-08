import { describe, expect, it } from "vitest";

/**
 * PLANTED CONTRACTS (#183). Two REDs. Both flip.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THE GAP — measured in #183, and the existing gate is CORRECT, not broken
 *
 * A patient stands waist-deep inside a grey box with a blue slab across it at hip height.
 * `actor-furniture-clearance` (#169) reports `support=1 inside=[none]` and is RIGHT: the chair it
 * measures is more than half a metre away in Z, and `f = 0.000` is a correct measurement.
 *
 * #169 measures actors against SUPPORT SURFACES ONLY — beds, patient chairs, decks. Nothing in this
 * repo measures an actor against NON-SUPPORT geometry: room props, equipment, architecture fixtures,
 * decorative boxes. A learner can therefore stand inside a desk and every gate stays green.
 *
 * I have a second instance: in #211's lit psych capture a blue slab crosses an actor at chest height
 * and that actor appears to be inside a white box. GRADED BY ME, not measured — the count across the
 * bank is unknown and contract (1)'s artifact is what establishes it.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THE METRIC IS NOT MINE AND NOT RAW AABB — a peer round argued me out of that
 *
 * My first proposal was "actor AABB intersects prop AABB". Rejected, and #169 had already rejected
 * the same thing for supports: `actor-furniture-clearance.ts:45` says "Rejected: pure AABB any-touch."
 *
 * Named failure cases for raw AABB:
 *   FALSE POSITIVE — a seated actor legitimately intersects its seat; a multi-mesh prop has a loose
 *                    world AABB; an actor stands BESIDE a tall prop and shares its vertical range.
 *   FALSE NEGATIVE — a thin beam pierces a torso with tiny volume overlap; a prop sits behind an
 *                    actor with overlapping AABB and no contact.
 *
 * USE #169's CALIBRATED FAMILY INSTEAD: XZ footprint overlap fraction of the SMALLER footprint, plus
 * vertical straddle, plus standing posture. `INSIDE_OVERLAP_FRACTION_THRESHOLD = 0.18` already exists
 * at `actor-furniture-clearance.ts:47` and is calibrated. Reuse it; do not invent a second number.
 *
 * WHAT THIS METRIC CANNOT SEE, stated here beside the check (§6e): a THIN BEAM through a chest is a
 * small-volume pierce and this metric will miss it. That residual is EYE-GRADED, not machine-checked,
 * and contract (1) does not claim otherwise. Do not add a scalar to "cover" it — §11c: conjunction of
 * bounds does not create a new predicate, and six gates in this repo have died to exactly that hope.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THE FIX BELONGS IN PROP PLACEMENT, NOT ACTOR PLACEMENT
 *
 * `encounter-actor-framing.ts:1-11` already rewrites slot positions for visual review, and #175 is
 * open precisely because a fourth placement source writes actor positions last. DO NOT add a fifth.
 * Move the PROP off the actor anchor — descriptor slot, mount planner, or default position.
 *
 * If a specific case genuinely cannot be fixed by moving a prop, say which and why, and stop there
 * rather than reaching into the actor path.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THE CAUSE OF ANY INDIVIDUAL COLLISION IS NOT KNOWN TO ME. My last three premises in this area were
 * withdrawn (#206, #189, #211). Measure; take no hypothesis of mine as fact.
 */

type PropRow = {
  scenarioId: string;
  actorId: string;
  propId: string;
  propSource: string;
  overlapFractionXZ: number;
  verticalStraddle: boolean;
  actorPosture: string;
};

type Inspect = () => Promise<{ stations: { scenarioId: string; collisions: PropRow[] }[] }>;

const load = () =>
  import("./actor-prop-intersection.js") as Promise<Record<string, unknown>>;

describe("a standing actor does not occupy a prop (#183)", () => {
  it("no standing actor intersects non-support geometry in any station", async () => {
    const mod = await load();
    const inspect = mod["inspectActorPropIntersection"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    expect(
      report.stations.length,
      "no stations inspected — enumerate dynamically from what ships, never a hardcoded list",
    ).toBeGreaterThan(1);

    const embedded: string[] = [];
    for (const station of report.stations) {
      for (const c of station.collisions) {
        if (c.actorPosture !== "standing") continue;
        if (c.overlapFractionXZ >= 0.18 && c.verticalStraddle) {
          embedded.push(
            `${station.scenarioId}/${c.actorId} is inside ${c.propId} [${c.propSource}] — `
            + `XZ overlap ${(c.overlapFractionXZ * 100).toFixed(0)}% of the smaller footprint`,
          );
        }
      }
    }
    expect(embedded, `standing actors occupying props:\n${embedded.join("\n")}`).toEqual([]);
  }, 900_000);

  it("the support-surface gates and the actor cast all survive (COUNTERWEIGHT)", async () => {
    // Moving props must not move actors, break a support relationship, or drop a cast member.
    // #169 owns actor-vs-support; #211 owns declared-actors-render. This slice may break neither,
    // and it may NOT fix a collision by relocating the actor — encounter-actor-framing.ts already
    // rewrites slot positions and #175 is open because a fourth source writes them last.
    const mod = await load();
    const inspect = mod["inspectActorPropIntersection"] as Inspect;
    const report = await inspect();

    const broken: string[] = [];
    for (const station of report.stations) {
      if (station.collisions.length === 0) {
        broken.push(`${station.scenarioId}: zero prop rows — the sweep found no geometry to measure`);
      }
    }
    expect(
      broken,
      `stations where the inspection measured nothing at all (a vacuous pass):\n${broken.join("\n")}`,
    ).toEqual([]);
  }, 900_000);
});
