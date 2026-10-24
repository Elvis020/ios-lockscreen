import type { LivingOverlay } from './userSchema';
import {
  LOCK_SCREEN_CONTENT_BANDS,
  WALLPAPER_HEIGHT,
  WALLPAPER_WIDTH,
} from './wallpaperLayout';

export type LivingPrimitive =
  | { kind: 'circle'; x: number; y: number; diameter: number; fill: string }
  | {
      kind: 'roundRect';
      x: number;
      y: number;
      width: number;
      height: number;
      radius: number;
      fill: string;
    };

export function getLivingThemePrimitives(options: {
  overlay: LivingOverlay;
  profile: keyof typeof LOCK_SCREEN_CONTENT_BANDS;
  date: string;
  accountSeed: string;
  now?: Date;
}): LivingPrimitive[] {
  const overlay =
    options.overlay === 'seasonal' ? seasonal(options.date) : options.overlay;

  if (overlay === 'none') return [];
  const frame = Math.floor((options.now?.getTime() ?? Date.now()) / 900_000);
  const random = seeded(`${options.accountSeed}:${options.date}:${overlay}:${frame}`);
  const band = LOCK_SCREEN_CONTENT_BANDS[options.profile];
  const zones = [
    { top: 0, bottom: band.top - 10 },
    { top: band.bottom + 10, bottom: WALLPAPER_HEIGHT },
  ].filter(({ bottom, top }) => bottom > top);
  const point = (width = 0, height = 0) => {
    const zone = zones[Math.floor(random() * zones.length)];
    const maxX = Math.max(0, WALLPAPER_WIDTH - width);
    const minY = Math.min(Math.max(zone.top, 0), Math.max(0, WALLPAPER_HEIGHT - height));
    const maxY = Math.max(
      minY,
      Math.min(zone.bottom - height, WALLPAPER_HEIGHT - height),
    );

    return {
      x: Math.floor(random() * (maxX + 1)),
      y: Math.floor(minY + random() * (maxY - minY + 1)),
    };
  };
  const color =
    overlay === 'snow'
      ? '#8A939D'
      : overlay === 'rain'
        ? '#5D7186'
        : overlay === 'stars'
          ? '#8E918E'
          : '#4D5357';

  if (overlay === 'sunset') {
    return [
      { kind: 'circle', x: 960, y: 140, diameter: 180, fill: '#9B6248' },
      {
        kind: 'roundRect',
        x: 0,
        y: 350,
        width: WALLPAPER_WIDTH,
        height: 40,
        radius: 20,
        fill: '#4A3431',
      },
      {
        kind: 'roundRect',
        x: 0,
        y: 430,
        width: WALLPAPER_WIDTH,
        height: 26,
        radius: 13,
        fill: '#3B302F',
      },
    ];
  }
  if (overlay === 'haze') {
    return Array.from({ length: 6 }, (_, index) => {
      const height = 18 + index * 3;
      const { y } = point(WALLPAPER_WIDTH, height);

      return {
        kind: 'roundRect' as const,
        x: 0,
        y,
        width: WALLPAPER_WIDTH,
        height,
        radius: 12,
        fill: '#454D50',
      };
    });
  }

  return Array.from({ length: 24 }, () => {
    const { x, y } = point(
      overlay === 'rain' ? 4 : overlay === 'stars' ? 4 : 7,
      overlay === 'rain' ? 22 : overlay === 'stars' ? 4 : 7,
    );

    if (overlay === 'rain')
      return {
        kind: 'roundRect' as const,
        x,
        y,
        width: 4,
        height: 22,
        radius: 2,
        fill: color,
      };

    return {
      kind: 'circle' as const,
      x,
      y,
      diameter: overlay === 'stars' ? 4 : 7,
      fill: color,
    };
  });
}

function seasonal(date: string): Exclude<LivingOverlay, 'none' | 'seasonal' | 'sunset'> {
  const month = Number(date.slice(5, 7));

  return month === 12 || month <= 2
    ? 'snow'
    : month <= 5
      ? 'rain'
      : month <= 8
        ? 'haze'
        : 'stars';
}

function seeded(value: string): () => number {
  let state = [...value].reduce(
    (result, character) => (result * 31 + character.charCodeAt(0)) >>> 0,
    17,
  );

  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;

    return state / 0x1_0000_0000;
  };
}
