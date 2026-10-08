import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { actorCrownChestVisibleEarly } from "../evidence/station-capture/gate-geometry.js";
import { evaluateLayoutCamera, solveLayouts } from "./camera-search.js";
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

function movedActorBox(actor: CachedSceneSnapshot["actors"][number], x: number, z: number) {
  const dx = x - (actor.box.min[0] + actor.box.max[0]) / 2;
  const dz = z - (actor.box.min[2] + actor.box.max[2]) / 2;
  return {
    min: [actor.box.min[0] + dx, actor.box.min[1], actor.box.min[2] + dz] as [number, number, number],
    max: [actor.box.max[0] + dx, actor.box.max[1], actor.box.max[2] + dz] as [number, number, number],
  };
}

describe("cached snapshot layouts resolve", () => {
  it("peds_fever_v1 seated family resolves companion_chair", () => {
    const snapshot = loadSnapshot("peds_fever_v1");
    const result = searchClinicalLayouts(snapshot);
    expect(result.bindingConstraint).toBeUndefined();
    expect(result.layouts.length).toBeGreaterThan(0);
    expect(result.learnerStance?.slotId).toBe("physician_bedside");
    expect(result.learnerStance?.world[1]).toBe(1.7);
    const parent = snapshot.actors.find((row) => row.id === "parent_mei_chen_v1");
    expect(parent?.standing).toBe(false);
    expect(parent?.currentPlacement.supportSurface).toBe("chair");
    const first = result.layouts[0];
    expect(first).toBeDefined();
    if (!first) return;
    const parentRow = first.find((row) => row.actorId === "parent_mei_chen_v1");
    expect(parentRow?.slotId).toBe("companion_chair");
  });

  it("scores the exact pediatric layout that it returns for persistence", () => {
    const snapshot = loadSnapshot("peds_fever_v1");
    const candidates = searchClinicalLayouts(snapshot);
    const solution = solveLayouts(snapshot, candidates.layouts);
    expect(solution).not.toBeNull();
    if (!solution) return;
    expect(evaluateLayoutCamera(snapshot, solution.layout, solution.camera)).toEqual(solution.gate);
  }, 15_000);

  for (const scenarioId of ["adult_abdominal_pain_v1"]) {
    it(`${scenarioId} returns a legal layout`, () => {
      const snapshot = loadSnapshot(scenarioId);
      const result = searchClinicalLayouts(snapshot);
      expect(result.bindingConstraint).toBeUndefined();
      expect(result.layouts.length).toBeGreaterThan(0);
      const stance = result.learnerStance;
      expect(stance?.slotId).toBe("physician_bedside");
      expect(stance?.world[1]).toBe(1.7);
      const first = result.layouts[0];
      expect(first).toBeDefined();
      if (!first || !stance) return;
      const patient = snapshot.actors.find((row) => row.role === "patient") ?? snapshot.actors[0];
      expect(patient).toBeDefined();
      if (!patient) return;
      const occluders = [];
      for (const row of first) {
        if (row.actorId === patient.id) continue;
        const actor = snapshot.actors.find((item) => item.id === row.actorId);
        if (!actor) continue;
        if (actor.role !== "physician") {
          expect(Math.hypot(stance.world[0] - row.world[0], stance.world[2] - row.world[2])).toBeGreaterThanOrEqual(0.45);
        }
        occluders.push({ actorId: actor.id, name: actor.id, box: movedActorBox(actor, row.world[0], row.world[2]) });
      }
      for (const occluder of snapshot.occluders) {
        if (/review-panel|review_panel/i.test(occluder.name)) occluders.push(occluder);
      }
      expect(actorCrownChestVisibleEarly(stance.world, { id: patient.id, box: patient.box, recumbent: patient.recumbent }, occluders)).toBe(true);
      expect(stance.world[0]).toBeGreaterThanOrEqual(snapshot.interior.min[0] + 0.08);
      expect(stance.world[0]).toBeLessThanOrEqual(snapshot.interior.max[0] - 0.08);
      expect(stance.world[2]).toBeGreaterThanOrEqual(snapshot.interior.min[2] + 0.08);
      expect(stance.world[2]).toBeLessThanOrEqual(snapshot.interior.max[2] - 0.08);
      for (const fixture of snapshot.fixtures) {
        if (fixture.kind !== "door") continue;
        const inside = stance.world[0] >= fixture.box.min[0] && stance.world[0] <= fixture.box.max[0]
          && stance.world[2] >= fixture.box.min[2] && stance.world[2] <= fixture.box.max[2];
        expect(inside).toBe(false);
      }
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
