/**
 * C52b counterweight: the supine plant may get cheaper, it may not move the body.
 * Re-plants every shipped supine body in {stretcher flat, stretcher 30 deg, bedless} and compares to
 * __fixtures__/supine-plant-pose-before.json (taken on base ebe98e0a5 before any src edit).
 * Tolerance 1e-4 m is the plantSupineBodyOnDeck convergence tolerance (`Math.abs(deltaY) < 1e-4`).
 *
 * Destructive probe (run by hand, results in the C52b handback): in the fixture, add 2e-4 to one bone
 * world coordinate -> this file fails on that case; revert -> passes. The "comparator" case below runs
 * the same substitution in memory on every run so the comparator itself cannot go slack.
 */
import { readFileSync } from "node:fs";
import { buildPatientStretcher } from "@openclinxr/xr-station";
import { Group, type Object3D, Vector3 } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { describe, expect, it } from "vitest";
import { applyAndPlantSupineOnDeck } from "./index.js";

const TOLERANCE_METERS = 1e-4;

type Vec = readonly number[];
type PoseCase = {
  asset: string;
  condition: string;
  inclineDeg: number;
  root: { position: Vec; quaternion: Vec };
  bones: Record<string, Vec>;
  userData: Record<string, unknown>;
};
type Fixture = { cases: PoseCase[] };

const fixture = JSON.parse(readFileSync(new URL("./__fixtures__/supine-plant-pose-before.json", import.meta.url), "utf8")) as Fixture;

/** Keys the fixture does not have and a faster plant may add (timing only). */
const ALLOWED_NEW_USERDATA_KEYS = new Set(["openClinXrPlantPhases", "openClinXrPlantTotalMs"]);

async function shippedBody(asset: string): Promise<Group> {
  const bytes = readFileSync(new URL(`../../../../apps/ui-xr/public/generated-humanoids/${asset}`, import.meta.url));
  const jsonLength = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString());
  const binLength = bytes.readUInt32LE(20 + jsonLength);
  json.buffers[0].uri = `data:application/octet-stream;base64,${bytes.subarray(28 + jsonLength, 28 + jsonLength + binLength).toString("base64")}`;
  for (const material of json.materials) {
    delete material.normalTexture; delete material.occlusionTexture; delete material.emissiveTexture;
    delete material.pbrMetallicRoughness?.baseColorTexture;
    delete material.pbrMetallicRoughness?.metallicRoughnessTexture;
  }
  json.images = []; json.textures = [];
  const platform = globalThis as unknown as { ProgressEvent?: typeof Event };
  if (!platform.ProgressEvent) platform.ProgressEvent = class extends Event {};
  return (await new GLTFLoader().parseAsync(JSON.stringify(json), "")).scene;
}

function withoutMs(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutMs);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) if (key !== "ms") out[key] = withoutMs(item);
    return out;
  }
  return value;
}

/** Largest absolute numeric difference between two JSON values of the same shape; Infinity on a shape or string mismatch. */
function maxJsonDelta(expected: unknown, actual: unknown): number {
  if (typeof expected === "number") return typeof actual === "number" ? (expected === actual ? 0 : Math.abs(expected - actual)) : Infinity;
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length) return Infinity;
    return expected.reduce<number>((worst, item, index) => Math.max(worst, maxJsonDelta(item, actual[index])), 0);
  }
  if (expected && typeof expected === "object") {
    if (!actual || typeof actual !== "object" || Array.isArray(actual)) return Infinity;
    return Object.entries(expected).reduce<number>((worst, [key, item]) => Math.max(worst, maxJsonDelta(item, (actual as Record<string, unknown>)[key])), 0);
  }
  return expected === actual ? 0 : Infinity;
}

type Comparison = { bones: number; root: number; userData: number; missingBones: string[]; extraKeys: string[]; missingKeys: string[] };

function compare(expected: PoseCase, actual: Pick<PoseCase, "root" | "bones" | "userData">): Comparison {
  let bones = 0;
  const missingBones: string[] = [];
  for (const [name, want] of Object.entries(expected.bones)) {
    const got = actual.bones[name];
    if (!got) { missingBones.push(name); continue; }
    bones = Math.max(bones, ...want.map((value, axis) => Math.abs(value - (got[axis] ?? Infinity))));
  }
  const root = Math.max(maxJsonDelta(expected.root.position, actual.root.position), maxJsonDelta(expected.root.quaternion, actual.root.quaternion));
  const wantKeys = Object.keys(expected.userData);
  const missingKeys = wantKeys.filter((key) => !(key in actual.userData));
  const extraKeys = Object.keys(actual.userData).filter((key) => !(key in expected.userData) && !ALLOWED_NEW_USERDATA_KEYS.has(key));
  const userData = Math.max(0, ...wantKeys.filter((key) => key in actual.userData).map((key) => maxJsonDelta(expected.userData[key], actual.userData[key])));
  return { bones, root, userData, missingBones, extraKeys, missingKeys };
}

function passes(result: Comparison): boolean {
  return result.bones <= TOLERANCE_METERS && result.root <= TOLERANCE_METERS && result.userData <= TOLERANCE_METERS
    && result.missingBones.length === 0 && result.extraKeys.length === 0 && result.missingKeys.length === 0;
}

async function plant(row: PoseCase): Promise<Pick<PoseCase, "root" | "bones" | "userData">> {
  const root = await shippedBody(row.asset);
  const parent = new Group();
  let bed: Group | undefined;
  if (row.condition !== "bedless") {
    bed = buildPatientStretcher({ slotId: "patient", position: { x: 0, y: 0, z: 0 }, trimColor: 0, inclineDegrees: row.inclineDeg });
    parent.rotation.y = -0.26; parent.scale.setScalar(0.82);
  }
  parent.add(root); parent.updateMatrixWorld(true);
  applyAndPlantSupineOnDeck(root, { ...(bed ? { stretcher: bed } : {}), deckTopWorldY: 0.55, deckCenter: { x: 0, z: 0 } });
  root.updateMatrixWorld(true);
  const bones: Record<string, Vec> = {};
  root.traverse((object: Object3D) => {
    if ((object as Object3D & { isBone?: boolean }).isBone !== true) return;
    let key = object.name; let n = 1;
    while (bones[key]) { n += 1; key = `${object.name}#${n}`; }
    const p = object.getWorldPosition(new Vector3());
    bones[key] = [p.x, p.y, p.z];
  });
  const userData: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(root.userData)) if (key.startsWith("openClinXr")) userData[key] = withoutMs(JSON.parse(JSON.stringify(value ?? null)));
  const q = root.quaternion;
  return { root: { position: [root.position.x, root.position.y, root.position.z], quaternion: [q.x, q.y, q.z, q.w] }, bones, userData };
}

describe("the supine plant keeps its pose while getting faster", () => {
  it("fixture covers the shipped supine bodies x {flat, 30 degrees, bedless}", () => {
    expect(fixture.cases.length).toBe(12);
    expect(new Set(fixture.cases.map((row) => row.condition))).toEqual(new Set(["stretcher_flat", "stretcher_incline_30", "bedless"]));
    for (const row of fixture.cases) expect(Object.keys(row.bones).length).toBeGreaterThan(100);
  });

  it("comparator rejects a 2e-4 m bone offset and accepts the unmodified fixture (probe substitution, in memory)", () => {
    const row = fixture.cases[0]!;
    const boneName = Object.keys(row.bones)[10]!;
    const original = row.bones[boneName]!;
    const moved = { ...row.bones, [boneName]: [original[0]! + 2e-4, original[1]!, original[2]!] };
    console.log(`probe substitution: ${row.asset} ${row.condition} bone ${boneName} x ${original[0]} -> ${original[0]! + 2e-4}`);
    expect(passes(compare(row, { root: row.root, bones: moved, userData: row.userData }))).toBe(false);
    expect(passes(compare(row, { root: row.root, bones: row.bones, userData: row.userData }))).toBe(true);
  });

  it.each(fixture.cases.map((row) => [row.asset, row.condition, row] as const))("%s %s stays within 1e-4 m on every bone, root pose and plant key", async (_asset, _condition, row) => {
    const actual = await plant(row);
    const result = compare(row, actual);
    console.log(`${row.asset} ${row.condition}: max bone ${result.bones.toExponential(2)} root ${result.root.toExponential(2)} userData ${result.userData.toExponential(2)}`);
    expect(result.missingBones).toEqual([]);
    expect(result.missingKeys).toEqual([]);
    expect(result.extraKeys).toEqual([]);
    expect(result.bones).toBeLessThanOrEqual(TOLERANCE_METERS);
    expect(result.root).toBeLessThanOrEqual(TOLERANCE_METERS);
    expect(result.userData).toBeLessThanOrEqual(TOLERANCE_METERS);
  }, 900_000);
});
