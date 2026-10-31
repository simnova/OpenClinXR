import { repoRoot } from "@openclinxr/factory-station-core/runner";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve as pathResolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The tearline stays in the lid crease (tsk_4d922e10e2eb7ff1).
 *
 * RED: the main-code bake (S/eyeshell/final.glb) renders an opaque unlit
 * grey wedge below the R lower lid (prim0 tri94 verts 79/110/80) and
 * measures 1 detached grey comp + maxBelow 9.11mm at blink closure.
 * GREEN: the fixed bake keeps a thin wet film along the margin: 0 detached
 * comps in the graded box, >=90% lower-margin recall per eye, 0
 * mobile-zone outsiders at closure 1.0, film edges an order thinner.
 *
 * claimScope: tearline byte + pixel measurement on the pinned fixed GLB and
 * the two pinned 1280 front renders below; the base GLB half of the original
 * RED is retired (see ## ADAPTED).
 * notEvidenceFor: clinical_validity, production_asset_readiness; how
 * anything else looks (pixel grade lives in the store sheet crops).
 * Neither input GLB is ever written.
 *
 * ## ADAPTED (ci-w6-head-realism-adapt, 2026-10-30)
 *
 * The RED base bake (realism-95 .openclinxr/realism-spike/eyeshell/final.glb)
 * was scratch in a removed worktree and tearline-report.json records no base
 * sha, so no verifiable equivalent exists (ci-w3 confirmed the same). The
 * geometry half of RED (tearTris 240, tearTargets 0, film maxEdgeP90Mm > 9.0,
 * g3.R maxBelowMm > 9.0, measured 2026-10-15) is retired to this header; the
 * pixel half still runs on the pinned store base PNG. The newer eye work
 * (eye-geo G0-G6, commit 65c0fd397) built a new anterior eye rather than
 * re-baking this experiment, so the store fixed GLB below remains the newest
 * tearline output and GREEN still guards it. Counterweight (8) proves the
 * instrument refuses untreated input, so GREEN cannot pass vacuously.
 */

const HERE = join(repoRoot(), "tools/openclinxr/asset-pipeline/realism-head/tearline");
const REPO_ROOT = repoRoot();
const TOOL_DIR = join(
  REPO_ROOT,
  "tools/openclinxr/asset-pipeline/realism-head/tearline",
);
const FIXED_GLB =
  "/Volumes/files/openclinxr-assets/store/tearline/tearline-fixed.glb";
const BASE_PNG =
  "/Volumes/files/openclinxr-assets/store/tearline/face-base-1280.png";
const FIXED_PNG =
  "/Volumes/files/openclinxr-assets/store/tearline/face-fixed-1280.png";

const REPORT = JSON.parse(
  readFileSync(join(TOOL_DIR, "tearline-report.json"), "utf8"),
) as {
  outputs: {
    fixedGlb: { sha256: string };
    faceBase1280: { sha256: string };
    faceFixed1280: { sha256: string };
  };
};

function sha256File(p: string): string {
  return createHash("sha256").update(readFileSync(p)).digest("hex");
}

function measure(glb: string): {
  tearVerts: number;
  tearTris: number;
  tearTargets: number;
  film: {
    maxEdgeP50Mm: number;
    maxEdgeP90Mm: number;
    maxEdgeMaxMm: number;
    degenerateTris: number;
  };
  g2: Record<string, { recallPct: number; maxGapMm: number }>;
  g3: Record<
    string,
    {
      outsideVerts: number;
      mobileOutsideVerts: number;
      maxBelowMm: number;
    }
  >;
} {
  const out = execFileSync(
    "mise",
    ["exec", "--", "python3", join(TOOL_DIR, "measure_tearline.py"), glb],
    { cwd: REPO_ROOT, encoding: "utf8", timeout: 600000, maxBuffer: 64 * 1024 * 1024 },
  );
  return JSON.parse(out);
}

function grey(png: string, extra: string[]): {
  comps: number;
  detached: number;
  areas: number[];
} {
  const out = execFileSync(
    "mise",
    ["exec", "--", "python3", join(TOOL_DIR, "probe_grey.py"), png, ...extra],
    { cwd: REPO_ROOT, encoding: "utf8", timeout: 300000, maxBuffer: 64 * 1024 * 1024 },
  );
  const areas: number[] = [];
  let comps = 0,
    detached = 0;
  for (const line of out.split("\n")) {
    const m = /^area=(\d+) @\(\d+,\d+\) \S+ (DETACHED|lid-row|border-touch)$/.exec(
      line.trim(),
    );
    if (m) {
      comps += 1;
      areas.push(Number(m[1]));
      if (m[2] === "DETACHED") detached += 1;
    }
  }
  return { comps, detached, areas };
}

describe("the tearline stays in the lid crease", () => {
  it("(1) pinned inputs exist with the recorded sha256", () => {
    for (const p of [FIXED_GLB, BASE_PNG, FIXED_PNG]) {
      expect(existsSync(p), p).toBe(true);
    }
    expect(sha256File(FIXED_GLB)).toBe(REPORT.outputs.fixedGlb.sha256);
    expect(sha256File(BASE_PNG)).toBe(REPORT.outputs.faceBase1280.sha256);
    expect(sha256File(FIXED_PNG)).toBe(REPORT.outputs.faceFixed1280.sha256);
  });

  it("(2) builder source carries the lid-band fix", () => {
    const src = readFileSync(
      join(
        REPO_ROOT,
        "tools/openclinxr/evidence/blender/materialize_mpfb_humanoid_candidate.py",
      ),
      "utf8",
    );
    for (const marker of [
      "TEAR_FILM_M = 0.0010",
      "TEAR_BAND_M = 0.0020",
      "TEAR_EL_MAX = 0.45",
      "in_vband",
      "1e-12",
    ]) {
      expect(src.includes(marker), marker).toBe(true);
    }
  });

  it("(3) RED: base render shows the wedge pixels (geometry retired, see header)", () => {
    // Geometry RED retired with the base GLB (scratch in a removed worktree,
    // no base sha in the report). The pixel half below still runs: the store
    // base PNG pinned in (1) shows the detached grey comp.
    const g = grey(BASE_PNG, []);
    expect(g.comps).toBe(3);
    expect(g.detached).toBe(1);
    expect(Math.max(...g.areas)).toBe(100);
  });

  it("(4) GREEN G1: fixed render has 0 detached grey comps in the box", () => {
    const g = grey(FIXED_PNG, []);
    expect(g.comps).toBe(2);
    expect(g.detached).toBe(0);
  });

  it("(5) GREEN G1 holds across the full eye bands (hinge check)", () => {
    for (const box of ["--box=680,700,220,70", "--box=380,700,220,70"]) {
      const g = grey(FIXED_PNG, [box, "--pad=0"]);
      expect(g.detached, box).toBe(0);
    }
  });

  it("(6) GREEN G2: fixed film covers >=90% of the lower-lid margin", () => {
    const m = measure(FIXED_GLB);
    expect(m.tearTris).toBeLessThan(240);
    expect(m.film.degenerateTris).toBe(0);
    expect(m.film.maxEdgeP90Mm).toBeLessThan(5.0);
    for (const side of ["L", "R"]) {
      expect(m.g2[side]!.recallPct).toBeGreaterThanOrEqual(90);
      expect(m.g2[side]!.maxGapMm).toBe(0);
    }
  });

  it("(7) GREEN G3: closure 1.0 leaves 0 mobile-zone outsiders", () => {
    const m = measure(FIXED_GLB);
    expect(m.tearTargets).toBe(6);
    for (const side of ["L", "R"]) {
      expect(m.g3[side]!.mobileOutsideVerts).toBe(0);
      expect(m.g3[side]!.maxBelowMm).toBeLessThanOrEqual(3.5);
    }
  });

  it("(8) COUNTERWEIGHT: the instrument refuses an untreated body, so GREEN is not vacuous", () => {
    // The shipped OB control carries no tearline mesh: measure_tearline.py
    // raises StopIteration instead of reporting film numbers. If a refactor
    // ever made the instrument pass untreated input, this clause fails.
    const CONTROL = pathResolve(
      REPO_ROOT,
      "apps/ui-xr/public/generated-humanoids/mpfb-ob-patient-aisha.glb",
    );
    expect(() => measure(CONTROL)).toThrow();
  });
});
