import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Card tsk_3cff39ffc572d85d: MPFB macro + target + asym fit to MediaPipe
 * landmarks beats the silhouette sweep.
 *
 * Large binaries live in the local asset store (store-manifest.json), never
 * in git. When the store is absent the gates below are SKIPPED under a
 * "store absent" name -- never a silent pass.
 *
 * Gates (all thresholds measured, never typed):
 * - self-check (card 1, S/consult47/r4.answer.md): fit-to-self drift <=
 *   detector error on the unfitted render (both from fit-report.json).
 * - Aisha: landmark error after fit < silhouette sweep error on the same
 *   35 trackable points.
 * - checkRender: Blender re-render re-detect <= analytic + detector floor.
 *   The render is the CHECK, never the objective (CW).
 *
 * claimScope: landmark fit quality on goal portraits, expression neutral.
 * notEvidenceFor: three.js transfer, profile-only cases, clinical validity.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPORT = join(HERE, "fit-report.json");
const EMBEDDING = join(HERE, "embedding.json");
const MANIFEST = join(HERE, "store-manifest.json");
const STORE =
  process.env.OPENCLINXR_ASSET_STORE ?? "/Volumes/files/openclinxr-assets/store/face-fit";
const storePresent = existsSync(STORE);

type FitReport = {
  mpfb: { targetData: string; asymN: number; macroN: number };
  embedding: {
    n: number;
    trackN: number;
    contourExcluded: number[];
    fallbacks: number;
  };
  camera: {
    yawScan: Record<string, number>;
    yawDeg: number;
    use3q: boolean;
    frontPrePx: number;
  };
  solve: { nVars: number; expression: string };
  selfCheck: { detectorRmsMm: number; fitDriftMm: number; wMax: number; pass: boolean };
  sweep: { rmsAfterMm70: number; onTrackMm: number };
  aisha: { rmsAfterMm: number; onTrackMm: number; beatsSweep: boolean };
  falsifier: { tripped: boolean; reason: string };
  checkRender: {
    redetectMm: number;
    analyticMm: number;
    detectorFloorMm: number;
    pass: boolean;
  } | null;
};

function sha256File(abs: string): string {
  return createHash("sha256").update(readFileSync(abs)).digest("hex");
}

describe("the-face-fit-beats-the-silhouette-sweep", () => {
  if (!storePresent) {
    it.skip(`store absent at ${STORE} -- evidence gates skipped, not passed`, () => {});
    return;
  }

  it("resolves every store-manifest asset with matching sha256", () => {
    const manifest = JSON.parse(readFileSync(MANIFEST, "utf8")) as {
      store: string;
      assets: Record<string, { sha256: string; bytes: number }>;
    };
    const names = Object.keys(manifest.assets);
    expect(names.length).toBeGreaterThanOrEqual(9);
    for (const name of names) {
      const abs = join(STORE, name);
      expect(existsSync(abs), `store asset missing: ${name}`).toBe(true);
      const want = manifest.assets[name]!;
      expect(sha256File(abs), `sha mismatch: ${name}`).toBe(want.sha256);
    }
  });

  it("publishes fit-report.json with the 2.0.18 asym basis", () => {
    const r = JSON.parse(readFileSync(REPORT, "utf8")) as FitReport;
    expect(r.mpfb.targetData).toBe("2.0.18");
    expect(r.mpfb.asymN).toBe(62);
    expect(r.mpfb.macroN).toBeGreaterThan(0);
    expect(r.solve.nVars).toBeGreaterThan(110);
    expect(r.solve.expression).toMatch(/neutral/);
  });

  it("stores ~40 barycentric triples with zero fallbacks", () => {
    const emb = JSON.parse(readFileSync(EMBEDDING, "utf8")) as {
      landmarks: number[];
      points: Record<string, { face: number; verts: number[]; w: number[] }>;
      fallbacks: number;
    };
    expect(emb.landmarks.length).toBeGreaterThanOrEqual(40);
    expect(emb.fallbacks).toBe(0);
    for (const lm of emb.landmarks) {
      const p = emb.points[String(lm)]!;
      expect(p.verts.length).toBe(3);
      expect(p.w.length).toBe(3);
      const sum = p.w[0]! + p.w[1]! + p.w[2]!;
      expect(Math.abs(sum - 1) < 1e-6, `lm ${lm} weights sum to ${sum}`).toBe(true);
    }
    const r = JSON.parse(readFileSync(REPORT, "utf8")) as FitReport;
    expect(r.embedding.n).toBe(emb.landmarks.length);
    expect(r.embedding.trackN).toBeLessThanOrEqual(emb.landmarks.length);
  });

  it("passes the self-check: fit-to-self drift <= detector error (measured)", () => {
    const r = JSON.parse(readFileSync(REPORT, "utf8")) as FitReport;
    expect(r.selfCheck.detectorRmsMm).toBeGreaterThan(0);
    expect(r.selfCheck.fitDriftMm).toBeLessThanOrEqual(r.selfCheck.detectorRmsMm);
    expect(r.selfCheck.wMax).toBe(0);
    expect(r.selfCheck.pass).toBe(true);
  });

  it("beats the silhouette sweep on the same trackable points", () => {
    const r = JSON.parse(readFileSync(REPORT, "utf8")) as FitReport;
    expect(r.falsifier.tripped).toBe(false);
    expect(r.falsifier.reason.length).toBeGreaterThan(0);
    expect(r.aisha.onTrackMm).toBeLessThan(r.sweep.onTrackMm);
    expect(r.aisha.beatsSweep).toBe(true);
  });

  it("confirms the fit on a re-render (check, not objective)", () => {
    const r = JSON.parse(readFileSync(REPORT, "utf8")) as FitReport;
    expect(r.checkRender, "checkRender missing: render the fitted mesh first").not.toBeNull();
    const c = r.checkRender!;
    expect(c.redetectMm).toBeLessThanOrEqual(c.analyticMm + c.detectorFloorMm);
    expect(c.pass).toBe(true);
  });

  it("excludes three-quarter only by the measured yaw scan", () => {
    const r = JSON.parse(readFileSync(REPORT, "utf8")) as FitReport;
    if (!r.camera.use3q) {
      const scans = Object.entries(r.camera.yawScan).sort((a, b) => a[1] - b[1]);
      const [bestDeg, bestPre] = scans[0]!;
      expect(Number(bestDeg)).toBe(r.camera.yawDeg);
      // Exclusion rule (fit_facefit2.py): best 3q pre-residual must be
      // within 2x the front pre-residual to enter the objective.
      expect(bestPre).toBeGreaterThan(2 * r.camera.frontPrePx);
    }
  });
});
