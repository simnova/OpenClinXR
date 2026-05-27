# Humanoid Toolchain Bakeoff - 2026-05-27

## Scope
This bakeoff compares the current Anny-derived humanoid runtime fallback against local and approval-gated alternatives. It is structural/provider-probe evidence only; it is not AAA realism, Quest readiness, production readiness, clinical validity, or scoring validity evidence.

Generated report: `docs/openclinxr/humanoid-toolchain-bakeoff-2026-05-27.json`.
MPFB local gate report: `docs/openclinxr/humanoid-realism-gate-mpfb-ob-patient-2026-05-27.json`.
Local generated comparator: `.openclinxr-local/provider-cache/mpfb/generated/mpfb-ob-patient-aisha-rigged-candidate.glb`.

## Candidates tried or probed

| Candidate | Result | Promotion posture |
| --- | --- | --- |
| Anny neutral runtime seed | Existing local GLB inspected structurally. Remains the repeatable seed. | Keep as seed/fallback, not final realism source. |
| OB patient/nurse/partner Anny source variants | Existing actor-specific GLBs inspected structurally. They remain the best currently routed runtime fallback because they are already attached to the encounter factory. | Keep as runtime fallback until a visual comparator beats them. |
| Anny body-profile matrix variants | Existing adult, bariatric, older-adult, and pediatric GLBs inspected structurally. Useful for age/body diversity, but previous visual evidence showed direct OB routing can reduce realism. | Candidate library only until encounter-specific screenshot proof improves. |
| Blender normals post-pass | Local Blender detected. Accepted as a safe post-pass. | Use as auxiliary cleanup, not a source replacement. |
| MPFB / MakeHuman | Official MPFB 2.0.15 extension staged from Blender Extensions and installed/probed locally. A patient comparator GLB was generated with a standard rig, morph target primitive, and clinical idle/expression animation clips. | Structurally passes local gate as a comparator. Do not promote until WebXR-only screenshot comparison proves visual improvement. |
| MB-Lab | Not installed locally in the detected Blender add-on paths. It is a Blender 4+ character creation add-on, but license/export/runtime evidence is not yet present in this repo. | Promising but evidence-thin; do not promote until local generation/export proof exists. |
| Hunyuan3D | Approval/model-cache gated. Best aimed at equipment/props first; humanoid promotion requires rig/topology/morph/animation/license proof. | Do not promote directly as humanoid runtime source. |
| Meshy/Tripo-style cloud providers | Approval-gated. | Do not execute or promote without explicit approval, credentials, budget, license review, hashes, and WebXR screenshot evidence. |

## Current conclusion
Anny is not enough by itself, but it should remain in the factory as the deterministic fallback seed. MPFB is now the strongest local challenger because it can generate a rigged humanoid candidate with shape-key/morph evidence and animation clips. The next product slice is visual: route the MPFB candidate behind a non-promoted comparison flag and capture WebXR-only screenshots against the current OB Anny fallback.

## External source posture
- MPFB is listed as a Blender extension and points to the MakeHuman Community MPFB project.
- MakeHuman/MPFB license guidance emphasizes low restrictions for generated graphics, but repo-specific provenance must still be recorded before runtime promotion.
- MB-Lab is a Blender 4+ character creation add-on; runtime export and license posture must be verified locally.
- Hunyuan3D is promising for generated 3D assets, but humanoid runtime promotion requires a separate rig/topology/morph/animation gate.

## Next local experiment
1. Add a non-promoted runtime comparison route for the MPFB OB patient candidate.
2. Capture WebXR-only screenshots for current OB Anny fallback and MPFB candidate under equivalent camera/framing.
3. Score the visual comparison for shoulder/clothing fit, face fidelity, body proportions, posture, morph/expression visibility, role match, and artifact absence.
4. Promote only if MPFB beats the fallback without introducing new runtime artifacts.

## MB-Lab local probe result
- Downloaded/staged MB-Lab `master` zip in `.openclinxr-local/provider-cache/mblab/`; sha256 `868b283a33c91f108793e5f3766b0f5d8f5102b5353c28eadae70701c7139a6a`.
- Blender 5.1.1 import and registration probe passed; MB-Lab exposed `mbast` operators including character generation and face-rig operators.
- License review blocks runtime asset generation/promotion: the MB-Lab license file states the code is GPL-3 and the database/generated models are AGPL-3 derived outputs.
- Decision: keep MB-Lab as research-only visual/reference evidence; do not generate or promote runtime GLBs from MB-Lab under the current open-source policy.

## CharMorph Antonia local probe result
- Staged CharMorph v0.4.0-3 release zip in `.openclinxr-local/provider-cache/charmorph/`; sha256 `870698ff3026f411b3cf9bd42d9f32108eefd7e1d643083b165d8e4331ebcc04`.
- Staged Antonia v1.2 character pack; sha256 `a489c63d3cb8ea4e819b0ceab0d9af21d81a5ea76c362ad9cf1cd4ade7d0533e`.
- CharMorph import/register passed, Antonia import passed, and a simplified local GLB comparator was generated at `.openclinxr-local/provider-cache/charmorph/generated/charmorph-antonia-ob-patient-candidate.glb`; sha256 `fd3ec8730477801ea2964de37ef9b0100f9b2af7149a60c21575bbaf6885b2d2`.
- Structural result: better mesh/morph potential than MPFB in some dimensions, but not promotable because Rigify is missing and no animation/clinical idle clips exported.
- Decision: keep CharMorph Antonia as the next permissive-source candidate, but solve Rigify/animation export before any runtime route or screenshot promotion.
