import { describe, expect, it } from "vitest";

/**
 * PLANTED CONTRACT (#57) — the fallback label must reach something a human looks at.
 *
 * THE SINGLE `it.fails` IN THIS FILE FLIPS. This header is THE RECORD, not scratch — flip it,
 * append a `## FIXED (#57)` block below, and leave the measurement intact.
 *
 * WHY A NEW FILE. `apps/ui-xr/src/main.ts` is 10232 lines against a 10240 ceiling
 * (`file-size-budgets.ts:43`) — EIGHT lines of headroom, on the file that budget itself calls the
 * "#1 paydown". The ceiling is a shrink-only ratchet and raising it is the one move that is never
 * available. So the exam-form boot path has to come OUT of main.ts, which is the point: this slice
 * moves ratchet debt as a side effect of product work rather than as a separate substrate errand.
 * main.ts also touches the DOM at import (`requireElement`, :539), so it is not directly testable.
 *
 * WHAT IS BROKEN TODAY, measured: `bootLearnerExamFormFromApi` (`main.ts:2066-2072`) wraps the whole
 * resolve in a bare catch whose only body is a comment saying to keep the fixture form (spelled out
 * rather than quoted: a star followed by a slash inside a block comment CLOSES IT, which is exactly
 * how this file failed to parse on its first run), and the evidence global it feeds
 * (`main.ts:2100-2128`) hardcodes `source: "exam_assembly_form_run"` with no notion of a fallback.
 * The on-page exam UI — `#exam-flow-station`, `#exam-flow-timer` (`main.ts:1856-1861`) — shows
 * station, phase and timer, and says NOTHING about where the cases came from.
 *
 * A FIELD IN A JSON GLOBAL IS NOT DONE. Three slices in this project landed correct and inert
 * because the wiring was described as optional. Setting `fallbackActive` on
 * `window.__openClinXrExamFormRunEvidence` and stopping would be the fourth: nothing renders it, so
 * a proctor watching a headset still cannot tell an authored exam from fixtures.
 *
 * THE CONTRACT PULLS BOTH WAYS. It requires a label to be written on the degraded path AND requires
 * the healthy path to leave the sink alone — so "always write something" fails as surely as "write
 * nothing". The label must also be readable prose, not an enum echoed at a human.
 *
 * NO DOM IS ASSERTED HERE, DELIBERATELY, and this is the residual you should know about: ui-xr has
 * no jsdom (it is a dev dependency of ui-admin only, `apps/ui-admin/package.json:40`). Adding one is
 * an unlocked decision — take it if you want a real DOM assertion and say why. This contract instead
 * injects a text sink, which proves the boot path REACHES a UI element rather than only a global.
 * That main passes the REAL element is not proven by this test; it is covered by `changed:main.ts`
 * and by a human looking at the running app.
 *
 * SIGNATURE IS THE IMPLEMENTER'S CHOICE. This reads `applyExamFormBootPresentation({ result, sink })`
 * where `sink` is anything carrying a writable `textContent`. Change the call sites and say why if a
 * different shape is better. What must not change: the degraded path puts human-readable text where
 * a person will see it, and the healthy path does not.
 *
 * SCOPE: the learner-facing surface. Whether a REVIEWER can see it afterwards is the ui-admin
 * contract in `App.test.tsx`, and the resolution semantics are in `learner-exam-scenario-source.test.ts`.
 * All three are required by #57; this file alone does not close it.
 */

const load = async () => import("./learner-exam-form-boot.js") as Promise<Record<string, unknown>>;

type Sink = { textContent: string | null };
type Apply = (input: { result: unknown; sink: Sink }) => void;

describe("the learner can see that an exam is running on fixtures (#57)", () => {
  it.fails("boot surfaces the fallback to the on-page exam UI, not only to the evidence global", async () => {
    const mod = await load();
    const apply = mod["applyExamFormBootPresentation"] as Apply | undefined;
    expect(apply).toBeTypeOf("function");

    const degradedSink: Sink = { textContent: "" };
    apply!({
      result: {
        scenarioSource: "fixture_fallback",
        fallbackActive: true,
        fallbackReason: "station_run_queue_unreachable",
        scenarios: [{ scenarioId: "ed_chest_pain_priority_v1" }],
      },
      sink: degradedSink,
    });

    const shown = String(degradedSink.textContent ?? "");
    expect(shown.length, "the degraded path must write something a person can read").toBeGreaterThan(0);
    // Prose, not an enum echoed at a human: the raw snake_case token alone does not count.
    expect(shown.toLowerCase()).toContain("fixture");
    expect(shown, "a bare enum is not a message").not.toBe("fixture_fallback");

    // And the healthy path must leave it alone, or "always write a banner" satisfies the above.
    const healthySink: Sink = { textContent: "" };
    apply!({
      result: {
        scenarioSource: "api_queue",
        fallbackActive: false,
        scenarios: [{ scenarioId: "ed_chest_pain_priority_v1" }],
      },
      sink: healthySink,
    });
    expect(String(healthySink.textContent ?? "")).toHaveLength(0);
  });
});
