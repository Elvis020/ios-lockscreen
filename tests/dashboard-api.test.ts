import { describe, expect, it } from 'vitest';
import handler from '../api/index';

describe('dashboard API', () => {
  it('returns browser JavaScript that parses successfully', async () => {
    const response = handler();
    const html = await response.text();
    const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];

    expect(response.status).toBe(200);
    expect(script).toBeTruthy();
    expect(() => new Function(script as string)).not.toThrow();
  });

  it('migrates the legacy token key and exposes an explicit recovery copy action', async () => {
    const html = await handler().text();

    expect(html).toContain("const LEGACY_TOKEN_KEY = 'quarterProgressToken'");
    expect(html).toContain('localStorage.setItem(TOKEN_KEY, legacyToken)');
    expect(html).toContain('id="managementToken"');
    expect(html).toContain('id="copyTokenButton"');
    expect(html).toContain('Management token copied. Keep it private.');
  });
});
