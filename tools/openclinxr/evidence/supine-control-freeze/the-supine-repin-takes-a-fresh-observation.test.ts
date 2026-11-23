import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { freezeRecordPath, produceSupineControlFreeze, repinSupineControlFreeze } from "./supine-control-freeze.js";

const renameCtl = vi.hoisted(() => ({ fail: false, calls: 0 }));
vi.mock("node:fs", async (o) => {
  const a = (await o()) as typeof import("node:fs");
  const renameSync = (x: string, y: string): void => {
    renameCtl.calls++;
    if (renameCtl.fail) {
      renameCtl.fail = false;
      throw new Error("EIO forced rename");
    }
    a.renameSync(x, y);
  };
  return { ...a, renameSync };
});

const sha256 = (b: Buffer): string => createHash("sha256").update(b).digest("hex");
const CLI = path.resolve("tools/openclinxr/evidence/supine-control-freeze/supine-control-freeze.ts");
const ASSET_KEYS = [
  "apps/ui-xr/public/xr-assets/environment/infinigen-inpatient-ward.glb",
  "apps/ui-xr/public/xr-assets/environment/infinigen-stepdown.glb",
  "apps/ui-xr/public/xr-assets/environment/infinigen-surgical-ward.glb",
  "apps/ui-xr/public/generated-humanoids/mpfb-gown-adult-patient.glb",
  "apps/ui-xr/public/generated-humanoids/mpfb-family-partner-adult.glb",
  "apps/ui-xr/public/generated-humanoids/mpfb-clinical-nurse-adult.glb",
  "apps/ui-xr/public/generated-humanoids/mpfb-clinical-physician-adult.glb",
  "apps/ui-xr/public/generated-humanoids/mpfb-peds-nurse-kevin.glb",
] as const;
const NURSE_KEY = "apps/ui-xr/public/generated-humanoids/mpfb-clinical-nurse-adult.glb";
const SIB_KEY = "apps/ui-xr/public/generated-humanoids/mpfb-family-partner-adult.glb";
const PRIOR_ISO = "2020-01-01T00:00:00.000Z";
const created: string[] = [];
afterEach(() => {
  for (const p of created.splice(0)) {
    try {
      rmSync(p, { recursive: true, force: true });
    } catch { /* best effort */ }
  }
});
function baselineRoot(indent = 2) {
  const root = mkdtempSync(path.join(tmpdir(), "supine-repin-"));
  created.push(root);
  for (const key of ASSET_KEYS) {
    const p = path.join(root, key);
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, Buffer.from(`control-bytes-v1:${key}`));
  }
  const produced = produceSupineControlFreeze({ observedBy: "baseline-observer", observedAtIso: PRIOR_ISO, reason: "fixture baseline", repoRootPath: root });
  expect(produced.produced).toBe(true);
  if (!produced.produced) throw new Error("fixture baseline not produced");
  const recordPath = freezeRecordPath(root);
  mkdirSync(path.dirname(recordPath), { recursive: true });
  writeFileSync(recordPath, `${JSON.stringify(produced.freeze, null, indent)}\n`);
  return root;
}
function changeNurseBytes(root: string) {
  const nursePath = path.join(root, NURSE_KEY);
  writeFileSync(nursePath, Buffer.from(`control-bytes-v2:${NURSE_KEY}:material-only-stage`));
  const bytes = readFileSync(nursePath);
  return { nursePath, digest: sha256(bytes), size: bytes.byteLength };
}
describe("supine-control-freeze --repin takes a fresh observation", () => {
  it("happy path re-pins the changed asset from bytes read now with a strictly later timestamp", () => {
    const root = baselineRoot();
    const recordPath = freezeRecordPath(root);
    const rawBefore = readFileSync(recordPath, "utf8");
    const { nursePath, digest, size } = changeNurseBytes(root);
    expect(repinSupineControlFreeze({ asset: nursePath, observedBy: "repin-tester", recordPath, repoRootPath: root }).repinned).toBe(true);
    const after = JSON.parse(readFileSync(recordPath, "utf8")) as {
      assetSha256ByPath: Record<string, string>;
      producedFrom: { observedBy: string; observedAtIso: string; byteCountByPath: Record<string, number> };
    };
    expect(after.assetSha256ByPath[NURSE_KEY]).toBe(digest);
    expect(after.producedFrom.byteCountByPath[NURSE_KEY]).toBe(size);
    expect(after.producedFrom.observedBy).toBe("repin-tester");
    expect(after.producedFrom.observedAtIso > PRIOR_ISO).toBe(true);
    const before = JSON.parse(rawBefore) as typeof after;
    for (const key of ASSET_KEYS) {
      if (key === NURSE_KEY) continue;
      expect(after.assetSha256ByPath[key]).toBe(before.assetSha256ByPath[key]);
      expect(after.producedFrom.byteCountByPath[key]).toBe(before.producedFrom.byteCountByPath[key]);
    }
    expect(sha256(readFileSync(nursePath))).toBe(digest);
  });
  it("COUNTERWEIGHT: reusing the prior observedAtIso refuses with the record byte-identical", () => {
    const root = baselineRoot();
    const recordPath = freezeRecordPath(root);
    const rawBefore = readFileSync(recordPath);
    const { nursePath } = changeNurseBytes(root);
    const r = repinSupineControlFreeze({ asset: nursePath, observedBy: "repin-tester", observedAtIso: PRIOR_ISO, recordPath, repoRootPath: root });
    expect(r.repinned).toBe(false);
    expect(readFileSync(recordPath).equals(rawBefore)).toBe(true);
  });
  it("COUNTERWEIGHT: a target digest equal to the prior digest while the asset bytes changed refuses", () => {
    const root = baselineRoot();
    const recordPath = freezeRecordPath(root);
    const rawBefore = readFileSync(recordPath);
    const priorDigest = (JSON.parse(rawBefore.toString("utf8")) as { assetSha256ByPath: Record<string, string> }).assetSha256ByPath[NURSE_KEY] as string;
    const { nursePath } = changeNurseBytes(root);
    expect(sha256(readFileSync(nursePath))).not.toBe(priorDigest);
    const r = repinSupineControlFreeze({ asset: nursePath, observedBy: "repin-tester", assetDigest: priorDigest, recordPath, repoRootPath: root });
    expect(r.repinned).toBe(false);
    expect(readFileSync(recordPath).equals(rawBefore)).toBe(true);
  });
  it("P-R1 a drifted sibling asset: its rows stay byte-identical", () => {
    const root = baselineRoot(4);
    const recordPath = freezeRecordPath(root);
    const rawBefore = readFileSync(recordPath, "utf8");
    const sibLines = rawBefore.split("\n").filter((l) => l.includes(JSON.stringify(SIB_KEY)));
    expect(sibLines.length).toBe(2);
    writeFileSync(path.join(root, SIB_KEY), Buffer.from("control-bytes-drifted:sibling"));
    changeNurseBytes(root);
    expect(repinSupineControlFreeze({ asset: path.join(root, NURSE_KEY), observedBy: "t", recordPath, repoRootPath: root }).repinned).toBe(true);
    const afterLines = readFileSync(recordPath, "utf8").split("\n");
    for (const l of sibLines) expect(afterLines).toContain(l);
  });
  it("P-R2 a prior sibling count 9007199254740993 or 1e400 refuses with the record byte-identical", () => {
    for (const bad of ["9007199254740993", "1e400"]) {
      const root = baselineRoot();
      const recordPath = freezeRecordPath(root);
      const injected = readFileSync(recordPath, "utf8").replace(new RegExp(`(${SIB_KEY.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"\\s*:\\s*)\\d+`), `$1${bad}`);
      writeFileSync(recordPath, injected);
      const rawBefore = readFileSync(recordPath);
      changeNurseBytes(root);
      expect(repinSupineControlFreeze({ asset: path.join(root, NURSE_KEY), observedBy: "t", recordPath, repoRootPath: root }).repinned, bad).toBe(false);
      expect(readFileSync(recordPath).equals(rawBefore)).toBe(true);
    }
  });
  it("P-R3 --observed-at=<iso> and --digest=<sha> equals forms (and unknown flags) refuse, record byte-identical", () => {
    const root = baselineRoot();
    const recordPath = freezeRecordPath(root);
    const { nursePath, digest } = changeNurseBytes(root);
    const rawBefore = readFileSync(recordPath);
    const base = ["exec", "tsx", CLI, "--repin", "--record", recordPath, "--asset", nursePath, "--observed-by", "cli-t", "--root", root];
    for (const extra of [["--observed-at=2030-01-01T00:00:00.000Z"], [`--digest=${digest}`], ["--bogus=1"], ["--bogus", "1"], ["--digest", digest]]) {
      const got = spawnSync("pnpm", [...base, ...extra], { encoding: "utf8" });
      expect(got.status, extra.join(" ")).toBe(2);
      expect(got.stderr, extra.join(" ")).toContain(extra[0] as string);
      expect(readFileSync(recordPath).equals(rawBefore)).toBe(true);
    }
  });
  it("P-R4 injected 1/2/2020, +01:00 equal instant, +02:00 earlier instant, and zzz all refuse", () => {
    for (const stamp of ["1/2/2020", "2020-01-01T01:00:00.000+01:00", "2020-01-01T00:00:00.000+02:00", "zzz"]) {
      const root = baselineRoot();
      const recordPath = freezeRecordPath(root);
      const rawBefore = readFileSync(recordPath);
      const { nursePath } = changeNurseBytes(root);
      expect(repinSupineControlFreeze({ asset: nursePath, observedBy: "t", observedAtIso: stamp, recordPath, repoRootPath: root }).repinned, stamp).toBe(false);
      expect(readFileSync(recordPath).equals(rawBefore)).toBe(true);
    }
  });
  it("P-R5 a symlinked record refuses, the link and its target unchanged", () => {
    const root = baselineRoot();
    const recordPath = freezeRecordPath(root);
    const targetBefore = sha256(readFileSync(recordPath));
    const link = path.join(root, "linked.record.json");
    symlinkSync(recordPath, link);
    changeNurseBytes(root);
    expect(repinSupineControlFreeze({ asset: path.join(root, NURSE_KEY), observedBy: "t", recordPath: link, repoRootPath: root }).repinned).toBe(false);
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(sha256(readFileSync(recordPath))).toBe(targetBefore);
  });
  it("P-R6 a forced rename failure leaves no temp file", () => {
    const root = baselineRoot();
    const recordPath = freezeRecordPath(root);
    const rawBefore = readFileSync(recordPath);
    changeNurseBytes(root);
    renameCtl.fail = true;
    renameCtl.calls = 0;
    let result: { repinned: boolean };
    try {
      result = repinSupineControlFreeze({ asset: path.join(root, NURSE_KEY), observedBy: "t", recordPath, repoRootPath: root });
    } catch {
      result = { repinned: false };
    } finally {
      renameCtl.fail = false;
    }
    expect(result.repinned).toBe(false);
    expect(renameCtl.calls).toBeGreaterThanOrEqual(1);
    expect(readdirSync(path.dirname(recordPath)).filter((n) => n.endsWith(".tmp"))).toEqual([]);
    expect(readFileSync(recordPath).equals(rawBefore)).toBe(true);
  });
});
