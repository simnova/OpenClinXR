/**
 * three.js bisect probe for the eye-realism card (factors 1/2/3 + ID passes).
 *
 * One server + one browser session, many captures. Never edits harness
 * files: every factor rides a variant (materialOverrides / rigOverride /
 * productEnvironmentId) or a same-GLB re-capture. Usage:
 *   pnpm tsx tools/openclinxr/asset-pipeline/realism-head/eye-realism/probe_threejs_bisect.ts
 *
 * Writes PNGs + per-capture debug JSONs under
 * /Volumes/files/openclinxr-assets/store/eyes-realism-regression/bisect/.
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

const STORE = "/Volumes/files/openclinxr-assets/store/eyes-realism-regression/bisect";
const SIZE = 1280;

const OCT15 = "/Volumes/files/openclinxr-assets/store/lid-conform-any/body2-lidconform.glb";
const RUN3 = "/Volumes/files/openclinxr-assets/store/face-station-cases/body2/run3/body2-lidconform.glb";
const BROWN = "/Users/patrick/.grok/worktrees/src-openclinxr/eyereal/.openclinxr-local/provider-cache/eyes/makehuman-system-assets/brown_eye.png";
const IRISC = "/Users/patrick/.grok/worktrees/src-openclinxr/eyereal/tools/openclinxr/asset-pipeline/eyes/iris-centred-c.png";

type Capture = {
  id: string;
  dir: string;
  file: string;
  glbAbs: string;
  materialOverrides?: Array<Record<string, unknown>>;
  rigOverride?: Record<string, unknown>;
  note: string;
};

const CAPTURES: Capture[] = [
  { id: "f1-oct15", dir: "f1-renderer", file: "threejs-oct15-front.png", glbAbs: OCT15, note: "F1 three.js column, Oct-15 GLB embedded brown_eye" },
  { id: "f1-run3", dir: "f1-renderer", file: "threejs-run3-front.png", glbAbs: RUN3, note: "F1 three.js column, run3 GLB embedded iris-centred-c" },
  {
    id: "f2-oct15-irisC", dir: "f2-iris", file: "threejs-oct15-irisC-front.png", glbAbs: OCT15,
    materialOverrides: [{ match: "mat_makeclothes_library_eyes", baseColorUrl: IRISC }],
    note: "F2 Oct-15 GLB with iris-centred-c swapped at load",
  },
  {
    id: "f2-run3-browneye", dir: "f2-iris", file: "threejs-run3-browneye-front.png", glbAbs: RUN3,
    materialOverrides: [{ match: "mat_makeclothes_library_eyes", baseColorUrl: BROWN }],
    note: "F2 run3 GLB with brown_eye swapped at load",
  },
  {
    id: "f3-run3-env0", dir: "f3-lighting", file: "threejs-run3-env0-front.png", glbAbs: RUN3,
    materialOverrides: [{ match: "eyes|cornea", envMapIntensity: 0 }],
    note: "F3 globe+cornea envMapIntensity 0 (catchlight off)",
  },
  {
    id: "f3-run3-env06", dir: "f3-lighting", file: "threejs-run3-env06-front.png", glbAbs: RUN3,
    materialOverrides: [{ match: "eyes|cornea", envMapIntensity: 0.6 }],
    note: "F3 globe+cornea envMapIntensity 0.6",
  },
  {
    id: "f3-run3-tonemap-none", dir: "f3-lighting", file: "threejs-run3-tonemap-none-front.png", glbAbs: RUN3,
    rigOverride: { toneMapping: "None" },
    note: "F3 tone mapping off (product rig exposure kept)",
  },
  {
    id: "id-oct15", dir: "f1-renderer", file: "threejs-oct15-front-id.png", glbAbs: OCT15,
    materialOverrides: [
      { match: "mat_makeclothes_library_eyes", color: "#000000", emissive: "#00ff00", emissiveIntensity: 1 },
      { match: "openclinxr_eye_cornea_mat", hide: true },
    ],
    note: "ID pass Oct-15: globe flat green, cornea hidden",
  },
  {
    id: "id-run3", dir: "f1-renderer", file: "threejs-run3-front-id.png", glbAbs: RUN3,
    materialOverrides: [
      { match: "mat_makeclothes_library_eyes", color: "#000000", emissive: "#00ff00", emissiveIntensity: 1 },
      { match: "openclinxr_eye_cornea_mat", hide: true },
    ],
    note: "ID pass run3: globe flat green, cornea hidden",
  },
];

function contentTypeFor(file: string): string {
  const ext = path.extname(file).toLowerCase();
  if (ext === ".png") return "image/png";
  throw new Error(`unsupported spike file: ${file}`);
}

async function main(): Promise<void> {
  const cwd = "/Users/patrick/.grok/worktrees/src-openclinxr/eyereal";
  let server: Awaited<ReturnType<typeof spawnPortlessDevServer>> | null = null;
  try {
    server = await spawnPortlessDevServer({ filter: "@openclinxr/ui-xr", cwd, readyTimeoutMs: 180_000 });
    const ui = server;
    await createLocalComputeServices({
      browserLaunch: chromium.launch.bind(chromium, {
        headless: true,
        args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader"],
      }),
    }).sceneCapture.withBrowser("eye-realism:threejs-bisect", async (launched) => {
      const page = await (launched as { newPage(o: { viewport: { width: number; height: number }; deviceScaleFactor?: number }): Promise<Page> }).newPage({
        viewport: { width: SIZE, height: SIZE },
        deviceScaleFactor: 1,
      });
      page.on("console", (msg) => {
        const t = msg.type();
        if (t === "error") console.log(`PAGE_CONSOLE error: ${msg.text().slice(0, 300)}`);
      });
      page.on("pageerror", (err) => console.log(`PAGE_ERROR: ${String((err as Error)?.stack ?? err).slice(0, 500)}`));
      page.on("requestfailed", (req) => console.log(`REQ_FAIL ${req.url().slice(0, 140)} ${req.failure()?.errorText ?? ""}`));
      // One shared /__spike/ route for the whole session (variant-mode shape):
      // per-capture bytes are swapped into `spikeCurrent` before each goto.
      const spikeCurrent = new Map<string, { bytes: Buffer; contentType: string }>();
      await page.route("**/__spike/*", async (route) => {
        const url = route.request().url();
        const pathname = new URL(url).pathname;
        const file = spikeCurrent.get(pathname);
        console.log(`ROUTE_HIT ${pathname} ${file ? `bytes=${file.bytes.length}` : "MISS"}`);
        if (!file) return route.abort();
        return route.fulfill({ body: file.bytes, contentType: file.contentType });
      });
      const failures: string[] = [];
      for (const cap of CAPTURES) {
        const spikeFiles = spikeCurrent;
        spikeFiles.clear();
        spikeFiles.set("/__spike/model.glb", { bytes: readFileSync(cap.glbAbs), contentType: "model/gltf-binary" });
        const matOvs = (cap.materialOverrides ?? []).map((o) => ({ ...(o as Record<string, unknown>) }));
        let texIndex = 0;
        for (const ov of matOvs) {
          const rel = ov.baseColorUrl;
          if (typeof rel === "string") {
            const bytes = readFileSync(rel);
            const servedPath = `/__spike/tex${texIndex}.png`;
            texIndex += 1;
            spikeFiles.set(servedPath, { bytes, contentType: contentTypeFor(rel) });
            ov.baseColorUrl = `${ui.url.replace(/\/$/, "")}${servedPath}`;
          }
        }
        const outDir = path.join(STORE, cap.dir);
        await mkdir(outDir, { recursive: true });
        const abs = path.join(outDir, cap.file);
        const spec: Record<string, unknown> = {
          subjectKind: "glb",
          bodyGlb: "/__spike/model.glb",
          view: "front",
          focus: "head",
          hideHair: true,
          subjectOnly: true,
          renderSize: SIZE,
          portrait: true,
          productEnvironmentId: "ob_triage_room_v1",
          ...(matOvs.length ? { materialOverrides: matOvs } : {}),
          ...(cap.rigOverride ? { rigOverride: cap.rigOverride } : {}),
        };
        const evidence = await captureOne({
          page, baseUrl: ui.url,
          spec: { ...spec, subjectId: cap.id, yawDegrees: 0, label: cap.id },
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
          note: cap.note,
          glb: cap.glbAbs,
          glbSha256: createHash("sha256").update(readFileSync(cap.glbAbs)).digest("hex"),
          png: abs,
          pngSha256: sha256File(abs),
          frameSpanFraction: (evidence as { frameSpanFraction?: number | null }).frameSpanFraction ?? null,
          renderer: (debug as Record<string, unknown> | null)?.["renderer"] ?? null,
          lights: (debug as { lights?: unknown } | null)?.lights ?? null,
          environmentMap: (debug as { environmentMap?: unknown } | null)?.environmentMap ?? null,
          materialOverridesApplied: (debug as { materialOverridesApplied?: unknown } | null)?.materialOverridesApplied ?? null,
          productRig: (debug as { productRig?: unknown } | null)?.productRig ?? null,
          portrait: (debug as { portrait?: unknown } | null)?.portrait ?? null,
        };
        await writeFile(path.join(outDir, `${cap.id}.json`), `${JSON.stringify(record, null, 2)}\n`, "utf8");
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
