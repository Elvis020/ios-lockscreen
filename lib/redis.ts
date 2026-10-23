import { Redis } from '@upstash/redis';

export class RedisConfigurationError extends Error {
  constructor() {
    super('Redis is not configured');
    this.name = 'RedisConfigurationError';
  }
}

let client: Redis | null = null;

export function getRedis(): Redis {
  if (client) {
    return client;
  }

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    throw new RedisConfigurationError();
  }

  client = new Redis({ url, token });

  return client;
}

export function isRedisConfigurationError(
  error: unknown,
): error is RedisConfigurationError {
  return error instanceof RedisConfigurationError;
}
