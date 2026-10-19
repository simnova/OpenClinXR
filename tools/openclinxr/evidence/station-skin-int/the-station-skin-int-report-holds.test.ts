/**
 * The station-skin-int report holds (card tsk_3dc1802d0ca2b36c).
 *
 * The report pins every gate beside its threshold and source: G1 the
 * under-lower-lip band, G2 the upper-lip dot count with its bad/good
 * ablation, G3 the brow subgates recomputed on the station albedos, G4
 * the face-regression check, G5 the seed renders, G6 the suites.
 *
 * This test asserts the report numbers always (thresholds, verdicts,
 * bad/good/threshold consistency), and re-measures from the store when
 * the run dirs exist: the G1 band mean, the G2 texel counts, the G3
 * outside-union byte-identity, and every G5 PNG sha. Python runs through
 * mise (R3); repo files resolve from the workspace root, never an
 * absolute worktree path (R5).
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

function testRepoRoot(): string {
  let dir = dirname(new URL(import.meta.url).pathname);
  for (let i = 0; i < 12; i += 1) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    dir = dirname(dir);
  }
  throw new Error("workspace root (pnpm-workspace.yaml) not found");
}

const MISE_TRUST_DIR = "/Volumes/files/src/openclinxr";
const REPORT_REL = "tools/openclinxr/evidence/station-skin-int/station-skin-int-report.json";

type Gate = {
  value: unknown;
  threshold: unknown;
  source: string;
  verdict: string;
  details?: Record<string, unknown>;
};

function loadReport(): {
  card: string;
  store: string;
  gates: Record<string, Gate>;
  runs: { runB: Record<string, string>; runC: Record<string, string> };
} {
  const root = testRepoRoot();
  const rep = JSON.parse(readFileSync(join(root, REPORT_REL), "utf8")) as {
    card: string;
    store: string;
    gates: Record<string, Gate>;
    runs: { runB: Record<string, string>; runC: Record<string, string> };
  };
  return rep;
}

function py(code: string): string {
  return execFileSync("mise", ["exec", "-C", MISE_TRUST_DIR, "--", "python3", "-c", code], {
    cwd: testRepoRoot(),
    timeout: 600_000,
    encoding: "utf8",
  });
}

function sha256File(abs: string): string {
  return createHash("sha256").update(readFileSync(abs)).digest("hex");
}

describe("the station-skin-int report holds", () => {
  it("every gate names value, threshold, source and PASS", () => {
    const rep = loadReport();
    expect(rep.card).toBe("tsk_3dc1802d0ca2b36c");
    for (const g of ["g1", "g2", "g3", "g4", "g5", "g6"]) {
      const gate = rep.gates[g];
      expect(gate, `gate ${g} missing`).toBeDefined();
      expect(gate!.verdict).toBe("PASS");
      expect(gate!.source.length).toBeGreaterThan(0);
    }
    // Card thresholds (brief G1/G2/G4):
    // G1 band mean in [-1, +1]; G2 threshold is the bad/good midpoint.
    expect(rep.gates["g1"]!.threshold).toEqual({ hi: 1.0, lo: -1.0 });
    const g2 = rep.gates["g2"]!;
    const bad = (g2.details as Record<string, number>)["known_bad"];
    const good = (g2.details as Record<string, number>)["known_good"];
    expect(g2.threshold).toBe((bad + good) / 2);
    expect(g2.value).toBe(good);
    // G4 exited 0 with no failures; G5 recorded exactly its 4 PNGs.
    expect((rep.gates["g4"]!.value as { exit: number; failed: string[] }).exit).toBe(0);
    expect((rep.gates["g4"]!.value as { exit: number; failed: string[] }).failed).toEqual([]);
    expect(rep.gates["g5"]!.value).toBe(4);
  });

  it("G3 subgates hold their report bounds", () => {
    const rep = loadReport();
    const d = rep.gates["g3"]!.details as Record<string, Record<string, number>>;
    const aisha = d["aisha_mesh"]!;
    expect(aisha["outside_max_dLab"]).toBe(0.0);
    expect(aisha["halo_frac"]).toBeLessThanOrEqual(0.1);
    expect(aisha["G7_union_mean_dL"]).toBeGreaterThanOrEqual(-2);
    expect(aisha["G9_ratio"]).toBeGreaterThanOrEqual(0.7);
    expect(aisha["G9_ratio"]).toBeLessThanOrEqual(1.3);
    expect(aisha["G9_margin"]).toBeLessThanOrEqual(0.05);
    expect(aisha["G10_cleared"]).toBeLessThanOrEqual(2);
    expect(aisha["G10_strip"]).toBeLessThanOrEqual(2);
    for (const r of aisha["G11_ratios"] as unknown as number[]) {
      expect(r).toBeGreaterThanOrEqual(0.65);
      expect(r).toBeLessThanOrEqual(1.35);
    }
    for (const b of aisha["G12_bright"] as unknown as number[]) {
      expect(b).toBeLessThanOrEqual(0.0096);
    }
    const body2 = d["body2_texture"]!;
    expect(body2["outside_max_dLab"]).toBe(0.0);
    expect(body2["G6_max_dL"]).toBeLessThanOrEqual(2);
    expect(body2["G6_max_dC"]).toBeLessThanOrEqual(2);
  });

  it("G5 PNGs exist with the recorded shas", () => {
    const rep = loadReport();
    const renders = (rep.gates["g5"]! as unknown as { renders: Array<{ png: string; sha256: string }> })["renders"];
    expect(renders).toHaveLength(4);
    for (const r of renders) {
      const abs = join(rep.store, r.png.replace(/^store\//, ""));
      expect(existsSync(abs), `missing ${r.png}`).toBe(true);
      expect(sha256File(abs)).toBe(r.sha256);
    }
  });

  it("runC completed runs reproduce the runB gate inputs byte-identically", () => {
    const rep = loadReport();
    const files = [
      "albedo_socket.png",
      "albedo_beard.png",
      "albedo_detail.png",
      "albedo_browform.png",
      "lip-vermilion-albedo-union.png",
    ];
    for (const kase of ["aisha", "body2"]) {
      const dirB = join(rep.store, rep.runs.runB[kase] as string);
      const dirC = join(rep.store, rep.runs.runC[kase] as string);
      const records = JSON.parse(readFileSync(join(dirC, "stage-records.json"), "utf8")) as {
        status: string;
      };
      expect(records.status, `${rep.runs.runC[kase]} completed`).toBe("completed");
      for (const f of files) {
        expect(existsSync(join(dirC, f)), `${rep.runs.runC[kase]}/${f} exists`).toBe(true);
        expect(sha256File(join(dirC, f)), `${kase} runC ${f} == runB`).toBe(
          sha256File(join(dirB, f)),
        );
      }
    }
  });

  it("G1 re-measures from the store when run6 exists", () => {
    const rep = loadReport();
    const aishaRun = join(rep.store, rep.runs.runB["aisha"] as string);
    if (!existsSync(join(aishaRun, "albedo_detail.png"))) return;
    const mean = parseFloat(
      py(
        [
          "import numpy as np",
          "from PIL import Image",
          "from scipy import ndimage",
          "from skimage.color import rgb2lab",
          `ST=${JSON.stringify(aishaRun)}`,
          "def lab(p): return rgb2lab(np.asarray(Image.open(p).convert('RGB')).astype(float)/255.0)",
          "pre=lab(ST+'/albedo_beard.png'); st=lab(ST+'/albedo_detail.png')",
          "m10=np.asarray(Image.open(ST+'/lip-vermilion-albedo-union.png').convert('L'))>127",
          "fc=np.asarray(Image.open(ST+'/derive_out/mask-facecore.png').convert('L'))>127",
          "fce=ndimage.binary_erosion(fc,iterations=30)",
          "cols=np.nonzero(m10.any(0))[0]; c0,c1=int(cols.min()),int(cols.max())",
          "cc0=int(c0+0.2*(c1-c0)); cc1=int(c1-0.2*(c1-c0))",
          "R2=np.zeros_like(fce)",
          "for x in range(cc0,cc1+1):",
          " col=np.nonzero(m10[:,x])[0]",
          " if len(col): lo=int(col.max()); R2[lo+3:lo+19,x]=True",
          "R2=R2&fce",
          "print(float(((st-pre)[...,0][R2]).mean()))",
        ].join("\n"),
      ).trim(),
    );
    const reported = (rep.gates["g1"]!.value as { mean_dL: number }).mean_dL;
    expect(Math.abs(mean - reported)).toBeLessThan(1e-4);
    expect(mean).toBeGreaterThanOrEqual(-1);
    expect(mean).toBeLessThanOrEqual(1);
  }, 600_000);

  it("G2 re-measures from the store when run9 and the ablation exist", () => {
    const rep = loadReport();
    const g2d = rep.gates["g2"]!.details as Record<string, string | number>;
    const body2Run = join(rep.store, rep.runs.runB["body2"] as string);
    const out = g2d["outputs"] as unknown as Record<string, string>;
    const files = [
      join(body2Run, "albedo_socket.png"),
      join(body2Run, "albedo_beard.png"),
      join(body2Run, "lip-vermilion-albedo-union.png"),
      join(rep.store, (out["bad"] as string).replace(/^store\//, "")),
      join(rep.store, (out["good"] as string).replace(/^store\//, "")),
    ];
    if (files.some((f) => !existsSync(f))) return;
    const counts = JSON.parse(
      py(
        [
          "import numpy as np, json",
          "from PIL import Image",
          `ST=${JSON.stringify(body2Run)}`,
          `OUT=${JSON.stringify(rep.store)}`,
          "def rgb(p): return np.asarray(Image.open(p).convert('RGB')).astype(np.int16)",
          "soc=rgb(ST+'/albedo_socket.png'); run=rgb(ST+'/albedo_beard.png')",
          `bad=rgb(OUT+'/${(out["bad"] as string).replace(/^store\//, "")}')`,
          `good=rgb(OUT+'/${(out["good"] as string).replace(/^store\//, "")}')`,
          "mst=np.asarray(Image.open(ST+'/lip-vermilion-albedo-union.png').convert('L'))>127",
          "def M(a,b): return int((np.abs(a-b).max(2)[mst]>=1).sum())",
          "print(json.dumps({'station':M(soc,run),'bad':M(soc,bad),'good':M(soc,good)}))",
        ].join("\n"),
      ).trim(),
    ) as { station: number; bad: number; good: number };
    expect(counts.station).toBe(rep.gates["g2"]!.value);
    expect(counts.bad).toBe(g2d["known_bad"]);
    expect(counts.good).toBe(g2d["known_good"]);
  }, 600_000);

  it("G3 re-measures outside-union identity from the store when the runs exist", () => {
    const rep = loadReport();
    const pairs = [
      { run: rep.runs.runB["aisha"] as string, pre: "albedo_detail.png", post: "albedo_browform.png" },
      { run: rep.runs.runB["body2"] as string, pre: "albedo_detail.png", post: "albedo_browform.png" },
    ];
    for (const p of pairs) {
      const dir = join(rep.store, p.run);
      const need = [
        join(dir, p.pre),
        join(dir, p.post),
        join(dir, "derive_out", "mask-brows-L.png"),
        join(dir, "derive_out", "mask-brows-R.png"),
      ];
      if (need.some((f) => !existsSync(f))) return;
      const maxOutside = parseFloat(
        py(
          [
            "import numpy as np",
            "from PIL import Image",
            "from skimage.color import rgb2lab",
            `D=${JSON.stringify(dir)}`,
            `a=np.array(Image.open(D+'/${p.pre}').convert('RGB')).astype(float)/255.0`,
            `b=np.array(Image.open(D+'/${p.post}').convert('RGB')).astype(float)/255.0`,
            "mL=np.array(Image.open(D+'/derive_out/mask-brows-L.png').convert('L'))>127",
            "mR=np.array(Image.open(D+'/derive_out/mask-brows-R.png').convert('L'))>127",
            "d=np.abs(rgb2lab(b)-rgb2lab(a)).max(axis=2)",
            "print(float(d[~(mL|mR)].max()))",
          ].join("\n"),
        ).trim(),
      );
      expect(maxOutside, `${p.run} outside-union drift`).toBe(0.0);
    }
  }, 600_000);
});
