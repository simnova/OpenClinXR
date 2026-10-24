import {createHash} from 'node:crypto';
import {controllerDeadline} from './cleanup.js';
interface AdmissionSession {send(method:'Target.getTargetInfo'):Promise<{targetInfo:{targetId:string;type:string;url:string}}>;detach():Promise<void>}
export interface ControllerSourceAdmission {
 schema:'quest-controller-source-admission.v1';actualFetchedBundleSha256:string;expectedBundleSha256:string;sourceManifestSha256:string;
 nonce:string;purpose:'readiness'|'cohort';mode:'OFF'|'ON';slot:number|null;ownedTargetId:string;ownedUrlSha256:string;processId:number;
}
export interface ControllerAdmissionOptions {
 newSession():Promise<AdmissionSession>;actualUrl():string;expectedUrl:string;actualFetchedBundleSha256:string;expectedBundleSha256:string;
 sourceManifestSha256:string;nonce:string;purpose:'readiness'|'cohort';mode:'OFF'|'ON';slot:number|null;processId:number;persist(receipt:ControllerSourceAdmission):Promise<void>;
}
/** Pre-entry only: exactly the owned page, no enumeration/polling; failure cannot admit XR. */
export async function persistControllerSourceAdmission(options:ControllerAdmissionOptions):Promise<void>{
 const hash=/^[a-f0-9]{64}$/;if(!hash.test(options.actualFetchedBundleSha256)||options.actualFetchedBundleSha256!==options.expectedBundleSha256||!hash.test(options.sourceManifestSha256)||!Number.isSafeInteger(options.processId)||options.processId<=0)throw Error('Invalid source-admission binding');
 const url=options.actualUrl(),parsed=new URL(url);if(url!==new URL(options.expectedUrl).href||parsed.searchParams.get('nonce')!==options.nonce||parsed.searchParams.get('purpose')!==options.purpose||parsed.searchParams.get('mode')!==options.mode||parsed.searchParams.get('slot')!==(options.slot===null?null:String(options.slot)))throw Error('Owned page URL/source-admission mismatch');
 const opening=options.newSession();let session:AdmissionSession|undefined,abandoned=false,receipt:ControllerSourceAdmission|undefined;
 // A constructor resolving after its bound must detach, never continue to capture or entry.
 void opening.then(late=>{if(abandoned)void controllerDeadline(late.detach(),1500,'Late owned CDP detach').catch(()=>undefined);},()=>undefined);
 try{
  session=await controllerDeadline(opening,1500,'Owned CDP creation');
  const {targetInfo}=await controllerDeadline(session.send('Target.getTargetInfo'),1500,'Owned target capture');
  if(typeof targetInfo.targetId!=='string'||!targetInfo.targetId.trim()||targetInfo.targetId.length>256||targetInfo.type!=='page'||targetInfo.url!==url||options.actualUrl()!==url)throw Error('Owned target identity mismatch');
  receipt={schema:'quest-controller-source-admission.v1',actualFetchedBundleSha256:options.actualFetchedBundleSha256,expectedBundleSha256:options.expectedBundleSha256,sourceManifestSha256:options.sourceManifestSha256,nonce:options.nonce,purpose:options.purpose,mode:options.mode,slot:options.slot,ownedTargetId:targetInfo.targetId,ownedUrlSha256:createHash('sha256').update(url).digest('hex'),processId:options.processId};
 }finally{abandoned=true;if(session)await controllerDeadline(session.detach(),1500,'Owned CDP detach');}
 if(!receipt)throw Error('Source-admission receipt unavailable');await controllerDeadline(options.persist(receipt),1500,'Source-admission persistence');
}
