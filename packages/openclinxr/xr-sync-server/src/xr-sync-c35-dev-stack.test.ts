import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { clinicKneePainScenario, edChestPainScenario, scenarioDialogueSeedBank } from "@openclinxr/scenario-fixtures";
import { connect, type EncounterSnapshot, type SyncConnection } from "@openclinxr/xr-sync-client";
import { afterEach, describe, expect, it } from "vitest";

// C35 RED (planted by lane manager, 2026-11-06): the documented dev stack loads the shipped scenarios + dialogue seed bank.
// Contract (names are the spec):
//   dev-server.ts reads XR_SYNC_SCENARIO (a shipped scenarioId; default "ed_chest_pain_priority_v1") and XR_SYNC_ENCOUNTER_SECONDS (default 900).
//   It builds a one-slot exam blueprint (doorway 1 s, encounter XR_SYNC_ENCOUNTER_SECONDS, note 60 s) and hands createEncounterServer
//   { examBlueprint, scenarios: [<shipped scenario, status forced "approved" for local dev>], dialogueSeeds: <exported scenarioDialogueSeedBank> }.
//   stdout line `xr-sync scenario ready id=<scenarioId> actors=<n>` BEFORE the `xr-sync listening ...` line.
//   Unknown id: no listening line, exit code 1, stderr `xr-sync dev-server: unknown-scenario: "<id>" (known: <comma list>)`, and it fails
//   BEFORE the sidecar probe (so the refusal is immediate).
//   Sidecar default python is repo-relative (<repo>/.openclinxr/stt/venv/bin/python), never an absolute machine path; the probe timeout default is 180000 ms.
const REPO = resolve(process.cwd(), "../../..");
const children: ChildProcess[] = [];
// C36 Part A: dev-server runs in its own process group so SIGKILL reaches the tsx wrapper's node child and the sidecar.
function killGroup(child: ChildProcess | undefined): void {
  if (child?.pid === undefined) return;
  try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); }
}
const dirs: string[] = [];
const conns: SyncConnection[] = [];
afterEach(async () => {
  while (conns.length > 0) await conns.pop()?.leave().catch(() => undefined);
  while (children.length > 0) killGroup(children.pop());
  while (dirs.length > 0) await rm(dirs.pop() as string, { recursive: true, force: true });
});
async function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      probe.close(() => resolvePort(typeof address === "object" && address !== null ? address.port : 0));
    });
  });
}
interface Dev { port: number; out: string[]; err: string[]; child: ChildProcess; exitCode: () => number | null | undefined }
async function spawnDev(env: Record<string, string>, args: string[] = []): Promise<Dev> {
  const port = await freePort();
  const child = spawn("../../../node_modules/.bin/tsx", [...args, "src/dev-server.ts"], { cwd: process.cwd(), env: { ...process.env, PORT: String(port), XR_SYNC_INSTANCE: "c35-test", XR_SYNC_STT: "off", ...env }, stdio: ["ignore", "pipe", "pipe"], detached: true });
  children.push(child);
  const dev: Dev = { port, out: [], err: [], child, exitCode: () => undefined };
  let code: number | null | undefined;
  child.on("exit", (c) => { code = c; });
  dev.exitCode = () => code;
  let pending = "";
  child.stdout?.on("data", (d: Buffer) => { pending += d.toString(); const parts = pending.split("\n"); pending = parts.pop() ?? ""; dev.out.push(...parts); });
  child.stderr?.on("data", (d: Buffer) => { dev.err.push(...d.toString().split("\n")); });
  return dev;
}
async function waitUntil(predicate: () => boolean, ms: number, label: string): Promise<void> {
  const deadline = Date.now() + ms;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}
async function bootListening(env: Record<string, string>): Promise<Dev> {
  const dev = await spawnDev(env);
  await waitUntil(() => dev.out.some((l) => l.startsWith("xr-sync listening")) || dev.exitCode() !== undefined, 60000, "listening");
  if (dev.exitCode() !== undefined) throw new Error(`dev-server exited ${dev.exitCode()}: ${dev.out.join(" | ")} ${dev.err.join(" | ")}`);
  return dev;
}
const bankEntry = (scenarioId: string) => {
  const found = scenarioDialogueSeedBank.find((entry) => entry.scenarioId === scenarioId);
  if (!found) throw new Error(`bank entry ${scenarioId} missing`);
  return found as unknown as { seeds: ReadonlyArray<{ seedId: string; actorId: string; spokenText?: string; caption?: string; safetyExpectation: string; utterancePhrases?: string[] }> };
};
async function ask(dev: Dev, scenarioId: string, seedId: string) {
  const seed = bankEntry(scenarioId).seeds.find((s) => s.seedId === seedId);
  if (!seed?.utterancePhrases?.[0]) throw new Error(`seed ${seedId} has no shipped phrase`);
  let latest: EncounterSnapshot | undefined;
  const learner = await connect(`ws://127.0.0.1:${dev.port}`, { roomOptions: { actors: [seed.actorId] } });
  conns.push(learner);
  learner.onState((s) => { latest = s; });
  await waitUntil(() => latest?.phase === "encounter", 10000, "encounter phase");
  expect(Object.keys(latest?.actors ?? {})).toContain(seed.actorId);
  expect(await learner.sendIntent("select-actor", { actorId: seed.actorId })).toMatchObject({ status: "ack" });
  // The first learner turn of a station plays the actor's opening; the shipped phrase is the second turn.
  for (const [text, replyId] of [["Hello, I am the student doctor.", `${seed.actorId}:opening`], [seed.utterancePhrases[0], `${seed.actorId}:seed:${seedId}`]] as const) {
    expect(await learner.sendIntent("utterance-start", {})).toMatchObject({ status: "ack" });
    expect(await learner.sendIntent("utterance-end", { text })).toMatchObject({ status: "ack" });
    await waitUntil(() => latest?.actors[seed.actorId]?.replyId === replyId, 8000, `reply ${replyId}`);
    if (replyId.endsWith(":opening")) await waitUntil(() => latest?.actors[seed.actorId]?.speaking !== true, 15000, "opening end");
  }
  return { seed, caption: latest?.actors[seed.actorId]?.caption ?? "" };
}

describe("xr-sync-server C35 dev stack casts shipped scenarios", () => {
  it("default env casts ed-chest, prints scenario ready before listening, and a typed phrase gets the authored line", async () => {
    const dev = await bootListening({});
    const readyAt = dev.out.findIndex((l) => l.startsWith(`xr-sync scenario ready id=${edChestPainScenario.scenarioId} actors=`));
    const listenAt = dev.out.findIndex((l) => l.startsWith("xr-sync listening"));
    expect(readyAt).toBeGreaterThanOrEqual(0);
    expect(readyAt).toBeLessThan(listenAt);
    const { seed, caption } = await ask(dev, edChestPainScenario.scenarioId, "patient_onset_history");
    expect(caption).toContain(seed.caption ?? seed.spokenText ?? "<missing>");
  }, 90000);

  it("XR_SYNC_SCENARIO selects another shipped scenario (knee) and answers from its seed bank entry", async () => {
    const dev = await bootListening({ XR_SYNC_SCENARIO: clinicKneePainScenario.scenarioId });
    expect(dev.out.some((l) => l.startsWith(`xr-sync scenario ready id=${clinicKneePainScenario.scenarioId} actors=`))).toBe(true);
    const { seed, caption } = await ask(dev, clinicKneePainScenario.scenarioId, "clinic_knee_rom_exam_on_learner_request");
    expect(caption).toContain(seed.caption ?? seed.spokenText ?? "<missing>");
  }, 90000);

  it("an unknown scenario id exits 1 with a named error, lists the known ids, and never listens", async () => {
    const started = Date.now();
    const dev = await spawnDev({ XR_SYNC_SCENARIO: "no_such_scenario_v9" });
    await waitUntil(() => dev.exitCode() !== undefined, 30000, "exit");
    expect(dev.exitCode()).toBe(1);
    const stderr = dev.err.join("\n");
    expect(stderr).toContain('xr-sync dev-server: unknown-scenario: "no_such_scenario_v9"');
    expect(stderr).toContain(edChestPainScenario.scenarioId);
    expect(dev.out.some((l) => l.startsWith("xr-sync listening"))).toBe(false);
    expect(Date.now() - started).toBeLessThan(30000);
  }, 40000);
});

describe("xr-sync-server C35 sidecar defaults", () => {
  it("the default probe timeout is 180000 ms (setTimeout compressed 1000x by a preload; the message keeps the requested value)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "c35-probe-"));
    dirs.push(dir);
    const silent = join(dir, "silent.cjs");
    await writeFile(silent, "process.stdin.resume();\n");
    const preload = join(dir, "compress.mjs");
    await writeFile(preload, `const real = globalThis.setTimeout;\nglobalThis.setTimeout = (fn, ms, ...rest) => real(fn, ms === 180000 ? 180 : ms, ...rest);\n`);
    const dev = await spawnDev({ XR_SYNC_STT: "on", XR_SYNC_STT_PYTHON: process.execPath, XR_SYNC_STT_SCRIPT: silent }, ["--import", preload]);
    await waitUntil(() => dev.out.some((l) => l.startsWith("xr-sync listening")), 60000, "listening after probe timeout");
    expect(dev.out.find((l) => l.startsWith("xr-sync speech "))).toBe("xr-sync speech unavailable: sidecar probe timed out after 180000 ms");
  }, 90000);

  it("the default sidecar python is repo-relative: no machine-local absolute asset path", async () => {
    const dev = await spawnDev({ XR_SYNC_STT: "on", XR_SYNC_STT_SCRIPT: "/nonexistent/stt.py" });
    await waitUntil(() => dev.out.some((l) => l.startsWith("xr-sync speech ")) || dev.exitCode() !== undefined, 60000, "speech line");
    const line = dev.out.find((l) => l.startsWith("xr-sync speech ")) ?? "";
    expect(line).not.toContain("/Volumes/files/openclinxr-assets");
    const defaultPython = `${REPO}/.openclinxr/stt/venv/bin/python`;
    // Where the repo-relative venv is absent the default must name it; where present, the script check is the next refusal.
    expect(line).toBe(existsSync(defaultPython) ? "xr-sync speech unavailable: missing script: /nonexistent/stt.py" : `xr-sync speech unavailable: missing python: ${defaultPython}`);
  }, 90000);
});
