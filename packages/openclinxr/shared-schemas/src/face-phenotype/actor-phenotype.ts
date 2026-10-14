import { Type } from "@sinclair/typebox";

/**
 * Optional per-actor authored phenotype that drives the asset factory's body
 * generation (Anny rail: orchestrate_character.py / generate_mesh.py). This is
 * the case-definition home for clinical (age, build, height_cm, bmi) and
 * cosmetic (hair_color, eye_color) identity plus the case-authored generation
 * inputs (pose, body_profile) — so the encounter specification, not a
 * generator-side Python dict, drives the generated actors (issue-291).
 *
 * Absence means the factory refuses the case rather than silently defaulting to
 * a generic adult (#276 / issue-291). Pipeline-only knobs (seed, output_name,
 * anny_topology, geometry-expansion recipes such as sleeveGeometryExpansion)
 * deliberately stay in the generator; see .openclinxr/evidence/issue-291/
 * phenotype-field-inventory.json for the per-field home classification.
 *
 * Lives here, not in ../schemas.ts: that file is at its 500-line zone budget,
 * and the face-phenotype keys (skin_asset_id, face_targets, lip_tone,
 * reference_portrait) are the D13 case home for chosen face-target weights.
 */
export const ActorPhenotypeSchema = Type.Object(
  {
    age: Type.Optional(Type.Number()),
    body_profile: Type.Optional(Type.String()),
    pose: Type.Optional(Type.String()),
    skin_tone: Type.Optional(Type.String()),
    hair_color: Type.Optional(Type.String()),
    eye_color: Type.Optional(Type.String()),
    gender_presentation: Type.Optional(Type.String()),
    height_cm: Type.Optional(Type.Number()),
    build: Type.Optional(Type.String()),
    hair_density: Type.Optional(Type.Number()),
    brow_tension: Type.Optional(Type.Number()),
    anxious: Type.Optional(Type.Number()),
    flush: Type.Optional(Type.Number()),
    age_wrinkle: Type.Optional(Type.Number()),
    bmi: Type.Optional(Type.Number()),
    clothing_style: Type.Optional(Type.String()),
    clothing_color: Type.Optional(Type.String()),
    role_visual_cue: Type.Optional(Type.String()),
    wardrobeRole: Type.Optional(Type.String()),
    garmentLayers: Type.Optional(Type.Array(Type.String())),
    fabricPalette: Type.Optional(Type.String()),
    materialFinish: Type.Optional(Type.String()),
    accessoryMarkers: Type.Optional(Type.Array(Type.String())),
    fitProfile: Type.Optional(Type.String()),
    skin_asset_id: Type.Optional(Type.String()),
    face_targets: Type.Optional(Type.Record(Type.String(), Type.Number())),
    lip_tone: Type.Optional(Type.String()),
    reference_portrait: Type.Optional(
      Type.Object({
        path: Type.String(),
        sha256: Type.String(),
        licence: Type.String(),
      }),
    ),
  },
  { additionalProperties: true },
);
