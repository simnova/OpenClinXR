/**
 * Shared-attribute index union — the ONE contract for the aisha-sweater consumer fix.
 *
 * A glTF primitive that shares its attribute arrays with another primitive (aisha's
 * appended shoulder-hide primitive reuses the body POSITION/JOINTS_0/WEIGHTS_0 accessors)
 * must not claim every row of those arrays: it may claim only the vertex rows its own
 * indices reference, deduped per shared attribute set. Consumers that counted all rows
 * of a shared set double-sampled the body (supine contact) and counted 1,140 phantom
 * hidden hand vertices (garment meters).
 *
 * Rule (applies identically to the contact solver and both garment meters):
 * - carriers are grouped by attribute-set identity (`set`: the accessor object, or the
 *   three.js BufferAttribute — SameValueZero);
 * - a set shared by >1 carrier resolves `shared: true` with the union of referenced
 *   rows plus each carrier's own referenced rows;
 * - a carrier alone on its set resolves `shared: false` with an EMPTY union: the caller
 *   keeps its legacy all-rows path, so actors without shared sets measure bit-identical;
 * - a carrier with an empty index contributes nothing (CW-1);
 * - a null index means non-indexed: every row is drawn in order, so every row is claimed;
 * - `ranges` restricts a carrier to rendered-material group spans (index-element space);
 *   default is the whole index. Out-of-range row numbers are skipped.
 */
export type SharedAttributeIndex = {
  readonly count: number;
  getX(index: number): number;
} | null;

/** Index-element span that participates in a carrier's referenced-row set. */
export type SharedAttributeRange = {
  start: number;
  count: number;
};

/** One primitive/mesh claiming rows of a possibly-shared attribute set. */
export type SharedAttributeCarrier = {
  /** Identity of the shared attribute set (accessor object / BufferAttribute). */
  set: unknown;
  /** Row number per index element; null for non-indexed carriers (all rows drawn). */
  index: SharedAttributeIndex;
  /** Row count of the attribute set. Bounds checks + the null-index case. */
  vertexCount: number;
  /** Index-element ranges that participate; default = the whole index. */
  ranges?: ReadonlyArray<SharedAttributeRange>;
};

/** Per-attribute-set resolution: shared flag, deduped union, and per-carrier rows. */
export type SharedAttributeResolution = {
  /** True only when >1 carrier shares the set — the only case with new behaviour. */
  shared: boolean;
  /** Union of referenced rows across the sharing carriers, deduped. Empty for singletons. */
  union: ReadonlySet<number>;
  /** Referenced rows per carrier (own ranges only). */
  perCarrier: ReadonlyMap<SharedAttributeCarrier, ReadonlySet<number>>;
};

function referencedRowsOf(carrier: SharedAttributeCarrier): Set<number> {
  const rows = new Set<number>();
  if (carrier.index === null) {
    for (let row = 0; row < carrier.vertexCount; row += 1) rows.add(row);
    return rows;
  }
  const ranges = carrier.ranges ?? [{ start: 0, count: carrier.index.count }];
  for (const range of ranges) {
    const end = Math.min(range.start + range.count, carrier.index.count);
    for (let i = Math.max(0, range.start); i < end; i += 1) {
      const row = carrier.index.getX(i);
      if (Number.isInteger(row) && row >= 0 && row < carrier.vertexCount) rows.add(row);
    }
  }
  return rows;
}

/** Group carriers by attribute-set identity and resolve each set's referenced rows. */
export function resolveSharedAttributeRows(
  carriers: readonly SharedAttributeCarrier[],
): Map<unknown, SharedAttributeResolution> {
  const grouped = new Map<unknown, SharedAttributeCarrier[]>();
  for (const carrier of carriers) {
    const members = grouped.get(carrier.set);
    if (members) members.push(carrier);
    else grouped.set(carrier.set, [carrier]);
  }
  const out = new Map<unknown, SharedAttributeResolution>();
  for (const [set, members] of grouped) {
    const perCarrier = new Map<SharedAttributeCarrier, ReadonlySet<number>>();
    for (const member of members) perCarrier.set(member, referencedRowsOf(member));
    const shared = members.length > 1;
    const union = new Set<number>();
    if (shared) for (const rows of perCarrier.values()) for (const row of rows) union.add(row);
    out.set(set, { shared, union, perCarrier });
  }
  return out;
}
