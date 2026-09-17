/** In-page runner for the real UI-XR Vite host. No second mouth writer. */
export async function runBrowserCapture(input) {
  const audio = window.__openClinXrPreparedActorAudio;
  const bridge = window.__openClinXrSpeakFixtureBridge;
  if (!audio || !bridge) throw new Error("prepared-audio-or-speak-bridge-missing");
  const binary = Uint8Array.from(atob(input.wavBase64), (c) => c.charCodeAt(0));
  const context = await audio.markUserActivated();
  const tapUrl = URL.createObjectURL(new Blob([input.tapSource], { type: "text/javascript" }));
  await audio.prepare({
    scenarioId: input.scenarioId,
    actorId: input.actorId,
    responseText: input.responseText,
    runnerConversationTurn: input.runnerConversationTurn,
    waveformSha256: input.waveformSha256,
    cueSha256: input.cueSha256,
    wav: binary.buffer,
    mouthCues: input.mouthCues,
    tapWorkletUrl: tapUrl,
  });
  const canvas = document.querySelector("canvas");
  if (!canvas) throw new Error("capture-canvas-missing");
  const recorderDest = audio.getRecorderDestination();
  const canvasStream = canvas.captureStream(30);
  const mixed = new MediaStream([
    ...canvasStream.getVideoTracks(),
    ...(recorderDest ? recorderDest.stream.getAudioTracks() : []),
  ]);
  const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp8,opus")
    ? "video/webm;codecs=vp8,opus"
    : "video/webm";
  const recorder = new MediaRecorder(mixed, { mimeType });
  const chunks = [];
  recorder.ondataavailable = (event) => {
    if (event.data && event.data.size) chunks.push(event.data);
  };
  const stopped = new Promise((resolve) => {
    recorder.onstop = resolve;
  });
  recorder.start();
  const speechStartedAtMs = performance.now();
  bridge.prepare({
    scenarioId: input.scenarioId,
    traceTag: "audible-lip-sync-diagnostic",
    transcript: "diagnostic prepared pcm",
    responseText: input.responseText,
    actorId: input.actorId,
    runnerRoutedActorId: input.actorId,
    routingReason: "audible-lip-sync-proof",
    runnerConversationTurn: input.runnerConversationTurn,
  });
  bridge.fire();
  const session = audio.sessions.get(input.actorId);
  if (!session) throw new Error("prepared-source-did-not-start");
  const frames = [];
  const nativeSeconds = input.sampleCount / input.sampleRate;
  const wallStart = performance.now();
  await new Promise((resolve, reject) => {
    function onFrame() {
      const drive = session.slot.root?.userData?.openClinXrNamedVisemeDrive;
      const sourcePositionSeconds = session.clockState.lastPosition;
      if (context.state === "running" && session.slot.activeSpeech === session.speech && drive) {
        frames.push({
          contextTime: session.clockState.lastContextTime,
          observationKind: "raf-callback",
          generation: session.generation,
          nodeSerial: session.nodeSerial,
          state: "playing",
          sourcePositionSeconds,
          mediaPositionSeconds: sourcePositionSeconds,
          displayNowMs: performance.now(),
          driveNowMs: drive.nowMs,
          frameIndex: drive.frameIndex ?? 0,
          activeTargetName: drive.activeTargetName ?? null,
          appliedMeshCount: drive.appliedMeshCount ?? 0,
        });
      }
      if (context.currentTime < session.startedWhen + 0.05 && performance.now() - wallStart > 12000) {
        reject(new Error("audio-context-not-advancing"));
        return;
      }
      if (sourcePositionSeconds + 1 / 60 >= nativeSeconds) {
        const waitTap = async () => {
          const deadline = performance.now() + 1500;
          while (audio.getPlayedTap().samples.length < input.sampleCount && performance.now() < deadline) {
            await new Promise((r) => setTimeout(r, 16));
          }
          resolve();
        };
        void waitTap();
        return;
      }
      if (performance.now() - wallStart > nativeSeconds * 1000 + 8000) {
        reject(new Error("capture-duration-timeout"));
        return;
      }
      requestAnimationFrame(onFrame);
    }
    requestAnimationFrame(onFrame);
  });
  await new Promise((r) => setTimeout(r, 600));
  recorder.stop();
  await stopped;
  const blob = new Blob(chunks, { type: mimeType });
  const video = new Uint8Array(await blob.arrayBuffer());
  const played = audio.getPlayedTap();
  let cameraMatrixWorld = Array(16).fill(0);
  let threeCamera = null;
  window.__openClinXrDebugScene?.traverse?.((object) => {
    if (threeCamera) return;
    if (object?.isCamera) threeCamera = object;
  });
  if (threeCamera?.matrixWorld?.elements) cameraMatrixWorld = Array.from(threeCamera.matrixWorld.elements);
  return {
    contextSampleRate: context.sampleRate,
    contextStateAtStart: "running",
    userActivated: true,
    decodedSampleRate: input.sampleRate,
    decodedSampleCount: input.sampleCount,
    segments: [{
      when: session.startedWhen,
      offset: 0,
      rate: 1,
      generation: session.generation,
      nodeSerial: session.nodeSerial,
    }],
    frames,
    playedTap: {
      observationKind: "audio-worklet-process",
      sourceGeneration: played.meta?.generation ?? session.generation,
      sourceNodeSerial: played.meta?.nodeSerial ?? session.nodeSerial,
      sourceStartContextSample: played.meta?.sourceStartContextSample ?? Math.round(session.startedWhen * context.sampleRate),
      sampleRate: context.sampleRate,
      sampleCount: played.samples.length,
    },
    playedSamples: Array.from(played.samples),
    videoBytes: Array.from(video),
    speechStartedAtMs,
    speechEndedAtMs: performance.now(),
    authoredMaterialRows: audio.getAuthoredMaterials(),
    framing: {
      cameraMatrixWorld,
      viewport: [canvas.width || 640, canvas.height || 640],
    },
  };
}
