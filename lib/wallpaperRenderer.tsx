import { ImageResponse } from '@vercel/og';
import type { CSSProperties, ReactElement } from 'react';
import type { WallpaperTheme } from './preferences';
import {
  CONTENT_LEFT,
  CONTENT_RIGHT,
  getCalendarComposition,
  getCountdownComposition,
  getContinuousDotGridLayout,
  getWallpaperEventLayout,
  getWallpaperHeaderCopy,
  HEADER_HEIGHT,
  HEADER_TO_PRESENTATION_GAP,
  LOCK_SCREEN_CONTENT_BANDS,
  WALLPAPER_HEIGHT,
  WALLPAPER_WIDTH,
  type CalendarComposition,
  type WallpaperEventLayout,
} from './wallpaperLayout';
import {
  formatPeriodRemaining,
  type DisplayEvent,
  type WallpaperCell,
  type WallpaperModel,
} from './wallpaperModel';

export {
  CALENDAR_DOT_GEOMETRY,
  getCalendarRequiredHeight,
  getWallpaperEventLayout,
  getWallpaperHeaderCopy,
  getWallpaperLayoutBounds,
  LOCK_SCREEN_CONTENT_BANDS,
  WALLPAPER_HEIGHT,
  WALLPAPER_WIDTH,
  type WallpaperEventLayout,
  type WallpaperLayoutBounds,
} from './wallpaperLayout';

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
  const composition = getCalendarComposition(model);

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
          top: composition?.top ?? contentBand.top,
          left: CONTENT_LEFT,
          width: WALLPAPER_WIDTH - CONTENT_LEFT - CONTENT_RIGHT,
          height: composition?.height ?? contentHeight,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <WallpaperHeader
          model={model}
          title={options.title}
          height={composition?.headerHeight}
          grouped={Boolean(composition)}
        />
        {composition ? (
          <GroupedCalendar model={model} composition={composition} />
        ) : (
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
        )}
      </div>
      {options.mockIosOverlay ? <MockIosOverlay model={model} /> : null}
    </div>
  );
}

function WallpaperHeader({
  model,
  title,
  height = HEADER_HEIGHT,
  grouped = false,
}: {
  model: WallpaperModel;
  title?: string;
  height?: number;
  grouped?: boolean;
}): ReactElement {
  const copy = getWallpaperHeaderCopy(model, title);

  return (
    <div
      style={{
        height,
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
      }}
    >
      {copy.title ? (
        <div
          style={{
            display: 'flex',
            maxWidth: 1060,
            overflow: 'hidden',
            whiteSpace: 'nowrap',
            textOverflow: 'ellipsis',
            fontSize: 42,
            lineHeight: 1.05,
            fontWeight: 500,
          }}
        >
          {copy.title}
        </div>
      ) : null}
      {copy.subtitle ? (
        <div
          style={{
            display: 'flex',
            width: '100%',
            justifyContent: 'center',
            textAlign: 'center',
            color: model.theme.subtext,
            fontSize: grouped ? 30 : 26,
            lineHeight: grouped ? 1.2 : 1.25,
          }}
        >
          {copy.subtitle}
        </div>
      ) : null}
    </div>
  );
}

function GroupedCalendar({
  model,
  composition,
}: {
  model: WallpaperModel;
  composition: CalendarComposition;
}): ReactElement {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        marginTop: composition.headerGap,
      }}
    >
      <div style={{ display: 'flex', height: composition.calendarHeight, flexShrink: 0 }}>
        <CalendarVisual model={model} />
      </div>
      <div
        style={{
          display: 'flex',
          height: composition.eventsHeight,
          marginTop: composition.eventGap,
          flexShrink: 0,
        }}
      >
        <EventList model={model} />
      </div>
    </div>
  );
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

  return <Minimal model={model} />;
}

function Agenda({ model }: { model: WallpaperModel }): ReactElement {
  return (
    <div style={columnStyle}>
      <EventList model={model} />
    </div>
  );
}

function Countdown({ model }: { model: WallpaperModel }): ReactElement {
  const event = model.events[0];
  const composition = getCountdownComposition(model);

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
          position: 'relative',
          width: '100%',
          height: composition.heroHeight,
          flexShrink: 0,
        }}
      >
        <div
          style={{
            display: 'flex',
            position: 'absolute',
            top: 0,
            width: '100%',
            height: 96,
            justifyContent: 'center',
            color: model.theme.current,
            fontSize: 80,
            fontWeight: 700,
            lineHeight: 1.2,
          }}
        >
          {event.daysLeft === 0 ? 'Today' : event.daysLeft}
        </div>
        {event.daysLeft > 0 ? (
          <div
            style={{
              display: 'flex',
              position: 'absolute',
              top: 106,
              width: '100%',
              height: 36,
              justifyContent: 'center',
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
            position: 'absolute',
            bottom: 0,
            width: '100%',
            height: 58,
            justifyContent: 'center',
            overflow: 'hidden',
            whiteSpace: 'nowrap',
            textOverflow: 'ellipsis',
            fontSize: 48,
            fontWeight: 600,
          }}
        >
          {event.name}
        </div>
      </div>
      {composition.eventsHeight > 0 ? (
        <div
          style={{
            display: 'flex',
            width: '100%',
            height: composition.eventsHeight,
            marginTop: 28,
            flexShrink: 0,
            textAlign: 'left',
          }}
        >
          <EventList model={model} />
        </div>
      ) : null}
    </div>
  );
}

function Progress({ model }: { model: WallpaperModel }): ReactElement {
  if (model.timeRange === 'year') {
    return (
      <div style={columnStyle}>
        <PeriodProgress model={model} large />
        <div style={{ display: 'flex', flex: 1, minHeight: 0, marginTop: 30 }}>
          <CalendarVisual model={model} />
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
        <EventRow event={event} theme={model.theme} compact={false} height={144} />
      ) : (
        <EmptyEvents theme={model.theme} compact />
      )}
    </div>
  );
}

function CalendarVisual({ model }: { model: WallpaperModel }): ReactElement {
  const grid = getContinuousDotGridLayout(model);

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: grid.height,
        display: 'flex',
        flexShrink: 0,
      }}
    >
      {model.cells.map((cell, index) => (
        <div
          key={cell.date}
          style={{
            display: 'flex',
            position: 'absolute',
            left: grid.positions[index].x,
            top: grid.positions[index].y,
          }}
        >
          <CalendarDot
            cell={cell}
            theme={model.theme}
            size={grid.size}
            eventRingGap={grid.eventRingGap}
            eventRingWidth={grid.eventRingWidth}
          />
        </div>
      ))}
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

function EventList({ model }: { model: WallpaperModel }): ReactElement {
  const layout = getWallpaperEventLayout(model);
  const visible = model.events.slice(layout.startIndex, layout.limit);
  const overflow = layout.overflow;

  if (!model.events.length) {
    return (
      <EmptyEvents
        theme={model.theme}
        compact={layout.compact}
        railLeft={layout.railLeft}
        railWidth={layout.railWidth}
      />
    );
  }

  return (
    <div
      style={{
        ...columnStyle,
        width: layout.railWidth,
        marginLeft: layout.railLeft,
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: layout.rowGap }}>
        {chunk(visible, layout.columns).map((row) => (
          <div key={row[0].id} style={{ display: 'flex', gap: layout.columnGap }}>
            {row.map((event) => (
              <div
                key={event.id}
                style={{ display: 'flex', width: layout.cellWidth, flexShrink: 0 }}
              >
                <EventRow
                  event={event}
                  theme={model.theme}
                  compact={layout.compact}
                  height={layout.rowHeight}
                  emphasizeCountdown={layout.compact}
                  layout={layout}
                />
              </div>
            ))}
          </div>
        ))}
      </div>
      {overflow ? (
        <div
          style={{
            display: 'flex',
            height: layout.overflowHeight,
            alignItems: 'flex-end',
            color: model.theme.subtext,
            fontSize: layout.compact ? 20 : 24,
          }}
        >
          {`+${overflow} more`}
        </div>
      ) : null}
    </div>
  );
}

function EventRow({
  event,
  theme,
  compact,
  height,
  emphasizeCountdown = false,
  layout,
}: {
  event: DisplayEvent;
  theme: WallpaperTheme;
  compact: boolean;
  height: number;
  emphasizeCountdown?: boolean;
  layout?: WallpaperEventLayout;
}): ReactElement {
  return (
    <div
      style={{
        height,
        width: '100%',
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: layout?.columns === 2 ? 16 : 28,
        }}
      >
        <div
          style={{
            display: 'flex',
            minWidth: 0,
            flex: 1,
            overflow: 'hidden',
            whiteSpace: 'nowrap',
            textOverflow: 'ellipsis',
            fontSize: layout?.nameSize ?? (compact ? 34 : 40),
            lineHeight: 1.2,
            fontWeight: 500,
          }}
        >
          {event.name}
        </div>
        <div
          style={{
            display: 'flex',
            flexShrink: 0,
            width: layout?.columns === 2 ? 80 : 140,
            justifyContent: 'flex-end',
            color:
              event.daysLeft <= 1
                ? theme.current
                : emphasizeCountdown
                  ? theme.text
                  : theme.subtext,
            fontSize:
              layout?.countdownSize ?? (compact ? (emphasizeCountdown ? 30 : 28) : 32),
            lineHeight: 1.2,
            fontWeight: 500,
          }}
        >
          {event.countdownLabel}
        </div>
      </div>
      <div
        style={{ display: 'flex', marginTop: layout?.timerGap ?? (compact ? 12 : 18) }}
      >
        <EventTimer event={event} theme={theme} />
      </div>
    </div>
  );
}

function EventTimer({
  event,
  theme,
}: {
  event: DisplayEvent;
  theme: WallpaperTheme;
}): ReactElement {
  return (
    <div
      style={{
        display: 'flex',
        width: '100%',
        height: 3,
        overflow: 'hidden',
        borderRadius: 6,
        backgroundColor: theme.future,
      }}
    >
      <div
        style={{
          display: 'flex',
          width: `${event.progressPercent}%`,
          height: '100%',
          backgroundColor: theme.current,
        }}
      />
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
  railLeft = 0,
  railWidth = '100%',
}: {
  theme: WallpaperTheme;
  compact?: boolean;
  railLeft?: number;
  railWidth?: number | string;
}): ReactElement {
  return (
    <div
      style={{
        ...columnStyle,
        width: railWidth,
        marginLeft: railLeft,
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
    </div>
  );
}

function MockIosOverlay({ model }: { model: WallpaperModel }): ReactElement {
  const { theme } = model;
  const dateLabel = new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${model.period.currentDate}T12:00:00Z`));

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
          top: 320,
          left: 0,
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
        }}
      >
        <div style={{ display: 'flex', fontSize: 50, lineHeight: 1.2, fontWeight: 600 }}>
          {dateLabel}
        </div>
        <div
          style={{
            display: 'flex',
            marginTop: 22,
            fontSize: model.lockScreenProfile === 'large-clock' ? 480 : 286,
            fontWeight: 300,
            letterSpacing: -7,
            lineHeight: 1,
          }}
        >
          9:41
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

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}
