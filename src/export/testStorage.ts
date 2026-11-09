/**
 * In-memory stand-in for `localStorage` shared by the export/import unit
 * tests. `failWritesTo` makes `setItem` throw for the given keys (like a full
 * disk), and `failWritesAfter` lets that many writes through first.
 */
export class FakeStorage implements Storage {
  private readonly data = new Map<string, string>();

  /** Keys whose writes throw. */
  failingKeys = new Set<string>();

  /** Every key written, in order (including backups). */
  readonly writeLog: string[] = [];

  constructor(initial: Record<string, string> = {}) {
    for (const [key, value] of Object.entries(initial)) this.data.set(key, value);
  }

  get length(): number {
    return this.data.size;
  }

  key(index: number): string | null {
    return [...this.data.keys()][index] ?? null;
  }

  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    if (this.failingKeys.has(key)) throw new Error(`quota exceeded for ${key}`);
    this.writeLog.push(key);
    this.data.set(key, value);
  }

  removeItem(key: string): void {
    this.data.delete(key);
  }

  clear(): void {
    this.data.clear();
  }

  [name: string]: unknown;
}
