/** Page identity is a declaration. The external ADB/CDP envelope authenticates hardware separately. */
export function browserIdentity(userAgent = navigator.userAgent): { provenance: "desktop-browser" | "browser-unverified"; device: string; label: string } {
  const quest = /OculusBrowser|MetaQuest|Quest [23S]/i.test(userAgent);
  return quest
    ? { provenance: "browser-unverified", device: "Quest browser (user-agent hint; external device proof separate)", label: "QUEST BROWSER · 2D PAGE · DEVICE IDENTITY REQUIRES EXTERNAL ADB/CDP PROOF" }
    : { provenance: "desktop-browser", device: "unverified browser host", label: "DESKTOP BROWSER · BOUNDED SMOKE EVIDENCE · NO HEADSET MEASUREMENTS" };
}
