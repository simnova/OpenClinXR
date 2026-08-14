import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";
import {
  HAIR_PACK_DIR,
  classifyHairPack,
} from "../../../tools/openclinxr/asset-pipeline/makeclothes/hair-licence-classify.js";

/**
 * **A licence-cleared, weighted hair FIT ships on the library rail and no cast actor consumes it.**
 * This is D9's characteristic defect stated exactly: the proven component is wired, and the thing a
 * learner actually sees does not use it.
 *
 * Measured 2026-08-14 on the shipped bytes:
 *
 *   glb                                        painted scalp     FITTED HAIR GEOMETRY
 *   -----------------------------------------  ---------------   ----------------------------
 *   body-param-adult_lean_female-library        2,160 tris        **4,976 tris, weighted**
 *   body-param-adult_heavy_male-library         1,804 tris        none (licence-derived skip)
 *   mpfb-ob-patient-aisha       (CAST)          2,536 tris        **NONE**
 *   mpfb-peds-patient-child     (CAST)          2,208 tris        **NONE**
 *   mpfb-peds-nurse-kevin       (CAST)          2,792 tris        **NONE**
 *
 * The library primitive is `openclinxr_fitted_hair_toigo_blunt_bob_with_bangs_adult_lean_female_mat`,
 * weighted (carries `JOINTS_0`), produced by `embed_library_hair.py` ->
 * `ClothesService.fit_clothes_to_human`. That script is invoked from exactly ONE place —
 * `body-param-cli.ts:1199` — so the cast bake never calls it.
 *
 * The scalp the cast actors DO have is a painted material region on the body mesh. Its boundary is
 * the hairline, and the hairline is the top visible face defect on all three actors: a hard
 * stair-step, graded in pixels 2026-08-13 and again 2026-08-14. A structure-pass render shows a
 * continuous smooth dome with NO geometric edge there, which is why three separate geometric
 * instruments measured nothing — they all read the body mesh, and the defect is the silhouette of a
 * painted region with no alpha to soften it. Fitted geometry replaces that boundary with an actual
 * object; it does not merely soften it.
 *
 * ## THE KNOWN-GOOD IS THE SAME FITTER, SAME PACK, ON A SHIPPED FILE (SS9h)
 *
 * `body-param-adult_lean_female-library.glb` is not an aspiration — it is 4,976 triangles of weighted
 * hair on disk right now, from this pack, through this fitter, behind this licence gate. Clause (4)
 * asserts it stays that way, so this file always carries the working reference beside the gap.
 *
 * ## THE LICENCE GATE IS REAL AND IS NOT MINE TO RELAX
 *
 * `classifyHairPack` parses each `.mhclo`'s OWN header. Measured: **25 styles, 9 usable**, 10 refused
 * copyleft (AGPL3 — a hard refusal), 4 unlicensed, 2 refused topology (helper-vertex refs at or above
 * 13,380). Clause (2) reads that classifier live rather than trusting a list I typed, so a style that
 * changes licence family stops being usable the moment the header says so.
 *
 * **The masculine gap is real and is NOT an excuse.** Every usable style is a feminine bob, so
 * `body-param-adult_heavy_male-library` is a RECORDED SKIP and kevin has no clean option today. A bob
 * on a male nurse would regress realism, which is worse than the stair-step it would replace.
 *
 * ## SCOPE: ONE ACTOR, AND THAT IS A CONTRACT CLAUSE, NOT A REQUEST
 *
 * Per the peer contract at
 * `.openclinxr/handoffs/mpfb-human-realism-peer-from-equipment-lane-2026-08-14.md`, slice 1 is
 * **aisha only**. Clause (1) therefore NAMES her rather than counting actors — a named subject cannot
 * be declared out of scope, so no skip list can satisfy it — and clause (3) asserts the child and
 * kevin gain nothing, which turns the peer's fence into something a machine checks instead of prose
 * a worker may reasonably read past (SS6d).
 *
 * ## THE CHEAP FIXES THIS REFUSES
 *
 *   treatment                                          | (1) aisha wears | (2) licence | (3) scope held | (4) known-good | result
 *   ---------------------------------------------------|-----------------|-------------|----------------|----------------|--------
 *   a) today                                           |    **FAIL**     |    pass     |      pass      |     pass       | REFUSED
 *   b) fit any of the 25 styles, ignore the header     |      pass       |  **FAIL**   |      pass      |     pass       | REFUSED
 *   c) bob on every actor so hair looks busy           |      pass       |    pass     |   **FAIL**     |     pass       | REFUSED
 *   d) move the library hair off the library rail      |      pass       |    pass     |      pass      |   **FAIL**     | REFUSED
 *   e) call the proven fitter for aisha alone          |      pass       |    pass     |      pass      |     pass       | ALL PASS
 *
 * **(b) is why clause (2) exists**: 10 of the 25 cached styles are AGPL3 and 4 are unlicensed, so
 * globbing the pack would put copyleft geometry in a shipped asset. **(c) is why clause (3) exists**:
 * the cheapest way to make a hair slice look impressive is to run it over the whole cast, and on
 * kevin that means a feminine bob on a male nurse.
 *
 * A `reject_measured` close — "no licensed style fits this basemesh, here is the ledger" — is an
 * ALLOWED and successful outcome. Authoring a replacement shell to avoid it is not.
 *
 * ## WHY THIS IS A DARK-FACTORY SLICE (D1/D9)
 *
 * Nothing here authors geometry. The `.mhclo` assets are cached, the licence gate exists, the fitter
 * exists and has produced a good result on another body, and the invocation is one finish step. The
 * step being moved from hand-authored to deterministic is HAIR: today it is a painted region whose
 * boundary is a defect on every actor; after this it is a fitted, weighted asset chosen by a
 * machine-checked licence family. A fourth actor gets hair the day it ships.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227): (1) is the sole RED and fails today. (2), (3), (4) and
 * (5) are counterweights and all pass today. They are independent of what (1) measures: fitting
 * licence-clean hair onto aisha cannot change the licence family of a style, cannot add geometry to
 * the child or kevin, cannot alter the library rail, and cannot remove aisha's painted region.
 *
 * NOT TESTED:
 *   - **That the hairline stair-step goes away.** This asserts geometry is present and weighted, not
 *     that the silhouette improved. Only a graded head-framed capture settles that, and that grade is
 *     the orchestrator's.
 *   - **Which style suits which actor.** Any licence-clean style satisfies this; matching a style to
 *     an actor's age and presentation is a staging decision (SS8y), not an implementer one.
 *   - **Kevin and the child.** Both are expected to remain bare. Clause (3) asserts they gain
 *     nothing; nothing here says a licensed masculine style has been found.
 *   - **Physics or motion.** Weighted-to-a-head-joint is asserted; hair that moves believably is not.
 *   - **Poke-through.** Whether fitted hair intersects the scalp or the ears is unmeasured here.
 */

/**
 * ## RE-PREMISED (#393) — the painted scalp is required without fitted hair and absent under it
 *
 * #387 retired aisha's placeholder scalp paint where #381's fitted hair replaced it
 * (`body_param_stage.scalp_placeholder_retired_for`); measured on the shipped bytes she now
 * carries 4,976 tris of weighted fitted hair and 0 painted scalp tris. Clause (5) below still
 * asserted the OLD premise — "the painted scalp region survives on every cast actor" — so it
 * failed on aisha. The re-premise matches the two contracts #387 already corrected
 * (`mpfb-scalp-hair-region.test.ts`, `hairline-is-a-line-not-a-sawtooth.test.ts`):
 *
 * - the region is REQUIRED on the figures with NO fitted hair (the child, kevin) — the 500-tri
 *   floor is unchanged;
 * - the region must be ABSENT on the figure that has it (aisha) — any painted scalp under
 *   fitted hair is the 2.8%-luminance placeholder #387 closed.
 *
 * Measured on the shipped bytes 2026-08-14 (this worktree): child 2,208 tris, kevin 2,792 tris,
 * aisha 0 tris, library known-good rail reference unchanged at 2,160 tris.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const GENERATED = join(REPO_ROOT, "apps/ui-xr/public/generated-humanoids");
const CANDIDATES = join(REPO_ROOT, "apps/ui-xr/public/xr-assets/humanoids/candidates");

/** The shipped cast — the actors a learner actually meets. */
const CAST = ["mpfb-ob-patient-aisha", "mpfb-peds-patient-child", "mpfb-peds-nurse-kevin"] as const;

/** The library rail's proof that this fitter works. Asserted unchanged by clause (4). */
const KNOWN_GOOD = "body-param-adult_lean_female-library";

/** A fitted hair primitive is named by `embed_library_hair.py` with this prefix. */
const FITTED_HAIR = /openclinxr_fitted_hair_/i;
/** The painted region that exists today. Present-or-absent only; not the subject of clause (1). */
const PAINTED_SCALP = /native_scalp_hair_surface/i;

/** Below this a "hair" primitive is a token, not a haircut. Library reference is 4,976. */
const MIN_FITTED_TRIS = 800;

/**
 * SLICE 1 IS ONE ACTOR. Peer contract
 * `.openclinxr/handoffs/mpfb-human-realism-peer-from-equipment-lane-2026-08-14.md`: aisha only,
 * because every licence-clean style is feminine and kevin is a recorded male skip. Naming the actor
 * — rather than counting actors — is also what removes the skip-list cheat entirely: a named subject
 * cannot be declared out of scope.
 */
const SLICE_1_ACTOR = "mpfb-ob-patient-aisha";
/** #393 — the shipped base id of the figure whose placeholder scalp paint is retired
 * (real fitted hair on disk). See body_param_stage.scalp_placeholder_retired_for. */
const RETIRED_FIGURE = "mpfb-ob-patient-aisha";
/** The two actors slice 1 must leave exactly as they are. Clause (3) enforces the peer's fence. */
const OUT_OF_SLICE = ["mpfb-peds-patient-child", "mpfb-peds-nurse-kevin"] as const;
/** Their fitted-hair triangle counts today, measured 2026-08-14. Both zero, and must stay zero. */
const OUT_OF_SLICE_FITTED_TRIS_TODAY = 0;

type HairRow = {
  id: string;
  exists: boolean;
  fittedTris: number;
  fittedWeighted: boolean;
  fittedNames: string[];
  paintedTris: number;
};

const io = new NodeIO();

async function measure(dir: string, id: string): Promise<HairRow> {
  let doc;
  try {
    doc = await io.read(join(dir, `${id}.glb`));
  } catch {
    return { id, exists: false, fittedTris: 0, fittedWeighted: false, fittedNames: [], paintedTris: 0 };
  }
  let fittedTris = 0;
  let paintedTris = 0;
  let fittedWeighted = true;
  const fittedNames: string[] = [];
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const name = prim.getMaterial()?.getName() ?? "";
      const tris = (prim.getIndices()?.getCount() ?? 0) / 3;
      if (FITTED_HAIR.test(name)) {
        fittedTris += tris;
        fittedNames.push(name);
        if (!prim.getAttribute("JOINTS_0")) fittedWeighted = false;
      } else if (PAINTED_SCALP.test(name)) {
        paintedTris += tris;
      }
    }
  }
  return { id, exists: true, fittedTris, fittedWeighted, fittedNames, paintedTris };
}

/** Live licence read — never a list typed into this file. */
const classification = classifyHairPack(HAIR_PACK_DIR);
const usableStyles = classification.assets.filter((a) => a.usable).map((a) => a.asset);

const castRows = await Promise.all(CAST.map((id) => measure(GENERATED, id)));
const knownGood = await measure(CANDIDATES, KNOWN_GOOD);

/**
 * An empty enumeration must FAIL, never pass vacuously (SS7t). Plain `it` on purpose: an `it.fails`
 * cannot guard its own vacuity — it is satisfied by ANY failure, including this guard throwing.
 */
function requireMeasured(): void {
  const missing = castRows.filter((r) => !r.exists).map((r) => r.id);
  expect(missing, "cast actor GLBs that could not be read").toEqual([]);
  expect(castRows.length, "cast actors enumerated").toBe(CAST.length);
  expect(
    usableStyles.length,
    `licence-clean hair styles from ${HAIR_PACK_DIR} (9 of 25 measured 2026-08-14)`,
  ).toBeGreaterThanOrEqual(1);
}

describe("cast actors wear the fitted hair the library rail already proves", () => {
  it("(1) RED: aisha carries a separate fitted hair mesh, weighted to the head", () => {
    requireMeasured();
    const row = castRows.find((r) => r.id === SLICE_1_ACTOR);
    const faults: string[] = [];
    if (!row) faults.push(`${SLICE_1_ACTOR} was not enumerated`);
    else {
      if (row.fittedTris < MIN_FITTED_TRIS) {
        faults.push(
          `${row.id}: ${row.fittedTris} tris of fitted hair (need >= ${MIN_FITTED_TRIS}); it carries only the ${row.paintedTris}-tri painted scalp region, whose boundary IS the stair-step hairline`,
        );
      } else if (!row.fittedWeighted) {
        faults.push(
          `${row.id}: fitted hair present (${row.fittedTris} tris) but carries no JOINTS_0 — a static cap that will not follow the head`,
        );
      }
    }
    expect(faults, "aisha's fitted hair geometry").toEqual([]);
  });

  it("(2) COUNTERWEIGHT: any fitted hair present comes from a licence-clean style", () => {
    // Refuses (b): 10 of the 25 cached styles are AGPL3 and 4 are unlicensed. The classifier reads
    // each .mhclo's own header, so this cannot be satisfied by editing a list in this file.
    requireMeasured();
    const dirty: string[] = [];
    for (const row of [...castRows, knownGood]) {
      for (const name of row.fittedNames) {
        const matched = usableStyles.some((s) => name.includes(s));
        if (!matched) {
          dirty.push(
            `${row.id}: fitted hair "${name}" does not match any licence-clean style (${usableStyles.length} usable of ${classification.summary.total}; ${classification.summary.refusedCopyleft} refused copyleft)`,
          );
        }
      }
    }
    expect(dirty, "fitted hair whose source style is not licence-clean").toEqual([]);
  });

  it("(3) COUNTERWEIGHT: slice 1 opens ONE actor — the child and kevin are untouched", () => {
    // This is the peer's scope fence made machine-checkable rather than left as prose (SS6d: a prose
    // warning is not a proof). Opening a second actor to make hair look busy fails here, and kevin
    // specifically must NOT receive a feminine bob — that would regress realism, which is worse than
    // the stair-step it replaces.
    requireMeasured();
    const opened = castRows
      .filter((r) => (OUT_OF_SLICE as readonly string[]).includes(r.id))
      .filter((r) => r.fittedTris > OUT_OF_SLICE_FITTED_TRIS_TODAY)
      .map(
        (r) =>
          `${r.id}: gained ${r.fittedTris} tris of fitted hair — out of slice 1 scope (aisha only; kevin is a recorded male skip until a licensed masculine style exists)`,
      );
    expect(opened, "actors opened outside slice 1").toEqual([]);
  });

  it("(4) COUNTERWEIGHT: the library rail's proven fit is not disturbed", () => {
    // Refuses (d): moving or deleting the known-good to make the cast look comparable. This is the
    // SS9h reference column — it must stay green and stay where it is.
    requireMeasured();
    const problems: string[] = [];
    if (!knownGood.exists) problems.push(`${KNOWN_GOOD}.glb no longer readable at ${CANDIDATES}`);
    else {
      if (knownGood.fittedTris < MIN_FITTED_TRIS) {
        problems.push(`${KNOWN_GOOD}: fitted hair fell to ${knownGood.fittedTris} tris (was 4976)`);
      }
      if (!knownGood.fittedWeighted) {
        problems.push(`${KNOWN_GOOD}: fitted hair lost its JOINTS_0 weights`);
      }
    }
    expect(problems, "regressions in the library rail's known-good hair fit").toEqual([]);
  });

  it("(5) COUNTERWEIGHT: the painted scalp region survives on cast actors without fitted hair and is absent where fitted hair replaced it", () => {
    // #393 re-premise (#387's shape): the painted scalp is a self-declared PLACEHOLDER
    // (automate_blender.py:4245: "before a real groom/hair-card source stage exists") — it is
    // required on figures with NO fitted hair (child, kevin) and must be ABSENT on the figure
    // that has it (aisha, whose body_param_stage.scalp_placeholder_retired_for skips painting
    // it). Refuses deleting paint to fake a fit, and refuses the opposite: leaving the
    // placeholder under real fitted hair (the #387 2.8%-luminance grade boundary). The SS6p
    // duty is met by the fitted hair itself — it takes over covering the scalp under and
    // behind the hairline, which is what the painted region did before it existed.
    requireMeasured();
    const bald = castRows
      .filter((r) => r.id !== RETIRED_FIGURE)
      .filter((r) => r.paintedTris < 500)
      .map((r) => `${r.id}: painted scalp region fell to ${r.paintedTris} tris — scalp coverage lost`);
    expect(bald, "cast actors without fitted hair that lost their painted scalp coverage").toEqual([]);
    const stale = castRows
      .filter((r) => r.id === RETIRED_FIGURE && r.paintedTris > 0)
      .map((r) => `${r.id}: painted scalp region still present (${r.paintedTris} tris) — placeholder not retired`);
    expect(stale, "figures with real fitted hair still carrying the placeholder").toEqual([]);
  });
});
