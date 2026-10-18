/**
 * ID-pass probe for the eye-realism bisect (globe-ID sclera metrics).
 *
 * Re-captures the F1 three.js cells with the globe painted flat green and
 * the cornea hidden, same camera (portrait framing is deterministic per GLB).
 * Cornea is matched by MESH name (/cornea/i): the in-page cornea material
 * slot did not match the glTF material name in the first attempt.
 * Usage:
 *   pnpm tsx tools/openclinxr/asset-pipeline/realism-head/eye-realism/probe_threejs_id.ts
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
} from "../../../evidence/skin-realism/runtime-portrait-capture.js";

const STORE = "/Volumes/files/openclinxr-assets/store/eyes-realism-regression/bisect";
const SIZE = 1280;

const CAPTURES = [
  {
    id: "id-oct15", dir: "f1-renderer", file: "threejs-oct15-front-id.png",
    glbAbs: "/Volumes/files/openclinxr-assets/store/lid-conform-any/body2-lidconform.glb",
  },
  {
    id: "id-run3", dir: "f1-renderer", file: "threejs-run3-front-id.png",
    glbAbs: "/Volumes/files/openclinxr-assets/store/face-station-cases/body2/run3/body2-lidconform.glb",
  },
];

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
    }).sceneCapture.withBrowser("eye-realism:threejs-id", async (launched) => {
      const page = await (launched as { newPage(o: { viewport: { width: number; height: number }; deviceScaleFactor?: number }): Promise<Page> }).newPage({
        viewport: { width: SIZE, height: SIZE },
        deviceScaleFactor: 1,
      });
      page.on("console", (msg) => {
        if (msg.type() === "error") console.log(`PAGE_CONSOLE error: ${msg.text().slice(0, 400)}`);
      });
      page.on("pageerror", (err) => console.log(`PAGE_ERROR: ${String((err as Error)?.stack ?? err).slice(0, 600)}`));
      const spikeCurrent = new Map<string, { bytes: Buffer; contentType: string }>();
      await page.route("**/__spike/*", async (route) => {
        const pathname = new URL(route.request().url()).pathname;
        const file = spikeCurrent.get(pathname);
        console.log(`ROUTE_HIT ${pathname} ${file ? `bytes=${file.bytes.length}` : "MISS"}`);
        if (!file) return route.abort();
        return route.fulfill({ body: file.bytes, contentType: file.contentType });
      });
      const failures: string[] = [];
      for (const cap of CAPTURES) {
        spikeCurrent.clear();
        spikeCurrent.set("/__spike/model.glb", { bytes: readFileSync(cap.glbAbs), contentType: "model/gltf-binary" });
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
          materialOverrides: [
            // Globe flat green for the ID pass. No cornea-hide override: the
            // lab scene carries no cornea meshes (GLTFLoader builds 17 meshes
            // from these GLBs; the 2 cornea nodes get no Mesh — slot list in
            // /tmp/eyereal-id.log; the eye-shader models the cornea virtually).
            { match: "mat_makeclothes_library_eyes", color: "#000000", emissive: "#00ff00", emissiveIntensity: 1 },
          ],
        };
        const evidence = await captureOne({
          page, baseUrl: ui.url,
          spec: { ...spec, subjectId: cap.id, yawDegrees: 0, label: cap.id },
          imagePath: abs,
          size: SIZE,
        }).catch((err) => ({ __captureError: String((err as Error)?.message ?? err) }) as unknown);
        if ((evidence as { __captureError?: string }).__captureError) {
          const full = (evidence as { __captureError: string }).__captureError;
          failures.push(`${cap.id}: ${full.slice(0, 200)}`);
          console.log(`capture FAIL: ${cap.id}: ${full.slice(0, 2500)}`);
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
          materialOverridesApplied: (debug as { materialOverridesApplied?: unknown } | null)?.materialOverridesApplied ?? null,
        };
        await writeFile(path.join(outDir, `${cap.id}.json`), `${JSON.stringify(record, null, 2)}\n`, "utf8");
        console.log(`capture ok: ${cap.id} sha=${record.pngSha256.slice(0, 12)}`);
      }
      if (failures.length) console.log(`FAILURES(${failures.length})`);
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
