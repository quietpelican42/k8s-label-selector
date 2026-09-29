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

Derived from k8s.io/apimachinery pkg/fields.
*/

import { SelectorError } from './errors.ts';
import { compareStrings } from './gofmt.ts';
import { type Labels, entriesOf, lookup } from './labels.ts';

/** A flat map of field path to value: a plain object or a Map. */
export type Fields = Labels;

/** One term of a field selector. */
export interface FieldRequirement {
  operator: '=' | '!=';
  field: string;
  value: string;
}

/** `fields.EscapeValue`: prefix `\`, `,` and `=` with a backslash. */
export function escapeFieldValue(s: string): string {
  return s.replace(/[\\,=]/g, (c) => '\\' + c);
}

/** `fields.UnescapeValue`. Throws SelectorError for stray `,`/`=` and unknown escapes. */
export function unescapeFieldValue(s: string): string {
  if (!/[\\,=]/.test(s)) return s;
  let out = '';
  let inSlash = false;
  for (const c of s) {
    if (inSlash) {
      if (c === '\\' || c === ',' || c === '=') out += c;
      else throw new SelectorError('invalid field selector: invalid escape sequence: \\' + c);
      inSlash = false;
      continue;
    }
    if (c === '\\') inSlash = true;
    else if (c === ',' || c === '=') {
      throw new SelectorError('invalid field selector: unescaped character in value: ' + (c.codePointAt(0) as number));
    } else out += c;
  }
  if (inSlash) throw new SelectorError('invalid field selector: invalid escape sequence: \\');
  return out;
}

/** A parsed field selector: the AND of `field=value` and `field!=value` terms. */
export class FieldSelector {
  readonly #terms: readonly FieldRequirement[];
  readonly #nothing: boolean;

  /** Use `parseFieldSelector` or `fieldSelectorFromSet`. */
  constructor(terms: readonly FieldRequirement[] = [], nothing = false) {
    this.#terms = terms;
    this.#nothing = nothing;
  }

  /** A missing field reads as the empty string, so `a=` matches a map without `a`. */
  matches(fields: Fields): boolean {
    if (this.#nothing) return false;
    return this.#terms.every((t) => {
      const v = lookup(fields, t.field) ?? '';
      return t.operator === '=' ? v === t.value : v !== t.value;
    });
  }

  empty(): boolean {
    return !this.#nothing && this.#terms.length === 0;
  }

  requirements(): readonly FieldRequirement[] {
    return this.#nothing ? [] : this.#terms;
  }

  /** The value the selector pins `field` to with `=`, or undefined. */
  requiresExactMatch(field: string): string | undefined {
    if (this.#nothing) return undefined;
    for (const t of this.#terms) if (t.operator === '=' && t.field === field) return t.value;
    return undefined;
  }

  toString(): string {
    if (this.#nothing) return '';
    return this.#terms.map((t) => `${t.field}${t.operator}${escapeFieldValue(t.value)}`).join(',');
  }
}

/** The field selector that matches nothing. */
export function nothingFields(): FieldSelector {
  return new FieldSelector([], true);
}

/** The field selector that matches everything. */
export function everythingFields(): FieldSelector {
  return new FieldSelector();
}

function splitTerms(fieldSelector: string): string[] {
  if (fieldSelector.length === 0) return [];
  const terms: string[] = [];
  let start = 0;
  let inSlash = false;
  for (let i = 0; i < fieldSelector.length; i++) {
    const c = fieldSelector[i];
    if (inSlash) inSlash = false;
    else if (c === '\\') inSlash = true;
    else if (c === ',') {
      terms.push(fieldSelector.slice(start, i));
      start = i + 1;
    }
  }
  terms.push(fieldSelector.slice(start));
  return terms;
}

const termOperators = ['!=', '==', '='] as const;

function splitTerm(term: string): [string, string, string] | undefined {
  for (let i = 0; i < term.length; i++) {
    for (const op of termOperators) {
      if (term.startsWith(op, i)) return [term.slice(0, i), op, term.slice(i + op.length)];
    }
  }
  return undefined;
}

/**
 * `fields.ParseSelector`: `=`, `==` and `!=` terms joined by commas, with `\,` `\=` `\\` escapes in values.
 * Terms are sorted as strings, and terms whose field and value are both empty are dropped.
 * Throws SelectorError with Go's message.
 */
export function parseFieldSelector(selector: string): FieldSelector {
  const parts = splitTerms(selector).sort(compareStrings);
  const items: FieldRequirement[] = [];
  for (const part of parts) {
    if (part === '') continue;
    const split = splitTerm(part);
    if (split === undefined) throw new SelectorError(`invalid selector: '${selector}'; can't understand '${part}'`);
    const [lhs, op, rhs] = split;
    const value = unescapeFieldValue(rhs);
    if (lhs === '' && value === '') continue;
    items.push({ operator: op === '!=' ? '!=' : '=', field: lhs, value });
  }
  return new FieldSelector(items);
}

/**
 * `fields.SelectorFromSet`. Nullish means everything. Go iterates the map in random order;
 * this sorts by field so the string form is stable.
 */
export function fieldSelectorFromSet(set: Fields | null | undefined): FieldSelector {
  if (set === null || set === undefined) return everythingFields();
  const entries = entriesOf(set).sort((a, b) => compareStrings(a[0], b[0]));
  return new FieldSelector(entries.map(([field, value]) => ({ operator: '=', field, value })));
}
