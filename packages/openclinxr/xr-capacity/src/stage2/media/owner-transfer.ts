import type {Stage2RunRecord} from '../grading/types.js';
import type {Stage2MediaOptions} from './api.js';
import type {Stage2Budget} from './budget.js';
/** One factory invocation owns this gate. Failed prefixes remain failed after ownership transfer. */
export class Stage2OwnerTransfer {
 private transferred=false;
 constructor(private readonly callback?:Stage2MediaOptions['onOwnerTransfer']){}
 complete(actualBudget:Stage2Budget,record:Stage2RunRecord,ioSettled:boolean):boolean {
  const close=record.cleanup.serverClose;
  if(this.transferred||!this.callback||!ioSettled||!actualBudget.audit().closed||actualBudget.temporaryHeldBytes!==0
   ||!['completed','failed','unsupported'].includes(record.outcome)||Object.values(record.cleanup.browserRemaining).some(v=>v!==0)
   ||!close?.closed||[close.activePeers,close.closingPeers,close.ownedTasks,close.pendingControls,close.queuedControlBytes].some(v=>v!==0))return false;
  this.transferred=true;this.callback(actualBudget);return true;
 }
}
