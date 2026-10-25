/**
 * Phase-2 report builder + verifiers (card tsk_0e618fa5e9ac3e15 STEP 6).
 *
 * Definitions (recorded verbatim in the report):
 * - largest mover = region with the largest dE / threshold.dE across both views;
 * - margin = (that region's dE) - threshold.dE;
 * - required margin / threshold.dE >= 1.
 *
 * Numbers are copied from the check.json / metrics JSON files by code, never
 * by hand. The tracked-report test verifies the recorded largestMover and
 * margin by recomputing them from the recorded per-region numbers, so a
 * hand-edited report fails.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { thresholdsFromCalibration, type Calibration } from "./thresholds.js";
import { sha256File } from "./render.js";

export const LARGEST_MOVER_DEFINITION =
  "largest mover = region with the largest dE / threshold.dE across both views";
export const MARGIN_DEFINITION = "margin = (that region's dE) - threshold.dE";
export const MARGIN_REQUIREMENT = "required margin / threshold.dE >= 1";

/**
 * The arms the phase-2 report must carry. Known-bad A is the stale pink-eyes
 * GLB: it moves an eye. Known-bad B is the real double-brow regression
 * (body2 run2, sha prefix below): it moves a brow by >= its threshold. A plant
 * that renders identically to the seed is NOT a known bad and is recorded
 * instead under `measuredNulls`.
 */
export const KNOWN_BAD_A_REGIONS = ["eye_L", "eye_R"] as const;
export const KNOWN_BAD_B_REGIONS = ["brow_L", "brow_R"] as const;
export const KNOWN_BAD_B_PLANT_SHA_PREFIX = "643563fc";
export const MEASURED_NULL_CLAIM = "aisha run2 plant is a double-brow regression";
export const MEASURED_NULL_RESULT = "renders byte-identical to the seed; every region dE 0.000";
export const MEASURED_NULL_CAUSE = "same brow mesh as aisha run4 (mindfront_eyebrows_05)";

export type RegionReading = { region: string; view: number; dE: number; threshold: number };

export type LargestMover = {
  region: string;
  view: number;
  dE: number;
  threshold: number;
  ratio: number;
  margin: number;
  marginOverThreshold: number;
};

export function recomputeLargestMover(readings: RegionReading[]): LargestMover {
  if (readings.length === 0) throw new Error("face-regression report: no region readings to rank");
  let best = readings[0]!;
  let bestRatio = best.dE / best.threshold;
  for (const r of readings.slice(1)) {
    const ratio = r.dE / r.threshold;
    if (ratio > bestRatio) {
      best = r;
      bestRatio = ratio;
    }
  }
  const margin = best.dE - best.threshold;
  return {
    region: best.region,
    view: best.view,
    dE: best.dE,
    threshold: best.threshold,
    ratio: bestRatio,
    margin,
    marginOverThreshold: margin / best.threshold,
  };
}

export function rawDERanking(readings: RegionReading[]): string[] {
  const maxByRegion = new Map<string, number>();
  for (const r of readings) maxByRegion.set(r.region, Math.max(maxByRegion.get(r.region) ?? -Infinity, r.dE));
  return [...maxByRegion.entries()].sort((a, b) => b[1] - a[1]).map(([region]) => region);
}

type MetricsFile = {
  metrics: Array<{ region: string; dE: number; ssimL: number; landmarkDispPx: number; pixels: number }>;
};

type CheckFile = {
  ok: boolean;
  cases: Array<{ caseId: string; status: string; views: Array<{ view: number; ok: boolean; failed: string[] }> }>;
};

function readingsForLabel(labelDir: string, thresholds: Record<string, number>): RegionReading[] {
  const out: RegionReading[] = [];
  for (const name of readdirSync(labelDir)) {
    const m = /^metrics-(.+)-(\d+)\.json$/.exec(name);
    if (!m) continue;
    const view = Number(m[2]);
    const file = JSON.parse(readFileSync(join(labelDir, name), "utf8")) as MetricsFile;
    for (const row of file.metrics) {
      const threshold = thresholds[row.region];
      if (threshold === undefined) throw new Error(`face-regression report: no threshold for region ${row.region}`);
      out.push({ region: row.region, view, dE: row.dE, threshold });
    }
  }
  out.sort((a, b) => a.view - b.view || (a.region < b.region ? -1 : 1));
  return out;
}

function renderPngs(renderSummaryPath: string): {
  cases: Array<{ caseId: string; runId: string; views: Array<{ yaw: number; png: string; sha256: string }> }>;
} {
  const summary = JSON.parse(readFileSync(renderSummaryPath, "utf8")) as {
    cases: Array<{ caseId: string; renderDir: string }>;
  };
  return {
    cases: summary.cases.map((c) => {
      const rj = JSON.parse(readFileSync(join(c.renderDir, "render.json"), "utf8")) as {
        runId?: string;
        views?: Array<{ yaw: number; png: string; sha256: string }>;
      };
      return {
        caseId: c.caseId,
        runId: rj.runId ?? "",
        views: (rj.views ?? []).map((v) => ({ yaw: v.yaw, png: v.png, sha256: v.sha256 })),
      };
    }),
  };
}

type MeasuredArm = {
  claim?: string;
  plant?: { glb?: string; sha256?: string };
  regions?: RegionReading[];
  largestMover?: LargestMover;
  ok?: boolean;
};

export function verifyPhase2Report(report: Record<string, unknown>, calibration: Calibration): string[] {
  const violations: string[] = [];
  const phase2 = (report.phase2 ?? {}) as Record<string, unknown>;
  // Thresholds recompute from calibration.json and equal the report's.
  const recomputed = thresholdsFromCalibration(calibration);
  const recorded = ((phase2.thresholds ?? {}) as Record<string, { maxDE: number; minSsimL: number }>);
  for (const [region, t] of Object.entries(recomputed)) {
    const rec = recorded[region];
    if (!rec || rec.maxDE !== t.maxDE || rec.minSsimL !== t.minSsimL) {
      violations.push(`threshold mismatch for ${region}: recorded ${JSON.stringify(rec)} != recomputed ${JSON.stringify(t)}`);
    }
  }
  // Largest mover + margin recompute from the recorded per-region numbers.
  const recomputeArm = (key: string, arm: MeasuredArm | undefined): void => {
    if (!arm || !arm.regions || !arm.largestMover) {
      violations.push(`${key}: missing regions or largestMover`);
      return;
    }
    const again = recomputeLargestMover(arm.regions);
    const rec = arm.largestMover;
    for (const k of ["region", "view", "dE", "threshold", "margin", "marginOverThreshold"] as const) {
      if (rec[k] !== again[k]) {
        violations.push(`${key}: largestMover.${k} recorded ${JSON.stringify(rec[k])} != recomputed ${JSON.stringify(again[k])}`);
      }
    }
  };
  recomputeArm("knownBadA", phase2.knownBadA as MeasuredArm);
  recomputeArm("knownBadB", phase2.knownBadB as MeasuredArm);

  // Known-good must pass; the known-bad arms must fail on their named region
  // with margin / threshold >= 1.
  if ((phase2.knownGood as { ok?: boolean } | undefined)?.ok !== true) {
    violations.push("knownGood: ok must be true");
  }
  const expectedRegions: Record<string, readonly string[]> = {
    knownBadA: KNOWN_BAD_A_REGIONS,
    knownBadB: KNOWN_BAD_B_REGIONS,
  };
  for (const key of ["knownBadA", "knownBadB"] as const) {
    const arm = phase2[key] as MeasuredArm | undefined;
    if (!arm) {
      violations.push(`${key}: missing`);
      continue;
    }
    if (arm.ok !== false) violations.push(`${key}: ok must be false (a known bad must fail)`);
    const region = arm.largestMover?.region;
    if (!region || !expectedRegions[key]!.includes(region)) {
      violations.push(`${key}: largestMover.region ${JSON.stringify(region)} is not in [${expectedRegions[key]!.join(", ")}]`);
    }
    const ratio = arm.largestMover?.marginOverThreshold;
    if (!(typeof ratio === "number" && ratio >= 1)) {
      violations.push(`${key}: marginOverThreshold ${JSON.stringify(ratio)} must be >= 1`);
    }
  }
  const badB = phase2.knownBadB as MeasuredArm | undefined;
  if (badB && !String(badB.plant?.sha256 ?? "").startsWith(KNOWN_BAD_B_PLANT_SHA_PREFIX)) {
    violations.push(`knownBadB: plant sha256 ${JSON.stringify(badB.plant?.sha256)} must start ${KNOWN_BAD_B_PLANT_SHA_PREFIX}`);
  }

  // A plant that renders identically to the seed is a measured null, never a
  // known bad: it must be recorded as ok (or with margin/threshold < 1) and
  // carry the aisha claim the old known-bad-B arm mis-stated.
  const nulls = phase2.measuredNulls;
  if (!Array.isArray(nulls) || nulls.length === 0) {
    violations.push("measuredNulls: missing");
  } else {
    let sawAisha = false;
    for (const entry of nulls as MeasuredArm[]) {
      const label = `measuredNulls[${String(entry?.claim)}]`;
      recomputeArm(label, entry);
      const ratio = entry?.largestMover?.marginOverThreshold;
      if (!(typeof ratio === "number" && ratio < 1) && entry?.ok !== true) {
        violations.push(`${label}: neither ok nor marginOverThreshold < 1 (a measured null must not be recorded as a failure)`);
      }
      if (typeof entry?.claim === "string" && /aisha/.test(entry.claim)) sawAisha = true;
    }
    if (!sawAisha) violations.push("measuredNulls: expected the aisha entry");
  }
  return violations;
}

type Args = Record<string, string | boolean>;

function parseFlags(argv: string[]): Args {
  const out: Args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]!;
    if (!a.startsWith("--")) throw new Error(`face-regression report: unexpected arg ${a}`);
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) { out[key] = next; i += 1; } else out[key] = true;
  }
  return out;
}

function buildReport(argv: string[]): number {
  const flags = parseFlags(argv);
  const need = [
    "base", "out", "calibration", "seed",
    "known-good", "known-bad-a", "known-bad-b", "plant-a", "plant-b",
    "measured-null-dir", "measured-null-glb",
  ] as const;
  for (const k of need) {
    if (!flags[k]) throw new Error(`face-regression report: --${k} is required`);
  }
  const str = (k: string): string => resolve(process.cwd(), String(flags[k]));
  const base = JSON.parse(readFileSync(str("base"), "utf8")) as Record<string, unknown>;
  const calibration = JSON.parse(readFileSync(str("calibration"), "utf8")) as Calibration;
  const thresholds = thresholdsFromCalibration(calibration);
  const maxDE: Record<string, number> = Object.fromEntries(Object.entries(thresholds).map(([r, t]) => [r, t.maxDE]));

  const seed = renderPngs(join(str("seed"), "render.json"));
  const goodDir = str("known-good");
  const badADir = str("known-bad-a");
  const badBDir = str("known-bad-b");
  const goodCheck = JSON.parse(readFileSync(join(goodDir, "check.json"), "utf8")) as CheckFile;
  const badACheck = JSON.parse(readFileSync(join(badADir, "check.json"), "utf8")) as CheckFile;
  const badBCheck = JSON.parse(readFileSync(join(badBDir, "check.json"), "utf8")) as CheckFile;
  const failedOf = (c: CheckFile): string[] => c.cases.flatMap((r) => r.views.filter((v) => !v.ok).flatMap((v) => v.failed));

  const arm = (labelDir: string, check: CheckFile, plantGlb: string) => {
    const regions = readingsForLabel(labelDir, maxDE);
    const largestMover = recomputeLargestMover(regions);
    return {
      checkJson: join(labelDir, "check.json"),
      plant: { glb: plantGlb, sha256: sha256File(plantGlb) },
      ok: check.ok,
      failedRegions: [...new Set(failedOf(check))],
      regions,
      rawRanking: rawDERanking(regions),
      largestMover,
      definitions: [LARGEST_MOVER_DEFINITION, MARGIN_DEFINITION, MARGIN_REQUIREMENT],
    };
  };

  const goodRegions = readingsForLabel(goodDir, maxDE);
  const nullDir = str("measured-null-dir");
  const nullCheck = JSON.parse(readFileSync(join(nullDir, "check.json"), "utf8")) as CheckFile;
  const nullRegions = readingsForLabel(nullDir, maxDE);
  const measuredNulls = [
    {
      claim: MEASURED_NULL_CLAIM,
      plant: { glb: str("measured-null-glb"), sha256: sha256File(str("measured-null-glb")) },
      result: MEASURED_NULL_RESULT,
      cause: MEASURED_NULL_CAUSE,
      checkJson: join(nullDir, "check.json"),
      ok: nullCheck.ok,
      failedRegions: [...new Set(failedOf(nullCheck))],
      regions: nullRegions,
      rawRanking: rawDERanking(nullRegions),
      largestMover: recomputeLargestMover(nullRegions),
    },
  ];
  const notes: string[] = [];
  if (typeof flags.note === "string" && flags.note.length > 0) notes.push(String(flags.note));
  const phase2 = {
    notes,
    seed: { renderSummary: join(str("seed"), "render.json"), cases: seed.cases },
    calibration: {
      status: calibration.status,
      seed: calibration.seed,
      perturbation: calibration.perturbation,
      regions: calibration.regions,
    },
    thresholds: Object.fromEntries(Object.entries(thresholds).map(([r, t]) => [r, { maxDE: t.maxDE, minSsimL: t.minSsimL }])),
    knownGood: {
      checkJson: join(goodDir, "check.json"),
      ok: goodCheck.ok,
      regions: goodRegions,
    },
    knownBadA: arm(badADir, badACheck, str("plant-a")),
    knownBadB: arm(badBDir, badBCheck, str("plant-b")),
    measuredNulls,
  };
  const violations = verifyPhase2Report({ ...base, phase2 }, calibration);
  if (violations.length > 0) throw new Error(`face-regression report: self-check failed:\n${violations.join("\n")}`);
  const { phase_2_outstanding: _superseded, ...rest } = base as Record<string, unknown> & { phase_2_outstanding?: unknown };
  void _superseded;
  const out = { ...rest, phase: 2, status: "calibrated-with-known-bads", phase2 };
  writeFileSync(str("out"), `${JSON.stringify(out, null, 2)}\n`, "utf8");
  console.log(str("out"));
  return 0;
}

const invokedDirectly = process.argv[1]?.endsWith("report.ts") ?? false;
if (invokedDirectly) {
  try {
    process.exitCode = buildReport(process.argv.slice(2));
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }
}
