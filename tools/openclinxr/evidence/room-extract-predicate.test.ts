import { describe, expect, it } from "vitest";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { reportForGlb, runPredicate } from "./room-extract-predicate.js";

/**
 * **Room predicate — a deterministic extract-time gate for which extracted Infinigen room
 * suits which station (Q1).**
 *
 * Rooms brief (2026-08-18). Two defects measured on the shipped rooms:
 *   1. The peds exterior mesh carried an interior L-shaped wall fragment — 10 faces /
 *      7.95 m² front-facing toward the derived interior eye at (-2.42, 1.70, 1.90) — that
 *      occluded the whole viewport (0.3% non-black). `--drop-interior-hull-faces` now
 *      removes centroid-inside-interior faces BY DEFAULT (719cadf8 made it opt-in).
 *   2. The peds left +Z corner sat in a pocket behind `kitchen_00wall` (look-ray hit at
 *      0.94 m vs actors 2.05 m); capture scoring now rejects it. The extract predicate
 *      must refuse a room whose doorway-candidate set is empty under the same look-ray
 *      rule, so a future bake cannot ship a pocket-only room.
 *
 * The predicate (`tools/openclinxr/asset-pipeline/environment/room_extract_predicate.py`,
 * pure stdlib, no bpy) measures, on the shipped centred frame (floor top y=0):
 *   floorAspect, floorAreaM2, ceilingHeightM, hullFrontFacingToDoorwayEyeCount (max over
 *   the 5 doorway-side candidate eyes), doorwayCandidateSurviveCount (candidates with any
 *   unobstructed sightline into the interior). Thresholds are DERIVED from the two shipped
 *   rooms (ED known-good, peds post-719cadf8 known-good after the drop) and recorded in
 *   the predicate JSON under `derivedFrom`.
 *
 * These tests are the planted RED for the pre-fix peds hull: if the predicate ever accepts
 * a hull carrying 10 interior front-facing faces (or a room whose doorway candidates are
 * all pockets, or the corridor shape class), the suite goes red.
 *
 * claimScope: predicate dry-run on the two shipped room GLBs and synthetic fixtures.
 * notEvidenceFor: the remaining 12 station rooms, interior framing, Quest readiness.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const ENV_DIR = join(REPO_ROOT, "apps/ui-xr/public/xr-assets/environment");

const ED_GLB = join(ENV_DIR, "infinigen-ed-exam-bay.glb");
const PEDS_GLB = join(ENV_DIR, "infinigen-pediatric-urgent-care-bay.glb");

/** Known-good measures the predicate recorded for the shipped bytes (anti-drift rows). */
const ED_KNOWN = { floorAspect: 1.02, floorAreaM2: 39.85, ceilingHeightM: 2.401, hullFrontFacingToDoorwayEyeCount: 8, doorwayCandidateSurviveCount: 5 };
const PEDS_KNOWN = { floorAspect: 1.021, floorAreaM2: 28.47, ceilingHeightM: 2.445, hullFrontFacingToDoorwayEyeCount: 4, doorwayCandidateSurviveCount: 4 };

// --- synthetic fixture builders ------------------------------------------------------
// Winding convention: three.js CCW front faces; the predicate's front-facing test uses the
// geometric normal cross(b-a, c-a). Each helper produces quads with the requested outward
// normal; verified against the shipped-room behaviour (proper shells measure 0 front-facing).
type V3 = [number, number, number];
type Tri = [V3, V3, V3];

function quad(a: V3, b: V3, c: V3, d: V3): Tri[] {
  return [
    [a, b, c],
    [a, c, d],
  ];
}

/** Rectangle in plane x=x0, y∈[y0,y1], z∈[z0,z1]; normal ±X. */
function rectX(x0: number, y0: number, y1: number, z0: number, z1: number, normal: "+x" | "-x"): Tri[] {
  const a: V3 = [x0, y0, z0], b: V3 = [x0, y0, z1], c: V3 = [x0, y1, z1], d: V3 = [x0, y1, z0];
  return normal === "-x" ? quad(a, b, c, d) : [[a, c, b], [a, d, c]];
}

/** Rectangle in plane z=z0, x∈[x0,x1], y∈[y0,y1]; normal ±Z. */
function rectZ(z0: number, x0: number, x1: number, y0: number, y1: number, normal: "+z" | "-z"): Tri[] {
  const a: V3 = [x0, y0, z0], b: V3 = [x1, y0, z0], c: V3 = [x1, y1, z0], d: V3 = [x0, y1, z0];
  return normal === "+z" ? quad(a, b, c, d) : [[a, c, b], [a, d, c]];
}

/** Rectangle in plane y=y0, x∈[x0,x1], z∈[z0,z1]; normal ±Y. */
function rectY(y0: number, x0: number, x1: number, z0: number, z1: number, normal: "+y" | "-y"): Tri[] {
  const a: V3 = [x0, y0, z0], b: V3 = [x1, y0, z0], c: V3 = [x1, y0, z1], d: V3 = [x0, y0, z1];
  return normal === "-y" ? quad(a, b, c, d) : [[a, c, b], [a, d, c]];
}

/** Closed box room with an offset exterior shell, in the extract's centred frame. */
function boxRoom(x: number, z: number, yh: number, wallThickness: number): Record<string, Tri[]> {
  const xh = x / 2, zh = z / 2;
  const parts: Record<string, Tri[]> = {};
  parts["room.floor"] = rectY(0, -xh, xh, -zh, zh, "+y");
  parts["room.ceiling"] = rectY(yh, -xh, xh, -zh, zh, "-y");
  parts["room.wall"] = [
    ...rectZ(zh, -xh, xh, 0, yh, "+z"),
    ...rectZ(-zh, -xh, xh, 0, yh, "-z"),
    ...rectX(xh, 0, yh, -zh, zh, "-x"),
    ...rectX(-xh, 0, yh, -zh, zh, "+x"),
  ];
  const hx = xh + wallThickness, hz = zh + wallThickness;
  parts["room.exterior"] = [
    ...rectY(-wallThickness, -hx, hx, -hz, hz, "-y"),
    ...rectY(yh + wallThickness, -hx, hx, -hz, hz, "+y"),
    ...rectZ(hz, -hx, hx, -wallThickness, yh + wallThickness, "+z"),
    ...rectZ(-hz, -hx, hx, -wallThickness, yh + wallThickness, "-z"),
    ...rectX(hx, -wallThickness, yh + wallThickness, -hz, hz, "+x"),
    ...rectX(-hx, -wallThickness, yh + wallThickness, -hz, hz, "-x"),
  ];
  return parts;
}

/**
 * The pre-fix peds hull class: a full-height interior L-sheet (10 triangles — 6 on a -X
 * arm at x=-2.0, 4 on a +Z arm at z=1.2 — facing the room interior, matching the recorded
 * "10 faces / 7.95 m² front-facing toward the derived eye"). The arms meet at the left
 * corner pocket, so the left doorway candidate's view into the room is fully enclosed
 * (rejected by the look-ray rule, like peds' kitchen_00wall pocket).
 */
function preFixPedsRoom(): Record<string, Tri[]> {
  const parts = boxRoom(5.28, 5.39, 2.44, 0.1093);
  const sheet: Tri[] = [];
  for (let i = 0; i < 3; i++) {
    const z0 = 1.0 + i * (1.44 / 3);
    const z1 = 1.0 + (i + 1) * (1.44 / 3);
    sheet.push(...rectX(-2.0, 0.8, 1.7, z0, z1, "-x"));
  }
  for (let i = 0; i < 2; i++) {
    const x0 = -2.6 + i * 0.5;
    const x1 = -2.6 + (i + 1) * 0.5;
    sheet.push(...rectZ(1.2, x0, x1, 0.8, 1.7, "+z"));
  }
  parts["kitchen_0/0.exterior"] = sheet;
  return parts;
}

describe("the extract-time room predicate", () => {
  it("ships both known-good rooms: live measures match the derivedFrom rows and both pass", async () => {
    const ed = await reportForGlb(ED_GLB, "dining-room_0");
    const peds = await reportForGlb(PEDS_GLB, "kitchen_0");
    expect(ed.pass, `ED refused: ${ed.refuseReasons.join("; ")}`).toBe(true);
    expect(peds.pass, `peds refused: ${peds.refuseReasons.join("; ")}`).toBe(true);
    // Anti-drift: the embedded derivedFrom rows are this predicate's own live measurement
    // of the shipped bytes; if a re-bake changes a room's measures, the rows go stale and
    // this fails (the thresholds were derived from them).
    expect(ed.measures.floorAspect).toBeCloseTo(ED_KNOWN.floorAspect, 2);
    expect(ed.measures.floorAreaM2).toBeCloseTo(ED_KNOWN.floorAreaM2, 1);
    expect(ed.measures.ceilingHeightM).toBeCloseTo(ED_KNOWN.ceilingHeightM, 2);
    expect(ed.measures.hullFrontFacingToDoorwayEyeCount).toBe(ED_KNOWN.hullFrontFacingToDoorwayEyeCount);
    expect(ed.measures.doorwayCandidateSurviveCount).toBe(ED_KNOWN.doorwayCandidateSurviveCount);
    expect(peds.measures.floorAspect).toBeCloseTo(PEDS_KNOWN.floorAspect, 2);
    expect(peds.measures.floorAreaM2).toBeCloseTo(PEDS_KNOWN.floorAreaM2, 1);
    expect(peds.measures.ceilingHeightM).toBeCloseTo(PEDS_KNOWN.ceilingHeightM, 2);
    expect(peds.measures.hullFrontFacingToDoorwayEyeCount).toBe(PEDS_KNOWN.hullFrontFacingToDoorwayEyeCount);
    expect(peds.measures.doorwayCandidateSurviveCount).toBe(PEDS_KNOWN.doorwayCandidateSurviveCount);
  }, 60_000);

  it("RED: refuses the pre-fix peds hull — 10 interior front-facing faces toward the doorway eye", () => {
    // The recorded pre-fix peds measurement: 10 faces front-facing toward the derived eye.
    // The predicate measures the same class (max over the doorway-side candidate eyes) and
    // must refuse it; the shipped rooms measure 8 and 4, so 10 sits above the derived max.
    const r = runPredicate({ room: "kitchen_0", parts: preFixPedsRoom() });
    expect(r.measures.hullFrontFacingToDoorwayEyeCount).toBe(10);
    expect(r.pass).toBe(false);
    expect(r.refuseReasons.join(" ")).toMatch(/hullFrontFacingToDoorwayEyeCount/);
  });

  it("RED: refuses a pocket-only room — zero surviving doorway candidates under the look-ray rule", () => {
    // A full-width partition behind the +Z side encloses every doorway candidate; the
    // capture scoring would reject all of them (kitchen_00wall class), so the extract must
    // refuse rather than ship a room no interior camera can see into.
    const parts = boxRoom(5.28, 5.39, 2.44, 0.1093);
    parts["room.wall"] = [...parts["room.wall"], ...rectZ(2.3, -2.64, 2.64, 0, 2.44, "+z")];
    const r = runPredicate({ room: "pocket_only", parts });
    expect(r.measures.doorwayCandidateSurviveCount).toBe(0);
    expect(r.pass).toBe(false);
    expect(r.refuseReasons.join(" ")).toMatch(/doorwayCandidateSurviveCount/);
  });

  it("RED: refuses the corridor shape class (aspect 2.02, #407) outside the derived band", () => {
    const r = runPredicate({ room: "corridor", parts: boxRoom(8.0, 4.0, 2.4, 0.12) });
    expect(r.measures.floorAspect).toBe(2.0);
    expect(r.pass).toBe(false);
    expect(r.refuseReasons.join(" ")).toMatch(/floorAspect/);
  });

  it("accepts a clean synthetic box room (the ED shape class)", () => {
    const r = runPredicate({ room: "clean_box", parts: boxRoom(6.5, 6.5, 2.4, 0.12) });
    expect(r.measures).toMatchObject({
      floorAspect: 1.0,
      floorAreaM2: 42.25,
      ceilingHeightM: 2.4,
      hullFrontFacingToDoorwayEyeCount: 0,
      doorwayCandidateSurviveCount: 5,
    });
    expect(r.pass).toBe(true);
  });

  it("records the derivedFrom threshold derivation in the predicate JSON", async () => {
    const ed = await reportForGlb(ED_GLB, "dining-room_0");
    expect(ed.derivedFrom.method.length).toBeGreaterThan(50);
    expect(ed.derivedFrom.rooms).toHaveLength(2);
    const files = ed.derivedFrom.rooms.map((r) => (r as { file: string }).file);
    expect(files.join(" ")).toMatch(/infinigen-ed-exam-bay\.glb/);
    expect(files.join(" ")).toMatch(/infinigen-pediatric-urgent-care-bay\.glb/);
    // The derive thresholds are a function of the shipped measurements.
    expect(ed.thresholds.hullFrontFacingToDoorwayEyeCount.max).toBe(8);
    expect(ed.thresholds.floorAspect.max).toBeGreaterThan(1.4);
    expect(ed.thresholds.floorAspect.max).toBeLessThan(1.6);
    expect(ed.thresholds.doorwayCandidateSurviveCount.min).toBe(1);
  }, 60_000);
});
