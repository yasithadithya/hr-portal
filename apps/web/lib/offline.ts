'use client';

/**
 * Last-known data for a few self-service views (PLAN.md Phase 8: cached last payslip list and
 * balances). Successful responses are kept in localStorage; when the browser is offline the
 * cached copy is returned instead of an error. Nothing sensitive beyond what the page shows.
 */
const PREFIX = 'hr-offline:';

export async function withOfflineCache<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  try {
    const data = await fetcher();
    try {
      localStorage.setItem(PREFIX + key, JSON.stringify({ at: Date.now(), data }));
    } catch {
      // Storage full or disabled: caching is best-effort.
    }
    return data;
  } catch (err) {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      const raw = localStorage.getItem(PREFIX + key);
      if (raw) return (JSON.parse(raw) as { data: T }).data;
    }
    throw err;
  }
}

/** Remove cached data on sign-out (another person may use the device next). */
export function clearOfflineCache() {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith(PREFIX)) localStorage.removeItem(k);
  } catch {
    // ignore
  }
}
