/**
 * Counterweight (MADR 0061 mouth-station pilot): the evaluator output on the
 * step3 fixed-capture track is byte-stable. This pins the CURRENT tools/
 * evaluator bytes before the station refactor, so the new solver package
 * must reproduce them unchanged. Compares against the committed fixture
 * generated at this commit, not against live gates.
 *
 * Epoch note 2026-10-28: the historical M3-era snapshot calibration
 * recorded against an older asset is superseded by the current-epoch
 * snapshot below. The historical fixture at the old path is preserved
 * byte-exact under SHA 6337dd72 and pinned by the hash-preservation test.
 * No M3 parity claim is made for either fixture.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { evaluate, readEvaluatorTrack } from "@openclinxr/station-mouth-verifier/evidence-mouth";
import { describe, expect, it } from "vitest";

const GLB = new URL(
  "../../../../../apps/ui-xr/public/generated-humanoids/mpfb-peds-parent-aisha.glb",
  import.meta.url,
).pathname;
const TRACK_PATH = new URL(
  "../../../../../docs/openclinxr/mouth-dynamics/teeth-gap/fixed-capture/metrics.json",
  import.meta.url,
).pathname;
const HISTORICAL_FIXTURE_PATH = new URL(
  "./the-evaluator-output-is-unchanged.fixture.json",
  import.meta.url,
).pathname;
const CURRENT_FIXTURE_PATH = new URL(
  "./the-evaluator-output-current-20261028.fixture.json",
  import.meta.url,
).pathname;

function stableJson(value: unknown): string {
  return JSON.stringify(value, (key, input: unknown) => (key === "wallClockMs" ? 0 : input));
}

function normalize(output: Record<string, unknown>): Record<string, unknown> {
  return { ...output, glbPath: "<GLB>", trackPath: "<TRACK>" };
}

describe("the evaluator output is unchanged", () => {
  it("current-epoch full JSON of evaluate(step3 track) equals the current fixture", async () => {
    const track = readEvaluatorTrack(TRACK_PATH);
    const { output } = await evaluate(GLB, track);
    const expected = JSON.parse(readFileSync(CURRENT_FIXTURE_PATH, "utf8")) as unknown;
    expect(stableJson(normalize(output as Record<string, unknown>))).toBe(stableJson(expected));
  }, 120_000);

  it("preserves the historical calibration fixture byte-exact (SHA 6337dd72)", async () => {
    const bytes = readFileSync(HISTORICAL_FIXTURE_PATH);
    const digest = createHash("sha256").update(bytes).digest("hex");
    expect(digest).toBe("6337dd72a2ae5c8e4f9d6349c7b8e21b2e926fd80258d830993d725f6a0a0a57");
  });
});
