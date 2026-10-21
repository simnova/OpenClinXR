/**
 * Cornea fresnel (eye-finish): capture matrix for the fresnel gate report.
 *
 * Shipped Aisha GLB (high-poly eye + orphan corneas, sha pinned below —
 * refusing on mismatch) through the portrait product rig
 * (ob_triage_room_v1, library_eyes envMapIntensity 0.6, eyeRuntimeShading
 * ON so the sclera + fresnel hooks install), 1280px.
 *
 * Cells: current (fresnel OFF = today's pixels) x {front, yaw+25, yaw-25},
 * determinism re-run of current-front, gain/exponent sweep at yaw+25, then
 * (round 2, after landing G/k from the sweep) fresnel + flat at each yaw.
 * Gain/exponent ride the lab spec (eyeCorneaFresnelGain /
 * eyeCorneaFresnelExponent); flat rides eyeCorneaFlat.
 *
 * Usage:
 *   pnpm tsx tools/openclinxr/asset-pipeline/realism-head/eye-realism/probe_cornea_fresnel_capture.ts [--only <id,...> | --round 1|2]
 *
 * Writes PNGs + per-capture debug JSONs under
 * /Volumes/files/openclinxr-assets/store/eye-catchlight/fresnel/.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createLocalComputeServices } from "@openclinxr/service-local-compute/local";
import { spawnPortlessDevServer, stopPortlessDevServer } from "../../../evidence/lib/portless-server.js";
import { chromium, type Page } from "../../../evidence/lib/slotted-playwright.js";
import {
  captureOne,
  sha256File,
  subjectUrl,
} from "../../../evidence/skin-realism/runtime-portrait-capture.js";

const STORE = "/Volumes/files/openclinxr-assets/store/eye-catchlight/fresnel";
const SIZE = 1280;
const CWD = "/Users/patrick/.local/share/opencode/worktree/29797f/eye-finish";

const GLB_ABS = "/Volumes/files/openclinxr-assets/store/lid-conform/aisha-lidconform.glb";
const GLB_SHA256 = "96c13f02d262b093eb53b4c8c2d493d57668f352cf406ad31a25dbac35d1ed76";

type Capture = {
  id: string;
  file: string;
  yawDegrees: number;
  corneaFresnel: boolean;
  corneaGain?: number;
  corneaExponent?: number;
  corneaFlat?: boolean;
  round: 1 | 2 | 3;
  /** Per-cell GLB + shading overrides (round 3 neutrality reprove). */
  glbAbs?: string;
  eyeShading?: boolean;
  envMapIntensity?: number;
};

const SWEEP: Array<{ gain: number; exponent: number }> = [
  { gain: 1, exponent: 1 },
  { gain: 2, exponent: 1 },
  { gain: 4, exponent: 1 },
  { gain: 1, exponent: 2 },
  { gain: 2, exponent: 2 },
  { gain: 4, exponent: 2 },
];

const CAPTURES: Capture[] = [
  { id: "cur-front", file: "cur-front.png", yawDegrees: 0, corneaFresnel: false, round: 1 },
  { id: "cur-front-rerun", file: "cur-front-rerun.png", yawDegrees: 0, corneaFresnel: false, round: 1 },
  { id: "cur-yaw25", file: "cur-yaw25.png", yawDegrees: 25, corneaFresnel: false, round: 1 },
  { id: "cur-yaw-25", file: "cur-yaw-25.png", yawDegrees: -25, corneaFresnel: false, round: 1 },
  ...SWEEP.map((s): Capture => ({
    id: `sweep-g${s.gain}-k${s.exponent}-yaw25`,
    file: `sweep-g${s.gain}-k${s.exponent}-yaw25.png`,
    yawDegrees: 25,
    corneaFresnel: true,
    corneaGain: s.gain,
    corneaExponent: s.exponent,
    round: 1,
  })),
  // Round 2 (landed G/k from the round-1 sweep): fresnel + flat at each yaw.
  { id: "fres-front", file: "fres-front.png", yawDegrees: 0, corneaFresnel: true, round: 2 },
  { id: "fres-yaw25", file: "fres-yaw25.png", yawDegrees: 25, corneaFresnel: true, round: 2 },
  { id: "fres-yaw-25", file: "fres-yaw-25.png", yawDegrees: -25, corneaFresnel: true, round: 2 },
  { id: "flat-front", file: "flat-front.png", yawDegrees: 0, corneaFresnel: true, corneaFlat: true, round: 2 },
  { id: "flat-yaw25", file: "flat-yaw25.png", yawDegrees: 25, corneaFresnel: true, corneaFlat: true, round: 2 },
  { id: "flat-yaw-25", file: "flat-yaw-25.png", yawDegrees: -25, corneaFresnel: true, corneaFlat: true, round: 2 },
  // Round 3: neutrality reprove — the h206 cell (shipped GLB, eyeShading OFF,
  // library_eyes 0.6) re-rendered with the fresnel-carrying source. Must come
  // back bit-identical to the recorded h206 PNG: the rig change installs
  // nothing when eyeShading is off, so the old h1/h2/pos cells still describe
  // the current source and their module pins can honestly move.
  { id: "reprove-h206", file: "reprove-h206-front.png", yawDegrees: 0, corneaFresnel: false, round: 3, glbAbs: "/Users/patrick/.local/share/opencode/worktree/29797f/eye-finish/apps/ui-xr/public/generated-humanoids/mpfb-ob-patient-aisha.glb", eyeShading: false, envMapIntensity: 0.6 },
];

async function main(): Promise<void> {
  const onlyIndex = process.argv.indexOf("--only");
  const only = onlyIndex >= 0 ? process.argv[onlyIndex + 1] : undefined;
  const roundIndex = process.argv.indexOf("--round");
  const roundArg = roundIndex >= 0 ? Number(process.argv[roundIndex + 1]) : null;
  const onlySet = only !== undefined ? new Set(only.split(",")) : null;
  const wanted = CAPTURES.filter((c) => {
    if (onlySet) return onlySet.has(c.id);
    if (roundArg === 1 || roundArg === 2 || roundArg === 3) return c.round === roundArg;
    return true;
  });
  if (wanted.length === 0) throw new Error("no captures selected");

  const glbBytesDefault = readFileSync(GLB_ABS);
  if (createHash("sha256").update(glbBytesDefault).digest("hex") !== GLB_SHA256) {
    throw new Error(
      `lid-conform GLB changed under the fresnel gate (want ${GLB_SHA256}) — refusing rather than grading a different eye`,
    );
  }

  let server: Awaited<ReturnType<typeof spawnPortlessDevServer>> | null = null;
  try {
    server = await spawnPortlessDevServer({ filter: "@openclinxr/ui-xr", cwd: CWD, readyTimeoutMs: 300_000 });
    const ui = server;
    await createLocalComputeServices({
      browserLaunch: chromium.launch.bind(chromium, {
        headless: true,
        args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader"],
      }),
    }).sceneCapture.withBrowser("cornea-fresnel:capture", async (launched) => {
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
        const cellGlbAbs = cap.glbAbs ?? GLB_ABS;
        const cellGlbBytes = cap.glbAbs ? readFileSync(cellGlbAbs) : glbBytesDefault;
        if (cap.glbAbs) {
          const cellSha = createHash("sha256").update(cellGlbBytes).digest("hex");
          if (cellSha !== "88070603c7b39b8bf433f088ac390c056bb69d9937bf2284845f1a541fc5f091") {
            throw new Error(`reprove GLB changed (got ${cellSha}) — refusing`);
          }
        }
        const cellGlbSha = createHash("sha256").update(cellGlbBytes).digest("hex");
        spikeCurrent.set("/__spike/model.glb", { bytes: cellGlbBytes, contentType: "model/gltf-binary" });
        await mkdir(STORE, { recursive: true });
        const abs = path.join(STORE, cap.file);
        const eyeShading = cap.eyeShading ?? true;
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
          eyeRuntimeShading: eyeShading,
          materialOverrides: [{ match: "library_eyes", envMapIntensity: cap.envMapIntensity ?? 0.6 }],
          yawDegrees: cap.yawDegrees,
          subjectId: cap.id,
          label: cap.id,
          ...(cap.corneaFresnel ? { eyeCorneaFresnel: true } : { eyeCorneaFresnel: false }),
          ...(cap.corneaGain !== undefined ? { eyeCorneaFresnelGain: cap.corneaGain } : {}),
          ...(cap.corneaExponent !== undefined ? { eyeCorneaFresnelExponent: cap.corneaExponent } : {}),
          ...(cap.corneaFlat === true ? { eyeCorneaFlat: true } : {}),
        };
        const evidence = await captureOne({
          page, baseUrl: ui.url,
          spec,
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
          spec: { ...spec, bodyGlb: "<spike>" },
          url: subjectUrl(ui.url, { ...spec, bodyGlb: "<spike>" }).slice(0, 200),
          glbSha256: cellGlbSha,
          png: abs,
          pngSha256: sha256File(abs),
          frameSpanFraction: (evidence as { frameSpanFraction?: number | null }).frameSpanFraction ?? null,
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
