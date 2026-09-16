import { inflateSync } from "node:zlib";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
export const assetHashes = {
  "mpfb-gown-adult-patient.glb": "8da37c5707958d7a4f8f8a89222d76ea6c0d3c2f18eb903d56c7f4d8727befcf",
  "mpfb-clinical-nurse-adult.glb": "8409334c30861e07d7bb180b2b8f7e5d48c277bc91c4a5df8f0cb0475869c541",
  "mpfb-family-partner-adult.glb": "ef2a4c0794d470fd649a18bf374f11778877693956b6cb0f12b7209a31ca6eb2",
};
const sources = ["face-rig.ts", "animation-loop.ts", "natural-blink-controller.ts"];
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const value of bytes) { crc ^= value; for (let i=0;i<8;i++) crc=(crc>>>1)^((crc&1)?0xedb88320:0); }
  return (crc ^ 0xffffffff) >>> 0;
}
function validPng(bytes) {
  try {
    if (!bytes || bytes.length < 2048 || !bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return false;
    let offset=8, width=0, height=0, channels=0, end=false, seenHeader=false; const data=[];
    while(offset+12<=bytes.length) {
      const length=bytes.readUInt32BE(offset), type=bytes.toString("ascii",offset+4,offset+8); if(offset+12+length>bytes.length) return false;
      const chunk=bytes.subarray(offset+4,offset+8+length); if(crc32(chunk)!==bytes.readUInt32BE(offset+8+length)) return false;
      if(offset===8 && (type!=="IHDR" || length!==13)) return false;
      if(type==="IHDR") { if(seenHeader) return false; seenHeader=true; width=bytes.readUInt32BE(offset+8); height=bytes.readUInt32BE(offset+12); const depth=bytes[offset+16], color=bytes[offset+17]; channels=color===6?4:color===2?3:0; if(depth!==8 || !channels || width<256 || height<256 || width>2048 || height>2048 || bytes[offset+18]!==0 || bytes[offset+19]!==0 || bytes[offset+20]!==0) return false; }
      if(type==="IDAT") data.push(bytes.subarray(offset+8,offset+8+length));
      offset+=length+12;
      if(type==="IEND") { if(length!==0 || offset!==bytes.length) return false; end=true; break; }
    }
    if(!end || !data.length || !width) return false;
    const size=(width*channels+1)*height; const decoded=inflateSync(Buffer.concat(data),{maxOutputLength:size}); if(decoded.length!==size) return false;
    for(let i=0;i<height;i++) if(decoded[i*(width*channels+1)]>4) return false;
    return true;
  } catch { return false; }
}

export function validateFacialReport(report, repoRoot = process.cwd()) {
  const errors = [];
  const require = (condition, message) => { if (!condition) errors.push(message); };
  const readBound = (record, label) => {
    try {
      if (typeof record?.path !== "string" || !record.path.startsWith("tools/openclinxr/evidence/natural-blink-emotion/runs/") || record.path.split("/").includes("..")) throw new Error("invalid portable path");
      const path = resolve(repoRoot, record.path);
      require(!relative(repoRoot, path).startsWith(".."), `${label}: path escapes repository`);
      const bytes = readFileSync(path);
      require(record.sha256 === hash(bytes), `${label}: hash mismatch`);
      return bytes;
    } catch { errors.push(`${label}: artifact missing or unreadable`); return null; }
  };
  require(report?.schemaVersion === 1, "schemaVersion must be 1");
  require(typeof report?.runId === "string" && report.runId.length > 8, "runId missing");
  require(/^[a-f0-9]{40}$/.test(report?.captureHead ?? ""), "captureHead missing");
  require(report?.renderer === "real-chromium-production-loop", "real production renderer required");
  for (const source of sources) {
    try {
      const bytes = readFileSync(resolve(repoRoot, "packages/openclinxr/xr-humanoid-animation/src", source));
      require(report.sourceSha256?.[source] === hash(bytes), `source identity mismatch: ${source}`);
      const historical = execFileSync("git", ["show", `${report.captureHead}:packages/openclinxr/xr-humanoid-animation/src/${source}`], { cwd: repoRoot, stdio: ["ignore", "pipe", "ignore"] });
      require(hash(historical) === report.sourceSha256?.[source], `execution source provenance mismatch: ${source}`);
    } catch { errors.push(`source missing: ${source}`); }
  }
  try { execFileSync("git", ["merge-base", "--is-ancestor", report.captureHead, "HEAD"], { cwd: repoRoot, stdio: "ignore" }); } catch { errors.push("capture head is not an ancestor of candidate"); }
  const cases = Array.isArray(report?.cases) ? report.cases : [];
  require(cases.length === 9, "exactly nine actor/context cases required");
  const keys = new Set();
  for (const c of cases) {
    const key = `${c.asset}:${c.context}`;
    require(!keys.has(key), `duplicate case: ${key}`); keys.add(key);
    require(Object.hasOwn(assetHashes, c.asset), `unsupported asset: ${c.asset}`);
    require(["idle", "speech", "authored-emotion"].includes(c.context), `unsupported context: ${c.context}`);
    try { require(hash(readFileSync(resolve(repoRoot, "apps/ui-xr/public/generated-humanoids", c.asset))) === assetHashes[c.asset], `shipped asset identity mismatch: ${key}`); } catch { errors.push(`shipped asset missing: ${key}`); }
    const bytes = readBound(c.raw, `raw ${key}`);
    let raw;
    try { raw = JSON.parse(bytes?.toString() ?? "null"); } catch { errors.push(`raw malformed: ${key}`); }
    if (!raw) continue;
    require(raw.runId === report.runId && raw.captureHead === report.captureHead && raw.asset === c.asset && raw.assetSha256 === assetHashes[c.asset] && raw.context === c.context, `raw identity mismatch: ${key}`);
    require(JSON.stringify(Object.entries(raw.sourceSha256 ?? {}).sort()) === JSON.stringify(Object.entries(report.sourceSha256 ?? {}).sort()), `raw source identity mismatch: ${key}`);
    require(JSON.stringify(raw.images) === JSON.stringify(c.images), `image manifest diverges from raw: ${key}`);
    require(raw.productionLoop === true && raw.syntheticClock === false, `synthetic or missing production observation: ${key}`);
    require(typeof raw.geometryRevision === "string" && raw.geometryRevision.length > 0, `geometry identity missing: ${key}`);
    const frames = Array.isArray(raw.frames) ? raw.frames : [];
    require(frames.length >= 300, `insufficient measured frames: ${key}`);
    let previous = -Infinity, cycles = 0, closedAt = null;
    for (const f of frames) {
      require(Number.isFinite(f.timeMs) && f.timeMs > previous && (previous === -Infinity || f.timeMs - previous <= 50), `non-monotonic frame time: ${key}`); previous = f.timeMs;
      require([f.leftClosure, f.rightClosure].every((v) => Number.isFinite(v) && v >= 0 && v <= 1), `closure bounds: ${key}`);
      require(["neutral","anxious","concerned","reassured","pain"].includes(f.emotion) && Number.isFinite(f.browDelta) && f.browDelta >= 0 && f.browDelta <= 1 && Number.isFinite(f.visemeAmplitude) && f.visemeAmplitude >= 0 && f.visemeAmplitude <= 1, `invalid facial composition measurement: ${key}`);
      require(f.faceVisible === true, `face occluded or cropped: ${key}`);
      require(Number.isFinite(f.rootTransformDelta) && f.rootTransformDelta <= 1e-6, `facial root transform changed: ${key}`);
      if (f.leftClosure >= 0.8 && f.rightClosure >= 0.8 && closedAt === null) {
        closedAt = f.timeMs;
        require([f.leftLidVertexDelta,f.rightLidVertexDelta].every((value) => Number.isFinite(value) && value >= 0.001), `no actual lid displacement: ${key}`);
      }
      if (closedAt !== null && f.leftClosure <= 0.05 && f.rightClosure <= 0.05) {
        require(f.timeMs - closedAt <= 500, `lid did not promptly reopen: ${key}`); cycles++; closedAt = null;
      }
    }
    require(frames.length > 1 && frames.at(-1).timeMs - frames[0].timeMs >= 30000, `thirty-second observation required: ${key}`);
    require(cycles >= 3 && cycles <= 12, `measured blink cycle bounds: ${key}`);
    require(closedAt === null, `observation ends with closed lids: ${key}`);
    if (c.context === "speech") require(frames.some((f) => f.visemeAmplitude > 0 && f.leftClosure <= 0.05 && f.rightClosure <= 0.05), `speech articulation absent: ${key}`);
    if (c.context === "authored-emotion") {
      require(frames.some((f) => f.emotion !== "neutral" && f.browDelta > 0), `authored emotion absent: ${key}`);
      require(frames.at(-1)?.emotion === "neutral" && frames.at(-1)?.browDelta <= 0.001, `bounded emotion recovery absent: ${key}`);
    }
    require(Array.isArray(c.images) && c.images.length >= 3, `open/closed/reopened images required: ${key}`);
    for (const image of c.images ?? []) {
      const png = readBound(image, `image ${key}`);
      require(validPng(png), `valid framed PNG required: ${key}`);
      const frame = frames.find((f) => f.timeMs === image.frameTimeMs);
      require(Boolean(frame), `image frame not in raw timeline: ${key}`);
      if (frame) require(image.phase === "closed" ? frame.leftClosure >= 0.8 && frame.rightClosure >= 0.8 : frame.leftClosure <= 0.05 && frame.rightClosure <= 0.05, `image phase contradicts measured closure: ${key}`);
    }
    require(new Set((c.images ?? []).map((image) => image.sha256)).size === (c.images ?? []).length, `identical image phases: ${key}`);
    const times = ["open", "closed", "reopened"].map((phase) => c.images?.find((image) => image.phase === phase)?.frameTimeMs);
    require(times.every(Number.isFinite) && times[0] < times[1] && times[1] < times[2], `ordered image triple required: ${key}`);
    require(["open", "closed", "reopened"].every((phase) => c.images?.some((i) => i.phase === phase)), `image phases missing: ${key}`);
  }
  for (const asset of Object.keys(assetHashes)) for (const context of ["idle", "speech", "authored-emotion"]) require(keys.has(`${asset}:${context}`), `missing actor/context: ${asset}:${context}`);
  // This is evidence integrity, not perceptual grading. Owner independently inspects the images before Landed.
  return { ok: errors.length === 0, errors };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = validateFacialReport(JSON.parse(readFileSync("tools/openclinxr/evidence/natural-blink-emotion/report.json", "utf8")));
    console.log(JSON.stringify(result)); process.exitCode = result.ok ? 0 : 1;
  } catch (error) { console.error(`facial report unavailable: ${error.message}`); process.exitCode = 1; }
}
