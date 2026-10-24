import { describe, expect, it } from 'vitest';
import {
  buildEventTimeline,
  expandManualEvent,
  nextOccurrenceOnOrAfter,
} from '../lib/eventTimeline';
import type { ManualEvent } from '../lib/userSchema';

describe('event timeline', () => {
  it('keeps monthly recurrence anchored instead of drifting through short months', () => {
    const event = manualEvent('2026-01-31', 'monthly');

    expect(expandManualEvent(event, '2026-02-01', '2026-05-31')).toEqual([
      '2026-03-31',
      '2026-05-31',
    ]);
    expect(nextOccurrenceOnOrAfter(event, '2026-02-01')).toBe('2026-03-31');
  });

  it('keeps leap-day yearly recurrence on leap years', () => {
    expect(
      expandManualEvent(manualEvent('2024-02-29', 'yearly'), '2025-01-01', '2030-12-31'),
    ).toEqual(['2028-02-29']);
  });

  it('assigns Google references from selected order and keeps category overrides', () => {
    const timeline = buildEventTimeline(
      [],
      [
        {
          id: 'later-selected',
          name: 'Second ref',
          date: '2026-11-02',
          source: 'google',
          category: 'travel',
        } as never,
        {
          id: 'first-selected',
          name: 'First ref',
          date: '2026-11-01',
          source: 'google',
          category: 'work',
        } as never,
      ],
      ['first-selected', 'later-selected'],
      '2026-11-01',
      '2026-11-30',
    );

    expect(timeline).toEqual([
      expect.objectContaining({
        id: 'first-selected',
        stableRef: 'G1',
        category: 'work',
      }),
      expect.objectContaining({
        id: 'later-selected',
        stableRef: 'G2',
        category: 'travel',
      }),
    ]);
  });
});

function manualEvent(date: string, recurrence: ManualEvent['recurrence']): ManualEvent {
  return {
    id: 'manual',
    name: 'Recurring event',
    date,
    source: 'manual',
    createdAt: '2026-01-01T00:00:00.000Z',
    category: 'general',
    recurrence,
  };
}
