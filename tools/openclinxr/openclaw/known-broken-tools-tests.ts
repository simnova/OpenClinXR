#!/usr/bin/env tsx
/**
 * Known-broken tools tests — a SHRINK-ONLY exclude list.
 *
 * WHY THIS EXISTS: `//#test:tools` ran vitest over a doubled-star glob under tools/ UNQUOTED, so
 * the SHELL expanded it. Without globstar the doubled star behaves as a single one, resolving to
 * one directory level — 14 of the 148 test files under tools/. The health gate ran 9% of its tests
 * and printed green.
 *
 * The glob is spelled out in prose rather than written literally on purpose: a star followed by a
 * slash inside a block comment CLOSES THE COMMENT. Writing it literally here is what made this file
 * fail to parse and put `pnpm typecheck` red on main for two cycles (fixed 2026-08-06).
 *
 * Everything in the loop machinery was in the invisible 134: dispatch-worker, integrate,
 * integrate-gate, board-brief, loop-pause, delegation-scorecard. They passed only because they were
 * run individually by path.
 *
 * Running all 148 surfaces 13 pre-existing broken files (e.g.
 * `buildDynamicEncounterFactoryPlanningProjection is not a function`, last touched by commit
 * 0e22752 in an earlier session). Fixing them all before making the gate honest would wedge the
 * loop; leaving the gate blind is worse.
 *
 * HONESTY, stated plainly because this is the harsher kind of freeze: a failing TEST is not like an
 * oversized FILE. A big file still works; a failing test asserts that behaviour is wrong. This is
 * debt labelled `known-broken`, NOT "acceptable" — and it is frozen BY FILE PATH rather than by a
 * failure count, because a count lets a frozen file quietly gain new failures and stay under the cap.
 */

export const KNOWN_BROKEN_TOOLS_TESTS: readonly string[] = [
  "tools/openclinxr/evidence/blueprint-voice-simulation-spike.test.ts",
  "tools/openclinxr/evidence/check-github-pages-site.test.ts",
  "tools/openclinxr/evidence/iwsdk-evidence-contract-check.test.ts",
  "tools/openclinxr/evidence/iwsdk-workspace-posture-check.test.ts",
  "tools/openclinxr/evidence/model-vetting-actor-player-runtime-evidence.test.ts",
  "tools/openclinxr/evidence/model-vetting-capture-manifest.test.ts",
  "tools/openclinxr/evidence/model-vetting-runtime-hook-bindings.test.ts",
  "tools/openclinxr/evidence/model-vetting-runtime-mapping-evidence.test.ts",
  "tools/openclinxr/factory/encounter-asset-generation-queue.test.ts",
  "tools/openclinxr/factory/encounter-publication-payloads.test.ts",
  "tools/openclinxr/factory/encounter-runtime-selection-review-packet.test.ts",
  "tools/openclinxr/factory/publish-generated-learner-runtime-bundle.test.ts",
  "tools/openclinxr/openclaw/agentic-hook-runner.test.ts",
];

/**
 * A frozen file that now passes on its own MUST leave the list — same ratchet as the size and
 * reference freezes. Without this the list only grows and the exclusion becomes permanent.
 */
export function staleFreezeEntries(passingWhenRunAlone: readonly string[]): string[] {
  return KNOWN_BROKEN_TOOLS_TESTS.filter((entry) => passingWhenRunAlone.includes(entry)).map(
    (entry) =>
      `${entry}: passes when run alone but is still excluded from the tools gate — `
      + `remove it from KNOWN_BROKEN_TOOLS_TESTS so the ratchet tightens.`,
  );
}
