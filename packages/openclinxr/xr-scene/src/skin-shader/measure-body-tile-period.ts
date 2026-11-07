/**
 * Measure the relief period carried by the body detail-normal tile referenced
 * by OPENCLINXR_skin_shade.bodyDetailNormalTexture in the shipped street GLB.
 *
 * The X and Y normal channels are independently mean-removed, multiplied by
 * a separable Hann window, transformed with a 2D FFT, and their powers are
 * summed into unit-width radial-frequency bins. Bin 0 (DC) and bins 1-2 are
 * excluded. Reported peaks are local maxima ordered by radially averaged
 * power, with frequency in cycles per square tile width.
 *
 * Usage from the repository root:
 *   pnpm exec tsx packages/openclinxr/xr-scene/src/skin-shader/measure-body-tile-period.ts
 */

import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";
import { NodeIO } from "@gltf-transform/core";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../../../..");

export const SHIPPED_BODY_TILE_ACTOR = resolve(
  repoRoot,
  "apps/ui-xr/public/generated-humanoids/mpfb-street-adult-male.glb",
);
export const SKIN_SHADE_EXTENSION_NAME = "OPENCLINXR_skin_shade";

type ComplexSignal = { real: Float64Array; imaginary: Float64Array };

type DecodedPng = {
  data: Uint8Array;
  width: number;
  height: number;
  channels: number;
};

export type BodyTileSpectrumPeak = {
  frequencyCyclesPerTile: number;
  power: number;
};

export type BodyTilePeriodMeasurement = {
  actor: string;
  extension: typeof SKIN_SHADE_EXTENSION_NAME;
  textureIndex: number;
  imageSha256: string;
  width: number;
  height: number;
  peaks: readonly [BodyTileSpectrumPeak, BodyTileSpectrumPeak, BodyTileSpectrumPeak];
};

function paethPredictor(left: number, above: number, upperLeft: number): number {
  const prediction = left + above - upperLeft;
  const leftDistance = Math.abs(prediction - left);
  const aboveDistance = Math.abs(prediction - above);
  const upperLeftDistance = Math.abs(prediction - upperLeft);
  if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) return left;
  return aboveDistance <= upperLeftDistance ? above : upperLeft;
}

/** Minimal decoder for the non-interlaced 8-bit RGB/RGBA PNG tiles shipped by this pipeline. */
function decodePng(bytes: Uint8Array): DecodedPng {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (!signature.every((value, index) => bytes[index] === value)) {
    throw new Error("body detail image is not a PNG");
  }
  let width = 0;
  let height = 0;
  let channels = 0;
  const compressedParts: Uint8Array[] = [];
  for (let offset = 8; offset < bytes.length; ) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...bytes.slice(offset + 4, offset + 8));
    const data = bytes.slice(offset + 8, offset + 8 + length);
    offset += 12 + length;
    if (type === "IHDR") {
      width = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(0);
      height = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(4);
      const bitDepth = data[8];
      const colorType = data[9];
      const interlace = data[12];
      channels = colorType === 2 ? 3 : colorType === 6 ? 4 : 0;
      if (bitDepth !== 8 || channels === 0 || interlace !== 0) {
        throw new Error(
          `body detail PNG must be non-interlaced 8-bit RGB/RGBA, received bitDepth=${bitDepth} colorType=${colorType} interlace=${interlace}`,
        );
      }
    } else if (type === "IDAT") {
      compressedParts.push(data);
    } else if (type === "IEND") {
      break;
    }
  }
  if (width === 0 || height === 0 || channels === 0 || compressedParts.length === 0) {
    throw new Error("body detail PNG is missing IHDR or IDAT data");
  }
  const compressedLength = compressedParts.reduce((sum, part) => sum + part.length, 0);
  const compressed = new Uint8Array(compressedLength);
  let compressedOffset = 0;
  for (const part of compressedParts) {
    compressed.set(part, compressedOffset);
    compressedOffset += part.length;
  }
  const filtered = inflateSync(compressed);
  const stride = width * channels;
  if (filtered.length !== (stride + 1) * height) {
    throw new Error(`unexpected PNG scanline byte count ${filtered.length}`);
  }
  const data = new Uint8Array(stride * height);
  for (let y = 0; y < height; y += 1) {
    const filter = filtered[y * (stride + 1)]!;
    for (let x = 0; x < stride; x += 1) {
      const raw = filtered[y * (stride + 1) + 1 + x]!;
      const outputIndex = y * stride + x;
      const left = x >= channels ? data[outputIndex - channels]! : 0;
      const above = y > 0 ? data[outputIndex - stride]! : 0;
      const upperLeft = y > 0 && x >= channels ? data[outputIndex - stride - channels]! : 0;
      if (filter === 0) data[outputIndex] = raw;
      else if (filter === 1) data[outputIndex] = (raw + left) & 255;
      else if (filter === 2) data[outputIndex] = (raw + above) & 255;
      else if (filter === 3) data[outputIndex] = (raw + Math.floor((left + above) / 2)) & 255;
      else if (filter === 4) {
        data[outputIndex] = (raw + paethPredictor(left, above, upperLeft)) & 255;
      } else throw new Error(`unsupported PNG row filter ${filter}`);
    }
  }
  return { data, width, height, channels };
}

function fft(signal: ComplexSignal): void {
  const { real, imaginary } = signal;
  const length = real.length;
  if (length < 2 || (length & (length - 1)) !== 0) {
    throw new Error(`FFT length must be a power of two, received ${length}`);
  }

  for (let index = 1, reversed = 0; index < length; index += 1) {
    let bit = length >> 1;
    while (reversed & bit) {
      reversed ^= bit;
      bit >>= 1;
    }
    reversed ^= bit;
    if (index < reversed) {
      [real[index], real[reversed]] = [real[reversed]!, real[index]!];
      [imaginary[index], imaginary[reversed]] = [imaginary[reversed]!, imaginary[index]!];
    }
  }

  for (let block = 2; block <= length; block *= 2) {
    const angle = (-2 * Math.PI) / block;
    const stepReal = Math.cos(angle);
    const stepImaginary = Math.sin(angle);
    for (let start = 0; start < length; start += block) {
      let twiddleReal = 1;
      let twiddleImaginary = 0;
      for (let offset = 0; offset < block / 2; offset += 1) {
        const even = start + offset;
        const odd = even + block / 2;
        const oddReal =
          real[odd]! * twiddleReal - imaginary[odd]! * twiddleImaginary;
        const oddImaginary =
          real[odd]! * twiddleImaginary + imaginary[odd]! * twiddleReal;
        real[odd] = real[even]! - oddReal;
        imaginary[odd] = imaginary[even]! - oddImaginary;
        real[even] = real[even]! + oddReal;
        imaginary[even] = imaginary[even]! + oddImaginary;
        const nextTwiddleReal =
          twiddleReal * stepReal - twiddleImaginary * stepImaginary;
        twiddleImaginary =
          twiddleReal * stepImaginary + twiddleImaginary * stepReal;
        twiddleReal = nextTwiddleReal;
      }
    }
  }
}

function powerSpectrum2d(
  samples: Float64Array,
  width: number,
  height: number,
): Float64Array {
  const real = samples.slice();
  const imaginary = new Float64Array(samples.length);

  for (let row = 0; row < height; row += 1) {
    const start = row * width;
    const rowReal = real.slice(start, start + width);
    const rowImaginary = imaginary.slice(start, start + width);
    fft({ real: rowReal, imaginary: rowImaginary });
    real.set(rowReal, start);
    imaginary.set(rowImaginary, start);
  }
  for (let column = 0; column < width; column += 1) {
    const columnReal = new Float64Array(height);
    const columnImaginary = new Float64Array(height);
    for (let row = 0; row < height; row += 1) {
      columnReal[row] = real[row * width + column]!;
      columnImaginary[row] = imaginary[row * width + column]!;
    }
    fft({ real: columnReal, imaginary: columnImaginary });
    for (let row = 0; row < height; row += 1) {
      real[row * width + column] = columnReal[row]!;
      imaginary[row * width + column] = columnImaginary[row]!;
    }
  }

  return real.map((value, index) => value * value + imaginary[index]! ** 2);
}

function radialAverage(
  xPower: Float64Array,
  yPower: Float64Array,
  width: number,
  height: number,
): Float64Array {
  const maxBin = Math.floor(Math.hypot(width / 2, height / 2));
  const sums = new Float64Array(maxBin + 1);
  const counts = new Uint32Array(maxBin + 1);
  for (let y = 0; y < height; y += 1) {
    const frequencyY = Math.min(y, height - y);
    for (let x = 0; x < width; x += 1) {
      const frequencyX = Math.min(x, width - x);
      const bin = Math.round(Math.hypot(frequencyX, frequencyY));
      if (bin > maxBin) continue;
      const index = y * width + x;
      sums[bin] = sums[bin]! + xPower[index]! + yPower[index]!;
      counts[bin] = counts[bin]! + 1;
    }
  }
  return sums.map((sum, bin) => (counts[bin] === 0 ? 0 : sum / counts[bin]!));
}

function strongestLocalPeaks(powerByFrequency: Float64Array): BodyTileSpectrumPeak[] {
  const peaks: BodyTileSpectrumPeak[] = [];
  for (let frequency = 3; frequency < powerByFrequency.length - 1; frequency += 1) {
    const power = powerByFrequency[frequency]!;
    if (power > powerByFrequency[frequency - 1]! && power >= powerByFrequency[frequency + 1]!) {
      peaks.push({ frequencyCyclesPerTile: frequency, power });
    }
  }
  return peaks.sort((a, b) => b.power - a.power);
}

async function bodyTileImage(actor: string): Promise<{
  bytes: Uint8Array;
  textureIndex: number;
}> {
  const io = new NodeIO();
  const jsonDocument = await io.readAsJSON(actor);
  const materials = jsonDocument.json.materials ?? [];
  const bodyTextureIndices = materials.flatMap((material) => {
    const extension = (
      material.extensions?.[SKIN_SHADE_EXTENSION_NAME] as
        | { bodyDetailNormalTexture?: { index?: unknown } }
        | undefined
    );
    const index = extension?.bodyDetailNormalTexture?.index;
    return Number.isInteger(index) && (index as number) >= 0 ? [index as number] : [];
  });
  if (bodyTextureIndices.length !== 1) {
    throw new Error(
      `expected exactly one ${SKIN_SHADE_EXTENSION_NAME}.bodyDetailNormalTexture, found ${bodyTextureIndices.length}`,
    );
  }
  const textureIndex = bodyTextureIndices[0]!;
  const imageIndex = jsonDocument.json.textures?.[textureIndex]?.source;
  if (!Number.isInteger(imageIndex)) {
    throw new Error(`body detail texture ${textureIndex} has no core image source`);
  }
  const document = await io.readJSON(jsonDocument);
  const bytes = document.getRoot().listTextures()[imageIndex as number]?.getImage();
  if (!bytes) throw new Error(`body detail image ${imageIndex} has no embedded bytes`);
  return { bytes, textureIndex };
}

export async function measureShippedBodyTilePeriod(
  actor = SHIPPED_BODY_TILE_ACTOR,
): Promise<BodyTilePeriodMeasurement> {
  const { bytes, textureIndex } = await bodyTileImage(actor);
  const decoded = decodePng(bytes);
  const { width, height, channels } = decoded;
  if (width !== height || (width & (width - 1)) !== 0 || channels < 2) {
    throw new Error(
      `body detail tile must be a square power-of-two image with X/Y channels, received ${width}x${height}x${channels}`,
    );
  }

  const channelMeans = [0, 1].map((channel) => {
    let sum = 0;
    for (let pixel = 0; pixel < width * height; pixel += 1) {
      sum += decoded.data[pixel * channels + channel]!;
    }
    return sum / (width * height);
  });
  const channelSamples = [0, 1].map(() => new Float64Array(width * height));
  for (let y = 0; y < height; y += 1) {
    const windowY = 0.5 - 0.5 * Math.cos((2 * Math.PI * y) / (height - 1));
    for (let x = 0; x < width; x += 1) {
      const windowX = 0.5 - 0.5 * Math.cos((2 * Math.PI * x) / (width - 1));
      const pixel = y * width + x;
      for (let channel = 0; channel < 2; channel += 1) {
        channelSamples[channel]![pixel] =
          (decoded.data[pixel * channels + channel]! - channelMeans[channel]!) *
          windowX *
          windowY;
      }
    }
  }

  const radialPower = radialAverage(
    powerSpectrum2d(channelSamples[0]!, width, height),
    powerSpectrum2d(channelSamples[1]!, width, height),
    width,
    height,
  );
  const peaks = strongestLocalPeaks(radialPower);
  if (peaks.length < 3) throw new Error(`body detail spectrum has only ${peaks.length} local peaks`);
  return {
    actor,
    extension: SKIN_SHADE_EXTENSION_NAME,
    textureIndex,
    imageSha256: createHash("sha256").update(bytes).digest("hex"),
    width,
    height,
    peaks: [peaks[0]!, peaks[1]!, peaks[2]!],
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await measureShippedBodyTilePeriod(), null, 2));
}
