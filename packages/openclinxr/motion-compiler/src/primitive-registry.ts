import type { CompiledMotionFragment, PrimitiveRequest } from "./canonical-motion-contract.js";

import { compile as compileGuardBodyRegion } from "./guard-body-region.js";
import { compile as compileClutchBodyRegion } from "./clutch-body-region.js";
import { compile as compileReachTarget } from "./reach-target.js";
import { compile as compileLookAt } from "./look-at.js";
import { compile as compileCoughRecoil } from "./cough-recoil.js";

/**
 * THE PRIMITIVE REGISTRY — one seam, owned once.
 *
 * Card tsk_51ffcc3e1a8fdea8. Five planted contracts required `./primitive-registry.js` and nobody
 * owned it; M2 (guard) and M4 (four behaviours) were described as releasable siblings while both
 * would have had to edit one unowned file. This module freezes the seam so they register through
 * it instead of racing for it.
 *
 * WHAT THIS FILE IS: the vocabulary, resolution and delegation. It implements NO motion. Every
 * registered entry delegates to a placeholder module whose BODY the owning card replaces; this file
 * is never edited by M2 or M4, and clause (5) of the seam test makes that mechanically true by
 * refusing duplicate ids at construction.
 *
 * THE STATIC REGISTRY. There is no runtime registration surface at all: the production registry is
 * built once, at import time, from stable module paths, so import order cannot decide who owns an
 * id. `createPrimitiveRegistry` is exported ONLY so collision handling is a property of a
 * deterministic pure constructor, testable without lifecycle semantics.
 */

/** The complete primitive-ID vocabulary: M2's guard plus M4's four. */
export const PRIMITIVE_IDS = [
  "guard_body_region",
  "clutch_body_region",
  "reach_target",
  "look_at",
  "cough_recoil",
] as const;

export type PrimitiveId = (typeof PRIMITIVE_IDS)[number];

export type RegisteredPrimitive = { compile: (request: PrimitiveRequest) => CompiledMotionFragment };

export type PrimitiveRegistryEntry = { id: string; primitive: RegisteredPrimitive };

export type PrimitiveRegistry = { resolvePrimitive: (id: string) => RegisteredPrimitive };

/**
 * PURE CONSTRUCTOR. Refuses a duplicate id deterministically — two entries claiming one id means
 * ownership depends on input order, which is the defect this seam exists to prevent. Unknown ids
 * are REFUSED at resolution, not silently undefined: `undefined` is indistinguishable from "not
 * registered yet" at every call site, and the canonical entry's own clause (3) requires a refusal.
 */
export function createPrimitiveRegistry(entries: readonly PrimitiveRegistryEntry[]): PrimitiveRegistry {
  const seen = new Set<string>();
  const byId = new Map<string, RegisteredPrimitive>();
  for (const entry of entries) {
    if (seen.has(entry.id)) {
      throw new Error(`createPrimitiveRegistry: duplicate primitive id "${entry.id}" — ownership of an id would depend on input order`);
    }
    seen.add(entry.id);
    byId.set(entry.id, entry.primitive);
  }
  return {
    resolvePrimitive: (id: string): RegisteredPrimitive => {
      const primitive = byId.get(id);
      if (!primitive) {
        throw new Error(`resolvePrimitive: unknown primitive id "${id}"`);
      }
      return primitive;
    },
  };
}

/** Stable module paths, in vocabulary order. M2/M4 replace the BODIES of their own modules. */
const STATIC_ENTRIES: readonly PrimitiveRegistryEntry[] = [
  { id: "guard_body_region", primitive: { compile: compileGuardBodyRegion } },
  { id: "clutch_body_region", primitive: { compile: compileClutchBodyRegion } },
  { id: "reach_target", primitive: { compile: compileReachTarget } },
  { id: "look_at", primitive: { compile: compileLookAt } },
  { id: "cough_recoil", primitive: { compile: compileCoughRecoil } },
];

const STATIC_REGISTRY = createPrimitiveRegistry(STATIC_ENTRIES);

/** Resolve a primitive by id, refusing ids outside the vocabulary. */
export const resolvePrimitive: PrimitiveRegistry["resolvePrimitive"] = STATIC_REGISTRY.resolvePrimitive;
