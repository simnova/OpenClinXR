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
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { glbGeometryDigest, repoRoot } from "@openclinxr/factory-station-core/runner";
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
  geometrySha256: string;
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

/** One actor file measured into its seat row (T1 and A1 P2 share this path). */
function measureRowFor(actorPath: string, actor: string): MeasureRow {
  const measured = measureTeethSeat(actorPath);
  return {
    actor,
    geometrySha256: glbGeometryDigest(new Uint8Array(readFileSync(actorPath))),
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
}

function measureRows(): { rows: MeasureRow[]; bounds: MeasureBounds } {
  const rows = kgActors().map((actor) => measureRowFor(join(DIR, actor), actor));
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

/** T1 identity gate, shared with the A1 P2 counterweight: a row whose pin
 * differs from the committed pin refuses (re-measure), whatever produced it. */
function seatGateRefuses(row: MeasureRow, expected: MeasureRow): boolean {
  return expected.geometrySha256 !== row.geometrySha256;
}

/** T1 refusal path (T1 and A1 P2 share it: disabling this branch breaks P2). */
function refuseStaleSeatRows(rows: MeasureRow[], committedRows: MeasureRow[]): void {
  for (const row of rows) {
    const expected = committedRows.find((candidate) => candidate.actor === row.actor)!;
    expect(expected, `seat json has no row for ${row.actor}`).toBeDefined();
    if (seatGateRefuses(row, expected)) {
      throw new Error(`re-measure: ${row.actor} GLB geometry changed`);
    }
  }
}

describe("the physician teeth seat in its mouth", () => {
  it("T1: the 10 known-good seat rows and bounds equal the committed measure json", () => {
    if (process.env["OPENCLINXR_WRITE_SEAT_MEASURE"] === "1") writeMeasureJson();
    const { rows, bounds } = measureRows();
    const committed = readMeasureJson();
    expect(committed.rows.map((row) => row.actor)).toEqual(rows.map((row) => row.actor));
    refuseStaleSeatRows(rows, committed.rows);
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

describe("A1 seat-geometry pin (C3a: a material-only stage re-pins no geometry file)", () => {
  const NURSE_GLB = join(DIR, NURSE);

  function committedNursePin(): string {
    const doc = JSON.parse(readFileSync(MEASURE_JSON, "utf8")) as { rows: { actor: string; geometrySha256: string }[] };
    const row = doc.rows.find((r) => r.actor === NURSE)!;
    expect(row, "seat json has no nurse row").toBeDefined();
    return row.geometrySha256;
  }

  /** Material-only variant: one parsed baseColorFactor component +0.05; JSON chunk lengths repaired. */
  function withMaterialOnlyTweak(shipped: Uint8Array): { bytes: Uint8Array; before: number; after: number } {
    const buf = Buffer.from(shipped);
    const jsonLen = buf.readUInt32LE(12);
    const text = buf.subarray(20, 20 + jsonLen).toString("utf8");
    const arrM = /"baseColorFactor":\[([^\]]*)\]/.exec(text);
    if (!arrM) throw new Error("A1 P1 setup: baseColorFactor array missing from JSON text");
    const tok = /-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(arrM[1]!)!;
    const before = Number(tok[0]);
    const after = Math.min(1, before + 0.05);
    const absIdx = arrM.index + arrM[0].indexOf(arrM[1]!) + tok.index;
    let next = text.slice(0, absIdx) + String(after) + text.slice(absIdx + tok[0].length);
    next += " ".repeat((4 - (Buffer.byteLength(next, "utf8") % 4)) % 4);
    const nextBytes = Buffer.from(next, "utf8");
    const binStart = 20 + jsonLen;
    const out = Buffer.alloc(20 + nextBytes.length + (buf.length - binStart));
    buf.subarray(0, 8).copy(out, 0);
    out.writeUInt32LE(nextBytes.length, 12);
    buf.subarray(16, 20).copy(out, 16);
    nextBytes.copy(out, 20);
    buf.subarray(binStart).copy(out, 20 + nextBytes.length);
    out.writeUInt32LE(out.length, 8);
    return { bytes: new Uint8Array(out.buffer, out.byteOffset, out.byteLength), before, after };
  }

  /** 1-ULP edit of the first float of the first float-POSITION accessor (in-memory copy). */
  function withOneUlpPositionEdit(shipped: Uint8Array): { bytes: Uint8Array; beforeHex: string; afterHex: string } {
    const buf = Buffer.from(shipped);
    const jsonLen = buf.readUInt32LE(12);
    const doc = JSON.parse(buf.subarray(20, 20 + jsonLen).toString("utf8")) as {
      meshes?: { primitives?: { attributes?: Record<string, number> }[] }[];
      accessors?: { bufferView?: number; byteOffset?: number; componentType?: number }[];
      bufferViews?: { byteOffset?: number }[];
    };
    let at = -1;
    for (const mesh of doc.meshes ?? []) {
      for (const prim of mesh.primitives ?? []) {
        const ai = prim.attributes?.["POSITION"];
        const acc = ai === undefined ? undefined : doc.accessors?.[ai];
        const bv = acc?.bufferView === undefined ? undefined : doc.bufferViews?.[acc.bufferView];
        if (acc !== undefined && bv !== undefined && acc.componentType === 5126) {
          at = 20 + jsonLen + 8 + (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0);
          break;
        }
      }
      if (at >= 0) break;
    }
    if (at < 0) throw new Error("A1 P2 setup: no float POSITION accessor");
    const beforeHex = buf.subarray(at, at + 4).toString("hex");
    buf.writeUInt32LE(buf.readUInt32LE(at) + 1, at);
    const afterHex = buf.subarray(at, at + 4).toString("hex");
    if (afterHex === beforeHex) throw new Error("A1 P2 setup: ULP edit did not change bytes");
    return { bytes: new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength), beforeHex, afterHex };
  }

  it("A1 P1 material-blind: a material-only copy keeps the nurse seat-geometry pin", () => {
    const shipped = new Uint8Array(readFileSync(NURSE_GLB));
    const liveSha = createHash("sha256").update(shipped).digest("hex");
    const tweak = withMaterialOnlyTweak(shipped);
    const copySha = createHash("sha256").update(tweak.bytes).digest("hex");
    console.log("A1 P1", { before: tweak.before, after: tweak.after, liveSha, copySha });
    expect(tweak.after, "material tweak must change the parsed component").not.toBe(tweak.before);
    expect(copySha, "material-only copy must differ in whole bytes from the live GLB").not.toBe(liveSha);
    // The parsed material JSON of the mutant carries the new component value (not just the regex token).
    const mutantBuf = Buffer.from(tweak.bytes);
    const mutatedDoc = JSON.parse(mutantBuf.subarray(20, 20 + mutantBuf.readUInt32LE(12)).toString("utf8")) as {
      materials?: { pbrMetallicRoughness?: { baseColorFactor?: number[] } }[];
    };
    const parsedFactors = (mutatedDoc.materials ?? []).flatMap((m) => m.pbrMetallicRoughness?.baseColorFactor ?? []);
    expect(parsedFactors, "mutated GLB parses a material factor carrying the tweak").toContain(tweak.after);
    expect(glbGeometryDigest(tweak.bytes), "material-only copy must keep the live geometry digest").toBe(
      glbGeometryDigest(shipped),
    );
    expect(glbGeometryDigest(tweak.bytes), "tweaked copy must match the committed pin").toBe(committedNursePin());
  }, 30_000);

  it("A1 P2 counterweight: a 1-ULP POSITION edit refuses as stale", () => {
    const shipped = new Uint8Array(readFileSync(NURSE_GLB));
    const edit = withOneUlpPositionEdit(shipped);
    console.log("A1 P2", { beforeHex: edit.beforeHex, afterHex: edit.afterHex });
    expect(edit.afterHex, "ULP edit must change accessor bytes").not.toBe(edit.beforeHex);
    // The mutant GLB goes through T1's own row-reading + refusal path: a
    // loosened T1 gate breaks this refusal instead of passing silently.
    const dir = mkdtempSync(join(tmpdir(), "h11-a1-p2-"));
    try {
      const mutant = join(dir, NURSE);
      writeFileSync(mutant, edit.bytes);
      const committed = JSON.parse(readFileSync(MEASURE_JSON, "utf8")) as { rows: MeasureRow[] };
      expect(() => refuseStaleSeatRows([measureRowFor(mutant, NURSE)], committed.rows)).toThrow(/re-measure/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 300_000);

  it("A1 P3 known-good: the shipped nurse passes the new pin", () => {
    const shipped = new Uint8Array(readFileSync(NURSE_GLB));
    expect(glbGeometryDigest(shipped)).toBe(committedNursePin());
  }, 30_000);
});
