/** Portable unit for seat-teeth-ff1-open08: synthetic fixtures + tmp files only. */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { Document } from "@gltf-transform/core";
import {
  applyTeethFf1Open08,
  CLOSED_GAIN,
  OPEN_GAIN,
  seatTeethFf1Open08,
} from "./seat-teeth-ff1-open08.js";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const MODULE_ABS = resolve(HERE, "seat-teeth-ff1-open08.ts");
const NAMES = ["viseme_aa", "viseme_E", "viseme_I", "viseme_O", "viseme_U", "viseme_FF", "viseme_PP"];
const OPEN = new Set(NAMES.slice(0, 5));

function fixture(names: string[] = NAMES): { doc: Document; base: Float32Array; deltas: Map<string, Float32Array> } {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const base = new Float32Array([0, 1.5, 0.1, 0.01, 1.48, 0.12]);
  const mk = (arr: Float32Array): ReturnType<Document["createAccessor"]> =>
    doc.createAccessor().setType("VEC3").setArray(arr).setBuffer(buffer);
  const mesh = doc.createMesh("openclinxr_fitted_teeth_test");
  mesh.setExtras({ targetNames: names });
  const prim = doc.createPrimitive().setAttribute("POSITION", mk(base.slice()));
  mesh.addPrimitive(prim);
  const deltas = new Map<string, Float32Array>();
  names.forEach((nm, i) => {
    const d = new Float32Array([0, -(0.001 + i * 0.0007), 0.0002 * (i + 1), 0, -(0.0008 + i * 0.0005), 0.0001 * (i + 1)]);
    deltas.set(nm, d);
    const target = doc.createPrimitiveTarget();
    target.setAttribute("POSITION", mk(d.slice()));
    prim.addTarget(target);
  });
  return { doc, base, deltas };
}

function teethPrim(doc: Document): ReturnType<Document["createPrimitive"]> {
  const mesh = doc.getRoot().listMeshes().find((m) => /fitted_teeth/i.test(m.getName() ?? ""))!;
  return mesh.listPrimitives()[0]!;
}

describe("seat-teeth-ff1-open08", () => {
  it("keeps FF/PP deltas bitwise identical and scales open vowels exactly x0.8", () => {
    const { doc, base, deltas } = fixture();
    const perTarget = applyTeethFf1Open08(doc);
    const prim = teethPrim(doc);
    const out = prim.getAttribute("POSITION")!.getArray() as Float32Array;
    for (let v = 0; v < 2; v++) {
      expect(out[v * 3]).toBe(base[v * 3]);
      expect(out[v * 3 + 1]).toBeCloseTo(base[v * 3 + 1]! + 0.00312, 6);
      expect(out[v * 3 + 2]).toBeCloseTo(base[v * 3 + 2]! + 0.00016, 6);
    }
    NAMES.forEach((nm, i) => {
      const target = prim.listTargets()[i];
      if (!target) throw new Error(`missing fixture target ${nm}`);
      const live = target.getAttribute("POSITION").getArray() as Float32Array;
      const want = deltas.get(nm)!;
      if (OPEN.has(nm)) {
        expect(perTarget[nm]).toBe(OPEN_GAIN);
        expect(Array.from(live)).not.toEqual(Array.from(want));
        for (let k = 0; k < live.length; k++) {
          expect(live[k]).toBeCloseTo(want[k]! * 0.8, 7);
        }
      } else {
        expect(perTarget[nm]).toBe(CLOSED_GAIN);
        expect(Array.from(live)).toEqual(Array.from(want));
      }
    });
  });

  it("rejects unexpected teeth targetNames without touching anything", () => {
    const { doc } = fixture([...NAMES.slice(0, 6), "viseme_CH"]);
    expect(() => applyTeethFf1Open08(doc)).toThrow(/unexpected teeth targetNames/);
  });

  it("refuses an input whose sha differs from the pinned original", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ff1-"));
    const bad = join(dir, "bad.glb");
    const out = join(dir, "out.glb");
    writeFileSync(bad, Buffer.from("not a pinned asset"));
    await expect(seatTeethFf1Open08(bad, out)).rejects.toThrow(/input sha .* != pinned/);
    expect(existsSync(out)).toBe(false);
  });

  it("refuses to clobber an existing output before doing any work", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ff1-"));
    const bad = join(dir, "bad.glb");
    const out = join(dir, "out.glb");
    writeFileSync(bad, Buffer.from("not a pinned asset"));
    writeFileSync(out, Buffer.from("precious"));
    await expect(seatTeethFf1Open08(bad, out)).rejects.toThrow(/refusing to clobber/);
    expect(readFileSync(out, "utf8")).toBe("precious");
  });

  it("refuses an output that aliases the input", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ff1-"));
    const same = join(dir, "same.glb");
    writeFileSync(same, Buffer.from("x"));
    await expect(seatTeethFf1Open08(same, same)).rejects.toThrow(/aliases input/);
  });

  it("does not execute the CLI on import even when the outer process carries .glb args", () => {
    const dir = mkdtempSync(join(tmpdir(), "ff1-"));
    const loader = join(dir, "loader.mts");
    writeFileSync(
      loader,
      `process.argv.push("a.glb", "b.glb");\nawait import(${JSON.stringify(MODULE_ABS)});\nconsole.log("IMPORT_SAFE");\n`,
    );
    const stdout = execFileSync("npx", ["tsx", loader], { cwd: HERE, encoding: "utf8" });
    expect(stdout).toContain("IMPORT_SAFE");
    expect(existsSync(join(dir, "a.glb"))).toBe(false);
    expect(existsSync(join(dir, "b.glb"))).toBe(false);
  });

  it("CLI rejects flags including --dry and writes nothing", () => {
    const dir = mkdtempSync(join(tmpdir(), "ff1-"));
    const out = join(dir, "out.glb");
    let err = "";
    try {
      execFileSync("npx", ["tsx", MODULE_ABS, "in.glb", out, "--dry"], { cwd: HERE, encoding: "utf8" });
    } catch (e: unknown) {
      const ce = e as { stderr?: string; stdout?: string; message?: string };
      err = String(ce.stderr ?? "") + String(ce.stdout ?? "") + String(ce.message ?? "");
    }
    expect(err).toMatch(/unsupported flag --dry/);
    expect(existsSync(out)).toBe(false);
  });
});
