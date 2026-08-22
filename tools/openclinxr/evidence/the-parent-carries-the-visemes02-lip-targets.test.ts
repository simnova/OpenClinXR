import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";

/**
 * #462 — the visemes02 bake works and the shipped parent never got it. D1/D11.
 *
 * ## MEASURED — the recipe already exists and is proven on the IDENTICAL mesh
 *
 * `apps/ui-xr/public/generated-humanoids/mpfb-viseme-inspect.glb`, baked by E6.3 (`6fea194c`):
 *
 *     mesh mpfb_ob_patient_aisha_body   47 targets, 15 of them viseme_*
 *     viseme_aa, viseme_CH, viseme_DD, viseme_E, viseme_FF, viseme_I, viseme_kk,
 *     viseme_nn, viseme_O, viseme_PP, viseme_RR, viseme_sil, viseme_SS, viseme_TH, viseme_U
 *
 * The two shipped parent variants, same mesh name:
 *
 *     generated-humanoids/mpfb-peds-parent-aisha.glb              32 targets, viseme_*: 0
 *     candidates/mpfb-peds-parent-aisha.motion-bind.glb           32 targets, viseme_*: 0
 *
 * **47 = 32 FACS + 15 visemes02, on the same mesh.** The bake is proven; the shipped asset is
 * simply unconsumed. That is D1 exactly — wire the proven tool, do not hand-author a lip shape.
 *
 * ## WHY IT MATTERS NOW
 *
 * #460 caps FACS `mouth-open` at **0.3** because at 1.0 the parent's mid-face collapses (nose
 * bridge gone — graded twice off #459's sweep). The cap exists **because the runtime's AA has
 * nowhere better to go**: the parent carries no `viseme_AA`, so AA aliases onto `mouth-open`.
 * Give the mesh real lip targets and AA no longer has to abuse a FACS jaw-drop.
 *
 * **This slice does NOT raise or remove the 0.3 cap.** That is a third slice, after both land.
 *
 * ## A HAZARD I FOUND AND AM NOT MAKING YOU DISCOVER (SS9g)
 *
 * The inspect bake emits **`viseme_aa` in lower case** while `viseme-runtime-wire.ts:57` maps
 * `AA: "AA"`. Whether the resolver is case-insensitive is UNMEASURED by me. Check it before
 * assuming the runtime will find the target — and if it will not, say so rather than renaming the
 * baked target to suit the resolver without saying which you changed.
 *
 * ## WHICH ARE REDS AND WHICH ARE NETS (#227)
 *
 *   (1) RED   — the shipped parent carries 0 viseme targets; it must carry the 15.
 *   (2) RED   — the isolated AA-vs-rest still pair does not exist.
 *   (3) NET   — the 32 FACS targets SURVIVE. Passes today (they are all it has) and must keep
 *               passing: visemes are ADDITIVE, not a replacement. #460's cap operates on
 *               `mouth-open`, which must still be there.
 *   (4) NET   — #460's 0.3 cap is untouched. Passes today, must keep passing.
 *   (5) NET   — the other shipped humanoids are not rebaked. Passes today.
 *   (6) GUARD — the inspect GLB is still on disk as the known-good column.
 *
 * ## THE CHEAPEST FIXES THIS REFUSES
 *
 *   a) rebake the parent with visemes and lose the FACS set  -> (3) fails; #460's cap needs
 *      `mouth-open` to exist
 *   b) raise or remove the 0.3 cap "since we have visemes now"-> (4) fails; separate slice
 *   c) rebake every humanoid to look thorough                 -> (5) fails; one actor is enough
 *   d) point the parent's path at mpfb-viseme-inspect.glb     -> (5) and (6) fail; that is a
 *      resolver swap, not a bake — and it is the S2 mistake the portfolio parks P1 for
 *   e) hand-author a lip morph                                -> D1; the bake exists
 *
 * NOT TESTED:
 *   - Whether the runtime resolver finds `viseme_aa` (case). Named above as an open hazard.
 *   - Whether AA@1.0 on a real viseme spares the mid-face. That is what the still pair is FOR and
 *     the superagent grades it — this contract asserts the pair exists, never that it looks good.
 *   - Raising the cap. Explicitly a later slice.
 *   - Other actors, Quest, frame budget, lip-sync timing.
 *
 * ## FIXED (#551)
 *
 * Clause (5) was a scope fence: `mpfb-peds-patient-child.glb` must carry ZERO visemes so a worker
 * would not mass-rebake every actor. `e9ef9e3f` (#542) then rolled visemes02 to all 11 shipped
 * `mpfb-*.glb` under a direct operator instruction, so the fence outlived its slice and went RED
 * on main (`expected 15 to be +0`). Inverted: every shipped `mpfb-*.glb` a learner can resolve
 * carries 15 `viseme_*` targets. The inspect-GLB-is-not-the-parent half of the counterweight is
 * kept (resolver-swap refusal).
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const GEN = join(REPO_ROOT, "apps/ui-xr/public/generated-humanoids");
const PARENT = join(GEN, "mpfb-peds-parent-aisha.glb");
const INSPECT = join(GEN, "mpfb-viseme-inspect.glb");
const APPLY = join(REPO_ROOT, "apps/ui-xr/src/viseme-morph-apply.ts");
const LEDGER = join(HERE, "parent-visemes02.json");

/** The 15 targets the proven E6.3 bake emits, read off the inspect GLB, not typed by me. */
const EXPECTED_VISEME_COUNT = 15;
/** The FACS set the parent already has and #460's cap depends on. */
const EXPECTED_FACS_COUNT = 32;
const CAP_TARGET = "mouth-open";

const io = new NodeIO();

async function targetNames(p: string): Promise<string[]> {
  const doc = await io.read(p);
  for (const m of doc.getRoot().listMeshes()) {
    const n = (m.getExtras() as { targetNames?: string[] } | null)?.targetNames;
    if (n?.length) return n;
  }
  return [];
}

const parentTargets = await targetNames(PARENT);
const inspectTargets = existsSync(INSPECT) ? await targetNames(INSPECT) : [];
const visemesOf = (n: string[]): string[] => n.filter((x) => /^viseme/iu.test(x));

type Ledger = { stills: { stateId: string; path: string }[] };
const ledger: Ledger | null = existsSync(LEDGER)
  ? (JSON.parse(readFileSync(LEDGER, "utf8")) as Ledger)
  : null;

describe("the parent carries the visemes02 lip targets", () => {
  it("(1) RED: the shipped parent carries the 15 visemes02 targets", async () => {
    expect(
      visemesOf(parentTargets).length,
      `mpfb-viseme-inspect.glb proves the bake emits 15 viseme_* on this exact mesh `
        + `(mpfb_ob_patient_aisha_body); the shipped parent has none`,
    ).toBe(EXPECTED_VISEME_COUNT);
  });

  it("(2) RED: an isolated AA-vs-rest still pair exists for grading", () => {
    expect(
      ledger,
      `tools/openclinxr/evidence/parent-visemes02.json must name an isolated still pair — the `
        + `superagent grades whether a real viseme spares the mid-face`,
    ).not.toBeNull();
    const ids = (ledger?.stills ?? []).map((s) => s.stateId).sort();
    expect(ids, `rest and the AA viseme at full weight`).toEqual(["aa-full", "rest"]);
    for (const s of ledger?.stills ?? []) {
      const p = join(REPO_ROOT, s.path);
      expect(existsSync(p), `${s.path} must exist`).toBe(true);
      expect(statSync(p).size, `${s.path} must carry rendered content`).toBeGreaterThan(40_000);
    }
  });

  it("(3) COUNTERWEIGHT: the FACS set survives — visemes are additive", () => {
    // Refuses (a). #460 caps `mouth-open`; if the rebake drops the FACS set that cap targets a
    // target that no longer exists and the collapse guard silently stops guarding anything.
    expect(
      parentTargets.filter((n) => !/^viseme/iu.test(n)).length,
      `the 32 FACS targets must survive a viseme rebake`,
    ).toBe(EXPECTED_FACS_COUNT);
    expect(parentTargets, `#460's capped target must still exist`).toContain(CAP_TARGET);
  });

  it("(4) COUNTERWEIGHT: #460's 0.3 cap is untouched", () => {
    // Refuses (b). Having real visemes is an argument for revisiting the cap; it is not this slice.
    const src = readFileSync(APPLY, "utf8");
    expect(src, `the FACS cap constant stays at 0.3 in this slice`).toMatch(/MOUTH_OPEN_CAP\s*=\s*0\.3/u);
  });

  it("(5) COUNTERWEIGHT: every shipped mpfb-*.glb carries 15 viseme_*, and the parent is not aliased away", async () => {
    // #551 inverted the child-zero scope fence after e9ef9e3f rolled visemes to all 11 actors.
    // Still refuses (d): pointing the parent's path at the inspect GLB is a resolver swap.
    const shipped = readdirSync(GEN)
      .filter((f: string) => f.startsWith("mpfb-") && f.endsWith(".glb"))
      .sort();
    expect(shipped.length, "shipped mpfb population must be non-empty").toBeGreaterThanOrEqual(11);
    const short: string[] = [];
    for (const f of shipped) {
      const n = visemesOf(await targetNames(join(GEN, f))).length;
      if (n !== EXPECTED_VISEME_COUNT) short.push(`${f}:${n}`);
    }
    expect(
      short,
      `every shipped mpfb-*.glb must carry ${EXPECTED_VISEME_COUNT} viseme_* (post-e9ef9e3f); short: ${short.join(", ")}`,
    ).toEqual([]);
    expect(existsSync(INSPECT), `the inspect GLB stays as its own artifact, not the parent's file`).toBe(
      true,
    );
    expect(PARENT, "parent must remain a distinct file from the inspect harness GLB").not.toBe(INSPECT);
  });

  it("(6) VACUITY GUARD: the known-good column is real and distinct from the subject", () => {
    expect(
      visemesOf(inspectTargets).length,
      `the inspect GLB is the proof the bake works; without it clause (1) has no source`,
    ).toBe(EXPECTED_VISEME_COUNT);
    expect(inspectTargets.length, `47 = 32 FACS + 15 visemes on the same mesh`).toBe(
      EXPECTED_FACS_COUNT + EXPECTED_VISEME_COUNT,
    );
    expect(PARENT).not.toBe(INSPECT);
  });
});
