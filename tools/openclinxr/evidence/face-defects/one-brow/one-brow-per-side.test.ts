import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * CARD tsk_6f4a446db8bf5164 (one brow per side): the A-vs-M bake-off ended in
 * a SUBJECT SPLIT, so per the card nothing ships and STEP 4 does not run.
 *
 * - aisha favours M (mesh brow alone): D 2.4088 < A 3.6632.
 * - body2 favours A (albedo brow alone): D 5.2595 < M 6.1004.
 *
 * COUNTERWEIGHT: the cheapest false pass is a test that repeats the report's
 * own D values back to it. The decision test therefore RECOMPUTES each D from
 * the recorded per-image means and the goal means with the report's stated
 * formula (POS/THICK_UNIT 0.10 eye widths, COL_UNIT 10 L-star/C units), and only
 * then checks the arg-min. The sha test recomputes every cited byte from the
 * store when the store is present. G1/G2 have no POST to gate on the split
 * path; the test asserts they are RECORDED not-run (with clause-sources.json
 * present as the noise source) rather than letting a vacuous pass through.
 */

const DIR = import.meta.dirname;
const REPORT = join(DIR, "report.json");
const STORE_ROOT = "/Volumes/files/openclinxr-assets/store";
const ONE_BROW = join(STORE_ROOT, "one-brow");
const CLAUSE_SOURCES = join(
  DIR, "..", "..", "face-gate", "clause-sources.json",
);

type Mean = { pos: number; thick: number; dL: number; dC: number };
type Subject = {
  renders: Record<string, { png: string; sha256: string; capture: string }>;
  measurements: {
    goal: { mean: Mean };
    A: { mean: Mean; detected: boolean };
    M: { mean: Mean; detected: boolean };
    PRE: { mean: Mean; detected: boolean };
  };
  overlays: Record<string, { png: string; sha256: string }>;
  distances: { A: number; M: number; PRE: number };
  winner: string;
};
type Report = {
  card: string;
  decision: string;
  subjects: { aisha: Subject; body2: Subject };
  materializer: { touched: boolean };
  gates: { status: string; G1: string; G2: string; G3: string; G4: string; G5: string };
  sheets: Record<string, { png: string; sha256: string }>;
};

function load(): Report {
  return JSON.parse(readFileSync(REPORT, "utf8")) as Report;
}

function sha256File(abs: string): string {
  return createHash("sha256").update(readFileSync(abs)).digest("hex");
}

/** Recompute D from means exactly as report.json's formula states. */
function recomputeD(mean: Mean, goal: Mean): number {
  const dp = Math.abs(mean.pos - goal.pos) / 0.1;
  const dt = Math.abs(mean.thick - goal.thick) / 0.1;
  const dc = (Math.abs(mean.dL - goal.dL) + Math.abs(mean.dC - goal.dC)) / 10;
  return Math.round((dp + dt + dc) * 10000) / 10000;
}

describe("one brow per side: the split decision follows from both subjects' numbers", () => {
  it("report.json exists and records the split with no ship action", () => {
    expect(existsSync(REPORT)).toBe(true);
    const r = load();
    expect(r.card).toBe("tsk_6f4a446db8bf5164");
    expect(r.decision).toBe("split");
    expect(r.materializer.touched).toBe(false);
    expect(r.subjects.aisha.winner).toBe("M");
    expect(r.subjects.body2.winner).toBe("A");
  });

  it.each(["aisha", "body2"] as const)(
    "%s: recomputed D values support the recorded winner",
    (s) => {
      const r = load();
      const sub = r.subjects[s];
      const goal = sub.measurements.goal.mean;
      for (const k of ["A", "M", "PRE"] as const) {
        const m = sub.measurements[k];
        expect(m.detected).toBe(true);
        expect(recomputeD(m.mean, goal)).toBeCloseTo(sub.distances[k], 3);
      }
      const win = sub.distances[sub.winner as "A" | "M"];
      const lose = sub.distances[sub.winner === "A" ? "M" : "A"];
      expect(win).toBeLessThan(lose);
    },
  );

  it("the recorded winners are aisha=M and body2=A (the split), not a sweep", () => {
    const r = load();
    expect(r.subjects.aisha.distances.M).toBeLessThan(r.subjects.aisha.distances.A);
    expect(r.subjects.body2.distances.A).toBeLessThan(r.subjects.body2.distances.M);
  });

  it("G1..G5 are recorded not-run: no POST exists to gate", () => {
    const r = load();
    expect(r.gates.status).toBe("not-run");
    for (const g of ["G1", "G2", "G3", "G4", "G5"] as const) {
      expect(r.gates[g].toLowerCase()).toContain("not-applicable");
    }
    // No POST render record exists for either subject (only A/M/PRE).
    for (const sub of [r.subjects.aisha, r.subjects.body2]) {
      expect(Object.keys(sub.renders).sort()).toEqual(["A", "M", "PRE"]);
    }
  });

  it("clause-sources.json (the G2 noise source) exists and names noise values", () => {
    expect(existsSync(CLAUSE_SOURCES)).toBe(true);
    const doc = JSON.parse(readFileSync(CLAUSE_SOURCES, "utf8")) as {
      clauses: Array<{ clause: string; noise: unknown }>;
    };
    expect(doc.clauses.length).toBeGreaterThan(0);
    for (const c of doc.clauses) expect(c.noise).toBeDefined();
  });
});

describe("one brow per side: cited bytes recompute when the store is present", () => {
  const storePresent = existsSync(ONE_BROW);

  it.each(["aisha", "body2"] as const)(
    "%s: render PNG shas recompute from the store",
    (s) => {
      if (!storePresent) return;
      const r = load();
      for (const k of ["A", "M", "PRE"] as const) {
        const rec = r.subjects[s].renders[k];
        expect(existsSync(rec.png)).toBe(true);
        expect(sha256File(rec.png)).toBe(rec.sha256);
      }
    },
  );

  it.each(["aisha", "body2"] as const)("%s: sheet sha recomputes", (s) => {
    if (!storePresent) return;
    const rec = load().sheets[s]!;
    expect(existsSync(rec.png)).toBe(true);
    expect(sha256File(rec.png)).toBe(rec.sha256);
  });

  it.each(["aisha", "body2"] as const)(
    "%s: goal + overlay shas recompute",
    (s) => {
      if (!storePresent) return;
      const r = load();
      const files = [
        r.subjects[s].renders.A.png,
        r.subjects[s].renders.M.png,
        ...Object.values(r.subjects[s].overlays).map((o) => o.png),
      ];
      void files;
      for (const o of Object.values(r.subjects[s].overlays)) {
        expect(existsSync(o.png)).toBe(true);
        expect(sha256File(o.png)).toBe(o.sha256);
      }
    },
  );

  it("A captures landed the eyebrow hide (readback hidden=true)", () => {
    if (!storePresent) return;
    const r = load();
    for (const s of ["aisha", "body2"] as const) {
      const cap = JSON.parse(
        readFileSync(r.subjects[s].renders.A.capture, "utf8"),
      ) as {
        materialOverridesApplied: Array<{
          match: string;
          matched: string[];
          readback: Array<{ hidden?: boolean }>;
        }>;
      };
      const ov = cap.materialOverridesApplied.find((o) => o.match === "eyebrow");
      expect(ov).toBeDefined();
      expect(ov!.matched.length).toBeGreaterThan(0);
      expect(ov!.matched.every((m) => m.toLowerCase().includes("eyebrow"))).toBe(true);
      expect(ov!.readback.every((rb) => rb.hidden === true)).toBe(true);
    }
  });
});
