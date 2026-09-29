// Plain-JS checks against the built dist/, so CI can run them on Node versions without type stripping.
import assert from 'node:assert/strict';
import test from 'node:test';

const k = await import('../dist/index.js');

test('parse, match and canonical string', () => {
  const s = k.parseSelector('tier in (b,a), app=web, !legacy');
  assert.equal(s.toString(), 'app=web,!legacy,tier in (a,b)');
  assert.equal(s.matches({ app: 'web', tier: 'a' }), true);
  assert.equal(s.matches({ app: 'web', tier: 'a', legacy: '1' }), false);
});

test('errors carry Go text', () => {
  assert.throws(() => k.parseSelector('=x'), { message: "found '=', expected: !, identifier, or 'end of string'" });
});

test('LabelSelector and field selectors', () => {
  assert.equal(k.labelSelectorAsSelector({ matchLabels: { a: 'b' } }).toString(), 'a=b');
  assert.equal(k.parseFieldSelector('b=1,a!=2').toString(), 'a!=2,b=1');
  assert.deepEqual(k.validateLabelKey('ok'), []);
});
