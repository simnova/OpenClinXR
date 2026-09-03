import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * OBSERVABLE: the artifact everyone is told to read before choosing a slice is three weeks stale, and
 * it cannot tell you so.
 *
 * `.openclinxr/evidence/issue-288/multi-case-rollup.json` records `generatedAt` and a `runner` string
 * and NOTHING about the tree it measured — no commit sha, no input hashes. So it is green about
 * nothing on every later read, and its numbers are quoted as current long after they stop being true.
 *
 * MEASURED 2026-09-03, and the drift is not hypothetical:
 *
 *   the artifact (generatedAt 2026-08-11T01:25:02Z) says
 *     casesFullyDeterministic 1 of 15
 *     frontierCounts { case_to_actor_params: 13, rigging: 1 }
 *     deterministicStationTotals.case_to_actor_params = 2 of 15
 *
 *   the LIVE seam, asked the same question through
 *   `orchestrate_character.allowed_case_actor_preset_ids` +
 *   `resolve_case_actor_params_with_source`, says
 *     34 allowed preset ids across 15 distinct cases
 *     33 of 34 actor entries resolve from `case_definition`, 1 from a legacy preset
 *     14 of 15 cases resolve ENTIRELY from the case definition
 *     legacy CASE_ACTOR_PRESETS is down to 4 rows
 *
 * Issue-650 ("the case is the source of its actors") inverted the bottleneck the artifact still
 * names. Anyone following the standing instruction to read the frontier before picking a slice is
 * pointed at `case_to_actor_params` — work that has already largely landed.
 *
 * ## WHY A DATE IS NOT ENOUGH, and why this asserts INPUT HASHES
 *
 * A freshness rule written as "generatedAt must be recent" goes red on a quiet week and gets deleted.
 * A rule written as "the sha must be an ancestor of HEAD" fires on every unrelated commit, which is
 * the same disease. What actually invalidates this measurement is a change to the code that DECIDES
 * station resolution, so that is what the artifact must hash: the runner, and the module whose
 * resolution order changed underneath it.
 *
 * IMMUTABLE diagnosis. Flip `it.fails` -> `it` and append a `## FIXED (#N)` block below. Do not
 * rewrite the measured tables.
 *
 * claimScope: whether the rollup artifact records the tree state it measured and can refuse itself
 *   when an input has moved.
 * notEvidenceFor: what the current frontier IS — this file does not run the chain and asserts no pass
 *   rate; whether any station works; anything about Blender, bakes, or render quality.
 *
 * ## FIXED (#0)
 * 2026-09-03. `tools/openclinxr/dark-factory/multi-case-runner.ts` now writes `measuredInputs`
 * (sha256 of each `ROLLUP_DECIDING_INPUTS` member — multi-case-runner.ts and
 * orchestrate_character.py — taken before any station runs) and `stale: false` into every rollup,
 * and exposes `refreshRollupStaleness` (CLI `--refresh-stale`) to rewrite an artifact whose inputs
 * have moved in place with `stale: true` instead of regenerating it. `pre-fix.json` records the
 * superseded rollup's headline figures so the drift between measurements stays readable. The rollup
 * was then re-run over the full 15-case population; the artifact it produced records the digests of
 * the tree it measured and is not stale. The immutability instruction in this header predates the
 * fix and is retained verbatim; the flipped assertions are the RED this fix turns green.
 */

const ROOT = join(import.meta.dirname, "../../..");
const ROLLUP = join(ROOT, ".openclinxr/evidence/issue-288/multi-case-rollup.json");

/**
 * The inputs that decide station resolution. If either moves, the recorded frontier may be wrong —
 * which is exactly what happened between 2026-08-11 and now.
 */
const DECIDING_INPUTS = [
  "tools/openclinxr/dark-factory/multi-case-runner.ts",
  "tools/openclinxr/asset-pipeline/anny/orchestrate_character.py",
] as const;

const sha256 = (rel: string): string =>
  createHash("sha256").update(readFileSync(join(ROOT, rel))).digest("hex");

const rollup = (): Record<string, unknown> =>
  JSON.parse(readFileSync(ROLLUP, "utf8")) as Record<string, unknown>;

describe("the multi-case rollup knows what tree it measured", () => {
  it("(0) VACUITY GUARD: the artifact and both deciding inputs are present", () => {
    // Without this, the clauses below would pass identically if the rollup were deleted.
    expect(existsSync(ROLLUP), `${ROLLUP} is missing — there is no frontier to read at all`).toBe(true);
    for (const rel of DECIDING_INPUTS) {
      expect(existsSync(join(ROOT, rel)), `${rel} is named as a deciding input but does not exist`).toBe(true);
    }
    expect(rollup()["summary"], "the artifact carries no summary — it is not the rollup").toBeDefined();
  });

  it("(1) RED: the rollup records the sha256 of every input that decides station resolution", () => {
    const r = rollup();
    const declared = (r["measuredInputs"] ?? {}) as Record<string, string>;
    for (const rel of DECIDING_INPUTS) {
      expect(Object.keys(declared), `the rollup records no hash for ${rel}, so it cannot know it is stale`)
        .toContain(rel);
    }
  });

  it("(2) RED: the recorded hashes still match the tree, or the artifact declares itself stale", () => {
    // COUNTERWEIGHT to (1): recording a hash field is cheap and proves nothing on its own. The value
    // has to be the REAL digest of the file it names, and it has to be checked. An artifact whose
    // inputs have moved is allowed to say so — `stale: true` is a legitimate, honest answer here and
    // is what a re-run must clear. What is not allowed is silence.
    const r = rollup();
    const declared = (r["measuredInputs"] ?? {}) as Record<string, string>;
    const drifted = DECIDING_INPUTS.filter((rel) => declared[rel] !== sha256(rel));
    if (drifted.length > 0) {
      expect(r["stale"], `inputs moved since the measurement (${drifted.join(", ")}) and the artifact does not say so`)
        .toBe(true);
      return;
    }
    for (const rel of DECIDING_INPUTS) {
      expect(declared[rel], `${rel}: recorded hash is not this file's digest`).toBe(sha256(rel));
    }
  });
});
