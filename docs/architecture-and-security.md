# Architecture and security

Calendar Lockscreen runs as Vercel Edge functions and uses Redis as the shared source of truth for accounts, settings, events, Telegram links, OAuth state, and cached Google events.

## Data flow

1. The dashboard, Telegram bot, or Google sync updates the user's Redis record.
2. The wallpaper endpoint reads that shared record.
3. The renderer creates the selected time range and presentation inside a calibrated lock-screen content band.
4. An iOS Shortcut fetches the image and applies it to the phone.

The application cannot force iOS to refresh a wallpaper. Run the Shortcut manually or with an iOS automation after changing settings. The agreed, deferred [iOS refresh setup](./ios-shortcut.md) uses Telegram's app-close trigger on the phone; it is not a server-push feature.

## Tokens and URLs

- The management token can change account data and must remain private.
- The wallpaper key is read-only and is intended for the iOS Shortcut URL.
- Legacy `token` wallpaper URLs remain supported.
- Management APIs prefer `Authorization: Bearer <management-token>` while retaining query-token compatibility for existing clients.
- Existing browser storage migrates from `quarterProgressToken` to `calendarLockscreenManagementToken`.

## Concurrency and compatibility

Existing user records preserve their stored week, month, or quarter and normalize to the calendar presentation with the standard lock-screen profile. New accounts start with the month-and-next-events hybrid preset. A read-only wallpaper key is created when a legacy account next uses a management API; existing Redis keys are not renamed.

The schema stores `timeRange`, `presentation`, and `lockScreenProfile` separately. The nine named presets are shared mappings over those dimensions, so users may start from a preset and still tune range or presentation independently. Legacy `viewMode` settings and `/view` clients remain accepted at the API boundary.

Per-user mutations use short-lived owner locks with atomic commit-time lease fencing. An expired lock holder therefore cannot overwrite a newer update from the dashboard, Telegram, or Google Calendar.

## Security boundaries

- All credentials come from environment variables.
- Google refresh tokens are encrypted with AES-GCM before Redis storage.
- OAuth state uses a short-lived, secure, HttpOnly, SameSite cookie.
- Telegram link codes and OAuth state expire after ten minutes.
- Personalized wallpaper responses are private and not cached.
- The public fallback wallpaper may use a one-hour CDN cache.
- Errors returned to clients avoid exposing internal details.

The temporary invite-admin endpoint remains available for initial setup. Keep `ADMIN_INVITE_SECRET` private and remove the endpoint when setup is complete.

## Lock-screen layout calibration

Wallpaper generation remains fixed at 1284×2778 for compatibility. The standard profile reserves roughly the top third for the clock and widgets and the bottom quarter for notifications. The large-clock profile moves the content start lower while retaining the same conservative bottom boundary.

These positions are calibration defaults, not device detection or universal safe-area claims. iOS can crop or zoom a wallpaper after download, and clock, widget, text-size, and notification choices vary. Use the generated mock-overlay previews as a first check, then verify the raw PNG on the actual target lock screen. Wallpaper settings also appear only after the iOS Shortcut fetches a fresh image; the application cannot force that refresh.

## Dots-first event layout

The wallpaper keeps circular day markers and deliberately limits text. The quarter
view has no quarter/year heading; its full month names identify the grid. Quarter
calendar and hybrid views show a centered, date-driven summary such as
`26% complete · 68 days left`, without an overview timer bar. Other presentations use
a modest single-line heading without a progress/date subtitle. Week, month, and
quarter grids retain weekday labels; the denser year grid omits them. The native iOS
clock is not part of the generated wallpaper.

Event dates remain stored for sorting, countdowns, and calendar markers but are not
printed beside events. Each displayed event has a single name/countdown line and a
thin, three-pixel progress track on the full-resolution image. Compact rows use
`Today`, `1d`, or `22d`; long names truncate without displacing the countdown. The
minimal presentation retains the event row's track; the large countdown display
has no event timer line.

| Presentation         | Standard clock | Large clock   |
| -------------------- | -------------- | ------------- |
| Calendar, any range  | 2 events       | 2 events      |
| Hybrid               | 2 events       | 2 events      |
| Agenda               | 5 events       | 4 events      |
| Countdown or minimal | 1 event        | 1 event       |
| Progress             | No event list  | No event list |

These are display caps, not account limits. Calendar, hybrid, and agenda lists show
`+N more` for remaining eligible events. Calendar markers use all eligible events,
including those outside the displayed event rows. Agenda includes only upcoming
events within its selected date range; other presentations retain globally upcoming
events.

The line measures inclusive progress from the displayed period's start to the event,
matching the original timer. It reaches 100% on the event date and works for events
beyond the visible month or year. Switching ranges can change its reference point;
it is not a live seconds timer. Like the dots, it updates on the next image fetch.

The server PNG renderer currently uses the image library's bundled Noto Sans fallback. Declaring
`Inter, system-ui, sans-serif` does not load Inter or adopt the user's iOS clock font.

## Optional on-device font rendering

The [native iPhone prototype](./native-ios-rendering.md) adds `format=native` to the
wallpaper endpoint. This returns a versioned, data-only drawing scene. Its explicit
allowlist includes only canvas dimensions, a background and text/circle/rounded-rect
commands; it never serializes the model or account record. Visible event names are
still private data. Native responses and errors always disable browser/CDN caching.

Only the existing read-only wallpaper key is accepted for personalized native data;
legacy management-token wallpaper URLs continue to work for PNG only. Supported
native combinations cover all five ranges, six presentations and two clock profiles.
Year uses a 4×3 month collection, and rolling 14 days uses two rows of seven dots.
The existing scene-v1 adapter remains compatible. Oversized public marker scenes
return a private, non-cacheable 422 rather than dropping markers. Unknown `format`
values retain the existing PNG behavior for compatibility.

Both renderers use shared geometry and event-cap calculations in `wallpaperLayout.ts`.
Calendar/Hybrid content is top-anchored below the clock; compact event slots have
independent preferred positions (1680px standard, 1772px large-clock) and move down
only when a grid needs more clearance. Quarter cells can expand vertically to use
the available band, and multi-row month collections distribute space between rows.
The native scene is interpreted on the iPhone by a strict, network-free Scriptable
script using the native Font APIs. The script returns PNG bytes as base64 text to
Shortcuts without saving files or uploading font data. The original PNG pathway and
Telegram mutations are unchanged. No new dependencies or credentials are required
on the server; Scriptable is an optional third-party dependency on the phone.

The implementation is an opt-in prototype: simulated tests and Mac previews do not
establish real iPhone font metrics, extension memory usage, Shortcut data conversion,
wallpaper crop/zoom, or background/locked execution. Those remain device acceptance
tests before replacing the working PNG Shortcut or enabling automatic refresh.
