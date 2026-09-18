"""Unit tests for licence_precedence.py (stdlib only, no bpy).

Runnable as: python3 tools/openclinxr/asset-pipeline/makeclothes/licence_precedence_test.py
Uses an injected packs dict; plus one case that writes a temp .mhclo under a
temp dir named makehuman-skins01/ and calls the real committed snapshot through
resolve_licence_precedence with slug skins01.
"""

import json
import pathlib
import re
import sys
import tempfile
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from licence_precedence import (  # noqa: E402
    catalogue_verdict,
    licence_permissiveness_rank,
    load_catalogue_packs,
    normalise_licence_token,
    resolve_licence_precedence,
)

REPO_ROOT = pathlib.Path(__file__).resolve().parents[4]


def entry(licence, licences=None):
    return {
        "licence": licence,
        "licences": licences or [],
        "packPageUrl": "https://static.makehumancommunity.org/assets/assetpacks/x.html",
        "sourceUrl": "https://static.makehumancommunity.org/assets/assetpacks/index.html",
        "label": "test",
        "fetchedAt": "2026-09-17",
    }


class CatalogueOverFile(unittest.TestCase):
    def test_skins01_agpl_file_governed_by_catalogue(self):
        packs = {"skins01": entry("CC0")}
        v = resolve_licence_precedence(
            "skins01", "This file is licensed AGPLv3", False, packs=packs
        )
        self.assertTrue(v["permitted"])
        self.assertEqual(v["via"], "catalogue")
        self.assertEqual(v["licence"], "CC0")
        self.assertEqual(v["overridden_file_licence"], "This file is licensed AGPLv3")
        self.assertIsNone(v["refusal_reason"])

    def test_catalogue_cc0_over_file_cc_by_keeps_attribution(self):
        # Attribution is TS-side (attributionRequired); the Python dict keeps the
        # same keys as the TS result minus that flag. The file's CC-BY line is
        # recorded as overridden, not dropped.
        packs = {"hair01": entry("CC0")}
        v = resolve_licence_precedence("hair01", "CC BY 4.0", True, packs=packs)
        self.assertTrue(v["permitted"])
        self.assertEqual(v["via"], "catalogue")
        self.assertEqual(v["overridden_file_licence"], "CC BY 4.0")

    def test_catalogue_branch_carries_attribution_required(self):
        packs = {"hair01": entry("CC0")}
        v = resolve_licence_precedence(
            "hair01", "CC BY 4.0", True, packs=packs,
            file_attribution_required=True,
        )
        self.assertTrue(v["permitted"])
        self.assertEqual(v["via"], "catalogue")
        self.assertTrue(v["attribution_required"])

    def test_silent_file_unlisted_pack_refused(self):
        v = resolve_licence_precedence(
            "no_such_pack_xyz", None, False,
            packs={}, file_refusal_reason="no licence line — unspecified is a refusal",
        )
        self.assertFalse(v["permitted"])
        self.assertEqual(v["via"], "none")

    def test_unlisted_pack_explicit_agpl_refused_via_file(self):
        v = resolve_licence_precedence(
            "no_such_pack_xyz", "AGPL3", False, packs={},
            file_refusal_reason="AGPL3 (copyleft) — refused: AGPL3",
        )
        self.assertFalse(v["permitted"])
        self.assertEqual(v["via"], "file")
        self.assertIn("AGPL", v["refusal_reason"] or "")

    def test_conflict_refused_naming_both_values_agpl_file(self):
        packs = {"skins01": entry("CC0", ["CC0", "AGPL3"])}
        v = resolve_licence_precedence("skins01", "AGPL3", False, packs=packs)
        self.assertFalse(v["permitted"])
        self.assertEqual(v["via"], "none")
        self.assertIn("CC0", v["refusal_reason"] or "")
        self.assertIn("AGPL3", v["refusal_reason"] or "")

    def test_conflict_refused_file_must_not_rescue(self):
        packs = {"skins01": entry("CC0", ["CC0", "AGPL3"])}
        v = resolve_licence_precedence("skins01", "CC0", True, packs=packs)
        self.assertFalse(v["permitted"])
        self.assertEqual(v["via"], "none")

    def test_cc0_cc_dash_0_spelling_not_a_conflict(self):
        packs = {"shoes01": entry("CC0", ["CC-0"])}
        status, _ = catalogue_verdict("shoes01", packs)
        self.assertEqual(status, "listed")
        v = resolve_licence_precedence("shoes01", None, False, packs=packs)
        self.assertTrue(v["permitted"])
        self.assertEqual(v["via"], "catalogue")

    def test_normalise_spellings(self):
        self.assertEqual(normalise_licence_token("CC-0"), normalise_licence_token("CC0"))
        self.assertNotEqual(normalise_licence_token("CC0"), normalise_licence_token("CC-BY"))

    def test_ranks(self):
        self.assertEqual(licence_permissiveness_rank("CC0"), 3)
        self.assertEqual(licence_permissiveness_rank("CC-0"), 3)
        self.assertEqual(licence_permissiveness_rank("public domain"), 3)
        self.assertEqual(licence_permissiveness_rank("CC BY 4.0"), 2)
        self.assertEqual(licence_permissiveness_rank("CC-BY"), 2)
        self.assertEqual(licence_permissiveness_rank("AGPLv3"), 1)
        self.assertEqual(licence_permissiveness_rank("AGPL3"), 1)
        self.assertEqual(licence_permissiveness_rank("Fancy Custom Licence 9 (all rights reserved)"), 0)

    def test_stricter_catalogue_loses_listed_by_over_file_cc0(self):
        # Rank 2 (catalogue CC-BY) <= rank 3 (file CC0): the file governs, no override.
        packs = {"testpack01": entry("CC-BY")}
        v = resolve_licence_precedence("testpack01", "CC0", True, packs=packs)
        self.assertTrue(v["permitted"])
        self.assertEqual(v["via"], "file")
        self.assertEqual(v["licence"], "CC0")
        self.assertIsNone(v["overridden_file_licence"])
        self.assertFalse(v["attribution_required"])

    def test_garbled_file_token_never_beats_listed_catalogue(self):
        packs = {"testpack01": entry("CC0")}
        v = resolve_licence_precedence(
            "testpack01", "Fancy Custom Licence 9 (all rights reserved)", False, packs=packs
        )
        self.assertTrue(v["permitted"])
        self.assertEqual(v["via"], "catalogue")
        self.assertEqual(v["licence"], "CC0")
        self.assertEqual(
            v["overridden_file_licence"], "Fancy Custom Licence 9 (all rights reserved)"
        )

    def test_garbled_catalogue_value_never_beats_cc0_file(self):
        packs = {"testpack01": entry("Fancy Custom Licence 9 (all rights reserved)")}
        v = resolve_licence_precedence("testpack01", "CC0", True, packs=packs)
        self.assertTrue(v["permitted"])
        self.assertEqual(v["via"], "file")
        self.assertEqual(v["licence"], "CC0")
        self.assertIsNone(v["overridden_file_licence"])

    def test_equal_ranks_keep_the_file(self):
        packs = {"testpack01": entry("CC0")}
        v = resolve_licence_precedence("testpack01", "CC-0", True, packs=packs)
        self.assertTrue(v["permitted"])
        self.assertEqual(v["via"], "file")
        self.assertEqual(v["licence"], "CC-0")
        self.assertIsNone(v["overridden_file_licence"])

    def test_copyleft_catalogue_never_governs_silent_file_refused(self):
        packs = {"testpack01": entry("AGPL3")}
        v = resolve_licence_precedence("testpack01", None, False, packs=packs)
        self.assertFalse(v["permitted"])
        self.assertEqual(v["via"], "none")
        self.assertIsNone(v["licence"])
        self.assertIn("AGPL3", v["refusal_reason"] or "")
        self.assertIn("testpack01", v["refusal_reason"] or "")

    def test_garbled_catalogue_never_governs_garbled_file_refused(self):
        packs = {"testpack01": entry("Fancy Custom Licence 9")}
        v = resolve_licence_precedence(
            "testpack01", "Fancy Custom Licence 9 (all rights reserved)", False, packs=packs
        )
        self.assertFalse(v["permitted"])
        self.assertEqual(v["via"], "none")

    def test_counterweight_listed_ccby_silent_file_permitted_with_attribution(self):
        packs = {"testpack01": entry("CC-BY")}
        v = resolve_licence_precedence("testpack01", None, False, packs=packs)
        self.assertTrue(v["permitted"])
        self.assertEqual(v["via"], "catalogue")
        self.assertTrue(v["attribution_required"])

    def test_real_snapshot_skins01_temp_mhclo(self):
        packs = load_catalogue_packs()
        self.assertIn("skins01", packs)
        with tempfile.TemporaryDirectory(prefix="openclinxr-lic-") as tmp:
            pack_dir = pathlib.Path(tmp) / "makehuman-skins01"
            pack_dir.mkdir()
            mhclo = pack_dir / "skin.mhclo"
            mhclo.write_text(
                "# Exported from MakeClothes (TM)\n"
                "# This file is licensed AGPLv3\n"
                "basemesh hm08\n",
                encoding="utf-8",
            )
            m = re.search(r"makehuman-([a-z0-9]+)", str(mhclo), re.I)
            slug = m.group(1).lower() if m else None
            self.assertEqual(slug, "skins01")
            v = resolve_licence_precedence(
                slug, "This file is licensed AGPLv3", False, packs=packs
            )
            self.assertTrue(v["permitted"])
            self.assertEqual(v["via"], "catalogue")
            self.assertEqual(v["overridden_file_licence"], "This file is licensed AGPLv3")

    def test_snapshot_shape(self):
        raw = json.loads(
            (REPO_ROOT / "tools/openclinxr/asset-pipeline/makeclothes/makehuman-catalogue-snapshot.json")
            .read_text(encoding="utf-8")
        )
        for slug in ("skins01", "skins02", "hair01", "pants01", "shirts01", "shoes01"):
            self.assertEqual(raw["packs"][slug]["licence"], "CC0")


if __name__ == "__main__":
    unittest.main(verbosity=2)
