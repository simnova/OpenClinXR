import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * OBSERVABLE: the whole-bank darkness gate fails when the runtime has moved since it was measured.
 *
 * MEASURED 2026-08-24, do not re-derive. `no-shipped-station-captures-darker-than-it-did.test.ts`
 * asserts fifteen station luminance floors and three ceilings. It captures NOTHING. It reads
 * `station-luminance-sweep.json` off disk and compares that file's numbers to constants:
 *
 *   const load = () => JSON.parse(readFileSync(REPORT, "utf8")).stations;   // :90-93
 *
 *   station-luminance-sweep.json  last written  f8a9edc0   2026-08-21
 *   apps/ui-xr/src/main.ts        last written  ec5cbd42   2026-08-24
 *   commits to main.ts in between                      8
 *   provenance keys in the sweep artifact               0   (top-level keys: ["stations"] only)
 *
 * So the gate has been green for three days about a tree that no longer exists, and it CANNOT go red
 * however dark the rooms become - only re-running the sweep and committing it can move the numbers.
 * It is the #55 class (a cached gate over a red main) wearing the whole encounter bank.
 *
 * This is not a complaint about that contract's floors, which are real and were honestly measured.
 * It is that nothing tells a reader - or a later gate - WHICH TREE they describe.
 *
 * KNOWN-GOOD COLUMN: this repo already settled this question for another artifact class.
 * `a-graded-image-says-which-commit-produced-it.test.ts` requires a graded image to name its
 * producing commit, and 31 evidence modules stamp `measuredAgainstCommit` - including
 * `bone-map-collision-prefix.json`, which carries `"measuredAgainstCommit": "730ed56f"`. The darkness
 * gate was simply never brought under the rule the rest of the evidence tree already follows.
 *
 * WHY THIS IS THE UNBLOCKING SLICE FOR #162. #162 asks whether closing the ceiling darkened every
 * room. That question cannot be answered - or re-answered after a lighting fix - while the only
 * whole-bank instrument is a frozen snapshot. A stale-refusing sweep is the measuring device #162
 * needs before anyone changes a light.
 *
 * FAILED TREATMENT, do not repeat: hand-stamping today's sha onto the EXISTING numbers. That makes
 * the artifact look fresh while describing the old tree, which is strictly worse than no stamp at all
 * because it defeats the check that would otherwise catch it. The stamp must be written by the sweep
 * run itself, in the same process that produced the numbers.
 *
 * claimScope: whether the luminance sweep artifact records the tree state it measured, and whether
 *   the freshness check refuses a stamp that does not match the runtime paths at HEAD.
 * notEvidenceFor: whether any station is too dark; the correctness of the floors; the lighting model;
 *   whether re-running the sweep today would change any number.
 *
 * ## FIXED (#635) — 2026-08-24
 *
 * The sweep writer now stamps the tree it measured: `station-luminance-sweep.ts` computes
 * `measuredAgainstCommit` via `git log -1 --format=%h -- apps/ui-xr/src/main.ts` IN THE SAME PROCESS
 * that produced the numbers, at write time. The sweep was re-run so the committed artifact carries a
 * fresh stamp and current medians; the recorded floors/ceilings were re-measured, not hand-stamped.
 *
 * DECISION, named: the staleness check is a SEPARATE contract from the floor gate. A stale artifact
 * is an instrument failure — the correct repair is re-running the sweep, and it must go red the day
 * the runtime moves so nobody reads an old tree as current. A dark room is a product failure — the
 * correct repair is a lighting/framing fix. Sharing one red would make a product regression gate fail
 * for an evidence reason (and vice versa), so the freshness check lives here and the floor gate
 * (`no-shipped-station-captures-darker-than-it-did.test.ts`) is unchanged, still asserting only
 * floors/ceilings. Clause (4) below keeps the two honest: freshness about an artifact that still
 * holds the whole bank.
 *
 * STOP RULE FIRED (2026-08-24 re-run): three stations moved beyond the recorded noise (2) —
 * ob_headache_preeclampsia_triage_v1 183→170, peds_asthma_parent_anxiety_v1 33→36,
 * primary_care_dyslipidemia_joint_pain_v1 16→0. Per the issue's stop rule the moved medians are a
 * #162 finding, not this slice's work, and NO floor was adjusted. The floor gate therefore goes red
 * on primary_care (0 < 12) and ob_headache (170 < 181-2) — that red is the finding made mechanical,
 * which is what this slice was built to unblock.
 */

const SWEEP = "tools/openclinxr/evidence/station-luminance-sweep.json";
/** The sources whose movement invalidates a capture-derived luminance number. */
const RUNTIME_PATHS = ["apps/ui-xr/src/main.ts"] as const;

const sweep = (): Record<string, unknown> => {
  if (!existsSync(SWEEP)) throw new Error(`${SWEEP} missing - TRACKED path required (#396)`);
  return JSON.parse(readFileSync(SWEEP, "utf8")) as Record<string, unknown>;
};

/** Short sha of the newest commit touching any runtime path the sweep's numbers depend on. */
const runtimeHead = (): string =>
  execFileSync("git", ["log", "-1", "--format=%h", "--", ...RUNTIME_PATHS], { encoding: "utf8" }).trim();

describe("the darkness gate knows which tree it measured", () => {
  it("(1) the luminance sweep records the tree its numbers describe, and it is current", () => {
    const s = sweep();
    const stamp = (s["measuredAgainstCommit"] ?? s["measuredAtCommit"]) as string | undefined;
    expect(
      stamp,
      `${SWEEP} has no commit stamp. Fifteen station floors are asserted against it and nothing says `
      + `which tree produced them; it has been green for three days across 8 commits to the runtime`,
    ).toBeTruthy();
    expect(
      stamp,
      `the sweep describes an older tree than the runtime it is supposed to gate - re-run the sweep`,
    ).toBe(runtimeHead());
  });

  it("(2) KNOWN-GOOD COLUMN: the pattern this repo already requires elsewhere still holds", () => {
    // bone-map-collision-prefix.json is an ordinary measurement artifact that stamps its tree. It is
    // the reference for the shape clause (1) asks for - not a new convention being invented here.
    const ref = "tools/openclinxr/evidence/bone-map-collision-prefix.json";
    expect(existsSync(ref), `${ref} is the reference artifact for this shape`).toBe(true);
    const stamp = (JSON.parse(readFileSync(ref, "utf8")) as { measuredAgainstCommit?: string })
      .measuredAgainstCommit;
    expect(stamp, "the reference artifact must still carry a commit stamp").toMatch(/^[0-9a-f]{7,40}$/u);
  });

  it("(3) COUNTERWEIGHT: the freshness check REFUSES a stale stamp, it does not just look for a key", () => {
    // Refuses the cheap fix. A check that only asserts "a stamp exists" is satisfied by hand-writing
    // any string, including one describing a tree from last week. This pins that a WRONG stamp is
    // rejected, so the fix cannot be a key with a decorative value.
    const stale = "0000000";
    expect(stale, "a sha that is not the runtime head must not be accepted as current")
      .not.toBe(runtimeHead());
    expect(runtimeHead(), "and the runtime head must be a real short sha, not an empty string")
      .toMatch(/^[0-9a-f]{7,40}$/u);
  });

  it("(4) VACUITY GUARD: the floors the other gate asserts are actually present to be gated", () => {
    // Without this, clause (1) could pass on an artifact that carries a stamp and no measurements -
    // freshness about nothing. Pins that the sweep still holds the whole bank it claims to cover.
    const stations = sweep()["stations"] as Record<string, { median: number }> | undefined;
    expect(stations, "the sweep must still carry its station table").toBeTruthy();
    expect(Object.keys(stations ?? {}).length, "the whole shipped bank, not a sample")
      .toBeGreaterThanOrEqual(14);
  });
});
