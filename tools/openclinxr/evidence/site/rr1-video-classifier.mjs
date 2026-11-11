import { execFileSync } from "node:child_process";

export function rawCrop(input, crop, select) {
  return execFileSync("ffmpeg", [
    "-v", "error", "-i", input,
    "-vf", `select='${select}',crop=${crop.width}:${crop.height}:${crop.x}:${crop.y}`,
    "-vsync", "0", "-f", "rawvideo", "-pix_fmt", "rgb24", "-",
  ], { maxBuffer: 128 * 1024 * 1024 });
}

export function frameAt(video, seconds, crop) {
  const raw = rawCrop(video, crop, `gte(t,${seconds})`);
  return raw.subarray(0, crop.width * crop.height * 3);
}

export function imageCrop(path, crop) {
  return rawCrop(path, crop, "gte(n,0)").subarray(0, crop.width * crop.height * 3);
}

export function meanAbsoluteError(actual, expected) {
  if (actual.length !== expected.length) throw new Error(`crop byte mismatch: ${actual.length} != ${expected.length}`);
  let total = 0;
  for (let index = 0; index < actual.length; index += 1) total += Math.abs((actual[index] ?? 0) - (expected[index] ?? 0));
  return total / actual.length;
}

export function relativeCropMatches(actual, target, alternative, threshold = 10) {
  const targetError = meanAbsoluteError(actual, target);
  const alternativeError = meanAbsoluteError(actual, alternative);
  return {
    alternativeError,
    matches: targetError < threshold && targetError < alternativeError,
    targetError,
    threshold,
  };
}

export function createRr1FrameClassifier({ video, doorwayPanel, encounterPanel, ch5FinalizedCrop, ch5OpenCrop, framePtsSeconds }) {
  const panelPhaseCrop = { x: 20, y: 18, width: 160, height: 22 };
  const videoPhaseCrop = { x: 560, y: 18, width: 160, height: 22 };
  const panelStationCrop = { x: 20, y: 40, width: 160, height: 24 };
  const videoStationCrop = { x: 560, y: 40, width: 160, height: 24 };
  const doorway = imageCrop(doorwayPanel, panelPhaseCrop);
  const encounter = imageCrop(encounterPanel, panelPhaseCrop);
  const station1 = imageCrop(encounterPanel, panelStationCrop);
  const station2 = imageCrop(doorwayPanel, panelStationCrop);
  const learnerTargets = {
    ch1: { phase: doorway, otherPhase: encounter, station: station1, otherStation: station2 },
    ch2: { phase: encounter, otherPhase: doorway, station: station1, otherStation: station2 },
    "rot-doorway": { phase: doorway, otherPhase: encounter, station: station2, otherStation: station1 },
    "rot-encounter": { phase: encounter, otherPhase: doorway, station: station2, otherStation: station1 },
  };
  const ch5Crop = { x: 0, y: 82, width: 250, height: 26 };
  const ch5FixtureCrop = { x: 0, y: 0, width: 250, height: 26 };
  const finalized = imageCrop(ch5FinalizedCrop, ch5FixtureCrop);
  const open = imageCrop(ch5OpenCrop, ch5FixtureCrop);
  const preloaded = framePtsSeconds === undefined ? null : {
    phase: rawCrop(video, videoPhaseCrop, "gte(n,0)"),
    station: rawCrop(video, videoStationCrop, "gte(n,0)"),
    ch5: rawCrop(video, ch5Crop, "gte(n,0)"),
    indexByPts: new Map(framePtsSeconds.map((pts, index) => [pts, index])),
  };
  const videoCropAt = (seconds, crop, key) => {
    const index = preloaded?.indexByPts.get(seconds);
    if (preloaded === null || index === undefined) return frameAt(video, seconds, crop);
    // VP8 yuv420 rounds odd crop heights down before rgb24 conversion. Use
    // the decoded stride, while preserving frameAt's requested-byte slice.
    const decodedFrameBytes = preloaded[key].length / framePtsSeconds.length;
    const requestedFrameBytes = crop.width * crop.height * 3;
    return preloaded[key].subarray(index * decodedFrameBytes, index * decodedFrameBytes + requestedFrameBytes);
  };

  return function readsMarkedState(id, seconds) {
    if (id === "ch5") return relativeCropMatches(videoCropAt(seconds, ch5Crop, "ch5"), finalized, open).matches;
    const target = learnerTargets[id];
    if (target === undefined) throw new Error(`unknown learner chapter ${id}`);
    const phase = videoCropAt(seconds, videoPhaseCrop, "phase");
    const station = videoCropAt(seconds, videoStationCrop, "station");
    const phaseMatch = relativeCropMatches(phase, target.phase, target.otherPhase);
    const stationMatch = relativeCropMatches(station, target.station, target.otherStation);
    return phaseMatch.matches && stationMatch.matches;
  };
}

export function rightmostTextColumn(pixels, crop) {
  const lumas = [];
  for (let index = 0; index < pixels.length; index += 3) {
    lumas.push(0.2126 * (pixels[index] ?? 0) + 0.7152 * (pixels[index + 1] ?? 0) + 0.0722 * (pixels[index + 2] ?? 0));
  }
  const sorted = [...lumas].sort((left, right) => left - right);
  const backgroundLuma = sorted[Math.floor(sorted.length / 2)];
  if (backgroundLuma === undefined) return undefined;
  let rightmost;
  for (let index = 0; index < lumas.length; index += 1) {
    if ((lumas[index] ?? 0) > backgroundLuma + 8) rightmost = Math.max(rightmost ?? -1, index % crop.width);
  }
  return rightmost;
}

export function signoffFrameSeries(video, framePtsSeconds, startSeconds, crop) {
  const selectedPts = framePtsSeconds.filter((pts) => pts >= startSeconds);
  const raw = rawCrop(video, crop, `gte(t,${startSeconds})`);
  const frameBytes = crop.width * crop.height * 3;
  if (raw.length !== selectedPts.length * frameBytes) {
    throw new Error(`signoff frame/PTS mismatch: ${raw.length / frameBytes} decoded frames != ${selectedPts.length} PTS entries`);
  }
  return selectedPts.map((pts, index) => ({
    pts,
    rightmostTextColumn: rightmostTextColumn(raw.subarray(index * frameBytes, (index + 1) * frameBytes), crop),
  }));
}
