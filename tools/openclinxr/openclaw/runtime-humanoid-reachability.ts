/**
 * runtime-humanoid-reachability — is this published humanoid asset something a learner can reach?
 *
 * ## WHY THIS EXISTS
 *
 * On 2026-08-24 four commits improved `peds_fever_patient_child.glb` between 19:21 and 23:28 — a
 * provenance slice that EMITTED it, a garment hem weld, and two shoe fixes. No runtime source
 * references that asset. Five gates passed every one of those commits, and two reviewers confirmed
 * the geometry. Full account: `docs/openclinxr/postmortem-anny-fixture-polish-2026-08-25.md`.
 *
 * The gates were multiple but not independent: each accepted a self-description of product relevance
 * — a path, a declared factory step, an attached proof. None consulted the consumer graph. This is
 * that missing source of truth.
 *
 * ## THE POPULATION IS CALLED, NEVER RE-IMPLEMENTED
 *
 * `listShippedCastScenarioIds()` then `resolveScenarioActorCast()`. A second implementation of "who
 * is in the cast" would be the same defect one layer down — the whole failure was a hand-authored
 * subject list diverging from the live one.
 *
 * ## THE DISCRIMINATOR, AND WHAT IT DELIBERATELY IS NOT
 *
 * Some published assets are legitimately unreachable: inspection fixtures, comparators, intermediate
 * bases. The check must let those through WITHOUT becoming an allowlist someone appends to whenever
 * it fires — an allowlist is how this defect returns.
 *
 * Two tempting discriminators are measured DEAD and must not be used:
 *
 *   - NAMING (`-inspect`). A marker check. `peds_fever_patient_child` is named like a cast member and
 *     that is precisely why four commits treated it as one.
 *   - `promotionStatus`. Measured stale in both directions: `mpfb-street-adult-male` says
 *     `baked_not_yet_wired_resolver_swap_out_of_scope` while it LEADS the street resolver, and the
 *     unreachable fever asset says `runtime_candidate_not_realism_gate_pass` — the same status live
 *     legacy assets carry.
 *
 * So the discriminator is a DECLARATION the asset makes about itself: `runtimeRole` in its own
 * provenance sidecar. An asset is acceptable when the resolver reaches it, or when it says in writing
 * what it is instead. An orphan that claims nothing fails, which is the case this was built for.
 *
 * claimScope: whether each published humanoid GLB is reached by the shipped-bank cast resolver, or
 *   declares a non-cast runtimeRole.
 * notEvidenceFor: whether a reached asset is CORRECT, whether a declared non-cast role is honest, or
 *   anything about assets outside the published humanoid directories.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/** Roles an asset may declare instead of being cast. Not an allowlist of ASSETS — of PURPOSES. */
export const NON_CAST_RUNTIME_ROLES = [
  "inspection_fixture",
  "comparator",
  "reference_base",
  "intermediate_bake",
] as const;

/** Directories whose GLBs are published to the learner and therefore in scope. */
export const PUBLISHED_HUMANOID_DIRS = [
  "apps/ui-xr/public/generated-humanoids",
] as const;

export type AssetReachability = {
  asset: string;
  path: string;
  reachedByResolver: boolean;
  declaredRuntimeRole: string | null;
  ok: boolean;
  why: string;
};

export type ReachabilityReport = {
  liveCastAssetCount: number;
  publishedAssetCount: number;
  assets: AssetReachability[];
  orphans: AssetReachability[];
};

type CastFns = {
  listShippedCastScenarioIds: () => string[];
  resolveScenarioActorCast: (id: string) => Array<{ assetPath: string }>;
};

/** The live cast, from the resolver the product uses. Injected so a test can prove it is CALLED. */
export function liveCastAssetPaths(cast: CastFns): Set<string> {
  const out = new Set<string>();
  for (const scenarioId of cast.listShippedCastScenarioIds()) {
    for (const actor of cast.resolveScenarioActorCast(scenarioId)) out.add(actor.assetPath);
  }
  return out;
}

function declaredRuntimeRole(repoRoot: string, dir: string, asset: string): string | null {
  const p = join(repoRoot, dir, `${asset}.provenance.json`);
  if (!existsSync(p)) return null;
  try {
    const v = (JSON.parse(readFileSync(p, "utf8")) as { runtimeRole?: unknown }).runtimeRole;
    return typeof v === "string" ? v : null;
  } catch {
    return null;
  }
}

export function checkRuntimeHumanoidReachability(repoRoot: string, cast: CastFns): ReachabilityReport {
  const live = liveCastAssetPaths(cast);
  const assets: AssetReachability[] = [];

  for (const dir of PUBLISHED_HUMANOID_DIRS) {
    const abs = join(repoRoot, dir);
    if (!existsSync(abs)) continue;
    for (const file of readdirSync(abs).filter((f) => f.endsWith(".glb")).sort()) {
      const asset = file.slice(0, -4);
      const repoRelative = `${dir}/${file}`;
      const reached = live.has(repoRelative);
      const role = declaredRuntimeRole(repoRoot, dir, asset);
      const roleOk = role !== null && (NON_CAST_RUNTIME_ROLES as readonly string[]).includes(role);
      assets.push({
        asset,
        path: repoRelative,
        reachedByResolver: reached,
        declaredRuntimeRole: role,
        ok: reached || roleOk,
        why: reached
          ? "reached by the shipped-bank cast resolver"
          : roleOk
            ? `declares runtimeRole=${role}`
            : role === null
              ? "UNREACHABLE and declares no runtimeRole — nothing loads this and it does not say what it is"
              : `UNREACHABLE and declares runtimeRole=${role}, which is not one of ${NON_CAST_RUNTIME_ROLES.join("|")}`,
      });
    }
  }

  return {
    liveCastAssetCount: live.size,
    publishedAssetCount: assets.length,
    assets,
    orphans: assets.filter((a) => !a.ok),
  };
}
