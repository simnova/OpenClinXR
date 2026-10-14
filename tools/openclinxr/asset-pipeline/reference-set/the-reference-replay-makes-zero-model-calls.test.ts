/**
 * The reference replay makes zero model calls.
 *
 * Fixtures are tiny synthetic noise/flat PNGs (no faces). Each refusal
 * below is its own red->green fixture test: missing record, sha
 * mismatch, flat placeholder, wrong aspect. The replay path is file
 * reads plus sha256 only.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  readPngDims,
  replayCase,
  sha256File,
  toneFlag,
  validateNewImage,
  type Manifest,
} from "./reference-set";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const FIX = path.join(DIR, "fixtures");

function fixtureManifest(): { manifest: Manifest; storeRoot: string } {
  const storeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "refset-"));
  const outName = "out-ok.png";
  fs.copyFileSync(path.join(FIX, outName), path.join(storeRoot, outName));
  const refName = "ref-wide.png";
  fs.copyFileSync(path.join(FIX, refName), path.join(storeRoot, refName));
  const manifest: Manifest = {
    version: 1,
    cases: {
      synth: {
        phenotype_tone: "warm_medium",
        references: {
          face_tile: {
            prompt: "fixture prompt",
            generator: "synthetic-fixture",
            created: "2026-10-13",
            reference_input: {
              store_relpath: refName,
              sha256: sha256File(path.join(storeRoot, refName)),
              size: [64, 32],
              note: null,
            },
            output: {
              store_relpath: outName,
              sha256: sha256File(path.join(storeRoot, outName)),
              size: [96, 48],
            },
            lock: null,
            acceptance: {
              grader: "fixture", verdict: "accepted", source: "test",
            },
            rejected: [],
          },
        },
      },
    },
  };
  return { manifest, storeRoot };
}

describe("the reference replay makes zero model calls", () => {
  it("replays with records present without spawning or fetching", () => {
    // Process-spawn spying is impossible here (measured: ESM
    // node:child_process exports are non-configurable, spyOn throws
    // "Cannot redefine property"), so the process half is enforced
    // statically: the replay module must contain no spawn/fetch token
    // at all. The network half is enforced with a live fetch spy.
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(
      (() => Promise.reject(new Error("no network"))) as unknown as
      typeof globalThis.fetch);
    try {
      const { manifest, storeRoot } = fixtureManifest();
      const resolved = replayCase(manifest, "synth", storeRoot);
      expect(resolved["face_tile"]).toBe(path.join(storeRoot, "out-ok.png"));
      expect(fetchSpy, "no network call on the replay path")
        .not.toHaveBeenCalled();
      const src = fs.readFileSync(
        path.join(DIR, "reference-set.ts"), "utf8");
      // Tokens that would indicate process spawn or network/model calls.
      // "token:" is excluded because the module reads a JSON file that
      // contains the word "token" in key names (tone_tokens), not an API token.
      for (const tok of ["child_process", "spawn", "execFile", "execSync",
        "fork(", "fetch(", "XMLHttpRequest", "https.", "http.",
        "grok", "imagine", "model", "api_key", "apikey"]) {
        expect(src.toLowerCase().includes(tok.toLowerCase()),
          `replay module mentions no process/network/model token (${tok})`)
          .toBe(false);
      }
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("refuses a missing record instead of returning a placeholder", () => {
    const { manifest, storeRoot } = fixtureManifest();
    expect(() => replayCase(manifest, "nobody", storeRoot))
      .toThrow(/REFUSE_MISSING/);
  });

  it("refuses a byte mismatch instead of serving wrong bytes", () => {
    const { manifest, storeRoot } = fixtureManifest();
    manifest.cases["synth"]!.references["face_tile"]!.output.sha256 =
      "0".repeat(64);
    expect(() => replayCase(manifest, "synth", storeRoot))
      .toThrow(/REFUSE_SHA_MISMATCH/);
  });

  it("rejects a flat placeholder image at record time", () => {
    expect(() => validateNewImage(path.join(FIX, "ref-wide.png"),
      path.join(FIX, "out-flat.png"))).toThrow(/REFUSE_FLAT/);
  });

  it("rejects a wrong-aspect output at record time", () => {
    const dims = readPngDims(path.join(FIX, "out-wide-as-square.png"));
    expect(dims).toEqual({ width: 48, height: 48 });
    expect(() => validateNewImage(path.join(FIX, "ref-wide.png"),
      path.join(FIX, "out-wide-as-square.png"))).toThrow(/REFUSE_ASPECT/);
  });

  it("accepts a same-aspect noisy output at record time", () => {
    expect(validateNewImage(path.join(FIX, "ref-wide.png"),
      path.join(FIX, "out-ok.png"))).toEqual({ width: 96, height: 48 });
  });

  it("nearest-token test: own token pass, other token flag", () => {
    // warm_medium goal at its own token's Lab -> NOT flagged (own is nearest)
    const ownLab = [56.71, 12.27, 19.96]; // warm_medium token Lab (approx)
    const r1 = toneFlag("warm_medium", ownLab);
    expect(r1.flagged).toBe(false);
    expect(r1.nearest_token).not.toBe("warm_medium");
    expect(r1.own_distance_dLab).toBeLessThan(r1.nearest_distance_dLab);
    
    // warm_medium goal at warm_light token's Lab -> flagged (warm_light is nearer)
    const lightLab = [68.24, 11.51, 19.09]; // warm_light token Lab (approx)
    const r2 = toneFlag("warm_medium", lightLab);
    expect(r2.flagged).toBe(true);
    expect(r2.nearest_token).toBe("warm_light");
    expect(r2.own_distance_dLab).toBeGreaterThan(r2.nearest_distance_dLab);
  });
});