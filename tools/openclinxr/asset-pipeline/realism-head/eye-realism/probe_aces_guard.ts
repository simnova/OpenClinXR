/**
 * Card tsk_e0afe706b7a5f071 G3: ACES guard probe.
 *
 * Case A (must REFUSE): portrait room-rig + eye shading on (default) +
 * rigOverride toneMapping None -> the lab must fail loudly, not render a
 * blowout eye (bisect: toneMapping=None M2b +9.0).
 * Case B (must RENDER): same but eyeRuntimeShading:false -> legacy path,
 * no guard, renders fine (guard is scoped to the shaded eye).
 *
 * Writes eyes-runtime-shading/frames/aces-guard.json (verdicts + error
 * text / toneMapping readback). Exit non-zero on unexpected outcome.
 */
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

const STORE = "/Volumes/files/openclinxr-assets/store/eyes-runtime-shading/frames";
const SIZE = 1280;
const CWD = "/Users/patrick/.grok/worktrees/src-openclinxr/eyeshade";
const AISHA = "/Volumes/files/openclinxr-assets/store/lid-conform/aisha-lidconform.glb";

async function tryCapture(page: Page, baseUrl: string, spec: Record<string, unknown>, file: string): Promise<{ ok: boolean; detail: string }> {
  const spikeCurrent = new Map<string, { bytes: Buffer; contentType: string }>();
  (page as unknown as { __spikeFiles?: unknown }).__spikeFiles = spikeCurrent;
  spikeCurrent.set("/__spike/model.glb", { bytes: readFileSync(AISHA), contentType: "model/gltf-binary" });
  // NOTE: route must exist before goto; (re)register per attempt.
  await page.unroute("**/__spike/*").catch(() => undefined);
  await page.route("**/__spike/*", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    const f = spikeCurrent.get(pathname);
    if (!f) return route.abort();
    return route.fulfill({ body: f.bytes, contentType: f.contentType });
  });
  const abs = path.join(STORE, file);
  try {
    await captureOne({ page, baseUrl, spec, imagePath: abs, size: SIZE });
    const debug = await page.evaluate(
      () => (globalThis as unknown as { __openClinXrIsolatedRuntimeDebug?: unknown }).__openClinXrIsolatedRuntimeDebug ?? null,
    );
    return { ok: true, detail: `rendered sha=${sha256File(abs).slice(0, 12)} toneMapping=${JSON.stringify((debug as { toneMapping?: unknown } | null)?.toneMapping ?? null)}` };
  } catch (err) {
    return { ok: false, detail: String((err as Error)?.message ?? err).slice(0, 400) };
  }
}

async function main(): Promise<void> {
  let server: Awaited<ReturnType<typeof spawnPortlessDevServer>> | null = null;
  try {
    server = await spawnPortlessDevServer({ filter: "@openclinxr/ui-xr", cwd: CWD, readyTimeoutMs: 180_000 });
    const ui = server;
    let result: Record<string, unknown> = {};
    await createLocalComputeServices({
      browserLaunch: chromium.launch.bind(chromium, {
        headless: true,
        args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader"],
      }),
    }).sceneCapture.withBrowser("eyeshade:aces-guard", async (launched) => {
      const page = await (launched as { newPage(o: { viewport: { width: number; height: number }; deviceScaleFactor?: number }): Promise<Page> }).newPage({
        viewport: { width: SIZE, height: SIZE },
        deviceScaleFactor: 1,
      });
      page.on("pageerror", () => undefined);
      const base = {
        subjectKind: "glb",
        bodyGlb: "/__spike/model.glb",
        view: "front",
        focus: "head",
        hideHair: true,
        subjectOnly: true,
        renderSize: SIZE,
        portrait: true,
        yawDegrees: 0,
        productEnvironmentId: "ob_triage_room_v1",
        rigOverride: { toneMapping: "None" },
      };
      const refused = await tryCapture(page, ui.url, { ...base, subjectId: "aces-guard-shaded", label: "aces-guard-shaded" }, "aces-guard-shaded.png");
      const legacy = await tryCapture(page, ui.url, { ...base, eyeRuntimeShading: false, subjectId: "aces-guard-legacy", label: "aces-guard-legacy" }, "aces-guard-legacy.png");
      const guardFires = !refused.ok && /ACESFilmic/i.test(refused.detail);
      result = {
        caseA_shaded_toneMappingNone: { refused: !refused.ok, guardFires, detail: refused.detail },
        caseB_legacy_toneMappingNone: { rendered: legacy.ok, detail: legacy.detail },
        verdict: guardFires && legacy.ok ? "pass" : "fail",
      };
      console.log(JSON.stringify(result, null, 2));
    });
    await mkdir(STORE, { recursive: true });
    await writeFile(path.join(STORE, "aces-guard.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
    if ((result as { verdict?: string }).verdict !== "pass") {
      console.error("ACES guard probe FAILED");
      process.exit(1);
    }
    console.log("ACES guard probe PASS");
  } finally {
    if (server) await stopPortlessDevServer(server.proc);
  }
}

main().catch((err) => {
  console.error(err?.stack ?? String(err));
  process.exit(1);
});
