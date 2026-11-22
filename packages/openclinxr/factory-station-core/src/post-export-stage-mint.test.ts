import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { expect, it } from "vitest";

const canon = (v: unknown): string => `${JSON.stringify(v, null, 2)}\n`;
const sha = (b: Buffer | string): string => createHash("sha256").update(b).digest("hex");
const CONSUMERS = [
  { file: "a/keep.json", field_or_symbol: "a/keep.json:1 (bodySha256)", proposed_pin: "keep-sha" },
  { file: "b/acc.json", field_or_symbol: "b/acc.json:2 (glbSha256)", proposed_pin: "accessor-digest" },
  { file: "c/multi.json", field_or_symbol: "c/multi.json:3 (f1); c/multi.json:4 (f2)", proposed_pin: "keep-sha" },
  { file: "c/multi.json", field_or_symbol: "c/multi.json:5 (f3)", proposed_pin: "other", why: "kept" },
  { file: "d/curated.json", field_or_symbol: "d/curated.json:9 (const SHIP)", proposed_pin: "keep-sha" },
];
const ROWS = [
  { file: "a/keep.json", field: "bodySha256", proposed_pin: "keep-sha", reader: "no" },
  { file: "b/acc.json", field: "glbSha256", proposed_pin: "accessor-digest", reader: "yes" },
  { file: "c/multi.json", field: "f1, f2", proposed_pin: "keep-sha", reader: "no" },
  { file: "c/multi.json", field: "f3", proposed_pin: "other", reader: "no" },
  { file: "d/curated.json", field: "SHIP", proposed_pin: "keep-sha", reader: "no" },
];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "mint-"));
  const far = join(root, "store", "post-export-stage-finalize");
  mkdirSync(far, { recursive: true });
  const blob = { schema: "openclinxr.post-export-stage-consumers.v0", baseSha: "0".repeat(64), consumers: CONSUMERS, chain: { entryPoint: "x" } };
  const blobBytes = canon(blob);
  const blobName = `post-export-stage-consumers.full-${sha(blobBytes).slice(0, 8)}.json`;
  writeFileSync(join(far, blobName), blobBytes);
  const compactPath = join(root, "compact.json");
  const compactBytes = canon({ schema: "openclinxr.post-export-stage-consumers.compact.v1", full: { store: `post-export-stage-finalize/${blobName}`, sha256: sha(blobBytes) }, baseSha: "0".repeat(64), rows: ROWS });
  writeFileSync(compactPath, compactBytes);
  const editsPath = join(root, "edits.json");
  return { root, store: join(root, "store"), compactPath, editsPath, blobBytes, compactBytes, blobName };
}
type Fx = ReturnType<typeof fixture>;
// Production path: the mint runs only through the registry CLI mint mode
// (the same entry finalize uses), never by import. A non-zero exit throws the
// CLI stderr so the refusal assertions below keep matching unchanged.
const REGISTRY_TS = join(import.meta.dirname, "post-export-stage-registry.ts");
interface MintOut { blobPath: string; blobSha256: string; blobWrote: boolean; branch: string; compactPath: string; editsApplied: number }
function mint(fx: Fx, edits: unknown): MintOut {
  writeFileSync(fx.editsPath, canon(edits));
  const r = spawnSync("pnpm", ["exec", "tsx", REGISTRY_TS, "--test-registry", fx.root, JSON.stringify({ mint: { edits: fx.editsPath, compact: fx.compactPath, storeRoot: fx.store, testRegistry: fx.root } })], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`${r.stderr}${r.stdout}`);
  return (JSON.parse(r.stdout) as { mint: MintOut }).mint;
}
const storeBlob = (fx: Fx): Buffer => readFileSync(join(fx.store, "post-export-stage-finalize", fx.blobName));
it("M1 empty edit list round-trips the fixture blob and compact byte-identical", () => {
  const fx = fixture();
  const out = mint(fx, []);
  expect(out.blobWrote).toBe(false);
  expect(out.blobSha256).toBe(sha(fx.blobBytes));
  expect(storeBlob(fx).toString()).toBe(fx.blobBytes.toString());
  expect(readFileSync(fx.compactPath).toString()).toBe(fx.compactBytes.toString());
  console.log(`M1 in=${sha(fx.blobBytes)} out=${out.blobSha256}`);
});
it("M2 r1 refuses when one compact row pin drifts, naming the file, writing nothing", () => {
  const fx = fixture();
  const compact = JSON.parse(fx.compactBytes) as { rows: { proposed_pin: string }[] };
  (compact.rows[1] as { proposed_pin: string }).proposed_pin = "keep-sha";
  writeFileSync(fx.compactPath, canon(compact));
  const before = readFileSync(fx.compactPath);
  expect(() => mint(fx, [])).toThrow(/b\/acc\.json/);
  expect(readFileSync(fx.compactPath).equals(before)).toBe(true);
  expect(sha(storeBlob(fx))).toBe(sha(fx.blobBytes));
  expect(readdirSync(join(fx.store, "post-export-stage-finalize"))).toEqual([fx.blobName]);
});
it("M3 r2 refuses an edit naming a (file, field) absent from the full blob", () => {
  const fx = fixture();
  const before = readFileSync(fx.compactPath);
  expect(() => mint(fx, [{ file: "zz/nope.json", field: "nope", proposed_pin: "keep-sha" }])).toThrow(/zz\/nope\.json/);
  expect(readdirSync(join(fx.store, "post-export-stage-finalize"))).toEqual([fx.blobName]);
  expect(readFileSync(fx.compactPath).equals(before)).toBe(true);
});
it("M4 r3 refuses proposed_pin accessor_digest and lists the pin enum", () => {
  const fx = fixture();
  const before = readFileSync(fx.compactPath);
  expect(() => mint(fx, [{ file: "a/keep.json", field: "bodySha256", proposed_pin: "accessor_digest" }])).toThrow(/accessor-digest.*accessor_digest/);
  expect(readdirSync(join(fx.store, "post-export-stage-finalize"))).toEqual([fx.blobName]);
  expect(readFileSync(fx.compactPath).equals(before)).toBe(true);
});
it("M6 projection carries every blob row: an unnamed absent row refuses, a named one is added", () => {
  const extra = { file: "e/blob-only.json", field_or_symbol: "e/blob-only.json:7 (gitSha)", proposed_pin: "keep-sha" };
  const named = () => {
    const fx = fixture();
    const blob = JSON.parse(fx.blobBytes.toString()) as { consumers: unknown[] };
    blob.consumers.push(extra);
    const bytes = canon(blob);
    writeFileSync(join(fx.store, "post-export-stage-finalize", fx.blobName), bytes);
    const compact = JSON.parse(fx.compactBytes.toString()) as { full: { sha256: string } };
    compact.full.sha256 = sha(bytes);
    writeFileSync(fx.compactPath, canon(compact));
    return fx;
  };
  const fx0 = named();
  const before0 = readFileSync(fx0.compactPath);
  expect(() => mint(fx0, [])).toThrow(/e\/blob-only\.json/);
  expect(readdirSync(join(fx0.store, "post-export-stage-finalize"))).toEqual([fx0.blobName]);
  expect(readFileSync(fx0.compactPath).equals(before0)).toBe(true);
  const fx = named();
  const out = mint(fx, [{ file: "e/blob-only.json", field: "gitSha", proposed_pin: "keep-sha" }]);
  expect(out.blobWrote).toBe(false);
  expect(readdirSync(join(fx.store, "post-export-stage-finalize"))).toEqual([fx.blobName]);
  const rows = (JSON.parse(readFileSync(fx.compactPath).toString()) as { rows: unknown[] }).rows;
  expect(rows).toHaveLength(6);
  expect(rows[5]).toMatchObject({ file: "e/blob-only.json", field: "gitSha", proposed_pin: "keep-sha" });
});
it("M5 one edit changes exactly one blob row and repoints the header at the new blob", () => {
  const fx = fixture();
  const out = mint(fx, [{ file: "b/acc.json", field: "glbSha256", proposed_pin: "keep-sha", reason: "m5" }]);
  expect(out.blobWrote).toBe(true);
  expect(basename(out.blobPath)).toBe(`post-export-stage-consumers.full-${out.blobSha256.slice(0, 8)}.json`);
  const nb = JSON.parse(readFileSync(out.blobPath).toString()) as { consumers: unknown[] };
  const ob = JSON.parse(fx.blobBytes.toString()) as { consumers: unknown[] };
  expect(nb.consumers).toHaveLength(ob.consumers.length);
  const diffs = nb.consumers.filter((r, i) => JSON.stringify(r) !== JSON.stringify(ob.consumers[i]));
  expect(diffs).toHaveLength(1);
  console.log(`M5 diff=${JSON.stringify(diffs[0])}`);
  expect(diffs[0]).toMatchObject({ proposed_pin: "keep-sha", reason: "m5" });
  expect(JSON.parse(readFileSync(fx.compactPath).toString()).full).toEqual({ store: `post-export-stage-finalize/${basename(out.blobPath)}`, sha256: out.blobSha256 });
  const oc = (JSON.parse(fx.compactBytes) as { rows: unknown[] }).rows;
  const nc = (JSON.parse(readFileSync(fx.compactPath).toString()) as { rows: unknown[] }).rows;
  expect(oc.filter((r, i) => JSON.stringify(r) !== JSON.stringify(nc[i]))).toHaveLength(1);
});
it("F04 swapped compact field labels refuse naming both rows", () => {
  const fx = fixture();
  const compact = JSON.parse(fx.compactBytes.toString()) as { rows: { field: string }[] };
  const t = compact.rows[2]!.field;
  compact.rows[2]!.field = compact.rows[3]!.field;
  compact.rows[3]!.field = t;
  writeFileSync(fx.compactPath, canon(compact));
  expect(() => mint(fx, [{ file: "c/multi.json", field: "f1, f2", proposed_pin: "accessor-digest" }])).toThrow(/pin:c\/multi\.json \[f3\].*edits: c\/multi\.json \[f1, f2\]/s);
  expect(readdirSync(join(fx.store, "post-export-stage-finalize"))).toEqual([fx.blobName]);
});
it("F05 an edit naming a blob-only row applies when the file has other compact rows", () => {
  const fx = fixture();
  const compact = JSON.parse(fx.compactBytes.toString()) as { rows: { field: string }[] };
  compact.rows = compact.rows.filter((r) => r.field !== "f3");
  writeFileSync(fx.compactPath, canon(compact));
  const out = mint(fx, [{ file: "c/multi.json", field: "f3", proposed_pin: "other" }]);
  expect(out.blobWrote).toBe(false);
  const rows = (JSON.parse(readFileSync(fx.compactPath).toString()) as { rows: { file: string; field: string }[] }).rows.filter((r) => r.file === "c/multi.json");
  expect(rows.map((r) => r.field).sort()).toEqual(["f1, f2", "f3"]);
});
it("F06 bogus proposed_pin refuses even when the compact says bogus, no-reader is accepted", () => {
  const fx = fixture();
  const compact = JSON.parse(fx.compactBytes.toString()) as { rows: { proposed_pin: string }[] };
  compact.rows[0]!.proposed_pin = "bogus";
  writeFileSync(fx.compactPath, canon(compact));
  expect(() => mint(fx, [{ file: "a/keep.json", field: "bodySha256", proposed_pin: "bogus" }])).toThrow(/bogus/);
  const out = mint(fx, [{ file: "a/keep.json", field: "bodySha256", proposed_pin: "no-reader" }]);
  expect(out.blobWrote).toBe(true);
});
it("F08 a compact write failure unlinks the newly written blob", () => {
  const fx = fixture();
  mkdirSync(join(fx.root, "ro"));
  const roCompact = join(fx.root, "ro", "compact.json");
  renameSync(fx.compactPath, roCompact);
  fx.compactPath = roCompact;
  chmodSync(join(fx.root, "ro"), 0o555);
  expect(() => mint(fx, [{ file: "a/keep.json", field: "bodySha256", proposed_pin: "accessor-digest" }])).toThrow();
  expect(readdirSync(join(fx.store, "post-export-stage-finalize"))).toEqual([fx.blobName]);
  chmodSync(join(fx.root, "ro"), 0o755);
});
it("F09 an existing directory at the new blob target refuses write-once", () => {
  const fx = fixture();
  const out = mint(fx, [{ file: "b/acc.json", field: "glbSha256", proposed_pin: "keep-sha", reason: "f9" }]);
  writeFileSync(fx.compactPath, fx.compactBytes);
  rmSync(out.blobPath);
  mkdirSync(out.blobPath);
  expect(() => mint(fx, [{ file: "b/acc.json", field: "glbSha256", proposed_pin: "keep-sha", reason: "f9" }])).toThrow(/write-once/);
  expect(readdirSync(join(fx.store, "post-export-stage-finalize")).sort()).toEqual([basename(out.blobPath), fx.blobName].sort());
});
it("F12 a blob sha mismatch refuses and writes nothing", () => {
  const fx = fixture();
  writeFileSync(join(fx.store, "post-export-stage-finalize", fx.blobName), "tampered");
  const before = readFileSync(fx.compactPath);
  expect(() => mint(fx, [])).toThrow(/r4/);
  expect(readdirSync(join(fx.store, "post-export-stage-finalize"))).toEqual([fx.blobName]);
  expect(readFileSync(fx.compactPath).equals(before)).toBe(true);
});
