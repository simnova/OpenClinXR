/**
 * P2a: the flagged S1 bake emits the hm08 mouth so the unmodified shipped chain
 * (swap_teeth -> teeth-rest-clearance -> couple-fitted-teeth-to-lip-viseme ->
 * decimate_teeth) reproduces the shipped nurse teeth.
 *
 * Layout: the reproduction record (sibling .reproduction.json) is the single
 * source of truth for store paths, file sha256, accessor sha256, argv and
 * exits. Every clause below recomputes live from disk.
 *
 * - CW1 chain-output teeth vs the shipped mesh, live: 4494 verts, the 7 target
 *   names in order, POSITION and every target delta element-wise within float32
 *   machine epsilon (IEEE 754 binary32).
 * - CW2 the flagged S1 mouth is a rename-only flag: flagged hm08 teeth
 *   POSITION is bit-identical to the unflagged S1 fitted teeth POSITION.
 *   swap_teeth.py:673 replaces the input mouth wholesale
 *   (output_document["meshes"][shipped_mesh_index] = cloned_mesh), so S1 teeth
 *   geometry cannot reach the chain output and clearance cannot double-apply.
 * - CW0 unflagged S1 stability, mode taken from the reproduction record
 *   ("byte-equal" or "structural").
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "@openclinxr/factory-station-core/runner";
import { describe, expect, it } from "vitest";

process.chdir(repoRoot());

const SCRIPT = "tools/openclinxr/evidence/blender/materialize_mpfb_humanoid_candidate.py";
const FLAG = "--emit-hm08-mouth";
const REPRO_PATH = join(
  process.cwd(),
  "packages/openclinxr/stations/humanoid-bake-evidence/src/humanoid-bake/the-flagged-bake-emits-the-hm08-mouth.reproduction.json",
);
const SHIPPED_PATH = join(
  process.cwd(),
  "apps/ui-xr/public/generated-humanoids/mpfb-clinical-nurse-adult.glb",
);
// IEEE 754 binary32 machine epsilon: |fl(x) - x| <= 2^-23 * max(|x|, 1) per element.
const FLOAT32_EPS = 2 ** -23;
const epsilonBound = (value: number): number => FLOAT32_EPS * Math.max(Math.abs(value), 1);
const EXPECTED_TARGET_NAMES = [
  "viseme_aa",
  "viseme_E",
  "viseme_I",
  "viseme_O",
  "viseme_U",
  "viseme_FF",
  "viseme_PP",
];
const EXPECTED_TEETH_VERTS = 4494;
// The store clauses read write-once bake artifacts from the machine-local asset
// store. The skip is keyed on the store ROOT only: a clone without the store
// skips them (and says so); a present root with any cited file missing fails.
// Precedent: garment-bake-matrix.test.ts:134 describe.skipIf(!garmentBakesEnabled()).
const STORE_ROOT = "/Volumes/files/openclinxr-assets/store/st-teeth/p2a";
const STORE_PRESENT = existsSync(STORE_ROOT);
if (!STORE_PRESENT) {
  // eslint-disable-next-line no-console
  console.log(`SKIP p2a store clauses: asset store root absent (${STORE_ROOT})`);
}
const TEETH_MESH_NAME = "openclinxr_fitted_teeth_mpfb_ed_chest_pain_nurse_adult_mesh";

type Accessor = {
  bufferView?: number;
  byteOffset?: number;
  componentType: number;
  count: number;
  type: string;
  normalized?: boolean;
  sparse?: unknown;
};
type Primitive = {
  indices?: number;
  attributes?: Record<string, number>;
  targets?: Array<Record<string, number>>;
  material?: number;
};
type Mesh = { name?: string; primitives?: Primitive[]; extras?: { targetNames?: string[] } };
type Document = {
  accessors: Accessor[];
  bufferViews: Array<{ byteOffset?: number; byteLength: number; byteStride?: number }>;
  meshes: Mesh[];
};
type Glb = { document: Document; binary: Buffer; raw: Buffer };

type Repro = {
  flaggedS1: { path: string; sha256: string };
  chainOutput: { path: string; sha256: string };
  chainOutputTeethAccessors: Record<string, string>;
  unflagged: { k0a: string; k0b: string; k0c: string };
  cw0: { mode: "byte-equal" | "structural"; shas?: Record<string, string> };
  steps: Array<{ name: string; argv: string[]; exit: number; outputSha256: string; output: string }>;
};

function sha256(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function loadRepro(): Repro {
  if (!existsSync(REPRO_PATH)) {
    throw new Error(`reproduction JSON absent: ${REPRO_PATH} (K4 has not run)`);
  }
  return JSON.parse(readFileSync(REPRO_PATH, "utf8")) as Repro;
}

function parseGlb(path: string): Glb {
  const raw = readFileSync(path);
  if (raw.readUInt32LE(0) !== 0x46546c67 || raw.readUInt32LE(4) !== 2) {
    throw new Error(`${path}: expected GLB v2`);
  }
  const jsonLength = raw.readUInt32LE(12);
  if (raw.readUInt32LE(16) !== 0x4e4f534a) throw new Error(`${path}: missing JSON chunk`);
  const document = JSON.parse(raw.subarray(20, 20 + jsonLength).toString("utf8")) as Document;
  const binHeader = 20 + jsonLength;
  if (raw.readUInt32LE(binHeader + 4) !== 0x004e4942) throw new Error(`${path}: missing BIN chunk`);
  return { document, binary: raw.subarray(binHeader + 8), raw };
}

function accessorPayload(glb: Glb, index: number): Buffer {
  const accessor = glb.document.accessors[index];
  if (!accessor || accessor.bufferView === undefined) throw new Error(`accessor ${index} has no bufferView`);
  if (accessor.sparse) throw new Error(`accessor ${index} is sparse: comparison refuses sparse mouth accessors`);
  if (accessor.componentType !== 5126 || accessor.type !== "VEC3") {
    throw new Error(`accessor ${index} is not float VEC3`);
  }
  const view = glb.document.bufferViews[accessor.bufferView];
  if (!view) throw new Error(`accessor ${index} has no bufferView entry`);
  const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  return glb.binary.subarray(start, start + accessor.count * 3 * 4);
}

function accessorFloats(glb: Glb, index: number): Float64Array {
  const payload = accessorPayload(glb, index);
  const out = new Float64Array(payload.length / 4);
  for (let i = 0; i < out.length; i++) out[i] = payload.readFloatLE(i * 4);
  return out;
}

function findMesh(glb: Glb, name: string): { mesh: Mesh; index: number } {
  const index = glb.document.meshes.findIndex((mesh) => mesh.name === name);
  if (index < 0) throw new Error(`mesh ${name} not found`);
  return { mesh: glb.document.meshes[index]!, index };
}

function maxAbsDiff(a: Float64Array, b: Float64Array): { max: number; at: number } {
  if (a.length !== b.length) throw new Error(`length mismatch ${a.length} vs ${b.length}`);
  let max = 0;
  let at = 0;
  for (let i = 0; i < a.length; i++) {
    const d = Math.abs(a[i]! - b[i]!);
    if (d > max) {
      max = d;
      at = i;
    }
  }
  return { max, at };
}

function expectWithinEpsilon(label: string, a: Float64Array, b: Float64Array): number {
  const { max, at } = maxAbsDiff(a, b);
  const ra = a[at] ?? 0;
  const rb = b[at] ?? 0;
  const bound = Math.max(epsilonBound(ra), epsilonBound(rb));
  expect(
    max,
    `${label}: max|d|=${max} at element ${at} exceeds float32 epsilon bound ${bound}`,
  ).toBeLessThanOrEqual(bound);
  return max;
}

function meshInventory(glb: Glb): Array<{ name: string; verts: number; targets: string[] }> {
  return glb.document.meshes.map((mesh) => {
    const prim = mesh.primitives?.[0];
    const position = prim?.attributes?.["POSITION"];
    const count = position === undefined ? -1 : (glb.document.accessors[position]?.count ?? -1);
    return { name: mesh.name ?? "", verts: count, targets: mesh.extras?.targetNames ?? [] };
  });
}

describe("the flagged bake emits the hm08 mouth", () => {
  it(
    "materialize exposes the opt-in hm08 mouth flag",
    { timeout: 180_000 },
    () => {
      // `materialize -- --help` crashed before this change (an unescaped
      // `+12%` in the --eyetex help string raised argparse's `%` TypeError).
      // Flag exposure is proven through the parser's error path, which never
      // depended on help formatting: passing the flag with the
      // required --output omitted must print a usage naming the flag and
      // complain about the missing argument -- not about an unrecognized
      // flag. Blender's exit code is not asserted (it masks script exits);
      // only the combined output matters.
      let out = "";
      try {
        out = execFileSync(
          "blender",
          ["--background", "--python", SCRIPT, "--", FLAG],
          { encoding: "utf8", timeout: 170_000 },
        ) as string;
      } catch (err) {
        const e = err as { stdout?: string | Buffer; stderr?: string | Buffer };
        out = `${String(e.stdout ?? "")}\n${String(e.stderr ?? "")}`;
      }
      expect(out, `usage must name the opt-in flag ${FLAG}`).toContain(FLAG);
      expect(out, "the flag must parse (missing --output, not unknown flag)").toContain("required");
      expect(out, "the flag must parse").not.toContain("unrecognized arguments");
    },
  );
});

describe.skipIf(!STORE_PRESENT)("the flagged bake's store artifacts reproduce the shipped mouth", () => {
  it("the flagged S1 output carries the hm08 mouth pair", () => {
    const repro = loadRepro();
    const glb = parseGlb(repro.flaggedS1.path);
    expect(sha256(readFileSync(repro.flaggedS1.path))).toBe(repro.flaggedS1.sha256);
    const names = glb.document.meshes.map((mesh) => mesh.name ?? "");
    const hm08Teeth = names.filter((name) => name.includes("openclinxr_hm08_teeth"));
    const hm08Tongue = names.filter((name) => name.includes("openclinxr_hm08_tongue"));
    const fittedTeeth = names.filter((name) => name.includes("openclinxr_fitted_teeth"));
    const fittedTongue = names.filter((name) => name.includes("openclinxr_fitted_tongue"));
    expect(hm08Teeth, "flagged S1 must emit exactly one openclinxr_hm08_teeth mesh").toHaveLength(1);
    expect(hm08Tongue, "flagged S1 must emit exactly one openclinxr_hm08_tongue mesh").toHaveLength(1);
    expect(fittedTeeth, "flagged S1 must not also carry fitted teeth").toHaveLength(0);
    expect(fittedTongue, "flagged S1 must not also carry a fitted tongue").toHaveLength(0);
  });

  it("the chain-output teeth match the shipped nurse teeth", () => {
    const repro = loadRepro();
    const chain = parseGlb(repro.chainOutput.path);
    expect(sha256(readFileSync(repro.chainOutput.path))).toBe(repro.chainOutput.sha256);
    const shipped = parseGlb(SHIPPED_PATH);

    const chainTeeth = findMesh(chain, TEETH_MESH_NAME).mesh;
    const shippedTeeth = findMesh(shipped, TEETH_MESH_NAME).mesh;
    const chainPrim = chainTeeth.primitives?.[0];
    const shippedPrim = shippedTeeth.primitives?.[0];
    if (!chainPrim?.attributes || !shippedPrim?.attributes) throw new Error("teeth primitive 0 missing");
    const chainPos = chainPrim.attributes["POSITION"];
    const shippedPos = shippedPrim.attributes["POSITION"];
    if (chainPos === undefined || shippedPos === undefined) throw new Error("teeth POSITION missing");
    expect(chain.document.accessors[chainPos]?.count).toBe(EXPECTED_TEETH_VERTS);
    expect(shipped.document.accessors[shippedPos]?.count).toBe(EXPECTED_TEETH_VERTS);
    expect(chainTeeth.extras?.targetNames).toEqual(EXPECTED_TARGET_NAMES);
    expect(shippedTeeth.extras?.targetNames).toEqual(EXPECTED_TARGET_NAMES);

    const maxD: Record<string, number> = {};
    maxD["POSITION"] = expectWithinEpsilon(
      "chain-output teeth POSITION vs shipped",
      accessorFloats(chain, chainPos),
      accessorFloats(shipped, shippedPos),
    );
    expect(sha256(accessorPayload(chain, chainPos))).toBe(repro.chainOutputTeethAccessors["POSITION"]);
    for (const name of EXPECTED_TARGET_NAMES) {
      const chainTargets = chainPrim.targets ?? [];
      const shippedTargets = shippedPrim.targets ?? [];
      const chainIndex = chainTeeth.extras?.targetNames?.indexOf(name) ?? -1;
      const shippedIndex = shippedTeeth.extras?.targetNames?.indexOf(name) ?? -1;
      const chainAccessor = chainIndex >= 0 ? chainTargets[chainIndex]?.["POSITION"] : undefined;
      const shippedAccessor = shippedIndex >= 0 ? shippedTargets[shippedIndex]?.["POSITION"] : undefined;
      if (chainAccessor === undefined || shippedAccessor === undefined) {
        throw new Error(`teeth target ${name} POSITION missing`);
      }
      maxD[name] = expectWithinEpsilon(
        `chain-output teeth target ${name} vs shipped`,
        accessorFloats(chain, chainAccessor),
        accessorFloats(shipped, shippedAccessor),
      );
      expect(sha256(accessorPayload(chain, chainAccessor))).toBe(repro.chainOutputTeethAccessors[name]);
    }
    // eslint-disable-next-line no-console
    console.log(`CW1 max|d| per accessor: ${JSON.stringify(maxD)}`);
  });

  it("the flagged S1 mouth is a rename-only flag", () => {
    const repro = loadRepro();
    const flagged = parseGlb(repro.flaggedS1.path);
    const unflagged = parseGlb(repro.unflagged.k0c);
    const flaggedNames = flagged.document.meshes.map((mesh) => mesh.name ?? "");
    const hm08 = flaggedNames.find((name) => name.includes("openclinxr_hm08_teeth"));
    if (!hm08) throw new Error("flagged S1 has no openclinxr_hm08_teeth mesh");
    const unflaggedMatch = findMesh(unflagged, hm08.replace("openclinxr_hm08_teeth", "openclinxr_fitted_teeth")).mesh;
    const flaggedMesh = findMesh(flagged, hm08).mesh;
    const flaggedPos = flaggedMesh.primitives?.[0]?.attributes?.["POSITION"];
    const unflaggedPos = unflaggedMatch.primitives?.[0]?.attributes?.["POSITION"];
    if (flaggedPos === undefined || unflaggedPos === undefined) throw new Error("teeth POSITION missing");
    const a = accessorFloats(flagged, flaggedPos);
    const b = accessorFloats(unflagged, unflaggedPos);
    const { max, at } = maxAbsDiff(a, b);
    expect(
      sha256(accessorPayload(flagged, flaggedPos)),
      "flagged hm08 teeth POSITION is not bit-identical to the unflagged fitted " +
        "teeth POSITION (the flag must be a rename only; swap_teeth.py:673 replaces " +
        "the input mouth wholesale so S1 teeth geometry cannot reach the chain output)",
    ).toBe(sha256(accessorPayload(unflagged, unflaggedPos)));
    // eslint-disable-next-line no-console
    console.log(`CW2 max|d| POSITION: ${max} at element ${at}`);
  });

  it("the unflagged S1 output is stable", () => {
    const repro = loadRepro();
    const shas = repro.cw0.shas ?? {};
    const files = [repro.unflagged.k0a, repro.unflagged.k0b, repro.unflagged.k0c];
    for (const file of files) {
      if (shas[file] === undefined) throw new Error(`reproduction record pins no sha256 for ${file}`);
      expect(sha256(readFileSync(file)), `${file} sha256 mismatch vs reproduction record`).toBe(shas[file]);
    }
    if (repro.cw0.mode === "byte-equal") {
      const [first, ...rest] = files.map((file) => shas[file]);
      for (const sha of rest) expect(sha, "unflagged S1 bytes drifted between runs").toBe(first);
    }
    const a = parseGlb(repro.unflagged.k0a);
    const b = parseGlb(repro.unflagged.k0b);
    const c = parseGlb(repro.unflagged.k0c);
    const inventories = [a, b, c].map(meshInventory);
    expect(inventories[1]).toEqual(inventories[0]);
    expect(inventories[2]).toEqual(inventories[0]);
    for (const [label, glb] of [["k0a", a], ["k0b", b], ["k0c", c]] as const) {
      const teeth = glb.document.meshes.find((mesh) => (mesh.name ?? "").includes("openclinxr_fitted_teeth"));
      expect(teeth, `${label} missing fitted teeth mesh`).toBeDefined();
    }
  });

  it("the reproduction record pins every byte", () => {
    const repro = loadRepro();
    expect(repro.flaggedS1.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(repro.chainOutput.sha256).toMatch(/^[0-9a-f]{64}$/);
    // Every cited artifact must sit under STORE_ROOT, or the skip key would
    // not cover it.
    const cited = [
      repro.flaggedS1.path,
      repro.chainOutput.path,
      repro.unflagged.k0a,
      repro.unflagged.k0b,
      repro.unflagged.k0c,
      ...repro.steps.map((step) => step.output),
    ];
    for (const file of cited) expect(file.startsWith(`${STORE_ROOT}/`), `${file} outside ${STORE_ROOT}`).toBe(true);
    for (const step of repro.steps) {
      expect(step.exit, `${step.name} exit`).toBe(0);
      expect(step.argv.length, `${step.name} argv`).toBeGreaterThan(0);
      expect(sha256(readFileSync(step.output)), `${step.name} output sha256`).toBe(step.outputSha256);
    }
    expect(Object.keys(repro.chainOutputTeethAccessors).sort()).toEqual(
      ["POSITION", ...EXPECTED_TARGET_NAMES].sort(),
    );
  });
});
