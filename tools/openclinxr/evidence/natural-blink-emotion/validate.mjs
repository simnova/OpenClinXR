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
export function validateFacialReport(report, repoRoot = process.cwd()) {
  const errors = [];
  const require = (condition, message) => { if (!condition) errors.push(message); };
  const readBound = (record, label) => {
    try {
      require(typeof record?.path === "string" && record.path.startsWith("tools/openclinxr/evidence/natural-blink-emotion/runs/"), `${label}: portable tracked run path required`);
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
    } catch { errors.push(`source missing: ${source}`); }
  }
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
    require(raw.productionLoop === true && raw.syntheticClock === false, `synthetic or missing production observation: ${key}`);
    require(typeof raw.geometryRevision === "string" && raw.geometryRevision.length > 0, `geometry identity missing: ${key}`);
    const frames = Array.isArray(raw.frames) ? raw.frames : [];
    require(frames.length >= 300, `insufficient measured frames: ${key}`);
    let previous = -Infinity, cycles = 0, closedAt = null;
    for (const f of frames) {
      require(Number.isFinite(f.timeMs) && f.timeMs > previous, `non-monotonic frame time: ${key}`); previous = f.timeMs;
      require([f.leftClosure, f.rightClosure].every((v) => Number.isFinite(v) && v >= 0 && v <= 1), `closure bounds: ${key}`);
      require(f.faceVisible === true, `face occluded or cropped: ${key}`);
      require(Number.isFinite(f.rootTransformDelta) && f.rootTransformDelta <= 1e-6, `facial root transform changed: ${key}`);
      if (f.leftClosure >= 0.8 && f.rightClosure >= 0.8 && closedAt === null) {
        closedAt = f.timeMs;
        require(f.leftLidVertexDelta > 0 && f.rightLidVertexDelta > 0, `no actual lid displacement: ${key}`);
      }
      if (closedAt !== null && f.leftClosure <= 0.05 && f.rightClosure <= 0.05) {
        require(f.timeMs - closedAt <= 500, `lid did not promptly reopen: ${key}`); cycles++; closedAt = null;
      }
    }
    require(frames.length > 1 && frames.at(-1).timeMs - frames[0].timeMs >= 30000, `thirty-second observation required: ${key}`);
    require(cycles >= 3 && cycles <= 25, `measured blink cycle bounds: ${key}`);
    require(closedAt === null, `observation ends with closed lids: ${key}`);
    if (c.context === "speech") require(frames.some((f) => f.visemeAmplitude > 0), `speech articulation absent: ${key}`);
    if (c.context === "authored-emotion") {
      require(frames.some((f) => f.emotion !== "neutral" && f.browDelta > 0), `authored emotion absent: ${key}`);
      require(frames.at(-1)?.emotion === "neutral", `bounded emotion recovery absent: ${key}`);
    }
    require(Array.isArray(c.images) && c.images.length >= 3, `open/closed/reopened images required: ${key}`);
    for (const image of c.images ?? []) readBound(image, `image ${key}`);
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
