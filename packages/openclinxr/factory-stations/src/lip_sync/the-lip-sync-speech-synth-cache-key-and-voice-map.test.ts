import { createHash } from "node:crypto";
import { mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runLipSync } from "../index.js";

/**
 * OBSERVABLE: the dark-factory lip_sync stage fails on all 15 cases with
 * "lip_sync needs wavPath" because no build-time speech source exists.
 *
 * runLipSync's `speech` option is that source: it synthesises the utterance
 * via seeded Kokoro-82M into a content cache keyed by
 * sha256(model revision | voice | text), then bakes rhubarb visemes from it.
 *
 * Entrypoint-only: every assertion below goes through `runLipSync` from the
 * package index. The expected key is recomputed inline from the documented
 * inputs, and the cache dir is pre-seeded, so no TTS install is needed: a
 * bogus OPENCLINXR_KOKORO_PYTHON makes any cache MISS fail fast, which means
 * every success below proves the exact expected key (hence voice) was used.
 * No import of ./speech-synth.js in any test, static or dynamic.
 */

// Pinned copy of the factory model revision (speech-synth.ts
// SPEECH_SYNTH_MODEL_REVISION). If the revision changes, seeded keys stop
// matching and these tests fail: that is the pin working, update both.
const MODEL_REVISION =
  "hexgrad/Kokoro-82M v1.0 kokoro-v1_0.pth sha256:496dba118d1a58f5f3db2efc88dbdc216e0483fc89fe6e47ee1f2c53f18ad1e4";
const FEMALE_VOICE = "af_heart";
const MALE_VOICE = "am_adam";

function expectedKey(text: string, voiceId: string): string {
  return createHash("sha256").update(`${MODEL_REVISION}\0${voiceId}\0${text}`, "utf8").digest("hex");
}

/** Minimal valid WAV (1.0 s 440 Hz sine, 22050 Hz mono 16-bit) for rhubarb. */
function sineWavBytes(): Buffer {
  const sampleRate = 22050;
  const data = Buffer.alloc(sampleRate * 2);
  for (let i = 0; i < sampleRate; i += 1) {
    data.writeInt16LE(Math.round(12000 * Math.sin((2 * Math.PI * 440 * i) / sampleRate)), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

async function seedCache(cacheDir: string, text: string, voiceId: string): Promise<{ key: string; wavSha256: string }> {
  const key = expectedKey(text, voiceId);
  expect(key).toMatch(/^[0-9a-f]{64}$/);
  const wav = sineWavBytes();
  const wavSha256 = createHash("sha256").update(wav).digest("hex");
  await writeFile(join(cacheDir, `${key}.wav`), wav);
  await writeFile(
    join(cacheDir, `${key}.provenance.json`),
    `${JSON.stringify({ tool: "kokoro", cacheKey: key, wavSha256, voice: voiceId })}\n`,
  );
  return { key, wavSha256 };
}

/** Point the shared cache at tmp and break synthesis so misses fail fast. */
async function isolatedCache(): Promise<{ cacheDir: string; restore: () => void }> {
  const cacheDir = await mkdtemp(join(tmpdir(), "lip-sync-synth-seam-"));
  const prevCache = process.env["OPENCLINXR_SPEECH_WAV_CACHE"];
  const prevPython = process.env["OPENCLINXR_KOKORO_PYTHON"];
  process.env["OPENCLINXR_SPEECH_WAV_CACHE"] = cacheDir;
  process.env["OPENCLINXR_KOKORO_PYTHON"] = join(cacheDir, "no-such-python");
  return {
    cacheDir,
    restore: () => {
      if (prevCache === undefined) delete process.env["OPENCLINXR_SPEECH_WAV_CACHE"];
      else process.env["OPENCLINXR_SPEECH_WAV_CACHE"] = prevCache;
      if (prevPython === undefined) delete process.env["OPENCLINXR_KOKORO_PYTHON"];
      else process.env["OPENCLINXR_KOKORO_PYTHON"] = prevPython;
    },
  };
}

describe("the lip_sync speech-synth cache key and voice map", () => {
  it("(0) same line twice resolves the same cache key and artifact", { timeout: 60000 }, async () => {
    const { cacheDir, restore } = await isolatedCache();
    try {
      const text = "My chest feels tight and it is hard to breathe.";
      await seedCache(cacheDir, text, FEMALE_VOICE);
      const speech = { caseId: "c", actorId: "patient_maya_johnson_v1", role: "patient", displayName: "Maya Johnson" };
      const first = await runLipSync(
        { actorId: "actor_a", visemeBank: "mpfb_phonemes" },
        { utterance: text, outDir: await mkdtemp(join(tmpdir(), "lip-sync-seam-a-")), wavPath: "", speech },
      );
      const second = await runLipSync(
        { actorId: "actor_a", visemeBank: "mpfb_phonemes" },
        { utterance: text, outDir: await mkdtemp(join(tmpdir(), "lip-sync-seam-b-")), wavPath: "", speech },
      );
      expect(first.cueArtifactPath).toContain("utterance-");
      expect(second.cueArtifactPath).toContain("utterance-");
      expect(first.cues.length).toBeGreaterThan(0);
      expect(second.cues.length).toBeGreaterThan(0);
      const cached = (await readdir(cacheDir)).filter((f) => f.endsWith(".wav"));
      expect(cached).toHaveLength(1);
    } finally {
      restore();
    }
  });

  it("(1) wrong text and wrong voice miss the cache and name the step", async () => {
    const { cacheDir, restore } = await isolatedCache();
    try {
      await seedCache(cacheDir, "hello", FEMALE_VOICE);
      const outDir = await mkdtemp(join(tmpdir(), "lip-sync-seam-miss-"));
      // Right voice, wrong text: miss.
      await expect(
        runLipSync(
          { actorId: "actor_a", visemeBank: "mpfb_phonemes" },
          {
            utterance: "hello!",
            outDir,
            wavPath: "",
            speech: { caseId: "c", actorId: "a", role: "patient", voiceId: FEMALE_VOICE },
          },
        ),
      ).rejects.toThrow(/speech-synth/);
      // Male actor with only the female key seeded: miss proves the lookup
      // used am_adam rather than ignoring the voice map.
      await expect(
        runLipSync(
          { actorId: "actor_a", visemeBank: "mpfb_phonemes" },
          {
            utterance: "hello",
            outDir,
            wavPath: "",
            speech: { caseId: "c", actorId: "patient_robert_hayes_v1", role: "patient", displayName: "Robert Hayes" },
          },
        ),
      ).rejects.toThrow(/speech-synth/);
    } finally {
      restore();
    }
  });

  it("(2) male actor bakes from the male voice and records it", { timeout: 60000 }, async () => {
    const { cacheDir, restore } = await isolatedCache();
    try {
      const text = "It feels heavy, like someone is sitting on my chest.";
      await seedCache(cacheDir, text, MALE_VOICE);
      const outDir = await mkdtemp(join(tmpdir(), "lip-sync-seam-male-"));
      const result = await runLipSync(
        { actorId: "actor_a", visemeBank: "mpfb_phonemes" },
        {
          utterance: text,
          outDir,
          wavPath: "",
          speech: { caseId: "c", actorId: "patient_robert_hayes_v1", role: "patient", displayName: "Robert Hayes" },
        },
      );
      expect((result["speech"] as { voice?: string } | undefined)?.voice).toBe(MALE_VOICE);
      expect(result.cues.length).toBeGreaterThan(0);
    } finally {
      restore();
    }
  });

  it("(3) female actor bakes from the female voice and records it", { timeout: 60000 }, async () => {
    const { cacheDir, restore } = await isolatedCache();
    try {
      const text = "The pain is sharp on my lower right side, and it hurts when I move.";
      await seedCache(cacheDir, text, FEMALE_VOICE);
      const outDir = await mkdtemp(join(tmpdir(), "lip-sync-seam-female-"));
      const result = await runLipSync(
        { actorId: "actor_a", visemeBank: "mpfb_phonemes" },
        {
          utterance: text,
          outDir,
          wavPath: "",
          speech: { caseId: "c", actorId: "patient_elena_vasquez_v1", role: "patient", displayName: "Elena Vasquez" },
        },
      );
      expect((result["speech"] as { voice?: string } | undefined)?.voice).toBe(FEMALE_VOICE);
      expect(result.cues.length).toBeGreaterThan(0);
    } finally {
      restore();
    }
  });

  it("(4) child actor bakes from the female voice and records it", { timeout: 60000 }, async () => {
    const { cacheDir, restore } = await isolatedCache();
    try {
      const text = "My chest feels tight and it is hard to breathe.";
      await seedCache(cacheDir, text, FEMALE_VOICE);
      const outDir = await mkdtemp(join(tmpdir(), "lip-sync-seam-child-"));
      const result = await runLipSync(
        { actorId: "actor_a", visemeBank: "mpfb_phonemes" },
        {
          utterance: text,
          outDir,
          wavPath: "",
          speech: {
            caseId: "c",
            actorId: "patient_maya_johnson_v1",
            role: "patient",
            genderPresentation: "child",
            displayName: "Maya Johnson",
          },
        },
      );
      expect((result["speech"] as { voice?: string } | undefined)?.voice).toBe(FEMALE_VOICE);
      expect(result.cues.length).toBeGreaterThan(0);
    } finally {
      restore();
    }
  });

  it("(5) empty text and unknown voice throw naming the speech-synth step", async () => {
    const { restore } = await isolatedCache();
    try {
      const outDir = await mkdtemp(join(tmpdir(), "lip-sync-seam-reject-"));
      await expect(
        runLipSync(
          { actorId: "actor_a", visemeBank: "mpfb_phonemes" },
          { utterance: "  ", outDir, wavPath: "", speech: { caseId: "c", actorId: "a", role: "patient" } },
        ),
      ).rejects.toThrow(/speech-synth/);
      await expect(
        runLipSync(
          { actorId: "actor_a", visemeBank: "mpfb_phonemes" },
          {
            utterance: "hi",
            outDir,
            wavPath: "",
            speech: { caseId: "c", actorId: "a", role: "patient", voiceId: "nope" },
          },
        ),
      ).rejects.toThrow(/speech-synth/);
    } finally {
      restore();
    }
  });

  it("(6) missing wavPath without a speech source still throws naming wavPath", async () => {
    const { restore } = await isolatedCache();
    try {
      const outDir = await mkdtemp(join(tmpdir(), "lip-sync-seam-nowav-"));
      await expect(
        runLipSync({ actorId: "actor_a", visemeBank: "mpfb_phonemes" }, { utterance: "hi", outDir, wavPath: "" }),
      ).rejects.toThrow(/wavPath/);
    } finally {
      restore();
    }
  });
});
