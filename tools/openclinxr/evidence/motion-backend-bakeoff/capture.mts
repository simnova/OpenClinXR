import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const REPO = join(fileURLToPath(new URL(".", import.meta.url)), "../../../..");
const OUT = join(REPO, "tools/openclinxr/evidence/motion-backend-bakeoff");
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

  const arms: Array<{ arm: string; behaviour: string; stills: Array<{ path: string; widthPx: number; heightPx: number; sha256: string }>; notes: string }> =
    [];

  for (const arm of ARMS) {
    for (const behaviour of BEHAVIOURS) {
      const info = await page.evaluate(async ({ arm, behaviour }) => {
        return (window as unknown as { renderPose: (i: { arm: string; behaviour: string }) => Promise<{ bones: number }> }).renderPose({
          arm,
          behaviour,
        });
      }, { arm, behaviour });
      const rel = `tools/openclinxr/evidence/motion-backend-bakeoff/${arm}__${behaviour}.png`;
      const abs = join(REPO, rel);
      await page.screenshot({ path: abs, type: "png" });
      arms.push({
        arm,
        behaviour,
        stills: [{ path: rel, widthPx: 1280, heightPx: 1280, sha256: sha256File(abs) }],
        notes: `isolated three.js harness; seated MPFB nurse; ${info.bones} bones; arm=${arm} behaviour=${behaviour}`,
      });
    }
  }

  await browser.close();
  await http.close();

  const report = {
    schemaVersion: "openclinxr.motion-backend-bakeoff.v1",
    measuredAgainstCommit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPO, encoding: "utf8" }).trim(),
    actorAssetSha256: sha256File(ACTOR),
    actorId: "mpfb-clinical-nurse-adult",
    arms,
    verdict: "other",
    verdictDetail:
      "PLACEHOLDER — orchestrator grades native stills after this capture. Do not treat this string as a grade.",
  };
  writeFileSync(join(OUT, "report.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ report: join(OUT, "report.json"), stills: arms.length }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
