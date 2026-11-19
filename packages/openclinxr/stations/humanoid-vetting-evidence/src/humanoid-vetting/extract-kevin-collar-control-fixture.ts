import { type BufferAttribute, Group, type Intersection, Mesh, Vector3 } from "three";
import {
  type AttrScene,
  loadAttrScene,
  probePixel,
} from "../../../../../../tools/openclinxr/evidence/humanoid-vetting/kevin-collar-skin-probe.js";
import {
  applyControlTransform,
  controlCamera,
  controlWriter,
  type ControlFixture,
  type ControlFraming,
  type Crop,
  loadControlFixture,
} from "./kevin-collar-control-fixture.js";
import { captures, coverageClasses, coveragePixels, readHeldOut, readHistoricalFraming, readPreFix, sides, writeFixture } from "./kevin-collar-control-rays.js";
import {
  body,
  gradeTie,
  heldCamera,
  heldSize,
  hitClass,
  openBoxes,
  type Pixel,
  pixels,
  posed,
  rayHits,
  shirtBoxes,
  type View,
} from "./kevin-collar-probes.js";

type Faces = Map<Mesh, Set<number>>;

function attributes(attr: BufferAttribute, vertices: number[], sampled?: Set<number>) {
  const data = new Float32Array(vertices.length * attr.itemSize);
  vertices.forEach((vertex, row) => {
    if (sampled && !sampled.has(vertex)) return;
    for (let i = 0; i < attr.itemSize; i++) data[row * attr.itemSize + i] = attr.getComponent(vertex, i);
  });
  return data;
}

function cropScene(
  writer: ReturnType<typeof controlWriter>,
  model: Group,
  selected: Faces,
  shadingVertices: Faces,
  shading: boolean,
): Crop[] {
  const crops: Crop[] = [];
  for (const object of model.children) {
    if (!(object instanceof Mesh)) continue;
    const picked = selected.get(object);
    if (!picked?.size) continue;
    const faces = [...picked].sort((a, b) => a - b);
    const geom = object.geometry;
    const sourceIndex = geom.getIndex();
    const offsets = faces.flatMap((face) => [3 * face, 3 * face + 1, 3 * face + 2]);
    const original = offsets.map((offset) => sourceIndex?.getX(offset) ?? offset);
    const position = geom.getAttribute("position");
    const normal = geom.getAttribute("normal");
    const sampled = shadingVertices.get(object);
    const uv = shading && hitClass(object) === "skin" ? geom.getAttribute("uv") : undefined;
    const compact = new Map<number | string, number>();
    const vertices: number[] = [];
    const indices = original.map((vertex) => {
      // Merge exact position duplicates only when no other attributes are stored.
      const key = (normal && sampled) || uv ? vertex
        : [position.getX(vertex), position.getY(vertex), position.getZ(vertex)]
          .map((value) => Object.is(value, -0) ? "-0" : value).join(",");
      const index = compact.get(key);
      if (index !== undefined) return index;
      compact.set(key, vertices.length);
      return vertices.push(vertex) - 1;
    });
    if (vertices.length > 65536) throw new Error(`Too many vertices in ${object.name}`);
    const metadata = object.userData;
    const crop: Crop = {
      meshName: String(metadata["meshName"]),
      primIndex: Number(metadata["primIndex"]),
      matName: String(metadata["matName"]),
      matIndex: Number(metadata["matIndex"]),
      alphaMode: String(metadata["alphaMode"]),
      faces: writer.integers(faces),
      count: faces.length,
      indices: writer.integers(indices, true),
      positions: writer.floats(attributes(position, vertices)),
    };
    if (normal && sampled) crop.normals = writer.floats(attributes(normal, vertices, sampled));
    if (uv) crop.uvs = writer.floats(attributes(uv, vertices));
    crops.push(crop);
  }
  return crops;
}

function selectFace(selected: Faces, { object, faceIndex }: Intersection) {
  if (!(object instanceof Mesh) || faceIndex == null) throw new Error("Expected a mesh triangle");
  const faces = selected.get(object) ?? new Set<number>();
  faces.add(faceIndex);
  selected.set(object, faces);
}

function collector(atlas: NonNullable<AttrScene["skin"]>, reference?: ReturnType<typeof loadControlFixture>) {
  const painted = new Uint8Array(Math.ceil(atlas.w * atlas.h / 8));
  const shadingVertices: Faces = new Map();
  const baseFaces: Faces = new Map();
  const posedFaces: Faces = new Map();
  return {
    painted,
    shadingVertices,
    baseFaces,
    posedFaces,
    sample(scene: AttrScene, domain: Iterable<Pixel>, kind: "static" | "posed", size: number, baseline?: AttrScene, forceFirst = false) {
      const selected = kind === "static" ? baseFaces : posedFaces;
      for (const px of domain) {
        const { hits } = rayHits(scene.model, scene.camera, px, size);
        const first = hits[0];
        if (!first) continue;
        const cls = hitClass(first.object);
        const hiddenRay = kind === "static" && (baseline
          ? hitClass(rayHits(baseline.model, baseline.camera, px, size).hits[0]?.object) === "hidden"
          : cls === "hidden");
        if (kind === "static" && !hiddenRay && (reference || cls !== "skin")) continue;
        if (kind === "posed" && !reference && !forceFirst && cls !== "hidden" && cls !== "shirt") continue;
        for (const [i, hit] of hits.entries()) {
          if (i > 0 && (kind === "static" || cls !== "shirt" || hit.distance - first.distance > gradeTie)) break;
          if (i > 0 && (hit.object.userData["meshName"] !== body || hitClass(hit.object) !== "skin")) continue;
          selectFace(selected, hit);
        }
        if (kind === "posed" && !reference) continue;
        const skinHit = cls === "skin" && first.object.userData["meshName"] === body;
        // C1 reads facing only on historical hidden rays. FACET also reads skin normals.
        if ((skinHit || hiddenRay) && first.object instanceof Mesh && first.face) {
          const vertices = shadingVertices.get(first.object) ?? new Set<number>();
          vertices.add(first.face.a).add(first.face.b).add(first.face.c);
          shadingVertices.set(first.object, vertices);
        }
        if (!reference || !skinHit) continue;
        const hit = probePixel(scene, px[0], px[1], size, size);
        if (!hit?.uv || !hit.texel || Math.max(...hit.texel) < 10) continue;
        const [u, v] = hit.uv;
        const x = Math.min(Math.max(Math.floor(u * atlas.w), 0), atlas.w - 1);
        const y = Math.min(Math.max(Math.floor(v * atlas.h), 0), atlas.h - 1);
        const i = y * atlas.w + x;
        painted[i >> 3] = (painted[i >> 3] ?? 0) | (1 << (i & 7));
      }
    },
    preserveOcclusion(scene: AttrScene, domain: Iterable<Pixel>, size: number, selected: Faces, classes: string[]) {
      for (const px of domain) {
        const { hits } = rayHits(scene.model, scene.camera, px, size);
        const first = hits[0];
        if (!first || hits.length < 2 || classes.includes(hitClass(first.object))) continue;
        if (hits.slice(1).some(({ object, faceIndex }) =>
          object instanceof Mesh && faceIndex != null && selected.get(object)?.has(faceIndex) &&
          classes.includes(hitClass(object)),
        )) selectFace(selected, first);
      }
    },
  };
}

function captureFraming(front: AttrScene, threeQuarter: AttrScene): ControlFraming {
  const cameraFrame = ({ position, quaternion }: AttrScene["camera"]) => ({
    position: position.toArray(),
    quaternion: quaternion.toArray(),
  });
  return {
    scale: front.model.scale.x,
    position: front.model.position.toArray(),
    cameras: { front: cameraFrame(front.camera), three_quarter: cameraFrame(threeQuarter.camera) },
  };
}

async function extract(path: string, destination: string, writeFraming: boolean, referencePath?: string) {
  // Both fixed cameras use identical static geometry. Use one mesh instance
  // per primitive so selection across the two views produces a union.
  const front = await loadAttrScene(path, "front");
  const threeQuarter = await loadAttrScene(path, "three_quarter");
  const staticFraming = captureFraming(front, threeQuarter);
  if (writeFraming) {
    writeFixture(destination, Buffer.from(`${JSON.stringify(staticFraming)}\n`), undefined, false);
    return;
  }
  if (!front.skin) throw new Error(`Missing skin atlas in ${path}`);
  const pre = readPreFix();
  const held = readHeldOut();
  const reference = referencePath ? loadControlFixture(referencePath) : undefined;
  const picked = collector(front.skin, reference);
  // The posed tests use the historical transform and cameras for all subjects.
  const historical = readHistoricalFraming();
  const posedCameras = {
    front: controlCamera(historical, "front"),
    three_quarter: controlCamera(historical, "three_quarter"),
  };
  const historicalModel = new Group();
  applyControlTransform(historicalModel, historical);
  const posedScene = await posed(path, { model: historicalModel, camera: posedCameras.front });
  const writer = controlWriter();
  const coverage = {} as Record<View, number>;
  const cameras = { front: front.camera, three_quarter: threeQuarter.camera };
  for (const capture of captures) {
    const view = sides[capture];
    const scene = { ...front, camera: cameras[view] };
    const referenceView = reference?.scene(view);
    for (const records of Object.values(pre.sites)) {
      const { box, stride } = records[capture];
      picked.sample(scene, pixels(box, stride), "static", 4096, referenceView);
    }
    // These full-frame checks consume only coverage classes.
    coverage[view] = writer.bytes(Uint8Array.from(coveragePixels(pre, capture), (px) => {
      const cls = hitClass(rayHits(scene.model, scene.camera, px).hits[0]?.object);
      return cls === "miss" || cls === "shirt" || cls === "pants" ? coverageClasses.indexOf(cls) : 3;
    }));
  }
  const posedDomains = [
    ...Object.values(sides).flatMap((view) =>
      [...Object.values(openBoxes[view]), ...shirtBoxes[view]].map((box) => ({
        camera: posedCameras[view], box, stride: 2, size: 4096,
      })),
    ),
    ...held.directions.map((direction) => ({
      camera: heldCamera(direction, new Vector3(...held.center)), box: direction.box, stride: 4, size: heldSize,
    })),
  ];
  for (const { camera, box, stride, size } of posedDomains) {
    picked.sample({ ...posedScene, camera }, pixels(box, stride), "posed", size);
  }
  picked.sample({ ...posedScene, camera: posedCameras.three_quarter }, [[2416, 1400]], "posed", 4096, undefined, true);

  // Baseline rays census class membership. Retain additional occluders only
  // when their removal would reveal a selected face in a counted class.
  if (!reference) {
    for (const capture of captures) {
      const scene = { ...front, camera: cameras[sides[capture]] };
      for (const records of Object.values(pre.sites)) {
        const { box, stride } = records[capture];
        picked.preserveOcclusion(scene, pixels(box, stride), 4096, picked.baseFaces, ["hidden", "skin"]);
      }
    }
    for (const { camera, box, stride, size } of posedDomains) {
      picked.preserveOcclusion({ ...posedScene, camera }, pixels(box, stride), size, picked.posedFaces, ["hidden", "shirt"]);
    }
  }

  const fixture: ControlFixture = {
    version: 3,
    coverage,
    ...staticFraming,
    atlas: { w: front.skin.w, h: front.skin.h, matIndex: front.skinMatIndex, painted: writer.bytes(picked.painted) },
    static: cropScene(writer, front.model, picked.baseFaces, picked.shadingVertices, true),
    posed: cropScene(writer, posedScene.model, picked.posedFaces, picked.shadingVertices, !!reference),
  };
  writeFixture(destination, writer.finish(fixture));
}

const args = process.argv.slice(2);
const framingOnly = args[0] === "--write-framing";
const [input, output, candidateReference, ...extra] = framingOnly ? args.slice(1) : args;
if (!input || !output || extra.length || (framingOnly && candidateReference)) {
  throw new Error("Expected INPUT.glb OUTPUT.fixture.br [HISTORICAL.fixture.br] or --write-framing HISTORICAL.glb OUTPUT.json");
}
await extract(input, output, framingOnly, candidateReference);
