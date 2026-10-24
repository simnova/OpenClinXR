import { readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import type { Stage2Identity, Stage2Mode } from '@openclinxr/xr-capacity/stage2';
import { STAGE2_PROTOCOL_SHA256 } from '@openclinxr/xr-capacity/stage2';
import { sha } from './gateway.js';
export const PLAN_SHA256 = 'f8f7a20206ad19a3261eae1b40e1db88832eff27a4a4e144db3bfe6964fcb6f6';
export const ORDER: readonly Stage2Mode[] = ['uplink-only','relay-instead-of-independent-return','remote-output-disconnected','early-peer-close','positive'];
export const LAUNCH_FLAGS = ['--mute-audio','--disable-background-timer-throttling','--disable-renderer-backgrounding'];
export interface CampaignSlot {ordinal:number;mode:Stage2Mode;nonce:string;state:'UNSTARTED'}
export interface CampaignGo {
  schema:'quest-stage2-host-campaign-go.v1'; authorized:true; review:{path:string;sha256:string};
  campaignPlanSha256:string; protocolSha256:string; sourceManifestSha256:string;
  identity:Stage2Identity; workletSha256:string; evidenceDirectory:string;
  environment:{browser:{executablePath:string;version:string;launchFlags:string[]};runtime:{nodeVersion:string;pythonVersion:string;aiortcVersion:string;avVersion:string;aiohttpVersion:string}};
}
export interface Stage2Manifest {schema:string;identity:Stage2Identity;workletSha256:string;files:Record<string,string>;served:Record<string,string>}
const exact = isDeepStrictEqual;
export function assertCampaignGo(go:CampaignGo, manifest:Stage2Manifest, manifestHash:string, evidence:string) {
  if (go?.schema !== 'quest-stage2-host-campaign-go.v1' || go.authorized !== true) throw new Error('Explicit root campaign GO required; implementation-only release is not media GO');
  if (go.campaignPlanSha256 !== PLAN_SHA256 || go.protocolSha256 !== STAGE2_PROTOCOL_SHA256 || go.sourceManifestSha256 !== manifestHash || !exact(go.identity,manifest.identity) || go.workletSha256 !== manifest.workletSha256) throw new Error('GO plan/protocol/source identity mismatch');
  if (resolve(go.evidenceDirectory) !== resolve(evidence)) throw new Error('GO exact evidence directory mismatch');
  if (!go.review?.path || !/^[a-f0-9]{64}$/.test(go.review.sha256)) throw new Error('Independent review bytes must be bound');
  if (!go.environment?.browser?.executablePath || !go.environment.browser.version || !exact(go.environment.browser.launchFlags,LAUNCH_FLAGS) || go.environment.runtime.nodeVersion !== process.version) throw new Error('Fixed executable/runtime/launch flags mismatch');
}
export async function loadCampaign(planPath:string, goPath:string, manifestBytes:Uint8Array, evidence:string) {
  const planBytes=await readFile(planPath);if(sha(planBytes)!==PLAN_SHA256)throw new Error('Exact pre-minted campaign plan required');
  const plan=JSON.parse(planBytes.toString('utf8')) as {slots:CampaignSlot[]};
  if(plan.slots.length!==5||new Set(plan.slots.map(slot=>slot.nonce)).size!==5||plan.slots.some((slot,i)=>slot.ordinal!==i+1||slot.mode!==ORDER[i]||slot.state!=='UNSTARTED'))throw new Error('Five immutable slots/order required');
  const go=JSON.parse(await readFile(goPath,'utf8')) as CampaignGo, manifest=JSON.parse(Buffer.from(manifestBytes).toString('utf8')) as Stage2Manifest;
  assertCampaignGo(go,manifest,sha(manifestBytes),evidence);if(sha(await readFile(go.review.path))!==go.review.sha256)throw new Error('Independent review file changed');
  return {go,manifest,slots:plan.slots};
}

export async function claimCampaign(directory:string,receipt:unknown) {
  await writeFile(join(directory,'campaign-invocation.json'),`${JSON.stringify(receipt,null,2)}\n`,{flag:'wx'});
}
export async function claimSlot(directory:string,slot:CampaignSlot) {
  if(!/^[a-f0-9-]{36}$/.test(slot.nonce))throw new Error('Pre-minted UUID nonce required');
  await writeFile(join(directory,`${slot.nonce}.STARTED.json`),`${JSON.stringify({slot,at:new Date().toISOString()})}\n`,{flag:'wx'});
}
