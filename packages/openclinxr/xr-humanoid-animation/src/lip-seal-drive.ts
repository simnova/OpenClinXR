import { Mesh } from "three";
import type { Group } from "three";

/**
 * Lip-seal drive: the named viseme_PP never seals on this body, so closed
 * visemes (PP/sil/rest/closed) zero every viseme_* except viseme_sil, then pin
 * FACS `mouth-compression` (AU24) to 1 and shut FACS `mouth-open` to 0.
 * Open frames clear a leftover mouth-compression to 0 and leave viseme_* alone.
 * Jaw drive in jaw-viseme-drive.ts is untouched.
 */

const SEALED = new Set(["pp", "sil", "silence", "rest", "closed"]);

function isSealedToken(token: string | null | undefined): boolean {
  if (!token) return false;
  const lower = token.trim().toLowerCase();
  const bare = lower.startsWith("viseme_") ? lower.slice("viseme_".length) : lower;
  return SEALED.has(bare);
}

function startsWithViseme(token: string | null | undefined): boolean {
  return typeof token === "string" && token.toLowerCase().startsWith("viseme_");
}

// The named drive is precise (viseme_PP vs viseme_AA); the coarse viseme token is
// not, and the two can disagree when the wall clock (named drive) and the capture
// clock (visemeSequence index) pick different frames. When they disagree and the named
// target is a REAL viseme_* on this mesh, the named one wins. A phantom named target
// (no such morph on the mesh) does not override the coarse token — it names nothing
// this frame, so both tokens decide as before.
function isSealedFrame(
  viseme: string | null | undefined,
  activeTargetName: string | null | undefined,
  availableNames: ReadonlySet<string>,
): boolean {
  if (startsWithViseme(activeTargetName)) {
    const lowered = new Set([...availableNames].map((name) => name.toLowerCase()));
    if (lowered.has(activeTargetName!.toLowerCase())) return isSealedToken(activeTargetName);
  }
  return isSealedToken(viseme) || isSealedToken(activeTargetName);
}

export function applyLipSealForClosedViseme(
  root: Group,
  viseme: string | null | undefined,
  activeTargetName: string | null | undefined,
  openness = 0,
): void {
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    const dict = object.morphTargetDictionary;
    const influences = object.morphTargetInfluences;
    if (!dict || !influences) return;
    const sealIndex = dict["mouth-compression"];
    if (typeof sealIndex !== "number" || !Number.isInteger(sealIndex)) return;
    if (sealIndex < 0 || sealIndex >= influences.length) return;
    const sealed = isSealedFrame(viseme, activeTargetName, new Set(Object.keys(dict)));
    if (!sealed) {
      influences[sealIndex] = 0;
      return;
    }
    for (const [name, index] of Object.entries(dict)) {
      if (typeof index !== "number" || !Number.isInteger(index)) continue;
      if (index < 0 || index >= influences.length) continue;
      if (name.startsWith("viseme_") && name !== "viseme_sil") influences[index] = 0;
    }
    influences[sealIndex] = 1.0;
    const clamped = Math.min(1, Math.max(0, openness));
    for (const [name, openIndex] of Object.entries(dict)) {
      if (typeof openIndex !== "number" || !Number.isInteger(openIndex)) continue;
      if (openIndex < 0 || openIndex >= influences.length) continue;
      const lower = name.toLowerCase();
      if (lower === "mouth-open" || lower === "openclinxr_mouth_open" || lower === "mouthopen") {
        influences[openIndex] = Math.min(influences[openIndex] ?? 0, clamped * 0.3);
      }
    }
  });
}
