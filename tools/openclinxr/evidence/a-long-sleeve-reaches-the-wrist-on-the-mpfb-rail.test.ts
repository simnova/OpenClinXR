import { existsSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";

/**
 * **No actor has ever worn a long sleeve, and the reason on record is wrong for the MPFB rail.**
 *
 * #199 concluded: *"No body-surface-derived garment can have a long sleeve on a body with no
 * forearm."* That is true for Anny and false for MPFB, and the issue itself named the measurement
 * nobody had taken — *"Nobody has counted the vertices in the forearm band."*
 *
 * Counted 2026-08-14. Body vertices within 8 cm of the middle 70% of the elbow→wrist segment, joints
 * from the skin's **inverse bind matrices** (not summed node translations — that gave a wrist 42 cm
 * above the head):
 *
 *   body                        rail    forearm verts   max radius   elbow->wrist
 *   --------------------------  ------  -------------   ----------   ------------
 *   adult_male_street_casual    Anny          **0**          --         31.5 cm
 *   mpfb-peds-nurse-kevin       MPFB        **122**       4.4 cm        24.9 cm
 *   mpfb-ob-patient-aisha       MPFB        **192**       6.1 cm        23.8 cm
 *
 * The Anny forearm is **absent, not narrow**. The MPFB forearm is real surface. So this is a rail
 * split (D11), not a body-shape blocker: **a long sleeve is achievable today on MPFB.**
 *
 * ## THE GARMENT IS ALREADY ON DISK, LICENCE-CLEAN AND UNEXTRACTED (D1)
 *
 * `toigo_fisherman_sweater` — `# license CC0`, `# author MRT`, read from its own `.mhclo` header
 * inside the already-acquired `shirts01_cc0.zip`. **Seven of that pack's ten garments were never
 * extracted**; only the t-shirt, polo and crude t-shirt were. It is the only long-sleeve garment
 * anywhere in the cache. Nothing needs acquiring and nothing needs authoring — this is a wire.
 *
 * **One trap in that pack, now in the ledger:** `skalldyrssuppe_tube_top_funky_colors` is **AGPL3**
 * inside an archive named `_cc0`. Do NOT glob `clothes/*`. Extract by name.
 *
 * **A threshold that does NOT transfer:** the hair pack refuses styles with helper-vertex refs at or
 * above 13,380. Every garment in shirts01 exceeds that, **including the `toigo_basic_tucked_t-shirt`
 * shipping on two actors today** (maxRef 98,857). Garments fit BEFORE the #318 helper strip, so that
 * criterion is a hair criterion. I read it as a refusal first and was wrong.
 *
 * ## THE KNOWN-GOOD IS THE SAME FITTER ON THE SAME BODIES (SS9h)
 *
 * `ClothesService.fit_clothes_to_human` already put `toigo_basic_tucked_t-shirt` (2,700 tris) on
 * aisha and the child, and `#381` used the identical path to fit hair. Same fitter, same pack, same
 * topology. A long sleeve differs only in which `.mhclo` is named.
 *
 * ## THE CHEAP FIXES THIS REFUSES
 *
 *   treatment                                        | (1) reaches wrist | (2) fitted | (3) arm covered | result
 *   -------------------------------------------------|-------------------|------------|-----------------|--------
 *   a) today (t-shirt only)                          |    **FAIL**       |    pass    |      pass       | REFUSED
 *   b) stretch the t-shirt's sleeve down the arm     |      pass         |    pass    |    **FAIL**     | REFUSED
 *   c) add a free-floating tube from elbow to wrist  |      pass         |  **FAIL**  |      pass       | REFUSED
 *   d) fit the CC0 long-sleeve .mhclo to the MPFB body|     pass         |    pass    |      pass       | ALL PASS
 *
 * **(c) is the one to watch and it is why clause (2) exists.** §6t records FIVE successive shoulder
 * gates passing on detached geometry — proximity and extremes cannot tell a fitted garment from a
 * floating tube. Clause (2) requires the sleeve to be **skinned to the forearm bones**, which a free
 * tube is not, and pins its triangle count against a plausible floor so a 12-triangle token fails.
 *
 * **(b) is why clause (3) exists.** Scaling a short sleeve to wrist length thins it to a ribbon: the
 * cuff arrives but the arm between elbow and wrist is bare. Clause (3) samples the forearm at several
 * heights and requires garment surface near the body at each, so reaching the wrist by a thread fails.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227): (1) and (3) are REDS and fail on 3 of 3 MPFB actors today
 * — measured reach along elbow->wrist is **0.00 on all three**, i.e. no upper-body garment comes
 * within 9 cm of the forearm at all. (2) is a counterweight and is **non-vacuous today**: it asserts
 * every upper-body garment is skinned and above a token triangle floor, which the shipping t-shirts
 * and scrub tops satisfy. An earlier draft scoped it to arm-proximate geometry only — that was
 * VACUOUS, because `sleeveTris` is 0 on 3/3, and it is corrected here rather than shipped (SS7t).
 *
 * NOT TESTED:
 *   - **The Anny rail.** Its forearm is absent (0 verts) and this contract deliberately does not
 *     require a long sleeve there. Anny actors keep short sleeves until their body gains a forearm.
 *   - **That it looks right.** This bounds geometry: reach, skinning, coverage. A graded capture is
 *     the only appearance evidence and that grade is the orchestrator's.
 *   - **Poke-through.** Whether the sleeve intersects the arm rather than covering it is unmeasured;
 *     #338's between-layer instrument is the right tool and is deliberately unbuilt.
 *   - **Which actor should wear one.** Clinical staging (a nurse in long sleeves vs a patient in a
 *     gown) is a staging decision (SS8y), not an implementer one.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const GENERATED = join(REPO_ROOT, "apps/ui-xr/public/generated-humanoids");

const MPFB = ["mpfb-ob-patient-aisha", "mpfb-peds-nurse-kevin", "mpfb-peds-patient-child"] as const;

/** A sleeve "reaches the wrist" when garment surface exists past this much of elbow->wrist. */
const WRIST_REACH_T = 0.75;
/** Below this a "sleeve" is a token, not a garment. The shipping t-shirt is 2,700 tris. */
const MIN_SLEEVE_TRIS = 300;
/** Sampled fractions along the forearm that must each carry garment surface nearby. */
const FOREARM_SAMPLES = [0.3, 0.5, 0.7] as const;
/** Garment surface within this of the body counts as covering it. */
const COVER_RADIUS_M = 0.09;

type Row = {
  actor: string;
  /** Furthest point along elbow->wrist reached by any garment vertex, 0..1. */
  reachT: number;
  sleeveTris: number;
  sleeveSkinned: boolean;
  /** Of FOREARM_SAMPLES, how many have garment surface within COVER_RADIUS_M. */
  coveredSamples: number;
  /** Every upper-body garment, arm-proximate or not. Keeps clause (2) non-vacuous today. */
  allUpperTris: number;
  allUpperSkinned: boolean;
};

const io = new NodeIO();

function jointWorld(m: number[]): number[] {
  const t = [m[12]!, m[13]!, m[14]!];
  return [
    -(m[0]! * t[0] + m[1]! * t[1] + m[2]! * t[2]),
    -(m[4]! * t[0] + m[5]! * t[1] + m[6]! * t[2]),
    -(m[8]! * t[0] + m[9]! * t[1] + m[10]! * t[2]),
  ];
}

async function measure(actor: string): Promise<Row | null> {
  const file = join(GENERATED, `${actor}.glb`);
  if (!existsSync(file)) return null;
  const doc = await io.read(file);
  const skin = doc.getRoot().listSkins()[0];
  if (!skin) return null;
  const ibm = skin.getInverseBindMatrices();
  const joints = skin.listJoints();
  if (!ibm) return null;
  const pos: Record<string, number[]> = {};
  const m = new Array<number>(16);
  for (let i = 0; i < joints.length; i += 1) {
    ibm.getElement(i, m);
    pos[(joints[i]?.getName() ?? `j${i}`).toLowerCase()] = jointWorld(m);
  }
  const names = Object.keys(pos);
  const elbow = names.find((n) => /^(forearm|lowerarm01)\.?l$/u.test(n)) ?? names.find((n) => /forearm|lowerarm01/u.test(n));
  const wrist = names.find((n) => /^(wrist|hand)\.?l$/u.test(n)) ?? names.find((n) => /^wrist|^hand/u.test(n));
  if (!elbow || !wrist) return null;
  const E = pos[elbow]!;
  const W = pos[wrist]!;
  const d = [W[0]! - E[0]!, W[1]! - E[1]!, W[2]! - E[2]!];
  const L2 = d[0]! ** 2 + d[1]! ** 2 + d[2]! ** 2;

  let reachT = 0;
  let sleeveTris = 0;
  let sleeveSkinned = true;
  let allUpperTris = 0;
  let allUpperSkinned = true;
  const garment: number[][] = [];
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const name = prim.getMaterial()?.getName() ?? "";
      // Upper-body garments only: a trouser leg is not a sleeve.
      if (!/shirt|sweater|sleeve|top|scrub/iu.test(name)) continue;
      const p = prim.getAttribute("POSITION");
      if (!p) continue;
      const v = [0, 0, 0];
      let touchedArm = false;
      // Counted for clause (2) regardless of arm proximity: every upper-body garment must be
      // fitted, today and after. Restricting to the arm made this vacuous (measured 2026-08-14:
      // sleeveTris 0 on 3/3, because no garment reaches within 9cm of elbow->wrist).
      allUpperTris += (prim.getIndices()?.getCount() ?? 0) / 3;
      if (!prim.getAttribute("JOINTS_0")) allUpperSkinned = false;
      for (let i = 0; i < p.getCount(); i += 1) {
        p.getElement(i, v);
        const w = [v[0]! - E[0]!, v[1]! - E[1]!, v[2]! - E[2]!];
        const t = (w[0]! * d[0]! + w[1]! * d[1]! + w[2]! * d[2]!) / L2;
        if (t < 0) continue;
        const r = Math.hypot(w[0]! - t * d[0]!, w[1]! - t * d[1]!, w[2]! - t * d[2]!);
        if (r > COVER_RADIUS_M) continue;
        garment.push([...v]);
        if (t > reachT) reachT = Math.min(1.5, t);
        touchedArm = true;
      }
      if (touchedArm) {
        sleeveTris += (prim.getIndices()?.getCount() ?? 0) / 3;
        if (!prim.getAttribute("JOINTS_0")) sleeveSkinned = false;
      }
    }
  }
  let coveredSamples = 0;
  for (const f of FOREARM_SAMPLES) {
    const target = [E[0]! + f * d[0]!, E[1]! + f * d[1]!, E[2]! + f * d[2]!];
    if (garment.some((g) => Math.hypot(g[0]! - target[0]!, g[1]! - target[1]!, g[2]! - target[2]!) < COVER_RADIUS_M)) {
      coveredSamples += 1;
    }
  }
  return { actor, reachT, sleeveTris, sleeveSkinned, coveredSamples, allUpperTris, allUpperSkinned };
}

const rows = (await Promise.all(MPFB.map(measure))).filter((r): r is Row => r !== null);

/**
 * An empty enumeration must FAIL, never pass vacuously (SS7t). Plain `it` on purpose: an `it.fails`
 * cannot guard its own vacuity — it is satisfied by ANY failure, including this guard throwing.
 */
function requireMeasured(): void {
  expect(rows.length, `MPFB actors with a skin and locatable elbow/wrist joints (of ${MPFB.length})`).toBe(
    MPFB.length,
  );
}

describe("a long sleeve reaches the wrist on the MPFB rail", () => {
  it("(1) RED: at least one MPFB actor has garment surface past the forearm midpoint", () => {
    requireMeasured();
    const reaching = rows.filter((r) => r.reachT >= WRIST_REACH_T).map((r) => r.actor);
    expect(
      reaching.length,
      `MPFB actors whose upper-body garment reaches t>=${WRIST_REACH_T} along elbow->wrist (today every actor stops at the short-sleeve cuff; measured reach: ${rows.map((r) => `${r.actor} ${r.reachT.toFixed(2)}`).join(", ")})`,
    ).toBeGreaterThanOrEqual(1);
  });

  it("(2) COUNTERWEIGHT: any sleeve on the arm is fitted geometry, not a floating tube", () => {
    // Refuses (c). SS6t: five successive shoulder gates passed on detached geometry, because
    // proximity and extremes cannot distinguish a fitted garment from a tube parked nearby.
    requireMeasured();
    // Measured 2026-08-14: sleeveTris is 0 on 3/3 because nothing reaches the forearm, so an
    // arm-only assertion here would be VACUOUS (SS7t). This asserts EVERY upper-body garment is
    // skinned and non-token — true today (t-shirts/scrubs, 2,700+ tris, all skinned) and still the
    // thing that refuses a floating tube once a sleeve exists.
    const bad = rows
      .filter((r) => !r.allUpperSkinned || r.allUpperTris < MIN_SLEEVE_TRIS)
      .map(
        (r) =>
          `${r.actor}: upper-body garment ${r.allUpperTris} tris, skinned=${r.allUpperSkinned} (need >=${MIN_SLEEVE_TRIS} tris AND JOINTS_0 — unskinned or token geometry is a floating tube, not a garment)`,
      );
    expect(bad, "upper-body garments that are not fitted geometry").toEqual([]);
  });

  it("(3) RED: the forearm is covered along its length, not just at the cuff", () => {
    // Refuses (b): stretching a short sleeve to wrist length thins it to a ribbon — the cuff arrives
    // and the arm between stays bare. SS11s: bound the distribution, not the extreme.
    requireMeasured();
    const bare = rows
      .filter((r) => r.coveredSamples < FOREARM_SAMPLES.length)
      .map(
        (r) =>
          `${r.actor}: garment surface found at ${r.coveredSamples}/${FOREARM_SAMPLES.length} sampled forearm heights`,
      );
    expect(bare.length, `MPFB actors with a bare forearm gap (need at least one fully covered)`).toBeLessThan(
      rows.length,
    );
  });
});
