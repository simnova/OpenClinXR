import { NON_CAST_RUNTIME_ROLES } from "../openclaw/runtime-humanoid-reachability.js";

export const DECLARATION_ONLY_SCHEMA = "openclinxr.humanoid-provenance.declaration-only.v1";

/** Fields that assert a bake happened. A declaration-only sidecar must carry none of them. */
export const BAKED_CLAIM_FIELDS = [
  "derivationMode",
  "phenotypeSource",
  "phenotypeSourceKind",
  "caseDefinitionSource",
] as const;

export type ProvenanceBody = Record<string, unknown>;

/** Typed discriminant only: schema tag + explicit flag. No filename, no notes parsing. */
export function isDeclarationOnly(body: ProvenanceBody): boolean {
  return body["schemaVersion"] === DECLARATION_ONLY_SCHEMA && body["declarationOnly"] === true;
}

export function claimsBakedFields(body: ProvenanceBody): boolean {
  return BAKED_CLAIM_FIELDS.some(
    (f) => typeof body[f] === "string" && (body[f] as string).length > 0,
  );
}

export function assetGlbForSidecar(name: string, body: ProvenanceBody): string {
  const a = body["asset"];
  if (typeof a === "string" && a.endsWith(".glb")) return a.split("/").pop() as string;
  return name.replace(/\.provenance\.json$/u, ".glb");
}

/**
 * Generic ban: a declaration-only asset must declare a non-cast runtimeRole,
 * claim no baked fields, and be absent from the live shipped-bank cast.
 * Returns error strings; empty means the exclusion is earned. Non-declaration
 * bodies return [] (they stay under the bake convention, unknowns included).
 */
export function validateDeclarationOnly(
  name: string,
  body: ProvenanceBody,
  liveAssetPaths: ReadonlySet<string>,
): string[] {
  if (!isDeclarationOnly(body)) return [];
  const errors: string[] = [];
  const role = body["runtimeRole"];
  if (typeof role !== "string" || !(NON_CAST_RUNTIME_ROLES as readonly string[]).includes(role)) {
    errors.push(`${name} declaration-only without non-cast runtimeRole`);
  }
  for (const f of BAKED_CLAIM_FIELDS) {
    if (typeof body[f] === "string" && (body[f] as string).length > 0) {
      errors.push(`${name} declaration-only claims baked field ${f}`);
    }
  }
  const glb = assetGlbForSidecar(name, body);
  for (const p of liveAssetPaths) {
    if (p === glb || p.endsWith(`/${glb}`)) {
      errors.push(`${name} declaration-only is in the live shipped-bank cast`);
      break;
    }
  }
  return errors;
}

export function partitionSidecars<T extends { name: string; body: ProvenanceBody }>(all: T[]): {
  declarationOnly: T[];
  bakeClaimed: T[];
} {
  return {
    declarationOnly: all.filter((s) => isDeclarationOnly(s.body)),
    // Unknown/untyped bodies fall here and stay under the bake convention.
    bakeClaimed: all.filter((s) => !isDeclarationOnly(s.body)),
  };
}
