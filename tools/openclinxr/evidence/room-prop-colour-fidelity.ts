/**
 * #100 — authored room-prop colours reach built materials.
 *
 * claimScope: CSS/bare hex on EncounterRuntimeRoomProp → MeshStandardMaterial.color.
 * notEvidenceFor: palette quality, clinical appropriateness, prop geometry.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildRoomPropMaterialColours,
  type RoomPropColourInput,
} from "../../../apps/ui-xr/src/room-prop-materials.js";

export { buildRoomPropMaterialColours };

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

/**
 * Load room-prop colour fields from a shipped public scene manifest
 * under apps/ui-xr/public/xr-assets/generated/<scenarioId>/.
 */
export async function roomPropsFromShippedManifest(
  scenarioId: string,
): Promise<RoomPropColourInput[]> {
  const manifestPath = path.join(
    REPO_ROOT,
    "apps/ui-xr/public/xr-assets/generated",
    scenarioId,
    "scene-manifest.v1.json",
  );
  const raw = JSON.parse(await readFile(manifestPath, "utf8")) as {
    roomProps?: Array<{
      propId?: string;
      colorHex?: string;
      accentColorHex?: string;
    }>;
  };
  const roomProps = Array.isArray(raw.roomProps) ? raw.roomProps : [];
  return roomProps
    .filter((p): p is { propId: string; colorHex: string; accentColorHex: string } =>
      typeof p.propId === "string"
      && typeof p.colorHex === "string"
      && typeof p.accentColorHex === "string")
    .map((p) => ({
      propId: p.propId,
      colorHex: p.colorHex,
      accentColorHex: p.accentColorHex,
    }));
}
