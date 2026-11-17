"""Run-only MPFB delete-group proof; not collected by CI."""
import pathlib
import sys
import types
from unittest.mock import MagicMock

import numpy as np

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
sys.modules.setdefault("bpy", MagicMock())
sys.modules.setdefault("mathutils", MagicMock())
CALLS = []


class Mhclo:
    def load(self, path):
        self.path, self.delete, self.delverts = path, True, [0, 1, 2]


class ClothesService:
    @staticmethod
    def update_delete_group(mhclo, mesh, **kwargs):
        CALLS.append((mhclo.path, mesh, kwargs))


def module(name, **attrs):
    value = types.ModuleType(name)
    value.__dict__.update(attrs)
    sys.modules[name] = value


for name in ("bl_ext", "bl_ext.user_default", "bl_ext.user_default.mpfb",
             "bl_ext.user_default.mpfb.entities", "bl_ext.user_default.mpfb.entities.clothes",
             "bl_ext.user_default.mpfb.services"):
    module(name)
module("bl_ext.user_default.mpfb.entities.clothes.mhclo", Mhclo=Mhclo)
module("bl_ext.user_default.mpfb.services.clothesservice", ClothesService=ClothesService)
import materialize_mpfb_humanoid_candidate as subject


def reset(mode):
    subject._DG.update({"mode": mode, "mesh": object(), "paths": {}, "parsed": {},
                        "verts": {}, "g": {}, "hon": {}})
    CALLS.clear()


def test_stage_and_arithmetic():
    paths = {slot: pathlib.Path(f"/tmp/{slot}.mhclo") for slot in subject._DG_SLOTS}
    old_argv, sys.argv = sys.argv, ["test", "--", "--output", "x.glb", "--upper-mhclo", "/tmp/upper.mhclo"]
    args = subject.parse_args()
    sys.argv = old_argv
    assert args.garment_delete_groups == "off" and args.upper_mhclo == "/tmp/upper.mhclo"
    reset("off")
    subject._garment_delete_group("create", mhclo_paths=paths)
    assert CALLS == []
    reset("union")
    subject._garment_delete_group("create", mhclo_paths=paths)
    assert [call[0] for call in CALLS] == [str(path) for path in paths.values()]
    assert all(call[2]["add_modifier"] is False for call in CALLS)
    faces = np.array([[0, 1, 2], [2, 3, 4], [5, 6, 7]])
    hoff = np.array([False, True, False])
    masks = []
    for slot in subject._DG_SLOTS:
        subject._DG["verts"][slot] = [0, 1, 2]
        hon, _, measured = subject._garment_delete_group("finalize", slot=slot, faces=faces, hoff=hoff)
        assert hon.tolist() == [True, True, False] and measured.tolist() == hoff.tolist()
        masks.append(hon)
    assert subject._garment_delete_group("union", hoff={slot: hoff for slot in subject._DG_SLOTS}, masks=masks).tolist() == [True, True, False]
    try:
        None in (hoff, hoff, hoff)  # the old aggregate expression must raise on NumPy arrays
    except ValueError:
        print("OLD_NONE_IN_NUMPY RED ValueError")
    else:
        raise AssertionError("old None-in-NumPy expression unexpectedly passed")
    subject._DG["mode"] = "replace"
    hon, _, measured = subject._garment_delete_group("finalize", slot="upper", faces=faces, hoff=hoff)
    assert hon.tolist() == [True, False, False] and measured.tolist() == hoff.tolist()
    subject._DG["verts"]["upper"] = []
    assert not subject._skip_slot_mask("upper")


if __name__ == "__main__":
    test_stage_and_arithmetic()
    print("ALL TESTS PASSED")
