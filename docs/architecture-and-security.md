# Architecture and security

Calendar Lockscreen runs as Vercel Edge functions and uses Redis as the shared source of truth for accounts, settings, events, Telegram links, OAuth state, and cached Google events.

## Data flow

1. The dashboard, signed Telegram control panel, Telegram bot, or Google sync updates the user's Redis record.
2. The wallpaper endpoint reads that shared record.
3. The renderer creates the selected time range and presentation inside a calibrated lock-screen content band.
4. An iOS Shortcut fetches the image and applies it to the phone.

The application cannot force iOS to refresh a wallpaper. Run the Shortcut manually or with an iOS automation after changing settings; this is not a server-push feature.

## Tokens and URLs

- The management token can change account data and must remain private.
- The wallpaper key is read-only and is intended for the iOS Shortcut URL.
- Legacy `token` wallpaper URLs remain supported.
- Management APIs prefer `Authorization: Bearer <management-token>` while retaining query-token compatibility for existing clients.
- Existing browser storage migrates from `quarterProgressToken` to `calendarLockscreenManagementToken`.
- A Telegram-first user is provisioned idempotently from the verified private-chat identity.
  Its management token and wallpaper key remain server-side; the Telegram control panel
  uses signed launch data instead of exposing either credential.

## Concurrency and compatibility

Existing user records preserve their stored week, month, or quarter and normalize to the calendar presentation with the standard lock-screen profile. New accounts start with the month-and-next-events hybrid preset. A read-only wallpaper key is created when a legacy account next uses a management API; existing Redis keys are not renamed.

The schema stores `timeRange`, `presentation`, `lockScreenProfile`, and `eventCount`
separately. The seven named presets map range/presentation only, so choosing a
preset never resets the event count. Counts are integers 1–5, defaulting to 2 for
new, legacy or invalid stored settings. Agenda and Minimal are no longer public
views; saved versions normalize to Calendar without changing account keys or
events. The retired Minimal color theme normalizes to Default. Legacy `viewMode`
remains accepted. If a legacy custom theme collides with a newly introduced built-in
name, its colors are preserved under a deterministic `-custom` name.

Per-user mutations use short-lived owner locks with atomic commit-time lease fencing. An expired lock holder therefore cannot overwrite a newer update from the dashboard, Telegram, or Google Calendar.

## Security boundaries

- All credentials come from environment variables.
- Google refresh tokens are encrypted with AES-GCM before Redis storage.
- OAuth state uses a short-lived, secure, HttpOnly, SameSite cookie.
- Telegram link codes and OAuth state expire after ten minutes.
- Control-panel requests authorize with verified, fresh Telegram init data or the
  short-lived OAuth continuation session; either path revalidates the current
  Telegram-to-account mapping. Mutations have short per-user, per-action rate limits.
  The live preview uses an authenticated POST and private, no-store caching rather than
  placing a wallpaper credential in the page or URL.
- Starting Google OAuth from Telegram creates a one-time, ten-minute Redis launch record
  and returns a same-origin handoff URL whose random capability is fragment-only. The
  Mini App opens that URL externally; its no-store handoff page posts the fragment back
  same-origin, atomically consumes the launch, then sets the Google browser nonce and
  opaque Telegram continuation-session cookies in the external browser before navigating
  to the stored Google authorization URL. The capability is never present in request URLs,
  server-rendered HTML, logs, or referrers, and a replay is rejected.
- Telegram event drafts and edit-menu snapshots expire after fifteen minutes. Edit-menu
  callbacks carry an opaque menu token plus a bounded slot, never an event ID; consuming
  a menu creates one draft atomically and invalidates prior menu buttons. The Mini App
  verifies signed Telegram launch data, checks freshness, and binds the verified user to
  an active date-selection draft before bootstrapping or accepting a date. Final create
  and edit saves use fenced user/draft commits; an edit compares its immutable original
  snapshot and discards the draft on conflict. The date picker sends a separate
  confirmation in the bot chat.
- Personalized wallpaper responses are private and not cached.
- The public fallback wallpaper may use a one-hour CDN cache.
- Errors returned to clients avoid exposing internal details.

Google sync discovers the primary calendar and other visible calendars through Google's
CalendarList API before fetching events. Secondary-calendar event IDs are namespaced with
a one-way calendar hash so identical provider event IDs cannot collide and raw calendar
IDs are not added to the app's stored event IDs. Provider pagination and calendar counts
are bounded; revoked refresh access returns a reconnect instruction.

The temporary invite-admin endpoint remains available for initial setup. Keep `ADMIN_INVITE_SECRET` private and remove the endpoint when setup is complete.

## Lock-screen layout calibration

Wallpaper generation remains fixed at 1284×2778 for compatibility. Dot fields begin
at y=832 in Standard and y=1032 in Large clock, below the estimated native time.
The generated 64px caption box ends 20px before the grid's outer ring envelope.
The envelope uses each range's actual ring outset. Countdown retains its 920/1120px
content bands. All layouts keep the same 2080px content bottom above notifications.

These positions are calibration defaults, not device detection or universal safe-area claims. iOS can crop or zoom a wallpaper after download, and clock, widget, text-size, and notification choices vary. Use the generated mock-overlay previews as a first check, then verify the raw PNG on the actual target lock screen. Wallpaper settings also appear only after the iOS Shortcut fetches a fresh image; the application cannot force that refresh.

## Dots-first event layout

The wallpaper is a continuous progress-dot matrix, not a conventional calendar.
Both renderers draw `model.cells` in chronological row-major order: 7 dots for a
week, 14 for rolling 14 days, 28–31 for a month, 90–92 for a quarter and 365–366 for
a year. Columns are 7/7/7/10/22 respectively. There are no month panels, weekday
headings, day numbers, or spacer day cells; the final partial row stays left-aligned.
Colors still distinguish elapsed weekdays/weekends, today and future days. Every
tracked event can add its ring even when its event row is hidden by the list limit.

Every dot view uses a centered summary such as `October · 74% left · 68 days left`,
without an overview bar or separate quarter/year title. The full month is taken
from the account-local current date, not the period's start. The remaining share is
`round(daysLeft / totalDays * 100)` and excludes today. Rolling 14 therefore shows
93% and 13 days remaining after today, resetting with its moving window rather
than claiming elapsed progress. Explicit custom-title requests retain their override.
Event countdowns remain unchanged. Countdown retains
its featured-event display. The real lock-screen clock is never baked into the
wallpaper. Mock overlays are visual aids without a simulated widget row, not proof
of a particular phone's font, widget or crop behavior.

Event dates remain stored for sorting, countdowns, and calendar markers but are not
printed beside events. Each displayed event has a single name/countdown line and a
thin, three-pixel progress track on the full-resolution image. In dot views, the
entire rail follows the centered outer-ring grid envelope; other views keep the full
content width. Compact rows use
`Today`, `1d`, or `22d`; long names truncate without displacing the countdown. The
large countdown display has no event timer line; additional Countdown events do.

Every active presentation honors the same saved display count: 1–5 events, default
2, for either clock profile. The layout reserves the actual rail height (at least
76px for an empty state), rather than an unused fixed 204px slot. Lists use the
dot-grid envelope in dot views and full-width rows otherwise when the available band
allows, first tightening
76px rows/20px gaps to 68px rows/14px gaps if needed. Dense combinations then use
two columns with 52px rows, a 28px gutter and the same thin timers. This preserves
bounded dot sizes and ring separation while fitting the selected count. Countdown keeps its first event
as the hero and lists the remainder beneath it. `+N more` counts all remaining
upcoming events. This is a display limit, not an account limit; every eligible
event still contributes its calendar marker. Dates remain stored and all active
views retain globally upcoming events.

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
native combinations cover all five ranges, four presentations and two clock profiles.
Year uses a single twenty-two-column matrix; rolling 14 days uses two rows of seven dots.
The existing scene-v1 adapter remains compatible. Oversized public marker scenes
return a private, non-cacheable 422 rather than dropping markers. Unknown `format`
values retain the existing PNG behavior for compatibility.

Both renderers use shared geometry and event-cap calculations in `wallpaperLayout.ts`.
Calendar/Hybrid/Progress content is top-anchored below the clock; compact event slots have
independent preferred positions (1720px standard, 1812px large-clock) and move down
when a grid needs clearance or up to fit a taller event list. A single pure solver
chooses an event density and fits the largest even dot diameter within range caps,
bounded horizontal/vertical gaps, an 80px clear ring-to-rail gap, and the 2080px
bottom. The ring-to-rail gap cannot exceed 240px: sparse views keep their events
closer instead of ballooning dots or leaving an oversized blank area. Year dots are 30–32px
with 12–16px horizontal fill gaps, larger and tighter than the former 24px/30px.
Geometry can adapt to profile and actual event count but not to dot-bearing
presentation alone. No spread-to-fill rows or month-group geometry remain.
The native scene is interpreted on the iPhone by a strict, network-free Scriptable
script using the native Font APIs. The script returns PNG bytes as base64 text to
Shortcuts without saving files or uploading font data. The original PNG pathway and
Telegram mutations are unchanged. No new dependencies or credentials are required
on the server; Scriptable is an optional third-party dependency on the phone.

The implementation is an opt-in prototype: simulated tests and Mac previews do not
establish real iPhone font metrics, extension memory usage, Shortcut data conversion,
wallpaper crop/zoom, or background/locked execution. Those remain device acceptance
tests before replacing the working PNG Shortcut or enabling automatic refresh.
