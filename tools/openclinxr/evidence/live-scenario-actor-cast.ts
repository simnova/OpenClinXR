/**
 * Live-enumerated scenario cast for evidence contracts (#528).
 *
 * Wire the proven enumerator — do not hand-author another population:
 *   resolveScenarioActorCast() over listShippedCastScenarioIds()
 *   — packages/openclinxr/asset-registry/src/actor-casting.ts
 *
 * campaign-track.ts:20 records why: "Four hand-typed populations produced confident
 * wrong measurements earlier in this campaign." This helper is the shared consumer so
 * skin/garment contracts stop scanning the GLB directory (harness subjects a learner
 * never sees) or typing a three-actor literal that the cast outgrew.
 */
import {
  listShippedCastScenarioIds,
  resolveScenarioActorCast,
} from "../../../packages/openclinxr/asset-registry/src/actor-casting.js";

export type LiveCastActor = {
  scenarioId: string;
  actorId: string;
  role: string;
  /** Repo-relative asset path from the casting SSOT. */
  assetPath: string;
  /** Basename including `.glb`. */
  glb: string;
};

/** Every cast slot across shipped scenarios (cross-scenario reuse kept as separate rows). */
export function listLiveCastActors(): LiveCastActor[] {
  const out: LiveCastActor[] = [];
  for (const scenarioId of listShippedCastScenarioIds()) {
    for (const a of resolveScenarioActorCast(scenarioId)) {
      const assetPath = a.assetPath ?? "";
      const glb = assetPath.split("/").pop() ?? "";
      out.push({
        scenarioId,
        actorId: a.actorId,
        role: a.role,
        assetPath,
        glb,
      });
    }
  }
  return out;
}

/** Unique repo-relative asset paths from the live cast (cross-scenario reuse collapses). */
export function listUniqueLiveCastAssetPaths(): string[] {
  return [...new Set(listLiveCastActors().map((a) => a.assetPath).filter(Boolean))].sort();
}

/**
 * Unique MPFB cast asset paths. Filters on the basename prefix from casting, never a
 * directory scan and never a `*-inspect` name filter (§7k).
 */
export function listUniqueLiveCastMpfbAssetPaths(): string[] {
  return listUniqueLiveCastAssetPaths().filter((p) => {
    const base = p.split("/").pop() ?? "";
    return base.startsWith("mpfb-") && base.endsWith(".glb");
  });
}
