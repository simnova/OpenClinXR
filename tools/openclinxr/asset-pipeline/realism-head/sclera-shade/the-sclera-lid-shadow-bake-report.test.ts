import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * CARD tsk_6a923ad05526b9e0: bake the lid shadow into the sclera texture.
 *
 * Outcome: NOT CONVERGED. The geometry-only numpy ray-cast AO (seated
 * lids/body as occluders, K=64 hemisphere rays per eye vertex, UV-space
 * multiply on sclera texels only) darkens the LOWER visible sclera more
 * than the upper at every strength (0.25/0.5/1.0), so M2b moves AWAY from
 * the goal midpoint monotonically on both subjects, and strength 1.0
 * breaks the CW iris clause on both. The flag stays opt-in (default off);
 * no shipped GLB rebaked.
 *
 * This test reads the report + the materializer source. claimScope: report
 * integrity + gate honesty + opt-in defaults + no-subject-literal code +
 * iris byte-identity.
 * notEvidenceFor: clinical_validity, quest_readiness, any visual grade.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../../../..");
const REPORT_PATH = join(HERE, "sclera-lid-shadow-bake-report.json");
const MATERIALIZE = join(
  REPO_ROOT,
  "tools/openclinxr/evidence/blender/materialize_mpfb_humanoid_candidate.py",
);
const EYE_SRC = join(REPO_ROOT, "tools/openclinxr/asset-pipeline/eyes/iris-centred-c.png");
const EYE_SRC_SHA = "76c805e58e8c7b451ce4453dd529a073e4d84c48fd4136744484b8b503a7d695";
const STORE = "/Volumes/files/openclinxr-assets/store/sclera-lid-shadow-bake";

const GOAL = {
  aisha: { M1: -14.032, M2a: 7.182, M2b: -8.655, D90: -7.201 },
  body2: { M1: -23.236, M2a: 16.915, M2b: -14.089, D90: -5.832 },
};
const IRIS_FLOOR = { aisha: 6.896, body2: 5.159 };

type Metrics = { M1: number; M2a: number; M2b: number; D90: number };
type Row = {
  row: string;
  params: { strength: number; feather: number };
  aisha: Metrics & { irisEuclidVsPre: number; catchlightPeakL: number; catchlightDeltaVsPre: number };
  body2: Metrics & { irisEuclidVsPre: number; catchlightPeakL: number; catchlightDeltaVsPre: number };
};
type Report = {
  card: string;
  verdict: string;
  pre: { aisha: Metrics & { catchlightPeakL: number; catchlightNoiseL: number }; body2: Metrics & { catchlightPeakL: number; catchlightNoiseL: number } };
  midpoints: { aisha: Record<string, number>; body2: Record<string, number> };
  d90Windows: { aisha: [number, number]; body2: [number, number] };
  noise: { irisEuclidFloor: Record<string, number> };
  sweep: Row[];
  gates: {
    g1: Record<string, Record<string, { value: number; mid: number; pass: boolean }>>;
    g2: Record<string, { D90: { value: number; window: [number, number]; pass: boolean }; iris: { value: number; floor: number; pass: boolean }; catchlight: { value: number; pre: number; noise: number; pass: boolean } }>;
    g3: { pass: boolean };
  };
  probes: {
    flagOff: { M2b: { aisha: number; body2: number } };
    uniform: { aisha: Metrics; body2: Metrics };
  };
  defaults: { unchanged: boolean };
  pick: string;
  files: Record<string, { sha256: string }>;
  sheet: { root: string; files: Record<string, string> };
};

function loadReport(): Report {
  return JSON.parse(readFileSync(REPORT_PATH, "utf8")) as Report;
}

/** Raw RGB decode via sharp (repo precedent: issue-247-pixel-probe.ts). */
const require = createRequire(import.meta.url);
// sharp is CJS and ships no types resolvable from this depth; runtime-only usage.
const sharp = require("sharp") as (input: string) => {
  raw: () => {
    toBuffer: (opts: { resolveWithObject: true }) => Promise<{
      data: Buffer;
      info: { width: number; height: number; channels: number };
    }>;
  };
};

async function decodeRaw(file: string): Promise<{ w: number; h: number; chans: number; data: Buffer }> {
  const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
  return { w: info.width, h: info.height, chans: info.channels, data };
}

function shaFile(abs: string): string {
  return createHash("sha256").update(readFileSync(abs)).digest("hex");
}

/** Source slice between two top-level def lines. */
function functionSlice(src: string, start: string, end: string): string {
  const i = src.indexOf(`\ndef ${start}(`);
  const j = src.indexOf(`\ndef ${end}(`, i + 1);
  expect(i, `def ${start} found`).toBeGreaterThan(-1);
  expect(j, `def ${end} found after ${start}`).toBeGreaterThan(i);
  return src.slice(i, j);
}

const IRIS_C = [[299.55 / 1024, 724.0 / 1024], [724.65 / 1024, 302.72 / 1024]];
const IRIS_R = 135 / 1024;

describe("the lid shadow bakes into the sclera texture (report integrity)", () => {
  it("report exists with the not_converged verdict", () => {
    expect(existsSync(REPORT_PATH)).toBe(true);
    const r = loadReport();
    expect(r.card).toBe("tsk_6a923ad05526b9e0");
    expect(r.verdict).toBe("not_converged");
  });

  it("sweep covers r1-r3 with strength 0.25/0.5/1.0 at feather 1.0, all finite", () => {
    const r = loadReport();
    expect(r.sweep.map((s) => s.row)).toEqual(["r1", "r2", "r3"]);
    expect(r.sweep.map((s) => s.params.strength)).toEqual([0.5, 0.25, 1.0]);
    for (const row of r.sweep) {
      expect(row.params.feather).toBe(1.0);
      for (const side of ["aisha", "body2"] as const) {
        for (const k of ["M1", "M2a", "M2b", "D90"] as const) {
          expect(Number.isFinite(row[side][k]), `${row.row}.${side}.${k} finite`).toBe(true);
        }
        expect(Number.isFinite(row[side].irisEuclidVsPre)).toBe(true);
        expect(Number.isFinite(row[side].catchlightPeakL)).toBe(true);
      }
    }
  });

  it("midpoints and D90 windows recompute from PRE and goal", () => {
    const r = loadReport();
    for (const subject of ["aisha", "body2"] as const) {
      for (const k of ["M1", "M2a", "M2b"] as const) {
        const exact = (r.pre[subject][k] + GOAL[subject][k]) / 2;
        expect(Math.abs(r.midpoints[subject]![k]! - exact), `${subject}.${k} midpoint`).toBeLessThanOrEqual(0.00051);
      }
      const h = Math.abs(r.pre[subject].D90 - GOAL[subject].D90) / 2;
      expect(Math.abs(r.d90Windows[subject]![0]! - (GOAL[subject].D90 - h))).toBeLessThanOrEqual(0.00051);
      expect(Math.abs(r.d90Windows[subject]![1]! - (GOAL[subject].D90 + h))).toBeLessThanOrEqual(0.00051);
      expect(r.noise.irisEuclidFloor[subject]).toBe(IRIS_FLOOR[subject]);
    }
  });

  it("G1/G2/CW flags recompute honestly and the verdict follows", () => {
    const r = loadReport();
    let allpass = true;
    const pick = r.sweep.find((s) => s.row === r.pick)!;
    expect(pick, "pick is a sweep row").toBeDefined();
    for (const subject of ["aisha", "body2"] as const) {
      const g = r.gates.g1[subject]!;
      for (const k of ["M1", "M2a", "M2b"] as const) {
        const want = k === "M2a" ? pick[subject][k] >= r.midpoints[subject]![k]! : pick[subject][k] <= r.midpoints[subject]![k]!;
        expect(g[k]!.pass, `${r.pick}.${subject}.${k} recomputed`).toBe(want);
        allpass &&= want;
      }
      const d = r.gates.g2[subject]!;
      const w = r.d90Windows[subject]!;
      expect(d.D90.pass, `${r.pick}.${subject}.D90 recomputed`).toBe(d.D90.value >= w[0]! && d.D90.value <= w[1]!);
      allpass &&= d.D90.value >= w[0]! && d.D90.value <= w[1]!;
      expect(d.iris.pass).toBe(d.iris.value <= d.iris.floor);
      allpass &&= d.iris.value <= d.iris.floor;
      expect(d.catchlight.pass).toBe(Math.abs(d.catchlight.value - d.catchlight.pre) <= d.catchlight.noise);
      allpass &&= Math.abs(d.catchlight.value - d.catchlight.pre) <= d.catchlight.noise;
    }
    expect(allpass, "some gate fails (not_converged)").toBe(false);
    expect(r.gates.g3.pass).toBe(true);
  });

  it("M2b fails its midpoint on every round on both subjects (the falsifier)", () => {
    const r = loadReport();
    for (const row of r.sweep) {
      for (const subject of ["aisha", "body2"] as const) {
        expect(row[subject].M2b, `${row.row}.${subject}.M2b above midpoint`).toBeGreaterThan(r.midpoints[subject]!["M2b"]!);
      }
    }
  });

  it("probes: flag-off and uniform multiply both fail G1 M2b", () => {
    const r = loadReport();
    for (const subject of ["aisha", "body2"] as const) {
      expect(r.probes.flagOff.M2b[subject], `flag-off ${subject} M2b short of midpoint`).toBeGreaterThan(r.midpoints[subject]!["M2b"]!);
      expect(r.probes.uniform[subject].M2b, `uniform ${subject} M2b short of midpoint`).toBeGreaterThan(r.midpoints[subject]!["M2b"]!);
    }
  });

  it("every cited file exists with a matching sha256", () => {
    const r = loadReport();
    expect(Object.keys(r.files).length).toBeGreaterThan(50);
    for (const [p, e] of Object.entries(r.files)) {
      expect(e.sha256, `${p} sha256`).toMatch(/^[0-9a-f]{64}$/);
      const abs = join(STORE, p);
      expect(existsSync(abs), `${p} exists`).toBe(true);
      expect(shaFile(abs), `${p} sha matches`).toBe(e.sha256);
    }
    for (const [name, digest] of Object.entries(r.sheet.files)) {
      const abs = join(r.sheet.root, name);
      expect(existsSync(abs), `sheet ${name} exists`).toBe(true);
      expect(shaFile(abs), `sheet ${name} sha matches`).toBe(digest);
    }
  });

  it("bake logs show a real ray-cast bake per sweep round (and none for PRE)", () => {
    const r = loadReport();
    for (const row of ["r1", "r2", "r3", "uniform"]) {
      for (const subject of ["aisha", "body2"]) {
        const log = readFileSync(join(STORE, row, `${subject}-bake.log`), "utf8");
        expect(log, `${row}/${subject} baked the AO field`).toContain("SCLERA_LID_AO_BAKED");
        expect(log, `${row}/${subject} iris untouched`).toContain("irisDiff=0");
        expect(log, `${row}/${subject} UV convention checked`).toContain("SCLERA_LID_AO_UVCHECK");
      }
    }
    for (const subject of ["aisha", "body2"]) {
      const log = readFileSync(join(STORE, "pre", subject + "-bake.log"), "utf8");
      expect(log, `pre/${subject} has no AO bake (flag off)`).not.toContain("SCLERA_LID_AO_BAKED");
    }
  });

  it("defaults unchanged: AO flag opt-in, strength/feather defaults pinned", () => {
    const r = loadReport();
    expect(r.defaults.unchanged).toBe(true);
    const src = readFileSync(MATERIALIZE, "utf8");
    expect(src).toMatch(/"--eye-sclera-lid-ao",\s*\n?\s*action\s*=\s*"store_true"/);
    expect(src).toMatch(/"--eye-sclera-lid-ao-strength", type=float, default=0\.5\)/);
    expect(src).toMatch(/"--eye-sclera-lid-ao-feather", type=float, default=1\.0\)/);
    expect(src).not.toMatch(/eye_sclera_lid_ao['"]?\s*\)?\s*=\s*True/);
  });

  it("tracked eye texture is byte-identical (never written by the bake)", () => {
    expect(shaFile(EYE_SRC)).toBe(EYE_SRC_SHA);
  });

  it("pick-round eye textures keep every iris-disc texel byte-identical", async () => {
    const r = loadReport();
    const src = await decodeRaw(EYE_SRC);
    for (const subject of ["aisha", "body2"]) {
      const png = await decodeRaw(join(STORE, r.pick, `${subject}-lidconform.sclera-lid-eye.png`));
      expect([png.w, png.h]).toEqual([src.w, src.h]);
      let diffs = 0;
      for (let y = 0; y < png.h; y += 1) {
        const vf = (y + 0.5) / png.h;
        for (let x = 0; x < png.w; x += 1) {
          const u = (x + 0.5) / png.w;
          const d = Math.min(
            Math.hypot(u - IRIS_C[0]![0], vf - IRIS_C[0]![1]),
            Math.hypot(u - IRIS_C[1]![0], vf - IRIS_C[1]![1]),
          );
          if (d > IRIS_R) continue;
          for (let c = 0; c < 3; c += 1) {
            if (png.data[(y * png.w + x) * png.chans + c] !== src.data[(y * src.w + x) * src.chans + c]) {
              diffs += 1;
              break;
            }
          }
        }
      }
      expect(diffs, `${subject} iris-disc texel diffs`).toBe(0);
    }
  });

  it("no subject name/stem or goal-photo path in the added bake code", () => {
    const src = readFileSync(MATERIALIZE, "utf8");
    const body = functionSlice(src, "_eye_sclera_lid_ao", "_eyemesh_split_cornea_glb");
    const addedCli = src.split("\n").filter((l) => l.includes("eye-sclera-lid-ao"));
    const callSite = src.split("\n").filter((l) => l.includes("_eye_sclera_lid_ao(") || l.includes("sclera-lid-ao") || l.includes("sclera-lid-eye"));
    for (const [name, text] of [["bake-fn", body], ["cli", addedCli.join("\n")], ["callsite", callSite.join("\n")]] as const) {
      expect(text, `${name} has no subject literal`).not.toMatch(/aisha|body2/i);
      expect(text, `${name} has no goal-photo path`).not.toMatch(/goal-front|edit-v9|realism-95|goal.*\.png|front\.png|project\/edit/i);
    }
  });
});
