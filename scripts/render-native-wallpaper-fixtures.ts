import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildNativeWallpaperScene } from '../lib/nativeWallpaperScene';
import { buildWallpaperModel } from '../lib/wallpaperModel';

const directory = process.argv[2] ?? '/private/tmp/calendar-native-fixtures';
const date = new Date('2026-10-24T12:00:00Z');
const publicEvents = [
  { name: 'Product launch', date: '2026-11-14' },
  { name: 'Team offsite', date: '2026-12-19' },
  { name: 'Holiday trip', date: '2026-12-23' },
];

async function main(): Promise<void> {
  await mkdir(directory, { recursive: true });

  for (const lockScreenProfile of ['standard', 'large-clock'] as const) {
    for (const timeRange of ['week', 'month', 'quarter'] as const) {
      for (const presentation of ['calendar', 'hybrid'] as const) {
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
    `Wrote 12 synthetic native scene fixtures to ${directory}. These are data, not iPhone-rendered images.`,
  );
}

main().catch(() => {
  console.error('Unable to write native scene fixtures');
  process.exitCode = 1;
});
