import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { repoRoot } from "@openclinxr/factory-station-core/runner";

/**
 * The lash blink-follow post-step (T2b selective-detach-drop + A3) gives the
 * fitted lash mesh closure morphs that move lid-margin verts with the lid.
 *
 * ## ADAPTED (ci-w6-head-realism-adapt, 2026-10-30)
 *
 * The old bake input (realism-95 spike eyemesh aisha-hp-cornea.glb) was
 * scratch in a removed worktree, so the old RED/GREEN pair is retired to this
 * header (historical: input 0 lash targets failed; baked output carried the 6
 * closure/slit/opened-up targets, >=80% lid travel per side). The producer is
 * unchanged — lash_blink_follow.py — and its newest run is the eye-geo G4
 * re-seat (commit 65c0fd397, 2026-10-22): T2b+A3 on the G3 post-refit profile
 * of the store lidconform bake, recorded in geometric-eye-g4-report.json.
 * This test re-runs that G4 producer and pins its measured output.
 *
 * RED: the G4 input (store lidconform bake, pre-T2b+A3) measures pass=false.
 * GREEN: the re-run reproduces the tracked G4 report byte-for-byte
 * (output_sha256) and measurement-for-measurement (t2b/a3/blinkFollow).
 * The input bake is never written (the tool writes only to tmp OUT).
 *
 * claimScope: blink-follow byte measurement on the G4 lineage below.
 * notEvidenceFor: clinical_validity, production_asset_readiness; how anything
 *   looks (pixel grade lives in lash-sheet.png).
 */

const REPO_ROOT = repoRoot();
const TOOL = join(
  REPO_ROOT,
  "tools/openclinxr/asset-pipeline/makeclothes/eye-lash/lash_blink_follow.py",
);
const PRODUCER = join(
  REPO_ROOT,
  "tools/openclinxr/evidence/realism-head/eyes/geometric-eye-g4-lash.py",
);
const MANIFEST = join(
  REPO_ROOT,
  "tools/openclinxr/asset-pipeline/makeclothes/eye-lash/manifest.json",
);
const REPORT = join(
  REPO_ROOT,
  "tools/openclinxr/evidence/realism-head/eyes/geometric-eye-g4-report.json",
);
const BAKE = "/Volumes/files/openclinxr-assets/store/lid-conform/aisha-lidconform.glb";
const CONTROL = join(
  REPO_ROOT,
  "apps/ui-xr/public/generated-humanoids/mpfb-ob-patient-aisha.glb",
);

type BlinkFollowRow = {
  lidMarginVerts: number;
  sameDirection: boolean;
  travelPct: number;
  pass: boolean;
};

type MeasureResult = {
  lashPrimTargets: number;
  pass: boolean;
  blinkFollow: Record<string, BlinkFollowRow>;
};

function sha256File(p: string): string {
  return createHash("sha256").update(readFileSync(p)).digest("hex");
}

function measure(glb: string): MeasureResult {
  const out = execFileSync(
    "mise",
    ["exec", "--", "python3", TOOL, glb, "--measure"],
    { cwd: REPO_ROOT, encoding: "utf8", timeout: 600000, maxBuffer: 64 * 1024 * 1024 },
  );
  return JSON.parse(out) as MeasureResult;
}

describe("the lash alpha card follows blink", () => {
  it("(1) manifest exists with the CC0 licence header", () => {
    expect(existsSync(MANIFEST), MANIFEST).toBe(true);
    const m = JSON.parse(readFileSync(MANIFEST, "utf8"));
    expect(m.tool).toBe("lash_blink_follow.py");
    expect(m.licence.rights).toBe("cc0");
    expect(m.licence.header.length).toBeGreaterThan(0);
    expect(m.licence.requiredRecordPhrases).toContain("CC0 1.0");
  });

  it("(2) RED: the G4 input bake (0 lash targets) fails blink-follow", () => {
    const tracked = JSON.parse(readFileSync(REPORT, "utf8"));
    expect(existsSync(BAKE), BAKE).toBe(true);
    expect(sha256File(BAKE)).toBe(tracked.bake_sha256);
    const r = measure(BAKE);
    expect(r.lashPrimTargets, "input lash prim has 0 morph targets").toBe(0);
    expect(r.blinkFollow.L.pass, "input left fails").toBe(false);
    expect(r.blinkFollow.R.pass, "input right fails").toBe(false);
    expect(r.pass, "input overall fails").toBe(false);
    expect(sha256File(BAKE), "input bake bytes unchanged").toBe(tracked.bake_sha256);
  });

  it("(3) GREEN: re-running the G4 producer reproduces the tracked report", () => {
    const tracked = JSON.parse(readFileSync(REPORT, "utf8"));
    const dir = mkdtempSync("/tmp/g4lash-test-");
    const freshReport = join(dir, "report.json");
    execFileSync("mise", ["exec", "--", "python3", PRODUCER], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      timeout: 600000,
      maxBuffer: 64 * 1024 * 1024,
      env: {
        ...process.env,
        G4_LASH_TMP: dir,
        G4_LASH_REPORT: freshReport,
      },
    });
    const fresh = JSON.parse(readFileSync(freshReport, "utf8"));
    expect(fresh.bake_sha256).toBe(tracked.bake_sha256);
    expect(fresh.postrefit_sha256).toBe(tracked.postrefit_sha256);
    expect(fresh.output_sha256, "producer output bytes reproduce the tracked bake").toBe(
      tracked.output_sha256,
    );
    expect(fresh.lashPrimTargets, "output carries the 6 closure/slit/opened-up targets").toBe(6);
    expect(fresh.blinkFollowPass, "output overall passes").toBe(true);
    expect(fresh.blinkFollow).toEqual(tracked.blinkFollow);
    expect(fresh.t2b).toEqual(tracked.t2b);
    expect(fresh.a3).toEqual(tracked.a3);
    expect(fresh.sealInvariance).toEqual(tracked.sealInvariance);
    for (const side of ["L", "R"]) {
      const row = fresh.blinkFollow[side];
      expect(row.lidMarginVerts, `${side} lid-margin verts > 0`).toBeGreaterThan(0);
      expect(row.sameDirection, `${side} same direction as lid`).toBe(true);
      // Absolute travel floor inherited from the retired spike guard (>=80%
      // lid travel per side): toEqual above only proves reproduction of
      // whatever the report holds, so a report re-issued with 40% travel
      // would pass without this. Landed G4 measures 194/207%.
      expect(row.travelPct, `${side} travelPct >= 80`).toBeGreaterThanOrEqual(80);
      expect(row.pass, `${side} passes`).toBe(true);
    }
  }, 600000);

  it("(4) COUNTERWEIGHT: the bar is not vacuous — untreated bodies fail it", () => {
    // The shipped OB control never went through T2b+A3: 0 lash targets, no
    // pass. If a refactor ever made untreated input clear GREEN, this fails.
    // The G4 treatment genuinely changes bytes (output != post-refit input).
    const tracked = JSON.parse(readFileSync(REPORT, "utf8"));
    const r = measure(CONTROL);
    expect(r.lashPrimTargets, "control has no lash morph targets").toBe(0);
    expect(r.pass, "untreated control fails").toBe(false);
    expect(tracked.output_sha256, "treatment changed the bytes").not.toBe(
      tracked.postrefit_sha256,
    );
  });
});

// NOT TESTED: gaze at +25/-25 deg (compat-eyes card); pixel grade (lash-sheet.png).
