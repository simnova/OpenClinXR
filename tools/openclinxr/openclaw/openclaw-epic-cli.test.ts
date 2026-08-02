import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  advanceEpicCursor,
  applyNextDequeueHeader,
  applyNextDequeueToFile,
  buildEpicPlan,
  createExampleEpic,
  loadEpic,
  saveEpic,
  setActiveEpic,
  getActiveEpicId,
  EPIC_SCHEMA,
} from "./openclaw-epic-cli.ts";

describe("openclaw-epic-cli", () => {
  it("applyNextDequeueHeader replaces Next dequeue line", () => {
    const src = `# Status\n\n**Next dequeue:** old-slice (Q1)\n\n## Active Work\n`;
    const { text, changed } = applyNextDequeueHeader(src, "new-slice (Q4) — do thing");
    expect(changed).toBe(true);
    expect(text).toContain("**Next dequeue:** new-slice (Q4) — do thing");
    expect(text).not.toContain("old-slice");
  });

  it("advances cursor and completes epic", () => {
    const epic = createExampleEpic();
    epic.slices = [
      { sliceId: "a", goal: "A", requiresVerifyOk: false },
      { sliceId: "b", goal: "B", requiresVerifyOk: false },
    ];
    epic.cursor = 0;
    const r1 = advanceEpicCursor(epic);
    expect(r1.closedSliceId).toBe("a");
    expect(r1.nextSlice?.sliceId).toBe("b");
    expect(r1.completed).toBe(false);
    const r2 = advanceEpicCursor(r1.epic);
    expect(r2.completed).toBe(true);
    expect(r2.epic.status).toBe("completed");
  });

  it("persists epic and ACTIVE pointer", () => {
    const root = mkdtempSync(path.join(tmpdir(), "epic-cli-"));
    const epic = createExampleEpic();
    epic.id = "test-epic";
    saveEpic(root, epic);
    setActiveEpic(root, "test-epic");
    expect(getActiveEpicId(root)).toBe("test-epic");
    const loaded = loadEpic(root, "test-epic");
    expect(loaded.schemaVersion).toBe(EPIC_SCHEMA);
    expect(loaded.slices.length).toBeGreaterThan(0);
  });

  it("applyNextDequeueToFile writes PROJECT_STATUS", () => {
    const root = mkdtempSync(path.join(tmpdir(), "epic-header-"));
    writeFileSync(
      path.join(root, "PROJECT_STATUS.md"),
      "# S\n\n**Next dequeue:** old\n\n## Active Work\n",
      "utf8",
    );
    const r = applyNextDequeueToFile(root, "fresh-slice (Q5) — goal", { dryRun: false });
    expect(r.changed).toBe(true);
    const text = readFileSync(path.join(root, "PROJECT_STATUS.md"), "utf8");
    expect(text).toContain("**Next dequeue:** fresh-slice (Q5) — goal");
  });

  it("buildEpicPlan emits command sequence", () => {
    const root = mkdtempSync(path.join(tmpdir(), "epic-plan-"));
    mkdirSync(path.join(root, ".openclinxr/openclaw"), { recursive: true });
    const epic = createExampleEpic();
    const plan = buildEpicPlan(root, epic);
    expect(plan.commands.some((c) => c.includes("slice-token:start"))).toBe(true);
    expect(plan.current?.sliceId).toBe("openclaw-pre-epic-kit-v1");
  });
});
