import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { mouthClosedformSolver } from "./index.js";

const tuning = JSON.parse(
  readFileSync(new URL("./tuning.json", import.meta.url), "utf8"),
) as { inputHash: string };

describe("a mismatched tuning file is refused", () => {
  it("throws when the problem hash is not the tuned input", () => {
    expect(() =>
      mouthClosedformSolver.solve({
        inputHash: "0".repeat(64),
        trackId: "step3",
        frameRate: 30,
        frameCount: 4,
      }),
    ).toThrow(/inputHash/);
  });

  it("throws on a near-miss hash, not just the zero hash", () => {
    const last = tuning.inputHash.slice(-1);
    const nearMiss = `${tuning.inputHash.slice(0, -1)}${last === "0" ? "1" : "0"}`;
    expect(() =>
      mouthClosedformSolver.solve({
        inputHash: nearMiss,
        trackId: "step3",
        frameRate: 30,
        frameCount: 4,
      }),
    ).toThrow(/inputHash/);
  });
});
