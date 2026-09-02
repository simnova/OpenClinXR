from __future__ import annotations

# ── #329 case-authored phenotype → MPFB macro dict ─────────────────────────────
# The case definition authors a CLINICAL phenotype (height_cm, age in YEARS, bmi,
# build, gender_presentation, ...). The MPFB body generator consumes MACRO floats
# (0..1). Nothing translated between them, so an authored height never reached a
# vertex and an unauthored body class was the median human at 0.5.
#
# #328 closed the height half of this gap on the materializer rail by solving the
# height macro against MPFB's OWN exported body (bake-measure-interpolate; a closed
# form is refused because stature is a function of height AND age AND gender — the
# Anny header measures `(height_cm-85)/115` wrong by up to 47 cm). This issue joins
# the CHAIN: the macro dict below is derived from the case's authored phenotype, and
# the height macro is solved against the model via the SAME probe machinery #328
# proved (one copy lives in materialize_mpfb_humanoid_candidate.py; imported lazily
# so there is no second solver — D1).
#
# The non-height translations are DETERMINISTIC case→macro maps anchored to MPFB's
# macro.json band semantics (data/targets/macrodetails/macro.json), not clinical
# claims: gender 0=female..1=male, age 0..0.1875=baby..child, 0.1875..0.5=child..
# young, 0.5..1=young..old, weight 0=min..1=max, muscle 0=min..1=max. A body that
# looks like the person the case describes is NOT claimed (the planted contract's
# NOT TESTED); the claim is that the case's authored values reach the generator and
# the height is honoured against the model's own measurement.

_AUTHORED_MACRO_KEYS = (
    "gender",
    "age",
    "muscle",
    "weight",
    "proportions",
    "height",
    "cupsize",
    "firmness",
)


def _clamp01(value: float) -> float:
    return min(max(float(value), 0.0), 1.0)


# #670 — MPFB2 is a build-time tool (outputs ours, ledger row 100) and its bundled
# data/targets are CC0 1.0 (ledger row 101, verified 2026-08-12 #343). The macro
# values these cells publish are produced by this stage's own translators.
BODY_CELL_LICENCE = "MPFB2 build-time tool (row 100); MPFB2 data/targets CC0 1.0 (row 101)"


def _gender_presentation_to_macro(gender_presentation: object) -> float | None:
    """Parse a case-authored gender_presentation string into the MPFB gender macro
    (0.0 female .. 1.0 male). None when the presentation carries no sex signal."""
    text = str(gender_presentation).strip().lower()
    if not text or text == "none":
        return None
    # "female" CONTAINS the substring "male" — check female FIRST (word-boundary
    # order), or every female presentation reads as ambiguous.
    if "female" in text:
        return 0.0
    if "male" in text:
        return 1.0
    return None  # e.g. "child" — no sex signal; caller keeps the neutral default


def _years_to_age_macro(years: object) -> float:
    """Deterministic years→age-macro map anchored to macro.json's band boundaries.

    macro.json: age 0..0.1875 = baby..child, 0.1875..0.5 = child..young, 0.5..1.0 =
    young..old. The map is monotonic and passes through those anchors; it is a
    TRANSLATION of the authored years, not a claim that MPFB's age target is a
    validated clinical age model.
    """
    y = float(years)
    if y <= 1.0:
        return 0.02  # infant edge of the child band
    if y <= 12.0:
        return 0.05 + (y - 1.0) / 11.0 * (0.1875 - 0.05)  # baby..child → child band
    if y <= 18.0:
        return 0.1875 + (y - 12.0) / 6.0 * (0.5 - 0.1875)  # child → young
    if y <= 65.0:
        return 0.5 + (y - 18.0) / 47.0 * (0.85 - 0.5)  # young → middle-aged
    return _clamp01(0.85 + (y - 65.0) / 25.0 * 0.15)  # middle-aged → old


# #670 — THE body cells this stage can bake: the cartesian product of the age bands
# _years_to_age_macro actually implements (its five predicates + its own 90-year
# ceiling) with the three sex outcomes of _gender_presentation_to_macro. This is the
# single literal for the capability catalog — generate_body_cell_capability_manifest.py
# derives packages/openclinxr/asset-registry/src/body-cell-capability-manifest.json from
# THIS pack by calling these two translators (never a second table), so a change here IS
# the published capability. Stature is deliberately NOT an axis: height stays the #328
# solve-against-authored-height_cm path, which snapping to band ticks would fight.
# Empty cells stay in the pack: the factory can bake them whether or not the scenario
# bank currently occupies them (the bank occupies 4 of the 15).
BODY_CELL_PACK = [
    {
        "id": f"{age_band}_{sex}",
        "ageBand": age_band,
        "sex": sex,
        "yearsLo": years_lo,
        "yearsHi": years_hi,
        # Computed BY CALLING _years_to_age_macro at the band midpoint — the same
        # §9h discipline as the iris manifest's probe. Never retype the number.
        "ageMacro": round(_years_to_age_macro((years_lo + years_hi) / 2.0), 4),
        "genderMacro": _gender_presentation_to_macro(sex),
        "licence": BODY_CELL_LICENCE,
    }
    for age_band, years_lo, years_hi in (
        ("infant", 0.0, 1.0),
        ("child", 1.0, 12.0),
        ("young", 12.0, 18.0),
        ("adult", 18.0, 65.0),
        ("older", 65.0, 90.0),
    )
    for sex in ("female", "male", "unspecified")
]


def _bmi_to_weight_macro(bmi: object) -> float:
    """Deterministic bmi→weight-macro map (0=minweight .. 1=maxweight in macro.json).

    Anchored at bmi 25 (WHO normal/overweight boundary) ≈ the averageweight midpoint
    (0.5); linear to 0.05 at bmi 14 and 1.0 at bmi 35. A translation, not a clinical
    body-composition claim.
    """
    b = float(bmi)
    return _clamp01(0.05 + (b - 14.0) / 21.0 * 0.95)


def _build_to_muscle_macro(build: object) -> float:
    """Deterministic build-descriptor→muscle-macro map (0=minmuscle .. 1=maxmuscle).

    Authoring a `muscle` float takes precedence over the descriptor (checked by the
    caller). Unknown descriptors keep the neutral 0.5 (average) default.
    """
    text = str(build).strip().lower()
    if any(k in text for k in ("slender", "lean", "thin", "slim", "asthma", "frail")):
        return 0.3
    if any(k in text for k in ("athletic", "muscular", "fit", "toned")):
        return 0.7
    if any(k in text for k in ("heavy", "obese", "large", "stout", "stocky")):
        return 0.45
    return 0.5  # average / standard / unknown


def derive_macro_dict_from_authored_phenotype(
    authored: dict,
    *,
    base_macro: dict | None = None,
) -> tuple[dict, dict]:
    """#329 — translate a CASE-authored clinical phenotype into the MPFB macro dict.

    Every key `apply_macros`/`HumanService.create_human` consumes is produced here
    from an authored clinical key or a documented neutral default; the returned
    (macro, derivation) pair records WHICH authored key drove WHICH macro so the
    report can show that `bmi`/`build`/`gender_presentation` reached the generator
    instead of dying at the materializer.

    `height` is deliberately left at the base/default value — the caller solves it
    against the model's own body via solve_height_macro_from_stature (a closed-form
    height map is the refused treatment, see the module header).
    """
    if base_macro is None:
        base_macro = {}
    macro = {
        "gender": 0.5,
        "age": 0.5,
        "muscle": 0.5,
        "weight": 0.5,
        "proportions": 0.5,
        "height": 0.5,
        "cupsize": 0.5,
        "firmness": 0.5,
        "race": {"asian": 0.33, "caucasian": 0.33, "african": 0.33},
    }
    if base_macro:
        for k in _AUTHORED_MACRO_KEYS:
            if k in base_macro:
                macro[k] = float(base_macro[k])
        if isinstance(base_macro.get("race"), dict):
            macro["race"].update({k: float(v) for k, v in base_macro["race"].items()})

    derivation: dict[str, str] = {}

    # gender ← gender_presentation string (0=female .. 1=male); authored float wins.
    if isinstance(authored.get("gender"), (int, float)):
        macro["gender"] = _clamp01(authored["gender"])
        derivation["gender"] = "authored gender float"
    else:
        gp = _gender_presentation_to_macro(authored.get("gender_presentation"))
        if gp is not None:
            macro["gender"] = gp
            derivation["gender"] = "gender_presentation"
        else:
            derivation["gender"] = "default 0.5 (no sex signal in gender_presentation)"

    # age ← authored age in YEARS (the case's `age: 8` is years, not the MPFB macro).
    if isinstance(authored.get("age"), (int, float)):
        macro["age"] = round(_years_to_age_macro(authored["age"]), 4)
        derivation["age"] = "age (years) -> macro.json bands"
    else:
        derivation["age"] = "default 0.5 (no authored age)"

    # weight ← authored bmi (monotonic map); authored weight float wins.
    if isinstance(authored.get("weight"), (int, float)):
        macro["weight"] = _clamp01(authored["weight"])
        derivation["weight"] = "authored weight float"
    elif isinstance(authored.get("bmi"), (int, float)):
        macro["weight"] = round(_bmi_to_weight_macro(authored["bmi"]), 4)
        derivation["weight"] = "bmi -> weight macro"
    else:
        derivation["weight"] = "default 0.5 (no authored bmi/weight)"

    # muscle ← authored build descriptor (or authored muscle float).
    if isinstance(authored.get("muscle"), (int, float)):
        macro["muscle"] = _clamp01(authored["muscle"])
        derivation["muscle"] = "authored muscle float"
    elif authored.get("build"):
        macro["muscle"] = _build_to_muscle_macro(authored["build"])
        derivation["muscle"] = "build -> muscle macro"
    else:
        derivation["muscle"] = "default 0.5 (no authored build/muscle)"

    for key in ("proportions", "cupsize", "firmness"):
        if isinstance(authored.get(key), (int, float)):
            macro[key] = _clamp01(authored[key])
            derivation[key] = f"authored {key}"
        else:
            derivation[key] = f"default 0.5 (no authored {key})"

    # height is solved by the caller (never mapped here).
    derivation["height"] = "SOLVED against the model (bake-measure-interpolate, #328 machinery)"
    return macro, derivation
