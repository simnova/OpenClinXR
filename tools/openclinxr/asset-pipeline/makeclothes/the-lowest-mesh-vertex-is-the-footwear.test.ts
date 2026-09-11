/**
 * HB-01: the lowest mesh vertex is the footwear.
 *
 * Reads the shipped GLB bytes in apps/ui-xr/public/generated-humanoids with
 * glTF-Transform NodeIO, computes per-primitive world minY (glTF up is +Y;
 * the card names Blender-scene bmin.z, same sole), and asserts the global
 * minimum-Y primitive belongs to the footwear mesh — or the audit names the
 * exception with a reason.
 *
 * Counterweight: asserts the audit covers every .glb on disk, so the clause
 * cannot pass on an audit of one body.
 *
 * Diagnosis (IMMUTABLE): the published still floated 158 px because
 * world_mesh_bounds() in finished_figure_grade.py included the unparented
 * MPFB Icosphere at z=-1 (Blender scene, fixed in 8f615ceb). This test nets
 * the remaining question: whether any helper is EXPORTED into a shipped GLB.
 *
 * NOT TESTED: Blender-side bounds, grade render pixels, colour findings.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { NodeIO } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";

const GLB_DIR = "apps/ui-xr/public/generated-humanoids";
const AUDIT_PATH = "docs/openclinxr/humanoid-lowest-vertex-audit-2026-09-10.json";

interface AuditBody {
  file: string;
  globalIsFootwear: boolean;
  exceptionReason: string | null;
}

async function lowestPerPrimitive(glbPath: string) {
  const doc = await new NodeIO().read(glbPath);
  const rows: { mesh: string; minY: number; footwear: boolean }[] = [];
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const w = node.getWorldMatrix();
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute("POSITION");
      if (!pos) continue;
      const arr = pos.getArray();
      if (!arr) continue;
      let mn = Infinity;
      for (let i = 0; i + 2 < arr.length; i += 3) {
        const wy = w[1]! * arr[i]! + w[5]! * arr[i + 1]! + w[9]! * arr[i + 2]! + w[13]!;
        if (wy < mn) mn = wy;
      }
      const name = mesh.getName();
      rows.push({ mesh: name, minY: mn, footwear: /footwear/i.test(name) });
    }
  }
  return rows;
}

describe("the lowest mesh vertex is the footwear", () => {
  it("audit covers every .glb on disk (counterweight)", () => {
    const onDisk = readdirSync(GLB_DIR).filter((f: string) => f.endsWith(".glb")).sort();
    expect(onDisk.length).toBeGreaterThan(0);
    const audit = JSON.parse(readFileSync(AUDIT_PATH, "utf8")) as {
      glbCount: number;
      glbFiles: string[];
      bodies: AuditBody[];
    };
    expect(audit.glbFiles.slice().sort()).toEqual(onDisk);
    expect(audit.bodies.length).toBe(onDisk.length);
  });

  it("global minimum-Y mesh is footwear, or the audit names the exception", async () => {
    const audit = JSON.parse(readFileSync(AUDIT_PATH, "utf8")) as { bodies: AuditBody[] };
    const byFile = new Map(audit.bodies.map((b) => [b.file, b]));
    const onDisk = readdirSync(GLB_DIR).filter((f: string) => f.endsWith(".glb")).sort();
    for (const f of onDisk) {
      const rows = await lowestPerPrimitive(join(GLB_DIR, f));
      const live = rows.filter((r) => r.minY !== Infinity).sort((a, b) => a.minY - b.minY)[0];
      expect(live, `${f}: no POSITION geometry`).toBeDefined();
      const entry = byFile.get(f);
      expect(entry, `${f}: missing from audit`).toBeDefined();
      if (live!.footwear) {
        expect(entry!.globalIsFootwear).toBe(true);
      } else {
        expect(entry!.globalIsFootwear).toBe(false);
        expect(entry!.exceptionReason, `${f}: exception needs a reason`).toBeTruthy();
      }
    }
  }, 120000);
});
