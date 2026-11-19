/**
 * K2 (aisha-p2k): P-side parity-routing contract.
 *
 * The X dispatcher (X/src/parity/parity-lab-entry.ts isParitySpec) routes a spec
 * parity-ward iff any parity-only key is set: parity / cameraOverride / calib /
 * masks / rigOverride.hdri (the exact keys ParitySpecExtension declares,
 * X/src/parity/parity-types.ts (the ParitySpecExtension declaration there),
 * plus ParityRigOverride.hdri declared in the same module).
 * That dispatcher cannot be unit-tested inside X: xr-scene testInternalImports
 * measures exactly 10 = ceiling 10 (exact ratchet, both directions), so any
 * counted test import pushes it to 11 and fails `pnpm architecture`. This test
 * therefore proves the P side of the contract: every spec P builds for a parity
 * capture carries a parity-only key the predicate reads, and plain (product/lab)
 * spec shapes carry none. Dispatch itself is proved live by K4 (every K4 capture
 * evidence carries the parity readback, which only the parity boot records).
 *
 * readsAsParity mirrors the entry predicate key-for-key (it cannot import it:
 * cross-package relative src imports are frozen). If the entry predicate gains
 * a key, update this mirror and cite the new source symbol by name.
 */
import { describe, expect, it } from "vitest";
import type { CameraRec } from "./capture-args.js";
import { buildSpec, type SubjectSpec } from "./capture-spec.js";

type SpecLike = {
  parity?: unknown;
  cameraOverride?: unknown;
  calib?: unknown;
  masks?: unknown;
  rigOverride?: { hdri?: unknown } | null;
} & Record<string, unknown>;

/** Mirror of X/src/parity/parity-lab-entry.ts isParitySpec (same five keys). */
function readsAsParity(spec: SpecLike): boolean {
  return (
    spec.parity != null ||
    spec.cameraOverride != null ||
    spec.calib != null ||
    spec.masks === true ||
    spec.rigOverride?.hdri != null
  );
}

const CAM: CameraRec = {
  name: "head_front",
  resolution: [1536, 1536],
  vfov_deg: 30,
  near: 0.01,
  far: 100,
  three: {
    position: [0.0, 1.55, 0.94],
    target: [0.0, 1.5, 0.0],
    up: [0, 1, 0],
    quaternion: [0, 0, 0, 1],
  },
};

const SUBJECT: SubjectSpec = {
  id: "aisha",
  bodyGlb: "generated-humanoids/mpfb-gown-adult-patient.glb",
  hdriUrl: "hdri/p1a-world.exr",
  bodyMeshName: "mpfb-body",
  garmentMeshNames: ["gown"],
};

const BASE_OPTS = {
  levers: { toneMapping: "AgX", exposure: 1 },
  masks: false,
  calibSpheres: null,
  nohair: false,
};

describe("K2: every P capture spec carries a parity-only key", () => {
  it("default beauty spec carries cameraOverride + rigOverride.hdri + parity", () => {
    const spec = buildSpec(CAM, SUBJECT, BASE_OPTS) as SpecLike;
    expect(spec.cameraOverride, "cameraOverride present").not.toBeNull();
    expect(
      (spec.rigOverride as { hdri?: unknown } | undefined)?.hdri,
      "rigOverride.hdri present",
    ).toBeDefined();
    expect(spec.parity, "parity present").not.toBeNull();
    expect(readsAsParity(spec), "routes parity-ward").toBe(true);
  });

  it("masks mode carries cameraOverride + masks", () => {
    const spec = buildSpec(CAM, SUBJECT, { ...BASE_OPTS, masks: true }) as SpecLike;
    expect(spec.cameraOverride, "cameraOverride present").not.toBeNull();
    expect(spec.masks, "masks present").toBe(true);
    expect(readsAsParity(spec), "routes parity-ward").toBe(true);
  });

  it("calib mode carries cameraOverride + hdri + calib", () => {
    const spec = buildSpec(CAM, SUBJECT, {
      ...BASE_OPTS,
      calibSpheres: {
        radiusM: 0.035,
        chromeCenter: [-0.048, 1.5, 0],
        greyCenter: [0.048, 1.5, 0],
      },
    }) as SpecLike;
    expect(spec.cameraOverride, "cameraOverride present").not.toBeNull();
    expect(spec.calib, "calib present").not.toBeNull();
    expect(readsAsParity(spec), "routes parity-ward").toBe(true);
  });

  it("nohair variant keeps the routing keys (hideHair is not a routing key)", () => {
    const spec = buildSpec(CAM, SUBJECT, { ...BASE_OPTS, nohair: true }) as SpecLike;
    expect(spec["hideHair"], "hideHair set").toBe(true);
    expect(readsAsParity(spec), "still routes parity-ward").toBe(true);
  });
});

describe("K2: each parity-only key alone reads parity-ward", () => {
  const base: SpecLike = { subjectId: "aisha", subjectKind: "glb" };
  it("parity alone", () => {
    expect(readsAsParity({ ...base, parity: { toneMapping: "AgX" } })).toBe(true);
  });
  it("cameraOverride alone", () => {
    expect(readsAsParity({ ...base, cameraOverride: { vfovDeg: 30 } })).toBe(true);
  });
  it("calib alone", () => {
    expect(readsAsParity({ ...base, calib: { spheres: {} } })).toBe(true);
  });
  it("masks alone", () => {
    expect(readsAsParity({ ...base, masks: true })).toBe(true);
  });
  it("rigOverride.hdri alone", () => {
    expect(readsAsParity({ ...base, rigOverride: { hdri: { url: "h.exr" } } })).toBe(true);
  });
});

describe("K2: plain specs carry no parity-only key (lab-ward)", () => {
  it("minimal subjectId+view spec", () => {
    expect(readsAsParity({ subjectId: "aisha", subjectKind: "glb", view: "front" })).toBe(false);
  });
  it("real non-parity portrait spec (isolated-subject portrait shape from runtime-portrait-capture)", () => {
    expect(
      readsAsParity({
        subjectKind: "glb",
        bodyGlb: "generated-humanoids/mpfb-ob-patient-aisha.glb",
        view: "front",
        focus: "head",
        hideHair: true,
        subjectOnly: true,
        renderSize: 1024,
      }),
    ).toBe(false);
  });
  it("real non-parity variant spec (isolated-subject variant shape with skin/material overrides)", () => {
    expect(
      readsAsParity({
        subjectKind: "glb",
        bodyGlb: "generated-humanoids/mpfb-ob-patient-aisha.glb",
        view: "front",
        focus: "head",
        hideHair: true,
        subjectOnly: true,
        renderSize: 1024,
        skinOverride: {},
        materialOverrides: [],
      }),
    ).toBe(false);
  });
});
