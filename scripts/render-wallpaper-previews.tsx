import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  WALLPAPER_PRESET_IDS,
  WALLPAPER_PRESETS,
  type LockScreenProfile,
  type WallpaperPresetId,
} from '../lib/preferences';
import { normalizeUserData } from '../lib/userSchema';
import { buildWallpaperModel } from '../lib/wallpaperModel';
import { createWallpaperImageResponse } from '../lib/wallpaperRenderer';

const outputDirectory = process.argv[2] ?? '/private/tmp/calendar-lockscreen-previews';
const previewDate = new Date('2026-10-24T12:00:00Z');
const previewEvents = [
  ['A deliberately long event name that must truncate cleanly', '2026-10-23'],
  ['Planning review', '2026-10-23'],
  ['Product launch', '2026-10-24'],
  ['Design review', '2026-10-27'],
  ['Project milestone', '2026-10-29'],
  ['Planning workshop', '2026-10-30'],
  ['Team retrospective', '2026-11-01'],
  ['Design critique', '2026-11-02'],
  ['Quarterly check-in', '2026-11-12'],
  ['Team offsite', '2026-12-04'],
  ['Annual planning', '2027-01-08'],
].map(([name, date], index) => ({
  id: `preview-${index}`,
  name,
  date,
  source: 'manual',
  createdAt: '2026-10-01T00:00:00.000Z',
}));

async function main(): Promise<void> {
  await mkdir(outputDirectory, { recursive: true });

  for (const lockScreenProfile of ['standard', 'large-clock'] as const) {
    for (const presetId of WALLPAPER_PRESET_IDS) {
      const model = previewModel(presetId, lockScreenProfile);
      const profileSuffix = lockScreenProfile === 'standard' ? '' : '-large-clock';

      await writePng(
        path.join(outputDirectory, `${presetId}${profileSuffix}.png`),
        createWallpaperImageResponse(model),
      );
      await writePng(
        path.join(outputDirectory, `${presetId}${profileSuffix}-ios-overlay.png`),
        createWallpaperImageResponse(model, { mockIosOverlay: true }),
      );
    }
  }

  const twoEventModel = buildWallpaperModel({
    date: previewDate,
    timeRange: 'quarter',
    publicEvents: [
      { name: 'Product launch', date: '2026-11-14' },
      { name: 'Team offsite', date: '2026-12-19' },
    ],
  });

  await writePng(
    path.join(outputDirectory, 'quarter-event-lines.png'),
    createWallpaperImageResponse(twoEventModel),
  );
  await writePng(
    path.join(outputDirectory, 'quarter-event-lines-ios-overlay.png'),
    createWallpaperImageResponse(twoEventModel, { mockIosOverlay: true }),
  );

  console.log(
    `Rendered ${WALLPAPER_PRESET_IDS.length * 4 + 2} PNG previews to ${outputDirectory}`,
  );
}

function previewModel(presetId: WallpaperPresetId, lockScreenProfile: LockScreenProfile) {
  const preset = WALLPAPER_PRESETS[presetId];
  const user = normalizeUserData(
    {
      schemaVersion: 3,
      token: 'preview',
      name: 'Preview',
      theme: 'default',
      timeRange: preset.timeRange,
      presentation: preset.presentation,
      lockScreenProfile,
      timeZone: 'UTC',
      events: previewEvents,
    },
    'preview',
  );

  if (!user) {
    throw new Error('Unable to create preview user');
  }

  return buildWallpaperModel({ date: previewDate, user });
}

async function writePng(filePath: string, response: Response): Promise<void> {
  const bytes = new Uint8Array(await response.arrayBuffer());

  if (!isPng(bytes)) {
    throw new Error(`Renderer did not return PNG data for ${filePath}`);
  }

  await writeFile(filePath, bytes);
}

function isPng(bytes: Uint8Array): boolean {
  return (
    bytes.length > 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Preview rendering failed');
  process.exitCode = 1;
});
