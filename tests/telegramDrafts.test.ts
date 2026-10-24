import { describe, expect, it } from 'vitest';
import { BUILT_IN_THEMES, isReservedThemeId } from '../lib/preferences';
import { formatTelegramEventDate, parseTelegramEventInput } from '../lib/telegramDrafts';
import { normalizeUserData } from '../lib/userSchema';

describe('Telegram event date parsing', () => {
  const now = new Date('2026-12-31T23:30:00.000Z');

  it('uses the account timezone and rolls omitted dates into the next year', () => {
    expect(
      parseTelegramEventInput('Dentist tomorrow', 'Africa/Accra', now),
    ).toMatchObject({
      name: 'Dentist',
      date: '2027-01-01',
    });
    expect(
      parseTelegramEventInput('Birthday 1 January', 'Africa/Accra', now),
    ).toMatchObject({
      name: 'Birthday',
      date: '2027-01-01',
    });
  });

  it('rejects impossible dates and resolves next weekdays', () => {
    expect(
      parseTelegramEventInput('Leap 29 February 2027', 'UTC', now).error,
    ).toBeTruthy();
    expect(parseTelegramEventInput('Leap 29 February', 'UTC', now).date).toBe(
      '2028-02-29',
    );
    expect(parseTelegramEventInput('Conference next Friday', 'UTC', now).date).toBe(
      '2027-01-01',
    );
  });

  it('uses a strictly future weekday and handles account-local midnight', () => {
    const monday = new Date('2026-10-26T12:00:00.000Z');
    const nearMidnight = new Date('2026-10-24T23:30:00.000Z');

    expect(parseTelegramEventInput('Review next Monday', 'UTC', monday).date).toBe(
      '2026-11-02',
    );
    expect(
      parseTelegramEventInput('Dentist today', 'Pacific/Kiritimati', nearMidnight).date,
    ).toBe('2026-10-25');
  });

  it('keeps legacy ISO input while rejecting ambiguous and date-only input', () => {
    expect(parseTelegramEventInput('2026-11-01 Launch', 'UTC', now)).toMatchObject({
      name: 'Launch',
      date: '2026-11-01',
    });
    expect(parseTelegramEventInput('Planning 11/12', 'UTC', now).error).toBeTruthy();
    expect(parseTelegramEventInput('tomorrow', 'UTC', now).error).toBeTruthy();
    expect(parseTelegramEventInput('14 November', 'UTC', now).error).toBeTruthy();
    expect(
      parseTelegramEventInput('Review tomorrow next Friday', 'UTC', now).error,
    ).toBeTruthy();
  });

  it('formats resolved dates as full confirmation labels', () => {
    expect(formatTelegramEventDate('2026-10-25')).toBe('Sunday, 25 October 2026');
  });
});

describe('Built-in theme reservations', () => {
  it('reserves all eight built-ins and safely migrates colliding custom IDs', () => {
    expect(Object.keys(BUILT_IN_THEMES)).toHaveLength(8);
    expect(isReservedThemeId('midnight')).toBe(true);
    expect(BUILT_IN_THEMES).toMatchObject({
      midnight: {
        background: '#151827',
        passed: '#AEB8FF',
        weekend: '#7C8CFF',
        current: '#FF8A5B',
        future: '#34384F',
        text: '#F1F3FF',
        subtext: '#969CB8',
      },
      frost: { background: '#15212B', current: '#76F0D0' },
      espresso: { background: '#241B16', current: '#FFB347' },
      rosewood: { background: '#28191E', current: '#FFB35C' },
    });
    const user = normalizeUserData(
      {
        theme: 'midnight',
        customThemes: [theme('midnight'), theme('midnight-custom')],
      },
      'token',
    );

    expect(user?.theme).toBe('midnight-custom-2');
    expect(user?.customThemes.map(({ id }) => id)).toEqual([
      'midnight-custom-2',
      'midnight-custom',
    ]);
  });
});

function theme(id: string) {
  return {
    id,
    background: '#111111',
    passed: '#222222',
    weekend: '#333333',
    current: '#444444',
    future: '#555555',
    text: '#eeeeee',
    subtext: '#999999',
  };
}
