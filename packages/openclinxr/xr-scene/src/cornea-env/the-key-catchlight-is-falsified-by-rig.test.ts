import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
// Arch: report-only gate. Imports node builtins plus vitest; no package
// modules at all, so it cannot move testInternalImports. It pins the
// falsified_by_rig record and guards the restored call site: anyone who
// changes the globe env source again must update catchlight-key-report.json.
const here = dirname(fileURLToPath(import.meta.url));
const reportPath = join(here, "catchlight-key-report.json");
const callSitePath = join(here, "../isolated-subject-rig-variants.ts");
const reportText: string = readFileSync(reportPath, "utf8");
const report = JSON.parse(reportText) as {
  card: string;
  decision: string;
  graderVerdict: { sheets: string; instruction: string; sheetPaths: string[] };
  rigKey: { blender: [number, number, number]; size: number; energy: number };
  eyes: Record<string, { key_pred: [number, number]; fals_pred_off_pupil: number; pupil_r: number }>;
  rigRequirement: {
    statement: string;
    perSubject: Record<string, { elevationDeg: [number, number]; windowPx: [number, number] }>;
    azimuthDeg: [number, number];
    azimuthBasis: string;
    method: string;
    currentKey: { elevationDeg: number; highlightOffsetPx: number; placement: string };
  };
  derivation: string;
  moduleSha256: string;
  callSiteSha256: string;
  globeEnvUpdate: { change: string; record: string; rigKeyFalsificationStands: boolean };
};

describe("the key catch-light is falsified by rig geometry (catchlight-key record)", () => {
  it("decision stands and the unwired module is gone", () => {
    expect(report.card).toBe("tsk_fd7dedb8dc543758");
    expect(report.decision).toBe("falsified_by_rig");
    expect(report.moduleSha256).toBe("reverted");
    expect(report.callSiteSha256).toBe("reverted");
  });

  it("key elevation and sub-stellar numbers exist with their sources", () => {
    expect(report.rigKey.blender).toEqual([0.0862, -0.0523, 2.4]);
    expect(report.rigRequirement.currentKey.elevationDeg).toBe(70);
    expect(report.rigRequirement.currentKey.placement).toMatch(/lidded/);
    const keys = Object.keys(report.eyes);
    expect(keys.length).toBeGreaterThanOrEqual(7);
    for (const k of keys) {
      const e = report.eyes[k]!;
      expect(Array.isArray(e.key_pred) && e.key_pred.length === 2, `${k} key_pred`).toBe(true);
      expect(Number.isFinite(e.fals_pred_off_pupil), `${k} pupil distance`).toBe(true);
      expect(Number.isFinite(e.pupil_r), `${k} pupil_r`).toBe(true);
    }
    expect(report.derivation.length).toBeGreaterThan(200);
  });

  it("rigRequirement band exists for both subjects", () => {
    const rr = report.rigRequirement;
    expect(rr.statement).toMatch(/48\.5-50\.0deg/);
    for (const subj of ["aisha", "body2"]) {
      const band = rr.perSubject[subj]!;
      expect(band.elevationDeg[0]).toBeLessThan(band.elevationDeg[1]);
      expect(band.windowPx[0]).toBeLessThan(band.windowPx[1]);
    }
    expect(rr.azimuthDeg).toEqual([-30, 30]);
    expect(rr.azimuthBasis.length).toBeGreaterThan(20);
    expect(rr.method).toMatch(/Gullstrand/);
  });

  it("grader verdict names the limbal ring with sheet paths", () => {
    expect(report.graderVerdict.sheets).toMatch(/limbus/);
    expect(report.graderVerdict.instruction).toMatch(/Do not wire/);
    expect(report.graderVerdict.sheetPaths.length).toBeGreaterThanOrEqual(4);
  });

  it("call-site globe env change is recorded (room + softbox quad, not the rig key)", () => {
    const src = readFileSync(callSitePath, "utf8");
    const fnIdx = src.indexOf("export async function applyProductRig");
    expect(fnIdx, "applyProductRig present").toBeGreaterThanOrEqual(0);
    const body = src.slice(fnIdx);
    expect(body, "room base retained").toMatch(/new RoomEnvironment\(\)/);
    expect(body, "softbox quad augments the room").toMatch(/globeEnvScene\.add\(catchQuad\)/);
    expect(body, "still globe-scoped, no scene.environment").not.toMatch(/scene\.environment =/);
    expect(src, "no rig-key-globe-env rebuild").not.toMatch(/rig-key-globe-env/);
    expect(report.globeEnvUpdate.rigKeyFalsificationStands, "key falsification stands").toBe(true);
    expect(report.globeEnvUpdate.record, "h2 record named").toMatch(/catchlight-report\.json h2/);
    expect(report.globeEnvUpdate.change, "quad change described").toMatch(/quad/);
  });
});
