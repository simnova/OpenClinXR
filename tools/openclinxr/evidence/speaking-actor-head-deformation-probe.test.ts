import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * E2 slice 1 — SEPARATE A MORPH FROM A BONE. Isolated reproduce for #402.
 *
 * ## THE DEFECT, AS FILED — measured, and the CAUSE IS NOT DETERMINED
 *
 * Two captures of `peds_asthma_parent_anxiety_v1`, minutes apart, **same shipped bytes**:
 *
 *     00:08  child speaks   -> parent CLEAN
 *     00:10  parent speaks  -> parent has a long thin spike from the head
 *
 * `mpfb-peds-parent-aisha.glb` was last written by `a66b3195` and has zero commits since. The
 * orchestrator captured her cleanly from those exact bytes. **So it is a RUNTIME deformation, not a
 * bake regression.** Frame-diff: 94.5% of pixels identical overall, 4,781 of 14,400 differing in the
 * head region alone.
 *
 * ## THIS SLICE DOES NOT FIX IT
 *
 * It builds the one measurement #402 names and did not run: dump `morphTargetInfluences` AND the
 * head/hair bone matrices at the deformed frame against the same values at the clean frame.
 * **That separates a morph from a bone in one shot.** A fix proposed before that separation is a
 * guess, and this repo has paid for eight of those in one session.
 *
 * ## CANDIDATES — UNRANKED, AND THEY MAY ALL BE WRONG (§6j, §6l)
 *
 * From #402, verbatim and unordered: a viseme/expression morph driven to an extreme; a bone driving
 * the fitted hair mesh (`toigo_blunt_bob_with_bangs`, 4,976 tris, k-NN weighted to `head`) with a bad
 * weight; a speaking-state pose applied over the idle; something merely correlated with elapsed time.
 *
 * **A FIFTH, found while writing this and NOT on #402's list** — disclosed as method knowledge so the
 * search does not have to rediscover it, explicitly NOT ranked above the others:
 * `main.ts:8104-8108` computes `isSpeaking = slot.activeSpeech !== undefined` and passes it into
 * `pediatricAsthmaActingOverlayForSlot(slot, t, isSpeaking)` — a scenario-specific acting overlay,
 * and #402's actor is the peds-asthma parent. That it exists is a fact; that it is the cause is not.
 * §6l: the answer was on none of the listed candidates the last two times.
 *
 * ## WIRE THE PROVEN TOOLS (D1)
 *
 *   - `sampleLiveVisemeInfluencesFromRoot` (`apps/ui-xr/src/viseme-runtime-wire.ts:328`) — #365's live
 *     morph sampler, already traverses a root and reads `morphTargetDictionary`/`Influences`.
 *   - `ui-xr-viseme-drive-capture.ts` — an existing live-runtime probe that already boots the app and
 *     drives the viseme path.
 *   Do not write a third sampler.
 *
 * ## WHY A STATIC READ CANNOT ANSWER THIS
 *
 * The bytes are identical in both frames. Reading the GLB tells you what the asset contains, not what
 * the running scene did to it (§6v — measure with the instrument the RUNTIME uses). Clause (3) refuses
 * a probe whose numbers could have come from the file.
 *
 * ## THE CHEAP FIXES THIS REFUSES
 *
 *   treatment                                                   | (1) | (2) | (3) | (4) | result
 *   -------------------------------------------------------------|-----|-----|-----|-----|--------
 *   a) today — no probe                                         |FAIL |FAIL |FAIL |FAIL | REFUSED
 *   b) sample only the speaking frame                           |pass |FAIL | pass| pass| REFUSED
 *   c) read morphs/bones from the shipped GLB                   |pass |pass |FAIL | pass| REFUSED
 *   d) sample morphs only, skip the bones                       |FAIL |FAIL | pass| pass| REFUSED
 *   e) live sample of BOTH, both states, both actors            |pass |pass | pass| pass| ALL PASS
 *
 * **(b) is the one to watch.** A dump of the deformed frame alone shows large morph weights and large
 * bone rotations and proves nothing — speech is SUPPOSED to move both. Only the delta against the
 * clean frame is evidence, which is why clause (2) requires both states.
 *
 * **(d)** is the tempting half-measure: the morph sampler already exists, the bone read does not. But
 * a morph-only dump cannot exclude the bone hypothesis, so it cannot separate anything.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227): **ALL FOUR are RED today.** I first declared (4) as a
 * net that "passes today", ran it, and it failed — because it reads the artifact that does not exist
 * yet, so it cannot be independent of the thing being built. Corrected here rather than left as
 * declared. (4) is a VACUITY GUARD that becomes load-bearing the moment the artifact appears: it
 * refuses a probe whose two states came back byte-identical, which would make (1)-(3) green about a
 * frozen scene. A guard that cannot pass before the work is not a net, and saying so is cheaper than
 * a reader trusting a column that was never true.
 *
 * NOT TESTED:
 *   - The cause. This slice separates morph from bone; naming the mechanism is E2 slice 2.
 *   - Any fix. No runtime change is asserted and none should be made in this slice.
 *   - Whether the spike is visible. That is a pixel grade and it is the orchestrator's.
 *   - Other actors or scenarios. Parent and child of one station only (D3/D4 — shrink the subject).
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const PROBE = join(REPO_ROOT, "tools/openclinxr/evidence/speaking-actor-head-deformation.json");

type ActorState = {
  actor: string;
  speaking: boolean;
  morphs?: Array<{ mesh: string; name: string; weight: number }>;
  bones?: Array<{ bone: string; worldMatrix: number[] }>;
};

function probe(): { source?: string; states: ActorState[] } {
  expect(
    existsSync(PROBE),
    `${PROBE} — the live dump #402 names as its first measurement and nobody ran`,
  ).toBe(true);
  return JSON.parse(readFileSync(PROBE, "utf8")) as ReturnType<typeof probe>;
}

const find = (s: ActorState[], actor: RegExp, speaking: boolean): ActorState | undefined =>
  s.find((x) => actor.test(x.actor) && x.speaking === speaking);

describe("the speaking-actor head deformation is separated into morph or bone", () => {
  it("(1) RED: the probe records BOTH morph influences and bone matrices", () => {
    // Refuses (d). A morph-only dump cannot exclude the bone hypothesis, so it separates nothing.
    const p = probe();
    expect(p.states.length, "actor/state rows").toBeGreaterThan(0);
    for (const st of p.states) {
      expect(Array.isArray(st.morphs), `${st.actor} speaking=${st.speaking}: morphs array`).toBe(true);
      expect(Array.isArray(st.bones), `${st.actor} speaking=${st.speaking}: bones array`).toBe(true);
      expect(st.bones!.length, `${st.actor}: at least the head bone must be sampled`).toBeGreaterThan(0);
    }
  });

  it("(2) RED: both states are captured for the parent, and the child is the control", () => {
    // Refuses (b). The deformed frame alone proves nothing — speech is supposed to move morphs and
    // bones. Only the delta is evidence. The child is clean in BOTH frames per #402, so it is the
    // known-good column: whatever the mechanism is, it must not show the same delta on her.
    const p = probe();
    expect(find(p.states, /parent/i, true), "parent, speaking").toBeTruthy();
    expect(find(p.states, /parent/i, false), "parent, not speaking").toBeTruthy();
    expect(find(p.states, /child|patient/i, true), "child control, speaking").toBeTruthy();
    expect(find(p.states, /child|patient/i, false), "child control, not speaking").toBeTruthy();
  });

  it("(3) RED: the sample came from the LIVE runtime, not the shipped GLB", () => {
    // Refuses (c). The bytes are identical in both frames; a static read cannot see a runtime
    // deformation (§6v — measure with the instrument the runtime uses).
    const p = probe();
    expect(typeof p.source, "the probe must record how it sampled").toBe("string");
    expect(
      /live|runtime|page|browser|playwright|dev-server/i.test(p.source ?? ""),
      `source must name a live runtime read, got: ${p.source}`,
    ).toBe(true);
    expect(
      /\.glb\b/i.test(p.source ?? ""),
      "a source naming a .glb read is a static read and cannot answer this",
    ).toBe(false);
  });

  it("(4) VACUITY GUARD: speaking and not-speaking are not identical dumps", () => {
    // Reads the artifact's own shape. If the two states came back identical the probe captured
    // nothing and clauses (1)-(3) would be green about a frozen scene.
    const p = probe();
    const a = find(p.states, /parent/i, true);
    const b = find(p.states, /parent/i, false);
    if (!a || !b) return; // clause (2) already fails loudly in that case
    expect(
      JSON.stringify(a.morphs) !== JSON.stringify(b.morphs) ||
        JSON.stringify(a.bones) !== JSON.stringify(b.bones),
      "speaking and non-speaking dumps are byte-identical — the probe captured a frozen scene",
    ).toBe(true);
  });
});
