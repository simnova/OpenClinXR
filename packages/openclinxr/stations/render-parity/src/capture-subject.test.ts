import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadCameras } from "./capture-args.js";
import { buildSpec, type SubjectSpec } from "./capture-spec.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));

const KEVIN: SubjectSpec = {
  id: "kevin-parity",
  bodyGlb: "generated-humanoids/mpfb-peds-nurse-kevin.glb",
  hdriUrl: "/cagematch/kevin-parity/studio_small_09_2k.hdr",
  bodyMeshName: "mpfb_peds_nurse_kevin_v1_body",
  garmentMeshNames: ["kevin_scrubs_top"],
};

const HEAD_FRONT = {
  name: "head_front",
  resolution: [1536, 1536] as [number, number],
  vfov_deg: 30,
  near: 0.01,
  far: 100,
  three: {
    position: [0, 1.6, 2] as [number, number, number],
    target: [0, 1.5, 0] as [number, number, number],
    up: [0, 1, 0] as [number, number, number],
    quaternion: [0, 0, 0, 1] as [number, number, number, number],
  },
};

describe("non-Aisha subject: spec carries the injected subject", () => {
  it("buildSpec yields the Kevin values for beauty and masks modes", () => {
    const beauty = buildSpec(HEAD_FRONT, KEVIN, { levers: { exposure: 0.87 }, masks: false, calibSpheres: null, nohair: false });
    expect(beauty["subjectId"]).toBe("kevin-parity");
    expect(beauty["bodyGlb"]).toBe("generated-humanoids/mpfb-peds-nurse-kevin.glb");
    expect((beauty["rigOverride"] as { hdri: { url: string } }).hdri.url).toBe(
      "/cagematch/kevin-parity/studio_small_09_2k.hdr",
    );
    const masks = buildSpec(HEAD_FRONT, KEVIN, { levers: {}, masks: true, calibSpheres: null, nohair: false });
    expect(masks["subjectId"]).toBe("kevin-parity");
    expect(masks["bodyGlb"]).toBe("generated-humanoids/mpfb-peds-nurse-kevin.glb");
  });

  it("loadCameras still parses the shared camera record shape", () => {
    const cams = loadCameras(JSON.stringify({ cameras: [HEAD_FRONT] }));
    expect(cams).toHaveLength(1);
    expect(cams[0]!.name).toBe("head_front");
  });

  it("counterweight: no non-test source contains the old subject name", async () => {
    const files: string[] = [];
    for (const entry of await readdir(HERE, { withFileTypes: true })) {
      if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) files.push(path.join(HERE, entry.name));
    }
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const text = await readFile(file, "utf8");
      expect(text.toLowerCase()).not.toContain("aisha");
    }
  });
});
