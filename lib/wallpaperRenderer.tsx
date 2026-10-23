import { ImageResponse } from '@vercel/og';
import type { CSSProperties, ReactElement, ReactNode } from 'react';
import type { WallpaperTheme } from './preferences';
import {
  formatPeriodRemaining,
  type DisplayEvent,
  type WallpaperCell,
  type WallpaperModel,
  type WallpaperMonthGroup,
} from './wallpaperModel';

export const WALLPAPER_WIDTH = 1284;
export const WALLPAPER_HEIGHT = 2778;

const CONTENT_LEFT = 112;
const CONTENT_RIGHT = 112;
const HEADER_HEIGHT = 112;
const HEADER_TO_PRESENTATION_GAP = 28;
const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

export const LOCK_SCREEN_CONTENT_BANDS = {
  standard: { top: 920, bottom: 2080 },
  'large-clock': { top: 1120, bottom: 2080 },
} as const;

export const CALENDAR_DOT_GEOMETRY = {
  shape: 'circle',
  week: { size: 100, compactSize: 92, eventRingGap: 5, eventRingWidth: 3 },
  month: { size: 68, eventRingGap: 4, eventRingWidth: 3 },
  quarter: { size: 28, eventRingGap: 3, eventRingWidth: 2 },
  year: { size: 16, eventRingGap: 2, eventRingWidth: 2 },
} as const;

export interface WallpaperLayoutBounds {
  contentTop: number;
  contentBottom: number;
  presentationTop: number;
  presentationBottom: number;
  calendarTop?: number;
  calendarBottom?: number;
  eventsTop?: number;
  eventsBottom?: number;
}

export function getWallpaperLayoutBounds(model: WallpaperModel): WallpaperLayoutBounds {
  const band = LOCK_SCREEN_CONTENT_BANDS[model.lockScreenProfile];
  const presentationTop = band.top + HEADER_HEIGHT + HEADER_TO_PRESENTATION_GAP;
  const bounds: WallpaperLayoutBounds = {
    contentTop: band.top,
    contentBottom: band.bottom,
    presentationTop,
    presentationBottom: band.bottom,
  };

  if (model.presentation === 'calendar') {
    const eventHeight = model.lockScreenProfile === 'large-clock' ? 230 : 250;
    const gap = model.lockScreenProfile === 'large-clock' ? 16 : 24;
    const eventLift = model.lockScreenProfile === 'large-clock' ? 48 : 32;

    return {
      ...bounds,
      calendarTop: presentationTop,
      calendarBottom: band.bottom - eventHeight - gap,
      eventsTop: band.bottom - eventHeight - eventLift,
      eventsBottom: band.bottom - eventLift,
    };
  }

  if (model.presentation === 'hybrid') {
    const eventHeight = 196;
    const gap = 24;

    return {
      ...bounds,
      calendarTop: presentationTop,
      calendarBottom: band.bottom - eventHeight - gap,
      eventsTop: band.bottom - eventHeight,
      eventsBottom: band.bottom,
    };
  }

  if (model.presentation === 'progress') {
    return {
      ...bounds,
      calendarTop: presentationTop + 144,
      calendarBottom: band.bottom,
    };
  }

  return bounds;
}

export function getCalendarRequiredHeight(
  model: WallpaperModel,
  compact = false,
): number {
  if (model.timeRange === 'week' || model.timeRange === 'rolling14') {
    const rows = Math.ceil(model.cells.length / 7);
    const rowHeight = compact ? 158 : 164;
    const gap = compact ? 20 : 30;

    return rows * rowHeight + Math.max(0, rows - 1) * gap;
  }

  const groupCount = model.monthGroups.length;
  const columns = groupCount === 1 ? 1 : groupCount <= 3 ? 3 : 4;
  const rows = Math.ceil(groupCount / columns);
  const scale = monthScale(model, groupCount);
  const groupHeight =
    scale === 'large'
      ? 666
      : scale === 'large-compact'
        ? 568
        : scale === 'medium'
          ? 346
          : scale === 'dots-compact'
            ? 182
            : 210;
  const gap = scale === 'dots-compact' ? 10 : compact ? 10 : 14;

  return rows * groupHeight + Math.max(0, rows - 1) * gap;
}

interface WallpaperRenderOptions {
  title?: string;
  mockIosOverlay?: boolean;
}

export function createWallpaperImageResponse(
  model: WallpaperModel,
  options: WallpaperRenderOptions = {},
): ImageResponse {
  return new ImageResponse(<WallpaperCanvas model={model} options={options} />, {
    width: WALLPAPER_WIDTH,
    height: WALLPAPER_HEIGHT,
  });
}

export function WallpaperCanvas({
  model,
  options = {},
}: {
  model: WallpaperModel;
  options?: WallpaperRenderOptions;
}): ReactElement {
  const { theme } = model;
  const contentBand = LOCK_SCREEN_CONTENT_BANDS[model.lockScreenProfile];
  const contentHeight = contentBand.bottom - contentBand.top;

  return (
    <div
      style={{
        width: WALLPAPER_WIDTH,
        height: WALLPAPER_HEIGHT,
        display: 'flex',
        position: 'relative',
        backgroundColor: theme.background,
        color: theme.text,
        fontFamily: 'Inter, system-ui, sans-serif',
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: contentBand.top,
          left: CONTENT_LEFT,
          width: WALLPAPER_WIDTH - CONTENT_LEFT - CONTENT_RIGHT,
          height: contentHeight,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <WallpaperHeader model={model} title={options.title} />
        <div
          style={{
            display: 'flex',
            flex: 1,
            minHeight: 0,
            marginTop: HEADER_TO_PRESENTATION_GAP,
          }}
        >
          <Presentation model={model} />
        </div>
      </div>
      {options.mockIosOverlay ? <MockIosOverlay theme={theme} /> : null}
    </div>
  );
}

function WallpaperHeader({
  model,
  title,
}: {
  model: WallpaperModel;
  title?: string;
}): ReactElement {
  const copy = getWallpaperHeaderCopy(model, title);

  return (
    <div
      style={{
        height: HEADER_HEIGHT,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          display: 'flex',
          maxWidth: 1060,
          overflow: 'hidden',
          whiteSpace: 'nowrap',
          textOverflow: 'ellipsis',
          fontSize: 58,
          lineHeight: 1.05,
          fontWeight: 650,
        }}
      >
        {copy.title}
      </div>
      <div
        style={{
          display: 'flex',
          marginTop: 13,
          color: model.theme.subtext,
          fontSize: 26,
        }}
      >
        {copy.subtitle}
      </div>
    </div>
  );
}

export function getWallpaperHeaderCopy(
  model: WallpaperModel,
  title?: string,
): { title: string; subtitle: string } {
  if (model.presentation === 'countdown') {
    return {
      title: title || 'Next event',
      subtitle: `As of ${formatContextDate(model.period.currentDate)}`,
    };
  }

  if (
    model.period.kind === 'rolling' ||
    model.presentation === 'progress' ||
    model.presentation === 'minimal'
  ) {
    return {
      title: title || model.period.title,
      subtitle: `${formatShortDate(model.period.startDate)} – ${formatShortDate(model.period.endDate)}`,
    };
  }

  return {
    title: title || model.period.title,
    subtitle: `${model.period.percentComplete}% complete · ${formatPeriodRemaining(model.period.daysLeft)}`,
  };
}

function Presentation({ model }: { model: WallpaperModel }): ReactElement {
  if (model.presentation === 'agenda') {
    return <Agenda model={model} />;
  }

  if (model.presentation === 'countdown') {
    return <Countdown model={model} />;
  }

  if (model.presentation === 'progress') {
    return <Progress model={model} />;
  }

  if (model.presentation === 'hybrid') {
    return <Hybrid model={model} />;
  }

  if (model.presentation === 'minimal') {
    return <Minimal model={model} />;
  }

  return <Calendar model={model} />;
}

function Calendar({ model }: { model: WallpaperModel }): ReactElement {
  const largeClock = model.lockScreenProfile === 'large-clock';
  const eventLift = largeClock ? 48 : 32;

  return (
    <div style={columnStyle}>
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <CalendarVisual model={model} />
      </div>
      <div
        style={{
          display: 'flex',
          position: 'relative',
          top: -eventLift,
          height: largeClock ? 230 : 250,
          marginTop: largeClock ? 16 : 24,
        }}
      >
        <EventList model={model} limit={3} compact />
      </div>
    </div>
  );
}

function Agenda({ model }: { model: WallpaperModel }): ReactElement {
  return (
    <div style={columnStyle}>
      <SectionLabel theme={model.theme}>Upcoming</SectionLabel>
      <div style={{ display: 'flex', flex: 1, marginTop: 18 }}>
        <EventList model={model} limit={5} />
      </div>
    </div>
  );
}

function Countdown({ model }: { model: WallpaperModel }): ReactElement {
  const event = model.events[0];

  if (!event) {
    return <EmptyEvents theme={model.theme} />;
  }

  return (
    <div
      style={{
        ...columnStyle,
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
      }}
    >
      <div
        style={{
          display: 'flex',
          color: model.theme.current,
          fontSize: event.daysLeft === 0 ? 94 : 182,
          fontWeight: 700,
          lineHeight: 0.95,
        }}
      >
        {event.daysLeft === 0 ? 'Today' : event.daysLeft}
      </div>
      {event.daysLeft > 0 ? (
        <div
          style={{
            display: 'flex',
            marginTop: 10,
            color: model.theme.subtext,
            fontSize: 30,
          }}
        >
          {event.daysLeft === 1 ? 'day away' : 'days away'}
        </div>
      ) : null}
      <div
        style={{
          display: 'flex',
          maxWidth: 920,
          marginTop: 42,
          overflow: 'hidden',
          whiteSpace: 'nowrap',
          textOverflow: 'ellipsis',
          fontSize: 48,
          fontWeight: 600,
        }}
      >
        {event.name}
      </div>
      <div
        style={{
          display: 'flex',
          marginTop: 16,
          color: model.theme.subtext,
          fontSize: 28,
        }}
      >
        {event.dateLabel}
      </div>
    </div>
  );
}

function Progress({ model }: { model: WallpaperModel }): ReactElement {
  if (model.timeRange === 'year') {
    return (
      <div style={columnStyle}>
        <PeriodProgress model={model} large />
        <div style={{ display: 'flex', flex: 1, minHeight: 0, marginTop: 30 }}>
          <MonthCollection model={model} groups={model.monthGroups} />
        </div>
      </div>
    );
  }

  return (
    <div style={columnStyle}>
      <PeriodProgress model={model} large />
      <div style={{ display: 'flex', flex: 1, minHeight: 0, marginTop: 48 }}>
        <CalendarVisual model={model} />
      </div>
    </div>
  );
}

function Hybrid({ model }: { model: WallpaperModel }): ReactElement {
  return (
    <div style={columnStyle}>
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <CalendarVisual model={model} compact />
      </div>
      <div style={{ display: 'flex', height: 196, marginTop: 24 }}>
        <EventList model={model} limit={2} compact />
      </div>
    </div>
  );
}

function Minimal({ model }: { model: WallpaperModel }): ReactElement {
  const event = model.events[0];

  return (
    <div
      style={{
        ...columnStyle,
        justifyContent: 'center',
      }}
    >
      <PeriodProgress model={model} large />
      <div
        style={{
          display: 'flex',
          height: 1,
          margin: '70px 0 54px',
          backgroundColor: model.theme.future,
        }}
      />
      {event ? (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <SectionLabel theme={model.theme}>Next</SectionLabel>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
              marginTop: 18,
              gap: 32,
            }}
          >
            <div
              style={{
                display: 'flex',
                maxWidth: 800,
                overflow: 'hidden',
                whiteSpace: 'nowrap',
                textOverflow: 'ellipsis',
                fontSize: 44,
                fontWeight: 600,
              }}
            >
              {event.name}
            </div>
            <div
              style={{
                display: 'flex',
                flexShrink: 0,
                color: model.theme.current,
                fontSize: 34,
              }}
            >
              {event.countdownLabel}
            </div>
          </div>
        </div>
      ) : (
        <EmptyEvents theme={model.theme} compact />
      )}
    </div>
  );
}

function CalendarVisual({
  model,
  compact = false,
}: {
  model: WallpaperModel;
  compact?: boolean;
}): ReactElement {
  if (model.timeRange === 'week' || model.timeRange === 'rolling14') {
    return <DayRows model={model} compact={compact} />;
  }

  return <MonthCollection model={model} groups={model.monthGroups} compact={compact} />;
}

function DayRows({
  model,
  compact,
}: {
  model: WallpaperModel;
  compact: boolean;
}): ReactElement {
  const rows = chunk(model.cells, 7);

  return (
    <div
      style={{
        ...columnStyle,
        justifyContent: 'center',
        gap: compact ? 20 : 30,
      }}
    >
      {rows.map((row, rowIndex) => (
        <div
          key={`row-${rowIndex}`}
          style={{
            display: 'flex',
            width: '100%',
            justifyContent: 'space-between',
          }}
        >
          {row.map((cell) => (
            <DayCard key={cell.date} cell={cell} theme={model.theme} compact={compact} />
          ))}
        </div>
      ))}
    </div>
  );
}

function DayCard({
  cell,
  theme,
  compact,
}: {
  cell: WallpaperCell;
  theme: WallpaperTheme;
  compact: boolean;
}): ReactElement {
  return (
    <div
      style={{
        width: 132,
        height: compact ? 158 : 164,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          display: 'flex',
          color: theme.subtext,
          fontSize: 24,
          fontWeight: 650,
          textTransform: 'uppercase',
        }}
      >
        {cell.weekdayLabel}
      </div>
      <div
        style={{
          marginTop: 12,
          display: 'flex',
        }}
      >
        <CalendarDot
          cell={cell}
          theme={theme}
          size={
            compact
              ? CALENDAR_DOT_GEOMETRY.week.compactSize
              : CALENDAR_DOT_GEOMETRY.week.size
          }
          eventRingGap={CALENDAR_DOT_GEOMETRY.week.eventRingGap}
          eventRingWidth={CALENDAR_DOT_GEOMETRY.week.eventRingWidth}
        />
      </div>
    </div>
  );
}

function MonthCollection({
  model,
  groups,
  compact = false,
}: {
  model: WallpaperModel;
  groups: WallpaperMonthGroup[];
  compact?: boolean;
}): ReactElement {
  const groupCount = groups.length;
  const columns = groupCount === 1 ? 1 : groupCount <= 3 ? 3 : 4;
  const rows = Math.ceil(groupCount / columns);
  const width = `${100 / columns - (columns > 1 ? 2 : 0)}%`;
  const scale = monthScale(model, groupCount);

  return (
    <div
      style={{
        display: 'flex',
        width: '100%',
        height: '100%',
        flexWrap: 'wrap',
        alignContent: 'center',
        justifyContent: columns === 1 ? 'center' : 'space-between',
        gap: rows > 1 ? (compact ? 10 : 14) : 0,
      }}
    >
      {groups.map((group) => (
        <MonthGroup
          key={group.id}
          group={group}
          theme={model.theme}
          width={width}
          scale={scale}
          showLabel={groupCount > 1}
        />
      ))}
    </div>
  );
}

function MonthGroup({
  group,
  theme,
  width,
  scale,
  showLabel,
}: {
  group: WallpaperMonthGroup;
  theme: WallpaperTheme;
  width: string;
  scale: MonthScale;
  showLabel: boolean;
}): ReactElement {
  const rows = chunk(group.cells, 7);
  const large = scale === 'large';
  const largeCompact = scale === 'large-compact';
  const dots = scale === 'dots' || scale === 'dots-compact';
  const dotsCompact = scale === 'dots-compact';
  const cellHeight = large ? 88 : largeCompact ? 78 : dotsCompact ? 22 : dots ? 24 : 40;

  return (
    <div
      style={{
        width,
        display: 'flex',
        flexDirection: 'column',
        padding: large
          ? '22px 20px'
          : largeCompact
            ? '10px 16px'
            : dotsCompact
              ? '6px 8px'
              : dots
                ? '12px 10px'
                : '16px 12px',
      }}
    >
      {showLabel ? (
        <div
          style={{
            display: 'flex',
            marginBottom: large ? 16 : largeCompact ? 8 : dotsCompact ? 4 : dots ? 8 : 12,
            color: theme.text,
            fontSize: large ? 34 : largeCompact ? 32 : dots ? 28 : 32,
            fontWeight: 650,
          }}
        >
          {group.label}
        </div>
      ) : null}
      {!dots ? (
        <div style={{ display: 'flex', width: '100%', marginBottom: 7 }}>
          {WEEKDAY_LABELS.map((label, index) => (
            <div
              key={`${label}-${index}`}
              style={{
                width: '14.285%',
                display: 'flex',
                justifyContent: 'center',
                color: theme.subtext,
                fontSize: large ? 25 : largeCompact ? 24 : 14,
                fontWeight: 650,
              }}
            >
              {label}
            </div>
          ))}
        </div>
      ) : null}
      {rows.map((row, rowIndex) => (
        <div key={`month-row-${rowIndex}`} style={{ display: 'flex', width: '100%' }}>
          {row.map((cell, cellIndex) => (
            <MonthCell
              key={cell?.date ?? `blank-${rowIndex}-${cellIndex}`}
              cell={cell}
              theme={theme}
              height={cellHeight}
              scale={scale}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function MonthCell({
  cell,
  theme,
  height,
  scale,
}: {
  cell: WallpaperCell | null;
  theme: WallpaperTheme;
  height: number;
  scale: MonthScale;
}): ReactElement {
  const large = scale === 'large';
  const largeCompact = scale === 'large-compact';
  const dots = scale === 'dots' || scale === 'dots-compact';
  const dotsCompact = scale === 'dots-compact';
  const geometry = large
    ? CALENDAR_DOT_GEOMETRY.month
    : largeCompact
      ? { ...CALENDAR_DOT_GEOMETRY.month, size: 64 }
      : dots
        ? {
            ...CALENDAR_DOT_GEOMETRY.year,
            size: dotsCompact ? 14 : CALENDAR_DOT_GEOMETRY.year.size,
          }
        : CALENDAR_DOT_GEOMETRY.quarter;

  return (
    <div
      style={{
        width: '14.285%',
        height,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {cell ? (
        <CalendarDot
          cell={cell}
          theme={theme}
          size={geometry.size}
          eventRingGap={geometry.eventRingGap}
          eventRingWidth={geometry.eventRingWidth}
        />
      ) : null}
    </div>
  );
}

function CalendarDot({
  cell,
  theme,
  size,
  eventRingGap,
  eventRingWidth,
}: {
  cell: WallpaperCell;
  theme: WallpaperTheme;
  size: number;
  eventRingGap: number;
  eventRingWidth: number;
}): ReactElement {
  const fill = cell.current
    ? theme.current
    : cell.passed && cell.weekend
      ? theme.weekend
      : cell.passed
        ? theme.passed
        : theme.future;
  const ringOffset = eventRingGap + eventRingWidth;

  return (
    <div
      style={{
        width: size,
        height: size,
        display: 'flex',
        position: 'relative',
        borderRadius: 999,
        backgroundColor: fill,
      }}
    >
      {cell.event ? (
        <div
          style={{
            position: 'absolute',
            top: -ringOffset,
            left: -ringOffset,
            width: size + ringOffset * 2,
            height: size + ringOffset * 2,
            display: 'flex',
            border: `${eventRingWidth}px solid ${cell.current ? theme.text : theme.current}`,
            borderRadius: 999,
          }}
        />
      ) : null}
    </div>
  );
}

function EventList({
  model,
  limit,
  compact = false,
}: {
  model: WallpaperModel;
  limit: number;
  compact?: boolean;
}): ReactElement {
  const visible = model.events.slice(0, limit);
  const overflow = Math.max(0, model.events.length - visible.length);

  if (!visible.length) {
    return <EmptyEvents theme={model.theme} compact={compact} />;
  }

  return (
    <div style={columnStyle}>
      {visible.map((event, index) => (
        <EventRow
          key={event.id}
          event={event}
          theme={model.theme}
          bordered={index > 0}
          compact={compact}
        />
      ))}
      {overflow ? (
        <div
          style={{
            display: 'flex',
            paddingTop: 10,
            color: model.theme.subtext,
            fontSize: compact ? 20 : 24,
          }}
        >
          +{overflow} more
        </div>
      ) : null}
    </div>
  );
}

function EventRow({
  event,
  theme,
  bordered,
  compact,
}: {
  event: DisplayEvent;
  theme: WallpaperTheme;
  bordered: boolean;
  compact: boolean;
}): ReactElement {
  return (
    <div
      style={{
        minHeight: compact ? 66 : 100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 28,
        borderTop: bordered ? `1px solid ${theme.future}` : 'none',
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          minWidth: 0,
          flex: 1,
        }}
      >
        <div
          style={{
            display: 'flex',
            overflow: 'hidden',
            whiteSpace: 'nowrap',
            textOverflow: 'ellipsis',
            fontSize: compact ? 34 : 36,
            fontWeight: 550,
          }}
        >
          {event.name}
        </div>
        <div
          style={{
            display: 'flex',
            marginTop: compact ? 3 : 8,
            color: theme.subtext,
            fontSize: compact ? 22 : 24,
          }}
        >
          {event.dateLabel}
        </div>
      </div>
      <div
        style={{
          display: 'flex',
          flexShrink: 0,
          color: event.daysLeft <= 1 ? theme.current : theme.subtext,
          fontSize: compact ? 28 : 30,
          fontWeight: 600,
        }}
      >
        {event.countdownLabel}
      </div>
    </div>
  );
}

function PeriodProgress({
  model,
  large = false,
}: {
  model: WallpaperModel;
  large?: boolean;
}): ReactElement {
  if (model.period.kind === 'rolling') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <div
          style={{
            display: 'flex',
            color: model.theme.current,
            fontSize: large ? 62 : 38,
            fontWeight: 680,
          }}
        >
          14-day outlook
        </div>
        <div
          style={{
            display: 'flex',
            marginTop: 10,
            color: model.theme.subtext,
            fontSize: large ? 26 : 21,
          }}
        >
          A moving window from today
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
        }}
      >
        <div
          style={{
            display: 'flex',
            color: model.theme.current,
            fontSize: large ? 78 : 48,
            fontWeight: 720,
            lineHeight: 1,
          }}
        >
          {model.period.percentComplete}%
        </div>
        <div
          style={{
            display: 'flex',
            color: model.theme.subtext,
            fontSize: large ? 26 : 21,
          }}
        >
          {formatPeriodRemaining(model.period.daysLeft)}
        </div>
      </div>
      <div
        style={{
          width: '100%',
          height: large ? 14 : 10,
          display: 'flex',
          marginTop: large ? 22 : 14,
          overflow: 'hidden',
          borderRadius: 8,
          backgroundColor: model.theme.future,
        }}
      >
        <div
          style={{
            width: `${model.period.percentComplete}%`,
            height: '100%',
            display: 'flex',
            backgroundColor: model.theme.current,
          }}
        />
      </div>
    </div>
  );
}

function EmptyEvents({
  theme,
  compact = false,
}: {
  theme: WallpaperTheme;
  compact?: boolean;
}): ReactElement {
  return (
    <div
      style={{
        ...columnStyle,
        justifyContent: 'center',
        alignItems: compact ? 'flex-start' : 'center',
      }}
    >
      <div
        style={{
          display: 'flex',
          color: theme.text,
          fontSize: compact ? 24 : 38,
          fontWeight: 600,
        }}
      >
        No upcoming events
      </div>
      <div
        style={{
          display: 'flex',
          marginTop: 8,
          color: theme.subtext,
          fontSize: compact ? 18 : 24,
        }}
      >
        Add one from the dashboard or Telegram.
      </div>
    </div>
  );
}

function SectionLabel({
  theme,
  children,
}: {
  theme: WallpaperTheme;
  children: ReactNode;
}): ReactElement {
  return (
    <div
      style={{
        display: 'flex',
        color: theme.subtext,
        fontSize: 20,
        fontWeight: 700,
        letterSpacing: 1.4,
        textTransform: 'uppercase',
      }}
    >
      {children}
    </div>
  );
}

function MockIosOverlay({ theme }: { theme: WallpaperTheme }): ReactElement {
  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: WALLPAPER_WIDTH,
        height: WALLPAPER_HEIGHT,
        display: 'flex',
        color: theme.text,
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: 170,
          left: 0,
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
        }}
      >
        <div style={{ display: 'flex', fontSize: 30, fontWeight: 600 }}>
          Friday, October 23
        </div>
        <div
          style={{
            display: 'flex',
            marginTop: 8,
            fontSize: 176,
            fontWeight: 300,
            letterSpacing: -7,
            lineHeight: 1,
          }}
        >
          9:41
        </div>
        <div
          style={{
            display: 'flex',
            gap: 20,
            marginTop: 44,
          }}
        >
          {[0, 1].map((item) => (
            <div
              key={item}
              style={{
                width: 222,
                height: 112,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: '2px solid rgba(255,255,255,0.35)',
                borderRadius: 28,
                backgroundColor: 'rgba(255,255,255,0.08)',
                color: 'rgba(255,255,255,0.7)',
                fontSize: 21,
              }}
            >
              Widget
            </div>
          ))}
        </div>
      </div>
      <div
        style={{
          position: 'absolute',
          top: 2180,
          left: 76,
          width: WALLPAPER_WIDTH - 152,
          display: 'flex',
          flexDirection: 'column',
          gap: 18,
        }}
      >
        {[0, 1].map((item) => (
          <div
            key={item}
            style={{
              height: 178,
              display: 'flex',
              alignItems: 'center',
              padding: '0 38px',
              border: '1px solid rgba(255,255,255,0.24)',
              borderRadius: 34,
              backgroundColor: 'rgba(255,255,255,0.12)',
              color: 'rgba(255,255,255,0.72)',
              fontSize: 24,
            }}
          >
            Mock notification region
          </div>
        ))}
      </div>
    </div>
  );
}

const columnStyle: CSSProperties = {
  width: '100%',
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
};

type MonthScale = 'large' | 'large-compact' | 'medium' | 'dots' | 'dots-compact';

function monthScale(model: WallpaperModel, groupCount: number): MonthScale {
  if (groupCount === 1) {
    return model.lockScreenProfile === 'large-clock' ? 'large-compact' : 'large';
  }

  if (groupCount <= 3) {
    return 'medium';
  }

  return model.lockScreenProfile === 'large-clock' ? 'dots-compact' : 'dots';
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

function formatShortDate(date: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${date}T00:00:00Z`));
}

function formatContextDate(date: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${date}T00:00:00Z`));
}
