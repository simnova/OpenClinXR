import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { linkSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { repinSidecarBytePin } from "./correct-sidecar-byte-lineage.js";

const renameCtl = vi.hoisted(() => ({ fail: false, closeFail: false }));
vi.mock("node:fs", async (o) => {
  const a = await o<typeof import("node:fs")>();
  const renameSync = (x: string, y: string): void => {
    if (renameCtl.fail) { renameCtl.fail = false; throw new Error("EIO forced rename"); }
    a.renameSync(x, y);
  };
  const closeSync = (fd: number): void => {
    if (renameCtl.closeFail) { renameCtl.closeFail = false; throw new Error("EIO forced close"); }
    a.closeSync(fd);
  };
  return { ...a, renameSync, closeSync };
});

const sha256 = (b: Buffer): string => createHash("sha256").update(b).digest("hex");
const CLI = path.resolve("tools/openclinxr/evidence/licence/correct-sidecar-byte-lineage.ts");

const created: string[] = [];
afterEach(() => {
  for (const p of created.splice(0)) {
    try {
      rmSync(p, { recursive: true, force: true });
    } catch {
      /* cleanup best effort */
    }
  }
});

function fixture() {
  const dir = mkdtempSync(path.join(tmpdir(), "sidecar-repin-"));
  created.push(dir);
  const pre = path.join(dir, "pre.glb");
  const post = path.join(dir, "post.glb");
  writeFileSync(pre, Buffer.from("GLB-PRE-BYTES-0001"));
  writeFileSync(post, Buffer.from("GLB-POST-BYTES-0002"));
  const preSha = sha256(readFileSync(pre));
  const sidecar = path.join(dir, "a.provenance.json");
  const doc = {
    outputSha256: preSha,
    outputBytes: readFileSync(pre).byteLength,
    studio: "repin-fixture",
    byteLineage: {
      correctedBy: "fixture",
      recordedBefore: { outputSha256: "0".repeat(64), outputBytes: 7 },
    },
  };
  writeFileSync(sidecar, `${JSON.stringify(doc, null, 1)}\n`);
  return { dir, pre, post, preSha, sidecar };
}

function withoutPins(doc: Record<string, unknown>): Record<string, unknown> {
  const { outputSha256: _a, outputBytes: _b, ...rest } = doc;
  return rest;
}

describe("correct-sidecar-byte-lineage --repin", () => {
  it("happy path re-pins outputSha256/outputBytes from the --post bytes and leaves every other field deep-equal", () => {
    const { pre, post, preSha, sidecar } = fixture();
    const before = JSON.parse(readFileSync(sidecar, "utf8")) as Record<string, unknown>;
    const glbBefore = sha256(readFileSync(post));
    const result = repinSidecarBytePin({ sidecarPath: sidecar, preSha, postPath: post });
    expect(result.sha256).toBe(sha256(readFileSync(post)));
    expect(result.bytes).toBe(readFileSync(post).byteLength);
    const after = JSON.parse(readFileSync(sidecar, "utf8")) as Record<string, unknown>;
    expect(after["outputSha256"]).toBe(sha256(readFileSync(post)));
    expect(after["outputBytes"]).toBe(readFileSync(post).byteLength);
    expect(withoutPins(after)).toEqual(withoutPins(before));
    expect(sha256(readFileSync(post))).toBe(glbBefore);
    expect(sha256(readFileSync(pre))).toBe(preSha);
  });

  it("antecedent refusal: a wrong --pre-sha throws and leaves the sidecar byte-identical", () => {
    const { post, sidecar } = fixture();
    const bytesBefore = readFileSync(sidecar);
    expect(() => repinSidecarBytePin({ sidecarPath: sidecar, preSha: "f".repeat(64), postPath: post })).toThrow();
    expect(readFileSync(sidecar).equals(bytesBefore)).toBe(true);
  });

  it("CLI happy path exits 0 and re-pins; CLI antecedent refusal exits non-zero with the sidecar byte-identical", () => {
    const { post, preSha, sidecar } = fixture();
    const ok = spawnSync("pnpm", ["exec", "tsx", CLI, "--repin", "--sidecar", sidecar, "--pre-sha", preSha, "--post", post], {
      encoding: "utf8",
    });
    expect(ok.status).toBe(0);
    expect((JSON.parse(readFileSync(sidecar, "utf8")) as Record<string, unknown>)["outputSha256"]).toBe(
      sha256(readFileSync(post)),
    );
    const bytesAfterHappy = readFileSync(sidecar);
    const bad = spawnSync(
      "pnpm",
      ["exec", "tsx", CLI, "--repin", "--sidecar", sidecar, "--pre-sha", "e".repeat(64), "--post", post],
      { encoding: "utf8" },
    );
    expect(bad.status).not.toBe(0);
    expect(readFileSync(sidecar).equals(bytesAfterHappy)).toBe(true);
  });

  it("S-R5 sidecar with extra:1e400 and with 9007199254740993: refused, sidecar byte-identical", () => {
    const { preSha, post, sidecar } = fixture();
    for (const extra of ["1e400", "9007199254740993", "1e-400", "9007199254740993e0"]) {
      writeFileSync(sidecar, `{"outputSha256":"${preSha}","outputBytes":18,"extra":${extra}}`);
      const bytesBefore = readFileSync(sidecar);
      expect(() => repinSidecarBytePin({ sidecarPath: sidecar, preSha, postPath: post })).toThrow();
      expect(readFileSync(sidecar).equals(bytesBefore)).toBe(true);
    }
  });

  it("S-R4 writer: a hard-linked AND a symlinked sidecar pointing at a stand-in: refused, stand-in sha256 unchanged", () => {
    const { preSha, post, dir } = fixture();
    for (const kind of ["hard", "sym"] as const) {
      const shipped = path.join(dir, `${kind}-shipped.provenance.json`);
      writeFileSync(shipped, JSON.stringify({ outputSha256: preSha, outputBytes: 18 }));
      const before = readFileSync(shipped);
      const consumer = path.join(dir, `${kind}-consumer.provenance.json`);
      if (kind === "hard") linkSync(shipped, consumer);
      else symlinkSync(shipped, consumer);
      expect(() => repinSidecarBytePin({ sidecarPath: consumer, preSha, postPath: post })).toThrow();
      expect(readFileSync(shipped).equals(before)).toBe(true);
    }
  });

  it("S-R6 --pre-sha=<x> equals form and an unknown --foo both refused", () => {
    const { post, preSha, sidecar } = fixture();
    const before = readFileSync(sidecar);
    const run = (args: string[]) => spawnSync("pnpm", ["exec", "tsx", CLI, "--repin", "--sidecar", sidecar, ...args, "--post", post], { encoding: "utf8" });
    expect(run([`--pre-sha=${preSha}`]).status).not.toBe(0);
    expect(run(["--pre-sha", preSha, "--foo", "bar"]).status).not.toBe(0);
    expect(readFileSync(sidecar).equals(before)).toBe(true);
    const legacy = spawnSync("pnpm", ["exec", "tsx", CLI, "--repin=true", "--working-directory", path.dirname(sidecar), "--asset", "no/such.glb"], { encoding: "utf8" });
    expect(legacy.status).not.toBe(0);
    expect(legacy.stderr).toMatch(/--repin=true/);
  });

  it("S-R7 a forced rename failure leaves no temp file", () => {
    const { preSha, post, sidecar, dir } = fixture();
    const before = readFileSync(sidecar);
    renameCtl.fail = true;
    expect(() => repinSidecarBytePin({ sidecarPath: sidecar, preSha, postPath: post })).toThrow(/forced rename/);
    expect(readFileSync(sidecar).equals(before)).toBe(true);
    expect(readdirSync(dir).filter((f) => f.includes(".repin-"))).toEqual([]);
  });
  it("S-R8 a forced close failure leaves no temp file", () => {
    const { preSha, post, sidecar, dir } = fixture();
    const before = readFileSync(sidecar);
    renameCtl.closeFail = true;
    expect(() => repinSidecarBytePin({ sidecarPath: sidecar, preSha, postPath: post })).toThrow(/forced close/);
    expect(readFileSync(sidecar).equals(before)).toBe(true);
    expect(readdirSync(dir).filter((f) => f.includes(".repin-"))).toEqual([]);
  });
});
