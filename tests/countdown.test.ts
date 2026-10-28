import { describe, expect, it } from 'vitest';
import { buildCountdown } from '../lib/countdown';
import { normalizeUserData } from '../lib/userSchema';

function user(timeZone: string, events: unknown[], extra: Record<string, unknown> = {}) {
  return normalizeUserData(
    { token: 'secret', name: 'Ada', timeZone, events, ...extra },
    'secret',
  )!;
}

describe('countdown', () => {
  it('selects by date and name, independent of focus and agenda, including selected Google events', () => {
    const data = user('UTC', [{ id: 'late', name: 'Late', date: '2026-11-20' }], {
      focusEventId: 'late',
      presentation: 'agenda',
      selectedEventIds: ['a', 'b'],
      cachedCalEvents: [
        { id: 'a', name: 'Zulu', date: '2026-11-01', accountEmail: 'a@example.com' },
        { id: 'b', name: 'Alpha', date: '2026-11-01', accountEmail: 'a@example.com' },
        { id: 'c', name: 'Hidden', date: '2026-10-30', accountEmail: 'a@example.com' },
      ],
    });

    expect(buildCountdown(data, new Date('2026-10-28T12:00:00Z')).nextEvent?.name).toBe(
      'Alpha',
    );
  });

  it('resolves recurring events and fractional-offset midnight', () => {
    const data = user('Asia/Kathmandu', [
      { id: 'a', name: 'Weekly', date: '2026-10-21', recurrence: 'weekly' },
    ]);
    const result = buildCountdown(data, new Date('2026-10-27T12:00:00Z'));

    expect(result.nextEvent).toMatchObject({
      date: '2026-10-28',
      targetAt: '2026-10-27T18:15:00.000Z',
      countdownLabel: 'Tomorrow',
    });
  });

  it('uses the offset at the target across daylight saving transitions', () => {
    const data = user('America/New_York', [
      { id: 'a', name: 'Event', date: '2026-03-09' },
    ]);
    const result = buildCountdown(data, new Date('2026-03-07T12:00:00Z'));

    expect(result.nextEvent?.targetAt).toBe('2026-03-09T04:00:00.000Z');
    expect(result.refreshAfter).toBe('2026-03-08T04:00:00.000Z');
  });

  it('uses the first real instant when daylight saving skips local midnight', () => {
    const data = user('America/Havana', [{ id: 'a', name: 'Event', date: '2026-03-08' }]);
    const result = buildCountdown(data, new Date('2026-03-07T12:00:00Z'));

    expect(result.nextEvent?.targetAt).toBe('2026-03-08T05:00:00.000Z');
  });

  it('refreshes at the 24-hour timer boundary on a 25-hour DST day', () => {
    const data = user('America/New_York', [
      { id: 'a', name: 'Event', date: '2026-11-02' },
    ]);
    const result = buildCountdown(data, new Date('2026-11-01T04:00:00Z'));

    expect(result.nextEvent).toMatchObject({
      targetAt: '2026-11-02T05:00:00.000Z',
      countdownLabel: 'Tomorrow',
    });
    expect(result.refreshAfter).toBe('2026-11-01T05:00:00.000Z');
  });

  it('requests the next account midnight for distant labels', () => {
    const data = user('Asia/Kathmandu', [{ id: 'a', name: 'Later', date: '2026-11-30' }]);
    const result = buildCountdown(data, new Date('2026-10-28T12:00:00Z'));

    expect(result.nextEvent?.countdownLabel).toBe('33d');
    expect(result.refreshAfter).toBe('2026-10-28T18:15:00.000Z');
  });

  it('includes today even after midnight', () => {
    const data = user('UTC', [{ id: 'a', name: 'Today', date: '2026-10-28' }]);

    expect(
      buildCountdown(data, new Date('2026-10-28T12:00:00Z')).nextEvent?.countdownLabel,
    ).toBe('Today');
  });

  it('uses the account-local date when UTC is still on the previous day', () => {
    const data = user('Pacific/Kiritimati', [
      { id: 'a', name: 'Local today', date: '2026-10-29' },
    ]);
    const result = buildCountdown(data, new Date('2026-10-28T10:30:00Z'));

    expect(result.nextEvent).toMatchObject({
      date: '2026-10-29',
      targetAt: '2026-10-28T10:00:00.000Z',
      daysLeft: 0,
      countdownLabel: 'Today',
    });
  });
});
