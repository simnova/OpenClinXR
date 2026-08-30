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
    file: "the-region-anchors-come-from-a-real-asset.test.ts",
    select: "(1) RED: anchors are DERIVED FROM THE ASSET \u2014 two sizes give two answers",
    expected: /must export deriveSkeletonProfile/,
    stage: "assertion",
  },
  {
    file: "the-region-anchors-come-from-a-real-asset.test.ts",
    select: "(2) RED: every derived anchor is REACHABLE on its own asset",
    expected: /must export deriveSkeletonProfile/,
    stage: "assertion",
  },
  {
    file: "the-region-anchors-come-from-a-real-asset.test.ts",
    select: "(3) RED: the declared space is HONOURED, checked against the asset's own bind frame",
    expected: /must export deriveSkeletonProfile/,
    stage: "assertion",
  },
  {
    file: "the-region-anchors-come-from-a-real-asset.test.ts",
    select: "(4) RED: a region with no derivable anchor is REFUSED, never defaulted",
    expected: /must export deriveSkeletonProfile/,
    stage: "assertion",
  },
  {
    file: "the-region-anchors-come-from-a-real-asset.test.ts",
    select: "(5) RED: two regions sharing a nearest joint still get DIFFERENT anchors",
    expected: /must export deriveSkeletonProfile/,
    stage: "assertion",
  },
  {
    file: "the-region-anchors-come-from-a-real-asset.test.ts",
    select: "(7) RED: the anchors are placed on a profile derived from a REAL RIG, not an asset-shaped object",
    expected: /must export deriveSkeletonProfileFromRigAsset/,
    stage: "assertion",
  },
  {
    file: "the-region-anchors-come-from-a-real-asset.test.ts",
    select: "(6) RED: the producer emits the PROFILE the compile path consumes, carrying the asset's own rig",
    expected: /must export deriveSkeletonProfile/,
    stage: "assertion",
  },
  {
    file: "the-skeleton-profile-comes-from-a-real-rig.test.ts",
    select: "(1) RED: the profile is DERIVED FROM THE ASSET — three shipped rigs give three answers",
    expected: /must export deriveSkeletonProfileFromRigAsset/,
    stage: "assertion",
  },
  {
    file: "the-skeleton-profile-comes-from-a-real-rig.test.ts",
    select: "(2) RED: the bind frame is THE ASSET'S OWN, checked against the file by an independent decode",
    expected: /must export deriveSkeletonProfileFromRigAsset/,
    stage: "assertion",
  },
  {
    file: "the-skeleton-profile-comes-from-a-real-rig.test.ts",
    select: "(3) RED: ancestry is REAL — parents are joints, chains terminate, and the wrist reaches the root",
    expected: /must export deriveSkeletonProfileFromRigAsset/,
    stage: "assertion",
  },
  {
    file: "the-skeleton-profile-comes-from-a-real-rig.test.ts",
    select: "(4) RED: a file that is not a rig is REFUSED, never defaulted",
    expected: /must export deriveSkeletonProfileFromRigAsset/,
    stage: "assertion",
  },
  {
    file: "the-skeleton-profile-comes-from-a-real-rig.test.ts",
    select: "(5) RED: only the real file can supply this — counterweight to a plausible fixture",
    expected: /must export deriveSkeletonProfileFromRigAsset/,
    stage: "assertion",
  },
  {
    file: "the-skeleton-profile-comes-from-a-real-rig.test.ts",
    select: "(6) RED: the elbow's axes are THE ASSET'S, not a constant",
    expected: /must export deriveSkeletonProfileFromRigAsset/,
    stage: "assertion",
  },
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
    select: "(0b) RED: the guard REFUSES a profile whose anchors are in a space it does not implement",
    expected: /primitive-registry must export resolvePrimitive/,
    stage: "assertion",
  },
  {
    file: "the-guard-primitive-hits-four-targets-on-three-rigs.test.ts",
    // STAGE MOVED 2026-08-30: was "guard-body-region must export compileGuardClip". That export is
    // no longer required by any clause — the second public compile entry was removed — so these two
    // clauses now stop at the registry, which is the single path. The probe caught the move and
    // demanded this edit, which is what it is for.
    select: "(1) guard_body_region resolves one target on THREE rig families through the bind frame, not a per-rig euler table",
    expected: /primitive-registry must export resolvePrimitive/,
    stage: "assertion",
  },
  {
    file: "the-guard-primitive-hits-four-targets-on-three-rigs.test.ts",
    select: "(2) a body target the module has never declared still compiles — there is no per-target pose table",
    expected: /primitive-registry must export resolvePrimitive/,
    stage: "assertion",
  },
  {
    file: "the-guard-primitive-hits-four-targets-on-three-rigs.test.ts",
    select: "(2b) RED: the registered guard returns a CANONICAL fragment, attributed to its action",
    expected: /primitive-registry must export resolvePrimitive/,
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
