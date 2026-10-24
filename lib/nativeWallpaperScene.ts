import type { WallpaperTheme } from './preferences';
import {
  CONTENT_LEFT,
  CONTENT_RIGHT,
  getDayCardGeometry,
  getMonthCollectionGeometry,
  getMonthGeometry,
  getWallpaperEventLayout,
  getWallpaperHeaderCopy,
  getWallpaperLayoutBounds,
  HEADER_HEIGHT,
  WALLPAPER_HEIGHT,
  WALLPAPER_WIDTH,
  WEEKDAY_LABELS,
} from './wallpaperLayout';
import type { WallpaperCell, WallpaperModel } from './wallpaperModel';

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

export class UnsupportedNativeLayoutError extends Error {
  constructor() {
    super('Native rendering currently supports week, month and quarter calendars only');
  }
}

const CONTENT_WIDTH = WALLPAPER_WIDTH - CONTENT_LEFT - CONTENT_RIGHT;

// A data-only boundary: never serialize the account, credentials or calendar records.
export function buildNativeWallpaperScene(
  model: WallpaperModel,
  title?: string,
): NativeWallpaperScene {
  if (
    !['week', 'month', 'quarter'].includes(model.timeRange) ||
    !['calendar', 'hybrid'].includes(model.presentation)
  ) {
    throw new UnsupportedNativeLayoutError();
  }

  const scene: NativeWallpaperScene = {
    version: 1,
    width: WALLPAPER_WIDTH,
    height: WALLPAPER_HEIGHT,
    background: model.theme.background,
    commands: [],
  };
  const bounds = getWallpaperLayoutBounds(model);
  const copy = getWallpaperHeaderCopy(model, title);

  if (copy.title) {
    addText(
      scene,
      copy.title,
      {
        x: CONTENT_LEFT,
        y: bounds.contentTop + (HEADER_HEIGHT - 51) / 2,
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
        y: bounds.contentTop + (HEADER_HEIGHT - 33) / 2,
        width: CONTENT_WIDTH,
        height: 33,
      },
      model.theme.subtext,
      26,
      'system',
      'center',
    );
  }

  const calendarTop = bounds.calendarTop as number;
  const calendarBottom = bounds.calendarBottom as number;

  if (model.timeRange === 'week') {
    addWeek(scene, model, calendarTop, calendarBottom);
  } else {
    addMonths(scene, model, calendarTop, calendarBottom);
  }

  addEvents(scene, model, bounds.eventsTop as number);

  return scene;
}

function addWeek(
  scene: NativeWallpaperScene,
  model: WallpaperModel,
  top: number,
  bottom: number,
): void {
  const geometry = getDayCardGeometry(model.presentation === 'hybrid');
  const cardTop = top + (bottom - top - geometry.height) / 2;
  const contentHeight = geometry.labelSize * 1.2 + geometry.labelGap + geometry.size;
  const labelTop = cardTop + (geometry.height - contentHeight) / 2;
  const cardGap = (CONTENT_WIDTH - 7 * geometry.width) / 6;

  for (const [index, cell] of model.cells.entries()) {
    const left = CONTENT_LEFT + index * (geometry.width + cardGap);

    addText(
      scene,
      cell.weekdayLabel.toUpperCase(),
      {
        x: left,
        y: labelTop,
        width: geometry.width,
        height: 30,
      },
      model.theme.subtext,
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
  const collection = getMonthCollectionGeometry(model);
  const geometry = getMonthGeometry(collection.scale);
  const showLabel = model.monthGroups.length > 1;
  const labelHeight = showLabel ? geometry.labelSize * 1.2 + geometry.labelGap : 0;
  const weekdayHeight = geometry.weekdaySize * 1.2;
  const groupHeight =
    geometry.paddingY * 2 + labelHeight + weekdayHeight + 7 + 6 * geometry.cellHeight;
  const groupWidth = (CONTENT_WIDTH * collection.widthPercent) / 100;
  const groupGap =
    collection.columns === 1
      ? 0
      : (CONTENT_WIDTH - collection.columns * groupWidth) / (collection.columns - 1);
  const groupTop = top + (bottom - top - groupHeight) / 2;

  for (const [groupIndex, group] of model.monthGroups.entries()) {
    const left = CONTENT_LEFT + groupIndex * (groupWidth + groupGap) + geometry.paddingX;
    const width = groupWidth - geometry.paddingX * 2;
    const labelTop = groupTop + geometry.paddingY;
    const weekdayTop = labelTop + labelHeight;
    const cellTop = weekdayTop + weekdayHeight + 7;
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

    for (const [index, label] of WEEKDAY_LABELS.entries()) {
      addText(
        scene,
        label,
        {
          x: left + index * cellWidth,
          y: weekdayTop,
          width: cellWidth,
          height: weekdayHeight,
        },
        model.theme.subtext,
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
        x: position.x - offset,
        y: position.y - offset,
        diameter: geometry.size + offset * 2,
        fill,
      });
    }
  }

  scene.commands.push({
    kind: 'circle',
    ...position,
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

function addEvents(
  scene: NativeWallpaperScene,
  model: WallpaperModel,
  top: number,
): void {
  const layout = getWallpaperEventLayout(model);
  const visible = model.events.slice(0, layout.limit);

  if (!visible.length) {
    addText(
      scene,
      'No upcoming events',
      {
        x: CONTENT_LEFT,
        y: top + (layout.slotHeight - 30) / 2,
        width: CONTENT_WIDTH,
        height: 30,
      },
      model.theme.text,
      24,
      'semibold',
    );

    return;
  }

  for (const [index, event] of visible.entries()) {
    const rowTop = top + index * (layout.rowHeight + layout.rowGap);
    const textTop = rowTop + (layout.rowHeight - (41 + 12 + 3)) / 2;

    addText(
      scene,
      event.name,
      {
        x: CONTENT_LEFT,
        y: textTop,
        width: CONTENT_WIDTH - 168,
        height: 41,
      },
      model.theme.text,
      34,
      'medium',
      'left',
      true,
    );
    addText(
      scene,
      event.countdownLabel,
      {
        x: CONTENT_LEFT + CONTENT_WIDTH - 140,
        y: textTop + 7,
        width: 140,
        height: 34,
      },
      event.daysLeft <= 1 ? model.theme.current : model.theme.subtext,
      28,
      'medium',
      'right',
    );

    const timer = {
      kind: 'roundRect' as const,
      x: CONTENT_LEFT,
      y: textTop + 41 + 12,
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
        height: 24,
      },
      model.theme.subtext,
      20,
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
