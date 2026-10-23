type SetOptions = {
  nx?: true;
  ex?: number;
  px?: number;
};

type Operation = () => unknown;

export class InMemoryRedis {
  readonly store = new Map<string, unknown>();
  readonly failDirectSetKeys = new Set<string>();
  readonly directSetAttempts = new Map<string, number>();

  async get<T>(key: string): Promise<T | null> {
    return clone(this.store.get(key)) as T | null;
  }

  async getdel<T>(key: string): Promise<T | null> {
    const value = await this.get<T>(key);

    this.store.delete(key);

    return value;
  }

  async set(key: string, value: unknown, options: SetOptions = {}): Promise<'OK' | null> {
    this.directSetAttempts.set(key, (this.directSetAttempts.get(key) ?? 0) + 1);

    if (this.failDirectSetKeys.has(key)) {
      throw new Error(`Injected direct SET failure for ${key}`);
    }

    if (options.nx && this.store.has(key)) {
      return null;
    }

    this.store.set(key, clone(value));

    return 'OK';
  }

  async del(...keys: string[]): Promise<number> {
    let deleted = 0;

    for (const key of keys) {
      deleted += Number(this.store.delete(key));
    }

    return deleted;
  }

  async eval<TArgs extends unknown[], TData>(
    script: string,
    keys: string[],
    args: TArgs,
  ): Promise<TData> {
    if (script.includes('FENCED_COMMIT')) {
      return this.runFencedCommit(keys, args) as TData;
    }

    const [key] = keys;
    const [expected] = args;
    const matches = this.store.get(key) === expected;

    if (matches) {
      this.store.delete(key);
    }

    return Number(matches) as TData;
  }

  multi(): InMemoryTransaction {
    return new InMemoryTransaction(this);
  }

  private runFencedCommit(keys: string[], rawArgs: unknown[]): number {
    const args = rawArgs.map(String);
    const lockCount = Number(args[0]);

    for (let index = 0; index < lockCount; index += 1) {
      if (this.store.get(keys[index]) !== args[index + 1]) {
        return 0;
      }
    }

    let argumentIndex = lockCount + 1;
    const setCount = Number(args[argumentIndex]);

    argumentIndex += 1;

    for (let index = 0; index < setCount; index += 1) {
      const key = keys[lockCount + index];
      const value = parseSerializedValue(args[argumentIndex]);

      this.store.set(key, clone(value));
      argumentIndex += 2;
    }

    for (let index = lockCount + setCount; index < keys.length; index += 1) {
      this.store.delete(keys[index]);
    }

    return 1;
  }
}

class InMemoryTransaction {
  private readonly operations: Operation[] = [];

  constructor(private readonly redis: InMemoryRedis) {}

  set(key: string, value: unknown): this {
    this.operations.push(() => this.redis.store.set(key, clone(value)));

    return this;
  }

  del(...keys: string[]): this {
    this.operations.push(() => {
      for (const key of keys) {
        this.redis.store.delete(key);
      }
    });

    return this;
  }

  async exec(): Promise<unknown[]> {
    return this.operations.map((operation) => operation());
  }
}

function clone<T>(value: T): T | null {
  if (value === undefined) {
    return null;
  }

  return structuredClone(value);
}

function parseSerializedValue(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
