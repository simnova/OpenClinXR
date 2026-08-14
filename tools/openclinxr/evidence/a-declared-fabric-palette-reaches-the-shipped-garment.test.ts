import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";

/**
 * **The paediatric patient's case definition declares `fabricPalette: "soft_blue_and_warm_white"`.
 * She ships in tan. The generator reads the field; the palette table has no key for it.**
 *
 * This is not "garment colour is a hardcoded literal" — that framing was mine and it was wrong.
 * `garment_shell_color(kind, actor_role, phenotype)` (`automate_blender.py:1748`) is genuinely
 * `f(role, kind, fabricPalette)`: it reads `phenotype["fabricPalette"]`, substring-matches it against
 * `_FABRIC_PALETTE_KIND_COLORS` (`:1723`), and only falls back to a role default when nothing matches.
 * The MPFB materializer consults the same field (6 references).
 *
 * ## MEASURED 2026-08-14 13:5x — the authored field, the table, and the shipped bytes
 *
 *   actor                     declared fabricPalette          in table?  shipped upper+lower
 *   ------------------------  ------------------------------  ---------  --------------------------
 *   patient_maya_johnson_v1    soft_blue_and_warm_white        **NO**     (0.720, 0.680, 0.550) tan
 *   parent_tara_johnson_v1     muted_rose_and_neutral          yes        (0.420, 0.360, 0.400) rose
 *   nurse_kevin_lee_v1         teal_scrubs_and_white_badge     yes        (0.050, 0.480, 0.520) teal
 *
 * `_FABRIC_PALETTE_KIND_COLORS` keys, in full: `hospital_gown_blue_pattern`,
 * `teal_scrubs_and_white_badge`, `teal_scrubs_peds_shift`, `muted_rose_and_neutral`,
 * `olive_knit_and_cream_casual`. **Nothing matches `soft_blue`.**
 *
 * **Two of three declared palettes reach the vertex. The third is silently dropped** — no warning, no
 * refusal, just a fallback that happens to be skin-adjacent. The child is the last actor in this
 * station reading as unclothed at station distance, and this is why.
 *
 * ## THE KNOWN-GOOD IS INSIDE THE SAME STATION (§9h)
 *
 * The parent and the nurse are not a different pipeline, a different rail or a different bake — they
 * are two actors standing beside the child, declaring palettes through the same field, resolved by the
 * same function, and both arrive correct. #388 added `muted_rose_and_neutral` for the parent and it
 * worked immediately. **The mechanism is proven; one key is missing.**
 *
 * ## THE CHEAP FIX THIS REFUSES
 *
 *   treatment                                             | (1) blue | (2) known-good | (3) mapped | result
 *   -------------------------------------------------------|----------|----------------|------------|--------
 *   a) today                                              | **FAIL** |      pass      |  **FAIL**  | REFUSED
 *   b) map soft_blue_and_warm_white -> the CURRENT tan    | **FAIL** |      pass      |    pass    | REFUSED
 *   c) recolour every patient blue, ignoring the palette  |   pass   |    **FAIL**    |  **FAIL**  | REFUSED
 *   d) add a soft-blue entry keyed on the declared name   |   pass   |      pass      |    pass    | ALL PASS
 *
 * **(b) is the one to watch and it is why clause (1) exists.** Adding the key while pointing it at
 * `(0.720, 0.680, 0.550)` satisfies "every declared palette resolves" without moving a single pixel —
 * the contract would go green and the child would still read as unclothed. Clause (1) requires the
 * shipped colour to be **blue-dominant**, which is what the palette's own name asserts.
 *
 * **(c) is why clause (2) exists.** A blanket patient recolour would green (1) and destroy the two
 * palettes that already work.
 *
 * **No invented threshold.** Clause (1) asserts `B > R` — a direction, not a magnitude, and the
 * minimum any colour called "soft blue" must satisfy. The nurse's shipped teal already clears it
 * (0.520 > 0.050) on the same pipeline, so it is a bound the tree demonstrably reaches.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227): **(1) and (3) are REDs**, both failing today on the child.
 * **(2) is a true net and passes today** — the parent's rose and the nurse's teal are already correct
 * and it reds the moment either moves. **(4) is the vacuity guard.**
 *
 * NOT TESTED:
 *   - **What shade of blue.** Clause (1) bounds direction only. Which soft blue is a staging choice;
 *     the palette name says "and warm white", so a two-tone table entry may be right.
 *   - **`patient_noah_chen_v1` declares NO fabricPalette at all.** Out of scope here — an actor with
 *     nothing declared is a different question from one whose declaration is dropped.
 *   - **Whether the child then reads as clothed at station distance.** That is a pixel grade the
 *     orchestrator owes after the bake, and the isolated capture will under-report it (measured: she
 *     reads clothed in isolation and unclothed in the station frame).
 *   - **The Anny rail.** Only the three MPFB peds actors are read.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const HUMANOIDS = process.env.OPENCLINXR_PALETTE_PROBE_DIR ?? join(REPO_ROOT, "apps/ui-xr/public/generated-humanoids");
const PHENOTYPES = join(REPO_ROOT, "packages/openclinxr/scenario-fixtures/generated/actor-phenotype.v1.json");
const AUTOMATE = join(REPO_ROOT, "tools/openclinxr/asset-pipeline/anny/automate_blender.py");

/** Actor id → shipped GLB, for the peds asthma station. */
const ACTOR_ASSETS: Readonly<Record<string, string>> = {
  patient_maya_johnson_v1: "mpfb-peds-patient-child",
  parent_tara_johnson_v1: "mpfb-peds-parent-aisha",
  nurse_kevin_lee_v1: "mpfb-peds-nurse-kevin",
};

/** The two that already resolve correctly — the known-good column, in the same station. */
const KNOWN_GOOD: Readonly<Record<string, readonly [number, number, number]>> = {
  parent_tara_johnson_v1: [0.42, 0.36, 0.4],
  nurse_kevin_lee_v1: [0.05, 0.48, 0.52],
};

const GARMENT = /t_shirt|pants|sweater/iu;
/** A rounding allowance on an exported float, not a tolerance on the colour choice. */
const COLOUR_EPSILON = 0.005;

type Row = { actorId: string; palette: string | null; upper: number[] | null; lower: number[] | null };

function declaredPalettes(): Record<string, string | null> {
  if (!existsSync(PHENOTYPES)) return {};
  const doc = JSON.parse(readFileSync(PHENOTYPES, "utf8")) as {
    entries: Record<string, Record<string, { phenotype?: Record<string, unknown> }>>;
  };
  const out: Record<string, string | null> = {};
  for (const actors of Object.values(doc.entries ?? {})) {
    for (const [actorId, a] of Object.entries(actors)) {
      const p = a.phenotype ?? {};
      const raw = (p["fabricPalette"] ?? p["clothing_color"] ?? null) as string | null;
      out[actorId] = typeof raw === "string" && raw.length > 0 ? raw : null;
    }
  }
  return out;
}

/** Keys of `_FABRIC_PALETTE_KIND_COLORS`, read from the file that defines them (not re-authored). */
function paletteTableKeys(): string[] {
  if (!existsSync(AUTOMATE)) return [];
  const src = readFileSync(AUTOMATE, "utf8");
  const start = src.indexOf("_FABRIC_PALETTE_KIND_COLORS: Dict");
  if (start < 0) return [];
  const block = src.slice(start, start + 2000);
  return [...block.matchAll(/^ {4}"([a-z_]+)":/gmu)].map((m) => m[1]!);
}

async function readGarments(assetStem: string): Promise<{ upper: number[] | null; lower: number[] | null }> {
  const path = join(HUMANOIDS, `${assetStem}.glb`);
  if (!existsSync(path)) return { upper: null, lower: null };
  const doc = await new NodeIO().readBinary(readFileSync(path));
  let upper: number[] | null = null;
  let lower: number[] | null = null;
  for (const mesh of doc.getRoot().listMeshes()) {
    const name = mesh.getName();
    if (!GARMENT.test(name)) continue;
    for (const prim of mesh.listPrimitives()) {
      const factor = prim.getMaterial()?.getBaseColorFactor();
      if (!factor) continue;
      const rgb = [factor[0]!, factor[1]!, factor[2]!];
      if (/pants|trouser/iu.test(name)) lower ??= rgb;
      else upper ??= rgb;
    }
  }
  return { upper, lower };
}

const palettes = declaredPalettes();
const tableKeys = paletteTableKeys();
const rows: Row[] = [];
for (const [actorId, stem] of Object.entries(ACTOR_ASSETS)) {
  const { upper, lower } = await readGarments(stem);
  rows.push({ actorId, palette: palettes[actorId] ?? null, upper, lower });
}

/**
 * An empty enumeration must FAIL, never pass vacuously (§7t). Plain `it` on purpose: an `it.fails`
 * cannot guard its own vacuity — it is satisfied by ANY failure, including this guard throwing.
 */
function requireMeasured(): Row[] {
  expect(existsSync(PHENOTYPES), `${PHENOTYPES} exists`).toBe(true);
  expect(tableKeys.length, "_FABRIC_PALETTE_KIND_COLORS keys parsed from automate_blender.py").toBeGreaterThan(0);
  expect(rows.length, "peds asthma actors measured").toBe(Object.keys(ACTOR_ASSETS).length);
  for (const r of rows) {
    expect(r.upper, `${r.actorId}: upper garment baseColorFactor read from the shipped GLB`).not.toBeNull();
  }
  return rows;
}

describe("a declared fabric palette reaches the shipped garment", () => {
  it("(1) RED: the child's soft-blue palette produces a blue-dominant garment", () => {
    const measured = requireMeasured();
    const child = measured.find((r) => r.actorId === "patient_maya_johnson_v1")!;
    expect(child.palette, "the child's case declares a fabricPalette at all").toBe("soft_blue_and_warm_white");
    // Direction, not magnitude: whatever "soft blue" is, blue exceeds red. The nurse's shipped teal
    // clears this on the same pipeline (0.520 > 0.050), so the tree demonstrably reaches it.
    expect(
      child.upper![2],
      `${child.actorId} declares "${child.palette}" and ships upper (${child.upper!.map((v) => v.toFixed(3)).join(", ")}) — blue must exceed red`,
    ).toBeGreaterThan(child.upper![0]!);
  });

  it("(2) COUNTERWEIGHT known-good: the parent's rose and the nurse's teal are unchanged", () => {
    // Refuses (c). A blanket patient recolour, or any collateral edit to the palette table, would
    // green clause (1) and break the two palettes that already reach the vertex today.
    const measured = requireMeasured();
    for (const [actorId, expected] of Object.entries(KNOWN_GOOD)) {
      const row = measured.find((r) => r.actorId === actorId)!;
      for (const [i, channel] of expected.entries()) {
        expect(
          Math.abs(row.upper![i]! - channel),
          `${actorId} upper channel ${i}: shipped ${row.upper![i]} vs known-good ${channel}`,
        ).toBeLessThanOrEqual(COLOUR_EPSILON);
      }
    }
  });

  it("(3) RED: every declared fabricPalette matches a key in the palette table", () => {
    // Refuses (b) from the other side: the child's palette must be MAPPED, not merely recoloured by
    // some other path. `garment_shell_color` substring-matches, so a key must contain or equal it.
    const measured = requireMeasured();
    const unmapped = measured
      .filter((r) => r.palette !== null)
      .filter((r) => !tableKeys.some((k) => r.palette!.includes(k) || k.includes(r.palette!)))
      .map((r) => `${r.actorId}: declares "${r.palette}", table has [${tableKeys.join(", ")}]`);
    expect(unmapped, "declared palettes with no entry in _FABRIC_PALETTE_KIND_COLORS").toEqual([]);
  });

  it("(4) VACUITY GUARD: upper and lower were both read for every actor", () => {
    const measured = requireMeasured();
    const missing = measured.filter((r) => r.lower === null).map((r) => `${r.actorId}: no lower garment`);
    expect(missing, "actors whose lower garment was not found").toEqual([]);
  });
});

/**
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * ## FIXED (#400) — appended; the planted header above is immutable
 *
 * MEASURED FIRST (clean-tree contract state, 2026-08-14): (1) fails — child upper
 * (0.720, 0.680, 0.550) tan, B < R; (3) fails — `soft_blue_and_warm_white` has no table key.
 * The premise correction (first dispatch, 48 turns) established that `garment_shell_color`
 * DOES read `phenotype["fabricPalette"]` but all three MPFB materializer call sites
 * (`materialize_mpfb_humanoid_candidate.py` :3017/:3091/:3269) passed an EMPTY phenotype —
 * the field was dropped before the palette function ever saw it. One table key alone would
 * have greened (3) while leaving the shipped bytes untouched (treatment b).
 *
 * FIX = two edits: (1) `materialize_mpfb_humanoid_candidate.py` now threads the manifest's
 * `input_params.phenotype.fabricPalette` into all three `garment_shell_color` calls via
 * `phenotype_fabric_palette(reference_id)` (the same manifest-read pattern as
 * `phenotype_skin_tone`; absent reference -> "" keeps the pre-#400 role fallback for aisha),
 * and (2) `automate_blender.py` `_FABRIC_PALETTE_KIND_COLORS` gained the
 * `soft_blue_and_warm_white` key mapping `closed_casual` -> (0.55, 0.68, 0.80) — the staged
 * muted powder blue from the issue (distinct from the nurse's teal, no cyan).
 *
 * Post-fix measured on the shipped bytes (NodeIO): child upper (0.55, 0.68, 0.80) and lower
 * (0.55, 0.68, 0.80) — B > R on both; parent rose (0.42, 0.36, 0.40) and nurse teal
 * (0.05, 0.48, 0.52) byte-unchanged; aisha's tan role fallback untouched (no reference).
 * The t-shirt keeps its authored T-shirt_basic.png texture; the cargo-pants cover shell
 * stays flat by authored state (cargo_pants.mhmat not staged — recorded skip, pre-existing).
 * (1) and (3) flipped to live `it(`; (2)/(4) hold unchanged.
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 */
