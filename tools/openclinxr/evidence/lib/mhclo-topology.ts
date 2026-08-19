import { readFileSync } from "node:fs";

/**
 * MADR 0052 helper-strip boundary: the MPFB basemesh is stripped at vertex 13,380,
 * so a `.mhclo` whose `verts` block references an index at or above this boundary is
 * interpolating against geometry that no longer exists on the stripped body.
 * Not tuned — it is the basemesh split point.
 */
export const HELPER_STRIP_VERTEX = 13_380;

/**
 * Max basemesh vertex index referenced anywhere in a `.mhclo` `verts` block.
 * Each data row is `i0 i1 i2 w0 w1 w2 dx dy dz` — the first three are BODY vertex indices.
 *
 * Extracted verbatim from the-gown-mhclo-fits-the-stripped-basemesh.test.ts:84-97
 * (E7.1, #450) so the hair-pack inventory and the gown contract share ONE walker.
 * The block is a bare `verts` header followed by index rows — a regex assuming
 * `^verts <n>` returns 0 for every row (measured, that instrument was discarded).
 */
export function maxBodyVertexRef(mhcloPath: string): { max: number; rows: number } {
  const lines = readFileSync(mhcloPath, "utf8").split("\n");
  let inVerts = false;
  let max = -1;
  let rows = 0;
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith("verts")) {
      inVerts = true;
      continue;
    }
    if (!inVerts) continue;
    if (!line || /^[a-z_]+\s/i.test(line)) {
      if (rows > 0) break;
      continue;
    }
    const parts = line.split(/\s+/);
    if (parts.length < 3) continue;
    const idx = parts.slice(0, 3).map(Number);
    if (idx.some((n) => !Number.isInteger(n))) continue;
    rows += 1;
    for (const n of idx) if (n > max) max = n;
  }
  return { max, rows };
}
