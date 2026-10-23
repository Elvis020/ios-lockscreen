import type { Redis } from '@upstash/redis';

const RELEASE_LOCK_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
end
return 0
`;

const FENCED_COMMIT_SCRIPT = `
-- FENCED_COMMIT
local lockCount = tonumber(ARGV[1])

for index = 1, lockCount do
  if redis.call("get", KEYS[index]) ~= ARGV[index + 1] then
    return 0
  end
end

local argumentIndex = lockCount + 2
local setCount = tonumber(ARGV[argumentIndex])
argumentIndex = argumentIndex + 1

for index = 1, setCount do
  local key = KEYS[lockCount + index]
  local value = ARGV[argumentIndex]
  local ttlSeconds = tonumber(ARGV[argumentIndex + 1])

  if ttlSeconds > 0 then
    redis.call("set", key, value, "EX", ttlSeconds)
  else
    redis.call("set", key, value)
  end

  argumentIndex = argumentIndex + 2
end

for index = lockCount + setCount + 1, #KEYS do
  redis.call("del", KEYS[index])
end

return 1
`;

const DEFAULT_TTL_MS = 10_000;
const DEFAULT_ATTEMPTS = 8;

export class RedisLockTimeoutError extends Error {
  constructor() {
    super('Another update is in progress; please retry');
    this.name = 'RedisLockTimeoutError';
  }
}

export class RedisLeaseLostError extends Error {
  constructor() {
    super('Redis lock lease was lost before commit');
    this.name = 'RedisLeaseLostError';
  }
}

export interface RedisLease {
  key: string;
  owner: string;
}

export interface RedisFencedSet {
  key: string;
  value: unknown;
  ttlSeconds?: number;
}

export interface RedisLockOptions {
  attempts?: number;
  ttlMs?: number;
  wait?: (milliseconds: number) => Promise<void>;
}

export async function deleteRedisKeyIfValue(
  redis: Redis,
  key: string,
  value: string,
): Promise<boolean> {
  const deleted = await redis.eval<[string], number>(RELEASE_LOCK_SCRIPT, [key], [value]);

  return deleted === 1;
}

export async function withRedisLock<T>(
  redis: Redis,
  resource: string,
  operation: (lease: RedisLease) => Promise<T>,
  options: RedisLockOptions = {},
): Promise<T> {
  const lockKey = `lock:${resource}`;
  const owner = crypto.randomUUID();
  const attempts = options.attempts ?? DEFAULT_ATTEMPTS;
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const wait = options.wait ?? defaultWait;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const acquired = await redis.set(lockKey, owner, { nx: true, px: ttlMs });

    if (acquired === 'OK') {
      const lease = { key: lockKey, owner };

      try {
        return await operation(lease);
      } catch (error) {
        if (!(error instanceof RedisLeaseLostError) || attempt === attempts - 1) {
          throw error;
        }
      } finally {
        try {
          await deleteRedisKeyIfValue(redis, lockKey, owner);
        } catch (error) {
          console.error('Redis lock release failed; waiting for TTL:', error);
        }
      }

      continue;
    }

    if (attempt < attempts - 1) {
      await wait(Math.min(25 * 2 ** attempt, 200));
    }
  }

  throw new RedisLockTimeoutError();
}

export async function withRedisLocks<T>(
  redis: Redis,
  resources: string[],
  operation: (leases: RedisLease[]) => Promise<T>,
  options: RedisLockOptions = {},
): Promise<T> {
  const uniqueResources = [...new Set(resources)].sort();

  async function acquireAt(index: number, leases: RedisLease[]): Promise<T> {
    const resource = uniqueResources[index];

    if (!resource) {
      return operation(leases);
    }

    return withRedisLock(
      redis,
      resource,
      (lease) => acquireAt(index + 1, [...leases, lease]),
      options,
    );
  }

  return acquireAt(0, []);
}

export async function commitIfLeasesOwned(
  redis: Redis,
  leases: RedisLease[],
  sets: RedisFencedSet[],
  deletes: string[] = [],
): Promise<void> {
  const keys = [
    ...leases.map(({ key }) => key),
    ...sets.map(({ key }) => key),
    ...deletes,
  ];
  const args = [
    String(leases.length),
    ...leases.map(({ owner }) => owner),
    String(sets.length),
    ...sets.flatMap(({ value, ttlSeconds }) => [
      serializeRedisValue(value),
      String(ttlSeconds ?? 0),
    ]),
  ];
  const committed = await redis.eval<string[], number>(FENCED_COMMIT_SCRIPT, keys, args);

  if (committed !== 1) {
    throw new RedisLeaseLostError();
  }
}

function defaultWait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function serializeRedisValue(value: unknown): string {
  const serialized = JSON.stringify(value);

  if (serialized === undefined) {
    throw new Error('Cannot persist an undefined Redis value');
  }

  return serialized;
}
