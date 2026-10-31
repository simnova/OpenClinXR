/**
 * C15 factory exam-blueprint boot for the xr-sync encounter server.
 *
 * Kept in its own module so server.ts stays under the file-size gate. The
 * live multi-station exam session boots from the factory's exam blueprint
 * (@openclinxr/shared-schemas ExamBlueprint, as @openclinxr/exam-assembly
 * builds it): station roster + phase timing come from the blueprint, the
 * headset shows the current station's blueprint label, and the review index
 * records which blueprint ran.
 *
 * Derived server config: stations = stationSlots sorted by (order, slotId)
 * -> their slotIds; timing = { doorwaySeconds, encounterSeconds,
 * noteSeconds } from the blueprint timing. Boot refuses (message names
 * "examBlueprint"): blueprint together with stations or timing; duplicate
 * slotId; duplicate order; any phase seconds not a positive integer.
 */

import type { StationTiming } from "./phase-clock.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Server config derived from one factory exam blueprint. */
export interface ParsedExamBlueprint {
  blueprintId: string;
  stations: string[];
  timing: StationTiming;
  labels: Map<string, string>;
}

interface ParsedSlot {
  slotId: string;
  order: number;
  label: string;
}

/**
 * Validate a factory exam blueprint and derive the server config. Throws a
 * named error on invalid (every message names "examBlueprint" so the boot
 * refusal is greppable).
 */
export function parseExamBlueprint(value: unknown): ParsedExamBlueprint {
  if (!isRecord(value)) {
    throw new Error("bad-examBlueprint: examBlueprint must be an object");
  }
  const blueprintId = value["blueprintId"];
  if (typeof blueprintId !== "string" || blueprintId.length === 0) {
    throw new Error("bad-examBlueprint: examBlueprint.blueprintId must be a non-empty string");
  }
  const slots = value["stationSlots"];
  if (!Array.isArray(slots) || slots.length === 0) {
    throw new Error("bad-examBlueprint: examBlueprint.stationSlots must be a non-empty array");
  }
  const seenIds = new Set<string>();
  const seenOrders = new Set<number>();
  const parsed: ParsedSlot[] = [];
  for (const slot of slots) {
    if (!isRecord(slot)) {
      throw new Error("bad-examBlueprint: each stationSlot must be an object");
    }
    const slotId = slot["slotId"];
    const order = slot["order"];
    const label = slot["label"];
    if (typeof slotId !== "string" || slotId.length === 0) {
      throw new Error("bad-examBlueprint: each stationSlot.slotId must be a non-empty string");
    }
    if (typeof order !== "number" || !Number.isInteger(order) || order < 1) {
      throw new Error("bad-examBlueprint: each stationSlot.order must be a positive integer");
    }
    if (typeof label !== "string" || label.length === 0) {
      throw new Error("bad-examBlueprint: each stationSlot.label must be a non-empty string");
    }
    if (seenIds.has(slotId)) {
      throw new Error(`bad-examBlueprint: duplicate stationSlot.slotId ${slotId.slice(0, 64)}`);
    }
    if (seenOrders.has(order)) {
      throw new Error(`bad-examBlueprint: duplicate stationSlot.order ${order}`);
    }
    seenIds.add(slotId);
    seenOrders.add(order);
    parsed.push({ slotId, order, label });
  }
  parsed.sort((a, b) => (a.order === b.order ? (a.slotId < b.slotId ? -1 : 1) : a.order - b.order));
  const timing = value["timing"];
  if (!isRecord(timing)) {
    throw new Error("bad-examBlueprint: examBlueprint.timing must be an object");
  }
  const doorwaySeconds = timing["doorwaySeconds"];
  const encounterSeconds = timing["encounterSeconds"];
  const noteSeconds = timing["noteSeconds"];
  const positive = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n > 0;
  if (!positive(doorwaySeconds) || !positive(encounterSeconds) || !positive(noteSeconds)) {
    throw new Error("bad-examBlueprint: examBlueprint.timing doorwaySeconds, encounterSeconds, noteSeconds must be positive integers");
  }
  const labels = new Map<string, string>();
  for (const slot of parsed) {
    labels.set(slot.slotId, slot.label);
  }
  return {
    blueprintId,
    stations: parsed.map((slot) => slot.slotId),
    timing: { doorwaySeconds, encounterSeconds, noteSeconds },
    labels,
  };
}
