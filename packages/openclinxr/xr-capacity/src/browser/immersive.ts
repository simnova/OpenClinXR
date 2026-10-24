export interface ImmersiveObservation { schema: "quest-capacity-immersive-smoke.v1"; requestedAt: number; startedAt: number | null; endedAt: number | null; state: string; sessionMode: "immersive-vr"; frames: number; visibility: string[]; framebuffer: { width: number; height: number } | null; inputSourceCount: number; frameRate: number | null; supportedFrameRates: number[]; reason: string | null; notEvidenceFor: string[] }
/** Must be invoked directly by an explicit user click. It uses the real navigator.xr only. */
export function mountImmersiveControl(container: HTMLElement): () => void {
  let session: XRSession | null = null; let sessionTimer: ReturnType<typeof setTimeout> | undefined; let gl: WebGL2RenderingContext | null = null; let disposed = false;
  const enter = document.createElement("button"); enter.type = "button"; enter.id = "capacity-enter-xr"; enter.textContent = "Enter real immersive VR · explicit permission";
  const exit = document.createElement("button"); exit.type = "button"; exit.textContent = "End immersive session"; exit.disabled = true;
  const output = document.createElement("p"); output.id = "capacity-immersive-status"; output.className = "capacity-muted"; output.textContent = "No immersive session requested. Device control and page timing do not establish worn-headset performance.";
  const observation: ImmersiveObservation = { schema: "quest-capacity-immersive-smoke.v1", requestedAt: 0, startedAt: null, endedAt: null, state: "not-requested", sessionMode: "immersive-vr", frames: 0, visibility: [], framebuffer: null, inputSourceCount: 0, frameRate: null, supportedFrameRates: [], reason: null, notEvidenceFor: ["worn-headset-observation", "maximum-capacity", "compositor-presentation", "physical-comfort", "clinical-validity"] };
  Object.defineProperty(window, "__capacityImmersiveObservation", { configurable: true, get: () => structuredClone(observation) });
  const update = () => { output.textContent = `${observation.state}; ${observation.frames} XR callbacks; visibility ${observation.visibility.join(" → ") || "unobserved"}; ${observation.reason ?? "No native or physical capacity claim."}`; };
  enter.addEventListener("click", () => {
    if (session || disposed) return;
    const xr = navigator.xr;
    observation.requestedAt = performance.now(); observation.state = "requesting"; enter.disabled = true;
    if (!xr) { observation.state = "unsupported"; observation.reason = "WebXR API absent"; enter.disabled = false; update(); return; }
    void xr.requestSession("immersive-vr", { optionalFeatures: ["local-floor"] }).then(async (value) => {
      if (disposed) { await value.end(); return; }
      session = value; sessionTimer = setTimeout(() => { void value.end(); }, 15000); observation.startedAt = performance.now(); observation.state = "active"; exit.disabled = false;
      observation.frameRate = value.frameRate && value.frameRate > 0 ? value.frameRate : null; observation.supportedFrameRates = [...(value.supportedFrameRates ?? [])];
      const visibility = () => { if (observation.visibility.at(-1) !== value.visibilityState) observation.visibility.push(value.visibilityState); update(); };
      visibility(); value.addEventListener("visibilitychange", visibility);
      value.addEventListener("end", () => { observation.state = "ended"; observation.endedAt = performance.now(); value.removeEventListener("visibilitychange", visibility); clearTimeout(sessionTimer); gl?.getExtension("WEBGL_lose_context")?.loseContext(); gl = null; session = null; enter.disabled = false; exit.disabled = true; update(); }, { once: true });
      try {
        const canvas = document.createElement("canvas"); gl = canvas.getContext("webgl2", { xrCompatible: true });
        if (!gl) throw new Error("XR-compatible WebGL2 context unavailable");
        await gl.makeXRCompatible();
        value.updateRenderState({ baseLayer: new XRWebGLLayer(value, gl) });
      } catch (error) { observation.reason = error instanceof Error ? error.message : "XR framebuffer unavailable"; await value.end(); return; }
      const frame = () => { if (session !== value || disposed) return; observation.frames++; observation.inputSourceCount = value.inputSources.length; const layer = value.renderState.baseLayer; if (layer) { observation.framebuffer = { width: layer.framebufferWidth, height: layer.framebufferHeight }; gl?.bindFramebuffer(gl.FRAMEBUFFER, layer.framebuffer); gl?.clearColor(.02, .08, .14, 1); gl?.clear(gl.COLOR_BUFFER_BIT); } if (observation.frames % 60 === 1) update(); value.requestAnimationFrame(frame); };
      value.requestAnimationFrame(frame); update();
    }).catch((error: unknown) => { observation.state = "request-failed"; observation.reason = error instanceof Error ? error.message : "Session request failed"; enter.disabled = false; update(); });
  });
  exit.addEventListener("click", () => { void session?.end(); });
  container.append(enter, exit, output);
  return () => { disposed = true; clearTimeout(sessionTimer); void session?.end(); delete (window as unknown as Record<string, unknown>)['__capacityImmersiveObservation']; };
}
