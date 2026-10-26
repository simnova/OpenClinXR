import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, join, extname } from 'node:path';
import { extractModuleSpecs } from './source-contract.mjs';
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
test('the app-installed package resolves the admitted public subpath without a new root production dependency', () => {
  const appRequire = createRequire(resolve(root,'apps/ui-xr/package.json'));
  assert.match(appRequire.resolve('@openclinxr/xr-dialogue/actor-audio-runtime'), /xr-dialogue\/dist\/actor-audio-runtime\.js$/);
  const p = JSON.parse(text('package.json'));
  assert.equal(p.dependencies?.['@openclinxr/xr-dialogue'], undefined);
  assert.equal(p.devDependencies?.['@openclinxr/xr-dialogue'], 'workspace:*');
  const xp = JSON.parse(text('packages/openclinxr/xr-dialogue/package.json'));
  const admitted = Object.keys(xp.exports || {}).map(k => k === '.' ? '@openclinxr/xr-dialogue' : '@openclinxr/xr-dialogue/' + k.replace(/^\.\//,''));
    // Bounded deterministic walk of actual root tool sources only, parsed with the
  // shared dependency-free extractor: static imports, re-exports, dynamic
  // import(), and require() are all extracted. Build output, archives, evidence blobs and
  // worktrees are never source imports.
  const skipDirs = new Set(['node_modules','dist','.git','.openclinxr','.openclinxr-local','proof-output','worktrees','coverage']);
  const skipExts = new Set(['.zip','.glb','.gltf','.png','.jpg','.jpeg','.wav','.mp3','.ogg','.pdf','.bin','.exr']);
  const srcExts = new Set(['.ts','.tsx','.mjs','.js','.mts','.cts']);
  const specs = new Set();
  let visited = 0;
  // User-forbidden inputs are never read or traversed: any path part starting
  // with .env or containing .bak is skipped before readdir/read.
  const forbiddenPart = name => name.startsWith('.env') || name.includes('.bak');
  const walk = dir => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (forbiddenPart(e.name)) continue;
      if (e.isDirectory()) { if (!skipDirs.has(e.name)) walk(join(dir, e.name)); continue; }
      const ext = extname(e.name).toLowerCase();
      if (skipExts.has(ext) || !srcExts.has(ext)) continue;
      if (++visited > 5000) throw new Error('tool source walk exceeded bound');
      for (const spec of extractModuleSpecs(readFileSync(join(dir, e.name), 'utf8'), e.name)) {
        if (spec.startsWith('@openclinxr/xr-dialogue')) specs.add(spec);
      }
    }
  };
  walk(resolve(root, 'tools'));
  assert.ok(specs.size >= 1, 'root tools actually consume the package (pnpm strict resolution needs the dev dependency)');
  for (const spec of [...specs].sort()) assert.ok(admitted.includes(spec), 'root tools bind only admitted public subpaths, actual ' + spec);
  for (const spec of [...specs].sort()) assert.doesNotMatch(spec, /^@openclinxr\/xr-dialogue$/, 'root tools never bind the root barrel');
});

test('root tool sources admit no private or barrel dynamic imports', () => {
  const src = text('tools/openclinxr/factory/actor-audio-app-owned-integration/workspace-seam.test.mjs');
  const specs = extractModuleSpecs(src, 'workspace-seam.test.mjs');
  assert.ok(specs.includes('./source-contract.mjs'));
  assert.equal(specs.filter(s => s.startsWith('@openclinxr/xr-dialogue')).length, 0);
});
