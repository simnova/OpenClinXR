/**
 * The public entry exposes no tuning (MADR 0061 d6).
 *
 * Fails if any runtime export name or any `public-api.json` "." name contains
 * a tuning or solver token. The seat target travels as the caller-supplied
 * `targetGapMm` field, never as a named knob; the pinned producer values stay
 * private to the package.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as entry from "./index.js";

const BANNED = /restDrop|downGain|clearance|passes|solve|solver/;

describe("the public entry exposes no tuning", () => {
  it("no runtime export name carries a tuning or solver token", () => {
    expect(Object.keys(entry).length).toBeGreaterThan(0);
    for (const name of Object.keys(entry)) {
      expect(name, name).not.toMatch(BANNED);
    }
  });

  it('public-api.json "." lists exactly the reviewed surface with no banned token', () => {
    const api = JSON.parse(
      readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "public-api.json"), "utf8"),
    ) as { entrypoints: { ".": string[] } };
    expect([...api.entrypoints["."]].sort()).toEqual([
      "ApplyProvenance",
      "ApplyResult",
      "BuildProblemOptions",
      "Problem",
      "Solution",
      "apply",
      "buildProblem",
    ]);
    for (const name of api.entrypoints["."]) {
      expect(name, name).not.toMatch(BANNED);
    }
  });
});
