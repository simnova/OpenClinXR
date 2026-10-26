import { afterAll, describe, expect, it } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildCaptureChildArgs } from "./cornice-capture-input.ts";
import { runCorniceAbCapture } from "./cornice-ab-capture.ts";

const ROOTS: string[] = [];
afterAll(() => {
  for (const root of ROOTS) rmSync(root, { recursive: true, force: true });
});

function trackRoot(prefix: string): string {
  const root = mkdtempSync(path.join(tmpdir(), prefix));
  ROOTS.push(root);
  return root;
}

function makeStore(payload = randomBytes(64)): { root: string; sha: string; ref: string } {
  const root = trackRoot("cornice-store-");
  const sha = createHash("sha256").update(payload).digest("hex");
  mkdirSync(path.join(root, sha), { recursive: true });
  writeFileSync(path.join(root, sha, "mesh.glb"), payload);
  return { root, sha, ref: `store:${sha}/mesh.glb` };
}

function manifestFor(root: string, sha: string) {
  const results: Record<string, { finalGlb: string; glbSha256: string }> = {};
  for (const env of ["inpatient_ward_room_v1", "stepdown_room_v1"]) {
    for (const v of ["v1", "v2", "v3", "v4"]) {
      results[`${env}/${v}`] = { finalGlb: `store:${sha}/mesh.glb`, glbSha256: sha };
    }
  }
  return { results };
}

describe("cornice-capture-input", () => {
  it("routes valid store GLB to the checked filesystem path", async () => {
    const { root, sha, ref } = makeStore();
    const args = await buildCaptureChildArgs({
      glbRef: ref,
      outDir: "out/ward/v1",
      environmentId: "inpatient_ward_room_v1",
      posesFile: "p.json",
      multiviewOnly: "a,b",
      expectedSha256: sha,
      storeRoot: root,
    });
    expect(args.glbPath).toContain(sha);
    expect(args.environmentId).toBe("inpatient_ward_room_v1");
  });

  it("preserves local-path behavior byte-for-byte", async () => {
    const dir = trackRoot("cornice-local-");
    const payload = randomBytes(32);
    const local = path.join(dir, "room.glb");
    writeFileSync(local, payload);
    const args = await buildCaptureChildArgs({
      glbRef: local,
      outDir: "out",
      environmentId: "e",
      posesFile: "p",
      multiviewOnly: "m",
    });
    expect(args.glbPath).toBe(local);
  });

  it("fails closed on wrong digest before child invocation", async () => {
    const { root, ref } = makeStore();
    await expect(
      buildCaptureChildArgs({
        glbRef: ref,
        outDir: "out",
        environmentId: "e",
        posesFile: "p",
        multiviewOnly: "m",
        expectedSha256: "0".repeat(64),
        storeRoot: root,
      }),
    ).rejects.toThrow(/hashes to/);
  });

  it("fails closed on missing store rows", async () => {
    const root = trackRoot("cornice-empty-");
    await expect(
      buildCaptureChildArgs({
        glbRef: `store:${"a".repeat(64)}/mesh.glb`,
        outDir: "out",
        environmentId: "e",
        posesFile: "p",
        multiviewOnly: "m",
        storeRoot: root,
      }),
    ).rejects.toThrow(/no file in the store/);
  });

  it("fails closed on store escape", async () => {
    const { root, sha } = makeStore();
    await expect(
      buildCaptureChildArgs({
        glbRef: `store:${sha}/../evil.glb`,
        outDir: "out",
        environmentId: "e",
        posesFile: "p",
        multiviewOnly: "m",
        storeRoot: root,
      }),
    ).rejects.toThrow(/unsafe|escapes/);
  });

  it("fails closed on tampered store bytes", async () => {
    const { root, sha, ref } = makeStore(Buffer.from("real-payload"));
    writeFileSync(path.join(root, sha, "mesh.glb"), Buffer.from("tampered-payload"));
    await expect(
      buildCaptureChildArgs({
        glbRef: ref,
        outDir: "out",
        environmentId: "e",
        posesFile: "p",
        multiviewOnly: "m",
        expectedSha256: sha,
        storeRoot: root,
      }),
    ).rejects.toThrow(/hashes to|content hashes/);
  });
});

describe("runCorniceAbCapture", () => {
  it("invokes all 8 rows with room, poses, and viewport preserved", async () => {
    const { root, sha } = makeStore();
    const seen: { outDir: string; glbPath: string; environmentId: string; posesFile: string; multiviewOnly: string }[] = [];
    await runCorniceAbCapture((child) => {
      seen.push(child);
    }, { manifest: manifestFor(root, sha), storeRoot: root });
    expect(seen).toHaveLength(8);
    const rooms = new Set(seen.map((c) => c.environmentId));
    expect(rooms).toEqual(new Set(["inpatient_ward_room_v1", "stepdown_room_v1"]));
    for (const child of seen) {
      expect(child.multiviewOnly).toContain("runtime-01-toward-door");
      expect(child.glbPath).toContain(sha);
    }
    expect(seen.filter((c) => c.environmentId === "inpatient_ward_room_v1")).toHaveLength(4);
    expect(seen.filter((c) => c.environmentId === "stepdown_room_v1")).toHaveLength(4);
  });

  it("emits zero callbacks when a row is defective", async () => {
    const { root, sha } = makeStore();
    const manifest = manifestFor(root, sha);
    delete (manifest.results as Record<string, unknown>)["inpatient_ward_room_v1/v1"];
    const seen: unknown[] = [];
    await expect(
      runCorniceAbCapture((child) => { seen.push(child); }, { manifest, storeRoot: root }),
    ).rejects.toThrow(/missing GLB/);
    expect(seen).toHaveLength(0);
  });

  it("emits zero callbacks on wrong manifest digest", async () => {
    const { root, sha } = makeStore();
    const manifest = manifestFor(root, sha);
    manifest.results["stepdown_room_v1/v4"].glbSha256 = "0".repeat(64);
    const seen: unknown[] = [];
    await expect(
      runCorniceAbCapture((child) => { seen.push(child); }, { manifest, storeRoot: root }),
    ).rejects.toThrow(/hashes to/);
    expect(seen).toHaveLength(0);
  });

  it("rejects malformed glbSha256", async () => {
    const { root, sha } = makeStore();
    const manifest = manifestFor(root, sha);
    manifest.results["stepdown_room_v1/v4"].glbSha256 = "xyz";
    const seen: unknown[] = [];
    await expect(
      runCorniceAbCapture((child) => { seen.push(child); }, { manifest, storeRoot: root }),
    ).rejects.toThrow(/malformed/);
    expect(seen).toHaveLength(0);
  });
});
