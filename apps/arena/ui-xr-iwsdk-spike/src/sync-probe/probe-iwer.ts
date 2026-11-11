type NavigatorWithXr = Navigator & {
  xr?: {
    isSessionSupported(mode: string): Promise<boolean>;
    requestSession(mode: string, options?: { optionalFeatures?: string[] }): Promise<XRSession>;
  };
};

export async function installIwerRuntime(forceIwer: boolean) {
  const iwer = await import("iwer");
  const container = document.createElement("div");
  container.id = "sync-probe-iwer-container";
  document.body.appendChild(container);
  const device = new iwer.XRDevice(iwer.metaQuest3, { canvasContainer: container });

  // Host: refuse to run against a real runtime (emulation only). Quest mode
  // (?forceIwer=1) explicitly installs the emulator over the native runtime
  // so root runs the identical deterministic script on-device; this is still
  // IWER emulation, never a native Quest runtime claim.
  if (!forceIwer && device.isNativeXRAvailable() !== false) {
    throw new Error("native XR runtime present; refusing to run emulated probe");
  }
  device.installRuntime(forceIwer ? { forceInstall: true } : undefined);

  const navigatorWithXr = navigator as NavigatorWithXr;
  if (!navigatorWithXr.xr) {
    throw new Error("navigator.xr unavailable after IWER installRuntime");
  }
  const supported = await navigatorWithXr.xr.isSessionSupported("immersive-vr");
  if (!supported) {
    throw new Error("immersive-vr unsupported after installRuntime");
  }
  const session = await navigatorWithXr.xr.requestSession("immersive-vr", {
    optionalFeatures: ["local-floor"],
  });
  return { device, session };
}
