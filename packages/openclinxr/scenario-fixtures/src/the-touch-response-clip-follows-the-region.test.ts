import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { ComplianceRegionSchema } from "@openclinxr/shared-schemas";
import { scenarioBank } from "./scenario-bank.js";

/**
 * **OBSERVABLE: a learner who palpates the left chest is played a right-lower-quadrant flinch.**
 *
 * Card tsk_ae6a9530ba63a68b. Every `touchResponse` row in the shipped bank names the same
 * `responseClip`, across four scenarios and six anatomically distinct regions.
 *
 * ## MEASURED ON HEAD — do not re-derive. This block is IMMUTABLE.
 *
 * Enumerated from the live `scenarioBank` at 501a517a, written to
 * `.openclinxr/evidence/touch-response-routing/pre-fix.json`:
 *
 *     rows                                    : 24   (4 scenarios x 6 regions)
 *     distinct regions                        : 6    abdomen_{rlq,ruq,luq,llq}, chest_{L,R}
 *     distinct responseClip values            : 1    openclinxr_role_patient_guard_withdraw_rlq
 *
 *     distinct values in the SAME rows, per field
 *       traceTag                              : 6    one per region
 *       emotionEventId                        : 6    one per region
 *       forceThreshold                        : 8
 *       dialogueLine (by length)              : 14
 *       responseKind                          : 1    legitimate — every row IS guarding
 *
 * THE MECHANISM, and it is why this is a binding defect rather than missing content: the case data
 * ALREADY discriminates the region in five fields. Trace tags and emotion events are one per region.
 * Only the clip binding ignores what the row says, so nothing upstream needs to be authored — the
 * region is present and is being dropped at exactly one hop.
 *
 * PINNED BY A SHIPPED TEST: `ed-chest-pain.test.ts:62` asserts that single clip for all six regions
 * inside its region loop. That assertion encodes the defect, so clause (4) requires it to change.
 * You MAY edit it. Name it in your report and say what the old assertion was. You may NOT weaken any
 * assertion in this file.
 *
 * DO NOT FIX BY AUTHORING SIX HAND-MADE CLIPS. That is the per-region euler table the motion factory
 * exists to remove (D1), and clause (2)'s totality requirement refuses it: four regions in the
 * vocabulary have no row to copy from.
 *
 * OUT OF SCOPE, and expected NOT TESTED: whether a learner notices the mismatch; clinical validity
 * of any guarding pose; whether the named clips have been BAKED. This card is the routing, and a
 * clip id that resolves correctly and has no GLB behind it still satisfies every clause here. The
 * bake is tsk_9faa82d3f77d8a6a.
 */

/**
 * ## FIXED (tsk_bae34b0cae2cf745)
 *
 * Clauses (1), (2) and (4) flipped when the response-clip routing landed:
 * `touch-response-clip.ts` derives the clip from the compliance region (total over the whole
 * schema vocabulary, injective on it), the 24 shipped rows in the four fixture files call that
 * resolver, the ui-xr runtime resolves guarding touches through it at registration, and
 * `ed-chest-pain.test.ts` now expects each region's own clip instead of pinning one RLQ clip.
 */

/**
 * ## FIXED (issue #0 Phase 1 peds rebase 05a49b8a)
 *
 * The Phase 1 authored-turn credibility floor removes the four abdomen rows from the draft
 * pediatric-asthma fixture (abdomen/RLQ guarding belongs to surgical-abdomen cases, not the
 * asthma draft; `pediatric-asthma.ts` keeps only its chest_R / chest_L guarding rows). The bank
 * is therefore 20 rows, not 24; clause (1)'s row counterweight tracks the re-measured bank. The
 * six-region vocabulary and clause (3)'s RLQ survival are unaffected — abdomen rows remain
 * authored in adult-abdominal-pain and ed-chest-pain.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const RESOLVER_MODULE = "./touch-response-clip.js";

type TouchRow = {
  scenarioId: string;
  actorId: string;
  region: string;
  responseClip: string;
  traceTag?: string | undefined;
};

/**
 * Enumerated from what SHIPS, never a literal list. A hardcoded set of six regions is the thing that
 * goes stale the moment a scenario is added, and it would let this contract pass over a bank that
 * had quietly shrunk.
 */
function liveTouchRows(): TouchRow[] {
  const rows: TouchRow[] = [];
  for (const scenario of scenarioBank as unknown as Array<Record<string, unknown>>) {
    for (const actor of (scenario["actors"] as Array<Record<string, unknown>>) ?? []) {
      const mechanics = actor["bodyMechanics"] as Record<string, unknown> | undefined;
      for (const row of (mechanics?.["touchResponses"] as Array<Record<string, unknown>>) ?? []) {
        rows.push({
          scenarioId: String(scenario["scenarioId"]),
          actorId: String(actor["actorId"]),
          region: String(row["region"]),
          responseClip: String(row["responseClip"]),
          traceTag: row["traceTag"] === undefined ? undefined : String(row["traceTag"]),
        });
      }
    }
  }
  return rows;
}

/** The region vocabulary, read from the schema rather than restated. */
function vocabularyRegions(): string[] {
  const union = (ComplianceRegionSchema as unknown as { anyOf?: Array<{ const?: unknown }> }).anyOf ?? [];
  return union.map((member) => String(member.const));
}

type ResolverModule = {
  responseClipForBodyRegion?: (region: string) => string;
};

async function loadResolver(): Promise<ResolverModule | null> {
  try {
    return (await import(/* @vite-ignore */ RESOLVER_MODULE)) as ResolverModule;
  } catch {
    return null;
  }
}

describe("the touch response clip follows the region", () => {
  it("(1) the clip is a function OF THE REGION — same region agrees, different regions differ", () => {
    const rows = liveTouchRows();

    // COUNTERWEIGHT, first: this clause must not pass by finding nothing. Both bounds come from the
    // measured header, and both fail if the bank is emptied or its regions collapsed to reach green.
    expect(rows.length, "the bank must still carry the 20 measured touch rows").toBeGreaterThanOrEqual(20);
    const regions = [...new Set(rows.map((r) => r.region))];
    expect(regions.length, "the bank must still author at least the 6 measured regions").toBeGreaterThanOrEqual(6);

    // (a) DETERMINED BY the region: one region must not get two different clips.
    const clipsByRegion = new Map<string, Set<string>>();
    for (const row of rows) {
      const seen = clipsByRegion.get(row.region) ?? new Set<string>();
      seen.add(row.responseClip);
      clipsByRegion.set(row.region, seen);
    }
    for (const [region, clips] of clipsByRegion) {
      expect(
        [...clips],
        `region ${region} is bound to ${clips.size} different clips across scenarios — the binding is per-row, not per-region`,
      ).toHaveLength(1);
    }

    // (b) DISCRIMINATES the region — the defect. Anatomically distinct regions must not share a clip.
    // This is the half that is red today: six regions, one clip.
    const clipToRegions = new Map<string, Set<string>>();
    for (const row of rows) {
      const seen = clipToRegions.get(row.responseClip) ?? new Set<string>();
      seen.add(row.region);
      clipToRegions.set(row.responseClip, seen);
    }
    for (const [clip, boundRegions] of clipToRegions) {
      expect(
        [...boundRegions].sort(),
        `clip ${clip} answers for ${boundRegions.size} anatomically distinct regions — a learner palpating any of them is played the same flinch`,
      ).toHaveLength(1);
    }
  });

  it("(2) the binding is RESOLVED for the whole vocabulary, not transcribed from the 24 rows", async () => {
    // A 6-entry lookup copied out of the bank satisfies clause (1) and leaves the next region to be
    // hand-authored — which is the per-region table this factory exists to remove. The vocabulary is
    // larger than the bank, so totality over it cannot be met by transcription.
    const resolver = await loadResolver();
    expect(
      typeof resolver?.responseClipForBodyRegion,
      `${RESOLVER_MODULE} must export responseClipForBodyRegion — it does not exist yet`,
    ).toBe("function");
    const resolve = resolver!.responseClipForBodyRegion!;

    const vocabulary = vocabularyRegions();
    const rows = liveTouchRows();
    const authored = new Set(rows.map((r) => r.region));
    const unauthored = vocabulary.filter((region) => !authored.has(region));

    expect(vocabulary.length, "the compliance region vocabulary must be readable from the schema").toBeGreaterThanOrEqual(10);
    expect(
      unauthored.length,
      "every vocabulary region already has a row, so totality here would prove nothing — this clause needs regions with nothing to copy from",
    ).toBeGreaterThan(0);

    // (a) The authored rows must AGREE with the resolver, so the 24 literals are derived rather than
    // a second source of truth that can drift from it.
    for (const row of rows) {
      expect(
        resolve(row.region),
        `${row.scenarioId}/${row.region} names a clip the resolver does not produce — two sources of truth`,
      ).toBe(row.responseClip);
    }

    // (b) TOTALITY. Regions with no row must still resolve, and to distinct clips.
    const unauthoredClips = unauthored.map((region) => resolve(region));
    for (const [index, clip] of unauthoredClips.entries()) {
      expect(
        typeof clip === "string" && clip.length > 0,
        `${unauthored[index]} has no row to copy and the resolver could not answer for it`,
      ).toBe(true);
    }
    expect(
      new Set(unauthoredClips).size,
      "regions with no authored row all resolved to the same clip — the resolver discriminates only what it was transcribed from",
    ).toBe(unauthored.length);

    // (c) INJECTIVE OVER THE WHOLE VOCABULARY, not just the part with nothing to copy.
    //
    // Found by probing (b): a resolver returning distinct clips for the four UNAUTHORED regions
    // while still collapsing the six authored ones passed (a) and (b) outright. The defect under
    // repair lives entirely in the authored six, so a clause that only exercises the other four is
    // narrower than its own claim — and clause (1) catching it does not make this clause honest,
    // because a bank edited to agree with such a resolver satisfies (1) too.
    const allClips = vocabulary.map((region) => resolve(region));
    const collapsed = [...new Set(allClips)];
    expect(
      collapsed.length,
      `the resolver maps ${vocabulary.length} regions onto ${collapsed.length} clips — regions sharing a clip are regions a learner cannot distinguish`,
    ).toBe(vocabulary.length);
  });

  it("(3) LIVE: the shipped RLQ binding survives — this replaces a mapping, it does not delete one", () => {
    // §6p COUNTERWEIGHT. A contract that removes something must say what takes over its job. The
    // cheapest way to satisfy clause (1)(b) is to stop naming clips at all, or to rename every one;
    // the one clip that EXISTS today must still be the answer for the region it was authored for.
    const rows = liveTouchRows();
    const rlq = rows.filter((row) => row.region === "abdomen_rlq");
    expect(rlq.length, "the bank must still author an RLQ touch response").toBeGreaterThan(0);
    for (const row of rlq) {
      expect(
        row.responseClip,
        `${row.scenarioId} no longer routes abdomen_rlq to the one clip that has actually been produced`,
      ).toBe("openclinxr_role_patient_guard_withdraw_rlq");
      expect(row.traceTag, "the RLQ trace tag must survive the rebinding").toBe("clinical_touch_guard_rlq");
    }
  });

  it("(4) the shipped test stops pinning one clip across all six regions", () => {
    // The defect is asserted as correct by a test that ships. Left alone, a worker fixing the data
    // makes ed-chest-pain.test.ts red and may reasonably read that as having broken something.
    //
    // Reading another test's SOURCE is deliberate: this is the only mechanically checkable form of
    // "that assertion encodes the old behaviour and must change". A prose note in the card would be
    // a warning, and warnings do not fail.
    const source = readFileSync(join(HERE, "ed-chest-pain.test.ts"), "utf8");
    expect(
      /responseClip\)\.toBe\("openclinxr_role_patient_guard_withdraw_rlq"\)/.test(source),
      "ed-chest-pain.test.ts still asserts the single RLQ clip inside its region loop — update it to expect the region's own clip",
    ).toBe(false);
    // COUNTERWEIGHT: it must still assert something about the clip. Deleting the line is not the fix.
    expect(
      /responseClip/.test(source),
      "ed-chest-pain.test.ts no longer asserts anything about responseClip — the pin was deleted, not corrected",
    ).toBe(true);
  });
});
