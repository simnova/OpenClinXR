import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  canonicalJson,
  collectStageKeyInputs,
  lookupStageCache,
  readCachedResult,
  resolveStageKeyFiles,
  restoreStageCache,
  scrubLightingKeyInput,
  sha256Hex,
  stageKeyDigest,
  storeStageCache,
} from "./cache.js";
import {
  parseWardChainArgs,
  RoomChainRecipeValidationError,
  validateRoomChainRecipe,
} from "./run.js";
import { ROOM_CHAIN_RECIPES } from "@openclinxr/factory-stations/room-chain";

/**
 * Room-chain stage cache unit tests. Pure: no Blender, no Infinigen install,
 * no network. Filesystem reads stay inside the repo (script sources) or a
 * tmp dir; the Blender/Git probes are bypassed via overrides.
 *
 * Cache primitives and CLI parsing remain private unit-test seams. The public
 * runRoomChain/ROOM_CHAIN_RECIPES contract is exercised through ./room-chain by the
 * cwd tests; these private imports count toward the unchanged import ceiling.
 */

const GEN_INPUT = {
  environmentId: "inpatient_ward_room_v1",
  infinigenPrompt: "inpatient ward room",
  seed: 205,
  layoutVariant: "default",
  footprintMeters: { width: 8.77, depth: 7.77, ceilingHeight: 2.42 },
  door: { doorWall: "+y", wallOffsetM: 0.5, hingeSide: "+x", style: "lite", widthM: 0.95, heightM: 2.1 },
};

const FINISH_INPUT = {
  environmentId: "inpatient_ward_room_v1",
  preset: "ward_photo",
  seed: 205,
};

const LIGHT_INPUT = {
  environmentId: "inpatient_ward_room_v1",
  roomGlbPath: "ward-chain.work.glb",
  bboxJson: JSON.stringify({ minX: -4.385, maxX: 4.385, minY: -3.885, maxY: 3.885, minZ: 0, maxZ: 2.42 }),
  castJson: JSON.stringify([{ actorId: "patient", position: [0, 0.5, 1.0] }]),
  mood: "clinic_day",
  seed: 205,
};

const PROBE_OVERRIDES = {
  blenderVersion: "Blender 5.1.1 (test)",
  infinigenCommit: "b11700ebac77695d8f53538705cfdc0cd890c54d",
  infinigenDecorateSha256: "decorate-test-sha",
};

const fakeFileSha256 = (absPath: string): string | null => sha256Hex(`fake-content:${absPath}`);

let tempRoot: string | null = null;

afterEach(() => {
  if (tempRoot) rmSync(tempRoot, { recursive: true, force: true });
  tempRoot = null;
});

function makeTempRoot(): string {
  tempRoot = mkdtempSync(path.join(tmpdir(), "room-chain-cache-test-"));
  return tempRoot;
}

describe("room-chain stage cache keys", () => {
  it("is deterministic for identical inputs", () => {
    const first = collectStageKeyInputs("room_generate", {
      input: { ...GEN_INPUT },
      overrides: { ...PROBE_OVERRIDES, fileSha256: fakeFileSha256 },
    });
    const second = collectStageKeyInputs("room_generate", {
      input: { ...GEN_INPUT },
      overrides: { ...PROBE_OVERRIDES, fileSha256: fakeFileSha256 },
    });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) expect(first.key).toBe(second.key);
  });

  it("changes when a stage param changes", () => {
    const base = collectStageKeyInputs("room_generate", {
      input: { ...GEN_INPUT },
      overrides: { ...PROBE_OVERRIDES, fileSha256: fakeFileSha256 },
    });
    const seeded = collectStageKeyInputs("room_generate", {
      input: { ...GEN_INPUT, seed: 206 },
      overrides: { ...PROBE_OVERRIDES, fileSha256: fakeFileSha256 },
    });
    expect(base.ok && seeded.ok).toBe(true);
    if (base.ok && seeded.ok) expect(base.key).not.toBe(seeded.key);
  });

  it("changes when one script byte changes", () => {
    const base = collectStageKeyInputs("room_clinic_finish", {
      input: { ...FINISH_INPUT },
      overrides: { ...PROBE_OVERRIDES, fileSha256: fakeFileSha256 },
    });
    const changed = collectStageKeyInputs("room_clinic_finish", {
      input: { ...FINISH_INPUT },
      overrides: {
        ...PROBE_OVERRIDES,
        fileSha256: (absPath: string) =>
          absPath.endsWith("compose.py")
            ? sha256Hex("one-byte-different")
            : fakeFileSha256(absPath),
      },
    });
    expect(base.ok && changed.ok).toBe(true);
    if (base.ok && changed.ok) expect(base.key).not.toBe(changed.key);
  });

  it("refuses the key when a file cannot be hashed", () => {
    const refused = collectStageKeyInputs("room_generate", {
      input: { ...GEN_INPUT },
      overrides: {
        ...PROBE_OVERRIDES,
        fileSha256: (absPath: string) =>
          absPath.endsWith("bake_shell_materials.py") ? null : fakeFileSha256(absPath),
      },
    });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.warning).toContain("bake_shell_materials.py");
  });

  it("chains the upstream key: same finish inputs, different bake, different key", () => {
    const first = collectStageKeyInputs("room_clinic_finish", {
      input: { ...FINISH_INPUT },
      upstreamKey: "bake-key-aaa",
      overrides: { ...PROBE_OVERRIDES, fileSha256: fakeFileSha256 },
    });
    const second = collectStageKeyInputs("room_clinic_finish", {
      input: { ...FINISH_INPUT },
      upstreamKey: "bake-key-bbb",
      overrides: { ...PROBE_OVERRIDES, fileSha256: fakeFileSha256 },
    });
    expect(first.ok && second.ok).toBe(true);
    if (first.ok && second.ok) expect(first.key).not.toBe(second.key);
  });

  it("lighting key is outDir-independent: same GLB name, different dir, same key", () => {
    const cold = { ...LIGHT_INPUT, roomGlbPath: "/repo/.openclinxr/evidence/red-cold/ward-chain.work.glb" };
    const warm = { ...LIGHT_INPUT, roomGlbPath: "/repo/.openclinxr/evidence/red-warm/ward-chain.work.glb" };
    const keyOf = (input: Record<string, unknown>): string => {
      const collected = collectStageKeyInputs("lighting_design", {
        input: scrubLightingKeyInput(input),
        upstreamKey: "finish-key",
        overrides: {
          ...PROBE_OVERRIDES,
          fileSha256: (absPath: string) =>
            absPath.endsWith("ward-chain.work.glb") ? sha256Hex("glb-bytes") : fakeFileSha256(absPath),
        },
        workGlbPath: "/tmp/ward-chain.work.glb",
      });
      expect(collected.ok).toBe(true);
      if (!collected.ok) throw new Error("unreachable");
      return collected.key;
    };
    // Same basename but different byte content must still miss.
    const sameDir = collectStageKeyInputs("lighting_design", {
      input: scrubLightingKeyInput(cold),
      upstreamKey: "finish-key",
      overrides: { ...PROBE_OVERRIDES, fileSha256: fakeFileSha256 },
      workGlbPath: "/tmp/ward-chain.work.glb",
    });
    expect(sameDir.ok).toBe(true);
    expect(keyOf(cold)).toBe(keyOf(warm));
    if (sameDir.ok) expect(keyOf(cold)).not.toBe(sameDir.key);
  });

  it("canonical JSON is field-order stable", () => {
    const inputs = {
      stage: "lighting_design",
      params: { b: 1, a: [3, 2, { z: 1, y: 2 }] },
    };
    const reordered = {
      params: { a: [3, 2, { y: 2, z: 1 }], b: 1 },
      stage: "lighting_design",
    };
    expect(canonicalJson(inputs)).toBe(canonicalJson(reordered));
    expect(stageKeyDigest({ ...inputs, extra: 1 } as never)).not.toBe(
      stageKeyDigest(inputs as never),
    );
  });
});

describe("room-chain stage file lists (real derivation, read-only)", () => {
  it("generate key covers every bake script but never compose.py", () => {
    const files = resolveStageKeyFiles("room_generate", GEN_INPUT);
    const names = files.map((file) => path.basename(file));
    expect(names).toContain("bake_shell_materials.py");
    expect(names).toContain("room-albedo-ao-bake.py");
    expect(names).toContain("room-occlusion-bake.py");
    expect(names).toContain("run_fixed_footprint.py");
    expect(names).toContain("infinigen-single-room-extract.py");
    expect(files.some((file) => file.endsWith(".patch"))).toBe(true);
    expect(files.some((file) => path.basename(file) === "compose.py")).toBe(false);
    expect(files.some((file) => file.includes("room_clinic_finish"))).toBe(false);
    expect(files.some((file) => file.includes("lighting_design"))).toBe(false);
  });

  it("finish key covers compose.py, its modules and its textures", () => {
    const files = resolveStageKeyFiles("room_clinic_finish", FINISH_INPUT);
    const names = files.map((file) => path.basename(file));
    expect(names).toContain("compose.py");
    expect(names).toContain("floor-vinyl.jpg");
    expect(names).toContain("door-maple.jpg");
    expect(names).toContain("ceiling-tile-face.png");
    expect(files.some((file) => file.includes("lighting_design"))).toBe(false);
    // The only room_generate paths a finish key may carry are the shared
    // Infinigen patches (uniform schema); never a generate-stage script.
    for (const file of files.filter((entry) => entry.includes("room_generate"))) {
      expect(file.endsWith(".patch")).toBe(true);
    }
    expect(names).not.toContain("bake_shell_materials.py");
    expect(names).not.toContain("room-albedo-ao-bake.py");
  });

  it("lighting key covers the rig script and nothing from other stages", () => {
    const files = resolveStageKeyFiles("lighting_design", LIGHT_INPUT);
    const names = files.map((file) => path.basename(file));
    expect(names).toContain("lighting-rig.py");
    expect(files.some((file) => path.basename(file) === "compose.py")).toBe(false);
    for (const file of files.filter((entry) => entry.includes("room_generate"))) {
      expect(file.endsWith(".patch")).toBe(true);
    }
    expect(names).not.toContain("bake_shell_materials.py");
  });
});

describe("room-chain cache store and lookup", () => {
  it("round-trips artifacts and the stage result", () => {
    const root = makeTempRoot();
    const collected = collectStageKeyInputs("lighting_design", {
      input: { ...LIGHT_INPUT },
      overrides: { ...PROBE_OVERRIDES, fileSha256: fakeFileSha256 },
    });
    expect(collected.ok).toBe(true);
    if (!collected.ok) return;
    const rigSrc = path.join(root, "rig.json");
    const reportSrc = path.join(root, "report.json");
    writeFileSync(rigSrc, '{"rig":true}\n', "utf8");
    writeFileSync(reportSrc, '{"report":true}\n', "utf8");
    expect(lookupStageCache("lighting_design", collected.key, root)).toBe(null);

    storeStageCache(
      "lighting_design",
      collected.key,
      collected.inputs,
      { stationId: "lighting_design", blenderExit: 0 },
      { "rig.json": rigSrc, "report.json": reportSrc },
      root,
    );
    const entry = lookupStageCache("lighting_design", collected.key, root);
    expect(entry).not.toBe(null);
    if (entry === null) return;
    expect(readCachedResult(entry)).toEqual({ stationId: "lighting_design", blenderExit: 0 });

    const outDir = path.join(root, "out");
    mkdirSync(outDir, { recursive: true });
    restoreStageCache(entry, {
      "rig.json": path.join(outDir, "ward-chain.lighting-rig.json"),
      "report.json": path.join(outDir, "ward-chain.lighting-report.json"),
    });
    expect(readFileSync(path.join(outDir, "ward-chain.lighting-rig.json"), "utf8")).toBe(
      '{"rig":true}\n',
    );
  });

  it("never serves an incomplete entry and removes it", () => {
    const root = makeTempRoot();
    const collected = collectStageKeyInputs("room_generate", {
      input: { ...GEN_INPUT },
      overrides: { ...PROBE_OVERRIDES, fileSha256: fakeFileSha256 },
    });
    expect(collected.ok).toBe(true);
    if (!collected.ok) return;
    // Simulate a killed run: key.json written, but no artifacts and no COMPLETE.
    const partial = path.join(root, ".openclinxr/cache/room-chain/room_generate", collected.key);
    mkdirSync(partial, { recursive: true });
    writeFileSync(path.join(partial, "key.json"), "{}\n", "utf8");
    expect(lookupStageCache("room_generate", collected.key, root)).toBe(null);
    expect(existsSync(partial)).toBe(false);
  });
});

describe("room-chain --no-cache flag", () => {
  it("defaults to false and parses the flag", () => {
    expect(parseWardChainArgs([]).noCache).toBe(false);
    expect(parseWardChainArgs(["--no-cache"]).noCache).toBe(true);
    expect(parseWardChainArgs(["--seed", "205", "--no-cache"]).noCache).toBe(true);
  });
});

describe("room-chain recipe registry", () => {
  it("accepts the shipped ward recipe", () => {
    const ward = validateRoomChainRecipe(ROOM_CHAIN_RECIPES.inpatient_ward_room_v1, "inpatient_ward_room_v1");
    expect(ward.finish?.preserveShell).toBe(true);
    expect(ward.finish?.floor).toEqual({ kind: "vinyl-tile", moduleM: 0.6 });
    expect(ward.finish?.ceiling).toEqual({ troffer: true, tbarMm: 24 });
  });

  it("fails closed with a named error on an unknown field", () => {
    expect(() => validateRoomChainRecipe({ ...ROOM_CHAIN_RECIPES.inpatient_ward_room_v1, typo: true }))
      .toThrow(RoomChainRecipeValidationError);
    expect(() => validateRoomChainRecipe({ ...ROOM_CHAIN_RECIPES.inpatient_ward_room_v1, typo: true }))
      .toThrow(/unknown field.*typo/);
  });
});
