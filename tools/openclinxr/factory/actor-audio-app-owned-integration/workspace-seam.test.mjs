import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
const root = process.cwd();
const text = p => readFileSync(resolve(root, p), 'utf8');
test('the actual named public factory importer belongs to the app that declares its workspace dependency', () => {
  const p = JSON.parse(text('apps/ui-xr/package.json'));
  assert.equal(p.dependencies['@openclinxr/xr-dialogue'], 'workspace:*');
  const source = text('apps/ui-xr/tests/actor-audio-compat.ts');
  assert.match(source, /import\s*\{\s*createActorAudioRuntime\s*\}\s*from\s*["']@openclinxr\/xr-dialogue\/actor-audio-runtime["']/);
  assert.doesNotMatch(source, /new\s+Map\s*\(|createBufferSource\s*\(|Object\.defineProperty\s*\(/);
  assert.equal(existsSync(resolve(root,'tools/openclinxr/factory/actor-audio-package-subpath-integration/prepared-actor-audio-compat.ts')), false);
});
test('the root runner consumes the app-owned test facade and retains only named historical-reader exclusions', () => {
  const source = text('vitest.config.ts');
  assert.match(source, /apps\/ui-xr\/tests\/actor-audio-compat\.ts/);
  assert.match(source, /mergeConfig\(nodeConfig/);
  for (const named of ['audible-lip-sync-proof/capture.test.mjs','audible-lip-sync-proof/source-wiring.test.mjs','actor-audio-package-subpath-integration/historical-test-compatibility.test.ts']) assert.ok(source.includes(named));
  assert.doesNotMatch(source, /audible-lip-sync-proof\/(?:\*|\*\*)/);
  assert.doesNotMatch(source, /actor-audio-package-subpath-integration\/(?:\*|\*\*)/);
});
test('the app-installed package resolves the admitted public subpath without a new root dependency', () => {
  const appRequire = createRequire(resolve(root,'apps/ui-xr/package.json'));
  assert.match(appRequire.resolve('@openclinxr/xr-dialogue/actor-audio-runtime'), /xr-dialogue\/dist\/actor-audio-runtime\.js$/);
  const p = JSON.parse(text('package.json'));
  assert.equal(p.dependencies?.['@openclinxr/xr-dialogue'], undefined);
  assert.equal(p.devDependencies?.['@openclinxr/xr-dialogue'], undefined);
});
