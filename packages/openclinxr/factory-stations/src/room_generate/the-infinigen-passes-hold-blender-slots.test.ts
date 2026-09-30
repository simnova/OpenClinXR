import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { runRoomGenerate } from "../index.js";

const priorLockRoot = process.env["OPENCLINXR_LOCK_ROOT"];
const priorBlenderSize = process.env["OPENCLINXR_SLOTS_BLENDER"];
const priorSlotTestLog = process.env["SLOT_TEST_LOG"];
let work: string | null = null;

afterEach(() => {
  if (work) rmSync(work, { recursive: true, force: true });
  work = null;
  if (priorLockRoot === undefined) delete process.env["OPENCLINXR_LOCK_ROOT"];
  else process.env["OPENCLINXR_LOCK_ROOT"] = priorLockRoot;
  if (priorBlenderSize === undefined) delete process.env["OPENCLINXR_SLOTS_BLENDER"];
  else process.env["OPENCLINXR_SLOTS_BLENDER"] = priorBlenderSize;
  if (priorSlotTestLog === undefined) delete process.env["SLOT_TEST_LOG"];
  else process.env["SLOT_TEST_LOG"] = priorSlotTestLog;
});

it("holds a blender slot for each Infinigen and Blender child pass", async () => {
  work = mkdtempSync(path.join(tmpdir(), `room-generate-slots-${process.pid}-`));
  const lockRoot = path.join(work, "locks");
  const infinigenSource = path.join(work, "infinigen");
  const logPath = path.join(work, "holders.log");
  mkdirSync(path.join(infinigenSource, "infinigen_examples"), { recursive: true });
  mkdirSync(path.join(infinigenSource, "infinigen/core/constraints/example_solver/room"), { recursive: true });
  writeFileSync(path.join(infinigenSource, "infinigen_examples/generate_indoors.py"), "# stub\n");
  writeFileSync(
    path.join(infinigenSource, "infinigen/core/constraints/example_solver/room/decorate.py"),
    '"Concrete"\nOPENCLINXR_ROOM_REALISM = True\n',
  );

  const recorder = String.raw`
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
const valueAfter = (flag) => args[args.indexOf(flag) + 1];
const script = valueAfter("--python") || "";
const stage = args.includes("-m") ? "generate"
  : script.includes("strip_room_shell") ? "strip"
  : script.includes("bake_shell") ? "shell-bake"
  : script.includes("probe_door") ? "probe" : "extract";
const poolDir = path.join(process.env.OPENCLINXR_LOCK_ROOT, "blender");
const holders = fs.existsSync(poolDir) ? fs.readdirSync(poolDir).filter((name) => /^slot-.*\.json$/.test(name)).length : 0;
fs.appendFileSync(process.env.SLOT_TEST_LOG, stage + ":" + holders + "\n");
if (stage === "generate") {
  const outputDir = valueAfter("--output_folder");
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, "scene.blend"), "scene");
} else if (stage === "strip") {
  fs.writeFileSync(valueAfter("--output"), "work");
} else if (stage === "extract") {
  fs.writeFileSync(valueAfter("--output"), "glb");
  fs.writeFileSync(valueAfter("--predicate-output"), JSON.stringify({ pass: true }));
  process.stdout.write(JSON.stringify({ extracted: true }) + "\n");
} else if (stage === "probe") {
  fs.writeFileSync(valueAfter("--output"), JSON.stringify({ door: true }));
}
`;
  const fakePython = path.join(work, "fake-python.cjs");
  const fakeBlender = path.join(work, "fake-blender.cjs");
  writeFileSync(fakePython, `#!/usr/bin/env node\n${recorder}`);
  writeFileSync(fakeBlender, `#!/usr/bin/env node\n${recorder}`);
  chmodSync(fakePython, 0o755);
  chmodSync(fakeBlender, 0o755);

  process.env["OPENCLINXR_LOCK_ROOT"] = lockRoot;
  process.env["OPENCLINXR_SLOTS_BLENDER"] = "1";
  process.env["SLOT_TEST_LOG"] = logPath;
  await runRoomGenerate(
    {
      environmentId: "slot-test",
      infinigenPrompt: "stubbed fixed-footprint room",
      footprintMeters: { width: 4, depth: 5, ceilingHeight: 2.7 },
      seed: 7,
      layoutVariant: "single",
    },
    {
      blender: fakeBlender,
      workGlb: path.join(work, "room.glb"),
      bakeAlbedo: false,
      bakeOcclusion: false,
      simplifyAfterBake: false,
      cwd: work,
      infinigenSource,
      venvPython: fakePython,
      generateTimeoutMs: 5_000,
    },
  );

  expect(readFileSync(logPath, "utf8").trim().split("\n")).toEqual([
    "generate:1",
    "strip:1",
    "shell-bake:1",
    "extract:1",
    "probe:1",
  ]);
});
