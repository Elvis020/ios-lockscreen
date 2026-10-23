import { describe, expect, it } from 'vitest';
import { handleLinkedTelegramCommand } from '../lib/telegramBot';

describe('Telegram commands', () => {
  it('documents view, timezone, theme, and Google sync controls', async () => {
    const help = await handleLinkedTelegramCommand(
      'token',
      '/help',
      [],
      'https://example.com',
    );

    expect(help).toContain('/view week|month|quarter');
    expect(help).toContain('/timezone Area/City');
    expect(help).toContain('/theme custom add');
    expect(help).toContain('/sync');
  });
});
