import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildNativeWallpaperScene } from '../lib/nativeWallpaperScene';
import { buildWallpaperModel } from '../lib/wallpaperModel';
import { TIME_RANGES, PRESENTATIONS, LOCK_SCREEN_PROFILES } from '../lib/preferences';

const directory = process.argv[2] ?? '/private/tmp/calendar-native-fixtures';
const date = new Date('2026-10-24T12:00:00Z');
const publicEvents = [
  { name: 'Product launch', date: '2026-10-24' },
  { name: 'Planning review', date: '2026-10-25' },
  { name: 'Design review', date: '2026-10-27' },
  { name: 'Workshop', date: '2026-10-29' },
  { name: 'Team retrospective', date: '2026-11-01' },
  { name: 'Quarterly check-in', date: '2026-11-14' },
  { name: 'Team offsite', date: '2026-12-19' },
];

async function main(): Promise<void> {
  await mkdir(directory, { recursive: true });

  for (const lockScreenProfile of LOCK_SCREEN_PROFILES) {
    for (const timeRange of TIME_RANGES) {
      for (const presentation of PRESENTATIONS) {
        const model = buildWallpaperModel({
          date,
          timeRange,
          presentation,
          lockScreenProfile,
          publicEvents,
        });
        const scene = buildNativeWallpaperScene(model);
        const name = `${timeRange}-${presentation}-${lockScreenProfile}.json`;

        await writeFile(path.join(directory, name), JSON.stringify(scene, null, 2));
      }
    }
  }

  console.log(
    `Wrote ${TIME_RANGES.length * PRESENTATIONS.length * LOCK_SCREEN_PROFILES.length} synthetic native scene fixtures to ${directory}. These are data, not iPhone-rendered images.`,
  );
}

main().catch(() => {
  console.error('Unable to write native scene fixtures');
  process.exitCode = 1;
});
