export interface PrDetails { title: string; body: string }

/** Session cache, keyed by full URL so equal PR numbers in different repos cannot collide. */
export class PrDetailsCache {
  private entries = new Map<string, { until: number; details?: PrDetails; pending: Promise<PrDetails | undefined> }>();

  constructor(private readonly read: (cwd: string, url: string) => Promise<PrDetails>,
    private readonly now = Date.now) {}

  peek(url: string): PrDetails | undefined { return this.entries.get(url)?.details; }
  clear(): void { this.entries.clear(); }

  get(cwd: string, url: string): Promise<PrDetails | undefined> {
    const cached = this.entries.get(url);
    if (cached && cached.until > this.now()) { return cached.pending; }
    if (this.entries.size >= 500) { this.entries.delete(this.entries.keys().next().value!); }
    const entry = { until: this.now() + 300_000, details: cached?.details,
      pending: Promise.resolve(undefined) as Promise<PrDetails | undefined> };
    entry.pending = this.read(cwd, url).then(details => {
      entry.details = details;
      return details;
    }).catch(() => {
      entry.until = this.now() + 30_000;
      return entry.details;
    });
    this.entries.set(url, entry);
    return entry.pending;
  }
}
