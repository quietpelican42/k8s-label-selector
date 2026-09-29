import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  SelectorError,
  everything,
  formatLabelSelector,
  labelSelectorAsMap,
  labelSelectorAsSelector,
  matches,
  newRequirement,
  nothing,
  parseFieldSelector,
  parseSelector,
  parseToLabelSelector,
  selectorFromSet,
  setAsLabelSelector,
  validateLabelKey,
  validateLabelValue,
  escapeFieldValue,
  unescapeFieldValue,
} from '../src/index.ts';

describe('label selectors', () => {
  test('canonical string sorts requirements and values', () => {
    assert.equal(parseSelector('b = 1, a in (z, y, y), !c').toString(), 'a in (y,z),b=1,!c');
    assert.equal(parseSelector('x in (foo,,baz),y,z notin ()').toString(), 'x in (,baz,foo),y,z notin ()');
  });

  test('exact grammar: keywords are valid keys and values', () => {
    assert.equal(parseSelector('in in (in)').toString(), 'in in (in)');
    assert.equal(parseSelector('notin=notin').toString(), 'notin=notin');
  });

  test('error text matches apimachinery', () => {
    assert.throws(() => parseSelector('a in (b'), { message: "unable to parse requirement: found '', expected: ',' or ')'" });
    assert.throws(() => parseSelector('=b'), { message: "found '=', expected: !, identifier, or 'end of string'" });
    assert.throws(() => parseSelector('a=b c'), SelectorError);
  });

  test('matching semantics', () => {
    assert.equal(matches('', {}), true);
    assert.equal(matches('a!=b', {}), true);
    assert.equal(matches('a notin (b)', {}), true);
    assert.equal(matches('a=b', {}), false);
    assert.equal(matches('!a', { a: '' }), false);
    assert.equal(matches('a>1', { a: '2' }), true);
    assert.equal(matches('a<1', { a: 'x' }), false);
    assert.equal(matches('a=b', new Map([['a', 'b']])), true);
    assert.equal(matches('toString', {}), false); // no prototype lookups
  });

  test('negative control: valid selectors never throw', () => {
    for (const s of ['app=web', 'app!=web', 'app in (a,b)', 'app notin (a)', 'app', '!app', 'a==b', 'a=']) {
      assert.doesNotThrow(() => parseSelector(s), s);
    }
  });

  test('selectorFromSet and requiresExactMatch', () => {
    const s = selectorFromSet({ b: '2', a: '1' });
    assert.equal(s.toString(), 'a=1,b=2');
    assert.equal(s.requiresExactMatch('a'), '1');
    assert.equal(s.requiresExactMatch('z'), undefined);
    assert.equal(selectorFromSet(null).empty(), true);
  });

  test('nothing and everything', () => {
    assert.equal(nothing().matches({}), false);
    assert.equal(nothing().empty(), false);
    assert.equal(everything().matches({ a: 'b' }), true);
  });

  test('newRequirement keeps caller order, String sorts', () => {
    const r = newRequirement('k', 'in', ['b', 'a', 'a']);
    assert.deepEqual(r.valuesUnsorted(), ['b', 'a', 'a']);
    assert.deepEqual(r.values(), ['a', 'b']);
    assert.equal(r.toString(), 'k in (a,a,b)');
    assert.throws(() => newRequirement('k', 'in', null), { message: `values: Invalid value: null: for 'in', 'notin' operators, values set can't be empty` });
  });

  test('validators return Go strings', () => {
    assert.deepEqual(validateLabelKey('app'), []);
    assert.deepEqual(validateLabelValue(''), []);
    assert.deepEqual(validateLabelValue('x'.repeat(64)).slice(0, 1), ['must be no more than 63 bytes']);
    assert.equal(validateLabelKey('/a')[0], 'prefix part must be non-empty');
  });

  test('long adversarial input validates in linear time', () => {
    const start = Date.now();
    validateLabelKey('a'.repeat(200000) + '!/x');
    validateLabelKey('a.'.repeat(100000) + '!');
    assert.ok(Date.now() - start < 1000);
  });
});

describe('LabelSelector objects', () => {
  test('conversion', () => {
    const s = labelSelectorAsSelector({
      matchLabels: { app: 'web' },
      matchExpressions: [{ key: 'tier', operator: 'In', values: ['b', 'a'] }, { key: 'x', operator: 'DoesNotExist' }],
    });
    assert.equal(s.toString(), 'app=web,tier in (a,b),!x');
    assert.equal(labelSelectorAsSelector(null).matches({}), false);
    assert.equal(labelSelectorAsSelector({}).matches({}), true);
    assert.throws(() => labelSelectorAsSelector({ matchExpressions: [{ key: 'a', operator: 'In', values: [] }] }), {
      message: `values: Invalid value: null: for 'in', 'notin' operators, values set can't be empty`,
    });
    assert.throws(() => labelSelectorAsSelector({ matchExpressions: [{ key: 'a', operator: 'Gt', values: ['1'] }] }), {
      message: '"Gt" is not a valid label selector operator',
    });
  });

  test('reverse direction', () => {
    assert.deepEqual(parseToLabelSelector('a=1,b in (y,x),!c'), {
      matchLabels: { a: '1' },
      matchExpressions: [
        { key: 'b', operator: 'In', values: ['x', 'y'] },
        { key: 'c', operator: 'DoesNotExist', values: [] },
      ],
    });
    assert.deepEqual(labelSelectorAsMap({ matchLabels: { a: '1' }, matchExpressions: [{ key: 'b', operator: 'In', values: ['2'] }] }), { a: '1', b: '2' });
    assert.deepEqual(setAsLabelSelector({ a: '1' }), { matchLabels: { a: '1' } });
    assert.equal(formatLabelSelector({}), '<none>');
    assert.equal(formatLabelSelector({ matchLabels: { '-': 'x' } }), '<error>');
  });
});

describe('field selectors', () => {
  test('parse, sort, escape', () => {
    const s = parseFieldSelector('status.phase!=Failed,metadata.name==a\\,b');
    assert.equal(s.toString(), 'metadata.name=a\\,b,status.phase!=Failed');
    assert.equal(s.matches({ 'metadata.name': 'a,b', 'status.phase': 'Running' }), true);
    assert.equal(s.matches({ 'metadata.name': 'a,b' }), true); // missing field reads as ""
    assert.equal(parseFieldSelector('a=').matches({}), true);
    assert.equal(parseFieldSelector('=').empty(), true);
  });

  test('errors match apimachinery', () => {
    assert.throws(() => parseFieldSelector('a'), { message: "invalid selector: 'a'; can't understand 'a'" });
    assert.throws(() => parseFieldSelector('a=b=c'), { message: 'invalid field selector: unescaped character in value: 61' });
    assert.throws(() => parseFieldSelector('a=\\x'), { message: 'invalid field selector: invalid escape sequence: \\x' });
  });

  test('escape round trip', () => {
    const v = 'a,b=c\\d';
    assert.equal(unescapeFieldValue(escapeFieldValue(v)), v);
  });
});
