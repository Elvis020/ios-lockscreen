# Calendar Lockscreen

Calendar Lockscreen is a Vercel Edge application that renders an iPhone wallpaper for the current week, month, or quarter. An iOS Shortcut fetches the image and applies it; the web dashboard and Telegram bot edit the shared Redis-backed settings used on the next fetch.

The service cannot force an iPhone wallpaper refresh. Run the Shortcut manually or through an iOS automation after changing settings.

## Product surfaces

- `/` rewrites to `/api`, the registration and management dashboard.
- `/api/wallpaper` renders the public fallback wallpaper.
- `/api/wallpaper?wallpaperKey=...` is the preferred read-only personalized URL for iOS.
- Legacy `/api/wallpaper?token=...` URLs continue to work.
- Management APIs prefer `Authorization: Bearer <management-token>` and retain query-token compatibility for existing clients.
- Redis is the shared truth for settings, events, Telegram links, OAuth state, and cached Google events. Per-user mutations use short-lived owner locks plus atomic commit-time lease fencing, so an expired lock holder cannot overwrite a newer web, Telegram, or Google update.

Existing user records normalize safely to quarter view, the default theme, and `UTC`. A read-only wallpaper key is created when a legacy user next accesses a management API. Existing Redis keys are not renamed.

## Local setup

```bash
npm install
cp .env.example .env.local
npx vercel dev --yes --listen 3000
```

Required Redis values:

```text
UPSTASH_REDIS_REST_URL
UPSTASH_REDIS_REST_TOKEN
```

The public wallpaper works without Redis. Personalized routes return a diagnosable `503` if Redis is unavailable or not configured.

## Verification

```bash
npm run check
```

This runs Prettier checking, ESLint (including logical blank-line rules), TypeScript, and Vitest.

## Telegram setup

Create a bot with BotFather, then configure:

```text
TELEGRAM_BOT_TOKEN
TELEGRAM_BOT_USERNAME
TELEGRAM_WEBHOOK_SECRET
```

After deploying, register the webhook yourself using the deployed HTTPS URL and the same secret token. This repository does not register or alter webhooks automatically.

The bot accepts linking and commands only from private chats and authorizes the Telegram user ID, not a shared group chat. Link codes are single-use. Relinking revokes the prior Telegram identity and clears stale account links. Mutating commands write their update-completion marker in the same Redis transaction as the user change, making Telegram retries idempotent.

Supported commands:

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

Custom theme names must start with a letter and contain only lowercase letters, digits, or hyphens. All five colors must use `#RRGGBB`. Each user may save up to five custom themes.

## Google Calendar setup

Create a Google OAuth web application with the Calendar API enabled and configure:

```text
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
GOOGLE_REDIRECT_URI=https://your-domain.example/api/google/callback
GOOGLE_OAUTH_ENCRYPTION_KEY
```

`GOOGLE_OAUTH_ENCRYPTION_KEY` must be a base64url-encoded 32-byte AES-GCM key. Google refresh tokens are encrypted before they are written to Redis. OAuth state and Telegram link codes expire after ten minutes. Google OAuth also uses a short-lived secure, HttpOnly, SameSite browser cookie, so a callback cannot consume state created in another browser session.

The integration uses direct OAuth and Calendar REST calls. It requests read-only calendar access, follows paginated event results, caches normalized events in Redis, and renders only the events selected in the dashboard. `/sync` refreshes that cache. If the connected-account credentials change during a sync, the stale result is rejected and the previous cache is retained. Google push/watch channels are intentionally out of scope.

Without valid Google credentials and a registered redirect URI, the dashboard remains usable but disables live Google connection. The OAuth URL, callback, encryption boundary, caching, and selection behavior can be tested with mocks; live consent and token refresh require real credentials.

## Data model and security boundary

- The management token can change settings and must remain private.
- The wallpaper key only maps to a user for image reads.
- The authenticated dashboard shows a copyable management token and offers logout plus management-token recovery. It migrates the legacy `quarterProgressToken` browser key to `calendarLockscreenManagementToken`.
- Manual events are structured records with stable IDs.
- User preferences include theme, view mode, and an IANA time zone.
- Cache headers are set after `ImageResponse` construction: personalized images are private/no-store; public images may use a one-hour CDN cache.

The temporary invite-admin endpoint is deliberately unchanged by this feature.
