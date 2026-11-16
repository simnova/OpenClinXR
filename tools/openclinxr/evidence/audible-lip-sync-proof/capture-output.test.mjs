import {it,expect} from "vitest";
import {resolve,sep} from "node:path";
import {tmpdir,homedir} from "node:os";
import fixture from "./fixture-manifest.mjs";
import {resolveCaptureOutputPaths} from "./capture.mjs";
const homeDocs=homedir()+sep+"Documents";
it("default output resolves to a fresh scratch directory under the OS temp root",()=>{
  const selected=resolveCaptureOutputPaths();
  expect(selected.latest).toBe(resolve(selected.packetRoot,"latest-report.json"));
  expect(selected.packetRoot.startsWith(tmpdir())).toBe(true);
  expect(selected.packetRoot.startsWith(homeDocs)).toBe(false);
  expect(selected.latest).not.toBe(fixture.proofReportPath);
});
it("an explicit NEW output directory changes both actual run root and latest report",()=>{
  const directory=resolve("/private/tmp/owner-new-capture-output");
  const selected=resolveCaptureOutputPaths(directory);
  expect(selected).toEqual({packetRoot:directory,latest:resolve(directory,"latest-report.json")});
  expect(selected.latest).not.toBe(fixture.proofReportPath);
});
