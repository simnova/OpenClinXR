import type {ReservationAudit} from '../grading/types.js';
import {STAGE2_CONFIG} from '../grading/config.js';
export const STAGE2_BROWSER_RESERVATION=STAGE2_CONFIG.bounds.ownerReservationBytes.browser;
export const STAGE2_CLOSE_HEADROOM=32768;
export const STAGE2_RETAINED_HISTORY_KEYS=['history:generator','history:monitor','history:uplink-decoded','history:downlink-source'] as const;
export class Stage2BudgetError extends Error {}

/** Exact UTF-8 JSON length without creating the encoded string/buffer first. JSON DTOs only. */
export function stage2JsonBytes(value:unknown):number {
 if(value===undefined)throw new Stage2BudgetError('JSON DTO required');
 const seen=new Set<object>();let nodes=0;
 function stringBytes(s:string):number {let n=2;for(let i=0;i<s.length;i++){const c=s.charCodeAt(i);if(c===34||c===92||[8,9,10,12,13].includes(c))n+=2;else if(c<32)n+=6;else if(c<128)n++;else if(c<2048)n+=2;else if(c>=0xd800&&c<=0xdbff){const next=s.charCodeAt(i+1);if(next>=0xdc00&&next<=0xdfff){n+=4;i++;}else n+=6;}else if(c>=0xdc00&&c<=0xdfff)n+=6;else n+=3;}return n;}
 function walk(v:unknown,depth:number):number {if(depth>32||++nodes>100000)throw new Stage2BudgetError('budget-exhausted JSON shape');if(v===null||v===undefined)return 4;if(typeof v==='string')return stringBytes(v);if(typeof v==='boolean')return v?4:5;if(typeof v==='number')return Number.isFinite(v)?String(v).length:4;if(typeof v!=='object')throw new Stage2BudgetError('unsupported JSON value');if(seen.has(v))throw new Stage2BudgetError('cyclic JSON value');seen.add(v);let n=2;if(Array.isArray(v)){for(let i=0;i<v.length;i++)n+=(i?1:0)+walk(v[i],depth+1);}else{if(Object.getPrototypeOf(v)!==Object.prototype&&Object.getPrototypeOf(v)!==null)throw new Stage2BudgetError('JSON DTO required');let count=0;for(const key of Object.keys(v)){const entry=(v as Record<string,unknown>)[key];if(entry===undefined)continue;n+=(count++?1:0)+stringBytes(key)+1+walk(entry,depth+1);}}seen.delete(v);return n;}
 return walk(value,0);
}

/** Nonborrowable browser owner. A refused reservation never changes retained earlier claims. */
export class Stage2Budget {
 private claims=new Map<string,{category:string;bytes:number;kind:'retained'|'temporary'}>();private current=0;private peak=0;private categories:Record<string,number>={};private rejected=0;private sealed=false;private heldAtSeal:number|null=null;private exhausted=false;
 constructor(readonly limitBytes:number=STAGE2_BROWSER_RESERVATION,readonly closeHeadroom:number=STAGE2_CLOSE_HEADROOM){}
 claim(key:string,category:string,bytes:number,closing=false):void {this.admit(key,category,bytes,'retained',closing);}
 /** Read-only working copies may be leased after retention closes; no history reopen/reset. */
 lease(key:string,category:'control'|'serialization',bytes:number,closing=false):void {this.admit(key,category,bytes,'temporary',closing);}
 private admit(key:string,category:string,bytes:number,kind:'retained'|'temporary',closing:boolean):void {
  const old=this.claims.get(key),next=this.current-(old?.bytes??0)+bytes;
  const temporary=kind==='temporary',limit=closing||this.sealed&&temporary?this.limitBytes:this.limitBytes-this.closeHeadroom;
  if(this.sealed&&!temporary||old&&old.kind!==kind||(!closing&&!this.sealed&&this.exhausted)||!Number.isSafeInteger(bytes)||bytes<0||!Number.isSafeInteger(next)||next>limit){this.rejected++;this.exhausted=true;throw new Stage2BudgetError(`budget-exhausted browser ${key}`);}
  this.claims.set(key,{category,bytes,kind});this.current=next;this.peak=Math.max(this.peak,next);let categoryBytes=0;for(const c of this.claims.values())if(c.category===category)categoryBytes+=c.bytes;this.categories[category]=Math.max(this.categories[category]??0,categoryBytes);
 }
 json(key:string,category:string,value:unknown,closing=false):void {this.claim(key,category,stage2JsonBytes(value),closing);}
 append(key:string,category:string,value:unknown,closing=false):void {this.claim(key,category,(this.claims.get(key)?.bytes??0)+stage2JsonBytes(value)+1,closing);}
 release(key:string):void {const old=this.claims.get(key);if(old){this.current-=old.bytes;this.claims.delete(key);}}
 /** Only durable-ACK callers may shrink an existing sealed canonical history claim. */
 releaseRetainedBytes(key:string,bytes:number):void {
  const old=this.claims.get(key);
  if(!this.sealed||!STAGE2_RETAINED_HISTORY_KEYS.some(k=>k===key)||!old||old.kind!=='retained'||old.category!=='history'||!Number.isSafeInteger(bytes)||bytes<0||bytes>old.bytes){this.rejected++;this.exhausted=true;throw new Stage2BudgetError(`invalid retained history release ${key}`);}
  this.current-=bytes;if(bytes===old.bytes)this.claims.delete(key);else this.claims.set(key,{...old,bytes:old.bytes-bytes});
 }
 get temporaryHeldBytes():number {let bytes=0;for(const c of this.claims.values())if(c.kind==='temporary')bytes+=c.bytes;return bytes;}
 held(key:string):number {return this.claims.get(key)?.bytes??0;}
 close():ReservationAudit {if(!this.sealed){this.heldAtSeal=this.current;this.sealed=true;}return this.audit();}
 audit():ReservationAudit {return {limitBytes:this.limitBytes,peakBytes:this.peak,heldBytesAtClose:this.heldAtSeal??this.current,rejectedReservations:this.rejected,closed:this.sealed,categoryPeaks:{...this.categories}};}
 ledger():Array<{category:string;bytes:number}> {const totals=new Map<string,number>();for(const c of this.claims.values())totals.set(c.category,(totals.get(c.category)??0)+c.bytes);return [...totals].map(([category,bytes])=>({category,bytes}));}
}
