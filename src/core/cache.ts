interface Entry<T> {
  value: T;
  expiresAt: number;
}

export interface CacheOptions {
  ttlMs: number;
  negativeTtlMs: number;
  now?: () => number;
}

export class ReferenceCache<T> {
  private readonly hits = new Map<string, Entry<T>>();
  private readonly misses = new Map<string, Entry<unknown>>();
  private readonly inflight = new Map<string, Promise<T>>();
  private readonly now: () => number;

  constructor(private readonly options: CacheOptions) {
    this.now = options.now ?? Date.now;
  }

  async resolve(key: string, loader: () => Promise<T>): Promise<T> {
    const now = this.now();

    const hit = this.hits.get(key);
    if (hit && hit.expiresAt > now) {
      return hit.value;
    }

    // During the negative-TTL window, re-throw the original error so callers
    // see the real reason (e.g. "No Sentry token configured") on every hover,
    // not a generic failure.
    const miss = this.misses.get(key);
    if (miss && miss.expiresAt > now) {
      throw miss.value;
    }

    const pending = this.inflight.get(key);
    if (pending) {
      return pending;
    }

    const promise = loader()
      .then((value) => {
        this.hits.set(key, { value, expiresAt: this.now() + this.options.ttlMs });
        this.misses.delete(key);
        return value;
      })
      .finally(() => {
        this.inflight.delete(key);
      });

    this.inflight.set(key, promise);

    try {
      return await promise;
    } catch (error) {
      this.misses.set(key, { value: error, expiresAt: this.now() + this.options.negativeTtlMs });
      throw error;
    }
  }

  clear(): void {
    this.hits.clear();
    this.misses.clear();
    this.inflight.clear();
  }
}
