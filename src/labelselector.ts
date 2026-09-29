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

Derived from k8s.io/apimachinery pkg/apis/meta/v1/helpers.go.
*/

import { SelectorError } from './errors.ts';
import { goQuote } from './gofmt.ts';
import {
  type Labels,
  Selector,
  entriesOf,
  everything,
  newRequirement,
  nothing,
  parseRequirements,
  type Requirement,
} from './labels.ts';

/** metav1.LabelSelectorRequirement. `operator` is In, NotIn, Exists or DoesNotExist. */
export interface LabelSelectorRequirement {
  key: string;
  operator: string;
  values?: readonly string[] | null;
}

/** metav1.LabelSelector. */
export interface LabelSelector {
  matchLabels?: Readonly<Record<string, string>> | null;
  matchExpressions?: readonly LabelSelectorRequirement[] | null;
}

const opMap: Record<string, 'in' | 'notin' | 'exists' | '!'> = {
  In: 'in',
  NotIn: 'notin',
  Exists: 'exists',
  DoesNotExist: '!',
};

function opFor(operator: string): 'in' | 'notin' | 'exists' | '!' | undefined {
  return Object.hasOwn(opMap, operator) ? opMap[operator] : undefined;
}

/**
 * `metav1.LabelSelectorAsSelector`. A nullish selector matches nothing; an empty one matches everything.
 * Throws SelectorError with Go's message.
 */
export function labelSelectorAsSelector(ps: LabelSelector | null | undefined): Selector {
  if (ps === null || ps === undefined) return nothing();
  const labels = ps.matchLabels ? Object.entries(ps.matchLabels) : [];
  const exprs = ps.matchExpressions ?? [];
  if (labels.length + exprs.length === 0) return everything();
  const reqs: Requirement[] = [];
  for (const [k, v] of labels) reqs.push(newRequirement(k, '=', [v]));
  for (const expr of exprs) {
    const op = opFor(expr.operator);
    if (op === undefined) throw new SelectorError(`${goQuote(expr.operator)} is not a valid label selector operator`);
    reqs.push(newRequirement(expr.key, op, expr.values && expr.values.length > 0 ? [...expr.values] : null));
  }
  return new Selector().add(...reqs);
}

/** `metav1.LabelSelectorAsMap`: the old map-only form. Throws SelectorError when it cannot be expressed. */
export function labelSelectorAsMap(ps: LabelSelector | null | undefined): Record<string, string> | null {
  if (ps === null || ps === undefined) return null;
  const selector: Record<string, string> = {};
  for (const [k, v] of Object.entries(ps.matchLabels ?? {})) selector[k] = v;
  for (const expr of ps.matchExpressions ?? []) {
    switch (expr.operator) {
      case 'In': {
        const values = expr.values ?? [];
        if (values.length !== 1) {
          throw new SelectorError(
            `operator ${goQuote(expr.operator)} without a single value cannot be converted into the old label selector format`,
          );
        }
        selector[expr.key] = values[0] as string;
        break;
      }
      case 'NotIn':
      case 'Exists':
      case 'DoesNotExist':
        throw new SelectorError(`operator ${goQuote(expr.operator)} cannot be converted into the old label selector format`);
      default:
        throw new SelectorError(`${goQuote(expr.operator)} is not a valid selector operator`);
    }
  }
  return selector;
}

/** `metav1.ParseToLabelSelector`: a selector string as a LabelSelector object. */
export function parseToLabelSelector(selector: string): { matchLabels: Record<string, string>; matchExpressions: LabelSelectorRequirement[] } {
  let reqs: Requirement[];
  try {
    reqs = parseRequirements(selector);
  } catch (e) {
    if (e instanceof SelectorError) throw new SelectorError(`couldn't parse the selector string "${selector}": ${e.message}`);
    throw e;
  }
  const out: { matchLabels: Record<string, string>; matchExpressions: LabelSelectorRequirement[] } = {
    matchLabels: {},
    matchExpressions: [],
  };
  for (const req of reqs) {
    let operator: string;
    switch (req.operator) {
      case '=':
      case '==': {
        const vals = req.values();
        if (vals.length !== 1) throw new SelectorError('equals operator must have exactly one value');
        out.matchLabels[req.key] = vals[0] as string;
        continue;
      }
      case 'in':
        operator = 'In';
        break;
      case 'notin':
        operator = 'NotIn';
        break;
      case 'exists':
        operator = 'Exists';
        break;
      case '!':
        operator = 'DoesNotExist';
        break;
      case 'gt':
      case 'lt':
        throw new SelectorError(`${goQuote(req.operator)} isn't supported in label selectors`);
      default:
        throw new SelectorError(`${goQuote(req.operator)} is not a valid label selector operator`);
    }
    out.matchExpressions.push({ key: req.key, operator, values: req.values() });
  }
  return out;
}

/** `metav1.SetAsLabelSelector`. */
export function setAsLabelSelector(set: Labels | null | undefined): { matchLabels: Record<string, string> } | null {
  if (set === null || set === undefined) return null;
  return { matchLabels: Object.fromEntries(entriesOf(set)) };
}

/** `metav1.FormatLabelSelector`: the selector string, `<none>` when empty and `<error>` when invalid. */
export function formatLabelSelector(ps: LabelSelector | null | undefined): string {
  let s: string;
  try {
    s = labelSelectorAsSelector(ps).toString();
  } catch (e) {
    if (e instanceof SelectorError) return '<error>';
    throw e;
  }
  return s.length === 0 ? '<none>' : s;
}
