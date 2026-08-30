/**
 * Every planted RED in this package, with the reason it is CURRENTLY red.
 *
 * `pnpm --filter @openclinxr/motion-compiler probe:reds` discovers every `planted(...)` clause from
 * the TypeScript AST, refuses any mismatch against this list, then runs each clause alone in probe
 * mode and requires it to fail with a message matching its pattern.
 *
 * ## Maintaining this
 *
 * As a module lands, a clause's failure reason MOVES - from "the module is absent" to a real
 * assertion, then to passing. That is a contract transition and it belongs here as an explicit edit,
 * with `stage` updated. A clause that passes while still listed is reported as a failure, which is
 * the point: nobody discovers a satisfied contract by accident.
 *
 * ## Why several patterns name a SET of modules
 *
 * Where a clause loads more than one absent module through `Promise.all`, WHICH ONE rejects first is
 * unordered. Pinning a single name made a fingerprint flaky - one probe run reported
 * `deterministic-scenario-motion-planner.js` against a pattern naming `motion-program.js`. The stage
 * is "the modules under test are absent"; the set is the honest fingerprint for it.
 *
 * `stage` is documentation for the reader, not logic - the probe matches on `expected` only.
 */
export type PlantedRed = {
  file: string;
  /** The clause title, EXACTLY. It is both the identity used for coverage and the vitest selector. */
  select: string;
  /** Regex the probe-mode failure output must match. */
  expected: RegExp;
  stage: "module_absent" | "assertion";
};

export const PLANTED_REDS: readonly PlantedRed[] = [
  {
    file: "the-primitive-registry-is-one-seam-with-no-behaviour.test.ts",
    select: "(1) RED: the vocabulary carries the guard AND the four behaviours, in one place",
    expected: /primitive-registry\.js must export PRIMITIVE_IDS/,
    stage: "assertion",
  },
  {
    file: "the-primitive-registry-is-one-seam-with-no-behaviour.test.ts",
    select: "(2) RED: every declared id resolves to something returning a CANONICAL fragment",
    expected: /primitive-registry\.js must export resolvePrimitive/,
    stage: "assertion",
  },
  {
    file: "the-primitive-registry-is-one-seam-with-no-behaviour.test.ts",
    select: "(3) RED: an unknown id is REFUSED, not silently undefined",
    expected: /primitive-registry\.js must export resolvePrimitive/,
    stage: "assertion",
  },
  {
    file: "the-primitive-registry-is-one-seam-with-no-behaviour.test.ts",
    select: "(4) RED: resolution returns a DISTINCT entry per id \u2014 an aliasing guard, nothing more",
    expected: /primitive-registry\.js must export resolvePrimitive/,
    stage: "assertion",
  },
  {
    file: "the-primitive-registry-is-one-seam-with-no-behaviour.test.ts",
    select: "(5) RED: a duplicate id is REFUSED at construction, deterministically",
    expected: /primitive-registry\.js must export createPrimitiveRegistry/,
    stage: "assertion",
  },
  {
    file: "the-canonical-compile-entry-orchestrates-primitives.test.ts",
    select: "(1) RED: one entry compiles a whole program through injected primitives",
    expected: /Cannot find module .*src\/compile-motion-program\.js/,
    stage: "module_absent",
  },
  {
    file: "the-canonical-compile-entry-orchestrates-primitives.test.ts",
    select: "(2) RED: the same input compiles to the same clip, and a moved target changes it",
    expected: /Cannot find module .*src\/compile-motion-program\.js/,
    stage: "module_absent",
  },
  {
    file: "the-canonical-compile-entry-orchestrates-primitives.test.ts",
    select: "(3) RED: an unknown primitive is REFUSED, never silently skipped",
    expected: /Cannot find module .*src\/compile-motion-program\.js/,
    stage: "module_absent",
  },
  {
    file: "the-canonical-compile-entry-orchestrates-primitives.test.ts",
    select: "(4) RED: the clip carries NO self-attested verdict — checked on the RETURNED object",
    expected: /Cannot find module .*src\/compile-motion-program\.js/,
    stage: "module_absent",
  },
  {
    file: "the-canonical-compile-entry-orchestrates-primitives.test.ts",
    select: "(5) RED: tracks have one closed value space — semantics, sign continuity, ordering",
    expected: /Cannot find module .*src\/compile-motion-program\.js/,
    stage: "module_absent",
  },
  {
    file: "the-contact-constraint-holds-across-its-window.test.ts",
    select: "(1) RED: inside the window the effector holds contact on every sampled frame, not only at the keys",
    expected: /compile-motion-program\.js must export compileMotionProgram/,
    stage: "assertion",
  },
  {
    file: "the-contact-constraint-holds-across-its-window.test.ts",
    select: "(1b) RED: the canonical entry uses the REAL registry \u2014 the registered guard is what runs",
    expected: /compile-motion-program\.js must export compileMotionProgram/,
    stage: "assertion",
  },
  {
    file: "the-contact-constraint-holds-across-its-window.test.ts",
    select: "(2) RED: outside the window the effector MOVES — a hand parked on the target is not a guard",
    expected: /compile-motion-program\.js must export compileMotionProgram/,
    stage: "assertion",
  },
  {
    file: "the-contact-constraint-holds-across-its-window.test.ts",
    select: "(3) RED: preserveWhileActive is OBEYED — a releasable contact yields to a competing one",
    expected: /compile-motion-program\.js must export compileMotionProgram/,
    stage: "assertion",
  },
  {
    file: "the-guard-primitive-hits-four-targets-on-three-rigs.test.ts",
    select: "(1) guard_body_region resolves one target on THREE rig families through the bind frame, not a per-rig euler table",
    expected: /guard-body-region must export compileGuardClip/,
    stage: "assertion",
  },
  {
    file: "the-guard-primitive-hits-four-targets-on-three-rigs.test.ts",
    select: "(2) a body target the module has never declared still compiles — there is no per-target pose table",
    expected: /guard-body-region must export compileGuardClip/,
    stage: "assertion",
  },
  {
    file: "the-guard-primitive-hits-four-targets-on-three-rigs.test.ts",
    select: "(2b) RED: the REGISTERED guard primitive reaches the same target as the internal solver",
    expected: /primitive-registry must export resolvePrimitive/,
    stage: "assertion",
  },
  {
    file: "the-llm-planner-cannot-emit-bone-tracks.test.ts",
    select: "(1) RED: refuses a planner output carrying raw per-bone quaternion tracks",
    expected: /Cannot find module .*src\/(motion-program|motion-body-region)\.js/,
    stage: "module_absent",
  },
  {
    file: "the-llm-planner-cannot-emit-bone-tracks.test.ts",
    select: "(2) RED: refuses a target naming a body region the case never authored",
    expected: /Cannot find module .*src\/(motion-program|motion-body-region)\.js/,
    stage: "module_absent",
  },
  {
    file: "the-llm-planner-cannot-emit-bone-tracks.test.ts",
    select: "(3) RED: a planner-produced program cannot self-declare reviewed_llm_proposal",
    expected: /Cannot find module .*src\/(motion-program|motion-body-region)\.js/,
    stage: "module_absent",
  },
  {
    file: "the-motion-evidence-gates-refuse-a-bad-clip.test.ts",
    select: "(1) REFUSES a clip whose elbow exceeds its limit and whose effector misses its target",
    expected: /Cannot find module .*src\/motion-evidence-gates\.js/,
    stage: "module_absent",
  },
  {
    file: "the-motion-evidence-gates-refuse-a-bad-clip.test.ts",
    select: "(2) ACCEPTS a known-good clip, with all seven gates run and none skipped",
    expected: /Cannot find module .*src\/motion-evidence-gates\.js/,
    stage: "module_absent",
  },
  {
    file: "the-motion-evidence-gates-refuse-a-bad-clip.test.ts",
    select: "(3b) RED: deterministic REFUSE beats visual ACCEPT, proved by CALLING it — not by reading a filename",
    expected: /Cannot find module .*src\/motion-evidence-gates\.js/,
    stage: "module_absent",
  },
  {
    file: "the-planner-emits-a-validated-motion-program.test.ts",
    select: "the deterministic planner turns the shipped abdomen_rlq guarding row into a MotionProgram v1 that its own validator accepts",
    expected: /Cannot find module .*src\/(motion-program|motion-body-region|deterministic-scenario-motion-planner)\.js/,
    stage: "module_absent",
  },
  {
    file: "the-planner-emits-a-validated-motion-program.test.ts",
    select: "MotionBodyRegion is a separate vocabulary: no raw ComplianceRegion value may be a MotionAction target, and the motion set holds a region the touch set has no counterpart for",
    expected: /Cannot find module .*src\/(motion-program|motion-body-region|deterministic-scenario-motion-planner)\.js/,
    stage: "module_absent",
  },
  {
    file: "the-planner-emits-a-validated-motion-program.test.ts",
    select: "(2b) RED: the support surface DERIVES the baseline posture — chair seats, stretcher lies down",
    expected: /Cannot find module .*src\/(motion-program|motion-body-region|deterministic-scenario-motion-planner)\.js/,
    stage: "module_absent",
  },
  {
    file: "the-primitive-registry-composes-four-behaviours.test.ts",
    select: "(1) the registry resolves all four primitives and each produces a motion distinct from the other three",
    expected: /Cannot find module .*src\/(primitive-registry|trajectory)\.js/,
    stage: "module_absent",
  },
  {
    file: "the-primitive-registry-composes-four-behaviours.test.ts",
    select: "(2) DETERMINISM: one seed reproduces byte-identically AND a different seed produces different motion",
    expected: /Cannot find module .*src\/(primitive-registry|trajectory)\.js/,
    stage: "module_absent",
  },
  {
    file: "the-primitive-registry-composes-four-behaviours.test.ts",
    select: "(3) the minimum-jerk profile has zero endpoint velocity and a 1.875x mid-motion peak",
    expected: /Cannot find module .*src\/(primitive-registry|trajectory)\.js/,
    stage: "module_absent",
  },
  {
    file: "the-primitive-registry-composes-four-behaviours.test.ts",
    select: "(4b) RED: registry resolution binds behaviour, not the primitiveId the request claims",
    expected: /Cannot find module .*src\/(primitive-registry|trajectory)\.js/,
    stage: "module_absent",
  },
  {
    file: "the-resolved-clip-id-is-what-the-compiler-produces.test.ts",
    select: "(1) RED: the canonical action reaches the primitive unchanged, through the canonical entry",
    expected: /compile-motion-program\.js must export compileMotionProgram/,
    stage: "assertion",
  },
  {
    file: "the-resolved-clip-id-is-what-the-compiler-produces.test.ts",
    select: "(2) RED: the compiled clipId IS the clip the case asks for — bank, resolver and compiler agree",
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
  { pattern: /Cannot find module '\/(?!Volumes)/, why: "a mangled relative specifier - the M1 defect of 2026-08-29" },
  { pattern: /Test timed out/, why: "the clause hung rather than asserting" },
  { pattern: /SyntaxError/, why: "the file does not parse" },
];
