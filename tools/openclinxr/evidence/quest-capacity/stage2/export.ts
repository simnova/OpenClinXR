import type {Stage2Budget} from '@openclinxr/xr-capacity/stage2';
export interface ExportUnit {runNonce:string;identitySha256:string;sequence:number;offset:number;length:number;sha256:string;chainSha256:string;data:string;final:boolean}
export interface ExportAck {runNonce:string;identitySha256:string;sequence:number;offset:number;length:number;sha256:string;chainSha256:string}
export const EXPORT_CHUNK_BYTES=4096;
const hex=(bytes:ArrayBuffer)=>Array.from(new Uint8Array(bytes),n=>n.toString(16).padStart(2,'0')).join('');
export async function digest(text:string){return hex(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)));}
export const chainInput=(previous:string,unit:Pick<ExportUnit,'runNonce'|'identitySha256'|'sequence'|'offset'|'sha256'>)=>`${previous}:${unit.runNonce}:${unit.identitySha256}:${unit.sequence}:${unit.offset}:${unit.sha256}`;
/** Equivalent JSON UTF8 size, without constructing a whole JSON string. */
export function jsonBytes(value:unknown):number {
  if(value===null)return 4;if(typeof value==='boolean')return value?4:5;
  if(typeof value==='number'){if(!Number.isFinite(value))throw new Error('Nonfinite export scalar');return String(value).length;}
  if(typeof value==='string'){let bytes=2;for(let i=0;i<value.length;i++){const n=value.charCodeAt(i);if(n===34||n===92||n===8||n===9||n===10||n===12||n===13)bytes+=2;else if(n<32)bytes+=6;else if(n<128)bytes++;else if(n<2048)bytes+=2;else if(n>=0xd800&&n<=0xdbff&&i+1<value.length&&value.charCodeAt(i+1)>=0xdc00&&value.charCodeAt(i+1)<=0xdfff){bytes+=4;i++;}else if(n>=0xd800&&n<=0xdfff)bytes+=6;else bytes+=3;}return bytes;}
  if(Array.isArray(value))return 2+Math.max(0,value.length-1)+value.reduce((sum,item)=>sum+jsonBytes(item===undefined?null:item),0);
  if(typeof value==='object'&&value){const keys=Object.keys(value).filter(key=>(value as Record<string,unknown>)[key]!==undefined);return 2+Math.max(0,keys.length-1)+keys.reduce((sum,key)=>sum+jsonBytes(key)+1+jsonBytes((value as Record<string,unknown>)[key]),0);}
  throw new Error('Unsupported export value');
}
function* stringTokens(value:string):Generator<string>{yield '"';for(let i=0;i<value.length;i++){const code=value.charCodeAt(i);if(code>=32&&code<127&&code!==34&&code!==92)yield value[i]??'';else if(code===34)yield '\\"';else if(code===92)yield '\\\\';else if(code===8)yield '\\b';else if(code===9)yield '\\t';else if(code===10)yield '\\n';else if(code===12)yield '\\f';else if(code===13)yield '\\r';else yield `\\u${code.toString(16).padStart(4,'0')}`;}yield '"';}
const HISTORY_KEYS:Record<string,string>={'sources.uplink.bins':'history:generator','decoded.downlink.bins':'history:monitor','decoded.uplink.bins':'history:uplink-decoded','sources.downlink.bins':'history:downlink-source'};
interface ReleasedRow {array:unknown[];index:number;bytes:number;key:string}
export class PostCloseExport {
  private readonly working='entry:export-working';
  private readonly tokens:Generator<string>;private rows:ReleasedRow[]=[];private pending:ExportUnit|null=null;
  private readonly binding:{runNonce:string;identity:unknown};
  private sequence=0;private offset=0;private chain='0'.repeat(64);private done=false;
  readonly counts:Record<string,number>={};
  constructor(record:unknown,private readonly budget:Stage2Budget){
    const prior=budget.audit();if(!prior.closed||prior.limitBytes!==655360)throw new Error('Closed actual owner required before export');
    const dto=record as {identity:unknown;binding:{runNonce:string}};if(!dto.binding?.runNonce||dto.binding.runNonce.length>128||jsonBytes(dto.identity)>1024)throw new Error('Bounded export identity required');this.binding={runNonce:dto.binding.runNonce,identity:dto.identity};
    // raw UTF16 chunk+concatenation overlap, encoded/hash bytes and bounded unit metadata.
    this.budget.lease(this.working,'serialization',24576,true);this.tokens=this.visit(record,[]);
  }
  private *visit(value:unknown,path:string[]):Generator<string>{
    if(value===null||typeof value==='boolean'||typeof value==='number'){if(typeof value==='number'&&!Number.isFinite(value))throw new Error('Nonfinite export scalar');yield String(value);return;}
    if(typeof value==='string'){yield*stringTokens(value);return;}
    if(Array.isArray(value)){const history=path.at(-1)==='bins',name=path.join('.');if(history)this.counts[name]=value.length;yield '[';for(let i=0;i<value.length;i++){if(i)yield ',';const bytes=history?jsonBytes(value[i])+1:0;yield*this.visit(value[i]===undefined?null:value[i],[...path,String(i)]);if(history){const key=HISTORY_KEYS[name];if(!key)throw new Error('Unknown history ownership key');this.rows.push({array:value,index:i,bytes,key});}}yield ']';return;}
    if(typeof value==='object'&&value){yield '{';let first=true;for(const key of Object.keys(value)){const child=(value as Record<string,unknown>)[key];if(child===undefined)continue;if(!first)yield ',';first=false;yield*stringTokens(key);yield ':';yield*this.visit(child,[...path,key]);}yield '}';return;}
    throw new Error('Unsupported export field');
  }
  async next():Promise<ExportUnit>{
    if(this.pending||this.done)throw new Error('ACK required; completed exports cannot restart');let data='';
    // Six ASCII chars maximum per token means no token or string payload is unbounded.
    while(data.length<=EXPORT_CHUNK_BYTES-6){const item=this.tokens.next();if(item.done){this.done=true;break;}data+=item.value;}
    const partial={runNonce:this.binding.runNonce,identitySha256:await digest(JSON.stringify(this.binding.identity)),sequence:this.sequence,offset:this.offset,sha256:await digest(data)};
    this.pending={...partial,length:data.length,chainSha256:await digest(chainInput(this.chain,partial)),data,final:this.done};return this.pending;
  }
  ack(ack:ExportAck){const unit=this.pending;if(!unit||ack.runNonce!==unit.runNonce||ack.identitySha256!==unit.identitySha256||ack.sequence!==unit.sequence||ack.offset!==unit.offset||ack.length!==unit.length||ack.sha256!==unit.sha256||ack.chainSha256!==unit.chainSha256)throw new Error('Export ACK mismatch; retained data preserved');
    for(const row of this.rows){this.budget.releaseRetainedBytes(row.key,row.bytes);row.array[row.index]=null;}this.rows=[];
    this.sequence++;this.offset+=unit.length;this.chain=unit.chainSha256;this.pending=null;if(this.done)this.budget.release(this.working);
  }
  snapshot(){if(this.done&&this.pending===null)this.budget.lease('entry:export-final-audit-response','serialization',4096,true);return {complete:this.done&&this.pending===null,sequence:this.sequence,bytes:this.offset,chainSha256:this.chain,counts:{...this.counts},reservation:this.budget.audit()};}
}
