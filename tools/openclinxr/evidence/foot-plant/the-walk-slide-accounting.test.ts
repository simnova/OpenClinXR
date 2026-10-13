import { describe, expect, it } from "vitest";
import {
  computeWalkSlideAccounting,
  INSTRUMENT_BAR_METERS,
  type AccountingFrame,
} from "./walk-slide-accounting.js";

/**
 * The slide accounting decomposes exactly on series with known answers.
 *
 * claimScope: the per-frame root/foot decomposition and the contact-level sums.
 * notEvidenceFor: browser captures, gait realism, clinical plausibility.
 */

function frame(
  i: number,
  slotX: number,
  leftX: number,
  rightX: number,
  stance: string | null,
  leftH = 0.01,
  rightH = 0.3,
): AccountingFrame {
  return {
    tMs: Math.round(i * 1000 / 30),
    phase: "walking",
    left: { x: leftX, y: 0.02, z: 0 },
    right: { x: rightX, y: 0.02, z: 0 },
    stanceFoot: stance,
    slot: { x: slotX, z: 0 },
    footBoneHeightMeters: { left: leftH, right: rightH },
  };
}

function fixedFootContact(): AccountingFrame[] {
  // Root advances 0.05 m/frame; the left foot is fixed in the world the whole contact.
  const frames: AccountingFrame[] = [];
  for (let i = 0; i < 10; i += 1) {
    frames.push(frame(i, i * 0.05, 1.0, 0.0, "left"));
  }
  return frames;
}

function carriedFootContact(): AccountingFrame[] {
  // Root advances 0.05 m/frame; the left foot travels WITH the body (body-frame still).
  const frames: AccountingFrame[] = [];
  for (let i = 0; i < 10; i += 1) {
    frames.push(frame(i, i * 0.05, 1.0 + i * 0.05, 0.0, "left"));
  }
  return frames;
}

describe("walk slide accounting", () => {
  it("a world-fixed stance foot slides 0 and the prediction matches", () => {
    const accounting = computeWalkSlideAccounting(fixedFootContact());
    expect(accounting.contacts).toHaveLength(1);
    const contact = accounting.contacts[0]!;
    expect(contact.measuredSlideM).toBeCloseTo(0, 9);
    expect(contact.predictedSlideM).toBeCloseTo(0, 9);
    expect(Math.abs(contact.predictedSlideM - contact.measuredSlideM))
      .toBeLessThanOrEqual(INSTRUMENT_BAR_METERS);
    expect(accounting.instrumentBarPass).toBe(true);
  });

  it("a foot moving with the body slides exactly the root travel", () => {
    const accounting = computeWalkSlideAccounting(carriedFootContact());
    expect(accounting.contacts).toHaveLength(1);
    const contact = accounting.contacts[0]!;
    // 9 intervals x 0.05 m of root travel, nothing cancelled by the foot.
    expect(contact.measuredSlideM).toBeCloseTo(0.45, 9);
    expect(contact.predictedSlideM).toBeCloseTo(0.45, 9);
    expect(accounting.instrumentBarPass).toBe(true);
  });

  it("a single-frame label run is dropped and counted, not measured", () => {
    const frames = fixedFootContact();
    // A one-frame right-label blip at the end: zero-length episode.
    frames.push(frame(10, 0.5, 1.0, 2.0, "right"));
    const accounting = computeWalkSlideAccounting(frames);
    expect(accounting.droppedZeroLengthEpisodes).toBe(1);
    expect(accounting.contacts).toHaveLength(1);
    expect(accounting.contacts[0]!.foot).toBe("left");
  });

  it("a low fast-moving unlabelled foot is reported as unlabelled stance", () => {
    const frames: AccountingFrame[] = [];
    // Labelled left stance first, so a global stance speed exists...
    for (let i = 0; i < 6; i += 1) {
      frames.push(frame(i, i * 0.05, 1.0, 0.0, "left"));
    }
    // ...then the label drops while the LEFT foot keeps stance kinematics:
    // fixed in the world (backward in the body frame) and low.
    for (let i = 6; i < 10; i += 1) {
      frames.push(frame(i, i * 0.05, 1.0, 0.0, null));
    }
    const accounting = computeWalkSlideAccounting(frames);
    const leftFlags = accounting.unlabelledStance.filter((u) => u.foot === "left");
    expect(leftFlags.length).toBeGreaterThan(0);
  });

  it("labelled frames that do not move back count against the contact", () => {
    const frames: AccountingFrame[] = [];
    // First half: foot fixed in world (moves back in the body frame).
    for (let i = 0; i < 5; i += 1) {
      frames.push(frame(i, i * 0.05, 1.0, 0.0, "left"));
    }
    // Second half: foot carried with the body (zero backward speed) while labelled.
    for (let i = 5; i < 10; i += 1) {
      frames.push(frame(i, i * 0.05, 1.0 + (i - 4) * 0.05, 0.0, "left"));
    }
    const accounting = computeWalkSlideAccounting(frames);
    expect(accounting.contacts).toHaveLength(1);
    expect(accounting.contacts[0]!.labelledButNotMovingBackFrames).toBeGreaterThan(0);
    expect(accounting.instrumentBarPass).toBe(true);
  });
});
