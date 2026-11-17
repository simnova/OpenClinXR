import { describe, expect, it } from "vitest";
import { inspectIdleArmHang } from "../idle-arm-hang.js";
import { listLiveCastActors } from "../live-scenario-actor-cast.js";

/**
 * OBSERVABLE: the arm instrument reads the whole cast (ARM-PARTIAL-CAST).
 *
 * DEFECT (CI run 43891315698, 17:31-17:53Z,
 * `the-arm-instrument-measures-the-same-cast-twice (1)`): three forced passes saw
 * 14 / 13 / 13 actors; run2 lacked ward_delirium_med_rec_v1/ward_nurse_patel_v1,
 * run3 lacked ward_delirium_med_rec_v1/daughter_lena_ellis_v1. Locally 5 passes saw
 * 14 each.
 *
 * MECHANISM (verified in-tree): `idle-arm-hang.ts` `waitForHumanoidsAndFrames`
 * returns once ONE skinned mesh and ONE posture tag exist; `waitForSceneAssetsSettled`
 * (declared-actors-rendered.ts) waits for pendingCount==0 with a 60 s cap and SWALLOWS
 * its timeout (catch -> sleep up to 30 s -> return, now returning
 * `{ settled, pendingIds }`). On CI a station takes ~105-135 s, so a sibling GLB
 * still loading at 60 s is read as absent, silently.
 *
 * FIXTURE: a page.route holds ward_nurse_patel_v1's GLB —
 * pattern `**\/mpfb-clinical-nurse-adult.glb` (the cast SSOT file for the ward nurse;
 * the inspector prints every matched URL) — for 100 s. The real bound is the 60 s cap
 * (F3: the arm call passes timeoutMs=60_000, so the catch path's remaining is ~0 and
 * the 30 s fallback never runs): 100 s > 60 s with ~40 s margin. Past the bound the
 * asset is still pending, so a silent instrument would return 3 ward actors and the
 * fixed instrument throws `idle-arm-hang: <scenarioId> cast incomplete: missing <ids>`.
 *
 * Clause (1) is RED on the base tree (3 actors, no throw) and GREEN on the fix
 * (throw naming ward_nurse_patel_v1). Clause (2) is the counterweight: the
 * full bank un-delayed measures every declared actor, settled, no throw.
 *
 * claimScope: cast completeness of the arm instrument (loud vs silent partial reads).
 * notEvidenceFor: arm geometry values; whether any posture is correct; Quest readiness.
 */

const WARD_SCENARIO_ID = "ward_delirium_med_rec_v1";
const WARD_NURSE_ACTOR_ID = "ward_nurse_patel_v1";
/** Cast SSOT file for the ward nurse (actor-casting.ts nurse branch). */
const NURSE_GLB_PATTERN = "**/mpfb-clinical-nurse-adult.glb";
/** F3: real bound is the 60 s cap (timeoutMs=60_000 -> no fallback sleep); 100 s = 60 s + ~40 s margin. */
const SETTLE_PROOF_DELAY_MS = 100_000;

describe("the arm instrument reads the whole cast (ARM-PARTIAL-CAST)", () => {
  it(
    "(1) a GLB still loading past the settle bound is a loud error naming the absent actor, not a silent partial cast",
    async () => {
      const castIds = listLiveCastActors()
        .filter((entry) => entry.scenarioId === WARD_SCENARIO_ID)
        .map((entry) => entry.actorId);
      expect(
        castIds,
        "the ward cast is the INPUT (casting SSOT), never a run's own output",
      ).toContain(WARD_NURSE_ACTOR_ID);
      const outcome = await inspectIdleArmHang({
        force: true,
        label: "whole-cast-delayed",
        scenarioIds: [WARD_SCENARIO_ID],
        glbDelay: { urlPattern: NURSE_GLB_PATTERN, delayMs: SETTLE_PROOF_DELAY_MS },
      }).then(
        (report) => ({ report }),
        (error: unknown) => ({ error }),
      );
      if ("error" in outcome) {
        const message = outcome.error instanceof Error ? outcome.error.message : String(outcome.error);
        expect(
          message,
          "the error names the absent actor id",
        ).toMatch(/ward_nurse_patel_v1/);
        expect(message, "the error names the station").toMatch(/ward_delirium_med_rec_v1/);
        return;
      }
      // No throw: the instrument must then have measured the WHOLE ward cast.
      const liveWardActors = new Set(
        outcome.report.arms
          .filter((a) => a.scenarioId === WARD_SCENARIO_ID)
          .map((a) => String(a.actorId)),
      );
      expect(
        [...liveWardActors].sort(),
        "without a throw every cast actor must be present — a silent 3-actor read is the defect",
      ).toEqual([...castIds].sort());
    },
    1_800_000,
  );

  it(
    "(2) COUNTERWEIGHT: without the delay the full bank measures every declared actor, settled, no throw",
    async () => {
      const report = await inspectIdleArmHang({ force: true, label: "whole-cast-no-delay" });
      const declared = new Set(
        listLiveCastActors()
          .filter((a) => report.scenarios.includes(a.scenarioId))
          .map((a) => `${a.scenarioId}/${a.actorId}`),
      );
      expect(declared.size, "today's bank: 14 actors across the 5 arm stations").toBe(14);
      const live = new Set(report.arms.map((a) => `${a.scenarioId}/${a.actorId}`));
      expect(
        [...live].sort(),
        "every declared actor measured (two arms each, no fabrication, no omission)",
      ).toEqual([...declared].sort());
      expect(report.arms.length, "two arm rows per declared actor").toBe(declared.size * 2);
      // The settle record is additive in the fix tree; the base tree returns no report
      // field (helper returned void), where completeness is observed via the counts above.
      if (report.settle !== undefined) {
        for (const row of report.settle) {
          expect(row.settled, `${row.scenarioId} settled`).toBe(true);
          expect(row.pendingIds, `${row.scenarioId} pendingIds`).toEqual([]);
          expect(row.liveObserved, `${row.scenarioId} liveObserved`).toBe(row.castExpected);
        }
      }
    },
    1_800_000,
  );
});
