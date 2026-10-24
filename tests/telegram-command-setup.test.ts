import { describe, expect, it, vi } from 'vitest';
import {
  configureTelegramCommands,
  TELEGRAM_COMMANDS,
} from '../scripts/configure-telegram-commands';

describe('Telegram command setup', () => {
  it('registers and verifies the supported commands for private chats', async () => {
    const requests: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const fetchImplementation = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        requests.push({ input, init });

        const result = String(input).endsWith('/setMyCommands')
          ? true
          : TELEGRAM_COMMANDS;

        return Response.json({ ok: true, result });
      },
    ) as unknown as typeof fetch;

    await expect(
      configureTelegramCommands(fetchImplementation, {
        TELEGRAM_BOT_TOKEN: 'test-bot-token',
      }),
    ).resolves.toEqual(TELEGRAM_COMMANDS.map(({ command }) => command));

    expect(requests).toHaveLength(2);
    expect(String(requests[0].input).endsWith('/setMyCommands')).toBe(true);
    expect(String(requests[1].input).endsWith('/getMyCommands')).toBe(true);

    const setBody = JSON.parse(String(requests[0].init?.body));
    const getBody = JSON.parse(String(requests[1].init?.body));

    expect(setBody).toEqual({
      commands: TELEGRAM_COMMANDS,
      scope: { type: 'all_private_chats' },
    });
    expect(getBody).toEqual({ scope: { type: 'all_private_chats' } });
  });

  it('keeps command names valid, unique, and aligned with handlers', () => {
    const expectedCommands = [
      'help',
      'status',
      'url',
      'add',
      'events',
      'edit',
      'eventcount',
      'delete',
      'view',
      'range',
      'layout',
      'profile',
      'timezone',
      'theme',
      'sync',
    ];

    expect(TELEGRAM_COMMANDS.map(({ command }) => command)).toEqual(expectedCommands);
    expect(
      TELEGRAM_COMMANDS.find(({ command }) => command === 'add')?.description,
    ).toContain('guided date choices');
    expect(new Set(expectedCommands).size).toBe(expectedCommands.length);

    for (const { command, description } of TELEGRAM_COMMANDS) {
      expect(command).toMatch(/^[a-z0-9_]{1,32}$/);
      expect(description.length).toBeGreaterThanOrEqual(1);
      expect(description.length).toBeLessThanOrEqual(256);
    }
  });

  it('redacts the token when Telegram cannot be reached', async () => {
    const botToken = 'sensitive-test-bot-token';
    const fetchImplementation = vi.fn(async () => {
      throw new Error(`Request failed for ${botToken}`);
    }) as unknown as typeof fetch;

    let message = '';

    try {
      await configureTelegramCommands(fetchImplementation, {
        TELEGRAM_BOT_TOKEN: botToken,
      });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toBe('Telegram setMyCommands request failed');
    expect(message).not.toContain(botToken);
  });
});
