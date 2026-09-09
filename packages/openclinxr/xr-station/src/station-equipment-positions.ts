/**
 * Default station equipment fallback positions.
 *
 * Split from station-equipment.ts (500-line zone budget): position data with no
 * mount-ordering logic.
 *
 * Default equipment mounts when a placement map is empty.
 * #169: first slot was (1.6, 0.28) — co-located with clean-encounter family framing
 * (1.42, 0.04), so chairs/exam tables bisected standing observers. Patient-side
 * offset first; doorway/wall mounts after.
 * #183: keep defaults clear of standing plants — clinical (0.64, 0.3), family (1.42, 0.04),
 * additional_cast (1.95, 0.15). Prefer walls / patient-side bay over mid-bay defaults.
 */
export const DEFAULT_STATION_EQUIPMENT_POSITIONS: ReadonlyArray<{ x: number; y: number; z: number }> = [
  { x: -1.55, y: 0, z: -0.85 },
  { x: -2.15, y: 0, z: 0.55 },
  { x: 2.25, y: 0, z: -1.05 },
  { x: -2.05, y: 0, z: -1.15 },
  { x: 2.15, y: 0, z: 0.95 },
  { x: -1.85, y: 0, z: 0.95 },
];
