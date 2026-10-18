"""Pediatric ocular axial length from the case phenotype age (Rauscher 2021).

tsk_083b92e9c7ca5d7b handback 1: the globe size must be case-driven, never a
copied constant. A second child case with a different phenotype age must get
its own globe, not an 8-year-old's eye.

Source table: Rauscher 2021 (Ophthalmic Physiol Opt, doi
10.1111/opo.12814): axial length age 4 = 22.2 mm .. age 17 = 23.9 mm. The
target INTERPOLATES that table at the case phenotype's own age
(actor-phenotype.v1.json entries.<case>.<actor>.phenotype.age). Ages outside
4..17 refuse (no extrapolation); a case with no age refuses (no fallback to
8 or any default).

bpy-free and stdlib-only so tests import it without Blender; the bake calls
it through _eye_target_for_output_stem, and --verify-eye-stem proves the
refusals without a bake.
"""
import argparse
import json
import sys

RAUSCHER_AGE_MIN = 4
RAUSCHER_LENGTH_MIN_MM = 22.2
RAUSCHER_AGE_MAX = 17
RAUSCHER_LENGTH_MAX_MM = 23.9


class PediatricAxialAgeError(RuntimeError):
    """Named refusal: a pediatric globe needs a case age inside 4..17."""


def axial_length_mm_for_age(age_years):
    """Axial length (mm) for a phenotype age, Rauscher 2021 interpolation."""
    if age_years is None:
        raise PediatricAxialAgeError(
            "pediatric axial length needs a case phenotype age "
            "(entries.<case>.<actor>.phenotype.age); refusing to fall back "
            "to 8 or any default"
        )
    if isinstance(age_years, bool) or not isinstance(age_years, (int, float)):
        raise PediatricAxialAgeError(
            "pediatric axial length needs a numeric case phenotype age, "
            f"got {age_years!r}"
        )
    if not (RAUSCHER_AGE_MIN <= age_years <= RAUSCHER_AGE_MAX):
        raise PediatricAxialAgeError(
            f"phenotype age {age_years} is outside the Rauscher 2021 table "
            f"({RAUSCHER_AGE_MIN}..{RAUSCHER_AGE_MAX} years); refusing to "
            "extrapolate"
        )
    return round(
        RAUSCHER_LENGTH_MIN_MM
        + (age_years - RAUSCHER_AGE_MIN)
        / (RAUSCHER_AGE_MAX - RAUSCHER_AGE_MIN)
        * (RAUSCHER_LENGTH_MAX_MM - RAUSCHER_LENGTH_MIN_MM),
        3,
    )


def axial_length_mm_for_case_actor(case_id, actor_id, entries):
    """Axial length (mm) read off the case phenotype at bake time.

    entries is actor-phenotype.v1.json's "entries" mapping
    (entries.<case>.<actor>.phenotype.age). Unknown case, unknown actor, or
    a missing age all refuse with the named error.
    """
    try:
        entry = entries[case_id][actor_id]
    except (KeyError, TypeError):
        raise PediatricAxialAgeError(
            "no actor-phenotype entry for case "
            f"{case_id!r} actor {actor_id!r}; a pediatric globe needs a "
            "case phenotype age"
        ) from None
    phenotype = (entry or {}).get("phenotype") or {}
    return axial_length_mm_for_age(phenotype.get("age"))


def main(argv):
    parser = argparse.ArgumentParser()
    parser.add_argument("--age", type=float, default=None)
    parser.add_argument("--entries-file", default=None)
    parser.add_argument("--case", default=None)
    parser.add_argument("--actor", default=None)
    args = parser.parse_args(argv)
    if args.entries_file is not None:
        with open(args.entries_file, encoding="utf-8") as handle:
            entries = json.load(handle)
        if isinstance(entries, dict) and "entries" in entries:
            entries = entries["entries"]
        result = {
            "case": args.case,
            "actor": args.actor,
            "axialLengthMm": axial_length_mm_for_case_actor(
                args.case, args.actor, entries),
        }
    else:
        result = {
            "age": args.age,
            "axialLengthMm": axial_length_mm_for_age(args.age),
        }
    print(json.dumps(result, sort_keys=True))


if __name__ == "__main__":
    main(sys.argv[1:])
