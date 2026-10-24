import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';
import { chainInput, digest, EXPORT_CHUNK_BYTES, type ExportAck, type ExportUnit } from './export.js';
import type { KnownBudget } from './memory.js';
export interface ExportFile {
  write(bytes:Uint8Array,offset:number,length:number,position:number|null):Promise<{bytesWritten:number}>;
  sync():Promise<void>;
  close():Promise<void>;
}
export interface ExportIo {
  admit?:()=>void;
  cleanup?:()=>void;
  openFile?:(path:string)=>Promise<ExportFile>;
}
const ascii=(text:string)=>{for(let i=0;i<text.length;i++)if(text.charCodeAt(i)>127)return false;return true;};
const noGuard=()=>undefined;
/** Post-close control only. Both complete files are synced before any ACK. */
export class DurableExport {
  private sequence=0;private offset=0;private chain='0'.repeat(64);private complete=false;private failed=false;
  private readonly hash=createHash('sha256');
  private closePromise:Promise<void>|null=null;
  private readonly handles:{file:'open'|'closed'|'failed';ledger:'open'|'closed'|'failed'}={file:'open',ledger:'open'};
  private readonly closeErrors:{file:string|null;ledger:string|null}={file:null,ledger:null};
  private constructor(private readonly file:ExportFile,private readonly ledger:ExportFile,private readonly budget:KnownBudget,private readonly binding:{runNonce:string;identitySha256:string},private readonly io:ExportIo){}
  static async create(path:string,budget:KnownBudget,binding:{runNonce:string;identitySha256:string},io:ExportIo={}){
    const admit=io.admit??noGuard,cleanup=io.cleanup??noGuard,openFile=io.openFile??(async(name:string)=>open(name,'wx'));
    admit();const file=await openFile(path);let ledger:ExportFile|null=null;
    try{admit();ledger=await openFile(`${path}.acks`);admit();return new DurableExport(file,ledger,budget,binding,io);}
    catch(error){const errors:unknown[]=[error];await Promise.all([file,ledger].map(async handle=>{if(handle)try{cleanup();await handle.close();}catch(closeError){errors.push(closeError);}}));throw new AggregateError(errors,'Export creation or partial-handle cleanup failed');}
  }
  private admit(){(this.io.admit??noGuard)();if(this.failed||this.closePromise)throw new Error('Export admission stopped');}
  private async writeAll(handle:ExportFile,bytes:Uint8Array,position:number|null){
    let at=0;
    while(at<bytes.length){this.admit();const remaining=bytes.length-at,{bytesWritten}=await handle.write(bytes,at,remaining,position===null?null:position+at);this.admit();if(!Number.isSafeInteger(bytesWritten)||bytesWritten<=0||bytesWritten>remaining)throw new Error('Invalid progress export write');at+=bytesWritten;}
  }
  async accept(unit:ExportUnit):Promise<ExportAck>{
    this.admit();
    if(this.complete||unit.runNonce!==this.binding.runNonce||unit.identitySha256!==this.binding.identitySha256||unit.sequence!==this.sequence||unit.offset!==this.offset||unit.length!==unit.data.length||unit.length>EXPORT_CHUNK_BYTES||unit.length<0||!ascii(unit.data))throw new Error('Export sequence/offset/bound violation');
    const lease=this.budget.reserve('postclose-export-unit-control-copies',unit.length*4+2048);
    try{
      const payloadHash=await digest(unit.data);this.admit();const nextChain=await digest(chainInput(this.chain,unit));this.admit();
      if(payloadHash!==unit.sha256||nextChain!==unit.chainSha256)throw new Error('Export digest mismatch');
      const bytes=Buffer.from(unit.data,'ascii');await this.writeAll(this.file,bytes,this.offset);this.admit();await this.file.sync();this.admit();
      const ack={runNonce:unit.runNonce,identitySha256:unit.identitySha256,sequence:unit.sequence,offset:unit.offset,length:unit.length,sha256:unit.sha256,chainSha256:unit.chainSha256};
      const journal=Buffer.from(`${JSON.stringify({...ack,final:unit.final})}\n`,'ascii');
      await this.writeAll(this.ledger,journal,null);this.admit();await this.ledger.sync();this.admit();
      this.hash.update(bytes);this.sequence++;this.offset+=unit.length;this.chain=unit.chainSha256;this.complete=unit.final;return ack;
    }catch(error){this.failed=true;throw error;}
    finally{this.budget.release(lease);}
  }
  snapshot(){return{complete:this.complete,sequence:this.sequence,bytes:this.offset,chainSha256:this.chain,canonicalSha256:this.hash.copy().digest('hex'),handles:{...this.handles},closeErrors:{...this.closeErrors}};}
  close():Promise<void>{
    if(this.closePromise)return this.closePromise;
    this.closePromise=Promise.resolve().then(async()=>{
      const errors:unknown[]=[];
      await Promise.all((['ledger','file'] as const).map(async name=>{try{(this.io.cleanup??noGuard)();await this[name].close();this.handles[name]='closed';}catch(error){this.handles[name]='failed';this.closeErrors[name]=String(error).slice(0,256);errors.push(error);}}));
      if(errors.length)throw new AggregateError(errors,'Export handle closure failed');
    });
    return this.closePromise;
  }
}
