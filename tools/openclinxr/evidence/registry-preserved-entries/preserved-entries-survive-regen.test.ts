import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { buildGeneratedArtifactRegistry } from "../../../agent-factory/build-generated-artifact-registry.ts";

/**
 * Builder-level contract for preserved entries + targeted append.
 *
 * (1) a path the scan cannot reproduce but that is explicitly preserved SURVIVES
 * (2) a path that is genuinely gone and NOT preserved is still cleared by --allow-shrink
 * (3) COUNTERWEIGHT: an arbitrary present-file removal that nobody preserved is STILL refused
 *
 * Clause (3) is the cheap pass this card exists to prevent: "keep everything present".
 */

const REL_JSON = "docs/openclinxr/generated-artifact-registry-2026-05-27.json";
const REL_MD = "docs/openclinxr/generated-artifact-registry-2026-05-27.md";

const temps: string[] = [];

afterEach(() => {
  while (temps.length > 0) {
    const dir = temps.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function seed(tmp: string, paths: readonly string[]): void {
  const entries = paths.map((p) => ({
    path: p,
    authority: "keep-evidence",
    tracked: false,
    action: "keep",
    rationale: "seed",
  }));
  const jsonAbs = path.join(tmp, REL_JSON);
  mkdirSync(path.dirname(jsonAbs), { recursive: true });
  writeFileSync(
    jsonAbs,
    `${JSON.stringify({ schemaVersion: "2026-05-27", counts: {}, entries }, null, 2)}\n`,
  );
  writeFileSync(path.join(tmp, REL_MD), "# seed\n");
}

function touch(tmp: string, rel: string): void {
  const abs = path.join(tmp, rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, "fixture\n");
}

describe("preserved entries and targeted append", () => {
  it("(1) a preserved unscannable path survives regeneration", () => {
    const tmp = mkdtempSync(path.join(tmpdir(), "openclinxr-preserved-survive-"));
    temps.push(tmp);
    seed(tmp, ["scan/keep.json", "outside/preserved.json"]);
    touch(tmp, "scan/keep.json");
    touch(tmp, "outside/preserved.json");

    const result = buildGeneratedArtifactRegistry({
      cwd: tmp,
      allowShrink: false,
      pathListOverride: ["scan/keep.json"],
      preservedEntries: [{ path: "outside/preserved.json", reason: "scan root does not include outside/" }],
      logError: () => {},
    });

    expect(result.ok, result.stderr).toBe(true);
    expect(result.wrote).toBe(true);
    const written = JSON.parse(readFileSync(path.join(tmp, REL_JSON), "utf8")) as {
      entries: Array<{ path: string; rationale: string }>;
    };
    const paths = written.entries.map((e) => e.path).sort();
    expect(paths).toEqual(["outside/preserved.json", "scan/keep.json"]);
    expect(written.entries.find((e) => e.path === "outside/preserved.json")?.rationale).toBe(
      "scan root does not include outside/",
    );
  });

  it("(2) a gone unpreserved path is still cleared by --allow-shrink", () => {
    const tmp = mkdtempSync(path.join(tmpdir(), "openclinxr-preserved-missing-"));
    temps.push(tmp);
    seed(tmp, ["scan/keep.json", "gone/stale.json"]);
    touch(tmp, "scan/keep.json");

    const result = buildGeneratedArtifactRegistry({
      cwd: tmp,
      allowShrink: true,
      pathListOverride: ["scan/keep.json"],
      preservedEntries: [],
      logError: () => {},
    });

    expect(result.ok, result.stderr).toBe(true);
    expect(result.removedPaths).toEqual(["gone/stale.json"]);
    const written = JSON.parse(readFileSync(path.join(tmp, REL_JSON), "utf8")) as {
      entries: Array<{ path: string }>;
    };
    expect(written.entries.map((e) => e.path)).toEqual(["scan/keep.json"]);
  });

  it("(3) COUNTERWEIGHT: an unpreserved present-file removal is still refused", () => {
    const tmp = mkdtempSync(path.join(tmpdir(), "openclinxr-preserved-counter-"));
    temps.push(tmp);
    seed(tmp, ["scan/keep.json", "outside/live.json"]);
    touch(tmp, "scan/keep.json");
    touch(tmp, "outside/live.json");

    const result = buildGeneratedArtifactRegistry({
      cwd: tmp,
      allowShrink: true,
      pathListOverride: ["scan/keep.json"],
      preservedEntries: [],
      logError: () => {},
    });

    expect(result.ok).toBe(false);
    expect(result.wrote).toBe(false);
    expect(result.removedPaths).toEqual(["outside/live.json"]);
    expect(readFileSync(path.join(tmp, REL_MD), "utf8")).toBe("# seed\n");
  });

  it("(4) --append registers one existing path without a wholesale scan", () => {
    const tmp = mkdtempSync(path.join(tmpdir(), "openclinxr-preserved-append-"));
    temps.push(tmp);
    seed(tmp, ["scan/keep.json"]);
    touch(tmp, "scan/keep.json");
    touch(tmp, "tools/new-artifact.json");

    const result = buildGeneratedArtifactRegistry({
      cwd: tmp,
      appendPath: "tools/new-artifact.json",
      preservedEntries: [],
      logError: () => {},
    });

    expect(result.ok, result.stderr).toBe(true);
    expect(result.wrote).toBe(true);
    const written = JSON.parse(readFileSync(path.join(tmp, REL_JSON), "utf8")) as {
      entries: Array<{ path: string }>;
    };
    expect(written.entries.map((e) => e.path).sort()).toEqual(["scan/keep.json", "tools/new-artifact.json"]);
  });
});
