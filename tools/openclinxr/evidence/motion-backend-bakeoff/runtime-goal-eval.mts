import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const REPO = join(fileURLToPath(new URL(".", import.meta.url)), "../../../..");
const OUT = join(REPO, "tools/openclinxr/evidence/motion-backend-bakeoff");
const ACTOR = join(REPO, "apps/ui-xr/public/generated-humanoids/mpfb-clinical-nurse-adult.glb");
const DESCRIPTOR = join(OUT, "runtime-goal-descriptor.json");

const MIME: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".glb": "model/gltf-binary",
  ".json": "application/json",
};

const sha256 = (buf: Buffer): string => createHash("sha256").update(buf).digest("hex");
const descriptor = JSON.parse(readFileSync(DESCRIPTOR, "utf8"));

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
    res.end(readFileSync(file));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no port assigned");
  return {
    port: address.port,
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve());
      }),
  };
}

async function main(): Promise<void> {
  const http = await serve(REPO, 0);
  const port = http.port;
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 1280 } });
  await page.goto(`http://127.0.0.1:${port}/tools/openclinxr/evidence/motion-backend-bakeoff/harness.html`, {
    waitUntil: "networkidle",
    timeout: 120_000,
  });
  await page.waitForFunction(() => (window as unknown as { __bakeoffReady?: boolean }).__bakeoffReady === true, {
    timeout: 120_000,
  });

  const payload = await page.evaluate(
    async () => (window as unknown as { __runtimeGoalEval: () => Promise<unknown> }).__runtimeGoalEval(),
  );
  await browser.close();
  await http.close();

  // Content-addressing: canonical hash of the descriptor (excluding the contentSha256 field),
  // and the actor bytes both arms solve on.
  const canonical = (obj: Record<string, unknown>): string => {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      if (key === "contentSha256") continue;
      sorted[key] = obj[key];
    }
    return JSON.stringify(sorted);
  };
  const descriptorSha256 = createHash("sha256").update(canonical(descriptor)).digest("hex");
  if (descriptorSha256 !== descriptor.contentSha256) {
    throw new Error(`descriptor self-hash mismatch: ${descriptorSha256} vs ${descriptor.contentSha256}`);
  }

  const report = {
    ...(payload as object),
    schemaVersion: "openclinxr.motion-backend-bakeoff.runtime-goal-eval.v1",
    measuredAgainstCommit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPO, encoding: "utf8" }).trim(),
    actorAssetSha256: sha256(readFileSync(ACTOR)),
    actorId: "mpfb-clinical-nurse-adult",
    descriptorSha256,
  };
  writeFileSync(join(OUT, "runtime-goal-eval.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ report: join(OUT, "runtime-goal-eval.json"), descriptorSha256 }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
