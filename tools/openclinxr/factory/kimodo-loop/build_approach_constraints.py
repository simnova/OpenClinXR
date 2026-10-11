#!/usr/bin/env python3
"""Build a stand -> walk-the-polyline -> stop -> turn-in-place -> hold `Root2DConstraintSet`
JSON for `kimodo_gen --constraints`, for the whole-approach take lane.

Same JSON shape as build_stop_constraints.py (read from `nv-tlabs/kimodo`'s source, not
guessed): `frame_indices` dense (every frame), `smooth_root_2d` as an (x, z) path,
`global_root_heading` [cos(h), sin(h)] per frame. Kimodo heading h faces (sin h, cos h) in
(x, z) -- the same yaw-from-+Z convention as three.js rotation.y (verified against
kimodo/motion_rep/feature_utils.py:compute_heading_angle, atan2(dz, -dx) on the hip vector).

Take frame: the route polyline translated so it starts at the origin, rotated so its initial
tangent points along +Z. Walk heading is 0 there; the arrival delta is wrap(arrival - tangent0)
in world yaw, carried into the take frame unchanged (a rigid map preserves relative angles).

Profile, s(t) arc length at 30 fps:
- stand0 (T0 seconds, default 1.0): s = 0, heading = tangent(s=0) rel = 0
- ease-in (Te seconds, default 0.8): cosine 0 -> v, covers v*Te/2
- cruise (Tc seconds): constant v, covers the remainder
- ease-out / decel (Td seconds, default 1.0): cosine v -> 0, covers v*Td/2
- turn window (Tt seconds, auto from |arrivalDelta| when 0): root static at the route end,
  heading cosine-ramped from end-tangent rel to arrivalDelta. When the requested arrival
  equals the travel heading (|arrivalDelta| < 1e-6 rad) the turn is SKIPPED (Tt = 0): the
  take ends standing facing down the route and the runtime's existing settling turn owns
  the residual yaw (measured 0.02-0.03 m; the baked turn cost 0.13-0.25 m).
- hold (T1 seconds, default 1.5): s = L, heading = arrivalDelta

If the route is shorter than the ease distances, Te/Td shrink proportionally (ratio kept)
and cruise goes to zero rather than refusing: the assay route is 1.306 m and always fits.
"""
import argparse
import json
import math


def wrap_pi(a: float) -> float:
    return ((a + math.pi) % (2.0 * math.pi)) - math.pi


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--route", required=True,
                    help="JSON list of [x, z] polyline points in WORLD frame (planner output).")
    ap.add_argument("--arrival-heading-radians", type=float, required=True,
                    help="World yaw the take must end facing (patient-facing).")
    ap.add_argument("--walk-speed-mps", type=float, required=True)
    ap.add_argument("--stand0-seconds", type=float, default=1.0)
    ap.add_argument("--easein-seconds", type=float, default=0.8)
    ap.add_argument("--decel-seconds", type=float, default=1.0)
    ap.add_argument("--turn-seconds", type=float, default=0.0,
                    help="0 = auto: max(0.6, |arrivalDelta| / (pi/2)).")
    ap.add_argument("--negate-arrival-delta", action="store_true",
                    help="Request the negated arrival delta in the heading conditioning. Calibration "
                         "against a measured bind transfer function: the motion-bind stage's rotation "
                         "path is EXACTLY yaw-negating (bound pelvis yaw = -source pelvis yaw at every "
                         "matched take fraction, to 0.01 deg on nurse seed 4), while translation is "
                         "correct. Negating the request lands the bound take on the true arrival "
                         "heading. Recorded in the profile; remove if the bind stage is ever fixed.")
    ap.add_argument("--hold-seconds", type=float, default=1.5)
    ap.add_argument("--fps", type=float, default=30.0)
    ap.add_argument("--out", required=True)
    ap.add_argument("--profile-out", required=True,
                    help="Phase boundary times (take seconds) for provenance + assay segmentation.")
    args = ap.parse_args(argv)

    route = [(float(p[0]), float(p[1])) for p in json.loads(args.route)]
    if len(route) < 2:
        print("REFUSE route_needs_2_points", flush=True)
        return 2
    if args.stand0_seconds < 0.8:
        print(f"REFUSE stand0_too_short: {args.stand0_seconds}s < 0.8s", flush=True)
        return 2
    if args.hold_seconds < 1.2:
        print(f"REFUSE hold_too_short: {args.hold_seconds}s < 1.2s", flush=True)
        return 2

    # Segment lengths + cumulative arc length of the world polyline.
    seg_lens = [math.hypot(b[0] - a[0], b[1] - a[1]) for a, b in zip(route[:-1], route[1:])]
    total_len = sum(seg_lens)
    if total_len <= 1e-9:
        print("REFUSE zero_length_route", flush=True)
        return 2

    def point_at(s: float) -> tuple[float, float]:
        s = min(max(s, 0.0), total_len)
        acc = 0.0
        for (a, b, ln) in zip(route[:-1], route[1:], seg_lens):
            if acc + ln >= s or ln == 0:
                t = 0.0 if ln == 0 else (s - acc) / ln
                return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)
            acc += ln
        return route[-1]

    def tangent_yaw_at(s: float) -> float:
        eps = min(0.01, total_len / 10.0)
        p0 = point_at(max(0.0, s - eps))
        p1 = point_at(min(total_len, s + eps))
        dx, dz = p1[0] - p0[0], p1[1] - p0[1]
        if math.hypot(dx, dz) <= 1e-9:
            return math.atan2(route[1][0] - route[0][0], route[1][1] - route[0][1])
        return math.atan2(dx, dz)

    tangent0 = tangent_yaw_at(0.0)
    arrival_delta = wrap_pi(args.arrival_heading_radians - tangent0)
    requested_delta = arrival_delta
    if args.negate_arrival_delta:
        arrival_delta = -arrival_delta

    # Ease distances at full speed; shrink proportionally when the route is short.
    v = args.walk_speed_mps
    te, td = args.easein_seconds, args.decel_seconds
    need = v * te / 2.0 + v * td / 2.0
    if need > total_len:
        scale = total_len / need
        te, td = te * scale, td * scale
        need = total_len
    tc = (total_len - need) / v

    t_stand0_end = args.stand0_seconds
    t_ease_end = t_stand0_end + te
    t_cruise_end = t_ease_end + tc
    t_decel_end = t_cruise_end + td
    turn_s = args.turn_seconds
    if turn_s <= 0:
        # No baked turn when the take already ends facing down the route: the runtime
        # hands the residual yaw to the existing settling turn (stepTake: residual >
        # SETTLE_TURN_TOLERANCE_RADIANS exits into settling; unit-tested flat-take
        # case "settles when the take ends off the target heading").
        turn_s = 0.0 if abs(arrival_delta) < 1e-6 else max(0.6, abs(arrival_delta) / (math.pi / 2.0))
    t_turn_end = t_decel_end + turn_s
    t_end = t_turn_end + args.hold_seconds
    duration = t_end

    s_ease_end = v * te / 2.0
    s_cruise_end = s_ease_end + v * tc

    def arc_at(t: float) -> float:
        if t <= t_stand0_end:
            return 0.0
        if t <= t_ease_end:
            tau = t - t_stand0_end
            return (v / 2.0) * (tau - (te / math.pi) * math.sin(math.pi * tau / te)) if te > 0 else 0.0
        if t <= t_cruise_end:
            return s_ease_end + v * (t - t_ease_end)
        if t <= t_decel_end:
            tau = t - t_cruise_end
            return s_cruise_end + (v / 2.0) * (tau + (td / math.pi) * math.sin(math.pi * tau / td)) if td > 0 else s_cruise_end
        return total_len

    end_tangent_rel = wrap_pi(tangent_yaw_at(total_len) - tangent0)

    def heading_at(t: float) -> float:
        if t <= t_decel_end:
            return wrap_pi(tangent_yaw_at(arc_at(t)) - tangent0)
        if t <= t_turn_end:
            u = (t - t_decel_end) / turn_s if turn_s > 0 else 1.0
            ease = 0.5 * (1.0 - math.cos(math.pi * u))
            return end_tangent_rel + wrap_pi(arrival_delta - end_tangent_rel) * ease
        return arrival_delta

    num_frames = int(round(duration * args.fps))
    # Take frame: translate route start to origin, rotate initial tangent onto +Z.
    # Rotation by -tangent0 about Y: take_x = dx*cos(-t0) ... with three.js yaw convention,
    # rotating a world offset by yaw -tangent0: tx = dx*cos(t0) - dz*sin(t0)? Verify: a point
    # along the initial tangent (dx,dz) = (sin t0, cos t0)*d must map to (0, d).
    # tx = dx*cos(t0) - dz*sin(t0) = d*(sin t0 cos t0 - cos t0 sin t0) = 0. tz = dx*sin(t0) +
    # dz*cos(t0) = d. Correct.
    c0, s0 = math.cos(tangent0), math.sin(tangent0)
    x0, z0 = route[0]

    smooth_root_2d = []
    headings = []
    for i in range(num_frames):
        t = i / args.fps
        wx, wz = point_at(arc_at(t))
        dx, dz = wx - x0, wz - z0
        smooth_root_2d.append([dx * c0 - dz * s0, dx * s0 + dz * c0])
        h = heading_at(t)
        headings.append([math.cos(h), math.sin(h)])

    constraint = {
        "type": "root2d",
        "frame_indices": list(range(num_frames)),
        "smooth_root_2d": smooth_root_2d,
        "global_root_heading": headings,
    }
    with open(args.out, "w") as fh:
        json.dump([constraint], fh)
    profile = {
        "takeFrame": {"originWorld": [x0, z0], "tangent0Radians": tangent0,
                      "arrivalDeltaRadians": arrival_delta,
                      "requestedArrivalDeltaRadians": requested_delta,
                      "bindYawMirrorCompensated": bool(args.negate_arrival_delta),
                      "endTangentRelRadians": end_tangent_rel},
        "walkSpeedMps": v,
        "routeLengthM": total_len,
        "stand0Seconds": args.stand0_seconds,
        "easeInSeconds": te,
        "cruiseSeconds": tc,
        "decelSeconds": td,
        "turnSeconds": turn_s,
        "holdSeconds": args.hold_seconds,
        "durationSeconds": duration,
        "boundaries": {
            "stand0End": t_stand0_end,
            "easeInEnd": t_ease_end,
            "cruiseEnd": t_cruise_end,
            "decelEnd": t_decel_end,
            "turnEnd": t_turn_end,
            "end": t_end,
        },
        "fps": args.fps,
        "numFrames": num_frames,
    }
    with open(args.profile_out, "w") as fh:
        json.dump(profile, fh)
    print(
        f"wrote {args.out}: {num_frames} frames, stand {args.stand0_seconds}s + "
        f"ease {te:.2f}s + cruise {tc:.2f}s + decel {td:.2f}s + turn {turn_s:.2f}s + "
        f"hold {args.hold_seconds}s, route {total_len:.3f} m, arrivalDelta {math.degrees(arrival_delta):.1f} deg"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main(__import__("sys").argv[1:]))
