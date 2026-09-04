/**
 * Canonical authored-content identity.
 *
 * Same complete recursive canonicalize as `apps/api/src/scenario-review-promotion.ts`:
 * omit documented non-authored/transient root keys (`review`, `status`) and the nested
 * GraphQL transport key (`__typename`). Do not replace this with a hand-picked field subset.
 */

export const AUTHORED_CONTENT_IDENTITY_EVIDENCE_PREFIX = "authoredContentIdentity:";
export const AUTHORED_CONTENT_IDENTITY_OMITTED_ROOT_KEYS = ["review", "status"] as const;
export const AUTHORED_CONTENT_IDENTITY_OMITTED_NESTED_KEYS = ["__typename"] as const;

function fnv1aHex(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function canonicalizeAuthoredValue(value: unknown, atRoot: boolean): unknown {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => canonicalizeAuthoredValue(item, false));
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record)
    .filter((key) => {
      if (record[key] === undefined) {
        return false;
      }
      if ((AUTHORED_CONTENT_IDENTITY_OMITTED_NESTED_KEYS as readonly string[]).includes(key)) {
        return false;
      }
      if (atRoot && (AUTHORED_CONTENT_IDENTITY_OMITTED_ROOT_KEYS as readonly string[]).includes(key)) {
        return false;
      }
      return true;
    })
    .sort();
  const canonical: Record<string, unknown> = {};
  for (const key of keys) {
    canonical[key] = canonicalizeAuthoredValue(record[key], false);
  }
  return canonical;
}

/**
 * JSON-like canonical snapshot of authored content. Deep-cloned, so later mutations of the
 * original input cannot change the stored value or its identity.
 */
export function snapshotAuthoredContent<T>(content: T): T {
  return JSON.parse(JSON.stringify(canonicalizeAuthoredValue(content, true))) as T;
}

export function deepFreezeAuthoredContent<T>(value: T): T {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      deepFreezeAuthoredContent(item);
    }
  } else {
    for (const key of Object.keys(value as object)) {
      deepFreezeAuthoredContent((value as Record<string, unknown>)[key]);
    }
  }
  return Object.freeze(value);
}

/** Canonical hash of complete authored content minus documented non-authored/transient keys. */
export function authoredContentIdentity(content: unknown): string {
  return fnv1aHex(JSON.stringify(canonicalizeAuthoredValue(content, true)));
}

export function authoredContentIdentityEvidenceRef(identity: string): string {
  if (identity.trim().length === 0) {
    throw new Error("authored content identity evidence ref requires a non-empty identity");
  }
  return `${AUTHORED_CONTENT_IDENTITY_EVIDENCE_PREFIX}${identity}`;
}

export function authoredContentIdentityFromEvidenceRefs(evidenceRefs: readonly string[]): string | undefined {
  const found = evidenceRefs.find((ref) => ref.startsWith(AUTHORED_CONTENT_IDENTITY_EVIDENCE_PREFIX));
  return found === undefined ? undefined : found.slice(AUTHORED_CONTENT_IDENTITY_EVIDENCE_PREFIX.length);
}
