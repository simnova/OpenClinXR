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
  const {createNeutralFaceView, readOwnedArticulation, subtreeExcludedFromJudgingLayer} = await import(input.neutralFaceModuleUrl);
  const {readAudioGraphClock, recorderChunkFact, serializeAudioGraphClock} = await import(input.audioGraphClockModuleUrl);
  if (typeof readAudioGraphClock !== "function" || typeof recorderChunkFact !== "function" || typeof serializeAudioGraphClock !== "function") throw new Error("audio-graph-clock-helper-missing");
  const {startNativeTrackObserver, float32ToBase64} = await import(input.nativeTrackObserverModuleUrl);
  if (typeof startNativeTrackObserver !== "function") throw new Error("native-track-observer-helper-missing");
  const clinicalScene = window.__openClinXrDebugScene;
  let ownedRoot;
  clinicalScene?.traverse((object) => {
    if (object.userData?.openClinXrActorId === input.actorId && object.userData?.openClinXrAssetPath) {
      if (ownedRoot && ownedRoot !== object) throw new Error("neutral-actor-root-ambiguous");
      ownedRoot = object;
    }
  });
  if (!ownedRoot) throw new Error("neutral-owned-runtime-asset-missing");
  let actorSlot = ownedRoot;
  for (let parent = ownedRoot.parent; parent && parent !== clinicalScene; parent = parent.parent) {
    if (parent.userData?.openClinXrActorId === input.actorId) actorSlot = parent;
  }
  const idleCues = { mouth: null, gaze: null, eyeFocus: null, expression: null };
  ownedRoot.traverse((object) => {
    const name = object.name ?? "";
    if (name.includes("phoneme-mouth-cue")) idleCues.mouth = object;
    else if (name.includes("eye-gaze-cue")) idleCues.gaze = object;
    else if (name.includes("eye-focus-cue")) idleCues.eyeFocus = object;
    else if (name.includes("runtime-expression-cue")) idleCues.expression = object;
  });
  if (!idleCues.mouth || !idleCues.gaze || !idleCues.eyeFocus || !idleCues.expression) throw new Error("idle-cue-identity-missing");
  const idleCueVisibility = {
    mouth: idleCues.mouth.visible === true,
    gaze: idleCues.gaze.visible === true,
    eyeFocus: idleCues.eyeFocus.visible === true,
    expression: idleCues.expression.visible === true,
  };
  const idleCueList = [idleCues.mouth, idleCues.gaze, idleCues.eyeFocus, idleCues.expression];
  const judgingLayer = 30;
  const neutralView = createNeutralFaceView({root: ownedRoot, actorSlot});
  const canvas = neutralView.canvas;
  const previousAfterRender = clinicalScene.onAfterRender;
  let canvasStream, recorder, ownedSession, trackObserver, startupStage = "create-view";
  try {
  startupStage = "exclude-idle-cues";
  neutralView.excludeHostCues(idleCueList);
  const idleCueLayerExcluded = idleCueList.every((cue) => subtreeExcludedFromJudgingLayer(cue, judgingLayer));
  if (!idleCueLayerExcluded) throw new Error("idle-cue-layer-not-excluded");
  const recorderDest = audio.getRecorderDestination();
  if (!recorderDest) throw new Error("combined-mediarecorder-unstartable");
  startupStage = "capture-stream";
  canvasStream = canvas.captureStream(30);
  const mixed = new MediaStream([
    ...canvasStream.getVideoTracks(),
    ...recorderDest.stream.getAudioTracks(),
  ]);
  startupStage = "native-track-observer";
  const sourceAudioTrack = recorderDest.stream.getAudioTracks()[0];
  const sourceVideoTrack = canvasStream.getVideoTracks()[0];
  if (!sourceAudioTrack || !sourceVideoTrack) throw new Error("native-track-source-missing");
  trackObserver = startNativeTrackObserver({
    audioTrack: sourceAudioTrack,
    videoTrack: sourceVideoTrack,
    readClock: () => serializeAudioGraphClock(readAudioGraphClock(context, performance.now())),
  });
  if (trackObserver.status !== "available") throw new Error("native-track-observer-unavailable:" + trackObserver.reason);
  const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp8,opus")
    ? "video/webm;codecs=vp8,opus"
    : "video/webm";
  recorder = new MediaRecorder(mixed, { mimeType });
  const chunks = [];
  const recorderEvents = [];
  recorder.ondataavailable = (event) => {
    recorderEvents.push(recorderChunkFact(event, performance.now()));
    if (event.data && event.data.size) chunks.push(event.data);
  };
  const stopped = new Promise((resolve) => {
    recorder.onstop = resolve;
  });
  let recorderStartCallAtMs;
  let recorderOnStartAtMs;
  let graphClockAtOnStart;
  const recorderStarted = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("mediarecorder-onstart-timeout:" + startupStage)), 2000);
    recorder.onstart = () => {
      recorderOnStartAtMs = performance.now();
      graphClockAtOnStart = serializeAudioGraphClock(readAudioGraphClock(context, recorderOnStartAtMs));
      clearTimeout(timer);
      resolve();
    };
    recorder.onerror = () => { clearTimeout(timer); reject(new Error("mediarecorder-start-failed:" + startupStage)); };
  });
  startupStage = "recorder-start";
  recorderStartCallAtMs = performance.now();
  const graphClockAtStartCall = serializeAudioGraphClock(readAudioGraphClock(context, recorderStartCallAtMs));
  recorder.start();
  startupStage = "post-start-draw";
  const prerenderFraming = neutralView.render();
  canvasStream.getVideoTracks()[0]?.requestFrame?.();
  await recorderStarted;
  const recorderStartedAtMs = recorderOnStartAtMs;
  const prerender = {
    displayNowMs: performance.now(),
    contextCurrentTime: context.currentTime,
    graphClock: graphClockAtOnStart,
    graphClockAtStartCall,
    graphClockAtOnStart,
    framing: prerenderFraming,
    idleCueVisibility,
    idleCueLayerExcluded,
    recorderStartCallAtMs,
    recorderOnStartAtMs,
    recorderStartedAtMs,
    recorderStartContextTime: context.currentTime,
    contextId: graphClockAtOnStart?.contextId ?? null,
    contextIsGetContext: audio.getContext() === context,
    mediaStreamDestination: {
      type: recorderDest.constructor?.name ?? null,
      streamId: recorderDest.stream?.id ?? null,
      audioTrackReadyState: recorderDest.stream?.getAudioTracks?.()[0]?.readyState ?? null,
      notAnOutputDeviceClock: true,
    },
    startupStage,
  };
  const speechStartedAtMs = performance.now();
  startupStage = "bridge-fire";
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
  const session = ownedSession = audio.sessions.get(input.actorId);
  if (!session) throw new Error("prepared-source-did-not-start");
  if (session.slot.root !== ownedRoot || session.slot.actorSlot !== actorSlot) throw new Error("neutral-host-slot-identity-mismatch");
  if (
    session.slot.mouthCue !== idleCues.mouth
    || session.slot.gazeCue !== idleCues.gaze
    || session.slot.eyeFocusCue !== idleCues.eyeFocus
    || session.slot.expressionCue !== idleCues.expression
  ) throw new Error("started-slot-cue-identity-mismatch");
  startupStage = "observe-host";
  const frames = [];
  const nativeSeconds = input.sampleCount / input.sampleRate;
  const wallStart = performance.now();
  await new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn) => (value) => { if (settled) return; settled = true; fn(value); };
    const ok = finish(resolve);
    const fail = finish(reject);
    clinicalScene.onAfterRender = function afterHostRender() {
      try {
        if (typeof previousAfterRender === "function") previousAfterRender.apply(this, arguments);
        if (settled) return;
        const appliedInfluences = [];
        ownedRoot.traverse((object) => {
          if (!object.isMesh || !object.morphTargetDictionary || !object.morphTargetInfluences) return;
          for (const [targetName, targetIndex] of Object.entries(object.morphTargetDictionary)) {
            if (targetName.startsWith("viseme_") || targetName === "mouth-open") {
              appliedInfluences.push({
                meshName: object.name,
                targetName,
                targetIndex,
                influence: object.morphTargetInfluences[targetIndex],
              });
            }
          }
        });
        const articulation = readOwnedArticulation(neutralView.getRig());
        const drive = session.slot.root?.userData?.openClinXrNamedVisemeDrive;
        const sourcePositionSeconds = session.clockState.lastPosition;
        if (context.state === "running" && session.slot.activeSpeech === session.speech && drive) {
          const row = {
            contextTime: session.clockState.lastContextTime,
            contextCurrentTime: context.currentTime,
            cachedDriverContextTime: session.clockState.lastContextTime,
            callbackSerial: frames.length,
            recorderStartedAtMs,
            hostCallback: "WebGLRenderer.render:scene.onAfterRender",
            appliedInfluences,
            jawWorld: articulation.jaw,
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
            graphClock: serializeAudioGraphClock(readAudioGraphClock(context, performance.now())),
          };
          row.evaluationFraming = neutralView.render(row);
          frames.push(row);
        }
        if (context.currentTime < session.startedWhen + 0.05 && performance.now() - wallStart > 12000) {
          fail(new Error("audio-context-not-advancing"));
          return;
        }
        if (sourcePositionSeconds + 1 / 60 >= nativeSeconds) {
          const waitTap = async () => {
            const deadline = performance.now() + 1500;
            while (audio.getPlayedTap().samples.length < input.sampleCount && performance.now() < deadline) {
              await new Promise((r) => setTimeout(r, 16));
            }
            ok();
          };
          void waitTap();
          return;
        }
      } catch (error) { fail(error); }
    };
    (function watchdog() {
      if (settled) return;
      if (performance.now() - wallStart > nativeSeconds * 1000 + 8000) {
        fail(new Error("capture-duration-timeout"));
        return;
      }
      requestAnimationFrame(watchdog);
    })();
  });
  await new Promise((r) => setTimeout(r, 600));
  recorder.stop();
  await stopped;
  const nativeTrack = trackObserver ? await trackObserver.stop() : null;
  const nativeSamples = nativeTrack?.samples ?? new Float32Array(0);
  const blob = new Blob(chunks, { type: mimeType });
  const video = new Uint8Array(await blob.arrayBuffer());
  const played = audio.getPlayedTap();
  const finalFraming = neutralView.getFraming();
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
    framing: finalFraming,
    recorderStartCallAtMs,
    recorderOnStartAtMs,
    recorderStartedAtMs,
    recorderEvents,
    prerender,
    evaluationScene: "neutral-owned-actor-no-room",
    facialWriter: "actual-ui-xr-host-only",
    nativeTrackObservation: nativeTrack && {
      status: nativeTrack.status,
      reason: nativeTrack.reason ?? null,
      createdAtMs: nativeTrack.createdAtMs,
      cloneCreatedAtMs: nativeTrack.cloneCreatedAtMs,
      processorReadStartAtMs: nativeTrack.processorReadStartAtMs,
      graphClockAtClone: nativeTrack.graphClockAtClone,
      originalAudioTrackId: nativeTrack.originalAudioTrackId,
      originalVideoTrackId: nativeTrack.originalVideoTrackId,
      cloneAudioTrackId: nativeTrack.cloneAudioTrackId,
      cloneVideoTrackId: nativeTrack.cloneVideoTrackId,
      originalAudioReadyState: nativeTrack.originalAudioReadyState,
      originalVideoReadyState: nativeTrack.originalVideoReadyState,
      audioRows: nativeTrack.audioRows,
      videoRows: nativeTrack.videoRows,
      audioClosed: nativeTrack.audioClosed,
      videoClosed: nativeTrack.videoClosed,
      audioPumpError: nativeTrack.audioPumpError ?? null,
      videoPumpError: nativeTrack.videoPumpError ?? null,
      cloneAudioReadyState: nativeTrack.cloneAudioReadyState,
      cloneVideoReadyState: nativeTrack.cloneVideoReadyState,
      audioCopyFailures: nativeTrack.audioCopyFailures,
      videoCopyFailures: nativeTrack.videoCopyFailures,
      audioFramesObserved: nativeTrack.audioFramesObserved,
      videoFramesObserved: nativeTrack.videoFramesObserved,
      sampleCount: nativeSamples.length,
    },
    nativeTrackAudioBase64: nativeSamples.length ? float32ToBase64(nativeSamples) : "",
  };
  } finally {
    let playerStopError;
    try {
      if (recorder && recorder.state !== "inactive") recorder.stop();
      if (ownedSession) {
        if (!ownedSession.player.ended()) await ownedSession.player.stop();
      }
    } catch (error) {
      playerStopError = error;
    } finally {
      if (trackObserver) await trackObserver.stop().catch(() => undefined);
      clinicalScene.onAfterRender = previousAfterRender;
      neutralView.dispose();
      canvasStream?.getTracks().forEach((track) => track.stop());
      URL.revokeObjectURL(tapUrl);
    }
    if (playerStopError) throw playerStopError;
  }
}
