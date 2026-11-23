import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { glbGeometryDigest } from "@openclinxr/factory-station-core/runner";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { pinSternalTGeometry } from "./pin-sternal-t-geometry.js";

/**
 * Writer tests for the sternal-T geometry pin (FINALIZE-2 C3a h9 AM2, h10 F6/F7).
 * The CLI writes ONLY subjects.<key>.geometrySha256 (+ the writer field);
 * every other record field is history and must survive byte-identical.
 * Fixtures are fresh mkdtemp dirs per test, removed in afterEach: no GLB
 * copies (and no PID-named dirs) are left in os.tmpdir().
 */
const WT = join(import.meta.dirname, "..", "..", "..", "..");
const RECORD = join(WT, "tools/openclinxr/evidence/humanoid-vetting/mpfb-nurse-sternal-t-classify.json");
const ADULT = join(WT, "apps/ui-xr/public/generated-humanoids/mpfb-clinical-nurse-adult.glb");
const PEDS = join(WT, "apps/ui-xr/public/generated-humanoids/mpfb-peds-nurse-kevin.glb");
const CLI = join(WT, "tools/openclinxr/evidence/humanoid-vetting/pin-sternal-t-geometry.ts");

let FX = "";
let fxRecord = "";
let fxAdult = "";
let fxPeds = "";

beforeEach(() => {
  FX = mkdtempSync(join(tmpdir(), "h10-pin-sternal-t-"));
  fxRecord = join(FX, "classify.json");
  fxAdult = join(FX, "adult.glb");
  fxPeds = join(FX, "peds.glb");
  copyFileSync(RECORD, fxRecord);
  copyFileSync(ADULT, fxAdult);
  copyFileSync(PEDS, fxPeds);
});

afterEach(() => {
  rmSync(FX, { recursive: true, force: true });
});

/** 1-ULP edit of the first float of the first float-POSITION accessor (in a tmp copy). */
function oneUlpPositionEdit(abs: string): { beforeHex: string; afterHex: string } {
  const buf = Buffer.from(readFileSync(abs));
  const jsonLen = buf.readUInt32LE(12);
  const doc = JSON.parse(buf.subarray(20, 20 + jsonLen).toString("utf8")) as {
    meshes?: { primitives?: { attributes?: Record<string, number> }[] }[];
    accessors?: { bufferView?: number; byteOffset?: number; componentType?: number }[];
    bufferViews?: { byteOffset?: number }[];
  };
  let at = -1;
  for (const mesh of doc.meshes ?? []) {
    for (const prim of mesh.primitives ?? []) {
      const ai = prim.attributes?.["POSITION"];
      const acc = ai === undefined ? undefined : doc.accessors?.[ai];
      const bv = acc?.bufferView === undefined ? undefined : doc.bufferViews?.[acc.bufferView];
      if (acc !== undefined && bv !== undefined && acc.componentType === 5126) {
        at = 20 + jsonLen + 8 + (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0);
        break;
      }
    }
    if (at >= 0) break;
  }
  if (at < 0) throw new Error("W3 setup: no float POSITION accessor");
  const beforeHex = buf.subarray(at, at + 4).toString("hex");
  buf.writeUInt32LE(buf.readUInt32LE(at) + 1, at);
  writeFileSync(abs, buf);
  const afterHex = buf.subarray(at, at + 4).toString("hex");
  if (afterHex === beforeHex) throw new Error("W3 setup: ULP edit did not change bytes");
  return { beforeHex, afterHex };
}

describe("pin-sternal-t-geometry writer (h9 AM2, h10 F6)", () => {
  it("W1 stale pins are rewritten to the digest of the tmp GLBs", () => {
    const stale = JSON.parse(readFileSync(fxRecord, "utf8")) as {
      subjects: { adult: { geometrySha256?: string }; pedsKevin: { geometrySha256?: string } };
    };
    stale.subjects.adult.geometrySha256 = "0".repeat(64);
    stale.subjects.pedsKevin.geometrySha256 = "f".repeat(64);
    writeFileSync(fxRecord, `${JSON.stringify(stale, null, 2)}\n`);
    pinSternalTGeometry({ recordPath: fxRecord, adultGlbPath: fxAdult, pedsGlbPath: fxPeds });
    const after = JSON.parse(readFileSync(fxRecord, "utf8")) as {
      subjects: { adult: { geometrySha256?: string }; pedsKevin: { geometrySha256?: string } };
    };
    expect(after.subjects.adult.geometrySha256, "adult digest rewritten from stale").toBe(
      glbGeometryDigest(new Uint8Array(readFileSync(fxAdult))),
    );
    expect(after.subjects.pedsKevin.geometrySha256, "peds digest rewritten from stale").toBe(
      glbGeometryDigest(new Uint8Array(readFileSync(fxPeds))),
    );
  });

  it("W2 every non-geometrySha256 field is deep-equal (pre-mutated fields not repaired)", () => {
    const probe = JSON.parse(readFileSync(fxRecord, "utf8")) as Record<string, unknown>;
    (probe["notTested"] as string) = "h10 W2 probe: pre-mutated, the writer must leave it exactly as found";
    writeFileSync(fxRecord, `${JSON.stringify(probe, null, 2)}\n`);
    pinSternalTGeometry({ recordPath: fxRecord, adultGlbPath: fxAdult, pedsGlbPath: fxPeds });
    const after = JSON.parse(readFileSync(fxRecord, "utf8")) as {
      geometryPinWriter?: string;
      subjects: { adult: Record<string, unknown>; pedsKevin: Record<string, unknown> };
    };
    expect(after.geometryPinWriter, "writer field names the CLI").toBe(
      "tools/openclinxr/evidence/humanoid-vetting/pin-sternal-t-geometry.ts",
    );
    const rest = structuredClone(after) as Record<string, unknown>;
    delete rest["geometryPinWriter"];
    delete (rest["subjects"] as Record<string, Record<string, unknown>>)["adult"]!["geometrySha256"];
    delete (rest["subjects"] as Record<string, Record<string, unknown>>)["pedsKevin"]!["geometrySha256"];
    const want = structuredClone(probe) as Record<string, unknown>;
    delete want["geometryPinWriter"];
    delete (want["subjects"] as Record<string, Record<string, unknown>>)["adult"]!["geometrySha256"];
    delete (want["subjects"] as Record<string, Record<string, unknown>>)["pedsKevin"]!["geometrySha256"];
    expect(rest).toEqual(want);
  });

  it("W3 a 1-ULP POSITION edit writes the edited GLB digest (stale is detectable)", () => {
    pinSternalTGeometry({ recordPath: fxRecord, adultGlbPath: fxAdult, pedsGlbPath: fxPeds });
    const baseline = JSON.parse(readFileSync(fxRecord, "utf8")) as {
      subjects: { pedsKevin: { geometrySha256?: string } };
    };
    const { beforeHex, afterHex } = oneUlpPositionEdit(fxPeds);
    console.log("W3", { beforeHex, afterHex });
    pinSternalTGeometry({ recordPath: fxRecord, adultGlbPath: fxAdult, pedsGlbPath: fxPeds });
    const after = JSON.parse(readFileSync(fxRecord, "utf8")) as {
      subjects: { pedsKevin: { geometrySha256?: string } };
    };
    const editedDigest = glbGeometryDigest(new Uint8Array(readFileSync(fxPeds)));
    expect(afterHex, "ULP edit must change accessor bytes").not.toBe(beforeHex);
    // A deleted pin (undefined) fails this equality: the writer must record the edited digest.
    expect(after.subjects.pedsKevin.geometrySha256, "writer records the edited GLB digest").toBe(editedDigest);
    expect(after.subjects.pedsKevin.geometrySha256, "edited digest differs from the pre-edit pin").not.toBe(
      baseline.subjects.pedsKevin.geometrySha256,
    );
  });

  it.each([
    ["an unknown flag", (fx: string): string[] => ["--recrod", fx]],
    ["a duplicate flag", (fx: string): string[] => ["--record", fx, "--record", fx]],
    ["a flag without a value", (_fx: string): string[] => ["--record"]],
  ])("F7 %s exits non-zero with a usage message and writes nothing", (_label, makeArgs) => {
    const before = readFileSync(RECORD, "utf8");
    let status: number | null = null;
    let output = "";
    try {
      execFileSync("pnpm", ["exec", "tsx", CLI, ...makeArgs(fxRecord)], { cwd: WT, encoding: "utf8", stdio: "pipe" });
    } catch (error) {
      status = (error as { status?: number }).status ?? null;
      output = `${(error as { stdout?: unknown }).stdout ?? ""}${(error as { stderr?: unknown }).stderr ?? ""}${(error as Error).message ?? ""}`;
    }
    expect(status, "bad argv exits non-zero").not.toBe(0);
    expect(status, "bad argv exits non-zero").not.toBeNull();
    expect(output, "bad argv prints a usage message").toMatch(/usage/i);
    expect(readFileSync(RECORD, "utf8"), "bad argv writes nothing to the tracked record").toBe(before);
  }, 120_000);
});
