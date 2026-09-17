/** App-local pure Rhubarb validation/canonical delegation and PCM16 mono decoding. */
import { mouthCuesToPhonemeCues } from "@openclinxr/xr-dialogue";

export type MouthCuesDocument = Parameters<typeof mouthCuesToPhonemeCues>[0];
export type DiagnosticMouthCue = { phoneme: string; atSecond: number; durationSeconds: number };

function toDiagnosticCues(cues: ReturnType<typeof mouthCuesToPhonemeCues>): DiagnosticMouthCue[] {
  return cues.map((cue) => ({ phoneme: cue.phoneme, atSecond: cue.atSecond, durationSeconds: cue.durationSeconds ?? 0 }));
}

export function convertRhubarb(doc: MouthCuesDocument): DiagnosticMouthCue[] {
  const cues = doc?.mouthCues ?? [];
  for (const cue of cues) {
    const value = String(cue?.value ?? "");
    const start = Number(cue?.start);
    const end = Number(cue?.end);
    if (!/^[A-HX]$/.test(value) || !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) {
      throw new Error("invalid-rhubarb-cue");
    }
  }
  let previousEnd = -Infinity;
  for (const cue of cues) {
    if (cue.start < previousEnd) throw new Error("overlapping-rhubarb-cues");
    previousEnd = cue.end;
  }
  return toDiagnosticCues(mouthCuesToPhonemeCues(doc));
}

export function decodePcm16MonoWav(wav: ArrayBuffer): { sampleRate: number; sampleCount: number; float32: Float32Array; pcm16: Int16Array } {
  const bytes = new Uint8Array(wav);
  const view = new DataView(wav);
  const ascii = (start: number, n: number) => String.fromCharCode(...bytes.subarray(start, start + n));
  if (ascii(0, 4) !== "RIFF" || ascii(8, 4) !== "WAVE") throw new Error("invalid-waveform-container");
  let fmt: DataView | undefined;
  let dataOffset = 0;
  let dataSize = 0;
  for (let p = 12; p + 8 <= bytes.length; ) {
    const tag = ascii(p, 4);
    const size = view.getUint32(p + 4, true);
    const start = p + 8;
    if (start + size > bytes.length) throw new Error("truncated-waveform-chunk");
    if (tag === "fmt ") fmt = new DataView(wav, start, size);
    if (tag === "data") {
      dataOffset = start;
      dataSize = size;
    }
    p = start + size + (size % 2);
  }
  if (!fmt || fmt.byteLength < 16 || dataSize <= 0) throw new Error("unsupported-waveform-domain");
  if (fmt.getUint16(0, true) !== 1 || fmt.getUint16(2, true) !== 1 || fmt.getUint16(14, true) !== 16 || dataSize % 2) {
    throw new Error("unsupported-waveform-domain");
  }
  const sampleRate = fmt.getUint32(4, true);
  const sampleCount = dataSize / 2;
  const pcm16 = new Int16Array(wav, dataOffset, sampleCount);
  const float32 = new Float32Array(sampleCount);
  for (let i = 0; i < sampleCount; i += 1) float32[i] = (pcm16[i] ?? 0) / 32768;
  return { sampleRate, sampleCount, float32, pcm16 };
}

export type PlaybackIdentity = { waveformSha256: string; cueSha256: string; actorId: string; generation: string; decodedSampleRate: number; decodedSampleCount: number };

export type PlaybackSource = {
  playbackRate: { value: number };
  buffer: unknown;
  connect(dest: unknown): void;
  start(when: number, offset: number): void;
  stop?: (() => unknown) | undefined;
  disconnect?: () => void;
  onended: (() => void) | null;
};

export type PlaybackContext = {
  currentTime: number;
  state: string;
  sampleRate?: number;
  resume?: () => Promise<unknown>;
  createBufferSource(): PlaybackSource;
};

export type PlaybackBuffer = { duration: number; sampleRate?: number; length?: number };


export function cuesAdmissible(cues: readonly DiagnosticMouthCue[] | undefined): boolean {
  if (!cues?.length) return false;
  let end = Number.NEGATIVE_INFINITY;
  for (const cue of cues) {
    if (!Number.isFinite(cue.atSecond) || cue.atSecond < 0 || !Number.isFinite(cue.durationSeconds) || cue.durationSeconds <= 0) return false;
    if (cue.atSecond < end) return false;
    end = cue.atSecond + cue.durationSeconds;
  }
  return true;
}

