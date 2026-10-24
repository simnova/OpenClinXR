import {afterEach,describe,it,expect,vi} from 'vitest';
import {runStage2Media,STAGE2_CONFIG} from '../../entrypoints/stage2.js';
import {graphFixture} from './run.test-support.js';
afterEach(()=>vi.unstubAllGlobals());
function paging(size:number,change?:(p:Record<string,unknown>)=>void){
 const h=graphFixture();let pages=0;
 h.respond(async(path,body)=>{
  const envelope={identity:h.options.release.identity,binding:h.options.release.binding};
  if(path==='/stage2/offer')return Response.json({...envelope,description:{type:'answer',sdp:'fake-answer'},allocatedAtServerMs:1,serverClockId:'server-clock'});
  if(path==='/stage2/control')return Response.json({...envelope,markerId:body['markerId'],command:body['command'],serverClockId:'server-clock',serverAtMs:2,uplinkDecoded:null,downlinkSource:null});
  if(path!=='/stage2/stats')return undefined;
  const snapshot:Record<string,unknown>=await h.defaultReply(path,body).json();
  const cursor=Number(body['afterSequence']),total=body['history']==='uplink-decoded'?512:0;
  const rows=Array.from({length:Math.min(size,total-cursor-1)},(_,i)=>{const sequence=cursor+i+1,bin=structuredClone(h.source.decoded.uplink.bins[0]!);bin.sequence=sequence;bin.frameStart=sequence*bin.frames;bin.frameEnd=bin.frameStart+bin.frames;bin.tagStart.value=12800+bin.frameStart;bin.tagEndExclusive.value=12800+bin.frameEnd;return bin;});
  const page={history:body['history'],afterSequence:cursor,nextAfterSequence:cursor+rows.length,totalAvailableRows:total,rows,final:true};
  if(total>0){pages++;change?.(page);}snapshot['page']=page;return Response.json(snapshot);
 });
 return {...h,get pages(){return pages;}};
}
describe('bounded final-history paging through actual control requests',()=>{
 for(const size of [1,4,16])it(`retains all512 rows with legal ${size}-row pages`,async()=>{
  const h=paging(size),result=await runStage2Media(h.options);
  expect(result.reason).toBe('fixture paging observed');expect(result.decoded.uplink.bins.map(b=>b.sequence)).toEqual(Array.from({length:512},(_,i)=>i));expect(result.sources.downlink.bins).toEqual([]);
  expect(h.pages).toBeLessThanOrEqual(STAGE2_CONFIG.bins.maximumRowsPerSource+2);expect(result.resources.overflow).toBe(0);expect(result.resources.ownerReservations.browser?.rejectedReservations).toBe(0);
  const requests=h.requests.filter(r=>r.path==='/stage2/stats'&&r.body['history']==='uplink-decoded');expect(requests.at(-1)?.body['afterSequence']).toBe(511);
 },15000);
 it('rejects an empty unfinished page immediately instead of renewing the deadline',async()=>{
  const h=paging(4,page=>{page['rows']=[];page['nextAfterSequence']=page['afterSequence'];});const result=await runStage2Media(h.options);expect(result.reason).toContain('did not progress');expect(result.decoded.uplink.bins).toEqual([]);expect(h.pages).toBe(2);
 });
 it.each(['cursor-reuse','cursor-skip','row-overflow','fractional-total'] as const)('rejects %s',async kind=>{
  const h=paging(4,page=>{if(kind==='cursor-reuse')page['afterSequence']=3;if(kind==='cursor-skip')page['nextAfterSequence']=8;if(kind==='row-overflow')page['rows']=Array(17).fill(h.source.decoded.uplink.bins[0]);if(kind==='fractional-total')page['totalAvailableRows']=512.5;});
  const result=await runStage2Media(h.options);expect(result.reason).toMatch(/snapshot identity\/shape|cursor\/history mismatch|next cursor mismatch/);expect(result.outcome).toBe('failed');expect(result.cleanup.browserRemaining.contexts).toBe(0);
 });
 it('accepts idempotent final-empty absent history without manufacturing a row',async()=>{
  const h=paging(16,page=>{page['rows']=[];page['totalAvailableRows']=0;page['nextAfterSequence']=-1;});const result=await runStage2Media(h.options);expect(result.reason).toBe('fixture paging observed');expect(result.decoded.uplink.bins).toEqual([]);expect(result.sources.downlink.bins).toEqual([]);expect(STAGE2_CONFIG.bins.maximumRowsPerSource+1).toBe(513);
 });
});
