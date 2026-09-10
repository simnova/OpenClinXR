import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { CANDIDATE_SOURCES, type CandidateSource, manifestRevisionProblems } from "./candidate-source-manifest.js";

/**
 * SC-10's research evidence INGESTION operation.
 *
 * It fetches the pinned first-party sources and lands them in the owner-controlled evidence store
 * with a retrieval receipt each. It does not screen and it does not decide; `candidate-screening.ts`
 * does that, reading only bytes this produced.
 *
 * The split matters for the card's "first-token HOLD/executed grading all fail" counterweight: a
 * verdict that never touched retrieved bytes is exactly the failure mode, so the only way to reach
 * the screening engine is through files this operation wrote and hashed.
 */

export type RetrievalReceipt = {
  sourceId: string;
  url: string;
  objectKey: string;
  httpStatus: number;
  byteCount: number;
  sha256: string;
  retrievedAtIso: string;
  mutableIndex: boolean;
};

export function sha256Hex(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Resolve the alias root from the owner registry. There is no default and no fallback. */
export function resolveStoreRoot(): string {
  const registryPath = process.env["OPENCLINXR_SC_EVIDENCE_REGISTRY"];
  if (!registryPath) throw new Error("OPENCLINXR_SC_EVIDENCE_REGISTRY is not set");
  if (!path.isAbsolute(registryPath)) throw new Error("OPENCLINXR_SC_EVIDENCE_REGISTRY must be absolute");
  const registry = JSON.parse(readFileSync(registryPath, "utf8")) as {
    aliases?: Record<string, { root?: string }>;
  };
  const root = registry.aliases?.["sc-evidence"]?.root;
  if (!root) throw new Error("registry has no sc-evidence alias root");
  return root;
}

async function fetchSource(source: CandidateSource, storeRoot: string): Promise<RetrievalReceipt> {
  const response = await fetch(source.url, { redirect: "follow" });
  const bytes = Buffer.from(await response.arrayBuffer());
  const destination = path.join(storeRoot, source.objectKey);
  mkdirSync(path.dirname(destination), { recursive: true });
  writeFileSync(destination, bytes);
  return {
    sourceId: source.sourceId,
    url: source.url,
    objectKey: source.objectKey,
    httpStatus: response.status,
    byteCount: bytes.byteLength,
    sha256: sha256Hex(bytes),
    retrievedAtIso: new Date().toISOString(),
    mutableIndex: source.mutableIndex,
  };
}

async function main(): Promise<void> {
  const manifestProblems = manifestRevisionProblems();
  if (manifestProblems.length > 0) {
    for (const problem of manifestProblems) process.stderr.write(`  - ${problem}\n`);
    process.stderr.write("retrieve-candidate-sources: manifest is not pinned; refusing to retrieve\n");
    process.exitCode = 2;
    return;
  }
  const storeRoot = resolveStoreRoot();
  const receipts: RetrievalReceipt[] = [];
  for (const source of CANDIDATE_SOURCES) {
    const receipt = await fetchSource(source, storeRoot);
    receipts.push(receipt);
    process.stdout.write(
      `${receipt.httpStatus} ${receipt.byteCount.toString().padStart(7)}B ${receipt.sha256.slice(0, 12)} ${receipt.sourceId}\n`,
    );
  }
  const failed = receipts.filter((receipt) => receipt.httpStatus !== 200);
  const receiptPath = path.join(storeRoot, "sc-10/sources/retrieval-receipts.json");
  mkdirSync(path.dirname(receiptPath), { recursive: true });
  writeFileSync(receiptPath, `${JSON.stringify(receipts, null, 2)}\n`);
  process.stdout.write(`\nreceipts: sc-10/sources/retrieval-receipts.json (${receipts.length} sources)\n`);
  if (failed.length > 0) {
    for (const receipt of failed) process.stderr.write(`  - ${receipt.sourceId} returned HTTP ${receipt.httpStatus}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1]?.endsWith("retrieve-candidate-sources.ts")) await main();
