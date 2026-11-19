/**
 * Isolated-subject lab dispatcher (lane aisha-parity, P2): every
 * bootIsolatedSubjectLab caller lands here. Parity specs (any parity-only key
 * set) boot the parity capture in ./parity-lab.js; every other spec boots the
 * restored isolated-subject-lab.js byte-for-byte (cornea pin
 * assertStrictLabSourceBinding). apps/ui-xr/isolated-subject.html imports the
 * name from @openclinxr/xr-scene and is untouched.
 *
 * The two boot targets are injectable for tests: dispatchLabBoot(spec, { lab,
 * parity }) routes the IDENTICAL spec object to exactly one target.
 */

import {
  bootIsolatedSubjectLab as bootRestoredLab,
  type IsolatedSubjectSpec,
} from "../isolated-subject-lab.js";
import { parseIsolatedSubjectSpec } from "../isolated-subject-spec-params.js";
import type {
  ParityRigOverride,
  ParitySpecExtension,
} from "./parity-types.js";
import { bootParityLab, type ParityLabSpec } from "./parity-lab.js";

/**
 * Spec surface the dispatcher reads: the lab spec plus the parity-only keys.
 * The parity-only keys are exactly the ones ParitySpecExtension declares
 * (cameraOverride, calib, masks, parity) plus rigOverride.hdri (the HDRI world
 * lives on ParityRigOverride, not the pinned product RigOverride). Keys the
 * origin/main lab already reads (hideHair, focus, portrait, view, ...) do NOT
 * route.
 */
export type EntrySpec = Omit<IsolatedSubjectSpec, "rigOverride"> &
  Partial<ParitySpecExtension> & {
    rigOverride?: ParityRigOverride;
  };

/** True when the spec carries any parity-only key (mirrors resolveParityScene). */
export function isParitySpec(spec: EntrySpec): boolean {
  return (
    spec.parity != null ||
    spec.cameraOverride != null ||
    spec.calib != null ||
    spec.masks === true ||
    spec.rigOverride?.hdri != null
  );
}

/** One boot target: receives the IDENTICAL spec object the dispatcher was given. */
export type LabBootTarget = (spec: EntrySpec) => void;

/** Route a parsed spec to exactly one boot target (identity-preserving). */
export function dispatchLabBoot(
  spec: EntrySpec,
  targets: { lab: LabBootTarget; parity: LabBootTarget },
): void {
  if (isParitySpec(spec)) {
    targets.parity(spec);
  } else {
    targets.lab(spec);
  }
}

/** Boot the isolated-subject lab from the #app element and URL spec (probe-only entry). */
export function bootIsolatedSubjectLab(): void {
  const spec = parseIsolatedSubjectSpec() as EntrySpec;
  dispatchLabBoot(spec, {
    lab: () => {
      bootRestoredLab();
    },
    parity: (paritySpec) => {
      bootParityLab(paritySpec as ParityLabSpec);
    },
  });
}
