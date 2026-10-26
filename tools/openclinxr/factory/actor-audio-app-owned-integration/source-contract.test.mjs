import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertClock, assertSyncNotMovedOutsideFrame, extractModuleSpecs } from './source-contract.mjs';

const good = `const stepActorSimulation = (deltaSeconds: number, now: number): void => { updateGeneratedHumanoidAnimations(deltaSeconds, now); };
function renderSceneFrame(timestamp?: number): void { syncPreparedActorAudio(frameNowMs); if (!fixedClockDisabled) { stepFixedClockFrame(fixedClockFrame, { frameDtSeconds: frameDtSeconds, nowMs: frameNowMs, simulate: stepActorSimulation }); } else { stepActorSimulation(frameDtSeconds, frameNowMs); } }`;

test('shared contract proves sync-before-dispatch causality on real layout', () => assertClock(good));

test('shared contract rejects sync moved outside the frame callback', () => {
  const moved = good.replace('syncPreparedActorAudio(frameNowMs); ', '').replace(
    '} else { stepActorSimulation(frameDtSeconds, frameNowMs); }',
    '} else { stepActorSimulation(frameDtSeconds, frameNowMs); } syncPreparedActorAudio(frameNowMs);',
  );
  assert.throws(() => assertClock(moved), /precedes fixed-clock dispatch/);
});

test('shared contract rejects detached simulate target', () => {
  assert.throws(
    () => assertClock(good.replace('simulate: stepActorSimulation', 'simulate: stepDetachedSimulation')),
    /points at the named simulation callback/,
  );
});

test('shared contract rejects facial loop driven outside the named callback', () => {
  const elsewhere = good
    .replace('updateGeneratedHumanoidAnimations(deltaSeconds, now); ', '')
    .replace(
      'syncPreparedActorAudio(frameNowMs);',
      'updateGeneratedHumanoidAnimations(deltaSeconds, now); syncPreparedActorAudio(frameNowMs);',
    );
  assert.throws(() => assertClock(elsewhere), /drives the facial loop on the same tick/);
});

test('shared contract rejects separate lexical frame callbacks despite global order', () => {
  const bad = `const stepActorSimulation = (deltaSeconds: number, now: number): void => { updateGeneratedHumanoidAnimations(deltaSeconds, now); };
const detached = () => { syncPreparedActorAudio(frameNowMs); };
const frame = () => { if (!fixedClockDisabled) { stepFixedClockFrame(fixedClockFrame, {simulate:stepActorSimulation}); } else { stepActorSimulation(frameDtSeconds, frameNowMs); } };`;
  assert.throws(() => assertClock(bad), /same lexical frame callback/);
});

test('shared contract helper rejects sync moved outside frame via host oracle', () => {
  assertSyncNotMovedOutsideFrame(good, (s) => assertClock(s));
});

test('shared contract rejects unwrapped top-level fragment without a lexical frame callback', () => {
  const unwrapped = `const stepActorSimulation = (deltaSeconds: number, now: number): void => { updateGeneratedHumanoidAnimations(deltaSeconds, now); };
syncPreparedActorAudio(frameNowMs); if (!fixedClockDisabled) { stepFixedClockFrame(fixedClockFrame, { frameDtSeconds: frameDtSeconds, nowMs: frameNowMs, simulate: stepActorSimulation }); } else { stepActorSimulation(frameDtSeconds, frameNowMs); }`;
  assert.throws(() => assertClock(unwrapped), /same lexical frame callback/);
});

test('extractor reports static, dynamic, and require specifiers, never comments', () => {
  const src = `import a from '@openclinxr/xr-dialogue/actor-audio-runtime';
export * from '@openclinxr/xr-dialogue/other';
// import dead from '@openclinxr/xr-dialogue/dead';
const x = await import('@openclinxr/xr-dialogue/lazy');
const y = require('@openclinxr/xr-dialogue/legacy');
const z = './not-a-specifier: just a string';`;
  assert.deepEqual(extractModuleSpecs(src), [
    '@openclinxr/xr-dialogue/actor-audio-runtime',
    '@openclinxr/xr-dialogue/lazy',
    '@openclinxr/xr-dialogue/legacy',
    '@openclinxr/xr-dialogue/other',
  ]);
});

test('extractor surfaces no-substitution template private spec for boundary rejection', () => {
  const specs = extractModuleSpecs('const lazy = import(`@openclinxr/xr-dialogue/private`);');
  assert.ok(specs.includes('@openclinxr/xr-dialogue/private'), 'template literal spec is extracted, never escapes');
  const admitted = ['@openclinxr/xr-dialogue/actor-audio-runtime'];
  assert.ok(!admitted.includes('@openclinxr/xr-dialogue/private'), 'private template spec rejected by the same allowed-set logic');
});

test('extractor surfaces barrel, admitted, and private specifiers for boundary checks', () => {
  const specs = extractModuleSpecs(`import a from '@openclinxr/xr-dialogue';
import b from '@openclinxr/xr-dialogue/actor-audio-runtime';
const c = require('@openclinxr/xr-dialogue/internal-secret');`);
  assert.deepEqual(specs, [
    '@openclinxr/xr-dialogue',
    '@openclinxr/xr-dialogue/actor-audio-runtime',
    '@openclinxr/xr-dialogue/internal-secret',
  ]);
});
