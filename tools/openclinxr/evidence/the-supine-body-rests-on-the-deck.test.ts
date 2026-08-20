import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * #492 — the recast supine body floats 668 mm above the deck it is supposed to lie on.
 *
 * ## THE DEFECT, MEASURED THROUGH THE PRODUCT POSE PATH — IMMUTABLE
 *
 * `#493` drove BOTH bodies through one `applyAndPlantSupineOnDeck` call via the isolated lab
 * (`isolated-subject-lab.ts:253`, `subjectKind: "runtime_posture"`). `STRETCHER_DECK_TOP_METERS =
 * 0.55` (`station-stretcher.ts:28`).
 *
 *   body                            posed mesh aabb.minY   clearance above deck
 *   --------------------------------|---------------------|----------------------
 *   ed_chest_pain_adult_cast.glb     |       0.566         |   +16 mm  RESTING   <- KNOWN-GOOD
 *   mpfb-gown-adult-patient.glb      |       1.218         |  +668 mm  FLOATING
 *
 * **A mesh AABB is rig-independent.** That is why this measurement survived when two earlier ones of
 * mine did not: it does not care what the joints are called, and both of my withdrawn diagnoses
 * failed precisely by comparing names.
 *
 * The posed ENVELOPE is close to the control — height 0.446 vs 0.466, length 1.688 vs 1.760, width
 * 0.992 vs 1.078. **Both bodies are recumbent.** The pose lays the figure down; the plant does not
 * put it on the deck.
 *
 * Rest state, for context — both bodies stand feet-on-ground and the roots are 60 mm apart:
 *
 *   ANNY  rest mesh Y [0.000, 1.760]   root joint "pelvis" local y = 0.810
 *   MPFB  rest mesh Y [0.001, 1.688]   root joint "root"   local y = 0.870
 *
 * After the same plant call the control's root sits at **0.810 — exactly its rest height** — while
 * the treatment's sits at **1.278, lifted 408 mm above its own rest height.**
 *
 * ## THE CAUSE IS NOT KNOWN TO ME BEYOND THESE NUMBERS
 *
 * Two of my diagnoses of this regression were withdrawn — a gown-skin tear, then a 3-of-17 bone
 * bind that was actually 17/17 through `resolvePoseBone`. **Trace it yourself; do not take a
 * hypothesis of mine as fact.** I am deliberately not offering a ranked cause, and the 408 mm root
 * lift above is a READING, not a mechanism.
 *
 * NOT diagnosed and NOT to be assumed: whether the float is the whole defect. `#493` also recorded
 * per-joint deltas spanning 96 mm to 774 mm, which a pure translation cannot produce — but those
 * are confounded by the two rigs having different rest poses and joint counts, so they are not
 * evidence of anything yet. If fixing the float leaves the figure distorted, that is a finding, and
 * this contract's clause (3) is what will show it.
 *
 * ## THE CHEAP FIXES THIS REFUSES
 *
 *   treatment                                     | (1) on deck | (2) control | (3) recumbent | result
 *   ----------------------------------------------|-------------|-------------|---------------|--------
 *   a) today — floating 668 mm                     |  **FAIL**   |    pass     |     pass      | REFUSED
 *   b) drop the body until minY hits the deck      |    pass     |    pass     |   **FAIL**    | REFUSED
 *      by scaling or squashing it                  |             |             |               |
 *   c) plant every body at a hardcoded deck height |    pass     |  **FAIL**   |     pass      | REFUSED
 *   d) make the plant measure the posed body       |    pass     |    pass     |     pass      | ALL PASS
 *
 * **(b) is the one to watch.** `minY` alone is satisfied by any transform that lowers the lowest
 * vertex — including squashing a recumbent figure flat or dropping it through the deck. Clause (3)
 * pins the posed envelope to the control's shape, so the body must still be a lying human.
 *
 * **(c)** is the S2 shape: a constant that happens to fit one body and breaks the other. Clause (2)
 * keeps the Anny control resting at +16 mm, and it is still the body every supine contract was
 * tuned against.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227): **(1) is the sole RED.** (2) and (3) pass today — they
 * exist so (1) cannot be satisfied by breaking the control or by deforming the figure. (4) is a
 * vacuity guard on the artifact.
 *
 * NOT TESTED:
 *   - That landing this makes the figure LOOK right. The orchestrator re-captures and grades all
 *     four supine stations; a green contract here is not the gate. `#491` shipped on a green
 *     contract and four stations were broken.
 *   - `seated`, the other postures, `ed_stroke_alert_handoff_v1` (ungradeable from its capture).
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const DUMP = join(HERE, "supine-pose-two-subject-dump.json");
const STRETCHER_SRC = join(REPO_ROOT, "apps/ui-xr/src/station-stretcher.ts");

const CONTROL = "ed_chest_pain_adult_cast.glb";
const TREATMENT = "mpfb-gown-adult-patient.glb";

/**
 * Derived from the CONTROL, not chosen by me: the Anny body rests at +16 mm above the deck, so a
 * 50 mm band is ~3x the control's own clearance and admits no float of the observed 668 mm class.
 */
const MAX_CLEARANCE_M = 0.05;

/** From the control's posed envelope — a lying human, not a squashed or standing one. */
const MAX_RECUMBENT_HEIGHT_M = 0.7;
const MIN_RECUMBENT_LENGTH_M = 1.5;

type Subject = {
  bodyGlb: string;
  posedMeshAabb: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } };
};

function deckTopMeters(): number {
  const m = /STRETCHER_DECK_TOP_METERS\s*=\s*([0-9.]+)/.exec(readFileSync(STRETCHER_SRC, "utf8"));
  expect(m, "station-stretcher.ts must still export STRETCHER_DECK_TOP_METERS").not.toBeNull();
  return Number(m![1]);
}

/** An empty enumeration must FAIL, never pass vacuously (SS7t). */
function subject(basename: string): Subject {
  expect(existsSync(DUMP), `${DUMP} must exist — regenerate the #493 two-subject dump`).toBe(true);
  const d = JSON.parse(readFileSync(DUMP, "utf8")) as { subjects: Subject[] };
  const s = d.subjects.find((x) => x.bodyGlb.endsWith(basename));
  expect(s, `the dump must carry ${basename}`).toBeDefined();
  return s!;
}

const clearance = (s: Subject): number => s.posedMeshAabb.min.y - deckTopMeters();

describe("the supine body rests on the deck", () => {
  it.fails("(1) RED: the recast body's posed mesh rests on the deck", () => {
    const c = clearance(subject(TREATMENT));
    expect(
      c,
      `${TREATMENT} posed mesh sits ${(c * 1000).toFixed(0)} mm above a deck at ${deckTopMeters()} m; `
        + `the control rests at +16 mm`,
    ).toBeLessThanOrEqual(MAX_CLEARANCE_M);
    expect(c, "and it must not sink through the deck either").toBeGreaterThanOrEqual(-MAX_CLEARANCE_M);
  });

  it("(2) COUNTERWEIGHT: the Anny control still rests on the deck", () => {
    // Refuses (c). A hardcoded plant height that fits the MPFB body and breaks the body every
    // supine contract was tuned against is the S2 shape.
    const c = clearance(subject(CONTROL));
    expect(Math.abs(c), `${CONTROL} is the known-good and must stay at its measured +16 mm`)
      .toBeLessThanOrEqual(MAX_CLEARANCE_M);
  });

  it("(3) COUNTERWEIGHT: the recast body is still a recumbent human", () => {
    // Refuses (b). minY alone is satisfied by squashing the figure or dropping it through the deck.
    const a = subject(TREATMENT).posedMeshAabb;
    const height = a.max.y - a.min.y;
    const length = Math.max(a.max.x - a.min.x, a.max.z - a.min.z);
    expect(height, `posed height ${height.toFixed(3)} m — the control lies at 0.466`)
      .toBeLessThanOrEqual(MAX_RECUMBENT_HEIGHT_M);
    expect(length, `posed length ${length.toFixed(3)} m — the control lies at 1.760`)
      .toBeGreaterThanOrEqual(MIN_RECUMBENT_LENGTH_M);
  });

  it("(4) VACUITY GUARD: the dump carries both subjects and a real deck constant", () => {
    expect(subject(CONTROL).posedMeshAabb?.min?.y, "control minY").toBeTypeOf("number");
    expect(subject(TREATMENT).posedMeshAabb?.min?.y, "treatment minY").toBeTypeOf("number");
    expect(deckTopMeters(), "a deck at 0 m would make every clearance meaningless").toBeGreaterThan(0.1);
  });
});
