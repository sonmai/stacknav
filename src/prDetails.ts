export interface PrDetails { title: string; body?: string }
interface Entry {
  until: number;
  details?: PrDetails;
  pending: Promise<PrDetails | undefined>;
  signal?: AbortSignal;
}

/** Titles and description previews expire independently; cancelled reads are retried immediately. */
export class PrDetailsCache {
  private entries = new Map<string, Entry>();
  constructor(private readonly read: (cwd: string, url: string, includeBody: boolean, signal?: AbortSignal) => Promise<PrDetails>,
    private readonly now = Date.now) {}

  peek(url: string): PrDetails | undefined {
    const title = this.entries.get(url + '\0title');
    const body = this.entries.get(url + '\0body');
    const latest = (title?.until ?? 0) > (body?.until ?? 0) ? title?.details : body?.details;
    const details = latest ?? title?.details ?? body?.details;
    return details && { title: details.title, body: body?.details?.body };
  }
  clear(): void { this.entries.clear(); }

  get(cwd: string, url: string, includeBody = true, signal?: AbortSignal): Promise<PrDetails | undefined> {
    if (signal?.aborted) { return Promise.resolve(undefined); }
    const key = url + (includeBody ? '\0body' : '\0title');
    const cached = this.entries.get(key);
    if (cached && !cached.signal?.aborted && cached.until > this.now()) { return cached.pending; }
    const full = this.entries.get(url + '\0body');
    if (!includeBody && full && !full.signal?.aborted && full.until > this.now()) { return full.pending; }
    if (this.entries.size >= 500) { this.entries.delete(this.entries.keys().next().value!); }
    const entry: Entry = { until: this.now() + 300_000, details: cached?.details, signal,
      pending: Promise.resolve(undefined) };
    entry.pending = this.read(cwd, url, includeBody, signal).then(details => {
      if (!signal?.aborted) { entry.details = details; entry.signal = undefined; }
      else { entry.until = 0; }
      return entry.details;
    }).catch(() => {
      entry.until = signal?.aborted ? 0 : this.now() + 30_000;
      if (!signal?.aborted) { entry.signal = undefined; }
      return entry.details;
    });
    this.entries.set(key, entry);
    return entry.pending;
  }
}
