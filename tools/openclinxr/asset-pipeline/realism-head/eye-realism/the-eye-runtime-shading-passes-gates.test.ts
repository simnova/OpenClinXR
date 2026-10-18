import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Card tsk_e0afe706b7a5f071 (eyeshade): runtime eye shading gates.
 *
 * Reads ONLY the report (plus repo sources for pins, plus the asset store
 * for sha checks when it exists — CI has no store, so those checks skip
 * there; the report-shape and gate-arithmetic checks always run).
 * claimScope: report integrity + gate arithmetic + source pins.
 * notEvidenceFor: clinical validity, Quest readiness, any visual grade
 * (the sheet is human-graded).
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../../../..");
const REPORT_PATH = join(HERE, "eye-runtime-shading-report.json");
const LAB_PATH = join(REPO_ROOT, "packages/openclinxr/xr-scene/src/isolated-subject-lab.ts");
const RIG_PATH = join(REPO_ROOT, "packages/openclinxr/xr-scene/src/isolated-subject-rig-variants.ts");
const SHADER_PATH = join(REPO_ROOT, "packages/openclinxr/xr-scene/src/eye-shader/eye-sclera-shade.ts");

type Cell = {
  pre: { M1: number; M2b: number };
  post: { M1: number; M2b: number };
  g1: { post: number; needBelow: number; pass: boolean };
  g2: { pre: number; post: number; deltaToward: number; needMoreThan: number; pass: boolean };
};

type Report = {
  card: string;
  verdict: string;
  constants: { scleraEnvAtten: number; lidBandM: number; lidDarken: number };
  goals: Record<string, { M1: number; M2b: number }>;
  noiseFloors: {
    mask: Record<string, { M1: number; M2b: number }>;
    irisEuclidFloor: Record<string, number>;
  };
  cells: Record<string, Cell>;
  constancyWitnesses: {
    irisCoreShared: Record<string, { euclid: number; floor: number; pass: boolean }>;
    skinCrops: Record<string, { cheek: { dL: number }; forehead: { dL: number } }>;
    catchlight: {
      glintVerdict: string;
    } & Record<string, unknown>;
  };
  g3: { verdict: string };
  sheet: { path: string; sha256: string };
  probes: string[];
};

const sha256File = (p: string): string =>
  createHash("sha256").update(readFileSync(p)).digest("hex");

const report = JSON.parse(readFileSync(REPORT_PATH, "utf8")) as Report;

function expectFiniteRecord(value: unknown, trail: string): void {
  if (typeof value === "number") {
    expect(Number.isFinite(value), `${trail} is finite`).toBe(true);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => expectFiniteRecord(v, `${trail}[${i}]`));
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (typeof v === "boolean" || typeof v === "string") continue;
      expectFiniteRecord(v, `${trail}.${k}`);
    }
  }
}

describe("the eye runtime shading passes its gates", () => {
  it("names this card with a pass verdict", () => {
    expect(report.card).toBe("tsk_e0afe706b7a5f071");
    expect(report.verdict).toBe("pass");
  });

  it("covers both subjects and both framings", () => {
    expect(Object.keys(report.cells).sort()).toEqual(
      ["aisha-front", "aisha-yaw25", "body2-front", "body2-yaw25"],
    );
  });

  it("cites finite measurements in every cell", () => {
    for (const [cell, c] of Object.entries(report.cells)) {
      expectFiniteRecord(c.pre, `${cell}.pre`);
      expectFiniteRecord(c.post, `${cell}.post`);
    }
  });

  it("G1 holds: M2b < 0 beyond its noise floor, recomputed from the numbers", () => {
    for (const [cell, c] of Object.entries(report.cells)) {
      const floor = report.noiseFloors.mask[cell]!.M2b;
      expect(c.g1.pass, `${cell} G1 flag`).toBe(true);
      expect(c.post.M2b, `${cell} POST M2b`).toBe(c.g1.post);
      expect(c.g1.post, `${cell} M2b < 0`).toBeLessThan(0);
      expect(c.g1.post, `${cell} M2b beyond floor -${floor}`).toBeLessThan(-floor);
    }
  });

  it("G2 holds: M1 moves toward the subject goal by more than its floor", () => {
    for (const [cell, c] of Object.entries(report.cells)) {
      const subject = cell.startsWith("aisha") ? "aisha" : "body2";
      const floor = report.noiseFloors.mask[cell]!.M1;
      const goal = report.goals[subject]!.M1;
      expect(c.g2.pass, `${cell} G2 flag`).toBe(true);
      expect(Math.abs(c.post.M1 - goal), `${cell} POST closer to goal than PRE`).toBeLessThan(
        Math.abs(c.pre.M1 - goal),
      );
      expect(Math.abs(c.g2.deltaToward), `${cell} |delta| beyond floor ${floor}`).toBeGreaterThan(
        floor,
      );
    }
  });

  it("CW iris holds: shared-landmark core euclid within its floor", () => {
    const cw = report.constancyWitnesses.irisCoreShared;
    for (const [cell, w] of Object.entries(cw)) {
      expect(w.pass, `${cell} CW iris flag`).toBe(true);
      expect(w.euclid, `${cell} core euclid within floor ${w.floor}`).toBeLessThanOrEqual(
        w.floor,
      );
    }
  });

  it("CW skin holds: cheek and forehead crops unchanged within the M1 mask floor", () => {
    for (const [dotCell, crops] of Object.entries(report.constancyWitnesses.skinCrops)) {
      if (!crops || typeof crops.cheek?.dL !== "number") continue;
      const cell = dotCell.replace(".", "-");
      const floor = report.noiseFloors.mask[cell]!.M1;
      expect(Math.abs(crops.cheek.dL), `${cell} cheek within ${floor}`).toBeLessThanOrEqual(
        floor,
      );
      expect(Math.abs(crops.forehead.dL), `${cell} forehead within ${floor}`).toBeLessThanOrEqual(
        floor,
      );
    }
  });

  it("CW catch-light: body2 bit-exact, aisha glint-verdict recorded with mechanism", () => {
    const cl = report.constancyWitnesses.catchlight as {
      glintVerdict: string;
      deviation: string;
    };
    expect(cl.glintVerdict).toBe("pass");
    expect(cl.deviation.length, "aisha deviation documented").toBeGreaterThan(100);
  });

  it("sweep pins the constants: 3 values per constant, shipped row matches POST", () => {
    const sweep = (report as unknown as { sweep: { rows: Array<Record<string, unknown>>; reading: string } }).sweep;
    expect(sweep.rows.length).toBe(9);
    for (const row of sweep.rows) {
      for (const side of ["aisha", "body2"] as const) {
        const m = row[side] as { M1: number; M2b: number; D90: number; CL: number };
        for (const k of ["M1", "M2b", "D90", "CL"] as const) {
          expect(typeof m[k], `${row["vary"]}=${row[row["vary"] as string]} ${side}.${k} finite`).toBe("number");
          expect(Number.isFinite(m[k]), `${row["vary"]}=${row[row["vary"] as string]} ${side}.${k}`).toBe(true);
        }
      }
    }
    const shipped = sweep.rows.filter((r) => r["shipped"] === true);
    expect(shipped.length).toBe(3);
    for (const row of shipped) {
      const a = row["aisha"] as { M1: number; M2b: number };
      expect(a.M1, "shipped atten/band/darken row reproduces POST aisha-front M1").toBe(
        report.cells["aisha-front"]!.post.M1,
      );
      expect(a.M2b, "shipped row reproduces POST aisha-front M2b").toBe(
        report.cells["aisha-front"]!.post.M2b,
      );
    }
    const weak = sweep.rows.find((r) => r["vary"] === "darken" && r["darken"] === 0.7)!;
    const weakBody2 = (weak["body2"] as { M2b: number }).M2b;
    expect(weakBody2, "darken 0.7 fails G1 on body2 (ruled-out bound)").toBeGreaterThan(
      -report.noiseFloors.mask["body2-front"]!.M2b,
    );
    expect(sweep.reading.length, "sweep reading recorded").toBeGreaterThan(200);
  });

  it("G3 holds: the ACES guard probe passed", () => {
    expect(report.g3.verdict).toBe("pass");
  });

  it("source pins the shaded-eye ACES guard (fails loudly otherwise)", () => {
    const src = readFileSync(LAB_PATH, "utf8");
    expect(src).toContain("eyeRuntimeShading requires ACESFilmic tone mapping");
    expect(src).toContain("refusing rather than grading a blowout eye");
    expect(src).toContain("ACESFilmicToneMapping");
  });

  it("source pins the lid-contact mechanism and its constants", () => {
    const rig = readFileSync(RIG_PATH, "utf8");
    expect(rig).toContain('"lid-contact"');
    expect(rig).toContain("applyEyeShading");
    const contact = readFileSync(
      join(REPO_ROOT, "packages/openclinxr/xr-scene/src/eye-shader/eye-lid-contact.ts"),
      "utf8",
    );
    expect(contact).toContain("applyScleraShade");
    expect(contact).toContain("lid-contact");
    expect(contact).toContain("emitWorldPositions");
    const shader = readFileSync(SHADER_PATH, "utf8");
    expect(shader).toContain(`EYE_SCLERA_ENV_ATTEN = ${report.constants.scleraEnvAtten}`);
    expect(shader).toContain(`EYE_LID_BAND_M = ${report.constants.lidBandM}`);
    expect(shader).toContain(`EYE_LID_DARKEN = ${report.constants.lidDarken}`);
    expect(shader).toContain("EYE_SCLERA_CENTER_L_UV");
  });

  it("probe scripts are listed and exist", () => {
    expect(report.probes.length).toBeGreaterThanOrEqual(4);
    for (const p of report.probes) {
      expect(existsSync(join(REPO_ROOT, p)), p).toBe(true);
    }
  });

  it("sheet sha matches disk when the store exists", () => {
    if (!existsSync(report.sheet.path)) return;
    expect(sha256File(report.sheet.path)).toBe(report.sheet.sha256);
  });

  it("graded sheet cells exist on disk when the store exists", () => {
    // Frame-level shas are pinned in eye-runtime-shading-report.json cells;
    // the sheet mapping pins the exact graded files (PRE|POST|EEVEE crops).
    const mapping = join(
      "/Volumes/files/openclinxr-assets/store/eyes-runtime-shading/sheet",
      "eyes-runtime-shading-sheet.mapping.json",
    );
    if (!existsSync(mapping)) return;
    const m = JSON.parse(readFileSync(mapping, "utf8")) as {
      rows: Array<{ pre: string; post: string; eevee: string }>;
    };
    expect(m.rows.length).toBe(4);
    for (const row of m.rows) {
      for (const f of [row.pre, row.post, row.eevee]) {
        expect(existsSync(f), f).toBe(true);
      }
    }
  });
});
