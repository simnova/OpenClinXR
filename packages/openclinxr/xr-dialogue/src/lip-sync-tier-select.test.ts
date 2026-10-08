import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { ActorTurnPlan } from "@openclinxr/shared-schemas";
import {
  digestActorTurnPlan,
  playIdentityBoundActorTurn,
  type ActorTurnExecutionArtifacts,
} from "./index.js";
import {
  bakeLiveSttCueTrack,
  buildPhonePlan,
  type SttWord,
} from "./package-actor-turn.js";

/**
 * Two-tier lip sync seam (MADR 0062, card tsk_edba82577ad9cc4a, live tier
 * card tsk_7d54a1bae1509307).
 * A turn carrying a baked track plays that track's cue times verbatim.
 * GREEN: the player accepts baker "mfa-baked" (actor-turn-player.ts) and maps
 * its ARPABET values through the baked intake; the S2 live builder port lives
 * in live-stt-plan.ts (module-internal, no new public export).
 */

const PLAN_ID = "plan_two_tier_baked_001";
const TURN_ID = "turn_two_tier_baked_001";
const ACTOR_ID = "patient_maya_johnson_v1";
const SPOKEN = "The inhaler is in my backpack.";
const AUDIO_URI = "bundle://encounter/turn_two_tier_baked_001.wav";
const AUDIO_DURATION_MS = 1_200;

/** Baked MFA-aligned cue times the exam must reproduce verbatim. */
const BAKED_AT_SECONDS = [0.12, 0.28, 0.45] as const;
const BAKED_PHONEMES = ["PP", "aa", "SS"] as const;

const ADAPTERS = {
  startAudio: () => true,
  startViseme: () => true,
  startGaze: () => true,
  startEmotion: () => true,
};

function samplePlan(): ActorTurnPlan {
  return {
    planId: PLAN_ID,
    planVersion: 1,
    turnId: TURN_ID,
    stationRunId: "run_peds",
    actorId: ACTOR_ID,
    respondingActorId: ACTOR_ID,
    turnIndex: 0,
    spokenText: SPOKEN,
    spokenTextForTts: SPOKEN,
    dialogueEmotionFrom: "neutral",
    dialogueEmotionTo: "neutral",
    somaticEmotion: null,
    eventKind: "learner_clinical_question",
    eventKindSource: "classifier",
    intensityBucket: "mid",
    ageBand: "child",
    performancePlanId: "perf_neutral_child_mid",
    facePresetId: "face.neutral",
    posePresetId: "pose_upright_child",
    gestureClipIds: [],
    prosody: { wrapTags: [], inlineTags: [], speed: 1, droppedTags: [] },
    voiceId: "mock-maya-johnson",
    languageProvenance: { fallbackUsed: false, providerId: "mock-model" },
    claimScope: "simulated_actor_behavior",
    notEvidenceFor: ["clinical_affect_inference", "empathy_score", "licensure"],
  };
}

describe("two-tier lip sync baked seam", () => {
  it("a turn carrying a baked track plays that track's cue times verbatim", () => {
    const plan = samplePlan();
    const id = { actorId: plan.actorId, turnId: plan.turnId, planDigest: digestActorTurnPlan(plan) };
    const artifacts = {
      audio: { ...id, audioUri: AUDIO_URI, durationMs: AUDIO_DURATION_MS },
      visemeCues: {
        ...id,
        baker: "mfa-baked",
        contentHash: "sha256:two-tier-baked-fixture",
        mouthCues: [
          { start: 0.12, end: 0.28, value: "P" },
          { start: 0.28, end: 0.45, value: "AA" },
          { start: 0.45, end: 0.6, value: "S" },
        ],
      },
      gaze: { ...id, gazeTargetKind: "learner_camera", gazeTargetActorId: null },
      emotion: { ...id, from: plan.dialogueEmotionFrom, to: plan.dialogueEmotionTo },
    } as unknown as ActorTurnExecutionArtifacts;
    const result = playIdentityBoundActorTurn(plan, artifacts, { adapters: ADAPTERS });
    expect(result.status).toBe("playing");
    if (result.status === "playing") {
      expect(result.viseme.cues.map((cue) => cue.atSecond)).toEqual([...BAKED_AT_SECONDS]);
      expect(result.viseme.cues.map((cue) => cue.phoneme)).toEqual([...BAKED_PHONEMES]);
    }
  });

  it("a baked track with stress-marked phones plays verbatim", () => {
    const plan = samplePlan();
    const id = { actorId: plan.actorId, turnId: plan.turnId, planDigest: digestActorTurnPlan(plan) };
    const artifacts = {
      audio: { ...id, audioUri: AUDIO_URI, durationMs: AUDIO_DURATION_MS },
      visemeCues: {
        ...id,
        baker: "mfa-baked",
        mouthCues: [
          { start: 0.1, end: 0.2, value: "F" },
          { start: 0.2, end: 0.35, value: "AE1" },
          { start: 0.35, end: 0.45, value: "T" },
        ],
      },
      gaze: { ...id, gazeTargetKind: "learner_camera", gazeTargetActorId: null },
      emotion: { ...id, from: plan.dialogueEmotionFrom, to: plan.dialogueEmotionTo },
    } as unknown as ActorTurnExecutionArtifacts;
    const result = playIdentityBoundActorTurn(plan, artifacts, { adapters: ADAPTERS });
    expect(result.status).toBe("playing");
    if (result.status === "playing") {
      expect(result.viseme.cues.map((cue) => cue.phoneme)).toEqual(["FF", "aa", "DD"]);
      expect(result.viseme.cues.map((cue) => cue.atSecond)).toEqual([0.1, 0.2, 0.35]);
    }
  });

  it("the rhubarb baker still plays its shapes verbatim", () => {
    const plan = samplePlan();
    const id = { actorId: plan.actorId, turnId: plan.turnId, planDigest: digestActorTurnPlan(plan) };
    const artifacts = {
      audio: { ...id, audioUri: AUDIO_URI, durationMs: AUDIO_DURATION_MS },
      visemeCues: {
        ...id,
        baker: "rhubarb",
        mouthCues: [{ start: 0.1, end: 0.3, value: "A" }],
      },
      gaze: { ...id, gazeTargetKind: "learner_camera", gazeTargetActorId: null },
      emotion: { ...id, from: plan.dialogueEmotionFrom, to: plan.dialogueEmotionTo },
    } as unknown as ActorTurnExecutionArtifacts;
    const result = playIdentityBoundActorTurn(plan, artifacts, { adapters: ADAPTERS });
    expect(result.status).toBe("playing");
    if (result.status === "playing") {
      expect(result.viseme.cues.map((cue) => cue.phoneme)).toEqual(["PP"]);
    }
  });
});

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..", "..", "..");
const ARENA = path.join(REPO, "apps", "arena", "viseme-audio-clock", "grok-voice");

/** Strip comments and collapse whitespace so copies compare by code, not layout. */
function normSrc(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//gu, "")
    .replace(/\/\/.*$/gmu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

function expectSnippetInFile(label: string, file: string, snippet: string): void {
  const body = normSrc(readFileSync(file, "utf8"));
  expect(body.includes(normSrc(snippet)), `${label} missing in ${path.basename(file)}`).toBe(true);
}

describe("S2 port provenance (sync with arena 57ca31545 or fail)", () => {
  const measure = path.join(ARENA, "measure.ts");
  const record = path.join(ARENA, "scripts", "record.ts");
  const port = path.join(HERE, "live-stt-plan.ts");
  const player = path.join(HERE, "actor-turn-player.ts");
  const cueTrack = path.join(HERE, "viseme-cue-track.ts");

  it("phone-duration table copy matches the arena source text", () => {
    const snippets = [
      `const DIPHTHONG = new Set(["AY", "EY", "OY", "AW", "OW"]);`,
      `"AA", "AE", "AH", "AO", "AW", "AY", "EH", "ER", "EY", "IH", "IY", "OW", "OY", "UH", "UW", "AX", "IX", "UX", "AXR",`,
      `const FRICATIVE = new Set(["F", "V", "S", "Z", "TH", "DH", "HH"]);`,
      `const NASAL = new Set(["M", "N", "NG"]);`,
      `const LIQUID_GLIDE = new Set(["L", "R", "W", "Y", "EL"]);`,
      `const STOP = new Set(["P", "B", "T", "D", "K", "G"]);`,
      `if (base === "SIL" || base === "SP" || base === "SPN") return 0;
       if (base === "DX" || base === "Q") return 0.5;
       if (STOP.has(base)) return 0.6;
       if (base === "CH" || base === "JH") return 1.0;
       if (base === "SH" || base === "ZH") return 1.0;
       if (FRICATIVE.has(base)) return 0.9;
       if (NASAL.has(base)) return 0.8;
       if (base === "L" || base === "R") return 0.85;
       if (LIQUID_GLIDE.has(base)) return 0.7;`,
      `let w = DIPHTHONG.has(base) ? 1.5 : 1.15;
       if (stress === "1") w *= 1.1;
       else if (stress === "0") w *= 0.8;
       return w;`,
    ];
    for (const snippet of snippets) {
      expectSnippetInFile("phone-duration", measure, snippet);
      expectSnippetInFile("phone-duration", port, snippet);
    }
  });

  it("closure predicate copy matches the arena source text", () => {
    const snippet = `const BILABIAL = new Set(["P", "B", "M"]);`;
    expectSnippetInFile("closure-predicate", measure, snippet);
    expectSnippetInFile("closure-predicate", port, snippet);
    const emission = `for (const c of opts?.closures ?? []) {
      if (c.endS <= c.startS) continue;`;
    expectSnippetInFile("closure-emission", measure, emission);
    expectSnippetInFile("closure-emission", port, emission);
  });

  it("onset-snap copy matches the arena source text", () => {
    const snippets = [
      `export const SNAP_WINDOW_S = 0.15;`,
      `export const SNAP_QUIET_RUN_S = 0.09;`,
      `export const SNAP_ZCR_ON = 0.25;`,
      `export const SNAP_ZCR_FLOOR_DB = -55;`,
      `const FRICATIVE_ONSET = new Set(["F", "V", "S", "Z", "SH", "ZH", "TH", "DH", "HH"]);`,
      `const need = Math.max(1, Math.round(quietRunS / frameS));`,
      `const gapStart = i === 0 ? 0 : (sttWords[i - 1]?.end ?? 0);`,
      `if (d <= windowS + 1e-9 && d < bestDist - 1e-9) {`,
    ];
    for (const snippet of snippets) {
      expectSnippetInFile("onset-snap", measure, snippet);
      expectSnippetInFile("onset-snap", port, snippet);
    }
  });

  it("duration-weighted split copy matches the arena source text", () => {
    const snippet = `const weights =
        opts?.split === "duration" ? phones.map((ph) => Math.max(phoneWeight(ph), 1e-6)) : null;`;
    expectSnippetInFile("duration-split", measure, snippet);
    expectSnippetInFile("duration-split", port, snippet);
  });

  it("audio-anchor derivation matches the record script's arithmetic", () => {
    const snippets = [
      `if (k > i && (prev < 0) !== (v < 0)) cross += 1;`,
      `zcr.push(cross / per);`,
      `let onsetIdx = dbs.findIndex((v) => v >= ANCHOR_THRESHOLD_DB);`,
      `if (onsetIdx < 0) onsetIdx = 0;`,
      `if (dbs[f]! >= ANCHOR_THRESHOLD_DB) lastLoud = f;`,
      `const tQuiet = lastLoud < 0 ? gapStart : Math.min(Math.max((lastLoud + 1)`,
    ];
    for (const snippet of snippets) {
      expectSnippetInFile("audio-anchor", record, snippet);
      expectSnippetInFile("audio-anchor", port, snippet);
    }
    // Frame constant adapted: record.ts frames a fixed 16 kHz decode
    // (FRAME_S = 0.01); the port frames caller-supplied samples at any rate
    // (frameS = round(sr * 0.01) / sr, identical at 16 kHz).
    expectSnippetInFile("audio-anchor", record, `* FRAME_S, gapStart), gapEnd);`);
    expectSnippetInFile("audio-anchor", port, `* frameS, gapStart), gapEnd);`);
  });

  it("player baked intake matches the cue-track ARPABET table", () => {
    const rows = [
      `P: "PP", B: "PP", M: "PP",`,
      `F: "FF", V: "FF",`,
      `TH: "TH", DH: "TH",`,
      `T: "DD", D: "DD",`,
      `K: "kk", G: "kk", NG: "kk",`,
      `CH: "CH", JH: "CH", SH: "CH", ZH: "CH",`,
      `S: "SS", Z: "SS",`,
      `N: "nn", L: "nn",`,
      `R: "RR", ER: "RR",`,
      `EH: "E", EY: "E",`,
      `IH: "I", IY: "I", Y: "I",`,
      `AO: "O", OW: "O", OY: "O",`,
      `UH: "U", UW: "U", W: "U",`,
    ];
    for (const row of rows) {
      expectSnippetInFile("arpabet-row", cueTrack, row);
      expectSnippetInFile("arpabet-row", player, row);
    }
  });
});

const CACHE_DIR = path.join(homedir(), ".openclinxr-cache", "grok-voice");
const HALF_FRAME_S = 0.5 / 30;

type ClipFixture = {
  clip: string;
  text: string;
  audioSha256: string;
  mp3Path: string;
  sttWords: SttWord[];
};

function loadClipFixtures(): { clips: ClipFixture[]; skippedReason: string | null } {
  if (!existsSync(CACHE_DIR)) {
    return { clips: [], skippedReason: `cache dir absent: ${CACHE_DIR}` };
  }
  const manifestPath = path.join(ARENA, "cache-manifest.json");
  const anchorsPath = path.join(ARENA, "audio-anchors.json");
  const phonesPath = path.join(ARENA, "phone-plans.json");
  if (!existsSync(manifestPath) || !existsSync(anchorsPath) || !existsSync(phonesPath)) {
    return { clips: [], skippedReason: "arena committed fixtures absent" };
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Array<{
    kind?: string; clip?: string; key?: string; text?: string; audioSha256?: string;
  }>;
  const anchors = JSON.parse(readFileSync(anchorsPath, "utf8")) as Record<string, unknown>;
  const sttByText = new Map<string, SttWord[]>();
  for (const file of readdirSync(CACHE_DIR)) {
    if (!file.endsWith(".json")) continue;
    try {
      const parsed = JSON.parse(readFileSync(path.join(CACHE_DIR, file), "utf8")) as {
        words?: Array<{ word?: string; start?: number; end?: number }>;
        text?: string;
      };
      if (parsed && Array.isArray(parsed.words) && typeof parsed.text === "string") {
        sttByText.set(
          parsed.text,
          parsed.words.map((w) => ({ word: String(w.word ?? ""), start: Number(w.start), end: Number(w.end) })),
        );
      }
    } catch {
      // Unparseable cache sidecar: no words to record, keep scanning.
    }
  }
  const clips: ClipFixture[] = [];
  for (const entry of manifest) {
    if (entry.kind !== "tts" || !entry.clip || !entry.key || !entry.text || !entry.audioSha256) continue;
    if (!(entry.clip in anchors)) continue;
    const mp3Path = path.join(CACHE_DIR, `${entry.key}.mp3`);
    if (!existsSync(mp3Path)) continue;
    const sttEntry = manifest.find(
      (m) => m.kind === "stt" && m.audioSha256 === entry.audioSha256 && typeof m.text === "string",
    );
    const sttWords = (sttEntry?.text !== undefined ? sttByText.get(sttEntry.text) : undefined)
      ?? sttByText.get(entry.text);
    if (!sttWords || sttWords.length === 0) continue;
    clips.push({ clip: entry.clip, text: entry.text, audioSha256: entry.audioSha256, mp3Path, sttWords });
  }
  if (clips.length === 0) return { clips, skippedReason: "no cached clips decoded" };
  return { clips, skippedReason: null };
}

function decodeMp3Mono16k(mp3Path: string): Float32Array {
  const raw: Buffer = execFileSync(
    "ffmpeg",
    ["-v", "error", "-i", mp3Path, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", "-f", "s16le", "-"],
    { encoding: "buffer", maxBuffer: 64 * 1024 * 1024 },
  );
  const bytes = Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength);
  const n = Math.floor(bytes.length / 2);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i += 1) out[i] = bytes.readInt16LE(i * 2) / 32768;
  return out;
}

describe("S2 parity counterweight (cached Grok voice fixtures, no network)", () => {
  const { clips, skippedReason } = loadClipFixtures();
  const phonesAll = JSON.parse(
    readFileSync(path.join(ARENA, "phone-plans.json"), "utf8"),
  ) as Record<string, { phones: string[] }>;
  const pronMap: Record<string, string[]> = Object.fromEntries(
    Object.entries(phonesAll).map(([k, v]) => [k, v.phones]),
  );
  const anchorsAll = JSON.parse(
    readFileSync(path.join(ARENA, "audio-anchors.json"), "utf8"),
  ) as Record<
    string,
    { closures: Array<{ wordIndex: number; phone: "P"; startS: number; endS: number }>; firstWordStartS: number; snappedStarts: number[]; energyOnsetS: number }
  >;

  if (skippedReason !== null || clips.length === 0) {
    it(`SKIPPED parity: ${skippedReason ?? "no cached clips"} (clean-clone CI stays green)`, () => {
      expect(skippedReason ?? "no cached clips").toBeTruthy();
    });
    return;
  }

  it(`derives committed anchors from cached audio (${clips.length} clips)`, () => {
    expect(clips.length).toBeGreaterThan(0);
    for (const { clip, text, sttWords, mp3Path } of clips) {
      const committed = anchorsAll[clip]!;
      const { anchors } = bakeLiveSttCueTrack({
        samples: decodeMp3Mono16k(mp3Path),
        sampleRate: 16000,
        sttWords,
        transcript: text,
        pronunciations: pronMap,
      });
      expect(anchors.thresholdDb).toBe(-40);
      expect(anchors.energyOnsetS).toBe(committed.energyOnsetS);
      expect(anchors.firstWordStartS).toBeCloseTo(committed.firstWordStartS, 3);
      expect(anchors.snappedStarts).toHaveLength(committed.snappedStarts.length);
      anchors.snappedStarts.forEach((s, i) => {
        expect(s, `${clip} word ${i}`).toBeCloseTo(committed.snappedStarts[i]!, 3);
      });
      expect(anchors.closures).toEqual(committed.closures);
    }
  });

  it("per-phone onsets match the committed phone-plan build within 0.5 frame", () => {
    for (const { clip, text, sttWords, mp3Path } of clips) {
      const committed = anchorsAll[clip]!;
      const refWords = text.split(/\s+/).filter(Boolean);
      // Both sides use the same audio-aware gap fill (the bake passes its
      // samples through; the committed-anchors build passes the same decode
      // here), so this still verifies bake == plan build, not the fill.
      const decoded = decodeMp3Mono16k(mp3Path);
      const expected = buildPhonePlan(refWords, sttWords, pronMap, {
        closures: committed.closures,
        firstWordStartS: committed.firstWordStartS,
        wordStarts: committed.snappedStarts,
        split: "duration",
        audio: { samples: decoded, sampleRate: 16000 },
      });
      expect(expected.mismatches, `${clip} mismatches`).toEqual([]);
      expect(expected.oovWords, `${clip} oov`).toEqual([]);
      const actual = bakeLiveSttCueTrack({
        samples: decoded,
        sampleRate: 16000,
        sttWords,
        transcript: text,
        pronunciations: pronMap,
      });
      expect(actual.mismatches, `${clip} live mismatches`).toEqual([]);
      expect(actual.cues).toHaveLength(expected.plan.length);
      actual.cues.forEach((cue, i) => {
        const want = expected.plan[i]!;
        expect(cue.phone, `${clip} phone ${i}`).toBe(want.phone);
        expect(Math.abs(cue.startS - want.startS), `${clip} onset ${i}`).toBeLessThanOrEqual(HALF_FRAME_S);
        expect(Math.abs(cue.endS - want.endS), `${clip} end ${i}`).toBeLessThanOrEqual(HALF_FRAME_S);
      });
    }
  });
});
