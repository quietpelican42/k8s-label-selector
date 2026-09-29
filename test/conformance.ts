import assert from 'node:assert/strict';

import {
  SelectorError,
  formatLabelSelector,
  labelSelectorAsMap,
  labelSelectorAsSelector,
  newRequirement,
  parseFieldSelector,
  parseSelector,
  parseToLabelSelector,
  selectorFromSet,
  unescapeFieldValue,
  escapeFieldValue,
  validateLabelKey,
  validateLabelValue,
  validatedSelectorFromSet,
  fieldSelectorFromSet,
  type Selector,
  type FieldSelector,
} from '../src/index.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Rec = Record<string, any>;
type StrMap = Record<string, string>;

/** Run `fn`; return its value, or the SelectorError message. */
function attempt<T>(fn: () => T): { ok: true; value: T } | { ok: false; error: string } {
  try {
    return { ok: true, value: fn() };
  } catch (e) {
    if (e instanceof SelectorError) return { ok: false, error: e.message };
    throw e;
  }
}

function bits(sel: { matches(m: StrMap): boolean }, sets: StrMap[]): string {
  return sets.map((s) => (sel.matches(s) ? '1' : '0')).join('');
}

function checkLabelSelector(sel: Selector, rec: Rec): void {
  assert.equal(sel.toString(), rec.str ?? '', 'String()');
  assert.equal(sel.empty(), Boolean(rec.em), 'Empty()');
  assert.deepEqual(
    sel.requirements().map((r) => ({ k: r.key, o: r.operator, v: r.values() })),
    rec.rq ?? [],
    'requirements',
  );
  assert.equal(bits(sel, rec.ls ?? []), rec.m ?? '', 'match results');
}

function normalizeLs(o: any): any {
  const out: Rec = {};
  if (o && Object.keys(o.matchLabels ?? {}).length) out.matchLabels = o.matchLabels;
  if (o && (o.matchExpressions ?? []).length) {
    out.matchExpressions = o.matchExpressions.map((e: Rec) => ({
      key: e.key,
      operator: e.operator,
      ...(e.values && e.values.length ? { values: e.values } : {}),
    }));
  }
  return out;
}

function checkRx(sel: { requiresExactMatch(k: string): string | undefined }, rx: Rec[] | undefined): void {
  for (const r of rx ?? []) {
    const got = sel.requiresExactMatch(r.k);
    assert.equal(got !== undefined, Boolean(r.f), `requiresExactMatch(${r.k}) found`);
    assert.equal(got ?? '', r.v ?? '', `requiresExactMatch(${r.k}) value`);
  }
}

export function checkRecord(rec: Rec): void {
  switch (rec.t) {
    case 'sel': {
      const r = attempt(() => parseSelector(rec.s));
      if (rec.ok) {
        assert.ok(r.ok, `parse failed: ${r.ok ? '' : r.error}`);
        if (r.ok) {
          checkLabelSelector(r.value, rec);
          checkRx(r.value, rec.rx);
        }
      } else {
        assert.ok(!r.ok, 'parse should fail');
        if (!r.ok) assert.equal(r.error, rec.e);
      }
      const p = attempt(() => parseToLabelSelector(rec.s));
      if (rec.pls.ok) {
        assert.ok(p.ok);
        if (p.ok) assert.deepEqual(normalizeLs(p.value), normalizeLs(rec.pls.o));
      } else {
        assert.ok(!p.ok);
        if (!p.ok) assert.equal(p.error, rec.pls.e);
      }
      return;
    }
    case 'lsel': {
      const r = attempt(() => labelSelectorAsSelector(rec.o));
      if (rec.ok) {
        assert.ok(r.ok, `conversion failed: ${r.ok ? '' : r.error}`);
        if (r.ok) {
          checkLabelSelector(r.value, rec);
          assert.equal(!r.value.selectable, Boolean(rec.nothing), 'selectable');
        }
      } else {
        assert.ok(!r.ok);
        if (!r.ok) assert.equal(r.error, rec.e);
      }
      assert.equal(formatLabelSelector(rec.o), rec.fmt, 'formatLabelSelector');
      const m = attempt(() => labelSelectorAsMap(rec.o));
      if (rec.map.ok) {
        assert.ok(m.ok);
        if (m.ok) {
          if (rec.map.nil) assert.equal(m.value, null);
          else assert.deepEqual(m.value, rec.map.m ?? {});
        }
      } else {
        assert.ok(!m.ok);
        if (!m.ok) assert.equal(m.error, rec.map.e);
      }
      return;
    }
    case 'req': {
      const r = attempt(() => newRequirement(rec.key, rec.op, rec.vals));
      if (rec.ok) {
        assert.ok(r.ok, `newRequirement failed: ${r.ok ? '' : r.error}`);
        if (r.ok) {
          assert.equal(r.value.toString(), rec.str);
          assert.deepEqual(r.value.valuesUnsorted(), rec.uns ?? []);
          assert.deepEqual(r.value.values(), rec.srt ?? []);
          assert.equal(bits({ matches: (m) => r.value.matches(m) }, rec.ls), rec.m);
        }
      } else {
        assert.ok(!r.ok);
        if (!r.ok) assert.equal(r.error, rec.e);
      }
      return;
    }
    case 'set': {
      const sel = selectorFromSet(rec.set);
      assert.equal(sel.toString(), rec.str);
      assert.equal(sel.empty(), rec.em);
      assert.equal(bits(sel, rec.ls), rec.m);
      const v = attempt(() => validatedSelectorFromSet(rec.set));
      if (rec.vok) {
        assert.ok(v.ok);
        if (v.ok) assert.equal(v.value.toString(), rec.vstr ?? '');
      } else {
        assert.ok(!v.ok);
        if (!v.ok) assert.equal(v.error, rec.ve);
      }
      return;
    }
    case 'val':
      assert.deepEqual(validateLabelKey(rec.s), rec.key, `validateLabelKey(${JSON.stringify(rec.s)})`);
      assert.deepEqual(validateLabelValue(rec.s), rec.val, `validateLabelValue(${JSON.stringify(rec.s)})`);
      return;
    case 'fld': {
      const r = attempt(() => parseFieldSelector(rec.s));
      if (rec.ok) {
        assert.ok(r.ok, `parse failed: ${r.ok ? '' : r.error}`);
        if (r.ok) {
          const sel: FieldSelector = r.value;
          assert.equal(sel.toString(), rec.str ?? '');
          assert.equal(sel.empty(), Boolean(rec.em));
          assert.deepEqual(
            sel.requirements().map((q) => ({ o: q.operator, f: q.field, v: q.value })),
            rec.rq ?? [],
          );
          assert.equal(bits(sel, rec.fs ?? []), rec.m ?? '');
          checkRx(sel, rec.rx);
          // fieldSelectorFromSet round trip on the exact-match terms
          const eq: StrMap = {};
          for (const q of sel.requirements()) if (q.operator === '=') eq[q.field] = q.value;
          const from = fieldSelectorFromSet(eq);
          assert.equal(from.requirements().length, Object.keys(eq).length);
        }
      } else {
        assert.ok(!r.ok, 'parse should fail');
        if (!r.ok) assert.equal(r.error, rec.e);
      }
      return;
    }
    case 'esc': {
      assert.equal(escapeFieldValue(rec.v), rec.esc);
      const u = attempt(() => unescapeFieldValue(rec.v));
      if (rec.ok) {
        assert.ok(u.ok);
        if (u.ok) assert.equal(u.value, rec.out ?? '');
      } else {
        assert.ok(!u.ok);
        if (!u.ok) assert.equal(u.error, rec.e);
      }
      return;
    }
    default:
      throw new Error(`unknown record type ${String(rec.t)}`);
  }
}

export interface Tally {
  records: number;
  failures: { line: number; rec: Rec; message: string }[];
  counts: Record<string, number>;
  valid: Record<string, number>;
  matchCases: number;
}

/** Check every JSONL line; collect failures rather than stopping at the first. */
export function checkLines(lines: string[]): Tally {
  const tally: Tally = { records: 0, failures: [], counts: {}, valid: {}, matchCases: 0 };
  lines.forEach((line, i) => {
    if (line === '') return;
    const rec = JSON.parse(line) as Rec;
    tally.records++;
    tally.counts[rec.t] = (tally.counts[rec.t] ?? 0) + 1;
    if (rec.ok) tally.valid[rec.t] = (tally.valid[rec.t] ?? 0) + 1;
    tally.matchCases += (rec.m ?? '').length;
    try {
      checkRecord(rec);
    } catch (e) {
      tally.failures.push({ line: i + 1, rec, message: e instanceof Error ? e.message : String(e) });
    }
  });
  return tally;
}
