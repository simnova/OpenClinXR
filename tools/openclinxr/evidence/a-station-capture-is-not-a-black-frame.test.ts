import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { regionLuminance } from "./lib/png-region-luminance.js";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * **A station can render NOTHING and every contract in this repo still passes.**
 *
 * Measured 2026-08-14. `peds_asthma_parent_anxiety_v1` renders a black viewport — no room, no floor,
 * no cast — while its room asset satisfies the shape contract (#407, aspect 1.02), the stand-off
 * contract (#406, thickness 0.109), the distinctness contract (#405, hash + geometry), and every
 * `run:`/`changed:`/`exists:` proof attached to all three. Reproduced three times with byte-identical
 * camera output, so it is not a load flake.
 *
 * **Nothing mechanical noticed.** I noticed, by opening the PNG, a cycle after landing it.
 *
 * ## THE MEASUREMENT — viewport luminance, two known-goods
 *
 * Sampling the 3D viewport region of each captured station frame (left 68%, excluding the top strip
 * and the status bar), every 6th pixel:
 *
 *   frame                                   | mean |   sd | non-black
 *   ----------------------------------------|------|------|----------
 *   ed_chest_pain_priority_v1               | 76.1 | 78.2 | **70.3 %**
 *   telehealth_diabetes_health_literacy_v1  |136.6 | 55.9 | **100.0 %**
 *   **peds_asthma_parent_anxiety_v1**       |  0.2 |  4.9 | **0.1 %**
 *
 * Two known-goods and one broken frame, separated by nearly three orders of magnitude. The bound is
 * `FLOOR_FRACTION x (the LOWEST known-good's non-black share)`, recomputed at test time — on today's
 * frames `0.5 x 70.3 = 35.2 %`, and peds measures 0.1 %, failing by **350x**. Margin computed before
 * the bound was written; this is not a threshold fitted to clear an observation.
 *
 * **Deliberately a catastrophe gate, not a quality gate.** It answers "did a learner see ANYTHING",
 * which is the one appearance question a machine can answer honestly. Whether the room looks *right*
 * stays a human grade — that division is the whole point (§8n: `min-bytes:` proves a renderer ran,
 * nothing more, and a 97 KB black PNG cleared every byte floor this repo has).
 *
 * ## WHY A BYTE FLOOR CANNOT DO THIS
 *
 * The black peds frame is **89-97 KB**; the working corridor frame was 134 KB; the ED frame is 327 KB.
 * A floor low enough to admit a legitimately sparse station admits the black one too. Luminance
 * variance separates them because a black viewport has almost none, whatever it weighs.
 *
 * ## THREE HYPOTHESES I KILLED BEFORE WRITING THIS (§9g)
 *
 *   1. *"The eye is inside geometry."* **No** — nearest vertex to the derived eye is **1.084 m**
 *      (ceiling). The ED bay's eye is CLOSER to its wall at 0.534 m and renders fine.
 *   2. *"The bake lost its materials."* **No** — both rooms carry 3 materials / 6 textures, white
 *      base colour, textured, double-sided, no emissive. Structurally identical.
 *   3. *"Corridor geometry explains it."* **No** — #407 replaced the corridor with a 1.02-aspect room
 *      and the frame went black anyway. That was a hypothesis I explicitly refused to file, and
 *      refusing it was right.
 *
 * **A limit of my own instrument, stated rather than hidden:** the clearance figure in (1) was computed
 * with the room centred on its own AABB, but `positionInfinigenRoom` centres Z on the PARAMETRIC
 * SHELL's floor centre. So it approximates the runtime frame. The remaining candidates therefore
 * involve placement or the live scene, and **the next measurement is a live scene dump at the derived
 * eye** — not another capture, and not another offline guess.
 *
 * ## THE CHEAP FIXES THIS REFUSES
 *
 *   treatment                                        | (1) non-black | (2) known-good | (3) vacuity | result
 *   --------------------------------------------------|---------------|----------------|-------------|--------
 *   a) today                                          |   **FAIL**    |      pass      |    pass     | REFUSED
 *   b) delete the peds capture so it is not measured  |     pass      |      pass      |  **FAIL**   | REFUSED
 *   c) darken the ED frame so the bar drops           |   **FAIL**    |   **FAIL**     |    pass     | REFUSED
 *   d) make the station render                        |     pass      |      pass      |    pass     | ALL PASS
 *
 * **(b) is the one to watch.** This contract reads captured artifacts, so the cheapest green is to stop
 * capturing the broken station. Clause (3) requires the population to still contain the subject.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227): **(1) is the sole RED.** **(2) and (3) pass today** and are
 * true nets.
 *
 * NOT TESTED:
 *   - **Why the station is black.** This gate detects, it does not diagnose. Cause NOT DETERMINED.
 *   - **Whether a non-black frame looks correct.** Explicitly out of scope — that is a human grade.
 *   - **Freshness.** These are on-disk artifacts (§7s). The directory is named `latest` and has held
 *     three-hour-old frames beside fresh ones. A tree-stamped capture would be strictly better and is
 *     not built; until then a stale PASS is possible and this contract cannot see it.
 *   - **Stations with no capture on disk.** Only what has been captured is measured.
 *
 * ## FIXED (2026-08-17) — extract L-sheet + doorway look-ray reject
 *
 * Two layers, both required:
 * 1. `719cadf8` dropped interior-intruding hull faces at extract (10 front-facing
 *    L-sheet faces on peds, 0 on ED). Capture went 0.1% → 97% non-black but was a
 *    full-frame surface close-up — orchestrator refused to flip then.
 * 2. Camera scoring now rejects a doorway candidate whose eye→look ray hits
 *    /wall|floor|ceiling|exterior/i before the look point. Peds left corner
 *    `(-2.42, 1.90)` sat behind `kitchen_00wall` (hit 0.94 m, actors 2.05 m).
 *    Surviving eye `(-1.18, 1.70, 1.90)`.
 *
 * Orchestrator pixel grade of the post-scoring capture: floor yes; two+ walls yes;
 * actors (nurse + child) yes; not a single rectangle. ED known-good still a room.
 * (1) flips because the station shows an interior, not because the bound moved.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const CAPTURE_DIR =
  process.env.OPENCLINXR_FRAME_PROBE_DIR ?? join(REPO_ROOT, ".openclinxr/evidence/ui-xr-environment-room/latest");

const SUBJECT = "peds_asthma_parent_anxiety_v1";
const KNOWN_GOOD = "ed_chest_pain_priority_v1";
/** Half the lowest known-good's share. Generous: a sparse station is legitimate, a black one is not. */
const FLOOR_FRACTION = 0.5;
/** Luminance below this counts as black. A rendered dark surface still carries texture noise above it. */
const BLACK_LUMA = 12;

type Frame = { id: string; nonBlackPct: number; mean: number };

async function readFrames(): Promise<Frame[]> {
  if (!existsSync(CAPTURE_DIR)) return [];
  const out: Frame[] = [];
  for (const file of readdirSync(CAPTURE_DIR).filter((f) => f.endsWith("-room.png")).sort()) {
    const abs = join(CAPTURE_DIR, file);
    if (!statSync(abs).isFile()) continue;
    // The 3D viewport: left 68%, excluding the top strip and the bottom status bar.
    const r = regionLuminance(readFileSync(abs), { left: 0, top: 0.1, width: 0.68, height: 0.8 }, { blackLuma: BLACK_LUMA, step: 6 });
    if (!r) continue;
    out.push({ id: file.replace(/-room\.png$/u, ""), nonBlackPct: r.nonBlackPct, mean: r.mean });
  }
  return out;
}

const frames = await readFrames();

/**
 * An empty enumeration must FAIL, never pass vacuously (§7t). Plain `it` on purpose: an `it.fails`
 * cannot guard its own vacuity — it is satisfied by ANY failure, including this guard throwing.
 */
function requireFrames(): { all: Frame[]; good: Frame } {
  expect(frames.length, `station frames read under ${CAPTURE_DIR}`).toBeGreaterThanOrEqual(2);
  const good = frames.find((f) => f.id === KNOWN_GOOD);
  expect(good, `${KNOWN_GOOD} frame present as the known-good column`).toBeDefined();
  return { all: frames, good: good as Frame };
}

describe("a station capture is not a black frame", () => {
  it("(1) every captured station shows something in its viewport", () => {
    const { all, good } = requireFrames();
    const floor = FLOOR_FRACTION * good.nonBlackPct;
    const black = all.filter((f) => f.nonBlackPct < floor);
    expect(
      black.map((f) => `${f.id} ${f.nonBlackPct.toFixed(1)}% non-black (mean luma ${f.mean.toFixed(1)})`),
      `floor ${floor.toFixed(1)}% = ${FLOOR_FRACTION} x the known-good's ${good.nonBlackPct.toFixed(1)}%`,
    ).toEqual([]);
  });

  it("(2) COUNTERWEIGHT: the known-good frame is not darkened to lower the bar", () => {
    // Refuses (c). The floor is a function of this frame, so dimming it widens the gate for everyone.
    const { good } = requireFrames();
    expect(good.nonBlackPct, `${KNOWN_GOOD} non-black share, measured 70.3% on 2026-08-14`).toBeGreaterThanOrEqual(50);
  });

  it("(3) COUNTERWEIGHT: the broken station is still in the measured population", () => {
    // Refuses (b). This contract reads artifacts, so the cheapest green is to stop capturing the
    // station that fails. The subject must remain present until it genuinely passes.
    const { all } = requireFrames();
    expect(all.map((f) => f.id), `${SUBJECT} must remain captured and measured`).toContain(SUBJECT);
  });
});
