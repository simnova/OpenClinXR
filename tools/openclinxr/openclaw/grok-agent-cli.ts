import { access, readdir } from "node:fs/promises";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { readFile } from "node:fs/promises";
import {
  buildGrokRepoAgentSpawnRegistry,
  buildGrokRepoAgentSpawnSpec,
  formatGrokRepoAgentSpawnBrief,
  recommendRepoAgentsForConsult,
} from "../../../packages/openclinxr/agent-loop/src/grok-repo-agent-spawn.js";
import {
  buildSliceTeamSpawnPrompt,
  rolesForPhase,
  sliceBriefPath,
  type SliceBrief,
  type SlicePhaseId,
  type SliceTeamTemplate,
} from "../../../packages/openclinxr/agent-loop/src/slice-team.js";

const repoRoot = process.cwd();
const DEFAULT_REGISTRY_PATH = ".openclinxr/openclaw/grok-repo-agent-spawn-registry-latest.json";

type RoleEntry = { roleId: string; roleDir: string; group: string };

async function discoverRoles(): Promise<RoleEntry[]> {
  const roles: RoleEntry[] = [];
  const groups = await readdir(path.join(repoRoot, "agents"), { withFileTypes: true });
  for (const group of groups.filter((entry) => entry.isDirectory())) {
    const groupDir = path.join(repoRoot, "agents", group.name);
    const roleDirs = await readdir(groupDir, { withFileTypes: true });
    for (const role of roleDirs.filter((entry) => entry.isDirectory())) {
      const roleDir = path.join("agents", group.name, role.name);
      const required = ["charter.md", "memory.md", "index.json"].map((file) => path.join(repoRoot, roleDir, file));
      const exists = await Promise.all(
        required.map(async (filePath) => {
          try {
            await access(filePath);
            return true;
          } catch {
            return false;
          }
        }),
      );
      if (exists.every(Boolean)) {
        roles.push({ roleId: role.name, roleDir, group: group.name });
      }
    }
  }
  return roles.sort((a, b) => a.roleId.localeCompare(b.roleId));
}

function parseArgs(argv: string[]): {
  command: "list" | "spawn-spec" | "validate" | "consult";
  roleId?: string;
  consultKind?: string;
  task?: string;
  sliceId?: string;
  phase?: SlicePhaseId;
  json: boolean;
  outputPath: string;
} {
  const positional = argv.filter((arg) => !arg.startsWith("--"));
  const command = (positional[0] ?? "list") as "list" | "spawn-spec" | "validate" | "consult";
  let roleId: string | undefined;
  let consultKind: string | undefined;
  let task: string | undefined;
  let sliceId: string | undefined;
  let phase: SlicePhaseId | undefined;
  let json = false;
  let outputPath = DEFAULT_REGISTRY_PATH;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--json") json = true;
    if (arg === "--role" && argv[i + 1]) roleId = argv[++i];
    if (arg === "--consult" && argv[i + 1]) consultKind = argv[++i];
    if (arg === "--task" && argv[i + 1]) task = argv[++i];
    if (arg === "--slice-id" && argv[i + 1]) sliceId = argv[++i];
    if (arg === "--phase" && argv[i + 1]) phase = argv[++i] as SlicePhaseId;
    if (arg === "--output" && argv[i + 1]) outputPath = argv[++i];
  }
  return { command, roleId, consultKind, task, sliceId, phase, json, outputPath };
}

async function loadSliceBrief(sliceId: string): Promise<SliceBrief> {
  const raw = await readFile(path.join(repoRoot, sliceBriefPath(sliceId)), "utf8");
  return JSON.parse(raw) as SliceBrief;
}

async function loadSliceTemplate(templateId: string): Promise<SliceTeamTemplate | null> {
  try {
    const raw = await readFile(path.join(repoRoot, "teams", `${templateId}.json`), "utf8");
    return JSON.parse(raw) as SliceTeamTemplate;
  } catch {
    return null;
  }
}

async function resolveSliceTeamTask(input: {
  roleId: string;
  roleDir: string;
  sliceId: string;
  phase: SlicePhaseId;
}): Promise<string | undefined> {
  const brief = await loadSliceBrief(input.sliceId);
  const template = brief.templateId ? await loadSliceTemplate(brief.templateId) : null;
  const phaseRoles = rolesForPhase(brief, template, input.phase);
  if (!phaseRoles.includes(input.roleId)) {
    return undefined;
  }
  const assignment = brief.roles[input.roleId];
  if (!assignment) {
    return undefined;
  }
  return buildSliceTeamSpawnPrompt({
    repoRoot,
    roleId: input.roleId,
    roleDir: input.roleDir,
    brief,
    assignment,
    phase: input.phase,
  });
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const roles = await discoverRoles();

  if (args.command === "validate") {
    const registry = buildGrokRepoAgentSpawnRegistry({ roles });
    await mkdir(path.dirname(path.join(repoRoot, args.outputPath)), { recursive: true });
    await writeFile(path.join(repoRoot, args.outputPath), `${JSON.stringify(registry, null, 2)}\n`);
    if (args.json) {
      console.log(JSON.stringify(registry, null, 2));
    } else {
      for (const check of registry.checks) {
        console.log(`${check.passed ? "✓" : "✗"} ${check.checkId}: ${check.note}`);
      }
      console.log(`\nPosture: ${registry.posture} (${registry.roleCount} roles)`);
      console.log(`Wrote ${args.outputPath}`);
    }
    if (registry.posture !== "aligned") process.exitCode = 1;
    return;
  }

  if (args.command === "consult") {
    const kind = args.consultKind ?? "orchestration";
    const roleIds = recommendRepoAgentsForConsult(
      kind as Parameters<typeof recommendRepoAgentsForConsult>[0],
    );
    const specs = roleIds.map((roleId) => {
      const role = roles.find((r) => r.roleId === roleId);
      if (!role) throw new Error(`Role not found: ${roleId}`);
      return buildGrokRepoAgentSpawnSpec({ ...role, task: args.task });
    });
    if (args.json) {
      console.log(JSON.stringify(specs, null, 2));
      return;
    }
    for (const spec of specs) {
      console.log(formatGrokRepoAgentSpawnBrief(spec));
    }
    return;
  }

  if (args.command === "spawn-spec") {
    if (!args.roleId) {
      console.error("Missing --role <role-id>");
      process.exitCode = 1;
      return;
    }
    const role = roles.find((r) => r.roleId === args.roleId);
    if (!role) {
      console.error(`Unknown role: ${args.roleId}`);
      process.exitCode = 1;
      return;
    }
    let task = args.task;
    if (args.sliceId) {
      const sliceTask = await resolveSliceTeamTask({
        roleId: role.roleId,
        roleDir: role.roleDir,
        sliceId: args.sliceId,
        phase: args.phase ?? "execute",
      });
      if (!sliceTask) {
        console.error(`Role ${args.roleId} not in slice ${args.sliceId} phase ${args.phase ?? "execute"}`);
        process.exitCode = 1;
        return;
      }
      task = sliceTask;
    }
    const spec = buildGrokRepoAgentSpawnSpec({ ...role, task });
    if (args.json) {
      console.log(JSON.stringify(spec, null, 2));
      return;
    }
    console.log(formatGrokRepoAgentSpawnBrief(spec));
    console.log(`\nPrompt:\n${spec.spawnPrompt}`);
    if (spec.spawnSubagentCall) {
      console.log(`\nspawn_subagent payload:\n${JSON.stringify(spec.spawnSubagentCall, null, 2)}`);
    } else {
      console.log("\nUse Composer main thread (grok-build) — do not spawn as cheap subagent.");
    }
    return;
  }

  const registry = buildGrokRepoAgentSpawnRegistry({ roles });
  if (args.json) {
    console.log(JSON.stringify(registry.agents, null, 2));
    return;
  }
  for (const agent of registry.agents) {
    console.log(formatGrokRepoAgentSpawnBrief(agent));
  }
  console.log(`\n${registry.roleCount} repo agents; posture ${registry.posture}`);
  console.log("Use: pnpm grok:agent:spawn-spec -- --role <id> [--task \"...\"] [--slice-id <id> [--phase scout|execute]]");
}

await main();