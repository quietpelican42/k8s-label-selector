// Helpers that reproduce Go's string formatting and ordering.

const encoder = new TextEncoder();

/** Length in UTF-8 bytes, which is what Go's len() reports. */
export function byteLength(s: string): number {
  return encoder.encode(s).length;
}

/** Compare by Unicode code point, which equals Go's byte-wise comparison of UTF-8 strings. */
export function compareStrings(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    let ca = a.charCodeAt(i);
    let cb = b.charCodeAt(i);
    if (ca === cb) continue;
    // Surrogates (astral code points) sort after the rest of the BMP in UTF-8.
    if (ca >= 0xd800 && cb >= 0xd800) {
      ca += ca >= 0xe000 ? -0x800 : 0x2000;
      cb += cb >= 0xe000 ? -0x800 : 0x2000;
    }
    return ca < cb ? -1 : 1;
  }
  return a.length === b.length ? 0 : a.length < b.length ? -1 : 1;
}

/** `a < b` in Go string order. */
export function lessString(a: string, b: string): boolean {
  return compareStrings(a, b) < 0;
}

const printable = /^[\p{L}\p{M}\p{N}\p{P}\p{S}]$/u;

function hex(n: number, width: number): string {
  return n.toString(16).padStart(width, '0');
}

/** strconv.Quote. */
export function goQuote(s: string): string {
  let out = '"';
  for (const ch of s) {
    const c = ch.codePointAt(0) as number;
    if (ch === '"' || ch === '\\') {
      out += '\\' + ch;
    } else if (c === 0x20 || (c > 0x20 && c < 0x7f)) {
      out += ch;
    } else if (c >= 0x80 && printable.test(ch)) {
      out += ch;
    } else if (c === 7) out += '\\a';
    else if (c === 8) out += '\\b';
    else if (c === 12) out += '\\f';
    else if (c === 10) out += '\\n';
    else if (c === 13) out += '\\r';
    else if (c === 9) out += '\\t';
    else if (c === 11) out += '\\v';
    else if (c < 0x20 || c === 0x7f) out += '\\x' + hex(c, 2);
    else if (c >= 0xd800 && c < 0xe000) out += '\\ufffd';
    else if (c < 0x10000) out += '\\u' + hex(c, 4);
    else out += '\\U' + hex(c, 8);
  }
  return out + '"';
}

/** encoding/json string encoding, including its HTML escaping. */
export function goJsonString(s: string): string {
  let out = '"';
  for (const ch of s) {
    const c = ch.codePointAt(0) as number;
    if (ch === '"') out += '\\"';
    else if (ch === '\\') out += '\\\\';
    else if (c === 8) out += '\\b';
    else if (c === 12) out += '\\f';
    else if (c === 10) out += '\\n';
    else if (c === 13) out += '\\r';
    else if (c === 9) out += '\\t';
    else if (c < 0x20 || ch === '<' || ch === '>' || ch === '&' || c === 0x2028 || c === 0x2029) out += '\\u' + hex(c, 4);
    else if (c >= 0xd800 && c < 0xe000) out += '\\ufffd';
    else out += ch;
  }
  return out + '"';
}

/** json.Marshal of a []string, where a nil slice is `null`. */
export function goJsonStrings(values: readonly string[] | null | undefined): string {
  if (values === null || values === undefined) return 'null';
  return '[' + values.map(goJsonString).join(',') + ']';
}

/** strconv.ParseInt(s, 10, 64) as a bigint, or undefined when Go would fail. */
export function parseInt64(s: string): bigint | undefined {
  if (!/^[+-]?[0-9]+$/.test(s)) return undefined;
  const n = BigInt(s);
  if (n > 9223372036854775807n || n < -9223372036854775808n) return undefined;
  return n;
}
