import type { Sql } from 'postgres';
import { describe, expect, it, vi } from 'vitest';

import { PoolManager } from './pools';

function fakeSql() {
  return {
    options: { parsers: {}, serializers: {} },
    end: vi.fn(async () => {}),
  } as unknown as Sql & {
    end: ReturnType<typeof vi.fn>;
  };
}

describe('PoolManager', () => {
  it('reuses pools, evicts the least recently used beyond maxPools, and sweeps idle ones', async () => {
    let now = 0;
    const created: ReturnType<typeof fakeSql>[] = [];
    const pools = new PoolManager({
      maxPools: 2,
      connectionsPerPool: 1,
      idleMs: 1000,
      now: () => now,
      connectFn: () => {
        const s = fakeSql();
        created.push(s);
        return s;
      },
    });

    pools.get('a', 'url-a');
    pools.get('b', 'url-b');
    pools.get('a', 'url-a'); // a is now most recent
    pools.get('c', 'url-c'); // evicts b
    expect(created).toHaveLength(3);
    expect(created[1]!.end).toHaveBeenCalled();
    expect(pools.getMetrics()).toMatchObject({ open: 2, created: 3, evicted: 1, hits: 1 });

    now = 5000;
    pools.get('c', 'url-c');
    await pools.sweepIdle(); // a idle since t=0
    expect(created[0]!.end).toHaveBeenCalled();
    expect(pools.getMetrics().open).toBe(1);
  });

  it('replaces a pool when the tenant URL rotates', () => {
    const created: ReturnType<typeof fakeSql>[] = [];
    const pools = new PoolManager({
      maxPools: 5,
      connectionsPerPool: 1,
      idleMs: 1000,
      connectFn: () => {
        const s = fakeSql();
        created.push(s);
        return s;
      },
    });
    pools.get('a', 'old');
    pools.get('a', 'new');
    expect(created).toHaveLength(2);
    expect(created[0]!.end).toHaveBeenCalled();
  });
});
