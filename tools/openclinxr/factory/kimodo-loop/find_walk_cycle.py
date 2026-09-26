#!/usr/bin/env python3
"""Find one clean, loopable two-step walk cycle from the STEADY MIDDLE of an exported Kimodo clip,
using its own foot-contact labels -- and slice both the joint-position and contact arrays to it.

Promoted from the kimodo cagematch's own round-10 manual analysis (docs/openclinxr/kimodo-mlx-
bedside-approach-cagematch-2026-09-26.md) into the `kimodo-walk-loop-station.py` factory pipeline.

Method, unchanged from round 10: a full gait period runs from one LEFT-heel-strike (a rising edge
on the L_heel contact column) to the NEXT left-heel-strike -- two steps, matching root phase and
pose at the loop boundary by construction (both endpoints are the same labelled event). Picks the
cycle whose START is closest to the clip's own midpoint, avoiding the first/last few frames' startup
and stop transients. Refuses (nonzero exit) rather than guessing when fewer than 3 rising edges
exist (not enough cycles to pick a STEADY one, only a transient).
"""
import argparse
import json
import sys

CONTACT_L_HEEL = 0


def rising_edges(column: list[int]) -> list[int]:
    return [i for i in range(1, len(column)) if column[i] == 1 and column[i - 1] == 0]


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--joints", required=True)
    ap.add_argument("--contacts", required=True)
    ap.add_argument("--out-joints", required=True)
    ap.add_argument("--out-contacts", required=True)
    ap.add_argument("--out-window", required=True, help="Writes {start,end,frames} as JSON, for provenance.")
    args = ap.parse_args(argv)

    with open(args.contacts) as fh:
        contacts = json.load(fh)
    l_heel = [row[CONTACT_L_HEEL] for row in contacts]
    edges = rising_edges(l_heel)
    if len(edges) < 3:
        print(f"REFUSE not_enough_cycles: found {len(edges)} left-heel-strike(s), need >= 3", file=sys.stderr)
        return 2

    midpoint = len(contacts) / 2.0
    # Pick the cycle (edges[i], edges[i+1]) whose OWN CENTER is closest to the clip's own midpoint
    # -- not the cycle's start, which biases toward earlier (still-settling) cycles for a 3-edge
    # clip (e.g. edges [34, 69, 104] on a 105-frame clip: comparing starts alone picks (69, 104),
    # whose actual span sits in the back third of the clip; comparing centers correctly picks
    # (34, 69), centered at 51.5 against a midpoint of 52.5 -- the round-10 manual choice).
    best_i = min(range(len(edges) - 1), key=lambda i: abs((edges[i] + edges[i + 1]) / 2.0 - midpoint))
    start, end = edges[best_i], edges[best_i + 1]

    with open(args.joints) as fh:
        joints = json.load(fh)
    frame_count = joints.pop("_frames")
    if end > frame_count:
        print(f"REFUSE cycle_exceeds_frame_count: end={end} frame_count={frame_count}", file=sys.stderr)
        return 2

    sliced_joints = {name: arr[start:end] for name, arr in joints.items()}
    sliced_joints["_frames"] = end - start
    with open(args.out_joints, "w") as fh:
        json.dump(sliced_joints, fh)

    sliced_contacts = contacts[start:end]
    with open(args.out_contacts, "w") as fh:
        json.dump(sliced_contacts, fh)

    window = {"start": start, "end": end, "frames": end - start, "allLeftHeelStrikes": edges}
    with open(args.out_window, "w") as fh:
        json.dump(window, fh, indent=2)

    print(f"cycle {start}->{end} ({end - start} frames), all left-heel-strikes: {edges}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
