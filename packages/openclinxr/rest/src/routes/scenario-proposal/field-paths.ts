export function splitFieldPath(path: string): string[] | undefined {
  if (path.trim().length === 0 || path !== path.trim()) return undefined;
  if (path.startsWith(".") || path.endsWith(".") || path.includes("..")) return undefined;
  const segments = path.split(".");
  if (segments.some((segment) => segment.length === 0)) return undefined;
  return segments;
}

export function getByPath(root: unknown, path: string): { ok: true; value: unknown } | { ok: false } {
  const segments = splitFieldPath(path);
  if (!segments) return { ok: false };
  let cursor: unknown = root;
  for (const segment of segments) {
    if (cursor === null || typeof cursor !== "object") return { ok: false };
    if (Array.isArray(cursor)) {
      if (!/^\d+$/u.test(segment)) return { ok: false };
      const index = Number(segment);
      if (index >= cursor.length) return { ok: false };
      cursor = cursor[index];
      continue;
    }
    if (!(segment in cursor)) return { ok: false };
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return { ok: true, value: cursor };
}

export function setByPath(root: unknown, path: string, value: unknown): unknown | undefined {
  const segments = splitFieldPath(path);
  if (!segments) return undefined;
  return setAt(root, segments, 0, value);
}

function setAt(node: unknown, segments: readonly string[], index: number, value: unknown): unknown | undefined {
  const segment = segments[index];
  if (segment === undefined) return undefined;
  const last = index === segments.length - 1;
  if (node === null || typeof node !== "object") return undefined;

  if (Array.isArray(node)) {
    if (!/^\d+$/u.test(segment)) return undefined;
    const at = Number(segment);
    if (at >= node.length) return undefined;
    const next = [...node];
    if (last) {
      next[at] = value;
      return next;
    }
    const child = setAt(next[at], segments, index + 1, value);
    if (child === undefined) return undefined;
    next[at] = child;
    return next;
  }

  const record = node as Record<string, unknown>;
  if (!(segment in record)) return undefined;
  const copy: Record<string, unknown> = { ...record };
  if (last) {
    copy[segment] = value;
    return copy;
  }
  const child = setAt(copy[segment], segments, index + 1, value);
  if (child === undefined) return undefined;
  copy[segment] = child;
  return copy;
}

export function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
