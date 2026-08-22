import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { regionLuminance } from "./lib/png-region-luminance.js";

/**
 * OBSERVABLE: a capture that renders NOTHING is refused whether it came out black or white.
 *
 * `a-station-capture-is-not-a-black-frame.test.ts` landed the right instrument and enumerates every
 * captured station dynamically. It bounds ONE END: its only assertion is `nonBlackPct < floor`, and
 * the file contains zero `toBeLessThan` calls. A blank WHITE frame scores `nonBlackPct = 100.0` - the
 * maximum - and passes everything.
 *
 * MEASURED on the fixtures beside this file, via the shipped `regionLuminance`:
 *
 *   fixture                  mean      sd   nonBlackPct
 *   uniform-white           255.0    0.00        100.0     <- passes today, renders nothing
 *   uniform-near-black        8.0    0.00          0.0     <- caught today
 *   textured-lit            119.2   60.30         98.0
 *   textured-dim             29.1   19.08         77.4
 *   textured-lit-no-dark…   134.4   49.65        100.0     <- a HEALTHY frame that is also 100%
 *
 * `sd` is what separates "rendered nothing" from "rendered something", at either exposure. The
 * ambient calibration is already in the tree, recorded in the black-frame contract's own header from
 * REAL captures: ed_chest_pain_priority_v1 sd 78.2, telehealth_diabetes_health_literacy_v1 sd 55.9,
 * and the black peds frame sd 4.9. An 11x gap between a uniform frame and the dimmest real one.
 *
 * The assertions below are COMPARATIVE wherever they can be. The capture pipeline is the thing being
 * measured and a bare number in a contract becomes its design target.
 *
 * WHY THE FIXTURES ARE SYNTHETIC, stated rather than hidden: the original blank-white artifact from
 * #172 is unrecoverable - its evidence directory is gone - so I cannot show that THIS pipeline still
 * emits white. What is demonstrated is that it emits UNIFORM frames: the black peds capture is one,
 * measured at sd 4.9. White is that same failure at the other exposure. A real capture has
 * compression noise, so `uniform-white` at sd 0.00 is a cleaner case than reality; the derivation
 * below is anchored on the real 4.9, not on 0.
 *
 * claimScope: whether a uniform capture frame is refused independent of its brightness.
 * notEvidenceFor: why any frame came out uniform, whether the current pipeline can emit white, or
 *   anything about a specific station.
 */

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures/uniform-frame");
const read = (name: string) => readFileSync(join(FIXTURES, `${name}.png`));
const luma = (name: string) => {
  const r = regionLuminance(read(name), {}, { step: 1 });
  if (!r) throw new Error(`fixture ${name}.png did not decode`);
  return r;
};

/** Named so a reader can see which way each fixture is supposed to go. */
const UNIFORM = ["uniform-white", "uniform-near-black"] as const;
const TEXTURED = ["textured-lit", "textured-dim", "textured-lit-no-dark-pixels"] as const;

async function classify(bytes: Uint8Array): Promise<{ uniform: boolean }> {
  const mod = await import("./lib/png-region-luminance.js") as Record<string, unknown>;
  const fn = mod["classifyCaptureFrame"];
  if (typeof fn !== "function") {
    throw new Error(
      "png-region-luminance.ts does not export classifyCaptureFrame(bytes). The blank-frame verdict "
      + "currently lives inline in a-station-capture-is-not-a-black-frame.test.ts and bounds only the "
      + "dark end, so nothing can be asked whether a WHITE frame is a rendered scene.",
    );
  }
  return (fn as (b: Uint8Array) => { uniform: boolean })(bytes);
}

describe("a uniform frame is refused at either end", () => {
  it("(0) HARNESS COLUMN: the instrument reads every fixture and separates them on sd", () => {
    // Passes today. Proves the failures below mean "no verdict function exists", not "the fixtures
    // are broken". Comparative: every uniform frame must sit below every textured one on sd.
    const uniformMax = Math.max(...UNIFORM.map((n) => luma(n).sd));
    const texturedMin = Math.min(...TEXTURED.map((n) => luma(n).sd));
    expect(uniformMax, "a uniform frame has no variance whatever its brightness").toBeLessThan(texturedMin);
  });

  it("(1) HARNESS COLUMN: a white frame is maximally healthy on the metric that exists today", () => {
    // This is the defect, stated as a measurement rather than an assertion about a missing function.
    // It passes today and MUST KEEP PASSING - it is a fact about nonBlackPct, not about the gate. If
    // a fix makes this fail, the fix changed the instrument rather than adding a verdict.
    expect(luma("uniform-white").nonBlackPct, "white saturates the only bound that exists").toBe(100);
    expect(luma("textured-dim").nonBlackPct).toBeLessThan(luma("uniform-white").nonBlackPct);
  });

  it.fails("(2) RED: a blank white frame is classified as rendering nothing", async () => {
    const v = await classify(read("uniform-white"));
    expect(v.uniform, "nonBlackPct 100.0 and sd 0.00 - the brightest possible frame with no scene in it").toBe(true);
  });

  it.fails("(3) RED: a blank near-black frame is still classified as rendering nothing", async () => {
    // The property the landed contract already has must survive being generalised.
    const v = await classify(read("uniform-near-black"));
    expect(v.uniform, "sd 0.00 at mean 8.0 - the case the black-frame contract catches today").toBe(true);
  });

  it.fails("(4) RED + COUNTERWEIGHT: a legitimately DIM but textured frame is not refused", async () => {
    // Refuses the cheap fix - raising the brightness floor. #162 records that closing the ceilings
    // darkened every room, so a dim room is a real shipped state. textured-dim sits at nonBlackPct
    // 77.4 and mean 29.1: a floor tuned to catch white or black by brightness alone takes this with
    // it. Variance is what distinguishes it (sd 19.08), not exposure.
    const v = await classify(read("textured-dim"));
    expect(v.uniform, "a dark room with geometry in it is a rendered scene").toBe(false);
  });

  it.fails("(5) COUNTERWEIGHT: a bright frame with NO dark pixels at all is not refused", async () => {
    // Refuses the other cheap fix - widening nonBlackPct to bite at both ends. That rule
    // misclassifies this fixture, which mirrors a REAL healthy capture: the black-frame contract's
    // own header records telehealth_diabetes_health_literacy_v1 at mean 136.6, sd 55.9,
    // nonBlackPct 100.0. A shipped station legitimately has no dark pixels, so "nonBlackPct > 99"
    // refuses a known-good frame. Probed: brightness-only misses textured-dim, nonBlackPct-both-ends
    // misses this one, variance misses neither.
    const v = await classify(read("textured-lit-no-dark-pixels"));
    expect(v.uniform, "mean 134.4, sd 49.65, nonBlackPct 100.0 - bright, varied, and real").toBe(false);
  });

  it.fails("(6) COUNTERWEIGHT: an ordinary lit frame is not refused", async () => {
    const v = await classify(read("textured-lit"));
    expect(v.uniform, "sd 60.30, inside the 55.9-78.2 range measured on real shipped captures").toBe(false);
  });
});
