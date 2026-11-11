import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { checkEncodedOutput, encodeClip, hasAudioStream } from "./capture/encode.mjs";

// Fixture ceilings below are illustrative only: tiny values keep the
// over-ceiling fixture small and do not copy any PLAN slot ceiling.

function makeDir(prefix: string): string {
  return mkdtempSync(path.join(tmpdir(), prefix));
}

function makeInputWithAudio(outPath: string): void {
  execFileSync(
    "ffmpeg",
    [
      "-y",
      "-f",
      "lavfi",
      "-i",
      "testsrc=size=128x128:rate=10",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:sample_rate=44100",
      "-t",
      "2",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-shortest",
      outPath,
    ],
    { stdio: "pipe", timeout: 60000 },
  );
}

function writeMedia(
  dir: string,
  slotId: string,
  opts: { audio: boolean; ceilingBytes: number },
): string {
  const mediaPath = path.join(dir, "media.json");
  const payload = {
    slots: [
      {
        audio: opts.audio,
        ceilingBytes: opts.ceilingBytes,
        files: [],
        id: slotId,
        kind: "visual",
        releaseTag: null,
        state: "PLACEHOLDER",
        voice: "none",
      },
    ],
  };
  writeFileSync(mediaPath, JSON.stringify(payload));
  return mediaPath;
}

function writeCapture(dir: string): string {
  const capturePath = path.join(dir, "capture.json");
  const payload = {
    blueprintId: "ed-chest-pain",
    buildSha: "test",
    cameraPreset: "test",
    clientRoles: ["learner"],
    ffmpeg: { args: null, version: null },
    seed: "test",
  };
  writeFileSync(capturePath, JSON.stringify(payload));
  return capturePath;
}

function readCapture(capturePath: string): { ffmpeg: { args: unknown; version: unknown } } {
  const raw = readFileSync(capturePath, "utf8");
  return JSON.parse(raw) as { ffmpeg: { args: unknown; version: unknown } };
}

it("known-good: encode writes ffmpeg version and exact args into capture.json", async () => {
  const dir = makeDir("w0c-good-");
  const slotId = "K1";
  const input = path.join(dir, "input.mp4");
  const output = path.join(dir, "output.mp4");
  makeInputWithAudio(input);
  const mediaPath = writeMedia(dir, slotId, { audio: false, ceilingBytes: 50_000_000 });
  const capturePath = writeCapture(dir);
  const blockers = (await encodeClip({
    captureJsonPath: capturePath,
    input,
    mediaJsonPath: mediaPath,
    output,
    slotId,
  })) as string[];
  expect(blockers).toEqual([]);
  const capture = readCapture(capturePath);
  expect(typeof capture.ffmpeg.version).toBe("string");
  expect(String(capture.ffmpeg.version)).toContain("ffmpeg version");
  const expectedArgs = [
    "-y",
    "-i",
    input,
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-crf",
    "23",
    "-movflags",
    "+faststart",
    "-an",
    output,
  ];
  expect(capture.ffmpeg.args).toEqual(expectedArgs);
}, 60000);

it("negative: muted slot output that still carries audio is refused", async () => {
  const dir = makeDir("w0c-audio-");
  const slotId = "K1";
  const input = path.join(dir, "input.mp4");
  const defect = path.join(dir, "defect.mp4");
  makeInputWithAudio(input);
  execFileSync(
    "ffmpeg",
    [
      "-y",
      "-i",
      input,
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-crf",
      "23",
      "-c:a",
      "aac",
      "-movflags",
      "+faststart",
      defect,
    ],
    { stdio: "pipe", timeout: 60000 },
  );
  const mediaPath = writeMedia(dir, slotId, { audio: false, ceilingBytes: 50_000_000 });
  expect(await hasAudioStream(defect)).toBe(true);
  const blockers = (await checkEncodedOutput({
    mediaJsonPath: mediaPath,
    output: defect,
    slotId,
  })) as string[];
  expect(blockers).toContain(`encode_audio_present:${slotId}`);
}, 60000);

it("negative: output over ceilingBytes gives encode_over_ceiling", async () => {
  const dir = makeDir("w0c-ceil-");
  const slotId = "K1";
  const input = path.join(dir, "input.mp4");
  const output = path.join(dir, "output.mp4");
  makeInputWithAudio(input);
  const mediaPath = writeMedia(dir, slotId, { audio: false, ceilingBytes: 10 });
  const capturePath = writeCapture(dir);
  const blockers = (await encodeClip({
    captureJsonPath: capturePath,
    input,
    mediaJsonPath: mediaPath,
    output,
    slotId,
  })) as string[];
  const size = statSync(output).size;
  expect(size).toBeGreaterThan(10);
  expect(blockers.some((entry) => entry === `encode_over_ceiling:${slotId}:${size}`)).toBe(true);
}, 60000);

it("counterweight: output bytes differ from input bytes so a copy is not an encode", async () => {
  const dir = makeDir("w0c-copy-");
  const slotId = "K1";
  const input = path.join(dir, "input.mp4");
  const output = path.join(dir, "output.mp4");
  makeInputWithAudio(input);
  const mediaPath = writeMedia(dir, slotId, { audio: false, ceilingBytes: 50_000_000 });
  const capturePath = writeCapture(dir);
  await encodeClip({
    captureJsonPath: capturePath,
    input,
    mediaJsonPath: mediaPath,
    output,
    slotId,
  });
  expect(statSync(output).size).not.toBe(statSync(input).size);
}, 60000);

it("fail-closed: a slot with no audio field encodes with -an and carries no audio stream", async () => {
  const dir = makeDir("w0c-noaudio-");
  const slotId = "K1";
  const input = path.join(dir, "input.mp4");
  const output = path.join(dir, "output.mp4");
  makeInputWithAudio(input);
  const mediaPath = path.join(dir, "media.json");
  writeFileSync(mediaPath, JSON.stringify({ slots: [{ ceilingBytes: 50_000_000, id: slotId, kind: "visual" }] }));
  const capturePath = writeCapture(dir);
  const blockers = (await encodeClip({ captureJsonPath: capturePath, input, mediaJsonPath: mediaPath, output, slotId })) as string[];
  expect(blockers).toEqual([]);
  expect(readCapture(capturePath).ffmpeg.args).toContain("-an");
  expect(await hasAudioStream(output)).toBe(false);
}, 60000);
