import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Mint re-pins (C3a h4): full blob named by the compact header (sha-checked) +
 * [{file, field, proposed_pin, reason?}] -> new write-once store blob (skipped when
 * identical; exclusive-create, an existing target with different bytes refuses) +
 * compact rewritten as a BLOB-ORDER projection. r1 matches rows by (file, field key),
 * never by ordinal: exact-key pins must agree (an edited row whose compact pin matches
 * neither blob nor proposal is named, never fatal); leftover rows pair in file order;
 * an unnamed blob-only row refuses, an edited one is appended at its blob index. r3
 * checks ONLY POST_EXPORT_PIN_ENUM. Compact goes via tmp+rename; a compact-write
 * failure unlinks the new blob. CLI overrides (compact/storeRoot/testRegistry) apply
 * ONLY with --test-registry; without it the mint uses the real inventory. Throws
 * `mint refused (<cause>)` (CLI: exit 2). All checks run before any write. */
export const POST_EXPORT_PIN_ENUM = ["keep-sha", "accessor-digest", "other", "no-reader"] as const;
export interface PostExportMintEdit { file: string; field: string; proposed_pin: string; reason?: string }
export interface PostExportMintResult { blobPath: string; blobSha256: string; blobWrote: boolean; branch: string; compactPath: string; editsApplied: number }
interface MintRow { file: string; field?: unknown; field_or_symbol?: unknown; proposed_pin: string; reason?: string; [k: string]: unknown }
const mintCanon = (v: unknown): string => `${JSON.stringify(v, null, 2)}\n`;
const mintSha = (b: string): string => createHash("sha256").update(b, "utf8").digest("hex");
const MINT_BLOB_DIR = "post-export-stage-finalize";
/** (file, field key): grouped `path:line (fields)` symbols tokenized like the compact
 * labels (comma/slash/space split, bare "and" dropped, leading "const" dropped,
 * deduped); the same function keys blob symbols, compact fields, and edit fields. */
function mintFieldKey(s: unknown): string {
  const toks: string[] = [];
  for (const raw of String(s ?? "").split(";")) {
    const part = raw.trim();
    if (!part) continue;
    const g = part.match(/^.+?:\d+\s*\(([^()]*)\)\s*$/) ?? part.match(/\(([^()]*)\)/);
    const content = g?.[1] !== undefined ? g[1] : part;
    let t = content.split(/[,\s/]+/).map((x) => x.trim()).filter((x) => x !== "" && x !== "and");
    if (t[0] === "const") t = t.slice(1);
    for (const x of t) if (!toks.includes(x)) toks.push(x);
  }
  return toks.join(", ");
}
export function mintPostExportConsumers(o: { compactPath?: string; storeRoot?: string; editsPath: string; testRoot?: string }): PostExportMintResult {
  const repo = join(import.meta.dirname, "..", "..", "..", "..");
  const rel = (p: string): string => (p.startsWith("/") ? p : join(process.cwd(), p));
  const cp = rel(o.compactPath ?? join(repo, "packages/openclinxr/factory-station-core/src/post-export-stage-consumers.json"));
  const sp = rel(o.storeRoot ?? "/Volumes/files/openclinxr-assets/store");
  if (o.testRoot === undefined) {
    if (realpathSync(cp) !== realpathSync(join(repo, "packages/openclinxr/factory-station-core/src/post-export-stage-consumers.json")) || realpathSync(sp) !== realpathSync("/Volumes/files/openclinxr-assets/store")) throw new Error("mint refused (paths): inventory override refused without testRoot");
  } else {
    const root = realpathSync(o.testRoot);
    if (![tmpdir(), "/private/tmp"].map((t) => { try { return realpathSync(t); } catch { return ""; } }).some((t) => t !== "" && (root === t || root.startsWith(`${t}/`)))) throw new Error(`mint refused (test-root): outside the tmp fixture root (${o.testRoot})`);
    for (const [label, p] of [["compact", cp], ["store", sp], ["edits", rel(o.editsPath)]] as [string, string][]) { const r = realpathSync(p); if (r !== root && !r.startsWith(`${root}/`)) throw new Error(`mint refused (test-root): ${label} outside the fixture root (${p})`); }
  }
  const compactDoc = JSON.parse(readFileSync(cp, "utf8")) as { full?: { store?: unknown; sha256?: unknown }; rows?: unknown; [k: string]: unknown };
  const header = compactDoc.full ?? {};
  const headerStore: unknown = header.store;
  const headerSha: unknown = header.sha256;
  if (typeof headerStore !== "string" || typeof headerSha !== "string" || !/^[0-9a-f]{64}$/.test(headerSha)) throw new Error(`mint refused (header): compact header names no store path + sha256 (${cp})`);
  const oldText = readFileSync(join(sp, headerStore), "utf8");
  if (mintSha(oldText) !== headerSha) throw new Error(`mint refused (r4): store inventory sha mismatch (${sp}/${headerStore})`);
  const blobDoc = JSON.parse(oldText) as { consumers?: unknown; [k: string]: unknown };
  if (!Array.isArray(blobDoc.consumers) || !Array.isArray(compactDoc.rows)) throw new Error("mint refused (read): inventory has no consumers/rows arrays");
  const rawEdits: unknown = JSON.parse(readFileSync(rel(o.editsPath), "utf8"));
  if (!Array.isArray(rawEdits)) throw new Error(`mint refused (edits): edit list is not an array (${o.editsPath})`);
  const edits = rawEdits.map((e: unknown, i: number): PostExportMintEdit => {
    const v = e as PostExportMintEdit | null;
    if (typeof v !== "object" || v === null || typeof v.file !== "string" || typeof v.field !== "string" || typeof v.proposed_pin !== "string" || (v.reason !== undefined && typeof v.reason !== "string")) throw new Error(`mint refused (edits): edit ${i} wants {file, field, proposed_pin, reason?} strings`);
    return v.reason === undefined ? { file: v.file, field: v.field, proposed_pin: v.proposed_pin } : { file: v.file, field: v.field, proposed_pin: v.proposed_pin, reason: v.reason };
  });
  const rows = blobDoc.consumers as MintRow[];
  const crows = compactDoc.rows as MintRow[];
  const at = edits.map((e) => {
    if (!(POST_EXPORT_PIN_ENUM as readonly string[]).includes(e.proposed_pin)) throw new Error(`mint refused (r3): proposed_pin outside the pin enum [${POST_EXPORT_PIN_ENUM.join(", ")}] (${e.file} ${e.field}: ${e.proposed_pin})`);
    const hits: number[] = [];
    rows.forEach((r, i) => { if (r.file === e.file && mintFieldKey(r.field_or_symbol) === mintFieldKey(e.field)) hits.push(i); });
    if (hits.length !== 1) throw new Error(`mint refused (r2): ${hits.length === 0 ? "no blob row for" : `ambiguous (${hits.length})`} (${e.file} ${e.field})`);
    return hits[0] as number;
  });
  const atSet = new Set(at);
  const bkey = rows.map((r) => `${r.file}\0${mintFieldKey(r.field_or_symbol)}`);
  const cpool = new Map<string, number[]>();
  crows.forEach((r, i) => { const k = `${r.file}\0${mintFieldKey(r.field)}`; cpool.set(k, [...(cpool.get(k) ?? []), i]); });
  const pair: (number | undefined)[] = new Array(rows.length).fill(undefined);
  const drift: string[] = [];
  const noted: string[] = [];
  bkey.forEach((k, bi) => {
    const q = cpool.get(k);
    if (q === undefined || q.length === 0) return;
    const ci = q.shift() as number;
    pair[bi] = ci;
    const rb = rows[bi] as MintRow;
    const cb = crows[ci] as MintRow;
    if (rb.proposed_pin !== cb.proposed_pin) {
      const msg = `pin:${rb.file} [${mintFieldKey(rb.field_or_symbol)}] compact=${cb.proposed_pin} blob=${rb.proposed_pin}`;
      if (atSet.has(bi)) noted.push(msg);
      else drift.push(msg);
    }
  });
  const bf = new Map<string, number[]>();
  const cf = new Map<string, number[]>();
  bkey.forEach((_, i) => { if (pair[i] === undefined) { const f = (rows[i] as MintRow).file; bf.set(f, [...(bf.get(f) ?? []), i]); } });
  crows.forEach((r, i) => { if (!pair.includes(i)) cf.set(r.file, [...(cf.get(r.file) ?? []), i]); });
  for (const [f, bl] of bf) {
    const cl = cf.get(f) ?? [];
    for (let k = 0; k < Math.min(bl.length, cl.length); k++) {
      const bi = bl[k] as number;
      const ci = cl[k] as number;
      pair[bi] = ci;
      const rb = rows[bi] as MintRow;
      const cb = crows[ci] as MintRow;
      if (!atSet.has(bi) && rb.proposed_pin !== cb.proposed_pin) drift.push(`pin:${f} [${k}] compact=${cb.proposed_pin} blob=${rb.proposed_pin}`);
    }
    for (const bi of bl.slice(Math.min(bl.length, cl.length))) { const rb = rows[bi] as MintRow; if (!atSet.has(bi)) drift.push(`blob-only:${f} (${mintFieldKey(rb.field_or_symbol)})`); }
    for (const ci of cl.slice(Math.min(bl.length, cl.length))) drift.push(`compact-only:${f} (${String((crows[ci] as MintRow).field)})`);
  }
  for (const [f, cl] of cf) if (!bf.has(f)) drift.push(`compact-only:${f} (${cl.length})`);
  if (drift.length > 0) throw new Error(`mint refused (r1): ${drift.length} outside the edit list disagree: ${drift.join("; ").slice(0, 900)}; edits: ${edits.map((e) => `${e.file} [${e.field}]`).join(", ")}${noted.length > 0 ? `; edited-row pins differ (overwritten): ${noted.join("; ").slice(0, 400)}` : ""}`);
  const next = rows.map((r) => ({ ...r }));
  at.forEach((bi: number, k: number) => {
    const e: PostExportMintEdit | undefined = edits[k];
    const r: MintRow | undefined = next[bi];
    if (e === undefined || r === undefined) throw new Error(`mint refused (r2): edit ${k} resolved outside the blob`);
    else {
      r.proposed_pin = e.proposed_pin;
      if (e.reason !== undefined) r.reason = e.reason;
    }
  });
  const newText = mintCanon({ ...blobDoc, consumers: next });
  const newSha = mintSha(newText);
  const blobName = `post-export-stage-consumers.full-${newSha.slice(0, 8)}.json`;
  const target = join(sp, MINT_BLOB_DIR, blobName);
  let wrote = false;
  if (newText !== oldText) {
    let cur: string | undefined;
    try { cur = readFileSync(target, "utf8"); } catch { cur = undefined; }
    if (cur === undefined) {
      mkdirSync(join(sp, MINT_BLOB_DIR), { recursive: true });
      try { writeFileSync(target, newText, { flag: "wx" }); } catch { throw new Error(`mint refused (write-once): store path cannot be created exclusively (${target}); refusing overwrite`); }
      wrote = true;
    } else if (cur !== newText) throw new Error(`mint refused (write-once): store path exists with different bytes (${target}); refusing overwrite`);
  }
  const nrows: MintRow[] = rows.map((_, bi) => {
    const nb = next[bi] as MintRow;
    const ci = pair[bi];
    if (ci === undefined) {
      const added: MintRow = { file: nb.file, field: mintFieldKey(nb.field_or_symbol), proposed_pin: nb.proposed_pin, reader: "no" };
      if (nb.reason !== undefined) added.reason = nb.reason;
      return added;
    }
    const c: MintRow = { ...(crows[ci] as MintRow) };
    if (atSet.has(bi)) {
      c.proposed_pin = nb.proposed_pin;
      if (nb.reason === undefined) delete c.reason;
      else c.reason = nb.reason;
    }
    return c;
  });
  const newCompact = mintCanon({ ...compactDoc, full: { store: `${MINT_BLOB_DIR}/${blobName}`, sha256: newSha }, rows: nrows });
  const tmpCp = `${cp}.${process.pid}.tmp`;
  try {
    writeFileSync(tmpCp, newCompact);
    renameSync(tmpCp, cp);
  } catch (error) {
    try { unlinkSync(tmpCp); } catch { /* tmp cleanup is best-effort */ }
    if (wrote) { try { unlinkSync(target); } catch { /* new-blob rollback is best-effort */ } }
    if (error instanceof Error && error.message.startsWith("mint refused")) throw error;
    throw new Error(`mint refused (compact-write): compact rewrite failed (${cp}); refusing`);
  }
  return { blobPath: target, blobSha256: newSha, blobWrote: wrote, branch: wrote ? "wrote-new" : "identical", compactPath: cp, editsApplied: edits.length };
}
