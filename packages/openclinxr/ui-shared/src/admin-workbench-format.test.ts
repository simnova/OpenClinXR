import { describe, expect, it } from "vitest";
import {
  capabilityTagColor,
  clampedScoreFromWorkbenchInput,
  countActorCommunicationProfiles,
  formatDuration,
  formatMinutes,
  pluralizeWorkbenchCount,
  uniqueWorkbenchValues,
} from "./admin-workbench-format.js";

describe("admin workbench format helpers", () => {
  it("counts actors with communication profiles", () => {
    expect(countActorCommunicationProfiles([{ communicationProfile: {} }, {}])).toBe(1);
  });

  it("formats durations and minute values", () => {
    expect(formatDuration(18720)).toBe("5h 12m");
    expect(formatMinutes(720)).toBe("12m");
  });

  it("dedupes values and pluralizes counts", () => {
    expect(uniqueWorkbenchValues(["a", "a", "b"])).toEqual(["a", "b"]);
    expect(pluralizeWorkbenchCount(1, "event")).toBe("event");
    expect(pluralizeWorkbenchCount(2, "event")).toBe("events");
  });

  it("clamps score input to the 0-2 faculty range", () => {
    expect(clampedScoreFromWorkbenchInput("5")).toBe(2);
    expect(clampedScoreFromWorkbenchInput("abc")).toBe(0);
  });

  it("maps capability tags to colors", () => {
    expect(capabilityTagColor("GraphQL Codegen")).toBe("green");
    expect(capabilityTagColor("unknown")).toBe("default");
  });
});
