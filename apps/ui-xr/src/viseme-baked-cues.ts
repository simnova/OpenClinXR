/**
 * Baked lip-sync cue loading and the #722 runtime join (#722).
 *
 * The bake half (issue-288 / multi-case-runner.ts:876) names every cue file
 * `utterance-${sha1(bare text).slice(0, 10)}.mouth-cues.json` under
 * `.openclinxr/evidence/issue-288/cases/<scenario>/stage-lip-sync/` — a gitignored path a
 * runtime cannot depend on. The promoted, served copies live at
 * `apps/ui-xr/public/lip-sync-cues/<scenarioId>/utterance-<id>.mouth-cues.json` (tracked, served
 * at the app root). `loadBakedMouthCuesForUtterance` reads them by content-hash of the spoken
 * line (actor-name prefix stripped — the runtime speaks "Samuel Brooks: My right arm feels…",
 * the bake hashed the bare text); `attachBakedCuesToSpeech` is the join main.ts calls once per
 * dialogue. The load is memoised per (scenario, utterance id) and warmed at boot so the attach
 * on the actual dialogue is a cache hit instead of a fetch queued behind the actor GLBs.
 *
 * claimScope: served-cue loading + attach only. notEvidenceFor: cue timing vs audio (Rhubarb
 * owns), mouth appearance, utterance-to-dialogue-turn identity beyond the content-hash match
 * this module defines, anatomy/bind-pose.
 */

import type { PhonemeCue } from "./viseme-timeline-drive.js";
import { utteranceIdForText } from "./viseme-utterance-hash.js";

/**
 * Rhubarb lip-sync shapes (#722) → runtime phoneme tokens the driver resolves to shipped
 * morph targets. Rhubarb's own shape definitions (from its docs): A = "aa" (trap), B = "e"
 * (dress), C = "i" (fleece), D = "o" (thought), E = "u" (goose), F = "f/v", G = "r", H =
 * "w/aw", X = silence. Tokens are chosen so `resolveVisemeTarget` lands on the viseme_* names
 * the shipped cast GLBs carry (viseme_AA, viseme_E, viseme_IH, viseme_OH, viseme_OU,
 * viseme_FV, viseme_L, viseme_TH, viseme_silence — face-morph-census, 2026-08-13).
 */
const RHUBARB_SHAPE_TO_TOKEN: Readonly<Record<string, string>> = {
  A: "AA",
  B: "E",
  C: "IH",
  D: "OH",
  E: "OU",
  F: "FV",
  G: "L",
  H: "OU",
  X: "sil",
};

export type MouthCuesDocument = {
  metadata?: { duration?: number } | null;
  mouthCues?: ReadonlyArray<{ start: number; end: number; value: string }>;
};

/**
 * Baked Rhubarb cues → driver cues. Real `start`/`end` timing is preserved as
 * `atSecond` + `durationSeconds`, so the wire plays the bake's timeline instead of the
 * text-derived dwell model (#722 — the whole point of loading the cues).
 */
export function mouthCuesToPhonemeCues(doc: MouthCuesDocument): PhonemeCue[] {
  const cues = doc?.mouthCues ?? [];
  const out: PhonemeCue[] = [];
  for (const cue of cues) {
    const start = Number(cue?.start);
    const end = Number(cue?.end);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    out.push({
      phoneme: RHUBARB_SHAPE_TO_TOKEN[String(cue?.value ?? "").toUpperCase()] ?? "sil",
      atSecond: Math.max(0, Number(start.toFixed(4))),
      durationSeconds: Math.max(0, Number((end - start).toFixed(4))),
    });
  }
  return out;
}

/** Total wall-clock length of a baked cue timeline, in ms (same dwell semantics as frameDurationSeconds). */
export function bakedCuesDurationMs(cues: readonly PhonemeCue[]): number {
  let totalSeconds = 0;
  for (let i = 0; i < cues.length; i += 1) {
    const cue = cues[i]!;
    const explicit = cue.durationSeconds;
    if (typeof explicit === "number" && Number.isFinite(explicit) && explicit >= 0) {
      totalSeconds += explicit;
    } else {
      const next = cues[i + 1];
      const prev = cues[i - 1];
      if (next) totalSeconds += Math.max(0, next.atSecond - cue.atSecond);
      else if (prev) totalSeconds += Math.max(0, cue.atSecond - prev.atSecond);
      else totalSeconds += 0.12;
    }
  }
  return Math.max(1, Math.round(totalSeconds * 1000));
}

export type BakedMouthCuesLoad = {
  utteranceId: string;
  cues: PhonemeCue[];
};

/**
 * Per-utterance memo of the served cue load, keyed by scenario + utterance id. The attach in
 * main.ts runs when a dialogue fires; the fetch itself can queue behind the actor GLBs on a
 * cold boot and resolve after the speech window ended. A boot-time warm-up (main.ts prefetch)
 * resolves this map once, so the attach on the actual dialogue is a cache hit and the baked
 * timeline is in place from the first frame of speech (#722).
 */
const bakedCueCache = new Map<string, Promise<BakedMouthCuesLoad | null>>();

/**
 * Load the baked cue file for a spoken line, when one exists. The promoted files live under
 * `apps/ui-xr/public/lip-sync-cues/<scenarioId>/utterance-<sha1(bare text) 10>.mouth-cues.json`
 * (served at the app root); a spoken line whose text hashes to no baked file resolves to null
 * and the caller keeps the text-derived timeline. Never regenerates cues — it reads the bake.
 */
export function loadBakedMouthCuesForUtterance(
  scenarioId: string,
  text: string,
  baseUrl: string = "",
): Promise<BakedMouthCuesLoad | null> {
  const key = `${scenarioId}/${utteranceIdForText(text)}`;
  const cached = bakedCueCache.get(key);
  if (cached) return cached;
  const promise = loadBakedMouthCuesForUtteranceUncached(scenarioId, text, baseUrl);
  bakedCueCache.set(key, promise);
  return promise;
}

async function loadBakedMouthCuesForUtteranceUncached(
  scenarioId: string,
  text: string,
  baseUrl: string,
): Promise<BakedMouthCuesLoad | null> {
  try {
    const utteranceId = utteranceIdForText(text);
    const root = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
    const url = `${root}lip-sync-cues/${scenarioId}/utterance-${utteranceId}.mouth-cues.json`;
    let response: Response;
    try {
      response = await fetch(url);
    } catch {
      return null;
    }
    if (!response.ok) return null;
    const doc = (await response.json()) as MouthCuesDocument;
    const cues = mouthCuesToPhonemeCues(doc);
    if (cues.length === 0) return null;
    return { utteranceId, cues };
  } catch {
    // A malformed served cue file must not take the speech path down — absent cues keep the
    // text-derived timeline (the join is an enhancement, not a dependency).
    return null;
  }
}

type BakedSpeechSlotRoot = {
  traverse: (callback: (object: unknown) => void) => void;
  userData?: Record<string, unknown>;
};

export type BakedSpeechSlotLike = {
  root: BakedSpeechSlotRoot;
  activeSpeech?:
    | {
        text?: string;
        bakedCues?: readonly PhonemeCue[];
        durationMs?: number;
        startedAtMs?: number;
      }
    | undefined;
};

/**
 * #722 — the join, as a call main.ts makes once per dialogue: load the served cue file for the
 * spoken line and attach it to the active speech so the wire drives the bake's real timing. A
 * line with no baked file resolves to null and the text-derived timeline stays. The marker on
 * the root is the runtime's own evidence that the join ran (the evidence harness waits on it).
 */
export function attachBakedCuesToSpeech(
  slot: BakedSpeechSlotLike,
  text: string,
  scenarioId: string,
): void {
  void loadBakedMouthCuesForUtterance(scenarioId, text).then((loaded) => {
    if (!loaded) return;
    const current = slot.activeSpeech;
    if (!current || current.text !== text) return;
    current.bakedCues = loaded.cues;
    current.durationMs = bakedCuesDurationMs(loaded.cues);
    const rootUserData = slot.root.userData ?? {};
    slot.root.userData = rootUserData;
    rootUserData.openClinXrBakedVisemeTimeline = {
      scenarioId,
      utteranceId: loaded.utteranceId,
      cueCount: loaded.cues.length,
      durationMs: current.durationMs,
      speechStartedAtMs: current.startedAtMs,
      attachedAtMs: performance.now(),
    };
  });
}
