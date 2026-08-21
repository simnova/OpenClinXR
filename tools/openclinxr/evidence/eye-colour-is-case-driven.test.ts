import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";

/**
 * Every actor in the peds asthma station has the same brown eyes, by construction. A case definition
 * cannot change them.
 *
 * MEASURED 2026-08-13 on the shipped bytes — the iris texture is byte-identical across the cast:
 *
 *   actor            material name                              iris texture   sha256[0:12]
 *   ---------------- ----------------------------------------   ------------   ------------
 *   aisha            mat_makeclothes_library_eyes_ob_patient_…   597 KB         4659691c7295
 *   nurse_kevin      mat_makeclothes_library_eyes_peds_nurse_…   597 KB         4659691c7295
 *   patient_child    mat_makeclothes_library_eyes_peds_patien…   597 KB         4659691c7295
 *
 * The material NAME is per-actor; the pixels are one asset. `baseColorFactor` is (1,1,1) on all three,
 * so the texture is the whole appearance.
 *
 * ## THE EYE RAIL IS OTHERWISE A PROPER FACTORY — THIS IS THE ONE CONSTANT IN IT
 *
 * Traced through `materialize_mpfb_humanoid_candidate.py`:
 *
 *   - mesh: `HumanService.add_mhclo_asset` on the CC0 MakeHuman `low-poly.mhclo` from the provider
 *     cache — a wired library asset, and it fails closed (`raise RuntimeError` when the cache is
 *     missing) rather than silently producing no eye.
 *   - placement: fitted to the FULL basemesh *before* the #318 helper strip, because the `.mhclo`
 *     references helper verts 14598–14741. Derived from the body.
 *   - scale: IPD measures 61.6 / 60.7 / **52.1 mm** — it tracks stature, adult versus child. Derived,
 *     not authored.
 *   - rig: `eye.L` / `eye.R` from the MPFB2 standard 137-joint armature.
 *   - material: `make_material_from_mhmat` reads the asset's own declared `brown.mhmat` →
 *     `brown_eye.png`. The code says of that helper, correctly, that it "is not eye-special-cased".
 *
 * So geometry, placement, scale and rig are all case-driven or derived. **Only the colour is fixed**,
 * and grepping the eye path for `actor_role`, `phenotype` or any per-case input returns nothing.
 *
 * ## THE KNOWN-GOOD IS THE GARMENT SLOT, ON THIS RAIL, LANDED TONIGHT
 *
 * `#180` (`044c3c21`) had exactly this shape: one hardcoded colour for every actor. It was fixed by
 * wiring the existing `garment_shell_color(kind, actor_role, phenotype)` into the MPFB materializer —
 * no table copied, no colour invented. Upper garments now measure (0.720, 0.680, 0.550) /
 * (0.420, 0.360, 0.400) / (0.050, 0.480, 0.520) across the same three actors.
 *
 * That is the precedent and the pattern: **the same materializer already varies one material slot by
 * role and phenotype.** There is no `eye_colour(phenotype)` equivalent, and the `.mhmat` path that
 * would consume one is already generic.
 *
 * ## THE CHEAP FIXES THIS REFUSES, probed 2026-08-13 before planting
 *
 *   treatment                                   | (1) irises differ | (2) still a real eye | (3) garments kept | result
 *   --------------------------------------------|-------------------|----------------------|-------------------|--------
 *   a) today                                    |    **FAIL**       |         pass         |       pass        | REFUSED
 *   b) flat baseColorFactor per actor           |      pass         |       **FAIL**       |       pass        | REFUSED
 *   c) tint the shared texture via the factor   |      pass         |       **FAIL**       |       pass        | REFUSED
 *   d) per-actor iris texture from a declared   |      pass         |         pass         |       pass        | ALL PASS
 *      material, phenotype-driven               |                   |                      |                   |
 *
 * (b) and (c) are not hypothetical — **they are what #337 and #338 each actually did**, and the
 * materializer's own comment records why both failed: *"a sclera and an iris cannot be one colour."*
 * A flat factor produces a coloured ball, not an eye. Clause (2) therefore requires the eye material
 * to keep a real texture and a neutral factor, which is exactly what those two slices lost.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227): (1) is the RED and fails 3/3. (2) and (3) pass today and
 * are regression nets — (2) guards the #340 fix that finally produced an eye at all, and (3) guards
 * the #180 garment colours landed hours ago.
 *
 * NOT TESTED:
 *   - **Which colours are right.** Eye colour is a phenotype question and this contract only asserts
 *     that the cast is not uniform. It cannot say that a given brown belongs to a given case.
 *   - **Whether an alternative iris asset exists or is licence-clear.** The `brown_eye.png` in the
 *     provider cache is CC0-headered; nothing establishes that a second one is available, and
 *     "unspecified licence is a refusal" applies. If no second asset exists, the honest fix may be a
 *     derived tint of a GREYSCALE iris rather than a second texture — that is a design question this
 *     contract deliberately does not settle.
 *   - **The peds cast only.** It is the one station whose three actors are all MPFB today.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const GENERATED = "apps/ui-xr/public/generated-humanoids";
const BANK = join(REPO_ROOT, "packages/openclinxr/scenario-fixtures/src/pediatric-asthma.ts");

/** Same-station peds asthma files (#388: parent is a dedicated family-palette variant). */
const CAST = [
  "mpfb-peds-patient-child.glb",
  "mpfb-peds-parent-aisha.glb",
  "mpfb-peds-nurse-kevin.glb",
] as const;

/** File → case actorId — phenotype.eye_color is read from the bank, never invented. */
const CAST_ACTOR_ID: Record<(typeof CAST)[number], string> = {
  "mpfb-peds-patient-child.glb": "patient_maya_johnson_v1",
  "mpfb-peds-parent-aisha.glb": "parent_tara_johnson_v1",
  "mpfb-peds-nurse-kevin.glb": "nurse_kevin_lee_v1",
};

/**
 * CC0 makehuman-system-assets pack stems (#356 / iris_palette._EYE_IRIS_PACK). An authored
 * eye_color outside this set is unbuildable and is out of clause (1)'s match duty (Maya/hazel).
 */
const EYE_IRIS_PACK = new Set([
  "blue",
  "bluegreen",
  "brown",
  "brownlight",
  "deepblue",
  "green",
  "grey",
  "ice",
  "lightblue",
]);

/**
 * Measured sha256[0:12] of each pack colour's iris PNG (baked into shipped GLBs / FIXED #356
 * table). brown/green/blue are the three that have reached a learner; others are absent until
 * a case authors them.
 */
const IRIS_SHA_BY_COLOUR: Record<string, string> = {
  brown: "4659691c7295",
  green: "b9864ac4f4fa",
  blue: "572ddc93ab3e",
};

function authoredColour(actorId: string): string {
  const src = readFileSync(BANK, "utf8");
  const needle = `actorId: "${actorId}"`;
  const idx = src.indexOf(needle);
  if (idx < 0) throw new Error(`bank missing actorId ${actorId}`);
  // Slice to the next actorId (or EOF) so Maya's long dialogue block still yields eye_color.
  const next = src.indexOf("actorId:", idx + needle.length);
  const block = src.slice(idx, next < 0 ? undefined : next);
  const m = block.match(/eye_color:\s*"([a-z_]+)"/);
  if (!m) throw new Error(`bank missing eye_color for ${actorId}`);
  return m[1]!;
}

/** (b) helper — two different pack-authored colours must not share an iris sha. */
function sharedIrisAcrossDifferentAuthored(
  actors: Array<{ file: string; authoredColour: string; irisSha: string | null }>,
): string[] {
  const inPack = actors.filter((a) => EYE_IRIS_PACK.has(a.authoredColour));
  const clashes: string[] = [];
  for (let i = 0; i < inPack.length; i++) {
    for (let j = i + 1; j < inPack.length; j++) {
      const a = inPack[i]!;
      const b = inPack[j]!;
      if (a.authoredColour !== b.authoredColour && a.irisSha !== null && a.irisSha === b.irisSha) {
        clashes.push(
          `${a.file}(${a.authoredColour})/${b.file}(${b.authoredColour}) share iris ${a.irisSha}`,
        );
      }
    }
  }
  return clashes;
}

/** #506: OB aisha's closed_casual role colour — muted olive, no longer the skin-adjacent
 * cream. Measured separately so clause (3) does not compare across stations. */
const OB_AISHA = "mpfb-ob-patient-aisha.glb";

const OLIVE: [number, number, number] = [0.34, 0.44, 0.34];
const TEAL: [number, number, number] = [0.05, 0.48, 0.52];
const CYAN: [number, number, number] = [0.08, 0.52, 0.95];
/**
 * #400 (2026-08-14): the child's declared `soft_blue_and_warm_white` now resolves through
 * `garment_shell_color` to this muted powder blue — she no longer ships cream (the patient
 * role fallback). The (3c) net's job — the EYE path must not recolour garments — is unchanged.
 */
const SOFT_BLUE: [number, number, number] = [0.55, 0.68, 0.8];

/** A real iris map is hundreds of KB; #337/#338 shipped flat colour and produced no eye. */
const MIN_IRIS_TEXTURE_KB = 100;

/** baseColorFactor must stay neutral — tinting the shared map is treatment (c). */
const MAX_FACTOR_DEVIATION = 0.08;

/** #180 landed per-actor garment colours on this rail; they must survive. */
const MIN_GARMENT_CHANNEL_DELTA = 0.05;

type Row = {
  file: string;
  irisSha: string | null;
  irisKb: number;
  factor: [number, number, number];
  upperRgb: [number, number, number] | null;
};

const io = new NodeIO();

async function measure(file: string): Promise<Row | null> {
  const doc = await io.read(join(REPO_ROOT, GENERATED, file));
  let irisSha: string | null = null;
  let irisKb = 0;
  let factor: [number, number, number] = [1, 1, 1];
  let upperRgb: [number, number, number] | null = null;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const mat = prim.getMaterial();
      if (!mat) continue;
      const name = `${mesh.getName()}/${mat.getName()}`;
      if (/eye/i.test(name)) {
        const img = mat.getBaseColorTexture()?.getImage();
        if (img) {
          irisSha = createHash("sha256").update(img).digest("hex").slice(0, 16);
          irisKb = img.length / 1024;
        }
        const c = mat.getBaseColorFactor();
        if (c) factor = [c[0]!, c[1]!, c[2]!];
      } else if (/t_shirt|scrub|sweater/i.test(mesh.getName())) {
        const c = mat.getBaseColorFactor();
        if (c) upperRgb = [c[0]!, c[1]!, c[2]!];
      }
    }
  }
  return { file, irisSha, irisKb, factor, upperRgb };
}

const rows = (await Promise.all(CAST.map((f) => measure(f).catch(() => null)))).filter(
  (r): r is Row => r !== null,
);

/** An empty enumeration must FAIL, never pass vacuously (§7t). */
function requireRows(): void {
  expect(rows.length, `cast actors measured (of ${CAST.length})`).toBe(CAST.length);
}

describe("eye colour is case-driven, not one constant for everyone", () => {
  it("(1) RED (FIXED #519): iris matches authored pack eye_color; different authored pack colours differ", () => {
    // Re-keyed from the #356 anti-monopoly proxy (cast-wide distinctness floor). Uniformity is
    // permitted when the CASE is uniform — #519 made parent+nurse both author brown and ship brown.
    requireRows();
    const withAuthored = rows.map((r) => {
      const actorId = CAST_ACTOR_ID[r.file as (typeof CAST)[number]];
      return { ...r, authoredColour: authoredColour(actorId) };
    });

    // (a) every actor whose authored eye_color is in the pack ships exactly that colour.
    const mismatches: string[] = [];
    for (const r of withAuthored) {
      if (!EYE_IRIS_PACK.has(r.authoredColour)) continue;
      const expected = IRIS_SHA_BY_COLOUR[r.authoredColour];
      expect(expected, `pack colour ${r.authoredColour} needs a measured iris sha`).toBeTruthy();
      if (!r.irisSha?.startsWith(expected!)) {
        mismatches.push(
          `${r.file}: authoredColour=${r.authoredColour} expected sha ${expected} got ${r.irisSha}`,
        );
      }
    }
    expect(mismatches, "authored pack eye_color must reach the shipped iris").toEqual([]);

    // (b) two actors authoring DIFFERENT pack colours ship DIFFERENT irises — hardcode defense.
    expect(
      sharedIrisAcrossDifferentAuthored(withAuthored),
      "different authored pack colours must not share one iris",
    ).toEqual([]);
    // Fixture: a hardcode (one iris for two pack colours) must still fail (b).
    expect(
      sharedIrisAcrossDifferentAuthored([
        { file: "fixture-a.glb", authoredColour: "brown", irisSha: "4659691c7295ad62" },
        { file: "fixture-b.glb", authoredColour: "blue", irisSha: "4659691c7295ad62" },
      ]).length,
      "fixture with two pack colours sharing one iris must be rejected",
    ).not.toBe(0);
  });

  it("(2) NET known-good: the eye is still a textured iris, not a flat colour", () => {
    // #337 and #338 each replaced the material with a flat colour and neither produced an eye —
    // "a sclera and an iris cannot be one colour". #340 fixed it by consuming the declared .mhmat.
    requireRows();
    const flat = rows
      .filter(
        (r) =>
          r.irisSha === null ||
          r.irisKb < MIN_IRIS_TEXTURE_KB ||
          r.factor.some((v) => Math.abs(v - 1) > MAX_FACTOR_DEVIATION),
      )
      .map((r) => `${r.file}: tex=${r.irisKb.toFixed(0)}KB factor=(${r.factor.map((v) => v.toFixed(2)).join(",")})`);
    expect(flat, "eyes reduced to a flat or tinted colour").toEqual([]);
  });

  it("(3) NET known-good: #180's per-actor garment colours survive", () => {
    requireRows();
    const clashes: string[] = [];
    for (let i = 0; i < rows.length; i++)
      for (let j = i + 1; j < rows.length; j++) {
        const a = rows[i]!.upperRgb;
        const b = rows[j]!.upperRgb;
        if (a && b && a.every((v, k) => Math.abs(v - b[k]!) < MIN_GARMENT_CHANNEL_DELTA))
          clashes.push(`${rows[i]!.file}/${rows[j]!.file} share an upper colour`);
      }
    expect(clashes, "garment colours collapsed back to a shared value").toEqual([]);
  });

  it("(3b) DESTRUCTIVE: peds parent and child do not share an upper colour", () => {
    requireRows();
    const child = rows.find((r) => r.file === "mpfb-peds-patient-child.glb");
    const parent = rows.find((r) => r.file === "mpfb-peds-parent-aisha.glb");
    expect(child?.upperRgb, "child upper measured").toBeTruthy();
    expect(parent?.upperRgb, "parent upper measured").toBeTruthy();
    const same = child!.upperRgb!.every(
      (v, k) => Math.abs(v - parent!.upperRgb![k]!) < MIN_GARMENT_CHANNEL_DELTA,
    );
    expect(same, "parent and child still share an upper colour (one-GLB-two-roles not split)").toBe(false);
  });

  it("(3c) COUNTERWEIGHT: child soft-blue, kevin teal, OB aisha olive — no cyan, no grey-everyone", async () => {
    requireRows();
    const child = rows.find((r) => r.file === "mpfb-peds-patient-child.glb");
    const parent = rows.find((r) => r.file === "mpfb-peds-parent-aisha.glb");
    const kevin = rows.find((r) => r.file === "mpfb-peds-nurse-kevin.glb");
    const aisha = await measure(OB_AISHA);
    expect(aisha?.upperRgb, "OB aisha upper measured").toBeTruthy();
    const near = (got: [number, number, number] | null | undefined, want: [number, number, number]) =>
      Boolean(got && want.every((v, k) => Math.abs(v - got[k]!) < MIN_GARMENT_CHANNEL_DELTA));
    expect(near(child?.upperRgb, SOFT_BLUE), `child recolored away from her declared soft blue: ${child?.upperRgb}`).toBe(true);
    expect(near(kevin?.upperRgb, TEAL), `kevin recolored away from teal: ${kevin?.upperRgb}`).toBe(true);
    expect(near(aisha?.upperRgb, OLIVE), `OB aisha recolored away from olive: ${aisha?.upperRgb}`).toBe(true);
    expect(near(parent?.upperRgb, CYAN), "parent used the forbidden cyan probe colour").toBe(false);
    expect(near(parent?.upperRgb, OLIVE), "parent shares OB aisha's olive — family must stay muted-rose").toBe(false);
    const greys = [child, parent, kevin]
      .filter((r) => {
        const c = r?.upperRgb;
        if (!c) return false;
        const spread = Math.max(...c) - Math.min(...c);
        return spread < MIN_GARMENT_CHANNEL_DELTA;
      })
      .map((r) => r!.file);
    expect(greys, "cast painted everyone grey").toEqual([]);
  });
});

/**
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * ## FIXED (#356) — appended, planted header above is immutable
 *
 * MEASUREMENT FIRST (`.openclinxr/evidence/mpfb-eye-colour/pre-fix.json`, 2026-08-13): the shared
 * iris is byte-identical across the cast (sha256 `4659691c7295ad62`, 610,817 bytes, 1024² RGBA,
 * baseColorFactor (1,1,1)) and it is BAKED BROWN, not greyscale — 37% of sampled pixels are
 * chromatic at mean hue 34°, iris annulus 42% chromatic. Naive tinting would be muddy (treatment c
 * stays refused). The provider cache held ONLY brown; the makehuman2 repo holds only hm08/brown.
 * A licence-clear second asset EXISTS: the official `makehuman_system_assets` CC0 pack (every
 * staged `<colour>.mhmat` carries the same in-file CC0 header as hm08), 9 iris colours, each
 * 610-701 KB / 1024² RGBA / luminance sd 33.7-40.0 — all clear the (2) floors. pack `brown_eye.png`
 * is byte-identical to the shipped iris (sha `4659691c7295ad62`).
 *
 * FIX = treatment (d), the #180 pattern: the same materializer that varies the garment slot now
 * varies the iris slot. `automate_blender.eye_iris_colour(actor_role, phenotype)` returns the CC0
 * pack's declared colour id (patient → brown, family → green, nurse → blue; a phenotype naming an
 * eye colour overrides); the materializer resolves that id to the staged `<colour>.mhmat` and
 * consumes the asset's OWN declared texture via the unchanged generic `make_material_from_mhmat`
 * path (#340). No table copied, no colour invented; baseColorFactor stays (1,1,1) — the texture is
 * the whole appearance. Re-baked all three cast actors (same re-bake path as #180/#350/#351, no
 * fresh full orchestrate). Post-fix measured on the shipped bytes (NodeIO):
 *
 *   file                         | iris texture | sha256[0:12] | bytes   | hue
 *   -----------------------------|--------------|--------------|---------|-----
 *   mpfb-peds-patient-child.glb  | brown        | 4659691c7295 | 610,817 | 34°
 *   mpfb-ob-patient-aisha.glb    | green        | b9864ac4f4fa | 662,241 | 49°
 *   mpfb-peds-nurse-kevin.glb    | blue         | 572ddc93ab3e | 666,029 | 66°
 *
 * (1) flipped to `it`; (2)/(3) hold unchanged — real textured irises at neutral factors, and #180's
 * garment colours (measured (0.720,0.680,0.550)/(0.420,0.360,0.400)/(0.050,0.480,0.520)) survived
 * the re-bake.
 *
 * NOT TESTED (unchanged residual): WHICH colours are right — eye colour is a phenotype question and
 * the assignment (brown/green/blue) is a "close enough" staging judgement, not a clinician's sign-off;
 * how the irises LOOK in the eye crops is the orchestrator's pixel grade; the peds cast only.
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 *
 * ## FIXED (#388) — appended, planted header above is immutable
 *
 * MEASURED FIRST (`.openclinxr/evidence/issue-388/pre-fix.json`): one GLB two roles.
 * `mpfb-ob-patient-aisha.glb` is both peds `parent_tara_johnson_v1` and OB
 * `patient_aisha_khan_v1`. Upper+lower on that file are cream (0.72, 0.68, 0.55),
 * identical to the child's closed_casual palette, so clause (3) reds on the peds
 * station. Recolouring aisha would collide with Omar's muted rose in OB.
 *
 * FIX: bake a second variant `mpfb-peds-parent-aisha.glb` via the same aisha
 * materializer entrypoint (`blender --background --python …/materialize_mpfb_humanoid_candidate.py
 * -- --output … --actor-role parent`, no `--reference`). `garment_shell_color` already
 * maps `closed_casual` + role=parent to `muted_rose_and_neutral` (0.42, 0.36, 0.40).
 * Both resolvers now point `parent_tara_johnson_v1` at the new file. CAST in this
 * module is the same-station peds files; OB aisha is measured only in the
 * counterweight and stays cream. Clause (3) is unweakened pairwise distinctness.
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 *
 * ## FIXED (#400) — appended; the planted header above is immutable
 *
 * (3c) pins the child's upper to cream — that was the #400 defect, not a property. The child's
 * declared `soft_blue_and_warm_white` now resolves through `garment_shell_color` to
 * (0.55, 0.68, 0.80) (see the a-declared-fabric-palette contract). The net's job — the EYE path
 * must not recolour garments — is unchanged and now expects the child's declared soft blue.
 * Measured post-fix on the shipped bytes: child (0.55, 0.68, 0.80), parent rose
 * (0.42, 0.36, 0.40), nurse teal (0.05, 0.48, 0.52), OB aisha cream (0.72, 0.68, 0.55).
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 *
 * ## FIXED (#519) — appended; the planted header above is immutable
 *
 * #519 made the peds cast honour its authored `eye_color` (parent green→brown, nurse blue→brown).
 * Clause (1)'s anti-monopoly proxy (cast-wide distinctness floor) then reds on a correct,
 * case-driven cast: the bank authors brown / brown / hazel, hazel is unbuildable, both adults
 * ship brown `4659691c7295`. Uniformity is a TRUE statement about the case, not a hardcode.
 *
 * FIX (#520 instrument): re-key clause (1) to the case —
 *   (a) every actor whose authored `eye_color` is in the CC0 pack ships that colour's iris sha;
 *   (b) two actors authoring DIFFERENT pack colours ship DIFFERENT irises (hardcode still fails;
 *       a brown+blue fixture sharing one sha is rejected). Maya/hazel stays out of (a) — not in
 *       pack. Clauses (2)/(3)/(3b)/(3c) untouched. Bank unedited.
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 */
