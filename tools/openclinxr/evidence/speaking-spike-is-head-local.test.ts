import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * E2 slice 2 (#419) — COLUMN A. Measure the spike in a frame that can SEE a mesh artifact.
 *
 * ## WHY SLICE 1'S ANSWER WAS WITHDRAWN
 *
 * E2.1 (`d1b646fa`) dumped morphs and bone WORLD matrices for parent and child, speaking and not.
 * I read a 4.4× ratio off it and reported "the delta is BONE-side". **That was wrong and I withdrew
 * it.** Decomposing the same matrices:
 *
 *     parent   all 19 bones translate 234–236 mm, scale Δ 0.0157
 *     child    all 19 bones translate  58–60 mm, scale Δ 0.0175
 *
 * A uniform translation across every bone with unchanged scale is a RIGID BODY DISPLACEMENT — the
 * actors were sampled at different animation phases and simply stood in different places.
 *
 * Then, root-relative (the `root` bone was in the sample, so this was computable without a dispatch):
 *
 *     parent   max 26.50 mm (head)      child   max 19.73 mm (eyeR)      ratio 1.34×, not 4.4×
 *
 * **So a bone-transform defect is ruled out.** 20–27 mm of head/neck articulation appears on the
 * CONTROL too, and the control is clean in both #402 frames.
 *
 * ## WHAT IS LEFT, AND WHY WORLD AND BONE FRAMES CANNOT SEE IT
 *
 * #402's own candidate list contains "a bone driving the fitted hair mesh with a bad weight, flinging
 * vertices". **A bad weight moves VERTICES, not bones.** Both prior frames are blind to it by
 * construction: the bone transforms can be perfect while the skinned mesh tears.
 *
 * Column A measures skinned vertex positions in **head-bone local** space. Rigid displacement cancels,
 * neck articulation cancels, and a mesh artifact does not.
 *
 * ## THE CHEAP FIXES THIS REFUSES
 *
 *   treatment                                                  | (1) | (2) | (3) | (4) | result
 *   -------------------------------------------------------------|-----|-----|-----|-----|--------
 *   a) today — no head-local measurement                        |FAIL |FAIL |FAIL |FAIL | REFUSED
 *   b) re-report the world-matrix delta                         |FAIL |FAIL |FAIL |FAIL | REFUSED
 *   c) report root-relative BONE motion again (26.5 vs 19.7 mm) |FAIL |FAIL | pass|FAIL | REFUSED
 *   d) sample the parent only, no control                       |pass |FAIL | pass|pass | REFUSED
 *   e) head-local skinned verts, both states, both actors       |pass |pass | pass|pass | ALL PASS
 *
 * **(b) and (c) are the ones to watch, because I have already published both numbers.** A worker that
 * re-derives either satisfies "something differs" without going near the mesh. Clause (3) names them
 * explicitly as forbidden passes — the superagent's instruction was "world-matrix non-identity is
 * forbidden as a pass", and root-relative bone motion is now equally spent.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227): **ALL FOUR are RED today** — the artifact does not exist,
 * and every clause reads it. Clause (4) is a vacuity guard that becomes load-bearing once it does:
 * it refuses a run whose only signal is the two quantities already known to be uninformative.
 * (E2.1 taught me not to call such a clause a "net that passes today" — it cannot be independent of
 * the thing being built.)
 *
 * ## THE STOP CONDITION IS A SUCCESSFUL OUTCOME
 *
 * If head-local vertex deltas are ALSO small on the parent relative to the child, then **the isolated
 * dump does not contain #402** and the effort says so and halts. It does NOT retarget idle/lean to
 * shrink a ratio — that is the displacement, and chasing it is how a dead premise becomes a fix.
 *
 * NOT TESTED:
 *   - Any cause. This slice localises to the mesh or exonerates it; naming a mechanism is later.
 *   - Any fix. No runtime change is asserted and none should be made here.
 *   - Whether the spike is visible today. That is a pixel grade and it is the orchestrator's.
 *   - Hair-mesh weights specifically. A vertex delta does not distinguish body skin from fitted hair;
 *     recording which MESH each extreme vertex belongs to is required so a later slice can.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const PROBE = join(REPO_ROOT, "tools/openclinxr/evidence/speaking-spike-head-local.json");

/** Measured in E2.1 and already spent as evidence — a run whose only signal is these is refused. */
const SPENT_WORLD_MM = 234;
const SPENT_ROOT_REL_MM = 30;

type ActorRow = {
  actor: string;
  maxHeadLocalDeltaMm?: number;
  maxHeadLocalVertexMesh?: string;
  worldTranslationDeltaMm?: number;
  rootRelativeBoneDeltaMm?: number;
  vertexCount?: number;
};

function probe(): { source?: string; frame?: string; actors: ActorRow[] } {
  expect(existsSync(PROBE), `${PROBE} — column A; E2.1's artifact carries no vertex data`).toBe(true);
  return JSON.parse(readFileSync(PROBE, "utf8")) as ReturnType<typeof probe>;
}
const find = (a: ActorRow[], re: RegExp) => a.find((x) => re.test(x.actor));

describe("the speaking-actor spike is measured in head-bone local space", () => {
  it("(1) RED: head-local skinned vertex deltas are recorded, with the owning mesh named", () => {
    const p = probe();
    for (const a of p.actors) {
      expect(typeof a.maxHeadLocalDeltaMm, `${a.actor}: head-local vertex delta`).toBe("number");
      expect(typeof a.maxHeadLocalVertexMesh, `${a.actor}: which MESH owns the extreme vertex`).toBe("string");
      expect(a.vertexCount ?? 0, `${a.actor}: vertices sampled`).toBeGreaterThan(0);
    }
  });

  it("(2) RED: the parent AND the child control are both measured", () => {
    // Refuses (d). The control is clean in both #402 frames, so any head-local delta it also shows is
    // ordinary speech, not the spike. Slice 1's whole lesson: without the control the parent's
    // numbers looked damning and were not.
    const p = probe();
    expect(find(p.actors, /parent/i), "parent row").toBeTruthy();
    expect(find(p.actors, /child|patient/i), "child control row").toBeTruthy();
  });

  it("(3) RED: neither spent quantity may stand in for the head-local measurement", () => {
    // Refuses (b) and (c). Both numbers are already published and both are uninformative: the world
    // delta is a rigid displacement, and root-relative bone motion appears on the control at 19.73 mm.
    const p = probe();
    const parent = find(p.actors, /parent/i);
    if (!parent) return; // clause (2) fails loudly
    expect(
      parent.maxHeadLocalDeltaMm,
      "head-local delta must be measured, not copied from the world translation",
    ).not.toBe(parent.worldTranslationDeltaMm);
    expect(
      (parent.maxHeadLocalDeltaMm ?? 0) < SPENT_WORLD_MM,
      `a head-local delta of ~${SPENT_WORLD_MM} mm is the rigid displacement leaking through, not a mesh artifact`,
    ).toBe(true);
    expect(
      parent.maxHeadLocalDeltaMm,
      "head-local delta must not be the already-spent root-relative bone number",
    ).not.toBe(parent.rootRelativeBoneDeltaMm);
  });

  it("(4) VACUITY GUARD: the measurement is live and frame-anchored", () => {
    // Becomes load-bearing once the artifact exists. A dump that cannot say WHEN it sampled cannot be
    // compared against E2.1, and a static read cannot see a runtime deformation at all (§6v).
    const p = probe();
    expect(typeof p.source, "how it sampled").toBe("string");
    expect(
      /live|runtime|page|browser|playwright|dev-server/i.test(p.source ?? ""),
      `source must name a live runtime read, got: ${p.source}`,
    ).toBe(true);
    expect(/\.glb\b/i.test(p.source ?? ""), "a .glb read is static and cannot see this").toBe(false);
    expect(typeof p.frame, "the sampling instant must be recorded").toBe("string");
  });
});
