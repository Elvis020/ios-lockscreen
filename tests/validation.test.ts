import { describe, expect, it } from 'vitest';
import { createCustomTheme, isValidDateString, isValidTimeZone } from '../lib/validation';

describe('validation', () => {
  it('rejects impossible calendar dates', () => {
    expect(isValidDateString('2026-02-29')).toBe(false);
    expect(isValidDateString('2028-02-29')).toBe(true);
    expect(isValidDateString('2026-13-01')).toBe(false);
  });

  it('validates IANA time zones', () => {
    expect(isValidTimeZone('Africa/Accra')).toBe(true);
    expect(isValidTimeZone('Not/A_Zone')).toBe(false);
  });

  it('requires strict custom theme syntax', () => {
    expect(
      createCustomTheme('midnight', [
        '#111111',
        '#EEEEEE',
        '#AAAAAA',
        '#FF6600',
        '#444444',
      ]),
    ).toMatchObject({ id: 'midnight', background: '#111111' });
    expect(createCustomTheme('Bad Name', ['#111111'])).toBeNull();
    expect(
      createCustomTheme('midnight', [
        '#11111Z',
        '#EEEEEE',
        '#AAAAAA',
        '#FF6600',
        '#444444',
      ]),
    ).toBeNull();
  });
});
