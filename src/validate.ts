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

Derived from k8s.io/apimachinery pkg/api/validate/content (kube.go, dns.go, errors.go).
The regular expressions are replaced by linear scans so that long inputs cannot backtrack.
*/

import { byteLength } from './gofmt.ts';

const labelKeyFmt = '([A-Za-z0-9][-A-Za-z0-9_.]*)?[A-Za-z0-9]';
const labelKeyErrMsg =
  "must consist of alphanumeric characters, '-', '_' or '.', and must start and end with an alphanumeric character";
const labelValueFmt = '(' + labelKeyFmt + ')?';
const labelValueErrMsg =
  "a valid label must be an empty string or consist of alphanumeric characters, '-', '_' or '.', and must start and end with an alphanumeric character";
const dns1123LabelFmt = '[a-z0-9]([-a-z0-9]*[a-z0-9])?';
const dns1123SubdomainFmt = dns1123LabelFmt + '(\\.' + dns1123LabelFmt + ')*';
const dns1123SubdomainErrorMsg =
  "a lowercase RFC 1123 subdomain must consist of lower case alphanumeric characters, '-' or '.', and must start and end with an alphanumeric character";

const labelKeyMaxLength = 63;
const labelValueMaxLength = 63;
const dns1123SubdomainMaxLength = 253;

function maxLenError(length: number): string {
  return `must be no more than ${length} bytes`;
}

function regexError(msg: string, re: string, ...examples: string[]): string {
  if (examples.length === 0) return msg + " (regex used for validation is '" + re + "')";
  msg += ' (e.g. ';
  examples.forEach((ex, i) => {
    if (i > 0) msg += ' or ';
    msg += "'" + ex + "', ";
  });
  return msg + "regex used for validation is '" + re + "')";
}

const isAlnum = (c: number): boolean => (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
const isLowerAlnum = (c: number): boolean => (c >= 48 && c <= 57) || (c >= 97 && c <= 122);

/** Matches `([A-Za-z0-9][-A-Za-z0-9_.]*)?[A-Za-z0-9]`. */
function isNamePart(s: string): boolean {
  if (s.length === 0) return false;
  if (!isAlnum(s.charCodeAt(0)) || !isAlnum(s.charCodeAt(s.length - 1))) return false;
  for (let i = 1; i < s.length - 1; i++) {
    const c = s.charCodeAt(i);
    if (!isAlnum(c) && c !== 45 && c !== 95 && c !== 46) return false;
  }
  return true;
}

/** Matches `[a-z0-9]([-a-z0-9]*[a-z0-9])?`. */
function isDnsLabel(s: string): boolean {
  if (s.length === 0) return false;
  if (!isLowerAlnum(s.charCodeAt(0)) || !isLowerAlnum(s.charCodeAt(s.length - 1))) return false;
  for (let i = 1; i < s.length - 1; i++) {
    const c = s.charCodeAt(i);
    if (!isLowerAlnum(c) && c !== 45) return false;
  }
  return true;
}

function isDns1123Subdomain(value: string): string[] {
  const errs: string[] = [];
  if (byteLength(value) > dns1123SubdomainMaxLength) errs.push(maxLenError(dns1123SubdomainMaxLength));
  if (!value.split('.').every(isDnsLabel)) {
    errs.push(regexError(dns1123SubdomainErrorMsg, dns1123SubdomainFmt, 'example.com'));
  }
  return errs;
}

/**
 * Errors for a label key, as `content.IsLabelKey` (`validation.IsQualifiedName`) reports them.
 * An empty array means the key is valid.
 */
export function validateLabelKey(value: string): string[] {
  const errs: string[] = [];
  const parts = value.split('/');
  let name: string;
  if (parts.length === 1) {
    name = parts[0] as string;
  } else if (parts.length === 2) {
    const prefix = parts[0] as string;
    name = parts[1] as string;
    if (prefix.length === 0) {
      errs.push('prefix part must be non-empty');
    } else {
      for (const m of isDns1123Subdomain(prefix)) errs.push('prefix part ' + m);
    }
  } else {
    errs.push(
      'a valid label key ' +
        regexError(labelKeyErrMsg, labelKeyFmt, 'MyName', 'my.name', '123-abc') +
        " with an optional DNS subdomain prefix and '/' (e.g. 'example.com/MyName')",
    );
    return errs;
  }
  if (name.length === 0) errs.push('name part must be non-empty');
  else if (byteLength(name) > labelKeyMaxLength) errs.push('name part ' + maxLenError(labelKeyMaxLength));
  if (!isNamePart(name)) {
    errs.push('name part ' + regexError(labelKeyErrMsg, labelKeyFmt, 'MyName', 'my.name', '123-abc'));
  }
  return errs;
}

/**
 * Errors for a label value, as `content.IsLabelValue` (`validation.IsValidLabelValue`) reports them.
 * An empty array means the value is valid.
 */
export function validateLabelValue(value: string): string[] {
  const errs: string[] = [];
  if (byteLength(value) > labelValueMaxLength) errs.push(maxLenError(labelValueMaxLength));
  if (value !== '' && !isNamePart(value)) {
    errs.push(regexError(labelValueErrMsg, labelValueFmt, 'MyValue', 'my_value', '12345'));
  }
  return errs;
}
