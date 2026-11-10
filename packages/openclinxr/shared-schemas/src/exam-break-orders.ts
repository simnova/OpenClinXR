/**
 * The break orders that actually run: the sorted, unique entries of `breakAfterStationOrders` that are a station order and
 * not the maximum station order. A break never follows the last station; "last" is the max order value, not the array position.
 * Both the exam timing plan and the synced encounter server call this, so the two cannot disagree.
 */
export function effectiveBreakAfterStationOrders(
  stationOrders: readonly number[],
  breakAfterStationOrders: readonly number[],
): number[] {
  if (stationOrders.length === 0) {
    return [];
  }
  const maxOrder = Math.max(...stationOrders);
  const members = new Set(stationOrders);
  const kept = breakAfterStationOrders.filter((order) => members.has(order) && order !== maxOrder);
  return [...new Set(kept)].sort((left, right) => left - right);
}
