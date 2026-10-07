/**
 * Counterweight (MADR 0061 mouth-station pilot): the evaluator output on the
 * step3 fixed-capture track is byte-stable. This pins the CURRENT tools/
 * evaluator bytes before the station refactor, so the new solver package
 * must reproduce them unchanged. Compares against the committed fixture
 * generated at this commit, not against live gates.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { evaluate, readEvaluatorTrack } from "@openclinxr/station-mouth-verifier";

const GLB = new URL(
  "../../../apps/ui-xr/public/generated-humanoids/mpfb-peds-parent-aisha.glb",
  import.meta.url,
).pathname;
const TRACK_PATH = new URL(
  "../../../docs/openclinxr/mouth-dynamics/teeth-gap/fixed-capture/metrics.json",
  import.meta.url,
).pathname;
const FIXTURE_PATH = new URL(
  "./the-evaluator-output-is-unchanged.fixture.json",
  import.meta.url,
).pathname;

function stableJson(value: unknown): string {
  return JSON.stringify(value, (key, input: unknown) => (key === "wallClockMs" ? 0 : input));
}

function normalize(output: Record<string, unknown>): Record<string, unknown> {
  return { ...output, glbPath: "<GLB>", trackPath: "<TRACK>" };
}

describe("the evaluator output is unchanged", () => {
  it("stable JSON of evaluate(step3 track) equals the committed fixture", async () => {
    const track = readEvaluatorTrack(TRACK_PATH);
    const { output } = await evaluate(GLB, track);
    const expected = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as unknown;
    expect(stableJson(normalize(output as Record<string, unknown>))).toBe(stableJson(expected));
  }, 120_000);
});
