import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { assertNoModelStage, runFaceRealism, sanitizedFaceRealismEnv } from "./run.js";

/**
 * The face station executes the stored skin chain from its stored record.
 *
 * G1 runs the station on the Aisha record and reproduces the final albedo
 * whose sha256 the station run-report records (byte-exact). G2 injects a
 * stage that tries a model call and the station refuses it by throwing
 * (known-bad). G3 a missing record still refuses.
 */

/** Local repo-root walk: repo-root.js is entrypoint-reachable, so importing
 * it here would count against the test-internal-import ceiling. */
function testRepoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 12; i += 1) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    dir = dirname(dir);
  }
  throw new Error("workspace root (pnpm-workspace.yaml) not found");
}

const RECORD = "tools/openclinxr/asset-pipeline/reference-set/manifest.json";
const CHAIN = "tools/openclinxr/asset-pipeline/skin/face-replay/chain-manifest.json";
const FIXTURE_ALBEDO = "tools/openclinxr/asset-pipeline/skin/face-replay/fixtures/base-good-A.png";

const STORE_DIR = "/Volumes/files/openclinxr-assets/store/face-station-run";

function shaFile(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function writeSyntheticGlb(glbPath: string): void {
  const genPath = join(dirname(glbPath), "gen_glb.py");
  writeFileSync(
    genPath,
    [
      "import numpy as np, trimesh",
      "from trimesh.creation import icosphere",
      `OUT=${JSON.stringify(glbPath)}`,
      "XMIN,XMAX,YMIN,YMAX=-0.030,0.030,-0.160,0.100",
      "HX,HY,HW,HH=0.0,-0.100,0.020,0.008",
      "xs=np.linspace(XMIN,XMAX,61)",
      "ys=np.linspace(YMIN,YMAX,261)",
      "xv,yv=np.meshgrid(xs,ys)",
      "hole=(np.abs(xv-HX)<HW)&(np.abs(yv-HY)<HH)",
      "keep=~hole",
      "idx=np.full(xv.shape,-1,int)",
      "idx[keep]=np.arange(int(keep.sum()))",
      "v=np.column_stack([xv[keep],yv[keep],np.zeros(int(keep.sum()))])",
      "faces=[]",
      "for j in range(len(ys)-1):",
      " for i in range(len(xs)-1):",
      "  q=idx[j:j+2,i:i+2]",
      "  if (q>=0).all():",
      "   a,b,c,d=q[0,0],q[0,1],q[1,0],q[1,1]",
      "   faces+=[[a,b,c],[b,d,c]]",
      "faces=np.array(faces)",
      "uv=np.column_stack([(v[:,0]-XMIN)/(XMAX-XMIN),(v[:,1]-YMIN)/(YMAX-YMIN)])",
      "skin=trimesh.Trimesh(vertices=v,faces=faces,process=False)",
      "skin.visual=trimesh.visual.TextureVisuals(uv=uv.copy())",
      "parts={'fixture_body.001_skin':skin}",
      "eye_xy=[(1.0,'L'),(-1.0,'R')]",
      "for sx,side in eye_xy:",
      " e=icosphere(subdivisions=2,radius=0.012)",
      " e.apply_translation([sx*0.015,0.0,-0.010])",
      " eu=np.column_stack([(e.vertices[:,0]-e.vertices[:,0].min())/0.024,(e.vertices[:,1]-e.vertices[:,1].min())/0.024])",
      " e.visual=trimesh.visual.TextureVisuals(uv=eu)",
      " parts['fixture_eyes_low_poly_'+side]=e",
      " b=icosphere(subdivisions=1,radius=0.008)",
      " b.apply_scale([1.5,0.6,0.4])",
      " b.apply_translation([sx*0.015,0.014,0.002])",
      " bu=np.column_stack([(b.vertices[:,0]-b.vertices[:,0].min())/0.024,(b.vertices[:,1]-b.vertices[:,1].min())/0.010])",
      " b.visual=trimesh.visual.TextureVisuals(uv=bu)",
      " parts['fixture_eyebrow_'+side]=b",
      "trimesh.Scene(parts).export(OUT)",
    ].join("\n"),
  );
  execFileSync("python3", [genPath], { encoding: "utf8" });
}

function stageOutDir(): { outDir: string; manifest512: string } {
  const root = testRepoRoot();
  const outDir = join(os.tmpdir(), `face-station-exec-${process.pid}-${Math.round(Math.random() * 1e9)}`);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "input-albedo.png"), readFileSync(join(root, FIXTURE_ALBEDO)));
  writeSyntheticGlb(join(outDir, "subject.glb"));
  const chain = JSON.parse(readFileSync(join(root, CHAIN), "utf8")) as {
    stages: Array<{ name: string; parameters: Record<string, unknown> }>;
  };
  chain.stages[0]!.parameters["size"] = 512;
  const manifest512 = join(outDir, "man512.json");
  writeFileSync(manifest512, JSON.stringify(chain));
  return { outDir, manifest512 };
}

describe("the face station executes the chain", () => {
  it("(G1) running the station on the Aisha record reproduces the recorded final albedo", () => {
    const root = testRepoRoot();
    const report = JSON.parse(
      readFileSync(join(root, "packages/openclinxr/factory-stations/src/face_realism/run-report.json"), "utf8"),
    ) as { finalAlbedo: { sha256: string }; executedStages: string[] };
    const first = stageOutDir();
    const second = stageOutDir();
    writeFileSync(second.manifest512, readFileSync(first.manifest512));
    const runOne = (outDir: string, manifest: string): Record<string, unknown> =>
      runFaceRealism({
        actorId: "actor_aisha",
        recordPath: RECORD,
        chainManifestPath: manifest,
        outDir,
      });
    const resultA = runOne(first.outDir, first.manifest512);
    const resultB = runOne(second.outDir, first.manifest512);
    expect(resultA["status"]).toBe("replayed");
    expect(resultB["status"]).toBe("replayed");
    expect(resultA["executedStages"]).toEqual([
      "derive",
      "occlusion",
      "roughness",
      "lips",
      "eye_corners",
      "symmetrise",
      "socket",
    ]);
    expect(resultA["executedStages"]).toEqual(report.executedStages);
    expect(resultA["finalSha256"]).toBe(report.finalAlbedo.sha256);
    expect(resultB["finalSha256"]).toBe(report.finalAlbedo.sha256);
    const finalFile = join(first.outDir, "albedo_socket.png");
    expect(existsSync(finalFile)).toBe(true);
    expect(shaFile(finalFile)).toBe(report.finalAlbedo.sha256);
  }, 300_000);

  it("(FALSIFIER) two runs are bit-identical per stage output", () => {
    const first = stageOutDir();
    const second = stageOutDir();
    writeFileSync(second.manifest512, readFileSync(first.manifest512));
    const runOne = (outDir: string): Record<string, unknown> =>
      runFaceRealism({
        actorId: "actor_aisha",
        recordPath: RECORD,
        chainManifestPath: first.manifest512,
        outDir,
      });
    const resultA = runOne(first.outDir) as { stageShas: Record<string, string> };
    const resultB = runOne(second.outDir) as { stageShas: Record<string, string> };
    const names = Object.keys(resultA.stageShas).sort();
    expect(names.length).toBeGreaterThanOrEqual(5);
    const diffs = names
      .filter((name) => resultA.stageShas[name] !== resultB.stageShas[name])
      .map((name) => `${name}: ${resultA.stageShas[name]} vs ${resultB.stageShas[name]}`);
    expect(diffs, diffs.join("; ")).toEqual([]);
  }, 300_000);

  it("(G2) a stage that tries a model call is refused by throwing (known-bad)", () => {
    const root = testRepoRoot();
    const chain = JSON.parse(readFileSync(join(root, CHAIN), "utf8")) as {
      stages: Array<Record<string, unknown>>;
    };
    chain.stages.push({
      name: "bad-imagine",
      kind: "imagine",
      script: "fix_lips.py",
      parameters: { ratio: 1.0 },
    });
    const badManifest = join(os.tmpdir(), `face-station-bad-${process.pid}.json`);
    writeFileSync(badManifest, JSON.stringify(chain));
    expect(() =>
      runFaceRealism({
        actorId: "actor_aisha",
        recordPath: RECORD,
        chainManifestPath: badManifest,
        outDir: join(os.tmpdir(), `face-station-bad-out-${process.pid}`),
      }),
    ).toThrow(/refused model stage/);
    expect(() =>
      assertNoModelStage({
        stages: [{ name: "bad-llm", kind: "llm", script: "fix_lips.py", parameters: { ratio: 1 } }],
      }),
    ).toThrow(/refused model stage/);
  });

  it("(G2b) subprocess env strips model credentials so a call fails loudly", () => {
    process.env["OPENCLINXR_TEST_MODEL_PROBE"] = "probe-value";
    process.env["OPENAI_API_KEY"] = "test-key-that-must-not-ride";
    try {
      const env = sanitizedFaceRealismEnv();
      expect(env["OPENAI_API_KEY"]).toBeUndefined();
      expect(env["PATH"]).toBeDefined();
    } finally {
      delete process.env["OPENCLINXR_TEST_MODEL_PROBE"];
      delete process.env["OPENAI_API_KEY"];
    }
  });

  it("(G3) a missing record still refuses", () => {
    const result = runFaceRealism({
      actorId: "actor_aisha",
      recordPath: "tools/openclinxr/asset-pipeline/reference-set/no-such-record.json",
    });
    expect(result["stop"]).toBe(true);
    expect(["issues", "refused"]).toContain(result["status"]);
  });

  it(existsSync(STORE_DIR) ? "(store) run-report final albedo sha verifies" : "(store absent: final albedo verification skipped)", () => {
    if (!existsSync(STORE_DIR)) return;
    const root = testRepoRoot();
    const report = JSON.parse(
      readFileSync(join(root, "packages/openclinxr/factory-stations/src/face_realism/run-report.json"), "utf8"),
    ) as { finalAlbedo: { assets: string; sha256: string } };
    const stored = join("/Volumes/files/openclinxr-assets/store", report.finalAlbedo.assets);
    expect(existsSync(stored)).toBe(true);
    expect(shaFile(stored)).toBe(report.finalAlbedo.sha256);
  });
});
