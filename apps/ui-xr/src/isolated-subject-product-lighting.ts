/**
 * Isolated-subject lab product-lighting bridge (apps/ui-xr side).
 *
 * The lab lives in @openclinxr/xr-scene and cannot import from the app, so
 * this module imports the PRODUCT lighting functions and stashes them on
 * window for the lab to call. No energy/intensity or colour-temperature math
 * is re-implemented here or in the lab — it all stays inside
 * lighting-rig-runtime.ts. The only lab-owned transform is the rigid
 * translation that re-anchors the rig at the framed head (documented there).
 */
import {
  applyStationInteriorLightingForEnvironment,
  configureStationRendererToneMapping,
  loadLightingRig,
  resolveLightingRigPublicPath,
} from "./lighting-rig-runtime.js";

export type ProductRigCastEntry = {
  actorId: string;
  position: [number, number, number];
};

/** Raw `cast` array from the rig JSON (parseLightingRig strips it — the lab needs the patient locus). */
async function loadProductRigCast(environmentId: string): Promise<ProductRigCastEntry[] | null> {
  try {
    const response = await fetch(resolveLightingRigPublicPath(environmentId), { cache: "no-store" });
    if (!response.ok) return null;
    const json = (await response.json()) as { cast?: unknown };
    if (!Array.isArray(json.cast)) return null;
    const out: ProductRigCastEntry[] = [];
    for (const entry of json.cast) {
      const rec = entry as { actorId?: unknown; position?: unknown };
      if (typeof rec.actorId !== "string") continue;
      const p = rec.position;
      if (!Array.isArray(p) || p.length !== 3 || !p.every((v) => typeof v === "number" && Number.isFinite(v))) {
        continue;
      }
      out.push({ actorId: rec.actorId, position: p as [number, number, number] });
    }
    return out;
  } catch {
    return null;
  }
}

const fns = {
  applyStationInteriorLightingForEnvironment,
  configureStationRendererToneMapping,
  loadLightingRig,
  loadProductRigCast,
};

export type ProductLightingRigFns = typeof fns;

declare global {
  interface Window {
    __openClinXrProductLightingRigFns?: ProductLightingRigFns;
  }
}

(window as unknown as { __openClinXrProductLightingRigFns?: ProductLightingRigFns }).__openClinXrProductLightingRigFns = fns;
