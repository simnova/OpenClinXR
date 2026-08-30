/**
 * Every planted RED in this package, with the reason it is CURRENTLY red.
 *
 * `pnpm --filter @openclinxr/motion-compiler probe:reds` runs each clause alone in probe mode and
 * requires it to fail with a message matching its pattern. See `planted.ts` for what this catches
 * and why it is not a source-rewriting script.
 *
 * ## Maintaining this
 *
 * As a module lands, a clause's failure reason MOVES — from "the module is absent" to a real
 * assertion, then to passing. That is a contract transition and it belongs here as an explicit edit,
 * with `stage` updated. A clause that passes while still listed is reported as a failure by the
 * probe, which is the point: nobody discovers a satisfied contract by accident.
 *
 * `stage` is documentation for the reader, not logic — the probe matches on `expected` only.
 */
export type PlantedRed = {
  file: string;
  /** A substring of the clause title, enough to select it with vitest -t. */
  select: string;
  /** Regex the probe-mode failure output must match. */
  expected: RegExp;
  stage: "module_absent" | "assertion";
};

export const PLANTED_REDS: readonly PlantedRed[] = [
  {
    file: "the-planner-emits-a-validated-motion-program.test.ts",
    select: "the deterministic planner turns the shipped abdomen_rlq guarding row",
    // M1 loads three absent modules through `Promise.all`, and WHICH ONE rejects first is not
    // ordered. Pinning one name made this fingerprint flaky — caught while probing the probe, where
    // one run reported `deterministic-scenario-motion-planner.js` against a pattern naming
    // `motion-program.js`. The stage is "the modules under test are absent"; the set is the honest
    // fingerprint for it.
    expected: /Cannot find module .*src\/(motion-program|motion-body-region|deterministic-scenario-motion-planner)\.js/,
    stage: "module_absent",
  },
  {
    file: "the-planner-emits-a-validated-motion-program.test.ts",
    select: "(2b) RED: the support surface DERIVES the baseline posture",
    // M1 loads three absent modules through `Promise.all`, and WHICH ONE rejects first is not
    // ordered. Pinning one name made this fingerprint flaky — caught while probing the probe, where
    // one run reported `deterministic-scenario-motion-planner.js` against a pattern naming
    // `motion-program.js`. The stage is "the modules under test are absent"; the set is the honest
    // fingerprint for it.
    expected: /Cannot find module .*src\/(motion-program|motion-body-region|deterministic-scenario-motion-planner)\.js/,
    stage: "module_absent",
  },
  {
    file: "the-canonical-compile-entry-orchestrates-primitives.test.ts",
    select: "(1) RED: one entry compiles a whole program through injected primitives",
    expected: /Cannot find module .*src\/compile-motion-program\.js/,
    stage: "module_absent",
  },
  {
    file: "the-canonical-compile-entry-orchestrates-primitives.test.ts",
    select: "(5) RED: tracks have one closed value space",
    expected: /Cannot find module .*src\/compile-motion-program\.js/,
    stage: "module_absent",
  },
  {
    file: "the-guard-primitive-hits-four-targets-on-three-rigs.test.ts",
    select: "(1) guard_body_region resolves one target on THREE rig families",
    expected: /guard-body-region must export compileGuardClip/,
    stage: "assertion",
  },
  {
    file: "the-guard-primitive-hits-four-targets-on-three-rigs.test.ts",
    select: "(2b) RED: the REGISTERED guard primitive reaches the same target",
    expected: /primitive-registry must export resolvePrimitive/,
    stage: "assertion",
  },
  {
    file: "the-primitive-registry-composes-four-behaviours.test.ts",
    select: "(1) the registry resolves all four primitives",
    expected: /Cannot find module .*src\/primitive-registry\.js/,
    stage: "module_absent",
  },
  {
    file: "the-primitive-registry-composes-four-behaviours.test.ts",
    select: "(4b) RED: registry resolution binds behaviour",
    expected: /Cannot find module .*src\/primitive-registry\.js/,
    stage: "module_absent",
  },
  {
    file: "the-motion-evidence-gates-refuse-a-bad-clip.test.ts",
    select: "(3b) RED: deterministic REFUSE beats visual ACCEPT",
    expected: /Cannot find module .*src\/motion-evidence-gates\.js/,
    stage: "module_absent",
  },
  {
    file: "the-contact-constraint-holds-across-its-window.test.ts",
    select: "(1) RED: inside the window the effector holds contact",
    expected: /compile-motion-program\.js must export compileMotionProgram/,
    stage: "assertion",
  },
  {
    file: "the-contact-constraint-holds-across-its-window.test.ts",
    select: "(2) RED: outside the window the effector MOVES",
    expected: /compile-motion-program\.js must export compileMotionProgram/,
    stage: "assertion",
  },
  {
    file: "the-contact-constraint-holds-across-its-window.test.ts",
    select: "(3) RED: preserveWhileActive is OBEYED",
    expected: /compile-motion-program\.js must export compileMotionProgram/,
    stage: "assertion",
  },
  {
    file: "the-resolved-clip-id-is-what-the-compiler-produces.test.ts",
    select: "(1) RED: the canonical action reaches the primitive unchanged",
    expected: /compile-motion-program\.js must export compileMotionProgram/,
    stage: "assertion",
  },
  {
    file: "the-resolved-clip-id-is-what-the-compiler-produces.test.ts",
    select: "(2) RED: the compiled clipId IS the clip the case asks for",
    expected: /compile-motion-program\.js must export compileMotionProgram/,
    stage: "assertion",
  },
];

/**
 * Failure shapes that mean the INSTRUMENT is broken, whatever else matched. A clause dying on any of
 * these is not red for its own reason even if its message happens to contain the expected substring.
 */
export const INSTRUMENT_FAILURES: readonly { pattern: RegExp; why: string }[] = [
  { pattern: /ReferenceError/, why: "a symbol the clause references does not exist" },
  { pattern: /Cannot find module '\/(?!Volumes)/, why: "a mangled relative specifier — the M1 defect of 2026-08-29" },
  { pattern: /Test timed out/, why: "the clause hung rather than asserting" },
  { pattern: /SyntaxError/, why: "the file does not parse" },
];
