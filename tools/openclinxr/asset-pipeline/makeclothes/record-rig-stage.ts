// Record writer for registered rig stages (FINALIZE-RIG-STAGE); finalize is its only caller.
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

function fail(why: string): never {
  console.error(`record-rig-stage: refusing: ${why}`);
  process.exit(2);
}
const args = process.argv.slice(2);
const at = (f: string): string => {
  const i = args.indexOf(f);
  if (i < 0 || args[i + 1] === undefined) { console.error("usage: record-rig-stage.ts --sidecar <p> --post <glb> --tool <t> --argv-json <json>"); process.exit(2); }
  return args[i + 1] as string;
};
const sidecarPath = at("--sidecar"); const postPath = at("--post"); const tool = at("--tool");
let argv: unknown;
try { argv = JSON.parse(at("--argv-json")); } catch { fail("argv-json unparsable"); }
if (!Array.isArray(argv) || argv.some((w) => typeof w !== "string")) fail("argv-json must be a string array");
const postBytes = readFileSync(postPath);
const postSha = createHash("sha256").update(postBytes).digest("hex");
let doc: unknown;
try { doc = JSON.parse(readFileSync(sidecarPath, "utf8")); } catch { fail(`sidecar unreadable (${sidecarPath})`); }
const lineage = (doc as { byteLineage?: unknown }).byteLineage;
if (typeof lineage !== "object" || lineage === null) fail("sidecar carries no byteLineage to record on");
const rec = lineage as { derivationArgv?: unknown; outputSha256?: unknown; stageRecord?: unknown };
if (!(argv as string[]).includes(tool)) fail(`stage argv names no ${tool} level; refusing to invent one`);
rec.derivationArgv = argv;
const st = lstatSync(sidecarPath);
if (st.isSymbolicLink() || st.nlink > 1) fail(`sidecar is a symlink or hard-linked (${sidecarPath})`);
rec.outputSha256 = postSha;
const top = doc as { outputSha256?: unknown; outputBytes?: unknown };
top.outputSha256 = postSha; top.outputBytes = postBytes.byteLength;
rec.stageRecord = { ...(typeof rec.stageRecord === "object" && rec.stageRecord !== null ? rec.stageRecord as Record<string, unknown> : {}), rigStage: { tool, argv, postSha256: postSha, postBytes: postBytes.byteLength } };
const tmp = path.join(path.dirname(sidecarPath), `.rig-stage-${process.pid}.tmp`);
try {
  writeFileSync(tmp, `${JSON.stringify(doc, null, 1)}\n`);
  renameSync(tmp, sidecarPath);
} catch (e) { try { unlinkSync(tmp); } catch { /* already gone */ } throw e; }
console.log(JSON.stringify({ recorded: sidecarPath, tool, postSha256: postSha }));
