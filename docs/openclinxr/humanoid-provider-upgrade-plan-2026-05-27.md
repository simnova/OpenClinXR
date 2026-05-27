# Humanoid Provider Upgrade Plan - 2026-05-27

## Current state
The OB encounter has a B+ practical pass for composition and source-routed actor differentiation. The remaining realism gap is the underlying generated humanoid mesh/rig quality: shoulders, clothing topology, facial fidelity, and body-profile diversity still depend on the current local neutral Anny-derived GLB.

## Why the next step is provider/source upgrade
Screenshot evidence rejected both runtime overlay masks and source-level sleeve scaling. Those approaches hide or amplify mesh defects instead of solving them. The next productive slice must replace or improve the upstream humanoid source, then route the result through the existing encounter factory.

## Recommended integration order
1. Add a provider candidate contract for higher-quality humanoid source generation/import, disabled by default.
2. Require license/provenance, generated asset hash, actor-role mapping, rig presence, animation/morph-target evidence, and WebXR-only screenshots before runtime promotion.
3. Keep current OB actor-specific GLBs as the fallback source variant set.
4. Compare any new provider output against the current OB B+ evidence before replacing the fallback.

## Acceptance criteria for next B+ humanoid-source upgrade
- Three actor-specific GLBs are generated or imported through the factory, not hand-wired scene cosmetics.
- Shoulder/clothing artifacts are reduced without overlay masks.
- Patient, nurse, and partner remain visually distinct by source file, material, body profile, and posture.
- Humanoid realism gate reports and WebXR-only screenshots exist for each promoted source.
- No Quest, production, clinical, or scoring readiness claim is made from this upgrade alone.

## Immediate next slice
Create a provider/import preflight artifact that can evaluate a candidate higher-quality humanoid source directory against the gate above and produce a promotion decision before any runtime replacement.
