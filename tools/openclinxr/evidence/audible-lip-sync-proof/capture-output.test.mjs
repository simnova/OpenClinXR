import {it,expect} from "vitest";
import {resolve,dirname} from "node:path";
import fixture from "./fixture-manifest.mjs";
import {resolveCaptureOutputPaths} from "./capture.mjs";
it("historical default output still resolves exact frozen fixture report",()=>{
 expect(resolveCaptureOutputPaths()).toEqual({packetRoot:dirname(fixture.proofReportPath),latest:fixture.proofReportPath});
});
it("an explicit NEW output directory changes both actual run root and latest report",()=>{
 const directory=resolve("/private/tmp/owner-new-capture-output");
 const selected=resolveCaptureOutputPaths(directory);
 expect(selected).toEqual({packetRoot:directory,latest:resolve(directory,"latest-report.json")});
 expect(selected.packetRoot).not.toBe(dirname(fixture.proofReportPath));
 expect(selected.latest).not.toBe(fixture.proofReportPath);
});
