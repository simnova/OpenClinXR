/**
 * K2 (aisha-p2k): P-side parity-routing contract.
 *
 * The X dispatcher (X/src/parity/parity-lab-entry.ts isParitySpec +
 * dispatchLabBoot) routes a spec parity-ward iff any parity-only key is set:
 * parity / cameraOverride / calib / masks / rigOverride.hdri (the exact keys
 * ParitySpecExtension declares, X/src/parity/parity-types.ts (the
 * ParitySpecExtension declaration there), plus ParityRigOverride.hdri
 * declared in the same module). That dispatcher cannot be unit-tested inside
 * X: xr-scene testInternalImports measures exactly 10 = ceiling 10 (exact
 * ratchet, both directions), so any counted test import pushes it to 11 and
 * fails `pnpm architecture`. This test therefore mirrors the P side of the
 * contract AND proves the mirror is the same code as the entry (text
 * comparison, no sha pin): readsAsParity mirrors isParitySpec, dispatchMirror
 * mirrors dispatchLabBoot. Behaviour cases route through dispatchMirror with
 * spy targets (identity-preserving dispatch).
 *
 * If the entry gains a key or reroutes, update the mirror in the same commit.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
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

/** One mirror boot target: receives the IDENTICAL spec object. */
type MirrorTarget = (spec: SpecLike) => void;

/** Mirror of X/src/parity/parity-lab-entry.ts dispatchLabBoot (same body). */
function dispatchMirror(
  spec: SpecLike,
  targets: { lab: MirrorTarget; parity: MirrorTarget },
): void {
  if (readsAsParity(spec)) {
    targets.parity(spec);
  } else {
    targets.lab(spec);
  }
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

function routeThroughMirror(spec: SpecLike): {
  labCalls: SpecLike[];
  parityCalls: SpecLike[];
} {
  const labCalls: SpecLike[] = [];
  const parityCalls: SpecLike[] = [];
  dispatchMirror(spec, {
    lab: (s) => {
      labCalls.push(s);
    },
    parity: (s) => {
      parityCalls.push(s);
    },
  });
  return { labCalls, parityCalls };
}

describe("K2: each parity-only key alone routes parity-ward via dispatchMirror", () => {
  const base: SpecLike = { subjectId: "aisha", subjectKind: "glb" };
  const cases: Array<[string, SpecLike]> = [
    ["parity", { ...base, parity: { toneMapping: "AgX" } }],
    ["cameraOverride", { ...base, cameraOverride: { vfovDeg: 30 } }],
    ["calib", { ...base, calib: { spheres: {} } }],
    ["masks", { ...base, masks: true }],
    ["rigOverride.hdri", { ...base, rigOverride: { hdri: { url: "h.exr" } } }],
  ];
  for (const [name, spec] of cases) {
    it(`${name} alone`, () => {
      const { labCalls, parityCalls } = routeThroughMirror(spec);
      expect(parityCalls.length, `${name}: parity called once`).toBe(1);
      expect(parityCalls[0], `${name}: identical spec object`).toBe(spec);
      expect(labCalls.length, `${name}: lab never called`).toBe(0);
    });
  }
});

describe("K2: plain specs route lab-ward via dispatchMirror (identity)", () => {
  const cases: Array<[string, SpecLike]> = [
    ["minimal subjectId+view spec", { subjectId: "aisha", subjectKind: "glb", view: "front" }],
    [
      "real non-parity portrait spec (isolated-subject portrait shape from runtime-portrait-capture)",
      {
        subjectKind: "glb",
        bodyGlb: "generated-humanoids/mpfb-ob-patient-aisha.glb",
        view: "front",
        focus: "head",
        hideHair: true,
        subjectOnly: true,
        renderSize: 1024,
      },
    ],
    [
      "real non-parity variant spec (isolated-subject variant shape with skin/material overrides)",
      {
        subjectKind: "glb",
        bodyGlb: "generated-humanoids/mpfb-ob-patient-aisha.glb",
        view: "front",
        focus: "head",
        hideHair: true,
        subjectOnly: true,
        renderSize: 1024,
        skinOverride: {},
        materialOverrides: [],
      },
    ],
  ];
  for (const [name, spec] of cases) {
    it(name, () => {
      const { labCalls, parityCalls } = routeThroughMirror(spec);
      expect(labCalls.length, `${name}: lab called once`).toBe(1);
      expect(labCalls[0], `${name}: identical spec object`).toBe(spec);
      expect(parityCalls.length, `${name}: parity never called`).toBe(0);
    });
  }
});

function stripComments(src: string): string {
  let out = "";
  let i = 0;
  const n = src.length;
  let sq = false;
  let dq = false;
  let tpl = false;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (sq) {
      out += c;
      if (c === "\\") {
        out += d ?? "";
        i += 2;
        continue;
      }
      if (c === "'") sq = false;
      i += 1;
      continue;
    }
    if (dq) {
      out += c;
      if (c === "\\") {
        out += d ?? "";
        i += 2;
        continue;
      }
      if (c === '"') dq = false;
      i += 1;
      continue;
    }
    if (tpl) {
      out += c;
      if (c === "\\") {
        out += d ?? "";
        i += 2;
        continue;
      }
      if (c === "`") tpl = false;
      i += 1;
      continue;
    }
    if (c === "/" && d === "/") {
      while (i < n && src[i] !== "\n") i += 1;
      out += "\n";
      continue;
    }
    if (c === "/" && d === "*") {
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) i += 1;
      i += 2;
      out += " ";
      continue;
    }
    if (c === "'") {
      sq = true;
      out += c;
      i += 1;
      continue;
    }
    if (c === '"') {
      dq = true;
      out += c;
      i += 1;
      continue;
    }
    if (c === "`") {
      tpl = true;
      out += c;
      i += 1;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

function normaliseBody(body: string): string {
  const toks =
    stripComments(body).match(/[A-Za-z0-9_$]+|[^A-Za-z0-9_$\s]/g) ?? [];
  return toks.join(" ");
}

function extractBody(src: string, fnName: string): string {
  const clean = stripComments(src);
  const m = new RegExp(`function\\s+${fnName}\\b`).exec(clean);
  if (!m || m.index === undefined) throw new Error(`function ${fnName} not found`);
  const i = m.index + m[0].length;
  const parenOpen = clean.indexOf("(", i);
  if (parenOpen < 0) throw new Error(`function ${fnName}: no param list`);
  let depth = 0;
  let j = parenOpen;
  for (; j < clean.length; j += 1) {
    if (clean[j] === "(") depth += 1;
    else if (clean[j] === ")") {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  if (depth !== 0) throw new Error(`function ${fnName}: unbalanced params`);
  const braceOpen = clean.indexOf("{", j);
  if (braceOpen < 0) throw new Error(`function ${fnName}: no body brace`);
  let bdepth = 0;
  for (let k = braceOpen; k < clean.length; k += 1) {
    if (clean[k] === "{") bdepth += 1;
    else if (clean[k] === "}") {
      bdepth -= 1;
      if (bdepth === 0) return clean.slice(braceOpen, k + 1);
    }
  }
  throw new Error(`function ${fnName}: unbalanced body`);
}

describe("K2: P mirror is the same code as the X dispatcher (text, no pin)", () => {
  const hereDir = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(hereDir, "../../../../..");
  const entryPath = path.join(
    repoRoot,
    "packages/openclinxr/xr-scene/src/parity/parity-lab-entry.ts",
  );
  const selfPath = fileURLToPath(import.meta.url);
  const entrySrc = readFileSync(entryPath, "utf8");
  const selfSrc = readFileSync(selfPath, "utf8");

  it("isParitySpec vs readsAsParity bodies match", () => {
    const a = normaliseBody(extractBody(entrySrc, "isParitySpec"));
    const b = normaliseBody(extractBody(selfSrc, "readsAsParity"));
    expect(
      b,
      "packages/openclinxr/xr-scene/src/parity/parity-lab-entry.ts isParitySpec vs "
        + "parity-dispatch-contract.test.ts readsAsParity: the parity dispatcher and its "
        + "P mirror must be the same code: change both in the same commit "
        + "(LAB-PARITY-DEDUPE tsk_fc8765e10b4f4f53)",
    ).toBe(a);
  });

  it("dispatchLabBoot vs dispatchMirror bodies match (up to the paired predicate name)", () => {
    const canon = (s: string): string =>
      s.replace(/\bisParitySpec\b/g, "PRED").replace(/\breadsAsParity\b/g, "PRED");
    const a = canon(normaliseBody(extractBody(entrySrc, "dispatchLabBoot")));
    const b = canon(normaliseBody(extractBody(selfSrc, "dispatchMirror")));
    expect(
      b,
      "packages/openclinxr/xr-scene/src/parity/parity-lab-entry.ts dispatchLabBoot vs "
        + "parity-dispatch-contract.test.ts dispatchMirror: the parity dispatcher and its "
        + "P mirror must be the same code: change both in the same commit "
        + "(LAB-PARITY-DEDUPE tsk_fc8765e10b4f4f53)",
    ).toBe(a);
  });
});
