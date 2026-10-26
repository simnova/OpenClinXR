/**
 * Ward writer functional routing (ph634 output isolation + review R1-R4).
 *
 * SOURCE=A, PUBLISHED=B, CHAIN=B with A!=B. Provenance/budget/freeze pins must
 * equal B; sourceRoot bytes unchanged. Previous budget + provenance template are
 * immutable INPUTS read from sourceRoot. Default freeze flow (no skip).
 */
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { shipWardProvenance } from "./ship-ward-provenance.js";
import { readSupineControlFreeze, computeSupineControlFreeze } from "../supine-control-freeze/supine-control-freeze.js";

const sha = (b: Buffer | string): string => createHash("sha256").update(b).digest("hex");

const CONTROL_ASSETS: Array<[string, string]> = [
  ["apps/ui-xr/public/xr-assets/environment/infinigen-stepdown.glb", "glTF-control-stepdown"],
  ["apps/ui-xr/public/xr-assets/environment/infinigen-surgical-ward.glb", "glTF-control-surgical"],
  ["apps/ui-xr/public/generated-humanoids/mpfb-gown-adult-patient.glb", "patient"],
  ["apps/ui-xr/public/generated-humanoids/mpfb-family-partner-adult.glb", "partner"],
  ["apps/ui-xr/public/generated-humanoids/mpfb-clinical-nurse-adult.glb", "nurse"],
  ["apps/ui-xr/public/generated-humanoids/mpfb-clinical-physician-adult.glb", "physician"],
  ["apps/ui-xr/public/generated-humanoids/mpfb-peds-nurse-kevin.glb", "peds"],
];

const WARD_REL = "apps/ui-xr/public/xr-assets/environment/infinigen-inpatient-ward.glb";
const RIG_REL = "apps/ui-xr/public/xr-assets/lighting/inpatient_ward_room_v1.rig.json";
const SOURCE_WARD = "glTF-source-ward-A";
const PUB_WARD = "glTF-published-ward-B";
const RIG_BODY = JSON.stringify({ rig: "clinic_day" });

function buildFixture(): { base: string; sourceRoot: string; publicationRoot: string } {
  const base = mkdtempSync(path.join(tmpdir(), "ward-prov-"));
  const sourceRoot = path.join(base, "src");
  const publicationRoot = path.join(base, "pub");
  // Source tree: OLD ward A + remaining controls + immutable inputs (previous + template).
  const srcWard = path.join(sourceRoot, WARD_REL);
  mkdirSync(path.dirname(srcWard), { recursive: true });
  writeFileSync(srcWard, Buffer.from(SOURCE_WARD));
  for (const [rel, body] of CONTROL_ASSETS) {
    const p = path.join(sourceRoot, rel);
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, Buffer.from(body));
  }
  const srcRigDir = path.join(sourceRoot, "apps/ui-xr/public/xr-assets/lighting");
  mkdirSync(srcRigDir, { recursive: true });
  writeFileSync(path.join(srcRigDir, "inpatient_ward_room_v1.rig.json"), RIG_BODY);
  // Previous budget (valid: images[] present) lives in sourceRoot as immutable input.
  mkdirSync(path.join(sourceRoot, "docs/openclinxr/room-realism/ship-ward-room"), { recursive: true });
  writeFileSync(path.join(sourceRoot, "docs/openclinxr/room-realism/ship-ward-room/shipped-budget.json"),
    JSON.stringify({ images: [{ name: "ao", decodedRgbaBytes: 8 }] }));
  const srcProvDir = path.join(sourceRoot, "apps/ui-xr/public/xr-assets/environment");
  mkdirSync(srcProvDir, { recursive: true });
  writeFileSync(path.join(srcProvDir, "PROVENANCE.md"),
    "- `infinigen-inpatient-ward.glb`\nOLD ENTRY\n- `infinigen-pediatric-fever-dummy`\n");
  // Published tree: NEW ward B + rig + chain(B).
  const pubWard = path.join(publicationRoot, WARD_REL);
  mkdirSync(path.dirname(pubWard), { recursive: true });
  writeFileSync(pubWard, Buffer.from(PUB_WARD));
  const pubRigDir = path.join(publicationRoot, "apps/ui-xr/public/xr-assets/lighting");
  mkdirSync(pubRigDir, { recursive: true });
  writeFileSync(path.join(pubRigDir, "inpatient_ward_room_v1.rig.json"), RIG_BODY);
  const chainDir = path.join(publicationRoot, "chain");
  mkdirSync(chainDir, { recursive: true });
  writeFileSync(path.join(chainDir, "infinigen-inpatient-ward.chain.glb"), Buffer.from(PUB_WARD));
  writeFileSync(path.join(chainDir, "ward-chain.lighting-rig.json"), RIG_BODY);
  return { base, sourceRoot, publicationRoot };
}

const fakeBudget = (bytes: Buffer) => ({
  sha256: sha(bytes),
  bytes: bytes.length,
  triangles: 7,
  primitiveCount: 2,
  decodedMiBWithMips: 1.5,
  images: [{ name: "ao", decodedRgbaBytes: 8 }],
});

const snapshotSource = (sourceRoot: string): Map<string, string> => {
  const out = new Map<string, string>();
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else out.set(path.relative(sourceRoot, p), sha(readFileSync(p)));
    }
  };
  walk(sourceRoot);
  return out;
};

describe("ship-ward-provenance R1-R4 (published/source split)", () => {
  it("R1+R2+R4: pins B, freeze pins published B, consumer fields preserved, source unchanged", () => {
    const fx = buildFixture();
    try {
      const before = snapshotSource(fx.sourceRoot);
      const out = path.join(fx.publicationRoot, "ship-ward-room");
      const freezePath = path.join(fx.publicationRoot, "freeze-record.json");
      const result = shipWardProvenance({
        publicationRoot: fx.publicationRoot,
        sourceRoot: fx.sourceRoot,
        outDir: out,
        chainDir: path.join(fx.publicationRoot, "chain"),
        seed: 205,
        freezeRecordPath: freezePath,
        runBudget: () => fakeBudget(Buffer.from(PUB_WARD)),
      });
      const expectedWard = sha(Buffer.from(PUB_WARD));
      const expectedRig = sha(RIG_BODY);
      // R4: returned metadata preserves consumer fields.
      expect(result.assetSha256).toBe(expectedWard);
      expect(result.rigSha256).toBe(expectedRig);
      expect(result.decodedMiB).toBe(1.5);
      const shipped = JSON.parse(readFileSync(result.shippedBudgetPath, "utf8"));
      expect(shipped.assetSha256).toBe(expectedWard);
      expect(shipped.rigSha256).toBe(expectedRig);
      expect(shipped.decodedMiB).toBe(1.5);
      expect(shipped.sha256).toBe(expectedWard);
      // R1: provenance pins published B, source A untouched.
      const prov = readFileSync(result.provenancePath, "utf8");
      expect(prov).toContain(expectedWard);
      expect(prov).not.toContain("OLD ENTRY");
      // R2: freeze pins published B; old source-only pin is rejected (differs).
      const freeze = JSON.parse(readFileSync(freezePath, "utf8"));
      expect(freeze.assetSha256ByPath[WARD_REL]).toBe(expectedWard);
      const oldPin = computeSupineControlFreeze(fx.sourceRoot);
      expect(oldPin.assetSha256ByPath[WARD_REL]).toBe(sha(Buffer.from(SOURCE_WARD)));
      expect(oldPin.assetSha256ByPath[WARD_REL]).not.toBe(expectedWard);
      const after = snapshotSource(fx.sourceRoot);
      expect([...after.entries()]).toEqual([...before.entries()]);
    } finally {
      rmSync(fx.base, { recursive: true, force: true });
    }
  });

  it("R3: malformed previous budget refused BEFORE any write", () => {
    const fx = buildFixture();
    try {
      writeFileSync(path.join(fx.sourceRoot, "docs/openclinxr/room-realism/ship-ward-room/shipped-budget.json"),
        JSON.stringify({ noImages: true }));
      expect(() => shipWardProvenance({
        publicationRoot: fx.publicationRoot,
        sourceRoot: fx.sourceRoot,
        outDir: path.join(fx.publicationRoot, "ship-ward-room"),
        chainDir: path.join(fx.publicationRoot, "chain"),
        freezeRecordPath: path.join(fx.publicationRoot, "freeze-record.json"),
        runBudget: () => fakeBudget(Buffer.from(PUB_WARD)),
      })).toThrow(/required images\[\] contract/);
      expect(existsSync(path.join(fx.publicationRoot, "ship-ward-room", "shipped-budget.json"))).toBe(false);
      expect(existsSync(path.join(fx.publicationRoot, "freeze-record.json"))).toBe(false);
      expect(readSupineControlFreeze(fx.publicationRoot)).toBeNull();
    } finally {
      rmSync(fx.base, { recursive: true, force: true });
    }
  });

  it("negative: chain mismatch throws and writes nothing", () => {
    const fx = buildFixture();
    try {
      writeFileSync(path.join(fx.publicationRoot, "chain", "infinigen-inpatient-ward.chain.glb"), Buffer.from("different-bytes"));
      const before = snapshotSource(fx.sourceRoot);
      expect(() => shipWardProvenance({
        publicationRoot: fx.publicationRoot,
        sourceRoot: fx.sourceRoot,
        outDir: path.join(fx.publicationRoot, "ship-ward-room"),
        chainDir: path.join(fx.publicationRoot, "chain"),
        freezeRecordPath: path.join(fx.publicationRoot, "freeze-record.json"),
        runBudget: () => fakeBudget(Buffer.from(PUB_WARD)),
      })).toThrow(/Runtime bytes must equal the chain outputs/);
      expect(existsSync(path.join(fx.publicationRoot, "ship-ward-room", "shipped-budget.json"))).toBe(false);
      expect(existsSync(path.join(fx.publicationRoot, "freeze-record.json"))).toBe(false);
      const after = snapshotSource(fx.sourceRoot);
      expect([...after.entries()]).toEqual([...before.entries()]);
      expect(readSupineControlFreeze(fx.publicationRoot)).toBeNull();
    } finally {
      rmSync(fx.base, { recursive: true, force: true });
    }
  });
});
