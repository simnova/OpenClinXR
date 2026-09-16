import { deflateSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { assetHashes, validateFacialReport } from "./validate.mjs";
const root = mkdtempSync(join(tmpdir(), "facial-validator-fixture-"));
after(() => rmSync(root, { recursive: true, force: true }));
const sha = (v) => createHash("sha256").update(v).digest("hex");
const put = (path, bytes) => { const full = join(root, path); mkdirSync(join(full, ".."), { recursive: true }); writeFileSync(full, bytes); return { path, sha256: sha(bytes) }; };

function crc32(bytes) {let c=0xffffffff; for(const b of bytes){c^=b;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}return(c^0xffffffff)>>>0;}
function chunk(type,data) {const bytes=Buffer.concat([Buffer.from(type),data]);const length=Buffer.alloc(4);length.writeUInt32BE(data.length);const crc=Buffer.alloc(4);crc.writeUInt32BE(crc32(bytes));return Buffer.concat([length,bytes,crc]);}
function pngFixture(seed){const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(256);ihdr.writeUInt32BE(256,4);ihdr[8]=8;ihdr[9]=2;const pixels=Buffer.alloc((256*3+1)*256);let state=seed;for(let y=0;y<256;y++){for(let x=1;x<=768;x++){state=(Math.imul(state,1664525)+1013904223)>>>0;pixels[y*769+x]=state>>>24;}}return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk("IHDR",ihdr),chunk("IDAT",deflateSync(pixels)),chunk("IEND",Buffer.alloc(0))]);}
const pngs=[1,2,3].map(pngFixture);

const report = { schemaVersion: 1, runId: "explicit-validator-test-fixture", captureHead: "a".repeat(40), renderer: "real-chromium-production-loop", sourceSha256: {}, cases: [] };
for (const source of ["face-rig.ts", "animation-loop.ts", "natural-blink-controller.ts"]) {
  const bytes = Buffer.from("fixture source bytes"); put(`packages/openclinxr/xr-humanoid-animation/src/${source}`, bytes); report.sourceSha256[source] = sha(bytes);
}
execFileSync("git", ["init", "-q"], { cwd: root });
execFileSync("git", ["add", "packages"], { cwd: root });
execFileSync("git", ["-c", "user.name=Validator Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-q", "-m", "explicit fixture source"], { cwd: root });
report.captureHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
for (const asset of Object.keys(assetHashes)) {
  const dest = join(root, "apps/ui-xr/public/generated-humanoids", asset); mkdirSync(join(dest, ".."), { recursive: true }); copyFileSync(join(process.cwd(), "apps/ui-xr/public/generated-humanoids", asset), dest);
  for (const context of ["idle", "speech", "authored-emotion"]) {
    const frames = Array.from({ length: 601 }, (_, i) => ({ timeMs: i * 50, leftClosure: [80,280,480].includes(i) ? 1 : 0, rightClosure: [80,280,480].includes(i) ? 1 : 0, leftLidVertexDelta: 0.005, rightLidVertexDelta: 0.005, faceVisible: true, rootTransformDelta: 0, visemeAmplitude: context === "speech" ? 0.5 : 0, emotion: context === "authored-emotion" && i > 20 && i < 200 ? "pain" : "neutral", browDelta: context === "authored-emotion" && i > 20 && i < 200 ? 0.1 : 0 }));
    const raw = { runId: report.runId, captureHead: report.captureHead, asset, assetSha256: assetHashes[asset], context, productionLoop: true, syntheticClock: false, geometryRevision: "fixture-geometry", frames };
    const prefix = `tools/openclinxr/evidence/natural-blink-emotion/runs/fixture/${asset}-${context}`;
    const images = ["open", "closed", "reopened"].map((phase, index) => {
      // Valid synthetic PNG fixture, explicitly not a humanoid render or perceptual proof.
      const png = pngs[index];
      return { ...put(`${prefix}/${phase}.png`, png), phase, frameTimeMs: [3950,4000,4050][index] };
    });
    raw.images = images; raw.sourceSha256 = report.sourceSha256;
    report.cases.push({ asset, context, raw: put(`${prefix}/raw.json`, Buffer.from(JSON.stringify(raw))), images });
  }
}
const clone = () => structuredClone(report);
test("complete explicit fixture passes the production evidence validator", () => assert.deepEqual(validateFacialReport(report, root), { ok: true, errors: [] }));
test("report-only context forgery over unchanged raw evidence is rejected by identity", () => { const r=clone(); r.cases[0].context="speech"; const v=validateFacialReport(r,root); assert.equal(v.ok,false); assert.ok(v.errors.some((e)=>e.includes("raw identity mismatch"))); });
test("raw hash forgery is rejected by name", () => { const r=clone(); r.cases[0].raw.sha256="0".repeat(64); assert.ok(validateFacialReport(r,root).errors.some((e)=>e.includes("raw")&&e.includes("hash mismatch"))); });
test("missing screenshot evidence is rejected by name", () => { const r=clone(); r.cases[0].images[0].path="tools/openclinxr/evidence/natural-blink-emotion/runs/missing.png"; assert.ok(validateFacialReport(r,root).errors.some((e)=>e.includes("image")&&e.includes("artifact missing"))); });
test("source identity mutation and duplicate actor/context are rejected", () => { const r=clone(); r.sourceSha256["face-rig.ts"]="0".repeat(64); r.cases[1]=r.cases[0]; const v=validateFacialReport(r,root); assert.equal(v.ok,false); assert.ok(v.errors.some((e)=>e.includes("source identity mismatch"))); assert.ok(v.errors.some((e)=>e.includes("duplicate case"))); });

test("report-only screenshot reassignment over unchanged raw is rejected", () => { const r=clone(); r.cases[0].images[0]=r.cases[0].images[2]; assert.ok(validateFacialReport(r,root).errors.some((e)=>e.includes("image manifest diverges from raw"))); });
test("non-ancestor execution identity is rejected by name", () => { const r=clone(); r.captureHead="f".repeat(40); assert.ok(validateFacialReport(r,root).errors.includes("capture head is not an ancestor of candidate")); });

function mutateRaw(mutator, message) {const r=clone();const path=join(root,r.cases[0].raw.path), saved=readFileSync(path);try{const raw=JSON.parse(saved);mutator(raw,r.cases[0]);const bytes=Buffer.from(JSON.stringify(raw));writeFileSync(path,bytes);r.cases[0].raw.sha256=sha(bytes);const result=validateFacialReport(r,root);assert.equal(result.ok,false);assert.ok(result.errors.some((e)=>e.includes(message)),JSON.stringify(result));}finally{writeFileSync(path,saved);}}
test("zero and infinitesimal lid displacement fail the named actual-motion gate",()=>{for(const delta of [0,1e-15])mutateRaw((raw)=>{for(const f of raw.frames){f.leftLidVertexDelta=delta;f.rightLidVertexDelta=delta;}},"no actual lid displacement");});
test("synthetic clock is rejected even with internally consistent raw hashes",()=>mutateRaw((raw)=>{raw.syntheticClock=true;},"synthetic or missing production observation"));
test("identical valid PNG phases cannot claim a blink",()=>mutateRaw((raw,c)=>{const replacement={...c.images[0],phase:"closed",frameTimeMs:4000};c.images[1]=replacement;raw.images=c.images;},"identical image phases"));
test("header-only PNG cannot stand in for a screenshot",()=>{const path=join(root,report.cases[0].images[0].path),saved=readFileSync(path);try{const bytes=Buffer.alloc(24);Buffer.from([137,80,78,71,13,10,26,10]).copy(bytes);bytes.writeUInt32BE(960,16);bytes.writeUInt32BE(720,20);writeFileSync(path,bytes);const r=clone();r.cases[0].images[0].sha256=sha(bytes);assert.ok(validateFacialReport(r,root).errors.some((e)=>e.includes("valid framed PNG required")));}finally{writeFileSync(path,saved);}});
