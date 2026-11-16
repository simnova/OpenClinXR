export const storeRoot = process.env.OPENCLINXR_LIPSYNC_STORE_ROOT ?? "/Volumes/files/openclinxr-assets/store/lip-sync-packet-20260916/execution-packet";
export default {
  "sourcePath": "/Users/patrick/.openclinxr-tools/rhubarb/extras/AdobeAfterEffects/demo/riddle.wav",
  "retainedPrivatePath": "/Users/patrick/.openclinxr-tools/rhubarb/extras/AdobeAfterEffects/demo/riddle.wav",
  "sha256": "dc9370f8f4d6fb104ee526f2eb5da0d4697e44b03309cba13ee8aba52c0ca87c",
  "bytes": 639198,
  "sampleRate": 22050,
  "sampleCount": 317009,
  "channels": 1,
  "sampleWidth": 2,
  "rights": "Installed Rhubarb v1.14.0 demo from tagged Git LFS object, repository MIT notices retained. Local diagnostic input only; no input audio or audio-bearing output is committed, published, or claimed as a licensed actor voice. Future product voice clearance remains separate.",
  "taggedOrigin": "https://github.com/DanielSWolf/rhubarb-lip-sync/blob/v1.14.0/extras/AdobeAfterEffects/demo/riddle.wav",
  "taggedLfsObjectMatches": true,
  "notEvidenceFor": [
    "phone alignment",
    "provider voice authorization",
    "live provider readiness"
  ],
  "cueSource": "Rhubarb1.14.0 freshly run against exact retained waveform; approximate nine-shape timing, not per-phone accuracy",
  "cuePath": storeRoot + "/existing-rhubarb-demo/fresh-mouth-cues.json",
  "cueSha256": "bf5d6ec9179f9bf9c76176ded8c8b9a7a028ccf52c7f3448344d2b8a19403a8b",
  "cueCount": 72,
  "proofReportPath": storeRoot + "/proof-output/latest-report.json",
  "cdpProbeDir": storeRoot + "/browser-cdp-module-probe-1789613971918",
  "factoryProofReportPath": storeRoot + "/factory-proof-output/latest-report.json",
  "requiredSourceRoles": {
    "playback": "tools/openclinxr/evidence/audible-lip-sync-proof/playback.mjs",
    "capturePage": "tools/openclinxr/evidence/audible-lip-sync-proof/capture-page.mjs",
    "audioTap": "tools/openclinxr/evidence/audible-lip-sync-proof/audio-tap.mjs",
    "admittedRig": "packages/openclinxr/xr-dialogue/src/viseme-runtime-wire.ts",
    "consumedHost": "apps/ui-xr/src/main.ts",
    "preparedAudio": "apps/ui-xr/src/prepared-actor-audio.ts",
    "lateCueJoin": "packages/openclinxr/xr-dialogue/src/viseme-baked-cues.ts",
    "asset": "apps/ui-xr/public/generated-humanoids/mpfb-gown-adult-patient.glb"
  },
  "frozenSourceHashes": {
    "asset": "8da37c5707958d7a4f8f8a89222d76ea6c0d3c2f18eb903d56c7f4d8727befcf"
  }
};
