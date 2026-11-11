import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { inflateSync } from "node:zlib";
import { expect, it } from "vitest";
import { checkGrades } from "./check-grades.js";

// W0 artifact test: reads the STORE capture.json written by
// tools/openclinxr/evidence/site/capture/w0-still.mjs and asserts checklist
// A1-A6 and A8. A7 is the sonnet pre-screen (not in this file); A7' below is
// the pixel counterweight from the W0 brief. A4 is n/a for a single settled
// frame (see its it block).

const W0_ROOT = "/Volumes/files/openclinxr-assets/store/site-reimagine/w0";
const PNG_MAGIC = [137, 80, 78, 71, 13, 10, 26, 10];
const G4_PATTERNS = [/Trace \d+\/\d+/, /WebXR unavailable/, /local-only fallback/];

interface StillRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface StillEntry {
  file: string;
  sha256: string;
  bytes: number;
  innerText: string;
  bbox: StillRect;
  frameHeight: number;
}

interface HiddenSelectorEntry {
  selector: string;
  source: string;
  count: number;
  rects: StillRect[];
}

interface ProtectedEntry {
  selector: string;
  source: string;
  count: number;
  visibleInControl: boolean;
  visibleInProof: boolean;
}

interface CaptureRecord {
  buildSha: string;
  seed: string;
  blueprintId: string;
  cameraPreset: string;
  clientRoles: string[];
  ffmpeg: { version: unknown; args: unknown };
  stills: StillEntry[];
  presentationCss: string;
  gpuArgs: string[];
  hiddenSelectors: HiddenSelectorEntry[];
  protected: ProtectedEntry[];
  canvasRect: StillRect;
  viewport: { width: number; height: number };
  excludedFraction: number;
  comparedPixels: number;
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    throw new Error(`bad ${label}: not an object`);
  }
  return value as Record<string, unknown>;
}

function asRect(value: unknown, label: string): StillRect {
  const row = asRecord(value, label);
  for (const key of ["x", "y", "width", "height"] as const) {
    if (typeof row[key] !== "number") {
      throw new Error(`bad ${label}: ${key} is not a number`);
    }
  }
  return { x: row["x"] as number, y: row["y"] as number, width: row["width"] as number, height: row["height"] as number };
}

function readCapture(): CaptureRecord {
  const raw = readFileSync(path.join(W0_ROOT, "capture.json"), "utf8");
  const root = asRecord(JSON.parse(raw) as unknown, "capture.json");
  const stillsRaw = root["stills"];
  if (Array.isArray(stillsRaw) === false) {
    throw new Error("bad capture.json: stills is not an array");
  }
  const stills: StillEntry[] = (stillsRaw as unknown[]).map((entry, index) => {
    const row = asRecord(entry, `stills[${index}]`);
    if (typeof row["file"] !== "string" || typeof row["sha256"] !== "string") {
      throw new Error(`bad stills[${index}]: file/sha256`);
    }
    if (typeof row["bytes"] !== "number" || typeof row["innerText"] !== "string") {
      throw new Error(`bad stills[${index}]: bytes/innerText`);
    }
    if (typeof row["frameHeight"] !== "number") {
      throw new Error(`bad stills[${index}]: frameHeight`);
    }
    return {
      file: row["file"] as string,
      sha256: row["sha256"] as string,
      bytes: row["bytes"] as number,
      innerText: row["innerText"] as string,
      bbox: asRect(row["bbox"], `stills[${index}].bbox`),
      frameHeight: row["frameHeight"] as number,
    };
  });
  const hiddenRaw = root["hiddenSelectors"];
  if (Array.isArray(hiddenRaw) === false) {
    throw new Error("bad capture.json: hiddenSelectors is not an array");
  }
  const hiddenSelectors: HiddenSelectorEntry[] = (hiddenRaw as unknown[]).map((entry, index) => {
    const row = asRecord(entry, `hiddenSelectors[${index}]`);
    if (typeof row["selector"] !== "string" || typeof row["source"] !== "string" || typeof row["count"] !== "number") {
      throw new Error(`bad hiddenSelectors[${index}]`);
    }
    const rectsRaw = row["rects"];
    if (Array.isArray(rectsRaw) === false) {
      throw new Error(`bad hiddenSelectors[${index}].rects`);
    }
    return {
      selector: row["selector"] as string,
      source: row["source"] as string,
      count: row["count"] as number,
      rects: (rectsRaw as unknown[]).map((rect, retry) => asRect(rect, `hiddenSelectors[${index}].rects[${retry}]`)),
    };
  });
  for (const key of ["buildSha", "seed", "blueprintId", "cameraPreset"] as const) {
    if (typeof root[key] !== "string" || (root[key] as string) === "") {
      throw new Error(`bad capture.json: ${key} missing`);
    }
  }
  if (Array.isArray(root["clientRoles"]) === false) {
    throw new Error("bad capture.json: clientRoles is not an array");
  }
  const ffmpegRow = asRecord(root["ffmpeg"], "ffmpeg");
  const protectedRaw = root["protected"];
  if (Array.isArray(protectedRaw) === false) {
    throw new Error("bad capture.json: protected is not an array");
  }
  const protectedEntries: ProtectedEntry[] = (protectedRaw as unknown[]).map((entry, index) => {
    const row = asRecord(entry, `protected[${index}]`);
    if (typeof row["selector"] !== "string" || typeof row["source"] !== "string") {
      throw new Error(`bad protected[${index}]: selector/source`);
    }
    if (typeof row["count"] !== "number" || typeof row["visibleInControl"] !== "boolean" || typeof row["visibleInProof"] !== "boolean") {
      throw new Error(`bad protected[${index}]: count/visibility`);
    }
    return {
      selector: row["selector"] as string,
      source: row["source"] as string,
      count: row["count"] as number,
      visibleInControl: row["visibleInControl"] as boolean,
      visibleInProof: row["visibleInProof"] as boolean,
    };
  });
  const viewportRow = asRecord(root["viewport"], "viewport");
  if (typeof viewportRow["width"] !== "number" || typeof viewportRow["height"] !== "number") {
    throw new Error("bad capture.json: viewport");
  }
  return {
    buildSha: root["buildSha"] as string,
    seed: root["seed"] as string,
    blueprintId: root["blueprintId"] as string,
    cameraPreset: root["cameraPreset"] as string,
    clientRoles: root["clientRoles"] as string[],
    ffmpeg: { version: ffmpegRow["version"], args: ffmpegRow["args"] },
    stills,
    presentationCss: typeof root["presentationCss"] === "string" ? (root["presentationCss"] as string) : "",
    gpuArgs: Array.isArray(root["gpuArgs"]) ? (root["gpuArgs"] as string[]) : [],
    hiddenSelectors,
    protected: protectedEntries,
    canvasRect: asRect(root["canvasRect"], "canvasRect"),
    viewport: { width: viewportRow["width"] as number, height: viewportRow["height"] as number },
    excludedFraction: typeof root["excludedFraction"] === "number" ? (root["excludedFraction"] as number) : Number.NaN,
    comparedPixels: typeof root["comparedPixels"] === "number" ? (root["comparedPixels"] as number) : -1,
  };
}

function g4Found(text: string): string[] {
  return G4_PATTERNS.filter((pattern) => pattern.test(text)).map((pattern) => pattern.source);
}

function stillBytes(entry: StillEntry): Buffer {
  return readFileSync(path.join(W0_ROOT, entry.file));
}

interface DecodedPng {
  width: number;
  height: number;
  rgba: Buffer;
}

function paethPredictor(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) {
    return a;
  }
  if (pb <= pc) {
    return b;
  }
  return c;
}

// Minimal PNG decoder for the A7' counterweight: 8-bit RGB/RGBA,
// non-interlaced only; anything else is refused (no new dependency).
function decodePng(bytes: Buffer): DecodedPng {
  for (let i = 0; i < PNG_MAGIC.length; i += 1) {
    if (bytes[i] !== PNG_MAGIC[i]) {
      throw new Error("refusing non-PNG bytes");
    }
  }
  let pos = 8;
  let width = -1;
  let height = -1;
  let bitDepth = -1;
  let colorType = -1;
  let interlace = -1;
  const idat: Buffer[] = [];
  while (pos + 8 <= bytes.length) {
    const length = bytes.readUInt32BE(pos);
    const type = bytes.toString("ascii", pos + 4, pos + 8);
    const data = bytes.subarray(pos + 8, pos + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === "IDAT") {
      idat.push(Buffer.from(data));
    } else if (type === "IEND") {
      break;
    }
    pos += 12 + length;
  }
  if (width <= 0 || height <= 0) {
    throw new Error("refusing PNG without IHDR size");
  }
  if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6) || interlace !== 0) {
    throw new Error(`refusing PNG bitDepth=${bitDepth} colorType=${colorType} interlace=${interlace}`);
  }
  const channels = colorType === 6 ? 4 : 3;
  const stride = width * channels;
  const raw = inflateSync(Buffer.concat(idat));
  if (raw.length < height * (stride + 1)) {
    throw new Error("refusing truncated PNG data");
  }
  const rgba = Buffer.alloc(width * height * 4);
  let prev = Buffer.alloc(stride);
  let offset = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[offset];
    offset += 1;
    if (filter < 0 || filter > 4) {
      throw new Error(`refusing unknown PNG filter ${filter}`);
    }
    const row = Buffer.alloc(stride);
    for (let x = 0; x < stride; x += 1) {
      const filt = raw[offset + x];
      const a = x >= channels ? row[x - channels] : 0;
      const b = prev[x];
      const c = x >= channels ? prev[x - channels] : 0;
      let value = filt;
      if (filter === 1) {
        value = filt + a;
      } else if (filter === 2) {
        value = filt + b;
      } else if (filter === 3) {
        value = filt + Math.floor((a + b) / 2);
      } else if (filter === 4) {
        value = filt + paethPredictor(a, b, c);
      }
      row[x] = value & 0xff;
    }
    offset += stride;
    for (let x = 0; x < width; x += 1) {
      const dest = (y * width + x) * 4;
      rgba[dest] = row[x * channels];
      rgba[dest + 1] = row[x * channels + 1];
      rgba[dest + 2] = row[x * channels + 2];
      rgba[dest + 3] = channels === 4 ? row[x * channels + 3] : 255;
    }
    prev = row;
  }
  return { width, height, rgba };
}

interface A7Outcome {
  comparedPixels: number;
  ambient: number;
  proofDiff: number;
  proofStddev: number;
  pass: boolean;
}

function insideAny(rects: StillRect[], x: number, y: number): boolean {
  return rects.some((rect) => x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height);
}

// A7' counterweight: inside the given region (STEER 2: the canvas rect),
// excluding the recorded hidden-selector rects, the proof must match
// control-a within the ambient control-a/control-b variation, and the proof
// must be non-blank.
function checkA7(controlA: DecodedPng, controlB: DecodedPng, proof: DecodedPng, bbox: StillRect, exclude: StillRect[]): A7Outcome {
  if (controlA.width !== controlB.width || controlA.height !== controlB.height || controlA.width !== proof.width || controlA.height !== proof.height) {
    throw new Error("refusing A7' on mismatched still sizes");
  }
  let ambient = 0;
  let proofDiff = 0;
  let sum = 0;
  let sumSq = 0;
  let samples = 0;
  let pixels = 0;
  for (let y = bbox.y; y < bbox.y + bbox.height; y += 1) {
    for (let x = bbox.x; x < bbox.x + bbox.width; x += 1) {
      if (x < 0 || y < 0 || x >= proof.width || y >= proof.height) {
        continue;
      }
      if (insideAny(exclude, x, y)) {
        continue;
      }
      pixels += 1;
      for (let c = 0; c < 3; c += 1) {
        const at = (y * proof.width + x) * 4 + c;
        const va = controlA.rgba[at];
        const vb = controlB.rgba[at];
        const vp = proof.rgba[at];
        const drift = Math.abs(va - vb);
        if (drift > ambient) {
          ambient = drift;
        }
        const delta = Math.abs(vp - va);
        if (delta > proofDiff) {
          proofDiff = delta;
        }
        sum += vp;
        sumSq += vp * vp;
        samples += 1;
      }
    }
  }
  const mean = samples > 0 ? sum / samples : 0;
  const variance = samples > 0 ? sumSq / samples - mean * mean : 0;
  const proofStddev = Math.sqrt(Math.max(0, variance));
  return { comparedPixels: pixels, ambient, proofDiff, proofStddev, pass: pixels > 0 && proofDiff <= ambient && proofStddev > 0 };
}

it("A1 capture.json holds every A1 field non-null except ffmpeg", () => {
  const capture = readCapture();
  expect(capture.buildSha.length).toBeGreaterThan(0);
  expect(capture.seed.length).toBeGreaterThan(0);
  expect(capture.blueprintId.length).toBeGreaterThan(0);
  expect(capture.cameraPreset.length).toBeGreaterThan(0);
  expect(capture.clientRoles.length).toBeGreaterThan(0);
  expect("version" in capture.ffmpeg).toBe(true);
  expect("args" in capture.ffmpeg).toBe(true);
  expect(capture.presentationCss.length).toBeGreaterThan(0);
  expect(capture.gpuArgs.length).toBeGreaterThan(0);
  expect(capture.viewport.width).toBe(960);
  expect(capture.viewport.height).toBe(600);
  expect(capture.stills).toHaveLength(3);
});

it("A2 w0-proof innerText holds none of the G4 strings", () => {
  const capture = readCapture();
  const proof = capture.stills[2];
  if (proof === undefined) {
    throw new Error("missing w0-proof still");
  }
  expect(g4Found(proof.innerText)).toEqual([]);
});

it("KNOWN-GOOD control innerText shows at least one G4 string, so the detector is live", () => {
  const capture = readCapture();
  const control = capture.stills[0];
  if (control === undefined) {
    throw new Error("missing control-a still");
  }
  expect(g4Found(control.innerText).length).toBeGreaterThan(0);
});

it("A3 w0-proof subject bbox height is at least 10 percent of frame height", () => {
  const capture = readCapture();
  const proof = capture.stills[2];
  if (proof === undefined) {
    throw new Error("missing w0-proof still");
  }
  expect(proof.bbox.height).toBeGreaterThanOrEqual(0.1 * proof.frameHeight);
});

it("A4 single still: no adjacent samples, one settled frame across all three stills", () => {
  // The brief's "assert stills.length is 2" contradicts S2's three stills
  // (control-a, control-b, w0-proof) and the sha256-for-all-three rule, so
  // this asserts the S2 shape and the single-frame property instead: a jump
  // limit is n/a, recorded as "A4 n/a: no adjacent samples" in RESULT.
  const raw = readFileSync(path.join(W0_ROOT, "capture.json"), "utf8");
  const root = asRecord(JSON.parse(raw) as unknown, "capture.json");
  const capture = readCapture();
  expect(capture.stills).toHaveLength(3);
  const phases = new Set((root["stills"] as unknown[]).map((entry) => asRecord(entry, "still")["serverPhase"]));
  const counts = new Set((root["stills"] as unknown[]).map((entry) => asRecord(entry, "still")["humanoidCount"]));
  expect(phases.size).toBe(1);
  expect(counts.size).toBe(1);
});

it("A5 w0-proof bytes fit the hero-poster ceiling", () => {
  const capture = readCapture();
  const proof = capture.stills[2];
  if (proof === undefined) {
    throw new Error("missing w0-proof still");
  }
  expect(proof.bytes).toBeLessThanOrEqual(300000);
  const media = asRecord(JSON.parse(readFileSync(path.join(process.cwd(), "docs", "site", "data", "media.json"), "utf8")) as unknown, "media.json");
  const slots = media["slots"];
  if (Array.isArray(slots) === false) {
    throw new Error("bad media.json: slots is not an array");
  }
  const hero = (slots as unknown[]).map((slot) => asRecord(slot, "slot")).find((slot) => slot["id"] === "hero-poster");
  expect(hero?.["ceilingBytes"]).toBe(300000);
});

it("A6 the proof is a PNG still and the media slot carries no audio", () => {
  const capture = readCapture();
  const proof = capture.stills[2];
  if (proof === undefined) {
    throw new Error("missing w0-proof still");
  }
  const bytes = stillBytes(proof);
  for (let i = 0; i < PNG_MAGIC.length; i += 1) {
    expect(bytes[i]).toBe(PNG_MAGIC[i]);
  }
  const media = asRecord(JSON.parse(readFileSync(path.join(process.cwd(), "docs", "site", "data", "media.json"), "utf8")) as unknown, "media.json");
  const slots = media["slots"];
  if (Array.isArray(slots) === false) {
    throw new Error("bad media.json: slots is not an array");
  }
  const hero = (slots as unknown[]).map((slot) => asRecord(slot, "slot")).find((slot) => slot["id"] === "hero-poster");
  expect(hero?.["audio"]).toBe(false);
});

it("A8 graded docs copy passes checkGrades, else the still stays STORE-only", async () => {
  const docsCopy = path.join(process.cwd(), "docs", "site", "media", "w0-proof.png");
  if (existsSync(docsCopy)) {
    expect(await checkGrades(process.cwd())).toEqual([]);
  } else {
    const capture = readCapture();
    const proof = capture.stills[2];
    if (proof === undefined) {
      throw new Error("missing w0-proof still");
    }
    expect(existsSync(path.join(W0_ROOT, proof.file))).toBe(true);
  }
});

it("sha256 in capture.json equals the file bytes for all three stills", () => {
  const capture = readCapture();
  for (const still of capture.stills) {
    const actual = createHash("sha256").update(stillBytes(still)).digest("hex");
    expect(actual).toBe(still.sha256);
  }
});

it("protected capability UI visible in control-a stays visible in w0-proof", () => {
  const capture = readCapture();
  const hidden = capture.protected.filter((entry) => entry.visibleInControl && !entry.visibleInProof);
  expect(hidden.map((entry) => entry.selector)).toEqual([]);
});

it("A7 prime counterweight: proof matches control-a within ambient and is non-blank", () => {
  const capture = readCapture();
  const controlA = capture.stills[0];
  const controlB = capture.stills[1];
  const proof = capture.stills[2];
  if (controlA === undefined || controlB === undefined || proof === undefined) {
    throw new Error("missing stills");
  }
  // STEER 2 G4: the counterweight covers the canvas rect minus the recorded
  // hidden-chrome rects, so it speaks for the still (not just the subject box).
  const exclude = capture.hiddenSelectors.flatMap((entry) => entry.rects);
  const outcome = checkA7(decodePng(stillBytes(controlA)), decodePng(stillBytes(controlB)), decodePng(stillBytes(proof)), capture.canvasRect, exclude);
  expect(outcome.comparedPixels).toBeGreaterThan(0);
  expect(outcome.proofDiff).toBeLessThanOrEqual(outcome.ambient);
  expect(outcome.proofStddev).toBeGreaterThan(0);
  expect(outcome.pass).toBe(true);
  expect(capture.comparedPixels).toBeGreaterThan(0);
});

it("PROBE red: a flat-filled w0-proof bbox copy fails the A7 prime check", () => {
  const capture = readCapture();
  const controlA = capture.stills[0];
  const controlB = capture.stills[1];
  const proof = capture.stills[2];
  if (controlA === undefined || controlB === undefined || proof === undefined) {
    throw new Error("missing stills");
  }
  const sandbox = mkdtempSync(path.join(tmpdir(), "w0-probe-"));
  for (const still of capture.stills) {
    writeFileSync(path.join(sandbox, path.basename(still.file)), stillBytes(still));
  }
  const decoded = decodePng(readFileSync(path.join(sandbox, path.basename(proof.file))));
  const filled = Buffer.from(decoded.rgba);
  // Simulate a hidden canvas: flat-fill the compared (canvas) region.
  const region = capture.canvasRect;
  for (let y = region.y; y < region.y + region.height; y += 1) {
    for (let x = region.x; x < region.x + region.width; x += 1) {
      if (x < 0 || y < 0 || x >= decoded.width || y >= decoded.height) {
        continue;
      }
      const at = (y * decoded.width + x) * 4;
      filled[at] = 128;
      filled[at + 1] = 128;
      filled[at + 2] = 128;
      filled[at + 3] = 255;
    }
  }
  const exclude = capture.hiddenSelectors.flatMap((entry) => entry.rects);
  const outcome = checkA7(decodePng(stillBytes(controlA)), decodePng(stillBytes(controlB)), { width: decoded.width, height: decoded.height, rgba: filled }, capture.canvasRect, exclude);
  expect(outcome.pass).toBe(false);
});

it("PROBE green: the real stills pass the A7 prime check", () => {
  const capture = readCapture();
  const controlA = capture.stills[0];
  const controlB = capture.stills[1];
  const proof = capture.stills[2];
  if (controlA === undefined || controlB === undefined || proof === undefined) {
    throw new Error("missing stills");
  }
  const exclude = capture.hiddenSelectors.flatMap((entry) => entry.rects);
  const outcome = checkA7(decodePng(stillBytes(controlA)), decodePng(stillBytes(controlB)), decodePng(stillBytes(proof)), capture.canvasRect, exclude);
  expect(outcome.pass).toBe(true);
});

// STEER 2 item 3: evaluate a CSS rule set against the recorded protected
// elements without a browser. A protected selector counts as hidden by the
// CSS when some rule's selector list names it exactly.
function cssHiddenSelectors(cssText: string): string[] {
  const found = new Set<string>();
  const rulePattern = /([^{}]+)\{[^}]*\}/g;
  let match = rulePattern.exec(cssText);
  while (match !== null) {
    const head = match[1] ?? "";
    for (const part of head.split(",")) {
      const selector = part.trim();
      if (selector !== "") {
        found.add(selector);
      }
    }
    match = rulePattern.exec(cssText);
  }
  return [...found];
}

function protectionViolations(cssText: string, entries: ProtectedEntry[]): string[] {
  const hidden = new Set(cssHiddenSelectors(cssText));
  return entries.filter((entry) => entry.visibleInControl && hidden.has(entry.selector)).map((entry) => entry.selector);
}

it("PROBE css-tamper: a protected rule added to a css copy reds the protection check", () => {
  const capture = readCapture();
  const cssPath = path.join(process.cwd(), capture.presentationCss);
  const shipped = readFileSync(cssPath, "utf8");
  const tampered = `${shipped}\n#room-countdown { display: none; }\n`;
  expect(protectionViolations(tampered, capture.protected)).toEqual(["#room-countdown"]);
});

it("PROBE css restore: the shipped css keeps the protection check green", () => {
  const capture = readCapture();
  const cssPath = path.join(process.cwd(), capture.presentationCss);
  const shipped = readFileSync(cssPath, "utf8");
  expect(protectionViolations(shipped, capture.protected)).toEqual([]);
});

it("a throw before the server is up exits the process non-zero within 5 s", () => {
  // STEER 2 item 6: the run-1 heartbeat stayed referenced, so a pre-server
  // failure never let the loop drain. The interval is unref'd, so any early
  // throw must exit fast instead of hanging.
  const script = path.join(process.cwd(), "tools", "openclinxr", "evidence", "site", "capture", "w0-still.mjs");
  let status: number | null = null;
  let timedOut = false;
  try {
    execFileSync("node", [script], { timeout: 5000, encoding: "utf8" });
  } catch (error) {
    const failure = error as { status?: unknown; code?: unknown };
    status = typeof failure.status === "number" ? failure.status : null;
    timedOut = failure.code === "ETIMEDOUT";
  }
  expect(timedOut).toBe(false);
  expect(status).toBe(1);
});
