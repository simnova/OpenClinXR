import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resetCoordinationRootCache } from "./coordination-root.js";
import {
  commandContainsRawGrokHeadless,
  evaluateRawGrokShellCommand,
  isGrokBinaryToken,
  peelLeadingEnvAssignments,
  RAW_GROK_REASON_ENV,
  RAW_GROK_SANCTION_ENV,
  RAW_GROK_SANCTION_LEDGER,
  segmentIsRawGrokHeadless,
  splitShellSegments,
  tokenizeSegment,
} from "./dispatch-chokepoint.js";

afterEach(() => {
  resetCoordinationRootCache();
  delete process.env["OPENCLINXR_COORDINATION_ROOT"];
});

describe("raw-grok classifier (string matcher)", () => {
  it("recognizes grok binary tokens and rejects lookalikes", () => {
    expect(isGrokBinaryToken("grok")).toBe(true);
    expect(isGrokBinaryToken("~/.grok/bin/grok")).toBe(true);
    expect(isGrokBinaryToken("/Users/x/.grok/bin/grok")).toBe(true);
    expect(isGrokBinaryToken("pnpm")).toBe(false);
    expect(isGrokBinaryToken("grok:tier:introspect")).toBe(false);
  });

  it("matches headless -p / --single / --prompt", () => {
    expect(segmentIsRawGrokHeadless('grok -p "do the thing"')).toBe(true);
    expect(segmentIsRawGrokHeadless("~/.grok/bin/grok -p hi")).toBe(true);
    expect(segmentIsRawGrokHeadless("grok --single 'x'")).toBe(true);
    expect(segmentIsRawGrokHeadless("grok --prompt x")).toBe(true);
    expect(segmentIsRawGrokHeadless("grok chat")).toBe(false);
    expect(segmentIsRawGrokHeadless("echo 'use grok -p later'")).toBe(false);
    expect(segmentIsRawGrokHeadless("pnpm openclaw:run-next")).toBe(false);
    expect(segmentIsRawGrokHeadless("pnpm grok:tier:introspect")).toBe(false);
  });

  it("matches through common wrappers and bash -c nesting", () => {
    expect(segmentIsRawGrokHeadless('env grok -p "x"')).toBe(true);
    expect(segmentIsRawGrokHeadless('nohup ~/.grok/bin/grok -p "x"')).toBe(true);
    expect(segmentIsRawGrokHeadless(`bash -c 'grok -p "nested"'`)).toBe(true);
  });

  it("splits chained commands so a trailing raw grok is still seen", () => {
    expect(splitShellSegments("pnpm test && grok -p x")).toEqual(["pnpm test", "grok -p x"]);
    expect(commandContainsRawGrokHeadless("pnpm test && grok -p x")).toBe(true);
    expect(commandContainsRawGrokHeadless("echo done; true")).toBe(false);
  });

  it("peels leading env assignments for sanction detection", () => {
    const tokens = tokenizeSegment(
      `${RAW_GROK_SANCTION_ENV}=1 ${RAW_GROK_REASON_ENV}=probe grok -p x`,
    );
    const { assignments, rest } = peelLeadingEnvAssignments(tokens);
    expect(assignments[RAW_GROK_SANCTION_ENV]).toBe("1");
    expect(assignments[RAW_GROK_REASON_ENV]).toBe("probe");
    expect(rest[0]).toBe("grok");
  });
});

describe("chokepoint evaluate — control / treatment", () => {
  it("CONTROL: raw grok -p without sanction is denied", () => {
    const verdict = evaluateRawGrokShellCommand('~/.grok/bin/grok -p "isolation control"', {
      env: { PATH: "/usr/bin" },
      logSanction: false,
    });
    expect(verdict.decision).toBe("deny");
    expect(verdict.matched).toBe(true);
    expect(verdict.reason).toMatch(/REFUSING raw headless|bypass/);
  });

  it("TREATMENT (sanctioned escape): allow when flag+reason set, and log", () => {
    const root = mkdtempSync(join(tmpdir(), "chokepoint-sanction-"));
    process.env["OPENCLINXR_COORDINATION_ROOT"] = root;
    resetCoordinationRootCache();

    const verdict = evaluateRawGrokShellCommand('grok -p "isolation treatment"', {
      env: {
        PATH: "/usr/bin",
        [RAW_GROK_SANCTION_ENV]: "1",
        [RAW_GROK_REASON_ENV]: "isolation-probe-control-arm",
      },
      repoRoot: root,
      logSanction: true,
    });
    expect(verdict.decision).toBe("allow");
    expect(verdict.matched).toBe(true);
    if (verdict.matched && verdict.decision === "allow") {
      expect(verdict.sanctioned).toBe(true);
    }

    const ledger = join(root, RAW_GROK_SANCTION_LEDGER);
    expect(existsSync(ledger)).toBe(true);
    const line = readFileSync(ledger, "utf8").trim().split("\n").at(-1)!;
    const parsed = JSON.parse(line) as { reason: string };
    expect(parsed.reason).toBe("isolation-probe-control-arm");
  });

  it("TREATMENT (sanction via command prefix): allow without process env", () => {
    const cmd =
      `${RAW_GROK_SANCTION_ENV}=1 ${RAW_GROK_REASON_ENV}=prefix-probe `
      + `~/.grok/bin/grok -p "x"`;
    const verdict = evaluateRawGrokShellCommand(cmd, {
      env: { PATH: "/usr/bin" },
      logSanction: false,
    });
    expect(verdict.decision).toBe("allow");
    expect(verdict.matched).toBe(true);
  });

  it("sanction without reason is still denied (escape must be named)", () => {
    const verdict = evaluateRawGrokShellCommand("grok -p x", {
      env: { [RAW_GROK_SANCTION_ENV]: "1" },
      logSanction: false,
    });
    expect(verdict.decision).toBe("deny");
  });

  it("workers never get the escape even with sanction env", () => {
    const verdict = evaluateRawGrokShellCommand("grok -p x", {
      env: {
        OPENCLINXR_WORKER: "1",
        [RAW_GROK_SANCTION_ENV]: "1",
        [RAW_GROK_REASON_ENV]: "worker-self-sanction",
      },
      logSanction: false,
    });
    expect(verdict.decision).toBe("deny");
    expect(verdict.reason).toMatch(/OPENCLINXR_WORKER/);
  });

  it("non-matching commands always allow (existing openclaw scripts, etc.)", () => {
    for (const cmd of [
      "pnpm openclaw:run-next",
      "pnpm packages:typecheck:agent",
      "tsx tools/openclinxr/openclaw/dispatch-worker.ts",
      "pnpm test",
      "echo grok -p is the wrong path",
    ]) {
      const v = evaluateRawGrokShellCommand(cmd, { env: {}, logSanction: false });
      expect(v.decision, cmd).toBe("allow");
      expect(v.matched ?? false, cmd).toBe(false);
    }
  });
});

describe("dispatch path remains outside the shell chokepoint", () => {
  it("buildArgv still produces -p first (dispatch uses spawn, not shell matcher)", async () => {
    // Import from dispatch-worker — proves sanctioned path API still works alongside chokepoint.
    const { buildArgv } = await import("./dispatch-worker.js");
    const argv = buildArgv({ prompt: "do work", resume: "sess-1" });
    expect(argv[0]).toBe("-p");
    expect(argv[1]).toBe("do work");
    // The chokepoint never sees spawn() argv — only shell-tool command strings.
    // A synthetic shell line that re-creates buildArgv would be denied without sanction:
    const fakeShell = `grok ${argv.map((a) => JSON.stringify(a)).join(" ")}`;
    const denied = evaluateRawGrokShellCommand(fakeShell, { env: {}, logSanction: false });
    expect(denied.decision).toBe("deny");
  });
});
