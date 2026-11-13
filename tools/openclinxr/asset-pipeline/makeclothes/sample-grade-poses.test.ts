/** M5 plant: the poses promote is one atomic directory rename, not per-file moves. */
import { existsSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { promoteStagedDir } from "./sample-grade-poses.ts";

const MANIFEST = ["a.bin", "meta.json"];

function stage(names: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), "sgp-stage-"));
  for (const name of names) writeFileSync(join(dir, name), name);
  return dir;
}

describe("sample-grade-poses atomic promote (e9-r2d M5)", () => {
  it("promotes the exact manifest with one directory rename", () => {
    const parent = mkdtempSync(join(tmpdir(), "sgp-parent-"));
    const staged = stage(MANIFEST);
    const outDir = join(parent, "poses");
    promoteStagedDir(staged, outDir, MANIFEST);
    expect(readdirSync(outDir).sort()).toEqual([...MANIFEST].sort());
    expect(readFileSync(join(outDir, "meta.json"), "utf8")).toBe("meta.json");
    expect(existsSync(staged)).toBe(false);
  });

  it("plant: manifest mismatch cleans the stage and leaves the destination absent", () => {
    const parent = mkdtempSync(join(tmpdir(), "sgp-parent-"));
    const staged = stage(["partial.bin"]);
    const outDir = join(parent, "poses");
    expect(() => promoteStagedDir(staged, outDir, MANIFEST)).toThrow(/!= manifest/);
    expect(existsSync(outDir), "destination stays absent after a mid-write failure").toBe(false);
    expect(existsSync(staged), "no temp stage is left behind").toBe(false);
    expect(readdirSync(parent), "parent holds no stray entries").toEqual([]);
  });

  it("plant: extra stale entry refuses; existing destination refuses and is left unchanged", () => {
    const parent = mkdtempSync(join(tmpdir(), "sgp-parent-"));
    const outDir = join(parent, "poses");
    writeFileSync(join(parent, "keep.txt"), "keep");
    const stale = stage([...MANIFEST, "stale.bin"]);
    expect(() => promoteStagedDir(stale, outDir, MANIFEST)).toThrow(/!= manifest/);
    expect(existsSync(outDir)).toBe(false);
    expect(existsSync(stale)).toBe(false);
    // Absent-destination promote is the single atomic rename; an existing
    // destination is refused (no backup swap), stage cleaned, content intact.
    const dest = mkdtempSync(join(tmpdir(), "sgp-dest-"));
    writeFileSync(join(dest, "old.bin"), "old");
    renameSync(dest, outDir);
    const staged = stage(MANIFEST);
    expect(() => promoteStagedDir(staged, outDir, MANIFEST)).toThrow(/already exists/);
    expect(readdirSync(outDir).sort()).toEqual(["old.bin"]);
    expect(readFileSync(join(outDir, "old.bin"), "utf8"), "existing destination content unchanged").toBe("old");
    expect(existsSync(staged), "refused stage is cleaned").toBe(false);
    rmSync(parent, { recursive: true, force: true });
  });
});
