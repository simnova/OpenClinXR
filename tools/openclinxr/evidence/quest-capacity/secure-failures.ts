import type { Page } from "playwright";
import type { startSecureServices } from "./secure-services.js";
import { checkSecureWires } from "./secure-wire-client.js";
/** Controlled local application delay is failure-fixture input, never routed network impairment. */
export async function checkFailurePage(page: Page, service: Awaited<ReturnType<typeof startSecureServices>>) {
  const observations = await checkSecureWires(page, service.manifest, 30);
  const delayed = new Set(["https-h2-echo", "wss-payload-echo", "webrtc-reliable-server-echo", "webrtc-unordered-server-echo", "webrtc-audio-rtp-echo", "webtransport-bidi-stream-echo", "webtransport-datagram-echo"]);
  const deadlines = observations.filter((item) => delayed.has(item.id));
  const serverReceipt = await page.evaluate(async (url) => (await fetch(url)).json(), service.manifest.peerStatsUrl) as { rtc: { messages: number }; wt: { streamChunks: number; datagrams: number } };
  const acceptedEachFault = service.counters.echoRequests >= 1 && service.counters.echoBytes >= 318 && service.counters.wssMessages >= 1 && serverReceipt.rtc.messages >= 3 && serverReceipt.wt.streamChunks >= 1 && serverReceipt.wt.datagrams >= 1;
  const overloadScript = String.raw`async (m) => {
    const socket=new WebSocket(m.wssUrl);const result=await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('overload close deadline')),5000);
      socket.onopen=()=>{for(let i=0;i<20;i++)socket.send(new Uint8Array(65536))};
      socket.onclose=event=>{clearTimeout(timer);resolve({code:event.code,reason:event.reason,expectedFailure:event.code===1008})};
      socket.onerror=()=>{};
    });socket.close();return result;
  }`;
  const overload = await page.evaluate(`(${overloadScript})(${JSON.stringify(service.manifest)})`) as { code: number; reason: string; expectedFailure: boolean };
  return { schema: "quest-capacity-secure-failure-fixtures.v1", applicationDelayMs: service.manifest.applicationDelayMs, ackDeadlineMs: 30, observations, serverReceipt, acceptedEachFault, overload, expectedFailure: true, ok: deadlines.length === 7 && deadlines.every((item) => !item.ok && item.error?.includes("application-echo-deadline")) && service.manifest.applicationDelayMs === 200 && acceptedEachFault && overload.expectedFailure, notEvidenceFor: ["network impairment", "actual path packet loss", "capacity limit", "physical audio latency"] };
}
