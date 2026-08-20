import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { resolveMorphTarget } from "../../../packages/openclinxr/asset-registry/src/morph-target-resolver.js";

/**
 * #464 — the chain resolves on paper; nobody has watched it run.
 *
 * #462 baked 15 visemes02 targets onto the runtime peds-parent GLB. #463 made the resolver reach
 * them: `viseme_AA -> viseme_aa` on the shipped mesh, with the FACS alias preserved for
 * un-rebaked actors. Both verified by me on merged main.
 *
 * **Neither proves a learner sees moving lips.** Name resolution is not the mixer, and nobody has
 * captured speech in the running app since the bake. That gap is this slice, and it is the last
 * step of E2's chain: bake -> mesh -> resolver -> **mixer**.
 *
 * ## USE THE PROVEN INSTRUMENT (D1)
 *
 * `tools/openclinxr/evidence/ui-xr-viseme-drive-capture.ts` already samples
 * `mesh.morphTargetInfluences[dict[name]]` live via `page.evaluate` on
 * `window.__openClinXrDebugScene`, and reads `userData.openClinXrMorphTargetRuntimeCue` at
 * `:485-489`. `main.ts:8861` writes `activeTargetName` into that cue every frame the named drive
 * runs. Script: `pnpm asset:ui-xr:viseme-drive-capture`. **Do not build a second sampler.**
 *
 * ## ITS OWN HEADER IS NOW STALE, AND THAT IS PART OF THE FINDING
 *
 * `ui-xr-viseme-drive-capture.ts:6-9` still records, from #365:
 *
 *   > "the parent/nurse are MPFB FACS bodies (`mouth-*`) driven through the #353 alias map"
 *
 * That was true before #462/#463 and is false now for the parent. Correct it where it is stated —
 * do not append. Same class as #458, where two stale wardrobe records reddened main.
 *
 * ## THE LAND-PATH TRAP, NAMED SO YOU DO NOT HIT IT
 *
 * The capture writes `.openclinxr/evidence/viseme-drive-2026-08-06/inspection.json`, which is
 * **gitignored — no land path (#396)**. I have hit this twice in three slices. Derive a small
 * TRACKED summary from the live capture and let the contract assert on that; the gitignored
 * inspection stays where it is.
 *
 * ## WHICH ARE REDS AND WHICH ARE NETS (#227)
 *
 *   (1) RED — no tracked summary of what the parent drives at runtime exists.
 *   (2) RED — the parent's driven target must be a real `viseme_*`, not a `mouth-*` FACS alias.
 *   (3) NET — the resolver's FACS fallback still resolves for a mesh without visemes. Passes today
 *             and is what a "fix" that deleted the alias would break (probed on #463).
 *   (4) GUARD — the summary names a live source, so it cannot be a hand-written assertion of the
 *             thing it is asserting.
 *
 * ## THE CHEAPEST FIXES THIS REFUSES
 *
 *   a) hand-write the summary from what the resolver SHOULD do  -> (4) fails; it must name a live
 *      capture source and the mesh it sampled
 *   b) assert on the gitignored inspection.json directly         -> no land path (#396)
 *   c) build a second sampler                                    -> D1; the instrument exists
 *   d) delete the FACS alias so only visemes can resolve         -> (3) fails; silences every
 *      un-rebaked actor
 *   e) sample a mesh that is not the parent                      -> (2)/(4) fail; the actor must
 *      be named and it must be the peds parent
 *
 * **IF THE RUNTIME DOES NOT DRIVE A VISEME, THAT IS THE FINDING.** Report it and stop rather than
 * making the summary say what the resolver promises. A negative here is worth more than a green.
 *
 * NOT TESTED:
 *   - Whether the lip motion is LEGIBLE as speech. This asserts which target is driven and at what
 *     weight; the orchestrator grades any frame, and legibility is a separate judgement.
 *   - Phoneme timing, coverage beyond whichever tokens the mock dialogue emits, or co-articulation.
 *   - Other actors. Only the parent was rebaked; clause (3) is what keeps the rest working.
 *   - #460's 0.3 cap. It keys on the RESOLVED name, so `viseme_aa` passes uncapped by construction
 *     and `mouth-open` stays capped for un-rebaked actors. Not changed here.
 *   - Quest, frame budget, on-device rendering.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const SUMMARY = join(HERE, "parent-drives-a-real-viseme.json");
const CAPTURE = join(HERE, "ui-xr-viseme-drive-capture.ts");

type Summary = {
  /** Live source the rows came from — a path or command, not a claim. */
  capturedFrom: string;
  /** The mesh actually sampled, read from the live scene. */
  meshName: string;
  actor: string;
  samples: { drivenTargetName: string; influence: number }[];
};

const summary: Summary | null = existsSync(SUMMARY)
  ? (JSON.parse(readFileSync(SUMMARY, "utf8")) as Summary)
  : null;

function requireSummary(): Summary {
  expect(
    summary,
    `tools/openclinxr/evidence/parent-drives-a-real-viseme.json must exist — a TRACKED summary `
      + `derived from pnpm asset:ui-xr:viseme-drive-capture. The capture's own inspection.json is `
      + `gitignored and has no land path (#396).`,
  ).not.toBeNull();
  return summary as Summary;
}

describe("the parent drives a real viseme at runtime", () => {
  it("(1) RED: a tracked summary of the parent's live drive exists", () => {
    const s = requireSummary();
    expect(s.samples.length, "at least one sampled frame where the named drive was active").toBeGreaterThan(0);
    expect(s.actor.toLowerCase(), "the summary names the peds parent").toContain("parent");
  });

  it("(2) RED: the driven target is a real viseme, not the FACS jaw-drop alias", () => {
    const s = requireSummary();
    const driven = [...new Set(s.samples.map((x) => x.drivenTargetName))];
    const facs = driven.filter((n) => !/^viseme_/iu.test(n));
    expect(
      facs,
      `after #462/#463 the parent carries viseme_* targets and the resolver reaches them; a `
        + `mouth-* drive means the mixer is still on the capped FACS jaw-drop`,
    ).toEqual([]);
    expect(
      s.samples.some((x) => x.influence > 0),
      "a target named but never weighted is not a drive",
    ).toBe(true);
  });

  it("(3) COUNTERWEIGHT: the FACS fallback still resolves for a mesh without visemes", () => {
    // Refuses (d). Probed on #463: case-insensitive matching that drops the alias makes the REDs
    // green and silences every un-rebaked actor.
    const facsOnly = new Set(["mouth-open", "mouth-compression"]);
    expect(resolveMorphTarget("viseme_AA", facsOnly), "un-rebaked actors keep working").toBe("mouth-open");
  });

  it("(4) VACUITY GUARD: the summary names a live source and the mesh it sampled", () => {
    // Refuses (a) and (e). A summary that does not say where it came from is an assertion, not
    // evidence.
    const s = requireSummary();
    expect(s.capturedFrom.length, "name the capture command or artifact the rows came from").toBeGreaterThan(10);
    expect(s.meshName, "the sampled mesh is read from the live scene, not typed").toMatch(/mesh|body/iu);
    expect(existsSync(CAPTURE), "the proven instrument is still in the tree (D1)").toBe(true);
  });
});
