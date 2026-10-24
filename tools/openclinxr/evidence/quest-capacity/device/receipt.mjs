import { createHash } from 'node:crypto';
import { connect } from 'node:tls';
import { isIP } from 'node:net';
export const jsonSha256 = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
/** Host TLS observation is restricted to the caller's exact test origin. No trust store changes. */
export function observeCertificate(origin) {
  const url = new URL(origin);
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Exact credential-free HTTPS origin required');
  return new Promise((resolve, reject) => {
    const socket = connect({ host: url.hostname, port: Number(url.port || 443), ...(!isIP(url.hostname) ? { servername: url.hostname } : {}), rejectUnauthorized: false });
    const timer = setTimeout(() => { socket.destroy(); reject(new Error('Certificate observation timed out')); }, 5000);
    socket.once('secureConnect', () => {
      clearTimeout(timer);
      const certificate = socket.getPeerCertificate();
      const result = { origin: url.origin, scope: 'host TLS observation of exact service origin', authorizedByHost: socket.authorized, authorizationError: String(socket.authorizationError || ''), fingerprint256: certificate.fingerprint256, validFrom: certificate.valid_from, validTo: certificate.valid_to, subjectAltName: certificate.subjectaltname };
      socket.destroy(); resolve(result);
    });
    socket.once('error', (error) => { clearTimeout(timer); reject(error); });
  });
}
export function assertBuildMetadata(metadata, expectedBuildHash) {
  if (!metadata || !/^sha256:[a-f0-9]{64}$/.test(metadata.capacitySourceHash) || !/^[a-f0-9]{7,64}$/.test(metadata.gitCommit)) throw new Error('Served runtime build identity missing or unknown');
  if (expectedBuildHash && metadata.capacitySourceHash !== expectedBuildHash) throw new Error('Served build does not match expected source fingerprint');
  return {gitCommit:metadata.gitCommit,capacitySourceHash:metadata.capacitySourceHash};
}
export function assertCampaignBuild(raw, metadata, expectedBuildHash) {
  const build = assertBuildMetadata(metadata, expectedBuildHash);
  if (!Array.isArray(raw?.runs) || raw.runs.length < 1 || raw.runs.length > 32) throw new Error('Observed campaign must include bounded runtime records');
  for (const run of raw.runs) {
    if (run.environment?.revision !== build.gitCommit || run.environment?.buildHash !== build.capacitySourceHash) throw new Error('Campaign run build identity differs from served runtime');
  }
  return {...build,expectedBuildHash:expectedBuildHash || null,runCount:raw.runs.length,verifiedAgainst:'served document metadata and external expected fingerprint when supplied'};
}
/** Local collector evidence only; uploaded page claims/UA alone cannot invoke this producer. */
export function sealQuestCampaign(raw, { device, expectedUrl, runtime, buildIdentity, expectedBuildHash }) {
  const url = new URL(expectedUrl);
  if (device.state !== 'device' || !device.model?.includes('Quest') || !device.serial || !device.ownedTargetId || !device.nonce || device.emulationApplied !== false) throw new Error('External ADB/CDP identity missing');
  if (url.searchParams.get('capacityNonce') !== device.nonce || runtime.url !== url.href) throw new Error('Owned page URL/nonce not matched');
  if (!device.cdpVersion?.browser?.includes('OculusBrowser/') || !runtime.userAgent?.includes('Quest')) throw new Error('Quest browser identity inconsistent');
  if (raw?.schema !== 'quest-capacity-campaign.v1' || !Array.isArray(raw.runs) || raw.runs.length > 32) throw new Error('Invalid observed campaign');
  const clientBuild = assertCampaignBuild(raw, buildIdentity, expectedBuildHash);
  const campaign = structuredClone(raw);
  for (const run of campaign.runs) {
    if (!['browser-unverified', 'desktop-browser', 'quest-browser'].includes(run.provenance)) throw new Error('Unexpected page run subject');
    run.provenance = 'quest-browser';
    run.nativeSession = null;
    run.configuration.axes.deviceIdentityTrust = 'external-adb-cdp-receipt';
  }
  const receipt = { schema: 'quest-capacity-collector-receipt.v1', at: new Date().toISOString(), collector: 'sole-device-adb-cdp', serial: device.serial, model: device.model, build: device.build, browser: device.cdpVersion.browser, targetId: device.ownedTargetId, nonce: device.nonce, url: url.href, rawCampaignSha256: jsonSha256(raw), sealedCampaignSha256: jsonSha256(campaign), provenance: 'quest-browser', clientBuild, nativeSession: null, worn: 'unobserved', attestation: 'local collector observation; not signed or accepted as uploaded native authority', notEvidenceFor: ['quest-native', 'worn-headset', 'compositor-frame-rate', 'physical-latency', 'maximum-capacity'] };
  return { campaign, receipt };
}
