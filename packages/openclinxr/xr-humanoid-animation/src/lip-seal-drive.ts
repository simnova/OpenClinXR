import { Mesh } from "three";
import type { Group } from "three";

/**
 * Lip-seal drive: the named viseme_PP never seals on this body, so closed
 * visemes (PP/sil/rest/closed) zero every viseme_* except viseme_sil, then pin
 * FACS `mouth-compression` (AU24) to 1. Jaw drive in jaw-viseme-drive.ts is untouched.
 */

const SEALED = new Set(["pp", "sil", "silence", "rest", "closed"]);

function isSealedToken(token: string | null | undefined): boolean {
  if (!token) return false;
  const lower = token.trim().toLowerCase();
  const bare = lower.startsWith("viseme_") ? lower.slice("viseme_".length) : lower;
  return SEALED.has(bare);
}

export function applyLipSealForClosedViseme(
  root: Group,
  viseme: string | null | undefined,
  activeTargetName: string | null | undefined,
): void {
  if (!isSealedToken(viseme) && !isSealedToken(activeTargetName)) return;
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    const dict = object.morphTargetDictionary;
    const influences = object.morphTargetInfluences;
    if (!dict || !influences) return;
    const sealIndex = dict["mouth-compression"];
    if (typeof sealIndex !== "number" || !Number.isInteger(sealIndex)) return;
    if (sealIndex < 0 || sealIndex >= influences.length) return;
    for (const [name, index] of Object.entries(dict)) {
      if (typeof index !== "number" || !Number.isInteger(index)) continue;
      if (index < 0 || index >= influences.length) continue;
      if (name.startsWith("viseme_") && name !== "viseme_sil") influences[index] = 0;
    }
    influences[sealIndex] = 1.0;
  });
}
