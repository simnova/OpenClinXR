/**
 * Recapture the parent AA still through applyDialogueVisemeTimelineToRoot.
 *
 * Head focus, 1280x960, phoneme AA at progress 0. The applier resolves
 * viseme_AA to viseme_aa and does not write mouth-open to 1.
 *
 * Run: pnpm exec tsx tools/openclinxr/evidence/parent-fitted-teeth/recapture-aa.ts
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createLocalComputeServices } from "@openclinxr/service-local-compute";
import type { Page } from "../lib/slotted-playwright.js";
import { spawnPortlessDevServer, stopPortlessDevServer, type PortlessDevServer } from "../lib/portless-server.js";
import { regionLuminance } from "../lib/png-region-luminance.js";

type HeadlessBrowser = {
  newPage(options: { viewport: { width: number; height: number }; deviceScaleFactor?: number }): Promise<Page>;
};

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../../../..");
const GLB_URL = "/generated-humanoids/mpfb-peds-parent-aisha.glb";
const GLB_DISK = path.join(REPO, "apps/ui-xr/public/generated-humanoids/mpfb-peds-parent-aisha.glb");
const STILL = path.join(HERE, "aa.png");
const SIDECAR = path.join(HERE, "aa.json");
const VIEW_W = 1280;
const VIEW_H = 960;

function sha256(bytes: Buffer | Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function readGlbJson(filePath: string): {
  meshes: { name?: string; primitives: { indices?: number }[] }[];
  accessors: { count: number }[];
} {
  const file = readFileSync(filePath);
  const jsonLength = file.readUInt32LE(12);
  return JSON.parse(file.subarray(20, 20 + jsonLength).toString("utf8"));
}

function triangleCount(json: ReturnType<typeof readGlbJson>, meshName: string): number {
  const mesh = json.meshes.find((item) => item.name === meshName);
  const index = mesh?.primitives[0]?.indices;
  if (mesh === undefined || index === undefined) throw new Error(`no triangles for ${meshName}`);
  return (json.accessors[index]?.count ?? 0) / 3;
}

function esbuildBin(): string {
  const root = path.join(REPO, "node_modules/.pnpm");
  const dir = readdirSync(root).find((name) => name.startsWith("esbuild@"));
  if (!dir) throw new Error("esbuild is not installed");
  return path.join(root, dir, "node_modules/esbuild/bin/esbuild");
}

function applierSource(): string {
  const outfile = path.join(tmpdir(), `parent-aa-drive-${process.pid}.js`);
  const resolver = path.join(REPO, "packages/openclinxr/asset-registry/src/morph-target-resolver.ts");
  execFileSync(esbuildBin(), [
    path.join(REPO, "packages/openclinxr/xr-dialogue/src/viseme-runtime-wire.ts"),
    "--bundle",
    "--format=iife",
    "--global-name=OpenClinXrAaDrive",
    "--platform=browser",
    `--alias:@openclinxr/asset-registry=${resolver}`,
    `--outfile=${outfile}`,
  ], { stdio: "inherit" });
  const bundled = readFileSync(outfile, "utf8");
  return `${bundled}
(() => {
  const drive = typeof OpenClinXrAaDrive !== "undefined" ? OpenClinXrAaDrive : globalThis.OpenClinXrAaDrive;
  globalThis.OpenClinXrAaDrive = drive;
  if (!drive || typeof drive.applyDialogueVisemeTimelineToRoot !== "function") {
    throw new Error("shipped viseme applier did not load");
  }
  const native = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = function (callback) {
    return native(function (time) {
      try {
        const root = window.__openClinXrIsolatedSceneRoot;
        if (root) {
          const result = drive.applyDialogueVisemeTimelineToRoot(root, {
            phonemeSequence: ["AA"],
            progress: 0,
          });
          window.__openClinXrAaApplier = {
            activeTargetName: result.activeTargetName,
            jawOpenRadians: result.jawOpenRadians,
            visemeAa: result.weights.viseme_aa ?? 0,
            mouthOpen: result.weights["mouth-open"] ?? 0,
          };
        }
      } catch (error) {
        window.__openClinXrAaApplierError = String(error && error.stack || error);
      }
      return callback(time);
    });
  };
})();
`;
}

const MEASURE = `(() => {
  const root = window.__openClinXrIsolatedSceneRoot;
  const evidence = window.__openClinXrIsolatedSubjectEvidence;
  const drive = window.__openClinXrAaApplier;
  if (!root || !evidence || !drive) return null;
  let teethAa = null;
  let teethName = null;
  let mouthOpen = 0;
  let jawX = null;
  root.traverse(function (object) {
    const dict = object.morphTargetDictionary;
    const influences = object.morphTargetInfluences;
    if (dict && influences) {
      if (typeof object.name === "string" && object.name.indexOf("teeth") >= 0 && dict.viseme_aa !== undefined) {
        teethAa = influences[dict.viseme_aa];
        teethName = object.name;
      }
      if (dict["mouth-open"] !== undefined) {
        mouthOpen = Math.max(mouthOpen, influences[dict["mouth-open"]] || 0);
      }
    }
    if (object.isBone && object.name === "jaw") jawX = object.rotation.x;
  });
  const canvas = document.getElementById("isolated-subject-capture-canvas");
  return {
    teethAa, teethName, mouthOpen, jawX,
    canvasWidth: canvas ? canvas.width : 0,
    canvasHeight: canvas ? canvas.height : 0,
    focusKind: evidence.focusRegion ? evidence.focusRegion.kind : null,
    drive,
  };
})()`;

async function main(): Promise<void> {
  const disk = readFileSync(GLB_DISK);
  const diskSha = sha256(disk);
  const json = readGlbJson(GLB_DISK);
  const teethMesh = "openclinxr_fitted_teeth_mpfb_parent_tara_johnson_v1_mesh";
  const tongueMesh = "openclinxr_fitted_tongue_mpfb_parent_tara_johnson_v1_mesh";
  const script = applierSource();
  let server: PortlessDevServer | undefined;
  await createLocalComputeServices().sceneCapture.withBrowser("parent-fitted-teeth:recapture-aa", async (launched) => {
  const browser = launched as HeadlessBrowser;
  try {
    server = await spawnPortlessDevServer({
      filter: "@openclinxr/ui-xr",
      readyTimeoutMs: 180_000,
      cwd: REPO,
    });
    const served = await fetch(new URL(GLB_URL, server.url));
    if (!served.ok) throw new Error(`GLB fetch failed: ${served.status}`);
    const servedSha = sha256(new Uint8Array(await served.arrayBuffer()));
    if (servedSha !== diskSha) {
      throw new Error(`served GLB ${servedSha} differs from tracked ${diskSha}`);
    }
    const spec = {
      subjectId: "mpfb-peds-parent-aisha",
      subjectKind: "glb",
      bodyGlb: GLB_URL,
      focus: "head",
      label: "parent fitted teeth viseme AA",
    };
    const page: Page = await browser.newPage({
      viewport: { width: VIEW_W, height: VIEW_H },
      deviceScaleFactor: 1,
    });
    page.setDefaultTimeout(180_000);
    page.setDefaultNavigationTimeout(240_000);
    const pageErrors: string[] = [];
    const consoleLines: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(String(error)));
    page.on("console", (message) => consoleLines.push(`${message.type()}: ${message.text()}`));
    await page.addInitScript(script);
    await page.goto(
      `${server.url}isolated-subject.html?subject=${encodeURIComponent(JSON.stringify(spec))}`,
      { waitUntil: "domcontentloaded", timeout: 240_000 },
    );
    // waitForFunction(pageFunction, arg, options) — timeout is the third argument.
    try {
      await page.waitForFunction(
        `(() => window.__openClinXrIsolatedSubjectEvidence != null || window.__openClinXrAaApplierError != null || (document.querySelector("#app")?.textContent || "").includes("Isolated subject lab error"))()`,
        null,
        { timeout: 180_000 },
      );
    } catch (error) {
      const appText = await page.locator("#app").innerText().catch(() => "");
      throw new Error(
        `${String(error)}\napp=${appText.slice(0, 500)}\nconsole=${consoleLines.slice(-20).join("\n")}\npageErrors=${pageErrors.join("\n")}`,
      );
    }
    const labError = await page.locator("#app").innerText().catch(() => "");
    if (labError.includes("Isolated subject lab error")) {
      throw new Error(labError.slice(0, 2000));
    }
    const driveError = await page.evaluate(`window.__openClinXrAaApplierError || ""`);
    if (driveError) throw new Error(String(driveError).slice(0, 2000));
    if (pageErrors.length > 0) throw new Error(pageErrors.join("\n").slice(0, 2000));
    const measure = await page.evaluate(MEASURE) as {
      teethAa: number | null;
      teethName: string | null;
      mouthOpen: number;
      jawX: number | null;
      canvasWidth: number;
      canvasHeight: number;
      focusKind: string | null;
      drive: { activeTargetName: string; jawOpenRadians: number; visemeAa: number; mouthOpen: number };
    } | null;
    if (!measure) throw new Error("in-page measure returned nothing");
    if (measure.teethAa !== 1) throw new Error(`teeth viseme_aa influence is ${measure.teethAa}`);
    if (measure.mouthOpen === 1 || measure.drive.mouthOpen === 1) {
      throw new Error("mouth-open was forced to 1");
    }
    if (measure.drive.activeTargetName !== "viseme_aa") {
      throw new Error(`active target ${measure.drive.activeTargetName}`);
    }
    if (measure.focusKind !== "head_box") throw new Error(`focus kind ${measure.focusKind}`);
    if (measure.canvasWidth !== VIEW_W || measure.canvasHeight !== VIEW_H) {
      throw new Error(`canvas ${measure.canvasWidth}x${measure.canvasHeight}`);
    }
    await page.locator("#isolated-subject-capture-canvas").screenshot({ path: STILL });
    const still = readFileSync(STILL);
    const lum = regionLuminance(still);
    if (!lum || lum.width !== VIEW_W || lum.height !== VIEW_H || lum.sd <= 8) {
      throw new Error(`still ${lum?.width}x${lum?.height} sd ${lum?.sd}`);
    }
    const sidecar = {
      schemaVersion: "openclinxr.parent-fitted-teeth.v1",
      generatedAt: new Date().toISOString(),
      glb: GLB_URL,
      glbSha256: diskSha,
      viewport: { width: VIEW_W, height: VIEW_H },
      focus: "head",
      focusKind: measure.focusKind,
      applier: "applyDialogueVisemeTimelineToRoot",
      phonemeSequence: ["AA"],
      progress: 0,
      activeTargetName: measure.drive.activeTargetName,
      jawRadians: measure.drive.jawOpenRadians,
      measuredJawX: measure.jawX,
      teethVisemeAaInfluence: measure.teethAa,
      mouthOpenInfluence: measure.mouthOpen,
      teethMesh,
      teethTris: triangleCount(json, teethMesh),
      tongueMesh,
      tongueTris: triangleCount(json, tongueMesh),
      claimScope: "parent fitted lower teeth follow viseme_aa through the shipped applier",
      notEvidenceFor: ["clinical", "Quest", "pixel grade"],
    };
    writeFileSync(SIDECAR, `${JSON.stringify(sidecar, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify({ still: STILL, bytes: still.length, sha: diskSha, ...measure }, null, 2)}\n`);
    await page.close();
  } finally {
    if (server) await stopPortlessDevServer(server.proc);
  }
  });
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
