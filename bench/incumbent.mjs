// Measures the Node incumbent `k8s-selector` against the shared Go corpus.
//
//   mkdir -p .cache && npm install --prefix .cache k8s-selector@1.0.1 && node bench/incumbent.mjs
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

const require = createRequire(import.meta.url);
let inc;
try {
  inc = createRequire(new URL('../.cache/', import.meta.url))('k8s-selector');
} catch {
  console.log('SKIPPED: k8s-selector is not installed. Run: npm install --prefix .cache k8s-selector@1.0.1');
  process.exit(0);
}
const { parse, Selector } = inc;
void require;

const lines = gunzipSync(readFileSync(new URL('../test/fixtures/corpus.jsonl.gz', import.meta.url))).toString().split('\n').filter(Boolean);
let total = 0, validityAgree = 0, goValid = 0, cases = 0, caseAgree = 0, selAgree = 0;
for (const line of lines) {
  const r = JSON.parse(line);
  if (r.t !== 'sel') continue;
  total++;
  let matcher = null;
  try { matcher = Selector(r.s); parse(r.s); } catch { matcher = null; }
  if ((matcher !== null) === Boolean(r.ok)) validityAgree++;
  if (!r.ok) continue;
  goValid++;
  let all = true;
  r.ls.forEach((set, i) => {
    cases++;
    let got;
    try { got = matcher ? (matcher(set) ? '1' : '0') : 'x'; } catch { got = 'x'; }
    if (got === r.m[i]) caseAgree++; else all = false;
  });
  if (all) selAgree++;
}
const pct = (a, b) => ((100 * a) / b).toFixed(2) + '%';
console.log(`selectors: ${total}, valid in Go: ${goValid}`);
console.log(`validity agreement: ${validityAgree}/${total} = ${pct(validityAgree, total)}`);
console.log(`match agreement on Go-valid selectors: ${caseAgree}/${cases} = ${pct(caseAgree, cases)}`);
console.log(`selectors with all match results equal: ${selAgree}/${goValid} = ${pct(selAgree, goValid)}`);
