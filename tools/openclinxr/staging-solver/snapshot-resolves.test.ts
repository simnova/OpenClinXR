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
  // Fever's only companion seat is inside 1.2 m of the nurse bedside anchor.
  it("peds_fever_v1 seated family with no chair 1.2 m from the nurse anchor names companion_chair", () => {
    const snapshot = loadSnapshot("peds_fever_v1");
    const result = searchClinicalLayouts(snapshot);
    expect(result.layouts).toEqual([]);
    expect(result.bindingConstraint).toContain("companion_chair");
    expect(result.bindingConstraint).not.toContain("companion_bedside");
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
