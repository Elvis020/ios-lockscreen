import { describe, expect, it } from 'vitest';
import { getLivingThemePrimitives } from '../lib/livingThemes';
import {
  LOCK_SCREEN_CONTENT_BANDS,
  WALLPAPER_HEIGHT,
  WALLPAPER_WIDTH,
} from '../lib/wallpaperLayout';
import type { LivingOverlay } from '../lib/userSchema';

describe('living theme primitives', () => {
  it.each(['snow', 'rain', 'stars', 'haze', 'sunset'] as LivingOverlay[])(
    'keeps %s primitives on canvas and outside lock-screen content',
    (overlay) => {
      const primitives = getLivingThemePrimitives({
        overlay,
        profile: 'standard',
        date: '2026-10-24',
        accountSeed: 'account-a',
        now: new Date('2026-10-24T10:01:00Z'),
      });
      const band = LOCK_SCREEN_CONTENT_BANDS.standard;

      expect(primitives.length).toBeGreaterThan(0);
      expect(primitives.length).toBeLessThanOrEqual(36);

      for (const primitive of primitives) {
        const width = primitive.kind === 'circle' ? primitive.diameter : primitive.width;
        const height =
          primitive.kind === 'circle' ? primitive.diameter : primitive.height;

        expect(primitive.x).toBeGreaterThanOrEqual(0);
        expect(primitive.y).toBeGreaterThanOrEqual(0);
        expect(primitive.x + width).toBeLessThanOrEqual(WALLPAPER_WIDTH);
        expect(primitive.y + height).toBeLessThanOrEqual(WALLPAPER_HEIGHT);
        expect(primitive.y + height <= band.top || primitive.y >= band.bottom).toBe(true);
        expect(primitive.fill).toMatch(/^#[0-9A-F]{6}$/i);
      }
    },
  );

  it('is stable within a refresh frame and changes across frames', () => {
    const options = {
      overlay: 'snow' as const,
      profile: 'large-clock' as const,
      date: '2026-12-24',
      accountSeed: 'account-a',
    };
    const first = getLivingThemePrimitives({
      ...options,
      now: new Date('2026-12-24T10:01:00Z'),
    });
    const sameFrame = getLivingThemePrimitives({
      ...options,
      now: new Date('2026-12-24T10:14:59Z'),
    });
    const nextFrame = getLivingThemePrimitives({
      ...options,
      now: new Date('2026-12-24T10:15:00Z'),
    });

    expect(sameFrame).toEqual(first);
    expect(nextFrame).not.toEqual(first);
  });

  it('maps seasonal mode deterministically from the date', () => {
    const seasonal = getLivingThemePrimitives({
      overlay: 'seasonal',
      profile: 'standard',
      date: '2026-12-24',
      accountSeed: 'account-a',
      now: new Date('2026-12-24T10:01:00Z'),
    });
    const snow = getLivingThemePrimitives({
      overlay: 'snow',
      profile: 'standard',
      date: '2026-12-24',
      accountSeed: 'account-a',
      now: new Date('2026-12-24T10:01:00Z'),
    });

    expect(seasonal).toEqual(snow);
  });
});
