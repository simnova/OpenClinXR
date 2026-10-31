/**
 * The cheek-brightness cause is found one layer at a time (card tsk_c309c61d93a899).
 *
 * WHY: gate G2M/mirror_cheek/Lratio_face fails body2 render-vs-photo 0.0542
 * vs frozen threshold 0.00835 (known-good Aisha 0.00289; known-bads 0.0375,
 * 0.0138). Mirroring cancels the photo's lateral key, so the residual is
 * render-side: body2's cheeks render brighter relative to its face than in
 * its photo. STEP 0 recomputes the mirrored cheek L* ratio (and mirrored
 * logY) on every regional-shading ablation render plus denominator variants,
 * with Aisha beside every body2 row. Candidates run one at a time only where
 * STEP 0 leaves them open (C1 rig, C2 geometry, C3 denominator); a
 * denominator that fixes body2 must keep Aisha passing AND keep
 * known-good/known-bad separation under the unchanged enforcement rule.
 * Falsifier: stop and report if nothing moves body2's delta below 0.00835
 * or by more than half the gap (to <= 0.0313).
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { repoRoot } from "@openclinxr/factory-station-core/runner";
/** Relocated evidence: skin sources stay under tools/ (S4); anchor via the repo-root helper (S5). */
const DIR = path.join(repoRoot(), "tools/openclinxr/asset-pipeline/skin/face-replay");
const MODULE = path.join(DIR, "skin_gates_split.py");
const REPORT = path.join(DIR, "cheek-relative-brightness-report.json");
const MIRROR = path.join(DIR, "skin-gates-mirror-report.json");

const FROZEN_THRESHOLD = 0.00835;
const FALSIFIER_HALF_GAP = 0.0313;
const VARIANTS = ["base", "a1", "a2", "a3", "a4a", "a4b", "a5"];
const SUBJECTS = ["body2", "aisha"];
const DENOMS = ["face_all5", "face_no_beard", "face_no_forehead", "median_all5"];
const VERDICTS = [
  "rig",
  "geometry",
  "denominator",
  "albedo",
  "ao",
  "beard",
  "roughness",
  "normal",
  "none",
] as const;

type StepRow = {
  variant?: string;
  denominator?: string;
  render: string;
  mirror: Record<string, number>;
  delta_vs_own: Record<string, number>;
  delta_vs_aisha_photo: Record<string, number>;
  delta_vs_body2_photo: Record<string, number>;
};
type Report = {
  card: string;
  frozen_threshold: number;
  frozen_threshold_source: string;
  step0: { ablation: StepRow[]; denominator: StepRow[] };
  candidates: Record<
    string,
    { ran: boolean; result: string; reason: string }
  >;
  verdict: (typeof VERDICTS)[number];
  verdict_partial: boolean;
  fix: null | { kind: string };
  falsifier: { base: number; target: number; best: number; met: boolean };
  red_first: string;
};

function loadReport(): Report {
  return JSON.parse(fs.readFileSync(REPORT, "utf8")) as Report;
}

function py(args: string[], timeoutMs = 300000): string {
  return execFileSync("python3", [MODULE, ...args], {
    encoding: "utf8",
    timeout: timeoutMs,
  });
}

describe("the cheek-brightness cause is found one layer at a time", () => {
  it("STEP 0 is present with every variant x both subjects and the frozen threshold", () => {
    const rep = loadReport();
    expect(rep.card).toBe("tsk_c309c61d93a899");
    expect(rep.frozen_threshold).toBe(FROZEN_THRESHOLD);
    expect(rep.frozen_threshold_source).toMatch(/skin-gates-mirror-report\.json/);
    // Frozen threshold equals the landed G2Mb Lratio_face threshold.
    const mirror = JSON.parse(fs.readFileSync(MIRROR, "utf8")) as {
      g2m_rows: { gate: string; quantity: string; threshold: number }[];
    };
    const g2mb = mirror.g2m_rows.find(
      (r) => r.gate === "G2Mb" && r.quantity === "Lratio_face",
    );
    expect(g2mb?.threshold).toBe(FROZEN_THRESHOLD);
    for (const v of VARIANTS) {
      for (const s of SUBJECTS) {
        const row = rep.step0.ablation.find(
          (r) => r.variant === v && r.render === s,
        );
        expect(row, `${v}/${s}`).toBeDefined();
        for (const q of ["Lratio_face", "logY_face"]) {
          expect(typeof row!.mirror[q], `${v}/${s} mirror ${q}`).toBe("number");
          expect(typeof row!.delta_vs_own[q], `${v}/${s} delta ${q}`).toBe("number");
        }
      }
    }
    for (const d of DENOMS) {
      for (const s of SUBJECTS) {
        expect(
          rep.step0.denominator.find((r) => r.denominator === d && r.render === s),
          `${d}/${s}`,
        ).toBeDefined();
      }
    }
  });

  it("Aisha rows sit beside every body2 row and verdict follows the table", () => {
    const rep = loadReport();
    // Every body2 ablation row has a same-variant Aisha row.
    for (const v of VARIANTS) {
      const b = rep.step0.ablation.find((r) => r.variant === v && r.render === "body2")!;
      const a = rep.step0.ablation.find((r) => r.variant === v && r.render === "aisha")!;
      expect(b && a, v).toBeTruthy();
    }
    // Falsifier rule: movers below threshold or <= half-gap target.
    const body2 = VARIANTS.map(
      (v) =>
        rep.step0.ablation.find((r) => r.variant === v && r.render === "body2")!
          .delta_vs_own["Lratio_face"],
    );
    const base = body2[0];
    const best = Math.min(...body2);
    expect(rep.falsifier.base).toBe(base);
    expect(rep.falsifier.target).toBe(FALSIFIER_HALF_GAP);
    expect(rep.falsifier.best).toBe(best);
    const moverExists = body2.some(
      (d) => d < FROZEN_THRESHOLD || d <= FALSIFIER_HALF_GAP,
    );
    expect(rep.falsifier.met).toBe(!moverExists);
    // Verdict is in the closed set; HANDBACK 1: A1 (0.02226) and the
    // no-beard denominator (0.0283) cross the half-gap line, so the verdict
    // is albedo (partial), not "none". A1 flattening Aisha is expected.
    expect(VERDICTS).toContain(rep.verdict);
    expect(rep.verdict).toBe("albedo");
    expect(rep.verdict_partial).toBe(true);
    if (rep.verdict === "none") {
      expect(rep.fix).toBeNull();
      for (const c of ["c1_rig", "c2_geometry", "c3_denominator"]) {
        expect(rep.candidates[c]?.ran, c).toBe(true);
      }
    }
    // A denominator fix must keep Aisha passing and separation under the
    // unchanged rule; otherwise fix stays null.
    if (rep.fix !== null) {
      expect(rep.verdict).toBe("denominator");
    }
  });

  it("one STEP 0 value recomputes from its store render when present", () => {
    const store = "/Volumes/files/openclinxr-assets/store/skin-regional-shading";
    const png = `${store}/regshade-a1-body2-front.png`;
    if (!fs.existsSync(png)) return;
    const rq = JSON.parse(py(["--render-quantities", png])) as {
      quantities: Record<string, Record<string, number>>;
    };
    const rep = loadReport();
    const row = rep.step0.ablation.find(
      (r) => r.variant === "a1" && r.render === "body2",
    )!;
    const recomputed =
      (rq.quantities["L_cheek"]["Lratio_face"] + rq.quantities["R_cheek"]["Lratio_face"]) / 2;
    expect(Math.abs(recomputed - row.mirror["Lratio_face"])).toBeLessThan(0.001);
  }, 300000);
});
