/**
 * pnpm openclaw:inbox <command>
 *
 *   machines                      list registered machine inboxes
 *   register                      create this machine's inbox card (commit the registry change)
 *   send <machine|all> <text...>  post to a machine's inbox, or to every machine
 *   watch [--once] [--mode lines|monitor] [--wait-ms N]
 *                                 long-poll this machine's inbox and the broadcast card
 *   read [--all]                  print received messages not yet read
 *
 * Machine name: BOTHY_MACHINE_NAME, else the hostname without ".local".
 * `--mode monitor` prints only DONE / FAILED for Grok's `monitor` tool.
 */
import {
  fileMessageLog,
  fileStateStore,
  httpInboxRpc,
  machineNameFrom,
  readRegistry,
  readUnread,
  registerMachine,
  runWatch,
  sendMessage,
  type WatchMode,
  writeRegistry,
} from "./machine-inbox.js";

const repoRoot = process.cwd();
const [command, ...rest] = process.argv.slice(2).filter((a) => a !== "--");
const machine = machineNameFrom();

function flag(name: string): string | undefined {
  const i = rest.indexOf(name);
  return i >= 0 ? rest[i + 1] : undefined;
}

function requirePat(): string {
  const pat = process.env["BOTHY_BOARD_PAT"];
  if (!pat) {
    process.stderr.write("BOTHY_BOARD_PAT unset (see docs/madr/0063-mise-env-for-lane-worktrees.md)\n");
    process.exit(2);
  }
  return pat;
}

async function main(): Promise<number> {
  const registry = readRegistry(repoRoot);
  switch (command) {
    case "machines": {
      for (const [name, id] of Object.entries(registry.machines)) {
        process.stdout.write(`${name}\t${id}${name === machine ? "\t(this machine)" : ""}\n`);
      }
      process.stdout.write(`all\t${registry.broadcastTaskId}\t(broadcast)\n`);
      return 0;
    }
    case "register": {
      const out = await registerMachine({ rpc: httpInboxRpc(requirePat()), registry, machine });
      if (out.created) writeRegistry(repoRoot, out.registry);
      process.stdout.write(
        out.created
          ? `created ${out.taskId} for ${machine}; commit tools/openclinxr/openclaw/machine-inboxes.json\n`
          : `${machine} already has ${out.taskId}\n`,
      );
      return 0;
    }
    case "send": {
      const [to, ...words] = rest;
      const text = words.join(" ").trim();
      if (!to || !text) {
        process.stderr.write("usage: send <machine|all> <text...>\n");
        return 1;
      }
      const out = await sendMessage({
        rpc: httpInboxRpc(requirePat()),
        registry,
        from: machine,
        to,
        text,
        harness: process.env["OPENCLINXR_HARNESS"],
      });
      process.stdout.write(`sent ${out.commentId ?? "?"} to ${to} (${out.taskId})\n`);
      return 0;
    }
    case "watch": {
      const mode = (flag("--mode") ?? "lines") as WatchMode;
      const waitMs = flag("--wait-ms") ? Number(flag("--wait-ms")) : undefined;
      let stop = false;
      process.on("SIGTERM", () => {
        stop = true;
      });
      return runWatch({
        rpc: httpInboxRpc(requirePat()),
        registry,
        machine,
        state: fileStateStore(repoRoot),
        log: fileMessageLog(repoRoot),
        emit: (line) => process.stdout.write(`${line}\n`),
        mode,
        once: rest.includes("--once"),
        waitMs,
        shouldStop: () => stop,
      });
    }
    case "read": {
      for (const m of readUnread(repoRoot, { all: rest.includes("--all") })) {
        process.stdout.write(`${JSON.stringify(m)}\n`);
      }
      return 0;
    }
    default:
      process.stderr.write("usage: pnpm openclaw:inbox <machines|register|send|watch|read>\n");
      return 1;
  }
}

process.exitCode = await main();
