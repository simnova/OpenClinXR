/**
 * Card tsk_e0afe706b7a5f071 (eyeshade): PRE vs POST capture matrix.
 *
 * 2 subjects (aisha-lidconform, body2-run3-lidconform) x 2 framings
 * (front, yaw25) x 2 conditions (PRE = eyeRuntimeShading:false,
 * POST = portrait default ON) + globe-ID passes per subject/framing/
 * condition. Portrait room-rig lab (ob_triage_room_v1), 1280px.
 *
 * Usage:
 *   pnpm tsx tools/openclinxr/asset-pipeline/realism-head/eye-realism/probe_eyeshade_capture.ts [--mode pre|post|id|all]
 *
 * Writes PNGs + per-capture debug JSONs under
 * /Volumes/files/openclinxr-assets/store/eyes-runtime-shading/frames/.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createLocalComputeServices } from "@openclinxr/service-local-compute/local";
import { chromium, type Page } from "../../../evidence/lib/slotted-playwright.js";
import { spawnPortlessDevServer, stopPortlessDevServer } from "../../../evidence/lib/portless-server.js";
import {
  captureOne,
  sha256File,
  subjectUrl,
} from "../../../evidence/skin-realism/runtime-portrait-capture.js";

const STORE = "/Volumes/files/openclinxr-assets/store/eyes-runtime-shading/frames";
const SIZE = 1280;
const CWD = "/Users/patrick/.grok/worktrees/src-openclinxr/eyeshade";

const AISHA = "/Volumes/files/openclinxr-assets/store/lid-conform/aisha-lidconform.glb";
const BODY2 = "/Volumes/files/openclinxr-assets/store/face-station-cases/body2/run3/body2-lidconform.glb";

type Capture = {
  id: string;
  file: string;
  glbAbs: string;
  yawDegrees: number;
  eyeRuntimeShading?: boolean;
  eyeScleraShade?: boolean;
  eyeLidShadow?: boolean;
  eyeScleraAtten?: number;
  eyeLidBandM?: number;
  eyeLidDarken?: number;
  idPass: boolean;
};

const CAPTURES: Capture[] = [];
for (const [tag, glbAbs] of [["aisha", AISHA], ["body2", BODY2]] as const) {
  for (const [view, yawDegrees] of [["front", 0], ["yaw25", 25]] as const) {
    CAPTURES.push({ id: `pre-${tag}-${view}`, file: `pre-${tag}-${view}.png`, glbAbs, yawDegrees, eyeRuntimeShading: false, idPass: false });
    CAPTURES.push({ id: `post-${tag}-${view}`, file: `post-${tag}-${view}.png`, glbAbs, yawDegrees, idPass: false });
    CAPTURES.push({ id: `pre-${tag}-${view}-id`, file: `pre-${tag}-${view}-id.png`, glbAbs, yawDegrees, eyeRuntimeShading: false, idPass: true });
    CAPTURES.push({ id: `post-${tag}-${view}-id`, file: `post-${tag}-${view}-id.png`, glbAbs, yawDegrees, idPass: true });
  }
}
// Ablation cells (aisha-front): hook-only and shadow-only.
CAPTURES.push({ id: "abl-hook-aisha-front", file: "abl-hook-aisha-front.png", glbAbs: AISHA, yawDegrees: 0, eyeLidShadow: false, idPass: false });
CAPTURES.push({ id: "abl-shadow-aisha-front", file: "abl-shadow-aisha-front.png", glbAbs: AISHA, yawDegrees: 0, eyeScleraShade: false, idPass: false });
// Constant sweep (front only, both subjects): 3 values per constant, shipped
// value is the centre row (atten 0.35 / band 0.007 / darken 0.85 = POST).
for (const [tag, glbAbs] of [["aisha", AISHA], ["body2", BODY2]] as const) {
  for (const [row, ov] of [
    ["a025", { eyeScleraAtten: 0.25 }],
    ["a050", { eyeScleraAtten: 0.5 }],
    ["b005", { eyeLidBandM: 0.005 }],
    ["b010", { eyeLidBandM: 0.01 }],
    ["d070", { eyeLidDarken: 0.7 }],
    ["d100", { eyeLidDarken: 1.0 }],
  ] as const) {
    CAPTURES.push({ id: `sw-${row}-${tag}-front`, file: `sw-${row}-${tag}-front.png`, glbAbs, yawDegrees: 0, ...ov, idPass: false });
  }
}

async function main(): Promise<void> {
  const mode = process.argv.includes("--mode")
    ? process.argv[process.argv.indexOf("--mode")! + 1]
    : "all";
  const wanted = CAPTURES.filter((c) => {
    if (mode === "all") return true;
    if (mode === "abl") return c.id.startsWith("abl-");
    if (mode === "sweep") return c.id.startsWith("sw-");
    if (mode === "pre") return c.id.startsWith("pre-") && !c.idPass;
    if (mode === "post") return c.id.startsWith("post-") && !c.idPass;
    if (mode === "id") return c.idPass;
    throw new Error(`unknown --mode ${mode}`);
  });
  let server: Awaited<ReturnType<typeof spawnPortlessDevServer>> | null = null;
  try {
    server = await spawnPortlessDevServer({ filter: "@openclinxr/ui-xr", cwd: CWD, readyTimeoutMs: 180_000 });
    const ui = server;
    await createLocalComputeServices({
      browserLaunch: chromium.launch.bind(chromium, {
        headless: true,
        args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader"],
      }),
    }).sceneCapture.withBrowser("eyeshade:capture", async (launched) => {
      const page = await (launched as { newPage(o: { viewport: { width: number; height: number }; deviceScaleFactor?: number }): Promise<Page> }).newPage({
        viewport: { width: SIZE, height: SIZE },
        deviceScaleFactor: 1,
      });
      page.on("console", (msg) => {
        if (msg.type() === "error") console.log(`PAGE_CONSOLE error: ${msg.text().slice(0, 300)}`);
      });
      page.on("pageerror", (err) => console.log(`PAGE_ERROR: ${String((err as Error)?.stack ?? err).slice(0, 500)}`));
      page.on("requestfailed", (req) => console.log(`REQ_FAIL ${req.url().slice(0, 140)} ${req.failure()?.errorText ?? ""}`));
      const spikeCurrent = new Map<string, { bytes: Buffer; contentType: string }>();
      await page.route("**/__spike/*", async (route) => {
        const url = route.request().url();
        const pathname = new URL(url).pathname;
        const file = spikeCurrent.get(pathname);
        if (!file) return route.abort();
        return route.fulfill({ body: file.bytes, contentType: file.contentType });
      });
      const failures: string[] = [];
      for (const cap of wanted) {
        spikeCurrent.clear();
        spikeCurrent.set("/__spike/model.glb", { bytes: readFileSync(cap.glbAbs), contentType: "model/gltf-binary" });
        await mkdir(STORE, { recursive: true });
        const abs = path.join(STORE, cap.file);
        const spec: Record<string, unknown> = {
          subjectKind: "glb",
          bodyGlb: "/__spike/model.glb",
          view: "front",
          focus: "head",
          hideHair: true,
          subjectOnly: true,
          renderSize: SIZE,
          portrait: true,
          yawDegrees: cap.yawDegrees,
          productEnvironmentId: "ob_triage_room_v1",
          ...(cap.eyeRuntimeShading === false ? { eyeRuntimeShading: false } : {}),
          ...(cap.eyeScleraShade === false ? { eyeScleraShade: false } : {}),
          ...(cap.eyeLidShadow === false ? { eyeLidShadow: false } : {}),
          ...(cap.eyeScleraAtten !== undefined ? { eyeScleraAtten: cap.eyeScleraAtten } : {}),
          ...(cap.eyeLidBandM !== undefined ? { eyeLidBandM: cap.eyeLidBandM } : {}),
          ...(cap.eyeLidDarken !== undefined ? { eyeLidDarken: cap.eyeLidDarken } : {}),
          ...(cap.idPass
            ? {
                materialOverrides: [
                  { match: "mat_makeclothes_library_eyes", color: "#000000", emissive: "#00ff00", emissiveIntensity: 1 },
                ],
              }
            : {}),
        };
        const evidence = await captureOne({
          page, baseUrl: ui.url,
          spec: { ...spec, subjectId: cap.id, label: cap.id },
          imagePath: abs,
          size: SIZE,
        }).catch((err) => ({ __captureError: String((err as Error)?.message ?? err) }) as unknown);
        if ((evidence as { __captureError?: string }).__captureError) {
          failures.push(`${cap.id}: ${(evidence as { __captureError: string }).__captureError.slice(0, 200)}`);
          console.log(`capture FAIL (continuing): ${cap.id}`);
          continue;
        }
        const debug = await page.evaluate(
          () => (globalThis as unknown as { __openClinXrIsolatedRuntimeDebug?: unknown }).__openClinXrIsolatedRuntimeDebug ?? null,
        );
        const record = {
          id: cap.id,
          glb: cap.glbAbs,
          glbSha256: createHash("sha256").update(readFileSync(cap.glbAbs)).digest("hex"),
          png: abs,
          pngSha256: sha256File(abs),
            spec: { yawDegrees: cap.yawDegrees, eyeRuntimeShading: cap.eyeRuntimeShading ?? "default", eyeScleraShade: cap.eyeScleraShade ?? "default", eyeLidShadow: cap.eyeLidShadow ?? "default", eyeScleraAtten: cap.eyeScleraAtten ?? "default", eyeLidBandM: cap.eyeLidBandM ?? "default", eyeLidDarken: cap.eyeLidDarken ?? "default", idPass: cap.idPass },
          url: subjectUrl(ui.url, { ...spec, subjectId: cap.id, label: cap.id }),
          frameSpanFraction: (evidence as { frameSpanFraction?: number | null }).frameSpanFraction ?? null,
          renderer: (debug as Record<string, unknown> | null)?.["renderer"] ?? null,
          lights: (debug as { lights?: unknown } | null)?.lights ?? null,
          environmentMap: (debug as { environmentMap?: unknown } | null)?.environmentMap ?? null,
          materialOverridesApplied: (debug as { materialOverridesApplied?: unknown } | null)?.materialOverridesApplied ?? null,
          productRig: (debug as { productRig?: unknown } | null)?.productRig ?? null,
          portrait: (debug as { portrait?: unknown } | null)?.portrait ?? null,
        };
        await writeFile(path.join(STORE, `${cap.id}.json`), `${JSON.stringify(record, null, 2)}\n`, "utf8");
        console.log(`capture ok: ${cap.id} sha=${record.pngSha256.slice(0, 12)}`);
      }
      if (failures.length) console.log(`FAILURES(${failures.length}): ${failures.join(" | ")}`);
      else console.log("all captures ok");
    });
  } finally {
    if (server) await stopPortlessDevServer(server.proc);
  }
}

main().catch((err) => {
  console.error(err?.stack ?? String(err));
  process.exit(1);
});
