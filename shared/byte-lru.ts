/** Bounded cache; eviction only drops cached references, never invalidates consumers. */
export class ByteLru<T> {
  private entries = new Map<string, { value: T; bytes: number }>();
  private total = 0;
  readonly maxEntries: number;
  readonly maxBytes: number;
  private measure: (value: T, key: string) => number;
  constructor(maxEntries: number, maxBytes: number, measure: (value: T, key: string) => number) {
    this.maxEntries = maxEntries; this.maxBytes = maxBytes; this.measure = measure;
  }
  get size() { return this.entries.size; }
  get bytes() { return this.total; }
  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key); this.entries.set(key, entry);
    return entry.value;
  }
  set(key: string, value: T) {
    const old = this.entries.get(key);
    if (old) { this.total -= old.bytes; this.entries.delete(key); }
    const bytes = this.measure(value, key);
    if (!Number.isFinite(bytes) || bytes < 0 || bytes > this.maxBytes) return;
    while (this.entries.size && (this.entries.size >= this.maxEntries || this.total + bytes > this.maxBytes)) {
      const first = this.entries.keys().next().value!;
      this.total -= this.entries.get(first)!.bytes;
      this.entries.delete(first);
    }
    this.entries.set(key, { value, bytes }); this.total += bytes;
  }
  clear() { this.entries.clear(); this.total = 0; }
}
