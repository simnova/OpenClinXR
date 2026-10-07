/** Isolated viseme stills report validation (results, not gates). */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../../../..");
const REPORT_DIR = path.join(REPO, "docs/openclinxr/mouth-dynamics/viseme-eval");

const ORDER = ["sil", "PP", "FF", "TH", "DD", "kk", "CH", "SS", "nn", "RR", "aa", "E", "I", "O", "U"];

type IsolatedReport = {
  schemaVersion: string;
  method: string[];
  corners: { front: { lx: number; rx: number }; view34: { lx: number; rx: number }; default: { lx: number; rx: number } | null };
  views: Record<string, {
    canvas: { w: number; h: number };
    cameraResidualPx: number;
    stills: {
      viseme: string; jawRad: number; jawFraction: number; teethTarget: string; teethWeight: number;
      upperPx: number; lowerPx: number; apertureH: number; width: number; lipGapPx: number;
      centralBox: { x0: number; x1: number; y0: number; y1: number };
    }[];
  }>;
};

function loadIsolated(): IsolatedReport {
  const file = path.join(REPORT_DIR, "isolated.report.json");
  expect(existsSync(file), `missing ${file}`).toBe(true);
  return JSON.parse(readFileSync(file, "utf8")) as IsolatedReport;
}

describe("isolated viseme stills", () => {
  it("reports all 15 visemes in both views with posed-alone weights", () => {
    const report = loadIsolated();
    expect(report.schemaVersion).toBe("openclinxr.viseme-isolated.v1");
    expect(report.method.length).toBeGreaterThan(0);
    for (const id of ["front", "34"]) {
      const view = report.views[id];
      expect(view, `view ${id}`).toBeDefined();
      expect(view.stills.map((s) => s.viseme)).toEqual(ORDER);
      expect(view.cameraResidualPx).toBeLessThan(60);
      for (const s of view.stills) {
        expect(s.jawRad).toBeGreaterThanOrEqual(0);
        expect(s.jawFraction).toBeGreaterThanOrEqual(0);
        expect(s.jawFraction).toBeLessThanOrEqual(1);
        expect(s.teethTarget.length).toBeGreaterThan(0);
        expect(s.upperPx).toBeGreaterThanOrEqual(0);
        expect(s.lowerPx).toBeGreaterThanOrEqual(0);
        expect(s.apertureH).toBeGreaterThanOrEqual(0);
        expect(s.width).toBeGreaterThan(0);
        expect(s.centralBox.x1).toBeGreaterThan(s.centralBox.x0);
      }
    }
  });

  it("resolves landmark corners in every view", () => {
    const report = loadIsolated();
    for (const [id, c] of [["front", report.corners.front], ["34", report.corners.view34], ["default", report.corners.default]] as const) {
      expect(c, `corners ${id}`).not.toBeNull();
      expect(c!.rx).toBeGreaterThan(c!.lx);
    }
  });

  it("commits one labelled sheet per view", () => {
    for (const id of ["front", "34"]) {
      const file = path.join(REPORT_DIR, `isolated-${id}.png`);
      expect(existsSync(file), `missing ${file}`).toBe(true);
      const bytes = readFileSync(file);
      expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
      expect(bytes.readUInt32BE(16)).toBe(5 * 256);
      expect(bytes.readUInt32BE(20)).toBe(3 * (256 + 28));
    }
  });

  it("keeps still PNGs for every viseme and view", () => {
    for (const id of ["front", "34"]) {
      for (const viseme of ORDER) {
        const file = path.join(REPORT_DIR, `isolated-${id}`, `${viseme}.png`);
        expect(existsSync(file), `missing ${file}`).toBe(true);
      }
    }
  });
});
