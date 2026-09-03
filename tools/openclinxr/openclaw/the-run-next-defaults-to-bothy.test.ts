import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  boardCardOrNull,
  buildOpenClawRunNextPlan,
  type BoardCardSelection,
} from "./openclaw-slice-runner.js";

/**
 * OBSERVABLE: `pnpm openclaw:run-next` never consults BothyBoard in its default mode.
 *
 * On 2026-09-03, `pnpm openclaw:run-next` returned `selectedSlice:null` while a ready/Planted
 * OpenClinXR Bothy task sat on the board. `openclaw-slice-runner.ts`'s dequeue hop
 * (`boardCardOrNull`) called `selectNextBoardCard` (GitHub project 7) UNCONDITIONALLY — the
 * `selectNextBothyCard` / `bothyDequeueEnabled` helpers existed and were exercised by unit tests,
 * but the CLI-facing default branch never called them. BothyBoard is the dequeue SSOT
 * (`BOTHY_BOARD_DEQUEUE` unset or 1); GitHub project 7 is the `BOTHY_BOARD_DEQUEUE=0` opt-in.
 *
 * These clauses prove the hop `main()` actually runs: dequeue via `boardCardOrNull` with the
 * runner's env (machine name, PAT) and repo cache store, then plan emission through
 * `buildOpenClawRunNextPlan`. A returned task whose body `tasks.next` does not carry must be fetched
 * through `bothy-board.tasks.get`, not through gh. A missing PAT, an incomplete read, or
 * `{task:null}` fails closed: null card, and the GitHub project selector never executes.
 *
 * claimScope: run-next's default dequeue branch semantics with an injected BothyBoard fetch.
 * notEvidenceFor: a real network call to BothyBoard, worker execution after the bridge lands, or
 *   GitHub retirement — those are integration/operational follow-ups.
 */

/** A runnable GitHub project 7 card, used by the injected gh runner spies. */
const RUNNABLE_GITHUB_PAGE = JSON.stringify({
  totalCount: 1,
  items: [
    {
      factory: "Planted",
      status: "Todo",
      priority: "P0",
      content: { number: 603, title: "a runnable GitHub card" },
    },
  ],
});

/**
 * Non-neutral PROJECT_STATUS: an anchored Next dequeue header that WOULD win if the CLI hop
 * fell through to markdown. Fail-closed Bothy reads must not emit this slice; a Planted Bothy
 * card must outrank it.
 */
const MARKDOWN_POINTER = "admin-packet-replay-surfaces-impl";
const NON_NEUTRAL_STATUS = {
  "PROJECT_STATUS.md": `# OpenClinXR Project Status\n\n**Next dequeue:** \`${MARKDOWN_POINTER}\`\n`,
};

function planFor(boardCard: BoardCardSelection | null, boardConsulted = true) {
  return buildOpenClawRunNextPlan({
    stateFiles: NON_NEUTRAL_STATUS,
    gitStatusShort: "## main",
    boardCard,
    boardConsulted,
  });
}

describe("run-next defaults to the BothyBoard dequeue", () => {
  it("(1) default env dequeues the Planted Bothy task and emits its bothy-tsk_ slice as the next team command", async () => {
    // GitHub WOULD return a runnable card here; the default branch must not execute it.
    let ghCalls = 0;
    const calls: Array<{ tool: string; arguments: Record<string, unknown> }> = [];
    const root = mkdtempSync(path.join(tmpdir(), "run-next-bothy-"));

    const card = await boardCardOrNull({
      env: { BOTHY_MACHINE_NAME: "audit-box" },
      gh: () => {
        ghCalls += 1;
        return RUNNABLE_GITHUB_PAGE;
      },
      bothy: {
        pat: "bb_pat_test",
        repoRoot: root,
        fetch: async ({ tool, arguments: args }) => {
          calls.push({ tool, arguments: args });
          if (tool === "bothy-board.tasks.next") {
            return {
              structuredContent: {
                task: {
                  id: "tsk_aabb",
                  title: "wire the bothy hop",
                  factory: "Planted",
                  status: "ready",
                  body: "## factory_step: instrument\n## done_when\n- run:x\n",
                },
                spawnCommand: "grok -s sess-1 -w -p …",
                grokSessionId: "sess-1",
                cacheToken: "bb-r1",
              },
              httpStatus: 200,
            };
          }
          return { structuredContent: {}, httpStatus: 200 };
        },
      },
    });

    expect(ghCalls, "GitHub project 7 must not be ranked while BothyBoard is the default SSOT").toBe(0);
    expect(calls[0]?.tool).toBe("bothy-board.tasks.next");
    expect(calls[0]?.arguments.machineName).toBe("audit-box");

    // Cache store: the runner's repoRoot wires fileTokenStore, which persists the snapshot.
    const cache = JSON.parse(
      readFileSync(path.join(root, ".openclinxr/openclaw/bothy-next-cache.json"), "utf8"),
    ) as { task?: { id?: string } };
    expect(cache.task?.id).toBe("tsk_aabb");

    expect(card).not.toBeNull();
    expect(card?.sliceId).toBe("bothy-tsk_aabb");
    expect(card?.body).toContain("## factory_step:");

    const plan = planFor(card);
    expect(plan.selectedSlice).toBe("bothy-tsk_aabb");
    expect(plan.nextCommand).toContain("--slice-id bothy-tsk_aabb");
    expect(plan.sliceTeam.teamSpawnCommand).toContain("--slice-id bothy-tsk_aabb");
  });

  it("(1b) BOTHY_BOARD_DEQUEUE=1 is the same default Bothy hop, not GitHub", async () => {
    let ghCalls = 0;
    const card = await boardCardOrNull({
      env: { BOTHY_BOARD_DEQUEUE: "1", BOTHY_MACHINE_NAME: "audit-box" },
      gh: () => {
        ghCalls += 1;
        return RUNNABLE_GITHUB_PAGE;
      },
      bothy: {
        pat: "bb_pat_test",
        fetch: async () => ({
          structuredContent: {
            task: { id: "tsk_one", title: "explicit-1", factory: "Planted", status: "ready", body: "## done_when\n- run:x\n" },
          },
          httpStatus: 200,
        }),
      },
    });
    expect(ghCalls).toBe(0);
    expect(card?.sliceId).toBe("bothy-tsk_one");
    expect(planFor(card).selectedSlice).toBe("bothy-tsk_one");
  });

  it("(2) a Planted task whose body tasks.next does not carry is fetched through bothy-board.tasks.get", async () => {
    let ghCalls = 0;
    const calls: Array<{ tool: string; arguments: Record<string, unknown> }> = [];
    const root = mkdtempSync(path.join(tmpdir(), "run-next-bothy-body-"));

    const card = await boardCardOrNull({
      env: { BOTHY_MACHINE_NAME: "audit-box" },
      gh: () => {
        ghCalls += 1;
        return RUNNABLE_GITHUB_PAGE;
      },
      bothy: {
        pat: "bb_pat_test",
        repoRoot: root,
        fetch: async ({ tool, arguments: args }) => {
          calls.push({ tool, arguments: args });
          if (tool === "bothy-board.tasks.next") {
            return {
              structuredContent: {
                task: { id: "tsk_bodyless", title: "body via get", factory: "Planted", status: "ready" },
                cacheToken: "bb-r1",
              },
              httpStatus: 200,
            };
          }
          if (tool === "bothy-board.tasks.get") {
            return {
              structuredContent: {
                task: { id: "tsk_bodyless", title: "body via get", body: "## done_when\n- run:pnpm exec vitest run x\n" },
              },
              httpStatus: 200,
            };
          }
          return { structuredContent: {}, httpStatus: 200 };
        },
      },
    });

    expect(ghCalls).toBe(0);
    expect(calls.map((c) => c.tool)).toEqual(["bothy-board.tasks.next", "bothy-board.tasks.get"]);
    expect(calls[1]?.arguments.taskId).toBe("tsk_bodyless");
    expect(card?.sliceId).toBe("bothy-tsk_bodyless");
    expect(card?.body).toContain("## done_when");
    expect(planFor(card).selectedSlice).toBe("bothy-tsk_bodyless");
  });

  it("(3) a missing Bothy PAT is incomplete-read: null card, no GitHub execution, no slice emitted", async () => {
    let ghCalls = 0;
    const card = await boardCardOrNull({
      env: {},
      gh: () => {
        ghCalls += 1;
        return RUNNABLE_GITHUB_PAGE;
      },
    });
    expect(card, "missing PAT must refuse, not rank GitHub").toBeNull();
    expect(ghCalls).toBe(0);
    const plan = planFor(card);
    expect(plan.selectedSlice).toBeNull();
    expect(plan.nextCommand).toBeNull();
  });

  it("(4) an incomplete Board read is fail-closed: null card, no GitHub execution, no slice emitted", async () => {
    let ghCalls = 0;
    const card = await boardCardOrNull({
      env: { BOTHY_BOARD_PAT: "bb_pat_test" },
      gh: () => {
        ghCalls += 1;
        return RUNNABLE_GITHUB_PAGE;
      },
      bothy: {
        fetch: async () => ({ structuredContent: null, httpStatus: 500 }),
      },
    });
    expect(card, "HTTP 500 must refuse, not rank GitHub").toBeNull();
    expect(ghCalls).toBe(0);
    const plan = planFor(card);
    expect(plan.selectedSlice).toBeNull();
    expect(plan.nextCommand).toBeNull();
  });

  it("(5) {task:null} is an empty ready set: null card, no GitHub execution, no slice emitted", async () => {
    let ghCalls = 0;
    const card = await boardCardOrNull({
      env: { BOTHY_BOARD_PAT: "bb_pat_test" },
      gh: () => {
        ghCalls += 1;
        return RUNNABLE_GITHUB_PAGE;
      },
      bothy: {
        fetch: async () => ({ structuredContent: { task: null }, httpStatus: 200 }),
      },
    });
    expect(card, "{task:null} is success-with-no-candidate; GitHub must not be ranked").toBeNull();
    expect(ghCalls).toBe(0);
    const plan = planFor(card);
    expect(plan.selectedSlice).toBeNull();
    expect(plan.nextCommand).toBeNull();
  });

  it("(6) BOTHY_BOARD_DEQUEUE=0 is the sole explicit opt-in for the GitHub project selector", async () => {
    let bothyCalls = 0;
    const card = await boardCardOrNull({
      env: { BOTHY_BOARD_DEQUEUE: "0", BOTHY_BOARD_PAT: "bb_pat_test" },
      gh: () => RUNNABLE_GITHUB_PAGE,
      bothy: {
        fetch: async () => {
          bothyCalls += 1;
          return { structuredContent: { task: null }, httpStatus: 200 };
        },
      },
    });
    expect(bothyCalls, "the BothyBoard dequeue must not run in GitHub opt-in mode").toBe(0);
    expect(card?.sliceId).toBe("issue-603");
    expect(planFor(card).selectedSlice).toBe("issue-603");
  });

  it("(7) COUNTERWEIGHT: a fail-closed Bothy hop does not fall through to a non-neutral PROJECT_STATUS Next dequeue", async () => {
    const card = await boardCardOrNull({
      env: {},
      gh: () => RUNNABLE_GITHUB_PAGE,
    });
    expect(card).toBeNull();
    const plan = planFor(card, true);
    expect(plan.selectedSlice, "markdown Next dequeue must not steal a fail-closed Bothy read").toBeNull();
    expect(plan.nextCommand).toBeNull();
  });

  it("(8) --no-board still honours an anchored markdown pointer (offline, hop skipped)", () => {
    const plan = planFor(null, false);
    expect(plan.selectedSlice).toBe(MARKDOWN_POINTER);
  });
});
