import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";

/**
 * PLANTED CONTRACTS (#235). TRELLIS multi-case bake from Grok MV packs + MADR 0050 post-opt.
 *
 * #233 proved one ECG image → mesh_exported (991k tris, postOpt null). #232 shipped multi-view
 * packs for ecg-cart, wall-clock, bedside-monitor.
 *
 * This slice: bake ≥2 subjects from those packs (or documented blocked), run simplify/meshopt,
 * report rawTriangleCount AND postOptTriangleCount per subject. Do not reject solely on raw.
 *
 * Header IMMUTABLE — append ## FIXED (#235).
 */

type SubjectRow = {
  subjectId: string;
  verdict: "mesh_exported" | "runs_but_over_budget" | "blocked_build" | "inconclusive_blocked";
  rawTriangleCount: number | null;
  postOptTriangleCount: number | null;
  exportPath: string | null;
  postOptPath: string | null;
};

type Report = {
  subjects: SubjectRow[];
  claimScope: string[];
  notEvidenceFor: string[];
};

type Inspect = () => Promise<Report>;
const load = () =>
  import("./trellis-multicase-postopt.js") as Promise<Record<string, unknown>>;

describe("TRELLIS multi-case bake + post-opt (#235)", () => {
  it("multi-case report covers at least two subjects with named verdicts", async () => {
    const mod = await load();
    const inspect = mod["inspectTrellisMulticasePostopt"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");
    const r = await inspect!();
    expect(r.subjects.length).toBeGreaterThanOrEqual(2);
    for (const s of r.subjects) {
      expect(["mesh_exported", "runs_but_over_budget", "blocked_build", "inconclusive_blocked"]).toContain(
        s.verdict,
      );
    }
    expect(r.notEvidenceFor.join(" ")).toMatch(/quest|clinical|adopt/i);
  }, 7_200_000);

  it("any exported mesh records raw and postOpt triangle columns (COUNTERWEIGHT)", async () => {
    const mod = await load();
    const inspect = mod["inspectTrellisMulticasePostopt"] as Inspect;
    const r = await inspect();
    const exported = r.subjects.filter(
      (s) => s.verdict === "mesh_exported" || s.verdict === "runs_but_over_budget",
    );
    if (exported.length === 0) return;
    for (const s of exported) {
      expect(s.rawTriangleCount).toBeGreaterThan(0);
      expect(s.postOptTriangleCount, `${s.subjectId} missing postOpt (0050)`).not.toBeNull();
      expect(s.postOptTriangleCount!).toBeGreaterThan(0);
      expect(s.postOptTriangleCount!).toBeLessThanOrEqual(s.rawTriangleCount!);
      expect(s.exportPath && existsSync(s.exportPath)).toBe(true);
    }
  }, 7_200_000);
});
