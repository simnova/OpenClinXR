import type { Page } from "playwright";
import type { SecureServiceManifest } from "./secure-services.js";
export interface WireObservation { id: string; ok: boolean; detail: Record<string, unknown>; error?: string }
/** End-to-end wire checks, not capacity profiles. No browser API is mocked. */
export async function checkSecureWires(page: Page, manifest: SecureServiceManifest, ackDeadlineMs = 8000): Promise<WireObservation[]> {
  const script = String.raw`async (m) => {
    const results = [];
    const digest=async(text)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))).map(byte=>byte.toString(16).padStart(2,'0')).join('');
    const receipt=async(sent,received)=>({sentBytes:new TextEncoder().encode(sent).length,receivedBytes:new TextEncoder().encode(received).length,sentSha256:await digest(sent),receivedSha256:await digest(received),byteExact:sent===received});
    const deadline = (promise, ms=8000, phase='setup') => new Promise((resolve,reject) => {
      const id=setTimeout(()=>reject(new Error(phase==='application-echo'?'application-echo-deadline':'setup deadline')),ms);
      Promise.resolve(promise).then(v=>{clearTimeout(id);resolve(v)},e=>{clearTimeout(id);reject(e)});
    });
    const once = (target,name) => new Promise((resolve,reject)=>{
      const ok=event=>{clean();resolve(event)}, bad=()=>{clean();reject(new Error(name+' failed'))};
      const clean=()=>{target.removeEventListener(name,ok);target.removeEventListener('error',bad)};
      target.addEventListener(name,ok,{once:true});target.addEventListener('error',bad,{once:true});
    });
    const check=async(id,run)=>{try{results.push({id,ok:true,detail:await run()})}catch(e){results.push({id,ok:false,detail:{},error:String(e).slice(0,500)})}};
    const expected=JSON.stringify({version:1,session:'real-wire-check',seq:1,payload:'abcdefgh'.repeat(32)});
    await check('https-h2-echo',async()=>{
      const start=performance.now();const r=await fetch(m.echoUrl,{method:'POST',body:expected,signal:AbortSignal.timeout(m.ackDeadlineMs)}).catch(error=>{if(error.name==='TimeoutError')throw new Error('application-echo-deadline: HTTPS request timed out');throw error});
      const actual=await r.text();if(!r.ok||actual!==expected)throw new Error('HTTPS byte mismatch');const echoRttMs=performance.now()-start;
      const httpVersion=r.headers.get('x-capacity-http-version');if(httpVersion!=='2.0')throw new Error('HTTP/2 was not observed: '+httpVersion);
      return {...await receipt(expected,actual),bytes:new TextEncoder().encode(actual).length,rttMs:echoRttMs,protocolEvidence:"observed server HTTP/TLS response headers",httpVersion,alpn:r.headers.get('x-capacity-alpn')};
    });
    await check('https-png-asset',async()=>{
      const r=await fetch(m.imageAssetUrl,{signal:AbortSignal.timeout(5000)});const blob=await r.blob();const bitmap=await createImageBitmap(blob);
      const detail={bytes:blob.size,width:bitmap.width,height:bitmap.height,sha256:r.headers.get('x-capacity-sha256')};bitmap.close();
      if(!r.ok||detail.width!==256||detail.height!==256)throw new Error('PNG mismatch');return detail;
    });
    await check('https-request-bound',async()=>{const r=await fetch(m.echoUrl,{method:'POST',body:'a'.repeat(65537),signal:AbortSignal.timeout(5000)});if(r.status!==413)throw new Error('Oversize request was not rejected');return {status:r.status}});
    await check('wss-payload-echo',async()=>{
      const socket=new WebSocket(m.wssUrl);try{await deadline(once(socket,'open'));const receive=once(socket,'message');const start=performance.now();socket.send(expected);const event=await deadline(receive,m.ackDeadlineMs,'application-echo');if(event.data!==expected)throw new Error('WSS byte mismatch');const echoRttMs=performance.now()-start;return {...await receipt(expected,event.data),bytes:expected.length,rttMs:echoRttMs,browserAlpn:"not-exposed",bufferedAmount:socket.bufferedAmount}}finally{socket.close()}
    });
    const rtc=async(unordered,audio)=>{
      const pc=new RTCPeerConnection({iceServers:[]});let peerId;let context;let source;let media;let receivedAudio=false;
      pc.addEventListener('track',event=>{receivedAudio=event.track.kind==='audio'});
      const channel=pc.createDataChannel('capacity-wire',unordered?{ordered:false,maxRetransmits:0}:{});
      try{
        if(audio){context=new AudioContext();await context.resume();source=context.createOscillator();const gain=context.createGain();gain.gain.value=0.02;const destination=context.createMediaStreamDestination();source.connect(gain).connect(destination);source.start();media=destination.stream;for(const track of media.getTracks())pc.addTrack(track,media)}
        await pc.setLocalDescription(await pc.createOffer());
        if(pc.iceGatheringState!=='complete')await deadline(new Promise(resolve=>pc.addEventListener('icegatheringstatechange',()=>{if(pc.iceGatheringState==='complete')resolve()})),4000);
        const response=await fetch(m.rtcOfferUrl,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(pc.localDescription),signal:AbortSignal.timeout(12000)});
        const answer=await response.json();if(!response.ok)throw new Error('RTC offer rejected');peerId=answer.peerId;
        await pc.setRemoteDescription(answer);if(channel.readyState!=='open')await deadline(once(channel,'open'));
        const pending=once(channel,'message');const start=performance.now();channel.send(expected);const event=await deadline(pending,m.ackDeadlineMs,'application-echo');if(event.data!==expected)throw new Error('RTC byte mismatch');const dataEchoRttMs=performance.now()-start;const audioObservationBegan=performance.now();
        if(audio)await new Promise(resolve=>setTimeout(resolve,350));
        let stats=await pc.getStats();const statsBegan=performance.now();
        const hasPair=()=>{let found=false;stats.forEach(item=>{if(item.type==='candidate-pair'&&item.state==='succeeded'&&item.nominated)found=true});return found};
        while(!hasPair()&&performance.now()-statsBegan<1000){await new Promise(resolve=>setTimeout(resolve,25));stats=await pc.getStats()}
        const pairs=[];const selectedCandidatePairIds=[];let inboundAudioPackets=0;
        stats.forEach(item=>{if(item.type==='transport'&&typeof item.selectedCandidatePairId==='string')selectedCandidatePairIds.push(item.selectedCandidatePairId)});
        stats.forEach(item=>{if(item.type==='candidate-pair'&&item.state==='succeeded'){const local=stats.get(item.localCandidateId);const remote=stats.get(item.remoteCandidateId);pairs.push({id:item.id,selected:selectedCandidatePairIds.includes(item.id),state:item.state,nominated:item.nominated,currentRoundTripTime:item.currentRoundTripTime,local:{candidateType:local?.candidateType,protocol:local?.protocol,address:local?.address},remote:{candidateType:remote?.candidateType,protocol:remote?.protocol,address:remote?.address}})}if(item.type==='inbound-rtp'&&item.kind==='audio')inboundAudioPackets+=item.packetsReceived??0});
        if(!pairs.some(pair=>pair.nominated))throw new Error('No nominated actual ICE pair');if(audio&&(!receivedAudio||inboundAudioPackets<1))throw new Error('No real server audio RTP received');
        return {...await receipt(expected,event.data),rttMs:dataEchoRttMs,audioObservationDurationMs:performance.now()-audioObservationBegan,ordered:channel.ordered,maxRetransmits:channel.maxRetransmits,receivedAudio,inboundAudioPackets,selectedCandidatePairIds,selectedPairEvidence:selectedCandidatePairIds.length?"RTCTransportStats.selectedCandidatePairId":"not-exposed; nominated pair observations only",pairs};
      }finally{channel.close();pc.close();source?.stop();for(const track of media?.getTracks()??[])track.stop();await context?.close();if(peerId)await fetch(m.rtcCloseUrl,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({peerId}),signal:AbortSignal.timeout(3000)}).catch(()=>{})}
    };
    await check('webrtc-reliable-server-echo',()=>rtc(false,false));
    await check('webrtc-unordered-server-echo',()=>rtc(true,false));
    await check('webrtc-audio-rtp-echo',()=>rtc(false,true));
    const wt=async(datagram)=>{
      if(typeof WebTransport!=='function')throw new Error('WebTransport API unavailable');
      const transport=new WebTransport(m.webTransportUrl,{serverCertificateHashes:m.certificateHashes.map(x=>({algorithm:x.algorithm,value:new Uint8Array(x.value)}))});
      transport.closed.catch(()=>{});let writer,reader;
      try{
        await deadline(transport.ready);const encoded=new TextEncoder().encode(expected+'\n');
        if(datagram){writer=transport.datagrams.writable.getWriter();reader=transport.datagrams.readable.getReader()}else{const stream=await deadline(transport.createBidirectionalStream());writer=stream.writable.getWriter();reader=stream.readable.getReader()}
        const start=performance.now();await deadline(writer.write(encoded));let text='';
        while(text.length<expected.length+1){const value=await deadline(reader.read(),m.ackDeadlineMs,'application-echo');if(value.done)break;text+=new TextDecoder().decode(value.value)}
        if(text!==expected+'\n')throw new Error('WebTransport byte mismatch');const echoRttMs=performance.now()-start;return {...await receipt(expected+"\n",text),rttMs:echoRttMs,datagram,bytes:encoded.length,browserAlpn:"not-exposed",protocolEvidence:"aioquic accepted WebTransport HTTP/3 session receipt",protocol:'HTTP/3 QUIC real peer'};
      }finally{await reader?.cancel().catch(()=>{});await writer?.abort().catch(()=>{});transport.close()}
    };
    await check('webtransport-bidi-stream-echo',()=>wt(false));
    await check('webtransport-datagram-echo',()=>wt(true));
    return results;
  }`;
  return page.evaluate(`(${script})(${JSON.stringify({ ...manifest, ackDeadlineMs })})`) as Promise<WireObservation[]>;
}
