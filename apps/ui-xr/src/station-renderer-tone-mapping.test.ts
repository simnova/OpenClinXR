/**
 * S3 pin: the station renderer must use ACESFilmicToneMapping so the rig
 * exposure value takes effect. Guards against an unrelated refactor silently
 * dropping the curve (which reads as "exposure does nothing" + clipped floors).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ACESFilmicToneMapping, NoToneMapping, type WebGLRenderer } from "three";
import { configureStationRendererToneMapping } from "./lighting-rig-runtime.js";

describe("station renderer tone mapping (S3 pin)", () => {
  it("configures ACESFilmicToneMapping, not the three.js NoToneMapping default", () => {
    const renderer = { toneMapping: NoToneMapping } as unknown as WebGLRenderer;
    configureStationRendererToneMapping(renderer);
    expect(renderer.toneMapping).toBe(ACESFilmicToneMapping);
    expect(ACESFilmicToneMapping).not.toBe(NoToneMapping);
  });

  it("main.ts station scene still routes renderer construction through the helper", () => {
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "main.ts"), "utf8");
    // Anchored to line start so a commented-out call does not satisfy the pin.
    expect(source).toMatch(/^\s*configureStationRendererToneMapping\(renderer\);$/m);
  });
});
