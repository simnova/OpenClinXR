import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";
import { resolveMorphTarget } from "../../../packages/openclinxr/asset-registry/src/morph-target-resolver.js";

/**
 * #463 — #462 put 15 viseme targets on the runtime mesh and the mixer still cannot use them.
 *
 * ## MEASURED, and it is purely CASE
 *
 * `morph-target-resolver.ts:94-102`:
 *
 *     if (availableNames.has(canonicalName)) return canonicalName;   // exact match wins
 *     const alias = MPFB_FACS_MORPH_NAMES[canonicalName];            // else the FACS alias
 *     if (alias !== undefined && availableNames.has(alias)) return alias;
 *
 * The wire emits **`viseme_AA`** (`viseme-runtime-wire.ts:11`, and `:195` filters on
 * `toLowerCase().startsWith("viseme_")`). The visemes02 pack bakes **`viseme_aa`**. So the exact
 * match misses on case and the FACS alias takes over. Control/treatment on the resolver, run by me:
 *
 *   | available targets                  | `viseme_AA` resolves to |
 *   |------------------------------------|-------------------------|
 *   | FACS only (before #462)            | `mouth-open`            |
 *   | FACS + visemes (after #462)        | **`mouth-open`** — still |
 *
 * **No regression** — #462 broke nothing, and I checked that before writing this. But the 15
 * targets it baked onto the runtime asset are unreachable, so the mixer keeps driving the FACS
 * jaw-drop that #460 had to cap at 0.3. `viseme_aa` at 1.0 was graded intact; `mouth-open` at 1.0
 * destroyed the face. The mesh has the good target and the resolver picks the bad one.
 *
 * ## WHY THE FIX IS IN THE RESOLVER, NOT THE BAKE
 *
 * The pack's own names are genuinely mixed case — `viseme_aa`, `viseme_kk`, `viseme_nn`,
 * `viseme_sil` alongside `viseme_CH`, `viseme_DD`, `viseme_PP`, `viseme_RR`, `viseme_SS`,
 * `viseme_TH`. Renaming them to suit our resolver diverges a proven upstream asset from upstream
 * (D1). Case-insensitive matching in the resolver is the change; the bake stays as the pack ships.
 *
 * ## WHICH ARE REDS AND WHICH ARE NETS (#227)
 *
 *   (1) RED — `viseme_AA` must resolve to the real `viseme_aa` when the mesh carries it.
 *   (2) RED — every viseme token the wire can emit must reach a real target on the shipped
 *             runtime mesh, not a FACS alias.
 *   (3) NET — exact match still BEATS the FACS alias. Passes today; the precedence must survive.
 *   (4) NET — a mesh WITHOUT visemes still falls back to the FACS alias, so the Anny rail and any
 *             un-rebaked actor keep working. Passes today and is the thing a careless
 *             case-insensitive rewrite would break.
 *   (5) GUARD — the runtime mesh really carries mixed-case viseme names, so case is the axis.
 *
 * ## THE CHEAPEST FIXES THIS REFUSES
 *
 *   a) rename the baked targets to `viseme_AA`      -> (5) fails; diverges from the pack (D1)
 *   b) drop the FACS alias so only visemes resolve  -> (4) fails; un-rebaked actors go silent
 *   c) make the alias win over an exact match        -> (3) fails
 *   d) special-case the string "viseme_AA"           -> (2) fails; all 15 must reach
 *
 * NOT TESTED:
 *   - Whether raising #460's 0.3 cap is then safe. Strongly suggested by the graded stills; a
 *     separate slice, and this contract does not touch the cap.
 *   - Lip-sync timing or phoneme coverage.
 *   - Other actors. Only the peds parent was rebaked; the child still has 32 FACS targets and
 *     clause (4) is what keeps it working.
 *   - Whether 15 targets suffice for legible speech.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const RUNTIME_GLB = join(
  REPO_ROOT,
  "apps/ui-xr/public/xr-assets/humanoids/candidates/mpfb-peds-parent-aisha.motion-bind.glb",
);

const io = new NodeIO();
const doc = await io.read(RUNTIME_GLB);
let targetNames: string[] = [];
for (const m of doc.getRoot().listMeshes()) {
  const n = (m.getExtras() as { targetNames?: string[] } | null)?.targetNames;
  if (n?.length) { targetNames = n; break; }
}
const available = new Set(targetNames);
const visemeTargets = targetNames.filter((n) => /^viseme_/iu.test(n));

/** What the wire emits: `viseme_` + the canonical token, upper-cased tokens per :11. */
const wireName = (t: string): string => `viseme_${t}`;

describe("the runtime reaches the baked viseme targets", () => {
  it("(1) RED: viseme_AA resolves to the real viseme target, not the FACS jaw-drop", () => {
    expect(
      resolveMorphTarget(wireName("AA"), available),
      `the mesh carries viseme_aa and mouth-open; the resolver must pick the real lip target. `
        + `mouth-open at 1.0 was graded as a destroyed mid-face (#459); viseme_aa at 1.0 was graded intact (#462)`,
    ).toMatch(/^viseme_aa$/iu);
  });

  it("(2) RED: every baked viseme target is reachable from the name the wire emits", () => {
    // Refuses (d). One special case is not a fix.
    const unreachable = visemeTargets.filter((baked) => {
      const token = baked.replace(/^viseme_/iu, "");
      const resolved = resolveMorphTarget(wireName(token.toUpperCase()), available);
      return resolved === null || !/^viseme_/iu.test(resolved);
    });
    expect(
      unreachable,
      `${visemeTargets.length} viseme targets are on the shipped runtime mesh; each must be reachable `
        + `from the wire's upper-cased token`,
    ).toEqual([]);
  });

  it("(3) COUNTERWEIGHT: an exact match still beats the FACS alias", () => {
    // Refuses (c). Precedence is the invariant; case-insensitivity must not reorder it.
    expect(resolveMorphTarget("mouth-open", available), "an exactly-named target wins").toBe("mouth-open");
  });

  it("(4) COUNTERWEIGHT: a mesh without visemes still falls back to the FACS alias", () => {
    // Refuses (b). The child and every Anny-rail actor still carry FACS only — a careless
    // case-insensitive rewrite that drops the alias silences them.
    const facsOnly = new Set(["mouth-open", "mouth-compression", "eyebrows-left-inner-up"]);
    expect(
      resolveMorphTarget(wireName("AA"), facsOnly),
      `un-rebaked actors must keep working through the alias`,
    ).toBe("mouth-open");
  });

  it("(5) VACUITY GUARD: the runtime mesh really carries mixed-case viseme names", () => {
    expect(visemeTargets.length, "the runtime mesh carries the baked visemes").toBe(15);
    expect(
      visemeTargets.some((n) => /^viseme_[a-z]+$/u.test(n)) && visemeTargets.some((n) => /[A-Z]/u.test(n)),
      `the pack ships BOTH cases (viseme_aa, viseme_kk vs viseme_CH, viseme_PP) — that is why this `
        + `is a resolver fix and not a rename`,
    ).toBe(true);
    expect(available.has("mouth-open"), "the FACS target the alias points at is present").toBe(true);
  });
});
