/**
 * PLACEHOLDER for #43. Deliberately implements nothing.
 *
 * This file exists so the planted contracts in `learner-exam-scenario-source.test.ts` can reference
 * the module without breaking `typecheck` — a dynamic `import()` is still resolved at compile time,
 * so an absent module is a hard error rather than a runtime one. The contracts assert that
 * `resolveLearnerExamScenarios` is a function; while this placeholder stands they fail on exactly
 * that, which is the intended RED.
 *
 * WHAT GOES HERE (#43): resolution of an exam form's scenarios — ids in, validated `Scenario[]` out.
 *   - a configured api base url means fetch the assembled sequence
 *     (`/exam-blueprints/:blueprintId/station-run-queue`, `rest/src/index.ts:82`), then resolve any
 *     id absent from `scenarioBank` via `get-authored-scenario` (`rest/src/index.ts:57`)
 *   - no base url means the fixture bank exactly as today: offline dev and headset boot must not
 *     acquire a network dependency
 *   - every scenario arriving over HTTP passes `validateScenario` before it can become a station;
 *     the client does not trust raw JSON
 *
 * WHAT DOES NOT GO HERE: `createMultiStationExamRuntime` / `assembleExamForm`. Resolution only —
 * pulling assembly in drags exam-assembly and clock types into a module whose value is being cheap
 * to test.
 *
 * WHY A NEW MODULE AT ALL: `main.ts` is size-frozen at 10255 lines and sits at 10254. The freeze is
 * shrink-only. There is no room to add this there, and `main.ts` touches the DOM at import so it
 * could not be tested there either.
 *
 * KNOWN HARD PART: the exam form is built synchronously at module scope (`main.ts:1810`) and HTTP
 * resolution is async. Wiring this up is an async-init or deferred-build change, not a swap.
 */

export const LEARNER_EXAM_SCENARIO_SOURCE_PLACEHOLDER = true;
