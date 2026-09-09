/**
 * Station equipment catalog — real GLB library + display labels.
 *
 * Split from station-equipment.ts (500-line zone budget): catalog data with no
 * mount-ordering logic.
 */

/** Real equipment GLBs under apps/ui-xr/public/xr-assets/medical-equipment/. */
export const REAL_EQUIPMENT_GLTF_BY_ID: Readonly<Record<string, string>> = {
  ecg_cart_equipment: "ecg-cart-12-lead.glb",
  iv_stand_equipment: "iv-pole-with-pump.glb",
  // #244: TRELLIS-generated wall clock (34,507 tris) — the first equipment subject to
  // clear the 60k per-asset ceiling; promoted byte-identical from issue-239 evidence.
  wall_clock_equipment: "wall-clock-analog.glb",
  // #253: TRELLIS-generated bedside monitor (60,000 tris) — second equipment subject to
  // clear the 60k per-asset ceiling; promoted byte-identical from issue-250 evidence.
  bedside_monitor_equipment: "bedside-monitor-generated.glb",
  // Sketchfab CC BY 4.0 bank (2026-08-12): measure-first normalize → deck/length SSOT.
  // Provenance sidecars + PROVENANCE.md carry attribution strings (#193).
  hospital_bed_equipment: "hospital-bed-sketchfab-ccby.glb",
  stretcher_equipment: "stretcher-sketchfab-ccby.glb",
  exam_table_equipment: "exam-table-sketchfab-ccby.glb",
  privacy_curtain_equipment: "privacy-curtain-monitor-sketchfab-ccby.glb",
  // #646: Kenney Furniture Kit CC0 — promoted via kenney-promote-cli.ts (seat-height
  // normalize: detected seat 0.24 m -> 0.45 m, scale 1.875 baked into vertices). CC0 needs
  // no attribution surface. Staging kit untouched; provenance sidecar records both hashes.
  chairs_equipment: "clinic-chair-kenney-cc0.glb",
};

export function equipmentDisplayLabel(equipmentId: string): string {
  return equipmentId
    .replace(/_equipment$/u, "")
    .split(/[-_]+/u)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
