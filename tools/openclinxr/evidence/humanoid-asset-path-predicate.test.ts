import { dirname, resolve as pathResolve } from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The capture suite recognises a runtime humanoid by the folder it sits in, and the factory outgrew
 * that folder. Every capture that wants to photograph the two hm08 library bodies waits 180 s and
 * times out, because those bodies moved to `xr-assets/humanoids/candidates/` when they were promoted.
 *
 * MEASURED 2026-08-11. `ui-xr-parent-nurse-sleeve-deform-capture.ts:63-76` waits on:
 *
 *   const humanoids = scene?.assets?.filter((a) =>
 *     a.assetPath?.includes("generated-humanoids/") || a.assetPath?.includes(expectedGlb)) ?? [];
 *   return humanoids.length >= 2 && humanoids.some(a => a.assetPath?.includes(expectedGlb) && a.status === "loaded");
 *
 * That capture photographs the peds PARENT and NURSE. Both resolve to
 * `/xr-assets/humanoids/candidates/body-param-adult_{lean_female,heavy_male}-library.glb`
 * (`humanoid-runtime-asset-url.ts:54-61`), so neither matches `generated-humanoids/`. Only the single
 * `expectedGlb` can match, `length >= 2` is unsatisfiable, and the wait always expires. Confirmed by
 * running it: `page.waitForFunction: Timeout 180000ms exceeded`.
 *
 * SCOPE OF THE ASSUMPTION, measured:
 *
 *   evidence modules referencing "generated-humanoids/"     57
 *   runtime actor mappings                                  23
 *   mappings resolving to xr-assets/humanoids/candidates/    5   <- both library bodies
 *
 * So this is not one bad predicate. It is a path convention encoded in 57 places that stopped being
 * true when MPFB-topology bodies reached the runtime — and it silently excludes exactly the bodies
 * the MPFB graduation work is about.
 *
 * THREE WRONG MECHANISMS WERE RULED OUT FIRST. Recorded so nobody re-walks them:
 *   1. "the actors are missing" — no. All three humanoids report `status: "loaded"`; the ENVIRONMENT
 *      asset is what fails (`pediatric_urgent_care_bay_environment.glb` does not exist on disk).
 *   2. "the stations have no room" — no. `main.ts:3285` calls `buildStationEnvironment`
 *      unconditionally and `:3374` states walls and floor come from it. Rooms are procedural.
 *   3. "`waitForStationShell` is the blocker" — no. Neither failing capture calls it; both have
 *      inline predicates. The working control (`mouth-gaze-capture:45`) waits on viseme/gaze evidence
 *      fields and has no humanoid-count clause, which is why it passes.
 *
 * THE CHEAP FIXES THIS REFUSES, probed 2026-08-11 before planting:
 *
 *   treatment                                    | (1) all rails | (2) rejects non-humanoids | result
 *   ---------------------------------------------|---------------|---------------------------|--------
 *   a) today: includes("generated-humanoids/")   |     FAIL      |           pass            | REFUSED
 *   b) match everything (`() => true`)           |     pass      |         **FAIL**          | REFUSED
 *   c) add "candidates/" as a second literal     |     pass      |         **FAIL**          | REFUSED
 *   d) recognise by humanoid asset identity      |     pass      |           pass            | ALL PASS
 *
 * (c) is the tempting one and it is why (2) exists: `xr-assets/humanoids/candidates/` and
 * `xr-assets/environment/` and `xr-assets/medical-equipment/` are siblings, so a loose substring that
 * fixes the humanoids can start matching rooms and equipment. A predicate that cannot tell a body from
 * a bed is not a fix.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227): (1) is a RED and fails today. (2) PASSES today — the
 * current predicate is wrong but not indiscriminate — and is the known-good column a fix must keep.
 *
 * NOT TESTED: nothing is rendered and no capture is run here. This asserts the PREDICATE over the real
 * runtime path strings; it does not prove a capture then succeeds, which depends on the assets also
 * loading. The other 56 modules referencing the folder are not touched — this contract covers the
 * predicate one capture uses, deliberately (D4). Nothing here claims the paths themselves are well
 * chosen.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");

/** Runtime humanoid paths, read from the SSOT rather than restated, so a move breaks this loudly. */
function runtimeHumanoidPaths(): string[] {
  const src = readFileSync(
    `${REPO_ROOT}/apps/ui-xr/src/humanoid-runtime-asset-url.ts`,
    "utf8",
  );
  const paths = new Set<string>();
  for (const m of src.matchAll(/"(\/(?:generated-humanoids|xr-assets\/humanoids\/candidates|cagematch)\/[^"]+\.glb)"/g)) {
    paths.add(m[1]!);
  }
  return [...paths];
}

/** Sibling asset families a humanoid predicate must NOT claim. */
const NON_HUMANOID_PATHS = [
  "/xr-assets/environment/ed-exam-bay-shell.glb",
  "/xr-assets/environment/pediatric_urgent_care_bay_environment.glb",
  "/xr-assets/medical-equipment/iv-pole-with-pump.glb",
  "/xr-assets/medical-equipment/ecg-cart-12-lead.glb",
] as const;

/**
 * The deliverable. Absent today, so (1) is red. Expected at
 * `packages/openclinxr/asset-registry/src/humanoid-asset-path.ts` exporting
 * `isRuntimeHumanoidAssetPath(assetPath: string): boolean`, so the 57 scattered folder checks have one
 * place to converge on.
 */
async function loadPredicate(): Promise<((assetPath: string) => boolean) | null> {
  const mod = (await import(
    `${REPO_ROOT}/packages/openclinxr/asset-registry/src/humanoid-asset-path.ts`
  ).catch(() => null)) as { isRuntimeHumanoidAssetPath?: unknown } | null;
  return typeof mod?.isRuntimeHumanoidAssetPath === "function"
    ? (mod.isRuntimeHumanoidAssetPath as (p: string) => boolean)
    : null;
}

const humanoidPaths = runtimeHumanoidPaths();

describe("a runtime humanoid is recognised by what it is, not the folder it sits in", () => {
  it.fails("(1) RED: every humanoid path the runtime resolves is recognised as a humanoid", async () => {
    const isRuntimeHumanoidAssetPath = await loadPredicate();
    expect(
      isRuntimeHumanoidAssetPath,
      "asset-registry must export isRuntimeHumanoidAssetPath",
    ).not.toBeNull();
    expect(humanoidPaths.length, "runtime humanoid paths found in the SSOT").toBeGreaterThanOrEqual(3);

    const unrecognised = humanoidPaths.filter((p) => !isRuntimeHumanoidAssetPath!(p));
    expect(unrecognised, "runtime humanoid assets the predicate does not recognise").toEqual([]);
  });

  it("(2) NET known-good: the predicate rejects rooms and equipment — a loose substring is refused", async () => {
    const isRuntimeHumanoidAssetPath = await loadPredicate();
    if (!isRuntimeHumanoidAssetPath) {
      // Today's shipped behaviour, measured directly: wrong about library bodies, but NOT
      // indiscriminate. This clause pins that property so a fix cannot trade one fault for the other.
      const shipped = (p: string): boolean => p.includes("generated-humanoids/");
      expect(NON_HUMANOID_PATHS.filter(shipped), "shipped predicate must not claim non-humanoids")
        .toEqual([]);
      return;
    }
    const misclaimed = NON_HUMANOID_PATHS.filter((p) => isRuntimeHumanoidAssetPath(p));
    expect(misclaimed, "non-humanoid assets claimed by the humanoid predicate").toEqual([]);
  });

  it("(3) NET premise check: the library bodies really are outside generated-humanoids/", () => {
    const candidates = humanoidPaths.filter((p) => p.includes("xr-assets/humanoids/candidates/"));
    expect(candidates.length, `library-path humanoids found: ${candidates.join(", ")}`)
      .toBeGreaterThanOrEqual(2);
    for (const p of candidates) {
      expect(p.includes("generated-humanoids/"), `${p} must not be in generated-humanoids/`).toBe(false);
    }
  });
});
