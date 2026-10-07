/**
 * M6 retire-old-paths gate: the tools CLIs are wrappers over their station,
 * and the moved originals are absent from tools/.
 *
 * evaluate.ts wraps the verifier; seat-teeth-on-lip-rim.ts wraps the registry
 * run. The seat keeps its pipeline exports (planRimSeat, lowerArchByJoint)
 * for the jaw-lip-couple evidence test outside the M6 writeRoots and the
 * tongue TH test; the station entry exports no plan, so a follow-up card
 * with evidence writeRoots plus station plan exports retires them. The
 * headless-scene shim stays for the same evidence test.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EVALUATE = path.join(HERE, "evaluate.ts");
const SEAT = path.join(HERE, "..", "asset-pipeline", "makeclothes", "seat-teeth-on-lip-rim.ts");

function stationImports(source: string): string[] {
  const found: string[] = [];
  for (const match of source.matchAll(/from\s+["'](@openclinxr\/[^"']+)["']/g)) {
    found.push(match[1] ?? "");
  }
  return [...new Set(found)].sort();
}

describe("the wrappers call only their station", () => {
  it("evaluate.ts imports the verifier entry and no relative module", () => {
    const source = readFileSync(EVALUATE, "utf8");
    expect(stationImports(source)).toEqual(["@openclinxr/station-mouth-verifier"]);
    expect(source).not.toMatch(/from\s+["']\.\.?\//);
  });

  it("seat-teeth-on-lip-rim.ts reaches the registry run and no verifier or solver", () => {
    const source = readFileSync(SEAT, "utf8");
    const stations = stationImports(source);
    expect(stations).toContain("@openclinxr/station-mouth-registry");
    expect(stations).not.toContain("@openclinxr/station-mouth-verifier");
    expect(stations).not.toContain("@openclinxr/station-mouth-solver-closedform");
    expect(stations).not.toContain("@openclinxr/station-mouth-executor");
    expect(source).toMatch(/await run\(new Uint8Array\(input\), \{ targetGapMm \}\)/);
  });

  it("the moved evaluator originals are absent from tools/", () => {
    expect(existsSync(path.join(HERE, "mouth-evaluator.ts"))).toBe(false);
    expect(existsSync(path.join(HERE, "solver-types.ts"))).toBe(false);
  });

  it("retained compat stays until the follow-up card (evidence test + no station plan export)", () => {
    expect(existsSync(path.join(HERE, "headless-scene.ts"))).toBe(true);
    const seat = readFileSync(SEAT, "utf8");
    expect(seat).toMatch(/export async function planRimSeat\(/);
    expect(seat).toMatch(/export function lowerArchByJoint\(/);
  });
});
