import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Eyes compat report validator (tsk_e4befac3ff1b06da): the realism-head
 * eyes/compat-report.json names its producer manifests the way the card
 * demands, carries the measured gaze + blink populations on both rows, and
 * records the known eye-globe-fit edge honestly instead of claiming it away.
 *
 * Evidence chain (no live bake in-test): materialize.py sha + census.json
 * (machine-read NodeIO populations) + sheet-record probes in scratch + store
 * sheet. The RED clauses fail on a fabricated census and pass on the measured
 * one.
 *
 * claimScope: report integrity (shas resolve to real files; populations
 *   match the tracked census; falsifier + edge recorded, not hidden).
 * notEvidenceFor: clinical_validity, production_asset_readiness; the pixel
 *   grade lives in gaze-blink-sheet.png and is the orchestrator's (D12).
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../../../..");
const REPORT = join(HERE, "compat-report.json");
const CENSUS = join(HERE, "census.json");
const SHELL_MANIFEST = join(HERE, "..", "shell", "shell-manifest.json");
const MESH_DECISION = join(REPO_ROOT, "tools/openclinxr/asset-pipeline/eyes/mesh-decision.json");
const TEXTURE_MANIFEST = join(REPO_ROOT, "tools/openclinxr/asset-pipeline/eyes/texture-manifest.json");
const CORNER_MANIFEST = join(REPO_ROOT, "tools/openclinxr/asset-pipeline/makeclothes/eye-corner/manifest.json");
const LASH_MANIFEST = join(REPO_ROOT, "tools/openclinxr/asset-pipeline/makeclothes/eye-lash/manifest.json");
const MATERIALIZE = join(REPO_ROOT, "tools/openclinxr/evidence/blender/materialize_mpfb_humanoid_candidate.py");
const STORE_ROOT = "/Volumes/files/openclinxr-assets/store/";
const SCRATCH_REALISM =
  "/Users/patrick/.grok/worktrees/src-openclinxr/realism-95/.openclinxr/realism-spike/compateyes/aisha-realism.glb";

const EYE_FACS = [
  "eye-left-closure",
  "eye-left-slit",
  "eye-left-opened-up",
  "eye-right-closure",
  "eye-right-slit",
  "eye-right-opened-up",
];

type CompatRow = {
  label: string;
  glb: string;
  sha256: string;
  verdict: string;
  globeMesh: string;
  corneaMeshes: string[];
  lashMesh: string;
  lashMorphs: string[];
  eyeJoints: string[];
  eyeFacsPresent: string[];
  gaze: { bonesTouched: string[]; yawRad: number };
  blink: { closurePlusSlitMeshWrites: number };
};
type CompatReport = {
  name: string;
  producerSourceSha256: string;
  producerSourcePath: string;
  manifests: {
    shell: { path: string; sha256: string };
    eyeMesh: { path: string; sha256: string; note: string };
    eyeTexture: { path: string; sha256: string };
    eyeCorner: { path: string; sha256: string };
    eyeLash: { path: string; sha256: string };
  };
  rows: CompatRow[];
  falsifier: { edgeAtYaw: string };
  briefMissing: string;
  sheet: { src: string; sha256: string; renderSize: number; views: string[]; subjects: string[] };
  gates: Record<string, unknown>;
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
  expect(r.name).toBe("gaze-blink-compat");
  expect(r.rows).toHaveLength(2);
  const [realism, control] = r.rows as [CompatRow, CompatRow];
  // CW: pointing the motivating row at the shipped Aisha sha is a fail.
  expect(realism!.sha256).not.toBe(control!.sha256);
  expect(realism!.verdict).toBe("gaze_blink_green_edge_recorded");
  expect(control!.verdict).toBe("control_clean");
  for (const row of r.rows) {
    expect([...row.eyeFacsPresent].sort()).toEqual([...EYE_FACS].sort());
    expect(row.eyeJoints).toContain("eye.L");
    expect(row.eyeJoints).toContain("eye.R");
    expect(row.gaze.bonesTouched).toEqual(["eyeL", "eyeR"]);
    expect(row.gaze.yawRad).toBeCloseTo(0.43633, 4);
    expect(row.blink.closurePlusSlitMeshWrites).toBeGreaterThan(0);
  }
  // RED: the realism head carries the new eye build; the control does not.
  expect(realism!.globeMesh).toMatch(/high_poly_globe/);
  expect(realism!.corneaMeshes).toHaveLength(2);
  expect(realism!.lashMorphs).toHaveLength(6);
  expect(realism!.lashMesh).toMatch(/thinned/);
  expect(control!.corneaMeshes).toHaveLength(0);
  expect(control!.lashMorphs).toHaveLength(0);
  // The falsifier + edge must be recorded, never claimed away.
  expect(r.falsifier.edgeAtYaw.length).toBeGreaterThan(0);
  expect(r.briefMissing).toMatch(/mesh-manifest\.json does not exist/);
  expect(r.sheet.renderSize).toBe(1280);
  expect(r.sheet.views).toEqual(["front", "yaw-plus-25", "yaw-minus-25", "blink"]);
  expect(r.sheet.subjects).toEqual(["realism", "control"]);
}

function storePath(src: string): string {
  const rel = src.startsWith("assets:") ? src.slice("assets:".length) : src;
  return join(STORE_ROOT, "compat-eyes", rel);
}

/** Fail-closed manifest verification shared by clause (1) and the known-bad fixtures. */
function verifyManifestShas(r: CompatReport): void {
  expect(r.producerSourceSha256, "producer source moved: materialize.py sha mismatch").toBe(
    sha256File(MATERIALIZE),
  );
  expect(r.manifests.shell.sha256, "shell-manifest moved").toBe(sha256File(SHELL_MANIFEST));
  expect(r.manifests.eyeMesh.sha256, "eye mesh decision moved").toBe(sha256File(MESH_DECISION));
  expect(r.manifests.eyeTexture.sha256, "eye texture manifest moved").toBe(sha256File(TEXTURE_MANIFEST));
  expect(r.manifests.eyeCorner.sha256, "eye-corner manifest moved").toBe(sha256File(CORNER_MANIFEST));
  expect(r.manifests.eyeLash.sha256, "eye-lash manifest moved").toBe(sha256File(LASH_MANIFEST));
}

describe("the compat report names the producer manifests", () => {
  it("(1) report cites the five current manifest shas and the materialize sha", () => {
    const r = readReport();
    verifyManifestShas(r);
    expect(r.sheet.src).toMatch(/^assets:/);
  });

  it("(2) RED: realism carries the new eye build with gaze + blink; control is the shipped cast", () => {
    validateReport(readReport());
  });

  it("(3) rows match the tracked machine-read census", () => {
    const r = readReport();
    const census = JSON.parse(readFileSync(CENSUS, "utf8")) as {
      rows: Array<{
        label: string;
        sha256: string;
        globeMeshes: string[];
        corneaMeshes: string[];
        lashMeshes: string[];
        lashMorphs: Record<string, string[]>;
        eyeJoints: string[];
        eyeFacsPresent: string[];
      }>;
    };
    for (const row of r.rows) {
      const c = census.rows.find((x) => x.label === row.label);
      expect(c, `census has a ${row.label} row`).toBeTruthy();
      expect(row.sha256).toBe(c!.sha256);
      expect([...row.eyeFacsPresent].sort()).toEqual([...c!.eyeFacsPresent].sort());
      expect([...row.eyeJoints].sort()).toEqual([...c!.eyeJoints].sort());
      expect(row.corneaMeshes).toEqual(c!.corneaMeshes);
      const censusLashMorphs = Object.values(c!.lashMorphs).flat();
      expect([...row.lashMorphs].sort()).toEqual([...censusLashMorphs].sort());
      if (row.label === "realism") expect(c!.globeMeshes).toContain(row.globeMesh);
    }
  });

  it("(4) census names the shell slot and the corner slot (absent, not omitted)", () => {
    const census = JSON.parse(readFileSync(CENSUS, "utf8")) as {
      rows: Array<{ label: string; shellMeshes: string[]; tearlineMeshes: string[]; cornerMeshes: string[] }>;
    };
    for (const c of census.rows) {
      expect(Array.isArray(c.shellMeshes), `${c.label} census names the shell slot`).toBe(true);
      expect(Array.isArray(c.cornerMeshes), `${c.label} census names the corner slot`).toBe(true);
      expect(c.shellMeshes, `${c.label}: shell OFF, no shell mesh`).toHaveLength(0);
      expect(c.cornerMeshes, `${c.label}: corner not_found, no corner mesh`).toHaveLength(0);
    }
    const shell = JSON.parse(readFileSync(SHELL_MANIFEST, "utf8")) as {
      shell: { mesh: string };
    };
    expect(shell.shell.mesh).toBe("openclinxr_eye_occlusion_shell_mesh");
  });

  it("(5) control sha resolves to the shipped bytes", () => {
    const r = readReport();
    const control = r.rows.find((x) => x.label === "control")!;
    const abs = join(REPO_ROOT, control.glb);
    expect(existsSync(abs), `shipped control exists: ${abs}`).toBe(true);
    expect(sha256File(abs)).toBe(control.sha256);
  });

  it("(6) realism sha resolves to the baked bytes — absence is not a pass", () => {
    const r = readReport();
    const realism = r.rows.find((x) => x.label === "realism")!;
    expect(existsSync(SCRATCH_REALISM), `motivating bake exists: ${SCRATCH_REALISM}`).toBe(true);
    expect(sha256File(SCRATCH_REALISM), "baked bytes match the report").toBe(realism.sha256);
  });

  const _r = readReport();
  const _storeSheet = storePath(_r.sheet.src);
  if (existsSync(_storeSheet)) {
    it("(7) store sheet bytes match the report sha", () => {
      const r = readReport();
      const bytes = readFileSync(storePath(r.sheet.src));
      expect(bytes.length, "sheet is a real PNG, not a stub").toBeGreaterThan(100000);
      expect(sha256File(storePath(r.sheet.src))).toBe(r.sheet.sha256);
    });
  } else {
    it.skip("(7) store absent — sheet sha unverified", () => {});
  }

  it("(8) known-bad: a motivating row pointed at the control sha is rejected", () => {
    const r = readReport();
    const bad = {
      ...r,
      rows: r.rows.map((row) => (row.label === "realism" ? { ...row, sha256: r.rows[1]!.sha256 } : row)),
    };
    expect(() => validateReport(bad as CompatReport)).toThrow();
  });

  it("(9) known-bad: a stale manifest sha is rejected", () => {
    const r = readReport();
    const bad = {
      ...r,
      manifests: { ...r.manifests, eyeLash: { ...r.manifests.eyeLash, sha256: "0".repeat(64) } },
    };
    expect(() => verifyManifestShas(bad as CompatReport)).toThrow();
  });

  it("(10) known-bad: a producer source that moved is rejected", () => {
    const r = readReport();
    const bad = { ...r, producerSourceSha256: "0".repeat(64) };
    expect(() => verifyManifestShas(bad as CompatReport)).toThrow();
  });
});
