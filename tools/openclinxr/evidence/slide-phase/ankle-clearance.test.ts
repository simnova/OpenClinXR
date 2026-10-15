import { describe, expect, it } from "vitest";
import { analyzeSwings, angleAtAnkleDeg, resampleSwing, rmseIntersection } from "./ankle-clearance.js";

describe("ankle-clearance instrument", () => {
  it("measures a right angle as 90 deg", () => {
    expect(
      angleAtAnkleDeg({ x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }),
    ).toBeCloseTo(90, 9);
  });

  it("resamples a two-frame swing onto bins", () => {
    expect(resampleSwing([0, 10], 0, 1, 4)).toHaveLength(4);
  });

  it("reports clearance above the preceding stance datum, not the floor", () => {
    // Frames 0-2: stance at toe 0.05; frames 3-8: swing peaking 0.12, min mid 0.07;
    // frame 9: touchdown. Floor (min) is 0.05; datum is the stance mean 0.05;
    // mid-swing min 0.07 -> clearance 20 mm, while above-floor reads the same
    // here by construction; the datum-vs-floor split is covered below.
    const toeY = [0.05, 0.05, 0.05, 0.09, 0.11, 0.12, 0.1, 0.07, 0.06, 0.05];
    const heelY = [0.1, 0.1, 0.1, 0.15, 0.18, 0.2, 0.18, 0.14, 0.11, 0.1];
    const contact = toeY.map((y) => y - 0.05 <= 0.06);
    // Force the swing to start at frame 3: make frame 2 contact, frame 3 above band.
    const contact2 = [true, true, true, false, false, false, false, false, false, true];
    const res = analyzeSwings({
      toeY,
      heelY,
      ankleDeg: toeY.map(() => 100),
      contact: contact2,
      bins: 50,
    });
    expect(res.nSwings).toBe(1);
    expect(res.swings[0]?.toeDatum).toBeCloseTo(0.05, 9);
    expect(res.swings[0]?.heelDatum).toBeCloseTo(0.1, 9);
    // Mid-swing (phase 0.3-0.7 of frames 3..9) covers frames 5..7: min 0.07-0.05.
    expect(res.swings[0]?.minToeClrM).toBeCloseTo(0.02, 9);
    expect(contact).toBeDefined();
  });

  it("anchors the datum to the preceding stance when the floor sits lower", () => {
    // Stance rides at 0.06 (roll), walk minimum is 0.01 elsewhere: clearance
    // must read off 0.06, not 0.01.
    const toeY = [0.01, 0.06, 0.06, 0.06, 0.1, 0.12, 0.09, 0.08, 0.06];
    const heelY = toeY.map((y) => y + 0.05);
    const contact = [false, true, true, true, false, false, false, false, true];
    const res = analyzeSwings({
      toeY,
      heelY,
      ankleDeg: toeY.map(() => 100),
      contact,
      bins: 50,
    });
    expect(res.nSwings).toBe(1);
    expect(res.swings[0]?.toeDatum).toBeCloseTo(0.06, 9);
  });

  it("rmseIntersection ignores bins missing on either side", () => {
    const { rmse, nBins } = rmseIntersection([0, null, 2], [0, 1, null]);
    expect(nBins).toBe(1);
    expect(rmse).toBeCloseTo(0, 9);
  });
});
