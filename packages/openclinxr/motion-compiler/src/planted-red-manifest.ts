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
  // ALL SEVEN REGION-ANCHOR ENTRIES REMOVED 2026-08-30 (tsk_1e0cd3cc7084db02). The anchor producer
  // landed — src/regions/region-anchors.ts exports deriveSkeletonProfile, and the seven clauses
  // were flipped from `planted` to `it` with a `## FIXED (tsk_1e0cd3cc7084db02)` block appended in
  // the-region-anchors-come-from-a-real-asset.test.ts. A satisfied contract is a transition to
  // record, not a planted RED to keep.
  // ALL SIX M1B ENTRIES REMOVED 2026-08-30 (tsk_3778b159cf72414d). The deriver landed —
  // src/derive-skeleton-profile.ts exports deriveSkeletonProfileFromRigAsset, and the six clauses
  // were flipped from `planted` to `it` with a `## FIXED (tsk_3778b159cf72414d)` block appended in
  // the-skeleton-profile-comes-from-a-real-rig.test.ts. A satisfied contract is a transition to
  // record, not a planted RED to keep.
  // ALL FIVE SEAM ENTRIES REMOVED 2026-08-30 (tsk_51ffcc3e1a8fdea8). The registry seam landed —
  // primitive-registry.ts exports PRIMITIVE_IDS, resolvePrimitive and createPrimitiveRegistry, and
  // the five clauses were flipped from `planted` to `it` with a `## FIXED (tsk_51ffcc3e1a8fdea8)`
  // block appended in the-primitive-registry-is-one-seam-with-no-behaviour.test.ts. A satisfied
  // contract is a transition to record, not a planted RED to keep.
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
    // STAGE MOVED 2026-08-30 (tsk_51ffcc3e1a8fdea8): the registry seam landed and resolves
    // guard_body_region, so this clause no longer stops at module absence. It now fails because the
    // PLACEHOLDER guard compiles a foreign-space profile instead of refusing it — M2's behaviour
    // clause, red for its own reason. The probe caught the move and demanded this edit.
    select: "(0b) RED: the guard REFUSES a profile whose anchors are in a space it does not implement",
    expected: /the guard compiled anchors in a space it does not implement/,
    stage: "assertion",
  },
  {
    file: "the-guard-primitive-hits-four-targets-on-three-rigs.test.ts",
    // STAGE MOVED 2026-08-30: was "guard-body-region must export compileGuardClip". That export is
    // no longer required by any clause — the second public compile entry was removed — so these two
    // clauses now stop at the registry, which is the single path. The probe caught the move and
    // demanded this edit, which is what it is for.
    //
    // STAGE MOVED AGAIN 2026-08-30 (tsk_51ffcc3e1a8fdea8): the registry now resolves
    // guard_body_region to the placeholder, which emits no tracks. The clause fails on its first
    // track-content assertion, which is M2's behavioural bar — red for its own reason.
    select: "(1) guard_body_region resolves one target on THREE rig families through the bind frame, not a per-rig euler table",
    expected: /produced no tracks/,
    stage: "assertion",
  },
  {
    file: "the-guard-primitive-hits-four-targets-on-three-rigs.test.ts",
    // STAGE MOVED 2026-08-30 (tsk_51ffcc3e1a8fdea8): the registry seam landed; the undeclared-target
    // clause now fails because the placeholder emits an empty track list where a reach must be shown.
    select: "(2) a body target the module has never declared still compiles — there is no per-target pose table",
    expected: /expected 0 to be greater than 0/,
    stage: "assertion",
  },
  {
    file: "the-guard-primitive-hits-four-targets-on-three-rigs.test.ts",
    // STAGE MOVED 2026-08-30 (tsk_51ffcc3e1a8fdea8): the registry seam landed and the placeholder
    // satisfies the wire-format half of this clause (canonical fragment, attributed to its action).
    // The reach half fails — legal tracks that go nowhere — which is the M2 behavioural bar.
    select: "(2b) RED: the registered guard returns a CANONICAL fragment, attributed to its action",
    expected: /the registered guard returns legal tracks that go nowhere near the region's anchor/,
    stage: "assertion",
  },
  // ALL THREE M5 ENTRIES REMOVED 2026-08-30 (tsk_bca4085904e3b071). The M1
  // closed-IR validator satisfies clauses (1)-(3), so they were flipped from
  // `planted` to `it` with a `## FIXED (tsk_bca4085904e3b071)` block appended
  // in the-llm-planner-cannot-emit-bone-tracks.test.ts. Clause (2)'s actor half
  // passes only CONFINED (the plant's own PLACEHOLDER target is an undeclared
  // region, so the foreign-actor program is refused for the placeholder, not
  // the actorId) — recorded in that file; closing it needs case context, the
  // M5 card's residual.
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
  // FOUR M1 ENTRIES REMOVED 2026-08-30 (tsk_bca4085904e3b071). The M1 modules
  // landed, all four clauses pass, and they were deliberately flipped from
  // `planted` to `it` with a `## FIXED (tsk_bca4085904e3b071)` block appended
  // in the-planner-emits-a-validated-motion-program.test.ts. A satisfied
  // contract is a transition to record, not a planted RED to keep.
  // ALL FOUR M4 ENTRIES REMOVED 2026-08-30 (tsk_ccc9fb8c7f0def8b). The behaviour layer landed —
  // src/trajectory.ts plus the four primitive bodies (clutch-body-region.ts, reach-target.ts,
  // look-at.ts, cough-recoil.ts) — and all four clauses were flipped from `planted` to `it` with a
  // `## FIXED (tsk_ccc9fb8c7f0def8b)` block appended in
  // the-primitive-registry-composes-four-behaviours.test.ts. A satisfied contract is a transition
  // to record, not a planted RED to keep.
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
  // ALL FOUR SEED ENTRIES REMOVED 2026-08-30 (tsk_89fca85c7700ae13). The canonical derivation
  // landed at src/trajectory/deterministic-variation.ts and program/compile-scenario-motion.ts
  // routes the plan seed and the compile identity through it; the four clauses were flipped from
  // `planted` to `it` with a `## FIXED (tsk_89fca85c7700ae13)` block appended in
  // the-seed-is-derived-from-five-case-inputs.test.ts. A satisfied contract is a transition to
  // record, not a planted RED to keep.
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
