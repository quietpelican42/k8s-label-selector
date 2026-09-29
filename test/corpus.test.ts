import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { gunzipSync } from 'node:zlib';

import { checkLines } from './conformance.ts';

const path = new URL('./fixtures/corpus.jsonl.gz', import.meta.url);

test('agrees with the Go corpus (apimachinery v0.37.1)', () => {
  const lines = gunzipSync(readFileSync(path)).toString('utf8').split('\n');
  const t = checkLines(lines);
  for (const f of t.failures.slice(0, 5)) {
    console.error(`line ${f.line}: ${JSON.stringify(f.rec).slice(0, 300)}\n  ${f.message.split('\n')[0]}`);
  }
  assert.equal(t.failures.length, 0, `${t.failures.length} of ${t.records} records disagree with Go`);
  // The corpus must stay big enough to mean something.
  assert.ok(t.counts.sel! >= 20000, `selectors: ${t.counts.sel}`);
  assert.ok(t.matchCases >= 20000, `match cases: ${t.matchCases}`);
  assert.ok(t.counts.lsel! >= 5000, `LabelSelector objects: ${t.counts.lsel}`);
  assert.ok(t.counts.fld! >= 5000, `field selectors: ${t.counts.fld}`);
  console.log(
    `checked ${t.records} records: ${JSON.stringify(t.counts)}, valid ${JSON.stringify(t.valid)}, ${t.matchCases} match results`,
  );
});
