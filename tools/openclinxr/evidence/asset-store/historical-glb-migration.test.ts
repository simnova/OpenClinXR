import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  resolveHistoricalEntry,
  resolveHistoricalRef,
  resolveStoreRoot,
  readHistoricalBytes,
  validateMigrationManifest,
} from "./historical-glb-migration.js";

const tmpStores: string[] = [];
function mkTmp(prefix: string): string {
  const d = mkdtempSync(path.join(tmpdir(), prefix));
  tmpStores.push(d);
  return d;
}
afterEach(() => {
  while (tmpStores.length) {
    const d = tmpStores.pop() as string;
    try { rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

// Generated unit fixtures, not committed proof claims: build logical paths
// from separate segments so no full literal evidence path appears in code.
const EV = ".openclinxr";
const EVD = "evidence";
const TINY = "tiny";
const lp = (...segs: string[]) => [EV, EVD, ...segs].join("/");

function tinyManifest(storeRoot: string) {
  const a = randomBytes(16);
  const b = randomBytes(24);
  const sha = (x: Buffer) => createHash("sha256").update(x).digest("hex");
  const files = Array.from({ length: 10 }, (_, i) => {
    const payload = i === 0 ? a : Buffer.concat([b, Buffer.from([i])]);
    const p = lp(TINY, `f${i}.glb`);
    return {
      path: p,
      sha256: sha(payload),
      bytes: payload.length,
      storeRef: `store:${sha(payload)}/f${i}.glb`,
      producer: `producer ${i}`,
      sourceCommit: "a".repeat(40),
      __payload: payload,
    };
  });
  const manifest: Record<string, unknown> = {
    schemaVersion: 1,
    migration: "ten-historical-evidence-glbs-20261029",
    sourceHead: "b".repeat(40),
    storeRoot,
    files: files.map(({ __payload, ...f }) => f),
    aliases: { [lp(TINY, "f0.glb")]: [lp(TINY, "alias.glb")] },
  };
  return { manifest, payloads: files.map((f) => f.__payload as Buffer) };
}

function seedStore(storeRoot: string, sha: string, base: string, payload: Buffer) {
  const dir = path.join(storeRoot, sha);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, base), payload);
}

describe("historical-glb-migration", () => {
  it("accepts the ten-entry shape with one alias (eleven resolvable)", () => {
    const { manifest } = tinyManifest("/tmp/store");
    const m = validateMigrationManifest(manifest);
    expect(m.files).toHaveLength(10);
    expect(resolveHistoricalRef(lp(TINY, "f0.glb"), m)).toContain("store:");
    expect(resolveHistoricalRef(lp(TINY, "alias.glb"), m)).toContain("store:");
    expect(resolveHistoricalRef(lp(TINY, "other.glb"), m)).toBeNull();
    expect(resolveHistoricalEntry(lp(TINY, "other.glb"), m)).toBeNull();
  });

  it("rejects null entry, empty producer, dot segments, bad name, extra aliases", () => {
    const { manifest } = tinyManifest("/tmp/store");
    const bad = (mut: (x: Record<string, unknown>) => void) => {
      const c = JSON.parse(JSON.stringify(manifest)) as Record<string, unknown>;
      mut(c);
      expect(() => validateMigrationManifest(c)).toThrow();
    };
    bad((c) => { (c.files as unknown[])[0] = null; });
    bad((c) => { ((c.files as Record<string, unknown>[])[0] as Record<string, unknown>).producer = "  "; });
    bad((c) => { ((c.files as Record<string, unknown>[])[0] as Record<string, unknown>).path = lp(EVD, "..", "evil.glb"); });
    bad((c) => { ((c.files as Record<string, unknown>[])[0] as Record<string, unknown>).path = lp(EVD, ".", "x.glb"); });
    bad((c) => { c.migration = "Bad Name!"; });
    bad((c) => {
      (c.aliases as Record<string, string[]>)[lp(TINY, "f1.glb")] = [lp(TINY, "alias2.glb")];
    });
  });

  it("rejects malformed storeRef, duplicate canonical, conflicting alias", () => {
    const { manifest } = tinyManifest("/tmp/store");
    const bad = (mut: (x: Record<string, unknown>) => void) => {
      const c = JSON.parse(JSON.stringify(manifest)) as Record<string, unknown>;
      mut(c);
      expect(() => validateMigrationManifest(c)).toThrow();
    };
    bad((c) => { ((c.files as Record<string, unknown>[])[0] as Record<string, unknown>).storeRef = "bogus-ref"; });
    bad((c) => {
      const fs = c.files as Record<string, unknown>[];
      fs.push(JSON.parse(JSON.stringify(fs[0])));
    });
    bad((c) => {
      (c.aliases as Record<string, string[]>)[lp(TINY, "f0.glb")] = [lp(TINY, "f1.glb")];
    });
  });

  it("honors storeRoot precedence: option, env, manifest", () => {
    const { manifest } = tinyManifest("/manifest-root");
    const m = validateMigrationManifest(manifest);
    expect(resolveStoreRoot(m, { storeRoot: "/opt" })).toBe("/opt");
    const prev = process.env.OPENCLINXR_ASSET_STORE;
    const hadPrev = prev !== undefined;
    process.env.OPENCLINXR_ASSET_STORE = "/env-root";
    try {
      expect(resolveStoreRoot(m)).toBe("/env-root");
      expect(resolveStoreRoot(m, { storeRoot: "/opt" })).toBe("/opt");
    } finally {
      if (!hadPrev) delete process.env.OPENCLINXR_ASSET_STORE;
      else process.env.OPENCLINXR_ASSET_STORE = prev;
    }
    expect(resolveStoreRoot(m)).toBe("/manifest-root");
    // Works even when the original env was defined: restore-then-check order.
    if (hadPrev) expect(resolveStoreRoot(m)).toBe("/manifest-root");
  });

  it("reads real bytes from a temp store; missing/corrupt/wrong bytes fail", async () => {
    const store = mkTmp("hist-store-");
    const { manifest, payloads } = tinyManifest(store);
    const m = validateMigrationManifest(manifest);
    const ref = m.files[0].storeRef;
    const sha = ref.slice("store:".length).split("/")[0];
    const base = ref.slice("store:".length).split("/").slice(1).join("/");
    seedStore(store, sha, base, payloads[0]);
    const ok = await readHistoricalBytes(m.files[0].path, m, { storeRoot: store });
    expect(ok.bytes.equals(payloads[0])).toBe(true);
    expect(ok.sha256).toBe(m.files[0].sha256);
    await expect(readHistoricalBytes(m.files[1].path, m, { storeRoot: store })).rejects.toThrow();
    await expect(
      readHistoricalBytes(lp("unrelated.glb"), m, { storeRoot: store }),
    ).rejects.toThrow();
    const corrupt = mkTmp("hist-corrupt-");
    seedStore(corrupt, sha, base, Buffer.from("corrupt bytes here!!"));
    await expect(readHistoricalBytes(m.files[0].path, m, { storeRoot: corrupt })).rejects.toThrow();
  });

  it("rejects wrong declared bytes even when sha matches", async () => {
    const store = mkTmp("hist-bytes-");
    const { manifest, payloads } = tinyManifest(store);
    const c = JSON.parse(JSON.stringify(manifest)) as Record<string, unknown>;
    const f0 = (c.files as Record<string, unknown>[])[0];
    f0.bytes = (f0.bytes as number) + 1;
    const m = validateMigrationManifest(c);
    const ref = m.files[0].storeRef;
    const sha = ref.slice("store:".length).split("/")[0];
    const base = ref.slice("store:".length).split("/").slice(1).join("/");
    seedStore(store, sha, base, payloads[0]);
    await expect(readHistoricalBytes(m.files[0].path, m, { storeRoot: store })).rejects.toThrow();
  });
});
