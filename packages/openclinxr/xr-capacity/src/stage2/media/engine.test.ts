import {createHash} from 'node:crypto';
import {afterEach,describe,it,expect,vi} from 'vitest';
import {runStage2Media} from "../../entrypoints/stage2.js";
import {setupFixture as fixture,tick,bytes} from "./run.test-support.js";
import {STAGE2_PROTOCOL_SHA256} from "../../entrypoints/stage2.js";
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});
describe('bounded setup and late completion cleanup (mock browser only)',()=>{
 it('stops a pending module admission and cannot construct a graph on its late resolution',async()=>{
  const h=fixture('module'),transfer=vi.fn();h.options.onOwnerTransfer=transfer;const promise=runStage2Media(h.options);await vi.waitFor(()=>expect(h.instances[0]?.audioWorklet.addModule).toHaveBeenCalled());h.abort.abort();const result=await promise;
  expect(result.reason).toBe('Explicit browser fixture Stop');expect(result.outcome).toBe('failed');expect(result.cleanup.browserRemaining).toEqual({peers:0,tracks:0,generators:0,nodes:0,ports:0,contexts:0,listeners:0,timers:0,pendingCommands:1});expect(transfer).not.toHaveBeenCalled();expect(h.posts).toContain('/stage2/close');
  h.finishModule();await tick();expect(h.instances[0]?.createdNodes).toBe(0);expect(h.instances[0]?.state).toBe('closed');expect(result.cleanup.browserRemaining.pendingCommands).toBe(1);expect(transfer).not.toHaveBeenCalled();
 });
 it('closes after pending resume cancellation and ignores its late fulfillment',async()=>{
  const h=fixture('resume'),transfer=vi.fn();h.options.onOwnerTransfer=transfer;const promise=runStage2Media(h.options);await vi.waitFor(()=>expect(h.instances[0]?.audioWorklet.addModule).toHaveBeenCalled());h.abort.abort();const result=await promise;h.finishResume();await tick();expect(result.outcome).toBe('failed');expect(h.instances[0]?.state).toBe('closed');expect(h.instances[0]?.createdNodes).toBe(0);expect(result.cleanup.browserRemaining.contexts).toBe(0);expect(result.cleanup.browserRemaining.pendingCommands).toBe(1);expect(transfer).not.toHaveBeenCalled();
 });
 it('does not allocate context or peer for a previously cancelled Start',async()=>{
  const h=fixture('module');h.abort.abort();const result=await runStage2Media(h.options);expect(result.reason).toBe('Explicit trusted Start required');expect(h.instances).toHaveLength(0);expect(result.cleanup.browserRemaining.contexts).toBe(0);expect(h.posts).toContain('/stage2/close');
 });
 it('enforces the original20s setup deadline while module loading never settles',async()=>{
  vi.useFakeTimers();const digest=Uint8Array.from(createHash('sha256').update(bytes).digest());vi.stubGlobal('crypto',{subtle:{digest:async()=>digest.buffer}});const h=fixture('module'),promise=runStage2Media(h.options);await tick();expect(h.instances[0]?.audioWorklet.addModule).toHaveBeenCalled();await vi.advanceTimersByTimeAsync(20001);const result=await promise;expect(result.outcome).toBe('failed');expect(result.reason).toMatch(/setup20s|worklet module deadline/);expect(result.cleanup.browserRemaining.contexts).toBe(0);h.finishModule();await tick();expect(h.instances[0]?.createdNodes).toBe(0);
 });
 it('retains budget-exhaustion reason and closes every owned resource when a working copy is refused',async()=>{const h=fixture('module');h.options.release.expectedEnvironment.browser.launchFlags=['oversized-control-metadata:'+ 'x'.repeat(280000)];const result=await runStage2Media(h.options);expect(h.instances).toHaveLength(1);expect(result.reason).toContain('budget-exhausted');expect(result.outcome).toBe('failed');expect(Object.values(result.cleanup.browserRemaining).every(v=>v===0)).toBe(true);expect(result.cleanup.serverClose?.closed).toBe(true);expect(result.resources.ownerReservations.browser).toMatchObject({limitBytes:655360,closed:true});expect(result.resources.ownerReservations.browser!.rejectedReservations).toBeGreaterThan(0);expect(result.sources.uplink.bins).toHaveLength(0);});
 it('transfers the actual sealed owner once for a settled rejected native operation and preserves its failed incomplete prefix',async()=>{
  const h=fixture('reject'),transfer=vi.fn();h.options.onOwnerTransfer=transfer;const result=await runStage2Media(h.options);
  expect(result.outcome).toBe('failed');expect(result.reason).toBe('fixture module failed');expect(result.cleanup.browserRemaining.pendingCommands).toBe(0);expect(Object.values(result.cleanup.browserRemaining).every(v=>v===0)).toBe(true);expect(result.sources.uplink.final).toBeNull();expect(result.decoded.uplink.final).toBeNull();expect(result.cleanup.serverClose?.closed).toBe(true);expect(transfer).toHaveBeenCalledTimes(1);const actual=transfer.mock.calls[0]![0];expect(actual.audit()).toEqual(result.resources.ownerReservations.browser);expect(actual.temporaryHeldBytes).toBe(0);expect(result.cleanup.browserDrained).toBe(true);
 });
});
