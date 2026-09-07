/**
 * Animation-clip name helpers for generated humanoids — extracted verbatim from
 * apps/ui-xr/src/main.ts (shrink-only SIZE_FREEZE). Scenario + metadata reads
 * go through ctx; the package holds no mutable module state.
 */

import type { Scenario } from "@openclinxr/shared-schemas";
import { AnimationClip } from "three";

type ScenarioActor = Scenario["actors"][number];

export type ClipNameContext = {
  selectedScenarioId: () => string;
  scenarioForId: (scenarioId: string) => Scenario | undefined;
  actorMetadataRoleClipNames: (actorId: string) => readonly string[];
  touchResponseClipNames: (actorId: string) => readonly string[];
};

export function hasAuthoredClinicalIdlePoseClip(animationClips: readonly unknown[]): boolean {
  return animationClips.some((clip: unknown) =>
    clip instanceof AnimationClip && /clinical|idle|relaxed|conversation|consult/i.test(clip.name),
  );
}

export function gazeProbeAnimationClipNamesFromGltf(animationClips: readonly unknown[]): string[] {
  return animationClips
    .filter((clip: unknown): clip is AnimationClip => clip instanceof AnimationClip && clip.name.startsWith("openclinxr_mpfb2_eye_look_probe"))
    .map((clip) => clip.name);
}

/**
 * Case-driven one-shot response clip names (bodyMechanics.touchResponses.responseClip).
 * Registered alongside role clips for discoverability; played only via handleClinicalTouch.
 */
export function clinicalTouchResponseClipNamesForActor(ctx: ClipNameContext, actorId: string): string[] {
  const scenario = ctx.scenarioForId(ctx.selectedScenarioId());
  const actor = scenario?.actors.find((candidate: ScenarioActor) => candidate.actorId === actorId);
  const responses = actor?.bodyMechanics?.touchResponses ?? [];
  return responses
    .map((response: { responseClip?: string }) => response.responseClip)
    .filter((name: string | undefined): name is string => Boolean(name));
}

export function roleAnimationClipNamesForActor(ctx: ClipNameContext, actorId: string): string[] {
  const fromMetadata = ctx.actorMetadataRoleClipNames(actorId);
  // ED / non-peds paths have no actor-player metadata; keep a stable idle clip so we do not
  // auto-play every GLB animation (including the guard/withdraw one-shot) as role idle.
  const base =
    fromMetadata.length > 0
      ? fromMetadata
      : ["openclinxr_clinical_idle_breathing", "openclinxr_conversation_listen_nod"];
  // Register clinical-touch response clips here (discoverable via roleAnimationClipNamesForActor);
  // registerGeneratedHumanoidAnimation excludes them from auto-loop playback.
  return [...new Set([...base, ...ctx.touchResponseClipNames(actorId)])];
}
