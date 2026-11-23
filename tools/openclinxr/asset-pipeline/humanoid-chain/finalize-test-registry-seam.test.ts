import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const FINALIZE = "tools/openclinxr/asset-pipeline/makeclothes/finalize_post_export_stage.py";
const MAPS_TOOL = "tools/openclinxr/asset-pipeline/makeclothes/apply_hair_material_maps.py";
const NURSE_GLB = "apps/ui-xr/public/generated-humanoids/mpfb-family-partner-adult.glb";
const WRITER_SIDECAR =
  "pnpm exec tsx tools/openclinxr/evidence/licence/correct-sidecar-byte-lineage.ts (actor entry and recorded derivationArgv)";
const WRITER_SUPINE =
  "tools/openclinxr/evidence/supine-control-freeze/supine-control-freeze.ts#produceSupineControlFreeze with fresh observation";

const sha256 = (b: Buffer): string => createHash("sha256").update(b).digest("hex");
const shaFile = (p: string): string => sha256(readFileSync(p));
const snap = (d: string): string[] => readdirSync(d).sort();

/** X1: working registry copy under the fixture root (plus its local imports). */
function stageRegistry(dir: string): string {
  const src = path.join(process.cwd(), "packages/openclinxr/factory-station-core/src");
  copyFileSync(path.join(src, "post-export-stage-registry.ts"), path.join(dir, "registry.ts"));
  copyFileSync(path.join(src, "glb-geometry-digest.ts"), path.join(dir, "glb-geometry-digest.ts"));
  copyFileSync(path.join(src, "post-export-stage-mint.ts"), path.join(dir, "post-export-stage-mint.ts"));
  return realpathSync(path.join(dir, "registry.ts"));
}

function runFinalize(args: string[]) {
  return spawnSync("python3", ["-I", path.join(process.cwd(), FINALIZE), ...args], { encoding: "utf8" });
}

function registryDigests(reg: string, files: string[]): string[] {
  const r = spawnSync("pnpm", ["exec", "tsx", reg, JSON.stringify({ digest: files })], { encoding: "utf8" });
  expect(r.status).toBe(0);
  return (JSON.parse(r.stdout) as { digests: string[] }).digests;
}

/** Material-only pre/post pair (equal geometry digests, distinct file shas). */
function nursePair(dir: string, tag: string, reg: string): { pre: string; post: string; preSha: string; postSha: string } {
  const pre = path.join(dir, `${tag}-pre.glb`);
  const post = path.join(dir, `${tag}-post.glb`);
  copyFileSync(path.join(process.cwd(), NURSE_GLB), pre);
  const bytes = Buffer.from(readFileSync(pre));
  const gen = Buffer.from("glTF-Transform v4.3.0");
  const at = bytes.indexOf(gen);
  expect(at > 0).toBe(true);
  const ext = Buffer.from("glTF-Transform v4.3.0+matonly");
  const postBytes = Buffer.concat([bytes.subarray(0, at), ext, bytes.subarray(at + gen.length)]);
  postBytes.writeUInt32LE(bytes.readUInt32LE(12) + (ext.length - gen.length), 12);
  postBytes.writeUInt32LE(bytes.readUInt32LE(8) + (ext.length - gen.length), 8);
  writeFileSync(post, postBytes);
  const [preDigest, postDigest] = registryDigests(reg, [pre, post]);
  expect(postDigest).toBe(preDigest);
  return { pre, post, preSha: shaFile(pre), postSha: shaFile(post) };
}

function craftSidecar(dir: string, name: string, pinSha: string, pre: string, post: string): string {
  const p = path.join(dir, name);
  writeFileSync(
    p,
    JSON.stringify({
      outputSha256: pinSha,
      outputBytes: readFileSync(pinSha === shaFile(post) ? post : pre).byteLength,
      byteLineage: {
        derivationArgv: ["mise", "exec", "--", "python3", MAPS_TOOL, "--glb", pre, "--output", post, "--provenance", p],
        outputSha256: pinSha,
        preImageSha256: shaFile(pre),
      },
    }),
  );
  return p;
}

function writeConsumers(dir: string, rows: unknown[]): string {
  const fixture = path.join(dir, "consumers.json");
  writeFileSync(fixture, JSON.stringify({ consumers: rows }));
  return fixture;
}

/** F6: the stage sidecar is byte-identical and its dir gains no file. */
function expectSidecarUntouched(sidecar: string, beforeSha: string, dir: string, beforeEntries: string[]) {
  expect(shaFile(sidecar), "stage sidecar byte-identical").toBe(beforeSha);
  expect(snap(dir), "no new file in the sidecar dir").toEqual(beforeEntries);
}

describe("finalize test-registry seam (FINALIZE-TEST-REGISTRY-SEAM)", () => {
  it("S1: fixture registry returning a different program for an allowlisted writer refuses before exec", { timeout: 180_000 }, () => {
    const dir = mkdtempSync(path.join(process.env["OPENCLINXR_JOB_TMP"] ?? tmpdir(), "finalize-seam-s1-"));
    try {
      const reg = stageRegistry(dir);
      const marker = path.join(dir, "s1-marker.txt");
      const src = readFileSync(reg, "utf8");
      const anchor = `    argv: [\n      "pnpm",\n      "exec",\n      "tsx",\n      "tools/openclinxr/evidence/licence/correct-sidecar-byte-lineage.ts",\n      "--repin",\n      "--sidecar",\n      "{file}",\n      "--pre-sha",\n      "{pre_sha}",\n      "--post",\n      "{post}",\n    ],`;
      expect(src.includes(anchor), "S1 anchor names the trusted sidecar template").toBe(true);
      writeFileSync(reg, src.replace(anchor, `    argv: [\n      "node",\n      "-e",\n      "require(\\"fs\\").writeFileSync(\\"${marker}\\", \\"s1\\")",\n    ],`));
      const { pre, post, preSha } = nursePair(dir, "s1", reg);
      const sidecar = craftSidecar(dir, "s1.provenance.json", preSha, pre, post);
      const sidecarBefore = shaFile(sidecar);
      const consumer = path.join(dir, "consumer.json");
      writeFileSync(consumer, JSON.stringify({ outputSha256: preSha }));
      const consumerBefore = shaFile(consumer);
      const fixture = writeConsumers(dir, [{ file: consumer, field: "outputSha256", proposed_pin: "keep-sha", writer: WRITER_SIDECAR }]);
      const entriesBefore = snap(dir);
      const r = runFinalize(["--pre", pre, "--post", post, "--sidecar", sidecar, "--consumers", fixture, "--test-registry", reg]);
      expect(r.status, "S1 refuses").not.toBe(0);
      expect(r.stderr, "S1 names the trusted-template seam").toMatch(/differs from the trusted template/);
      expect(existsSync(marker), "S1 marker never created").toBe(false);
      expect(shaFile(consumer), "S1 consumer unwritten").toBe(consumerBefore);
      expectSidecarUntouched(sidecar, sidecarBefore, dir, entriesBefore);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("S2: fixture data pointing the trusted supine writer at a record outside the fixture root refuses before exec", { timeout: 180_000 }, () => {
    const dir = mkdtempSync(path.join(process.env["OPENCLINXR_JOB_TMP"] ?? tmpdir(), "finalize-seam-s2-"));
    const out = mkdtempSync(path.join(process.env["OPENCLINXR_JOB_TMP"] ?? tmpdir(), "finalize-seam-s2-out-"));
    try {
      const reg = stageRegistry(dir);
      const { pre, post, preSha, postSha } = nursePair(dir, "s2", reg);
      const nurseKey = "apps/ui-xr/public/generated-humanoids/mpfb-clinical-nurse-adult.glb";
      const keys = ["apps/ui-xr/public/xr-assets/environment/infinigen-inpatient-ward.glb", "apps/ui-xr/public/generated-humanoids/mpfb-family-partner-adult.glb", nurseKey, "apps/ui-xr/public/generated-humanoids/mpfb-clinical-physician-adult.glb", "apps/ui-xr/public/generated-humanoids/mpfb-peds-nurse-kevin.glb", "apps/ui-xr/public/xr-assets/environment/infinigen-stepdown.glb", "apps/ui-xr/public/xr-assets/environment/infinigen-surgical-ward.glb", "apps/ui-xr/public/generated-humanoids/mpfb-gown-adult-patient.glb"];
      for (const key of keys) {
        const ap = path.join(dir, key);
        mkdirSync(path.dirname(ap), { recursive: true });
        if (key === nurseKey) copyFileSync(pre, ap);
        else writeFileSync(ap, Buffer.from(`frozen-control:${key}`));
      }
      const digests: Record<string, string> = {};
      const counts: Record<string, number> = {};
      for (const key of keys) {
        digests[key] = shaFile(path.join(dir, key));
        counts[key] = readFileSync(path.join(dir, key)).byteLength;
      }
      expect(digests[nurseKey]).toBe(preSha);
      // WRITE-path argv outside the fixture root: the supine --record destination.
      const record = path.join(out, "supine.record.json");
      writeFileSync(record, JSON.stringify({
        schemaVersion: "openclinxr.supine-control-freeze.v1",
        scenarioId: "ward_delirium_med_rec_v1",
        assetSha256ByPath: digests,
        staged: { posture: "supine", supportSurfaceCount: 1, clearanceAboveDeckMeters: 0.25 },
        producedFrom: { observedBy: "fixture-baseline", observedAtIso: "2020-01-01T00:00:00.000Z", reason: "fixture baseline", byteCountByPath: counts },
      }, null, 2));
      const recordBefore = shaFile(record);
      const outBefore = snap(out);
      copyFileSync(post, path.join(dir, nurseKey));
      const sidecar = craftSidecar(dir, "s2.provenance.json", postSha, pre, post);
      const sidecarBefore = shaFile(sidecar);
      const fixture = writeConsumers(dir, [{
        file: record,
        field_or_symbol: "(assetSha256ByPath, producedFrom.byteCountByPath)",
        proposed_pin: "keep-sha",
        writer: WRITER_SUPINE,
      }]);
      const entriesBefore = snap(dir);
      const r = runFinalize(["--pre", pre, "--post", post, "--sidecar", sidecar, "--consumers", fixture, "--test-registry", reg]);
      const recordAfter = shaFile(record);
      expect(r.status, `S2 refuses before exec (outside record before=${recordBefore} after=${recordAfter})`).not.toBe(0);
      expect(r.stderr, "S2 names the fixture-root seam").toMatch(/outside the fixture root/);
      expect(recordAfter, "S2 outside record unwritten").toBe(recordBefore);
      expect(snap(out), "no new file beside the outside record").toEqual(outBefore);
      expectSidecarUntouched(sidecar, sidecarBefore, dir, entriesBefore);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(out, { recursive: true, force: true });
    }
  });

  it("F2: a symlinked .. row path whose writer temp lands outside the fixture root refuses before exec", { timeout: 180_000 }, () => {
    const dir = mkdtempSync(path.join(process.env["OPENCLINXR_JOB_TMP"] ?? tmpdir(), "finalize-seam-f2-"));
    const sib = mkdtempSync(path.join(process.env["OPENCLINXR_JOB_TMP"] ?? tmpdir(), "finalize-seam-f2-sib-"));
    try {
      const reg = stageRegistry(dir);
      mkdirSync(path.join(dir, "sub"));
      symlinkSync(path.join(dir, "sub"), path.join(sib, "link"));
      const { pre, post, preSha } = nursePair(dir, "f2", reg);
      const sidecar = craftSidecar(dir, "f2.provenance.json", preSha, pre, post);
      const sidecarBefore = shaFile(sidecar);
      const sibBefore = snap(sib);
      const consumerReal = path.join(dir, "consumer.json");
      writeFileSync(consumerReal, JSON.stringify({ outputSha256: preSha }));
      const consumerBefore = shaFile(consumerReal);
      // path.join would collapse link/.. lexically; the writer sees the raw form.
      const rowFile = `${sib}/link/../consumer.json`;
      const fixture = writeConsumers(dir, [{ file: rowFile, field: "outputSha256", proposed_pin: "keep-sha", writer: WRITER_SIDECAR }]);
      const entriesBefore = snap(dir);
      const r = runFinalize(["--pre", pre, "--post", post, "--sidecar", sidecar, "--consumers", fixture, "--test-registry", reg]);
      const consumerAfter = shaFile(consumerReal);
      expect(r.status, `F2 refuses before exec (consumer before=${consumerBefore} after=${consumerAfter})`).not.toBe(0);
      expect(r.stderr, `F2 names the fixture-root seam (consumer before=${consumerBefore} after=${consumerAfter})`).toMatch(/outside the fixture root/);
      expect(consumerAfter, "F2 consumer unwritten").toBe(consumerBefore);
      expect(snap(sib), "no writer temp left in the sibling dir").toEqual(sibBefore);
      expectSidecarUntouched(sidecar, sidecarBefore, dir, entriesBefore);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(sib, { recursive: true, force: true });
    }
  });

  it("F3: a lineage --sidecar in a sibling dir refuses before exec", { timeout: 180_000 }, () => {
    const dir = mkdtempSync(path.join(process.env["OPENCLINXR_JOB_TMP"] ?? tmpdir(), "finalize-seam-f3-"));
    const sib = mkdtempSync(path.join(process.env["OPENCLINXR_JOB_TMP"] ?? tmpdir(), "finalize-seam-f3-sib-"));
    try {
      const reg = stageRegistry(dir);
      const { pre, post, postSha } = nursePair(dir, "f3", reg);
      const sidecar = craftSidecar(sib, "f3.provenance.json", postSha, pre, post);
      const sidecarBefore = shaFile(sidecar);
      const sibBefore = snap(sib);
      const fixture = writeConsumers(dir, []);
      const entriesBefore = snap(dir);
      const r = runFinalize(["--pre", pre, "--post", post, "--sidecar", sidecar, "--consumers", fixture, "--test-registry", reg]);
      expect(r.status, "F3 refuses before exec").not.toBe(0);
      expect(r.stderr, "F3 names the fixture-root seam").toMatch(/outside the fixture root/);
      expectSidecarUntouched(sidecar, sidecarBefore, sib, sibBefore);
      expect(snap(dir), "no new file in the fixture dir").toEqual(entriesBefore);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(sib, { recursive: true, force: true });
    }
  });
});
