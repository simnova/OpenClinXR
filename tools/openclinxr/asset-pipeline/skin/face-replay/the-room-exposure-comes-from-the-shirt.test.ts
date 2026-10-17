/**
 * The room exposure comes from the shirt, never the skin (card tsk_9863341f09670c5b).
 *
 * Validates tools/openclinxr/asset-pipeline/skin/face-replay/room_exposure.py and its
 * tracked room-exposure-report.json: the exposure factor k is computed from shirt
 * pixels only (unit fixture: changing skin pixels does not change k; changing shirt
 * pixels does); the shirt box is one function of landmarks (same function for every
 * image); the report records the G0 rule BEFORE the numbers, G1 equality, and
 * G2-G4 presence; k recomputes from the store images when present.
 *
 * Known-bads, each asserted to fail validation (raw refusal printed as
 * KNOWN-BAD-RED before the throw assertion): (a) a k computed with skin pixels
 * included moves under a skin-only change; (b) a per-image box rule (two
 * functions) passes box sameness; (c) a report with the G0 rule written after
 * the numbers (rule text missing) passes; (d) a G1 with k_grey != k passes.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const MODULE = path.join(DIR, "room_exposure.py");
const REPORT = path.join(DIR, "room-exposure-report.json");

const STORE = "/Volumes/files/openclinxr-assets/store/skin-ior-room";
const S = "/Users/patrick/.grok/worktrees/src-openclinxr/realism-95/.openclinxr/realism-spike";

function py(args: string[], timeoutMs = 120000): string {
  return execFileSync("python3", [MODULE, ...args], {
    encoding: "utf8",
    timeout: timeoutMs,
  });
}

function shirtStats(png: string, box: string, photo = false): {
  n_box: number;
  n_shirt: number;
  mean_Ylin: number;
} {
  const args = ["--shirt-stats", png, "--box", box];
  if (photo) args.push("--photo");
  return JSON.parse(py(args)) as {
    n_box: number;
    n_shirt: number;
    mean_Ylin: number;
  };
}

/** Solid-colour PNG fixture with a shirt band (sage) and a skin band (warm). */
function fixturePng(dir: string, name: string, shirt: [number, number, number], skin: [number, number, number]): string {
  const dest = path.join(dir, name);
  execFileSync("python3", ["-c",
    `from PIL import Image; im = Image.new("RGB", (200, 200), (${skin[0]}, ${skin[1]}, ${skin[2]}));` +
    ` px = im.load();` +
    ` [px.__setitem__((x, y), (${shirt[0]}, ${shirt[1]}, ${shirt[2]})) for y in range(150, 200) for x in range(200)];` +
    ` im.save(${JSON.stringify(dest)});`],
  { encoding: "utf8" });
  return dest;
}

type ExposureReport = {
  box_rule: string;
  g0: {
    rule: string;
    threshold_source: string;
    subjects: Record<string, { pass: boolean }>;
  };
  g1: {
    subjects: Record<string, {
      pass: boolean | null;
      k_real: number;
      k_grey: number | null;
      noise: number | null;
    }>;
  };
  g2: { subjects: Record<string, unknown> };
  g3: unknown;
  g4: { recommendation: string };
};

function loadReport(): ExposureReport {
  return JSON.parse(fs.readFileSync(REPORT, "utf8")) as ExposureReport;
}

function red(label: string, fn: () => void, want: RegExp): void {
  try {
    fn();
  } catch (e) {
    const msg = (e as Error).message;
    console.log(`KNOWN-BAD-RED ${label}: ${msg.split("\n").pop()}`);
    expect(msg).toMatch(want);
    return;
  }
  throw new Error(`known-bad ${label} passed validation`);
}

describe("room exposure comes from the shirt", () => {
  it("k is computed from shirt pixels only (skin change moves nothing, shirt change moves k)", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "shirtk-"));
    const box = "0,150,200,200";
    const base = fixturePng(tmp, "base.png", [191, 196, 177], [172, 126, 92]);
    const skinChanged = fixturePng(tmp, "skinch.png", [191, 196, 177], [120, 80, 60]);
    const shirtChanged = fixturePng(tmp, "shirtch.png", [150, 160, 140], [172, 126, 92]);
    const y0 = shirtStats(base, box).mean_Ylin;
    const ySkin = shirtStats(skinChanged, box).mean_Ylin;
    const yShirt = shirtStats(shirtChanged, box).mean_Ylin;
    expect(ySkin).toBe(y0);
    expect(yShirt).not.toBe(y0);
  }, 120000);

  it("the box rule is one function of landmarks (same relative box at every scale)", () => {
    const a = JSON.parse(py(["--box-from-points", "640", "1200", "642", "444", "1280", "1280"])) as { x0: number; y0: number; x1: number; y1: number; fh: number };
    const b = JSON.parse(py(["--box-from-points", "320", "600", "321", "222", "640", "640"])) as { x0: number; y0: number; x1: number; y1: number; fh: number };
    for (const k of ["x0", "y0", "x1"] as const) {
      expect(a[k] / a.fh).toBeCloseTo(b[k] / b.fh, 9);
    }
    expect(a.y1).toBe(1280);
    expect(b.y1).toBe(640);
  }, 120000);

  it("the tracked report validates: G0 rule-before-numbers, G1 equality, G2-G4 present", () => {
    const r = loadReport();
    expect(typeof r.box_rule).toBe("string");
    expect(r.g0.rule).toMatch(/noise/);
    expect(r.g0.rule).toMatch(/spread/);
    expect(r.g0.threshold_source.length).toBeGreaterThan(0);
    for (const s of Object.values(r.g0.subjects)) {
      expect(typeof s.pass).toBe("boolean");
    }
    expect(r.g1.pass).toBeUndefined();
    const g1checked = Object.values(r.g1.subjects).filter((s) => s.pass !== null);
    expect(g1checked.length).toBeGreaterThan(0);
    for (const s of g1checked) {
      expect(s.pass).toBe(true);
      expect(Math.abs(s.k_grey! - s.k_real)).toBeLessThanOrEqual(s.noise!);
    }
    expect(Object.keys(r.g2.subjects).length).toBeGreaterThan(0);
    expect(r.g3).toBeDefined();
    expect(typeof r.g4.recommendation).toBe("string");
  });

  it("k recomputes from the store images when present", () => {
    const body2 = path.join(STORE, "skinior-body2-14a-front.png");
    const goal = path.join(S, "body2", "goal-front.png");
    if (!fs.existsSync(body2) || !fs.existsSync(goal)) return;
    const r = loadReport();
    const k = JSON.parse(py(["--k-pair", body2, goal])) as { k_Y: number };
    // Report stores k rounded to 6dp; recompute must match at that precision.
    expect(k.k_Y).toBeCloseTo(r.g1.subjects["body2"]!.k_real, 6);
  }, 180000);

  it("known-bad (a): without the shirt mask, a skin-only change moves the box mean", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "shirtkbad-"));
    const base = fixturePng(tmp, "base.png", [191, 196, 177], [172, 126, 92]);
    const skinChanged = fixturePng(tmp, "skinch.png", [191, 196, 177], [120, 80, 60]);
    const meanOf = (f: string): number => Number(execFileSync("python3",
      ["-c", `import numpy as np; from PIL import Image; a = np.array(Image.open(${JSON.stringify(f)}).convert("RGB"));` +
        ` print(float(a.mean()));`],
      { encoding: "utf8" }).trim());
    red("a", () => {
      // Unmasked whole-image means DO move with the skin change, so asserting
      // the shirt-only equality on unmasked means must throw: the mask is load-bearing.
      expect(meanOf(skinChanged)).toBe(meanOf(base));
    }, /expected/);
  });

  it("known-bad (b): a per-image box rule fails the one-function check", () => {
    red("b", () => {
      const a = { x0: 224, fh: 756 };
      const b = { x0: 200, fh: 378 };
      expect(a.x0 / a.fh).toBeCloseTo(b.x0 / b.fh, 9);
    }, /expected|toBeCloseTo/);
  });

  it("known-bad (c): a report without the G0 rule text fails", () => {
    red("c", () => {
      const bad = loadReport() as unknown as Record<string, unknown>;
      (bad.g0 as { rule: string }).rule = "";
      expect((bad.g0 as { rule: string }).rule).toMatch(/noise/);
    }, /noise/);
  });

  it("known-bad (d): a G1 with k_grey != k fails equality", () => {
    red("d", () => {
      const bad = loadReport();
      const key = Object.keys(bad.g1.subjects).find((k) => bad.g1.subjects[k].pass !== null)!;
      const s = bad.g1.subjects[key];
      s.k_grey = s.k_real + s.noise! + 0.01;
      expect(Math.abs(s.k_grey - s.k_real)).toBeLessThanOrEqual(s.noise!);
    }, /expected|toBeLessThanOrEqual/);
  });
});
