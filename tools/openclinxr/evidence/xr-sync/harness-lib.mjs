#!/usr/bin/env node
/**
 * Shared host/quest harness plumbing for the xr-sync Colyseus probes.
 *
 * Used by BOTH c2-run.mjs and c3-run.mjs. Quest behaviour (VIEW-intent
 * launch, exact-URL attach, outer finally removing reverses + tcp:9222
 * forward) lives here verbatim so the two runners cannot drift.
 */
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const PLAYWRIGHT_CDP_PORT = 9222;
export const DONE_TIMEOUT_MS = 150000;
export const POLL_MS = 250;

export function usage() {
  return [
    "usage:",
    "  node c2-run.mjs --mode host --out <dir>",
    "  node c2-run.mjs --mode quest --serial <serial> --out <dir>",
    "  node c3-run.mjs --mode host --out <dir>",
    "  node c3-run.mjs --mode quest --serial <serial> --out <dir>",
  ].join("\n");
}

export function parseArgs(argv) {
  const options = { mode: null, serial: null, out: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--mode") {
      options.mode = argv[i + 1];
      i += 1;
    } else if (arg === "--serial") {
      options.serial = argv[i + 1];
      i += 1;
    } else if (arg === "--out") {
      options.out = argv[i + 1];
      i += 1;
    } else {
      throw new Error(`unknown argument: ${arg}\n${usage()}`);
    }
  }
  if (options.mode !== "host" && options.mode !== "quest") {
    throw new Error(`--mode must be host or quest\n${usage()}`);
  }
  if (options.mode === "quest" && !options.serial) {
    throw new Error(`--mode quest requires --serial <serial>\n${usage()}`);
  }
  if (!options.out) {
    throw new Error(`--out <dir> is required\n${usage()}`);
  }
  return options;
}

function percentile(sorted, p) {
  if (sorted.length === 0) {
    return 0;
  }
  const rank = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return Number(sorted[Math.max(0, rank)].toFixed(2));
}

export function summarize(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    n: sorted.length,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    max: sorted.length === 0 ? 0 : Number(sorted[sorted.length - 1].toFixed(2)),
  };
}

const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".map": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".wasm": "application/wasm",
  ".glb": "model/gltf-binary",
  ".ico": "image/x-icon",
};

export async function startStaticServer(root) {
  const server = createServer((req, res) => {
    void (async () => {
      try {
        const url = new URL(req.url ?? "/", "http://127.0.0.1");
        let pathname = decodeURIComponent(url.pathname);
        if (pathname.endsWith("/")) {
          pathname += "index.html";
        }
        if (pathname.includes("..") || pathname.includes("\0")) {
          res.writeHead(400);
          res.end("bad path");
          return;
        }
        const file = join(root, pathname);
        if (!existsSync(file) || statSync(file).isDirectory()) {
          res.writeHead(404);
          res.end("not found");
          return;
        }
        const ext = extname(file);
        if (!(ext in MIME)) {
          res.writeHead(403);
          res.end("forbidden type");
          return;
        }
        res.writeHead(200, { "Content-Type": MIME[ext] });
        createReadStream(file).pipe(res);
      } catch {
        res.writeHead(500);
        res.end("static error");
      }
    })();
  });
  await new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolvePromise();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("static server has no port");
  }
  return {
    port: address.port,
    async close() {
      await new Promise((resolvePromise) => server.close(() => resolvePromise()));
    },
  };
}

export async function adb(serial, args) {
  const { stdout } = await execFileAsync("adb", ["-s", serial, ...args], { timeout: 30000 });
  return stdout.trim();
}

export async function collectBundleSentry({ appDist, appSrcSyncProbe, extraBanned = [] }) {
  // Source/bundle import-surface check: the page must never touch the server
  // package or @colyseus/core (networking is xr-sync-client only).
  const banned = ["@openclinxr/xr-sync-server", "@colyseus/core", ...extraBanned];
  const hits = [];
  for (const file of ["probe-state.ts", "sync-probe.ts"]) {
    const source = await readFile(join(appSrcSyncProbe, file), "utf8");
    for (const marker of banned) {
      if (source.includes(marker)) {
        hits.push(`src/sync-probe/${file} contains ${marker}`);
      }
    }
  }
  const manifest = JSON.parse(await readFile(join(appDist, ".vite", "manifest.json"), "utf8"));
  const entry = manifest["sync-probe.html"];
  if (!entry) {
    hits.push("manifest missing sync-probe.html");
    return { hits };
  }
  const chunkFiles = new Set();
  const visit = (key) => {
    const node = manifest[key];
    if (!node || chunkFiles.has(node.file)) {
      return;
    }
    chunkFiles.add(node.file);
    for (const dep of [...(node.imports ?? []), ...(node.dynamicImports ?? [])]) {
      if (manifest[dep]) {
        visit(dep);
        continue;
      }
      const depKey = Object.keys(manifest).find((k) => manifest[k].file === dep);
      if (depKey) {
        visit(depKey);
      }
    }
  };
  visit("sync-probe.html");
  for (const file of chunkFiles) {
    if (!file.endsWith(".js")) {
      continue;
    }
    const code = await readFile(join(appDist, file), "utf8");
    for (const marker of banned) {
      if (code.includes(marker)) {
        hits.push(`dist/${file} contains ${marker}`);
      }
    }
  }
  return { hits, chunks: [...chunkFiles].sort() };
}

export async function runHostProbe({ pageUrl, outDir }) {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true, args: ["--disable-features=WebXR"] });
  const pageErrors = [];
  const consoleErrors = [];
  try {
    const context = await browser.newContext({ viewport: { width: 800, height: 600 } });
    const page = await context.newPage();
    page.on("pageerror", (error) => pageErrors.push(String(error).slice(0, 300)));
    page.on("console", (message) => {
      if (message.type() === "error") {
        consoleErrors.push(message.text().slice(0, 300));
      }
    });
    await page.goto(pageUrl, { timeout: 60000, waitUntil: "load" });
    const deadline = Date.now() + DONE_TIMEOUT_MS;
    let probe = null;
    for (;;) {
      probe = await page.evaluate(() => window.__syncProbe ?? null);
      if (probe?.done === true) {
        break;
      }
      if (Date.now() > deadline) {
        throw new Error("timed out waiting for window.__syncProbe.done");
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
    probe = await page.evaluate(() => window.__syncProbe);
    await context.close();
    void outDir;
    return { probe, pageErrors, consoleErrors, browserProduct: await browser.version() };
  } finally {
    await browser.close();
  }
}

export async function runQuestProbe({ pageUrl, outDir, serial }) {
  // Remove our reverses even when launch/connect throws before the inner
  // finally is reached (a connect failure leaked tcp:54054/54055 on 2026-10-30).
  try {
    return await runQuestProbeInner({ pageUrl, outDir, serial });
  } finally {
    const httpPort = new URL(pageUrl).port;
    const syncPort = new URL(pageUrl).searchParams.get("sync")?.match(/:(\d+)$/)?.[1];
    for (const port of [httpPort, syncPort].filter(Boolean)) {
      await adb(serial, ["reverse", "--remove", `tcp:${port}`]).catch(() => {});
    }
    await adb(serial, ["forward", "--remove", `tcp:${PLAYWRIGHT_CDP_PORT}`]).catch(() => {});
  }
}

async function runQuestProbeInner({ pageUrl, outDir, serial }) {
  // Quest mode (NOT executed by the C2 author): Oculus Browser via CDP.
  // Owns a single new target only; never touches foreign tabs.
  const { chromium } = await import("playwright");
  const httpPort = new URL(pageUrl).port;
  const syncPort = new URL(pageUrl).searchParams.get("sync")?.match(/:(\d+)$/)?.[1];
  if (!syncPort) {
    throw new Error("cannot parse sync port for adb reverse");
  }
  await adb(serial, ["reverse", `tcp:${httpPort}`, `tcp:${httpPort}`]);
  await adb(serial, ["reverse", `tcp:${syncPort}`, `tcp:${syncPort}`]);
  await adb(serial, ["forward", `tcp:${PLAYWRIGHT_CDP_PORT}`, "localabstract:chrome_devtools_remote"]);
  const pageErrors = [];
  const consoleErrors = [];
  // The devtools socket exists only while Oculus Browser runs: launch our page
  // first with a VIEW intent, then wait for the socket before connecting.
  const quoted = pageUrl.replace(/'/g, "'\\''");
  await adb(serial, ["shell", `am start -a android.intent.action.VIEW -d '${quoted}' com.oculus.browser`]);
  const socketDeadline = Date.now() + 30000;
  for (;;) {
    try {
      const response = await fetch(`http://127.0.0.1:${PLAYWRIGHT_CDP_PORT}/json/version`);
      if (response.ok) break;
    } catch {}
    if (Date.now() > socketDeadline) throw new Error("Oculus Browser devtools socket not up within 30 s");
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PLAYWRIGHT_CDP_PORT}`);
  try {
    const before = new Set();
    for (const context of browser.contexts()) {
      for (const existing of context.pages()) {
        before.add(existing);
      }
    }
    // Oculus Browser refuses Target.createTarget/newPage over CDP. Open our
    // URL with a VIEW intent (quest-cdp-smoke.ts pattern), then attach to it.
    let page = null;
    const attachDeadline = Date.now() + 30000;
    while (!page) {
      for (const context of browser.contexts()) {
        for (const candidate of context.pages()) {
          if (candidate.url() === pageUrl) {
            page = candidate;
          }
        }
      }
      if (page) break;
      if (Date.now() > attachDeadline) {
        throw new Error("VIEW intent page did not appear over CDP within 30 s");
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    page.on("pageerror", (error) => pageErrors.push(String(error).slice(0, 300)));
    page.on("console", (message) => {
      if (message.type() === "error") {
        consoleErrors.push(message.text().slice(0, 300));
      }
    });
    await page.waitForLoadState("load", { timeout: 120000 });
    const deadline = Date.now() + DONE_TIMEOUT_MS;
    let probe = null;
    for (;;) {
      probe = await page.evaluate(() => window.__syncProbe ?? null);
      if (probe?.done === true) {
        break;
      }
      if (Date.now() > deadline) {
        throw new Error("timed out waiting for window.__syncProbe.done");
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
    probe = await page.evaluate(() => window.__syncProbe);
    // Close ONLY our own target; foreign tabs are never touched.
    await page.close();
    void before;
    void outDir;
    return { probe, pageErrors, consoleErrors, browserProduct: browser.version() };
  } finally {
    // Detach-only semantics: never browser.close() over CDP (that would kill
    // the on-device browser). The node process exit drops the CDP session.
    await adb(serial, ["reverse", "--remove", `tcp:${httpPort}`]);
    await adb(serial, ["reverse", "--remove", `tcp:${syncPort}`]);
    await adb(serial, ["forward", "--remove", `tcp:${PLAYWRIGHT_CDP_PORT}`]);
  }
}
