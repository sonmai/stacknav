/** Session cache, keyed by full URL so equal PR numbers in different repos cannot collide. */
export class PrTitles {
  private entries = new Map<string, { until: number; title?: string; pending: Promise<string | undefined> }>();

  constructor(private readonly read: (cwd: string, url: string) => Promise<string>,
    private readonly now = Date.now) {}

  peek(url: string): string | undefined { return this.entries.get(url)?.title; }
  clear(): void { this.entries.clear(); }

  get(cwd: string, url: string): Promise<string | undefined> {
    const cached = this.entries.get(url);
    if (cached && cached.until > this.now()) { return cached.pending; }
    if (this.entries.size >= 500) { this.entries.delete(this.entries.keys().next().value!); }
    const entry = { until: this.now() + 300_000, title: cached?.title,
      pending: Promise.resolve(undefined) as Promise<string | undefined> };
    entry.pending = this.read(cwd, url).then(title => {
      entry.title = title;
      return title;
    }).catch(() => {
      entry.until = this.now() + 30_000;
      return entry.title;
    });
    this.entries.set(url, entry);
    return entry.pending;
  }
}
