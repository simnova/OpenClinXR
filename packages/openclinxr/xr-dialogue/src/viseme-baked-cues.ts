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
 * morph targets. Meanings quoted from the Rhubarb README (~/.openclinxr-tools/rhubarb/
 * README.adoc, "Mouth shapes"): A = "Closed mouth for the P, B, and M sounds"; B =
 * "Slightly open mouth with clenched teeth ... K, S, T ... EE sound in bee"; C = "Open
 * mouth ... EH as in men and AE as in bat"; D = "Wide open mouth ... AA as in father";
 * E = "Slightly rounded mouth ... AO as in off and ER as in bird"; F = "Puckered lips ...
 * UW as in you, OW as in show, W as in way"; G = "Upper teeth touching the lower lip for
 * F ... and V"; H = "long L sounds, with the tongue raised behind the upper teeth"; X =
 * "Idle position ... lips should be closed but relaxed".
 *
 * Each token reaches, per body rail: MPFB visemes02 nurse (viseme_PP viseme_SS viseme_E
 * viseme_aa viseme_O viseme_U viseme_FF viseme_nn viseme_sil); Anny cast (viseme_silence
 * viseme_IH viseme_E viseme_AA viseme_OH viseme_OU viseme_FV viseme_L viseme_silence, via
 * the CAST_VISEME_FALLBACK_NAMES pass); FACS-only MPFB (mouth-compression mouth-part-later
 * mouth-retraction mouth-open mouth-eversion mouth-protusion mouth-elevation mouth-parling).
 *
 * The previous table (A->AA ... H->OU, "A = aa (trap)" etc.) misread Rhubarb's shapes and
 * opened the mouth wide on bilabial closures. B->SS rather than kk: the README says
 * "clenched teeth"; visemes02 SS is the teeth-together sibilant, kk is teeth apart.
 */
const RHUBARB_SHAPE_TO_TOKEN: Readonly<Record<string, string>> = {
  A: "PP",
  B: "SS",
  C: "E",
  D: "AA",
  E: "OH",
  F: "OU",
  G: "FV",
  H: "L",
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
  /** Present source-media reader marks audio-owned speech; delayed served bakes must not attach. */
  mediaPositionSeconds?: () => number | null | undefined;
};

/**
 * #722 — the join, as a call main.ts makes once per dialogue: load the served cue file for the
 * spoken line and attach it to the active speech so the wire drives the bake's real timing. A
 * line with no baked file resolves to null and the text-derived timeline stays. The marker on
 * the root is the runtime's own evidence that the join ran (the evidence harness waits on it).
 * When audioEvents are passed (station synthesize path), real synthesize cues attach
 * synchronously first (true); otherwise the served-bake load proceeds (false).
 */
export function attachBakedCuesToSpeech(
  slot: BakedSpeechSlotLike,
  text: string,
  scenarioId: string,
  // Station synthesize path: real audioEvents attach synchronously (true);
  // otherwise the served-bake load proceeds (false). Module-local fold — not public surface.
  audioEvents?: unknown,
): boolean {
  if (audioEvents !== undefined && attachSynthesizeAudioEventsToSpeech(slot, audioEvents)) return true;
  const requested = slot.activeSpeech;
  void loadBakedMouthCuesForUtterance(scenarioId, text).then((loaded) => {
    if (!loaded) return;
    if (slot.activeSpeech !== requested) return;
    if (!requested || requested.text !== text) return;
    if (typeof slot.mediaPositionSeconds === "function") return;
    requested.bakedCues = loaded.cues;
    requested.durationMs = bakedCuesDurationMs(loaded.cues);
    const rootUserData = slot.root.userData ?? {};
    slot.root.userData = rootUserData;
    rootUserData.openClinXrBakedVisemeTimeline = {
      scenarioId,
      utteranceId: loaded.utteranceId,
      cueCount: loaded.cues.length,
      durationMs: requested.durationMs,
      speechStartedAtMs: requested.startedAtMs,
      attachedAtMs: performance.now(),
    };
  });
  return false;
}

/**
 * Real synthesize viseme tokens the mouth wire resolves (README map values +
 * dialogue ARKit passthroughs). The mock "neutral-pain" fixture cue is absent
 * by design — it must never drive the mouth.
 */
const REAL_SYNTHESIZE_VISEME_TOKENS: ReadonlySet<string> = new Set([
  "AA",
  "E",
  "IH",
  "OH",
  "OU",
  "FV",
  "L",
  "TH",
  "PP",
  "SS",
  "sil",
  "silence",
]);

const MOCK_SYNTHESIZE_VISEME_CUE = "neutral-pain";

/**
 * synthesizeActorSpeech audioEvents → driver cues with the events' own timing.
 * Starts stack cumulatively (the voice result carries per-chunk duration only).
 * Returns null when no real cue survives (mock cue, unknown token, bad duration).
 * Never touches ActorTurnExecution — DVA-6 schema stays gap-reported.
 */
function mouthCuesFromSynthesizeAudioEvents(events: unknown): PhonemeCue[] | null {
  if (!Array.isArray(events) || events.length === 0) return null;
  const cues: PhonemeCue[] = [];
  let atSecond = 0;
  for (const event of events) {
    if (event === null || typeof event !== "object") continue;
    const record = event as Record<string, unknown>;
    const cue = typeof record["visemeCue"] === "string" ? (record["visemeCue"] as string) : "";
    if (cue.length === 0 || cue === MOCK_SYNTHESIZE_VISEME_CUE) continue;
    if (!REAL_SYNTHESIZE_VISEME_TOKENS.has(cue)) continue;
    const durationMs = Number(record["durationMs"]);
    if (!Number.isFinite(durationMs) || durationMs <= 0) continue;
    const durationSeconds = Number((durationMs / 1000).toFixed(4));
    cues.push({ phoneme: cue, atSecond: Number(atSecond.toFixed(4)), durationSeconds });
    atSecond += durationSeconds;
  }
  return cues.length > 0 ? cues : null;
}

/**
 * Attach synthesize audioEvents to a live slot's activeSpeech as bakedCues so
 * the existing wire drives the mouth from real cue timing. No-op (false) when
 * the slot has no activeSpeech or no real cue survives. Writes only the speech
 * slot + a root marker — never visemeTimeline / audioUri on the execution.
 */
function attachSynthesizeAudioEventsToSpeech(slot: unknown, events: unknown): boolean {
  const cues = mouthCuesFromSynthesizeAudioEvents(events);
  if (!cues) return false;
  if (slot === null || typeof slot !== "object") return false;
  const slotRecord = slot as Record<string, unknown>;
  const active = slotRecord["activeSpeech"];
  if (active === null || typeof active !== "object") return false;
  const speech = active as Record<string, unknown>;
  speech["bakedCues"] = cues;
  const totalMs = cues.reduce(
    (sum, cue) => sum + (typeof cue.durationSeconds === "number" ? cue.durationSeconds : 0),
    0,
  ) * 1000;
  speech["durationMs"] = Math.max(1, Math.round(totalMs));
  const root = slotRecord["root"];
  if (root !== null && typeof root === "object") {
    const rootRecord = root as Record<string, unknown>;
    const userData = rootRecord["userData"];
    if (userData !== null && typeof userData === "object") {
      (userData as Record<string, unknown>)["openClinXrSynthesizeVisemeTimeline"] = {
        cueCount: cues.length,
        durationMs: speech["durationMs"],
      };
    }
  }
  return true;
}
