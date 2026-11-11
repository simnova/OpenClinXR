/**
 * Pinned site-clip encode (card W0c).
 *
 * One fixed ffmpeg argv per published clip. The argv and the ffmpeg
 * version string are recorded into capture.json so every published
 * clip carries its exact encode provenance (checklist A1).
 */

import { execFile } from "node:child_process";
import { readFile, stat, writeFile } from "node:fs/promises";
import { promisify } from "node:util";

const runExecFile = promisify(execFile);

const ffmpegBin = process.env["FFMPEG"] ?? "ffmpeg";
const ffprobeBin = process.env["FFPROBE"] ?? "ffprobe";

export const PINNED_CRF = "23";

export function buildEncodeArgs({ input, output, muted }) {
  const args = [
    "-y",
    "-i",
    input,
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-crf",
    PINNED_CRF,
    "-movflags",
    "+faststart",
  ];
  if (muted) {
    args.push("-an");
  } else {
    args.push("-c:a", "aac");
  }
  args.push(output);
  return args;
}

async function readSlot({ slotId, mediaJsonPath }) {
  const raw = await readFile(mediaJsonPath, "utf8");
  const data = JSON.parse(raw);
  const slots = Array.isArray(data.slots) ? data.slots : [];
  const slot = slots.find((entry) => entry?.id === slotId);
  if (slot === undefined) {
    throw new Error(`unknown media slot: ${slotId}`);
  }
  return slot;
}

async function readFfmpegVersion() {
  const { stdout } = await runExecFile(ffmpegBin, ["-version"]);
  const first = String(stdout).split("\n")[0] ?? "";
  return first.trim();
}

export async function hasAudioStream(output) {
  const { stdout } = await runExecFile(ffprobeBin, [
    "-v",
    "error",
    "-select_streams",
    "a",
    "-show_entries",
    "stream=codec_type",
    "-of",
    "csv=p=0",
    output,
  ]);
  return String(stdout).trim().length > 0;
}

export async function checkEncodedOutput({ slotId, output, mediaJsonPath }) {
  const blockers = [];
  const slot = await readSlot({ slotId, mediaJsonPath });
  const info = await stat(output);
  const ceiling = slot.ceilingBytes;
  if (typeof ceiling === "number" && info.size > ceiling) {
    blockers.push(`encode_over_ceiling:${slotId}:${info.size}`);
  }
  const muted = slot.audio !== true; // only an explicit audio: true keeps sound
  if (muted) {
    const audioFound = await hasAudioStream(output);
    if (audioFound) {
      blockers.push(`encode_audio_present:${slotId}`);
    }
  }
  return blockers;
}

export async function encodeClip({ input, output, slotId, mediaJsonPath, captureJsonPath }) {
  const slot = await readSlot({ slotId, mediaJsonPath });
  const muted = slot.audio !== true; // only an explicit audio: true keeps sound
  const args = buildEncodeArgs({ input, output, muted });
  const version = await readFfmpegVersion();
  await runExecFile(ffmpegBin, args);
  const raw = await readFile(captureJsonPath, "utf8");
  const capture = JSON.parse(raw);
  capture.ffmpeg = { version, args };
  await writeFile(captureJsonPath, `${JSON.stringify(capture, null, 2)}\n`, "utf8");
  return checkEncodedOutput({ slotId, output, mediaJsonPath });
}
