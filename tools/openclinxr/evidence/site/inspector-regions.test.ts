// Inspector regions test (card W4a-0). Fixture coordinates under
// fixtures/inspector/** are illustrative: they exercise the validateRegions
// blocker ids, not real capture output.
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { extentOf, histogramOf, isEffectivelyVisible, planMaskRestore, planMaskSetupInner, RESTORE_SOURCE, SETUP_SOURCE } from "./capture/inspector-mask.mjs";
import { blueprintActorLines, ratiosOf, validateRegions } from "./capture/inspector-regions.mjs";
import {
  CAST_TIMEOUT_BLOCKER,
  CAST_MODE_TOLERANCE_M,
  castCompletePredicate,
  castModeBlockers,
  classifyCastMode,
  readCamera,
  waitForCastComplete,
} from "./capture/inspector-still.mjs";

vi.mock("../xr-sync/harness-lib.mjs", () => ({
  projectActorBbox: vi.fn(),
  startStaticServer: vi.fn(),
}));

interface RegionDoc {
  canvasRect: { x: number; y: number; width: number; height: number };
  viewport: { width: number; height: number };
  regions: { actorId: string; bbox: { x: number; y: number; width: number; height: number } }[];
}

const BLUEPRINT_ACTOR_IDS = [
  "patient_robert_hayes_v1",
  "spouse_anna_hayes_v1",
  "nurse_maria_alvarez_v1",
];

function readFixture(name: string): RegionDoc {
  const raw = readFileSync(
    path.join(process.cwd(), "tools", "openclinxr", "evidence", "site", "fixtures", "inspector", name),
    "utf8",
  );
  return JSON.parse(raw) as RegionDoc;
}

it("KNOWN-GOOD patient bbox inside canvas at 0.3 viewport height plus nurse returns no blockers", () => {
  expect(validateRegions(readFixture("known-good.json"), BLUEPRINT_ACTOR_IDS)).toEqual([]);
});

it("NEGATIVE bbox crossing the canvas right edge returns region_bbox_outside_canvas", () => {
  expect(validateRegions(readFixture("region-outside-canvas.json"), BLUEPRINT_ACTOR_IDS)).toEqual([
    "region_bbox_outside_canvas:nurse_maria_alvarez_v1",
  ]);
});

it("NEGATIVE zero-width bbox returns region_bbox_zero_area", () => {
  expect(validateRegions(readFixture("region-zero-area.json"), BLUEPRINT_ACTOR_IDS)).toEqual([
    "region_bbox_zero_area:patient_robert_hayes_v1",
  ]);
});

it("NEGATIVE actorId patient_robert_hayes_v2 returns region_actor_unknown", () => {
  expect(validateRegions(readFixture("region-unknown-actor.json"), BLUEPRINT_ACTOR_IDS)).toEqual([
    "region_actor_unknown:patient_robert_hayes_v2",
  ]);
});

it("NEGATIVE no patient region returns region_patient_missing", () => {
  expect(validateRegions(readFixture("region-patient-missing.json"), BLUEPRINT_ACTOR_IDS)).toEqual([
    "region_patient_missing",
  ]);
});

it("NEGATIVE patient height 0.05 of viewport returns region_patient_too_small", () => {
  expect(validateRegions(readFixture("region-patient-too-small.json"), BLUEPRINT_ACTOR_IDS)).toEqual([
    "region_patient_too_small",
  ]);
});

it("blueprintActorLines on the real blueprint returns the 3 actor ids with nurse on 2 or more lines", () => {
  const sourcePath = path.join(
    process.cwd(),
    "packages",
    "openclinxr",
    "scenario-fixtures",
    "src",
    "ed-chest-pain-mod.ts",
  );
  const sourceText = readFileSync(sourcePath, "utf8");
  const lines = blueprintActorLines(sourceText);
  expect([...lines.keys()].sort()).toEqual([...BLUEPRINT_ACTOR_IDS].sort());
  const nurseLines = lines.get("nurse_maria_alvarez_v1") ?? [];
  expect(nurseLines.length).toBeGreaterThanOrEqual(2);
  const sourceLines = sourceText.split("\n");
  for (const [actorId, numbers] of lines) {
    for (const lineNumber of numbers) {
      expect(sourceLines[lineNumber - 1] ?? "").toContain(actorId);
    }
  }
});

it("inspector-still imports projectActorBbox and w0-still helpers and defines no patientBbox", () => {
  const stillSource = readFileSync(
    path.join(process.cwd(), "tools", "openclinxr", "evidence", "site", "capture", "inspector-still.mjs"),
    "utf8",
  );
  expect(stillSource).toContain("projectActorBbox");
  expect(stillSource).toContain("harness-lib.mjs");
  expect(stillSource).toContain('from "./w0-still.mjs"');
  expect(stillSource).toContain("regionFor");
  expect(stillSource).not.toContain("patientBbox");
});

it("inspector-still drives only through openW0Stage from w0-still", () => {
  const stillSource = readFileSync(
    path.join(process.cwd(), "tools", "openclinxr", "evidence", "site", "capture", "inspector-still.mjs"),
    "utf8",
  );
  for (const banned of ["createEncounterServer", "resolveDevStack", "startStaticServer", "chromium.launch", "addStyleTag"]) {
    expect(stillSource).not.toContain(banned);
  }
  expect(stillSource).toContain("openW0Stage");
  expect(stillSource).toContain('from "./w0-still.mjs"');
});

it("BEHAVIOUR regionFor returns the mocked bbox from exactly one projectActorBbox call", async () => {
  const harness = await import("../xr-sync/harness-lib.mjs");
  const still = await import("./capture/inspector-still.mjs");
  const page = { stub: "page" };
  const bbox = { x: 10, y: 20, width: 30, height: 40 };
  vi.mocked(harness.projectActorBbox).mockReset();
  vi.mocked(harness.projectActorBbox).mockResolvedValue({ ok: true, bbox });
  const row = await still.regionFor(page, "nurse_maria_alvarez_v1");
  expect(harness.projectActorBbox).toHaveBeenCalledTimes(1);
  expect(harness.projectActorBbox).toHaveBeenCalledWith(page, "nurse_maria_alvarez_v1");
  expect(row).toEqual({ actorId: "nurse_maria_alvarez_v1", bbox });
});

it("BEHAVIOUR regionFor maps ok:false to why", async () => {
  const harness = await import("../xr-sync/harness-lib.mjs");
  const still = await import("./capture/inspector-still.mjs");
  const page = { stub: "page" };
  vi.mocked(harness.projectActorBbox).mockReset();
  vi.mocked(harness.projectActorBbox).mockResolvedValue({ ok: false, why: "no scene node stamped ghost" });
  const row = await still.regionFor(page, "ghost_actor_v1");
  expect(harness.projectActorBbox).toHaveBeenCalledTimes(1);
  expect(harness.projectActorBbox).toHaveBeenCalledWith(page, "ghost_actor_v1");
  expect(row).toEqual({ actorId: "ghost_actor_v1", why: "no scene node stamped ghost" });
});

it("importing inspector-still launches no browser", async () => {
  const still = await import("./capture/inspector-still.mjs");
  expect(typeof still.regionFor).toBe("function");
  expect(typeof still.captureInspectorRun).toBe("function");
});

function illustrativeBuffer(): { rgba: Uint8ClampedArray; width: number; height: number } {
  const width = 10;
  const height = 10;
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 5; y < 9; y += 1) {
    for (let x = 2; x < 5; x += 1) {
      const i = (y * width + x) * 4;
      rgba[i] = 255;
      rgba[i + 1] = 255;
      rgba[i + 2] = 255;
      rgba[i + 3] = 255;
    }
  }
  return { rgba, width, height };
}

it("KNOWN-GOOD extentOf returns the illustrative white 3x4 block at (2,5)", () => {
  const { rgba, width, height } = illustrativeBuffer();
  expect(extentOf(rgba, width, height, 32)).toEqual({ x: 2, y: 5, width: 3, height: 4 });
});

it("NEGATIVE extentOf on an all-black buffer returns null", () => {
  const rgba = new Uint8ClampedArray(10 * 10 * 4);
  expect(extentOf(rgba, 10, 10, 32)).toBeNull();
});

it("extentOf threshold boundary: value 32 returns null and 33 returns a 1x1 rect", () => {
  const at32 = new Uint8ClampedArray(10 * 10 * 4);
  const i32 = (4 * 10 + 7) * 4;
  at32[i32] = 32;
  at32[i32 + 1] = 32;
  at32[i32 + 2] = 32;
  at32[i32 + 3] = 255;
  expect(extentOf(at32, 10, 10, 32)).toBeNull();
  const at33 = new Uint8ClampedArray(10 * 10 * 4);
  const i33 = (4 * 10 + 7) * 4;
  at33[i33] = 33;
  at33[i33 + 1] = 33;
  at33[i33 + 2] = 33;
  at33[i33 + 3] = 255;
  expect(extentOf(at33, 10, 10, 32)).toEqual({ x: 7, y: 4, width: 1, height: 1 });
});

it("KNOWN-GOOD ratiosOf equal rects returns 1,1,1 and half-width mask returns width 0.5", () => {
  const bbox = { x: 373, y: 100, width: 167, height: 200 };
  expect(ratiosOf(bbox, { x: 373, y: 100, width: 167, height: 200 })).toEqual({
    width: 1,
    height: 1,
    area: 1,
  });
  const half = ratiosOf(bbox, { x: 373, y: 100, width: 83.5, height: 200 });
  expect(half?.width).toBeCloseTo(0.5, 10);
  expect(half?.height).toBeCloseTo(1, 10);
  expect(half?.area).toBeCloseTo(0.5, 10);
});

it("extentOf histogram: a grey-100 border around the block counts in mid", () => {
  const { rgba, width, height } = illustrativeBuffer();
  for (let y = 4; y < 10; y += 1) {
    for (let x = 1; x < 6; x += 1) {
      const inside = x >= 2 && x < 5 && y >= 5 && y < 9;
      if (inside) continue;
      const i = (y * width + x) * 4;
      rgba[i] = 100;
      rgba[i + 1] = 100;
      rgba[i + 2] = 100;
      rgba[i + 3] = 255;
    }
  }
  expect(histogramOf(rgba, width, height)).toEqual({ zero: 70, mid: 18, high: 12 });
});

it("inspector-mask restores visibility, material and background; inspector-still shoots still.png before the first maskExtent call", () => {
  const maskSource = readFileSync(
    path.join(process.cwd(), "tools", "openclinxr", "evidence", "site", "capture", "inspector-mask.mjs"),
    "utf8",
  );
  expect(maskSource).toContain("obj.visible = row.visible");
  expect(maskSource).toContain("obj.material = row.material");
  expect(maskSource).toContain("scene.background = stash.savedBackground");
  const stillSource = readFileSync(
    path.join(process.cwd(), "tools", "openclinxr", "evidence", "site", "capture", "inspector-still.mjs"),
    "utf8",
  );
  expect(stillSource).toContain("maskExtent(");
  expect(stillSource.indexOf("still.png")).toBeLessThan(stillSource.indexOf("maskExtent("));
});

// Behaviour of the in-page mask setup/restore on an illustrative fake scene graph
// (owner fix 2026-11-12: run-3 showed every restore returning undefined because the
// restore source was evaluated without being called).
class FakeColor {
  r: number;
  g: number;
  b: number;
  constructor(r = 0, g = 0, b = 0) {
    this.r = r;
    this.g = g;
    this.b = b;
  }
  setRGB(r: number, g: number, b: number): void {
    this.r = r;
    this.g = g;
    this.b = b;
  }
}
type FakeNode = {
  id: number;
  name: string;
  parent: FakeNode | null;
  children: FakeNode[];
  userData: Record<string, unknown>;
  isMesh?: boolean;
  visible: boolean;
  material?: unknown;
  background?: unknown;
  traverse: (fn: (node: FakeNode) => void) => void;
  getObjectById: (id: number) => FakeNode | undefined;
};
function fakeScene(): { scene: FakeNode; meshes: FakeNode[]; materials: unknown[]; background: FakeColor } {
  let next = 1;
  const all: FakeNode[] = [];
  const node = (name: string, parent: FakeNode | null, extra: Partial<FakeNode> = {}): FakeNode => {
    const n: FakeNode = {
      id: next++,
      name,
      parent,
      children: [],
      userData: {},
      visible: true,
      traverse(fn) {
        fn(n);
        for (const child of n.children) child.traverse(fn);
      },
      getObjectById: (id) => all.find((x) => x.id === id),
      ...extra,
    };
    all.push(n);
    parent?.children.push(n);
    return n;
  };
  const material = () => ({ color: new FakeColor(0.5, 0.4, 0.3), clone() { return { ...this, color: new FakeColor(0.5, 0.4, 0.3) }; } });
  const background = new FakeColor(0.9, 0.9, 0.9);
  const scene = node("scene", null, { background });
  const actor = node("actor", scene);
  actor.userData.openClinXrActorId = "patient_robert_hayes_v1";
  const body = node("body", actor, { isMesh: true, material: material() });
  const garment = node("garment", body, { isMesh: true, material: material() });
  const bed = node("bed", scene, { isMesh: true, material: material() });
  return { scene, meshes: [body, garment, bed], materials: [body.material, garment.material, bed.material], background };
}
function inPage<T>(source: string): T {
  return new Function(`return ${source}`)() as T;
}

it("BEHAVIOUR mask setup whitens every actor descendant, hides the rest, and restore returns every field exactly", () => {
  const { scene, meshes, materials, background } = fakeScene();
  const g = globalThis as Record<string, unknown>;
  g.__openClinXrDebugScene = scene;
  try {
    const setup = inPage<{ ok: boolean; meshCount: number }>(`(${SETUP_SOURCE})("patient_robert_hayes_v1")`);
    expect(setup.ok).toBe(true);
    expect(setup.meshCount).toBe(2);
    expect(meshes[2]?.visible).toBe(false);
    expect(meshes[0]?.material).not.toBe(materials[0]);
    expect(scene.background).not.toBe(background);
    const restore = inPage<{ ok: boolean }>(`(${RESTORE_SOURCE})()`);
    expect(restore.ok).toBe(true);
    expect(meshes.map((m) => m.visible)).toEqual([true, true, true]);
    expect(meshes.map((m) => m.material)).toEqual(materials);
    expect(scene.background).toBe(background);
  } finally {
    delete g.__openClinXrDebugScene;
    delete g.__openClinXrMaskSaved;
  }
});

it("every page.evaluate of the restore source calls it", () => {
  const source = readFileSync(path.join(process.cwd(), "tools", "openclinxr", "evidence", "site", "capture", "inspector-mask.mjs"), "utf8");
  const calls = source.match(/\(\$\{RESTORE_SOURCE\}\)[^`]*`/g) ?? [];
  expect(calls.length).toBeGreaterThanOrEqual(2);
  for (const call of calls) expect(call).toBe("(${RESTORE_SOURCE})()`");
});

class VisColor {
  r: number;
  g: number;
  b: number;
  constructor(r = 0, g = 0, b = 0) {
    this.r = r;
    this.g = g;
    this.b = b;
  }
  setRGB(r: number, g: number, b: number): void {
    this.r = r;
    this.g = g;
    this.b = b;
  }
}
type VisNode = {
  id: number;
  name: string;
  parent: VisNode | null;
  children: VisNode[];
  userData: Record<string, unknown>;
  isMesh?: boolean;
  isSkinnedMesh?: boolean;
  visible: boolean;
  material?: { color: VisColor; clone: () => { color: VisColor } };
  background?: unknown;
  traverse: (fn: (node: VisNode) => void) => void;
  getObjectById: (id: number) => VisNode | undefined;
};
function visibilityScene(): { scene: VisNode; byName: Record<string, VisNode>; background: VisColor } {
  let next = 1;
  const all: VisNode[] = [];
  const byName: Record<string, VisNode> = {};
  const node = (name: string, parent: VisNode | null, extra: Partial<VisNode> = {}): VisNode => {
    const n: VisNode = {
      id: next++,
      name,
      parent,
      children: [],
      userData: {},
      visible: true,
      traverse(fn) {
        fn(n);
        for (const child of n.children) child.traverse(fn);
      },
      getObjectById: (id) => all.find((x) => x.id === id),
      ...extra,
    };
    all.push(n);
    byName[name] = n;
    parent?.children.push(n);
    return n;
  };
  const material = () => ({
    color: new VisColor(0.5, 0.4, 0.3),
    clone() {
      return { color: new VisColor(0.5, 0.4, 0.3) };
    },
  });
  const background = new VisColor(0.9, 0.9, 0.9);
  const scene = node("scene", null, { background });
  const actor = node("actor", scene);
  actor.userData.openClinXrActorId = "patient_robert_hayes_v1";
  node("body", actor, { isMesh: true, material: material() });
  node("prefix.actor-nameplate.patient", actor, { isMesh: true, visible: false, material: material() });
  const proxies = node("proxies", actor, { visible: false });
  node("prefix.ragdoll-collision-proxy.patient", proxies, { isMesh: true, material: material() });
  node("prefix.physician-interaction-target.patient", proxies, { isMesh: true, material: material() });
  node("prefix.glb-affordance.patient:dialogue_target", actor, { isMesh: true, visible: false, material: material() });
  node("spouse-body", scene, { isMesh: true, material: material() });
  return { scene, byName, background };
}

it("G1 mask counts only effectively-visible actor meshes: hidden-ancestor proxy and hidden nameplate are excluded", () => {
  const { scene, byName, background } = visibilityScene();
  const g = globalThis as Record<string, unknown>;
  g.__openClinXrDebugScene = scene;
  try {
    expect(isEffectivelyVisible(byName["prefix.ragdoll-collision-proxy.patient"])).toBe(false);
    expect(isEffectivelyVisible(byName["prefix.actor-nameplate.patient"])).toBe(false);
    expect(isEffectivelyVisible(byName["prefix.glb-affordance.patient:dialogue_target"])).toBe(false);
    expect(isEffectivelyVisible(byName["body"])).toBe(true);
    const setup = planMaskSetupInner("patient_robert_hayes_v1", isEffectivelyVisible) as {
      ok: boolean;
      meshCount: number;
      meshNames: string[];
    };
    expect(setup.ok).toBe(true);
    expect(setup.meshCount).toBe(1);
    expect(setup.meshNames).toEqual(["body"]);
    const white = byName["body"]?.material;
    for (const name of [
      "prefix.ragdoll-collision-proxy.patient",
      "prefix.physician-interaction-target.patient",
      "prefix.actor-nameplate.patient",
      "prefix.glb-affordance.patient:dialogue_target",
    ]) {
      expect(byName[name]?.material).not.toBe(white);
    }
    expect(byName["spouse-body"]?.visible).toBe(false);
    const restore = planMaskRestore() as { ok: boolean };
    expect(restore.ok).toBe(true);
    expect(byName["spouse-body"]?.visible).toBe(true);
    expect(scene.background).toBe(background);
  } finally {
    delete g.__openClinXrDebugScene;
    delete g.__openClinXrMaskSaved;
  }
});

it("G1 cast-mode discriminator: eye at recomputed height is full-cast, 0.5445 m lower is partial-cast, 0.26 m lower is full-cast, absent userData is unknown; mode never blocks", () => {
  const castTopY = 1.6394;
  const roomCapY = 2.05;
  const expected = Math.min(castTopY, roomCapY);
  const full = classifyCastMode({ eyeY: expected, castTopY, roomCapY, castComplete: true, userDataPresent: true });
  expect(full.mode).toBe("full-cast");
  expect(full.expectedTopY).toBeCloseTo(expected, 10);
  expect(full.deltaM).toBeCloseTo(0, 10);
  const partial = classifyCastMode({
    eyeY: expected - 0.5445,
    castTopY,
    roomCapY,
    castComplete: true,
    userDataPresent: true,
  });
  expect(partial.mode).toBe("partial-cast");
  expect(partial.deltaM).toBeCloseTo(0.5445, 10);
  const boundary = classifyCastMode({
    eyeY: expected - 0.26,
    castTopY,
    roomCapY,
    castComplete: true,
    userDataPresent: true,
  });
  expect(boundary.mode).toBe("full-cast");
  expect(CAST_MODE_TOLERANCE_M).toBe(0.27);
  const noUserData = classifyCastMode({
    eyeY: expected,
    castTopY,
    roomCapY,
    castComplete: true,
    userDataPresent: false,
  });
  expect(noUserData).toEqual({ mode: "unknown", expectedTopY: null, deltaM: null });
  const incompleteCast = classifyCastMode({
    eyeY: expected,
    castTopY,
    roomCapY,
    castComplete: false,
    userDataPresent: true,
  });
  expect(incompleteCast.mode).toBe("unknown");
  expect(castModeBlockers(true)).toEqual([]);
  expect(castModeBlockers(false)).toEqual([CAST_TIMEOUT_BLOCKER]);
  expect(CAST_TIMEOUT_BLOCKER).toBe("cast-timeout");
});

it("G3 camera wait polls the full-cast predicate: false then true resolves only after true", async () => {
  const g = globalThis as Record<string, unknown>;
  const incomplete = {
    traverse(fn: (node: unknown) => void) {
      const root = {
        userData: { openClinXrActorId: "patient_robert_hayes_v1" },
        traverse(inner: (node: unknown) => void) {
          inner(root);
        },
      };
      fn(root);
    },
  };
  const complete = {
    traverse(fn: (node: unknown) => void) {
      const skinned = { isSkinnedMesh: true };
      const root = {
        userData: { openClinXrActorId: "patient_robert_hayes_v1" },
        traverse(inner: (node: unknown) => void) {
          inner(root);
          inner(skinned);
        },
      };
      fn(root);
    },
  };
  expect(castCompletePredicate(["patient_robert_hayes_v1"])).toBe(false);
  let evaluations = 0;
  const fakePage = {
    waitForFunction: async (pred: (ids: string[]) => boolean, arg: string[]) => {
      for (let i = 0; i < 10; i += 1) {
        g.__openClinXrDebugScene = i === 0 ? incomplete : complete;
        evaluations += 1;
        if (pred(arg) === true) return undefined;
      }
      throw new Error("predicate never true");
    },
  };
  try {
    const result = await waitForCastComplete(fakePage, ["patient_robert_hayes_v1"], { timeoutMs: 5000 });
    expect(result).toEqual({ ok: true });
    expect(evaluations).toBe(2);
  } finally {
    delete g.__openClinXrDebugScene;
  }
});

it("G5 w0 capture.json camera gains interiorPreviewCamera from inspector-still readCamera, verbatim when present and null when absent", async () => {
  const g = globalThis as Record<string, unknown>;
  const framing = {
    eyeWorld: [2.7, 1.09, 0.6],
    lookAtWorld: [0, 0.9, 0],
    policy: "authored",
    interiorMin: [0, 0, 0],
    interiorMax: [5, 2.5, 5],
    wallThicknessMeters: 0.2,
    nearestActorMeters: 1.1,
  };
  g.__openClinXrGazeCamera = {
    position: { x: 1, y: 2, z: 3 },
    quaternion: { x: 0, y: 0, z: 0, w: 1 },
    fov: 55,
    userData: { openClinXrInteriorPreviewCamera: framing },
  };
  try {
    const fakePage = {
      evaluate: async (fn: unknown) => (typeof fn === "function" ? (fn as () => unknown)() : null),
    };
    expect(await readCamera(fakePage)).toEqual({
      source: "__openClinXrGazeCamera",
      position: [1, 2, 3],
      quaternion: [0, 0, 0, 1],
      fov: 55,
      interiorPreviewCamera: framing,
    });
    g.__openClinXrGazeCamera = {
      position: { x: 1, y: 2, z: 3 },
      quaternion: { x: 0, y: 0, z: 0, w: 1 },
      fov: 55,
      userData: {},
    };
    expect(await readCamera(fakePage)).toEqual({
      source: "__openClinXrGazeCamera",
      position: [1, 2, 3],
      quaternion: [0, 0, 0, 1],
      fov: 55,
      interiorPreviewCamera: null,
    });
  } finally {
    delete g.__openClinXrGazeCamera;
  }
  const w0Source = readFileSync(
    path.join(process.cwd(), "tools", "openclinxr", "evidence", "site", "capture", "w0-still.mjs"),
    "utf8",
  );
  expect(w0Source).toContain('import { readCamera } from "./inspector-still.mjs"');
  expect(w0Source).toContain("\n      camera,\n");
});

it("G2a MASK_THRESHOLD stays a named constant citing the w0/run-6 pixel match", () => {
  const maskSource = readFileSync(
    path.join(process.cwd(), "tools", "openclinxr", "evidence", "site", "capture", "inspector-mask.mjs"),
    "utf8",
  );
  expect(maskSource).toMatch(/export const MASK_THRESHOLD = 32/);
  expect(maskSource).toContain("w0/run-6");
});
