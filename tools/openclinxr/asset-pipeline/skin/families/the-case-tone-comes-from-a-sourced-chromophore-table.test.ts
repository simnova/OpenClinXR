import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { edChestPainScenario } from "@openclinxr/scenario-fixtures";

type Lab = [number, number, number];
type KnownGood = {
  id: string;
  measuredLab: Lab;
  derivedLab: Lab;
  Cm: number;
  betaM: number;
  Ch: number;
  dE76: number;
  onRangeBound: { Cm: boolean; betaM: boolean; Ch: boolean };
};
type TableRow = {
  token: string;
  Cm: number;
  betaM: number;
  Ch: number;
  derivedLab: Lab;
  calibratedBy: string;
};
type Report = {
  decision: "table" | "falsified" | "inconclusive";
  reason?: string;
  control: {
    fit: { Cm: number; betaM: number; Ch: number };
    values: Array<{ wavelengthNm: number; reflectance: number; populationSd: number }>;
    tolerance: { value: number; source: string };
    rmsReflectanceError: number;
    qBandMinimaNm: { control: number[]; model: number[] };
    Lab: { control: Lab; model: Lab; dE76: number };
    pass: boolean;
  };
  counterweight: {
    Cm: number;
    betaM: number;
    "aStarAtCh0.001": number;
    "aStarAtCh0.1": number;
    deltaAStar: number;
    threshold: number;
    thresholdSource: string;
    pass: boolean;
  };
  parameters: {
    betaM: { value: number; citation: string; range: [number, number] };
    Ch: { value: number; citation: string; range: [number, number] };
    Cm: { citation: string; range: [number, number] };
  };
  knownGood: KnownGood[];
  tableRows: TableRow[];
  endToEnd: {
    caseDriven: boolean;
    fixture: string;
    token: string;
    reason?: string;
    pick?: string;
    runnerUpMarginDE76?: number;
  };
};

const HERE = path.join(process.cwd(), "tools/openclinxr/asset-pipeline/skin/families");
const REPORT_PATH = path.join(HERE, "chromophore-report.json");
const TONE = JSON.parse(readFileSync(path.join(HERE, "tone-report.json"), "utf8")) as {
  tone_anchors_Lab: { warm_light: Lab; warm_medium: Lab };
  families: Record<string, { forehead: Lab }>;
};
const REPORT = existsSync(REPORT_PATH)
  ? (JSON.parse(readFileSync(REPORT_PATH, "utf8")) as Report)
  : null;

const expectedKnownGood = new Map<string, Lab>([
  ["anchor:warm_light", TONE.tone_anchors_Lab.warm_light],
  ["anchor:warm_medium", TONE.tone_anchors_Lab.warm_medium],
  ["family:young:forehead", TONE.families.young!.forehead],
  ["family:middle:forehead", TONE.families.middle!.forehead],
  ["family:old:forehead", TONE.families.old!.forehead],
]);

// dE76: Euclidean CIELAB distance, the same definition tone-report.json and the
// nearest-family station use. Kept local: the freeze forbids a new cross-package
// relative import, and the station exports it only from a test file.
function dLab(a: readonly number[], b: readonly number[]): number {
  return Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);
}

function requireReport(): Report {
  expect(REPORT, "chromophore-report.json must exist").not.toBeNull();
  return REPORT!;
}

function expectLabClose(actual: number[], expected: number[], tolerance = 1e-6): void {
  expect(actual).toHaveLength(3);
  expect(expected).toHaveLength(3);
  for (let channel = 0; channel < 3; channel += 1) {
    expect(Math.abs(actual[channel]! - expected[channel]!)).toBeLessThanOrEqual(tolerance);
  }
}

function inRange(value: number, range: [number, number]): boolean {
  return value >= range[0] && value <= range[1];
}

// The derivation needs colour-science (DATA2, BSD-3-Clause), which the mise python lacks;
// uv supplies the pinned wheel. The script also fetches Prahl's Hb table (not vendorable).
function runDerivation(args: string[]): string {
  const result = spawnSync(
    "mise",
    [
      "exec",
      "--",
      "uv",
      "run",
      "-q",
      "--with",
      "colour-science==0.4.7",
      "--with",
      "numpy==2.2.6",
      "python",
      path.join(HERE, "derive_chromophore_lab.py"),
      ...args,
    ],
    { encoding: "utf8", timeout: 120_000 },
  );
  expect(result.status, result.stderr || result.stdout).toBe(0);
  return result.stdout;
}

function rederiveLab(row: TableRow): Lab {
  return JSON.parse(runDerivation(["--lab", String(row.Cm), String(row.betaM), String(row.Ch)])) as Lab;
}

function rowIsDerived(row: TableRow): boolean {
  return dLab(row.derivedLab, rederiveLab(row)) <= 1e-6;
}

describe("case skin_tone comes from a sourced chromophore table", () => {
  it("T1 records a closed decision, with a reason when inconclusive", () => {
    const report = requireReport();
    expect(["table", "falsified", "inconclusive"]).toContain(report.decision);
    if (report.decision === "inconclusive") expect(report.reason?.trim()).toBeTruthy();
  });

  it("T2 imports all five measured Lab points and re-derives every dE76", () => {
    const report = requireReport();
    expect(report.knownGood).toHaveLength(expectedKnownGood.size);
    for (const point of report.knownGood) {
      const measured = expectedKnownGood.get(point.id);
      expect(measured, `unexpected known-good id ${point.id}`).toBeDefined();
      expectLabClose(point.measuredLab, measured!);
      expect(dLab(point.measuredLab, point.derivedLab)).toBeCloseTo(point.dE76, 6);
    }
    expect(new Set(report.knownGood.map((point) => point.id))).toEqual(
      new Set(expectedKnownGood.keys()),
    );
  });

  it("T2b re-derives every known-good Cm and Lab from the model, not from the report", () => {
    const report = requireReport();
    const fresh = JSON.parse(
      runDerivation(["--calibrate", path.join(HERE, "tone-report.json")]),
    ) as { knownGood: KnownGood[] };
    const byId = new Map(fresh.knownGood.map((point) => [point.id, point]));
    for (const point of report.knownGood) {
      const again = byId.get(point.id);
      expect(again, `derivation did not emit ${point.id}`).toBeDefined();
      expect(Math.abs(again!.Cm - point.Cm)).toBeLessThanOrEqual(1e-9);
      expect(Math.abs(again!.betaM - point.betaM)).toBeLessThanOrEqual(1e-9);
      expect(Math.abs(again!.Ch - point.Ch)).toBeLessThanOrEqual(1e-9);
      expectLabClose(point.derivedLab, again!.derivedLab, 1e-6);
    }
  }, 180_000);

  it("T3 falsifies iff a miss exceeds half the measured inter-tone gap", () => {
    const report = requireReport();
    const halfInterToneGap =
      dLab(TONE.tone_anchors_Lab.warm_light, TONE.tone_anchors_Lab.warm_medium) / 2;
    const hasFlippingMiss = report.knownGood.some(
      (point) => dLab(point.measuredLab, point.derivedLab) > halfInterToneGap,
    );
    expect(report.decision === "falsified").toBe(hasFlippingMiss);
  });

  it("T4 CW1 re-derives table Lab; its measured-anchor substitution probe fails", () => {
    const report = requireReport();
    if (report.decision !== "table") {
      expect(report.tableRows).toEqual([]);
      return;
    }
    expect(execFileSync("sh", ["-c", "command -v mise"], { encoding: "utf8" }).trim()).toBeTruthy();
    for (const row of report.tableRows) expect(rowIsDerived(row), row.token).toBe(true);

    const row = report.tableRows.find((candidate) => candidate.token === "warm_medium")!;
    const before = rowIsDerived(row);
    const mutant = { ...row, derivedLab: TONE.tone_anchors_Lab.warm_medium };
    const after = rowIsDerived(mutant);
    console.log(`CW1 planted probe warm_medium: before=${before} after=${after}`);
    expect(dLab(row.derivedLab, mutant.derivedLab)).toBeGreaterThan(0);
    expect(before).toBe(true);
    expect(after).toBe(false);
  });

  it("T5 CW2 fixes one cited beta-m and Ch; a Ch perturbation probe fails", () => {
    const report = requireReport();
    if (report.decision !== "table") {
      expect(report.tableRows).toEqual([]);
      return;
    }
    expect(report.parameters.betaM.citation.trim()).toBeTruthy();
    expect(report.parameters.Ch.citation.trim()).toBeTruthy();
    const fixed = (rows: TableRow[]) =>
      rows.every(
        (row) =>
          row.betaM === report.parameters.betaM.value && row.Ch === report.parameters.Ch.value,
      );
    expect(fixed(report.tableRows)).toBe(true);
    const mutant = report.tableRows.map((row, index) =>
      index === 0 ? { ...row, Ch: row.Ch + 0.001 } : row,
    );
    console.log(`CW2 planted probe fixed before=true after=${fixed(mutant)}`);
    expect(fixed(mutant)).toBe(false);
  });

  it("T6 CW3 keeps every chromophore parameter inside its cited physiological range", () => {
    const report = requireReport();
    if (report.decision !== "table") {
      expect(report.tableRows).toEqual([]);
      return;
    }
    for (const row of report.tableRows) {
      expect(inRange(row.Cm, report.parameters.Cm.range), `${row.token}.Cm`).toBe(true);
      expect(inRange(row.betaM, report.parameters.betaM.range), `${row.token}.betaM`).toBe(true);
      expect(inRange(row.Ch, report.parameters.Ch.range), `${row.token}.Ch`).toBe(true);
    }
  });

  it("T7 resolves the authored warm_medium fixture or records the honest stop", () => {
    const report = requireReport();
    const patient = edChestPainScenario.actors.find(
      (actor) => actor.actorId === "patient_robert_hayes_v1",
    );
    expect(patient).toBeDefined();
    const token = patient!.phenotype!.skin_tone;
    expect(token).toBe("warm_medium");
    expect(report.endToEnd.token).toBe(token);

    if (report.decision !== "table") {
      expect(report.tableRows).toEqual([]);
      expect(report.endToEnd.caseDriven).toBe(false);
      expect(report.endToEnd.pick).toBeUndefined();
      expect(report.endToEnd.reason).toMatch(/no case can be driven/i);
      return;
    }
    const row = report.tableRows.find((candidate) => candidate.token === token)!;
    const ranked = Object.entries(TONE.families)
      .map(([id, family]) => ({ id, distance: dLab(row.derivedLab, family.forehead) }))
      .sort((left, right) => left.distance - right.distance);
    // Unreachable while decision=falsified. Nearest = min dE76, as selectNearestFamily.
    const pick = ranked[0]!.id;
    expect(report.endToEnd.caseDriven).toBe(true);
    expect(report.endToEnd.pick).toBe(pick);
    expect(report.endToEnd.runnerUpMarginDE76).toBeCloseTo(
      ranked[1]!.distance - ranked[0]!.distance,
      6,
    );
  });

  it("T8 passes the published in-vivo control RMS and both oxy-Hb Q-band minima", () => {
    const report = requireReport();
    const fresh = JSON.parse(runDerivation(["--control"])) as {
      values: Array<{ wavelengthNm: number; reflectance: number }>;
      modelReflectance: number[];
      rmsReflectanceError: number;
      populationSdRmsTolerance: number;
      controlQBandMinimaNm: number[];
      modelQBandMinimaNm: number[];
      controlLab: Lab;
      modelLab: Lab;
    };
    expect(report.control.tolerance.source.trim()).toBeTruthy();
    expect(fresh.values.map((value) => value.wavelengthNm)).toEqual(
      report.control.values.map((value) => value.wavelengthNm),
    );
    const rms = Math.sqrt(
      report.control.values.reduce((sum, value, index) => {
        const error = fresh.modelReflectance[index]! - value.reflectance;
        return sum + error * error;
      }, 0) / report.control.values.length,
    );
    expect(rms).toBeCloseTo(report.control.rmsReflectanceError, 9);
    expect(rms).toBeLessThanOrEqual(report.control.tolerance.value);
    expect(fresh.populationSdRmsTolerance).toBeCloseTo(report.control.tolerance.value, 9);
    expect(fresh.controlQBandMinimaNm).toEqual(report.control.qBandMinimaNm.control);
    expect(fresh.modelQBandMinimaNm).toEqual(report.control.qBandMinimaNm.model);
    for (const [index, center] of [542, 577].entries()) {
      expect(Math.abs(fresh.controlQBandMinimaNm[index]! - center)).toBeLessThanOrEqual(10);
      expect(Math.abs(fresh.modelQBandMinimaNm[index]! - center)).toBeLessThanOrEqual(10);
    }
    expectLabClose(fresh.controlLab, report.control.Lab.control);
    expectLabClose(fresh.modelLab, report.control.Lab.model);
    expect(dLab(fresh.controlLab, fresh.modelLab)).toBeCloseTo(report.control.Lab.dE76, 9);
  }, 180_000);

  it("T9 refuses a blood-blind model using a threshold computed from tone-report.json", () => {
    const report = requireReport();
    const measuredA = [...expectedKnownGood.values()].map((lab) => lab[1]);
    const threshold = Math.max(...measuredA) - Math.min(...measuredA);
    const low = JSON.parse(
      runDerivation(["--lab", String(report.counterweight.Cm), String(report.counterweight.betaM), "0.001"]),
    ) as Lab;
    const high = JSON.parse(
      runDerivation(["--lab", String(report.counterweight.Cm), String(report.counterweight.betaM), "0.1"]),
    ) as Lab;
    const delta = high[1] - low[1];
    expect(threshold).toBe(report.counterweight.threshold);
    expect(report.counterweight.thresholdSource).toMatch(/tone-report\.json/);
    expect(low[1]).toBeCloseTo(report.counterweight["aStarAtCh0.001"], 9);
    expect(high[1]).toBeCloseTo(report.counterweight["aStarAtCh0.1"], 9);
    expect(delta).toBeCloseTo(report.counterweight.deltaAStar, 9);
    expect(delta).toBeGreaterThanOrEqual(threshold);
  }, 180_000);

  it("T10 makes the closed decision exactly consistent with G1, G2, and G3", () => {
    const report = requireReport();
    const halfInterToneGap =
      dLab(TONE.tone_anchors_Lab.warm_light, TONE.tone_anchors_Lab.warm_medium) / 2;
    const measuredA = [...expectedKnownGood.values()].map((lab) => lab[1]);
    const bloodThreshold = Math.max(...measuredA) - Math.min(...measuredA);
    const g1 =
      report.control.rmsReflectanceError <= report.control.tolerance.value &&
      [542, 577].every(
        (center, index) =>
          Math.abs(report.control.qBandMinimaNm.control[index]! - center) <= 10 &&
          Math.abs(report.control.qBandMinimaNm.model[index]! - center) <= 10,
      );
    const g2 = report.counterweight.deltaAStar >= bloodThreshold;
    const g3Complete =
      report.knownGood.length === expectedKnownGood.size &&
      report.knownGood.every(
        (point) =>
          inRange(point.Cm, report.parameters.Cm.range) &&
          inRange(point.betaM, report.parameters.betaM.range) &&
          inRange(point.Ch, report.parameters.Ch.range),
      );
    const anyG3Miss = report.knownGood.some(
      (point) => dLab(point.measuredLab, point.derivedLab) > halfInterToneGap,
    );
    const expectedDecision = !g1 || !g2 || !g3Complete ? "inconclusive" : anyG3Miss ? "falsified" : "table";
    expect(report.control.pass).toBe(g1);
    expect(report.counterweight.pass).toBe(g2);
    expect(report.decision).toBe(expectedDecision);
  });
});
