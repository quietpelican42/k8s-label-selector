/** Thrown for every selector or requirement that apimachinery rejects. `message` is Go's error text. */
export class SelectorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SelectorError';
  }
}
