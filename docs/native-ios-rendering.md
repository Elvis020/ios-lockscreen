# Native SF wallpaper prototype

Status: experimental, opt-in code. Manual rendering and Lock Screen application
have worked on the target iPhone. The latest spacing refinements have automated
coverage and Mac previews; they still need a fresh iPhone check. Keep the existing
PNG Shortcut as a fallback.

## What changes

Vercel sends a small JSON scene instead of an image. [Scriptable](https://scriptable.app/)
draws that scene on the iPhone using its native system font and returns a PNG to
Shortcuts. Shortcuts still applies the wallpaper. No Apple font file is copied into
the project, downloaded, or hosted on Vercel.

The prototype supports seven presets: Week, Month, Quarter, Rolling 14 days,
Countdown, Year, and Month + next events. It also supports
all 40 combinations of the five ranges, four presentations and two clock profiles,
including saved built-in/custom themes. The current Telegram/dashboard settings
remain authoritative; a preset is not silently replaced by a different view.

Calendar/Hybrid/Progress use one continuous field of chronological dots. Week and
rolling 14 days use seven columns, Month uses seven, Quarter ten, and Year twenty-two.
There are exactly as many dots as days in the selected period: no month panels,
weekday labels, date numbers, or leading/trailing blank day cells. A partial last
row stays left-aligned with the first row.

The first fill-dot starts at y=832 for Standard or y=1032 for Large clock on the
1284×2778 image, consistently across ranges. The centered caption sits above it,
with more clearance below the clock. These are calibration targets, not device
detection; widgets, iOS zoom/cropping and clock customization need phone testing.
Event rows have independent preferred anchors at y=1720/1812, moving as needed to
keep at least 80px clear after the last dot's outer ring and finish by y=2080.
The gap is capped at 240px so Week and Rolling 14 do not leave an oversized empty
area before their events.
Event timer lines remain 3px thin. Compact lists
default to two events plus `+N more`. Set 1–5 using `/eventcount` or **Events shown**
on the dashboard; this preference survives view changes. Rows stay full width
while space allows, tightening their vertical gaps before using two columns for
the densest combinations. Dot diameter and axis gaps adapt within bounded ranges,
without stretching circles or dropping days/events. Countdown counts its
featured event as the first, with additional events beneath it. Event dates and
the redundant quarter heading stay hidden.

The shared layout solver fits the dot field and actual event rail together. In dot
views, the rail is centered beneath and constrained to the grid's outer-ring envelope;
other presentations retain the content-width rail. It tries normal rows, then snug
rows, then two-column dense rows, keeping
the largest even dot diameter that fits each candidate's height and the available
width. Week/rolling dots stay within 112–124px, Month 96–108px, Quarter 56–72px and
Year 30–32px. Axis gaps are bounded rather than spread-to-fill: a sparse Week stays
compact, while dense views use more of the available height. Year has seventeen
rows, including leap years, with a maximum 16px horizontal fill gap instead of the
old 30px gap. The selected count and actual events can affect geometry; switching
between Calendar/Hybrid/Progress alone cannot. Native dots and rings stay integer-aligned.

Every dot view uses one centered caption such as
`October · 74% left · 68 days left`. The month is the account-local current month;
percentage and days refer to the selected period, excluding today. For Rolling 14,
this is `93% left · 13 days left`: a moving window, not accumulating elapsed progress.
An explicit public custom title still overrides the default caption. No overview
bar or redundant year/quarter heading is added. Saved
Year/progress settings render identically to Year/calendar. Countdown retains its
featured-event presentation rather than adding a dot field.

These refinements change server-side drawing data only. The scene stays at version 1:
existing Scriptable code and native Shortcut URLs do not need changing. After the
deployment, rerun the same Shortcut to fetch the revised layout.

The installed adapter accepts native text up to 80px. Countdown uses an 80px number
in both renderers. Neither
path changes the actual iOS clock.

The native drawing budget stays at 600 commands and 200,000 serialized characters.
Normal accounts have at most seven tracked events and fit that budget, including
a leap-year grid with event rings. An oversized public example returns a private,
non-cacheable 422 `native_scene_too_large` error rather than silently dropping markers.

## Set up a separate test Shortcut

1. Install Scriptable on the iPhone. Open it once.
2. Add a new Scriptable script named **Calendar Lockscreen Native**. Paste the full
   contents of [`render-wallpaper.js`](../scripts/scriptable/render-wallpaper.js).
   This is a plain JavaScript script, not a website to open in Safari.
3. Duplicate your working wallpaper Shortcut and name the copy **Calendar Native Test**.
4. Use the read-only wallpaper URL from the bot's `/url` command. Append
   `&format=native` to that URL. A public test URL can use
   `/api/wallpaper?view=quarter&format=native` without any credential.
5. Use this action sequence, explicitly connecting each action's output to the next:

   - **URL**: the native URL.
   - **Get Contents of URL**: GET. Its output is a JSON dictionary, not a picture.
   - Scriptable **Run Script**: select Calendar Lockscreen Native; set its input
     parameter to the contents returned above. Dictionary or JSON text is accepted.
   - **Base64 Encode**: change its operation to **Decode**; input is the Run Script
     result. The exact action label may vary by iOS language/version.
   - **Get Images from Input**: use the decoded data.
   - **Quick Look**: inspect the image first. Do not apply it until this works.

6. Run while unlocked and approve required permissions. Expect a full-size
   1284×2778 image with no fake clock baked in. The actual lock-screen clock remains iOS-owned.
7. When the image looks correct, replace Quick Look with the wallpaper-setting action
   from your working Shortcut. Select **Lock Screen only** and disable its preview
   confirmation where available.

Verify manual refreshes first. Locked-phone and background execution are separate tests.
If Scriptable is terminated for memory or fails inside the extension, try its
**Run in App** option; that may open Scriptable and is not a silent-refresh guarantee.

## Privacy and failure behavior

- Use only the read-only wallpaper key, never the management token. The native URL
  rejects legacy management-token authentication.
- The scene contains visible event names, countdown text, colors and drawing
  coordinates. Treat both the response and resulting image as private.
- The server does not send account records, Google emails/tokens, Telegram IDs,
  management tokens or wallpaper keys in the JSON body. All native responses use
  private/no-store cache headers, including public examples and errors.
- Scriptable receives data, not executable code. The script validates the protocol,
  canvas size and every drawing command before creating an image. It makes no
  network requests and writes nothing to Files, Photos or iCloud.
- PNG bytes pass back as base64 text because Scriptable's documented Shortcut output
  contract supports text, not a direct Image object. This adds temporary memory use.
- A failed fetch or rejected scene must stop the Shortcut before Set Wallpaper.
  Do not add a continue-on-error or empty-result fallback. The previous wallpaper
  then remains in place. This is not an automatic fallback to the old PNG route.
- Keep the Shortcut private: its URL still contains a bearer-style read-only key.
  Scriptable's installed app privacy policies apply independently of this script.

## Verify on the iPhone

Check all seven presets, event counts 1–5, and both clock profiles. Confirm genuine system-font text,
crisp dots, the correct period-day count, consistent first-dot placement, event-ring alignment and
three-pixel event tracks. Test a long title, accented characters and emoji. Event
names currently use conservative single-line truncation because DrawContext does
not expose native text measurement; exact clipping needs device inspection.

Change a view/theme/event in Telegram, wait for the successful reply, then run the
test Shortcut. Confirm the next fetch reflects the saved change. This does not add
a Telegram Send trigger, refresh Google automatically, or force a wallpaper refresh.

Do not call the prototype production-ready until crop/zoom, permissions, payload
size, memory and locked/background execution have been checked on the target phone.

## Local verification

```bash
npm run check
npm run preview:native-data -- /private/tmp/calendar-native-fixtures
```

The second command writes 40 deterministic JSON scenes using synthetic events.
It does not render with iOS or prove the Scriptable/Shortcuts integration. Tests run
the actual Scriptable script in a simulated native API environment; a native Mac
preview is also only a visual aid, not an iPhone execution result.

## Primary API references

- [Scriptable: native Font APIs](https://docs.scriptable.app/font/)
- [Scriptable: DrawContext](https://docs.scriptable.app/drawcontext/)
- [Scriptable: Shortcut input](https://docs.scriptable.app/args/#shortcutparameter)
- [Scriptable: Shortcut output types](https://docs.scriptable.app/script/#setshortcutoutput)
- [Scriptable: PNG/base64 data](https://docs.scriptable.app/data/)
