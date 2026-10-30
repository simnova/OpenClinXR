/**
 * C4 page rendering for conversation content: per-actor mouth bars driven ONLY
 * by the server's (cueId, speaking), tinted by the server's emotion. No DOM,
 * no network, no local intent state: every method takes the server snapshot
 * (or a view of it) and derives pixels from that alone.
 */
import * as THREE from "three";
import { resolveActorTint, resolveMouthAmplitude } from "./probe-state.js";

/** One (turnId, cueId) appended when the SERVER's cue changes. */
export interface SyncProbeCueObservation {
  turnId: number;
  cueId: string;
}

/** The server snapshot fields C4 rendering reads. Extra fields are ignored. */
export interface C4ServerActorView {
  speaking?: unknown;
  cueId?: unknown;
  emotion?: unknown;
}

function viewSpeaking(view: C4ServerActorView | undefined): boolean {
  return view?.speaking === true;
}

function viewCueId(view: C4ServerActorView | undefined): string {
  return typeof view?.cueId === "string" ? view.cueId : "";
}

function viewEmotion(view: C4ServerActorView | undefined): string {
  return typeof view?.emotion === "string" ? view.emotion : "neutral";
}

/**
 * Per-actor mouth bars plus C4 change observations. Constructed once with the
 * scene; observe() consumes server snapshots, update() animates one frame.
 * Counters accumulate speaking/silent active frames for the harness.
 */
export class C4MouthRender {
  private mouthMeshes = new Map<string, THREE.Mesh>();
  private lastCue = new Map<string, { turnId: number; cueId: string }>();
  private lastEmotion = new Map<string, string>();
  silentFrames = 0;
  speakingFrames = 0;

  constructor(
    scene: THREE.Scene,
    actorIds: readonly string[],
    positions: Record<string, readonly [number, number, number]>,
  ) {
    for (const id of actorIds) {
      const mouth = new THREE.Mesh(
        new THREE.BoxGeometry(0.34, 0.06, 0.06),
        new THREE.MeshStandardMaterial({ color: resolveActorTint("neutral"), roughness: 0.5 }),
      );
      const position = positions[id] ?? [0, 1, -2];
      mouth.position.set(position[0], position[1] + 0.42, position[2] + 0.26);
      mouth.name = `sync-probe.mouth.${id}`;
      scene.add(mouth);
      this.mouthMeshes.set(id, mouth);
    }
  }

  /** Consume one server snapshot: tint bars, return cue/emotion deltas. */
  observe(
    actors: Record<string, C4ServerActorView | undefined>,
    turnId: number,
  ): { cues: SyncProbeCueObservation[]; emotions: string[] } {
    const cues: SyncProbeCueObservation[] = [];
    const emotions: string[] = [];
    for (const [id, mouth] of this.mouthMeshes) {
      const view = actors[id];
      // Append on VALUE change (not turnId change): the idle actor's cue and
      // emotion never move, so it contributes no entries.
      const cueId = viewCueId(view);
      const cueSeen = this.lastCue.get(id);
      if (!cueSeen) {
        this.lastCue.set(id, { turnId, cueId });
      } else if (cueSeen.cueId !== cueId) {
        this.lastCue.set(id, { turnId, cueId });
        cues.push({ turnId, cueId });
      }
      const emotion = viewEmotion(view);
      const emotionSeen = this.lastEmotion.get(id);
      if (emotionSeen === undefined) {
        this.lastEmotion.set(id, emotion);
      } else if (emotionSeen !== emotion) {
        this.lastEmotion.set(id, emotion);
        emotions.push(emotion);
      }
      const material = mouth.material as THREE.MeshStandardMaterial;
      material.color.setHex(resolveActorTint(emotion));
    }
    return { cues, emotions };
  }

  /** Animate bars for one frame from the latest server snapshot. */
  update(actors: Record<string, C4ServerActorView | undefined>, nowMs: number): void {
    for (const [id, mouth] of this.mouthMeshes) {
      const view = actors[id];
      const speaking = viewSpeaking(view);
      const amplitude = resolveMouthAmplitude(viewCueId(view), speaking, nowMs);
      mouth.scale.set(1, 1 + amplitude * 4, 1);
      if (amplitude > 0) {
        if (speaking) {
          this.speakingFrames += 1;
        } else {
          this.silentFrames += 1;
        }
      }
    }
  }
}
