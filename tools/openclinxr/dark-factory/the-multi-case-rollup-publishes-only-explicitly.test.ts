import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  const { default: pathInsideFactory } = await import("node:path");
  const CANONICAL_SUFFIX = pathInsideFactory.join(".openclinxr", "evidence", "factory-run", "multi-case-rollup.json");
  const attempts: string[] = [];
  return {
    ...actual,
    writeFile: (async (file: unknown, ...rest: unknown[]) => {
      if (typeof file === "string" && file.endsWith(CANONICAL_SUFFIX)) {
        attempts.push(file);
        throw new Error(`REFUSED canonical write in test: ${file}`);
      }
      return (actual.writeFile as (...a: unknown[]) => unknown)(file, ...rest);
    }) as typeof actual.writeFile,
    __canonicalWriteAttempts: attempts,
  };
});

vi.mock("../evidence/lib/portless-server.js", () => ({
  spawnPortlessDevServer: vi.fn(async () => ({ url: "http://127.0.0.1:9", proc: undefined as never })),
  stopPortlessDevServer: vi.fn(async () => {}),
}));

import { runMultiCaseChain } from "./multi-case-runner.js";

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../..");
const CANONICAL_ROLLUP = path.join(REPO_ROOT, ".openclinxr", "evidence", "factory-run", "multi-case-rollup.json");
const CANONICAL_SUFFIX = path.join(".openclinxr", "evidence", "factory-run", "multi-case-rollup.json");

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

async function readOptional(file: string): Promise<string | null> {
  try {
    return await readFile(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return null;
    throw err;
  }
}

describe("multi-case rollup publishes only explicitly", () => {
  let dirs: string[] = [];

  async function ownedTemp(): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), "openclinxr-rollup-test-"));
    dirs.push(dir);
    return dir;
  }

  afterEach(async () => {
    for (const dir of dirs) await rm(dir, { recursive: true, force: true });
    dirs = [];
  });

  it("default run writes only the isolated evidence dir, never canonical", async () => {
    const before = await readOptional(CANONICAL_ROLLUP);
    const evidenceDir = path.join(await ownedTemp(), "evidence");
    await runMultiCaseChain({ evidenceDir, population: [] });
    const isolated = await readFile(path.join(evidenceDir, "multi-case-rollup.json"), "utf8");
    expect(JSON.parse(isolated).cases).toEqual([]);
    const after = await readOptional(CANONICAL_ROLLUP);
    expect(after).toBe(before);
  });

  it("explicit publishRollupPath writes a byte-exact second copy to an owned temp path", async () => {
    const before = await readOptional(CANONICAL_ROLLUP);
    const job = await ownedTemp();
    const evidenceDir = path.join(job, "evidence");
    const publishRollupPath = path.join(job, "published", "multi-case-rollup.json");
    expect(publishRollupPath.endsWith(CANONICAL_SUFFIX)).toBe(false);
    await runMultiCaseChain({ evidenceDir, population: [], publishRollupPath });
    const isolated = await readFile(path.join(evidenceDir, "multi-case-rollup.json"), "utf8");
    const published = await readFile(publishRollupPath, "utf8");
    expect(published).toBe(isolated);
    expect(sha256(published)).toBe(sha256(isolated));
    expect(await readOptional(CANONICAL_ROLLUP)).toBe(before);
  });
});
