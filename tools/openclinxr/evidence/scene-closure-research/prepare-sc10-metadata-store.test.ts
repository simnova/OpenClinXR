import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  storeValidationProblems,
  writeAliasRegistry,
  verifyPreparedStore,
} from "./prepare-sc10-metadata-store.js";
import {
  CANDIDATE_SOURCES,
  manifestRevisionProblems,
} from "./candidate-source-manifest.js";

/**
 * Admission/routing tests for the SC-10 CI metadata input preparation.
 * Pure unit scope: manifest validation, registry writing, and verification
 * through the actual local loader (no mocks; missing receipts refused via
 * the real loadRetrievedSources path). No network, no retrieval, no fixture.
 */

function fresh(): string {
  return mkdtempSync(path.join(tmpdir(), "sc10-"));
}

describe("prepare-sc10-metadata-store routing", () => {
  it("accepts the pinned production manifest with no validation problems", () => {
    expect(manifestRevisionProblems()).toEqual([]);
    expect(storeValidationProblems()).toEqual([]);
    expect(CANDIDATE_SOURCES.length).toBe(18);
  });

  it("refuses a source with an unexpected kind before any retrieval", () => {
    const tampered = [
      ...CANDIDATE_SOURCES.slice(0, 17),
      { ...CANDIDATE_SOURCES[17]!, kind: "weights" },
    ];
    const problems = storeValidationProblems(tampered as typeof CANDIDATE_SOURCES);
    expect(problems.some((p) => p.includes("unexpected kind"))).toBe(true);
  });

  it("refuses a source URL outside the pinned first-party metadata set", () => {
    const tampered = [
      { ...CANDIDATE_SOURCES[0]!, url: "https://example.com/unpinned-weights.bin" },
      ...CANDIDATE_SOURCES.slice(1),
    ];
    const problems = storeValidationProblems(tampered);
    expect(problems.length).toBeGreaterThan(0);
  });

  it("refuses URL credentials even on an allowlisted host", () => {
    const tampered = [
      { ...CANDIDATE_SOURCES[0]!, url: "https://user:pass@raw.githubusercontent.com/o/r/x.txt" },
      ...CANDIDATE_SOURCES.slice(1),
    ];
    expect(storeValidationProblems(tampered).some((p) => p.includes("credentials"))).toBe(true);
  });

  it("refuses a pinned model.safetensors URL even with a metadata kind", () => {
    const pin = "a".repeat(40);
    const tampered = [
      { ...CANDIDATE_SOURCES[0]!, url: `https://huggingface.co/o/r/resolve/${pin}/model.safetensors` },
      ...CANDIDATE_SOURCES.slice(1),
    ];
    expect(storeValidationProblems(tampered).some((p) => p.includes("model-weight"))).toBe(true);
  });

  it("writes alias JSON into a fresh directory and returns the actual path", () => {
    const base = fresh();
    try {
      const store = path.join(base, "store");
      const registryPath = writeAliasRegistry(store);
      expect(registryPath).toBe(path.join(store, "registry.json"));
      const parsed = JSON.parse(readFileSync(registryPath, "utf8")) as {
        aliases: Record<string, { root: string }>;
      };
      expect(parsed.aliases["sc-evidence"]!.root).toBe(store);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("permits an existing EMPTY directory", () => {
    const base = fresh();
    try {
      const store = path.join(base, "store");
      mkdirSync(store, { recursive: true });
      expect(writeAliasRegistry(store)).toBe(path.join(store, "registry.json"));
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("refuses a relative root, a nonempty root, and an existing registry", () => {
    expect(() => writeAliasRegistry("relative/path")).toThrow();
    const base = fresh();
    try {
      const store = path.join(base, "store");
      mkdirSync(store, { recursive: true });
      writeFileSync(path.join(store, "x"), "x");
      expect(() => writeAliasRegistry(store)).toThrow();
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
    const base2 = fresh();
    try {
      const store2 = path.join(base2, "store");
      const first = writeAliasRegistry(store2);
      expect(first).toBe(path.join(store2, "registry.json"));
      expect(() => writeAliasRegistry(store2)).toThrow();
    } finally {
      rmSync(base2, { recursive: true, force: true });
    }
  });

  it("verifyPreparedStore fails when receipts are missing (actual loader, local files only)", () => {
    const base = fresh();
    try {
      const store = path.join(base, "store");
      const registryPath = writeAliasRegistry(store);
      expect(() => verifyPreparedStore(registryPath)).toThrow(/retrieval receipts absent/);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});
