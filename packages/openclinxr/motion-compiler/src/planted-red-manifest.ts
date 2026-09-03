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
  // BOTH FOUR-BEHAVIOURS ENTRIES REMOVED 2026-09-03 (BothyBoard issue #0). The two orphaned
  // kinds got primitives of their own — src/imposed-limb-arc.ts (passive_rom: the limb carried
  // through an out-and-back arc by an examiner's grasp) and src/guided-placement.ts (positioning:
  // the effector guided to a placed offset, dwelt on, released with the placement retained) —
  // both registered in primitive-registry.ts (PRIMITIVE_IDS now seven) and wired in
  // compile-scenario-motion.ts (passive_rom -> imposed_limb_arc, positioning -> guided_placement;
  // guarding and palpation keep their primitives). Clauses (1) and (2) were flipped from
  // `planted` to `it` with a `## FIXED (BothyBoard issue #0)` block appended in
  // the-four-response-kinds-are-four-behaviours.test.ts. A satisfied contract is a transition to
  // record, not a planted RED to keep. (The earlier compiler-repair card had repointed the two
  // orphans at guard_body_region / reach_target, which satisfied resolvability but collapsed the
  // kinds into aliases — the clause's second counterweight now refuses repointing at the M2+M4
  // five by requiring two resolved ids outside it.)

  // ALL FIVE COMPILER-SURFACE ENTRIES REMOVED 2026-09-02 (compiler-repair card, issue #0). The
  // package root now exports the registry + both profile derivers; clutch_body_region compiles
  // each site to its own travel and reads action.effector; guard_body_region reads action.effector
  // with side-aware chain resolution; every motion primitive emits track times in seconds; and
  // RESPONSE_KIND_TO_PRIMITIVE maps only registered primitive ids. The five clauses were flipped
  // from `planted` to `it` with a `## FIXED (compiler-repair card, issue #0)` block appended in
  // the-compiler-surface-carries-region-and-effector.test.ts. A satisfied contract is a transition
  // to record, not a planted RED to keep.
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
  // ALL FIVE KEYSTONE ENTRIES REMOVED 2026-08-30 (tsk_fd3856d1d8e23ec1). The canonical compile
  // entry landed — src/compile-motion-program.ts exports compileMotionProgram, and the five clauses
  // were flipped from `planted` to `it` with a `## FIXED (tsk_fd3856d1d8e23ec1)` block appended in
  // the-canonical-compile-entry-orchestrates-primitives.test.ts. A satisfied contract is a
  // transition to record, not a planted RED to keep.
  // TWO CONTACT ENTRIES REMOVED 2026-08-30 (tsk_fd3856d1d8e23ec1). The keystone compile entry
  // landing made clauses (1b) and (2) exercisable, and both now PASS as a consequence — they were
  // flipped from `planted` to `it` with a `## FIXED (tsk_fd3856d1d8e23ec1)` block appended in
  // the-contact-constraint-holds-across-its-window.test.ts. Clauses (1) and (3) stay planted:
  // their failure MOVED to real contact assertions — the registered guard reaches and settles
  // but does not HOLD the contact across the window (the contact-solver card's residual).
  // BOTH REMAINING CONTACT ENTRIES REMOVED 2026-09-02 (BothyBoard issue #0). The contact-window
  // schedule landed — src/contact/contact-window-schedule.ts (window precedence by
  // preserveWhileActive, refusal of programs no single pose can satisfy) wired into the registered
  // guard (src/primitives/guard-body-region.ts brackets every winning window with identical
  // solved-pose keys) — and clauses (1) and (3) were flipped from `planted` to `it` with a
  // `## FIXED (BothyBoard issue #0)` block appended in
  // the-contact-constraint-holds-across-its-window.test.ts. A satisfied contract is a transition
  // to record, not a planted RED to keep.
  // ALL THREE M3 ENTRIES REMOVED 2026-09-02 (BothyBoard issue #0). The aggregator landed —
  // src/evidence/motion-evidence.ts exports runMotionEvidenceGates (seven deterministic gates
  // measured and classified from the caller-supplied spec, none skipped, each result carrying its
  // own cannotSee), MOTION_GATE_IDS, and combineMotionVerdict (deterministic verdict authoritative
  // in both directions; the advisory channel's verdict is preserved as advisoryVisualVerdict,
  // never applied) — and the three clauses were flipped from `planted` to `it` with a
  // `## FIXED (BothyBoard issue #0)` block appended in
  // the-motion-evidence-gates-refuse-a-bad-clip.test.ts. A satisfied contract is a transition to
  // record, not a planted RED to keep.
  // ALL FOUR GUARD ENTRIES REMOVED 2026-08-30 (tsk_744eea9a35614caf). The guard primitive landed —
  // src/ik/solve-chain.ts (the solver SEAM named by the guard plant's clause 4; analytic two-bone
  // solve with conservative joint limits) plus src/primitives/guard-body-region.ts (region-anchor
  // resolution + 3-keyframe clip), and the four clauses were flipped from `planted` to `it` with a
  // `## FIXED (tsk_744eea9a35614caf)` block appended in
  // the-guard-primitive-hits-four-targets-on-three-rigs.test.ts. A satisfied contract is a
  // transition to record, not a planted RED to keep.
  //
  // NOTE: do not write the three.js IK solver's name here — the guard plant's clause (4) scans
  // every non-test source in this package and only the solve-chain.ts seam may carry it.
  // ALL THREE M5 ENTRIES REMOVED 2026-08-30 (tsk_bca4085904e3b071). The M1
  // closed-IR validator satisfies clauses (1)-(3), so they were flipped from
  // `planted` to `it` with a `## FIXED (tsk_bca4085904e3b071)` block appended
  // in the-llm-planner-cannot-emit-bone-tracks.test.ts. Clause (2)'s actor half
  // passes only CONFINED (the plant's own PLACEHOLDER target is an undeclared
  // region, so the foreign-actor program is refused for the placeholder, not
  // the actorId) — recorded in that file; closing it needs case context, the
  // M5 card's residual.
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
  // ONE RESOLVED-CLIP-ID ENTRY REMOVED 2026-08-30 (tsk_fd3856d1d8e23ec1). Clause (1) now PASSES
  // as a consequence of the keystone entry landing and was flipped from `planted` to `it` with a
  // `## FIXED (tsk_fd3856d1d8e23ec1)` block appended in
  // the-resolved-clip-id-is-what-the-compiler-produces.test.ts. Clause (2) stays planted: its
  // failure MOVED to the scenario-fixtures resolver — `responseClipForBodyRegion` (card
  // tsk_ae6a9530ba63a68b) does not exist yet; clipId agreement with the case data is the sibling
  // card's residual.
  {
    file: "the-resolved-clip-id-is-what-the-compiler-produces.test.ts",
    select: "(2) RED: the compiled clipId IS the clip the case asks for — bank, resolver and compiler agree",
    expected: /must export responseClipForBodyRegion \(card tsk_ae6a9530ba63a68b\)/,
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
