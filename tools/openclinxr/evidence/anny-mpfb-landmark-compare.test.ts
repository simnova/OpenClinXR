import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { COMPARISON_ARTIFACT_PATH } from "./anny-mpfb-landmark-compare.js";

/**
 * PLANTED CONTRACTS (#297). Three REDs + the artifact shape. All four flip.
 *
 * ════════════════════════════════════════════════════════════════════════════════
 * THE DEFECT, MEASURED (2026-08-10) — do not re-derive the numbers
 *
 * Naive horizontal-slab spans on the real Anny reference meshes:
 *
 *   | mesh                   | verts | stature | "chest" x | "waist" x | "hip" x |
 *   |------------------------|------:|--------:|----------:|----------:|--------:|
 *   | adult_male_street_casual | 13348 | 1.760 m | 0.779 | 1.078 | 0.352 |
 *   | ed_chest_pain_spouse_adult | 13348 | 1.660 m | 0.745 | 1.030 | 0.337 |
 *   | peds_patient_child      | 13718 | 1.250 m | 0.450 | 0.767 | 0.805 |
 *
 * Stature is reliable and cleanly separates the three. The girth columns are
 * CONTAMINATED BY THE ARMS — a 1.078 m "waist" on a 1.76 m man is the abducted arms
 * crossing the band, not a torso (the arms sit at |x| ≈ 0.5 m at waist height while
 * the torso spans only ~0.28 m). That is the defect this instrument avoids, and it is
 * why MADR 0051 §3 requires T-pose normalization and §4 asks for a torso slice rather
 * than a bounding span.
 *
 * MADR 0051 §5 bands (source stated, so no number is invented):
 *   - stature: ±1 cm of the phenotype's height_cm — fixed by the input
 *   - girths:  ±2 cm — ordinary between-observer tolerance for a tape measurement
 *   - BMI:     ±1.0 unit — from measured stature and an estimated volume
 *
 * ════════════════════════════════════════════════════════════════════════════════
 * WHAT THE CONTRACTS MUST PROVE (so a bounding span cannot pass)
 *
 * RED (1)          — the instrument separates known-different bodies: male vs child
 *                    differ in stature by > 0.4 m, and EVERY extracted landmark is
 *                    finite (no silent NaN from an empty band).
 * COUNTERWEIGHT (2) — measured waist girth WIDTH on adult_male_street_casual must be
 *                    < 0.50 m AND < its own shoulder span. The naive implementation
 *                    reports 1.078 m and fails both. This cannot be satisfied by any
 *                    bounding span at any threshold — it requires actually excluding
 *                    the arms. To make that airtight, the naive all-vertices slab at
 *                    the SAME waist band must also fail, so "move the band lower"
 *                    cannot be the mechanism that passes.
 * REGRESSION NET (3) — the two adult references, differing 0.10 m in stature, are
 *                    separated on stature AND on at least one girth by more than the
 *                    §5 ±2 cm measurement tolerance. An instrument that only measures
 *                    height passes (1) and fails this.
 *
 * claimScope: MADR 0051 step-4 landmark instrument over the seven tracked genuine
 *   .anny_base.obj references (all provenance records carry
 *   real_anny_mpfb2_forward_pass_v1 — read from the files, not assumed).
 * notEvidenceFor: the §6 solve loop / §7 tuning table (next slice); anthropometric or
 *   clinical validity; learner readiness; Quest readiness.
 *
 * The planted header is IMMUTABLE — append `## FIXED (#297)` below.
 *
 * ## FIXED (#297)
 *
 * The instrument landed in tools/openclinxr/evidence/anny-mpfb-landmark-compare.ts.
 * Measured on the three tracked genuine Anny references (provenance reads
 * real_anny_mpfb2_forward_pass_v1 from .provenance.json/.anny_manifest.json —
 * `annyPath: real_anny_forward_pass` recorded per MADR 0051's BLOCKER note):
 *
 *   | mesh | stature | shoulder | chest | waist | hip | waistWidth | naive slab |
 *   |------|--------:|---------:|------:|-----:|----:|-----------:|-----------:|
 *   | adult_male_street_casual | 1.760 | 0.634 | 0.843 | 0.735 | 0.926 | **0.279** | 0.950 |
 *   | ed_chest_pain_spouse_adult | 1.660 | 0.608 | 0.828 | 0.717 | 0.886 | 0.267 | 0.908 |
 *   | peds_patient_child | 1.250 | 0.554 | 0.669 | 0.600 | 0.695 | 0.215 | 0.726 |
 *
 * The counterweight waist width 0.279 m passes both clauses (< 0.50 m, < shoulder
 * span 0.634 m) while the naive slab at the SAME waist band fails both — the arms
 * really are excluded, not the band moved. Male↔child stature delta 0.510 m > 0.4 m.
 * Male↔spouse: stature 0.100 m and hip girth 0.041 m beyond the §5 ±2 cm tolerance.
 *
 * Unlocked decisions (named in the module and artifacts): girth = convex-hull
 * perimeter of the torso-only slice with arms excluded by lateral clustering
 * (union-find radius 0.05 m — no hardcoded x cutoff); T-pose = measured
 * pose-invariantly (the reference OBJ has no rig to pose); limbs = from the mesh
 * (no rig on the reference), knee split at the documented 0.285×stature fraction,
 * elbow at a mesh arm-width interior local minimum where one exists (adults) else a
 * documented 0.55 fraction (child's arm is a monotone taper). All band windows,
 * sources and methods are recorded in the artifacts under
 * .openclinxr/evidence/issue-297/.
 *
 * NOT TESTED (next slice): the MPFB solve loop (MADR 0051 §6) and the tuning table
 * (§7). No anthropometric/clinical validity claim: this is a comparison instrument.
 */

const FINITE_LANDMARKS = [
  "statureMeters",
  "shoulderSpanMeters",
  "chestGirthMeters",
  "waistGirthMeters",
  "hipGirthMeters",
  "waistGirthWidthMeters",
  "naiveWaistSlabWidthMeters",
  "headHeightMeters",
  "thighLengthMeters",
  "shinLengthMeters",
  "upperArmLengthMeters",
  "forearmLengthMeters",
  "totalLegLengthMeters",
  "totalArmLengthMeters",
] as const;

const load = () =>
  import("./anny-mpfb-landmark-compare.js") as Promise<Record<string, unknown>>;

type LandmarkSet = {
  meshId: string;
  annyPath: string;
  statureMeters: number;
  shoulderSpanMeters: number;
  chestGirthMeters: number;
  waistGirthMeters: number;
  hipGirthMeters: number;
  waistGirthWidthMeters: number;
  naiveWaistSlabWidthMeters: number;
  [k: string]: unknown;
};

type ComparisonReport = {
  bodies: LandmarkSet[];
  comparisons: Array<{
    pair: [string, string];
    rows: Array<{
      landmark: string;
      deltaMeters: number;
      bandMeters: number | null;
      bandSource: string | null;
      marginMeters: number | null;
    }>;
  }>;
  madr0051Bands: Array<{ landmark: string; bandMeters: number; source: string }>;
};

describe("MADR 0051 §4 landmark instrument (#297)", () => {
  it("RED (1): separates known-different bodies; every landmark finite", async () => {
    const mod = await load();
    const inspect = mod["inspectLandmarkComparison"] as
      | (() => Promise<ComparisonReport>)
      | undefined;
    expect(inspect, "inspectLandmarkComparison must be exported").toBeTypeOf("function");
    const report = await inspect!();

    const male = report.bodies.find((b) => b.meshId === "adult_male_street_casual");
    const child = report.bodies.find((b) => b.meshId === "peds_patient_child");
    expect(male, "adult_male_street_casual must be in the comparison").toBeDefined();
    expect(child, "peds_patient_child must be in the comparison").toBeDefined();

    expect(male!.statureMeters - child!.statureMeters).toBeGreaterThan(0.4);

    for (const b of report.bodies) {
      for (const k of FINITE_LANDMARKS) {
        expect(
          Number.isFinite(b[k] as number),
          `${b.meshId}.${k} must be finite — an empty band produced a NaN`,
        ).toBe(true);
      }
    }
    // provenance gate: the references are genuine Anny output, not the parametric stub
    for (const b of report.bodies) {
      expect(b.annyPath, `${b.meshId} must be a genuine Anny forward-pass reference`).toBe(
        "real_anny_forward_pass",
      );
    }
  });

  it("COUNTERWEIGHT (2): waist girth width < 0.50 m and < shoulder span — the naive slab fails both", async () => {
    const mod = await load();
    const inspect = mod["inspectLandmarkComparison"] as () => Promise<ComparisonReport>;
    const report = await inspect!();
    const male = report.bodies.find((b) => b.meshId === "adult_male_street_casual")!;

    expect(male.waistGirthWidthMeters).toBeLessThan(0.5);
    expect(male.waistGirthWidthMeters).toBeLessThan(male.shoulderSpanMeters);

    // Airtight: at the SAME waist band, the naive all-vertices slab must fail, so the
    // mechanism is arm exclusion, not moving the band somewhere the arms do not reach.
    expect(male.naiveWaistSlabWidthMeters).toBeGreaterThan(0.5);
    expect(male.naiveWaistSlabWidthMeters).toBeGreaterThan(male.shoulderSpanMeters);
  });

  it("REGRESSION NET (3): the two adults differ on stature AND on at least one girth", async () => {
    const mod = await load();
    const inspect = mod["inspectLandmarkComparison"] as () => Promise<ComparisonReport>;
    const report = await inspect!();
    const male = report.bodies.find((b) => b.meshId === "adult_male_street_casual")!;
    const spouse = report.bodies.find((b) => b.meshId === "ed_chest_pain_spouse_adult")!;

    // the two adults differ by 0.10 m in stature (issue body, measured)
    expect(Math.abs(male.statureMeters - spouse.statureMeters)).toBeGreaterThan(0.09);

    const girthDeltas = ["chestGirthMeters", "waistGirthMeters", "hipGirthMeters"].map(
      (g) => Math.abs((male[g] as number) - (spouse[g] as number)),
    );
    const maxGirthDelta = Math.max(...girthDeltas);
    // separated beyond the §5 ±2 cm between-observer tolerance — a height-only
    // instrument cannot satisfy this row
    expect(maxGirthDelta).toBeGreaterThan(0.02);
  });

  it("the comparison artifact carries the §5 bands, their source, and per-row margins", async () => {
    expect(
      existsSync(COMPARISON_ARTIFACT_PATH),
      `artifact missing: ${COMPARISON_ARTIFACT_PATH}`,
    ).toBe(true);
    const artifact = JSON.parse(
      readFileSync(COMPARISON_ARTIFACT_PATH, "utf8"),
    ) as ComparisonReport;

    const bandKeys = new Set(artifact.madr0051Bands.flatMap((b) => b.landmark.split("|")));
    expect(bandKeys.has("stature")).toBe(true);
    expect(artifact.madr0051Bands.length).toBeGreaterThanOrEqual(3);
    for (const b of artifact.madr0051Bands) {
      expect(b.source.length).toBeGreaterThan(10);
    }

    const male = artifact.bodies.find((b) => b.meshId === "adult_male_street_casual")!;
    const spouse = artifact.bodies.find((b) => b.meshId === "ed_chest_pain_spouse_adult")!;
    const pair = artifact.comparisons.find(
      (c) => c.pair[0] === male.meshId && c.pair[1] === spouse.meshId,
    );
    expect(pair, "male↔spouse comparison row must exist").toBeDefined();

    for (const row of pair!.rows) {
      expect(row.bandSource, `${row.landmark}: band must state its source`).toBeTruthy();
      if (row.bandMeters !== null) {
        expect(row.marginMeters, `${row.landmark}: banded row must carry a margin`).not.toBeNull();
      }
    }
  }, 600_000);
});
