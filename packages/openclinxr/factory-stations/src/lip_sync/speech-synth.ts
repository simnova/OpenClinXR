/**
 * Build-time speech source for the lip_sync station (lipsync-speech slice).
 *
 * Production lip_sync (run.ts) takes a wavPath and never synthesises speech.
 * The dark-factory chain had no wav producer, so all 15 cases failed with
 * "lip_sync needs wavPath". This module is that producer: deterministic,
 * offline, build-time TTS via Kokoro-82M (Apache-2.0 code + weights; see the
 * third-party licence ledger 2026-10-04 section). No LLM, no cloud voice,
 * nothing at exam time — WAVs are baked once and cached by content hash.
 *
 * Voice mapping rule (deterministic from case data, recorded here):
 *  1. child indicators (phenotype gender_presentation "child", or child
 *     name tokens maya/noah, or kid/child/toddler/peds words) -> af_heart.
 *     Kokoro ships no child voice; the female voice sits closer to a child's
 *     pitch range than the male voice.
 *  2. female indicators (phenotype "female", or female name tokens) -> af_heart.
 *  3. male indicators (phenotype "male", or male name tokens) -> am_adam.
 *  4. ambiguous/unknown (e.g. patient_jordan_reed_v1) -> af_heart (default).
 * Matching is on whole words of "displayName + actorId + genderPresentation",
 * lowercased, so "female" never misfires on the "male" substring.
 */

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const SPEECH_SYNTH_TOOL = "kokoro";
export const SPEECH_SYNTH_TOOL_VERSION = "kokoro pip 0.9.4";
export const SPEECH_SYNTH_MODEL_REVISION =
  "hexgrad/Kokoro-82M v1.0 kokoro-v1_0.pth sha256:496dba118d1a58f5f3db2efc88dbdc216e0483fc89fe6e47ee1f2c53f18ad1e4";
export const SPEECH_SYNTH_SAMPLE_RATE_HZ = 24000;
export const SPEECH_SYNTH_SEED = 0;
export const SPEECH_SYNTH_FEMALE_VOICE = "af_heart";
export const SPEECH_SYNTH_MALE_VOICE = "am_adam";
export const SPEECH_SYNTH_VOICE_IDS = [SPEECH_SYNTH_FEMALE_VOICE, SPEECH_SYNTH_MALE_VOICE] as const;
export const SPEECH_SYNTH_PHONEMIZER = "espeak-ng 1.52.0 (GPL-3.0, build-time only, not shipped)";

export type SpeechActorInfo = {
  role: string;
  genderPresentation?: string | undefined;
  displayName?: string | undefined;
  actorId?: string | undefined;
};

const CHILD_TOKENS = new Set([
  "child",
  "kid",
  "toddler",
  "infant",
  "baby",
  "peds",
  "pediatric",
  "paediatric",
  "school",
  "maya",
  "noah",
]);

const FEMALE_TOKENS = new Set([
  "female",
  "girl",
  "woman",
  "women",
  "mother",
  "mom",
  "sister",
  "daughter",
  "wife",
  "anna",
  "elena",
  "lucia",
  "helen",
  "aisha",
  "tara",
  "mei",
  "priya",
  "rachel",
  "maria",
  "margaret",
  "lena",
]);

const MALE_TOKENS = new Set([
  "male",
  "boy",
  "man",
  "men",
  "father",
  "dad",
  "son",
  "brother",
  "husband",
  "mr",
  "robert",
  "samuel",
  "eric",
  "david",
  "diego",
  "kevin",
  "mario",
  "omar",
  "luis",
  "carlos",
]);

function actorWords(actor: SpeechActorInfo): Set<string> {
  return new Set(
    `${actor.genderPresentation ?? ""} ${actor.displayName ?? ""} ${actor.actorId ?? ""}`
      .toLowerCase()
      .split(/[^a-z]+/)
      .filter((word) => word.length > 0),
  );
}

/** Deterministic voice for an actor; see the mapping rule in the header. */
export function voiceIdForActor(actor: SpeechActorInfo): string {
  const words = actorWords(actor);
  for (const token of CHILD_TOKENS) {
    if (words.has(token)) return SPEECH_SYNTH_FEMALE_VOICE;
  }
  for (const token of FEMALE_TOKENS) {
    if (words.has(token)) return SPEECH_SYNTH_FEMALE_VOICE;
  }
  for (const token of MALE_TOKENS) {
    if (words.has(token)) return SPEECH_SYNTH_MALE_VOICE;
  }
  return SPEECH_SYNTH_FEMALE_VOICE;
}

export type SpeechCacheKeyInput = {
  text: string;
  voiceId: string;
  modelRevision?: string;
};

/** Content key: sha256 of model revision + voice + text. First write wins. */
export function speechCacheKey(input: SpeechCacheKeyInput): string {
  const revision = input.modelRevision ?? SPEECH_SYNTH_MODEL_REVISION;
  return createHash("sha256").update(`${revision}\0${input.voiceId}\0${input.text}`, "utf8").digest("hex");
}

function resolveKokoroPython(): string {
  const override = process.env["OPENCLINXR_KOKORO_PYTHON"];
  if (override && override.trim().length > 0) return override;
  const home = process.env["HOME"] ?? "/Users/patrick";
  return path.join(home, ".openclinxr-tools", "kokoro", "venv", "bin", "python");
}

function resolveSynthHelper(): string {
  // Embedded below as KOKORO_SYNTH_PY; written to tmp at synth time so the
  // helper always ships with the module (dist never copies sibling .py files).
  return path.join(tmpdir(), `lip-sync-kokoro-synth-${process.pid}.py`);
}

/**
 * Kokoro synthesis helper (runs under ~/.openclinxr-tools/kokoro/venv).
 * Seeded (torch + numpy + random) for byte-deterministic WAV output.
 */
const KOKORO_SYNTH_PY = `from __future__ import annotations

import argparse
import json
import random
import sys

import numpy as np
import soundfile as sf
import torch


def main() -> int:
    parser = argparse.ArgumentParser(description="Synthesize one line with Kokoro-82M")
    parser.add_argument("--text", required=True)
    parser.add_argument("--voice", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--lang", default="a")
    args = parser.parse_args()

    random.seed(args.seed)
    np.random.seed(args.seed)
    torch.manual_seed(args.seed)

    from kokoro import KPipeline

    pipeline = KPipeline(lang_code=args.lang)
    chunks = []
    for _gs, _ps, audio in pipeline(args.text, voice=args.voice):
        chunks.append(audio)
    if not chunks:
        print(json.dumps({"ok": False, "error": "no audio chunks"}))
        return 1
    import numpy
    wave = numpy.concatenate(chunks, axis=0)
    sf.write(args.out, wave, 24000, subtype="PCM_16")
    print(json.dumps({"ok": True, "sampleRateHz": 24000, "frames": int(wave.shape[0])}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
`;

function resolveWavCacheDir(): string {
  const override = process.env["OPENCLINXR_SPEECH_WAV_CACHE"];
  if (override && override.trim().length > 0) return override;
  const home = process.env["HOME"] ?? "/Users/patrick";
  return path.join(home, ".openclinxr-tools", "kokoro", "wav-cache");
}

export type SpeechProvenance = {
  tool: string;
  toolVersion: string;
  voice: string;
  voiceLicence: string;
  modelRevision: string;
  phonemizer: string;
  seed: number;
  sampleRateHz: number;
  caseId: string;
  actorId: string;
  text: string;
  cacheKey: string;
  wavSha256: string;
  generatedAt: string;
};

export type SynthesizeSpeechOptions = {
  caseId: string;
  actorId: string;
  text: string;
  voiceId: string;
  cacheDir?: string;
};

export type SynthesizeSpeechResult = {
  wavPath: string;
  provenancePath: string;
  provenance: SpeechProvenance;
  cacheHit: boolean;
};

function sha256File(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Synthesize one scripted line to a cached WAV (+ provenance JSON sidecar).
 * Throws naming the speech-synth step when synthesis fails.
 */
export async function synthesizeSpeechWav(options: SynthesizeSpeechOptions): Promise<SynthesizeSpeechResult> {
  const { caseId, actorId, text, voiceId } = options;
  if (!text || text.trim().length === 0) {
    throw new Error("lip_sync build-time speech-synth (kokoro) failed: text is empty");
  }
  if (!SPEECH_SYNTH_VOICE_IDS.includes(voiceId as (typeof SPEECH_SYNTH_VOICE_IDS)[number])) {
    throw new Error(
      `lip_sync build-time speech-synth (kokoro) failed: unknown voiceId ${JSON.stringify(voiceId)}`,
    );
  }
  const cacheDir = options.cacheDir ?? resolveWavCacheDir();
  await mkdir(cacheDir, { recursive: true });
  const key = speechCacheKey({ text, voiceId });
  const wavPath = path.join(cacheDir, `${key}.wav`);
  const provenancePath = path.join(cacheDir, `${key}.provenance.json`);

  try {
    const [cachedWav, cachedProvenance] = await Promise.all([
      readFile(wavPath),
      readFile(provenancePath, "utf8"),
    ]);
    const provenance = JSON.parse(cachedProvenance) as SpeechProvenance;
    if (provenance.wavSha256 === sha256File(cachedWav) && provenance.cacheKey === key) {
      return { wavPath, provenancePath, provenance, cacheHit: true };
    }
  } catch {
    // Cache miss or corrupt entry: synthesise below.
  }

  const python = resolveKokoroPython();
  const helper = resolveSynthHelper();
  const tmp = await mkdirTmp();
  await writeFile(helper, KOKORO_SYNTH_PY, "utf8");
  const staging = path.join(tmp, `${key}.wav`);
  try {
    await execFileAsync(python, [helper, "--text", text, "--voice", voiceId, "--out", staging, "--seed", "0"], {
      env: {
        ...process.env,
        HF_HOME: process.env["HF_HOME"] ?? path.join(process.env["HOME"] ?? "/Users/patrick", ".openclinxr-tools", "kokoro", "hf-cache"),
      },
      timeout: 600000,
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message.split("\n").slice(0, 4).join(" ") : String(err);
    throw new Error(`lip_sync build-time speech-synth (kokoro) failed for ${caseId}/${actorId}: ${detail}`);
  }
  const wavBytes = await readFile(staging);
  await rename(staging, wavPath);
  const provenance: SpeechProvenance = {
    tool: SPEECH_SYNTH_TOOL,
    toolVersion: SPEECH_SYNTH_TOOL_VERSION,
    voice: voiceId,
    voiceLicence: "Apache-2.0 (Kokoro-82M checkpoint voice tensor, no separate grant)",
    modelRevision: SPEECH_SYNTH_MODEL_REVISION,
    phonemizer: SPEECH_SYNTH_PHONEMIZER,
    seed: SPEECH_SYNTH_SEED,
    sampleRateHz: SPEECH_SYNTH_SAMPLE_RATE_HZ,
    caseId,
    actorId,
    text,
    cacheKey: key,
    wavSha256: sha256File(wavBytes),
    generatedAt: new Date().toISOString(),
  };
  await writeFile(provenancePath, `${JSON.stringify(provenance, null, 2)}\n`, "utf8");
  return { wavPath, provenancePath, provenance, cacheHit: false };
}

async function mkdirTmp(): Promise<string> {
  const dir = path.join(tmpdir(), `lip-sync-speech-synth-${process.pid}`);
  await mkdir(dir, { recursive: true });
  return dir;
}
