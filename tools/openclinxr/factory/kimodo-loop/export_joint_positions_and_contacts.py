#!/usr/bin/env python3
"""Export Kimodo's own per-frame global joint positions and foot-contact labels from a generated
.npz, converted from Kimodo's native Y-up to Blender's Z-up ONCE, explicitly, and verified.

Promoted from the kimodo cagematch's own scratch `export_joint_positions.py`
(docs/openclinxr/kimodo-mlx-bedside-approach-cagematch-2026-09-26.md, round 3 onward) into the
`kimodo-walk-loop-station.py` factory pipeline, unchanged in method. Pure numpy, no Blender.

Index map for SOMA77 (from nv-tlabs/kimodo kimodo/skeleton/definitions.py:SOMASkeleton77,
bone_order_names_with_parents, read directly from source 2026-09-26).
"""
import argparse
import json
import sys

import numpy as np

SOMA77_INDEX = {
    "Hips": 0, "Spine1": 1, "Spine2": 2, "Chest": 3, "Neck1": 4, "Neck2": 5, "Head": 6, "HeadEnd": 7,
    "LeftShoulder": 11, "LeftArm": 12, "LeftForeArm": 13, "LeftHand": 14, "LeftHandMiddle1": 24,
    "RightShoulder": 39, "RightArm": 40, "RightForeArm": 41, "RightHand": 42, "RightHandMiddle1": 52,
    "LeftLeg": 67, "LeftShin": 68, "LeftFoot": 69, "LeftToeBase": 70, "LeftToeEnd": 71,
    "RightLeg": 72, "RightShin": 73, "RightFoot": 74, "RightToeBase": 75, "RightToeEnd": 76,
}
# foot_contacts columns, per nv-tlabs/kimodo's own convention (matches this cagematch's earlier
# measurement): [L_heel, L_toe, L_toeEnd, R_heel, R_toe, R_toeEnd].
CONTACT_L_HEEL, CONTACT_R_HEEL = 0, 3


def yup_to_zup(v: np.ndarray) -> np.ndarray:
    """Kimodo's own output is Y-up (Y=height). Blender is Z-up. Standard glTF/Blender-style
    conversion: blender_x = y_up_x, blender_y = -y_up_z, blender_z = y_up_y."""
    x, y, z = v[..., 0], v[..., 1], v[..., 2]
    return np.stack([x, z * -1.0, y], axis=-1)


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--npz", required=True)
    ap.add_argument("--out-joints", required=True)
    ap.add_argument("--out-contacts", required=True)
    args = ap.parse_args(argv)

    d = np.load(args.npz)
    pj = d["posed_joints"]  # (frames, 77, 3), Y-up
    pj_z = yup_to_zup(pj)

    frame0 = pj_z[0]
    head_z = frame0[SOMA77_INDEX["Head"]][2]
    pelvis_z = frame0[SOMA77_INDEX["Hips"]][2]
    feet_z = [frame0[SOMA77_INDEX[n]][2] for n in ("LeftFoot", "RightFoot", "LeftToeBase", "RightToeBase")]
    reference_z = [frame0[SOMA77_INDEX[n]][2] for n in ("Head", "Hips", "Chest", "LeftHand", "RightHand")]
    head_above_pelvis = head_z > pelvis_z
    feet_are_lowest = max(feet_z) < min(reference_z)

    print(f"VERIFY head_z={head_z:.4f} pelvis_z={pelvis_z:.4f} head_above_pelvis={head_above_pelvis}")
    print(f"VERIFY feet_z={feet_z} reference_z={reference_z} feet_are_lowest={feet_are_lowest}")
    if not head_above_pelvis or not feet_are_lowest:
        print("VERIFY FAILED -- axis conversion is wrong, stopping", file=sys.stderr)
        return 2

    if "foot_contacts" not in d:
        print("VERIFY FAILED -- npz carries no foot_contacts array", file=sys.stderr)
        return 2
    contacts = d["foot_contacts"].astype(int)
    if contacts.shape[0] != pj_z.shape[0]:
        print(
            f"VERIFY FAILED -- foot_contacts frame count {contacts.shape[0]} != joints frame count {pj_z.shape[0]}",
            file=sys.stderr,
        )
        return 2

    out = {name: pj_z[:, idx, :].tolist() for name, idx in SOMA77_INDEX.items()}
    out["_frames"] = pj_z.shape[0]
    with open(args.out_joints, "w") as fh:
        json.dump(out, fh)
    with open(args.out_contacts, "w") as fh:
        json.dump(contacts.tolist(), fh)
    print(f"wrote {args.out_joints} and {args.out_contacts}, frames={pj_z.shape[0]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
