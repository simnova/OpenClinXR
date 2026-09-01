/**
 * issue-275 — the hm08 body_param rail derives its upper garment from the CASE
 * DEFINITION (cast role -> Anny case-actor preset garmentLayers), with the scrub
 * shirt as the factory FALLBACK.
 *
 * THE DEFECT, MEASURED (see .openclinxr/evidence/issue-275/pre-fix.json): every
 * hm08 body class was fitted with the same `makeclothes_library_scrub_shirt_*`
 * regardless of the role the case definition casts it into — the ED spouse / peds
 * parent (family) rendered as clinical staff. The five hardcoded sites are in
 * fit_stage.py, fit-cli.ts, body-param-cli.ts (×2) and body_param_stage.py.
 *
 * WHAT DRIVES THE CHOICE (reported per the issue): the scenario bank itself carries
 * no `phenotype` field (verified: zero occurrences in packages/openclinxr/scenario-fixtures),
 * so `phenotype.garmentLayers` is NOT populated for hm08-cast actors. The case
 * definition that IS populated for hm08-cast actors is the cast ROLE in the
 * actor-casting SSOT (packages/openclinxr/asset-registry/src/actor-casting.ts),
 * resolved through the SAME case-actor presets the Anny rail uses
 * (tools/openclinxr/asset-pipeline/anny/orchestrate_character.py
 *  CASE_ACTOR_PRESETS ... phenotype.garmentLayers).
 *
 * ROLE -> GARMENT LAYERS (source: orchestrate_character.py case-actor presets):
 *   patient -> ["hospital_gown"]                       (ed_chest_pain_priority_v2 patient)
 *   nurse   -> ["scrub_top", "scrub_pocket"]           (nurse_kevin_lee_v1, nurse_maria_alvarez_v1)
 *   family  -> ["casual_top", "open_cardigan"]         (parent_tara_johnson_v1, spouse_anna_hayes_v1)
 *
 * LAYER -> HM08 GARMENT (factory library):
 *   scrub layers     -> wojackowl_scrubs_shirt_hm08 (CC-BY, fits and covers)
 *   casual / tshirt  -> toigo_basic_tucked_t-shirt_hm08 (#322: CC0 MakeClothes top
 *                    with sleeves, zero helper refs — replaces the hand-coded shell
 *                    on the roles where a real garment exists)
 *   gown / cardigan  -> openclinxr_hm08_upper_cover_shell (the deterministic
 *                    body-derived cover shell, the #277 factory fallback for garments
 *                    that cannot be fitted from the library — no gown or open-front
 *                    cardigan exists in any cached pack, so the shell stays; no .mhclo
 *                    is invented — a mapping pointing at a missing asset is the #256 trap)
 *
 * COUNTERWEIGHT: the default is NOT removed. `resolveHm08UpperGarment` returns the
 * scrub shirt for any role without a case-definition garment, so no generated body
 * is ever left without an upper garment (#73's topless-parent regression).
 */

import { planClothingGenerate } from "@openclinxr/factory-stations";

export type Hm08GarmentKind = "library" | "cover_shell";

export type Hm08UpperGarmentSpec = {
  /** Semantic garment id recorded in the body-param catalog. */
  garmentId: string;
  kind: Hm08GarmentKind;
  /** Mesh name prefix used for the fitted/shell mesh on each body class. */
  meshNamePrefix: string;
  /** The case-definition garment layers that produced this selection. */
  garmentLayers: string[];
  /** The case field the selection read. */
  sourceField: string;
  /** Band (fractions of body height) the cover shell covers; null for library fits. */
  bandLowFraction: number | null;
  bandHighFraction: number | null;
};

/**
 * The factory FALLBACK upper garment. Issue #275 says "do not remove the default
 * outright — make it the fallback". This is the single source of truth for it.
 * WojackOWL Scrub Shirt, CC-BY (read from the .mhclo header), the only upper-body
 * .mhclo present in the library.
 */
export const HM08_UPPER_GARMENT_FALLBACK_ID = "wojackowl_scrubs_shirt_hm08";
export const HM08_UPPER_GARMENT_FALLBACK_MESH_PREFIX = "makeclothes_library_scrub_shirt";

/**
 * #322 — the CC0 MakeClothes casual top (`toigo_basic_tucked_t-shirt`, author MRT,
 * CC0 per its own `.mhclo` header) that replaces the hand-coded cover shell for the
 * `casual_top` / `tshirt` layer family. Measured across the provider cache it has
 * zero helper-vertex references (so it fits the helper-stripped #318 basemesh) and a
 * W/H of 1.40 on an A-pose basemesh (geometry extending laterally along the arms —
 * it has sleeves, which the shell never did, #319). Fitted through the SAME
 * `ClothesService.fit_clothes_to_human` the catalog already records (D1: wire the
 * proven tool rather than repair hand-authored geometry).
 */
export const HM08_TOIGO_T_SHIRT_ID = "toigo_basic_tucked_t-shirt_hm08";
export const HM08_TOIGO_T_SHIRT_MESH_PREFIX = "makeclothes_library_toigo_basic_tucked_t_shirt";

/**
 * The procedural upper garment: the deterministic body-derived cover shell (#277's
 * factory fallback mechanism) used when the case definition selects a garment the
 * .mhclo library cannot provide (open_cardigan / hospital_gown remain; no gown or
 * open-front cardigan exists in any cached pack — #322 narrowed the surface from
 * four layers to two). No `.mhclo` is invented — the stage builds the shell from
 * the body surface.
 */
export const HM08_UPPER_COVER_SHELL_ID = "openclinxr_hm08_upper_cover_shell";
export const HM08_UPPER_COVER_SHELL_MESH_PREFIX = "makeclothes_library_civilian_shirt";

/** Fitted `.mhclo` upper garments the library can provide (id -> mesh prefix). */
const HM08_LIBRARY_GARMENTS: Readonly<Record<string, { meshNamePrefix: string }>> = {
  [HM08_UPPER_GARMENT_FALLBACK_ID]: {
    meshNamePrefix: HM08_UPPER_GARMENT_FALLBACK_MESH_PREFIX,
  },
  [HM08_TOIGO_T_SHIRT_ID]: {
    meshNamePrefix: HM08_TOIGO_T_SHIRT_MESH_PREFIX,
  },
};

/**
 * Case-definition role -> garmentLayers. Mirrors the Anny rail's case-actor presets
 * (orchestrate_character.py CASE_ACTOR_PRESETS, keyed per actor). Roles are the
 * actor-casting SSOT's role vocabulary (patient / nurse / family).
 */
export const ROLE_TO_GARMENT_LAYERS: Readonly<Record<string, string[]>> = {
  patient: ["hospital_gown"],
  nurse: ["scrub_top", "scrub_pocket"],
  family: ["casual_top", "open_cardigan"],
  family_member: ["casual_top", "open_cardigan"],
  parent: ["casual_top", "open_cardigan"],
  spouse: ["casual_top", "open_cardigan"],
};

/** Case-definition garment layer -> hm08 upper garment id. */
const HM08_GARMENT_BY_LAYER: Readonly<Record<string, string>> = {
  scrub_top: HM08_UPPER_GARMENT_FALLBACK_ID,
  scrub_pocket: HM08_UPPER_GARMENT_FALLBACK_ID,
  scrub: HM08_UPPER_GARMENT_FALLBACK_ID,
  hospital_gown: HM08_UPPER_COVER_SHELL_ID,
  patient_gown: HM08_UPPER_COVER_SHELL_ID,
  ed_gown: HM08_UPPER_COVER_SHELL_ID,
  gown: HM08_UPPER_COVER_SHELL_ID,
  // #322 — casual/t-shirt layers now route to the CC0 MakeClothes t-shirt (fitted,
  // sleeved) instead of the hand-coded shell. open_cardigan and hospital_gown keep
  // the shell: no open-front cardigan or gown exists in any cached pack.
  casual_top: HM08_TOIGO_T_SHIRT_ID,
  open_cardigan: HM08_UPPER_COVER_SHELL_ID,
  short_sleeve_exam_tshirt: HM08_TOIGO_T_SHIRT_ID,
  tshirt: HM08_TOIGO_T_SHIRT_ID,
  exam_tshirt: HM08_TOIGO_T_SHIRT_ID,
};

/** Torso band (fractions of body height) the scrub shirt covers, measured on the
 * shipped lean-female GLB (Y 0.936..1.494 of a 1.760 m body). The cover shell is
 * built over this same band so the family figure is clothed over the same region. */
export const UPPER_COVER_SHELL_BAND = { low: 0.53, high: 0.85 } as const;

function normalizeRole(role: string): string {
  return role.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

/**
 * The Anny rail's garment layers for a role (the known-good column). The Anny rail
 * derives its garments from these same case-actor preset layers.
 */
export function resolveAnnyGarmentLayers(role: string): string[] {
  return ROLE_TO_GARMENT_LAYERS[normalizeRole(role)] ?? [];
}

/** Map case-definition garment layers to an hm08 upper garment. */
export function garmentIdForLayers(garmentLayers: readonly string[]): string {
  for (const layer of garmentLayers) {
    const id = HM08_GARMENT_BY_LAYER[normalizeRole(layer)];
    if (id) return id;
  }
  return HM08_UPPER_GARMENT_FALLBACK_ID;
}

/**
 * Resolve the hm08 upper garment for a cast role.
 * The case definition (role -> garmentLayers) is the source when it supplies one;
 * the scrub shirt is the fallback otherwise (COUNTERWEIGHT: nobody ends up undressed).
 * `kind` is "library" when the resolved id names a fitted `.mhclo` (scrub or the #322
 * CC0 t-shirt); "cover_shell" when the layer still has no library garment (gown /
 * open_cardigan) and the deterministic body-derived shell is used.
 */
export function resolveHm08UpperGarment(role: string): Hm08UpperGarmentSpec {
  planClothingGenerate({
    actorId: role,
    garmentToken: resolveAnnyGarmentLayers(role)[0] ?? "short_sleeve_exam_tshirt",
  });
  const garmentLayers = resolveAnnyGarmentLayers(role);
  const garmentId = garmentIdForLayers(garmentLayers);
  const library = HM08_LIBRARY_GARMENTS[garmentId];
  return {
    garmentId,
    kind: library ? "library" : "cover_shell",
    meshNamePrefix: library ? library.meshNamePrefix : HM08_UPPER_COVER_SHELL_MESH_PREFIX,
    garmentLayers,
    sourceField: "actor-casting SSOT cast role -> Anny case-actor preset phenotype.garmentLayers",
    bandLowFraction: library ? null : UPPER_COVER_SHELL_BAND.low,
    bandHighFraction: library ? null : UPPER_COVER_SHELL_BAND.high,
  };
}

/** Body class id -> cast roles, read from the actor-casting SSOT (never hardcoded). */
export function hm08BodyClassCastRoles(input: {
  scenarios: readonly string[];
  resolveCast: (scenarioId: string) => readonly { assetPath: string; actorId: string; role: string }[];
}): Record<string, Array<{ scenarioId: string; actorId: string; role: string }>> {
  const out: Record<string, Array<{ scenarioId: string; actorId: string; role: string }>> = {};
  for (const scenarioId of input.scenarios) {
    for (const actor of input.resolveCast(scenarioId)) {
      const m = /body-param-(adult_[a-z_]+)-library\.glb$/u.exec(actor.assetPath);
      if (!m) continue;
      const bodyClassId = m[1]!;
      (out[bodyClassId] ??= []).push({
        scenarioId,
        actorId: actor.actorId,
        role: actor.role,
      });
    }
  }
  return out;
}
