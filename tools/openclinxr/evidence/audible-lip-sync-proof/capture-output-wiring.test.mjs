import {it,expect} from "vitest";
import {readFileSync} from "node:fs";
import {execFileSync} from "node:child_process";
import {assertCaptureOutputWiring} from "./capture-output-wiring.mjs";
it("actual producer consumes selected root and latest path without old-destination shadow",()=>{
 expect(()=>assertCaptureOutputWiring(readFileSync(new URL("./capture.mjs",import.meta.url),"utf8"))).not.toThrow();
});
it("same wiring assertion refuses real callable-helper-but-unconsumed owner RED baseline",()=>{
 const old=execFileSync("git",["show","4acac11e4071e3aa24533a31a24744ed20c8c0d5:tools/openclinxr/evidence/audible-lip-sync-proof/capture.mjs"],{encoding:"utf8"});
 expect(old).toContain("export function resolveCaptureOutputPaths");
 expect(()=>assertCaptureOutputWiring(old)).toThrow("selected output must enter actual producer");
});
