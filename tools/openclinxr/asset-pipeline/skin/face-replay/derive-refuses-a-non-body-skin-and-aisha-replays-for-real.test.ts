/**
 * Derive refuses a non-body skin and Aisha replays for real.
 *
 * load_subject (derive.py) chooses skin ONLY among body-named meshes
 * with per-vert UVs that match no role pattern (eyebrow/lash/teeth/
 * tongue/eye/clothing): split body primitives merge only when they
 * partition one surface on one UV atlas (pairwise 3D-bbox-disjoint and
 * UV IoU < 0.05), else the largest body primitive wins. It REFUSES with
 * NO_BODY_SKIN_MESH when no body mesh qualifies (too few faces for
 * 4096px derivation, or no mouth hole loop) or no body mesh exists --
 * so the decimated runtime LOD (eyebrow card largest) hits the named
 * refusal instead of the mouth-hole assert. aisha-real-chain-report.json
 * pins the evidence: G2 derive table (base.glb reproduces S/derive/A),
 * G3 byte-identical real chain with/without the beard stage, G4
 * polygon-measured beard-weight sweep.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:path";
import osp from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const REPORT = path.join(DIR, "aisha-real-chain-report.json");
const MANIFEST = path.join(DIR, "chain-manifest.json");

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

function expectRefusal(glb: string): string {
  const raw = (() => {
    try {
      loadSubject(glb);
    } catch (e) {
      return String((e as { message?: string }).message ?? e);
    }
    return "NO-REFUSAL";
  })();
  expect(raw).toContain("NO_BODY_SKIN_MESH");
  return raw;
}

function writeSyntheticGLB(tmpDir: string, opts: {
  bodyName: string | null; bodyGrid: number; mouthHole: boolean;
  browGrid: number;
}): string {
  const glbPath = path.join(tmpDir, "subject.glb");
  const genPath = path.join(tmpDir, "gen_glb.py");
  fs.writeFileSync(genPath, [
    "import numpy as np, trimesh",
    "from trimesh.creation import icosphere",
    `OUT=${JSON.stringify(glbPath)}`,
    `BODY=${opts.bodyName === null ? "None" : JSON.stringify(opts.bodyName)}`,
    `N=${opts.bodyGrid}`,
    `HOLE=${opts.mouthHole ? "True" : "False"}`,
    `B=${opts.browGrid}`,
    "parts={}",
    "if BODY is not None:",
    " xs=np.linspace(-0.030,0.030,N)",
    " ys=np.linspace(-0.160,0.100,N)",
    " xv,yv=np.meshgrid(xs,ys)",
    " hole=(np.abs(xv)<0.020)&(np.abs(yv+0.100)<0.008) if HOLE else np.zeros_like(xv,bool)",
    " keep=~hole",
    " idx=np.full(xv.shape,-1,int)",
    " idx[keep]=np.arange(int(keep.sum()))",
    " v=np.column_stack([xv[keep],yv[keep],np.zeros(int(keep.sum()))])",
    " faces=[]",
    " for j in range(N-1):",
    "  for i in range(N-1):",
    "   q=idx[j:j+2,i:i+2]",
    "   if (q>=0).all():",
    "    a,b,c,d=q[0,0],q[0,1],q[1,0],q[1,1]",
    "    faces+=[[a,b,c],[b,d,c]]",
    " faces=np.array(faces)",
    " uv=np.column_stack([(v[:,0]+0.030)/0.060,(v[:,1]+0.160)/0.260])",
    " skin=trimesh.Trimesh(vertices=v,faces=faces,process=False)",
    " skin.visual=trimesh.visual.TextureVisuals(uv=uv.copy())",
    " parts[BODY]=skin",
    "xb=np.linspace(-0.030,0.030,B)",
    "yb=np.linspace(0.0,0.030,B)",
    "xg,yg=np.meshgrid(xb,yb)",
    "vg=np.column_stack([xg.ravel(),yg.ravel(),np.full(B*B,0.05)])",
    "fg=[]",
    "for j in range(B-1):",
    " for i in range(B-1):",
    "  a=j*B+i; fg+=[[a,a+1,a+B],[a+1,a+B+1,a+B]]",
    "brow=trimesh.Trimesh(vertices=vg,faces=np.array(fg),process=False)",
    "bu=np.column_stack([(vg[:,0]+0.030)/0.060,vg[:,1]/0.030])",
    "brow.visual=trimesh.visual.TextureVisuals(uv=bu)",
    "parts['fixture_eyebrow_test']=brow",
    "trimesh.Scene(parts).export(OUT)",
    "print('wrote',OUT)",
  ].join("\n"));
  execFileSync("python3", [genPath], { encoding: "utf8" });
  return glbPath;
}

describe("derive refuses a non-body skin", { timeout: 240000 }, () => {
  it("an eyebrow-named mesh larger than a body-named one never wins skin", () => {
    const tmp = fs.mkdtempSync(osp.tmpdir() + "/refuse-bigbrow-");
    // body 61x61 (~7k faces, below the 20k floor) with a mouth hole,
    // eyebrow 200x200 (80k faces): size must not elect the eyebrow.
    const glb = writeSyntheticGLB(tmp, {
      bodyName: "fixture_body_test", bodyGrid: 61, mouthHole: true,
      browGrid: 200,
    });
    const raw = expectRefusal(glb);
    expect(raw).toContain("NO_BODY_SKIN_MESH");
  });

  it("a full-size body without a mouth hole loop is refused", () => {
    const tmp = fs.mkdtempSync(osp.tmpdir() + "/refuse-noloop-");
    // body 121x121 (~28k faces, above the floor) but closed lips:
    // the loop leg fires, not the size leg.
    const glb = writeSyntheticGLB(tmp, {
      bodyName: "fixture_body_test", bodyGrid: 121, mouthHole: false,
      browGrid: 20,
    });
    const raw = expectRefusal(glb);
    expect(raw).toContain("no mouth hole loop");
  });

  it("a GLB with no body mesh is refused", () => {
    const tmp = fs.mkdtempSync(osp.tmpdir() + "/refuse-nobody-");
    const glb = writeSyntheticGLB(tmp, {
      bodyName: null, bodyGrid: 61, mouthHole: true, browGrid: 60,
    });
    expectRefusal(glb);
  });

  it("a qualifying body is still selected when the eyebrow is smaller", () => {
    const tmp = fs.mkdtempSync(osp.tmpdir() + "/refuse-okbody-");
    // body 121x121 with mouth hole (~27k faces, no ".001" in the name):
    // passes floor + loop, eyebrow 200x200 is larger and must still lose.
    const glb = writeSyntheticGLB(tmp, {
      bodyName: "fixture_body_v1", bodyGrid: 121, mouthHole: true,
      browGrid: 200,
    });
    expect(loadSubject(glb)).toContain("fixture_body_v1");
  });
});

describe("aisha replays for real (aisha-real-chain-report.json)", { timeout: 240000 }, () => {
  it("G2: base.glb reproduces S/derive/A, LOD is refused", () => {
    const rep = JSON.parse(fs.readFileSync(REPORT, "utf8")) as {
      G2_derive_table: {
        candidates: Record<string, {
          differing: string[]; verdict: string; mouth_loop_n: number | null;
        }>;
      };
    };
    const cands = rep.G2_derive_table.candidates;
    expect(cands["S/eyefinal/base.glb"]!.differing).toEqual([]);
    expect(cands["S/eyefinal/base.glb"]!.mouth_loop_n).toBe(188);
    expect(cands["S/regen3/aisha-ref3.glb"]!.differing.length)
      .toBeGreaterThan(0);
    expect(cands["apps/ui-xr/public/generated-humanoids/mpfb-ob-patient-aisha.glb"]!.verdict)
      .toContain("NO_BODY_SKIN_MESH");
  });

  it("G3: with-beard and no-beard shas are equal, beard == socket", () => {
    const rep = JSON.parse(fs.readFileSync(REPORT, "utf8")) as {
      G3_real_chain: {
        common_outputs_byte_identical: string[];
        output_shas_with_beard: Record<string, string>;
        albedo_beard_equals_albedo_socket: boolean;
      };
    };
    const g3 = rep.G3_real_chain;
    expect(g3.common_outputs_byte_identical.length).toBeGreaterThanOrEqual(20);
    expect(g3.output_shas_with_beard["albedo_beard.png"])
      .toBe(g3.output_shas_with_beard["albedo_socket.png"]);
    expect(g3.albedo_beard_equals_albedo_socket).toBe(true);
  });

  it("G4: polygon sweep picks 0.9 and the manifest records it", () => {
    const rep = JSON.parse(fs.readFileSync(REPORT, "utf8")) as {
      G4_polygon_sweep: {
        chosen_weight: number;
        max_abs_dlab_vs_goal: Record<string, number>;
      };
    };
    expect(rep.G4_polygon_sweep.chosen_weight).toBe(0.9);
    const table = rep.G4_polygon_sweep.max_abs_dlab_vs_goal;
    const best = Object.entries(table).sort((a, b) => a[1] - b[1])[0]![0];
    expect(Number(best)).toBe(0.9);
    const manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf8")) as {
      subjects: Record<string, {
        glb_sha256: string;
        overrides: Record<string, Record<string, number>>;
      }>;
    };
    expect(manifest.subjects["aisha"]!.glb_sha256)
      .toBe("2be4b0980beb612d9a18dcb3093d3969a1d4c04cf70119ab588d7de998a38d5f");
    expect(manifest.subjects["adult_male_street_casual"]!
      .overrides["beard_shadow"]!["weight"]).toBe(0.9);
  });
});
