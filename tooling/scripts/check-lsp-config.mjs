#!/usr/bin/env node
/**
 * Structural check: project Grok LSP config points at installable stdio servers.
 * Exit 0 when .grok/lsp.json is valid and required binaries exist.
 *
 * Grok routes **one** language server per file extension for agent `lsp` tool
 * requests (hover / definition / documentSymbol). Overlapping
 * `extensionToLanguage` maps (e.g. knip + typescript both claiming `.ts`) cause
 * textDocument/* methods to hit a server that does not implement them
 * (-32601 Unhandled method). Do not re-add knip LS with the same extensions
 * as typescript until the harness multiplexes by capability.
 *
 * Knip remains a CLI gate (`pnpm hygiene:knip` / `pnpm knip`). Optional
 * `@knip/language-server` may stay installed for editors that multiplex.
 */
import { accessSync, constants, existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const lspPath = path.join(root, ".grok/lsp.json");
const rootLspPath = path.join(root, ".lsp.json");

function fail(msg) {
  console.error(`check-lsp-config: FAIL: ${msg}`);
  process.exit(1);
}

if (!existsSync(lspPath)) fail(`.grok/lsp.json missing at ${lspPath}`);

let cfg;
try {
  cfg = JSON.parse(readFileSync(lspPath, "utf8"));
} catch (e) {
  fail(`invalid JSON: ${e.message}`);
}

// Keep root .lsp.json in sync when both exist (Grok may prefer either)
if (existsSync(rootLspPath)) {
  const rootCfg = readFileSync(rootLspPath, "utf8");
  const grokCfg = readFileSync(lspPath, "utf8");
  if (rootCfg !== grokCfg) {
    fail(".lsp.json and .grok/lsp.json differ — keep them identical");
  }
}

/** @type {string[]} */
const required = ["typescript", "python"];
/** Optional servers: present only if configured; never share extensions with typescript. */
const optional = ["knip"];

for (const name of required) {
  if (!cfg[name]?.command) fail(`server "${name}" missing command`);
}

const allServerNames = Object.keys(cfg);
for (const name of allServerNames) {
  const server = cfg[name];
  if (!server?.command) fail(`server "${name}" missing command`);
  const cmd = server.command;
  const abs = path.isAbsolute(cmd) ? cmd : path.join(root, cmd);
  if (!existsSync(abs)) fail(`binary missing for ${name}: ${cmd} → ${abs}`);
  try {
    accessSync(abs, constants.X_OK);
  } catch {
    // shebang scripts may not show X_OK on all FS
  }
  const args = server.args;
  if (!Array.isArray(args) || !args.includes("--stdio")) {
    fail(`${name} args must include --stdio`);
  }
  if (typeof server.startupTimeout !== "number" || server.startupTimeout < 30_000) {
    console.warn(
      `check-lsp-config: WARN: ${name} startupTimeout < 30000 (large monorepos often need more)`,
    );
  }
  if (!server.extensionToLanguage || typeof server.extensionToLanguage !== "object") {
    fail(`${name} missing extensionToLanguage map`);
  }
  if (Object.keys(server.extensionToLanguage).length === 0) {
    fail(`${name} extensionToLanguage is empty — server would never attach`);
  }
}

// Fail closed on extension collisions (Grok single-routes per extension)
/** @type {Map<string, string>} */
const extOwner = new Map();
for (const name of allServerNames) {
  for (const ext of Object.keys(cfg[name].extensionToLanguage)) {
    const prev = extOwner.get(ext);
    if (prev && prev !== name) {
      fail(
        `extension collision: ${ext} claimed by both "${prev}" and "${name}" ` +
          `(Grok agent lsp tool single-routes per extension; knip must not share .ts with typescript)`,
      );
    }
    extOwner.set(ext, name);
  }
}
console.log(
  "extension map:",
  [...extOwner.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([ext, owner]) => `${ext}→${owner}`)
    .join(" "),
);

// typescript must own navigation extensions
for (const ext of [".ts", ".tsx", ".mts", ".cts"]) {
  if (extOwner.get(ext) !== "typescript") {
    fail(`${ext} must route to typescript (got ${extOwner.get(ext) ?? "none"})`);
  }
}
if (extOwner.get(".py") !== "python") {
  fail(`.py must route to python (got ${extOwner.get(".py") ?? "none"})`);
}

// typescript-language-server --version
const tsRel = cfg.typescript.command.replace(/^\.\//, "");
const tsBin = path.isAbsolute(cfg.typescript.command)
  ? cfg.typescript.command
  : path.join(root, tsRel);
const ts = spawnSync(tsBin, ["--version"], { encoding: "utf8", timeout: 15_000 });
if (ts.status !== 0) {
  fail(`typescript-language-server --version failed: ${ts.stderr || ts.stdout}`);
}
console.log("typescript-language-server", (ts.stdout || ts.stderr).trim());

// pyright-langserver: prove bin present
const pyRel = cfg.python.command.replace(/^\.\//, "");
const pyBin = path.isAbsolute(cfg.python.command)
  ? cfg.python.command
  : path.join(root, pyRel);
if (!existsSync(pyBin)) fail(`pyright-langserver missing: ${pyBin}`);
console.log("pyright-langserver: bin present", pyBin);

// Optional knip: if configured, already covered by collision + bin checks above.
// If not in lsp.json, still note whether the CLI/bin exists (editor-only use).
if (!cfg.knip) {
  const knipBin = path.join(root, "node_modules", ".bin", "knip-language-server");
  if (existsSync(knipBin)) {
    console.log(
      "knip-language-server: installed but not in lsp.json (correct for Grok — use pnpm knip CLI)",
    );
  } else {
    console.log("knip-language-server: not installed (optional; CLI knip may still work)");
  }
} else {
  console.log("knip: configured in lsp.json (must not share extensions with typescript)");
}

// package.json pins
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const dev = pkg.devDependencies || {};
if (!dev["typescript-language-server"]) fail("package.json missing typescript-language-server");
if (!dev.pyright && !dev["pyright"]) fail("package.json missing pyright");
// @knip/language-server optional — do not fail if absent

// Live stdio smoke: tsls hover on a known monorepo package symbol (proves binary + project load path)
const smokeFile = path.join(
  root,
  "packages/openclinxr/agent-loop/src/model-pricing.ts",
);
if (existsSync(smokeFile)) {
  const smoke = spawnSync(
    process.execPath,
    [
      "-e",
      `
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const root = ${JSON.stringify(root)};
const bin = ${JSON.stringify(tsBin)};
const file = ${JSON.stringify(smokeFile)};
const text = fs.readFileSync(file, "utf8");
const lines = text.split(/\\n/);
let line = 0, character = 0;
for (let i = 0; i < lines.length; i++) {
  const idx = lines[i].indexOf("resolveModelPrice");
  if (idx >= 0 && lines[i].includes("function")) { line = i; character = idx; break; }
}
const uri = "file://" + file;
const proc = spawn(bin, ["--stdio"], { cwd: root, stdio: ["pipe", "pipe", "pipe"] });
let buf = Buffer.alloc(0);
const pending = new Map();
function send(msg) {
  const body = Buffer.from(JSON.stringify(msg), "utf8");
  proc.stdin.write("Content-Length: " + body.length + "\\r\\n\\r\\n");
  proc.stdin.write(body);
}
function onMsg(msg) {
  if (msg.id != null && pending.has(msg.id)) {
    const { resolve } = pending.get(msg.id);
    pending.delete(msg.id);
    resolve(msg);
  }
}
proc.stdout.on("data", (chunk) => {
  buf = Buffer.concat([buf, chunk]);
  while (true) {
    const sep = buf.indexOf("\\r\\n\\r\\n");
    if (sep < 0) break;
    const header = buf.slice(0, sep).toString("utf8");
    const m = /Content-Length:\\s*(\\d+)/i.exec(header);
    if (!m) { buf = buf.slice(sep + 4); continue; }
    const len = Number(m[1]);
    const start = sep + 4;
    if (buf.length < start + len) break;
    const body = buf.slice(start, start + len).toString("utf8");
    buf = buf.slice(start + len);
    try { onMsg(JSON.parse(body)); } catch {}
  }
});
function request(id, method, params) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout " + method)), 25000);
    pending.set(id, { resolve: (msg) => { clearTimeout(t); resolve(msg); } });
    send({ jsonrpc: "2.0", id, method, params });
  });
}
(async () => {
  try {
    await request(1, "initialize", {
      processId: process.pid,
      rootUri: "file://" + root,
      rootPath: root,
      capabilities: { textDocument: { hover: { contentFormat: ["markdown", "plaintext"] } } },
      initializationOptions: { hostInfo: "check-lsp-smoke" },
      workspaceFolders: [{ uri: "file://" + root, name: "openclinxr" }],
    });
    send({ jsonrpc: "2.0", method: "initialized", params: {} });
    send({
      jsonrpc: "2.0",
      method: "textDocument/didOpen",
      params: {
        textDocument: { uri, languageId: "typescript", version: 1, text },
      },
    });
    await new Promise((r) => setTimeout(r, 2500));
    const hover = await request(2, "textDocument/hover", {
      textDocument: { uri },
      position: { line, character },
    });
    const contents = hover?.result?.contents;
    const value =
      typeof contents === "string"
        ? contents
        : contents?.value ||
          (Array.isArray(contents) ? contents.map((c) => (typeof c === "string" ? c : c?.value)).join("\\n") : "");
    if (!value || !String(value).includes("resolveModelPrice")) {
      console.error("SMOKE_FAIL", JSON.stringify(hover)?.slice(0, 400));
      process.exit(2);
    }
    console.log("tsls-smoke: hover ok →", String(value).split("\\n").find((l) => l.includes("resolveModelPrice") || l.includes("function")) || "ok");
    proc.kill();
    process.exit(0);
  } catch (e) {
    console.error("SMOKE_FAIL", e.message || e);
    try { proc.kill(); } catch {}
    process.exit(2);
  }
})();
`,
    ],
    { encoding: "utf8", timeout: 45_000, cwd: root },
  );
  if (smoke.status !== 0) {
    fail(`typescript-language-server live smoke failed: ${(smoke.stderr || smoke.stdout || "").slice(0, 500)}`);
  }
  const smokeLine = (smoke.stdout || "").trim().split("\n").filter(Boolean).pop();
  if (smokeLine) console.log(smokeLine);
} else {
  console.warn("check-lsp-config: WARN: smoke file missing, skipped live tsls hover");
}

console.log("check-lsp-config: PASS");
process.exit(0);
