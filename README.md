# k8s-label-selector

Parse and match Kubernetes label selectors and field selectors with the grammar, error messages and canonical strings of `k8s.io/apimachinery`.

```ts
import { parseSelector, labelSelectorAsSelector, parseFieldSelector } from 'k8s-label-selector';

const sel = parseSelector('tier in (b,a), app=web, !legacy');
sel.toString();                                  // 'app=web,!legacy,tier in (a,b)'
sel.matches({ app: 'web', tier: 'a' });          // true
sel.matches({ app: 'web', tier: 'a', legacy: '1' }); // false

labelSelectorAsSelector({ matchLabels: { app: 'web' } }).toString(); // 'app=web'
parseFieldSelector('status.phase!=Failed').matches({ 'status.phase': 'Running' }); // true
```

## Why

Kubernetes clients need to evaluate selectors outside a cluster: mock API servers, dashboards, policy checkers. The rules are subtle: an empty selector matches everything, `!=` and `notin` match objects that lack the key, keys and values are validated, and `String()` sorts requirements and values.

Hand-written copies of this logic exist in `akuity/kargo` (`ui/src/features/project/targets/targets-utils.ts`), `ngrok/webernetes` (`src/client/labels.ts`, a port of the Go parser) and `jumpstarter-dev/jumpstarter` (`selectors.py`, a regex parser). This package is a port of the Go code, checked against Go output rather than against the documentation.

Incumbents checked: `k8s-selector` 1.0.1 (last release 2016), `kubernetes-label-selector` 2.1.3 (an AngularJS widget, fails on `require`), and `@kubernetes/client-node`, which only passes selector strings through.

Measured: `node bench/incumbent.mjs`, on the 26,562 selectors of the shared corpus (9,103 are valid in Go):

```
selectors: 26562, valid in Go: 9103
validity agreement: 17917/26562 = 67.45%
match agreement on Go-valid selectors: 16982/36412 = 46.64%
selectors with all match results equal: 3668/9103 = 40.29%
```

This package agrees with Go on every record of the same corpus (see Development).

## Installation

```sh
npm install k8s-label-selector
```

Node >= 20.6. No runtime dependencies. ESM only.

## Usage

### Parse errors

Errors are `SelectorError` and carry the text Go produces.

```ts
try {
  parseSelector('-a=b');
} catch (e) {
  e.message;
  // unable to parse requirement: <nil>: Invalid value: "-a": name part must consist of
  // alphanumeric characters, '-', '_' or '.', and must start and end with an alphanumeric
  // character (e.g. 'MyName',  or 'my.name',  or '123-abc', regex used for validation is
  // '([A-Za-z0-9][-A-Za-z0-9_.]*)?[A-Za-z0-9]')
}
```

### LabelSelector objects

`labelSelectorAsSelector` mirrors `metav1.LabelSelectorAsSelector` (`null` matches nothing, `{}` matches everything). `parseToLabelSelector`, `labelSelectorAsMap`, `setAsLabelSelector` and `formatLabelSelector` mirror the other `metav1` helpers.

```ts
labelSelectorAsSelector({
  matchLabels: { app: 'web' },
  matchExpressions: [{ key: 'tier', operator: 'NotIn', values: ['b', 'a'] }],
}).toString(); // 'app=web,tier notin (a,b)'
```

### Field selectors

```ts
const f = parseFieldSelector('status.phase!=Failed,metadata.name==a\\,b');
f.toString(); // 'metadata.name=a\\,b,status.phase!=Failed'
```

A field missing from the map reads as the empty string, as in Go.

### Validation

```ts
validateLabelValue('x'.repeat(64)); // ['must be no more than 63 bytes']
validateLabelKey('example.com/name'); // []
```

## Reference

Label selectors:

| Export | Description |
| --- | --- |
| `parseSelector(s)` | `labels.Parse`. Returns a `Selector`, throws `SelectorError`. |
| `parseRequirements(s)` | `labels.ParseToRequirements`. Sorted `Requirement[]`. |
| `matches(selector, labels)` | Selector (string or `Selector`) against a plain object or `Map`. |
| `newRequirement(key, op, values?)` | `labels.NewRequirement`. Operators: `in notin = == != exists ! gt lt`. |
| `selectorFromSet(set)` | `labels.SelectorFromSet`. No validation. |
| `validatedSelectorFromSet(set)` | `labels.ValidatedSelectorFromSet`. |
| `everything()` / `nothing()` | Selectors that match all or no label sets. |
| `validateLabelKey(s)` / `validateLabelValue(s)` | `IsQualifiedName` / `IsValidLabelValue` error strings. Empty array means valid. |

`Selector`: `matches(labels)`, `empty()`, `selectable`, `requirements()`, `add(...reqs)`, `requiresExactMatch(key)` (value or `undefined`), `toString()`.
`Requirement`: `key`, `operator`, `values()` (sorted, de-duplicated), `valuesUnsorted()`, `matches(labels)`, `equal(other)`, `toString()`.

Objects: `labelSelectorAsSelector`, `labelSelectorAsMap`, `parseToLabelSelector`, `setAsLabelSelector`, `formatLabelSelector`.

Field selectors: `parseFieldSelector`, `fieldSelectorFromSet`, `everythingFields`, `nothingFields`, `escapeFieldValue`, `unescapeFieldValue`, and the `FieldSelector` class (`matches`, `empty`, `requirements`, `requiresExactMatch`, `toString`).

## How it works

The lexer and parser are ports of `pkg/labels/selector.go`, including its quirks: a NUL character ends a token, `!a=b` fails at the `=`, `x in ()` means the single value `""`, and `Gt`/`Lt` (`a>1`) are accepted. Requirements are ordered with a port of Go's `sort.Sort` (pdqsort), because Go's sort is not stable and equal keys keep Go's order only under the same algorithm. Key and value validation uses linear scans instead of the Go regular expressions, so long inputs cannot cause backtracking.

Conformance corpus: `gen/main.go` generates selectors, label sets, `LabelSelector` objects, requirement calls, field selectors and validation strings, runs them through apimachinery v0.37.1, and writes the results. `test/fixtures/corpus.jsonl.gz` is one such output (seed 1). The Python sibling package `kubernetes-selectors` uses the identical file.

## Limitations

- Verified against apimachinery v0.37.1 only. Other releases may differ.
- Strings are JavaScript strings. Go strings that are not valid UTF-8 cannot be represented.
- `fieldSelectorFromSet` sorts by field. Go iterates a map in random order, so its string form for several fields is not deterministic.
- Go's `Transform`/`ParseAndTransformSelector`, `labels.Set` helpers (`Merge`, `Conflicts`, `Set.String`) and `ValidatedSetSelector` are not provided.
- The sort port follows Go 1.19 and later. A Go toolchain older than that orders equal keys differently.

## Compatibility

Run here: Node 24.20, TypeScript 5.x, Go 1.27.1 for the oracle. The CI workflow also lists Node 20.6 and 22 for the built package; those runs have not been made.

## Development

```sh
npm install
npx tsc --noEmit
npm test              # includes the corpus and, when `go` is available, a live run against Go
npm run build && npm run test:dist
node bench/incumbent.mjs
```

`test/live.test.ts` runs `go run ./gen` with a fresh random seed and checks every record. It skips with a loud message when `go` or the Go module cache is unavailable. `K8SSEL_SCALE=1` runs a full-size corpus. To regenerate the fixture: `cd gen && GOFLAGS=-mod=mod go run . -seed 1 -out corpus.jsonl && gzip -9 -n corpus.jsonl`.

## License

MIT, see [LICENSE](LICENSE). Files derived from Kubernetes carry the Kubernetes Authors header and are under Apache-2.0, see [LICENSE-apache](LICENSE-apache). `src/gosort.ts` is derived from the Go standard library, see [LICENSE-go](LICENSE-go).
