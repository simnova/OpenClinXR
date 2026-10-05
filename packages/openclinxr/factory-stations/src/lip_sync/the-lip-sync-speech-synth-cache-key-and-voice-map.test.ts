import { createHash } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  SPEECH_SYNTH_FEMALE_VOICE,
  SPEECH_SYNTH_MALE_VOICE,
  SPEECH_SYNTH_MODEL_REVISION,
  speechCacheKey,
  synthesizeSpeechWav,
  voiceIdForActor,
} from "../index.js";

/**
 * OBSERVABLE: the dark-factory lip_sync stage fails on all 15 cases with
 * "lip_sync needs wavPath" because no build-time speech source exists.
 *
 * speech-synth.ts is that source: speechCacheKey versions WAVs by
 * (model revision, voice, text); voiceIdForActor maps case actor data to a
 * Kokoro voice; synthesizeSpeechWav caches {wav, provenance.json} by key.
 * No TTS install is needed for any assertion below (cache-hit path only).
 */

describe("the lip_sync speech-synth cache key and voice map", () => {
  it("(0) cache key is a stable sha256 of revision, voice, and text", () => {
    const input = { text: "My chest feels tight and it is hard to breathe.", voiceId: "af_heart" };
    const first = speechCacheKey(input);
    const second = speechCacheKey(input);
    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    const expected = createHash("sha256")
      .update(`${SPEECH_SYNTH_MODEL_REVISION}\0af_heart\0${input.text}`, "utf8")
      .digest("hex");
    expect(first).toBe(expected);
  });

  it("(1) key changes when voice, text, or model revision changes", () => {
    const base = speechCacheKey({ text: "hello", voiceId: "af_heart" });
    expect(speechCacheKey({ text: "hello!", voiceId: "af_heart" })).not.toBe(base);
    expect(speechCacheKey({ text: "hello", voiceId: "am_adam" })).not.toBe(base);
    expect(speechCacheKey({ text: "hello", voiceId: "af_heart", modelRevision: "next" })).not.toBe(base);
  });

  it("(2) voice map covers the 15 case speakers deterministically", () => {
    const cases: Array<[string, string, string, string]> = [
      ["patient", "Elena Vasquez", "patient_elena_vasquez_v1", SPEECH_SYNTH_FEMALE_VOICE],
      ["patient", "Lucia Morales", "patient_lucia_morales_v1", SPEECH_SYNTH_FEMALE_VOICE],
      ["patient", "Robert Hayes", "patient_robert_hayes_v1", SPEECH_SYNTH_MALE_VOICE],
      ["patient", "Samuel Brooks", "patient_samuel_brooks_v1", SPEECH_SYNTH_MALE_VOICE],
      ["patient", "Aisha Khan", "patient_aisha_khan_v1", SPEECH_SYNTH_FEMALE_VOICE],
      ["patient", "David Miller", "patient_david_miller_v1", SPEECH_SYNTH_MALE_VOICE],
      ["patient", "Maya Johnson", "patient_maya_johnson_v1", SPEECH_SYNTH_FEMALE_VOICE],
      ["patient", "Noah Chen", "patient_noah_chen_v1", SPEECH_SYNTH_FEMALE_VOICE],
      ["patient", "Priya Shah", "patient_priya_shah_v1", SPEECH_SYNTH_FEMALE_VOICE],
      ["patient", "Mario Guzman", "patient_mario_guzman_v1", SPEECH_SYNTH_MALE_VOICE],
      ["patient", "Helen Carter", "patient_helen_carter_v1", SPEECH_SYNTH_FEMALE_VOICE],
      ["patient", "Luis Martinez", "patient_luis_martinez_v1", SPEECH_SYNTH_MALE_VOICE],
      ["patient", "Margaret Ellis", "patient_margaret_ellis_v1", SPEECH_SYNTH_FEMALE_VOICE],
    ];
    for (const [role, displayName, actorId, voice] of cases) {
      expect(voiceIdForActor({ role, displayName, actorId })).toBe(voice);
      expect(voiceIdForActor({ role, displayName, actorId })).toBe(voiceIdForActor({ role, displayName, actorId }));
    }
  });

  it("(3) phenotype leads: child and explicit sex beat name silence", () => {
    expect(voiceIdForActor({ role: "patient", genderPresentation: "child", actorId: "patient_x_v1" })).toBe(
      SPEECH_SYNTH_FEMALE_VOICE,
    );
    expect(voiceIdForActor({ role: "patient", genderPresentation: "adult_male", actorId: "patient_x_v1" })).toBe(
      SPEECH_SYNTH_MALE_VOICE,
    );
    expect(
      voiceIdForActor({ role: "patient", genderPresentation: "adult_female_parent", actorId: "parent_x_v1" }),
    ).toBe(SPEECH_SYNTH_FEMALE_VOICE);
    // "female" never misfires on the "male" substring; ambiguous names default female.
    expect(voiceIdForActor({ role: "patient", displayName: "Jordan Reed", actorId: "patient_jordan_reed_v1" })).toBe(
      SPEECH_SYNTH_FEMALE_VOICE,
    );
  });

  it("(4) cache hit returns without spawning TTS (bogus python proves no exec)", async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), "lip-sync-synth-cache-"));
    const text = "cache hit line";
    const voiceId = "af_heart";
    const key = speechCacheKey({ text, voiceId });
    const wavBytes = Buffer.from("RIFF-test-bytes");
    const wavSha256 = createHash("sha256").update(wavBytes).digest("hex");
    await writeFile(join(cacheDir, `${key}.wav`), wavBytes);
    await writeFile(
      join(cacheDir, `${key}.provenance.json`),
      `${JSON.stringify({ tool: "kokoro", cacheKey: key, wavSha256 })}\n`,
    );
    process.env["OPENCLINXR_KOKORO_PYTHON"] = join(cacheDir, "no-such-python");
    try {
      const result = await synthesizeSpeechWav({ caseId: "c", actorId: "a", text, voiceId, cacheDir });
      expect(result.cacheHit).toBe(true);
      expect(result.wavPath).toBe(join(cacheDir, `${key}.wav`));
    } finally {
      delete process.env["OPENCLINXR_KOKORO_PYTHON"];
    }
  });

  it("(5) empty text and unknown voice throw naming the speech-synth step", async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), "lip-sync-synth-reject-"));
    await expect(
      synthesizeSpeechWav({ caseId: "c", actorId: "a", text: "  ", voiceId: "af_heart", cacheDir }),
    ).rejects.toThrow(/speech-synth/);
    await expect(
      synthesizeSpeechWav({ caseId: "c", actorId: "a", text: "hi", voiceId: "nope", cacheDir }),
    ).rejects.toThrow(/speech-synth/);
  });
});
