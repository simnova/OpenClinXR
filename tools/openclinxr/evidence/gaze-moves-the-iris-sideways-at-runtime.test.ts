import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * **MADR 0052's 08:00 tick asks for eyes "confirmed live, not merely present in the file". The probe
 * that would confirm it exists, CRASHES in Node, and is wired to nothing.**
 *
 * What is already verified: `gaze-eye-bones-resolve-on-every-rail` (3/3) and `eyes-have-an-iris` (9/9).
 * Both read the FILE. Neither rotates a bone and asks whether the iris moved, which is the whole
 * distinction #311 drew: *"presence is not drive"*.
 *
 * `gaze-eye-rotation-live.ts` (#337) is the right instrument and it is real — it loads the shipped GLB
 * with the same three.js + GLTFLoader the app uses and walks the exact shader path
 * (`Skeleton.update` boneMatrices, `bindMatrixInverse * bind`). It is **not** referenced by any
 * contract, has **no** package.json script, and its only numbers live in a docstring dated 2026-08-11.
 *
 * ## MEASURED 2026-08-14 08:2x — it does not run, and one line fixes that
 *
 *   pnpm exec tsx tools/openclinxr/evidence/gaze-eye-rotation-live.ts
 *   -> ReferenceError: self is not defined
 *      at GLTFParser.loadImageSource (GLTFLoader.js:3301)
 *
 * GLTFLoader decodes textures through a browser API. With `globalThis.self ??= globalThis` it runs and
 * reports both mechanisms at yaw 0.7 rad on `mpfb-ob-patient-aisha`:
 *
 *   mechanism                              iris mean mag   lateralFraction   verticalFraction
 *   -------------------------------------  -------------   ---------------   ----------------
 *   `bone.rotation.y = yaw` (pre-#337)          4.85 mm          0.53               0.81
 *   `rotateOnWorldAxis(up, yaw)` (#337)        10.85 mm          **0.95**           0.17
 *
 * A yaw must move the iris SIDEWAYS. The pre-#337 mechanism moved it mostly **vertically** — it
 * composed the yaw into the bone's rest orientation. The runtime ships the corrected one
 * (`gaze-drives-eyes.ts:64`), and **nothing checks that it still does.**
 *
 * ## THE KNOWN-GOOD AND KNOWN-BAD ARE BOTH MEASURED, FROM THE SAME PROBE (SS9h)
 *
 * This is the rare case where the instrument reports the correct and the broken mechanism side by
 * side on the same asset in the same run. Clause (2) uses the broken one as a live control: if the
 * probe cannot still show `rotation.y = yaw` failing, it has stopped discriminating and clause (1)
 * means nothing.
 *
 * ## THE THRESHOLD IS A RATIO, NOT A FITTED NUMBER (SS9s)
 *
 * The rule is **lateral must dominate vertical at least 2:1** — a statement about what a yaw IS, not a
 * number chosen to clear an observation. Measured: the correct mechanism is 0.95 vs 0.17 (**5.6:1**),
 * the broken one 0.53 vs 0.81 (**0.65:1**). A fitted threshold — "lateralFraction >= 0.9" — would sit
 * just under the good value and tell you nothing about why.
 *
 * ## THE CHEAP FIXES THIS REFUSES
 *
 *   treatment                                        | (1) lateral | (2) control | (3) real asset | result
 *   --------------------------------------------------|-------------|-------------|----------------|--------
 *   a) today — no contract, probe crashes            |  **FAIL**   |  **FAIL**   |   **FAIL**     | REFUSED
 *   b) assert only that the iris MOVES               |    pass     |  **FAIL**   |     pass       | REFUSED
 *   c) stub the probe's output                       |    pass     |    pass     |   **FAIL**     | REFUSED
 *   d) shim `self`, run the probe, assert the ratio  |    pass     |    pass     |     pass       | ALL PASS
 *
 * **(b) is the one to watch.** The broken mechanism moves the iris 4.85 mm — a "does it move?" check
 * grades it as working. Clause (2) requires the probe to still FAIL the ratio on `rotation.y = yaw`,
 * so an instrument that has stopped discriminating cannot pass.
 *
 * **(c) is why clause (3) exists.** Eight iris vertices read off the shipped GLB is cheap to fake and
 * cheap to verify.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227): (1) is the RED. (2) and (3) also fail today — unavoidable,
 * they read the same absent report — and they are what stops (1) being satisfied by an instrument that
 * measures the wrong thing.
 *
 * NOT TESTED:
 *   - **That a learner sees the eyes move.** This is the shader path in Node, not a browser frame.
 *     §6v says the file and the runtime can disagree; this measures the runtime's math, not its pixels.
 *   - **Gaze magnitude or timing.** One yaw value, 0.7 rad. Nothing about how far a real gaze turns.
 *   - **The Anny rail.** `gaze-eye-bones-resolve-on-every-rail` covers bone resolution on both; this
 *     measures iris motion on the MPFB actor only.
 *   - **Vertical gaze.** Only yaw. A pitch axis would need its own control.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const PROBE = join(HERE, "gaze-eye-rotation-live.ts");
const SUBJECT = join(HERE, "../../../apps/ui-xr/public/generated-humanoids/mpfb-ob-patient-aisha.glb");
/**
 * The probe is a SCRIPT, not a module — importing it runs `main()` and its catch calls
 * `process.exit(1)`. So it is spawned and its `EYE_ROTATION_MECHANISM {json}` lines parsed, which is
 * how it already presents results. Spawned at MODULE SCOPE, not inside a test body: an in-test spawn
 * is subject to vitest's 5 s per-test timeout and is what made #390's clause flake under load.
 */

/** A yaw is lateral by definition. Not a fitted number — the correct mechanism measures 5.6:1. */
const MIN_LATERAL_TO_VERTICAL = 2;
/** Read off the shipped GLB; a stub is cheap to fake and cheap to catch. */
const MIN_IRIS_VERTS = 8;

type Reading = {
  mechanism: string;
  irisVerts: number;
  irisMeanMagMm: number;
  lateralFraction: number;
  verticalFraction: number;
};

function runProbe(): Reading[] | null {
  if (!existsSync(PROBE) || !existsSync(SUBJECT)) return null;
  let stdout: string;
  try {
    stdout = execFileSync("pnpm", ["exec", "tsx", PROBE, SUBJECT], {
      cwd: join(HERE, "../../.."),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null;
  }
  const out: Reading[] = [];
  for (const line of stdout.split("\n")) {
    const m = /^EYE_ROTATION_MECHANISM\s+(\{.*\})\s*$/u.exec(line.trim());
    if (!m) continue;
    try { out.push(JSON.parse(m[1]!) as Reading); } catch { /* malformed line */ }
  }
  return out.length ? out : null;
}

const readings = runProbe();
const shipped = readings?.find((r) => /rotateOnWorldAxis|FIXED/iu.test(r.mechanism)) ?? null;
const legacy = readings?.find((r) => /rotation\.y|SHIPPED_rotation/iu.test(r.mechanism)) ?? null;

/**
 * An empty enumeration must FAIL, never pass vacuously (SS7t). Plain `it` on purpose: an `it.fails`
 * cannot guard its own vacuity — it is satisfied by ANY failure, including this guard throwing.
 */
function requireReadings(): { shipped: Reading; legacy: Reading } {
  expect(
    readings,
    `${PROBE} must RUN and print EYE_ROTATION_MECHANISM lines — today it throws "ReferenceError: self is not defined" from GLTFLoader.loadImageSource under Node`,
  ).not.toBeNull();
  expect(shipped, "a reading for the shipped rotateOnWorldAxis mechanism").not.toBeNull();
  expect(legacy, "a reading for the legacy rotation.y mechanism (the live control)").not.toBeNull();
  return { shipped: shipped as Reading, legacy: legacy as Reading };
}

describe("gaze moves the iris sideways at runtime", () => {
  it.fails("(1) RED: the shipped mechanism turns the iris laterally, not vertically", () => {
    const { shipped: s } = requireReadings();
    expect(
      s.lateralFraction,
      `shipped mechanism lateral ${s.lateralFraction} vs vertical ${s.verticalFraction} — a yaw must move the iris sideways (correct mechanism measured 0.95 vs 0.17)`,
    ).toBeGreaterThanOrEqual(MIN_LATERAL_TO_VERTICAL * s.verticalFraction);
  });

  it.fails("(2) COUNTERWEIGHT: the probe still FAILS the legacy mechanism — it can tell them apart", () => {
    // Refuses (b). The broken mechanism moves the iris 4.85 mm, so a "does it move?" check grades it
    // as working. If the probe can no longer show rotation.y = yaw failing the ratio, it has stopped
    // discriminating and clause (1) is green about nothing.
    const { legacy: l } = requireReadings();
    expect(
      l.lateralFraction,
      `legacy rotation.y measured lateral ${l.lateralFraction} vs vertical ${l.verticalFraction} — it must still FAIL the 2:1 ratio (measured 0.53 vs 0.81)`,
    ).toBeLessThan(MIN_LATERAL_TO_VERTICAL * l.verticalFraction);
  });

  it.fails("(3) COUNTERWEIGHT: the readings come from the shipped GLB, not a stub", () => {
    // Refuses (c): a fabricated report satisfies a ratio for free. Eight iris vertices off the real
    // asset is cheap to verify and cheap to fake, so it is asserted rather than assumed.
    const { shipped: s, legacy: l } = requireReadings();
    for (const r of [s, l]) {
      expect(r.irisVerts, `${r.mechanism}: iris vertices read from ${SUBJECT}`).toBeGreaterThanOrEqual(MIN_IRIS_VERTS);
      expect(r.irisMeanMagMm, `${r.mechanism}: iris actually moved`).toBeGreaterThan(0);
    }
  });
});
