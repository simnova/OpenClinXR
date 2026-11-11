/**
 * RR1 framing-census verdict logic. Store-free: reads only the fixture
 * copies under fixtures/rr1-framing/ (one run per framing group).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { RunFramingEvidence } from "./rr1-framing-census";
import {
  differingInputFields,
  framesDiffer,
  verdictFramingCensus,
} from "./rr1-framing-census";

const FIXTURES = join(process.cwd(), "tools/openclinxr/evidence/site/fixtures/rr1-framing");

function loadFixture(name: string): RunFramingEvidence {
  return JSON.parse(readFileSync(join(FIXTURES, name), "utf8")) as RunFramingEvidence;
}

describe("RR1 framing census", () => {
  it("narrow + wide fixtures: recorded inputs identical, frames differ -> inputs_identical_frames_differ", () => {
    const runs = [loadFixture("narrow.json"), loadFixture("wide.json")];
    expect(differingInputFields(runs)).toEqual([]);
    expect(framesDiffer(runs)).toBe(true);
    const result = verdictFramingCensus(runs);
    expect(result.verdict).toBe("inputs_identical_frames_differ");
    expect(result.reason.length).toBeGreaterThan(0);
  });

  it("a differing recorded input -> inputs_differ naming the field", () => {
    const runs = [loadFixture("narrow.json"), loadFixture("wide.json")];
    const altered: RunFramingEvidence = {
      ...runs[1],
      viewport: { status: "recorded", value: "1280x800", source: "synthetic" },
    };
    const result = verdictFramingCensus([runs[0], altered]);
    expect(result.verdict).toBe("inputs_differ");
    expect(result.differingFields).toContain("viewport");
    expect(result.reason).toContain("viewport");
  });

  it("matching frames with unrecorded core inputs -> unrecorded", () => {
    const runs = [loadFixture("narrow.json"), loadFixture("wide.json")];
    const sameFrame: RunFramingEvidence = { ...runs[1], ch1RightStripMeanLuma: runs[0].ch1RightStripMeanLuma };
    const result = verdictFramingCensus([runs[0], sameFrame]);
    expect(result.verdict).toBe("unrecorded");
    expect(result.reason.length).toBeGreaterThan(0);
  });

  it("matching frames with every input recorded -> other", () => {
    const recorded = (value: string): RunFramingEvidence["seed"] => ({
      status: "recorded",
      value,
      source: "synthetic",
    });
    const base: RunFramingEvidence = {
      ...loadFixture("narrow.json"),
      run: "synthetic-a",
      cameraPosition: recorded("0,1.48,5.35"),
      cameraTarget: recorded("0,1.04,-0.18"),
      cameraFov: recorded("55"),
      roomAssetPath: recorded("/xr-assets/environment/infinigen-ed-exam-bay.glb"),
      roomAssetSha256: recorded("synthetic"),
      ch1RightStripMeanLuma: 205.0,
    };
    const twin: RunFramingEvidence = { ...base, run: "synthetic-b", ch1RightStripMeanLuma: 205.4 };
    const result = verdictFramingCensus([base, twin]);
    expect(result.verdict).toBe("other");
  });
});
