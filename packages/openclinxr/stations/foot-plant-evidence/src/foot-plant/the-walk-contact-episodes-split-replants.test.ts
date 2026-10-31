import { describe, expect, it } from "vitest";
import { contactEpisodes } from "../../../../../../tools/openclinxr/evidence/foot-plant/ccd-stance-lock/ccd-browser-metrics.js";
import { computeTurnQuality, type TurnQualityFrame } from "../../../../../../tools/openclinxr/evidence/foot-plant/turn-quality-metrics.js";

function frame(
  sample: number,
  phase: string,
  stanceFoot: "left" | "right",
  x: number,
  z: number,
  y: number,
): TurnQualityFrame {
  const toe = { x, y, z };
  return {
    sample,
    tMs: sample * 33,
    phase,
    left: stanceFoot === "left" ? { ...toe } : { x: 9, y: 0.2, z: 9 },
    right: stanceFoot === "right" ? { ...toe } : { x: -9, y: 0.2, z: -9 },
    stanceFoot,
  };
}

describe("walk contact episodes", () => {
  it("splits a same-foot replant into a second contact anchored at the reland", () => {
    const frames: TurnQualityFrame[] = [];
    // Contact 1: left holds near the origin (2 cm creep over 5 frames, never lifts).
    for (let i = 0; i < 5; i += 1) frames.push(frame(i, "walking", "left", i * 0.005, 0, 0.004));
    // Lift and a short swing: 2 cm up, 5 cm of travel.
    frames.push(frame(5, "walking", "left", 0.03, 0, 0.03));
    frames.push(frame(6, "walking", "left", 0.05, 0, 0.03));
    // Reland 6 cm from the anchor: a new contact, holds with 4 mm creep.
    for (let i = 7; i < 10; i += 1) frames.push(frame(i, "walking", "left", 0.06 + (i - 7) * 0.002, 0, 0.003));
    const episodes = contactEpisodes(frames, "walking");
    expect(episodes.length).toBe(2);
    expect(episodes[0]!.startSample).toBe(0);
    expect(episodes[1]!.startSample).toBe(7);
    expect(episodes[1]!.slideMeters).toBeCloseTo(0.004, 5);
  });

  it("keeps a same-foot snap without lift inside one contact (it is slide, not a landing)", () => {
    const frames: TurnQualityFrame[] = [];
    for (let i = 0; i < 4; i += 1) frames.push(frame(i, "walking", "right", i * 0.004, 0, 0.003));
    // 3 cm single-frame jump, toe never leaves the floor: no new contact.
    for (let i = 4; i < 7; i += 1) frames.push(frame(i, "walking", "right", 0.012 + 0.03 + (i - 4) * 0.002, 0, 0.003));
    const episodes = contactEpisodes(frames, "walking");
    expect(episodes.length).toBe(1);
    expect(episodes[0]!.slideMeters).toBeCloseTo(0.046, 5);
  });

  it("settling episodes reproduce computeTurnQuality plantedSlideM exactly", () => {
    const frames: TurnQualityFrame[] = [];
    frames.push(frame(0, "walking", "left", 0, 0, 0.004));
    frames.push(frame(1, "walking", "right", 0.3, 0, 0.004));
    for (let i = 2; i < 6; i += 1) frames.push(frame(i, "settling", "right", (i - 2) * 0.004, 0, 0.002));
    frames.push(frame(6, "settling", "right", 0.02, 0, 0.03));
    for (let i = 7; i < 10; i += 1) frames.push(frame(i, "settling", "right", 0.06 + (i - 7) * 0.001, 0, 0.002));
    const quality = computeTurnQuality({ frames });
    const episodes = contactEpisodes(frames, "settling");
    expect(episodes.length).toBe(2);
    expect(Math.max(...episodes.map((e) => e.slideMeters))).toBe(quality.plantedSlideM);
  });
});
