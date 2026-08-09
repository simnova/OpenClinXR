import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";

/**
 * PLANTED CONTRACTS (#239). Deeper post-opt ladder toward station band (MADR 0050).
 *
 * First-pass postopt (#235/#237) at ratio 0.10:
 *   wall-clock ~93k, bedside-monitor ~141k, ecg-cart ~184k
 * Station soft target ≤60k per prop; hard ceiling 180k. Clock is closest; ECG/monitor still fat.
 *
 * Job: multi-rung simplify ladder on existing raw or stage-1 postopt GLBs (no re-bake TRELLIS).
 * Record raw → stage1 → stage2(+), feature survival (non-zero extent, not collapsed).
 *
 * Header IMMUTABLE — append ## FIXED (#239).
 */

type LadderRung = {
  label: string;
  ratio: number;
  triangleCount: number;
  bytes: number;
  path: string;
};

type SubjectLadder = {
  subjectId: string;
  rungs: LadderRung[];
  bestUnderSoftTarget: boolean; // ≤60k
  bestUnderHardCeiling: boolean; // ≤180k
  featureSurvival: "ok" | "collapsed" | "unknown";
};

type Report = {
  subjects: SubjectLadder[];
  softTarget: number;
  hardCeiling: number;
  claimScope: string[];
  notEvidenceFor: string[];
};

type Inspect = () => Promise<Report>;
const load = () =>
  import("./trellis-deeper-postopt.js") as Promise<Record<string, unknown>>;

describe("TRELLIS deeper post-opt ladder to station band (#239)", () => {
  it("ladder report covers ≥2 equipment subjects with multi-rung counts", async () => {
    const mod = await load();
    const inspect = mod["inspectTrellisDeeperPostopt"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");
    const r = await inspect!();
    expect(r.softTarget).toBe(60_000);
    expect(r.hardCeiling).toBe(180_000);
    expect(r.subjects.length).toBeGreaterThanOrEqual(2);
    for (const s of r.subjects) {
      expect(s.rungs.length).toBeGreaterThanOrEqual(2);
      // rungs should be non-increasing tris
      for (let i = 1; i < s.rungs.length; i++) {
        expect(s.rungs[i].triangleCount).toBeLessThanOrEqual(s.rungs[i - 1].triangleCount);
      }
    }
    expect(r.notEvidenceFor.join(" ")).toMatch(/quest|clinical|adopt/i);
  }, 600_000);

  it("at least one subject reaches soft ≤60k with featureSurvival ok, or all documented under hard ceiling with survival (COUNTERWEIGHT)", async () => {
    const mod = await load();
    const inspect = mod["inspectTrellisDeeperPostopt"] as Inspect;
    const r = await inspect();
    const okSoft = r.subjects.filter((s) => s.bestUnderSoftTarget && s.featureSurvival === "ok");
    const okHard = r.subjects.filter((s) => s.bestUnderHardCeiling && s.featureSurvival === "ok");
    if (okSoft.length === 0) {
      // Allow hard-ceiling-only if survival holds for all attempted subjects
      expect(okHard.length).toBe(r.subjects.length);
      expect(existsSync(".openclinxr/evidence/issue-239/ladder-report.json")).toBe(true);
    } else {
      expect(okSoft.length).toBeGreaterThanOrEqual(1);
    }
    // Every subject must have a written ladder path on disk
    for (const s of r.subjects) {
      const last = s.rungs[s.rungs.length - 1];
      expect(existsSync(last.path), last.path).toBe(true);
    }
  }, 600_000);
});
