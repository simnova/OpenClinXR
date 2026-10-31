#!/usr/bin/env node
/**
 * Portless dev-service harness (RED planted by root, 2026-10-30).
 *
 * Operator 2026-10-30: "let's do the portless for local dev to avoid C13's 405 as portless should be
 * consistnet for dev services". Portless allocates the port and the <name>.localhost route; clients dial
 * ws://127.0.0.1:<PORT> directly (the proxy's TLS mode drops plain ws:// and carries no UDP).
 * Tests and the c*-run harnesses keep in-process port-0 servers; this harness is for the dev entrypoint.
 *
 * Host only:  node portless-dev-run.mjs --out <dir>
 *
 * Contract for the dev entrypoint (names are the spec):
 *   `pnpm --filter @openclinxr/xr-sync-server dev:portless` runs `portless xr-sync-<instance> <dev server>`,
 *   instance = $XR_SYNC_INSTANCE, defaulting to the worktree directory name (distinct per worktree).
 *   The dev server listens on Number(process.env.PORT) at 127.0.0.1 and prints exactly one line
 *   `xr-sync listening ws://127.0.0.1:<port> instance=xr-sync-<instance>` once it accepts joins.
 *   SIGTERM closes the server and exits.
 *
 * Assertions:
 *   P1 both instances print their listening line; the two ports differ; each port equals the port
 *      portless assigned ("Using port N"), so the server honoured PORT rather than binding 0.
 *   P2 ~/.portless/routes.json holds { hostname: "xr-sync-<instance>.localhost", port } for each.
 *   P3 each port is held on 127.0.0.1: a second loopback bind fails EADDRINUSE (wildcard bind fails this).
 *   P4 two browser pages run the C2 sync-probe script at the same time, one per instance: each completes,
 *      0 page errors, 0 rejects, every sent seq acked in order, the page's synced snapshot caught up to its
 *      last sent seq, page-local selection [a1,a2].
 *      Pages dial ws://127.0.0.1:<instance port> directly (built by this harness), never the proxy.
 *   P5 teardown: SIGTERM to each process group; both exit within 10 s; both routes leave routes.json;
 *      each port binds again (the server released it).
 * Exit 1 on any failed assertion. The run file is always written first.
 */
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runHostProbe, startStaticServer } from "./harness-lib.mjs";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const WORKTREE_ROOT = resolve(HERE, "..", "..", "..", "..");
const APP_DIST = join(WORKTREE_ROOT, "apps", "arena", "ui-xr-iwsdk-spike", "dist");
const ROUTES_FILE = join(homedir(), ".portless", "routes.json");
const READY_TIMEOUT_MS = 120000;
const EXIT_TIMEOUT_MS = 10000;
const LISTEN_RE = /xr-sync listening ws:\/\/127\.0\.0\.1:(\d+) instance=(\S+)/;
const PORTLESS_PORT_RE = /Using port (\d+)/;

function parseOut(argv) {
  const i = argv.indexOf("--out");
  if (i < 0 || !argv[i + 1]) throw new Error("usage: node portless-dev-run.mjs --out <dir>");
  return resolve(argv[i + 1]);
}

function startInstance(instance) {
  const proc = spawn("pnpm", ["--filter", "@openclinxr/xr-sync-server", "dev:portless"], {
    cwd: WORKTREE_ROOT,
    env: { ...process.env, XR_SYNC_INSTANCE: instance, FORCE_COLOR: "0" },
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const record = { instance, name: `xr-sync-${instance}`, proc, output: "", port: null, printedName: null, portlessPort: null, exited: false, exitCode: null };
  const onData = (chunk) => {
    record.output += chunk.toString();
    const listen = record.output.match(LISTEN_RE);
    if (listen && record.port === null) {
      record.port = Number(listen[1]);
      record.printedName = listen[2];
    }
    const assigned = record.output.match(PORTLESS_PORT_RE);
    if (assigned && record.portlessPort === null) record.portlessPort = Number(assigned[1]);
  };
  proc.stdout.on("data", onData);
  proc.stderr.on("data", onData);
  record.exitPromise = new Promise((done) => proc.once("exit", (code) => {
    record.exited = true;
    record.exitCode = code;
    done();
  }));
  return record;
}

async function waitFor(predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await new Promise((done) => setTimeout(done, 200));
  }
}

function bindLoopback(port) {
  return new Promise((done) => {
    const probe = createServer();
    probe.once("error", (error) => done(error.code ?? "unknown-error"));
    probe.listen(port, "127.0.0.1", () => probe.close(() => done("bound")));
  });
}

async function readRoutes() {
  try {
    return JSON.parse(await readFile(ROUTES_FILE, "utf8"));
  } catch {
    return [];
  }
}

async function stopInstance(record) {
  if (record.exited) return true;
  try {
    process.kill(-record.proc.pid, "SIGTERM");
  } catch {
    return record.exited;
  }
  const exited = await Promise.race([record.exitPromise.then(() => true), new Promise((done) => setTimeout(() => done(false), EXIT_TIMEOUT_MS))]);
  if (!exited) {
    try {
      process.kill(-record.proc.pid, "SIGKILL");
    } catch {
      // already gone
    }
  }
  return exited;
}

async function main(argv) {
  const outDir = parseOut(argv);
  await mkdir(outDir, { recursive: true });
  const startedMs = Date.now();
  const run = { startedAt: new Date().toISOString(), instances: [], pages: [], routesWhileRunning: null, routesAfter: null, assertions: [], fatal: null, elapsedMs: null };
  let exitCode = 0;
  const check = (name, pass, detail) => {
    run.assertions.push({ name, pass, detail: String(detail ?? "") });
    if (!pass) exitCode = 1;
  };

  const records = [`a-${process.pid}`, `b-${process.pid}`].map(startInstance);
  let staticServer = null;
  try {
    await waitFor(() => records.every((r) => r.port !== null || r.exited), READY_TIMEOUT_MS, "both listening lines");
    const [a, b] = records;
    check(
      "P1 both instances print the listening line with their own name",
      records.every((r) => r.port !== null && r.printedName === r.name),
      records.map((r) => `${r.name}:${r.port}:${r.printedName}`).join(" "),
    );
    check("P1 the two ports differ", a.port !== null && b.port !== null && a.port !== b.port, `${a.port} ${b.port}`);
    check(
      "P1 each server port equals the portless-assigned PORT",
      records.every((r) => r.port !== null && r.port === r.portlessPort),
      records.map((r) => `${r.name} server=${r.port} portless=${r.portlessPort}`).join(" "),
    );

    run.routesWhileRunning = await readRoutes();
    check(
      "P2 routes.json holds <name>.localhost -> port for each instance",
      records.every((r) => run.routesWhileRunning.some((route) => route.hostname === `${r.name}.localhost` && route.port === r.port)),
      JSON.stringify(run.routesWhileRunning.filter((route) => String(route.hostname).startsWith("xr-sync-"))),
    );

    const binds = [];
    for (const r of records) binds.push(await bindLoopback(r.port));
    check("P3 each port is held on 127.0.0.1 (second bind EADDRINUSE)", binds.every((code) => code === "EADDRINUSE"), binds.join(" "));

    staticServer = await startStaticServer(APP_DIST);
    const pageUrls = records.map((r) => {
      const params = new URLSearchParams({ sync: `ws://127.0.0.1:${r.port}`, iwer: "1", autostart: "1" });
      return `http://127.0.0.1:${staticServer.port}/sync-probe.html?${params.toString()}`;
    });
    const outcomes = await Promise.all(records.map((r, i) => runHostProbe({ pageUrl: pageUrls[i], outDir: join(outDir, r.name) })));
    outcomes.forEach((outcome, i) => {
      const r = records[i];
      const probe = outcome.probe;
      run.pages.push({ name: r.name, pageUrl: pageUrls[i], probe, pageErrors: outcome.pageErrors, consoleErrors: outcome.consoleErrors });
      const sentSeqs = probe.sentSeqs ?? [];
      const ackSeqs = probe.ackSeqs ?? [];
      const inOrder = sentSeqs.length > 0 && sentSeqs.length === ackSeqs.length && sentSeqs.every((seq, k) => seq === k + 1 && ackSeqs[k] === seq);
      const learners = Object.values(probe.lastServerState?.learners ?? {});
      const caughtUp = learners.length === 1 && learners[0].lastSeq === probe.sent;
      check(
        `P4 ${r.name} page completed and synced`,
        probe.done === true && probe.error == null && outcome.pageErrors.length === 0 && probe.rejects === 0 && inOrder && caughtUp
          && JSON.stringify(probe.selectedLocal ?? []) === JSON.stringify(["a1", "a2"]),
        `done=${probe.done} error=${probe.error ?? "none"} pageErrors=${outcome.pageErrors.length} rejects=${probe.rejects} sent=${sentSeqs.length} acks=${ackSeqs.length} snapshotSeq=${learners[0]?.lastSeq} selected=${(probe.selectedLocal ?? []).join(",")}`,
      );
    });
  } catch (error) {
    exitCode = 1;
    run.fatal = String(error?.stack ?? error).slice(0, 1000);
  } finally {
    if (staticServer) await staticServer.close().catch(() => undefined);
    const stopped = [];
    for (const r of records) stopped.push(await stopInstance(r));
    await new Promise((done) => setTimeout(done, 500));
    run.routesAfter = await readRoutes();
    const rebinds = [];
    for (const r of records) rebinds.push(r.port === null ? "no-port" : await bindLoopback(r.port));
    if (run.fatal === null && records.every((r) => r.port !== null)) {
      check("P5 both instances exit within 10 s of SIGTERM", stopped.every(Boolean), stopped.join(" "));
      check("P5 both routes leave routes.json", records.every((r) => !run.routesAfter.some((route) => route.hostname === `${r.name}.localhost`)), JSON.stringify(run.routesAfter));
      check("P5 each port binds again after teardown", rebinds.every((code) => code === "bound"), rebinds.join(" "));
    }
    run.instances = records.map((r) => ({ instance: r.instance, name: r.name, port: r.port, printedName: r.printedName, portlessPort: r.portlessPort, exitCode: r.exitCode, output: r.output.slice(-4000) }));
    run.elapsedMs = Date.now() - startedMs;
    await writeFile(join(outDir, "portless-dev-run.json"), `${JSON.stringify(run, null, 2)}\n`, "utf8");
    if (run.fatal) console.log(`FATAL ${run.fatal.slice(0, 400)}`);
    for (const assertion of run.assertions) console.log(`${assertion.pass ? "PASS" : "FAIL"} ${assertion.name} ${assertion.detail}`.slice(0, 260));
    console.log(`wrote ${join(outDir, "portless-dev-run.json")}`);
  }
  process.exitCode = exitCode;
}

await main(process.argv.slice(2));
process.exit(process.exitCode ?? 0);
