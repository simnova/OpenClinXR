import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * OBSERVABLE: the runtime-goal arm's `body_region_contact` goal is pinned to a fixed WORLD point, so
 * the chest rocks 6 cm through a stationary hand. The contact is correct at one instant per cycle.
 *
 * MEASURED 2026-09-03 from runtime-goal-eval.json on origin/main, 12 oscillation frames:
 *
 *   targetWorld travel                    0.00 cm   (x, y and z)
 *   pelvis travel, the DRIVER             6.00 cm on Y
 *   distance target -> breastR       0.0 to 6.0 cm, SPREAD 5.99 cm
 *   distance target -> spine03      26.1 to 32.1 cm, SPREAD 5.99 cm
 *   distance target -> spine04      33.2 to 39.2 cm, SPREAD 5.97 cm
 *
 * Every torso bone shows a spread equal to the driver's travel, because the target does not move at
 * all. At one extreme the hand is exactly on the chest; at the other it is 6 cm off it — in front of
 * the chest or inside it, depending on phase.
 *
 * The descriptor asks for a region, not a point: `regionRole: "rightChestSurface"`, goal kind
 * `body_region_contact`. A hand on a rocking chest is the behaviour the operator's own example needs
 * ("reach out to hold their hand to take their pulse"); a hand hanging in space while the chest rocks
 * past it is not.
 *
 * SECOND DEFECT, same descriptor. `chainRoles` is
 *   ["lowerarm02.R", "lowerarm01.R", "upperarm02.R", "upperarm01.R", "shoulder01.R", "clavicle.R"]
 * `lowerarm02.R` and `upperarm02.R` are MakeHuman TWIST segments: they twist, they do not flex. A
 * CCDIK chain that rotates them bends the forearm in the middle of itself. This is the same defect
 * `solveArmChain` carried until c7e85634 fixed it in the compiler by skipping `*02`; the harness has
 * its own chain and still names them. Two ticks ago I recorded that positions alone could not settle
 * whether the twists were in the chain — the descriptor settles it.
 *
 * IMMUTABLE diagnosis. Flip `it.fails` -> `it` and append a `## FIXED (#N)` block. Do not rewrite the
 * measured tables.
 *
 * claimScope: whether the goal's world position follows its named body region across the oscillation,
 *   and whether the declared IK chain excludes twist segments.
 * notEvidenceFor: what any still SHOWS — no pixel is graded here; which motion backend wins; pose
 *   quality or clinical plausibility; the compiler's solveArmChain, already fixed separately.
 *
 * ## FIXED (#0) — clauses (1) and (2) flipped
 *
 * Re-run 2026-09-03 via runtime-goal-eval.mts (Playwright, headless chromium) against harness.html
 * at 8baad49e, actor bytes unchanged (2e111a0d...). The eval's solve() now applies the pelvis
 * driver FIRST and then aims the goal at the region's post-motion anchor (regionGoalTarget in
 * harness.html), so the goal rides the region across the oscillation:
 *
 *   targetWorld travel                    6.00 cm on Y (== pelvis travel, the driver)
 *   distance target -> breastR       3.0 cm at all 12 frames, SPREAD 0.00 cm
 *   distance target -> spine03       spread 0.00 cm;  spine04 spread 0.00 cm
 *
 * The descriptor's chainRoles no longer names the MakeHuman TWIST segments lowerarm02.R /
 * upperarm02.R — the c7e85634 defect in the harness's own declared chain — and is now
 * ["lowerarm01.R", "upperarm01.R", "shoulder01.R", "clavicle.R"] (contentSha256 recomputed).
 * targetA/B remain 0.120 m apart with wristR following by 0.120 m at blend 1, so the reach proof
 * the runtime arm already carried is unchanged.
 */

const ROOT = join(import.meta.dirname, "../../..");
const DIR = join(ROOT, "tools/openclinxr/evidence/motion-backend-bakeoff");
const EVAL = join(DIR, "runtime-goal-eval.json");
const DESCRIPTOR = join(DIR, "runtime-goal-descriptor.json");
const ACTOR = join(ROOT, "apps/ui-xr/public/generated-humanoids/mpfb-clinical-nurse-adult.glb");

/**
 * The repo's established contact tolerance, taken from the contact-window contract rather than
 * invented here: `the-contact-constraint-holds-across-its-window.test.ts` fails an effector that sits
 * more than 0.03 m from its target inside a hold window. A body-region contact that wanders further
 * than the same allowance is not holding contact either.
 */
const CONTACT_TOLERANCE_M = 0.03;

/** MakeHuman names its twist segments `*02`. They twist; they must not be IK bend links. */
const TWIST = /(?:upperarm|lowerarm|upperleg|lowerleg)02\./u;

type Vec = { x: number; y: number; z: number };
type Frame = { targetWorld: Vec; bones: Record<string, Vec> };
const dist = (a: Vec, b: Vec): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const frames = (): Frame[] =>
  (JSON.parse(readFileSync(EVAL, "utf8")) as { oscillation: Frame[] }).oscillation;
const descriptor = (): { goals: { kind?: string; regionRole?: string; chainRoles?: string[] }[] } =>
  JSON.parse(readFileSync(DESCRIPTOR, "utf8")) as { goals: { kind?: string; regionRole?: string; chainRoles?: string[] }[] };
const spread = (xs: number[]): number => Math.max(...xs) - Math.min(...xs);

describe("the body-region goal follows the body", () => {
  it("(0) VACUITY GUARD: both artifacts exist and the oscillation actually oscillates", () => {
    // Without this, clause (1) passes trivially against a still actor: if the pelvis never moves,
    // a world-pinned target trivially "tracks" it.
    expect(existsSync(EVAL), `${EVAL} is missing`).toBe(true);
    expect(existsSync(DESCRIPTOR), `${DESCRIPTOR} is missing`).toBe(true);
    const f = frames();
    expect(f.length, "fewer than four oscillation frames — nothing to measure across").toBeGreaterThanOrEqual(4);
    const pelvisTravel = spread(f.map((x) => (x.bones["pelvisR"] ?? x.bones["pelvisL"])!.y));
    expect(pelvisTravel, "the pelvis does not move, so nothing is being tracked or failing to track")
      .toBeGreaterThan(CONTACT_TOLERANCE_M);
  });

  it("(1) the goal stays in contact with its region while the body moves (was a RED; see header)", () => {
    const f = frames();
    // breastR is the bone nearest the descriptor's `rightChestSurface`. If the target tracked the
    // region, this distance is near-constant; before the fix its spread equalled the pelvis travel.
    const d = f.map((x) => dist(x.targetWorld, x.bones["breastR"]!));
    expect(spread(d), `target-to-region distance varies by ${(spread(d) * 100).toFixed(2)} cm across the cycle`)
      .toBeLessThanOrEqual(CONTACT_TOLERANCE_M);
    // COUNTERWEIGHT: freezing the actor would make the line above pass. Tie the assertion to the
    // DRIVER — the target must follow most of the region's own travel, not merely fail to diverge.
    const pelvisTravel = spread(f.map((x) => (x.bones["pelvisR"] ?? x.bones["pelvisL"])!.y));
    const targetTravel = spread(f.map((x) => x.targetWorld.y));
    expect(targetTravel, `the target moved ${(targetTravel * 100).toFixed(2)} cm while the body moved ${(pelvisTravel * 100).toFixed(2)} cm`)
      .toBeGreaterThan(pelvisTravel / 2);
  });

  it("(2) the declared IK chain names no twist segment (was a RED; see header)", () => {
    const goal = descriptor().goals.find((g) => g.kind === "body_region_contact");
    expect(goal, "the descriptor declares no body_region_contact goal").toBeDefined();
    const chain = goal?.chainRoles ?? [];
    expect(chain.length, "the goal declares no chainRoles").toBeGreaterThan(0);
    for (const link of chain) {
      expect(link, `${link} is a MakeHuman twist segment and must not be an IK bend link`).not.toMatch(TWIST);
    }
  });

  /**
   * PROVENANCE GUARD (added with the stale-eval fix, #0): this file reads cached numbers from
   * runtime-goal-eval.json, so a stale eval would make every clause above green about a rig that no
   * longer ships. The eval must name the digest of the actor on disk — re-run runtime-goal-eval.mts
   * after any actor rebake. A digest, not a commit: the commit moves for reasons that do not
   * invalidate the numbers; the actor bytes move exactly when they do.
   */
  it("(3) the eval names the actor digest that is on disk", () => {
    expect(existsSync(ACTOR), `${ACTOR} is missing — there is no actor to compare against`).toBe(true);
    const r = JSON.parse(readFileSync(EVAL, "utf8")) as { actorAssetSha256?: string };
    const onDisk = createHash("sha256").update(readFileSync(ACTOR)).digest("hex");
    expect(
      r.actorAssetSha256,
      `eval was measured against actor ${String(r.actorAssetSha256 ?? "").slice(0, 16)} but the shipped actor is ${onDisk.slice(0, 16)} — re-run runtime-goal-eval.mts`,
    ).toBe(onDisk);
  });
});
