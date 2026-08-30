import type { CompiledMotionFragment, PrimitiveRequest } from "./canonical-motion-contract.js";

/**
 * PLACEHOLDER for `look_at`, owned by M4 (tsk_eed004e50d19be54).
 *
 * This module is the OWNERSHIP SLOT this card (tsk_51ffcc3e1a8fdea8) established: the registry
 * resolves `look_at` to this module's `compile` and M4 replaces THIS BODY only — never
 * `primitive-registry.ts`. The placeholder returns a legal EMPTY-tracks fragment so the seam is
 * canonical end to end while the gaze solver lives with its owner.
 *
 * Deliberately no motion: returning content here would steal M4's behaviour clause.
 */

export function compile(request: PrimitiveRequest): CompiledMotionFragment {
  const action = request.action as { actionId?: unknown };
  if (typeof action?.actionId !== "string") {
    throw new Error("look_at requires a request whose action carries a string actionId");
  }
  return { actionId: action.actionId, tracks: [] };
}
