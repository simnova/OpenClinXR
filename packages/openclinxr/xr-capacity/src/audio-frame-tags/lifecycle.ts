export interface OwnedNode {disconnect(): void; port: {onmessage: unknown; close(): void}}
export interface OperationState {pending:number;stopped:boolean}
export function requireBrowserCommandIdentity(command:unknown,expectedExecutable:string) {
  const args=command&&typeof command==='object'?(command as {arguments?:unknown}).arguments:null;
  if(!Array.isArray(args)||!args.length||args.some(value=>typeof value!=='string')||args[0]!==expectedExecutable)
    throw Error('Effective browser executable differs from exact root GO; no page or graph admission');
  if(!args.includes('--headless'))
    throw Error('Effective browser command lacks the fixed headless profile; no page or graph admission');
}
export function ownedCloseConfirmed(created:boolean,pending:number,fulfilled:boolean,closedReadback:boolean) {
  return pending===0&&(!created||fulfilled&&closedReadback);
}
export async function deadlineStep<T>(make:()=>Promise<T>,state:OperationState,deadline:number,cleanup=false):Promise<T> {
  const check=()=>{if((state.stopped&&!cleanup)||performance.now()>=deadline){state.stopped=true;throw Error('Original outer deadline/admission expired');}};
  check();state.pending++;
  const work=(async()=>{check();return await make();})().finally(()=>{state.pending--;});
  let timer:ReturnType<typeof setTimeout>|undefined;
  try {
    const result=await Promise.race([work,new Promise<never>((_,reject)=>{timer=setTimeout(()=>{state.stopped=true;reject(Error('Original outer deadline exceeded; pending work remains owned'));},Math.max(0,deadline-performance.now()));})]);
    check();return result;
  } finally {if(timer)clearTimeout(timer);}
}
export async function closeGraph(nodes: OwnedNode[], context: {state: string; close(): Promise<void>} | null, deadline: number) {
  const errors: string[] = []; let disconnected = 0, portsClosed = 0, pendingContextClose = false;
  for (const node of nodes) {
    try { node.disconnect(); disconnected++; } catch (error) { errors.push(String(error)); }
    node.port.onmessage = null;
    try { node.port.close(); portsClosed++; } catch (error) { errors.push(String(error)); }
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  if (context && context.state !== 'closed') {
    if (performance.now() >= deadline) errors.push('Context-close admission deadline exceeded');
    else {
      pendingContextClose = true;
      const closing = context.close().then(() => { pendingContextClose = false; }, error => { pendingContextClose = false; errors.push(String(error)); });
      await Promise.race([closing, new Promise<void>(resolve => { timer = setTimeout(resolve, Math.max(0, deadline - performance.now())); })]);
      if (timer) clearTimeout(timer);
    }
  }
  const contextClosed = context === null || context.state === 'closed';
  return {nodesCreated: nodes.length, nodesDisconnected: disconnected, portsClosed, contextClosed,
    pendingContextClose, confirmed: disconnected === nodes.length && portsClosed === nodes.length && contextClosed && !pendingContextClose && errors.length === 0, errors};
}
