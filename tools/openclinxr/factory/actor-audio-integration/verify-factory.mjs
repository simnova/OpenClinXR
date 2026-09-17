/** Read retained results: this factory verifier never records or rewrites an AV attempt. */
import {createHash} from "node:crypto";
import {inspectExecutedModules} from "../../evidence/audible-lip-sync-proof/executed-module-integrity.mjs";
import {reproduceViteModules} from "../../evidence/audible-lip-sync-proof/reproduce-vite-modules.mjs";
import {execFileSync} from "node:child_process";
import {realpathSync,existsSync,readFileSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {assertCaptureOutputWiring} from "../../evidence/audible-lip-sync-proof/capture-output-wiring.mjs";
const args=process.argv.slice(2);
if(args.length!==2 || args[0]!=="--tree") throw new Error("explicit --tree required");
const tree=realpathSync(resolve(args[1]));
const root=realpathSync(execFileSync("git",["rev-parse","--show-toplevel"],{cwd:tree,encoding:"utf8"}).trim());
if(tree!==root) throw new Error("tree must be exact worktree root");
const gitDir=realpathSync(resolve(tree,execFileSync("git",["rev-parse","--git-dir"],{cwd:tree,encoding:"utf8"}).trim()));
const commonDir=realpathSync(resolve(tree,execFileSync("git",["rev-parse","--git-common-dir"],{cwd:tree,encoding:"utf8"}).trim()));
if(gitDir===commonDir) throw new Error("isolated worktree required");
const ownRoot=realpathSync(resolve(dirname(fileURLToPath(import.meta.url)),"../../../.."));
if(tree!==ownRoot) throw new Error("verifier module must belong to explicit selected tree");
assertCaptureOutputWiring(readFileSync(resolve(tree,"tools/openclinxr/evidence/audible-lip-sync-proof/capture.mjs"),"utf8"));
function run(binary,argv,env=process.env){execFileSync(binary,argv,{cwd:tree,env,stdio:"inherit"});}
run("node",["tools/openclinxr/factory/actor-audio-integration/verify-regression-plant.mjs","--fixed"]);
run("node",["tools/openclinxr/evidence/audible-lip-sync-proof/verify-plant.mjs"]);
run("pnpm",["exec","vitest","run","tools/openclinxr/evidence/audible-lip-sync-proof","tools/openclinxr/factory/actor-audio-integration/ordinary-turn-and-cue-authority.test.ts","--exclude","tools/openclinxr/evidence/audible-lip-sync-proof/capture.test.mjs"],{...process.env,NODE_ENV:"test"});
const report="/Users/patrick/Documents/Codex/2026-09-08/referenced-chatgpt-conversation-this-is-an/openclinxr-lip-sync-consultation-2026-09-16/execution-packet/factory-proof-output/latest-report.json";
if(!existsSync(report)) throw new Error("fresh retained factory AV report missing");
run("node",["tools/openclinxr/evidence/audible-lip-sync-proof/validate.mjs",report],{...process.env,NODE_ENV:"test"});
const fresh=JSON.parse(readFileSync(report,"utf8"));
const dataPath="apps/ui-xr/src/prepared-actor-audio-data.ts";
const dataBindings=(fresh.sourceBindings??[]).filter(row=>row.role==="preparedData");
const dataHash=createHash("sha256").update(readFileSync(resolve(tree,dataPath))).digest("hex");
if(dataBindings.length!==1 || dataBindings[0].path!==dataPath || dataBindings[0].sha256!==dataHash)
  throw new Error("required current preparedData source binding");
const reproduced=await reproduceViteModules(tree,fresh.executedModules,fresh.buildMetadata);
const dataErrors=inspectExecutedModules(fresh.executedModules,dirname(report),tree,[dataPath],reproduced);
if(dataErrors.length) throw new Error("preparedData executed witness: "+dataErrors.join(","));
console.log(JSON.stringify({treeRoot:tree,scope:"ordinary-dialogue-and-local-private-audible-clock-integrity",notTested:["physical-output-sync","phonetic-perceptual-sync","voice-recording-rights","case-artifact-admission"]}));
