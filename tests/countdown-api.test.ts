import { beforeEach, describe, expect, it, vi } from 'vitest';
import { normalizeUserData } from '../lib/userSchema';

const lookup = vi.hoisted(() => vi.fn());

vi.mock('../lib/tokenManager', () => ({ getUserByWallpaperKey: lookup }));

import handler from '../api/countdown';

const key = '12345678-1234-1234-1234-123456789abc';

describe('countdown API', () => {
  beforeEach(() => lookup.mockReset());

  it('rejects methods, token credentials and malformed keys before storage', async () => {
    expect(
      (
        await handler(
          new Request('https://example.com/api/countdown', { method: 'POST' }),
        )
      ).headers.get('allow'),
    ).toBe('GET');
    expect(
      (
        await handler(
          new Request(
            `https://example.com/api/countdown?wallpaperKey=${key}&token=secret`,
          ),
        )
      ).status,
    ).toBe(400);
    expect(
      (await handler(new Request('https://example.com/api/countdown?wallpaperKey=bad')))
        .status,
    ).toBe(401);
    expect(
      (
        await handler(
          new Request(
            `https://example.com/api/countdown?wallpaperKey=${key}&wallpaperKey=${key}`,
          ),
        )
      ).status,
    ).toBe(401);
    expect(lookup).not.toHaveBeenCalled();
  });

  it('returns only the private versioned payload and private cache headers', async () => {
    lookup.mockResolvedValue(
      normalizeUserData(
        { name: 'Ada', token: 'secret', timeZone: 'UTC', events: [] },
        'secret',
      ),
    );
    const response = await handler(
      new Request(`https://example.com/api/countdown?wallpaperKey=${key}`),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(response.headers.get('cache-control')).toBe('private, no-store, max-age=0');
    expect(response.headers.get('cdn-cache-control')).toBe('private, no-store');
    expect(response.headers.get('vercel-cdn-cache-control')).toBe('private, no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(Object.keys(body).sort()).toEqual([
      'generatedAt',
      'nextEvent',
      'refreshAfter',
      'version',
    ]);
    expect(body.nextEvent).toBeNull();
    expect(JSON.stringify(body)).not.toContain('secret');
  });

  it('hides unknown credentials and storage errors', async () => {
    lookup.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('secret'));
    const url = `https://example.com/api/countdown?wallpaperKey=${key}`;
    const unknown = await handler(new Request(url));
    const failure = await handler(new Request(url));

    expect(unknown.status).toBe(401);
    expect(failure.status).toBe(500);
    expect(await failure.text()).not.toContain('secret');
  });
});
