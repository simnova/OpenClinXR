/**
 * Recapture parent head-focus stills through applyDialogueVisemeTimelineToRoot.
 *
 * 1280x960, mouth-open left at 0. One still per phoneme: AA, E, I, O, U, FF, PP.
 *
 * Run: pnpm exec tsx tools/openclinxr/evidence/parent-fitted-teeth/recapture-visemes.ts
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
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
const OUT_DIR = path.join(HERE, "visemes");
const VIEW_W = 1280;
const VIEW_H = 960;

const SHOTS = [
  { file: "aa.png", phoneme: "AA", target: "viseme_aa" },
  { file: "E.png", phoneme: "E", target: "viseme_E" },
  { file: "I.png", phoneme: "I", target: "viseme_I" },
  { file: "O.png", phoneme: "O", target: "viseme_O" },
  { file: "U.png", phoneme: "U", target: "viseme_U" },
  { file: "FF.png", phoneme: "FF", target: "viseme_FF" },
  { file: "PP.png", phoneme: "PP", target: "viseme_PP" },
] as const;

function esbuildBin(): string {
  const root = path.join(REPO, "node_modules/.pnpm");
  const dir = readdirSync(root).find((name) => name.startsWith("esbuild@"));
  if (!dir) throw new Error("esbuild is not installed");
  return path.join(root, dir, "node_modules/esbuild/bin/esbuild");
}

function applierSource(): string {
  const outfile = path.join(tmpdir(), `parent-viseme-drive-${process.pid}.js`);
  const resolver = path.join(REPO, "packages/openclinxr/asset-registry/src/morph-target-resolver.ts");
  execFileSync(esbuildBin(), [
    path.join(REPO, "packages/openclinxr/xr-dialogue/src/viseme-runtime-wire.ts"),
    "--bundle",
    "--format=iife",
    "--global-name=OpenClinXrVisemeDrive",
    "--platform=browser",
    `--alias:@openclinxr/asset-registry=${resolver}`,
    `--outfile=${outfile}`,
  ], { stdio: "inherit" });
  const bundled = readFileSync(outfile, "utf8");
  return `${bundled}
(() => {
  const drive = typeof OpenClinXrVisemeDrive !== "undefined" ? OpenClinXrVisemeDrive : globalThis.OpenClinXrVisemeDrive;
  globalThis.OpenClinXrVisemeDrive = drive;
  if (!drive || typeof drive.applyDialogueVisemeTimelineToRoot !== "function") {
    throw new Error("shipped viseme applier did not load");
  }
  const native = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = function (callback) {
    return native(function (time) {
      try {
        const root = window.__openClinXrIsolatedSceneRoot;
        const phoneme = new URLSearchParams(location.search).get("viseme") || "AA";
        window.__openClinXrVisemePhoneme = phoneme;
        if (root) {
          const result = drive.applyDialogueVisemeTimelineToRoot(root, {
            phonemeSequence: [phoneme],
            progress: 0,
          });
          window.__openClinXrVisemeApplier = {
            phoneme,
            activeTargetName: result.activeTargetName,
            jawOpenRadians: result.jawOpenRadians,
            mouthOpen: result.weights["mouth-open"] || 0,
          };
        }
      } catch (error) {
        window.__openClinXrVisemeApplierError = String(error && error.stack || error);
      }
      return callback(time);
    });
  };
})();
`;
}

function measureSource(target: string): string {
  return `(() => {
    const root = window.__openClinXrIsolatedSceneRoot;
    const evidence = window.__openClinXrIsolatedSubjectEvidence;
    const drive = window.__openClinXrVisemeApplier;
    if (!root || !evidence || !drive) return null;
    const want = ${JSON.stringify(target)};
    let teethInfluence = null;
    let teethAa = null;
    let teethMeshCount = 0;
    let lipInfluence = null;
    let mouthOpen = 0;
    root.traverse(function (object) {
      const dict = object.morphTargetDictionary;
      const influences = object.morphTargetInfluences;
      if (!dict || !influences) return;
      const name = typeof object.name === "string" ? object.name : "";
      if (name.indexOf("teeth") >= 0) {
        teethMeshCount += 1;
        if (dict["viseme_aa"] !== undefined) teethAa = influences[dict["viseme_aa"]];
        if (dict[want] !== undefined) teethInfluence = influences[dict[want]];
      } else if (name.indexOf("body") >= 0 && dict[want] !== undefined) {
        lipInfluence = influences[dict[want]];
      }
      if (dict["mouth-open"] !== undefined) mouthOpen = Math.max(mouthOpen, influences[dict["mouth-open"]] || 0);
    });
    const canvas = document.getElementById("isolated-subject-capture-canvas");
    return {
      teethInfluence,
      teethAa,
      teethMeshCount,
      lipInfluence,
      mouthOpen,
      canvasWidth: canvas ? canvas.width : 0,
      canvasHeight: canvas ? canvas.height : 0,
      focusKind: evidence.focusRegion ? evidence.focusRegion.kind : null,
      drive,
    };
  })()`;
}

async function openShot(page: Page, serverUrl: string, phoneme: string, target: string): Promise<void> {
  const spec = {
    subjectId: "mpfb-peds-parent-aisha",
    subjectKind: "glb",
    bodyGlb: GLB_URL,
    focus: "head",
    label: `parent fitted teeth viseme ${phoneme}`,
  };
  const pageErrors: string[] = [];
  const onError = (error: Error) => pageErrors.push(String(error));
  page.on("pageerror", onError);
  try {
    await page.goto(
      `${serverUrl}isolated-subject.html?viseme=${encodeURIComponent(phoneme)}&subject=${encodeURIComponent(JSON.stringify(spec))}`,
      { waitUntil: "domcontentloaded", timeout: 240_000 },
    );
    await page.waitForFunction(
      `(() => window.__openClinXrIsolatedSubjectEvidence != null || window.__openClinXrVisemeApplierError != null)()`,
      null,
      { timeout: 180_000 },
    );
    const driveError = await page.evaluate(`window.__openClinXrVisemeApplierError || ""`);
    if (driveError) throw new Error(String(driveError).slice(0, 2000));
    if (pageErrors.length > 0) throw new Error(pageErrors.join("\n").slice(0, 2000));
    await page.waitForFunction(
      `(() => {
        const drive = window.__openClinXrVisemeApplier;
        return drive && drive.phoneme === ${JSON.stringify(phoneme)} && drive.activeTargetName === ${JSON.stringify(target)} && drive.mouthOpen === 0;
      })()`,
      null,
      { timeout: 30_000 },
    );
  } finally {
    page.off("pageerror", onError);
  }
}

function selectedShots() {
  const args = process.argv.slice(2).filter((arg: string) => arg !== "--");
  if (args.length === 0) return [...SHOTS];
  const shots = SHOTS.filter(
    (shot) => args.includes(shot.file) || args.includes(shot.phoneme) || args.includes(shot.phoneme.toLowerCase()),
  );
  if (shots.length !== args.length) {
    throw new Error(`unknown viseme shot in: ${args.join(" ")}`);
  }
  return [...shots];
}

async function main(): Promise<void> {
  const shots = selectedShots();
  const script = applierSource();
  let server: PortlessDevServer | undefined;
  await createLocalComputeServices().sceneCapture.withBrowser("parent-fitted-teeth:recapture-visemes", async (launched) => {
  const browser = launched as HeadlessBrowser;
  try {
    server = await spawnPortlessDevServer({
      filter: "@openclinxr/ui-xr",
      readyTimeoutMs: 180_000,
      cwd: REPO,
    });
    const page = await browser.newPage({ viewport: { width: VIEW_W, height: VIEW_H }, deviceScaleFactor: 1 });
    page.setDefaultTimeout(180_000);
    page.setDefaultNavigationTimeout(240_000);
    await page.addInitScript(script);
    const written: string[] = [];
    for (const shot of shots) {
      await openShot(page, server.url, shot.phoneme, shot.target);
      const measure = await page.evaluate(measureSource(shot.target)) as {
        teethInfluence: number | null;
        teethAa: number | null;
        teethMeshCount: number;
        lipInfluence: number | null;
        mouthOpen: number;
        canvasWidth: number;
        canvasHeight: number;
        focusKind: string | null;
        drive: { activeTargetName: string; mouthOpen: number };
      } | null;
      if (!measure) throw new Error(`${shot.phoneme} measure returned nothing`);
      if (measure.teethMeshCount < 1 || measure.teethAa === null) {
        throw new Error(`${shot.phoneme} teeth viseme_aa missing`);
      }
      if (shot.target === "viseme_aa") {
        if (measure.teethInfluence !== 0.5 || measure.teethAa !== 0.5) {
          throw new Error(`${shot.phoneme} teeth influence ${measure.teethInfluence} aa ${measure.teethAa}`);
        }
      } else if (measure.teethInfluence !== 0.5 || measure.teethAa !== 0) {
        throw new Error(`${shot.phoneme} teeth influence ${measure.teethInfluence} aa ${measure.teethAa}`);
      }
      if (measure.lipInfluence !== 0.5) {
        throw new Error(`${shot.phoneme} lip influence ${measure.lipInfluence}`);
      }
      if (measure.mouthOpen !== 0 || measure.drive.mouthOpen !== 0) {
        throw new Error(`${shot.phoneme} mouth-open is ${measure.mouthOpen}`);
      }
      if (measure.drive.activeTargetName !== shot.target) {
        throw new Error(`${shot.phoneme} active target ${measure.drive.activeTargetName}`);
      }
      if (measure.focusKind !== "head_box") throw new Error(`${shot.phoneme} focus ${measure.focusKind}`);
      if (measure.canvasWidth !== VIEW_W || measure.canvasHeight !== VIEW_H) {
        throw new Error(`${shot.phoneme} canvas ${measure.canvasWidth}x${measure.canvasHeight}`);
      }
      const stillPath = path.join(OUT_DIR, shot.file);
      await page.locator("#isolated-subject-capture-canvas").screenshot({ path: stillPath });
      const still = readFileSync(stillPath);
      const lum = regionLuminance(still);
      if (!lum || lum.width !== VIEW_W || lum.height !== VIEW_H || lum.sd <= 8) {
        throw new Error(`${shot.file} ${lum?.width}x${lum?.height} sd ${lum?.sd}`);
      }
      written.push(shot.file);
      process.stderr.write(`${shot.file} ${still.length} ${createHash("sha256").update(still).digest("hex").slice(0, 12)}\n`);
    }
    const hashes = written.map((file) => createHash("sha256").update(readFileSync(path.join(OUT_DIR, file))).digest("hex"));
    if (new Set(hashes).size !== written.length) {
      throw new Error(`viseme stills are not distinct: ${hashes.join(",")}`);
    }
    process.stdout.write(`${JSON.stringify({ written })}\n`);
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
