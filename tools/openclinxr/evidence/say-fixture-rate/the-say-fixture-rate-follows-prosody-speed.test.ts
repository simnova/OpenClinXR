import { describe, expect, it } from "vitest";
import {
  MACOS_SAY_DEFAULT_WPM,
  sayFixtureArgv,
  sayRateWpmFromProsodySpeed,
} from "../../../../packages/openclinxr/factory-stations/src/lip_sync/fixture-wav.ts";

/**
 * Fixture `say -r` must follow the emotion mapper speed table
 * (pain 0.85, anxious 0.95, else 1.0) without shelling TTS.
 * Diagnosis header IMMUTABLE.
 */
describe("say fixture rate follows prosody speed", () => {
  it("maps mapper speeds onto say -r WPM from the 175 default", () => {
    expect(MACOS_SAY_DEFAULT_WPM).toBe(175);
    expect(sayRateWpmFromProsodySpeed(1)).toBe(175);
    expect(sayRateWpmFromProsodySpeed(0.95)).toBe(166);
    expect(sayRateWpmFromProsodySpeed(0.85)).toBe(149);
  });

  it("clamps to the shared-schema 0.7–1.5 band", () => {
    expect(sayRateWpmFromProsodySpeed(0.7)).toBe(122);
    expect(sayRateWpmFromProsodySpeed(1.5)).toBe(263);
    expect(sayRateWpmFromProsodySpeed(0.1)).toBe(122);
    expect(sayRateWpmFromProsodySpeed(9)).toBe(263);
  });

  it("omits -r when speed is omitted (historical fixture argv)", () => {
    expect(sayFixtureArgv("/tmp/x.aiff", "hello")).toEqual(["-o", "/tmp/x.aiff", "hello"]);
  });

  it("counterweight: omitted speed is not the same argv as speed 1.0", () => {
    const omitted = sayFixtureArgv("/tmp/x.aiff", "hello").join(" ");
    const one = sayFixtureArgv("/tmp/x.aiff", "hello", { prosodySpeed: 1 }).join(" ");
    expect(one).toContain("-r 175");
    expect(omitted).not.toContain("-r");
  });

  it("pain 0.85 inserts -r 149; anxious 0.95 inserts -r 166", () => {
    expect(sayFixtureArgv("/tmp/x.aiff", "line", { prosodySpeed: 0.85, voice: "Samantha" })).toEqual([
      "-v",
      "Samantha",
      "-r",
      "149",
      "-o",
      "/tmp/x.aiff",
      "line",
    ]);
    expect(sayFixtureArgv("/tmp/x.aiff", "line", { prosodySpeed: 0.95 })).toEqual([
      "-r",
      "166",
      "-o",
      "/tmp/x.aiff",
      "line",
    ]);
  });
});
