import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { HostFacts } from "./candidate-screening.js";
import { CANDIDATE_SOURCES } from "./candidate-source-manifest.js";
import type { RetrievalReceipt } from "./retrieve-candidate-sources.js";

/**
 * Read back what the ingestion operation stored, verifying each object against its receipt.
 *
 * Both the named behavior test and SC-10's evidence verifier come through here, so neither can
 * screen bytes that were not actually retrieved, and a source edited after retrieval fails its
 * hash rather than quietly changing a verdict.
 */

export type LoadedSources = {
  sources: Map<string, Buffer>;
  receipts: RetrievalReceipt[];
  problems: string[];
  storeRoot: string;
};

function sha256Hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** The alias root from the owner registry. No default, no environment fallback to a fixture. */
export function resolveSourceStoreRoot(registryPath: string | undefined): string {
  if (!registryPath) throw new Error("OPENCLINXR_SC_EVIDENCE_REGISTRY is not set");
  if (!path.isAbsolute(registryPath)) throw new Error("OPENCLINXR_SC_EVIDENCE_REGISTRY must be absolute");
  const registry = JSON.parse(readFileSync(registryPath, "utf8")) as {
    aliases?: Record<string, { root?: string }>;
  };
  const root = registry.aliases?.["sc-evidence"]?.root;
  if (!root) throw new Error("registry has no sc-evidence alias root");
  return root;
}

export function loadRetrievedSources(registryPath: string | undefined): LoadedSources {
  const storeRoot = resolveSourceStoreRoot(registryPath);
  const receiptPath = path.join(storeRoot, "sc-10/sources/retrieval-receipts.json");
  const problems: string[] = [];
  if (!existsSync(receiptPath)) {
    return { sources: new Map(), receipts: [], problems: [`retrieval receipts absent at ${receiptPath}`], storeRoot };
  }
  const receipts = JSON.parse(readFileSync(receiptPath, "utf8")) as RetrievalReceipt[];
  const byId = new Map(receipts.map((receipt) => [receipt.sourceId, receipt]));
  const sources = new Map<string, Buffer>();
  for (const source of CANDIDATE_SOURCES) {
    const receipt = byId.get(source.sourceId);
    if (receipt === undefined) {
      problems.push(`${source.sourceId} has no retrieval receipt`);
      continue;
    }
    if (receipt.url !== source.url) {
      problems.push(`${source.sourceId} was retrieved from ${receipt.url}, not the pinned ${source.url}`);
      continue;
    }
    if (receipt.httpStatus !== 200) {
      problems.push(`${source.sourceId} retrieval returned HTTP ${receipt.httpStatus}`);
      continue;
    }
    const objectPath = path.join(storeRoot, source.objectKey);
    if (!existsSync(objectPath)) {
      problems.push(`${source.sourceId} object is missing from the store`);
      continue;
    }
    const bytes = readFileSync(objectPath);
    const digest = sha256Hex(bytes);
    if (digest !== receipt.sha256) {
      problems.push(`${source.sourceId} bytes changed since retrieval (receipt ${receipt.sha256}, disk ${digest})`);
      continue;
    }
    if (bytes.byteLength !== receipt.byteCount) {
      problems.push(`${source.sourceId} byte count changed since retrieval`);
      continue;
    }
    sources.set(source.sourceId, bytes);
  }
  return { sources, receipts, problems, storeRoot };
}

/** Measure the execution host rather than describing it. */
export function measureHostFacts(): HostFacts {
  // Annotated, not inferred: `process.arch` narrows to the `Architecture` literal union, so an
  // inferred binding rejects the sysctl string that is the whole point of the measurement.
  let cpuBrand: string = process.arch;
  try {
    cpuBrand = execFileSync("sysctl", ["-n", "machdep.cpu.brand_string"], { encoding: "utf8" }).trim();
  } catch {
    cpuBrand = `${process.platform}/${process.arch}`;
  }
  let cudaDevicePresent = false;
  try {
    execFileSync("nvidia-smi", ["-L"], { stdio: "ignore" });
    cudaDevicePresent = true;
  } catch {
    cudaDevicePresent = existsSync("/usr/local/cuda");
  }
  return { platform: process.platform, arch: process.arch, cpuBrand, cudaDevicePresent };
}
