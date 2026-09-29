import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { checkLines } from './conformance.ts';

const genDir = new URL('../gen/', import.meta.url).pathname;
const have = spawnSync('go', ['version'], { encoding: 'utf8', timeout: 20000 });

test('live: fresh random corpus from the Go generator', { skip: have.status !== 0 && 'SKIPPED LOUDLY: `go` not found on PATH; install Go to run the live oracle test' }, (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'k8ssel-'));
  try {
    const seed = String(Math.floor(Math.random() * 1e9));
    const out = join(dir, 'corpus.jsonl');
    const run = spawnSync('go', ['run', '.', '-seed', seed, '-scale', process.env.K8SSEL_SCALE ?? '0.15', '-out', out], {
      cwd: genDir,
      encoding: 'utf8',
      timeout: 180000,
      env: { ...process.env, GOFLAGS: '-mod=mod' },
    });
    if (run.status !== 0) {
      t.skip(`SKIPPED LOUDLY: go run failed (offline or module cache empty?): ${String(run.stderr).slice(0, 300)}`);
      return;
    }
    const tally = checkLines(readFileSync(out, 'utf8').split('\n'));
    for (const f of tally.failures.slice(0, 3)) console.error(`seed ${seed} line ${f.line}: ${JSON.stringify(f.rec).slice(0, 300)}\n  ${f.message.split('\n')[0]}`);
    assert.equal(tally.failures.length, 0, `seed ${seed}: ${tally.failures.length}/${tally.records} disagree`);
    console.log(`live seed ${seed}: ${tally.records} records agree`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
