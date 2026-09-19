import { Mesh } from "three";
import type { Group } from "three";

/**
 * Lip-seal drive: the named viseme_PP never seals on this body, so closed
 * visemes (PP/sil/rest/closed) also pin FACS `mouth-compression` (AU24) to 1.
 * Jaw drive in jaw-viseme-drive.ts is untouched.
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
    const index = dict["mouth-compression"];
    if (typeof index !== "number" || !Number.isInteger(index)) return;
    if (index < 0 || index >= influences.length) return;
    influences[index] = Math.max(influences[index] ?? 0, 1.0);
  });
}
