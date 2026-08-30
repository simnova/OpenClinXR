import type { CompiledMotionFragment, PrimitiveRequest } from "./canonical-motion-contract.js";

/**
 * PLACEHOLDER for `guard_body_region`, owned by M2 (tsk_87ee56f876ff1204).
 *
 * This module is the OWNERSHIP SLOT this card (tsk_51ffcc3e1a8fdea8) established: the registry
 * resolves `guard_body_region` to this module's `compile` and M2 replaces THIS BODY only — never
 * `primitive-registry.ts`. The placeholder returns a legal EMPTY-tracks fragment so the seam is
 * canonical end to end while the guard's solver lives with its owner.
 *
 * Deliberately no motion: returning content here would steal M2's behaviour clause.
 */

export function compile(request: PrimitiveRequest): CompiledMotionFragment {
  const action = request.action as { actionId?: unknown };
  if (typeof action?.actionId !== "string") {
    throw new Error("guard_body_region requires a request whose action carries a string actionId");
  }
  return { actionId: action.actionId, tracks: [] };
}
