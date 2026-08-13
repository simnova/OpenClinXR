import { readdirSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
// Relative source import: `tools/` is outside the workspace package graph and cannot resolve
// `@openclinxr/asset-registry` by name. This is the SAME function the runtime calls (#308).
import { resolveMorphTarget } from "../../../packages/openclinxr/asset-registry/src/morph-target-resolver.ts";
import { describe, expect, it } from "vitest";

/**
 * **Every MPFB actor a learner will speak to is mute.** Speech drives nothing on their mouths, while
 * 13 usable mouth/lip/jaw morph targets sit on each body unreferenced.
 *
 * MEASURED 2026-08-12 on the shipped GLBs, by calling the real runtime resolver
 * (`resolveMorphTarget`, `#308`) against each body's actual morph dictionary:
 *
 *   actor            morphs   mouth/lip/jaw FACS   canonical expressions   **visemes**
 *   ---------------- ------   ------------------   ---------------------   -----------
 *   aisha              32             13                   2 / 3              **0 / 9**
 *   nurse_kevin        32             13                   2 / 3              **0 / 9**
 *   patient_child      32             13                   2 / 3              **0 / 9**
 *
 * The nine the runtime asks for — `viseme_sil AA E IH OH OU FV TH L` — every one resolves to null.
 * The thirteen sitting unused on every body: `mouth-open`, `mouth-protusion`, `mouth-compression`,
 * `mouth-corner-puller`, `mouth-eversion`, `mouth-parling`, `mouth-part-later`, `mouth-elevation`,
 * `mouth-depression-retraction` (+`.001`), and three more.
 *
 * ## THIS CORRECTS TWO DOCUMENTS, INCLUDING THE ONE THAT DEFINED THE GAP
 *
 * **MADR 0052's capability table** records the 32 FACS morphs as living on "both hm08 library
 * bodies", with the MPFB rail's gap being "name resolution **plus a bake that loads the targets**".
 * Measured: the bake half is already done — all three *shipped* MPFB actors export the 32 targets on
 * 7 primitives each. Only resolution is missing, and it is missing for speech only.
 *
 * **`morph-target-resolver.ts`'s own header** says: *"The MPFB library bodies carry no `viseme_*`
 * targets at all (that is #224's bake fix, not a resolution fix), so no viseme alias can exist."*
 * That was correct for the library bodies and about a different question. A `viseme_*` target is not
 * required for a viseme to be drivable — MADR 0052 says so in the same table: *"face action units
 * ship and visemes must be COMPOSED from them — FACS-style."* Thirteen mouth action units are
 * present. The conclusion "no viseme alias can exist" does not follow from "no `viseme_*` name
 * exists", and it is the sentence that has kept this closed.
 *
 * **The known-good column is on the same bodies, through the same function.** `openclinxr_mouth_open`
 * → `mouth-open` and `openclinxr_brow_concern` → `eyebrows-left-inner-up` both resolve, 3/3 actors.
 * So this is not a resolver that cannot reach MPFB names; it is a map with two entries and no speech
 * row. (`openclinxr_cheek_tension` resolves to null by deliberate design — no cheek target ships —
 * and that is honest, not a defect.)
 *
 * THE CHEAP FIXES THIS REFUSES, probed 2026-08-12 before planting:
 *
 *   treatment                                   | (1) resolves | (2) distinct shapes | (3) mouth region | (4) #308 intact | result
 *   --------------------------------------------|--------------|---------------------|------------------|-----------------|--------
 *   a) today                                    |  **FAIL**    |        n/a          |       n/a        |      pass       | REFUSED
 *   b) map all nine visemes to `mouth-open`     |    pass      |     **FAIL**        |       pass       |      pass       | REFUSED
 *   c) map them to any FACS name that exists    |    pass      |       pass          |    **FAIL**      |      pass       | REFUSED
 *   d) compose each from the mouth action units |    pass      |       pass          |       pass       |      pass       | ALL PASS
 *
 * (b) is the obvious one: nine identical entries make clause (1) green and produce a jaw that flaps
 * the same way on every phoneme — a mouth that moves is not a mouth that speaks. Clause (2) requires
 * distinct targets across the set.
 * (c) is the subtler one and it is the #308 failure mode in a new place: a resolver that returns
 * *some* name for every request looks fixed and drives the wrong region. Clause (3) requires every
 * resolved viseme target to be a mouth/lip/jaw target, which is the same anatomical counterweight
 * #308 used (it checked brow-above-mouth ordering for exactly this reason).
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227): (1) is the RED and fails 3/3. (2) and (3) are
 * counterweights REACHABLE ONLY once (1) passes. (4) passes today and is a regression net.
 *
 * NOT TESTED, and the scope here is narrow on purpose:
 *   - **Name resolution only.** Nothing is claimed about whether the resulting mouth shapes LOOK like
 *     the phonemes. `mouth-protusion` resolving for `viseme_OU` is a defensible mapping and this
 *     contract cannot tell a good one from a plausible one — only a pixel grade or a clinician can.
 *   - **No timing, no audio.** Whether the viseme sequence is driven at the right moments is
 *     `viseme-timeline-drive.ts`'s question, untouched here.
 *   - **1:1 only.** The runtime resolver returns ONE name per canonical, so a true FACS composition
 *     (several action units blended per phoneme) is a residual this contract does not reach. That is
 *     the honest ceiling of a 1:1 resolver and should be named in whatever fixes this, not hidden.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const GENERATED = "apps/ui-xr/public/generated-humanoids";

/** The ARKit-style set the runtime asks for (`viseme-runtime-wire.ts` DIALOGUE_PHONEME_TO_ARKIT). */
const ARKIT_VISEMES = ["sil", "AA", "E", "IH", "OH", "OU", "FV", "TH", "L"] as const;

/**
 * Nine phonemes legitimately share shapes, so 9 distinct targets is not required. Fewer than 5 across
 * the whole set is a flap, not speech — 13 mouth action units ship, so 5 is reachable without
 * inventing anything.
 */
const MIN_DISTINCT_TARGETS = 5;

/** #308's two canonical expression rows must keep resolving on these bodies. */
const CANONICAL_EXPRESSIONS = ["openclinxr_mouth_open", "openclinxr_brow_concern"] as const;

type Row = {
  file: string;
  morphCount: number;
  mouthFacsCount: number;
  resolvedVisemes: { name: string; target: string | null }[];
  resolvedCanonical: { name: string; target: string | null }[];
};

const io = new NodeIO();
const isMouthTarget = (n: string): boolean => /mouth|lip|jaw/i.test(n);

async function measure(rel: string): Promise<Row | null> {
  const doc = await io.read(join(REPO_ROOT, rel));
  const names = new Set<string>();
  for (const mesh of doc.getRoot().listMeshes()) {
    const extras = (mesh.getExtras() ?? {}) as { targetNames?: string[] };
    for (const t of extras.targetNames ?? []) names.add(t);
  }
  if (names.size === 0) return null;
  return {
    file: rel.split("/").pop()!,
    morphCount: names.size,
    mouthFacsCount: [...names].filter(isMouthTarget).length,
    resolvedVisemes: ARKIT_VISEMES.map((v) => ({
      name: `viseme_${v}`,
      target: resolveMorphTarget(`viseme_${v}`, names),
    })),
    resolvedCanonical: CANONICAL_EXPRESSIONS.map((c) => ({
      name: c,
      target: resolveMorphTarget(c, names),
    })),
  };
}

const files = readdirSync(join(REPO_ROOT, GENERATED))
  .filter((n: string) => n.startsWith("mpfb-") && n.endsWith(".glb") && !/candidate/i.test(n))
  .map((n: string) => `${GENERATED}/${n}`);

const rows = (await Promise.all(files.map((f) => measure(f).catch(() => null)))).filter(
  (r): r is Row => r !== null,
);

/** An empty enumeration must FAIL, never pass vacuously (§7t). */
function requireRows(): void {
  expect(rows.length, `MPFB bodies carrying morph targets (scanned ${files.length})`)
    .toBeGreaterThanOrEqual(3);
}

describe("MPFB actors can speak", () => {
  it.fails("(1) RED: the runtime's viseme names resolve on every MPFB actor", () => {
    requireRows();
    const mute = rows
      .filter((r) => r.resolvedVisemes.some((v) => v.target === null))
      .map((r) => {
        const missing = r.resolvedVisemes.filter((v) => v.target === null).map((v) => v.name);
        return `${r.file}: ${missing.length}/${r.resolvedVisemes.length} unresolved (${r.mouthFacsCount} mouth targets available, unused)`;
      });
    expect(mute, "actors whose speech drives no mouth morph").toEqual([]);
  });

  it("(2) COUNTERWEIGHT: the viseme set maps to distinct shapes", () => {
    // Refuses nine entries all pointing at `mouth-open` — a jaw that flaps identically on every
    // phoneme satisfies (1) and is not speech. Reachable only once (1) passes.
    requireRows();
    const flapped = rows
      .filter((r) => {
        const targets = r.resolvedVisemes.map((v) => v.target).filter((t): t is string => t !== null);
        return targets.length > 0 && new Set(targets).size < MIN_DISTINCT_TARGETS;
      })
      .map((r) => {
        const set = new Set(r.resolvedVisemes.map((v) => v.target).filter(Boolean));
        return `${r.file}: only ${set.size} distinct targets across ${ARKIT_VISEMES.length} visemes`;
      });
    expect(flapped, `viseme sets collapsing below ${MIN_DISTINCT_TARGETS} distinct targets`).toEqual([]);
  });

  it("(3) COUNTERWEIGHT: every resolved viseme drives the MOUTH", () => {
    // Refuses a resolver that returns some name for every request and moves the wrong region — the
    // #308 failure mode, which is why that module counterweighted on anatomical ordering.
    requireRows();
    const wrongRegion = rows.flatMap((r) =>
      r.resolvedVisemes
        .filter((v) => v.target !== null && !isMouthTarget(v.target))
        .map((v) => `${r.file}: ${v.name} -> ${v.target} (not a mouth/lip/jaw target)`),
    );
    expect(wrongRegion, "visemes resolved onto non-mouth morphs").toEqual([]);
  });

  it("(4) NET known-good: #308's canonical expressions still resolve", () => {
    requireRows();
    const broken = rows.flatMap((r) =>
      r.resolvedCanonical
        .filter((c) => c.target === null)
        .map((c) => `${r.file}: ${c.name} no longer resolves`),
    );
    expect(broken, "canonical expression names broken by the viseme work").toEqual([]);
  });
});
