/** Debug: single three.js capture with console + full error capture. */
import { readFileSync } from "node:fs";
import { createLocalComputeServices } from "@openclinxr/service-local-compute/local";
import { chromium, type Page } from "../../../evidence/lib/slotted-playwright.js";
import { spawnPortlessDevServer, stopPortlessDevServer } from "../../../evidence/lib/portless-server.js";
import { captureOne, subjectUrl } from "../../../evidence/skin-realism/runtime-portrait-capture.js";

const GLB = "/Volumes/files/openclinxr-assets/store/lid-conform-any/body2-lidconform.glb";

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
    }).sceneCapture.withBrowser("eye-realism:debug-spike", async (launched) => {
      const page = await (launched as { newPage(o: { viewport: { width: number; height: number } }): Promise<Page> }).newPage({
        viewport: { width: 1280, height: 1280 },
      });
      page.on("console", (msg) => {
        const t = msg.type();
        if (t === "error" || t === "warning") console.log(`PAGE_CONSOLE ${t}: ${msg.text().slice(0, 500)}`);
      });
      page.on("pageerror", (err) => console.log(`PAGE_ERROR: ${String(err?.stack ?? err).slice(0, 2000)}`));
      page.on("requestfailed", (req) => console.log(`REQ_FAIL ${req.url().slice(0, 120)} ${req.failure()?.errorText ?? ""}`));
      const bytes = readFileSync(GLB);
      await page.route("**/__spike/*", async (route) => {
        const pathname = new URL(route.request().url()).pathname;
        console.log(`ROUTE_HIT ${pathname}`);
        if (pathname === "/__spike/model.glb") {
          return route.fulfill({ body: bytes, contentType: "model/gltf-binary" });
        }
        return route.abort();
      });
      const spec: Record<string, unknown> = {
        subjectKind: "glb",
        bodyGlb: "/__spike/model.glb",
        view: "front",
        focus: "head",
        hideHair: true,
        subjectOnly: true,
        renderSize: 1280,
        portrait: true,
        productEnvironmentId: "ob_triage_room_v1",
      };
      console.log(`SPEC_URL_LEN ${subjectUrl(ui.url, spec).length}`);
      try {
        const evidence = await captureOne({
          page, baseUrl: ui.url,
          spec: { ...spec, subjectId: "debug-oct15", yawDegrees: 0, label: "debug" },
          imagePath: "/tmp/eyereal-debug-oct15.png",
          size: 1280,
        });
        console.log(`EVIDENCE_OK meshCount=${JSON.stringify((evidence as { meshCount?: unknown }).meshCount)}`);
      } catch (err) {
        console.log(`CAPTURE_FAIL ${String((err as Error)?.message ?? err).slice(0, 1000)}`);
        try {
          const appText = await page.evaluate(
            () => (globalThis as unknown as { document: { querySelector(s: string): { textContent: string | null } | null } }).document.querySelector("#app")?.textContent?.slice(0, 3000),
          );
          console.log(`APP_TEXT ${appText}`);
          const dbg = await page.evaluate(
            () => JSON.stringify((globalThis as unknown as { __openClinXrIsolatedRuntimeDebug?: unknown }).__openClinXrIsolatedRuntimeDebug ?? null).slice(0, 2000),
          );
          console.log(`DEBUG_READOUT ${dbg}`);
        } catch (inner) {
          console.log(`EVAL_FAIL ${String(inner).slice(0, 300)}`);
        }
      }
    });
  } finally {
    if (server) await stopPortlessDevServer(server.proc);
  }
}

main().catch((err) => {
  console.error(err?.stack ?? String(err));
  process.exit(1);
});
