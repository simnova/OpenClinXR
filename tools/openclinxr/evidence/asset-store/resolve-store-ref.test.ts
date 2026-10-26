import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  readStoreRefBytes,
  rejectStoreRefForOutput,
  resolveInputBytes,
  resolveStoreRef,
} from "./resolve-store-ref.js";

const previousRoot = process.env.OPENCLINXR_ASSET_STORE;
const tempDirs: string[] = [];

afterEach(async () => {
  if (previousRoot === undefined) delete process.env.OPENCLINXR_ASSET_STORE;
  else process.env.OPENCLINXR_ASSET_STORE = previousRoot;
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function seededStore(basename = "probe.bin"): Promise<{ root: string; ref: string; bytes: Buffer }> {
  const bytes = Buffer.from("store bytes");
  const sha = createHash("sha256").update(bytes).digest("hex");
  const root = await tempDir("openclinxr-store-");
  await mkdir(path.join(root, sha), { recursive: true });
  await writeFile(path.join(root, sha, basename), bytes);
  return { root, ref: `store:${sha}/${basename}`, bytes };
}

describe("resolve-store-ref direct", () => {
  it("resolves a verified reference to bytes on the ordinary path", async () => {
    const { root, ref, bytes } = await seededStore();
    const resolved = await resolveStoreRef(ref, { storeRoot: root });
    expect(resolved.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
    const read = await readStoreRefBytes(ref, { storeRoot: root });
    expect(read.bytes.equals(bytes)).toBe(true);
    const viaEnv = await (async () => {
      process.env.OPENCLINXR_ASSET_STORE = root;
      return resolveInputBytes(ref);
    })();
    expect(viaEnv.fromStore).toBe(true);
    expect(viaEnv.logicalPath).toBe(ref);
    expect(viaEnv.bytes.equals(bytes)).toBe(true);
  });

  it("passes a plain path through without the store", async () => {
    const dir = await tempDir("openclinxr-plain-");
    const file = path.join(dir, "plain.bin");
    await writeFile(file, Buffer.from("plain"));
    delete process.env.OPENCLINXR_ASSET_STORE;
    const resolved = await resolveInputBytes(file);
    expect(resolved.fromStore).toBe(false);
    expect(resolved.logicalPath).toBe(file);
  });

  it("refuses a symlink that escapes the store root", async () => {
    const { root, ref } = await seededStore();
    const outside = await tempDir("openclinxr-outside-");
    const target = path.join(outside, "evil.bin");
    await writeFile(target, Buffer.from("evil"));
    const link = path.join(root, ref.slice("store:".length));
    await rm(link, { force: true });
    await symlink(target, link);
    await expect(resolveStoreRef(ref, { storeRoot: root })).rejects.toThrow(/escapes the store root/);
  });

  it("refuses malformed references, a missing root, and a missing file", async () => {
    const { root, ref } = await seededStore();
    await expect(resolveStoreRef("store:xyz/probe.bin", { storeRoot: root })).rejects.toThrow(/malformed/);
    await expect(resolveStoreRef(`store:${"0".repeat(64)}/../evil.bin`, { storeRoot: root })).rejects.toThrow(
      /unsafe basename/,
    );
    await expect(resolveStoreRef(`store:${"0".repeat(64)}/probe.bin`, { storeRoot: root })).rejects.toThrow(
      /names no file/,
    );
    await expect(resolveStoreRef(ref, { storeRoot: path.join(root, "does-not-exist") })).rejects.toThrow(
      /store root does not exist/,
    );
    delete process.env.OPENCLINXR_ASSET_STORE;
    await expect(resolveStoreRef(ref)).rejects.toThrow(/no asset store root/);
  });

  it("refuses content that disagrees with its hash", async () => {
    const { root, ref } = await seededStore();
    await writeFile(path.join(root, ref.slice("store:".length)), Buffer.from("corrupted bytes"));
    await expect(readStoreRefBytes(ref, { storeRoot: root })).rejects.toThrow(/content hashes/);
  });

  it("rejects a store reference as an output write target", () => {
    expect(() => rejectStoreRefForOutput(`store:${"0".repeat(64)}/out.glb`, "probe")).toThrow(
      /not an output write target/,
    );
  });

  it("reads back the stored bytes through the filesystem path", async () => {
    const { root, ref, bytes } = await seededStore();
    const resolved = await resolveStoreRef(ref, { storeRoot: root });
    expect((await readFile(resolved.filesystemPath)).equals(bytes)).toBe(true);
  });
});
