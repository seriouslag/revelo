import { describe, it, expect, vi } from 'vitest';
import { ReferenceCache } from '../core/cache';

function makeCache(now: () => number) {
  return new ReferenceCache<string>({ ttlMs: 1000, negativeTtlMs: 500, now });
}

describe('ReferenceCache', () => {
  it('caches a resolved value within TTL', async () => {
    let t = 0;
    const cache = makeCache(() => t);
    const loader = vi.fn().mockResolvedValue('v');

    expect(await cache.resolve('k', loader)).toBe('v');
    t = 500;
    expect(await cache.resolve('k', loader)).toBe('v');
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('reloads after TTL expiry', async () => {
    let t = 0;
    const cache = makeCache(() => t);
    const loader = vi.fn().mockResolvedValue('v');

    await cache.resolve('k', loader);
    t = 1001;
    await cache.resolve('k', loader);
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('de-dupes concurrent in-flight requests', async () => {
    const cache = makeCache(() => 0);
    let resolveFn!: (v: string) => void;
    const loader = vi.fn(() => new Promise<string>((r) => (resolveFn = r)));

    const a = cache.resolve('k', loader);
    const b = cache.resolve('k', loader);
    resolveFn('v');

    expect(await a).toBe('v');
    expect(await b).toBe('v');
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('negative-caches failures and re-throws the original error', async () => {
    let t = 0;
    const cache = makeCache(() => t);
    const loader = vi.fn().mockRejectedValue(new Error('boom'));

    await expect(cache.resolve('k', loader)).rejects.toThrow('boom');
    t = 100;
    // Within the negative-TTL window, the loader is not re-run and the same
    // error message is surfaced.
    await expect(cache.resolve('k', loader)).rejects.toThrow('boom');
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('retries after negative TTL expiry', async () => {
    let t = 0;
    const cache = makeCache(() => t);
    const loader = vi.fn().mockRejectedValue(new Error('boom'));

    await expect(cache.resolve('k', loader)).rejects.toThrow();
    t = 501;
    await expect(cache.resolve('k', loader)).rejects.toThrow();
    expect(loader).toHaveBeenCalledTimes(2);
  });
});
