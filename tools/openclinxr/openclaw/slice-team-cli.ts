import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  buildGrokRepoAgentSpawnSpec,
  resolveGrokSpawnSurfaceForPolicy,
} from "../../../packages/openclinxr/agent-loop/src/grok-repo-agent-spawn.js";
import { getRepoRoleHarnessPolicy } from "../../../packages/openclinxr/agent-loop/src/role-harness-policy.js";
import {
  buildTeamSpawnReport,
  formatTeamSpawnBrief,
  materializeBriefFromTemplate,
  sliceBriefPath,
  sliceHandoffPath,
  sliceRootDir,
  verifySliceBrief,
  type SliceBrief,
  type SliceHandoff,
  type SliceTeamTemplate,
} from "../../../packages/openclinxr/agent-loop/src/slice-team.js";

const repoRoot = process.cwd();
const TEAMS_DIR = "teams";

type RoleEntry = { roleId: string; roleDir: string; group: string };

async function discoverRoles(): Promise<RoleEntry[]> {
  const roles: RoleEntry[] = [];
  const groups = await readdir(path.join(repoRoot, "agents"), { withFileTypes: true });
  for (const group of groups.filter((entry) => entry.isDirectory())) {
    const roleDirs = await readdir(path.join(repoRoot, "agents", group.name), { withFileTypes: true });
    for (const role of roleDirs.filter((entry) => entry.isDirectory())) {
      const roleDir = path.join("agents", group.name, role.name);
      roles.push({ roleId: role.name, roleDir, group: group.name });
    }
  }
  return roles.sort((a, b) => a.roleId.localeCompare(b.roleId));
}

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = { json: false };
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--json") out.json = true;
    else if (arg.startsWith("--") && argv[i + 1] && !argv[i + 1]!.startsWith("--")) {
      out[arg.slice(2)] = argv[++i]!;
    } else if (!arg.startsWith("--")) positional.push(arg);
  }
  out.command = positional[0] ?? "help";
  return out;
}

async function readJsonFile<T>(filePath: string): Promise<T> {
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw) as T;
}

async function loadTeamTemplate(templateId: string): Promise<SliceTeamTemplate> {
  const filePath = path.join(repoRoot, TEAMS_DIR, `${templateId}.json`);
  await access(filePath);
  return readJsonFile<SliceTeamTemplate>(filePath);
}

async function loadBrief(sliceId: string): Promise<SliceBrief> {
  const filePath = path.join(repoRoot, sliceBriefPath(sliceId));
  await access(filePath);
  return readJsonFile<SliceBrief>(filePath);
}

async function loadHandoffs(sliceId: string): Promise<Record<string, SliceHandoff | null>> {
  const handoffDir = path.join(repoRoot, sliceRootDir(sliceId), "handoffs");
  const result: Record<string, SliceHandoff | null> = {};
  try {
    const files = await readdir(handoffDir);
    for (const file of files.filter((name) => name.endsWith(".json"))) {
      const roleId = file.replace(/\.json$/, "");
      result[roleId] = await readJsonFile<SliceHandoff>(path.join(handoffDir, file));
    }
  } catch {
    // no handoffs yet
  }
  return result;
}

async function cmdInit(args: Record<string, string | boolean>): Promise<void> {
  const templateId = String(args.template ?? "");
  const sliceId = String(args["slice-id"] ?? "");
  if (!templateId || !sliceId) {
    console.error("Usage: init --template <id> --slice-id <id>");
    process.exitCode = 1;
    return;
  }
  const template = await loadTeamTemplate(templateId);
  const brief = materializeBriefFromTemplate(template, sliceId);
  const root = path.join(repoRoot, sliceRootDir(sliceId));
  await mkdir(path.join(root, "handoffs"), { recursive: true });
  const briefFile = path.join(root, "brief.json");
  await writeFile(briefFile, `${JSON.stringify(brief, null, 2)}\n`);
  console.log(`Initialized slice ${sliceId} from template ${templateId}`);
  console.log(`Brief: ${sliceBriefPath(sliceId)}`);
}

async function cmdTeamSpawn(args: Record<string, string | boolean>): Promise<void> {
  const sliceId = String(args["slice-id"] ?? "");
  const phase = String(args.phase ?? "execute") as "scout" | "execute" | "integrate";
  if (!sliceId) {
    console.error("Usage: team-spawn --slice-id <id> [--phase scout|execute|integrate] [--json]");
    process.exitCode = 1;
    return;
  }
  const brief = await loadBrief(sliceId);
  const template = brief.templateId ? await loadTeamTemplate(brief.templateId) : null;
  const roles = await discoverRoles();
  const roleDirs = Object.fromEntries(roles.map((r) => [r.roleId, r.roleDir]));

  const report = buildTeamSpawnReport({
    repoRoot,
    brief,
    template,
    phase,
    roleDirs,
  });

  const enriched = report.roles.map((roleSpec) => {
    const role = roles.find((r) => r.roleId === roleSpec.roleId);
    const policy = getRepoRoleHarnessPolicy(roleSpec.roleId);
    const spawnSpec = role
      ? buildGrokRepoAgentSpawnSpec({
          roleId: role.roleId,
          roleDir: role.roleDir,
          group: role.group,
          task: roleSpec.spawnPrompt,
        })
      : null;
    const surface = policy ? resolveGrokSpawnSurfaceForPolicy(policy) : null;
    return {
      ...roleSpec,
      model: spawnSpec?.model,
      grokSubagentType: spawnSpec?.grokSubagentType,
      capabilityMode: spawnSpec?.spawnSubagentCall?.capability_mode,
      spawnSubagentCall: spawnSpec?.spawnSubagentCall
        ? { ...spawnSpec.spawnSubagentCall, prompt: roleSpec.spawnPrompt }
        : null,
      spawnSurface: surface?.spawnSurface,
    };
  });

  const output = { ...report, roles: enriched };
  const outPath = path.join(repoRoot, ".openclinxr", "openclaw", `slice-team-spawn-${sliceId}-${phase}.json`);
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(output, null, 2)}\n`);

  if (args.json) {
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  console.log(formatTeamSpawnBrief(report));
  console.log(`Wrote ${outPath}`);
  for (const role of enriched) {
    console.log(`\n## ${role.roleId} (${role.phase}, ${role.mode})`);
    console.log(`handoff → ${role.handoffPath}`);
    if (role.spawnSubagentCall) {
      console.log(JSON.stringify(role.spawnSubagentCall, null, 2));
    } else {
      console.log("Use Composer integrator for this role.");
    }
  }
}

async function cmdVerify(args: Record<string, string | boolean>): Promise<void> {
  const sliceId = String(args["slice-id"] ?? "");
  if (!sliceId) {
    console.error("Usage: verify --slice-id <id> [--json]");
    process.exitCode = 1;
    return;
  }
  const brief = await loadBrief(sliceId);
  const handoffs = await loadHandoffs(sliceId);
  const report = await verifySliceBrief({ repoRoot, brief, handoffs });
  const outPath = path.join(repoRoot, ".openclinxr", "openclaw", `slice-verify-${sliceId}.json`);
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`);

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`slice=${sliceId} ok=${report.ok}`);
    for (const check of report.checks) {
      console.log(`${check.passed ? "✓" : "✗"} ${check.rule} — ${check.detail}`);
    }
    console.log(`Wrote ${outPath}`);
  }
  if (!report.ok) process.exitCode = 1;
}

async function cmdStatus(args: Record<string, string | boolean>): Promise<void> {
  const sliceId = String(args["slice-id"] ?? "");
  if (!sliceId) {
    console.error("Usage: status --slice-id <id>");
    process.exitCode = 1;
    return;
  }
  const brief = await loadBrief(sliceId);
  const handoffs = await loadHandoffs(sliceId);
  console.log(`Slice: ${brief.id}`);
  console.log(`Goal: ${brief.goal}`);
  console.log(`Q-gate: ${brief.q_gate}`);
  for (const [roleId, assignment] of Object.entries(brief.roles)) {
    const handoff = handoffs[roleId];
    const status = handoff?.status ?? "missing";
    console.log(`- ${roleId} (${assignment.mode}, phase=${assignment.phase ?? "execute"}): ${status}`);
    const handoffRel = sliceHandoffPath(sliceId, roleId);
    if (handoff) {
      console.log(`  handoff: ${handoffRel}`);
      if (handoff.skeptic_verdict) console.log(`  skeptic: ${handoff.skeptic_verdict}`);
    }
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const command = String(args.command);
  switch (command) {
    case "init":
      await cmdInit(args);
      break;
    case "team-spawn":
      await cmdTeamSpawn(args);
      break;
    case "verify":
      await cmdVerify(args);
      break;
    case "status":
      await cmdStatus(args);
      break;
    default:
      console.log(`OpenClinXR slice-team CLI

Commands:
  init        --template <id> --slice-id <id>
  team-spawn  --slice-id <id> [--phase scout|execute|integrate] [--json]
  verify      --slice-id <id> [--json]
  status      --slice-id <id>
`);
  }
}

await main();