# Humanoid Source Quality Gate - 2026-05-27

## Purpose
Prevent the OB portal-entry B+ composition pass from being mistaken for a humanoid realism pass.

## Current evidence boundary
- Passing: OB WebXR composition proof frame with reduced clutter and scenario-specific set dressing.
- Not passing yet: humanoid source realism, shoulder/clothing quality, differentiated body profile, natural pose variation, facial expression fidelity, lip-sync, gaze, locomotion, and interaction collision quality.

## Required next evidence before grading humanoids B+
1. Use a generated or imported rigged humanoid source whose shoulders/clothing do not require overlay masks.
2. Show at least three actor roles with visibly different body profiles, posture, clothing, and face/hair treatment.
3. Capture WebXR-only screenshots for patient, clinical team member, and family/partner actor.
4. Verify no role-continuity overlay geometry is visible in default runtime evidence.
5. Record source provenance, license posture, generated asset hash, and reuse key in the shared asset-library path.

## Rejection rules
- Do not count composition improvements as humanoid realism improvements.
- Do not use flat panels, shoulder pads, or floating cue geometry to hide rig defects in default runtime evidence.
- Do not claim Quest, production, clinical, or scoring readiness from this gate.

## Recommended next implementation slice
Add/route a higher-quality rigged humanoid source through the encounter asset factory, then compare WebXR screenshots against the current OB frame before expanding to additional encounters.
