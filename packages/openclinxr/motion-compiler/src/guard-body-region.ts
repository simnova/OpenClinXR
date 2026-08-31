/**
 * OWNERSHIP SLOT for `guard_body_region`, established by the registry seam (tsk_51ffcc3e1a8fdea8).
 *
 * The registry resolves `guard_body_region` to this module's `compile`; M2 (tsk_744eea9a35614caf)
 * replaces THIS BODY only — never `primitive-registry.ts`. The implementation lives in
 * `src/primitives/guard-body-region.ts`; this file is the single redirect the registry's stable
 * module path points at, so the seam stays frozen while the solver belongs to its owner.
 */
export { compile } from "./primitives/guard-body-region.js";
