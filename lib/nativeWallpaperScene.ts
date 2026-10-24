import type { WallpaperTheme } from './preferences';
import {
  CONTENT_LEFT,
  CONTENT_RIGHT,
  getCalendarComposition,
  getDayRowsLayout,
  getMonthCollectionLayout,
  getWallpaperEventLayout,
  getWallpaperHeaderCopy,
  getWallpaperLayoutBounds,
  isGroupedCalendarLayout,
  HEADER_HEIGHT,
  WALLPAPER_HEIGHT,
  WALLPAPER_WIDTH,
  WEEKDAY_LABELS,
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
    addCalendar(
      scene,
      model,
      composition.calendarTop,
      composition.calendarTop + composition.calendarHeight,
    );
    addEvents(scene, model, composition.eventsTop);
  } else if (model.presentation === 'agenda') {
    addEvents(scene, model, bounds.presentationTop);
  } else if (model.presentation === 'countdown') {
    addCountdown(scene, model, bounds.presentationTop, bounds.presentationBottom);
  } else if (model.presentation === 'progress') {
    addPeriodProgress(scene, model, bounds.presentationTop);
    addCalendar(scene, model, bounds.calendarTop!, bounds.calendarBottom!);
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
  bottom: number,
): void {
  if (model.timeRange === 'week' || model.timeRange === 'rolling14') {
    addDayRows(scene, model, top, bottom);
  } else {
    addMonths(scene, model, top, bottom);
  }
}

function addDayRows(
  scene: NativeWallpaperScene,
  model: WallpaperModel,
  top: number,
  bottom: number,
): void {
  const { geometry, rowGap } = getDayRowsLayout(model, bottom - top);
  const contentHeight = geometry.labelSize * 1.2 + geometry.labelGap + geometry.size;
  const cardGap = (CONTENT_WIDTH - 7 * geometry.width) / 6;

  for (const [index, cell] of model.cells.entries()) {
    const row = Math.floor(index / 7);
    const cardTop = top + row * (geometry.height + rowGap);
    const labelTop = cardTop + (geometry.height - contentHeight) / 2;
    const left = CONTENT_LEFT + (index % 7) * (geometry.width + cardGap);

    addText(
      scene,
      cell.weekdayLabel.toUpperCase(),
      {
        x: left,
        y: labelTop,
        width: geometry.width,
        height: 30,
      },
      isGroupedCalendarLayout(model) ? model.theme.text : model.theme.subtext,
      geometry.labelSize,
      'semibold',
      'center',
    );
    addDot(
      scene,
      cell,
      model.theme,
      {
        x: left + (geometry.width - geometry.size) / 2,
        y: labelTop + geometry.labelSize * 1.2 + geometry.labelGap,
      },
      geometry,
    );
  }
}

function addMonths(
  scene: NativeWallpaperScene,
  model: WallpaperModel,
  top: number,
  bottom: number,
): void {
  const collection = getMonthCollectionLayout(model, bottom - top);
  const geometry = collection.geometry;
  const showLabel = model.monthGroups.length > 1;
  const labelHeight = showLabel ? geometry.labelSize * 1.2 + geometry.labelGap : 0;
  const weekdayHeight = geometry.showWeekdays ? geometry.weekdaySize * 1.2 : 0;
  const groupWidth = (CONTENT_WIDTH * collection.widthPercent) / 100;
  const groupGap =
    collection.columns === 1
      ? 0
      : (CONTENT_WIDTH - collection.columns * groupWidth) / (collection.columns - 1);

  for (const [groupIndex, group] of model.monthGroups.entries()) {
    const row = Math.floor(groupIndex / collection.columns);
    const column = groupIndex % collection.columns;
    const groupTop = top + row * (collection.groupHeight + collection.rowGap);
    const left = CONTENT_LEFT + column * (groupWidth + groupGap) + geometry.paddingX;
    const width = groupWidth - geometry.paddingX * 2;
    const labelTop = groupTop + geometry.paddingY;
    const weekdayTop = labelTop + labelHeight;
    const cellTop = weekdayTop + weekdayHeight + (geometry.showWeekdays ? 7 : 0);
    const cellWidth = width / 7;

    if (showLabel) {
      addText(
        scene,
        group.label,
        {
          x: left,
          y: labelTop,
          width,
          height: geometry.labelSize * 1.2,
        },
        model.theme.text,
        geometry.labelSize,
        'semibold',
      );
    }

    for (const [index, label] of (geometry.showWeekdays
      ? WEEKDAY_LABELS
      : []
    ).entries()) {
      addText(
        scene,
        label,
        {
          x: left + index * cellWidth,
          y: weekdayTop,
          width: cellWidth,
          height: weekdayHeight,
        },
        isGroupedCalendarLayout(model) ? model.theme.text : model.theme.subtext,
        geometry.weekdaySize,
        'semibold',
        'center',
      );
    }

    for (const [index, cell] of group.cells.entries()) {
      if (!cell) {
        continue;
      }

      addDot(
        scene,
        cell,
        model.theme,
        {
          x: left + (index % 7) * cellWidth + (cellWidth - geometry.dot.size) / 2,
          y:
            cellTop +
            Math.floor(index / 7) * geometry.cellHeight +
            (geometry.cellHeight - geometry.dot.size) / 2,
        },
        geometry.dot,
      );
    }
  }
}

function addDot(
  scene: NativeWallpaperScene,
  cell: WallpaperCell,
  theme: WallpaperTheme,
  position: { x: number; y: number },
  geometry: { size: number; eventRingGap: number; eventRingWidth: number },
): void {
  // Snap once so the fill and both ring layers share the same pixel-aligned center.
  const x = Math.round(position.x);
  const y = Math.round(position.y);

  if (cell.event) {
    for (const [offset, fill] of [
      [
        geometry.eventRingGap + geometry.eventRingWidth,
        cell.current ? theme.text : theme.current,
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
): void {
  const size = compact ? 24 : 38;

  addText(
    scene,
    'No upcoming events',
    {
      x: CONTENT_LEFT,
      y: top + (height - size * 1.2) / 2,
      width: CONTENT_WIDTH,
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
  const blockHeight = event.daysLeft === 0 ? 196 : 240;
  const start = top + (bottom - top - blockHeight) / 2;

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
): void {
  const layout = getWallpaperEventLayout(model);
  const nameSize = layout.compact ? 34 : 40;
  const nameHeight = Math.ceil(nameSize * 1.2);
  const countdownSize = layout.compact ? 30 : 32;
  const countdownHeight = Math.ceil(countdownSize * 1.2);
  const gap = layout.compact ? 12 : 18;
  const textTop = top + (layout.rowHeight - (nameHeight + gap + 3)) / 2;

  addText(
    scene,
    event.name,
    { x: CONTENT_LEFT, y: textTop, width: CONTENT_WIDTH - 168, height: nameHeight },
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
      x: CONTENT_LEFT + CONTENT_WIDTH - 140,
      y: textTop + (nameHeight - countdownHeight) / 2,
      width: 140,
      height: countdownHeight,
    },
    event.daysLeft <= 1
      ? model.theme.current
      : layout.compact
        ? model.theme.text
        : model.theme.subtext,
    countdownSize,
    'medium',
    'right',
  );
  const timer = {
    kind: 'roundRect' as const,
    x: CONTENT_LEFT,
    y: textTop + nameHeight + gap,
    width: CONTENT_WIDTH,
    height: 3,
    radius: 1.5,
    fill: model.theme.future,
  };

  scene.commands.push(timer);

  if (event.progressPercent > 0) {
    scene.commands.push({
      ...timer,
      width: (CONTENT_WIDTH * event.progressPercent) / 100,
      fill: model.theme.current,
    });
  }
}

function addEvents(
  scene: NativeWallpaperScene,
  model: WallpaperModel,
  top: number,
): void {
  const layout = getWallpaperEventLayout(model);
  const visible = model.events.slice(0, layout.limit);

  if (!visible.length) {
    addEmptyEvents(scene, model, top, layout.slotHeight, layout.compact);

    return;
  }

  for (const [index, event] of visible.entries()) {
    const rowTop = top + index * (layout.rowHeight + layout.rowGap);

    addEventRow(scene, model, event, rowTop);
  }

  const overflow = model.events.length - visible.length;

  if (overflow > 0) {
    addText(
      scene,
      `+${overflow} more`,
      {
        x: CONTENT_LEFT,
        y:
          top +
          visible.length * layout.rowHeight +
          (visible.length - 1) * layout.rowGap +
          8,
        width: CONTENT_WIDTH,
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
