import { readFileSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";
import { applyGeneratedScalarVisemeToRoot, resolveMorphIndex } from "../../../apps/ui-xr/src/viseme-runtime-wire.js";

/**
 * **MPFB actors never blink.** The blink SIGNAL exists and is already deterministic; the TARGET exists
 * and already seals the lids; nothing connects them. Measured 2026-08-14 on the shipped bytes and the
 * shipped source:
 *
 *   1. `computeHumanoidEyeMotionMetrics` (`apps/ui-xr/src/main.ts:8684-8697`) emits `blinkIntensity`
 *      from a pure clock: 4300 ms period, a 200 ms window, `sin(pi * t)`. Deterministic, no LLM, and
 *      the right shape. Keep it.
 *
 *   2. That value is consumed at `main.ts:8650-8655` by `scaleRigControl` / `offsetRigControl` on FOUR
 *      hand-authored proxy objects — `openclinxr_left_upper_eyelid_blink_control` and siblings — and
 *      by scaling the EYEBALL itself to 0.28x vertically. A blink lowers a lid; it does not flatten a
 *      globe.
 *
 *   3. **All three shipped MPFB actors carry ZERO such proxy nodes** (0 of 143 nodes each; the only
 *      eye-named nodes are `eye.L` and `eye.R`). `getObjectByName` returns undefined, every
 *      `*RigControl` call is a no-op, and the actors are open-eyed forever.
 *
 *   4. They DO carry real FACS lid morphs, and those morphs work. Palpebral aperture on a vertical
 *      slice through the pupil, `eye-*-closure` at influence 1.0:
 *
 *        actor   globe r    aperture open -> closed     slit (partial)
 *        ------  --------   -------------------------   --------------
 *        child   11.25mm    8.05 -> **-1.48mm** sealed   8.05 -> 2.29mm
 *        aisha   12.00mm    7.63 -> **-1.92mm** sealed   7.63 -> 2.47mm
 *        kevin   12.00mm    7.07 -> **-2.44mm** sealed   7.07 -> 1.25mm
 *
 *      Negative = the lid margins cross rather than merely meet. The eye seals.
 *
 *   5. `applyHumanoidMorphTargetCue` (`main.ts:8831`) is the function that DOES reach morph targets —
 *      and its signature is `(slot, openness, viseme, expressionWeights)`. **It never receives
 *      `blinkIntensity` at all.** There is no wire to cut; there is a wire to add.
 *
 * ## THE KNOWN-GOOD IS THE MOUTH, ON THE SAME DICTIONARY, IN THE SAME FUNCTION (SS9h)
 *
 * This is not "it ought to be possible". Three rows down the same `traverse`,
 * `resolveMorphIndex(dict, "openclinxr_mouth_open")` resolves against these exact MPFB dictionaries
 * and drives `mouth-open` every frame, and `applyNamedSpeechVisemes` drives the viseme targets — 48
 * live samples at influence 1.0 were measured in the running scene on `mpfb_peds_patient_child_body`.
 * The canonical eye rows were added to the same resolver by #354 and resolve 13/14 on all three
 * actors. Clause (4) asserts the mouth column stays green, so this file always carries a working
 * reference beside the broken one.
 *
 * ## THE CHEAP FIXES THIS REFUSES
 *
 *   treatment                                        | (1) closes | (2) open at rest | (3) tracks | (4) mouth | result
 *   -------------------------------------------------|------------|------------------|------------|-----------|--------
 *   a) today (no wire at all)                        | **FAIL**   |      pass        |  **FAIL**  |   pass    | REFUSED
 *   b) pin closure to 1.0 whenever a lid is found    |   pass     |    **FAIL**      |  **FAIL**  |   pass    | REFUSED
 *   c) drive a constant 0.5 "half-lidded" look       | **FAIL**   |    **FAIL**      |  **FAIL**  |   pass    | REFUSED
 *   d) rebuild the mouth traverse and lose the visemes|  pass     |      pass        |    pass    | **FAIL**  | REFUSED
 *   e) map blinkIntensity -> eye-*-closure influence |   pass     |      pass        |    pass    |   pass    | ALL PASS
 *
 * **(b) is the one to watch and it is why clause (2) exists.** Clause (1) only asks what happens at
 * full intensity, so an applier that ignores its argument satisfies it completely — and shuts the
 * actor's eyes for the entire encounter. **(c) is why clause (3) exists**: a constant anywhere in the
 * range defeats a two-point check, so (3) requires the influence to be a monotone non-decreasing
 * function of intensity AND to actually span the range. A constant is monotone; a constant does not
 * span.
 *
 * ## WHY THIS IS A DARK-FACTORY SLICE (D9)
 *
 * The step being moved from hand-authored to deterministic is the eyelid itself. Today an eyelid is
 * four invented proxy objects scaled by magic constants (`* 1.8`, `* 0.72`, `* 0.012`) that exist on
 * one rail and not the other. After this, the eyelid is the asset's own FACS morph driven by a clock —
 * the same shape the mouth already has. Nothing is hand-authored per actor, and a fourth actor blinks
 * the day it ships. Per D1 the target is WIRED, not authored: the morph already exists in the bytes.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227): (1) and (3) are the REDS and fail on all three actors
 * today. (2) and (4) are counterweights and pass today. They are independent of what (1) measures:
 * connecting a lid morph cannot change the rest-state influence unless the applier ignores intensity,
 * and cannot change mouth resolution unless the mouth traverse is disturbed.
 *
 * NOT TESTED:
 *   - **That a learner sees a blink.** This bounds influence values, not pixels. A graded capture
 *     mid-blink settles appearance and that grade is the orchestrator's.
 *   - **Blink TIMING.** The 4300/200 ms clock is asserted nowhere here; only that the applier is a
 *     function of whatever intensity it is handed. Rate realism is a separate question.
 *   - **Whether the -1.5..-2.4mm lid overshoot predates #377.** The pre-shrink asset was not measured,
 *     so the smaller globe cannot be blamed for it (or cleared).
 *   - **The Anny rail.** Only the three MPFB actors are enumerated. Whether the proxy-object path is
 *     still right for Anny actors that DO carry those nodes is out of scope and untouched.
 *   - **Asymmetric lids** (unilateral ptosis, facial droop). Clause (1) drives both eyes together;
 *     nothing here exercises a one-sided drive, which is what a stroke station would need.
 *
 * ## FIXED (#379)
 *
 * The wire landed in apps/ui-xr/src/blink-runtime-wire.ts: `applyBlinkClosureToRoot(root,
 * blinkIntensity)` drives `openclinxr_eye_left_closure` / `openclinxr_eye_right_closure` on every
 * mesh under root that carries them, resolved through the shared `resolveMorphIndex` (#354). The
 * intensity→influence curve is linear (identity on [0,1]), so the applier is monotone and spans
 * the range. `main.ts` calls it from `applyHumanoidFaceRigControls` where the existing proxy
 * blink controls run — a call, not an implementation (clause (5)). The proxy-object path stays
 * for the Anny rail; this drives the morph path the MPFB actors already carry.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const GENERATED = "apps/ui-xr/public/generated-humanoids";
const MAIN_TS = join(REPO_ROOT, "apps/ui-xr/src/main.ts");

const ACTORS = ["mpfb-ob-patient-aisha", "mpfb-peds-nurse-kevin", "mpfb-peds-patient-child"] as const;

/** Canonical names the shared resolver maps onto MPFB FACS targets (#354). */
const LEFT_CLOSURE = "openclinxr_eye_left_closure";
const RIGHT_CLOSURE = "openclinxr_eye_right_closure";
/** The known-good column: this one already resolves and drives today. */
const MOUTH_OPEN = "openclinxr_mouth_open";

/** Full closure must actually close. */
const CLOSED_MIN = 0.9;
/** At rest the eye must be open; anything above this is a half-lidded actor. */
const REST_MAX = 0.02;
/** The applier must span the range, not sit at a constant. */
const MIN_SPAN = 0.8;

type ActorRoot = {
  actor: string;
  /** Duck-typed MorphRootLike over one synthetic mesh carrying the actor's real dictionary. */
  root: { traverse: (cb: (o: unknown) => void) => void; userData: Record<string, unknown> };
  mesh: { morphTargetDictionary: Record<string, number>; morphTargetInfluences: number[]; name: string };
  eyeTargetNames: string[];
};

const io = new NodeIO();

/**
 * Build a synthetic morph root from the SHIPPED dictionary. Isolated by construction (D3/D4): no dev
 * server, no scene, no three.js — the consumers are duck-typed on `traverse` + `morphTargetDictionary`,
 * so this exercises the real resolver against the real names at zero boot cost.
 */
async function actorRoot(actor: string): Promise<ActorRoot | null> {
  const doc = await io.read(join(REPO_ROOT, GENERATED, `${actor}.glb`));
  for (const mesh of doc.getRoot().listMeshes()) {
    const names = mesh.getExtras()?.targetNames;
    if (!Array.isArray(names) || !names.some((n) => /^eye-(left|right)-closure$/.test(String(n)))) {
      continue;
    }
    const dictionary: Record<string, number> = {};
    names.forEach((n, i) => {
      dictionary[String(n)] = i;
    });
    const synthetic = {
      name: mesh.getName() || actor,
      morphTargetDictionary: dictionary,
      morphTargetInfluences: names.map(() => 0),
    };
    return {
      actor,
      mesh: synthetic,
      eyeTargetNames: names.map(String).filter((n) => /^eye-/.test(n)),
      root: {
        userData: {},
        traverse: (cb: (o: unknown) => void) => {
          cb(synthetic);
        },
      },
    };
  }
  return null;
}

/** The applier this slice must add. Absent today, so every call site sees `null`. */
type BlinkApplier = (root: unknown, blinkIntensity: number) => unknown;

/**
 * The specifier is COMPUTED, not a literal: the module does not exist yet, and a literal would make
 * `pnpm typecheck` fail to resolve it before the slice starts. It resolves normally once written.
 */
const BLINK_MODULE = ["..", "..", "..", "apps", "ui-xr", "src", "blink-runtime-wire.js"].join("/");

async function loadBlinkApplier(): Promise<BlinkApplier | null> {
  try {
    const mod: Record<string, unknown> = await import(BLINK_MODULE);
    const fn = mod.applyBlinkClosureToRoot;
    return typeof fn === "function" ? (fn as BlinkApplier) : null;
  } catch {
    return null;
  }
}

const roots = (await Promise.all(ACTORS.map(actorRoot))).filter((r): r is ActorRoot => r !== null);
const applier = await loadBlinkApplier();

/** Drive one intensity and read back both lid influences. Returns null when no applier exists. */
function closureAt(entry: ActorRoot, intensity: number): { left: number; right: number } | null {
  if (!applier) return null;
  entry.mesh.morphTargetInfluences.fill(0);
  applier(entry.root, intensity);
  const li = resolveMorphIndex(entry.mesh.morphTargetDictionary, LEFT_CLOSURE);
  const ri = resolveMorphIndex(entry.mesh.morphTargetDictionary, RIGHT_CLOSURE);
  if (typeof li !== "number" || typeof ri !== "number") return null;
  return {
    left: entry.mesh.morphTargetInfluences[li] ?? 0,
    right: entry.mesh.morphTargetInfluences[ri] ?? 0,
  };
}

/**
 * An empty enumeration must FAIL, never pass vacuously (SS7t). Plain `it` on purpose: an `it.fails`
 * cannot guard its own vacuity — it is satisfied by ANY failure, including this guard throwing.
 */
function requireActors(): void {
  expect(roots.length, `MPFB actors carrying eye-*-closure morphs (of ${ACTORS.length})`).toBe(
    ACTORS.length,
  );
  for (const entry of roots) {
    expect(
      entry.eyeTargetNames.length,
      `${entry.actor} eye-* FACS targets (6 measured 2026-08-14)`,
    ).toBeGreaterThanOrEqual(6);
  }
}

describe("actors blink with their eyelids", () => {
  it("(1) RED: at full blink intensity both lid morphs are driven closed", () => {
    requireActors();
    const open = roots
      .map((entry) => ({ entry, at: closureAt(entry, 1) }))
      .filter(({ at }) => !at || at.left < CLOSED_MIN || at.right < CLOSED_MIN)
      .map(({ entry, at }) =>
        at === null
          ? `${entry.actor}: no blink applier reaches a lid morph — blinkIntensity is consumed only by proxy objects this actor does not have`
          : `${entry.actor}: left ${at.left.toFixed(2)}, right ${at.right.toFixed(2)} at full intensity (need >= ${CLOSED_MIN})`,
      );
    expect(open, "actors whose eyes do not close at full blink intensity").toEqual([]);
  });

  it("(2) COUNTERWEIGHT: at rest the eyes are open", () => {
    // Refuses (b): an applier that ignores its argument satisfies clause (1) completely and shuts the
    // actor's eyes for the whole encounter. Passes today only because nothing drives them at all —
    // which is exactly the state clause (1) refuses, so the two cannot be satisfied together by doing
    // nothing.
    requireActors();
    const shut = roots
      .map((entry) => ({ entry, at: closureAt(entry, 0) }))
      .filter(({ at }) => at !== null && (at.left > REST_MAX || at.right > REST_MAX))
      .map(
        ({ entry, at }) =>
          `${entry.actor}: left ${at?.left.toFixed(2)}, right ${at?.right.toFixed(2)} at intensity 0 (need <= ${REST_MAX}) — half-lidded at rest`,
      );
    expect(shut, "actors whose eyes are not open at rest").toEqual([]);
  });

  it("(3) RED: lid closure tracks blink intensity monotonically across the range", () => {
    // Refuses (c): a constant satisfies any two-point check and is monotone. Requiring a SPAN as well
    // as monotonicity is what a constant cannot do. SS11s — bound the shape, not only the extremes.
    requireActors();
    const steps = [0, 0.25, 0.5, 0.75, 1];
    const bad: string[] = [];
    for (const entry of roots) {
      const series = steps.map((s) => closureAt(entry, s));
      if (series.some((v) => v === null)) {
        bad.push(`${entry.actor}: no applier — closure does not track intensity at all`);
        continue;
      }
      const left = series.map((v) => v?.left ?? 0);
      for (let i = 1; i < left.length; i += 1) {
        if (left[i]! < left[i - 1]! - 1e-6) {
          bad.push(
            `${entry.actor}: closure fell from ${left[i - 1]!.toFixed(2)} to ${left[i]!.toFixed(2)} as intensity rose ${steps[i - 1]} -> ${steps[i]}`,
          );
        }
      }
      const span = Math.max(...left) - Math.min(...left);
      if (span < MIN_SPAN) {
        bad.push(
          `${entry.actor}: closure spans only ${span.toFixed(2)} across intensity 0..1 (need >= ${MIN_SPAN}) — this is a constant, not a blink`,
        );
      }
    }
    expect(bad, "actors whose lid closure does not track blink intensity").toEqual([]);
  });

  it("(4) COUNTERWEIGHT: the mouth still resolves and drives on the same dictionary", () => {
    // Refuses (d): the lid drive shares a traverse with the viseme drive. If wiring the eyes disturbs
    // it the actor stops speaking, which is worse than not blinking. This is also the KNOWN-GOOD
    // column (SS9h) — proof in-file that this machinery reaches these dictionaries today.
    requireActors();
    const broken: string[] = [];
    for (const entry of roots) {
      entry.mesh.morphTargetInfluences.fill(0);
      const mouthIndex = resolveMorphIndex(entry.mesh.morphTargetDictionary, MOUTH_OPEN);
      if (typeof mouthIndex !== "number") {
        broken.push(`${entry.actor}: ${MOUTH_OPEN} no longer resolves against the shipped dictionary`);
        continue;
      }
      const result = applyGeneratedScalarVisemeToRoot(entry.root, 0.8);
      if (!result.activeTargetName) {
        broken.push(`${entry.actor}: the named viseme drive found no target on the shipped dictionary`);
      }
    }
    expect(broken, "actors whose mouth drive regressed while wiring the eyes").toEqual([]);
  });

  it("(5) COUNTERWEIGHT: the blink logic does not grow the app entry", () => {
    // The deterministic logic belongs in a module, not in the 9,866-line app entry. main.ts should
    // gain a call, not an implementation. Ceiling inherited from #376.
    const lines = readFileSync(MAIN_TS, "utf8").split("\n").length;
    expect(lines, "apps/ui-xr/src/main.ts line count").toBeLessThanOrEqual(9875);
  });
});
