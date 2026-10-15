import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Mouth compat report validator (tsk_667587349a455eec): the realism-head
 * mouth/compat-report.json names its producer manifests the way compat-eyes
 * does, carries the full 15-name viseme census on both rows, and records
 * the jaw / teeth / emotion / brow findings honestly — including the
 * counterweight inversion (teeth 1.9 mm behind the tongue after the
 * card-ordered post steps).
 *
 * Evidence chain (no live bake in-test): materialize.py shas + census.json
 * (machine-read NodeIO populations) + probe JSONs in scratch + store sheet.
 * The RED clauses fail on a fabricated census and pass on the measured one.
 *
 * claimScope: report integrity (shas resolve to real files; populations
 *   match the tracked census; both falsifier verdicts recorded).
 * notEvidenceFor: clinical_validity, production_asset_readiness; the pixel
 *   grade lives in viseme-emotion-sheet.png and is the orchestrator's (D12).
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../../../..");
const REPORT = join(HERE, "compat-report.json");
const CENSUS = join(HERE, "census.json");
const SHELL_MANIFEST = join(HERE, "..", "shell", "shell-manifest.json");
const MATERIALIZE = join(REPO_ROOT, "tools/openclinxr/evidence/blender/materialize_mpfb_humanoid_candidate.py");
const ROUNDTRIP = join(REPO_ROOT, "tools/openclinxr/asset-pipeline/makeclothes/gltf-ext/roundtrip-report.json");
const STORE_ROOT = "/Volumes/files/openclinxr-assets/store/";
const SCRATCH_REALISM =
  "/Users/patrick/.grok/worktrees/src-openclinxr/realism-95/.openclinxr/realism-spike/compatmouth/aisha-realism.glb";

const EXPECTED_VISEMES = [
  "viseme_aa", "viseme_CH", "viseme_DD", "viseme_E", "viseme_FF", "viseme_I",
  "viseme_kk", "viseme_nn", "viseme_O", "viseme_PP", "viseme_RR",
  "viseme_sil", "viseme_SS", "viseme_TH", "viseme_U",
];

type CompatRow = {
  label: string;
  glb: string;
  sha256: string;
  verdict: string;
  visemes: string[];
  jawJoints: string[];
  browMovers: string[];
  teethMinusTongueM: number;
};
type CompatReport = {
  name: string;
  producerSourceLineageSha256: string;
  producerSourceSha256: string;
  producerSourcePath: string;
  roundtripReportSha256: string;
  roundtripReportPath: string;
  rows: CompatRow[];
  falsifier: { visemesAndJaw: string; brow: string };
  counterweightFinding: string;
  sheet: { src: string; sha256: string; renderSize: number; views: string[] };
  gates: Record<string, boolean>;
};

function sha256File(abs: string): string {
  return createHash("sha256").update(readFileSync(abs)).digest("hex");
}

function readReport(): CompatReport {
  expect(existsSync(REPORT), `compat report exists: ${REPORT}`).toBe(true);
  return JSON.parse(readFileSync(REPORT, "utf8")) as CompatReport;
}

/** Fail-closed validator shared by the report clause and the known-bad fixtures. */
function validateReport(r: CompatReport): void {
  expect(r.name).toBe("mouth-viseme-jaw-teeth-emotion-compat");
  expect(r.rows).toHaveLength(2);
  const [realism, control] = r.rows as [CompatRow, CompatRow];
  // CW: pointing the motivating row at the shipped Aisha sha is a fail.
  expect(realism!.sha256).not.toBe(control!.sha256);
  expect(realism!.verdict).toBe("control_clean");
  expect(control!.verdict).toBe("control_clean");
  for (const row of r.rows) {
    expect([...row.visemes].sort()).toEqual([...EXPECTED_VISEMES].sort());
    expect(row.jawJoints).toContain("jaw");
    expect(row.browMovers.length).toBeGreaterThan(0);
  }
  // CW: a hidden brow mesh must not be recorded as a moving brow.
  expect(realism!.browMovers.length).toBeGreaterThanOrEqual(2);
  expect(control!.browMovers).toHaveLength(1);
  expect(typeof realism!.teethMinusTongueM).toBe("number");
  expect(r.counterweightFinding.length).toBeGreaterThan(0);
  expect(r.falsifier.visemesAndJaw.length).toBeGreaterThan(0);
  expect(r.falsifier.brow.length).toBeGreaterThan(0);
  expect(r.sheet.renderSize).toBe(1280);
  expect(r.sheet.views).toEqual(["viseme_aa", "viseme_PP", "viseme_sil", "reassured", "brow concern"]);
}

function storePath(src: string): string {
  const rel = src.startsWith("assets:") ? src.slice("assets:".length) : src;
  return join(STORE_ROOT, "compat-mouth", rel);
}

describe("the mouth report names the producer manifests", () => {
  it("(1) report cites the shell-manifest lineage sha and the roundtrip-report sha", () => {
    const r = readReport();
    const shell = JSON.parse(readFileSync(SHELL_MANIFEST, "utf8")) as { producerSourceSha256: string };
    expect(r.producerSourceLineageSha256).toBe(shell.producerSourceSha256);
    expect(r.producerSourceSha256).toBe(sha256File(MATERIALIZE));
    expect(r.roundtripReportSha256).toBe(sha256File(ROUNDTRIP));
    expect(r.sheet.src).toMatch(/^assets:/);
  });

  it("(2) RED: both rows carry the 15 shipped viseme names, the jaw, and honest brow movers", () => {
    validateReport(readReport());
  });

  it("(3) rows match the tracked machine-read census", () => {
    const r = readReport();
    const census = JSON.parse(readFileSync(CENSUS, "utf8")) as {
      rows: Array<{ label: string; sha256: string; visemes: string[]; jawJoints: string[]; browCarrierMeshes: string[] }>;
    };
    for (const row of r.rows) {
      const c = census.rows.find((x) => x.label === row.label);
      expect(c, `census has a ${row.label} row`).toBeTruthy();
      expect([...row.visemes].sort()).toEqual([...c!.visemes].sort());
      expect(row.jawJoints).toEqual(c!.jawJoints);
      expect([...row.browMovers].sort()).toEqual([...c!.browCarrierMeshes].sort());
      expect(row.sha256).toBe(c!.sha256);
    }
  });

  it("(4) control sha resolves to the shipped bytes", () => {
    const r = readReport();
    const control = r.rows.find((x) => x.label === "control")!;
    const abs = join(REPO_ROOT, control.glb);
    expect(existsSync(abs), `shipped control exists: ${abs}`).toBe(true);
    expect(sha256File(abs)).toBe(control.sha256);
  });

  // Large files live in the asset store: verify shas when it exists, else skip.
  const _r = readReport();
  const _realism = _r.rows.find((x) => x.label === "realism")!;
  const _storeGlb = storePath(_realism.glb);
  const _realismProbes = [_storeGlb, SCRATCH_REALISM].filter((p) => existsSync(p));
  if (_realismProbes.length > 0) {
    it("(5) realism sha resolves to the baked bytes", () => {
      const r = readReport();
      const realism = r.rows.find((x) => x.label === "realism")!;
      for (const p of [storePath(realism.glb), SCRATCH_REALISM].filter((x) => existsSync(x))) {
        expect(sha256File(p), `baked bytes match the report: ${p}`).toBe(realism.sha256);
      }
    });
  } else {
    it.skip("(5) store absent — realism GLB sha unverified", () => {});
  }

  const _storeSheet = storePath(_r.sheet.src);
  if (existsSync(_storeSheet)) {
    it("(6) store sheet bytes match the report sha", () => {
      const r = readReport();
      const bytes = readFileSync(storePath(r.sheet.src));
      expect(bytes.length, "sheet is a real PNG, not a stub").toBeGreaterThan(10000);
      expect(sha256File(storePath(r.sheet.src))).toBe(r.sheet.sha256);
    });
  } else {
    it.skip("(6) store absent — sheet sha unverified", () => {});
  }

  it("(7) known-bad: a motivating row pointed at the control sha is rejected", () => {
    const r = readReport();
    const bad = {
      ...r,
      rows: r.rows.map((row) => (row.label === "realism" ? { ...row, sha256: r.rows[1]!.sha256 } : row)),
    };
    expect(() => validateReport(bad as CompatReport)).toThrow();
  });

  it("(8) known-bad: a hidden brow mesh recorded as moving is rejected", () => {
    const r = readReport();
    const bad = {
      ...r,
      rows: r.rows.map((row) =>
        row.label === "control" ? { ...row, browMovers: [...row.browMovers, "openclinxr_fitted_eyebrow_hidden_mesh"] } : row,
      ),
    };
    expect(() => validateReport(bad as CompatReport)).toThrow();
  });
});
