import { existsSync, readFileSync } from "node:fs";
import { regionLuminance } from "./lib/png-region-luminance.js";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * E2 reproduce (#402 / #419) — AN ISOLATED SPEAKING STILL, NOT ANOTHER BONE DUMP.
 *
 * ## WHY THIS AND NOT MORE NUMBERS
 *
 * Two measurements have now resolved #402 to normal behaviour and neither was a picture:
 *   - E2.1: all 19 bones translated uniformly (parent 234-236 mm) at identical scale — rigid
 *     whole-body displacement, which a moving actor produces regardless. Conclusion withdrawn.
 *   - E2.2 (`b2e5ac8d`): 8.729 mm head-LOCAL deformation with `headRigid100MaxDeltaMm = 0`, and the
 *     carrying vertex 4658 is **76.4% weighted to lip muscles** (`levator05.R` 41.9%, `oris03.R`
 *     22.3%, `oris07.R` 12.2%). That is a mouth moving during speech.
 *
 * The effort stopped there because the ruling was: a further slice needs a DIFFERENT INSTRUMENT,
 * not another dump. The different instrument is an isolated still of the parent speaking, graded by
 * eye against the same actor not speaking. Either a spike is visible or it is not, and both answers
 * close something.
 *
 * ## THE PAIR MUST DIFFER ONLY IN THE SPEAKING STATE
 *
 * Same GLB, same bytes, same camera, same framing — one frame where the parent is the speaking
 * actor and one where she is not. E2.2 established both states are reachable and distinguishable in
 * the live scene: `speakingMorphInfluence` 1.0 at t=20.11 against 0.4998 at t=16.05, with
 * `driveTrace: "parent communication"`. That is the known-good column — it proves the two frames
 * exist, so a pair that comes back identical is a capture failure, not evidence of no spike.
 *
 * ## THE CHEAP FIXES THIS REFUSES
 *
 *   treatment                                                  | (1) | (2) | (3) | (4) | result
 *   -------------------------------------------------------------|-----|-----|-----|-----|--------
 *   a) today — no stills                                       |FAIL |FAIL |FAIL |FAIL | REFUSED
 *   b) two stills captured from DIFFERENT source bytes         | pass|FAIL | pass| pass| REFUSED
 *   c) the same frame written twice under two names            | pass| pass|FAIL | pass| REFUSED
 *   d) a blank GREY frame that clears any byte floor           | pass| pass| pass|FAIL | REFUSED
 *   e) same bytes, two distinct states, both frames renderable | pass| pass| pass| pass| ALL PASS
 *
 * **(c) is the one to watch** — the capture harness is driven by time, and a mistimed pair silently
 * produces the same frame twice, which would read as "no spike" when nothing was compared. Clause
 * (3) requires the two files to differ.
 *
 * **(d) is the #409 class, and it DEFEATED my first version of clause (4).** A still that exists and
 * shows nothing passes `exists:`, passes a byte floor, and teaches the producer that its obligation
 * is discharged. Clause (4) now measures luminance sd — see the FIXED block below.
 *
 * **PROBE FIXTURE NOTE.** My first probe run had treatment (e) FAILING clause (4), and that was a
 * defect in the fixture rather than the contract: flat-colour synthetic PNGs compress to a few
 * hundred bytes and cannot clear a 20 KB floor a real render clears trivially. A probe whose
 * pass-leg does not pass has demonstrated nothing, so it was re-run with noise-filled 400x400 PNGs
 * (480 KB) — (e) then passed 4/4 and (d) failed clause (4) alone, as declared.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (SS227): **all four are RED today** — no artifact and no stills.
 * (2), (3) and (4) become the load-bearing guards once (1) is green.
 *
 * NOT TESTED: whether a visible spike means #402 is real — **the orchestrator grades the pair, and
 * that grade is not in this contract.** No cause, no fix, no rebake, no `apps/ui-xr` product edit,
 * no other actor or scenario. A pair that shows nothing does not prove #402 never happens; it
 * proves it is not in these two frames.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const ARTIFACT = join(REPO_ROOT, "tools/openclinxr/evidence/speaking-parent-still-pair.json");

/** E2.2's shipped-bytes measurement — proves both states are reachable. */
const KNOWN_GOOD_STATES = { speaking: 1.0, notSpeaking: 0.4998 };
/**
 * ## FIXED (#431) — a byte floor is not a content check, measured
 *
 * The first run of this contract produced two stills I graded as EMPTY grey fields, and the byte
 * floor passed BOTH: 24,922 B and **134,991 B** — the second six times a 20,000 B floor, and
 * completely blank. Bytes measure entropy; a noisy empty frame has plenty.
 *
 * `nonBlackPct` does not catch it either. Measured on those two frames and on a known-good sheet:
 *
 *   frame                       mean     sd      nonBlackPct
 *   EMPTY speaking             142.7    0.96      100.0%
 *   EMPTY not-speaking         184.3    1.82      100.0%
 *   KNOWN-GOOD garment sheet    35.8   26.90      100.0%
 *
 * All three are 100% non-black, because the empties are GREY rather than black. Only luminance
 * **sd** separates them. The floor below sits 4.4x above the worst observed empty and 3.4x below
 * observed real content — derived from both columns, not fitted to clear one observation.
 */
const MIN_CONTENT_SD = 8;

type Frame = { stateId: string; speakingFlag: boolean; morphInfluence: number; still: string; bytes: number; sha256: string };
type Pair = { actor?: string; sourceGlb?: string; sourceGlbSha256?: string; frames?: Frame[] };

function pair(): Pair {
  expect(existsSync(ARTIFACT), `${ARTIFACT} — this slice writes it`).toBe(true);
  return JSON.parse(readFileSync(ARTIFACT, "utf8")) as Pair;
}
const frames = (): Frame[] => pair().frames ?? [];

describe("an isolated speaking/not-speaking still pair exists for the parent", () => {
  it("(1) RED: two frames of the parent are recorded, one speaking and one not", () => {
    const p = pair();
    expect(p.actor, "the subject").toMatch(/parent/);
    const f = frames();
    expect(f.length, "exactly two frames — speaking and not").toBe(2);
    expect(f.filter((x) => x.speakingFlag).length, "one frame must be the speaking state").toBe(1);
    expect(f.filter((x) => !x.speakingFlag).length, "one frame must be the control state").toBe(1);
  });

  it("(2) COUNTERWEIGHT: both frames come from the SAME source bytes", () => {
    // Refuses (b). A pair captured from two different GLBs compares two actors, not two states.
    const p = pair();
    expect(p.sourceGlbSha256, "the GLB hash both frames were captured from").toBeTruthy();
    expect(p.sourceGlb, "the GLB path").toMatch(/\.glb$/);
  });

  it("(3) COUNTERWEIGHT: the two stills are different images", () => {
    // Refuses (c). A time-driven harness can silently write the same frame twice, which would read
    // as "no spike" when nothing was compared.
    const f = frames();
    if (f.length !== 2) return;
    expect(f[0]!.sha256, "the two stills must not be the same image").not.toBe(f[1]!.sha256);
    expect(f[0]!.morphInfluence, "the two states must differ in morph influence").not.toBe(f[1]!.morphInfluence);
  });

  it("(4) COUNTERWEIGHT: both stills carry content, and the states match E2.2's measurement", () => {
    // Refuses (d), the #409 class — a frame that exists and shows nothing.
    const f = frames();
    if (f.length !== 2) return;
    for (const x of f) {
      const abs = join(REPO_ROOT, x.still);
      expect(existsSync(abs), `${x.still} must exist`).toBe(true);
      const lum = regionLuminance(readFileSync(abs));
      expect(lum, `${x.still} must be a readable PNG`).toBeTruthy();
      expect(
        lum!.sd,
        `${x.still} is a flat field (mean ${lum!.mean.toFixed(1)}, sd ${lum!.sd.toFixed(2)}) — no figure was rendered`,
      ).toBeGreaterThan(MIN_CONTENT_SD);
    }
    const speaking = f.find((x) => x.speakingFlag)!;
    const control = f.find((x) => !x.speakingFlag)!;
    expect(speaking.morphInfluence, `E2.2 measured ${KNOWN_GOOD_STATES.speaking} at the speaking frame`).toBeGreaterThan(control.morphInfluence);
  });
});
