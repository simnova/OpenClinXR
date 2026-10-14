import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The lash blink-follow post-step (settled T2+A3) gives the fitted lash mesh
 * closure morphs that move lid-margin verts along with the lid.
 *
 * RED: the bake input (shipped lash mesh, 0 lash morph targets) measures
 * pass=false. GREEN: the baked output measures pass=true per side
 * (lid-margin verts count>0, same direction as the lid, >=80% lid travel),
 * measured from GLB bytes via `lash_blink_follow.py --measure`.
 *
 * claimScope: blink-follow byte measurement on the two pinned GLBs below.
 * notEvidenceFor: clinical_validity, production_asset_readiness; how anything
 *   looks (pixel grade lives in lash-sheet.png). The input GLB is never written.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../../../..");
const TOOL = join(
  REPO_ROOT,
  "tools/openclinxr/asset-pipeline/makeclothes/eye-lash/lash_blink_follow.py",
);
const MANIFEST = join(
  REPO_ROOT,
  "tools/openclinxr/asset-pipeline/makeclothes/eye-lash/manifest.json",
);
const INPUT = pathResolve(
  REPO_ROOT,
  "../realism-95/.openclinxr/realism-spike/eyemesh/aisha-hp-cornea.glb",
);
const OUTPUT = join(
  REPO_ROOT,
  ".openclinxr/realism-spike/lashcards/aisha-lash-blink.glb",
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

  it("(2) RED: the bake input (0 lash targets) fails blink-follow", () => {
    expect(existsSync(INPUT), INPUT).toBe(true);
    const before = readFileSync(INPUT);
    const r = measure(INPUT);
    expect(r.lashPrimTargets, "input lash prim has 0 morph targets").toBe(0);
    expect(r.blinkFollow.L.pass, "input left fails").toBe(false);
    expect(r.blinkFollow.R.pass, "input right fails").toBe(false);
    expect(r.pass, "input overall fails").toBe(false);
    expect(readFileSync(INPUT).equals(before), "input GLB bytes unchanged").toBe(true);
  });

  it("(3) GREEN: the baked output moves lid-margin verts with the lid", () => {
    if (!existsSync(OUTPUT)) {
      execFileSync("mise", ["exec", "--", "python3", TOOL, INPUT, OUTPUT], {
        cwd: REPO_ROOT,
        encoding: "utf8",
        timeout: 600000,
        maxBuffer: 64 * 1024 * 1024,
      });
    }
    expect(existsSync(OUTPUT), OUTPUT).toBe(true);
    const r = measure(OUTPUT);
    expect(r.lashPrimTargets, "output lash prim carries the 6 closure/slit/opened-up targets").toBe(6);
    for (const side of ["L", "R"]) {
      const row = r.blinkFollow[side];
      expect(row.lidMarginVerts, `${side} lid-margin verts > 0`).toBeGreaterThan(0);
      expect(row.sameDirection, `${side} same direction as lid`).toBe(true);
      expect(row.travelPct, `${side} >= 80% lid travel`).toBeGreaterThanOrEqual(80);
      expect(row.pass, `${side} passes`).toBe(true);
    }
    expect(r.pass, "output overall passes").toBe(true);
  });
});

// NOT TESTED: gaze at +25/-25 deg (compat-eyes card); pixel grade (lash-sheet.png).
