/**
 * tsk_fad7908c3fc42ef3: the shipped blink gap has a measured cause.
 *
 * WHY: compat-eyes 0af137017 rendered the SHIPPED Aisha at blink closure 1.0 +
 * slit 1.0 and dark gaps remain between the lids (control blink row of
 * gaze-blink-sheet.png); the realism bake closes fully. This test pins the
 * gap in pixels and checks each listed candidate with one measurement:
 * morph-target extent (GLB bytes), eye-mesh position (bind-local Z, both
 * meshes skinned to the same skeleton under identity nodes), and the runtime
 * weight clamp (executed here through the real applier, not read off the
 * source). All three measure non-causal, so the report names unknown with
 * the per-cause records — unknown is the allowed answer on this card.
 *
 * claimScope: gap pixel counts + per-candidate GLB/driver measurements on
 * these two bytes. notEvidenceFor: which occluder (lid skin vs globe) owns
 * the cavity — that is the globe-hidden take recommended in the report.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { applyBlinkClosureToRoot } from "@openclinxr/xr-dialogue/evidence-viseme";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPORT = JSON.parse(readFileSync(join(HERE, "closure-report.json"), "utf8")) as {
  gapPx: { shipped: { left: number; right: number; total: number }; realism: { left: number; right: number; total: number } };
  morphExtent: { shippedTravelMm: number; shippedApertureMm: number; realismTravelMm: number; realismApertureMm: number };
  globePosition: { shippedProtrusionMm: number; realismProtrusionMm: number };
  driver: { writtenAt1: number };
  lashCorrelate: { shippedLashTargets: number; realismLashTargets: number };
  cause: string;
};

/** Duck-typed MorphRootLike carrying the shipped dictionary shape. */
function syntheticRoot() {
  const mesh = {
    morphTargetDictionary: { "eye-left-closure": 0, "eye-right-closure": 1 },
    morphTargetInfluences: [0, 0],
  };
  return {
    mesh,
    root: {
      userData: {} as Record<string, unknown>,
      traverse: (cb: (o: unknown) => void) => {
        cb(mesh);
      },
    },
  };
}

describe("the shipped blink gap has a measured cause", () => {
  it("gap: shipped shows a solid cavity, realism is ~0", () => {
    expect(REPORT.gapPx.shipped.total).toBeGreaterThan(1000);
    expect(REPORT.gapPx.shipped.left).toBeGreaterThan(500);
    expect(REPORT.gapPx.shipped.right).toBeGreaterThan(500);
    expect(REPORT.gapPx.realism.total).toBeLessThanOrEqual(100);
  });

  it("morph extent does not move the gap (shipped spans, realism seals with less)", () => {
    const shippedRatio = REPORT.morphExtent.shippedTravelMm / REPORT.morphExtent.shippedApertureMm;
    const realismRatio = REPORT.morphExtent.realismTravelMm / REPORT.morphExtent.realismApertureMm;
    expect(shippedRatio).toBeGreaterThanOrEqual(1.0);
    expect(realismRatio).toBeLessThan(shippedRatio);
    expect(REPORT.gapPx.realism.total).toBeLessThan(REPORT.gapPx.shipped.total);
  });

  it("globe protrusion does not move the gap (realism protrudes more, still seals)", () => {
    expect(REPORT.globePosition.realismProtrusionMm).toBeGreaterThan(
      REPORT.globePosition.shippedProtrusionMm,
    );
    expect(REPORT.gapPx.realism.total).toBeLessThanOrEqual(100);
  });

  it("runtime driver writes full weight at closure 1.0 (no clamp)", () => {
    const { mesh, root } = syntheticRoot();
    const result = applyBlinkClosureToRoot(root, 1.0) as { influence: number; appliedTargetCount: number };
    expect(result.influence).toBe(1.0);
    expect(mesh.morphTargetInfluences[0]).toBe(1.0);
    expect(mesh.morphTargetInfluences[1]).toBe(1.0);
    expect(result.appliedTargetCount).toBe(2);
    expect(REPORT.driver.writtenAt1).toBe(1.0);
  });

  it("cause is unknown with every candidate recorded, lash difference noted", () => {
    expect(REPORT.cause).toBe("unknown");
    expect(REPORT.lashCorrelate.shippedLashTargets).toBe(0);
    expect(REPORT.lashCorrelate.realismLashTargets).toBe(6);
  });
});
