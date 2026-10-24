import type {Stage2RunRecord,Stage2RunRelease} from "../grading/types.js";
import type {Stage2Budget} from './budget.js';
/** Called directly by one trusted Start click; no capture, immersive API or external service. */
export interface Stage2MediaOptions {
 release:Stage2RunRelease;gatewayOrigin:string;workletUrl:string;expectedWorkletSha256:string;
 driverStartedMs:number;signal:AbortSignal;onUpdate?:(record:Readonly<Stage2RunRecord>)=>void;
 /** Synchronous ownership receipt only; export starts after factory resolution. Never an audit reconstruction. */
 onOwnerTransfer?:(actualBudget:Stage2Budget)=>void;
}
