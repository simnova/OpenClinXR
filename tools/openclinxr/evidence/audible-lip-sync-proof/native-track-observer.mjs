/** Clone-only MediaStreamTrackProcessor tees. Does not replace MDS/canvas/MediaRecorder audio. */
import { decodeObservedRowMarkerFromRgba } from "./observed-row-barcode.mjs";

export const AUDIO_TIMESTAMP_EPOCH = "audio-data-capture-ticks";
export const VIDEO_TIMESTAMP_EPOCH = "video-frame-relative-first-ticks";

export function nativeTrackObserverSupported() {
  if (typeof MediaStreamTrackProcessor !== "function") return { status: "unavailable", reason: "MediaStreamTrackProcessor-missing" };
  if (typeof AudioData !== "function") return { status: "unavailable", reason: "AudioData-missing" };
  if (typeof VideoFrame !== "function") return { status: "unavailable", reason: "VideoFrame-missing" };
  return { status: "available" };
}

export function copyAudioDataSamples(data) {
  if (!data || typeof data.copyTo !== "function") return { status: "unsupported", reason: "audio-data-copyTo-missing" };
  const frames = data.numberOfFrames;
  const channels = data.numberOfChannels;
  const format = data.format;
  if (!Number.isInteger(frames) || frames <= 0 || !Number.isInteger(channels) || channels <= 0) {
    return { status: "unsupported", reason: "audio-data-layout" };
  }
  try {
    if (format === "f32-planar") {
      const planes = [];
      for (let c = 0; c < channels; c += 1) {
        const plane = new Float32Array(frames);
        data.copyTo(plane, { planeIndex: c });
        planes.push(plane);
      }
      const samples = new Float32Array(frames * channels);
      for (let i = 0; i < frames; i += 1) {
        for (let c = 0; c < channels; c += 1) samples[i * channels + c] = planes[c][i];
      }
      return { status: "available", samples, numberOfFrames: frames, numberOfChannels: channels, format };
    }
    if (format === "f32") {
      const samples = new Float32Array(frames * channels);
      data.copyTo(samples, { planeIndex: 0 });
      return { status: "available", samples, numberOfFrames: frames, numberOfChannels: channels, format };
    }
    if (format === "s16-planar") {
      const samples = new Float32Array(frames * channels);
      for (let c = 0; c < channels; c += 1) {
        const plane = new Int16Array(frames);
        data.copyTo(plane, { planeIndex: c });
        for (let i = 0; i < frames; i += 1) samples[i * channels + c] = plane[i] / 32768;
      }
      return { status: "available", samples, numberOfFrames: frames, numberOfChannels: channels, format };
    }
    if (format === "s16") {
      const raw = new Int16Array(frames * channels);
      data.copyTo(raw, { planeIndex: 0 });
      const samples = new Float32Array(frames * channels);
      for (let i = 0; i < raw.length; i += 1) samples[i] = raw[i] / 32768;
      return { status: "available", samples, numberOfFrames: frames, numberOfChannels: channels, format };
    }
    return { status: "unsupported", reason: "audio-data-format:" + String(format) };
  } catch (error) {
    return { status: "unsupported", reason: error?.name ?? "copyTo-failed" };
  }
}

export function appendAudioObservation(rows, row) {
  if (!row || row.type !== "AudioData" || typeof row.timestamp !== "number" || !Number.isInteger(row.sampleIndex) || row.sampleIndex < 0) {
    throw new Error("native-track-fake-row");
  }
  if (!Number.isInteger(row.numberOfFrames) || row.numberOfFrames <= 0) throw new Error("native-track-fake-row");
  const last = rows.at(-1);
  if (last && row.sampleIndex < last.sampleIndex + last.numberOfFrames) throw new Error("native-track-dedup-or-overlap");
  rows.push(row);
  return row;
}

export function packRgba(bytes, width, height, stride) {
  const packedStride = width * 4;
  if (!bytes || width <= 0 || height <= 0) throw new Error("native-track-video-pixels-missing");
  if (!stride || stride === packedStride) return bytes instanceof Uint8ClampedArray ? new Uint8Array(bytes.buffer, bytes.byteOffset, width * height * 4) : bytes;
  const packed = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) packed.set(bytes.subarray(y * stride, y * stride + packedStride), y * packedStride);
  return packed;
}

export function videoFrameMetadataFacts(frame) {
  const instanceFields = {};
  for (const key of ["captureTime", "receiveTime", "rtpTimestamp"]) {
    instanceFields[key] = frame && key in frame && frame[key] != null ? { available: true, value: frame[key] } : { available: false };
  }
  let metadataMethod = { available: false };
  if (frame && typeof frame.metadata === "function") {
    try { metadataMethod = { available: true, value: frame.metadata() }; }
    catch (error) { metadataMethod = { available: true, error: error?.name ?? "metadata-failed" }; }
  }
  return { instanceFields, metadataMethod };
}

function bgraToRgba(bytes) {
  const out = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i += 4) {
    out[i] = bytes[i + 2];
    out[i + 1] = bytes[i + 1];
    out[i + 2] = bytes[i];
    out[i + 3] = bytes[i + 3];
  }
  return out;
}

export async function videoFrameToPackedRgba(frame) {
  const width = frame.displayWidth || frame.codedWidth;
  const height = frame.displayHeight || frame.codedHeight;
  const format = frame.format;
  if (typeof OffscreenCanvas === "function") {
    try {
      const canvas = new OffscreenCanvas(width, height);
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(frame, 0, 0, width, height);
      const image = ctx.getImageData(0, 0, width, height);
      return { status: "available", rgba: new Uint8Array(image.data), width, height, format, path: "offscreen-drawImage" };
    } catch {
      /* copyTo fallback */
    }
  }
  if (typeof frame.copyTo !== "function") return { status: "unsupported", reason: "video-frame-pixel-copy:" + String(format) };
  const packedRgb = format === "RGBA" || format === "RGBX" || format === "BGRA" || format === "BGRX";
  try {
    const copyFormat = packedRgb ? undefined : "RGBA";
    const size = typeof frame.allocationSize === "function"
      ? (copyFormat ? frame.allocationSize({ format: copyFormat }) : frame.allocationSize())
      : width * height * 4;
    const buf = new Uint8Array(size);
    const layout = await Promise.resolve(copyFormat ? frame.copyTo(buf, { format: copyFormat }) : frame.copyTo(buf));
    const plane = Array.isArray(layout) ? layout[0] : null;
    const stride = plane?.stride ?? width * 4;
    const offset = plane?.offset ?? 0;
    let packed = packRgba(buf.subarray(offset), width, height, stride);
    if ((copyFormat ?? format) === "BGRA" || format === "BGRA" || format === "BGRX") packed = bgraToRgba(packed);
    return { status: "available", rgba: packed, width, height, format, path: copyFormat ? "copyTo-RGBA" : "copyTo" };
  } catch (error) {
    if (!packedRgb) return { status: "unsupported", reason: "video-frame-planar:" + String(format) };
    return { status: "unsupported", reason: String(error?.message ?? error) };
  }
}

export function classifyVideoMarker(rgba, width, height) {
  try {
    const decoded = decodeObservedRowMarkerFromRgba(rgba, width, height);
    return { kind: "marked", decoded };
  } catch (error) {
    const message = String(error?.message ?? error);
    if (message.includes("row-barcode-missing")) return { kind: "unmarked" };
    return { kind: "excluded-checksum" };
  }
}

export function float32ToBase64(samples) {
  const bytes = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength);
  let binary = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) binary += String.fromCharCode(...bytes.subarray(i, i + step));
  return btoa(binary);
}

function concatF32(chunks) {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Float32Array(total);
  let offset = 0;
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.length; }
  return out;
}

export function startNativeTrackObserver({ audioTrack, videoTrack, readClock } = {}) {
  const support = nativeTrackObserverSupported();
  const createdAtMs = typeof performance !== "undefined" ? performance.now() : 0;
  if (support.status !== "available") {
    return {
      status: support.status,
      reason: support.reason,
      createdAtMs,
      async stop() { return { status: support.status, reason: support.reason, audioRows: [], videoRows: [], samples: new Float32Array(0) }; },
    };
  }
  if (!audioTrack || typeof audioTrack.clone !== "function" || !videoTrack || typeof videoTrack.clone !== "function") {
    return {
      status: "unavailable",
      reason: "track-clone-missing",
      createdAtMs,
      async stop() { return { status: "unavailable", reason: "track-clone-missing", audioRows: [], videoRows: [], samples: new Float32Array(0) }; },
    };
  }
  const audioClone = audioTrack.clone();
  const videoClone = videoTrack.clone();
  const cloneCreatedAtMs = typeof performance !== "undefined" ? performance.now() : 0;
  const graphClockAtClone = readClock?.() ?? null;
  let audioProcessor;
  let videoProcessor;
  try {
    audioProcessor = new MediaStreamTrackProcessor({ track: audioClone });
    videoProcessor = new MediaStreamTrackProcessor({ track: videoClone });
  } catch (error) {
    audioClone.stop();
    videoClone.stop();
    return {
      status: "unavailable",
      reason: error?.name ?? "MediaStreamTrackProcessor-construct",
      createdAtMs,
      async stop() { return { status: "unavailable", reason: error?.name ?? "MediaStreamTrackProcessor-construct", audioRows: [], videoRows: [], samples: new Float32Array(0) }; },
    };
  }
  const audioReader = audioProcessor.readable.getReader();
  const videoReader = videoProcessor.readable.getReader();
  const processorReadStartAtMs = typeof performance !== "undefined" ? performance.now() : 0;
  const state = {
    stopped: false,
    audioRows: [],
    videoRows: [],
    pcmChunks: [],
    observedSampleIndex: 0,
    pcmFrameCount: 0,
    audioClosed: 0,
    videoClosed: 0,
    audioCopyFailures: 0,
    videoCopyFailures: 0,
  };

  async function pumpAudio() {
    while (!state.stopped) {
      const before = typeof performance !== "undefined" ? performance.now() : 0;
      const read = await audioReader.read();
      const after = typeof performance !== "undefined" ? performance.now() : 0;
      if (read.done) break;
      const value = read.value;
      try {
        const copy = copyAudioDataSamples(value);
        const row = {
          type: "AudioData",
          timestamp: value.timestamp,
          timestampEpoch: AUDIO_TIMESTAMP_EPOCH,
          timestampMeaning: "mds-consumption-fifo-delivery",
          format: value.format,
          numberOfChannels: value.numberOfChannels,
          numberOfFrames: value.numberOfFrames,
          sampleRate: value.sampleRate,
          sampleIndex: state.observedSampleIndex,
          pcmFrameOffset: copy.status === "available" ? state.pcmFrameCount : null,
          readPerformanceBeforeMs: before,
          readPerformanceAfterMs: after,
          graphClock: readClock?.() ?? null,
          copyStatus: copy.status,
          copyReason: copy.reason ?? null,
        };
        appendAudioObservation(state.audioRows, row);
        state.observedSampleIndex += value.numberOfFrames;
        if (copy.status === "available") {
          state.pcmChunks.push(copy.samples);
          state.pcmFrameCount += value.numberOfFrames;
        } else {
          state.audioCopyFailures += 1;
        }
      } finally {
        value.close();
        state.audioClosed += 1;
      }
    }
  }

  async function pumpVideo() {
    while (!state.stopped) {
      const before = typeof performance !== "undefined" ? performance.now() : 0;
      const read = await videoReader.read();
      const after = typeof performance !== "undefined" ? performance.now() : 0;
      if (read.done) break;
      const value = read.value;
      try {
        const pixels = await videoFrameToPackedRgba(value);
        const marker = pixels.status === "available" ? classifyVideoMarker(pixels.rgba, pixels.width, pixels.height) : { kind: "unmarked" };
        if (pixels.status !== "available") state.videoCopyFailures += 1;
        state.videoRows.push({
          type: "VideoFrame",
          timestamp: value.timestamp,
          timestampEpoch: VIDEO_TIMESTAMP_EPOCH,
          duration: value.duration ?? null,
          format: value.format,
          codedWidth: value.codedWidth ?? null,
          codedHeight: value.codedHeight ?? null,
          displayWidth: value.displayWidth ?? null,
          displayHeight: value.displayHeight ?? null,
          metadata: videoFrameMetadataFacts(value),
          markerKind: marker.kind,
          decoded: marker.kind === "marked" ? marker.decoded : null,
          readPerformanceBeforeMs: before,
          readPerformanceAfterMs: after,
          graphClock: readClock?.() ?? null,
          pixelCopyStatus: pixels.status,
        });
      } finally {
        value.close();
        state.videoClosed += 1;
      }
    }
  }

  let audioPumpError = null;
  let videoPumpError = null;
  const audioPump = pumpAudio().catch((error) => { audioPumpError = String(error?.message ?? error); });
  const videoPump = pumpVideo().catch((error) => { videoPumpError = String(error?.message ?? error); });

  return {
    status: "available",
    createdAtMs,
    cloneCreatedAtMs,
    processorReadStartAtMs,
    graphClockAtClone,
    originalAudioTrackId: audioTrack.id,
    originalVideoTrackId: videoTrack.id,
    cloneAudioTrackId: audioClone.id,
    cloneVideoTrackId: videoClone.id,
    async stop() {
      if (state.stopped) {
        return { status: "available", audioRows: state.audioRows, videoRows: state.videoRows, samples: concatF32(state.pcmChunks) };
      }
      state.stopped = true;
      await audioReader.cancel().catch(() => undefined);
      await videoReader.cancel().catch(() => undefined);
      await Promise.allSettled([audioPump, videoPump]);
      audioClone.stop();
      videoClone.stop();
      const samples = concatF32(state.pcmChunks);
      return {
        status: audioPumpError || videoPumpError ? "error" : "available",
        audioPumpError,
        videoPumpError,
        cloneAudioReadyState: audioClone.readyState,
        cloneVideoReadyState: videoClone.readyState,
        createdAtMs,
        cloneCreatedAtMs,
        processorReadStartAtMs,
        graphClockAtClone,
        originalAudioTrackId: audioTrack.id,
        originalVideoTrackId: videoTrack.id,
        cloneAudioTrackId: audioClone.id,
        cloneVideoTrackId: videoClone.id,
        originalAudioReadyState: audioTrack.readyState,
        originalVideoReadyState: videoTrack.readyState,
        audioRows: state.audioRows,
        videoRows: state.videoRows,
        audioClosed: state.audioClosed,
        videoClosed: state.videoClosed,
        audioCopyFailures: state.audioCopyFailures,
        videoCopyFailures: state.videoCopyFailures,
        audioFramesObserved: state.audioRows.length,
        videoFramesObserved: state.videoRows.length,
        sampleCount: samples.length,
        samples,
      };
    },
  };
}
