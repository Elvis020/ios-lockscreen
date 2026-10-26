# Telegram bot setup

The Telegram bot is the main entry point for Calendar Lockscreen. It can create or resume an account, open the visual control panel, manage events, choose presets or independent wallpaper dimensions, change themes, and refresh Google Calendar data.

## 1. Create the bot

1. Open [@BotFather](https://t.me/BotFather) in Telegram.
2. Send `/newbot`.
3. Choose a display name and a username ending in `bot`.
4. Copy the token into your local environment file.

```text
TELEGRAM_BOT_TOKEN=
TELEGRAM_BOT_USERNAME=
TELEGRAM_WEBHOOK_SECRET=
```

Set `TELEGRAM_BOT_USERNAME` without the `@` symbol.

Telegram does not create the webhook secret. Generate one locally:

```bash
openssl rand -hex 32
```

Use the generated value for `TELEGRAM_WEBHOOK_SECRET`.

## 2. Register the webhook

Deploy the application first, then register this HTTPS endpoint with Telegram:

```text
https://YOUR-DOMAIN/api/telegram/webhook
```

Pass the same webhook secret as Telegram's `secret_token`. Telegram will return it in the `X-Telegram-Bot-Api-Secret-Token` header, which the application verifies.

The repository does not create or change Telegram webhooks automatically.

## Deployment URLs

Set `PUBLIC_APP_ORIGIN` in Vercel to the canonical deployed HTTPS origin. When it is
unset, the app falls back to Vercel's `VERCEL_PROJECT_PRODUCTION_URL`. Set
`PUBLIC_SHORTCUT_INSTALL_URL` to the public iCloud share link created after publishing
and testing a stable Shortcut; Vercel does not generate that link.

## Commands

Register the command menu once after creating the bot:

```bash
npm run telegram:configure-commands
```

This command requires Node.js 22.18 or newer. The script reads `TELEGRAM_BOT_TOKEN` from `.env`, registers commands only for private chats, and verifies the saved list without printing the token. Telegram stores the menu, so normal deployments do not need to run this command again.

Typing `/` in the bot chat will then show autocomplete for:

```text
/app
/help
/status
/url
/add Event name
/events
/today
/week
/focus M1|G1|off
/repeat M1 off|weekly|monthly|yearly
/category M1|G1 general|work|personal|health|travel
/edit
/edit NUMBER
/eventcount 1|2|3|4|5
/delete NUMBER
/view week|month|quarter|rolling14|countdown|year|hybrid
/range week|month|quarter|rolling14|year
/layout calendar|countdown|progress|hybrid
/profile standard|large-clock
/timezone Area/City
/theme list
/theme NAME
/theme custom add name #BACKGROUND #PASSED #WEEKEND #CURRENT #FUTURE
/theme custom delete name
/living none|snow|rain|stars|haze|sunset|seasonal
/rings single|double|halo
/studio
/studio calm|warm|focus|night|fresh
/studio color #RRGGBB name
/autoprofile status|on|off|save day|evening|night
/share M1|G1
/shares
/unshare NUMBER
/sync
```

`/start` creates a private Calendar Lockscreen account when the Telegram identity has
not been seen before. Repeating `/start` resumes that same account instead of creating
duplicates. Existing dashboard link codes remain supported as `/start LINK_CODE` for
legacy accounts.

`/app` opens the signed Telegram control panel. It provides a private live preview,
manual event entry, Google Calendar connection and event selection, appearance controls,
and the iPhone Shortcut installer when `PUBLIC_SHORTCUT_INSTALL_URL` is configured. The
panel verifies fresh Telegram launch data on requests, or uses the short-lived OAuth
continuation session after Google redirects back; both paths revalidate the Telegram
account mapping and never send a management token or wallpaper key to the browser. Google
authorization is opened in the external browser through a one-time fragment-only handoff,
not inside Telegram's embedded WebView.

`/status` shows the current wallpaper setup and includes one **Open wallpaper**
button for quick access. The URL stays out of the status summary so it remains easy to
scan.

`/url` deliberately returns the full wallpaper URL as plain, copyable text. Use this
version when configuring the iOS Shortcut or anywhere else that needs the raw URL.

`/view` applies one of the seven shared presets. `/range` and `/layout` then let you change those dimensions independently. `/profile` calibrates the vertical content band. `large-clock` reserves more room above while keeping content above the notification region. Preview the result on the target phone because iOS lock-screen spacing and crop/zoom behavior vary.

`/eventcount 3` shows up to three upcoming events. Choose 1–5; the default is 2.
The count is saved separately from the view, so changing presets, ranges, layouts,
themes or clock profiles does not reset it. The dashboard's **Events shown** setting
edits the same preference. Remaining events appear as `+N more`; all tracked events
still mark the calendar. Changes appear on the next wallpaper refresh.

Agenda and Minimal views have been removed. Saved accounts using either fall back
to Calendar without losing events or their wallpaper URL. The retired `minimal`
color theme also falls back to `default` and cannot be recreated as a custom theme.

`/add` creates a 15-minute draft rather than saving immediately. It accepts natural
phrases such as `Dentist tomorrow`, `Mum’s birthday 14 November`, and `Conference next
Friday`, while the exact `/add YYYY-MM-DD Event name` form remains supported. Name-only
entries offer Today, Tomorrow, Next Monday, or a compact Telegram calendar before a final
Save event confirmation.

`/edit` creates a private, 15-minute button menu from a server-side snapshot; the
callback contains only the menu token and position, never an event ID. `/edit NUMBER`
opens the current numbered event directly. Every edit starts with an immutable copy of
the original event and only changes the stored event after **Save changes**. If another
client changes or removes the event first, the save is rejected safely. The normal date
buttons and Mini App work only while an active date-selection step is open.

`/theme` and `/theme list` show all eight built-in themes in a compact visual contact
sheet and two-column selector. A Custom themes page provides the separately saved themes;
neither page silently truncates entries. The preview is a static PNG:
it shows only each theme's palette and sample calendar marks, not account, calendar,
credential, or wallpaper-key data. If Telegram cannot deliver the PNG, the bot sends
the same selector as text and buttons. No animated snow or rain is included because
the generated iPhone wallpaper is a static image. Living overlays are deterministic static
marks per fetch, not a live-weather service and do not change the native Shortcut protocol.

`/studio` opens one-tap mood buttons. Calm, Warm, Focus, Night, and Fresh each show the
actual palette before it is saved and pair it with a suitable static living overlay. The
explicit mood and custom-color forms remain available for people who prefer typed commands.

Year uses a continuous twenty-two-column dot field with event timers; older saved
Year/progress settings render the same way.

`/sync` now checks the primary calendar and other calendars currently visible in Google
Calendar. Its reply distinguishes an unconnected account, no visible calendars, an empty
one-year window, events waiting to be selected, and a ready wallpaper. A successful ready
reply shows the next three tracked events; the button opens the control panel when a
selection or reconnection is needed.

Run `npm run telegram:configure-commands` again after deploying this update to add
`/app` to Telegram's autocomplete menu. This does not alter the webhook or BotFather's
separate menu-button configuration.

`/start` stays out of autocomplete because Telegram presents it automatically when a user
opens the bot for the first time.

Custom theme names must begin with a letter and may contain lowercase letters, numbers, or hyphens. Every color must use the `#RRGGBB` format. Each account may save up to five custom themes.

## Linking and safety

- Bot commands work only in private chats.
- New Telegram-first accounts do not require a link code.
- Legacy dashboard link codes remain single-use and expire after ten minutes.
- Relinking revokes the previous Telegram identity.
- Telegram retries are handled idempotently.
- Authorization is tied to the Telegram user ID rather than a shared chat.
- Control-panel writes have short per-user rate limits and private, no-store responses.
- The date-picker Mini App validates Telegram's signed launch data on the server,
  checks its age, and matches the verified identity to the active linked draft.

Read the official [Telegram Bot API documentation](https://core.telegram.org/bots/api) for webhook details.
