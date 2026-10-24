import {afterEach,describe,it,expect,vi} from 'vitest';
import {runStage2Media} from '../../entrypoints/stage2.js';
import {graphFixture} from './run.test-support.js';
afterEach(()=>vi.unstubAllGlobals());
describe('independent owned-resource teardown through the actual media runner',()=>{
 it('releases all other resources after one throwing node, track, port or listener',async()=>{
  const h=graphFixture();let goodNode:ReturnType<typeof vi.fn>,goodPort:ReturnType<typeof vi.fn>;
  h.respond((path)=>{if(path!=='/stage2/offer')return undefined;
   const node=h.nodes[0]!,worklet=h.worklets[0]!,track=h.tracks[0]!,peer=h.peers[0]!;
   node.disconnect.mockImplementation(()=>{throw Error('node');});
   track.stop.mockImplementation(()=>{throw Error('track');});
   worklet.port.close.mockImplementation(()=>{throw Error('port');});
   vi.spyOn(peer,'removeEventListener').mockImplementationOnce(()=>{throw Error('listener');});
   goodNode=worklet.disconnect;goodPort=peer.close;
   throw Error('fixture graph terminal');
  });
  const result=await runStage2Media(h.options);
  expect(result.cleanup.browserRemaining).toMatchObject({peers:0,tracks:1,nodes:1,ports:1,listeners:1,contexts:0});
  expect(goodNode!).toHaveBeenCalledOnce();expect(goodPort!).toHaveBeenCalledOnce();expect(h.contexts[0]?.close).toHaveBeenCalledOnce();expect(h.tracks[0]?.stop).toHaveBeenCalledOnce();expect(h.worklets[0]?.port.close).toHaveBeenCalledOnce();
 });
 it('does not invent closed peer state when close throws',async()=>{
  const h=graphFixture();h.respond(path=>{if(path==='/stage2/offer'){h.peers[0]!.close.mockImplementation(()=>{throw Error('close');});throw Error('fixture graph terminal');}return undefined;});
  const result=await runStage2Media(h.options);expect(result.cleanup.browserRemaining.peers).toBe(1);expect(h.peers[0]?.connectionState).toBe('new');expect(h.contexts[0]?.state).toBe('closed');expect(result.cleanup.browserRemaining.tracks).toBe(0);expect(result.cleanup.browserRemaining.ports).toBe(0);
 });
});
