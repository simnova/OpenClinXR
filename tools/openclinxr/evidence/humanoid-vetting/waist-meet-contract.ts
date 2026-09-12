/**
 * Waist-meet ONE contract: the single definition of the waist-meet fit shared by
 * the Blender bake stage and the post-export GLB stage.
 *
 * The Blender bake stage (`fit_upper_hem_to_waistband` in
 * packages/openclinxr/factory-stations/src/body_param/garment_ops.py) runs in the
 * Z-up stage frame: height is Z, and the angular bucket is atan2(-stage_y, stage_x)
 * — the reflection that makes a factory bucket the same angular bucket the evidence
 * instrument measures after the export maps stage (x, y, z) to glTF (x, z, -y)
 * (export_yup=True). The post-export stage (`applyWaistMeetGlb` in
 * tools/openclinxr/asset-pipeline/makeclothes/apply-waist-meet-glb.ts) runs in the
 * exported Y-up frame the instrument reads: height is Y, bucket is atan2(glb_z,
 * glb_x). Same buckets, same rim band, same overlap margin — the ONLY difference
 * between the two stages is the axis swap the export performs.
 *
 * Both stages import these values from here (the Python stage mirrors them — the
 * agreement test fails closed on any drift). Never retune here without changing
 * the issue-320 overlap target in both stages.
 */

/** Positive overlap target: "several millimetres" (issue-320). Metres. */
export const WAIST_OVERLAP_MARGIN_M = 0.005;
/** Fraction of a garment's own height range treated as its rim band. */
export const WAIST_RIM_FRACTION = 0.12;
/** Angular buckets around the vertical axis. */
export const WAIST_BUCKETS = 36;
