import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Card tsk_96256abb59a7b6c7: face-fit landmark targets come from the case.
 *
 * A deterministic step (make_any_subject_targets.py) runs the SAME
 * MediaPipe Face Landmarker detector that produced the committed
 * pts_target_front.npy (fit_facefit2.py:detect_points verbatim -- same task
 * file, same RunningMode.IMAGE, same num_faces=1; no swap, no hand-placed
 * landmarks) on any reference-set case's goal_front, and writes that case's
 * target plus its embedding entry, keyed by case id, to
 * any-subject-targets.json. fit_facefit2.py reads targets by --case id.
 *
 * Gates:
 * - G1: rerun for Aisha reproduces the committed target byte-identical
 *   (detector measured bit-deterministic over 3 runs, maxAbsDiff 0.0).
 * - G2: body2 target is 478 points, all inside the image, eye-corner pairs
 *   present; face-fit runs on body2 to completion; its residual is recorded
 *   beside Aisha's in fit-report.json cases (a poor body2 fit is a recorded
 *   result, not a stop).
 * - G3: no 'aisha' literal remains in fit_facefit2.py (grep below).
 * - CW: hand-placed body2 landmarks are a fail -- body2's target must be the
 *   detector output on the manifest-pinned goal_front bytes (sha checked).
 *
 * claimScope: landmark-target provenance for front-view fits, neutral.
 * notEvidenceFor: clinical validity, production asset readiness.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const DOC = join(HERE, "any-subject-targets.json");
const REPORT = join(HERE, "fit-report.json");
const FIT_PY = join(HERE, "fit_facefit2.py");
const MAKER_PY = join(HERE, "make_any_subject_targets.py");
const MANIFEST = join(HERE, "..", "..", "asset-pipeline", "reference-set", "manifest.json");
const LEGACY_NPY = join(HERE, "pts_target_front.npy");

function sha256File(abs: string): string {
  return createHash("sha256").update(readFileSync(abs)).digest("hex");
}

/** Minimal .npy v1 float64 reader: returns rows of [x, y]. */
function readNpyPoints(abs: string): { shape: [number, number]; pts: Array<[number, number]> } {
  const buf = readFileSync(abs);
  expect(buf[0], `${abs} npy magic`).toBe(0x93);
  expect(buf.subarray(1, 6).toString("ascii"), `${abs} npy header`).toBe("NUMPY");
  const hlen = buf.readUInt16LE(8);
  const header = buf.subarray(10, 10 + hlen).toString("ascii");
  const m = header.match(/'shape':\s*\((\d+),\s*(\d+)\)/);
  expect(m, `${abs} npy shape in header ${header.slice(0, 80)}`).not.toBeNull();
  const rows = Number(m![1]);
  const cols = Number(m![2]);
  expect(header).toMatch(/<f8/);
  const data = buf.subarray(10 + hlen);
  expect(data.length, `${abs} npy payload bytes`).toBe(rows * cols * 8);
  const pts: Array<[number, number]> = [];
  for (let r = 0; r < rows; r++) {
    pts.push([data.readDoubleLE((r * cols) * 8), data.readDoubleLE((r * cols + 1) * 8)]);
  }
  return { shape: [rows, cols], pts };
}

type TargetsDoc = {
  detector: { taskSha256: string; runningMode: string; numFaces: number; nPoints: number };
  g1: { runs: number; maxAbsDiffPx: number; byteIdentical: boolean; legacySha256: string };
  cases: Record<string, {
    sourceSha256: string; imageSize: [number, number]; targetNpy: string;
    targetSha256: string; nPoints: number; allInsideImage: boolean;
    eyeCorners: Record<string, [number, number]>;
    embedding: { file: string; sha256: string; n: number; trackN: number; fallbacks: number };
  }>;
};

describe("face-fit-targets-come-from-the-case", () => {
  it("publishes any-subject-targets.json with aisha + body2 targets and embedding entries", () => {
    expect(existsSync(DOC), `targets doc exists: ${DOC}`).toBe(true);
    const d = JSON.parse(readFileSync(DOC, "utf8")) as TargetsDoc;
    for (const c of ["aisha", "body2"]) {
      const e = d.cases[c]!;
      expect(e, `case entry ${c}`).toBeDefined();
      expect(e.nPoints).toBe(478);
      expect(e.targetSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(e.embedding.n).toBe(40);
      expect(e.embedding.trackN).toBe(35);
      expect(e.embedding.fallbacks).toBe(0);
      const abs = join(HERE, e.targetNpy.split("tools/openclinxr/evidence/face-fit/").at(-1)!);
      expect(existsSync(abs), `target npy present: ${e.targetNpy}`).toBe(true);
      expect(sha256File(abs), `${c} target sha`).toBe(e.targetSha256);
    }
  });

  it("G1: the aisha rerun reproduces the committed target byte-identical", () => {
    const d = JSON.parse(readFileSync(DOC, "utf8")) as TargetsDoc;
    expect(d.g1.runs).toBe(3);
    expect(d.g1.maxAbsDiffPx).toBe(0);
    expect(d.g1.byteIdentical).toBe(true);
    expect(sha256File(LEGACY_NPY), "legacy target sha").toBe(d.g1.legacySha256);
    const aishaAbs = join(HERE, "pts_target_aisha_front.npy");
    expect(readFileSync(aishaAbs).equals(readFileSync(LEGACY_NPY)),
      "aisha per-case npy byte-identical to pts_target_front.npy").toBe(true);
  });

  it("uses the SAME detector as the fit (no swap, no hand landmarks)", () => {
    const fit = readFileSync(FIT_PY, "utf8");
    const maker = readFileSync(MAKER_PY, "utf8");
    for (const [name, src] of [["fit_facefit2.py", fit], ["make_any_subject_targets.py", maker]] as const) {
      expect(src, `${name} FaceLandmarkerOptions`).toMatch(/FaceLandmarkerOptions/);
      expect(src, `${name} RunningMode.IMAGE`).toMatch(/RunningMode\.IMAGE/);
      expect(src, `${name} num_faces=1`).toMatch(/num_faces=1/);
    }
    expect(maker, "maker cites its detector source").toMatch(/fit_facefit2\.py:detect_points/);
    // CW: body2's target is detector output on manifest-pinned bytes, not hands.
    const d = JSON.parse(readFileSync(DOC, "utf8")) as TargetsDoc;
    const manifest = JSON.parse(readFileSync(MANIFEST, "utf8")) as {
      cases: Record<string, { references: Record<string, { output: { sha256: string } }> }>;
    };
    expect(d.cases["body2"]!.sourceSha256, "body2 source == manifest goal_front sha")
      .toBe(manifest.cases["body2"]!.references["goal_front"]!.output.sha256);
  });

  it("G2: body2 target is 478 inside-image points with eye corners; fit ran to completion", () => {
    const d = JSON.parse(readFileSync(DOC, "utf8")) as TargetsDoc;
    const b = d.cases["body2"]!;
    const abs = join(HERE, b.targetNpy.split("tools/openclinxr/evidence/face-fit/").at(-1)!);
    const { shape, pts } = readNpyPoints(abs);
    expect(shape).toEqual([478, 2]);
    const [w, h] = b.imageSize;
    expect(pts.every(([x, y]) => x >= 0 && x < w && y >= 0 && y < h),
      "all 478 body2 points inside the image").toBe(true);
    expect(b.allInsideImage).toBe(true);
    for (const i of [33, 133, 362, 263]) {
      expect(pts[i], `eye-corner point ${i}`).toBeDefined();
    }
    const lw = Math.abs(pts[133]![0] - pts[33]![0]);
    const rw = Math.abs(pts[263]![0] - pts[362]![0]);
    expect(lw).toBeGreaterThan(10);
    expect(rw).toBeGreaterThan(10);
    const r = JSON.parse(readFileSync(REPORT, "utf8")) as {
      cases: Record<string, { rmsBeforeMm: number; rmsAfterMm: number; onTrackMm: number }>;
    };
    expect(r.cases["body2"], "body2 fit residual recorded").toBeDefined();
    expect(r.cases["aisha"], "aisha residual beside body2").toBeDefined();
    for (const c of ["aisha", "body2"]) {
      expect(typeof r.cases[c]!.rmsBeforeMm, `${c} rmsBeforeMm`).toBe("number");
      expect(typeof r.cases[c]!.rmsAfterMm, `${c} rmsAfterMm`).toBe("number");
    }
  });

  it("G3: fit_facefit2.py reads targets by case id with no subject literal", () => {
    const fit = readFileSync(FIT_PY, "utf8");
    expect(fit.includes("aisha"), "no 'aisha' literal in fit_facefit2.py").toBe(false);
    expect(fit, "fit loads any-subject-targets.json").toMatch(/any-subject-targets\.json/);
    expect(fit, "fit takes --case").toMatch(/--case/);
  });
});
