import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { searchClinicalLayouts } from "./layout-search.js";
import type { CachedSceneSnapshot } from "./staging-types.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "../../..");

function loadSnapshot(scenarioId: string): CachedSceneSnapshot {
  const raw = readFileSync(join(REPO_ROOT, ".openclinxr/staging-solver", scenarioId, "scene-snapshot.json"), "utf8");
  return JSON.parse(raw) as CachedSceneSnapshot;
}

function intersects(a: CachedSceneSnapshot extends never ? never : { min: [number, number, number]; max: [number, number, number] }, b: { min: [number, number, number]; max: [number, number, number] }, pad = 0): boolean {
  return a.min[0] < b.max[0] + pad && a.max[0] > b.min[0] - pad
    && a.min[1] < b.max[1] && a.max[1] > b.min[1]
    && a.min[2] < b.max[2] + pad && a.max[2] > b.min[2] - pad;
}

describe("cached snapshot layouts resolve", () => {
  // First interior cell (0.25 m, x then z) that is 1.2 m from nurse_bedside_head and clears crown/chest.
  it("peds_fever_v1 seated family keeps the first companion_chair cell", () => {
    const snapshot = loadSnapshot("peds_fever_v1");
    const result = searchClinicalLayouts(snapshot);
    expect(result.bindingConstraint).toBeUndefined();
    const parent = result.layouts[0]?.find((row) => row.actorId === "parent_mei_chen_v1");
    expect(parent?.slotId).toBe("companion_chair");
    expect(parent?.standing).toBe(false);
    expect(parent?.placement.supportSurface).toBe("chair");
    expect(parent?.world?.[0]).toBeCloseTo(-2.859999895095825, 6);
    expect(parent?.world?.[1]).toBeCloseTo(0.6715784359757551, 6);
    expect(parent?.world?.[2]).toBeCloseTo(-3.2949732780456547, 6);
    expect(parent?.placement.plantOffsetMeters.x).toBeCloseTo(-3.760690879556652, 6);
    expect(parent?.placement.plantOffsetMeters.y).toBe(0);
    expect(parent?.placement.plantOffsetMeters.z).toBeCloseTo(-2.809195120127517, 6);
    expect(parent?.placement.headingRadians).toBeCloseTo(-0.5907649108840785, 6);
    expect(parent?.slotId).not.toBe("companion_bedside");
  });

  for (const scenarioId of ["adult_abdominal_pain_v1"]) {
    it(`${scenarioId} returns a legal layout`, () => {
      const snapshot = loadSnapshot(scenarioId);
      const result = searchClinicalLayouts(snapshot);
      expect(result.layouts.length).toBeGreaterThan(0);
      const first = result.layouts[0];
      expect(first).toBeDefined();
      if (!first) return;
      const support = [...snapshot.patientSupports].sort(
        (a, b) => (b.box.max[0] - b.box.min[0]) * (b.box.max[2] - b.box.min[2])
          - (a.box.max[0] - a.box.min[0]) * (a.box.max[2] - a.box.min[2]),
      )[0];
      expect(support).toBeDefined();
      for (let i = 0; i < first.length; i += 1) {
        for (let j = i + 1; j < first.length; j += 1) {
          const a = first[i]?.box, b = first[j]?.box;
          if (!a || !b) continue;
          const aPatient = first[i]?.slotId === "patient_on_authored_support";
          const bPatient = first[j]?.slotId === "patient_on_authored_support";
          if (aPatient || bPatient) continue;
          expect(intersects(a, b, 0.02)).toBe(false);
        }
        const row = first[i];
        if (!row || row.slotId === "patient_on_authored_support" || !support) continue;
        expect(intersects(row.box, support.box, 0.03)).toBe(false);
      }
    });
  }
});
