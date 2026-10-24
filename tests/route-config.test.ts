import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('public routes', () => {
  it('keeps the product page at root and the existing dashboard at /app', async () => {
    const config = JSON.parse(await readFile('vercel.json', 'utf8')) as {
      rewrites: Array<{ source: string; destination: string }>;
    };

    expect(config.rewrites).toContainEqual({
      source: '/',
      destination: '/api/landing',
    });
    expect(config.rewrites).toContainEqual({ source: '/app', destination: '/api' });
  });
});
