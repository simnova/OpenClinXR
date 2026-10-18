/**
 * The skin chain takes the child case (tsk_0f87f7ced81c2849, F8).
 *
 * The 20000-face floor (derive.py SKIN_MIN_FACES) refused the shipped
 * child input (mpfb_peds_patient_child_body, 19802 faces) while nearly
 * admitting it: the input is a 4.00x decimation (79240/19802) of the same
 * body that ships full-topology at 79240 faces (identical bboxes), so the
 * floor cannot tell decimated from full. derive.py now qualifies skin by
 * the property the floor stood for -- face-region mesh density (faces per
 * m2 of 3D face area over a stature-scaled window), threshold 400000
 * faces/m2: above the decimated input (211799) and the runtime LOD
 * (36419), below the full subjects (Aisha 590146, body2 618663, dense
 * child 867489). child-inputs-report.json pins every number.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:path";
import osp from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const REPORT = path.join(DIR, "child-inputs-report.json");
const LOD = path.join(
  DIR, "..", "..", "..", "..", "..",
  "apps", "ui-xr", "public", "generated-humanoids",
  "mpfb-ob-patient-aisha.glb",
);

function loadSubject(glb: string): string {
  return execFileSync("python3", ["-c", [
    "import sys",
    `sys.path.insert(0, ${JSON.stringify(DIR)})`,
    "from pathlib import Path",
    "import derive",
    `r = derive.load_subject(Path(${JSON.stringify(glb)}))`,
    "print(r['skin'][3] + ' faces=' + str(len(r['skin'][1])))",
  ].join("\n")], { encoding: "utf8" });
}

function refusalOf(glb: string): string {
  try {
    loadSubject(glb);
  } catch (e) {
    return String((e as { message?: string }).message ?? e);
  }
  return "NO-REFUSAL";
}

/** Same face-like relief patch at two resolutions: dense passes, 4x-coarse refuses. */
function writeReliefGLB(tmpDir: string, n: number): string {
  const glbPath = path.join(tmpDir, "subject.glb");
  const genPath = path.join(tmpDir, "gen_glb.py");
  fs.writeFileSync(genPath, [
    "import numpy as np, trimesh",
    `OUT=${JSON.stringify(glbPath)}`,
    `N=${n}`,
    "xs=np.linspace(-0.090,0.090,N)",
    "ys=np.linspace(1.350,1.660,N)",
    "xv,yv=np.meshgrid(xs,ys)",
    "hole=(np.abs(xv)<0.020)&(np.abs(yv-1.450)<0.008)",
    "keep=~hole",
    "idx=np.full(xv.shape,-1,int)",
    "idx[keep]=np.arange(int(keep.sum()))",
    "zv=0.012*np.exp(-(((xv-0.0)/0.015)**2+((yv-1.560)/0.020)**2))",
    "v=np.column_stack([xv[keep],yv[keep],zv[keep]])",
    "faces=[]",
    "for j in range(N-1):",
    " for i in range(N-1):",
    "  q=idx[j:j+2,i:i+2]",
    "  if (q>=0).all():",
    "   a,b,c,d=q[0,0],q[0,1],q[1,0],q[1,1]",
    "   faces+=[[a,b,c],[b,d,c]]",
    "faces=np.array(faces)",
    "uv=np.column_stack([(xv[keep]+0.090)/0.180,(yv[keep]-1.350)/0.310])",
    "skin=trimesh.Trimesh(vertices=v,faces=faces,process=False)",
    "skin.visual=trimesh.visual.TextureVisuals(uv=uv.copy())",
    "trimesh.Scene({'fixture_body_childlike': skin}).export(OUT)",
    "print('wrote',OUT)",
  ].join("\n"));
  execFileSync("python3", [genPath], { encoding: "utf8" });
  return glbPath;
}

describe("the skin chain takes the child case", { timeout: 240000 }, () => {
  it("child-inputs-report.json pins the property, threshold, and route", () => {
    const rep = JSON.parse(fs.readFileSync(REPORT, "utf8")) as {
      property: string; threshold_faces_per_m2: number;
      falsifier: { fires: boolean; face_ratio: number };
      subjects: Record<string, {
        faces_per_m2: number; verdict: string; mouth_loop_n: number | null;
      }>;
      route: { denser_mesh: string; denser_verdict: string };
    };
    expect(rep.property).toContain("faces/m");
    expect(rep.falsifier.fires).toBe(true);
    expect(rep.falsifier.face_ratio).toBeCloseTo(4.0, 1);
    const t = rep.threshold_faces_per_m2;
    expect(rep.subjects["runtime_lod"]!.faces_per_m2).toBeLessThan(t);
    expect(rep.subjects["child_input"]!.faces_per_m2).toBeLessThan(t);
    expect(rep.subjects["aisha"]!.faces_per_m2).toBeGreaterThan(t);
    expect(rep.subjects["body2"]!.faces_per_m2).toBeGreaterThan(t);
    expect(rep.subjects["child_dense"]!.faces_per_m2).toBeGreaterThan(t);
    expect(rep.subjects["child_input"]!.verdict).toContain("NO_BODY_SKIN_MESH");
    expect(rep.route.denser_verdict).toContain("faces=");
  });

  it("a synthetic decimated fixture refuses on the measured property, not a face count", () => {
    const tmp = fs.mkdtempSync(osp.tmpdir() + "/child-decimated-");
    const glb = writeReliefGLB(tmp, 25);
    const raw = refusalOf(glb);
    expect(raw).toContain("NO_BODY_SKIN_MESH");
    expect(raw).toContain("faces/m");
    expect(raw).not.toContain("20000");
  });

  it("the same synthetic patch at full resolution still passes", () => {
    const tmp = fs.mkdtempSync(osp.tmpdir() + "/child-full-");
    const glb = writeReliefGLB(tmp, 121);
    expect(loadSubject(glb)).toContain("fixture_body_childlike");
  });

  it("the runtime LOD still refuses with the property-named reason", () => {
    const raw = refusalOf(LOD);
    expect(raw).toContain("NO_BODY_SKIN_MESH");
    expect(raw).toContain("faces/m");
  });
});
