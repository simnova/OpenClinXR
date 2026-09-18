"""Licence precedence for the MakeHuman bake gates (OPERATOR RULING 2026-09-17,
REFINED by the operator the same day).

Mirrors tools/openclinxr/asset-pipeline/makeclothes/licence-precedence.ts: the
MORE PERMISSIVE of the catalogue listing and the asset's own file line governs
(ranks in licence_permissiveness_rank). New operator line (verbatim): "Review the
assets with their listing page - is the listing page more permissive? If so record that
as the license instead of the license embedded into the asset as many just leave the
default license." Earlier the same day: "go with what site links say (CC0 over AGPLv3)".
Stdlib only.
"""

import json
import pathlib
import re

REPO_ROOT = pathlib.Path(__file__).resolve().parents[4]
CATALOGUE_SNAPSHOT_PATH = (
    REPO_ROOT / "tools/openclinxr/asset-pipeline/makeclothes/makehuman-catalogue-snapshot.json"
)

_CATALOGUE_PACKS = None


def load_catalogue_packs(path=None):
    """Load the committed catalogue snapshot packs (cached; no network)."""
    global _CATALOGUE_PACKS
    if path is None and _CATALOGUE_PACKS is not None:
        return _CATALOGUE_PACKS
    snap_path = pathlib.Path(path) if path is not None else CATALOGUE_SNAPSHOT_PATH
    try:
        packs = json.loads(snap_path.read_text(encoding="utf-8")).get("packs", {})
    except OSError:
        packs = {}
    if path is None:
        _CATALOGUE_PACKS = packs
    return packs


def normalise_licence_token(token):
    """Normalise for conflict comparison so CC0/CC-0 spellings compare equal."""
    return re.sub(r"[\s_-]+", "", str(token).strip().lower())


def licence_permissiveness_rank(token):
    """Permissiveness rank for the more-permissive-wins comparison (redistribution
    freedom: CC0 imposes no conditions; CC-BY imposes attribution only; copyleft
    imposes source obligations; an unrecognised token imposes unknown obligations).
    CC0 / public domain 3, CC-BY family 2, AGPL/GPL copyleft 1, unrecognised 0.
    Silence has no rank — the callers treat it as "not a candidate", never a winner.
    """
    t = str(token).strip()
    if re.search(r"cc\s*[-_ ]?0\b", t, re.I) or re.search(r"public\s+domain", t, re.I):
        return 3
    if re.search(r"cc[\s_-]*by", t, re.I):
        return 2
    if re.search(r"agpl|gpl|copyleft", t, re.I):
        return 1
    return 0


def catalogue_verdict(pack_slug, packs=None):
    """Catalogue state for a pack slug: listed, conflict, or silent.

    Returns (status, entry) where status is one of "listed", "conflict",
    "silent". Conflict means more than one distinct licence value across the
    entry's `licence` + `licences` fields (normalised for spelling).
    """
    table = packs if packs is not None else load_catalogue_packs()
    entry = table.get(pack_slug) if pack_slug else None
    if not entry:
        return "silent", None
    candidates = [entry.get("licence")] + list(entry.get("licences") or [])
    distinct = {normalise_licence_token(c) for c in candidates if c}
    if len(distinct) > 1:
        return "conflict", entry
    return "listed", entry


def resolve_licence_precedence(pack_slug, file_declared, file_permitted, packs=None,
                               file_attribution_required=False, file_refusal_reason=None):
    """One precedence decision for every bake gate.

    pack_slug: catalogue pack (e.g. "hair01"), or None when unlisted.
    file_declared: raw licence line from the asset's own file, or None when silent.
    file_permitted: the file side's own verdict (True only if the header clears alone).
    Listed catalogue + declared file -> the MORE PERMISSIVE side governs
    (catalogue rank > file rank -> catalogue, with the file's declared line recorded
    as overridden; catalogue rank <= file rank -> the file's own verdict decides,
    via "file"). A silent file is never a "declared" side, so a listed catalogue
    always governs it.
    Returns a dict with permitted, via, licence, refusal_reason,
    overridden_file_licence.
    """
    table = packs if packs is not None else load_catalogue_packs()
    status, entry = catalogue_verdict(pack_slug, table)
    if status == "conflict":
        assert entry is not None  # conflict implies an entry; narrows the Optional for checkers
        candidates = [entry.get("licence")] + list(entry.get("licences") or [])
        names = sorted({str(c).strip() for c in candidates if str(c).strip()})
        return {
            "permitted": False,
            "via": "none",
            "licence": None,
            "refusal_reason": (
                "catalogue lists conflicting licences for pack "
                f"{pack_slug or '(none)'}: {' vs '.join(names)}"
                " — refused without consulting the file"
            ),
            "overridden_file_licence": None,
            "attribution_required": False,
        }
    if status == "listed":
        assert entry is not None  # listed implies an entry; narrows the Optional for checkers
        catalogue_licence = entry.get("licence")
        catalogue_is_by = bool(re.search(r"cc[\s_-]*by", str(catalogue_licence or ""), re.I))
        catalogue_rank = licence_permissiveness_rank(catalogue_licence)
        file_rank = licence_permissiveness_rank(file_declared) if file_declared else None
        if file_rank is None or catalogue_rank > file_rank:
            # A catalogue listing is a grant we may rely on only when the grant
            # itself clears the CC0/CC-BY bar (rank >= 2); otherwise refuse
            # without consulting the file (it already lost the comparison).
            if catalogue_rank < 2:
                return {
                    "permitted": False,
                    "via": "none",
                    "licence": None,
                    "refusal_reason": (
                        f"catalogue licence for pack {pack_slug or '(none)'} "
                        f"is not CC0/CC-BY: {catalogue_licence} — refused"
                    ),
                    "overridden_file_licence": None,
                    "attribution_required": False,
                }
            return {
                "permitted": True,
                "via": "catalogue",
                "licence": catalogue_licence,
                "refusal_reason": None,
                "overridden_file_licence": file_declared,
                "attribution_required": catalogue_is_by or bool(file_attribution_required),
            }
        # Tie below the CC0/CC-BY bar (e.g. garbled catalogue + garbled file):
        # neither side is a grant we may rely on — refuse without letting the
        # file decide. A file that clears the bar on its own still governs.
        if catalogue_rank == file_rank and catalogue_rank < 2:
            return {
                "permitted": False,
                "via": "none",
                "licence": None,
                "refusal_reason": (
                    f"catalogue licence for pack {pack_slug or '(none)'} "
                    f"is not CC0/CC-BY: {catalogue_licence} — refused"
                ),
                "overridden_file_licence": None,
                "attribution_required": False,
            }
        return {
            "permitted": bool(file_permitted),
            "via": "file",
            "licence": file_declared,
            "refusal_reason": file_refusal_reason,
            "overridden_file_licence": None,
            "attribution_required": bool(file_attribution_required),
        }
    if file_declared:
        return {
            "permitted": bool(file_permitted),
            "via": "file",
            "licence": file_declared,
            "refusal_reason": file_refusal_reason,
            "overridden_file_licence": None,
            "attribution_required": bool(file_attribution_required),
        }
    return {
        "permitted": False,
        "via": "none",
        "licence": None,
        "refusal_reason": (
            file_refusal_reason
            or "no licence in the file and no catalogue listing — unspecified is a refusal"
        ),
        "overridden_file_licence": None,
        "attribution_required": False,
    }
