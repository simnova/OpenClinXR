import {
  createEdChestPainLocalLearnerRuntimeAssetBundle,
  resolveScenarioActorCast,
} from "@openclinxr/asset-registry/runtime-bundles";
import { describe, expect, it } from "vitest";
import {
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

  it("(2) the ward physician is STAGED — it used to be dropped, then reported, now staged", () => {
    // History, because the assertion inverted twice in one session and the reason matters. The
    // cast declared four actors and the bundle staged three: the clinical slot took the nurse by
    // role order and the physician disappeared with no record, so a learner met a ward nurse where
    // the case wrote a senior resident. It was first made REPORTABLE, then given the fourth slot
    // RUNTIME_SLOT_KINDS always had.
    const cast = resolveScenarioActorCast("ward_delirium_med_rec_v1");
    expect(cast.find((entry) => entry.role === "physician")?.actorId).toBe("senior_resident_ward_v1");

    const bundle = createEdChestPainLocalLearnerRuntimeAssetBundle({
      scenarioId: "ward_delirium_med_rec_v1",
    });
    expect(bundle.actors.map((actor) => actor.actorId)).toContain("senior_resident_ward_v1");
    // Staged AS a physician, not relabelled. Substituting the role would satisfy a presence check
    // while losing exactly what the brief asks to preserve.
    expect(
      bundle.actors.find((actor) => actor.actorId === "senior_resident_ward_v1")?.role,
    ).toBe("physician");
    // And the nurse keeps her own slot: the physician did not displace her.
    expect(bundle.actors.map((actor) => actor.actorId)).toContain("ward_nurse_patel_v1");
    expect(unstagedCastActors(cast)).toEqual([]);
  });

  it("(3) COUNTERWEIGHT: a fully staged cast reports NOTHING, so the report is not a constant", () => {
    // ED casts exactly the three roles the bundle stages. A report that named actors here would
    // pass clause (1) and (2) while meaning nothing.
    const unstaged = unstagedCastActors(resolveScenarioActorCast("ed_chest_pain_priority_v2"));
    expect(unstaged).toEqual([]);
  });
});
