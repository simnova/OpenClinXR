/**
 * The mask finds the lip line and the chin.
 *
 * Runs the tracked make_belowbrow_mask.py instrument on the two card
 * images when present (S scratch; skip with a logged reason otherwise)
 * and asserts the lane-manager gates: G1 parting row within +-12 of 812
 * (render) / 728 (goal); G2 chin 40x40 box fully inside rows 880-930
 * (render) / 808-864 (goal) with gatefrac >= 0.9; G3 cheeks centres and
 * Lab equal the landed S/port5 mask JSON values on both images, goal
 * forehead equal too, render forehead at the ied-scaled anatomy
 * (eye-0.1321*ied = [511,498], handback 1: brow/forehead offsets scaled
 * by ied from the goal ratio, render only moves). Validates
 * mouth-landmark-report.json beside this test (G4 numbers, overlay shas).
 *
 * RED state (card tsk_80caf274c12851ed): the current instrument finds
 * the mouth as an enclosed dark hole, so on closed lips it lands on the
 * nostril (render mouth_centroid y 719, chin box rows 752-792) and fails
 * G1/G2 on the render.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const MODULE = path.join(DIR, "make_belowbrow_mask.py");
const REPORT = path.join(DIR, "mouth-landmark-report.json");

const S = "/Users/patrick/.grok/worktrees/src-openclinxr/realism-95/.openclinxr/realism-spike";
const IMAGES = {
  render: {
    input: path.join(S, "port5/render/body2-bb-front.png"),
    reference: path.join(S, "port5/bb-final-mask.json"),
    parting: 812,
    chinRows: [880, 930] as const,
  },
  goal: {
    input: path.join(S, "body2/goal-front.png"),
    reference: path.join(S, "port5/goal-bb-mask.json"),
    parting: 728,
    chinRows: [808, 864] as const,
  },
} as const;

type Region = { center: [number, number]; n: number; gatefrac: number; Lab: [number, number, number] | null };
type MaskJson = {
  cx: number; eye_row: number; ied: number; brow_row: number; brow_row: number;
  mouth_centroid: [number, number]; mouth_bottom: number;
  parting_row?: number;
  regions: Record<"L_cheek" | "R_cheek" | "forehead_below_brow" | "chin", Region>;
};

function runInstrument(input: string): MaskJson {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mlm-"));
  const png = path.join(tmp, "mask.png");
  const json = path.join(tmp, "mask.json");
  execFileSync("mise",
    ["exec", "-C", "/Volumes/files/src/openclinxr", "--",
      "python3", MODULE, input, png, json],
    { encoding: "utf8", timeout: 300000 });
  return JSON.parse(fs.readFileSync(json, "utf8")) as MaskJson;
}

function partingRow(m: MaskJson): number {
  return m.parting_row ?? m.mouth_centroid[1];
}

const HAS_IMAGES = (Object.keys(IMAGES) as ("render" | "goal")[])
  .every((k) => fs.existsSync(IMAGES[k].input));
if (!HAS_IMAGES) {
  console.log("SKIP mouth-landmark: S scratch images absent " +
    `(render ${fs.existsSync(IMAGES.render.input)}, ` +
    `goal ${fs.existsSync(IMAGES.goal.input)}); gates not evaluated`);
}

describe("the mask finds the lip line and the chin", () => {
  const gate = HAS_IMAGES ? it : it.skip;

  gate("G1 parting row within +-12 of 812 (render) / 728 (goal)", () => {
    for (const name of ["render", "goal"] as const) {
      const spec = IMAGES[name];
      const m = runInstrument(spec.input);
      const row = partingRow(m);
      console.log(`G1 ${name}: parting_row=${row} target=${spec.parting}`);
      expect(Math.abs(row - spec.parting),
        `${name} parting ${row} within 12 of ${spec.parting}`).toBeLessThanOrEqual(12);
    }
  });

  gate("G2 chin 40x40 box on chin skin with gatefrac >= 0.9", () => {
    for (const name of ["render", "goal"] as const) {
      const spec = IMAGES[name];
      const m = runInstrument(spec.input);
      const chin = m.regions.chin;
      const [lo, hi] = spec.chinRows;
      console.log(`G2 ${name}: chin center=${chin.center} ` +
        `gatefrac=${chin.gatefrac} rows=[${chin.center[1] - 20},${chin.center[1] + 19}]`);
      expect(chin.center[1] - 20,
        `${name} chin box top inside ${lo}`).toBeGreaterThanOrEqual(lo);
      expect(chin.center[1] + 19,
        `${name} chin box bottom inside ${hi}`).toBeLessThanOrEqual(hi);
      expect(chin.gatefrac, `${name} chin gatefrac`).toBeGreaterThanOrEqual(0.9);
    }
  });

  gate("G3 cheeks equal landed values; forehead on the same anatomy", () => {
    const rep = JSON.parse(fs.readFileSync(REPORT, "utf8")) as {
      render_forehead: { center: [number, number]; Lab: [number, number, number] };
    };
    for (const name of ["render", "goal"] as const) {
      const spec = IMAGES[name];
      const m = runInstrument(spec.input);
      const ref = JSON.parse(fs.readFileSync(spec.reference, "utf8")) as MaskJson;
      for (const r of ["L_cheek", "R_cheek"] as const) {
        expect(m.regions[r].center, `${name} ${r} centre`).toEqual(ref.regions[r].center);
        expect(m.regions[r].Lab, `${name} ${r} Lab`).toEqual(ref.regions[r].Lab);
      }
      if (name === "goal") {
        expect(m.regions.forehead_below_brow.center, "goal forehead centre")
          .toEqual(ref.regions.forehead_below_brow.center);
        expect(m.regions.forehead_below_brow.Lab, "goal forehead Lab")
          .toEqual(ref.regions.forehead_below_brow.Lab);
      } else {
        expect(m.brow_row, "render brow_row ied-scaled").toBe(476);
        expect(m.regions.forehead_below_brow.center, "render forehead anatomy")
          .toEqual([511, 498]);
        expect(m.regions.forehead_below_brow.gatefrac, "render forehead gatefrac")
          .toBe(1.0);
        expect(m.regions.forehead_below_brow.Lab, "render forehead Lab recorded")
          .toEqual(rep.render_forehead.Lab);
      }
    }
  });

  it("mouth-landmark-report.json records G4 numbers and overlay shas", () => {
    expect(fs.existsSync(REPORT),
      "mouth-landmark-report.json exists beside the test").toBe(true);
    const rep = JSON.parse(fs.readFileSync(REPORT, "utf8")) as {
      parting: Record<string, number>;
      mouth_bottom: Record<string, number>;
      chin_center: Record<string, [number, number]>;
      g4_report_key: string;
      g4_within3_count: number;
      g4_regions: Record<string, [number, number, number]>;
      g4_blocks: string[];
      render_forehead: { center: [number, number]; Lab: [number, number, number] };
      overlays: { file: string; sha256: string }[];
    };
    for (const k of ["parting", "mouth_bottom", "chin_center", "g4_report_key",
      "g4_within3_count", "g4_regions", "g4_blocks", "render_forehead",
      "overlays"] as const) {
      expect(rep[k], `report has ${k}`).toBeDefined();
    }
    // Falsifier record (card tsk_80caf274c12851ed): with corrected
    // on-skin patches the field re-run reaches 2/4 (cheeks pass;
    // forehead misses by 0.12 in a*, chin is structurally blocked on L
    // by stubble darkening the a*/b*-only field cannot move). Pinned,
    // not bent: any silent change to the numbers breaks it.
    expect(rep.g4_within3_count, "G4 within-3 count recomputes to 2")
      .toBe(2);
    const flags = Object.fromEntries(Object.entries(rep.g4_regions)
      .map(([n, d]) => [n, (d as [number, number, number])
        .every((x) => Math.abs(x) <= 3)]));
    expect(flags, "L/R cheek pass, forehead + chin fail").toEqual({
      L_cheek: true, R_cheek: true, forehead_below_brow: false,
      chin: false,
    });
    expect(rep.g4_blocks.length, "blocker statement recorded").toBeGreaterThanOrEqual(1);
    const rchr = JSON.parse(fs.readFileSync(
      path.join(DIR, "regional-chroma-report.json"), "utf8")) as {
      [k: string]: unknown;
    };
    expect(rchr[rep.g4_report_key],
      `regional-chroma-report.json carries key ${rep.g4_report_key}`).toBeDefined();
    const mouthlm = rchr[rep.g4_report_key] as {
      regions: Record<string, {
        dLab_render_minus_goal: [number, number, number];
        within_3_per_channel: boolean;
      }>;
      g1_count: number;
    };
    for (const [n, d] of Object.entries(rep.g4_regions)) {
      expect(mouthlm.regions[n]!.dLab_render_minus_goal,
        `report key dLab matches for ${n}`).toEqual(d);
    }
    expect(mouthlm.g1_count, "report key G1 count matches").toBe(2);
    let checked = 0;
    for (const o of rep.overlays) {
      if (!fs.existsSync(o.file)) {
        console.log(`SKIP overlay sha (absent store file): ${o.file}`);
        continue;
      }
      const actual = execFileSync("shasum", ["-a", "256", o.file],
        { encoding: "utf8" }).split(" ")[0];
      expect(actual, `overlay sha ${o.file}`).toBe(o.sha256);
      checked++;
    }
    console.log(`report overlays: ${checked}/${rep.overlays.length} sha-checked`);
  });
});
