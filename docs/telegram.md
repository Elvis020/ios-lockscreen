# Telegram bot setup

The Telegram bot can link an existing Calendar Lockscreen account, manage events, switch views, change themes, and refresh Google Calendar data.

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

```text
/status
/url
/add YYYY-MM-DD Event name
/events
/delete NUMBER
/view week|month|quarter
/timezone Area/City
/theme list
/theme NAME
/theme custom add name #BACKGROUND #PASSED #WEEKEND #CURRENT #FUTURE
/theme custom delete name
/sync
```

Custom theme names must begin with a letter and may contain lowercase letters, numbers, or hyphens. Every color must use the `#RRGGBB` format. Each account may save up to five custom themes.

## Linking and safety

- Bot commands work only in private chats.
- Link codes are single-use and expire after ten minutes.
- Relinking revokes the previous Telegram identity.
- Telegram retries are handled idempotently.
- Authorization is tied to the Telegram user ID rather than a shared chat.

Read the official [Telegram Bot API documentation](https://core.telegram.org/bots/api) for webhook details.
