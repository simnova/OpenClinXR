// tmpdir bases go through realpathSync(tmpdir()): on macOS os.tmpdir() sits under
// /var -> /private/var, and the root-down no-follow walk would refuse /var itself.
// Canonicalizing keeps every scratch path on real directories, so only a planted
// link (like the dangling L below) can trigger the symlink refusal.
import {it,expect} from "vitest";
import {spawnSync} from "node:child_process";
import {mkdirSync,mkdtempSync,rmSync,realpathSync,symlinkSync,writeFileSync} from "node:fs";
import {join} from "node:path";
import {homedir,tmpdir} from "node:os";
import fixture from "./fixture-manifest.mjs";
import {requireLipSyncFixture,assertNotUnderHomeDocs} from "./lip-sync-fixture-paths.mjs";
import {inspectArtifacts} from "./validate.mjs";

const manifestHref = new URL("./fixture-manifest.mjs", import.meta.url).href;
const helperHref = new URL("./lip-sync-fixture-paths.mjs", import.meta.url).href;

it("child with a missing store reports the exact missing message for every role without hanging",()=>{
  const base=mkdtempSync(join(realpathSync(tmpdir()),"hl-store-"));
  const fakeStore=join(base,"child-store-missing");
  const child=[
    `import fixture from ${JSON.stringify(manifestHref)};`,
    `import {requireLipSyncFixture} from ${JSON.stringify(helperHref)};`,
    `const roles=[["cuePath","cues"],["proofReportPath","proof-report"],["cdpProbeDir","cdp-probe"],["factoryProofReportPath","factory-proof-report"]];`,
    `for(const [field,role] of roles){try{requireLipSyncFixture(fixture[field],role);console.log("UNEXPECTED_PASS:"+field);}catch(e){console.log("MSG:"+e.message);}}`,
  ].join("\n");
  const result=spawnSync(process.execPath,["--input-type=module","--eval",child],{env:{...process.env,OPENCLINXR_LIPSYNC_STORE_ROOT:fakeStore},timeout:5000,encoding:"utf8"});
  expect(result.error).toBe(undefined);
  expect(result.status).not.toBe(null);
  const out=(result.stdout ?? "")+"\n"+(result.stderr ?? "");
  expect(out).toContain(`missing lip-sync fixture cues: ${fakeStore}/existing-rhubarb-demo/fresh-mouth-cues.json (store copy pending operator; see HANG-LIPSYNC)`);
  expect(out).toContain(`missing lip-sync fixture proof-report: ${fakeStore}/proof-output/latest-report.json (store copy pending operator; see HANG-LIPSYNC)`);
  expect(out).toContain(`missing lip-sync fixture cdp-probe: ${fakeStore}/browser-cdp-module-probe-1789613971918 (store copy pending operator; see HANG-LIPSYNC)`);
  expect(out).toContain(`missing lip-sync fixture factory-proof-report: ${fakeStore}/factory-proof-output/latest-report.json (store copy pending operator; see HANG-LIPSYNC)`);
  rmSync(base,{recursive:true,force:true});
});

it("a dangling planted symlink is refused before any existence check",()=>{
  const base=mkdtempSync(join(realpathSync(tmpdir()),"hl-link-"));
  const target=join(base,"dangling-target");
  const link=join(base,"L");
  symlinkSync(target,link);
  const via=join(link,"f");
  let message="";
  try{requireLipSyncFixture(via,"x");}catch(e){message=String(e.message ?? e);}
  expect(message.startsWith("refused lip-sync fixture x: ")).toBe(true);
  expect(message).toContain(`traverses a symlink at ${link}`);
  expect(message).not.toContain("missing lip-sync fixture");
  rmSync(base,{recursive:true,force:true});
});

it("a path under the home Documents tree is refused before any existence check",()=>{
  const docsProbe=join(homedir(),"Documents","nonexistent-probe-"+Date.now().toString(16));
  let message="";
  try{requireLipSyncFixture(docsProbe,"x");}catch(e){message=String(e.message ?? e);}
  expect(message.startsWith("refused lip-sync fixture x: ")).toBe(true);
  expect(message).toContain("is under $HOME/Documents");
  expect(message).not.toContain("missing lip-sync fixture");
});

it("an existing regular scratch file passes through unchanged",()=>{
  const base=mkdtempSync(join(realpathSync(tmpdir()),"hl-good-"));
  const file=join(base,"f.txt");
  writeFileSync(file,"ok");
  expect(requireLipSyncFixture(file,"x")).toBe(file);
  expect(assertNotUnderHomeDocs(file,"x")).toBe(undefined);
  rmSync(base,{recursive:true,force:true});
});

it("a scratch report naming a home Documents path is refused without touching it",()=>{
  const docsAbs=join(homedir(),"Documents","nonexistent-probe-"+Date.now().toString(16),"input.wav");
  const scratch=mkdtempSync(join(realpathSync(tmpdir()),"hl-scratch-"));
  let message="";
  try{inspectArtifacts({files:{inputWav:{path:docsAbs,sha256:"f".repeat(64)}},attempts:[]},scratch);}catch(e){message=String(e.message ?? e);}
  expect(message.startsWith("refused lip-sync fixture")).toBe(true);
  expect(message).toContain(docsAbs);
  expect(message).toContain("is under $HOME/Documents");
  expect(message).not.toContain("ENOENT");
  rmSync(scratch,{recursive:true,force:true});
});
