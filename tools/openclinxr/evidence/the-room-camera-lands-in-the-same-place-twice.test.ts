import { beforeAll, describe, expect, it } from "vitest";
import { eyeSpreadMeters, measureRoomCameraLandings, type CameraLanding }
  from "./the-room-camera-lands-in-the-same-place-twice.js";

/**
 * OBSERVABLE: a station's derived room camera lands in the same place every time it is derived.
 *
 * MEASURED 2026-08-24, do not re-derive. Five capture runs in ONE process, same loop, same loader,
 * same `reframeCameraForRoom`:
 *
 *   station                                   median luminance      derived eye X
 *   primary_care_dyslipidemia_joint_pain_v1   83, 23, 23, 23, 23    +3.01, then -3.01 x4
 *   psych_suicidal_ideation_safety_v1         37, 37, 37, 37, 37    -2.26 every run
 *
 * The eye's |X| is 3.01 both times - only the SIGN flips, putting the camera on the opposite side of
 * the room and swinging the measured luminance 3.6x. psych never moves.
 *
 * The capture note names the mechanism. primary_care rejects EVERY candidate:
 *   rejected = -3.0/2.4  3.0/2.4  0.0/2.4  -1.5/2.4  1.5/2.4      (five)
 *   psych    = 2.3/2.1                                            (one)
 * A room that rejects all of its candidates falls through to something that is not sign-stable.
 *
 * WHY THIS MATTERS BEYOND ONE ROOM. `no-shipped-station-captures-darker-than-it-did.test.ts` asserts
 * a per-station luminance floor of >= 12 for this station. Its committed history reads 21, 0, 16, and
 * #635's live re-run read 0 while I read 83 minutes later. Those are not regressions and recoveries -
 * they are samples of a coin flip. **A threshold on an unstable measurement is not a gate.**
 *
 * KNOWN-GOOD COLUMN: psych, 5/5 identical, one rejected candidate, in the same process and the same
 * loop as the failing station. It is what refuses the "scene loading is just noisy" explanation: a
 * loader that produced this variance would have produced it for both.
 *
 * FAILED TREATMENT, do not repeat: pinning a literal camera position for this room.
 * `ui-xr-environment-room-capture.ts:997` states the rule this pipeline already chose - "the camera
 * derives from the shell width and the door constants, not a literal". A hardcoded eye satisfies
 * clause (1) and re-authors the defect the derivation exists to prevent.
 * ALSO FORBIDDEN: widening any luminance floor to accommodate the spread. The measurement is the
 * defect; the floors are not this contract's business.
 *
 * claimScope: whether the derived eye is identical across repeated derivations in one process, for
 *   these two stations.
 * notEvidenceFor: which of the two positions is correct; whether the room is too dark from either;
 *   the other twelve stations (not measured); why every candidate is rejected.
 */

const UNSTABLE = "primary_care_dyslipidemia_joint_pain_v1";
const CONTROL = "psych_suicidal_ideation_safety_v1";
/**
 * DERIVED FROM THE KNOWN-GOOD COLUMN, not from the defect. My first attempt used 0.01 m on the
 * reasoning that a derivation is pure - and clause (2) caught it before this was ever dispatched.
 * The control's eye HEIGHT jitters ~0.04 m run to run (1.66-1.70) while its X never moves at all,
 * so a sub-centimetre bound refuses a station that is behaving correctly. 0.10 m is 2.5x the
 * control's observed jitter and 60x below the 6.02 m X swing on the failing station.
 */
const MAX_EYE_SPREAD_METERS = 0.1;
const BOOT_TIMEOUT_MS = 600_000;

let landings: CameraLanding[] = [];
const forStation = (id: string): CameraLanding[] => landings.filter((l) => l.scenarioId === id);

beforeAll(async () => {
  landings = await measureRoomCameraLandings([UNSTABLE, CONTROL], 3);
}, BOOT_TIMEOUT_MS);

describe("the room camera lands in the same place twice", () => {
  it.fails("(1) the unstable station derives the same eye every run", () => {
    const rows = forStation(UNSTABLE);
    expect(rows.length, "no landings measured for the unstable station").toBeGreaterThanOrEqual(3);
    expect(
      eyeSpreadMeters(rows),
      `the derived eye moves ${eyeSpreadMeters(rows).toFixed(2)}m between runs `
      + `(${rows.map((r) => r.eye[0].toFixed(2)).join(", ")} on X). Every capture-derived number for `
      + "this station is sampling a different viewpoint, so its luminance floor is a coin flip",
    ).toBeLessThanOrEqual(MAX_EYE_SPREAD_METERS);
  }, BOOT_TIMEOUT_MS);

  it("(2) KNOWN-GOOD COLUMN: the control station is already deterministic and must stay so", () => {
    // Same process, same loop, same loader as clause (1). This is what refuses "scene loading is
    // noisy" as an explanation, and it refuses a fix that stabilises one room by pinning all of them.
    const rows = forStation(CONTROL);
    expect(rows.length, "no landings measured for the control station").toBeGreaterThanOrEqual(3);
    expect(eyeSpreadMeters(rows), "the control derived one eye 5/5 when measured; it must not regress")
      .toBeLessThanOrEqual(MAX_EYE_SPREAD_METERS);
  }, BOOT_TIMEOUT_MS);

  it("(3) COUNTERWEIGHT: the camera is still derived from the room, not the same point everywhere", () => {
    // Refuses the cheap fix. Returning one constant eye for every station makes clause (1) and (2)
    // trivially green and destroys the framing. Two rooms of different width must frame differently.
    const a = forStation(UNSTABLE)[0];
    const b = forStation(CONTROL)[0];
    expect(a && b, "both stations must have landed at least once").toBeTruthy();
    expect(a!.environmentId, "the two stations must be different rooms").not.toBe(b!.environmentId);
    expect(
      Math.abs(Math.abs(a!.eye[0]!) - Math.abs(b!.eye[0]!)),
      "the derived eyes must still differ between rooms - a shared constant is not a derivation",
    ).toBeGreaterThan(0.2);
  }, BOOT_TIMEOUT_MS);

  it("(4) VACUITY GUARD: the instrument actually re-derived, it did not reuse one reading", () => {
    // Without this, clause (1) passes on an instrument that measures once and copies. Pins that
    // distinct derivations happened and that the note carried a candidate list to parse.
    expect(landings.length, "3 repeats x 2 stations").toBeGreaterThanOrEqual(6);
    expect(
      forStation(UNSTABLE).some((r) => r.rejectedCandidateCount > 1),
      "the unstable station rejected five candidates when measured; a zero here means the note "
      + "shape changed and the parse is silently returning nothing",
    ).toBe(true);
  }, BOOT_TIMEOUT_MS);
});
