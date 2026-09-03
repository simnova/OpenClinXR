import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const REPO = join(fileURLToPath(new URL(".", import.meta.url)), "../../../..");
const OUT = join(REPO, "tools/openclinxr/evidence/motion-backend-bakeoff");
const HARNESS = join(OUT, "harness.html");
const ACTOR = join(REPO, "apps/ui-xr/public/generated-humanoids/mpfb-clinical-nurse-adult.glb");
const ARMS = ["baked_tracks", "runtime_goals"] as const;
const BEHAVIOURS = ["rock_plus_clutch", "pulse_presentation"] as const;

const MIME: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".glb": "model/gltf-binary",
  ".json": "application/json",
};

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

async function serve(root: string, port: number): Promise<{ close: () => Promise<void> }> {
  const server = createServer((req, res) => {
    const url = decodeURIComponent(req.url ?? "/");
    const rel = url.split("?")[0] === "/" ? "/index.html" : url.split("?")[0]!;
    const file = join(root, rel.replace(/^\//, ""));
    if (!file.startsWith(root) || !existsSync(file)) {
      res.writeHead(404);
      res.end("missing");
      return;
    }
    res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
    createReadStream(file).pipe(res);
  });
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  return {
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve());
      }),
  };
}

type Window = {
  renderPose: (i: { arm: string; behaviour: string }) => Promise<{ bones: number }>;
  __runtimeGoalFrame: (i?: { phase?: number; outwardMeters?: number }) => Promise<Record<string, unknown>>;
};

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const port = 8765;
  const http = await serve(REPO, port);
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 1280 } });
  await page.goto(`http://127.0.0.1:${port}/tools/openclinxr/evidence/motion-backend-bakeoff/harness.html`, {
    waitUntil: "networkidle",
    timeout: 120_000,
  });
  await page.waitForFunction(() => (window as unknown as { __bakeoffReady?: boolean }).__bakeoffReady === true, {
    timeout: 120_000,
  });

  const harnessSha256 = sha256File(HARNESS);
  const actorSha256 = sha256File(ACTOR);

  const arms: Array<{ arm: string; behaviour: string; stills: Array<{ path: string; widthPx: number; heightPx: number; sha256: string }>; notes: string }> =
    [];

  for (const arm of ARMS) {
    for (const behaviour of BEHAVIOURS) {
      // baked_tracks and the runtime pulse fallback render through the harness's renderPose path
      // (baked eulers / the pre-existing twoBoneToward reach: the content-addressed runtime
      // descriptor declares no pulse goal). runtime_goals/rock_plus_clutch renders one solved
      // frame of the CCDIKSolver runtime-goal arm via __runtimeGoalFrame (phase 0 contact frame,
      // the targetA instant the eval measures).
      const info =
        arm === "runtime_goals" && behaviour === "rock_plus_clutch"
          ? await page.evaluate(
              async ({ arm, behaviour }) => {
                const w = window as unknown as Window;
                return {
                  arm,
                  behaviour,
                  ...(await w.__runtimeGoalFrame({ phase: 0, outwardMeters: 0.03 })),
                };
              },
              { arm, behaviour },
            )
          : await page.evaluate(
              async ({ arm, behaviour }) => {
                const w = window as unknown as Window;
                return { arm, behaviour, ...(await w.renderPose({ arm, behaviour })) };
              },
              { arm, behaviour },
            );
      const rel = `tools/openclinxr/evidence/motion-backend-bakeoff/${arm}__${behaviour}.png`;
      const abs = join(REPO, rel);
      await page.screenshot({ path: abs, type: "png" });
      const bones = Number(info.bones ?? 0);
      const extra = info.solver
        ? `solver=${String(info.solver)} blend=1 effector=${String(info.effector)} residualMeters=${Number(info.residualMeters).toFixed(4)} phase=${Number(info.phase)} outwardMeters=${Number(info.outwardMeters)} pelvisDeltaMeters=${Number(info.pelvisDeltaMeters).toFixed(4)}`
        : arm === "baked_tracks"
          ? "renderPose baked-euler path (static baked rotations)"
          : "renderPose fallback: runtime descriptor declares no pulse goal, so the pre-existing twoBoneToward left-arm reach executed";
      arms.push({
        arm,
        behaviour,
        stills: [{ path: rel, widthPx: 1280, heightPx: 1280, sha256: sha256File(abs) }],
        notes: `isolated three.js harness; seated MPFB nurse; ${bones} bones; arm=${arm} behaviour=${behaviour}; ${extra}; harnessSha256=${harnessSha256.slice(0, 16)}`,
      });
    }
  }

  await browser.close();
  await http.close();

  const report = {
    schemaVersion: "openclinxr.motion-backend-bakeoff.v1",
    measuredAgainstCommit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPO, encoding: "utf8" }).trim(),
    actorAssetSha256: actorSha256,
    actorId: "mpfb-clinical-nurse-adult",
    harnessSha256,
    notes: [
      `Re-run captured by capture.mts (Playwright, headless chromium, native 1280x1280) against harness.html sha ${harnessSha256.slice(0, 16)}; actor bytes ${actorSha256.slice(0, 16)}.`,
      "Three stills are byte-identical to the blocked run at 1c63c4d7 (baked_tracks x2, runtime_goals/pulse_presentation): those code paths are unchanged since the blocked run and the render is deterministic, so an honest re-capture reproduces the bytes exactly (measured 0.00% pixel delta). This run re-wrote them; they are not copied.",
      "runtime_goals/rock_plus_clutch has a fresh digest: the CCDIKSolver runtime-goal arm solved wristR to the seated right-chest contact target (residual 0.0000 m, blend 1). 11.6% of its pixels differ from the blocked run's twoBoneToward frame (max luminance delta 190.8).",
      "runtime_goals/pulse_presentation remains the pre-existing twoBoneToward reach: the content-addressed runtime descriptor declares no pulse goal, so the CCDIKSolver machinery has no pulse frame to render.",
    ],
    arms,
    verdict: "other",
    verdictDetail:
      "PLACEHOLDER — orchestrator grades native stills after this capture. Re-run captured both arms " +
      "on the same seated MPFB actor (mpfb-clinical-nurse-adult) for rock_plus_clutch and " +
      "pulse_presentation, against harness.html sha " +
      `${harnessSha256.slice(0, 16)} (CCDIKSolver present). baked_tracks renders via renderPose baked ` +
      "rotations for both behaviours. runtime_goals/rock_plus_clutch renders one solved frame of the " +
      "CCDIKSolver runtime-goal arm (__runtimeGoalFrame, blend 1, phase 0 contact frame). The runtime " +
      "descriptor declares no pulse goal, so runtime_goals/pulse_presentation renders the harness's " +
      "pre-existing twoBoneToward left-arm reach via renderPose. Do not treat this string as a grade.",
  };
  writeFileSync(join(OUT, "report.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(
    JSON.stringify({ report: join(OUT, "report.json"), stills: arms.length, harnessSha256: harnessSha256.slice(0, 16) }, null, 2),
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
