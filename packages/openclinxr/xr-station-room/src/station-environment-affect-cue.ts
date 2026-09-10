import { Mesh, type Object3D } from "three";

/**
 * Per-frame affect modulation of the loaded environment container.
 *
 * MOVED OUT OF `apps/ui-xr/src/main.ts` UNCHANGED. It was fifteen lines of behaviour inside a
 * composition root, which `composition-root-conventions.ts` exists to stop: "an app module may only
 * compose, boot, and expose what a package built." The logic, its thresholds and its cue-name
 * matching are byte-for-byte what main.ts ran; only the location changed.
 *
 * WHAT IT DOES. The environment's own handoff carries a cue name and an intensity. An affective cue
 * — anxious, frightened, urgent, parent — raises emissive intensity and adds a small breathing
 * scale; anything else damps it. The numbers (1.8x, a 0.35 ceiling, 0.6x damping, a 1.5% scale at
 * 800 ms) are the shipped ones and are not re-derived here.
 *
 * claimScope: emissive intensity and scale on the meshes of one container.
 * notEvidenceFor: emotional realism, clinical validity, or anything a viewer perceives.
 */
export function applyEnvironmentAffectCue(input: {
  container: Object3D | null | undefined;
  /** Where the handoff cue lives when the container has not cached one. */
  floorUserData: Record<string, unknown> | null | undefined;
  nowMs: number;
}): { cue: string; targetIntensity: number; isAffect: boolean } | null {
  const container = input.container;
  if (!container) return null;
  const handoff = input.floorUserData?.["caseDerivedVirtualEnvGltfHandoff"] as
    | { deeperVisualCueApplied?: { cue?: string; intensity?: number; richerCuesApplied?: boolean } }
    | undefined;
  const cueData = ((container.userData as Record<string, unknown>)["deeperVisualCueApplied"]
    ?? handoff?.deeperVisualCueApplied
    ?? { cue: "neutral", intensity: 0.1, richerCuesApplied: false }) as {
    cue?: string;
    intensity?: number;
  };
  const baseIntensity = cueData.intensity || 0.1;
  const cue = cueData.cue ?? "";
  const isAffect = Boolean(
    cue && (cue.includes("anx") || cue.includes("fright") || cue.includes("urgent") || cue.includes("parent")),
  );
  const targetIntensity = isAffect ? Math.min(baseIntensity * 1.8, 0.35) : baseIntensity * 0.6;
  container.traverse((node) => {
    if (node instanceof Mesh && !Array.isArray(node.material) && typeof node.material.emissiveIntensity === "number") {
      node.material.emissiveIntensity = targetIntensity;
    }
    if (node.scale && isAffect) node.scale.setScalar(1 + Math.sin(input.nowMs / 800) * 0.015);
  });
  return { cue, targetIntensity, isAffect };
}
