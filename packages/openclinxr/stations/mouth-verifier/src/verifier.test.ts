import { describe, expect, it } from "vitest";
import {
  DY_GATE_BIAS_PX,
  DY_GATE_DETRENDED_MEDIAN_PX,
  DY_GATE_MAX_PX,
} from "@openclinxr/station-mouth-objective";
import { DY_GATE_RULE, assertGroundTruthDyGate, evaluate, probePremise, readEvaluatorTrack } from "./index.js";

describe("mouth verifier gate", () => {
  it("bounds match the objective thresholds", () => {
    expect(DY_GATE_BIAS_PX).toBe(3);
    expect(DY_GATE_DETRENDED_MEDIAN_PX).toBe(2);
    expect(DY_GATE_MAX_PX).toBe(5);
  });

  it("passes inside the gate and names the rule outside it", () => {
    expect(() => assertGroundTruthDyGate(0, 0, 0)).not.toThrow();
    expect(() => assertGroundTruthDyGate(3.1, 0, 0)).toThrow(DY_GATE_RULE);
    expect(() => assertGroundTruthDyGate(0, 2.1, 0)).toThrow(DY_GATE_RULE);
    expect(() => assertGroundTruthDyGate(0, 0, 5.1)).toThrow(DY_GATE_RULE);
  });

  it("exports the evaluator entry points", () => {
    expect(typeof evaluate).toBe("function");
    expect(typeof probePremise).toBe("function");
    expect(typeof readEvaluatorTrack).toBe("function");
  });
});
