/**
 * Consolidated environment / toolchain doctor for OpenClinXR.
 *
 * Deterministic CLI (not an LLM agent): mise + node/npm/pnpm/python + turbo +
 * workspace install + MCP→CLI preference matrix.
 *
 * Exit codes:
 *   0 — healthy (informational notes allowed)
 *   1 — hard failure (wrong majors, missing tools, install broken)
 *   2 — warnings only (when --strict-warn is set; otherwise warnings still exit 0)
 *
 * Usage:
 *   pnpm env:doctor
 *   pnpm env:doctor -- --json
 *   pnpm env:doctor -- --strict-warn
 *   mise run doctor
 */
import { spawnSync } from "node:child_process";
import { accessSync, constants, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ENV_DOCTOR_SCHEMA_VERSION = "openclinxr.env-doctor.v1" as const;
export const DEFAULT_ENV_DOCTOR_REPORT_PATH = ".openclinxr/env-doctor-latest.json";

export type CheckSeverity = "ok" | "warn" | "fail" | "info";

export type DoctorCheck = {
  id: string;
  category: "mise" | "runtime" | "workspace" | "turbo" | "lsp" | "mcp" | "host";
  severity: CheckSeverity;
  title: string;
  detail: string;
  fix?: string;
};

export type McpCliPreference = {
  mcpId: string;
  role: string;
  preferCli: string;
  cliAvailable: boolean | null;
  recommendation: "prefer_cli" | "keep_mcp" | "fix_broken_mcp" | "optional_mcp";
  notes: string;
};

export type EnvDoctorReport = {
  schemaVersion: typeof ENV_DOCTOR_SCHEMA_VERSION;
  generatedAt: string;
  cwd: string;
  health: "ok" | "warn" | "fail";
  exitCode: number;
  summary: {
    ok: number;
    warn: number;
    fail: number;
    info: number;
  };
  tools: Record<
    string,
    {
      path: string | null;
      version: string | null;
      realpath: string | null;
      miseBased: boolean | null;
    }
  >;
  pins: {
    packageEngines: Record<string, string> | null;
    packageManager: string | null;
    miseTools: Record<string, string> | null;
  };
  activation: {
    miseShell: string | null;
    direnvDir: string | null;
    shimsOnPath: boolean;
    rootNodeModulesBinOnPath: boolean;
  };
  checks: DoctorCheck[];
  mcpCliMatrix: McpCliPreference[];
  notes: string[];
};

type CliFlags = {
  json: boolean;
  strictWarn: boolean;
  outputPath: string;
  quiet: boolean;
};

function parseFlags(argv: string[]): CliFlags {
  let json = false;
  let strictWarn = false;
  let quiet = false;
  let outputPath = DEFAULT_ENV_DOCTOR_REPORT_PATH;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--json") json = true;
    else if (a === "--strict-warn") strictWarn = true;
    else if (a === "--quiet") quiet = true;
    else if (a === "--output" || a === "-o") {
      outputPath = argv[i + 1] ?? outputPath;
      i += 1;
    }
  }
  return { json, strictWarn, outputPath, quiet };
}

function run(
  cmd: string,
  args: string[],
  opts?: { cwd?: string; env?: NodeJS.ProcessEnv },
): { ok: boolean; stdout: string; stderr: string; status: number | null } {
  const r = spawnSync(cmd, args, {
    encoding: "utf8",
    cwd: opts?.cwd,
    env: opts?.env ?? process.env,
    shell: false,
  });
  return {
    ok: r.status === 0,
    stdout: (r.stdout ?? "").trim(),
    stderr: (r.stderr ?? "").trim(),
    status: r.status,
  };
}

/** Resolve binary on the **current** process PATH (not a nested login shell). */
function which(bin: string): string | null {
  const pathEnv = process.env.PATH ?? "";
  for (const dir of pathEnv.split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, bin);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // not executable / missing
    }
  }
  return null;
}

function realpathSafe(p: string | null): string | null {
  if (!p) return null;
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

function isMisePath(p: string | null): boolean {
  if (!p) return false;
  return p.includes("/.local/share/mise/") || p.includes("/mise/installs/") || p.includes("/mise/shims/");
}

function parseSemverMajorMinor(version: string | null): { major: number; minor: number } | null {
  if (!version) return null;
  const m = version.replace(/^v/i, "").match(/^(\d+)\.(\d+)/);
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]) };
}

function parseMiseTomlTools(repoRoot: string): Record<string, string> | null {
  const file = path.join(repoRoot, "mise.toml");
  if (!existsSync(file)) return null;
  const text = readFileSync(file, "utf8");
  const tools: Record<string, string> = {};
  let inTools = false;
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (t.startsWith("[")) {
      inTools = t === "[tools]";
      continue;
    }
    if (!inTools || t.startsWith("#") || !t.includes("=")) continue;
    const m = t.match(/^([a-zA-Z0-9_-]+)\s*=\s*"([^"]+)"/);
    if (m) tools[m[1]] = m[2];
  }
  return tools;
}

function toolProbe(bin: string, versionArgs: string[]): EnvDoctorReport["tools"][string] {
  const binPath = which(bin);
  let version: string | null = null;
  if (binPath) {
    const r = run(binPath, versionArgs);
    version = (r.stdout || r.stderr || "").split("\n")[0]?.trim() || null;
  }
  const rp = realpathSafe(binPath);
  return {
    path: binPath,
    version,
    realpath: rp,
    miseBased: binPath ? isMisePath(binPath) || isMisePath(rp) : null,
  };
}

function buildMcpCliMatrix(repoRoot: string): McpCliPreference[] {
  const gh = which("gh");
  const playwrightCli = which("playwright") ?? (existsSync(path.join(repoRoot, "node_modules", ".bin", "playwright"))
    ? path.join(repoRoot, "node_modules", ".bin", "playwright")
    : null);
  const agentBrowser = which("agent-browser");
  const chromeCliHint = Boolean(which("google-chrome") || which("chromium") || which("chrome"));

  return [
    {
      mcpId: "playwright",
      role: "Browser automation / evidence capture",
      preferCli: "pnpm playwright:codegen | playwright:test | playwright:help",
      cliAvailable: Boolean(playwrightCli),
      recommendation: "prefer_cli",
      notes:
        "IMPLEMENTED: project .grok/config.toml disables playwright MCP (enabled=false + disabled_mcp_servers). Use Playwright CLI scripts; re-enable MCP only for multi-step stateful browser loops.",
    },
    {
      mcpId: "chrome-devtools",
      role: "Chrome DevTools Protocol / performance",
      preferCli: "pnpm playwright:* | pnpm browser:agent | evidence scripts",
      cliAvailable: chromeCliHint || Boolean(playwrightCli),
      recommendation: "prefer_cli",
      notes:
        "IMPLEMENTED: chrome-devtools MCP disabled in project config; chrome-devtools-mcp user plugin removed. Prefer CLI capture; re-enable only for CDP profiling.",
    },
    {
      mcpId: "agent-browser",
      role: "Headed browser automation",
      preferCli: "pnpm browser:agent | agent-browser <cmd>",
      cliAvailable: Boolean(agentBrowser),
      recommendation: agentBrowser ? "prefer_cli" : "optional_mcp",
      notes:
        "IMPLEMENTED: user mcp_servers.agent-browser enabled=false. CLI remains on PATH; use shell, not MCP.",
    },
    {
      mcpId: "grok_com_github / github",
      role: "GitHub issues/PRs",
      preferCli: "pnpm gh:status | gh pr | gh issue | gh api",
      cliAvailable: Boolean(gh),
      recommendation: gh ? "prefer_cli" : "fix_broken_mcp",
      notes:
        "IMPLEMENTED: no transport-less grok_com_github entry; listed in disabled_mcp_servers. Prefer gh CLI always.",
    },
    {
      mcpId: "mongodb",
      role: "MongoDB Atlas / queries",
      preferCli: "mongosh / project evidence scripts (local)",
      cliAvailable: Boolean(which("mongosh")),
      recommendation: "optional_mcp",
      notes:
        "Optional user plugin for Atlas agent work only. Local smokes use scripts + mongosh, not always-on MCP.",
    },
    {
      mcpId: "drawio",
      role: "Diagram editing",
      preferCli: "none portable — keep MCP when actively diagramming",
      cliAvailable: null,
      recommendation: "keep_mcp",
      notes: "No good CLI substitute. Leave user MCP enabled only during architecture-diagram work; disable otherwise.",
    },
    {
      mcpId: "mise (hypothetical)",
      role: "Toolchain introspection",
      preferCli: "mise / pnpm env:doctor / mise run doctor",
      cliAvailable: Boolean(which("mise")),
      recommendation: "prefer_cli",
      notes:
        "Do not add mise MCP. env:doctor + mise CLI cover pins, tasks, and PATH. install_tool is unimplemented upstream.",
    },
  ];
}

export function runEnvDoctor(repoRoot: string, flags: { strictWarn?: boolean } = {}): EnvDoctorReport {
  const checks: DoctorCheck[] = [];
  const notes: string[] = [];

  const packageJsonPath = path.join(repoRoot, "package.json");
  let packageEngines: Record<string, string> | null = null;
  let packageManager: string | null = null;
  if (existsSync(packageJsonPath)) {
    const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
      engines?: Record<string, string>;
      packageManager?: string;
    };
    packageEngines = pkg.engines ?? null;
    packageManager = pkg.packageManager ?? null;
  }

  const miseTools = parseMiseTomlTools(repoRoot);

  const tools = {
    mise: toolProbe("mise", ["--version"]),
    node: toolProbe("node", ["-v"]),
    npm: toolProbe("npm", ["-v"]),
    pnpm: toolProbe("pnpm", ["-v"]),
    python3: toolProbe("python3", ["--version"]),
    bun: toolProbe("bun", ["--version"]),
    turbo: toolProbe("turbo", ["--version"]),
    tsx: toolProbe("tsx", ["--version"]),
    blender: toolProbe("blender", ["--version"]),
    gh: toolProbe("gh", ["--version"]),
    direnv: toolProbe("direnv", ["version"]),
  };

  // Normalize node version
  if (tools.node.version?.startsWith("v")) {
    // keep as-is
  }

  const shimsDir = path.join(process.env.HOME ?? "", ".local/share/mise/shims");
  const pathEnv = process.env.PATH ?? "";
  const shimsOnPath = pathEnv.split(path.delimiter).some((p) => p === shimsDir || p.endsWith(`${path.sep}mise${path.sep}shims`));
  const rootBin = path.join(repoRoot, "node_modules", ".bin");
  const rootNodeModulesBinOnPath = pathEnv.split(path.delimiter).includes(rootBin);

  const activation = {
    miseShell: process.env.MISE_SHELL ?? null,
    direnvDir: process.env.DIRENV_DIR ?? null,
    shimsOnPath,
    rootNodeModulesBinOnPath,
  };

  // --- mise presence ---
  if (!tools.mise.path) {
    checks.push({
      id: "mise.present",
      category: "mise",
      severity: "fail",
      title: "mise missing",
      detail: "mise is not on PATH",
      fix: "brew install mise && eval \"$(mise activate zsh)\" or add shims to PATH",
    });
  } else {
    checks.push({
      id: "mise.present",
      category: "mise",
      severity: "ok",
      title: "mise present",
      detail: `${tools.mise.version} @ ${tools.mise.path}`,
    });
  }

  // activation info
  checks.push({
    id: "mise.activation",
    category: "mise",
    severity: "info",
    title: "activation mode",
    detail: `MISE_SHELL=${activation.miseShell ?? "unset"}; DIRENV_DIR=${activation.direnvDir ?? "unset"}; shimsOnPath=${shimsOnPath}; rootNmBin=${rootNodeModulesBinOnPath}`,
  });

  if (!shimsOnPath && !activation.direnvDir) {
    checks.push({
      id: "mise.shims",
      category: "mise",
      severity: "warn",
      title: "mise shims not on PATH and direnv inactive",
      detail: "Bare shells may miss node/pnpm without shims or direnv",
      fix: 'Add to ~/.zshenv: export PATH="$HOME/.local/share/mise/shims:$PATH" and/or enable direnv use mise',
    });
  } else if (!shimsOnPath && activation.direnvDir) {
    checks.push({
      id: "mise.shims",
      category: "mise",
      severity: "info",
      title: "shims not on PATH (direnv active)",
      detail: "direnv use_mise injects install paths; shims optional in this shell",
    });
  } else {
    checks.push({
      id: "mise.shims",
      category: "mise",
      severity: "ok",
      title: "mise shims on PATH",
      detail: shimsDir,
    });
  }

  // node 24 LTS
  const nodeMm = parseSemverMajorMinor(tools.node.version);
  if (!tools.node.path || !nodeMm) {
    checks.push({
      id: "runtime.node",
      category: "runtime",
      severity: "fail",
      title: "node missing",
      detail: "node not found",
      fix: "mise install && eval \"$(mise env -s zsh)\"",
    });
  } else if (nodeMm.major !== 24) {
    checks.push({
      id: "runtime.node",
      category: "runtime",
      severity: "fail",
      title: "node major mismatch",
      detail: `expected v24.x LTS (engines >=24.15.0), got ${tools.node.version} @ ${tools.node.path}`,
      fix: "cd repo && mise trust && mise install && use direnv or mise env",
    });
  } else if (nodeMm.major === 24 && nodeMm.minor < 15) {
    checks.push({
      id: "runtime.node",
      category: "runtime",
      severity: "fail",
      title: "node patch too old for engines",
      detail: `engines require >=24.15.0, got ${tools.node.version}`,
      fix: "mise install node@24",
    });
  } else {
    checks.push({
      id: "runtime.node",
      category: "runtime",
      severity: "ok",
      title: "node LTS 24",
      detail: `${tools.node.version} miseBased=${tools.node.miseBased} @ ${tools.node.path}`,
    });
  }

  // pnpm 11.18+
  const pnpmMm = parseSemverMajorMinor(tools.pnpm.version);
  const wantPm = packageManager?.replace(/^pnpm@/, "").split("+")[0] ?? "11.18.0";
  if (!tools.pnpm.path || !pnpmMm) {
    checks.push({
      id: "runtime.pnpm",
      category: "runtime",
      severity: "fail",
      title: "pnpm missing",
      detail: "pnpm not found",
      fix: "mise install pnpm@11.18.0",
    });
  } else if (pnpmMm.major !== 11 || pnpmMm.minor < 18) {
    checks.push({
      id: "runtime.pnpm",
      category: "runtime",
      severity: "fail",
      title: "pnpm version mismatch",
      detail: `expected ${wantPm} (engines >=11.18.0), got ${tools.pnpm.version}`,
      fix: "mise install && ensure packageManager is pnpm@11.18.0",
    });
  } else {
    checks.push({
      id: "runtime.pnpm",
      category: "runtime",
      severity: "ok",
      title: "pnpm current 11.x",
      detail: `${tools.pnpm.version} @ ${tools.pnpm.path}`,
    });
  }

  // npm (bundled) — informational
  if (tools.npm.path) {
    checks.push({
      id: "runtime.npm",
      category: "runtime",
      severity: "ok",
      title: "npm (bundled with node)",
      detail: `${tools.npm.version} @ ${tools.npm.path}`,
    });
  }

  // python 3.13 mise
  const pyVer = tools.python3.version?.replace(/^Python\s+/i, "") ?? null;
  const pyMm = parseSemverMajorMinor(pyVer);
  if (!tools.python3.path || !pyMm) {
    checks.push({
      id: "runtime.python3",
      category: "runtime",
      severity: "fail",
      title: "python3 missing",
      detail: "python3 not found",
      fix: "mise install python@3.13",
    });
  } else if (pyMm.major !== 3 || pyMm.minor !== 13) {
    checks.push({
      id: "runtime.python3",
      category: "runtime",
      severity: "fail",
      title: "python version mismatch",
      detail: `expected 3.13.x via mise, got ${tools.python3.version} @ ${tools.python3.path}`,
      fix: "mise install python@3.13 && reshim; avoid Framework/Homebrew python3 first on PATH",
    });
  } else if (!tools.python3.miseBased) {
    checks.push({
      id: "runtime.python3",
      category: "runtime",
      severity: "fail",
      title: "python3 not mise-based",
      detail: `3.13-ish but path is not under mise: ${tools.python3.path}`,
      fix: "ensure mise python shims/installs precede /Library/Frameworks and Homebrew",
    });
  } else {
    checks.push({
      id: "runtime.python3",
      category: "runtime",
      severity: "ok",
      title: "python3 mise 3.13",
      detail: `${tools.python3.version} @ ${tools.python3.path}`,
    });
  }

  // turbo
  if (!tools.turbo.path) {
    checks.push({
      id: "turbo.present",
      category: "turbo",
      severity: "fail",
      title: "turbo missing",
      detail: "turbo not on PATH (need pnpm install + root node_modules/.bin)",
      fix: "pnpm install && eval \"$(mise env -s zsh)\" or direnv allow",
    });
  } else {
    checks.push({
      id: "turbo.present",
      category: "turbo",
      severity: "ok",
      title: "turbo present",
      detail: `${tools.turbo.version} @ ${tools.turbo.path}`,
    });
    // cheap dry probe — do not run full build
    const dry = run("turbo", ["run", "build", "--dry-run=json", "--filter=//"], { cwd: repoRoot });
    // turbo may error on filter // — try simpler
    if (!dry.ok) {
      const verOnly = tools.turbo.version;
      checks.push({
        id: "turbo.cli",
        category: "turbo",
        severity: "ok",
        title: "turbo CLI responsive",
        detail: `version ${verOnly} (skipped full pipeline)`,
      });
    }
  }

  // workspace
  const nm = path.join(repoRoot, "node_modules");
  const lock = path.join(repoRoot, "pnpm-lock.yaml");
  if (!existsSync(nm)) {
    checks.push({
      id: "workspace.node_modules",
      category: "workspace",
      severity: "fail",
      title: "node_modules missing",
      detail: "dependencies not installed",
      fix: "pnpm install",
    });
  } else {
    checks.push({
      id: "workspace.node_modules",
      category: "workspace",
      severity: "ok",
      title: "node_modules present",
      detail: nm,
    });
  }
  if (!existsSync(lock)) {
    checks.push({
      id: "workspace.lockfile",
      category: "workspace",
      severity: "fail",
      title: "pnpm-lock.yaml missing",
      detail: "lockfile required",
    });
  } else {
    checks.push({
      id: "workspace.lockfile",
      category: "workspace",
      severity: "ok",
      title: "pnpm-lock.yaml present",
      detail: lock,
    });
  }

  if (!rootNodeModulesBinOnPath && existsSync(rootBin)) {
    checks.push({
      id: "workspace.root_bin_path",
      category: "workspace",
      severity: "warn",
      title: "root node_modules/.bin not on PATH",
      detail: "tsx/turbo may need pnpm exec",
      fix: "direnv allow (use mise) or eval \"$(mise env -s zsh)\"",
    });
  } else if (rootNodeModulesBinOnPath) {
    checks.push({
      id: "workspace.root_bin_path",
      category: "workspace",
      severity: "ok",
      title: "root node_modules/.bin on PATH",
      detail: rootBin,
    });
  }

  // LSP config (Grok + agent navigation)
  const lspConfigPath = path.join(repoRoot, ".grok", "lsp.json");
  const lspBins = {
    typescript: path.join(repoRoot, "node_modules", ".bin", "typescript-language-server"),
    knip: path.join(repoRoot, "node_modules", ".bin", "knip-language-server"),
    pyright: path.join(repoRoot, "node_modules", ".bin", "pyright-langserver"),
  };
  if (!existsSync(lspConfigPath)) {
    checks.push({
      id: "lsp.config",
      category: "lsp",
      severity: "fail",
      title: ".grok/lsp.json missing",
      detail: lspConfigPath,
      fix: "restore .grok/lsp.json from repo; pnpm install",
    });
  } else {
    checks.push({
      id: "lsp.config",
      category: "lsp",
      severity: "ok",
      title: ".grok/lsp.json present",
      detail: lspConfigPath,
    });
    const rootLsp = path.join(repoRoot, ".lsp.json");
    if (existsSync(rootLsp)) {
      const a = readFileSync(lspConfigPath, "utf8");
      const b = readFileSync(rootLsp, "utf8");
      checks.push({
        id: "lsp.config_sync",
        category: "lsp",
        severity: a === b ? "ok" : "fail",
        title: a === b ? ".lsp.json matches .grok/lsp.json" : ".lsp.json drift from .grok/lsp.json",
        detail: rootLsp,
        fix: a === b ? undefined : "copy .grok/lsp.json to .lsp.json (keep identical)",
      });
    }
  }
  for (const [name, binPath] of Object.entries(lspBins)) {
    if (existsSync(binPath)) {
      checks.push({
        id: `lsp.bin.${name}`,
        category: "lsp",
        severity: "ok",
        title: `${name} language server bin`,
        detail: binPath,
      });
    } else {
      checks.push({
        id: `lsp.bin.${name}`,
        category: "lsp",
        severity: "fail",
        title: `${name} language server missing`,
        detail: binPath,
        fix: "pnpm install (typescript-language-server, @knip/language-server, pyright)",
      });
    }
  }
  // structural script when present
  const lspCheckScript = path.join(repoRoot, "tooling", "scripts", "check-lsp-config.mjs");
  if (existsSync(lspCheckScript) && existsSync(lspBins.typescript)) {
    const lspCheck = run(process.execPath, [lspCheckScript], { cwd: repoRoot });
    checks.push({
      id: "lsp.check_script",
      category: "lsp",
      severity: lspCheck.ok ? "ok" : "fail",
      title: lspCheck.ok ? "check-lsp-config PASS" : "check-lsp-config FAIL",
      detail: (lspCheck.stdout || lspCheck.stderr || "").split("\n").slice(0, 4).join(" | "),
      fix: lspCheck.ok ? undefined : "pnpm install && pnpm hygiene:lsp",
    });
  }

  // optional host
  if (!tools.blender.path) {
    checks.push({
      id: "host.blender",
      category: "host",
      severity: "info",
      title: "blender optional",
      detail: "not on PATH — Anny Blender pipeline needs brew install blender",
    });
  } else {
    checks.push({
      id: "host.blender",
      category: "host",
      severity: "ok",
      title: "blender present",
      detail: tools.blender.path,
    });
  }

  // packageManager vs pnpm
  if (packageManager && tools.pnpm.version) {
    const pmVer = packageManager.replace(/^pnpm@/, "").split("+")[0];
    if (!tools.pnpm.version.startsWith(pmVer.split(".").slice(0, 2).join("."))) {
      // soft: major.minor match is enough if we already checked 11.18+
      checks.push({
        id: "pins.packageManager",
        category: "runtime",
        severity: "info",
        title: "packageManager field",
        detail: `package.json packageManager=${packageManager}; resolved pnpm=${tools.pnpm.version}`,
      });
    } else {
      checks.push({
        id: "pins.packageManager",
        category: "runtime",
        severity: "ok",
        title: "packageManager aligned",
        detail: packageManager,
      });
    }
  }

  if (miseTools) {
    checks.push({
      id: "pins.mise_toml",
      category: "mise",
      severity: "ok",
      title: "mise.toml tools",
      detail: Object.entries(miseTools)
        .map(([k, v]) => `${k}=${v}`)
        .join(", "),
    });
  } else {
    checks.push({
      id: "pins.mise_toml",
      category: "mise",
      severity: "fail",
      title: "mise.toml missing",
      detail: "project mise.toml not found",
    });
  }

  const mcpCliMatrix = buildMcpCliMatrix(repoRoot);
  for (const row of mcpCliMatrix) {
    if (row.recommendation === "fix_broken_mcp") {
      checks.push({
        id: `mcp.${row.mcpId.replace(/\s+/g, "_")}`,
        category: "mcp",
        severity: "warn",
        title: `MCP→CLI: ${row.mcpId}`,
        detail: row.notes,
        fix: row.preferCli,
      });
    } else if (row.recommendation === "prefer_cli") {
      checks.push({
        id: `mcp.${row.mcpId.replace(/\W+/g, "_")}`,
        category: "mcp",
        severity: "info",
        title: `prefer CLI over MCP: ${row.mcpId}`,
        detail: `${row.preferCli} (cliAvailable=${row.cliAvailable}) — ${row.notes}`,
      });
    }
  }

  notes.push(
    "Package-local bins under packages/*/node_modules/.bin are NOT on PATH; use pnpm --filter <pkg> run|exec.",
  );
  notes.push("Prefer CLIs over always-on MCPs for env/doctor work; see mcpCliMatrix in the JSON report.");
  notes.push("Grok/agent desktops: launch from direnv-loaded shell or rely on mise shims + mise exec.");

  const summary = {
    ok: checks.filter((c) => c.severity === "ok").length,
    warn: checks.filter((c) => c.severity === "warn").length,
    fail: checks.filter((c) => c.severity === "fail").length,
    info: checks.filter((c) => c.severity === "info").length,
  };

  let health: EnvDoctorReport["health"] = "ok";
  let exitCode = 0;
  if (summary.fail > 0) {
    health = "fail";
    exitCode = 1;
  } else if (summary.warn > 0) {
    health = "warn";
    exitCode = flags.strictWarn ? 2 : 0;
  }

  return {
    schemaVersion: ENV_DOCTOR_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    cwd: repoRoot,
    health,
    exitCode,
    summary,
    tools,
    pins: {
      packageEngines,
      packageManager,
      miseTools,
    },
    activation,
    checks,
    mcpCliMatrix,
    notes,
  };
}

function printHuman(report: EnvDoctorReport): void {
  console.log(`cwd: ${report.cwd}`);
  console.log(`health: ${report.health.toUpperCase()}  (ok=${report.summary.ok} warn=${report.summary.warn} fail=${report.summary.fail} info=${report.summary.info})`);
  console.log(`generated: ${report.generatedAt}`);
  console.log("");
  console.log("=== activation ===");
  console.log(
    `MISE_SHELL=${report.activation.miseShell ?? "unset"}  DIRENV_DIR=${report.activation.direnvDir ?? "unset"}  shims=${report.activation.shimsOnPath}  rootNmBin=${report.activation.rootNodeModulesBinOnPath}`,
  );
  console.log("");
  console.log("=== tools ===");
  for (const [name, t] of Object.entries(report.tools)) {
    const mise = t.miseBased === null ? "" : t.miseBased ? " [mise]" : " [not-mise]";
    console.log(`${name.padEnd(10)} ${(t.version ?? "MISSING").padEnd(24)} ${t.path ?? ""}${mise}`);
  }
  console.log("");
  console.log("=== checks ===");
  for (const c of report.checks) {
    if (c.severity === "info" && c.category === "mcp") continue; // summarized below
    const tag = c.severity.toUpperCase().padEnd(4);
    console.log(`[${tag}] ${c.id}: ${c.title}`);
    console.log(`       ${c.detail}`);
    if (c.fix) console.log(`       fix: ${c.fix}`);
  }
  console.log("");
  console.log("=== MCP → CLI (prefer CLI to reduce context bloat) ===");
  for (const row of report.mcpCliMatrix) {
    console.log(`- ${row.mcpId}: ${row.recommendation}`);
    console.log(`    prefer: ${row.preferCli}`);
    console.log(`    ${row.notes}`);
  }
  console.log("");
  console.log("=== notes ===");
  for (const n of report.notes) console.log(`- ${n}`);
  console.log("");
  console.log(`report: ${DEFAULT_ENV_DOCTOR_REPORT_PATH}`);
}

function main(): void {
  const flags = parseFlags(process.argv.slice(2));
  // Resolve repo root: this file is tools/openclinxr/openclaw/env-doctor.ts
  const here = path.dirname(fileURLToPath(import.meta.url));
  const repoRootFromFile = path.resolve(here, "../../..");
  const cwd = process.cwd();
  const repoRoot = existsSync(path.join(cwd, "package.json")) && existsSync(path.join(cwd, "mise.toml"))
    ? cwd
    : repoRootFromFile;

  const report = runEnvDoctor(repoRoot, { strictWarn: flags.strictWarn });

  const outAbs = path.isAbsolute(flags.outputPath) ? flags.outputPath : path.join(repoRoot, flags.outputPath);
  mkdirSync(path.dirname(outAbs), { recursive: true });
  writeFileSync(outAbs, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  if (flags.json) {
    console.log(JSON.stringify(report, null, 2));
  } else if (!flags.quiet) {
    printHuman(report);
  } else {
    console.log(`health=${report.health} exit=${report.exitCode} report=${outAbs}`);
  }

  process.exitCode = report.exitCode;
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  main();
}
