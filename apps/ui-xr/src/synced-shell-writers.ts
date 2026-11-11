/** Synced shell writers: the doorway eyebrow follows the server phase. */
export function writeSyncedDoorwayEyebrow(el: Pick<Element, "textContent">, phase: string | undefined): string {
  if (!phase) return "";
  const name = phase.charAt(0).toUpperCase() + phase.slice(1);
  el.textContent = name;
  return name;
}
