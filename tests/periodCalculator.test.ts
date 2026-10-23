import { describe, expect, it } from 'vitest';
import { getPeriodInfo } from '../lib/periodCalculator';

describe('getPeriodInfo', () => {
  it('uses the user time zone at a UTC date boundary', () => {
    const instant = new Date('2026-01-01T00:30:00Z');

    expect(getPeriodInfo(instant, 'quarter', 'UTC')).toMatchObject({
      title: 'Q1 2026',
      currentDate: '2026-01-01',
      currentDay: 1,
    });
    expect(getPeriodInfo(instant, 'quarter', 'America/Los_Angeles')).toMatchObject({
      title: 'Q4 2025',
      currentDate: '2025-12-31',
      endDate: '2025-12-31',
    });
  });

  it('starts weeks on Sunday', () => {
    expect(getPeriodInfo(new Date('2026-10-23T12:00:00Z'), 'week', 'UTC')).toMatchObject({
      startDate: '2026-10-18',
      endDate: '2026-10-24',
      currentDay: 6,
    });
  });
});
