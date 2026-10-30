#!/usr/bin/env node
/**
 * C2 host/quest harness: server-authoritative sync probe with scripted IWER input.
 *
 * Host:  node c2-run.mjs --mode host --out <dir>
 * Quest:  node c2-run.mjs --mode quest --serial <serial> --out <dir>
 *         (implemented, NOT executed by the C2 author; root runs it on-device)
 *
 * Flow: start createEncounterServer (ephemeral) -> serve the built app ->
 * open sync-probe.html in an owned browser target -> the page auto-runs the
 * FIXED deterministic script through IWER (head yaw sweep 0->+30->-30->0 over
 * 6 s, aim+trigger on a1 then a2) -> collect server-side + page-side evidence
 * -> assert -> write run JSON -> cleanup (quest: also remove adb reverses and
 * verify with `adb reverse --list`).
 *
 * Exit 1 on any failed assertion. The run file is always written first.
 */
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const HERE = fileURLToPath(new URL(".", import.meta.url));
const WORKTREE_ROOT = resolve(HERE, "..", "..", "..", "..");
const SERVER_DIST = join(WORKTREE_ROOT, "packages", "openclinxr", "xr-sync-server", "dist", "index.js");
const APP_DIST = join(WORKTREE_ROOT, "apps", "arena", "ui-xr-iwsdk-spike", "dist");
const APP_SRC_SYNC_PROBE = join(WORKTREE_ROOT, "apps", "arena", "ui-xr-iwsdk-spike", "src", "sync-probe");
const PLAYWRIGHT_CDP_PORT = 9222;
const DONE_TIMEOUT_MS = 150000;
const POLL_MS = 250;

function usage() {
  return [
    "usage:",
    "  node c2-run.mjs --mode host --out <dir>",
    "  node c2-run.mjs --mode quest --serial <serial> --out <dir>",
  ].join("\n");
}

function parseArgs(argv) {
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

function summarize(samples) {
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

async function startStaticServer(root) {
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

async function adb(serial, args) {
  const { stdout } = await execFileAsync("adb", ["-s", serial, ...args], { timeout: 30000 });
  return stdout.trim();
}

async function collectBundleSentry() {
  // Source/bundle import-surface check: the page must never touch the server
  // package or @colyseus/core (networking is xr-sync-client only).
  const banned = ["@openclinxr/xr-sync-server", "@colyseus/core"];
  const hits = [];
  for (const file of ["probe-state.ts", "sync-probe.ts"]) {
    const source = await readFile(join(APP_SRC_SYNC_PROBE, file), "utf8");
    for (const marker of banned) {
      if (source.includes(marker)) {
        hits.push(`src/sync-probe/${file} contains ${marker}`);
      }
    }
  }
  const manifest = JSON.parse(await readFile(join(APP_DIST, ".vite", "manifest.json"), "utf8"));
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
    const code = await readFile(join(APP_DIST, file), "utf8");
    for (const marker of banned) {
      if (code.includes(marker)) {
        hits.push(`dist/${file} contains ${marker}`);
      }
    }
  }
  return { hits, chunks: [...chunkFiles].sort() };
}

async function runHostProbe({ pageUrl, outDir }) {
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
    return { probe, pageErrors, consoleErrors, browserProduct: await browser.version() };
  } finally {
    await browser.close();
  }
}

async function runQuestProbe({ pageUrl, outDir, serial }) {
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
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PLAYWRIGHT_CDP_PORT}`);
  try {
    const before = new Set();
    for (const context of browser.contexts()) {
      for (const existing of context.pages()) {
        before.add(existing);
      }
    }
    const page = await browser.newPage();
    page.on("pageerror", (error) => pageErrors.push(String(error).slice(0, 300)));
    page.on("console", (message) => {
      if (message.type() === "error") {
        consoleErrors.push(message.text().slice(0, 300));
      }
    });
    await page.goto(pageUrl, { timeout: 120000, waitUntil: "load" });
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
    return { probe, pageErrors, consoleErrors, browserProduct: browser.version() };
  } finally {
    // Detach-only semantics: never browser.close() over CDP (that would kill
    // the on-device browser). The node process exit drops the CDP session.
    await adb(serial, ["reverse", "--remove", `tcp:${httpPort}`]);
    await adb(serial, ["reverse", "--remove", `tcp:${syncPort}`]);
    await adb(serial, ["forward", "--remove", `tcp:${PLAYWRIGHT_CDP_PORT}`]);
  }
}

async function main(argv) {
  const options = parseArgs(argv);
  const outDir = resolve(options.out);
  await mkdir(outDir, { recursive: true });
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();

  const { createEncounterServer } = await import(SERVER_DIST);
  const syncServer = await createEncounterServer();
  const staticServer = await startStaticServer(APP_DIST);
  const cleanup = { syncClosed: false, staticClosed: false };

  const run = {
    mode: options.mode,
    serial: options.mode === "quest" ? options.serial : null,
    startedAt,
    syncUrl: syncServer.url,
    pageUrl: null,
    probe: null,
    serverState: null,
    probeStats: null,
    rttMs: null,
    frameMs: null,
    assertions: [],
    pageErrors: [],
    consoleErrors: [],
    adbReverseList: null,
    bundleCheck: null,
    elapsedMs: null,
  };

  let exitCode = 0;
  try {
    const params = new URLSearchParams({
      sync: syncServer.url,
      iwer: "1",
      autostart: "1",
      ...(options.mode === "quest" ? { forceIwer: "1" } : {}),
    });
    run.pageUrl = `http://127.0.0.1:${staticServer.port}/sync-probe.html?${params.toString()}`;

    const outcome =
      options.mode === "host"
        ? await runHostProbe({ pageUrl: run.pageUrl, outDir })
        : await runQuestProbe({ pageUrl: run.pageUrl, outDir, serial: options.serial });
    run.probe = outcome.probe;
    run.pageErrors = outcome.pageErrors;
    run.consoleErrors = outcome.consoleErrors;
    run.browserProduct = outcome.browserProduct;

    const probe = outcome.probe;
    run.serverState = JSON.parse(syncServer.getStateJSON());
    run.probeStats = syncServer.getProbeStats();
    run.rttMs = summarize(probe.rttMs ?? []);
    run.frameMs = summarize(probe.frameMs ?? []);
    run.bundleCheck = await collectBundleSentry();

    const check = (name, pass, detail) => {
      run.assertions.push({ name, pass, detail: String(detail ?? "") });
      if (!pass) {
        exitCode = 1;
      }
    };

    const learnerIds = Object.keys(run.serverState.learners ?? {});
    const learner = learnerIds.length === 1 ? run.serverState.learners[learnerIds[0]] : null;
    const lastPose = probe.lastSentPose;
    check("probe completed without error", probe.done === true && probe.error == null, probe.error ?? "done");
    check("no page errors", run.pageErrors.length === 0, run.pageErrors.join(" | ").slice(0, 300) || "0 pageerrors");
    check("rejects == 0", probe.rejects === 0 && (probe.rejectDetails ?? []).length === 0, `rejects=${probe.rejects}`);
    const sentSeqs = probe.sentSeqs ?? [];
    const ackSeqs = probe.ackSeqs ?? [];
    const inOrder = sentSeqs.length > 0 && sentSeqs.length === ackSeqs.length && sentSeqs.every((seq, i) => seq === i + 1 && ackSeqs[i] === seq);
    check("every sent seq acked in order", inOrder, `sent=${sentSeqs.length} acks=${ackSeqs.length}`);
    check(
      "server learner pose equals page last sent pose (exact)",
      learner !== null && lastPose !== null && learner.lastSeq === lastPose.seq && learner.headX === lastPose.x && learner.headY === lastPose.y && learner.headZ === lastPose.z,
      `server=${learner ? `${learner.headX},${learner.headY},${learner.headZ}#${learner.lastSeq}` : "none"} page=${lastPose ? `${lastPose.x},${lastPose.y},${lastPose.z}#${lastPose.seq}` : "none"}`,
    );
    const selectedSequence = (run.probeStats.selections ?? []).map((entry) => entry.actorId);
    check("server selected-actor sequence == [a1,a2]", JSON.stringify(selectedSequence) === JSON.stringify(["a1", "a2"]), selectedSequence.join(",") || "empty");
    check("page-local selection matches server", JSON.stringify(probe.selectedLocal ?? []) === JSON.stringify(["a1", "a2"]), (probe.selectedLocal ?? []).join(",") || "empty");
    check("no select misses", (probe.selectMisses ?? 0) === 0, `misses=${probe.selectMisses ?? 0}`);
    const counts = run.probeStats.intentCounts ?? {};
    check(
      "server intent counts match page sends",
      counts.pose === (probe.sentByKind?.pose ?? -1) && counts["select-actor"] === 2 && counts["utterance-start"] === 2,
      JSON.stringify(counts),
    );
    const actors = run.serverState.actors ?? {};
    check("server state shows a1+a2 speaking", actors.a1?.speaking === true && actors.a2?.speaking === true, `a1=${actors.a1?.speaking} a2=${actors.a2?.speaking}`);
    check("page snapshot caught up to final seq", probe.lastServerState?.learners?.[learnerIds[0]]?.lastSeq === probe.sent, `snapshotSeq=${probe.lastServerState?.learners?.[learnerIds[0]]?.lastSeq} sent=${probe.sent}`);
    check("bundle/source free of server imports", run.bundleCheck.hits.length === 0, run.bundleCheck.hits.join(" | ").slice(0, 300) || "clean");

    if (options.mode === "quest") {
      run.adbReverseList = await adb(options.serial, ["reverse", "--list"]);
      const leaked = run.adbReverseList.includes(`${staticServer.port}`) || run.adbReverseList.includes(`${syncServer.port}`);
      check("adb reverses removed", !leaked, run.adbReverseList.slice(0, 300) || "empty list");
    }
  } catch (error) {
    exitCode = 1;
    run.fatal = String(error?.stack ?? error).slice(0, 1000);
  } finally {
    try {
      await syncServer.close();
      cleanup.syncClosed = true;
    } catch {
      // best-effort
    }
    try {
      await staticServer.close();
      cleanup.staticClosed = true;
    } catch {
      // best-effort
    }
    run.cleanup = cleanup;
    run.elapsedMs = Date.now() - startedMs;
    await writeFile(join(outDir, "c2-run.json"), `${JSON.stringify(run, null, 2)}\n`, "utf8");
    for (const assertion of run.assertions) {
      console.log(`${assertion.pass ? "PASS" : "FAIL"} ${assertion.name} ${assertion.detail}`.slice(0, 220));
    }
    console.log(`wrote ${join(outDir, "c2-run.json")}`);
  }
  process.exitCode = exitCode;
}

await main(process.argv.slice(2));
