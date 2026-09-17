import {it, expect} from "vitest";
import {
  copyAudioDataSamples,
  appendAudioObservation,
  packRgba,
  classifyVideoMarker,
  videoFrameToPackedRgba,
  AUDIO_TIMESTAMP_EPOCH,
  VIDEO_TIMESTAMP_EPOCH,
  nativeTrackObserverSupported,
} from "./native-track-observer.mjs";
import { encodeObservedRowMarker } from "./observed-row-barcode.mjs";

function fakePlanarF32(frames, channels, timestamp = 100) {
  const planes = Array.from({ length: channels }, (_, c) => Float32Array.from({ length: frames }, (__, i) => (c + 1) * 0.01 + i * 0.001));
  return {
    timestamp,
    numberOfFrames: frames,
    numberOfChannels: channels,
    sampleRate: 22050,
    format: "f32-planar",
    copyTo(dest, opts) { dest.set(planes[opts.planeIndex]); },
    close() { this.closed = true; },
  };
}

it("copies planar f32 frames with preserved sample indices and timestamps", () => {
  const data = fakePlanarF32(4, 2, 1681097569089);
  const copy = copyAudioDataSamples(data);
  expect(copy.status).toBe("available");
  expect(copy.numberOfFrames).toBe(4);
  expect(copy.numberOfChannels).toBe(2);
  expect(copy.samples).toHaveLength(8);
  expect(copy.samples[0]).toBeCloseTo(0.01);
  expect(copy.samples[1]).toBeCloseTo(0.02);
  const rows = [];
  appendAudioObservation(rows, {
    type: "AudioData",
    timestamp: data.timestamp,
    timestampEpoch: AUDIO_TIMESTAMP_EPOCH,
    numberOfFrames: 4,
    sampleIndex: 0,
  });
  appendAudioObservation(rows, {
    type: "AudioData",
    timestamp: data.timestamp + 4107,
    timestampEpoch: AUDIO_TIMESTAMP_EPOCH,
    numberOfFrames: 4,
    sampleIndex: 4,
  });
  expect(rows.map((r) => r.sampleIndex)).toEqual([0, 4]);
  expect(rows[0].timestampEpoch).not.toBe(VIDEO_TIMESTAMP_EPOCH);
});

it("keeps observed sampleIndex contiguous when a copy fails, without zero-filling PCM", () => {
  const rows = [];
  appendAudioObservation(rows, { type: "AudioData", timestamp: 1, numberOfFrames: 220, sampleIndex: 0, copyStatus: "available", pcmFrameOffset: 0 });
  appendAudioObservation(rows, { type: "AudioData", timestamp: 2, numberOfFrames: 220, sampleIndex: 220, copyStatus: "unsupported", pcmFrameOffset: null });
  appendAudioObservation(rows, { type: "AudioData", timestamp: 3, numberOfFrames: 220, sampleIndex: 440, copyStatus: "available", pcmFrameOffset: 220 });
  expect(rows.map((r) => r.sampleIndex)).toEqual([0, 220, 440]);
  expect(rows[1].pcmFrameOffset).toBeNull();
});

it("refuses inserted, fake, and overlapping sample rows", () => {
  const rows = [];
  appendAudioObservation(rows, { type: "AudioData", timestamp: 1, numberOfFrames: 220, sampleIndex: 0 });
  expect(() => appendAudioObservation(rows, { type: "AudioData", timestamp: 2, numberOfFrames: 220, sampleIndex: 0 })).toThrow(/native-track-dedup-or-overlap/);
  expect(() => appendAudioObservation(rows, { type: "TimingRow", timestamp: 3, numberOfFrames: 220, sampleIndex: 220 })).toThrow(/native-track-fake-row/);
  expect(() => appendAudioObservation(rows, { type: "AudioData", timestamp: 3, numberOfFrames: 220, sampleIndex: 100 })).toThrow(/native-track-dedup-or-overlap/);
});

it("does not treat audio capture-ticks and video first-frame ticks as a common origin", () => {
  expect(AUDIO_TIMESTAMP_EPOCH).toBe("audio-data-capture-ticks");
  expect(VIDEO_TIMESTAMP_EPOCH).toBe("video-frame-relative-first-ticks");
  expect(AUDIO_TIMESTAMP_EPOCH).not.toBe(VIDEO_TIMESTAMP_EPOCH);
  const audioTs = 1681097569089;
  const videoTs = 0;
  expect(audioTs - videoTs).not.toBe(0);
});

it("decodes an actual painted strip nonce and excludes a corrupt checksum", () => {
  const marker = encodeObservedRowMarker({ callbackSerial: 88, generation: "clock-patient:turn-1:7", nodeSerial: 3 });
  const rgba = new Uint8Array(1024 * 1024 * 4);
  const { layout, bits } = marker;
  for (let i = 0; i < bits.length; i += 1) {
    const v = bits[i] ? 255 : 0;
    const x0 = layout.x0 + i * layout.cellPx;
    for (let y = layout.y0; y < layout.y0 + layout.stripPx; y += 1) {
      for (let x = x0; x < x0 + layout.cellPx; x += 1) {
        const o = (y * 1024 + x) * 4;
        rgba[o] = rgba[o + 1] = rgba[o + 2] = v;
        rgba[o + 3] = 255;
      }
    }
  }
  const marked = classifyVideoMarker(rgba, 1024, 1024);
  expect(marked).toMatchObject({ kind: "marked", decoded: { callbackSerial: 88, generationN: 7, nodeSerial: 3, checksum: marker.checksum } });
  const cx = layout.x0 + 40 * layout.cellPx + Math.floor(layout.cellPx / 2);
  const cy = layout.y0 + Math.floor(layout.stripPx / 2);
  const o = (cy * 1024 + cx) * 4;
  rgba[o] = 255 - rgba[o];
  rgba[o + 1] = 255 - rgba[o + 1];
  rgba[o + 2] = 255 - rgba[o + 2];
  const excluded = classifyVideoMarker(rgba, 1024, 1024);
  expect(excluded.kind).toBe("excluded-checksum");
  expect(classifyVideoMarker(new Uint8Array(16), 2, 2).kind).toBe("unmarked");
});

it("packs strided RGBA without inventing pixels", () => {
  const packed = packRgba(Uint8Array.from([1, 2, 3, 4, 9, 9, 5, 6, 7, 8, 9, 9]), 1, 2, 6);
  expect(Array.from(packed)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
});

it("copyTo fallback refuses planar NV12 bytes as RGBA", async () => {
  const previous = globalThis.OffscreenCanvas;
  globalThis.OffscreenCanvas = undefined;
  try {
    const frame = {
      format: "NV12",
      displayWidth: 2,
      displayHeight: 2,
      codedWidth: 2,
      codedHeight: 2,
      allocationSize(opts) {
        if (opts?.format === "RGBA") throw new Error("rgba-copy-unsupported");
        return 6;
      },
      async copyTo(_buf, opts) {
        if (opts?.format === "RGBA") throw new Error("rgba-copy-unsupported");
        return [{ offset: 0, stride: 2 }];
      },
    };
    const result = await videoFrameToPackedRgba(frame);
    expect(result.status).toBe("unsupported");
    expect(result.reason).toMatch(/planar|NV12|rgba-copy/i);
  } finally {
    globalThis.OffscreenCanvas = previous;
  }
});

it("names processor support without pretending Node has the API", () => {
  const support = nativeTrackObserverSupported();
  expect(["available", "unavailable"]).toContain(support.status);
  if (support.status === "unavailable") expect(support.reason).toMatch(/missing/);
});
