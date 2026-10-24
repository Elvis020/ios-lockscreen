import { describe, expect, it } from 'vitest';
import { verifyTelegramInitData } from '../lib/telegramMiniAppAuth';

const BOT_TOKEN = '123456:test-token';
const NOW = Date.parse('2026-10-24T12:00:00.000Z');

describe('Telegram Mini App authentication', () => {
  it('accepts a current, correctly signed Telegram user', async () => {
    const initData = await signedInitData({
      auth_date: String(NOW / 1000),
      query_id: 'AAE-test-query',
      user: JSON.stringify({ id: 42, first_name: 'Ada' }),
    });

    await expect(verifyTelegramInitData(initData, NOW, BOT_TOKEN)).resolves.toEqual({
      userId: '42',
    });
  });

  it.each([
    ['tampered', async () => `${await validInitData()}&query_id=changed`],
    [
      'stale',
      () =>
        signedInitData({
          auth_date: String((NOW - 601_000) / 1000),
          user: JSON.stringify({ id: 42 }),
        }),
    ],
    [
      'future',
      () =>
        signedInitData({
          auth_date: String((NOW + 61_000) / 1000),
          user: JSON.stringify({ id: 42 }),
        }),
    ],
    [
      'malformed user',
      () =>
        signedInitData({
          auth_date: String(NOW / 1000),
          user: '{broken',
        }),
    ],
    [
      'string user id',
      () =>
        signedInitData({
          auth_date: String(NOW / 1000),
          user: JSON.stringify({ id: '42' }),
        }),
    ],
  ])('rejects %s launch data', async (_label, buildData) => {
    await expect(
      verifyTelegramInitData(await buildData(), NOW, BOT_TOKEN),
    ).resolves.toBeNull();
  });

  it('rejects duplicate security fields', async () => {
    const initData = await validInitData();
    const hash = new URLSearchParams(initData).get('hash');

    await expect(
      verifyTelegramInitData(`${initData}&hash=${hash}`, NOW, BOT_TOKEN),
    ).resolves.toBeNull();
  });
});

function validInitData(): Promise<string> {
  return signedInitData({
    auth_date: String(NOW / 1000),
    query_id: 'AAE-test-query',
    user: JSON.stringify({ id: 42 }),
  });
}

async function signedInitData(values: Record<string, string>): Promise<string> {
  const params = new URLSearchParams(values);
  const dataCheckString = [...params.entries()]
    .map(([key, value]) => `${key}=${value}`)
    .sort()
    .join('\n');
  const encoder = new TextEncoder();
  const firstKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode('WebAppData'),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const secret = await crypto.subtle.sign('HMAC', firstKey, encoder.encode(BOT_TOKEN));
  const secondKey = await crypto.subtle.importKey(
    'raw',
    secret,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign('HMAC', secondKey, encoder.encode(dataCheckString)),
  );

  params.set(
    'hash',
    [...signature].map((byte) => byte.toString(16).padStart(2, '0')).join(''),
  );

  return params.toString();
}
