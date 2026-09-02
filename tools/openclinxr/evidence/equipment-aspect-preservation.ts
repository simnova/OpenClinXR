/**
 * #268 — equipment aspect-preservation measurement bridge.
 *
 * The #266 footprint fit scaled X/Z independently, squashing a generated GLB's
 * aspect (bedside-monitor-generated.glb: source aspect 1.00/0.81 ≈ 1.23 —
 * landscape — rendered 0.38/0.81 ≈ 0.47 — portrait). This module measures the
 * aspect a gltf-sourced mount ACTUALLY has in the live scene against the aspect
 * of its source GLB file, so the #268 contract can assert aspect preservation
 * without importing `three` into tools/.
 *
 * claimScope: aspect ratio (width/height) of gltf-sourced equipment as mounted
 * in the live ui-xr scene vs the source GLB file.
 * notEvidenceFor: clinical correctness, Quest readiness, pixel grading.
 */

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { REAL_EQUIPMENT_GLTF_BY_ID } from "../../../apps/ui-xr/src/station-equipment.js";
import { measureParametricComposite } from "../../../apps/ui-xr/src/station-equipment-composite-measure.js";
import { inspectDeclaredEquipmentMounting, type DeclaredEquipmentMountingReport } from "./declared-equipment-mounted.js";

export const ISSUE_268_EVIDENCE_DIR = ".openclinxr/evidence/issue-268";
export const PRE_FIX_NAME = "pre-fix.json";

export type AspectRow = {
  equipmentId: string;
  /** File-level local AABB of the shipped GLB (round3, metres). */
  localMin: { x: number; y: number; z: number };
  localMax: { x: number; y: number; z: number };
  /** Local width/height from the GLB file — the aspect BEFORE the mount path acts. */
  sourceAspect: number | null;
  /**
   * The declared placement envelope (the parametric composite total AABB) this
   * floor mount is fitted to. null for ids without a DEDICATED parametric
   * builder (ED bay library GLBs) and for the elevated wall-clock control.
   */
  envelope: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } } | null;
  /** Live world AABB of the mounted equipment root in the first station that mounts it. */
  mountedMin: { x: number; y: number; z: number } | null;
  mountedMax: { x: number; y: number; z: number } | null;
  /** World width/height of the mounted root — the aspect AFTER the mount path acts. */
  mountedAspect: number | null;
  /** Relative aspect deviation |after − before| / before. The wall-clock control row is ≈ 0. */
  relativeAspectDeviation: number | null;
  /** Wall clock = the control (elevated, untouched by the fit); everything else = subject. */
  control: boolean;
};

export type EquipmentAspectPreservationReport = {
  rows: AspectRow[];
};

type ArtifactPayload = {
  schemaVersion: "openclinxr.equipment-aspect-preservation.v1";
  kind: "equipment_aspect_preservation";
  label: string;
  generatedAt: string;
  rows: AspectRow[];
  claimScope: string[];
  notEvidenceFor: string[];
};

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

/**
 * #268 — the aspect-preservation tolerance, DERIVED, not fitted.
 *
 * Every AABB component in this measurement path is rounded to 1 mm (round3: the
 * file-side node-transformed bounds and the live world bounds both round). An
 * aspect ratio W/H computed from two rounded components therefore carries a
 * worst-case relative error of 0.001/W + 0.001/H per side. Both sides of the
 * comparison round independently (source local vs mounted world), so the bound
 * on |mountedAspect − sourceAspect| / sourceAspect is
 *
 *   TOL = (0.001/Ws + 0.001/Hs) + (0.001/Wm + 0.001/Hm)
 *
 * evaluated at the SUBJECT's own measured dimensions. The coefficient 0.001 is
 * the pipeline's stated rounding, not a chosen constant; the control validates
 * the formula — the wall clock is mounted untouched and measures 0.000
 * deviation (pre-fix.json), an order of magnitude below its own bound
 * (≈0.0042 at W=1.000, H=0.929). A per-axis squash (the #268 defect) moves the
 * bedside monitor's aspect by 0.828 relative — ~65× the tightest subject bound.
 *
 * The tolerance scales with subject size because rounding is absolute: a small
 * correctly-fitted subject (the monitor at 0.22 m wide) has a larger relative
 * rounding floor than the 1.00 m wall clock. A single number chosen from the
 * control's size would be fitted to the control and flaky for smaller subjects.
 */
export function aspectToleranceFor(dimensions: {
  sourceWidth: number;
  sourceHeight: number;
  mountedWidth: number;
  mountedHeight: number;
}): number {
  const { sourceWidth, sourceHeight, mountedWidth, mountedHeight } = dimensions;
  const term = (w: number, h: number) => (w > 0 && h > 0 ? 0.001 / w + 0.001 / h : 0);
  return term(sourceWidth, sourceHeight) + term(mountedWidth, mountedHeight);
}

/**
 * Runtime-faithful local AABB of every shipped real-equipment GLB.
 *
 * §6v: measure with the instrument the runtime uses. The runtime loads the GLB
 * through three.js, which applies the file's node transforms (translation /
 * rotation / scale) before any Box3 measurement. Raw POSITION bounds are NOT the
 * source aspect a mount sees: the ED bay library GLBs (ecg-cart-12-lead.glb,
 * iv-pole-with-pump.glb) carry node scales, so their raw bounds disagree with
 * the loaded geometry. getWorldMatrix() applies the same TRS chain three.js
 * does.
 */
export async function measureGltfAssetLocalBounds(): Promise<
  Record<string, { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } }>
> {
  const io = new NodeIO();
  const out: Record<string, { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } }> = {};
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
  const equipmentDir = path.join(repoRoot, "apps/ui-xr/public/xr-assets/medical-equipment");
  for (const [equipmentId, fileName] of Object.entries(REAL_EQUIPMENT_GLTF_BY_ID)) {
    const filePath = path.join(equipmentDir, fileName);
    if (!existsSync(filePath)) continue;
    const doc = await io.read(filePath);
    const root = doc.getRoot();
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    let found = false;
    for (const mesh of root.listMeshes()) {
      for (const prim of mesh.listPrimitives()) {
        const pos = prim.getAttribute("POSITION");
        if (!pos) continue;
        const arr = pos.getArray();
        if (!arr) continue;
        const node = root.listNodes().find((n) => n.getMesh() === mesh);
        const m = node ? node.getWorldMatrix() : null;
        if (!m) continue;
        for (let i = 0; i < pos.getCount(); i += 1) {
          const x = arr[i * 3];
          const y = arr[i * 3 + 1];
          const z = arr[i * 3 + 2];
          const wx = m[0] * x + m[4] * y + m[8] * z + m[12];
          const wy = m[1] * x + m[5] * y + m[9] * z + m[13];
          const wz = m[2] * x + m[6] * y + m[10] * z + m[14];
          if (wx < min[0]) min[0] = wx;
          if (wy < min[1]) min[1] = wy;
          if (wz < min[2]) min[2] = wz;
          if (wx > max[0]) max[0] = wx;
          if (wy > max[1]) max[1] = wy;
          if (wz > max[2]) max[2] = wz;
          found = true;
        }
      }
    }
    if (found) {
      out[equipmentId] = {
        min: { x: round3(min[0]), y: round3(min[1]), z: round3(min[2]) },
        max: { x: round3(max[0]), y: round3(max[1]), z: round3(max[2]) },
      };
    }
  }
  return out;
}

/**
 * Build the per-id aspect rows from the live mounted world extents (a
 * DeclaredEquipmentMountingReport) + file-level local bounds. Shared by the CLI
 * (pre-fix artifact) and the evidence contract so the artifact rows and the
 * assertion rows cannot drift.
 */
export function buildAspectRowsFromReport(
  report: DeclaredEquipmentMountingReport,
  localBounds: Record<string, { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } }>,
): EquipmentAspectPreservationReport {
  const rows: AspectRow[] = [];
  for (const equipmentId of Object.keys(REAL_EQUIPMENT_GLTF_BY_ID)) {
    const local = localBounds[equipmentId];
    const sourceAspect = local && local.max.y - local.min.y > 0
      ? (local.max.x - local.min.x) / (local.max.y - local.min.y)
      : null;
    const composite = measureParametricComposite(equipmentId);
    const envelope = composite.source === "parametric"
      ? {
          min: { x: composite.totalAabbMin.x, y: composite.totalAabbMin.y, z: composite.totalAabbMin.z },
          max: { x: composite.totalAabbMax.x, y: composite.totalAabbMax.y, z: composite.totalAabbMax.z },
        }
      : null;
    // The wall-clock control is the id whose placement is ELEVATED (y ≥ 0.05).
    const control = equipmentId === "wall_clock_equipment";
    let mountedMin: AspectRow["mountedMin"] = null;
    let mountedMax: AspectRow["mountedMax"] = null;
    for (const s of report.stations) {
      const m = s.mounted.find((row) => row.equipmentId === equipmentId && row.source === "gltf");
      // Body-only extent (#268): the GLB body, excluding the parametric stand.
      const bodyMin = m?.worldBodyAabbMin ?? m?.worldAabbMin;
      const bodyMax = m?.worldBodyAabbMax ?? m?.worldAabbMax;
      if (bodyMin && bodyMax) {
        mountedMin = bodyMin;
        mountedMax = bodyMax;
        break;
      }
    }
    const mountedAspect = mountedMin && mountedMax && mountedMax.y - mountedMin.y > 0
      ? (mountedMax.x - mountedMin.x) / (mountedMax.y - mountedMin.y)
      : null;
    const relativeAspectDeviation =
      sourceAspect !== null && mountedAspect !== null && sourceAspect > 0
        ? Math.abs(mountedAspect - sourceAspect) / sourceAspect
        : null;
    rows.push({
      equipmentId,
      localMin: local ? { x: local.min.x, y: local.min.y, z: local.min.z } : { x: 0, y: 0, z: 0 },
      localMax: local ? { x: local.max.x, y: local.max.y, z: local.max.z } : { x: 0, y: 0, z: 0 },
      sourceAspect: sourceAspect !== null ? round3(sourceAspect) : null,
      envelope,
      mountedMin,
      mountedMax,
      mountedAspect: mountedAspect !== null ? round3(mountedAspect) : null,
      relativeAspectDeviation: relativeAspectDeviation !== null ? round3(relativeAspectDeviation) : null,
      control,
    });
  }
  return { rows };
}

export async function writeAspectPreservationDump(
  payload: EquipmentAspectPreservationReport,
  input?: { outputPath?: string; label?: string },
): Promise<string> {
  const outputPath = input?.outputPath ?? path.join(ISSUE_268_EVIDENCE_DIR, PRE_FIX_NAME);
  await mkdir(path.dirname(outputPath), { recursive: true });
  const artifact: ArtifactPayload = {
    schemaVersion: "openclinxr.equipment-aspect-preservation.v1",
    kind: "equipment_aspect_preservation",
    label: input?.label ?? "measurement",
    generatedAt: new Date().toISOString(),
    rows: payload.rows,
    claimScope: [
      "gltf_file_local_aabb",
      "live_scene_mounted_world_aabb",
      "parametric_composite_envelope",
      "aspect_ratio_width_over_height",
    ],
    notEvidenceFor: [
      "clinical_correctness_of_equipment",
      "quest_readiness",
      "pixel_grading",
      "occlusion_free_scene",
    ],
  };
  await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  process.stdout.write(`equipment-aspect-preservation: wrote ${outputPath}\n`);
  return outputPath;
}

// CLI: write the pre-fix aspect artifact (live mounted extents required).
if (
  typeof process !== "undefined"
  && process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
) {
  const label = process.argv.includes("--write-pre-fix") ? "pre-fix" : "cli";
  const localBounds = await measureGltfAssetLocalBounds();
  const report = await inspectDeclaredEquipmentMounting({ force: true });
  const rows = buildAspectRowsFromReport(report, localBounds);
  const outputPath = await writeAspectPreservationDump(rows, {
    outputPath: process.argv.includes("--write-pre-fix")
      ? path.join(ISSUE_268_EVIDENCE_DIR, PRE_FIX_NAME)
      : path.join(ISSUE_268_EVIDENCE_DIR, "latest.json"),
    label,
  });
  for (const row of rows.rows) {
    process.stdout.write(
      `  ${row.equipmentId}${row.control ? " (CONTROL)" : ""}: sourceAspect=${row.sourceAspect ?? "-"} `
      + `mountedAspect=${row.mountedAspect ?? "-"} dev=${row.relativeAspectDeviation ?? "-"}\n`,
    );
  }
  process.stdout.write(`wrote ${outputPath}\n`);
}
