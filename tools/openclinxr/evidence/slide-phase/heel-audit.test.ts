import { describe, expect, it } from "vitest";
import {
  computeRunAudit,
  decideRoute,
  detectMarkerPlants,
  type HeelAuditFrame,
} from "./heel-audit.js";

const V = (x: number, y: number, z = 0) => ({ x, y, z });

function frame(opts: {
  heelY: number;
  heelX?: number;
  toeY: number;
  toeX?: number;
  phase?: string | null;
}): HeelAuditFrame {
  return {
    phase: opts.phase ?? "walking",
    leftToe: V(opts.toeX ?? 0, opts.toeY),
    rightToe: null,
    legWorlds: { heelL: V(opts.heelX ?? 0, opts.heelY), heelR: null },
  };
}

/** 40 frames: heel plants [10,20] + [30,35] (frozen), toe plant [12,24]. */
function cleanRun(): HeelAuditFrame[] {
  const out: HeelAuditFrame[] = [];
  for (let i = 0; i < 40; i += 1) {
    const heelDown = (i >= 10 && i <= 20) || (i >= 30 && i <= 35);
    const toeDown = i >= 12 && i <= 24;
    out.push(
      frame({
        heelY: heelDown ? 0.07 : 0.2,
        toeY: toeDown ? 0.01 : 0.2,
      }),
    );
  }
  return out;
}

describe("heel-audit instrument", () => {
  it("detects heel and toe plants from their own series and validates the order", () => {
    const run = computeRunAudit("clean", "clean.json", cleanRun());
    expect(run.heelPlants).toHaveLength(2);
    expect(run.toePlants).toHaveLength(1);
    expect(run.stances).toHaveLength(1);
    const s = run.stances[0]!;
    expect([s.heelStrike, s.footFlat, s.heelOff, s.toeOff]).toEqual([10, 12, 20, 24]);
    expect(s.orderOk).toBe(true);
    expect(s.violatedAt).toBeNull();
    // Gait cycle [10,30): fractions of the 20-frame cycle.
    expect(s.cycleEnd).toBe(30);
    expect(s.fracHeelStrike).toBeCloseTo(0, 9);
    expect(s.fracFootFlat).toBeCloseTo(0.1, 9);
    expect(s.fracHeelOff).toBeCloseTo(0.5, 9);
    expect(s.fracToeOff).toBeCloseTo(0.7, 9);
    expect(run.unpairedHeelPlants).toHaveLength(1);
    expect(run.unpairedHeelPlants[0]?.startFrame).toBe(30);
    expect(run.maxHeelSpanM).toBeCloseTo(0, 9);
    expect(run.violationRate).toBe(0);
  });

  it("reports a slow heel drift as span even though the speed gate holds", () => {
    // 0.6 mm/frame = 0.018 m/s (under the 0.02 gate) over 30 frames = 17.4 mm.
    const frames: HeelAuditFrame[] = [];
    for (let i = 0; i < 40; i += 1) {
      const down = i >= 5 && i <= 34;
      frames.push(
        frame({ heelY: down ? 0.07 : 0.2, heelX: down ? (i - 5) * 0.0006 : 0, toeY: 0.2 }),
      );
    }
    const run = computeRunAudit("drift", "drift.json", frames);
    expect(run.heelPlants).toHaveLength(1);
    expect(run.heelPlants[0]?.spanPairM).toBeCloseTo(0.0174, 4);
    expect(run.maxHeelSpanM).toBeGreaterThan(0.01);
    const decision = decideRoute("drift-route", [run]);
    expect(decision.spanPass).toBe(false);
    expect(decision.pass).toBe(false);
  });

  it("flags toe-already-down as an order violation (strict heelStrike < footFlat)", () => {
    const frames: HeelAuditFrame[] = [];
    for (let i = 0; i < 30; i += 1) {
      frames.push(
        frame({ heelY: i >= 12 && i <= 18 ? 0.07 : 0.2, toeY: i >= 10 && i <= 20 ? 0.01 : 0.2 }),
      );
    }
    const run = computeRunAudit("early-toe", "early-toe.json", frames);
    expect(run.stances).toHaveLength(1);
    expect(run.stances[0]?.orderOk).toBe(false);
    expect(run.stances[0]?.violatedAt).toBe("heelStrike<footFlat");
    expect(run.violationRate).toBe(1);
  });

  it("treats simultaneous plant starts as a violation (strict inequality)", () => {
    const frames: HeelAuditFrame[] = [];
    for (let i = 0; i < 30; i += 1) {
      frames.push(
        frame({ heelY: i >= 10 && i <= 20 ? 0.07 : 0.2, toeY: i >= 10 && i <= 20 ? 0.01 : 0.2 }),
      );
    }
    const run = computeRunAudit("same-start", "same-start.json", frames);
    expect(run.stances).toHaveLength(1);
    expect(run.stances[0]?.orderOk).toBe(false);
  });

  it("leaves fractions null on the open final cycle", () => {
    const frames: HeelAuditFrame[] = [];
    for (let i = 0; i < 30; i += 1) {
      frames.push(
        frame({ heelY: i >= 10 && i <= 20 ? 0.07 : 0.2, toeY: i >= 12 && i <= 24 ? 0.01 : 0.2 }),
      );
    }
    const run = computeRunAudit("open", "open.json", frames);
    expect(run.stances).toHaveLength(1);
    const s = run.stances[0]!;
    expect(s.orderOk).toBe(true);
    expect(s.cycleEnd).toBeNull();
    expect(s.fracFootFlat).toBeNull();
  });

  it("scales the speed gate by the sample dt (bound-clip style timing)", () => {
    const xs = [0, 0.001, 0.002];
    const ys = [0.07, 0.07, 0.07];
    // dt = 1/24 s: 1 mm steps = 0.024 m/s -> splits, no plant.
    const split = detectMarkerPlants({
      xs, zs: [0, 0, 0], ys,
      times: [0, 1 / 24, 2 / 24],
      foot: "left", kind: "heel",
    });
    expect(split).toHaveLength(0);
    // dt = 1/60 s: 1 mm steps = 0.06 m/s -> also splits.
    const split2 = detectMarkerPlants({
      xs, zs: [0, 0, 0], ys,
      times: [0, 1 / 60, 2 / 60],
      foot: "left", kind: "heel",
    });
    expect(split2).toHaveLength(0);
    // 0.2 mm steps at 1/24 s = 0.0048 m/s -> one plant, span 0.4 mm.
    const held = detectMarkerPlants({
      xs: [0, 0.0002, 0.0004], zs: [0, 0, 0], ys,
      times: [0, 1 / 24, 2 / 24],
      foot: "left", kind: "heel",
    });
    expect(held).toHaveLength(1);
    expect(held[0]?.spanPairM).toBeCloseTo(0.0004, 9);
  });
});
