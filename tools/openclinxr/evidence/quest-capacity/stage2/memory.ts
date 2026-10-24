import type { ReservationAudit } from '@openclinxr/xr-capacity/stage2';
/** Known byte working sets only: native, object, and library heaps are unmeasured. */
export class KnownBudget {
  private readonly items = new Map<symbol, {category:string;bytes:number;retained:boolean}>();
  private readonly current = new Map<string, number>();
  private readonly peaks: Record<string,number> = {};
  private held = 0; private peak = 0; private rejected = 0; private sealed = false; private heldAtClose = 0;
  constructor(readonly limit:number) {}
  reserve(category:string,bytes:number,retained=false):symbol {
    if (!Number.isSafeInteger(bytes)||bytes<0) throw new Error('Invalid byte dimension');
    if ((this.sealed&&retained)||this.held+bytes>this.limit) { this.rejected++; throw new Error(`Known-byte reservation rejected: ${category} ${bytes}, held ${this.held}, limit ${this.limit}`); }
    const key=Symbol(category); this.items.set(key,{category,bytes,retained}); this.held+=bytes; this.peak=Math.max(this.peak,this.held);
    const size=(this.current.get(category)??0)+bytes; this.current.set(category,size); this.peaks[category]=Math.max(this.peaks[category]??0,size); return key;
  }
  release(key:symbol) { const item=this.items.get(key); if(!item) throw new Error('Unknown reservation release'); this.items.delete(key); this.held-=item.bytes; this.current.set(item.category,(this.current.get(item.category)??0)-item.bytes); }
  resize(key:symbol,bytes:number) {
    const item=this.items.get(key); if(!item||!Number.isSafeInteger(bytes)||bytes<0) throw new Error('Invalid resize');
    if ((this.sealed&&item.retained&&bytes>item.bytes)||this.held+bytes-item.bytes>this.limit) { this.rejected++; throw new Error('Known-byte growth rejected'); }
    const change=bytes-item.bytes; item.bytes=bytes; this.held+=change; this.peak=Math.max(this.peak,this.held);
    const size=(this.current.get(item.category)??0)+change;this.current.set(item.category,size);this.peaks[item.category]=Math.max(this.peaks[item.category]??0,size);
  }
  seal() { if(!this.sealed) { this.sealed=true; this.heldAtClose=[...this.items.values()].filter(item=>item.retained).reduce((sum,item)=>sum+item.bytes,0); } }
  audit():ReservationAudit { return {limitBytes:this.limit,peakBytes:this.peak,heldBytesAtClose:this.heldAtClose,rejectedReservations:this.rejected,closed:this.sealed,categoryPeaks:{...this.peaks}}; }
}
