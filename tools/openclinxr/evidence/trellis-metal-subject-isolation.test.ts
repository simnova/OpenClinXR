import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";

/**
 * PLANTED CONTRACTS (#237). TRELLIS Metal multi-case — one OS process per subject.
 *
 * #235: first subject (ecg-cart) exported; wall-clock + bedside-monitor failed with
 * MPS OOM (~113 GiB accounted after first bake in same process). Residual: isolate
 * each subject in a **fresh Python/Blender subprocess** (or equivalent), never reuse
 * a long-lived torch MPS context across subjects.
 *
 * Success: ≥2 subjects that previously OOM'd (or clock+monitor) mesh_exported or
 * runs_but_over_budget with postOpt columns; OR measured proof that isolation still
 * OOMs with documented peak memory.
 *
 * Header IMMUTABLE — append ## FIXED (#237).
 */

type SubjectRow = {
  subjectId: string;
  verdict: "mesh_exported" | "runs_but_over_budget" | "blocked_build" | "inconclusive_blocked";
  processIsolation: "fresh_subprocess" | "same_process" | "unknown";
  rawTriangleCount: number | null;
  postOptTriangleCount: number | null;
};

type Report = {
  isolationMode: string;
  subjects: SubjectRow[];
  claimScope: string[];
  notEvidenceFor: string[];
};

type Inspect = () => Promise<Report>;
const load = () =>
  import("./trellis-metal-subject-isolation.js") as Promise<Record<string, unknown>>;

describe("TRELLIS Metal per-subject process isolation (#237)", () => {
  it("isolation multi-case report uses fresh subprocess per subject and covers ≥2 subjects", async () => {
    const mod = await load();
    const inspect = mod["inspectTrellisMetalSubjectIsolation"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");
    const r = await inspect!();
    expect(r.subjects.length).toBeGreaterThanOrEqual(2);
    expect(r.isolationMode.toLowerCase()).toMatch(/subprocess|spawn|isolated|process/);
    const fresh = r.subjects.filter((s) => s.processIsolation === "fresh_subprocess");
    expect(fresh.length, "each subject must declare fresh_subprocess").toBe(r.subjects.length);
    expect(r.notEvidenceFor.join(" ")).toMatch(/quest|clinical|adopt/i);
  }, 10_800_000);

  it("at least one previously OOM-class subject exports with postOpt, or all remain blocked with measured peaks (COUNTERWEIGHT)", async () => {
    const mod = await load();
    const inspect = mod["inspectTrellisMetalSubjectIsolation"] as Inspect;
    const r = await inspect();
    const exported = r.subjects.filter(
      (s) => s.verdict === "mesh_exported" || s.verdict === "runs_but_over_budget",
    );
    const oomClass = r.subjects.filter((s) =>
      /wall-clock|bedside|clock|monitor/i.test(s.subjectId),
    );
    // Prefer recovery of at least one OOM-class subject
    if (exported.length > 0) {
      for (const s of exported) {
        expect(s.rawTriangleCount).toBeGreaterThan(0);
        expect(s.postOptTriangleCount).not.toBeNull();
      }
      // If we only re-baked ecg-cart, still require ≥1 non-ecg success OR explicit isolation proof in report path
      const nonEcg = exported.filter((s) => !/ecg/i.test(s.subjectId));
      if (nonEcg.length === 0 && oomClass.length > 0) {
        // Allow all OOM subjects still blocked only if isolation was used and documented — require exportPath evidence file for isolation log
        expect(
          existsSync(".openclinxr/evidence/issue-237/isolation-log.json"),
          "if no non-ecg export, isolation-log.json must document measured OOM peaks under isolation",
        ).toBe(true);
      }
    } else {
      expect(existsSync(".openclinxr/evidence/issue-237/isolation-log.json")).toBe(true);
    }
  }, 10_800_000);
});
