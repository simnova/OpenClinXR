import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { NodeIO } from "@gltf-transform/core";

/**
 * **Six contracts are red on main and five of them are the same instrument defect: a hand-typed
 * population.** Measured by the orchestrator 2026-08-21 on shipped bytes, `HEAD` at plant time.
 *
 *   garments-keep-their-authored-texture      (3)  expected 2 to be 3
 *   mpfb-skin-carries-surface-relief          (2)  normal maps reused across actors (9 of 11)
 *   mpfb-skin-carries-surface-relief          (3)  base-colour atlases reused (6 distinct)
 *   mpfb-skin-is-baked-not-painted            (2)  skin textures reused (6 of 11 textured)
 *   skin-atlas-has-subsurface-not-occlusion   (1)  blockSd 3.07 vs pre-fix undefined (xNaN)
 *   skin-atlas-has-subsurface-not-occlusion   (3)  skin atlases reused (6 of 11)
 *
 * ## THE POPULATION EACH ONE ASSUMED
 *
 * All four were written when the MPFB cast was THREE actors. It is now ELEVEN. Each carries its
 * population as a literal and none of them noticed the cast grew:
 *
 *   garments-keep-their-authored-texture:126   `ACTORS = [aisha, kevin, child]`, then
 *                                              `expect(cargoPants.length).toBe(ACTORS.length)`
 *                                              -> asserts 3; two actors wear cargo_pants today.
 *   skin-atlas-has-subsurface-not-occlusion:67 `PRE_FIX_BLOCK_SD` has 3 keys; 8 of the 11 atlases
 *                                              compare against `undefined` and red as NaN (§7s).
 *   the three "no two actors share one X"      enumerate the GLB DIRECTORY, so they count assets a
 *                                              learner never sees.
 *
 * `campaign-track.ts:20` already carries the proven enumerator and says why it exists verbatim:
 * "Four hand-typed populations produced confident wrong measurements earlier in this campaign."
 * This is the fifth, sixth, seventh, eighth and ninth. **D1: wire it, do not hand-author a tenth.**
 *
 * ## WHAT THE SHARING COUNTERWEIGHTS ACTUALLY COUNT — measured, do not re-derive
 *
 *   e49a8dfcb6304aa5  x5   gown-adult-patient, gown-inspect, ob-patient-aisha,
 *                          peds-parent-aisha, viseme-inspect
 *   0e461d813de561ba  x2   clinical-nurse-adult, clinical-physician-adult
 *
 * The x5 group is **one woman plus two isolated-subject harnesses**. `ob-patient-aisha` and
 * `peds-parent-aisha` are the same person in two stations; `gown-inspect` and `viseme-inspect` are
 * D3/D4 harness subjects that `resolveScenarioActorCast` never returns. Five of the six reported
 * violations are not defects at all, and they bury the one that is.
 *
 * ## THE ONE THAT IS — product defect #527, NOT fixable from this write root
 *
 * `ward_delirium_med_rec_v1` stages a physician and a nurse **in the same room** who are the same
 * person, and not merely in skin:
 *
 *   file                                  POSITION sha    verts    height    body mesh name
 *   mpfb-clinical-nurse-adult.glb         e101e82b856f    10994    1.7601    mpfb_ed_chest_pain_nurse_a...
 *   mpfb-clinical-physician-adult.glb     e101e82b856f    10994    1.7601    mpfb_ed_chest_pain_nurse_a...
 *   mpfb-family-partner-adult.glb         7118890ea8f7    11367    1.6473    mpfb_ed_chest_pain_spouse_...
 *
 * Byte-identical mesh AND byte-identical 844,002 B skin atlas. The physician GLB still carries the
 * NURSE's mesh name. `family-partner` is the KNOWN-GOOD COLUMN (§9h), same rail, same bake: the
 * pipeline demonstrably produces distinct bodies, so this is not a capability limit.
 *
 * No pixel grade is cited and none is needed — byte identity of both geometry and atlas is a
 * stronger claim than a render could support. What is NOT claimed is how strongly it reads in the
 * room; the two wear different garments (§11l).
 *
 * ## WHY THIS CONTRACT DOES NOT ASSERT THE PRODUCT DEFECT AWAY
 *
 * Fixing the physician needs a body bake. That is outside `evidence/**` and outside this slice.
 * Clause (1) is therefore an INVERTED GUARD in the #517/#516 shape: it asserts the defect is STILL
 * PRESENT and names its card (#527), so the slice can land honestly — and it FAILS the day the physician
 * gets a distinct body, which forces the flip. Do not delete it then; rewrite it as the positive
 * assertion (merge-kill fires `deleted-test`).
 *
 * ## THE CHEAP FIXES THIS REFUSES
 *
 *   treatment                                          | (2) harness | (3) baseline | (4) live pop | (5) still catches | result
 *   ---------------------------------------------------|-------------|--------------|--------------|-------------------|--------
 *   a) today — directory scan, typed literals          |  **FAIL**   |   **FAIL**   |  **FAIL**    |      pass         | REFUSED
 *   b) name-filter out `*-inspect.glb`                 |    pass     |   **FAIL**   |  **FAIL**    |      pass         | REFUSED (§7k: a name match is a marker check)
 *   c) widen/delete the sharing clauses until green    |    pass     |     pass     |    pass      |    **FAIL**       | REFUSED
 *   d) extend PRE_FIX_BLOCK_SD with today's values     |    n/a      |   **FAIL**   |    n/a       |      n/a          | REFUSED — a post-hoc stamp is not a before-column (§9s)
 *
 * ## HOW CLAUSES (2)(3)(4) ARE MEASURED — behavioural, not by grepping source
 *
 * A first draft of this plant was UNPASSABLE and is recorded rather than quietly corrected. Clause
 * (2) reproduced the siblings' directory scan INSIDE this file, so no repair a worker could make in
 * the sibling would ever have flipped it (§6x-ter). Clause (3) required every atlas to be keyed in
 * `PRE_FIX_BLOCK_SD` — which MANDATES treatment (d), the one the table above refuses (§9s).
 *
 * Both are now measured by RUNNING the four siblings once in `beforeAll` and asserting on what they
 * actually report. That makes the repair unambiguous and lets (3) be satisfied EITHER by a real
 * before-column OR by an enumerated skip-with-reason — never by a post-hoc stamp, and never by
 * grepping for a literal (§7k).
 *   e) one live-enumerated cast helper, all four use it|    pass     |     pass     |    pass      |      pass         | ALL PASS
 *
 * (c) is the one to watch and clause (5) exists for it alone. §10s: never narrow a contract so that
 * it passes. Narrowing the population to the CAST is correct; narrowing it until the ward_delirium
 * pair stops being reported is the defect wearing a fix.
 *
 * (d) is the §9s trap. `PRE_FIX_BLOCK_SD` is a BEFORE-column. Stamping today's measurements into it
 * makes every future comparison self-satisfying. The honest repairs are: carry a real pre-fix value
 * where one exists, or have the clause SKIP an atlas with a named reason and assert the skip list is
 * enumerated — never silently NaN.
 *
 * claimScope: which shipped MPFB assets share a body mesh or skin atlas, and which of those pairs a
 *   learner can see together in one station.
 * notEvidenceFor: how strongly the duplication reads in a rendered room; garment differentiation;
 *   whether any atlas is of good quality; runtime skinning.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * ## FIXED (#528) — appended; the planted header above is immutable
 *
 * One shared live-cast helper (`live-scenario-actor-cast.ts`) now feeds all four siblings via
 * `resolveScenarioActorCast()` over `listShippedCastScenarioIds()`. Directory scans and the
 * three-actor `ACTORS` literal are gone. `PRE_FIX_BLOCK_SD` gaps are enumerated skip-with-reason
 * (not post-hoc stamps). Clauses (2)(3)(4) flipped `it.fails` → `it`. Clause (1) inverted guard
 * for #527 retained.
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * ## FIXED (#665) — appended 2026-08-25; the planted header above is immutable
 *
 * The #527 product defect is FIXED: `senior_resident_ward_v1` now authors its own identity
 * (ward-delirium.ts phenotype) and `mpfb-clinical-physician-adult.glb` was re-baked as a distinct
 * body (body vertex buffer 6ba48d646cc7, was the nurse's 3f9d4f4eceb0). Clauses (1) and (5)
 * inverted guards flipped to positive assertions: no co-staged distinct identities share a body
 * mesh, and the known physician/nurse pair must not be reported. The sibling-run discipline
 * (no skips, ≥15 tests) is preserved. The #528 fix and this one together close #527.
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const GENERATED = "apps/ui-xr/public/generated-humanoids";

/** The four contracts under measurement. Named files only — never a directory sweep (#195). */
const SIBLINGS = [
  "tools/openclinxr/evidence/garments-keep-their-authored-texture.test.ts",
  "tools/openclinxr/evidence/mpfb-skin-carries-surface-relief.test.ts",
  "tools/openclinxr/evidence/mpfb-skin-is-baked-not-painted.test.ts",
  "tools/openclinxr/evidence/skin-atlas-has-subsurface-not-occlusion.test.ts",
];
const CASTING = `${REPO_ROOT}/packages/openclinxr/asset-registry/src/actor-casting.ts`;

/** The known co-staged duplicate pair. Tracked as PRODUCT card #527; see the header. */
const KNOWN_DUPLICATE_PAIR = [
  "mpfb-clinical-nurse-adult.glb",
  "mpfb-clinical-physician-adult.glb",
] as const;

/** Never-cast harness subjects, DERIVED not typed: proven by absence from the live cast below. */
const io = new NodeIO();

type Row = { glb: string; bodySha: string | null; skinSha: string | null; verts: number };

async function readRow(glb: string): Promise<Row> {
  const doc = await io.read(`${GENERATED}/${glb}`);
  let bodySha: string | null = null;
  let verts = 0;
  for (const m of doc.getRoot().listMeshes()) {
    if (!/body|skin/i.test(m.getName() || "")) continue;
    const p = m.listPrimitives()[0]?.getAttribute("POSITION");
    if (!p) continue;
    const a = p.getArray() as Float32Array;
    verts = a.length / 3;
    bodySha = createHash("sha256").update(Buffer.from(a.buffer, a.byteOffset, a.byteLength)).digest("hex").slice(0, 16);
    break;
  }
  let skinSha: string | null = null;
  for (const mat of doc.getRoot().listMaterials()) {
    if (!/skin|body/i.test(mat.getName() || "")) continue;
    const img = mat.getBaseColorTexture()?.getImage();
    if (img) { skinSha = createHash("sha256").update(img).digest("hex").slice(0, 16); break; }
  }
  return { glb, bodySha, skinSha, verts };
}

/** Live cast: scenarioId -> [{actorId, glb}]. NEVER a directory scan, NEVER a name filter. */
async function liveCast(): Promise<Map<string, { actorId: string; role: string; glb: string }[]>> {
  const c: Record<string, unknown> = await import(CASTING);
  const listIds = c.listShippedCastScenarioIds as () => string[];
  const resolve = c.resolveScenarioActorCast as (id: string) => Record<string, string>[];
  const out = new Map<string, { actorId: string; role: string; glb: string }[]>();
  for (const s of listIds()) {
    out.set(s, resolve(s).map((a) => ({
      actorId: String(a.actorId ?? ""), role: String(a.role ?? ""),
      glb: String(a.assetPath ?? "").split("/").pop() ?? "",
    })));
  }
  return out;
}

/** Pairs of DISTINCT cast identities that appear in one station sharing a body mesh. */
async function coStagedDuplicates(): Promise<string[]> {
  const cast = await liveCast();
  const glbs = new Set<string>();
  for (const v of cast.values()) for (const a of v) if (a.glb.endsWith(".glb")) glbs.add(a.glb);
  const rows = new Map<string, Row>();
  for (const g of glbs) { try { rows.set(g, await readRow(g)); } catch { /* not an mpfb glb */ } }
  const hits = new Set<string>();
  for (const [scenarioId, actors] of cast) {
    for (let i = 0; i < actors.length; i += 1) for (let j = i + 1; j < actors.length; j += 1) {
      const a = actors[i]!, b = actors[j]!;
      if (a.actorId === b.actorId) continue;
      const ra = rows.get(a.glb), rb = rows.get(b.glb);
      if (!ra?.bodySha || !rb?.bodySha || ra.bodySha !== rb.bodySha) continue;
      hits.add(`${scenarioId}: ${[a.glb, b.glb].sort().join(" + ")}`);
    }
  }
  return [...hits].sort();
}

describe("a shared skin is a defect only between two people", () => {
  let siblingOutput = "";

  beforeAll(() => {
    // Run the four siblings ONCE and assert on what they REPORT. Named files only — never a sweep
    // over `tools/openclinxr/evidence` (#195 bake matrix). Non-zero exit is expected and fine: this
    // reads the assertion text, not the verdict, so the exit code is deliberately not trusted (§9p).
    const r = spawnSync("pnpm", ["exec", "vitest", "run", ...SIBLINGS], {
      encoding: "utf8", cwd: REPO_ROOT, timeout: 240_000,
      env: { ...process.env, FORCE_COLOR: "0", CI: "1" },
    });
    siblingOutput = `${r.stdout ?? ""}\n${r.stderr ?? ""}`;
    if (!siblingOutput.includes("Test Files")) {
      throw new Error(`sibling run produced no vitest summary; cannot measure:\n${siblingOutput.slice(0, 2000)}`);
    }
  }, 300_000);

  it("(1) the ward_delirium physician/nurse pair is no longer one person (#665)", async () => {
    // Flipped from the #527 inverted guard on 2026-08-25: the physician got its own
    // described identity (ward-delirium.ts authored phenotype) and a distinct baked
    // body, so the co-staged duplicate pair is gone. Positive assertion now.
    const dupes = await coStagedDuplicates();
    expect(dupes, "co-staged distinct identities sharing one body mesh").toEqual([]);
  });

  it("(2) RED: no sibling reports an asset the live cast never returns", async () => {
    const cast = await liveCast();
    const castGlbs = new Set<string>();
    for (const v of cast.values()) for (const a of v) castGlbs.add(a.glb);
    const onDisk = readdirSync(GENERATED).filter((f) => f.endsWith(".glb") && f.startsWith("mpfb-"));
    const neverCast = onDisk.filter((g) => !castGlbs.has(g));
    // A harness subject named in a sibling's assertion text is that sibling counting an asset no
    // learner sees. Today `gown-inspect` and `viseme-inspect` are both reported as sharing
    // violations. Satisfied by enumerating the population from the cast — NOT by a name filter,
    // which would leave the next un-cast asset to be rediscovered (§7k).
    const leaked = neverCast.filter((g) => siblingOutput.includes(g)).sort();
    expect(leaked, "never-cast harness assets named in sibling assertion output").toEqual([]);
  });

  it("(3) RED: no sibling compares a measurement against an absent baseline", () => {
    // `blockSd 3.07 vs pre-fix undefined (xNaN)`. Satisfiable EITHER by a real pre-fix value OR by
    // an enumerated skip-with-reason. NOT by stamping today's numbers into the before-column (§9s).
    const nan = siblingOutput
      .split("\n")
      .filter((l) => /pre-fix\s+undefined|xNaN|\bNaN\b/.test(l))
      .map((l) => l.trim())
      .slice(0, 12);
    expect(nan, "sibling assertions comparing against an undefined baseline").toEqual([]);
  });

  it("(4) RED: no sibling asserts a population count that a growing cast invalidates", () => {
    // `cargo-pants cover shells measured across the cast: expected 2 to be 3` — ACTORS.length is a
    // hand-typed population. Satisfied by enumerating wearers from the live cast.
    const typed = siblingOutput
      .split("\n")
      .filter((l) => /measured across the cast: expected \d+ to be \d+/.test(l))
      .map((l) => l.trim());
    expect(typed, "sibling assertions on a hand-typed population count").toEqual([]);
  });

  it("(5) COUNTERWEIGHT: the ward_delirium pair is GONE, and the flip was not reached by skipping", async () => {
    // Flipped with clause (1) on 2026-08-25 (#665). The original counterweight refused
    // treatment (c) — narrowing the population until the collision stopped being reported.
    // The collision is now gone for the real reason (the physician was baked a distinct
    // body from an authored identity), so the assertion direction inverts: the pair must
    // NOT be reported, and the sibling-run discipline (no skips, assertion count) still holds.
    const dupes = await coStagedDuplicates();
    expect(
      dupes.some((d) => KNOWN_DUPLICATE_PAIR.every((g) => d.includes(g))),
      "the ward_delirium physician/nurse pair (#527) must no longer be reported — a regression "
        + "that reintroduces the shared body reds here",
    ).toBe(false);

    // The other way to a clean sibling run is to stop running the assertions. Skipping, `.only`,
    // and deletion are all refused here; merge-kill independently refuses deletion.
    expect(/\bskipped\b/.test(siblingOutput), "a sibling assertion was skipped rather than repaired").toBe(false);
    const total = /Tests\s+(?:(\d+) failed \| )?(\d+) passed(?: \| (\d+) (?:skipped|todo))?\s+\((\d+)\)/.exec(siblingOutput);
    expect(total, `could not parse the sibling test total from:\n${siblingOutput.slice(-1200)}`).not.toBeNull();
    expect(
      Number(total![4]),
      "sibling assertion count must not shrink — 15 were running when this was planted",
    ).toBeGreaterThanOrEqual(15);
  });
});
