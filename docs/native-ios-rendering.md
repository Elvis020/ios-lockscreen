# Native SF wallpaper prototype

Status: experimental, opt-in code. It has local automated coverage, not a verified
installation on the target iPhone. Deploy this version before trying its native URL.
Keep the existing PNG Shortcut as a fallback.

## What changes

Vercel sends a small JSON scene instead of an image. [Scriptable](https://scriptable.app/)
draws that scene on the iPhone using its native system font and returns a PNG to
Shortcuts. Shortcuts still applies the wallpaper. No Apple font file is copied into
the project, downloaded, or hosted on Vercel.

The prototype supports week, month and quarter in Calendar or Hybrid presentation,
with either clock profile and the saved built-in/custom theme. It keeps the dots,
weekday labels, centered quarter summary, two visible events, `+N more`, and thin
event timer lines. The current saved Telegram/dashboard settings remain authoritative.

Agenda, rolling 14 days, year, Countdown, Progress and Minimal are not supported in
this prototype. The native URL returns a clear error for those settings; it does
not silently switch the view or fall back to a different font. Switch to a supported
view or use the original PNG Shortcut.

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

Do not connect the Telegram-close automation to this test Shortcut until manual
refreshes are reliable. Locked-phone and background execution are separate tests.
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

Check all three ranges and both clock profiles. Confirm genuine system-font text,
crisp dots, readable weekday labels, full month names, event-ring alignment and
three-pixel event tracks. Test a long title, accented characters and emoji. Event
names currently use conservative single-line truncation because DrawContext does
not expose native text measurement; exact clipping needs device inspection.

Change a view/theme/event in Telegram, wait for the successful reply, then run the
test Shortcut. Confirm the next fetch reflects the saved change. This does not add
a Telegram Send trigger, refresh Google automatically, or force a wallpaper refresh.

After manual application works, test the [Telegram-close automation](./ios-shortcut.md).
Do not call the prototype production-ready until crop/zoom, permissions, payload
size, memory and locked/background execution have been checked on the target phone.

## Local verification

```bash
npm run check
npm run preview:native-data -- /private/tmp/calendar-native-fixtures
```

The second command writes 12 deterministic JSON scenes using synthetic events.
It does not render with iOS or prove the Scriptable/Shortcuts integration. Tests run
the actual Scriptable script in a simulated native API environment; a native Mac
preview is also only a visual aid, not an iPhone execution result.

## Primary API references

- [Scriptable: native Font APIs](https://docs.scriptable.app/font/)
- [Scriptable: DrawContext](https://docs.scriptable.app/drawcontext/)
- [Scriptable: Shortcut input](https://docs.scriptable.app/args/#shortcutparameter)
- [Scriptable: Shortcut output types](https://docs.scriptable.app/script/#setshortcutoutput)
- [Scriptable: PNG/base64 data](https://docs.scriptable.app/data/)
