import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, linkSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const FINALIZE = "tools/openclinxr/asset-pipeline/makeclothes/finalize_post_export_stage.py";
const MAPS_TOOL = "tools/openclinxr/asset-pipeline/makeclothes/apply_hair_material_maps.py";
const NURSE_GLB = "apps/ui-xr/public/generated-humanoids/mpfb-family-partner-adult.glb";
const WRITER_SIDECAR =
  "pnpm exec tsx tools/openclinxr/evidence/licence/correct-sidecar-byte-lineage.ts (actor entry and recorded derivationArgv)";

const sha256 = (b: Buffer): string => createHash("sha256").update(b).digest("hex");
const shaFile = (p: string): string => sha256(readFileSync(p));

/** X1: stage a working registry copy under the fixture root (plus its local imports). */
function stageRegistry(dir: string): string {
  const root = process.cwd();
  const src = path.join(root, "packages/openclinxr/factory-station-core/src");
  copyFileSync(path.join(src, "post-export-stage-registry.ts"), path.join(dir, "registry.ts"));
  copyFileSync(path.join(src, "glb-geometry-digest.ts"), path.join(dir, "glb-geometry-digest.ts"));
  copyFileSync(path.join(src, "post-export-stage-mint.ts"), path.join(dir, "post-export-stage-mint.ts"));
  // realpath: /tmp is a symlink (/private/tmp); without it tsx sees a
  // non-equal argv[1] and the registry CLI silently runs nothing.
  return realpathSync(path.join(dir, "registry.ts"));
}

function writeConsumers(dir: string, rows: unknown[]): string {
  const fixture = path.join(dir, "consumers.json");
  writeFileSync(fixture, JSON.stringify({ consumers: rows }));
  return fixture;
}

function runFinalize(args: string[]) {
  return spawnSync("python3", ["-I", path.join(process.cwd(), FINALIZE), ...args], { encoding: "utf8" });
}

function registryDigests(reg: string, files: string[]): string[] {
  const r = spawnSync("pnpm", ["exec", "tsx", reg, JSON.stringify({ digest: files })], { encoding: "utf8" });
  expect(r.status).toBe(0);
  return (JSON.parse(r.stdout) as { digests: string[] }).digests;
}

/**
 * Pre/post pair from the hair-carrying shipped body (mpfb-family-partner-adult,
 * the run-chain F5 positive control): post flips one BIN-tail byte so the
 * file sha changes while the geometry digest stays equal (material-only shape),
 * and the (c) record writer still finds its wired toigo hair material.
 */
function nursePair(dir: string, tag: string, reg: string): { pre: string; post: string; preSha: string; postSha: string } {
  const src = path.join(process.cwd(), NURSE_GLB);
  const pre = path.join(dir, `${tag}-pre.glb`);
  const post = path.join(dir, `${tag}-post.glb`);
  copyFileSync(src, pre);
  // Material-only shape, F9 non-vacuous sizes: extend the glTF generator string
  // (+8 B, 4-aligned), fix chunk lengths; geometry roles untouched, digest equal.
  const bytes = Buffer.from(readFileSync(pre));
  const gen = Buffer.from("glTF-Transform v4.3.0");
  const at = bytes.indexOf(gen);
  expect(at > 0).toBe(true);
  const ext = Buffer.from("glTF-Transform v4.3.0+matonly");
  const postBytes = Buffer.concat([bytes.subarray(0, at), ext, bytes.subarray(at + gen.length)]);
  postBytes.writeUInt32LE(bytes.readUInt32LE(12) + (ext.length - gen.length), 12);
  postBytes.writeUInt32LE(bytes.readUInt32LE(8) + (ext.length - gen.length), 8);
  writeFileSync(post, postBytes);
  expect(readFileSync(post).byteLength).not.toBe(readFileSync(pre).byteLength);
  expect(shaFile(post)).not.toBe(shaFile(pre));
  const [preDigest, postDigest] = registryDigests(reg, [pre, post]);
  expect(postDigest).toBe(preDigest);
  return { pre, post, preSha: shaFile(pre), postSha: shaFile(post) };
}

/** Crafted sidecar with a registered hair-maps level plus an antecedent chain. */
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
        recordedBefore: { outputSha256: "a".repeat(64), outputBytes: 424242 },
      },
    }),
  );
  return p;
}

describe("finalize writers (FINALIZE-2 C2b re-pin modes)", () => {
  it("S-R2 a sha field holding the byte count, and an outputBytes string equal to the pre sha, refuse", () => {
    const py = `import importlib.util as u; s=u.spec_from_file_location("f","tools/openclinxr/asset-pipeline/makeclothes/finalize_post_export_stage.py");m=u.module_from_spec(s);s.loader.exec_module(m);A=m.pin_matches;sha="p"*64
assert A("outputSha256",100,sha,100) is False and A("byteLineage.outputSha256",100,sha,100) is False and A("outputBytes",sha,sha,100) is False
assert A("assetSha256ByPath",{"t":"s"*64,"o":sha},sha,100,"t") is False and A("byteCountByPath",{"t":1,"o":100},sha,100,"t") is False`;
    const r = spawnSync("python3", ["-c", py], { encoding: "utf8" });
    expect([r.status, r.stderr]).toEqual([0, ""]);
  });

  it("S-R3 a fixture named {pre_sha}.json is not expanded", () => {
    const py = `import importlib.util as u; s=u.spec_from_file_location("f","tools/openclinxr/asset-pipeline/makeclothes/finalize_post_export_stage.py");m=u.module_from_spec(s);s.loader.exec_module(m)
assert m.substitute_argv(["--sidecar","{file}"],{"file":"/tmp/fx/{pre_sha}.json","pre_sha":"p"*64})==["--sidecar","/tmp/fx/{pre_sha}.json"]`;
    const r = spawnSync("python3", ["-c", py], { encoding: "utf8" });
    expect([r.status, r.stderr]).toEqual([0, ""]);
  });

  it("S-R4 a hard-linked AND a symlinked consumer pointing at a stand-in shipped file: refused, stand-in sha256 unchanged", { timeout: 180_000 }, () => {
    for (const kind of ["hard", "sym"] as const) {
      const dir = mkdtempSync("/private/tmp/finalize-writers-f4-");
      try {
        const reg = stageRegistry(dir);
        const { pre, post, preSha } = nursePair(dir, `f4-${kind}`, reg);
        const shipped = path.join(dir, "shipped.provenance.json");
        writeFileSync(shipped, JSON.stringify({ outputSha256: preSha, outputBytes: readFileSync(pre).byteLength }));
        const before = shaFile(shipped);
        const c = path.join(dir, `${kind}-consumer.provenance.json`);
        if (kind === "hard") linkSync(shipped, c);
        else symlinkSync(shipped, c);
        const rows = [{ file: c, field: "outputSha256", proposed_pin: "keep-sha", writer: WRITER_SIDECAR }];
        const r = runFinalize(["--pre", pre, "--post", post, "--sidecar", craftSidecar(dir, `f4-${kind}.provenance.json`, preSha, pre, post), "--consumers", writeConsumers(dir, rows), "--test-registry", reg, "--dry-run"]);
        expect(r.status, `${kind} row must refuse`).not.toBe(0);
        expect(shaFile(shipped), `${kind} stand-in unchanged`).toBe(before);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });
  it("S-R1 F2 nurse (pre sha,10) + sibling (post sha,11) unchanged record on a 10->11 stage refuses", { timeout: 180_000 }, () => {
    const dir = mkdtempSync(path.join(process.env["OPENCLINXR_JOB_TMP"] ?? tmpdir(), "finalize-writers-r1-"));
    try {
      const reg = stageRegistry(dir);
      const { pre, post, preSha, postSha } = nursePair(dir, "r1", reg);
      const sidecar = craftSidecar(dir, "r1.provenance.json", preSha, pre, post);
      const doc = JSON.parse(readFileSync(sidecar, "utf8")) as Record<string, unknown>;
      doc["assetSha256ByPath"] = { nurse: preSha, sibling: postSha };
      doc["byteCountByPath"] = { nurse: readFileSync(pre).byteLength, sibling: readFileSync(post).byteLength };
      writeFileSync(sidecar, JSON.stringify(doc));
      const fixture = writeConsumers(dir, [
        { file: sidecar, field_or_symbol: "(outputSha256, assetSha256ByPath, byteCountByPath)", proposed_pin: "keep-sha", writer: WRITER_SIDECAR },
      ]);
      const r = runFinalize(["--pre", pre, "--post", post, "--sidecar", sidecar, "--consumers", fixture, "--test-registry", reg]);
      expect(r.status).not.toBe(0);
      expect(r.stderr).toMatch(/un-pinned/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("sidecar writer: one LIVE row re-pins to --post sha, GLBs byte-identical, antecedent chain unchanged", { timeout: 180_000 }, () => {
    const dir = mkdtempSync(path.join(process.env["OPENCLINXR_JOB_TMP"] ?? tmpdir(), "finalize-writers-a-"));
    try {
      const reg = stageRegistry(dir);
      const { pre, post, preSha, postSha } = nursePair(dir, "a", reg);
      const sidecar = craftSidecar(dir, "a.provenance.json", preSha, pre, post);
      const recordedBefore = (JSON.parse(readFileSync(sidecar, "utf8")) as { byteLineage: { recordedBefore: unknown } })
        .byteLineage.recordedBefore;
      const anteFile = path.join(dir, "ante.json");
      writeFileSync(anteFile, `${JSON.stringify({ pinned: "0".repeat(64) })}\n`);
      const anteBefore = shaFile(anteFile);
      const glbBefore = new Map([[pre, shaFile(pre)], [post, shaFile(post)]]);
      const fixture = writeConsumers(dir, [
        { file: sidecar, field_or_symbol: "(outputSha256, outputBytes)", proposed_pin: "keep-sha", writer: WRITER_SIDECAR },
        { file: anteFile, field: "pinned", proposed_pin: "keep-sha", writer: WRITER_SIDECAR },
      ]);
      const r = runFinalize(["--pre", pre, "--post", post, "--sidecar", sidecar, "--consumers", fixture, "--test-registry", reg]);
      expect(r.status).toBe(0);
      const after = JSON.parse(readFileSync(sidecar, "utf8")) as Record<string, unknown>;
      expect(after["outputSha256"]).toBe(postSha);
      expect(after["outputBytes"]).toBe(readFileSync(post).byteLength);
      expect((after["byteLineage"] as { recordedBefore: unknown }).recordedBefore).toEqual(recordedBefore);
      expect(shaFile(anteFile)).toBe(anteBefore);
      for (const [f, sha] of glbBefore) expect(shaFile(f), `${f} unchanged`).toBe(sha);
      const result = JSON.parse(r.stdout) as { live: { file: string }[] };
      expect(result.live.map((e) => e.file)).toContain(sidecar);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
