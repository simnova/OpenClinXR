/** One absolute Node clock for acquisition AND cleanup; no deadline reset at finally. */
export class InvocationDeadline {
  readonly controller=new AbortController();readonly signal=this.controller.signal;
  private readonly workController=new AbortController();readonly workSignal=this.workController.signal;
  private readonly timer:ReturnType<typeof setTimeout>;
  private readonly late=new Set<Promise<void>>();
  constructor(readonly startedMs:number,readonly limitMs:number,private readonly now=()=>performance.now()){
    this.timer=setTimeout(()=>{this.cancelWork('Absolute invocation deadline');this.controller.abort(new Error('Absolute invocation deadline'));},Math.max(1,this.remaining()));
  }
  remaining(){return Math.max(0,this.startedMs+this.limitMs-this.now());}
  assert(){if(this.signal.aborted||this.remaining()<=0)throw new Error('Absolute invocation deadline');}
  async acquire<T>(operation:Promise<T>,dispose:(value:T)=>Promise<void>):Promise<T>{
    let disposed=false;
    const cleanup=async(value:T)=>{if(!disposed){disposed=true;await dispose(value);}};
    const completion=operation.then(async value=>{if(this.workSignal.aborted||this.signal.aborted||this.remaining()<=0){await cleanup(value);throw new Error('Late constructor disposed');}return value;});
    const track=completion.then(()=>undefined,()=>undefined);this.late.add(track);void track.finally(()=>this.late.delete(track));
    try{const value=await this.wait(completion);if(this.workSignal.aborted){await cleanup(value);throw new Error('Late constructor disposed');}return value;}
    catch(error){void completion.catch(()=>undefined);throw error;}
  }
  async drainLate(){await this.wait(Promise.all([...this.late]));}

  assertWork(){this.assert();if(this.workSignal.aborted)throw new Error('Acquisition stopped; no new stage');}
  cancelWork(reason:string){if(!this.workSignal.aborted)this.workController.abort(new Error(reason));}
  async wait<T>(operation:Promise<T>,maximumMs=this.remaining()):Promise<T>{
    this.assert();let timer:ReturnType<typeof setTimeout>|undefined,abort:()=>void=()=>undefined;
    try{return await Promise.race([operation,new Promise<never>((_,no)=>{abort=()=>no(this.signal.reason??new Error('Absolute deadline'));this.signal.addEventListener('abort',abort,{once:true});timer=setTimeout(()=>no(new Error('Operation bound within absolute deadline')),Math.max(1,Math.min(maximumMs,this.remaining())));})]);}
    finally{if(timer)clearTimeout(timer);this.signal.removeEventListener('abort',abort);}
  }
  stop(reason:string){this.cancelWork(reason);if(!this.signal.aborted)this.controller.abort(new Error(reason));}
  finish(){clearTimeout(this.timer);return {remainingMs:this.remaining(),pendingLateConstructors:this.late.size,expired:this.signal.aborted||this.remaining()<=0};}
}
