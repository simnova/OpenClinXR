import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { brotliCompressSync, brotliDecompressSync } from "node:zlib";
import type { ControlFraming } from "./kevin-collar-control-fixture.js";
import { type Box, type HeldOutFixture, heldSize, pixels, readJson } from "./kevin-collar-probes.js";

type Manifest = { sha256: string; owners?: string[] };
const digest = (data: Buffer) => createHash("sha256").update(data).digest("hex");

export function writeFixture(path: string, payload: Buffer, owners?: string[], packed = true) {
  writeFileSync(path, packed ? brotliCompressSync(payload) : payload, { flag: "wx" });
  writeFileSync(`${path}.sha256.json`, JSON.stringify({ sha256: digest(payload), owners }), { flag: "wx" });
}

export function readFixture(path: string, packed = true) {
  const manifest = readJson<Manifest>(`${path}.sha256.json`);
  let payload: Buffer = readFileSync(path);
  if (packed) {
    const result = brotliDecompressSync(payload, { info: true }) as unknown as {
      buffer: Buffer;
      engine: { bytesWritten: number };
    };
    if (result.engine.bytesWritten !== payload.length) throw new Error(`Trailing Brotli bytes in ${path}`);
    payload = result.buffer;
  }
  if (digest(payload) !== manifest.sha256) throw new Error(`SHA-256 mismatch in ${path}`);
  return { payload, owners: new Set(manifest.owners) };
}

type CaptureView = "front" | "threeQuarter";
type Site = { box: Box; stride: number; hiddenCount: number; hiddenSha256?: string };
type Garment = { box: Box; stride: number; count: number; sha256: string };

export const sides = { front: "front", threeQuarter: "three_quarter" } as const;
export const captures = ["front", "threeQuarter"] as const;
export const views = ["front", "three_quarter"] as const;
export const fixture = <T>(name: string) => readJson<T>(fileURLToPath(new URL(name, import.meta.url)));
export const readPreFix = () => fixture<{
  sites: Record<string, Record<CaptureView, Site>>;
  shirt: Garment;
  pants: Garment;
  threeQuarter: { shirt: Garment; pants: Garment };
  silhouette: Record<CaptureView, Box>;
}>("./the-peds-nurse-kevin-collar-and-sleeves-show-no-skin-notch.pre-fix.json");
class HeldOutFixtureError extends Error {
  override name = "HeldOutFixtureError";
}

export function readHeldOut(path = fileURLToPath(new URL("./kevin-collar-heldout.fixture.br", import.meta.url))) {
  try {
    const { payload, owners } = readFixture(path);
    const held = JSON.parse(payload.toString()) as HeldOutFixture;
    for (const direction of held.directions) {
      const { box, label } = direction;
      if (box.length !== 4 || !box.every((v) => Number.isInteger(v) && v >= 0 && v <= heldSize)) {
        throw new Error(`Invalid grid for ${label}`);
      }
      const grid = new Set(Array.from(pixels(box, 4), ([x, y]) => y * heldSize + x));
      function decode(deltas: number[], valid: Set<number>) {
        let id = 0;
        return deltas.map((delta) => {
          id += delta;
          if (!Number.isInteger(delta) || !valid.delete(id)) throw new Error(`Invalid pixel ${id} for ${label}`);
          return id;
        });
      }
      direction.fill = decode(direction.fill, grid);
      const fill = new Set(direction.fill);
      for (const exclusion of direction.exclusions) {
        const { rule, tri } = exclusion;
        if (rule !== "a" && rule !== "b") throw new Error(`Invalid rule ${rule} for ${label}`);
        if (!owners.has(tri)) throw new Error(`Invalid source face ${tri} for ${label}`);
        exclusion.pixels = decode(exclusion.pixels, fill);
      }
    }
    return held;
  } catch (cause) {
    throw new HeldOutFixtureError(`Cannot decode ${path}: ${cause}`, { cause });
  }
}

class HistoricalFramingError extends Error {
  override name = "HistoricalFramingError";
}

function exactKeys<Key extends string>(value: unknown, ...keys: Key[]): value is Record<Key, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

const finite = (value: unknown) => typeof value === "number" && Number.isFinite(value);
const finiteTuple = (value: unknown, length: number) =>
  Array.isArray(value) && value.length === length && value.every(finite);

function isCameraFrame(value: unknown) {
  return exactKeys(value, "position", "quaternion") && finiteTuple(value.position, 3) && finiteTuple(value.quaternion, 4);
}

function isControlFraming(value: unknown): value is ControlFraming {
  if (!exactKeys(value, "scale", "position", "cameras")) return false;
  const { scale, position, cameras } = value;
  return finite(scale) && finiteTuple(position, 3)
    && exactKeys(cameras, ...views) && views.every((view) => isCameraFrame(cameras[view]));
}

export function readHistoricalFraming(
  path = fileURLToPath(new URL("./kevin-collar-historical-framing.json", import.meta.url)),
): ControlFraming {
  try {
    const value: unknown = JSON.parse(readFixture(path, false).payload.toString());
    if (isControlFraming(value)) return value;
    throw new Error("Invalid framing shape");
  } catch (cause) {
    throw new HistoricalFramingError(`${path}: ${cause}`, { cause });
  }
}

export function silhouetteEdges([x0, y0, x1, y1]: Box): [Box, Box, Box][] {
  return [
    [[x0, y0, x1 + 1, y0 + 1], [x0, y0 + 2, x1 + 1, y0 + 3], [x0, y0 - 5, x1 + 1, y0 - 4]],
    [[x0, y1, x1 + 1, y1 + 1], [x0, y1 - 2, x1 + 1, y1 - 1], [x0, y1 + 5, x1 + 1, y1 + 6]],
    [[x0, y0, x0 + 1, y1 + 1], [x0 + 2, y0, x0 + 3, y1 + 1], [x0 - 5, y0, x0 - 4, y1 + 1]],
    [[x1, y0, x1 + 1, y1 + 1], [x1 - 2, y0, x1 - 1, y1 + 1], [x1 + 5, y0, x1 + 6, y1 + 1]],
  ];
}

export function coveragePixels(pre: ReturnType<typeof readPreFix>, capture: CaptureView) {
  const { shirt, pants } = capture === "front" ? pre : pre.threeQuarter;
  const points = [...pixels(shirt.box, shirt.stride), ...pixels(pants.box, pants.stride)];
  for (const box of silhouetteEdges(pre.silhouette[capture]).flat()) points.push(...pixels(box, 2));
  return points;
}

export const coverageClasses = ["miss", "shirt", "pants", "other"] as const;
