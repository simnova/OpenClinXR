import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { NodeIO } from "@gltf-transform/core";
import { scenarioBank } from "../../../packages/openclinxr/scenario-fixtures/src/scenario-bank.js";
import {
  ED_ADULT_CAST_RUNTIME_PATH,
  MPFB_GOWN_ADULT_PATIENT_RUNTIME_PATH,
  resolveHumanoidVariantOrCastPath,
  resolveLocalHumanoidRuntimeAssetUrl,
} from "../../../apps/ui-xr/src/humanoid-runtime-asset-url.js";

/**
 * OBSERVABLE: seven humanoids a learner loads are still Anny-derived, and only the MPFB half of the
 * cast has face units.
 *
 * Operator, 2026-08-24: "clean up the humanoid assets so we know that none are anny" and "integrate
 * faceunits (if that makes sense) to all humanoids".
 *
 * MEASURED at 9999ea73 — THE TWO ASKS ARE ONE TASK:
 *
 *   shipped generated-humanoid provenance by sourceKind
 *     7  real_anny_candidate_unverified                 <- still Anny, still shipping
 *     6  mpfb2_makehuman_basemesh_from_anny_reference
 *     2  mpfb2_makehuman_basemesh
 *
 *   every mpfb-* asset carries an IDENTICAL 47-target set: 27 FACS + 15 viseme_* + 5 other
 *   no anny-derived asset carries any FACS action unit
 *
 * So face units arrive WITH the MPFB rail. Switching the resolver off Anny delivers "faceunits on
 * all humanoids" as a consequence — no acquisition required. MakeHuman's CC0 `faceunits01` pack
 * ("ARKit style face units") is NOT needed for expression: FACS is the superset ARKit derives from,
 * and `MPFB_FACS_MORPH_NAMES` (`packages/openclinxr/asset-registry/src/morph-target-resolver.ts:54`)
 * already maps canonical names onto it with an Action Unit justification per row.
 *
 * ## NOT A VALID COMPLETION ORACLE — corrected 2026-08-25 where it is stated, not appended
 *
 * DO NOT flip clause (1) and call the rail retired. Clause (1) does
 *
 *     const shipped = [...prov.entries()].filter(([name]) => resolver.includes(`${name}.glb`));
 *
 * which is a STRING SEARCH OVER THE RESOLVER'S SOURCE TEXT, not a call to the resolver. Deleting the
 * literals turns it green while proving nothing about generated bundles, comparator routes, the
 * exhausted-pool return at `actor-casting.ts:292`, isolated-lab defaults, or the 33 Anny-named files
 * sitting in `apps/ui-xr/dist` today. It is the marker-check class, and it is mine.
 *
 * Two counts in the block below are also STALE:
 *   - "ED counterpart = NONE" is FALSE. `mpfb-gown-adult-patient.glb` ships at 11,203,280 bytes and
 *     leads both the runtime resolver and registry casting. It has NO provenance sidecar, which is
 *     exactly why a provenance-keyed census omits it — add that sidecar before any audit trusts
 *     provenance.
 *   - "seven" is now EIGHT: `peds_fever_patient_child` was created 2026-08-24 19:21 and took four
 *     commits the same evening.
 *
 * The real oracle is #652 step 2: an audit that INVOKES both cast resolvers over the shipped bank plus
 * synthetic exhausted-pool cases, and reports `runtimeRawAnnyModelCount = 0`. Until that exists, this
 * file measures a text file and nothing else.
 *
 * AND THE LEARNER FRAMING BELOW IS OVERSTATED. `learners-see-mpfb-not-anny` and
 * `no-learner-meets-an-anny-patient` pass 9/9 today — no learner meets an Anny asset. The case for
 * retirement is stop-the-toil, not a recast.
 *
 * SIX OF SEVEN COUNTERPARTS ALREADY EXIST, so this is a resolver rewire, not a regeneration:
 *   adult_male_street_casual   -> mpfb-street-adult-male
 *   ed_chest_pain_nurse_adult  -> mpfb-clinical-nurse-adult
 *   ed_chest_pain_spouse_adult -> mpfb-family-partner-adult
 *   peds_anxious_parent        -> mpfb-peds-parent-aisha
 *   peds_nurse_kevin           -> mpfb-peds-nurse-kevin
 *   peds_patient_child         -> mpfb-peds-patient-child
 *   ed_chest_pain_adult_cast   -> NONE. This is the one body that must be produced.
 *
 * This finishes MADR 0052's P2 ("a learner loads MPFB bodies"), which is Accepted and half-executed:
 * 7 of 15 asset literals in `humanoid-runtime-asset-url.ts` are already mpfb-*.
 *
 * TWO RISKS THE IMPLEMENTER MUST MEASURE, NOT ASSUME:
 *   - MPFB assets are roughly TWICE the triangles (75,854 vs 34,572 on the nurse pair). Six swaps at
 *     2x is a real Quest budget change and is NOT evaluated here.
 *   - `mpfb-peds-parent-aisha` carries a garment mesh named
 *     `makeclothes_library_cargo_pants_mpfb_ob_patient_aisha_mesh.001` — an OB-patient garment on the
 *     peds parent. Whether that is a naming artifact or a real mis-fit is NOT DETERMINED.
 *
 * claimScope: that no shipped humanoid resolves an anny-derived asset, and that every shipped
 *   humanoid carries FACS action units.
 * notEvidenceFor: whether any MPFB body is anatomically right, correctly clothed, within the
 *   triangle budget, or reads as the same person the case describes.
 *
 * ## FIXED (#0)
 *
 * The resolver rewire landed, and "the one body that must be produced" was NOT produced: the
 * correction block's own note — `mpfb-gown-adult-patient.glb` ships and leads both resolvers — made
 * the repoint the D1-consistent move (no authored geometry, no new bake).
 *
 *   - `ED_ADULT_CAST_RUNTIME_PATH` now equals `MPFB_GOWN_ADULT_PATIENT_RUNTIME_PATH`
 *     (`humanoid-runtime-asset-url.ts:100-106`); the ED fallback and defense rows no longer emit
 *     `ed_chest_pain_adult_cast.glb`.
 *   - `ANNY_TO_MPFB_RUNTIME_PATH` remaps all seven Anny blob names to their MPFB2 counterparts
 *     inside `resolveLocalHumanoidRuntimeAssetUrl` (`humanoid-runtime-asset-url.ts:113-129, :386-390`).
 *     Shipped bundles still name the Anny files — e.g. `adult_abdominal_pain_v1` names all three ED
 *     Anny GLBs as actor blobs — so the emulator path must never return them.
 *
 * Clauses (1) and (2) flip `it.fails` -> `it`, implemented as the audit this header names as the
 * real oracle (#652 step 2) rather than the string search this header disowns: they INVOKE
 * `resolveHumanoidVariantOrCastPath` over every shipped scenario actor and
 * `resolveLocalHumanoidRuntimeAssetUrl` over the Anny blob names. Measured after the flip:
 *
 *   - 10 distinct cast paths for humanoid actors; 0 name an Anny GLB; all are mpfb-*.
 *   - every resolved file ships with the MPFB jaw joint and 31 FACS face keys (Anny carries 0).
 *   - emulator remap verified on all seven Anny blob names plus the full bundle-prefixed form.
 *
 * NOT TESTED (unchanged from the header above): the triangle-budget risk and the
 * `makeclothes_library_cargo_pants_mpfb_ob_patient_aisha_mesh.001` naming artifact remain open; no
 * pixel is graded here.
 */

const REPO = join(import.meta.dirname, "../../..");
const GEN = join(REPO, "apps/ui-xr/public/generated-humanoids");

const provenanceBySourceKind = (): Map<string, string> => {
  const out = new Map<string, string>();
  if (!existsSync(GEN)) return out;
  for (const f of readdirSync(GEN).filter((n) => n.endsWith(".provenance.json"))) {
    try {
      const d = JSON.parse(readFileSync(join(GEN, f), "utf8")) as { sourceKind?: string };
      out.set(f.replace(".provenance.json", ""), String(d.sourceKind ?? ""));
    } catch { /* skip */ }
  }
  return out;
};

/** An asset is Anny-derived when its sourceKind names anny WITHOUT naming mpfb — the
 *  `..._from_anny_reference` bodies are MPFB bodies MATCHED to an Anny reference, which is the
 *  sanctioned P1 path and is not what the operator asked to remove. */
const isAnnyDerived = (sourceKind: string): boolean =>
  /anny/i.test(sourceKind) && !/mpfb/i.test(sourceKind);

/** Anny-era GLB names the runtime must never resolve to. */
const ANNY_GLB_NAMES = [
  "ed_chest_pain_adult_cast.glb",
  "ed_chest_pain_nurse_adult.glb",
  "ed_chest_pain_spouse_adult.glb",
  "peds_anxious_parent.glb",
  "peds_fever_patient_child.glb",
  "peds_nurse_kevin.glb",
  "peds_patient_child.glb",
  "adult_male_street_casual.glb",
] as const;

/** MPFB2 FACS face-key naming (MakeHuman face units). Anny GLBs carry zero of these. */
const FACS_FACE_KEY = /^(eye-|eyebrows-|mouth-|nose-|neck-platysma)/iu;
const MIN_FACS_UNITS = 20;

type ResolvedRow = { scenarioId: string; actorId: string; role: string; path: string };

/** Mirrors the runtime's own non-humanoid filtering (system / virtual devices). */
function isHumanoidEmbodiedActor(actor: { actorId: string; role: string }): boolean {
  if (actor.role.toLowerCase() === "system") return false;
  if (/_phone_|_tablet_|telehealth_system/iu.test(actor.actorId)) return false;
  return true;
}

/** Every shipped scenario actor with a humanoid embodiment, through the cast SSOT. */
function resolvedHumanoidRows(): ResolvedRow[] {
  const rows: ResolvedRow[] = [];
  for (const scenario of scenarioBank) {
    for (const actor of scenario.actors ?? []) {
      if (!isHumanoidEmbodiedActor(actor)) continue;
      rows.push({
        scenarioId: scenario.scenarioId,
        actorId: actor.actorId,
        role: actor.role,
        path: resolveHumanoidVariantOrCastPath({
          scenarioId: scenario.scenarioId,
          actorId: actor.actorId,
          role: actor.role,
          fallbackPath: "/xr-assets/humanoids/neutral-generated-human.glb",
        }),
      });
    }
  }
  return rows;
}

async function faceUnitsOf(relPath: string): Promise<{ facsUnits: number; hasJaw: boolean } | null> {
  const abs = join(REPO, relPath);
  if (!existsSync(abs)) return null;
  const doc = await new NodeIO().read(abs);
  const joints = doc.getRoot().listSkins()[0]?.listJoints().map((j) => j.getName() ?? "") ?? [];
  const facs = new Set<string>();
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      for (const target of prim.listTargets()) {
        const name = target.getName() ?? "";
        if (FACS_FACE_KEY.test(name)) facs.add(name);
      }
    }
  }
  return { facsUnits: facs.size, hasJaw: joints.includes("jaw") };
}

describe("no shipped humanoid is anny, and every face has units", () => {
  it("(1) no humanoid the runtime resolves is anny-derived", () => {
    // Flipped it.fails -> it. The planted string-search oracle this header disowns is replaced by
    // the #652 step 2 audit it names: INVOKE the cast resolver over the shipped bank.
    const rows = resolvedHumanoidRows();
    expect(rows.length, "humanoid cast rows enumerated from scenarioBank").toBeGreaterThanOrEqual(10);
    const offenders = rows.filter((r) => ANNY_GLB_NAMES.some((n) => r.path.includes(n)));
    expect(offenders, "humanoid actors resolving to an Anny GLB").toEqual([]);
    const nonMpfb = rows.filter((r) => !r.path.includes("mpfb"));
    expect(nonMpfb, "resolved paths outside the mpfb rail").toEqual([]);
  });

  it("(2) every humanoid the runtime resolves carries FACS action units", async () => {
    // Flipped it.fails -> it. Same replacement: parse the resolved GLBs instead of reading
    // provenance, so the audit also sees mpfb-gown-adult-patient.glb (no provenance sidecar).
    const distinct = [...new Set(resolvedHumanoidRows().map((r) => r.path))];
    expect(distinct.length, "distinct runtime-resolved humanoid paths").toBeGreaterThanOrEqual(6);
    const broken: string[] = [];
    for (const p of distinct) {
      // Runtime paths are public URLs rooted at apps/ui-xr/public.
      const rel = p.replace(/^\//u, "");
      const abs = join(REPO, "apps/ui-xr/public", rel);
      if (!existsSync(abs)) {
        broken.push(`${p}: file missing from this tree`);
        continue;
      }
      const face = await faceUnitsOf(join("apps/ui-xr/public", rel));
      if (!face) {
        broken.push(`${p}: unreadable`);
        continue;
      }
      if (!face.hasJaw) broken.push(`${p}: no jaw joint (Anny rail marker)`);
      if (face.facsUnits < MIN_FACS_UNITS) {
        broken.push(`${p}: ${face.facsUnits} FACS face keys (< ${MIN_FACS_UNITS})`);
      }
    }
    expect(broken, "runtime-resolved humanoids failing the MPFB/FACS gate").toEqual([]);
  });

  it("(3) COUNTERWEIGHT: an MPFB body matched to an Anny REFERENCE is not an Anny asset", () => {
    // `mpfb2_makehuman_basemesh_from_anny_reference` is MADR 0052's P1 path: phenotype -> MPFB
    // macros, matched to the Anny reference. Removing those would delete the graduation work itself.
    expect(isAnnyDerived("mpfb2_makehuman_basemesh_from_anny_reference"),
      "an MPFB body matched to an Anny reference is MPFB").toBe(false);
    expect(isAnnyDerived("real_anny_candidate_unverified"), "a raw Anny candidate is not").toBe(true);
    expect(isAnnyDerived("mpfb2_makehuman_basemesh")).toBe(false);
  });

  it("(4) VACUITY GUARD: the MPFB counterparts exist and carry their face units", () => {
    // Without this, (1) and (2) could pass by the resolver referencing nothing at all.
    const prov = provenanceBySourceKind();
    const mpfb = [...prov.entries()].filter(([, k]) => /mpfb/i.test(k));
    expect(mpfb.length, "eight MPFB bodies were measured at 9999ea73").toBeGreaterThanOrEqual(6);
    for (const n of ["mpfb-clinical-nurse-adult", "mpfb-peds-parent-aisha", "mpfb-peds-patient-child"]) {
      expect(existsSync(join(GEN, `${n}.glb`)), `${n} must ship for the swap to be possible`).toBe(true);
    }
  });

  it("(5) NET: the ED fallback is the gowned MPFB patient, not the Anny cast GLB", () => {
    expect(ED_ADULT_CAST_RUNTIME_PATH).toBe(MPFB_GOWN_ADULT_PATIENT_RUNTIME_PATH);
    expect(ED_ADULT_CAST_RUNTIME_PATH).not.toContain("ed_chest_pain_adult_cast.glb");
    expect(ED_ADULT_CAST_RUNTIME_PATH).toContain("mpfb");
  });

  it("(6) NET: every Anny blob name the emulator or a bundle can hand us remaps to MPFB", () => {
    const cases = [
      "generated-humanoids/ed_chest_pain_adult_cast.glb",
      "apps/ui-xr/public/generated-humanoids/ed_chest_pain_nurse_adult.glb",
      "generated-humanoids/ed_chest_pain_spouse_adult.glb",
      "generated-humanoids/peds_anxious_parent.glb",
      "generated-humanoids/peds_nurse_kevin.glb",
      "generated-humanoids/peds_patient_child.glb",
      "generated-humanoids/adult_male_street_casual.glb",
      "ed_chest_pain_adult_cast.glb",
    ];
    const bad: string[] = [];
    for (const blobName of cases) {
      const url = resolveLocalHumanoidRuntimeAssetUrl({
        kind: "humanoid_model",
        blob: { blobName },
      });
      if (ANNY_GLB_NAMES.some((n) => url.includes(n))) bad.push(`${blobName} -> ${url}`);
      if (!url.includes("mpfb")) bad.push(`${blobName} -> ${url} (not on the mpfb rail)`);
    }
    expect(bad, "Anny blob names that still resolve to Anny GLBs").toEqual([]);
  });

  it("(7) NET: the Anny comparator files still ship and every MPFB counterpart exists", () => {
    // Refuses a "fix" that deletes the comparators (#491/#652 keep them as reference + comparator).
    for (const n of ANNY_GLB_NAMES) {
      expect(existsSync(join(GEN, n)), `Anny comparator ${n} must remain shipped (not deleted)`).toBe(true);
    }
    const counterparts = [
      "mpfb-gown-adult-patient.glb",
      "mpfb-clinical-nurse-adult.glb",
      "mpfb-family-partner-adult.glb",
      "mpfb-peds-nurse-kevin.glb",
      "mpfb-peds-patient-child.glb",
      "mpfb-street-adult-male.glb",
    ];
    for (const c of counterparts) {
      expect(existsSync(join(GEN, c)), `MPFB counterpart ${c} must ship`).toBe(true);
    }
    expect(
      existsSync(join(REPO, "apps/ui-xr/public/xr-assets/humanoids/candidates/mpfb-peds-parent-aisha.motion-bind.glb")),
      "MPFB counterpart mpfb-peds-parent-aisha.motion-bind.glb must ship",
    ).toBe(true);
  });
});
