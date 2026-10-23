import type { Redis } from '@upstash/redis';
import { describe, expect, it, vi } from 'vitest';
import { withRedisLock } from '../lib/redisLock';
import { InMemoryRedis } from './helpers/inMemoryRedis';

describe('Redis owner locks', () => {
  it('does not release a lease that has a different owner', async () => {
    const redis = new InMemoryRedis();

    await withRedisLock(redis as unknown as Redis, 'resource', async () => {
      await redis.set('lock:resource', 'new-owner');
    });

    expect(await redis.get('lock:resource')).toBe('new-owner');
  });

  it('bounds acquisition attempts when a resource remains busy', async () => {
    const redis = new InMemoryRedis();
    const wait = vi.fn().mockResolvedValue(undefined);

    await redis.set('lock:resource', 'existing-owner');

    await expect(
      withRedisLock(redis as unknown as Redis, 'resource', async () => undefined, {
        attempts: 3,
        wait,
      }),
    ).rejects.toThrow('Another update is in progress; please retry');
    expect(wait).toHaveBeenCalledTimes(2);
  });

  it('does not turn a successful operation into a retry when release fails', async () => {
    const redis = new InMemoryRedis();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    vi.spyOn(redis, 'eval').mockRejectedValueOnce(new Error('release unavailable'));

    await expect(
      withRedisLock(redis as unknown as Redis, 'resource', async () => 'committed'),
    ).resolves.toBe('committed');
    expect(errorSpy).toHaveBeenCalledWith(
      'Redis lock release failed; waiting for TTL:',
      expect.any(Error),
    );
  });
});
