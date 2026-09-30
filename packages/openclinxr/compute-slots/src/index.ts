/** Machine-wide lock-file slots for coordinating heavy local subprocesses across agent harnesses. */
export type {
  ComputeSlotLease,
  ComputeSlotMeta,
  ComputeSlotPoolStatus,
  ComputeSlotsStatus,
} from "./slots.js";
export { readComputeSlotsStatus, withComputeSlot, withComputeSlotSync } from "./slots.js";
