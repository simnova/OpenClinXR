// Bake TTS audio + Rhubarb viseme cues for the three nurse lines.
// Run: pnpm exec tsx tools/openclinxr/evidence/natural-blink-emotion/speech-emotion-video/bake-speech.ts --out <dir>
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { utteranceIdForText } from "../../../../../packages/openclinxr/xr-dialogue/src/viseme-utterance-hash.ts";
import { sayFixtureArgv } from "../../../../../packages/openclinxr/factory-stations/src/lip_sync/fixture-wav.ts";
import { runLipSync } from "../../../../../packages/openclinxr/factory-stations/src/lip_sync/run.ts";

const ACTOR_ID = "nurse_maria_alvarez_v1";
const SCENARIO_ID = "ed_chest_pain_priority_v1";

const LINES = [
  {
    lineId: "L1",
    emotion: "concerned",
    text: "Your blood pressure is higher than it was an hour ago, so I want to check it again.",
  },
  {
    lineId: "L2",
    emotion: "anxious",
    text: "The monitor is showing some changes, and I need the doctor to come and see you right now.",
  },
  {
    lineId: "L3",
    emotion: "reassured",
    text: "The doctor is on her way. You did the right thing telling us, and I will stay right here with you.",
  },
];

function parseArgs(): { out: string } {
  const args = process.argv.slice(2);
  const at = args.indexOf("--out");
  if (at < 0 || !args[at + 1]) throw new Error("usage: bake-speech.ts --out <dir>");
  return { out: resolve(args[at + 1]!) };
}

// Duration of a LEI16 mono WAV by parsing the header (fmt sampleRate + data chunk bytes).
function wavDurationSeconds(path: string): number {
  const buf = readFileSync(path);
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error(`not a WAV file: ${path}`);
  }
  let sampleRate = 0;
  let channels = 0;
  let bitsPerSample = 0;
  let dataBytes = 0;
  let offset = 12;
  while (offset + 8 <= buf.length) {
    const id = buf.toString("ascii", offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    if (id === "fmt " && size >= 16) {
      channels = buf.readUInt16LE(offset + 10);
      sampleRate = buf.readUInt32LE(offset + 12);
      bitsPerSample = buf.readUInt16LE(offset + 22);
    } else if (id === "data") {
      dataBytes = size;
    }
    offset += 8 + size + (size % 2);
  }
  if (!sampleRate || !channels || !bitsPerSample || !dataBytes) {
    throw new Error(`could not parse WAV header: ${path}`);
  }
  return dataBytes / ((bitsPerSample / 8) * channels * sampleRate);
}

const { out } = parseArgs();
const wavDir = join(out, "wav");
const cueDir = join(out, "lip-sync-cues", SCENARIO_ID);
mkdirSync(wavDir, { recursive: true });
mkdirSync(cueDir, { recursive: true });
const tmp = mkdtempSync(join(tmpdir(), "openclinxr-speech-bake-"));

const rows = [];
for (const line of LINES) {
  const id = utteranceIdForText(line.text);
  const aiff = join(tmp, `utterance-${id}.aiff`);
  const wav = join(wavDir, `utterance-${id}.wav`);
  // Same numbers as conversation-policy PROSODY_ROWS (pain 0.85, anxious 0.95, else 1.0).
  const prosodySpeed =
    line.emotion === "pain" ? 0.85 : line.emotion === "anxious" ? 0.95 : 1;
  execFileSync("say", sayFixtureArgv(aiff, line.text, { voice: "Samantha", prosodySpeed }), {
    stdio: "inherit",
  });
  execFileSync("afconvert", ["-f", "WAVE", "-d", "LEI16@22050", "-c", "1", aiff, wav], { stdio: "inherit" });
  const duration = wavDurationSeconds(wav);
  const result = await runLipSync(
    { actorId: ACTOR_ID, visemeBank: "mpfb_phonemes" },
    { utterance: line.text, outDir: join(tmp, `lipsync-${id}`), wavPath: wav },
  );
  const cuePath = join(cueDir, `utterance-${id}.mouth-cues.json`);
  copyFileSync(result.cueArtifactPath as string, cuePath);
  const cueCount = (result.cues ?? []).length;
  rows.push({
    lineId: line.lineId,
    text: line.text,
    emotion: line.emotion,
    utteranceId: id,
    wavPath: `wav/utterance-${id}.wav`,
    cuePath: `lip-sync-cues/${SCENARIO_ID}/utterance-${id}.mouth-cues.json`,
    audioDurationSeconds: Number(duration.toFixed(3)),
    cueCount,
  });
  console.error(`${line.lineId} id=${id} duration=${duration.toFixed(2)}s cues=${cueCount}`);
}

writeFileSync(join(out, "speech-lines.json"), `${JSON.stringify(rows, null, 2)}\n`);
console.error(`wrote ${join(out, "speech-lines.json")}`);
