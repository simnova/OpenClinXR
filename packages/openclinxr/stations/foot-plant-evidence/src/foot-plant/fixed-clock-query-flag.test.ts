import { describe, expect, it } from "vitest";
import {
  parseFixedClockEnabled,
  readFixedClockEnabled,
} from "../../../../../../packages/openclinxr/xr-humanoid-animation/dist/fixed-clock-query-flag-mod.js";

describe("fixed-clock query flag", () => {
  it("reads fixedClock=1 as true", () => {
    expect(parseFixedClockEnabled("?fixedClock=1")).toBe(true);
  });

  it("reads absent as true (default on)", () => {
    expect(parseFixedClockEnabled("")).toBe(true);
    expect(parseFixedClockEnabled("?stationId=x")).toBe(true);
  });

  it("reads only exactly fixedClock=0 as false", () => {
    expect(parseFixedClockEnabled("?fixedClock=0")).toBe(false);
  });

  it("reads the flag beside other params", () => {
    expect(parseFixedClockEnabled("?stationId=x&fixedClock=1")).toBe(true);
    expect(parseFixedClockEnabled("?fixedClock=1&stationId=x")).toBe(true);
    expect(parseFixedClockEnabled("?stationId=x&fixedClock=0")).toBe(false);
  });

  it("reads false with no window (node)", () => {
    expect(readFixedClockEnabled()).toBe(false);
  });
});
