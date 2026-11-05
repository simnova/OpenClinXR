/**
 * Isolated-subject URL spec parsing (st-vitbody r4).
 *
 * Extracted from isolated-subject-lab.ts when the forearm/neck focus values
 * pushed it over the frozen ceiling — a pure move, no behaviour change.
 * Type imports only (erased at build): no runtime cycle with the lab module.
 */

import type { CaptureView } from "./camera-fit-to-bounds.js";
import type { IsolatedSubjectKind, IsolatedSubjectSpec } from "./isolated-subject-lab.js";

/** Driven by URLSearchParams (same pattern as model-vetting-studio capture routes). */
export function parseIsolatedSubjectSpec(): IsolatedSubjectSpec {
  const params = new URLSearchParams(window.location.search);
  const raw = params.get("subject");
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as IsolatedSubjectSpec;
      if (parsed?.subjectId && parsed?.subjectKind) return parsed;
    } catch {
      // fall through to query fields
    }
  }
  const subjectId = params.get("subjectId") ?? "anonymous";
  const subjectKind = (params.get("subjectKind") ?? "furniture_builder") as IsolatedSubjectKind;
  const builder = (params.get("builder") as IsolatedSubjectSpec["builder"]) ?? undefined;
  const equipmentId = params.get("equipmentId") ?? undefined;
  const posture = (params.get("posture") as IsolatedSubjectSpec["posture"]) ?? undefined;
  const bodyGlb = params.get("bodyGlb") ?? undefined;
  const inclineRaw = params.get("inclineDegrees");
  const inclineDegrees = inclineRaw != null && inclineRaw !== "" ? Number(inclineRaw) : undefined;
  const viewRaw = params.get("view");
  const view = (viewRaw as CaptureView | null) ?? undefined;
  const exportGlbRaw = params.get("exportGlb");
  const subjectOnlyRaw = params.get("subjectOnly");
  const focusRaw = params.get("focus");
  const hideHairRaw = params.get("hideHair");
  const yawRaw = params.get("yawDegrees");
  const renderSizeRaw = params.get("renderSize");
  const yawDegrees = yawRaw != null && yawRaw !== "" ? Number(yawRaw) : undefined;
  const renderSize = renderSizeRaw != null && renderSizeRaw !== "" ? Number(renderSizeRaw) : undefined;
  return {
    subjectId,
    subjectKind,
    ...(builder ? { builder } : {}),
    ...(equipmentId ? { equipmentId } : {}),
    ...(posture ? { posture } : {}),
    ...(bodyGlb ? { bodyGlb } : {}),
    ...(inclineDegrees != null && Number.isFinite(inclineDegrees) ? { inclineDegrees } : {}),
    ...(view ? { view } : {}),
    ...(exportGlbRaw === "true" ? { exportGlb: true } : {}),
    ...(subjectOnlyRaw === "true" ? { subjectOnly: true } : {}),
    ...(focusRaw === "eyes" || focusRaw === "head" || focusRaw === "forearm" || focusRaw === "neck" ? { focus: focusRaw as "eyes" | "head" | "forearm" | "neck" } : {}),
    ...(hideHairRaw === "true" ? { hideHair: true } : {}),
    ...(yawDegrees != null && Number.isFinite(yawDegrees) ? { yawDegrees } : {}),
    ...(renderSize != null && Number.isFinite(renderSize) ? { renderSize } : {}),
    label: params.get("label") ?? subjectId,
  };
}
