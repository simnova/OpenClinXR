#!/usr/bin/env python3
"""Blender-free iris palette selector (issue #518).

`eye_iris_colour` is pure string logic with zero bpy references, but it used to live
in `automate_blender.py` — which hard-refuses import outside Blender's embedded Python.
That meant the one function this card is about could not be called by a contract. It
moves here so a contract can import and exercise it; `automate_blender` re-exports it so
the existing materializer import keeps working (D4 — shrink what is under test).

CLAIM: f(role, phenotype) returns a staged CC0 iris asset id; an unbuildable declared
colour raises ValueError instead of silently defaulting; patient/family/nurse (and
clinician) role fallbacks survive.
NOT: whether any iris LOOKS right; not a colour-naming standard beyond the pack.
"""

from __future__ import annotations

from typing import Any, Dict

# CC0 MakeHuman system-asset iris colours (#356) — per-actor iris asset ids from the official
# `makehuman_system_assets` pack (makehumancommunity.org, makehuman_system_assets_cc0.zip).
# Every staged <colour>.mhmat carries the same in-file CC0 header as the hm08 eyes ("This asset
# was explicitly released as CC0 in september 2020", Data Collection AB / Joel Palmius / Jonas
# Hauquier; recorded in third-party-asset-licence-ledger.md). The ids ARE the pack's own
# material stems — nothing invented here. `automate_blender.py` mirrors this tuple as a literal
# because the eye contract's clause (5) NET greps that file; keep the two in sync.
_EYE_IRIS_PACK = (
    "blue", "bluegreen", "brown", "brownlight", "deepblue", "green", "grey", "ice", "lightblue",
)

# #356: break the one-iris-for-everyone monopoly so co-present actors do not share an iris
# texture by construction — the same shape as garment_shell_color (#180). The assignments are a
# staging judgement ("which colours are right" is a phenotype question the eye contract
# deliberately does not test); the patient keeps the byte-identical brown, the family and nurse
# get clearly distinct measured hues (green 49°, blue 66° vs brown 34°).
_EYE_IRIS_BY_ROLE = {
    "patient": "brown",
    "family": "green",
    "nurse": "blue",
}

# A clinician (nurse / physician / RT / MA / staff) takes the clinician fallback, not the patient
# default. #518: "physician" matched none of nurse|clinician|staff, so it fell through to
# patient-brown by substring accident.
_CLINICIAN_ROLE_TOKENS = ("nurse", "clinician", "staff", "physician", "doctor")
_FAMILY_ROLE_TOKENS = ("family", "parent", "spouse", "guardian")


# Neutral-brown diffuse override (tsk_b1604af3eb881268 + st-viteye r2): the
# staged pack brown_eye.png renders red (texel iris-ring mean hue ~11.6 deg).
# st-viteye r1 built the CC0 Vitruvian polar resample (hazel = source as-is,
# brown/green/blue = OKLCH remap; see
# tools/openclinxr/asset-pipeline/eyes/vitruvian/manifest.json) and r2 reshaped
# its limbal transition to the shipped F edge. Every resolved pack id now feeds
# its Vitruvian texture through the SAME TEXTURE_OVERRIDES slot --eye-texture
# uses; an explicit --eye-texture keeps precedence. eye_iris_colour unchanged.
_IRIS_DIFFUSE_OVERRIDE_BY_PACK_ID = {
    "brown": "tools/openclinxr/asset-pipeline/eyes/vitruvian/vitruvian-iris-brown.png",
    "green": "tools/openclinxr/asset-pipeline/eyes/vitruvian/vitruvian-iris-green.png",
    "blue": "tools/openclinxr/asset-pipeline/eyes/vitruvian/vitruvian-iris-blue.png",
    # st-viteye: hazel is not a pack id (eye_iris_colour still refuses it —
    # no staged pack .mhmat), but it IS buildable: the CC0 Vitruvian polar
    # resample. The materializer catches the selector refusal for hazel only
    # and feeds this texture through the same TEXTURE_OVERRIDES slot.
    "hazel": "tools/openclinxr/asset-pipeline/eyes/vitruvian/vitruvian-iris-hazel.png",
}


_VITRUVIAN_IRIS_TEXTURE_BY_COLOUR = {
    "hazel": "tools/openclinxr/asset-pipeline/eyes/vitruvian/vitruvian-iris-hazel.png",
    "brown": "tools/openclinxr/asset-pipeline/eyes/vitruvian/vitruvian-iris-brown.png",
    "green": "tools/openclinxr/asset-pipeline/eyes/vitruvian/vitruvian-iris-green.png",
    "blue": "tools/openclinxr/asset-pipeline/eyes/vitruvian/vitruvian-iris-blue.png",
}


def vitruvian_iris_texture(colour: str) -> str | None:
    """Repo-relative path of the st-viteye CC0 Vitruvian resample for a colour.

    Pure f(colour) -> path or None. Hazel is the source as-is; brown, green
    and blue are the OKLCH remap (see vitruvian/manifest.json for fitted
    geometry, OKLCH parameters and output shas). Returns None for colours
    with no resample. Does NOT change eye_iris_colour return values.
    """
    return _VITRUVIAN_IRIS_TEXTURE_BY_COLOUR.get((colour or "").strip().lower())


def iris_diffuse_override(pack_id: str) -> str | None:
    """Diffuse texture replacing the pack texture for a selected iris id.

    Pure f(pack id) -> repo-relative texture path or None. brown/green/blue
    resolve to the st-viteye CC0 Vitruvian resamples; "hazel" resolves to the
    Vitruvian hazel (not a pack id — the materializer catches the selector
    refusal for hazel only); every other id returns None and the bake keeps
    the pack texture. eye_iris_colour return values are unchanged — this maps
    the SELECTED id, never a role or phenotype.
    """
    return _IRIS_DIFFUSE_OVERRIDE_BY_PACK_ID.get((pack_id or "").strip().lower())


def eye_iris_colour(actor_role: str, phenotype: Dict[str, Any] | None = None) -> str:
    """Declared iris asset id for the actor: f(role, phenotype) — #356, #518.

    The returned id names a <colour>.mhmat staged under
    `.openclinxr-local/provider-cache/eyes/makehuman-system-assets/`; the MPFB materializer
    consumes that declared material via the generic .mhmat path (D1 — no table copied, no
    colour invented). A phenotype that names an eye colour explicitly (the blueprint's snake_case
    `eye_color`, plus the legacy camelCase keys for back-compat) overrides the role fallback;
    a named colour with no staged .mhmat is REFUSED loudly (ValueError) rather than silently
    defaulted. Otherwise the role fallback mirrors garment_shell_color.
    """
    role = (actor_role or "").lower()
    phen = phenotype or {}
    declared = str(
        phen.get("eye_color")
        or phen.get("eyeColour")
        or phen.get("irisColour")
        or phen.get("eye")
        or ""
    ).strip().lower()
    if declared:
        for key in _EYE_IRIS_PACK:
            if key in declared:
                return key
        raise ValueError(
            f"unbuildable iris colour {declared!r}: not in the staged CC0 "
            f"makehuman-system-assets pack ({', '.join(_EYE_IRIS_PACK)})"
        )
    if any(token in role for token in _CLINICIAN_ROLE_TOKENS):
        return _EYE_IRIS_BY_ROLE["nurse"]
    if any(token in role for token in _FAMILY_ROLE_TOKENS):
        return _EYE_IRIS_BY_ROLE["family"]
    return _EYE_IRIS_BY_ROLE["patient"]
