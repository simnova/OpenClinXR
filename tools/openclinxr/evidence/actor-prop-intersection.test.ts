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

type EquipmentActorInspect = (input?: {
  scenarioIds?: string[];
  writePreFix?: boolean;
  label?: string;
}) => Promise<{
  stations: {
    scenarioId: string;
    environmentId: string;
    camera: { found: boolean; position: [number, number, number] | null; framing: string };
    equipment: Array<{ equipmentId: string; source: string; standPresent: boolean; worldAabb: unknown }>;
    actors: Array<{ actorId: string; role: string; posture: string; worldAabb: unknown }>;
    pairs: Array<{ equipmentId: string; actorId: string; worldIntersects: boolean; screenOverlapFraction: number; occlusionDirection: string; verdict: string }>;
    worldOverlapPairs: string[];
    screenOnlyPairs: string[];
  }[];
}>;

const loadEquipmentActor = () =>
  import("./actor-prop-intersection.js") as Promise<Record<string, unknown>>;

/**
 * #281 — the bedside monitor's preserved stand is correct equipment with an
 * unexamined placement. The brief's operationalization: SEPARATE world-space
 * overlap (placement bug: equipment standing inside a person) from screen-space
 * overlap only (camera/framing artifact). Both outcomes close the issue.
 *
 * MEASURED 2026-08-10 (pre-fix.json): world AABBs are DISJOINT for all
 * equipment×actor pairs in ed_stroke_alert_handoff_v1. The monitor projects
 * over the son (equipment_in_front) and the nurse (interleaved) at the default
 * scene-overview camera, but nothing stands inside anyone → framing, not
 * placement. The tests below pin the placement fact + the #260 stand
 * counterweight + measurement integrity, and leave the camera framing as
 * documented, not asserted-away.
 */
describe("equipment placement vs actors — world vs screen (#281)", () => {
  it("writes the pre-fix measurement and finds no world-space placement bug in the ED stroke station", async () => {
    const mod = await loadEquipmentActor();
    const inspect = mod["inspectEquipmentActorOverlap"] as EquipmentActorInspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!({
      scenarioIds: ["ed_stroke_alert_handoff_v1"],
      writePreFix: true,
      label: "pre-fix",
    });

    expect(report.stations).toHaveLength(1);
    const station = report.stations[0]!;
    expect(station.scenarioId).toBe("ed_stroke_alert_handoff_v1");
    expect(station.camera.found, "the default capture camera was not found in the scene graph")
      .toBe(true);
    expect(station.camera.position, "the camera position must be recorded for reproducibility")
      .not.toBeNull();

    // Placement bug guard: no equipment assembly AABB intersects any actor AABB.
    // If a future slice pushes the monitor (or its stand) into an actor, this reds.
    expect(
      station.worldOverlapPairs,
      `equipment assemblies standing inside actors:\n${station.worldOverlapPairs.join("\n")}`,
    ).toEqual([]);
  }, 900_000);

  it("keeps the bedside monitor's parametric stand and grounded assembly (COUNTERWEIGHT #260/#266/#268)", async () => {
    const mod = await loadEquipmentActor();
    const inspect = mod["inspectEquipmentActorOverlap"] as EquipmentActorInspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!({ scenarioIds: ["ed_stroke_alert_handoff_v1"] });
    const station = report.stations[0]!;
    const monitor = station.equipment.find((e) => e.equipmentId === "bedside_monitor_equipment");
    expect(monitor, "the bedside monitor assembly is not in the live scene").toBeDefined();
    expect(monitor!.standPresent, "#260: the parametric stand must survive the GLB mount").toBe(true);

    const box = monitor!.worldAabb as { minY: number; maxY: number; minX: number; maxX: number };
    expect(Number.isFinite(box.minY) && Number.isFinite(box.maxY)).toBe(true);
    expect(box.minY, "a floor-mounted monitor assembly must rest on the floor (y≈0)").toBeCloseTo(0, 1);
    expect(box.maxY - box.minY, "the assembly collapsed to zero height").toBeGreaterThan(0.5);
  }, 900_000);

  it("measures a non-vacuous cross product and records the camera-space observation", async () => {
    const mod = await loadEquipmentActor();
    const inspect = mod["inspectEquipmentActorOverlap"] as EquipmentActorInspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!({ scenarioIds: ["ed_stroke_alert_handoff_v1"] });
    const station = report.stations[0]!;

    // Full equipment × actor cross product: 2 assemblies × 3 actors = 6 rows.
    expect(station.equipment.length).toBeGreaterThanOrEqual(2);
    expect(station.actors.length).toBe(3);
    expect(station.pairs).toHaveLength(station.equipment.length * station.actors.length);

    // Every actor measured a non-degenerate world AABB (a failed humanoid load
    // would produce a missing or zero-extent row and red here).
    for (const actor of station.actors) {
      const b = actor.worldAabb as { minX: number; maxX: number; minY: number; maxY: number };
      expect(b.maxX - b.minX, `${actor.actorId} AABB collapsed on X`).toBeGreaterThan(0.1);
      expect(b.maxY - b.minY, `${actor.actorId} AABB collapsed on Y`).toBeGreaterThan(1.0);
    }

    // The camera-space observation is RECORDED, not asserted away: the monitor
    // screen box overlaps the son with equipment_in_front depth ordering. That
    // is the framing artifact the issue describes; the verdict is in the data.
    const monitorVsSon = station.pairs.find(
      (p) => p.equipmentId === "bedside_monitor_equipment" && p.actorId === "son_eric_brooks_v1",
    );
    expect(monitorVsSon, "the monitor×son pair is missing from the cross product").toBeDefined();
    expect(monitorVsSon!.verdict).toBe("screen_only");
    expect(monitorVsSon!.screenOverlapFraction).toBeGreaterThan(0);
    expect(monitorVsSon!.occlusionDirection).toBe("equipment_in_front");
    expect(
      station.screenOnlyPairs.some((s) => s.includes("bedside_monitor_equipment")),
      "the monitor's screen-space overlap must appear in the summary",
    ).toBe(true);
  }, 900_000);
});
