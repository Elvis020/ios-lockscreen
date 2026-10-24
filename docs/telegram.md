# Telegram bot setup

The Telegram bot can link an existing Calendar Lockscreen account, manage events, choose presets or independent wallpaper dimensions, change themes, and refresh Google Calendar data.

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

## Commands

Register the command menu once after creating the bot:

```bash
npm run telegram:configure-commands
```

This command requires Node.js 22.18 or newer. The script reads `TELEGRAM_BOT_TOKEN` from `.env`, registers commands only for private chats, and verifies the saved list without printing the token. Telegram stores the menu, so normal deployments do not need to run this command again.

Typing `/` in the bot chat will then show autocomplete for:

```text
/help
/status
/url
/add YYYY-MM-DD Event name
/events
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
/sync
```

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
to Calendar without losing events or their wallpaper URL. The Minimal color theme
is still available. Year uses a continuous twenty-column dot field with event timers;
older saved Year/progress settings render the same way.

Run `npm run telegram:configure-commands` again after deploying this update to add
`/eventcount` to Telegram's autocomplete menu. This does not alter the webhook.

`/start` is intentionally omitted from autocomplete because it is only used by the dashboard's single-use account-link URL.

Custom theme names must begin with a letter and may contain lowercase letters, numbers, or hyphens. Every color must use the `#RRGGBB` format. Each account may save up to five custom themes.

## Linking and safety

- Bot commands work only in private chats.
- Link codes are single-use and expire after ten minutes.
- Relinking revokes the previous Telegram identity.
- Telegram retries are handled idempotently.
- Authorization is tied to the Telegram user ID rather than a shared chat.

Read the official [Telegram Bot API documentation](https://core.telegram.org/bots/api) for webhook details.
