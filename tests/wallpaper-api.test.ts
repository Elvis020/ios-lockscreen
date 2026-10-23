import { describe, expect, it } from 'vitest';
import handler from '../api/wallpaper';

describe('wallpaper API', () => {
  it('constructs a public image response with explicit CDN caching', async () => {
    const response = await handler(
      new Request('https://example.com/api/wallpaper?view=week&theme=minimal'),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('image/png');
    expect(response.headers.get('cache-control')).toBe(
      'public, max-age=0, must-revalidate',
    );
    expect(response.headers.get('vercel-cdn-cache-control')).toBe(
      'public, s-maxage=3600',
    );
  });
});
