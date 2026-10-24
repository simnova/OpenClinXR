import type { ExportUnit } from './export.js';
import type { InvocationDeadline } from './deadline.js';
import type { KnownBudget } from './memory.js';
import { DurableExport, type ExportIo } from './persist.js';

/** Outer invocation owner; pending native writes remain owned after a raced await. */
export class ExportOwner {
  private stopped=false;private creation:Promise<DurableExport>|null=null;private writer:DurableExport|null=null;private closing:Promise<void>|null=null;
  private readonly pending=new Map<Promise<unknown>,'create'|'accept'|'control'|'close'>();private readonly errors:string[]=[];
  constructor(private readonly deadline:InvocationDeadline){}
  private admit(){this.deadline.assertWork();if(this.stopped)throw new Error('Export owner admission stopped');}
  private track<T>(kind:'create'|'accept'|'control'|'close',operation:Promise<T>):Promise<T>{
    this.pending.set(operation,kind);
    void operation.then(()=>this.pending.delete(operation),error=>{this.pending.delete(operation);this.errors.push(`${kind}:${String(error)}`);});
    return operation;
  }
  create(path:string,budget:KnownBudget,binding:{runNonce:string;identitySha256:string},io:Pick<ExportIo,'openFile'>={}):Promise<DurableExport>{
    this.admit();if(this.creation)throw new Error('Export writer already requested');
    // The deferred constructor cannot run until its Promise has entered this owner.
    this.creation=this.track('create',Promise.resolve().then(()=>{this.admit();return DurableExport.create(path,budget,binding,{...io,admit:()=>this.admit(),cleanup:()=>this.deadline.assert()});}).then(writer=>{this.writer=writer;if(this.stopped)void this.close().catch(()=>undefined);return writer;}));
    return this.creation;
  }
  accept(unit:ExportUnit){
    this.admit();const writer=this.writer;if(!writer)throw new Error('Export writer unavailable');
    if([...this.pending.values()].includes('accept'))throw new Error('Export accept already pending');
    return this.track('accept',Promise.resolve().then(()=>{this.admit();return writer.accept(unit);}));
  }
  control<T>(operation:()=>Promise<T>):Promise<T>{this.admit();return this.track('control',Promise.resolve().then(()=>{this.admit();return operation();}));}
  stop(){this.stopped=true;}
  close():Promise<void>{
    this.stop();if(this.closing)return this.closing;
    const prior=[...this.pending.keys()];
    this.closing=this.track('close',Promise.resolve().then(async()=>{
      await Promise.allSettled(prior);
      if(this.writer)await this.writer.close();
      else if(this.creation)throw new Error('Export creation failed; handle cleanup not independently confirmed');
    }));
    return this.closing;
  }
  snapshot(){
    const handles=this.writer?.snapshot().handles??null;
    return{admissionStopped:this.stopped,pendingCreate:[...this.pending.values()].filter(kind=>kind==='create').length,pendingAccept:[...this.pending.values()].filter(kind=>kind==='accept').length,pendingControl:[...this.pending.values()].filter(kind=>kind==='control').length,pendingClose:[...this.pending.values()].filter(kind=>kind==='close').length,handles,closeErrors:this.writer?.snapshot().closeErrors??null,errors:[...this.errors],confirmed:this.stopped&&this.pending.size===0&&(!this.creation||(handles?.file==='closed'&&handles.ledger==='closed'))};
  }
}
