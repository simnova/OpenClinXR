// Inspector regions test (card W4a-0). Fixture coordinates under
// fixtures/inspector/** are illustrative: they exercise the validateRegions
// blocker ids, not real capture output.
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { blueprintActorLines, validateRegions } from "./capture/inspector-regions.mjs";

vi.mock("../xr-sync/harness-lib.mjs", () => ({
  projectActorBbox: vi.fn(),
  startStaticServer: vi.fn(),
}));

interface RegionDoc {
  canvasRect: { x: number; y: number; width: number; height: number };
  viewport: { width: number; height: number };
  regions: { actorId: string; bbox: { x: number; y: number; width: number; height: number } }[];
}

const BLUEPRINT_ACTOR_IDS = [
  "patient_robert_hayes_v1",
  "spouse_anna_hayes_v1",
  "nurse_maria_alvarez_v1",
];

function readFixture(name: string): RegionDoc {
  const raw = readFileSync(
    path.join(process.cwd(), "tools", "openclinxr", "evidence", "site", "fixtures", "inspector", name),
    "utf8",
  );
  return JSON.parse(raw) as RegionDoc;
}

it("KNOWN-GOOD patient bbox inside canvas at 0.3 viewport height plus nurse returns no blockers", () => {
  expect(validateRegions(readFixture("known-good.json"), BLUEPRINT_ACTOR_IDS)).toEqual([]);
});

it("NEGATIVE bbox crossing the canvas right edge returns region_bbox_outside_canvas", () => {
  expect(validateRegions(readFixture("region-outside-canvas.json"), BLUEPRINT_ACTOR_IDS)).toEqual([
    "region_bbox_outside_canvas:nurse_maria_alvarez_v1",
  ]);
});

it("NEGATIVE zero-width bbox returns region_bbox_zero_area", () => {
  expect(validateRegions(readFixture("region-zero-area.json"), BLUEPRINT_ACTOR_IDS)).toEqual([
    "region_bbox_zero_area:patient_robert_hayes_v1",
  ]);
});

it("NEGATIVE actorId patient_robert_hayes_v2 returns region_actor_unknown", () => {
  expect(validateRegions(readFixture("region-unknown-actor.json"), BLUEPRINT_ACTOR_IDS)).toEqual([
    "region_actor_unknown:patient_robert_hayes_v2",
  ]);
});

it("NEGATIVE no patient region returns region_patient_missing", () => {
  expect(validateRegions(readFixture("region-patient-missing.json"), BLUEPRINT_ACTOR_IDS)).toEqual([
    "region_patient_missing",
  ]);
});

it("NEGATIVE patient height 0.05 of viewport returns region_patient_too_small", () => {
  expect(validateRegions(readFixture("region-patient-too-small.json"), BLUEPRINT_ACTOR_IDS)).toEqual([
    "region_patient_too_small",
  ]);
});

it("blueprintActorLines on the real blueprint returns the 3 actor ids with nurse on 2 or more lines", () => {
  const sourcePath = path.join(
    process.cwd(),
    "packages",
    "openclinxr",
    "scenario-fixtures",
    "src",
    "ed-chest-pain-mod.ts",
  );
  const sourceText = readFileSync(sourcePath, "utf8");
  const lines = blueprintActorLines(sourceText);
  expect([...lines.keys()].sort()).toEqual([...BLUEPRINT_ACTOR_IDS].sort());
  const nurseLines = lines.get("nurse_maria_alvarez_v1") ?? [];
  expect(nurseLines.length).toBeGreaterThanOrEqual(2);
  const sourceLines = sourceText.split("\n");
  for (const [actorId, numbers] of lines) {
    for (const lineNumber of numbers) {
      expect(sourceLines[lineNumber - 1] ?? "").toContain(actorId);
    }
  }
});

it("inspector-still imports projectActorBbox and w0-still helpers and defines no patientBbox", () => {
  const stillSource = readFileSync(
    path.join(process.cwd(), "tools", "openclinxr", "evidence", "site", "capture", "inspector-still.mjs"),
    "utf8",
  );
  expect(stillSource).toContain("projectActorBbox");
  expect(stillSource).toContain("harness-lib.mjs");
  expect(stillSource).toContain('from "./w0-still.mjs"');
  expect(stillSource).toContain("regionFor");
  expect(stillSource).not.toContain("patientBbox");
});

it("inspector-still drives only through openW0Stage from w0-still", () => {
  const stillSource = readFileSync(
    path.join(process.cwd(), "tools", "openclinxr", "evidence", "site", "capture", "inspector-still.mjs"),
    "utf8",
  );
  for (const banned of ["createEncounterServer", "resolveDevStack", "startStaticServer", "chromium.launch", "addStyleTag"]) {
    expect(stillSource).not.toContain(banned);
  }
  expect(stillSource).toContain("openW0Stage");
  expect(stillSource).toContain('from "./w0-still.mjs"');
});

it("BEHAVIOUR regionFor returns the mocked bbox from exactly one projectActorBbox call", async () => {
  const harness = await import("../xr-sync/harness-lib.mjs");
  const still = await import("./capture/inspector-still.mjs");
  const page = { stub: "page" };
  const bbox = { x: 10, y: 20, width: 30, height: 40 };
  vi.mocked(harness.projectActorBbox).mockReset();
  vi.mocked(harness.projectActorBbox).mockResolvedValue({ ok: true, bbox });
  const row = await still.regionFor(page, "nurse_maria_alvarez_v1");
  expect(harness.projectActorBbox).toHaveBeenCalledTimes(1);
  expect(harness.projectActorBbox).toHaveBeenCalledWith(page, "nurse_maria_alvarez_v1");
  expect(row).toEqual({ actorId: "nurse_maria_alvarez_v1", bbox });
});

it("BEHAVIOUR regionFor maps ok:false to why", async () => {
  const harness = await import("../xr-sync/harness-lib.mjs");
  const still = await import("./capture/inspector-still.mjs");
  const page = { stub: "page" };
  vi.mocked(harness.projectActorBbox).mockReset();
  vi.mocked(harness.projectActorBbox).mockResolvedValue({ ok: false, why: "no scene node stamped ghost" });
  const row = await still.regionFor(page, "ghost_actor_v1");
  expect(harness.projectActorBbox).toHaveBeenCalledTimes(1);
  expect(harness.projectActorBbox).toHaveBeenCalledWith(page, "ghost_actor_v1");
  expect(row).toEqual({ actorId: "ghost_actor_v1", why: "no scene node stamped ghost" });
});

it("importing inspector-still launches no browser", async () => {
  const still = await import("./capture/inspector-still.mjs");
  expect(typeof still.regionFor).toBe("function");
  expect(typeof still.captureInspectorRun).toBe("function");
});
