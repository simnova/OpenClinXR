import {strict as assert} from "node:assert";
/** Source wiring guards the same real producer exercised by retained AV validation. */
export function assertCaptureOutputWiring(source){
 const start=source.indexOf("export async function captureAudibleLipSync(");
 assert(start>=0,"actual capture producer missing");
 const body=source.slice(start,source.indexOf("if (process.argv[1]",start));
 assert.match(body,/const\s*\{\s*packetRoot\s*,\s*latest\s*\}\s*=\s*resolveCaptureOutputPaths\(outputDirectory\)/,"selected output must enter actual producer");
 assert.match(body,/const\s+runDir\s*=\s*resolve\(packetRoot,\s*runId\)/,"actual run directory must consume selected root");
 assert.match(body,/writeFileSync\(latest,\s*reportBytes\)/,"actual report writer must consume selected latest path");
 assert.doesNotMatch(body,/const\s+latest\s*=\s*fixture\.proofReportPath/,"old report destination must not shadow selected output");
}
