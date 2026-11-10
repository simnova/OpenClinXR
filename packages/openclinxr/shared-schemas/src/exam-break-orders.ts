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
