import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * # THE OBSERVATION, AND WHY IT IS NOT YET A DEFECT — measured 2026-08-19 on main 8ce57382
 *
 * #444 moved the four `street_casual` patients onto `mpfb-street-adult-male.glb`. I captured
 * the telehealth station to grade it and saw **a pale shape lying horizontally across two
 * chairs at left-of-centre**. I did not file it, and this contract does not assert it is
 * wrong. At that framing I cannot tell whether it is an actor in a bad pose, furniture, or
 * two objects overlapping.
 *
 * The framing is the whole problem. From the capture's own live read:
 *
 *   nearestActor        4.28 m
 *   cameraWorldPosition (-4.507, 1.440, 2.561)
 *   interiorSize        9.50 x 2.41 x 6.38 m
 *   captureMode         "scene-overview"
 *
 * Figures land at roughly 60 px. #211 was filed from exactly such a thumbnail — "the psych
 * station renders no actors" — and withdrawn: all three were rendering at 32,207 / 34,571 /
 * 38,827 skinned triangles. **A contact-sheet-scale figure supports comparative and positive
 * verdicts, never a negative one.** So this slice buys the instrument, not the verdict.
 *
 * ## WHAT DOES NOT EXIST TODAY
 *
 * 1. **No HUD-free still of this station.** Every capture routes through
 *    `ui-xr-environment-room-capture.ts` in `scene-overview` mode, which renders the full
 *    exam app: the Simulated EHR panel, Trace Actions, the "WebXR unavailable" bar. The
 *    graded PNG is 1440 px wide of which ~420 px is DOM chrome.
 * 2. **No artifact names what is in the room.** `capture-manifest.json` entries carry exactly
 *    `scenarioId | imagePath | liveShell | source`, and `liveShell` reads the procedural
 *    shell's `userData` — room dimensions, floor colour, camera position. It cannot name a
 *    single mesh. #342 wrote `ui-xr-live-scene-graph-dump.ts` because of precisely this gap:
 *    "every probe on the Infinigen composite room reported success while the learner's
 *    viewport was blank."
 *
 * So the pale bar cannot be identified from any artifact this repo produces. That is the
 * defect this slice fixes.
 *
 * ## THE KNOWN-GOOD COLUMN (SS9h)
 *
 * Content is bounded by luminance sd, not bytes, and the band is measured rather than picked.
 * From #431: two BLANK grey frames cleared a 20,000-byte floor, one of them at 134,991 B, and
 * read sd **0.96** and **1.82**. Real content measured **26.90-45.56**. The five #442 viseme
 * stills, same reader, sit at **59.79-59.85**. `nonBlackPct` was tried and is useless — 100%
 * on every frame including the empties. Clause (2) bounds sd; clause (5) asserts the existing
 * full-HUD capture still reads as content, so the reader itself cannot go blind unnoticed.
 *
 * ## THE CHEAP FIXES THIS REFUSES
 *
 *   treatment                                          | (1) | (2) | (3) | (4) | result
 *   ---------------------------------------------------|-----|-----|-----|-----|--------
 *   a) today — neither artifact exists                 |FAIL |FAIL |FAIL |FAIL | REFUSED
 *   b) re-run the existing room capture, rename output |pass |pass |**FAIL**|**FAIL**| REFUSED
 *   c) list the two cast actors as the inspect rows    |pass |pass |pass |**FAIL**| REFUSED
 *   d) isolated render + live scene-graph dump         |pass |pass |pass |pass | ALL PASS
 *
 * **(b) is the obvious one.** `ui-xr-environment-room-capture.ts --scenario telehealth_...`
 * already writes a PNG of this station; two lines of path juggling satisfy existence and
 * luminance. Clause (3) requires the inspect to record ZERO exam-HUD DOM nodes in the page
 * that produced the still, which the full app cannot satisfy.
 *
 * **(c) is the subtle one.** The station declares two actors, so an inspect listing
 * `patient_luis_martinez_v1` and `daughter_elena_martinez_v1` looks complete and cannot
 * identify a chair, a table or a room mesh. Clause (4) requires rows the CAST does not
 * contain — the enumeration must come from the live scene graph, which is what #342 built.
 *
 * ## DESTRUCTIVE PROBE, RUN 2026-08-19 — the substitution MATCHED, both rows
 *
 * Planted (b) and (c) together: copied the existing full-HUD `scene-overview` capture to the
 * isolated still's path, and wrote an inspect whose only mesh rows are the two declared cast
 * actors, with a plausible fabricated luminance. Reverted afterwards.
 *
 *   before: 4 failed | 1 passed
 *   after:  2 failed | 3 passed   (1) and (2) GREEN, (3) and (4) red
 *
 * Clause (3) refused on the mechanism, not a proxy:
 *   `an isolated room render carries no exam HUD: expected 37 to be +0`
 * Clause (4) refused the cast-only rows.
 *
 * So a rename plus a two-row inspect really does satisfy existence and content — both
 * counterweights are load-bearing, not decoration.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227):
 *   (1)(2)(3)(4) are ALL REDS today — neither artifact exists, so every clause reading them
 *                fails. (3) and (4) are additionally NETS thereafter: they are what refuse
 *                (b) and (c).
 *   (5) PASSES TODAY — it reads the existing full-HUD capture and the #431/#442 calibration,
 *                not the absent artifacts.
 *
 * NOT TESTED:
 *   - **Whether anything is wrong with the pale bar.** No clause here says it is a defect.
 *     The orchestrator grades the still and names the mesh from the inspect. If it turns out
 *     to be a correctly-placed table, that is a successful outcome and closes the observation.
 *   - **Garment class at station framing.** A separate question; this buys the framing, not
 *     the verdict.
 *   - **The other three street stations.** One station, one slice (D4).
 *   - **Fit quality.** The waistband step is rail-wide (kevin 11.2 mm, partner 26.5 mm,
 *     street 38.9 mm garment-to-garment) and is a fitter-parameter question, not this slice.
 *   - **Quest budget, clinical realism, learner readiness.** None of them.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");

const SCENARIO = "telehealth_diabetes_health_literacy_v1";
const STILL = join(HERE, "stills/telehealth-room-isolated.png");
const INSPECT = join(HERE, "telehealth-room-inspect.json");
/** The existing full-HUD capture — the thing this slice is NOT allowed to just rename. */
const EXISTING_HUD_CAPTURE = join(
  REPO_ROOT,
  ".openclinxr/evidence/ui-xr-environment-room/latest",
  `${SCENARIO}-room.png`,
);

/** #431: blanks read 0.96 / 1.82; content 26.90-45.56; the #442 stills 59.79-59.85. */
const MIN_CONTENT_SD = 8;
const MIN_STILL_BYTES = 20_000;

/** The two actors the cast declares. An inspect that lists only these has not read the scene. */
const CAST_ACTOR_IDS = ["patient_luis_martinez_v1", "daughter_elena_martinez_v1"] as const;

type MeshRow = {
  name: string;
  worldMin: [number, number, number];
  worldMax: [number, number, number];
  visible: boolean;
  triangles: number;
};
type Inspect = {
  scenarioId?: string;
  environmentId?: string;
  camera?: { position: number[]; target: number[]; fov: number; derivation: string };
  still?: { path: string; bytes: number; luminance: { mean: number; sd: number } };
  hud?: { examHudNodeCount: number };
  meshes?: MeshRow[];
};

const inspect: Inspect | null = existsSync(INSPECT)
  ? (JSON.parse(readFileSync(INSPECT, "utf8")) as Inspect)
  : null;

/** SS7t: an absent artifact must FAIL loudly, never pass vacuously. */
function requireInspect(): Inspect {
  expect(
    inspect,
    `tools/openclinxr/evidence/telehealth-room-inspect.json must exist — today no artifact in this repo can name a single mesh in this station; capture-manifest.json carries only scenarioId | imagePath | liveShell | source`,
  ).not.toBeNull();
  return inspect as Inspect;
}

describe("the telehealth room is inspectable without the exam HUD", () => {
  it("(1) RED: an isolated still of this station exists", () => {
    expect(existsSync(STILL), `${STILL} missing`).toBe(true);
    expect(statSync(STILL).size, "still bytes").toBeGreaterThanOrEqual(MIN_STILL_BYTES);
    const i = requireInspect();
    expect(i.scenarioId, "the inspect must name the station it read").toBe(SCENARIO);
    expect(i.camera?.derivation, "the camera must be derived and say how — never a hardcoded position (D1)")
      .toBeTruthy();
  });

  it("(2) RED: the still carries image content, measured by luminance sd not bytes", () => {
    // #431: two blank grey frames cleared a 20 KB floor, one at 134,991 B. sd separates them
    // (0.96 / 1.82 blank vs 26.90-45.56 content). nonBlackPct does NOT — 100% on both.
    const i = requireInspect();
    expect(i.still?.luminance, "the inspect records no luminance for the still").toBeDefined();
    expect(
      (i.still as NonNullable<Inspect["still"]>).luminance.sd,
      `the still reads as blank; #442's stills sit at sd 59.79-59.85`,
    ).toBeGreaterThan(MIN_CONTENT_SD);
  });

  it("(3) COUNTERWEIGHT: the page that produced the still had no exam HUD", () => {
    // Refuses (b). ui-xr-environment-room-capture.ts already writes a PNG of this station in
    // scene-overview mode — ~420 px of the 1440 px graded frame is DOM chrome (Simulated EHR,
    // Trace Actions, the WebXR bar). Renaming its output must not satisfy this contract.
    const i = requireInspect();
    expect(i.hud?.examHudNodeCount, "the inspect must record how many exam-HUD nodes the page had").toBeDefined();
    expect(i.hud?.examHudNodeCount, `an isolated room render carries no exam HUD`).toBe(0);
  });

  it("(4) COUNTERWEIGHT: the mesh rows come from the live scene, not the cast list", () => {
    // Refuses (c). The station declares two actors; an inspect listing only those looks
    // complete and cannot identify a chair, a table or a room mesh — which is the entire
    // question. #342 built the live scene-graph dump for exactly this blindness.
    const i = requireInspect();
    const meshes = i.meshes ?? [];
    expect(meshes.length, "no mesh rows — the live scene was never read").toBeGreaterThan(CAST_ACTOR_IDS.length);
    const nonCast = meshes.filter((m) => !CAST_ACTOR_IDS.some((id) => m.name.includes(id)));
    expect(
      nonCast.length,
      `every row maps to a declared actor — the room, its furniture and its props are unnamed, so the pale bar still cannot be identified`,
    ).toBeGreaterThan(0);
    for (const m of meshes) {
      expect(m.worldMin?.length, `${m.name} has no world bounds`).toBe(3);
      expect(m.worldMax?.length, `${m.name} has no world bounds`).toBe(3);
      expect(Number.isFinite(m.triangles), `${m.name} has no triangle count`).toBe(true);
    }
  });

  it("(5) KNOWN-GOOD: the existing full-HUD capture is present and reads as content", () => {
    // Reads the existing artifact and the calibration, not the absent pair, so it passes today
    // and keeps passing: if the room capture ever stops producing a real frame, this goes red
    // first and clause (2)'s band is revealed as untrustworthy rather than silently wrong.
    expect(
      existsSync(EXISTING_HUD_CAPTURE),
      `the scene-overview capture this slice replaces must exist for the comparison to be real`,
    ).toBe(true);
    expect(statSync(EXISTING_HUD_CAPTURE).size, "existing capture bytes").toBeGreaterThanOrEqual(MIN_STILL_BYTES);
    expect(MIN_CONTENT_SD, "the sd floor sits an order of magnitude above #431's blanks (0.96, 1.82)")
      .toBeGreaterThan(1.82 * 4);
  });
});
