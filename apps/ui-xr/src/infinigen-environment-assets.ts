/**
 * environmentId → shipped Infinigen room GLB. Deterministic bake; add rows as rooms are
 * produced. Seed/predicate facts live in `PROVENANCE.md`, not here (one line per room).
 */
export const INFINIGEN_ENVIRONMENT_ASSETS = {
  ed_exam_bay_v1: "/xr-assets/environment/infinigen-ed-exam-bay.glb",
  pediatric_urgent_care_bay_v1: "/xr-assets/environment/infinigen-pediatric-urgent-care-bay.glb",
  primary_care_clinic_room_v1: "/xr-assets/environment/infinigen-primary-care-clinic.glb",
  ed_stroke_bay_v1: "/xr-assets/environment/infinigen-ed-stroke-bay.glb",
  adult_ed_abdominal_bay_v1: "/xr-assets/environment/infinigen-adult-ed-abdominal-bay.glb",
} as const;
