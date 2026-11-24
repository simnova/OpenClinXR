import { describe, expect, it } from "vitest";

import { childEnv, decide, finalLine, isHalted, isOptedIn, markerOf, resumePrompt, startAtItem, type RunOutcome } from "./lane-driver.js";

const base: RunOutcome = {
  final: "DONE: a",
  startBefore: "a",
  startAfter: "b",
  halted: false,
  timedOut: false,
  failed: false,
  stalls: 0,
};

describe("handoff parsing", () => {
  it("takes the item id from the first START AT line", () => {
    expect(startAtItem("x\nSTART AT item 18z48 (2026-11-24): eye plan\nSTART AT item zz")).toBe("18z48");
    expect(startAtItem("START AT item t2: edit b.txt")).toBe("t2");
    expect(startAtItem("no start line")).toBeNull();
  });

  it("opts in only on an AUTOCONTINUE: on line without a halt", () => {
    expect(isOptedIn("## Next action\nAUTOCONTINUE: on\n")).toBe(true);
    expect(isOptedIn("AUTOCONTINUE: on (comment)\n")).toBe(false);
    expect(isOptedIn("AUTOCONTINUE: on\nLANE HALTED by operator\n")).toBe(false);
    expect(isOptedIn("AUTOCONTINUE: on\nAUTOCONTINUE: off\n")).toBe(false);
  });

  it("halts on a standalone pause/stop line, not on prose that mentions stop", () => {
    expect(isHalted("AUTOCONTINUE: on\npause\n")).toBe(true);
    expect(isHalted("AUTOCONTINUE: on\n  STOP  \n")).toBe(true);
    expect(isHalted("If still no net: stop 17y, revert --face-furrow\n")).toBe(false);
    expect(isHalted("write LANE HALTED or AUTOCONTINUE: off to stop\n")).toBe(false);
  });
});

describe("final line markers", () => {
  it("reads the last non-empty line", () => {
    expect(finalLine("did things\n\nBLOCKED: need verdict\n\n")).toBe("BLOCKED: need verdict");
    expect(finalLine("")).toBe("");
  });

  it("tolerates markdown emphasis and ignores mid-line markers", () => {
    expect(markerOf("**BLOCKED:** operator verdict")).toBe("BLOCKED");
    expect(markerOf("WAITING: render r3")).toBe("WAITING");
    expect(markerOf("DONE: t1")).toBe("DONE");
    expect(markerOf("the lane is not BLOCKED: fine")).toBeNull();
  });
});

describe("decide", () => {
  it("continues when START AT advanced", () => {
    expect(decide(base)).toMatchObject({ action: "continue", stalls: 0 });
  });

  it("stops on BLOCKED even when START AT advanced", () => {
    expect(decide({ ...base, final: "BLOCKED: needs operator" })).toMatchObject({ action: "stop" });
  });

  it("stops on a halted handoff before anything else", () => {
    expect(decide({ ...base, halted: true }).reason).toMatch(/halted/);
  });

  it("stops on timeout and on a failed run", () => {
    expect(decide({ ...base, timedOut: true }).reason).toBe("run timed out");
    expect(decide({ ...base, failed: true }).action).toBe("stop");
  });

  it("stops on WAITING when START AT did not move", () => {
    expect(decide({ ...base, startAfter: "a", final: "WAITING: render" })).toMatchObject({ action: "stop" });
  });

  it("WAITING after an advanced START AT still continues", () => {
    expect(decide({ ...base, final: "WAITING: next item later" }).action).toBe("continue");
  });

  it("retries once on an unchanged START AT, stops on the second", () => {
    const first = decide({ ...base, startAfter: "a", final: "done-ish" });
    expect(first).toMatchObject({ action: "continue", stalls: 1 });
    expect(decide({ ...base, startAfter: "a", final: "done-ish", stalls: first.stalls })).toMatchObject({ action: "stop", stalls: 2 });
  });

  it("resets the stall count after an advance", () => {
    expect(decide({ ...base, stalls: 1 }).stalls).toBe(0);
  });

  it("stops when the run removed the START AT line", () => {
    expect(decide({ ...base, startAfter: null }).action).toBe("stop");
  });
});

it("resume prompt carries the standard first sentence", () => {
  expect(resumePrompt("L", "/w/.openclinxr/handoffs/L.md", "t1")).toMatch(
    /^You are resuming lane L\. Read \/w\/\.openclinxr\/handoffs\/L\.md, verify every mechanical fact with git before acting, then do START AT item t1\./,
  );
});

it("child env drops desktop-session, hook-bypass and git-redirect vars", () => {
  const env = childEnv({
    PATH: "/bin",
    CLAUDECODE: "1",
    CLAUDE_CODE_SDK_HAS_HOST_AUTH_REFRESH: "1",
    RUST_LOG: "debug",
    OPENCLAW_SKIP_HOOKS: "1",
    GIT_DIR: "/x",
  });
  expect(env).toEqual({ PATH: "/bin" });
});
