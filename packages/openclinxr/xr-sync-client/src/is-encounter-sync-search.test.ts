import { describe, expect, it } from "vitest";
import { isEncounterSyncSearch } from "./headset.js";

describe("isEncounterSyncSearch", () => {
  it("is true for a sync search", () => {
    expect(isEncounterSyncSearch("?encounterSync=ws://x")).toBe(true);
  });

  it("is false without the sync param", () => {
    expect(isEncounterSyncSearch("")).toBe(false);
    expect(isEncounterSyncSearch("?capture=wide")).toBe(false);
  });
});
