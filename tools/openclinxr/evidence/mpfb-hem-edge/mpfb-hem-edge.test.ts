import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Validation companion for the issue #355 pre-fix measurement (mpfb-hem-edge/measure.ts).
 *
 * The artifact is `.openclinxr/evidence/mpfb-hem-edge/pre-fix.json` (gitignored, force-added at
 * land). This test makes the `exists:` contract proof machine-checkable: the file must exist and
 * carry a non-vacuous, well-formed measurement for all three MPFB actors.
 *
 * The artifact is GENERATED, not asserted for correctness of the flip-rate numbers — this validates
 * shape and completeness so a later reader can trust the file was produced by the measurement and
 * covers every actor and boundary the issue names.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../../..");
const ARTIFACT = join(REPO_ROOT, ".openclinxr/evidence/mpfb-hem-edge/pre-fix.json");

type Boundary = {
  band?: [number, number];
  bandedFlipRate: number | null;
  bandedSteps: number;
  perLoop?: { flipRate: number; medianStepMm: number; zigzagP2pMm: number; spanMm: number }[];
  note?: string;
};
type Actor = {
  file: string;
  figureHeightM: number;
  boundaries: Record<string, Boundary>;
  knownGood: Record<string, { flipRate?: number; note?: string }>;
};

function load(): { actors: Actor[]; mmPerPx: number } {
  const raw = readFileSync(ARTIFACT, "utf8");
  const parsed = JSON.parse(raw) as { actors?: Actor[]; mmPerPx?: number };
  return { actors: parsed.actors ?? [], mmPerPx: parsed.mmPerPx ?? 0 };
}

describe("issue-355 pre-fix measurement artifact", () => {
  it("exists and parses", () => {
    expect(existsSync(ARTIFACT), `${ARTIFACT} missing — run mpfb-hem-edge/measure.ts`).toBe(true);
    const { actors, mmPerPx } = load();
    expect(mmPerPx).toBeCloseTo(1.53, 2);
    expect(actors.length).toBeGreaterThanOrEqual(3);
  });

  it("covers all three MPFB actors", () => {
    const { actors } = load();
    const files = actors.map((a) => a.file);
    for (const f of ["mpfb-ob-patient-aisha.glb", "mpfb-peds-nurse-kevin.glb", "mpfb-peds-patient-child.glb"]) {
      expect(files, `actor ${f} missing from the artifact`).toContain(f);
    }
  });

  it("has a flip-rate measurement at the shirt hem for every actor (non-vacuous)", () => {
    const { actors } = load();
    for (const a of actors) {
      const hem = a.boundaries.shirt_hem;
      expect(hem, `${a.file}: shirt_hem boundary missing`).toBeDefined();
      expect(hem.bandedSteps, `${a.file}: shirt_hem frontier has no steps — the measurement is empty`).toBeGreaterThan(20);
      expect(hem.bandedFlipRate, `${a.file}: shirt_hem banded flip rate missing`).not.toBeNull();
      expect(hem.bandedFlipRate!).toBeGreaterThanOrEqual(0);
      expect(hem.bandedFlipRate!).toBeLessThanOrEqual(1);
      expect(hem.perLoop?.length ?? 0, `${a.file}: shirt_hem has no frontier loops`).toBeGreaterThan(0);
    }
  });

  it("has the garment-rim known-good for the shirt hem on every actor", () => {
    const { actors } = load();
    for (const a of actors) {
      const kg = a.knownGood.shirt_hem_rim;
      expect(kg, `${a.file}: shirt_hem_rim known-good missing`).toBeDefined();
      expect(kg.flipRate, `${a.file}: shirt_hem_rim flip rate missing`).toBeDefined();
      expect(kg.flipRate!).toBeGreaterThanOrEqual(0);
      expect(kg.flipRate!).toBeLessThanOrEqual(1);
    }
  });

  it("records every boundary (a missing trouser-cuff frontier is a recorded null, not an omission)", () => {
    const { actors } = load();
    for (const a of actors) {
      for (const b of ["shirt_hem", "trouser_cuff", "boot_top"]) {
        expect(a.boundaries[b], `${a.file}: boundary ${b} missing`).toBeDefined();
      }
      for (const g of ["shirt_hem_rim", "trouser_cuff_rim", "boot_top_rim"]) {
        expect(a.knownGood[g], `${a.file}: known-good ${g} missing`).toBeDefined();
      }
    }
  });

  it("amplitude fields are present and sane (mm and px at the 1.53 mm/px framing)", () => {
    const { actors, mmPerPx } = load();
    for (const a of actors) {
      for (const [bn, b] of Object.entries(a.boundaries)) {
        for (const l of b.perLoop ?? []) {
          expect(l.flipRate, `${a.file} ${bn}: flipRate out of range`).toBeGreaterThanOrEqual(0);
          expect(l.flipRate).toBeLessThanOrEqual(1);
          expect(l.medianStepMm, `${a.file} ${bn}: medianStepMm missing`).toBeGreaterThanOrEqual(0);
          expect(l.zigzagP2pMm, `${a.file} ${bn}: zigzagP2pMm missing`).toBeGreaterThanOrEqual(0);
          expect(l.spanMm).toBeGreaterThanOrEqual(0);
          expect(l.zigzagP2pMm / mmPerPx, `${a.file} ${bn}: px conversion`).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });
});
