/**
 * C3 — Snapshot + checksum.
 *
 * Serialize solver state to bytes and compute a SHA-256 hex digest.
 * Uses node:crypto for deterministic hashing.
 */

import { createHash } from "node:crypto";
import type { Sha256Hex } from "./types.js";

/**
 * Serialize a JSON-serializable state object to a deterministic byte buffer.
 * Keys are sorted for reproducibility.
 */
export function serializeState(state: unknown): Buffer {
  const json = JSON.stringify(state, deterministicReplacer);
  return Buffer.from(json, "utf-8");
}

/**
 * Compute the SHA-256 hex digest of a serialized state buffer.
 */
export function computeSnapshotHash(serialized: Buffer): Sha256Hex {
  return createHash("sha256").update(serialized).digest("hex");
}

/**
 * Compute SHA-256 from a state object in one call:
 * serialize → sha256 → hex.
 */
export function hashState(state: unknown): Sha256Hex {
  return computeSnapshotHash(serializeState(state));
}

/**
 * JSON.stringify replacer that sorts object keys for deterministic output.
 */
function deterministicReplacer(_key: string, value: unknown): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }
  const sorted: Record<string, unknown> = {};
  const keys = Object.keys(value as Record<string, unknown>).sort();
  for (const k of keys) {
    sorted[k] = (value as Record<string, unknown>)[k];
  }
  return sorted;
}
