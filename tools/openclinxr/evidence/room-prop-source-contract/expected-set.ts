/**
 * Expected source-bound current prop set (#223 option B).
 *
 * Shipped manifest ids in full, plus factory residuals that classify as
 * cue_or_overlay through the public classifyRoomProp export. Physical factory
 * residuals that are not shipped are excluded so a missing mesh cannot be
 * pretended shipped. Never derives from collector output.
 */

import { classifyRoomProp } from "@openclinxr/xr-station";
import {
  readFactoryResidualDeclarations,
  readRuntimeBundleDirectDeclarations,
  readShippedDeclarations,
} from "./source-declarations.js";

export type ExpectedSourceSet = {
  expectedIds: string[];
  shippedIds: string[];
  authoredIds: string[];
  cueIds: string[];
  sourceByPropId: Map<string, string>;
};

/** Canonical ED anchors from the generic-cue counterweight, never invented. */
export const TRACKED_ED_ANCHORS = [
  "monitor-waveform-card",
  "monitor-vitals-badge",
  "ekg-leads-on-bed",
] as const;

export async function expectedSourceBoundPropSet(): Promise<ExpectedSourceSet> {
  const shipped = await readShippedDeclarations();
  const shippedIds = [...new Set(shipped.map((d) => d.propId))].sort();
  if (shippedIds.length === 0) {
    throw new Error("room-prop-source-contract: empty shipped authoring — failing closed");
  }

  const sourceByPropId = new Map<string, string>();
  for (const row of shipped) {
    const prior = sourceByPropId.get(row.propId);
    sourceByPropId.set(row.propId, prior === undefined ? row.source : `${prior},${row.source}`);
  }

  const factory = await readFactoryResidualDeclarations();
  const bundles = await readRuntimeBundleDirectDeclarations();
  const residuals = [...factory, ...bundles];
  const cueIds = new Set<string>();
  for (const row of shipped) {
    const cls = classifyRoomProp(row.propId, { label: row.label, semanticRole: row.semanticRole });
    if (cls.classification === "cue_or_overlay") cueIds.add(row.propId);
  }
  for (const row of residuals) {
    if (sourceByPropId.has(row.propId)) continue;
    const cls = classifyRoomProp(row.propId, { label: row.label, semanticRole: row.semanticRole });
    if (cls.classification !== "cue_or_overlay") continue;
    cueIds.add(row.propId);
    sourceByPropId.set(row.propId, row.source);
  }
  if (cueIds.size === 0) {
    throw new Error("room-prop-source-contract: empty cue set — failing closed");
  }

  for (const anchor of TRACKED_ED_ANCHORS) {
    if (!sourceByPropId.has(anchor) || !shippedIds.includes(anchor)) {
      throw new Error(`room-prop-source-contract: missing TRACKED ED anchor ${anchor}`);
    }
  }

  return {
    expectedIds: [...sourceByPropId.keys()].sort(),
    shippedIds,
    authoredIds: shippedIds,
    cueIds: [...cueIds].sort(),
    sourceByPropId,
  };
}
