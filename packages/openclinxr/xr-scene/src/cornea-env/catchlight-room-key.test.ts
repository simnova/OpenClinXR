import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
// Arch: report-only gate. Node builtins + vitest only; no package modules, so
// it cannot move testInternalImports. Pins the catchroom falsifier record: the
// frontal rig light is not visible through the lab's envMap catch-light path,
// so the station rule was reverted and the required wiring is named here.
const here = dirname(fileURLToPath(import.meta.url));
const report = JSON.parse(readFileSync(join(here, "catchlight-room-key-report.json"), "utf8")) as {
  card: string;
  stationRule: { reverted: boolean; elevationDeg: number; azimuthDeg: number; revertReason: string };
  measurement: {
    runtimeCeiling: { threeIntensity: number; eyeMaxDeltaLstar: Record<string, number>; inDiscPxAt25: Record<string, number> };
    conclusion: string;
  };
  rootCause: { labCatchLightPath: string; removedModule: string };
  requiredWiring: { file: string; change: string; status: string };
  gates: Record<string, string>;
  falsifier: { antecedent: string; verdict: string; action: string };
};

const callSitePath = join(here, "../isolated-subject-rig-variants.ts");

describe("the frontal rig light is not visible through the lab catch-light path (catchroom record)", () => {
  it("the station rule was reverted when the falsifier fired", () => {
    expect(report.card).toBe("catchroom");
    expect(report.stationRule.reverted).toBe(true);
    expect(report.stationRule.revertReason).toMatch(/FALSIFIER/);
    expect(report.falsifier.verdict).toBe("fired");
    expect(report.falsifier.action).toMatch(/reverted/);
  });

  it("no reachable intensity reaches the 25 L* spot threshold", () => {
    const ceil = report.measurement.runtimeCeiling;
    expect(ceil.threeIntensity).toBe(5);
    for (const eye of Object.keys(ceil.eyeMaxDeltaLstar)) {
      expect(ceil.eyeMaxDeltaLstar[eye]!, `${eye} max delta`).toBeLessThan(25);
      expect(ceil.inDiscPxAt25[eye]!, `${eye} in-disc px`).toBe(0);
    }
    expect(report.measurement.conclusion).toMatch(/FALSIFIER/);
  });

  it("names the envMap catch-light path and the file outside WRITE_ROOTS", () => {
    expect(report.rootCause.labCatchLightPath).toMatch(/material\.envMap/);
    expect(report.rootCause.labCatchLightPath).toMatch(/RoomEnvironment/);
    expect(report.rootCause.removedModule).toMatch(/rig-key-globe-env\.ts/);
    expect(report.requiredWiring.file).toBe("packages/openclinxr/xr-scene/src/isolated-subject-rig-variants.ts");
    expect(report.requiredWiring.status).toMatch(/OUTSIDE WRITE_ROOTS/);
    expect(report.gates["G1"]).toMatch(/fail/);
    expect(report.gates["G2"]).toMatch(/NOT TESTED/);
  });

  it("the globe env is still the generic room PMREM (guard for the required wiring)", () => {
    const src = readFileSync(callSitePath, "utf8");
    expect(src).toMatch(/pmrem\.fromScene\(new RoomEnvironment\(\), 0\.04\)\.texture/);
  });
});
