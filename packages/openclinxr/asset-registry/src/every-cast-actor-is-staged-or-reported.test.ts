import { describe, expect, it } from "vitest";
import {
  createEdChestPainLocalLearnerRuntimeAssetBundle,
  resolveScenarioActorCast,
  listShippedCastScenarioIds,
  unstagedCastActors,
} from "./index.js";

/**
 * Brief §7 step 3, first requirement: "Verify that fixed slot assignment stages the intended
 * physician ID; if omitted, report that outcome rather than substituting another clinical actor."
 *
 * The failure this guards is silence, not omission. The local bundle has three humanoid slots and
 * cannot stage a fourth actor; that is a known limit. What it must not do is drop a cast actor
 * with no record, which is what it did until this landed.
 */
describe("every cast actor is staged or reported", () => {
  it("(1) every shipped cast actor is either staged in the bundle or named in the unstaged report", () => {
    for (const scenarioId of listShippedCastScenarioIds()) {
      const cast = resolveScenarioActorCast(scenarioId);
      const bundle = createEdChestPainLocalLearnerRuntimeAssetBundle({ scenarioId });
      const stagedIds = new Set(bundle.actors.map((actor) => actor.actorId));
      const reportedIds = new Set(unstagedCastActors(cast).map((row) => row.actorId));
      for (const entry of cast) {
        expect(
          stagedIds.has(entry.actorId) || reportedIds.has(entry.actorId),
          `${scenarioId}: cast actor ${entry.actorId} (${entry.role}) is neither staged nor reported`,
        ).toBe(true);
      }
    }
  });

  it("(2) the ward physician is REPORTED, not silently substituted by the nurse", () => {
    // The one shipped case that casts a physician. It is measured here rather than described:
    // if this stops holding, either the physician gained a slot (good, update this) or the
    // report stopped naming it (the silence returning).
    const cast = resolveScenarioActorCast("ward_delirium_med_rec_v1");
    const physician = cast.find((entry) => entry.role === "physician");
    expect(physician?.actorId).toBe("senior_resident_ward_v1");

    const bundle = createEdChestPainLocalLearnerRuntimeAssetBundle({
      scenarioId: "ward_delirium_med_rec_v1",
    });
    expect(bundle.actors.map((actor) => actor.actorId)).not.toContain("senior_resident_ward_v1");

    const unstaged = unstagedCastActors(cast);
    const row = unstaged.find((entry) => entry.actorId === "senior_resident_ward_v1");
    expect(row, "the omitted physician must appear in the unstaged report").toBeDefined();
    expect(row?.role).toBe("physician");
    expect(row?.reason.length).toBeGreaterThan(0);
  });

  it("(3) COUNTERWEIGHT: a fully staged cast reports NOTHING, so the report is not a constant", () => {
    // ED casts exactly the three roles the bundle stages. A report that named actors here would
    // pass clause (1) and (2) while meaning nothing.
    const unstaged = unstagedCastActors(resolveScenarioActorCast("ed_chest_pain_priority_v2"));
    expect(unstaged).toEqual([]);
  });
});
