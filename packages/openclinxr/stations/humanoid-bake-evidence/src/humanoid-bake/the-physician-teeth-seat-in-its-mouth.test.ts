/**
 * Seat gate for tsk_2a74bbdb3f03cb3e (physician teeth swap, gated on seat-in-mouth).
 *
 * The physician was excluded from the teeth/tongue swap because a body-similarity
 * gate missed on its chin; this file gates the swap on how the fitted teeth seat in
 * the mouth instead. Measure: ./teeth-seat-measure.ts (M1f = teeth verts whose +z
 * ray escapes the skin; M2s = incisal surface clearance; m1SignedSide/m2ClearanceMm
 * recorded only, superseded per card comment cmt_43acd416b71d3bca).
 *
 * NOTE on M2: the card says "nearest inner-lip skin vertex", but the body mesh has
 * no lip labels (and per-actor decimation gives different vertex counts: nurse 5155,
 * physician 4807), so the vertex clearance uses the nearest skin vertex of any label
 * and records which vertex it is (m2SkinVertexId + m2SkinVertex).
 *
 * T2/T3/T4/T4b are RED until the swap lands (the shipped physician still carries hm08
 * teeth/tongue and has no fitted teeth to seat). T5 is a self-check on a known-good
 * actor and is expected green.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "@openclinxr/factory-station-core/runner";
import { describe, expect, it } from "vitest";
import { measureTeethSeat } from "./teeth-seat-measure.js";

process.chdir(repoRoot());

const DIR = "apps/ui-xr/public/generated-humanoids";
const CARD = "tsk_2a74bbdb3f03cb3e";
const PHYSICIAN = "mpfb-clinical-physician-adult.glb";
const PHYSICIAN_SIDECAR = "apps/ui-xr/public/generated-humanoids/mpfb-clinical-physician-adult.provenance.json";
const BAKE_NATIVE_KNOWN_GOOD = "mpfb-peds-parent-aisha.glb";
const NURSE = "mpfb-clinical-nurse-adult.glb";
const STREET = "mpfb-street-adult-male.glb";
const MEASURE_JSON = "packages/openclinxr/stations/humanoid-bake-evidence/src/humanoid-bake/the-physician-teeth-seat-in-its-mouth.measure.json";
const SCHEMA = "openclinxr.teeth-seat-measure.v1";

type MeasureRow = {
  actor: string;
  glbSha256: string;
  m1SignedSide: number;
  m1f: number;
  teethVertexCount: number;
  orphanCount: number;
  skinTriangleCount: number;
  m2ClearanceMm: number;
  m2sMm: number;
  m2SkinVertexId: number;
  m2SkinVertex: [number, number, number];
};

type MeasureBounds = {
  m1fMax: number;
  m1fMaxActors: string[];
  m2sMinMm: number;
  m2sMinActor: string;
};

type NegativeControl = {
  skinActor: string;
  teethFrom: string;
  m1f: number;
  teethVertexCount: number;
  orphanCount: number;
  m2sMm: number;
  m2SkinVertexId: number;
  m2SkinVertex: [number, number, number];
  verdict: "inside" | "outside";
} | null;

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/** Known-good set: the 10 swapped actors (all shipped MPFB actors minus the pending physician swap and the bake-native peds-parent). */
function kgActors(): string[] {
  const actors = readdirSync(DIR)
    .filter((name) => /^mpfb-.*\.glb$/.test(name))
    .sort()
    .filter((name) => name !== PHYSICIAN && name !== BAKE_NATIVE_KNOWN_GOOD);
  expect(actors, "seat gate is pinned to the 10 swapped actors").toHaveLength(10);
  return actors;
}

function round6mm(valueMm: number): number {
  return Math.round(valueMm * 1e6) / 1e6;
}

function measureRows(): { rows: MeasureRow[]; bounds: MeasureBounds } {
  const rows = kgActors().map((actor) => {
    const measured = measureTeethSeat(join(DIR, actor));
    return {
      actor,
      glbSha256: sha256File(join(DIR, actor)),
      m1SignedSide: measured.m1SignedSide,
      m1f: measured.m1f,
      teethVertexCount: measured.teethVertexCount,
      orphanCount: measured.orphanCount,
      skinTriangleCount: measured.skinTriangleCount,
      m2ClearanceMm: round6mm(measured.m2ClearanceMm),
      m2sMm: round6mm(measured.m2sMm),
      m2SkinVertexId: measured.m2SkinVertexId,
      m2SkinVertex: measured.m2SkinVertex,
    } satisfies MeasureRow;
  });
  // m1fMax = max m1f over the 10 KG (expected 78: gown-inspect, ob-aisha, viseme-inspect).
  const m1fMax = Math.max(...rows.map((row) => row.m1f));
  const m1fMaxActors = rows.filter((row) => row.m1f === m1fMax).map((row) => row.actor);
  // m2sMinMm = min m2sMm over the 10 KG (expected 5.1327: street-adult-male).
  const m2Row = rows.reduce((a, b) => (b.m2sMm < a.m2sMm ? b : a));
  return {
    rows,
    bounds: { m1fMax, m1fMaxActors, m2sMinMm: m2Row.m2sMm, m2sMinActor: m2Row.actor },
  };
}

function measureNegativeControl(): NegativeControl {
  let measured: ReturnType<typeof measureTeethSeat>;
  try {
    measured = measureTeethSeat(join(DIR, STREET), { teethFrom: join(DIR, PHYSICIAN) });
  } catch {
    return null;
  }
  const { bounds } = readMeasureJson();
  const verdict = measured.m1f > bounds.m1fMax || measured.m2sMm < bounds.m2sMinMm ? "outside" : "inside";
  return {
    skinActor: STREET,
    teethFrom: PHYSICIAN,
    m1f: measured.m1f,
    teethVertexCount: measured.teethVertexCount,
    orphanCount: measured.orphanCount,
    m2sMm: round6mm(measured.m2sMm),
    m2SkinVertexId: measured.m2SkinVertexId,
    m2SkinVertex: measured.m2SkinVertex,
    verdict,
  };
}

/** Writes the measure json. Called only when OPENCLINXR_WRITE_SEAT_MEASURE=1; the test never writes otherwise. */
export function writeMeasureJson(): void {
  const { rows, bounds } = measureRows();
  const document = {
    schema: SCHEMA,
    card: CARD,
    measuredAt: new Date().toISOString(),
    tool: "packages/openclinxr/stations/humanoid-bake-evidence/src/humanoid-bake/teeth-seat-measure.ts",
    rows,
    bounds,
    negativeControl: measureNegativeControl(),
    supersededM1: {
      definition: "signed side to nearest skin triangle",
      verdict: "vacuous",
      evidence: "KG 3107-3114 of 3109-3115; nurse +5 mm 3114 -> 3114; card comment cmt_43acd416b71d3bca",
    },
  };
  writeFileSync(MEASURE_JSON, `${JSON.stringify(document, null, 2)}\n`);
}

function readMeasureJson(): { rows: MeasureRow[]; bounds: MeasureBounds; negativeControl: NegativeControl } {
  const document = JSON.parse(readFileSync(MEASURE_JSON, "utf8")) as {
    schema?: string;
    card?: string;
    rows?: MeasureRow[];
    bounds?: MeasureBounds;
    negativeControl?: NegativeControl;
  };
  expect(document.schema, "seat measure json schema").toBe(SCHEMA);
  expect(document.card, "seat measure json card").toBe(CARD);
  return { rows: document.rows ?? [], bounds: document.bounds!, negativeControl: document.negativeControl ?? null };
}

/** Reads the physician's teeth retreat delta (metres) from its provenance sidecar. */
function physicianRetreatDelta(): number {
  const named = (detail: string): Error =>
    new Error(`physician teeth swap pending ${CARD}: no teeth-rest-clearance retreat step in provenance sidecar until the swap (${detail})`);
  let sidecar: unknown;
  try {
    sidecar = JSON.parse(readFileSync(PHYSICIAN_SIDECAR, "utf8")) as unknown;
  } catch (error) {
    throw named(error instanceof Error ? error.message : String(error));
  }
  const postSteps = (sidecar as { teethSwapB1?: { postSteps?: Array<{ tool?: string; args?: string[] }> } }).teethSwapB1?.postSteps;
  if (!Array.isArray(postSteps)) throw named("sidecar has no teethSwapB1.postSteps");
  const retreat = postSteps.find((step) => String(step.tool ?? "").endsWith("teeth-rest-clearance.ts"));
  if (!retreat) throw named("postSteps has no teeth-rest-clearance.ts entry");
  const args = retreat.args ?? [];
  const at = args.indexOf("--delta");
  const delta = at >= 0 ? Number(args[at + 1]) : Number.NaN;
  if (!Number.isFinite(delta)) throw named(`unparseable --delta in ${JSON.stringify(args)}`);
  return delta;
}

describe("the physician teeth seat in its mouth", () => {
  it("T1: the 10 known-good seat rows and bounds equal the committed measure json", () => {
    if (process.env["OPENCLINXR_WRITE_SEAT_MEASURE"] === "1") writeMeasureJson();
    const { rows, bounds } = measureRows();
    const committed = readMeasureJson();
    expect(committed.rows.map((row) => row.actor)).toEqual(rows.map((row) => row.actor));
    for (const row of rows) {
      const expected = committed.rows.find((candidate) => candidate.actor === row.actor)!;
      expect(expected, `seat json has no row for ${row.actor}`).toBeDefined();
      if (expected.glbSha256 !== row.glbSha256) {
        throw new Error(`re-measure: ${row.actor} GLB changed`);
      }
    }
    expect({ rows, bounds }).toEqual({ rows: committed.rows, bounds: committed.bounds });
  }, 600_000);

  it("T2: the swapped physician seats its fitted teeth inside the known-good bounds", () => {
    let measured: ReturnType<typeof measureTeethSeat>;
    try {
      measured = measureTeethSeat(join(DIR, PHYSICIAN));
    } catch (error) {
      throw new Error(
        `physician teeth swap pending ${CARD}: no fitted teeth to seat until the swap (${error instanceof Error ? error.message : String(error)})`,
      );
    }
    const { bounds } = readMeasureJson();
    const m1fMargin = bounds.m1fMax - measured.m1f;
    const m2sMargin = measured.m2sMm - bounds.m2sMinMm;
    if (!(measured.m1f <= bounds.m1fMax && measured.m2sMm >= bounds.m2sMinMm)) {
      throw new Error(
        `physician seat m1f=${measured.m1f} (max ${bounds.m1fMax}, margin ${m1fMargin}) ` +
          `m2s=${measured.m2sMm}mm (min ${bounds.m2sMinMm}mm, margin ${m2sMargin}mm)`,
      );
    }
  }, 300_000);

  it("T3: street skin carrying physician teeth falls outside the known-good bounds", () => {
    let measured: ReturnType<typeof measureTeethSeat>;
    try {
      measured = measureTeethSeat(join(DIR, STREET), { teethFrom: join(DIR, PHYSICIAN) });
    } catch (error) {
      throw new Error(
        `physician teeth swap pending ${CARD}: RED until the swap, physician carries no fitted teeth yet (${error instanceof Error ? error.message : String(error)})`,
      );
    }
    const { bounds, negativeControl } = readMeasureJson();
    if (measured.m1f <= bounds.m1fMax && measured.m2sMm >= bounds.m2sMinMm) {
      throw new Error(
        `seat measure cannot tell a wrong mouth: street skin + physician teeth seats inside the bounds (m1f=${measured.m1f} <= ${bounds.m1fMax}, m2s=${measured.m2sMm}mm >= ${bounds.m2sMinMm}mm)`,
      );
    }
    if (negativeControl) {
      expect({
        m1f: measured.m1f,
        teethVertexCount: measured.teethVertexCount,
        orphanCount: measured.orphanCount,
        m2sMm: round6mm(measured.m2sMm),
        m2SkinVertexId: measured.m2SkinVertexId,
      }).toEqual({
        m1f: negativeControl.m1f,
        teethVertexCount: negativeControl.teethVertexCount,
        orphanCount: negativeControl.orphanCount,
        m2sMm: negativeControl.m2sMm,
        m2SkinVertexId: negativeControl.m2SkinVertexId,
      });
    }
  }, 300_000);

  it("T4 probe 1: physician teeth without the sidecar retreat fall below the surface bound", () => {
    const delta = physicianRetreatDelta();
    let base: ReturnType<typeof measureTeethSeat>;
    let shifted: ReturnType<typeof measureTeethSeat>;
    try {
      base = measureTeethSeat(join(DIR, PHYSICIAN));
      shifted = measureTeethSeat(join(DIR, PHYSICIAN), { teethOffsetZ: delta });
    } catch (error) {
      throw new Error(
        `physician teeth swap pending ${CARD}: RED until the swap, physician carries no fitted teeth yet (${error instanceof Error ? error.message : String(error)})`,
      );
    }
    const { bounds } = readMeasureJson();
    console.log(`physician retreat probe: delta=${delta}m base m2s=${base.m2sMm}mm shifted m2s=${shifted.m2sMm}mm bound=${bounds.m2sMinMm}mm`);
    if (!(shifted.m2sMm < bounds.m2sMinMm)) {
      throw new Error(
        `physician +retreat-delta probe m2s=${shifted.m2sMm}mm is not below m2sMin=${bounds.m2sMinMm}mm (base m2s=${base.m2sMm}mm, delta=${delta}m)`,
      );
    }
  }, 300_000);

  it("T4b probe 2: physician teeth shifted 5 mm forward fall below the surface bound", () => {
    let measured: ReturnType<typeof measureTeethSeat>;
    try {
      measured = measureTeethSeat(join(DIR, PHYSICIAN), { teethOffsetZ: 0.005 });
    } catch (error) {
      throw new Error(
        `physician teeth swap pending ${CARD}: RED until the swap, physician carries no fitted teeth yet (${error instanceof Error ? error.message : String(error)})`,
      );
    }
    const { bounds } = readMeasureJson();
    if (!(measured.m2sMm < bounds.m2sMinMm)) {
      throw new Error(
        `physician +5mm probe m2s=${measured.m2sMm}mm is not below m2sMin=${bounds.m2sMinMm}mm`,
      );
    }
  }, 300_000);

  it("T5: the surface measure responds to the defect direction on a known-good actor", () => {
    const base = measureTeethSeat(join(DIR, NURSE));
    const shifted = measureTeethSeat(join(DIR, NURSE), { teethOffsetZ: 0.005 });
    if (!(shifted.m2sMm < base.m2sMm)) {
      throw new Error(`nurse +5mm probe m2s=${shifted.m2sMm}mm is not below unshifted m2s=${base.m2sMm}mm`);
    }
  }, 300_000);
});
