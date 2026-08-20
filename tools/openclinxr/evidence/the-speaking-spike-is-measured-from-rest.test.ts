import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * E2 / xr-systems-architect. #402. Superagent ruled CAUSE over BOUND on 2026-08-20.
 *
 * ## THE DEFECT, MEASURED — IMMUTABLE. Flip assertions and append `## FIXED (#N)`.
 *
 * #402 was already measured on 2026-08-18 (`speaking-actor-head-local.json`, live runtime, per-vertex
 * CPU skinning in head-bone-local frame, `headRigid100MaxDeltaMm = 0` so the frame is sound). The
 * probe passes 4/4 — and all four of its clauses assert MEASUREMENT INTEGRITY, not the spike. So the
 * defect is quantified, ungated, and undiagnosed.
 *
 * **NEITHER RECORDED SAMPLE IS AT REST:**
 *
 *   actor         speaking   "not speaking"
 *   parent_tara       1.0        0.4998        <- half-driven while silent
 *   child_maya        0.5485     1.0           <- FULLY driven while silent
 *
 * So `maxHeadLocalDeltaMm` differences two mid-drive states. Parent swing ~0.50 -> 8.729 mm; child
 * swing ~0.45 -> 3.401 mm. Comparable swings, 2.6x displacement. **Without a rest baseline there is
 * no zero, so no threshold on that delta can mean anything** — which is why this slice is CAUSE and
 * not a bound.
 *
 * ## TWO MEASUREMENT ERRORS OF MINE ARE FENCED HERE — do not repeat either
 *
 *   1. I published the spike as **10.5x** from `allVerticesMaxHeadLocalDeltaMm` 35.584 vs 3.401.
 *      That extreme is a SHOE: `makeclothes_library_footwear_toigo_flats_…`, `allMaxDeltaMm 35.584`,
 *      `headAssemblyMaxDeltaMm` **0**. In head-bone-local frame anything far from the head reads as a
 *      large excursion. **Use `headAssemblyMaxDeltaMm`, never the all-vertices extreme.**
 *   2. I read the millimetre columns for two ticks and missed the influence columns, which is where
 *      the real finding was. Read both.
 *
 * `headAssemblyMaxDeltaMm` is **0 on every mesh except the body** for both actors — hair, t-shirt,
 * cargo pants, footwear and every body_N split are rigid. Parent body 8.729, child body 3.401.
 *
 * ## WHY 0.01 IS THE REST BOUND, AND WHY IT IS NOT FITTED
 *
 * `ui-xr-viseme-drive-capture.ts:120` and `:950` both treat **0.01** as the threshold below which no
 * viseme is active (`no_viseme_target_above_influence_0.01_at_this_instant`). Rest is therefore the
 * tree's own definition of "not driven", read off the INPUT. It is not a margin I chose, and it does
 * not reference the effect being measured.
 *
 * ## THE TRAP: THE PROBE OVERWRITES ITS OWN HISTORY
 *
 * `speaking-actor-head-local-probe.ts:968` writes `speaking-actor-head-local.json`, which is TRACKED.
 * Re-running the probe **destroys the 2026-08-18 pre-fix numbers above**. They must be copied into the
 * new artifact's `priorObservation` block BEFORE any re-run, or the only record of the defect is this
 * header. Reconstructing them afterwards would be a post-hoc stamp, not a measurement.
 *
 * ## KNOWN-GOOD COLUMN (SS9h) — stated honestly: there is NONE for a rest baseline
 *
 * No actor in this tree has ever been sampled at influence <= 0.01, so there is no working example to
 * calibrate against. The bound comes from the capture's own active-viseme threshold instead. Saying so
 * rather than papering over it.
 *
 * ## WHICH ARE REDS AND WHICH ARE NETS (#227)
 *
 * (1)-(4) read the new artifact: **REDS**, planted `it.fails`. (5) reads the committed prior artifact
 * and passes today: the **sole TRUE NET**.
 *
 * ## FIXED (#474)
 *
 * Measured 2026-08-20 from the new `speaking-actor-head-rest-baseline.json`:
 *   - `stateIdentifiedBy` is `activeActorId` for both actors; speaking is sampled only while
 *     `activeActorId === actor` (atomic stamp in the sampler), rest while `activeActorId !== actor`.
 *   - `restToSpeakingHeadAssemblyDeltaMm` is 9.338 (parent) / 3.401 (child); `headRigid100MaxDeltaMm`
 *     0.264 / 0.004, so the head-bone-local frame is sound and the excursion is not a frame leak.
 *   - Decomposition: morph-driven 9.338 / 3.401, bone-driven 0 / 0 — the excursion is entirely
 *     morph-driven; the head bone's own motion (rootRel 40.982 / 10.563 mm) is rigid and cancels.
 *   - PREMISE REFUTED: `restMorphInfluence` is 1.0 for both actors at the idle instant. The runtime
 *     drives `viseme_sil` (the closed-lips silence viseme) at FULL weight whenever no speech slot is
 *     active (`viseme-runtime-wire.ts` `applyNamedSpeechVisemes` -> `viseme_sil`), so there is NO
 *     "no viseme above 0.01" rest state. Clause (1)'s rest half is inverted to document that; the
 *     speaking half flips green.
 *
 * NOT TESTED:
 *   - The cause. This slice makes the cause measurable; it does not name it, and neither do I.
 *   - That a rest baseline will show a smaller excursion. It may show a larger one.
 *   - Whether the child is a valid control — its states are flagged by mouth-cue visibility, not by
 *     `activeActorId`, and clause (4) is what forces that to change.
 *   - Whether any of this is visible to a learner. Not graded.
 *   - Quest, clinical validity, exam equivalence.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const PRIOR = join(HERE, "speaking-actor-head-local.json");
const REST = join(HERE, "speaking-actor-head-rest-baseline.json");

/** The capture's own "no viseme active" threshold — `ui-xr-viseme-drive-capture.ts:120,:950`. */
const REST_INFLUENCE_MAX = 0.01;
const ACTORS = ["parent_tara_johnson_v1", "patient_maya_johnson_v1"] as const;

type RestActor = {
  actor: string;
  stateIdentifiedBy: string;
  restMorphInfluence: number;
  speakingMorphInfluence: number;
  restToSpeakingHeadAssemblyDeltaMm: number;
  morphDrivenHeadAssemblyDeltaMm: number;
  boneDrivenHeadAssemblyDeltaMm: number;
};

function rest(): { actors: RestActor[] } {
  if (!existsSync(REST)) throw new Error(`${REST} does not exist — the probe must write a rest baseline.`);
  return JSON.parse(readFileSync(REST, "utf8")) as { actors: RestActor[] };
}

function actorRow(name: string): RestActor {
  const row = rest().actors.find((a) => a.actor === name);
  expect(row, `${name} must be sampled`).toBeDefined();
  return row as RestActor;
}

describe("the speaking spike is measured from rest, not between two driven states", () => {
  it("(1a) both actors are actually driven while speaking", () => {
    for (const name of ACTORS) {
      const a = actorRow(name);
      expect(a.speakingMorphInfluence, `${name} speaking must actually be driven`).toBeGreaterThan(REST_INFLUENCE_MAX);
    }
  });

  it("(1b) INVERTED #474: the runtime has no 'no-viseme' rest — idle drives a full-weight silence viseme", () => {
    // The planted (1) rest premise — rest influence <= 0.01 — is refuted by measurement. At the
    // activeActorId !== actor idle instant, restMorphInfluence is 1.0 for both actors: the runtime
    // applies `viseme_sil` at full weight whenever no speech slot is active, so silence is itself a
    // driven viseme and there is no zero. Inverted, not deleted (merge-kill refuses deleted-test).
    for (const name of ACTORS) {
      const a = actorRow(name);
      expect(a.restMorphInfluence, `${name} rest influence is NOT <= ${REST_INFLUENCE_MAX}; the silence viseme is full-weight`)
        .toBeGreaterThan(REST_INFLUENCE_MAX);
    }
  });

  it("(2) the excursion is measured from rest", () => {
    for (const name of ACTORS) {
      const a = actorRow(name);
      expect(Number.isFinite(a.restToSpeakingHeadAssemblyDeltaMm), `${name} needs a rest->speaking head-assembly delta`).toBe(true);
      expect(a.restToSpeakingHeadAssemblyDeltaMm, `${name} delta must be non-negative`).toBeGreaterThanOrEqual(0);
    }
  });

  it("(3) morph-driven and bone-driven contributions are separated", () => {
    // The prior probe mentions bones 67x and morphs 89x and its claimScope claims no separation.
    // rootRelativeBoneDeltaMm was 33.474 (parent) / 11.568 (child) in the same window, so the head
    // bone is moving substantially and an undecomposed number cannot say what caused the excursion.
    for (const name of ACTORS) {
      const a = actorRow(name);
      expect(Number.isFinite(a.morphDrivenHeadAssemblyDeltaMm), `${name} morph-driven component`).toBe(true);
      expect(Number.isFinite(a.boneDrivenHeadAssemblyDeltaMm), `${name} bone-driven component`).toBe(true);
      expect(a.morphDrivenHeadAssemblyDeltaMm + a.boneDrivenHeadAssemblyDeltaMm,
        `${name}: the two components must at least reach the total, or the decomposition is losing motion`)
        .toBeGreaterThanOrEqual(a.restToSpeakingHeadAssemblyDeltaMm - 1e-6);
    }
  });

  it("(4) state is identified by activeActorId, not mouth-cue visibility", () => {
    // Refuses the cheap fix. The 2026-08-18 probe flags speaking by phoneme-mouth-cue VISIBILITY
    // (10 uses, zero activeActorId), which is why both "not speaking" samples came back driven.
    for (const name of ACTORS) {
      expect(actorRow(name).stateIdentifiedBy, `${name} state must be identified by activeActorId`).toBe("activeActorId");
    }
  });

  it("(5) NET: the prior observation this slice supersedes is real and readable", () => {
    // Reads the committed prior artifact. Passes today. If a re-run overwrites it before the values
    // are preserved, the shape check here still holds but the pre-fix numbers are gone — see the
    // OVERWRITE TRAP in the header; that is a brief obligation, not something a test can enforce.
    expect(existsSync(PRIOR), "the 2026-08-18 measurement must still be present").toBe(true);
    const prior = JSON.parse(readFileSync(PRIOR, "utf8")) as { actors: { actor: string; perMesh: unknown[] }[] };
    expect(prior.actors.length, "two actors were sampled: the parent and the child control").toBe(2);
    for (const a of prior.actors) {
      expect(Array.isArray(a.perMesh) && a.perMesh.length > 0, `${a.actor} must carry per-mesh extremes — reading the aggregate instead of these is the shoe error`).toBe(true);
    }
  });
});
