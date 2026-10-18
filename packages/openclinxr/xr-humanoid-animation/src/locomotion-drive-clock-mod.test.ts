import { describe, expect, it } from "vitest";
import { resolveIdleLifePhaseSeconds } from "./locomotion-drive-clock-mod.js";

/**
 * Entry-anchored idle-life phase for driven slots (walk-start slice).
 *
 * A driven slot's phase runs on drive age from the first driven frame plus
 * a stable actorId-hash stagger — never on wall/sim `nowMs` (whose anchor
 * is load timing) and never on creation-order `phaseOffsetMs` (whose order
 * is GLB-completion timing). Undriven slots and the deterministic capture
 * clock keep the legacy `nowMs` path exactly.
 */

const SLOT = { actorId: "senior_resident_ward_v1", phaseOffsetMs: 960 };
const DRIVE = { locomotion: 1 };

describe("resolveIdleLifePhaseSeconds", () => {
  it("ages from the first driven frame with a stable actor stagger", () => {
    const first = resolveIdleLifePhaseSeconds(SLOT, DRIVE, 1 / 60, 1_700_000_000_000, false);
    const second = resolveIdleLifePhaseSeconds(SLOT, DRIVE, 1 / 60, 1_700_000_000_000, false);
    // Two driven 1/60 s frames: age advances exactly one substep; the wall
    // clock never enters; the stagger is identical for the same actorId.
    expect(second - first).toBeCloseTo(1 / 60, 12);
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(2);
  });

  it("resets the age when the drive lapses and falls back to nowMs", () => {
    const other = { actorId: "other", phaseOffsetMs: 0 };
    resolveIdleLifePhaseSeconds(other, DRIVE, 1, 0, false);
    const fallback = resolveIdleLifePhaseSeconds(other, null, 1 / 60, 5000, false);
    expect(fallback).toBeCloseTo(5, 12);
    const restarted = resolveIdleLifePhaseSeconds(other, DRIVE, 1 / 60, 5000, false);
    expect(restarted).toBeLessThan(2);
  });

  it("keeps the legacy nowMs path under the deterministic capture clock", () => {
    const frozen = resolveIdleLifePhaseSeconds(SLOT, DRIVE, 1 / 60, 2000, true);
    expect(frozen).toBeCloseTo((2000 + SLOT.phaseOffsetMs) / 1000, 12);
  });

  it("ignores a drive addressed to another actor", () => {
    const foreign = resolveIdleLifePhaseSeconds(
      SLOT,
      { actorId: "someone_else", locomotion: 1 },
      1 / 60,
      2000,
      false,
    );
    expect(foreign).toBeCloseTo((2000 + SLOT.phaseOffsetMs) / 1000, 12);
  });
});
