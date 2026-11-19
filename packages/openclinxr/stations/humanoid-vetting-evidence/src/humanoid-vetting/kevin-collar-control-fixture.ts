import { fileURLToPath } from "node:url";
import { BufferAttribute, BufferGeometry, DoubleSide, Group, Mesh, MeshBasicMaterial, PerspectiveCamera } from "three";
import { acceleratedRaycast, MeshBVH } from "three-mesh-bvh";
import type { AttrScene } from "../../../../../../tools/openclinxr/evidence/humanoid-vetting/kevin-collar-skin-probe.js";
import { captures, coverageClasses, coveragePixels, readFixture, readPreFix, sides } from "./kevin-collar-control-rays.js";
import { skin, type View } from "./kevin-collar-probes.js";

export const historicalControlPath = fileURLToPath(new URL("./kevin-collar-control.fixture.br", import.meta.url));

export type Crop = {
  meshName: string;
  primIndex: number;
  matName: string;
  matIndex: number;
  alphaMode: string;
  faces: number;
  count: number;
  indices: number;
  positions: number;
  normals?: number;
  uvs?: number;
};

export type ControlFraming = {
  scale: number;
  position: [number, number, number];
  cameras: Record<View, { position: [number, number, number]; quaternion: [number, number, number, number] }>;
};

export type ControlFixture = ControlFraming & {
  version: 3;
  atlas: { w: number; h: number; matIndex: number; painted: number };
  coverage: Record<View, number>;
  static: Crop[];
  posed: Crop[];
};

const cacheSize = 16;
function remember(cache: number[], value: number, slot: number) {
  if (slot >= 0) cache.splice(slot, 1);
  cache.unshift(value);
  if (cache.length > cacheSize) cache.pop();
}

export function controlWriter() {
  const chunks: Buffer[] = [];
  const lengths: number[] = [];
  function bytes(data: Uint8Array) {
    chunks.push(Buffer.from(data.buffer, data.byteOffset, data.byteLength));
    return lengths.push(data.length) - 1;
  }
  function integers(values: number[], indices = false) {
    let last = indices ? -1 : 0;
    const cache: number[] = [];
    const data: number[] = [];
    for (const value of values) {
      let code = value - last;
      if (indices) {
        // Zero adds a vertex; reuse uses the cache or a signed delta.
        const slot = cache.indexOf(value);
        const delta = value - (cache[0] ?? 0);
        code = value > last ? 0 : slot >= 0 ? slot + 1 : cacheSize + 1 + ((delta << 1) ^ (delta >> 31));
        remember(cache, value, slot);
      }
      last = Math.max(last, value);
      while (code >= 128) {
        data.push((code & 127) | 128);
        code >>>= 7;
      }
      data.push(code);
    }
    return bytes(Uint8Array.from(data));
  }
  function floats(values: Float32Array) {
    // Separate the four byte planes so Brotli can match shared exponents.
    const source = new Uint8Array(values.buffer);
    const data = new Uint8Array(source.length);
    for (let i = 0; i < values.length; i++) {
      for (let lane = 0; lane < 4; lane++) data[lane * values.length + i] = source[4 * i + lane] ?? 0;
    }
    return bytes(data);
  }
  function finish(fixture: ControlFixture) {
    const header = Buffer.from(JSON.stringify({ fixture, lengths }));
    const size = Buffer.alloc(4);
    size.writeUInt32LE(header.length);
    return Buffer.concat([size, header, ...chunks]);
  }
  return { bytes, integers, floats, finish };
}

function readControl(path: string) {
  const { payload: buffer } = readFixture(path);
  const end = 4 + buffer.readUInt32LE();
  if (end > buffer.length) throw new Error(`Invalid Kevin collar header in ${path}`);
  const { fixture, lengths } = JSON.parse(buffer.toString("utf8", 4, end)) as {
    fixture: ControlFixture;
    lengths: number[];
  };
  if (fixture.version !== 3) throw new Error(`Unsupported Kevin collar fixture version in ${path}`);
  let offset = end;
  const chunks = lengths.map((length) => {
    if (!Number.isSafeInteger(length) || length < 0) throw new Error(`Invalid chunk length in ${path}`);
    const chunk = buffer.subarray(offset, offset + length);
    offset += length;
    return chunk;
  });
  if (offset !== buffer.length) throw new Error(`Trailing or missing fixture bytes in ${path}`);
  function bytes(id: number) {
    const chunk = chunks[id];
    if (!chunk) throw new Error(`Missing Kevin collar fixture chunk ${id} in ${path}`);
    return chunk;
  }
  function integers(id: number, count: number, indices = false) {
    let last = indices ? -1 : 0;
    const cache: number[] = [];
    const result: number[] = [];
    let shift = 0;
    let code = 0;
    for (const byte of bytes(id)) {
      if (shift >= 28) throw new Error(`Oversized varint in chunk ${id}`);
      code |= (byte & 127) << shift;
      if (byte & 128) {
        shift += 7;
      } else {
        let value = last + code;
        if (indices) {
          const delta = code - cacheSize - 1;
          value = code === 0 ? last + 1 : code <= cacheSize ? (cache[code - 1] ?? -1)
            : (cache[0] ?? 0) + ((delta >>> 1) ^ -(delta & 1));
          if (value < 0 || (code && value > last)) throw new Error(`Invalid vertex in chunk ${id}`);
          remember(cache, value, cache.indexOf(value));
        } else if (code === 0 && result.length > 0) {
          throw new Error(`Repeated face ordinal in chunk ${id}`);
        }
        last = Math.max(last, value);
        result.push(value);
        shift = code = 0;
      }
    }
    if (shift) throw new Error(`Truncated varint in chunk ${id}`);
    if (result.length !== count) throw new Error(`Wrong decoded count in chunk ${id}: ${result.length} != ${count}`);
    return result;
  }
  function floats(id: number) {
    const source = bytes(id);
    const result = new Float32Array(source.length / 4);
    const data = new Uint8Array(result.buffer);
    for (let i = 0; i < result.length; i++) {
      for (let lane = 0; lane < 4; lane++) data[4 * i + lane] = source[lane * result.length + i] ?? 0;
    }
    return result;
  }
  return { fixture, bytes, integers, floats };
}

function makeModel(crops: Crop[], { fixture, integers, floats }: ReturnType<typeof readControl>) {
  const model = new Group();
  const inspection = new MeshBasicMaterial({ side: DoubleSide });
  for (const { faces, count, indices, positions, normals, uvs, ...metadata } of crops) {
    const geometry = new BufferGeometry();
    const originalFaces = integers(faces, count);
    const compact = integers(indices, 3 * count, true);
    // Preserve ordinals and tie order with degenerate faces in the gaps.
    const lastFace = originalFaces.at(-1);
    if (lastFace === undefined) throw new Error(`Empty crop for ${metadata.meshName}#${metadata.primIndex}`);
    const sparse = new Uint16Array(3 * (lastFace + 1));
    for (const [i, face] of originalFaces.entries()) {
      sparse.set(compact.slice(3 * i, 3 * i + 3), 3 * face);
    }
    geometry.setIndex(new BufferAttribute(sparse, 1));
    geometry.setAttribute("position", new BufferAttribute(floats(positions), 3));
    if (normals !== undefined) geometry.setAttribute("normal", new BufferAttribute(floats(normals), 3));
    if (uvs !== undefined) geometry.setAttribute("uv", new BufferAttribute(floats(uvs), 2));
    geometry.boundsTree = new MeshBVH(geometry, { verbose: false, indirect: true });
    const mesh = new Mesh(geometry, inspection);
    mesh.name = `${metadata.meshName}#${metadata.primIndex}`;
    mesh.userData = metadata;
    mesh.raycast = acceleratedRaycast;
    model.add(mesh);
  }
  applyControlTransform(model, fixture);
  return model;
}

export function applyControlTransform(model: Group, framing: ControlFraming) {
  model.scale.setScalar(framing.scale);
  model.position.fromArray(framing.position);
  model.updateMatrixWorld(true);
}

export function controlCamera(framing: ControlFraming, view: View) {
  const frame = framing.cameras[view];
  const camera = new PerspectiveCamera(35, 1, 0.01, 100);
  camera.position.fromArray(frame.position);
  camera.quaternion.fromArray(frame.quaternion);
  camera.updateMatrixWorld(true);
  return camera;
}

export function loadControlFixture(path: string) {
  const data = readControl(path);
  const { fixture } = data;
  const { w, h, matIndex, painted } = fixture.atlas;
  // Expand the mask at the padding threshold.
  const mask = data.bytes(painted);
  const r = Uint8Array.from({ length: w * h }, (_, i) => ((mask[i >> 3] ?? 0) & (1 << (i & 7))) ? 10 : 0);
  const texture = { w, h, r, g: r, b: r, a: new Uint8Array(), lum: new Float32Array(), greyscale: true };
  const staticModel = makeModel(fixture.static, data);
  const posedModel = makeModel(fixture.posed, data);

  const pre = readPreFix();
  const coverage = Object.fromEntries(captures.map((capture) => {
    const view = sides[capture];
    const values = data.bytes(fixture.coverage[view]);
    return [view, new Map(coveragePixels(pre, capture).map(([x, y], i) => [
      4096 * y + x,
      coverageClasses[values[i] ?? -1],
    ]))];
  }));

  function scene(view: View, model: Group = staticModel): AttrScene {
    return { camera: controlCamera(fixture, view), model, prims: [], skin: texture, skinMatIndex: matIndex, skinMatName: skin };
  }

  return { scene, posedModel, coverage };
}
