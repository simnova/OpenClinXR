import { startPythonCompatibleVoiceBackendFixture, startRealtimeVoiceGatewayServer } from "./index.js";

const port = Number(process.env.PORT ?? 4017);
const backendUrl = process.env.OPENCLINXR_PYTHON_VOICE_BACKEND_WS_URL;
const backend = backendUrl
  ? undefined
  : await startPythonCompatibleVoiceBackendFixture({ port: 0, artificialDelayMs: 1 });
const gateway = await startRealtimeVoiceGatewayServer({
  port,
  backendUrl: backendUrl ?? backend?.wsUrl ?? "",
});

console.log(`OpenClinXR realtime voice gateway listening on ${gateway.httpUrl}`);
console.log(`WebSocket endpoint: ${gateway.wsUrl}`);
if (backend) {
  console.log(`Using local Python-compatible fixture backend at ${backend.wsUrl}`);
}
