/*
Copyright 2009 The Go Authors. All rights reserved.
Use of this source code is governed by a BSD-style license that can be found in LICENSE-go.

A port of Go's sort.Sort (pattern-defeating quicksort, Go 1.19 and later). It is not stable, and
apimachinery sorts requirements with it, so equal keys come out in Go's order only with the same algorithm.
*/

const Unknown = 0;
const Increasing = 1;
const Decreasing = 2;
type Hint = 0 | 1 | 2;

/** Sort `data` in place exactly as Go's `sort.Sort` would order equal elements. */
export function goSort<T>(data: T[], lessThan: (x: T, y: T) => boolean): T[] {
  const less = (i: number, j: number): boolean => lessThan(data[i] as T, data[j] as T);
  const swap = (i: number, j: number): void => {
    const t = data[i] as T;
    data[i] = data[j] as T;
    data[j] = t;
  };
  const n = data.length;
  if (n <= 1) return data;

  const bitsLen = (x: number): number => (x === 0 ? 0 : Math.floor(Math.log2(x)) + 1);

  function insertionSort(a: number, b: number): void {
    for (let i = a + 1; i < b; i++) {
      for (let j = i; j > a && less(j, j - 1); j--) swap(j, j - 1);
    }
  }

  function siftDown(lo: number, hi: number, first: number): void {
    let root = lo;
    for (;;) {
      let child = 2 * root + 1;
      if (child >= hi) return;
      if (child + 1 < hi && less(first + child, first + child + 1)) child++;
      if (!less(first + root, first + child)) return;
      swap(first + root, first + child);
      root = child;
    }
  }

  function heapSort(a: number, b: number): void {
    const first = a;
    const hi = b - a;
    for (let i = Math.floor((hi - 1) / 2); i >= 0; i--) siftDown(i, hi, first);
    for (let i = hi - 1; i >= 0; i--) {
      swap(first, first + i);
      siftDown(0, i, first);
    }
  }

  function partition(a: number, b: number, pivot: number): [number, boolean] {
    swap(a, pivot);
    let i = a + 1;
    let j = b - 1;
    while (i <= j && less(i, a)) i++;
    while (i <= j && !less(j, a)) j--;
    if (i > j) {
      swap(j, a);
      return [j, true];
    }
    swap(i, j);
    i++;
    j--;
    for (;;) {
      while (i <= j && less(i, a)) i++;
      while (i <= j && !less(j, a)) j--;
      if (i > j) break;
      swap(i, j);
      i++;
      j--;
    }
    swap(j, a);
    return [j, false];
  }

  function partitionEqual(a: number, b: number, pivot: number): number {
    swap(a, pivot);
    let i = a + 1;
    let j = b - 1;
    for (;;) {
      while (i <= j && !less(a, i)) i++;
      while (i <= j && less(a, j)) j--;
      if (i > j) break;
      swap(i, j);
      i++;
      j--;
    }
    return i;
  }

  function partialInsertionSort(a: number, b: number): boolean {
    const maxSteps = 5;
    const shortestShifting = 50;
    let i = a + 1;
    for (let j = 0; j < maxSteps; j++) {
      while (i < b && !less(i, i - 1)) i++;
      if (i === b) return true;
      if (b - a < shortestShifting) return false;
      swap(i, i - 1);
      if (i - a >= 2) {
        for (let k = i - 1; k >= 1; k--) {
          if (!less(k, k - 1)) break;
          swap(k, k - 1);
        }
      }
      if (b - i >= 2) {
        for (let k = i + 1; k < b; k++) {
          if (!less(k, k - 1)) break;
          swap(k, k - 1);
        }
      }
    }
    return false;
  }

  function breakPatterns(a: number, b: number): void {
    const length = b - a;
    if (length >= 8) {
      const mask = (1n << 64n) - 1n;
      let random = BigInt(length);
      const modulus = 2 ** bitsLen(length);
      for (let idx = a + Math.floor(length / 4) * 2 - 1; idx <= a + Math.floor(length / 4) * 2 + 1; idx++) {
        random ^= (random << 13n) & mask;
        random ^= random >> 7n;
        random ^= (random << 17n) & mask;
        let other = Number(random & BigInt(modulus - 1));
        if (other >= length) other -= length;
        swap(idx, a + other);
      }
    }
  }

  const swaps = { n: 0 };
  function order2(a: number, b: number): [number, number] {
    if (less(b, a)) {
      swaps.n++;
      return [b, a];
    }
    return [a, b];
  }
  function median(a: number, b: number, c: number): number {
    [a, b] = order2(a, b);
    [b, c] = order2(b, c);
    [a, b] = order2(a, b);
    void c;
    return b;
  }
  function medianAdjacent(a: number): number {
    return median(a - 1, a, a + 1);
  }

  function choosePivot(a: number, b: number): [number, Hint] {
    const shortestNinther = 50;
    const maxSwaps = 4 * 3;
    const l = b - a;
    swaps.n = 0;
    let i = a + Math.floor(l / 4) * 1;
    let j = a + Math.floor(l / 4) * 2;
    let k = a + Math.floor(l / 4) * 3;
    if (l >= 8) {
      if (l >= shortestNinther) {
        i = medianAdjacent(i);
        j = medianAdjacent(j);
        k = medianAdjacent(k);
      }
      j = median(i, j, k);
    }
    if (swaps.n === 0) return [j, Increasing];
    if (swaps.n === maxSwaps) return [j, Decreasing];
    return [j, Unknown];
  }

  function reverseRange(a: number, b: number): void {
    let i = a;
    let j = b - 1;
    while (i < j) {
      swap(i, j);
      i++;
      j--;
    }
  }

  function pdqsort(a: number, b: number, limit: number): void {
    const maxInsertion = 12;
    let wasBalanced = true;
    let wasPartitioned = true;
    for (;;) {
      const length = b - a;
      if (length <= maxInsertion) {
        insertionSort(a, b);
        return;
      }
      if (limit === 0) {
        heapSort(a, b);
        return;
      }
      if (!wasBalanced) {
        breakPatterns(a, b);
        limit--;
      }
      let [pivot, hint] = choosePivot(a, b);
      if (hint === Decreasing) {
        reverseRange(a, b);
        pivot = b - 1 - (pivot - a);
        hint = Increasing;
      }
      if (wasBalanced && wasPartitioned && hint === Increasing) {
        if (partialInsertionSort(a, b)) return;
      }
      if (a > 0 && !less(a - 1, pivot)) {
        a = partitionEqual(a, b, pivot);
        continue;
      }
      const [mid, already] = partition(a, b, pivot);
      wasPartitioned = already;
      const leftLen = mid - a;
      const rightLen = b - mid;
      const balanceThreshold = Math.floor(length / 8);
      if (leftLen < rightLen) {
        wasBalanced = leftLen >= balanceThreshold;
        pdqsort(a, mid, limit);
        a = mid + 1;
      } else {
        wasBalanced = rightLen >= balanceThreshold;
        pdqsort(mid + 1, b, limit);
        b = mid;
      }
    }
  }

  pdqsort(0, n, bitsLen(n));
  return data;
}
