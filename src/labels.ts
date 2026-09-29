/*
Copyright 2014 The Kubernetes Authors.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.

Derived from k8s.io/apimachinery pkg/labels/selector.go.
*/

import { SelectorError } from './errors.ts';
import { compareStrings, goJsonString, goJsonStrings, goQuote, parseInt64 } from './gofmt.ts';
import { goSort } from './gosort.ts';
import { validateLabelKey, validateLabelValue } from './validate.ts';

/** A set of labels: a plain object or a Map. */
export type Labels = Readonly<Record<string, string>> | ReadonlyMap<string, string>;

/** Requirement operators, spelled as in `k8s.io/apimachinery/pkg/selection`. */
export type Operator = 'in' | 'notin' | '=' | '==' | '!=' | 'exists' | '!' | 'gt' | 'lt';

const binaryOperators = ['in', 'notin', '=', '==', '!=', 'gt', 'lt'];
const validRequirementOperators = [...binaryOperators, 'exists', '!'];

/** Look up a key in a Labels value; own properties only. */
export function lookup(labels: Labels, key: string): string | undefined {
  if (labels instanceof Map) return labels.get(key);
  const rec = labels as Readonly<Record<string, string>>;
  return Object.hasOwn(rec, key) ? rec[key] : undefined;
}

/** The entries of a Labels value. */
export function entriesOf(labels: Labels): [string, string][] {
  return labels instanceof Map ? [...labels.entries()] : Object.entries(labels);
}

function aggregate(errs: string[]): SelectorError | undefined {
  const seen: string[] = [];
  for (const e of errs) if (!seen.includes(e)) seen.push(e);
  if (seen.length === 0) return undefined;
  return new SelectorError(seen.length === 1 ? (seen[0] as string) : '[' + seen.join(', ') + ']');
}

function invalid(path: string, badValue: string, detail: string): string {
  return `${path}: Invalid value: ${badValue}: ${detail}`;
}

/** One `key operator values` term of a selector. */
export class Requirement {
  readonly key: string;
  readonly operator: Operator;
  readonly #values: readonly string[];

  /** Use `newRequirement`, which validates. */
  constructor(key: string, operator: Operator, values: readonly string[]) {
    this.key = key;
    this.operator = operator;
    this.#values = values;
  }

  /** Sorted, de-duplicated values (`Requirement.Values().List()`). */
  values(): string[] {
    return [...new Set(this.#values)].sort(compareStrings);
  }

  /** Values in the order they were passed (`ValuesUnsorted`). */
  valuesUnsorted(): string[] {
    return [...this.#values];
  }

  matches(labels: Labels): boolean {
    const val = lookup(labels, this.key);
    switch (this.operator) {
      case 'in':
      case '=':
      case '==':
        return val !== undefined && this.#values.includes(val);
      case 'notin':
      case '!=':
        return val === undefined || !this.#values.includes(val);
      case 'exists':
        return val !== undefined;
      case '!':
        return val === undefined;
      case 'gt':
      case 'lt': {
        if (val === undefined) return false;
        const l = parseInt64(val);
        if (l === undefined) return false;
        if (this.#values.length !== 1) return false;
        const r = parseInt64(this.#values[0] as string);
        if (r === undefined) return false;
        return this.operator === 'gt' ? l > r : l < r;
      }
      default:
        return false;
    }
  }

  toString(): string {
    let s = this.operator === '!' ? '!' + this.key : this.key;
    switch (this.operator) {
      case '=':
        s += '=';
        break;
      case '==':
        s += '==';
        break;
      case '!=':
        s += '!=';
        break;
      case 'in':
        s += ' in ';
        break;
      case 'notin':
        s += ' notin ';
        break;
      case 'gt':
        s += '>';
        break;
      case 'lt':
        s += '<';
        break;
      default:
        return s;
    }
    const paren = this.operator === 'in' || this.operator === 'notin';
    if (paren) s += '(';
    s += this.#values.length === 1 ? (this.#values[0] as string) : [...this.#values].sort(compareStrings).join(',');
    if (paren) s += ')';
    return s;
  }

  equal(other: Requirement): boolean {
    return (
      this.key === other.key &&
      this.operator === other.operator &&
      this.#values.length === other.#values.length &&
      this.#values.every((v, i) => v === other.#values[i])
    );
  }
}

/**
 * Build a validated requirement, as `labels.NewRequirement` does.
 * `values` of `null` or `undefined` stands for Go's nil slice.
 * Throws SelectorError with Go's message.
 */
export function newRequirement(key: string, operator: string, values?: readonly string[] | null): Requirement {
  const errs: string[] = [];
  const keyErrs = validateLabelKey(key);
  if (keyErrs.length !== 0) errs.push(invalid('key', goQuote(key), keyErrs.join('; ')));
  const vals = values ?? null;
  const n = vals === null ? 0 : vals.length;
  switch (operator) {
    case 'in':
    case 'notin':
      if (n === 0) errs.push(invalid('values', goJsonStrings(vals), "for 'in', 'notin' operators, values set can't be empty"));
      break;
    case '=':
    case '==':
    case '!=':
      if (n !== 1) errs.push(invalid('values', goJsonStrings(vals), 'exact-match compatibility requires one single value'));
      break;
    case 'exists':
    case '!':
      if (n !== 0) errs.push(invalid('values', goJsonStrings(vals), 'values set must be empty for exists and does not exist'));
      break;
    case 'gt':
    case 'lt':
      if (n !== 1) errs.push(invalid('values', goJsonStrings(vals), "for 'Gt', 'Lt' operators, exactly one value is required"));
      (vals ?? []).forEach((v, i) => {
        if (parseInt64(v) === undefined) {
          errs.push(invalid(`values[${i}]`, goQuote(v), "for 'Gt', 'Lt' operators, the value must be an integer"));
        }
      });
      break;
    default:
      errs.push(
        `operator: Unsupported value: ${goJsonString(operator)}: supported values: ` +
          validRequirementOperators.map(goQuote).join(', '),
      );
  }
  (vals ?? []).forEach((v, i) => {
    const verrs = validateLabelValue(v);
    if (verrs.length !== 0) errs.push(invalid(`values[${i}][${key}]`, goQuote(v), verrs.join('; ')));
  });
  const err = aggregate(errs);
  if (err) throw err;
  return new Requirement(key, operator as Operator, vals ?? []);
}

// Go sorts requirements with sort.Sort, which is not stable; goSort reproduces its order for equal keys.
function sortByKey(reqs: Requirement[]): Requirement[] {
  return goSort(reqs, (a, b) => compareStrings(a.key, b.key) < 0);
}

/** A parsed label selector: the AND of its requirements. */
export class Selector {
  readonly #reqs: readonly Requirement[];
  readonly #nothing: boolean;

  /** Use `parseSelector`, `selectorFromSet` or `labelSelectorAsSelector`. */
  constructor(requirements: readonly Requirement[] = [], nothing = false) {
    this.#reqs = requirements;
    this.#nothing = nothing;
  }

  matches(labels: Labels): boolean {
    if (this.#nothing) return false;
    return this.#reqs.every((r) => r.matches(labels));
  }

  /** True when the selector does not restrict anything. The nothing-selector is not empty. */
  empty(): boolean {
    return !this.#nothing && this.#reqs.length === 0;
  }

  /** False for the selector that matches nothing. */
  get selectable(): boolean {
    return !this.#nothing;
  }

  /** The requirements, sorted by key. */
  requirements(): readonly Requirement[] {
    return this.#nothing ? [] : this.#reqs;
  }

  /** A new selector with extra requirements, re-sorted by key. */
  add(...reqs: Requirement[]): Selector {
    if (this.#nothing) return this;
    return new Selector(sortByKey([...this.#reqs, ...reqs]));
  }

  /** The value the selector pins `label` to, or undefined. */
  requiresExactMatch(label: string): string | undefined {
    if (this.#nothing) return undefined;
    for (const r of this.#reqs) {
      if (r.key === label) {
        if ((r.operator === '=' || r.operator === '==' || r.operator === 'in') && r.valuesUnsorted().length === 1) {
          return r.valuesUnsorted()[0];
        }
        return undefined;
      }
    }
    return undefined;
  }

  toString(): string {
    return this.#nothing ? '' : this.#reqs.map((r) => r.toString()).join(',');
  }
}

const everythingSelector = new Selector();
const nothingSelector = new Selector([], true);

/** The selector that matches every label set. */
export function everything(): Selector {
  return everythingSelector;
}

/** The selector that matches no label set. */
export function nothing(): Selector {
  return nothingSelector;
}

// ---- lexer

const ErrorToken = 0;
const EndOfStringToken = 1;
const ClosedParToken = 2;
const CommaToken = 3;
const DoesNotExistToken = 4;
const DoubleEqualsToken = 5;
const EqualsToken = 6;
const GreaterThanToken = 7;
const IdentifierToken = 8;
const InToken = 9;
const LessThanToken = 10;
const NotEqualsToken = 11;
const NotInToken = 12;
const OpenParToken = 13;

const string2token = new Map<string, number>([
  [')', ClosedParToken],
  [',', CommaToken],
  ['!', DoesNotExistToken],
  ['==', DoubleEqualsToken],
  ['=', EqualsToken],
  ['>', GreaterThanToken],
  ['in', InToken],
  ['<', LessThanToken],
  ['!=', NotEqualsToken],
  ['notin', NotInToken],
  ['(', OpenParToken],
]);

const isWhitespace = (ch: string): boolean => ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n';
const isSpecialSymbol = (ch: string): boolean => '=!(),><'.includes(ch);

interface ScannedItem {
  tok: number;
  literal: string;
}

// A NUL character ends a token exactly like the end of input, as in Go's lexer.
class Lexer {
  readonly #s: string;
  #pos = 0;

  constructor(s: string) {
    this.#s = s;
  }

  #read(): string {
    if (this.#pos < this.#s.length) return this.#s[this.#pos++] as string;
    return '\0';
  }

  #unread(): void {
    this.#pos--;
  }

  #scanIDOrKeyword(): ScannedItem {
    let buffer = '';
    for (;;) {
      const ch = this.#read();
      if (ch === '\0') break;
      if (isSpecialSymbol(ch) || isWhitespace(ch)) {
        this.#unread();
        break;
      }
      buffer += ch;
    }
    const tok = string2token.get(buffer);
    return tok !== undefined ? { tok, literal: buffer } : { tok: IdentifierToken, literal: buffer };
  }

  #scanSpecialSymbol(): ScannedItem {
    let last: ScannedItem = { tok: ErrorToken, literal: '' };
    let buffer = '';
    for (;;) {
      const ch = this.#read();
      if (ch === '\0') break;
      if (isSpecialSymbol(ch)) {
        buffer += ch;
        const tok = string2token.get(buffer);
        if (tok !== undefined) {
          last = { tok, literal: buffer };
        } else if (last.tok !== ErrorToken) {
          this.#unread();
          break;
        }
      } else {
        this.#unread();
        break;
      }
    }
    if (last.tok === ErrorToken) return { tok: ErrorToken, literal: `error expected: keyword found '${buffer}'` };
    return last;
  }

  lex(): ScannedItem {
    let ch = this.#read();
    while (isWhitespace(ch)) ch = this.#read();
    if (ch === '\0') return { tok: EndOfStringToken, literal: '' };
    this.#unread();
    return isSpecialSymbol(ch) ? this.#scanSpecialSymbol() : this.#scanIDOrKeyword();
  }
}

// ---- parser

const enumValues = 1;
const enumKeyAndOperator = 0;

class Parser {
  readonly #items: ScannedItem[] = [];
  #position = 0;

  constructor(s: string) {
    const lexer = new Lexer(s);
    for (;;) {
      const item = lexer.lex();
      this.#items.push(item);
      if (item.tok === EndOfStringToken) break;
    }
  }

  #lookahead(context: number): [number, string] {
    const item = this.#items[this.#position] as ScannedItem;
    let tok = item.tok;
    if (context === enumValues && (tok === InToken || tok === NotInToken)) tok = IdentifierToken;
    return [tok, item.literal];
  }

  #consume(context: number): [number, string] {
    const item = this.#items[this.#position++] as ScannedItem;
    let tok = item.tok;
    if (context === enumValues && (tok === InToken || tok === NotInToken)) tok = IdentifierToken;
    return [tok, item.literal];
  }

  parse(): Requirement[] {
    const requirements: Requirement[] = [];
    for (;;) {
      const [tok, lit] = this.#lookahead(enumValues);
      if (tok === IdentifierToken || tok === DoesNotExistToken) {
        let r: Requirement;
        try {
          r = this.#parseRequirement();
        } catch (e) {
          if (e instanceof SelectorError) throw new SelectorError('unable to parse requirement: ' + e.message);
          throw e;
        }
        requirements.push(r);
        const [t, l] = this.#consume(enumValues);
        if (t === EndOfStringToken) return requirements;
        if (t === CommaToken) {
          const [t2, l2] = this.#lookahead(enumValues);
          if (t2 !== IdentifierToken && t2 !== DoesNotExistToken) {
            throw new SelectorError(`found '${l2}', expected: identifier after ','`);
          }
        } else {
          throw new SelectorError(`found '${l}', expected: ',' or 'end of string'`);
        }
      } else if (tok === EndOfStringToken) {
        return requirements;
      } else {
        throw new SelectorError(`found '${lit}', expected: !, identifier, or 'end of string'`);
      }
    }
  }

  #parseRequirement(): Requirement {
    const [key, inferred] = this.#parseKeyAndInferOperator();
    if (inferred === 'exists' || inferred === '!') return newRequirement(key, inferred, []);
    const operator = this.#parseOperator();
    let values: string[];
    if (operator === 'in' || operator === 'notin') values = this.#parseValues();
    else values = this.#parseExactValue();
    return newRequirement(key, operator, values);
  }

  #parseKeyAndInferOperator(): [string, Operator | ''] {
    let operator: Operator | '' = '';
    let [tok, literal] = this.#consume(enumValues);
    if (tok === DoesNotExistToken) {
      operator = '!';
      [tok, literal] = this.#consume(enumValues);
    }
    if (tok !== IdentifierToken) throw new SelectorError(`found '${literal}', expected: identifier`);
    const errs = validateLabelKey(literal);
    if (errs.length !== 0) throw new SelectorError(invalid('<nil>', goQuote(literal), errs.join('; ')));
    const [t] = this.#lookahead(enumValues);
    if (t === EndOfStringToken || t === CommaToken) {
      if (operator !== '!') operator = 'exists';
    }
    return [literal, operator];
  }

  #parseOperator(): Operator {
    const [tok, lit] = this.#consume(enumKeyAndOperator);
    switch (tok) {
      case InToken:
        return 'in';
      case EqualsToken:
        return '=';
      case DoubleEqualsToken:
        return '==';
      case GreaterThanToken:
        return 'gt';
      case LessThanToken:
        return 'lt';
      case NotInToken:
        return 'notin';
      case NotEqualsToken:
        return '!=';
      default:
        throw new SelectorError(`found '${lit}', expected: ${binaryOperators.join(', ')}`);
    }
  }

  #parseValues(): string[] {
    let [tok, lit] = this.#consume(enumValues);
    if (tok !== OpenParToken) throw new SelectorError(`found '${lit}' expected: '('`);
    [tok, lit] = this.#lookahead(enumValues);
    switch (tok) {
      case IdentifierToken:
      case CommaToken: {
        const s = this.#parseIdentifiersList();
        [tok] = this.#consume(enumValues);
        if (tok !== ClosedParToken) throw new SelectorError(`found '${lit}', expected: ')'`);
        return sortedSet(s);
      }
      case ClosedParToken:
        this.#consume(enumValues);
        return [''];
      default:
        throw new SelectorError(`found '${lit}', expected: ',', ')' or identifier`);
    }
  }

  #parseIdentifiersList(): Set<string> {
    const s = new Set<string>();
    for (;;) {
      const [tok, lit] = this.#consume(enumValues);
      if (tok === IdentifierToken) {
        s.add(lit);
        const [tok2, lit2] = this.#lookahead(enumValues);
        if (tok2 === CommaToken) continue;
        if (tok2 === ClosedParToken) return s;
        throw new SelectorError(`found '${lit2}', expected: ',' or ')'`);
      } else if (tok === CommaToken) {
        if (s.size === 0) s.add('');
        const [tok2] = this.#lookahead(enumValues);
        if (tok2 === ClosedParToken) {
          s.add('');
          return s;
        }
        if (tok2 === CommaToken) s.add('');
      } else {
        throw new SelectorError(`found '${lit}', expected: ',', or identifier`);
      }
    }
  }

  #parseExactValue(): string[] {
    const [tok] = this.#lookahead(enumValues);
    if (tok === EndOfStringToken || tok === CommaToken) return [''];
    const [t, lit] = this.#consume(enumValues);
    if (t === IdentifierToken) return [lit];
    throw new SelectorError(`found '${lit}', expected: identifier`);
  }
}

function sortedSet(s: Set<string>): string[] {
  return [...s].sort(compareStrings);
}

/**
 * Parse a label selector with apimachinery's grammar (`labels.Parse`).
 * Throws SelectorError with Go's message. Requirements are sorted by key.
 */
export function parseSelector(selector: string): Selector {
  return new Selector(sortByKey(parseRequirements(selector)));
}

/** `labels.ParseToRequirements`: the sorted requirements without wrapping them in a Selector. */
export function parseRequirements(selector: string): Requirement[] {
  return sortByKey(new Parser(selector).parse());
}

/** Whether `labels` satisfies `selector`, which may be a string or a parsed Selector. */
export function matches(selector: string | Selector, labels: Labels): boolean {
  return (typeof selector === 'string' ? parseSelector(selector) : selector).matches(labels);
}

/** `labels.SelectorFromSet`: `k=v` for every entry, no validation. Nullish or empty means everything. */
export function selectorFromSet(set: Labels | null | undefined): Selector {
  if (set === null || set === undefined) return everything();
  const entries = entriesOf(set);
  if (entries.length === 0) return everything();
  return new Selector(sortByKey(entries.map(([k, v]) => new Requirement(k, '=', [v]))));
}

/** `labels.ValidatedSelectorFromSet`: like selectorFromSet, but throws SelectorError for invalid keys or values. */
export function validatedSelectorFromSet(set: Labels | null | undefined): Selector {
  if (set === null || set === undefined) return everything();
  const entries = entriesOf(set);
  if (entries.length === 0) return everything();
  return new Selector(sortByKey(entries.map(([k, v]) => newRequirement(k, '=', [v]))));
}
