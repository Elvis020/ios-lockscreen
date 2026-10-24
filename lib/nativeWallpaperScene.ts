import { eventCategoryColor, type WallpaperTheme } from './preferences';
import { getLivingThemePrimitives } from './livingThemes';
import {
  CONTENT_LEFT,
  CONTENT_RIGHT,
  getCalendarComposition,
  getCountdownComposition,
  getContinuousDotGridLayout,
  getWallpaperEventLayout,
  getWallpaperHeaderCopy,
  getWallpaperLayoutBounds,
  HEADER_HEIGHT,
  WALLPAPER_HEIGHT,
  WALLPAPER_WIDTH,
} from './wallpaperLayout';
import {
  formatPeriodRemaining,
  type DisplayEvent,
  type WallpaperCell,
  type WallpaperModel,
} from './wallpaperModel';

interface Frame {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface NativeTextCommand extends Frame {
  kind: 'text';
  value: string;
  color: string;
  size: number;
  font: 'system' | 'medium' | 'semibold';
  align: 'left' | 'center' | 'right';
  truncate: boolean;
}

export type NativeDrawCommand =
  | NativeTextCommand
  | { kind: 'circle'; x: number; y: number; diameter: number; fill: string }
  | (Frame & { kind: 'roundRect'; radius: number; fill: string });

export interface NativeWallpaperScene {
  version: 1;
  width: typeof WALLPAPER_WIDTH;
  height: typeof WALLPAPER_HEIGHT;
  background: string;
  commands: NativeDrawCommand[];
}

export class NativeSceneBudgetError extends Error {
  constructor() {
    super(
      'Too many calendar markers for native rendering. Reduce the public event list.',
    );
  }
}

const CONTENT_WIDTH = WALLPAPER_WIDTH - CONTENT_LEFT - CONTENT_RIGHT;

// A data-only boundary: never serialize the account, credentials or calendar records.
export function buildNativeWallpaperScene(
  model: WallpaperModel,
  title?: string,
): NativeWallpaperScene {
  const composition = getCalendarComposition(model);
  const bounds = getWallpaperLayoutBounds(model);
  const headerTop = composition?.top ?? bounds.contentTop;
  const headerHeight = composition?.headerHeight ?? HEADER_HEIGHT;
  const scene: NativeWallpaperScene = {
    version: 1,
    width: WALLPAPER_WIDTH,
    height: WALLPAPER_HEIGHT,
    background: model.theme.background,
    commands: [],
  };
  const copy = getWallpaperHeaderCopy(model, title);

  scene.commands.push(
    ...getLivingThemePrimitives({
      overlay: model.livingOverlay,
      profile: model.lockScreenProfile,
      date: model.period.currentDate,
      accountSeed: model.accountSeed,
    }).map((primitive) => primitive),
  );

  if (copy.title) {
    addText(
      scene,
      copy.title,
      {
        x: CONTENT_LEFT,
        y: headerTop + (headerHeight - 51) / 2,
        width: CONTENT_WIDTH,
        height: 51,
      },
      model.theme.text,
      42,
      'medium',
      'left',
      true,
    );
  }

  if (copy.subtitle) {
    addText(
      scene,
      copy.subtitle,
      {
        x: CONTENT_LEFT,
        y: headerTop + (headerHeight - 36) / 2,
        width: CONTENT_WIDTH,
        height: 36,
      },
      model.theme.subtext,
      30,
      'system',
      'center',
    );
  }

  if (composition) {
    addCalendar(scene, model, composition.calendarTop);
    addEvents(scene, model, composition.eventsTop);
  } else if (model.presentation === 'agenda') {
    addEvents(scene, model, bounds.presentationTop);
  } else if (model.presentation === 'countdown') {
    addCountdown(scene, model, bounds.presentationTop, bounds.presentationBottom);
  } else if (model.presentation === 'progress') {
    addPeriodProgress(scene, model, bounds.presentationTop);
    addCalendar(scene, model, bounds.calendarTop!);
  } else {
    addMinimal(scene, model, bounds.presentationTop, bounds.presentationBottom);
  }

  if (scene.commands.length > 600 || JSON.stringify(scene).length > 200000) {
    throw new NativeSceneBudgetError();
  }

  return scene;
}

function addCalendar(
  scene: NativeWallpaperScene,
  model: WallpaperModel,
  top: number,
): void {
  const grid = getContinuousDotGridLayout(model);

  for (const [index, cell] of model.cells.entries()) {
    const position = grid.positions[index];

    addDot(
      scene,
      cell,
      model.theme,
      model.milestoneRingStyle,
      cell.category,
      {
        x: CONTENT_LEFT + position.x,
        y: top + position.y,
      },
      grid,
    );
  }
}

function addDot(
  scene: NativeWallpaperScene,
  cell: WallpaperCell,
  theme: WallpaperTheme,
  ringStyle: WallpaperModel['milestoneRingStyle'],
  category: string | undefined,
  position: { x: number; y: number },
  geometry: { size: number; eventRingGap: number; eventRingWidth: number },
): void {
  // Snap once so the fill and both ring layers share the same pixel-aligned center.
  const x = Math.round(position.x);
  const y = Math.round(position.y);

  if (cell.event) {
    const color = eventCategoryColor(category, theme.current);

    if (ringStyle === 'double' || ringStyle === 'halo') {
      const offset =
        geometry.eventRingGap + geometry.eventRingWidth + (ringStyle === 'halo' ? 10 : 7);
      const outerRingWidth = ringStyle === 'halo' ? 2 : geometry.eventRingWidth;

      // Paint the outer ring first, then carve its center before the inner ring.
      scene.commands.push({
        kind: 'circle',
        x: x - offset,
        y: y - offset,
        diameter: geometry.size + offset * 2,
        fill: ringStyle === 'halo' ? theme.future : color,
      });
      scene.commands.push({
        kind: 'circle',
        x: x - offset + outerRingWidth,
        y: y - offset + outerRingWidth,
        diameter: geometry.size + offset * 2 - outerRingWidth * 2,
        fill: theme.background,
      });
    }

    for (const [offset, fill] of [
      [
        geometry.eventRingGap + geometry.eventRingWidth,
        cell.current ? theme.text : color,
      ],
      [geometry.eventRingGap, theme.background],
    ] as const) {
      scene.commands.push({
        kind: 'circle',
        x: x - offset,
        y: y - offset,
        diameter: geometry.size + offset * 2,
        fill,
      });
    }
  }

  scene.commands.push({
    kind: 'circle',
    x,
    y,
    diameter: geometry.size,
    fill: cell.current
      ? theme.current
      : cell.passed && cell.weekend
        ? theme.weekend
        : cell.passed
          ? theme.passed
          : theme.future,
  });
}

function addPeriodProgress(
  scene: NativeWallpaperScene,
  model: WallpaperModel,
  top: number,
): void {
  if (model.period.kind === 'rolling') {
    addText(
      scene,
      '14-day outlook',
      { x: CONTENT_LEFT, y: top, width: CONTENT_WIDTH, height: 75 },
      model.theme.current,
      62,
      'semibold',
    );
    addText(
      scene,
      'A moving window from today',
      { x: CONTENT_LEFT, y: top + 85, width: CONTENT_WIDTH, height: 32 },
      model.theme.subtext,
      26,
    );

    return;
  }

  addText(
    scene,
    `${model.period.percentComplete}%`,
    { x: CONTENT_LEFT, y: top, width: 400, height: 94 },
    model.theme.current,
    78,
    'semibold',
  );
  addText(
    scene,
    formatPeriodRemaining(model.period.daysLeft),
    { x: CONTENT_LEFT + 420, y: top + 47, width: CONTENT_WIDTH - 420, height: 32 },
    model.theme.subtext,
    26,
    'system',
    'right',
  );
  const track = {
    kind: 'roundRect' as const,
    x: CONTENT_LEFT,
    y: top + 100,
    width: CONTENT_WIDTH,
    height: 14,
    radius: 7,
    fill: model.theme.future,
  };

  scene.commands.push(track);

  if (model.period.percentComplete > 0) {
    const width = (CONTENT_WIDTH * model.period.percentComplete) / 100;

    scene.commands.push({
      ...track,
      width,
      radius: Math.min(track.radius, width / 2),
      fill: model.theme.current,
    });
  }
}

function addEmptyEvents(
  scene: NativeWallpaperScene,
  model: WallpaperModel,
  top: number,
  height: number,
  compact = false,
  left = CONTENT_LEFT,
  width = CONTENT_WIDTH,
): void {
  const size = compact ? 24 : 38;

  addText(
    scene,
    'No upcoming events',
    {
      x: left,
      y: top + (height - size * 1.2) / 2,
      width,
      height: size * 1.2,
    },
    model.theme.text,
    size,
    'semibold',
    compact ? 'left' : 'center',
  );
}

function addCountdown(
  scene: NativeWallpaperScene,
  model: WallpaperModel,
  top: number,
  bottom: number,
): void {
  const event = model.events[0];

  if (!event) {
    addEmptyEvents(scene, model, top, bottom - top);

    return;
  }

  // The installed v1 adapter accepts fonts up to 80px; no script update is required.
  const composition = getCountdownComposition(model);
  const blockHeight = composition.heroHeight;
  const start = composition.top;

  addText(
    scene,
    event.daysLeft === 0 ? 'Today' : String(event.daysLeft),
    {
      x: CONTENT_LEFT,
      y: start,
      width: CONTENT_WIDTH,
      height: 96,
    },
    model.theme.current,
    80,
    'semibold',
    'center',
  );

  if (event.daysLeft > 0) {
    addText(
      scene,
      event.daysLeft === 1 ? 'day away' : 'days away',
      {
        x: CONTENT_LEFT,
        y: start + 106,
        width: CONTENT_WIDTH,
        height: 36,
      },
      model.theme.subtext,
      30,
      'system',
      'center',
    );
  }

  addText(
    scene,
    event.name,
    {
      x: CONTENT_LEFT,
      y: start + blockHeight - 58,
      width: CONTENT_WIDTH,
      height: 58,
    },
    model.theme.text,
    48,
    'semibold',
    'center',
    true,
  );

  if (composition.eventsHeight > 0) {
    addEvents(scene, model, composition.eventsTop);
  }
}

function addMinimal(
  scene: NativeWallpaperScene,
  model: WallpaperModel,
  top: number,
  bottom: number,
): void {
  const height = 114 + 70 + 1 + 54 + 144;
  const start = top + (bottom - top - height) / 2;
  const dividerTop = start + 114 + 70;

  addPeriodProgress(scene, model, start);
  scene.commands.push({
    kind: 'roundRect',
    x: CONTENT_LEFT,
    y: dividerTop,
    width: CONTENT_WIDTH,
    height: 1,
    radius: 0.5,
    fill: model.theme.future,
  });
  const eventTop = dividerTop + 1 + 54;

  if (model.events[0]) {
    addEventRow(scene, model, model.events[0], eventTop);
  } else {
    addEmptyEvents(scene, model, eventTop, 144, true);
  }
}

function addEventRow(
  scene: NativeWallpaperScene,
  model: WallpaperModel,
  event: DisplayEvent,
  top: number,
  left = CONTENT_LEFT,
  width = CONTENT_WIDTH,
): void {
  const layout = getWallpaperEventLayout(model);
  const nameSize = layout.nameSize;
  const nameHeight = Math.ceil(nameSize * 1.2);
  const countdownSize = layout.countdownSize;
  const countdownHeight = Math.ceil(countdownSize * 1.2);
  const gap = layout.timerGap;
  const countdownWidth = layout.columns === 2 ? 80 : 140;
  const nameGap = layout.columns === 2 ? 16 : 28;
  const textTop = top + (layout.rowHeight - (nameHeight + gap + 3)) / 2;

  if (event.focused) {
    scene.commands.push({
      kind: 'roundRect',
      x: left - 10,
      y: textTop,
      width: 4,
      height: 24,
      radius: 2,
      fill: eventCategoryColor(event.category, model.theme.current),
    });
  }

  addText(
    scene,
    event.name,
    { x: left, y: textTop, width: width - countdownWidth - nameGap, height: nameHeight },
    model.theme.text,
    nameSize,
    'medium',
    'left',
    true,
  );
  addText(
    scene,
    event.countdownLabel,
    {
      x: left + width - countdownWidth,
      y: textTop + (nameHeight - countdownHeight) / 2,
      width: countdownWidth,
      height: countdownHeight,
    },
    event.daysLeft <= 1
      ? eventCategoryColor(event.category, model.theme.current)
      : layout.compact
        ? model.theme.text
        : model.theme.subtext,
    countdownSize,
    'medium',
    'right',
  );
  const timer = {
    kind: 'roundRect' as const,
    x: left,
    y: textTop + nameHeight + gap,
    width,
    height: 3,
    radius: 1.5,
    fill: model.theme.future,
  };

  scene.commands.push(timer);

  if (event.progressPercent > 0) {
    scene.commands.push({
      ...timer,
      width: (width * event.progressPercent) / 100,
      fill: eventCategoryColor(event.category, model.theme.current),
    });
  }
}

function addEvents(
  scene: NativeWallpaperScene,
  model: WallpaperModel,
  top: number,
): void {
  const layout = getWallpaperEventLayout(model);
  const visible = model.events.slice(layout.startIndex, layout.limit);

  if (!model.events.length) {
    addEmptyEvents(
      scene,
      model,
      top,
      layout.slotHeight,
      layout.compact,
      CONTENT_LEFT + layout.railLeft,
      layout.railWidth,
    );

    return;
  }

  for (const [index, event] of visible.entries()) {
    const rowTop =
      top + Math.floor(index / layout.columns) * (layout.rowHeight + layout.rowGap);
    const left =
      CONTENT_LEFT +
      layout.railLeft +
      (index % layout.columns) * (layout.cellWidth + layout.columnGap);

    addEventRow(scene, model, event, rowTop, left, layout.cellWidth);
  }

  const overflow = layout.overflow;

  if (overflow > 0) {
    addText(
      scene,
      `+${overflow} more`,
      {
        x: CONTENT_LEFT + layout.railLeft,
        y:
          top +
          layout.rows * layout.rowHeight +
          Math.max(0, layout.rows - 1) * layout.rowGap +
          Math.max(0, layout.overflowHeight - (layout.compact ? 24 : 29)),
        width: layout.railWidth,
        height: layout.compact ? 24 : 29,
      },
      model.theme.subtext,
      layout.compact ? 20 : 24,
    );
  }
}

function addText(
  scene: NativeWallpaperScene,
  value: string,
  frame: Frame,
  color: string,
  size: number,
  font: NativeTextCommand['font'] = 'system',
  align: NativeTextCommand['align'] = 'left',
  truncate = false,
): void {
  scene.commands.push({
    kind: 'text',
    ...frame,
    value: value.replace(/\p{Cc}/gu, ' ').slice(0, 160),
    color,
    size,
    font,
    align,
    truncate,
  });
}
