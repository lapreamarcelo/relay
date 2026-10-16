// Controlled replay of Matte's shipped helper library, not its native editor.
// Reads the installed resource; does not copy or modify Matte's implementation.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const path = '/Applications/Matte.app/Contents/Resources/CodeClipHelpers.js';
const source = readFileSync(path, 'utf8');
const context = vm.createContext({});
vm.runInContext(source, context, { timeout: 1000, filename: path });
const M = context.makeM(class Path2DStub {});
// The arriving key's easing is used by this subsystem.
const keys = [[0, 0, 'linear'], [1, 100, 'inQuad']];
assert.equal(M.tween(.5, keys), 25);
assert.equal(M.tween(-1, keys), 0);
assert.equal(M.tween(2, keys), 100);
assert.equal(M.tween(.5, [[0, 1], [1, 4, 'linear']], { perceptual: true }), 2);
const times = [0, .1, .2, .3, .6, 1];
const spring = times.map(t => ({ t, value: M.spring(t) }));
assert.equal(spring[0].value, 0);
assert.ok(spring.every(p => Number.isFinite(p.value)));
// Arbitrary evaluation order must give the same helper results.
for (const t of [...times].reverse()) assert.equal(M.spring(t), spring.find(p => p.t === t).value);
const a = M.random(42), b = M.random(42);
const random = Array.from({ length: 5 }, () => a());
assert.deepEqual(random, Array.from({ length: 5 }, () => b()));
assert.deepEqual(Array.from(M.screenPoint({ screen: [[0,0],[100,0],[100,200],[0,200]] }, .5, .5)), [50,100]);

console.log(JSON.stringify({
  evidenceType: 'controlled-replay-of-shipped-javascript-helper',
  path,
  sha256: createHash('sha256').update(source).digest('hex'),
  verified: ['arriving-key-easing', 'endpoint-holds', 'geometric-scale-interpolation', 'arbitrary-time-spring-evaluation', 'seeded-random-repeatability', 'screen-coordinate-projection'],
  easingNames: Object.keys(M.ease),
  tweenAtHalf: M.tween(.5, keys),
  perceptualScaleAtHalf: M.scaleLerp(1,4,.5),
  defaultSpringSamples: spring,
  random,
  limitations: ['Does not execute Matte native editor, native animation evaluator, renderer, or exporter.', 'Path2D is stubbed; drawing and font layout are not exercised.', 'Native preset spring curveParameter is a separate unverified mapping.']
}, null, 2));
