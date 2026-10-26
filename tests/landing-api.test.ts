import { afterEach, describe, expect, it } from 'vitest';
import handler from '../api/landing';

const originalEnvironment = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnvironment };
});

describe('landing page', () => {
  it('renders a public product page with truthful setup guidance', async () => {
    const response = handler();
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(html).toContain('<title>Calendar Lockscreen');
    expect(html).toContain('Your calendar, visible before you unlock.');
    expect(html).toContain('href="/app"');
    expect(html).toContain('Creates your private setup in Telegram');
    expect(html).toContain('iOS Shortcut');
    expect(html).toContain('/api/wallpaper?preset=hybrid');
    expect(html).toContain('preview=ios');
    expect(html).toContain('Simulated Lock Screen');
  });

  it('routes the primary setup action directly into Telegram when configured', async () => {
    process.env.TELEGRAM_BOT_USERNAME = '@calendar_lockscreen_bot';

    const html = await handler().text();

    expect(html).toContain('href="https://t.me/calendar_lockscreen_bot?start=setup"');
    expect(html).toContain('Continue with Telegram');
    expect(html).not.toContain('Invite code required');
  });

  it('does not expose dashboard credentials or a broken public Telegram link', async () => {
    const html = await handler().text();

    expect(html).not.toContain('id="managementToken"');
    expect(html).not.toContain('id="inviteCode"');
    expect(html).not.toContain('quarterProgressToken');
    expect(html).not.toContain('https://t.me/');
    expect(html).not.toContain('TELEGRAM_BOT_TOKEN');
  });

  it('includes accessible responsive and reduced-motion foundations', async () => {
    const html = await handler().text();

    expect(html).toContain('viewport-fit=cover');
    expect(html).toContain('href="#main">Skip to content');
    expect(html).toContain('@media (prefers-reduced-motion: reduce)');
    expect(html).toContain('width="1284" height="2778"');
    expect(html).toContain('fetchpriority="high"');
  });
});
