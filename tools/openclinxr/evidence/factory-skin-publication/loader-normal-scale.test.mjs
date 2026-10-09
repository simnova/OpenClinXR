/** Owner controls exercise the exact proposed/live loader derivation AND assertion. */
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';
const source=readFileSync(process.argv[2]??new URL('./loader-proof.mjs',import.meta.url),'utf8');
const begin=source.indexOf('function expectedSkinNormalScale(');const end=source.indexOf('const expectedNormalScale=',begin);assert.ok(begin>=0&&end>begin);
const expectedScale=runInNewContext(source.slice(begin,end)+';expectedSkinNormalScale');
const line=source.split('\n').find(s=>s.includes('for(const b of loaded.bindings)')&&s.includes('loaded normalScale mismatch'));assert.ok(line?.includes('expectedNormalScale[0]')&&line?.includes('expectedNormalScale[1]'));
const check=new Function('loaded','expectedNormalScale',line);
const doc=modes=>({meshes:[{primitives:modes.map(t=>({material:0,attributes:t?{TANGENT:1}:{}}))}]});
const actual=scale=>({bindings:[{normalScale:scale}]});
test('actual derivative-tangent loader sign passes; wrong Y fails',()=>{const expected=Array.from(expectedScale(doc([false]),0,1));assert.deepEqual(expected,[1,-1]);check(actual([1,-1]),expected);assert.throws(()=>check(actual([1,1]),expected),/loaded normalScale mismatch/);});
test('authored tangent scale passes; derivative sign wrongly applied fails',()=>{const expected=Array.from(expectedScale(doc([true]),0,0.75));assert.deepEqual(expected,[0.75,0.75]);check(actual([0.75,0.75]),expected);assert.throws(()=>check(actual([0.75,-0.75]),expected),/loaded normalScale mismatch/);});
test('mixed or absent skin primitive support fails closed',()=>{assert.throws(()=>expectedScale(doc([false,true]),0,1),/mixed skin tangent/);assert.throws(()=>expectedScale(doc([]),0,1),/skin primitive missing/);});
