/**
 * Canonical morph name -> index on a given body, through the ONE shared resolver.
 *
 * MEASURED DEFECT this exists to fix (2026-09-16): emotion-transition.ts and viseme-timeline.ts
 * indexed `morphTargetDictionary["openclinxr_mouth_open" | "..._brow_concern" | "..._cheek_tension"]`
 * DIRECTLY. The MPFB-topology bodies this studio actually captures carry MakeHuman FACS names
 * ("mouth-open", "eyebrows-left-inner-up", ...), so all three lookups returned undefined and the
 * cue wrote nothing while still reporting a full set of expression weights.
 *
 * Probed against the built module with a FACS dictionary and a canonical one:
 *   MPFB (FACS names) appliedTargetCount=0  written=[]
 *   Anny (canonical)  appliedTargetCount=3  written=[all three]
 *
 * Routed through @openclinxr/asset-registry's resolveMorphTarget rather than re-declaring the
 * alias map here: a concept redeclared in two places drifts.
 */
import { resolveMorphTarget } from "@openclinxr/asset-registry";

export function resolveMorphTargetIndex(
  dictionary: Record<string, number>,
  canonicalName: string,
): number | undefined {
  const resolved = resolveMorphTarget(canonicalName, new Set(Object.keys(dictionary)));
  return resolved === null ? undefined : dictionary[resolved];
}
