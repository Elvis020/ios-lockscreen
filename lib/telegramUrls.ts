export function telegramSetupUrl(): string | null {
  const username = process.env.TELEGRAM_BOT_USERNAME?.trim().replace(/^@/, '');

  if (!username || !/^[A-Za-z0-9_]{5,32}$/.test(username)) {
    return null;
  }

  return `https://t.me/${username}?start=setup`;
}
