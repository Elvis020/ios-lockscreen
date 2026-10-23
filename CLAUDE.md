# Repository guidance

## Architecture

This is a TypeScript Vercel Edge application, not a native iOS app. It produces 1284×2778 wallpaper images that an iOS Shortcut fetches and applies.

- `api/wallpaper.tsx` is the image endpoint.
- `api/index.tsx` is the management dashboard.
- `lib/tokenManager.ts` owns Redis user mutations and compatibility normalization.
- `lib/periodCalculator.ts` performs timezone-aware civil-date calculations.
- `lib/wallpaperModel.ts` builds the renderer-independent view model.
- `lib/calendar/` contains the Google OAuth and Calendar provider boundary.
- `lib/telegramBot.ts` contains bot commands.

Redis is the shared truth. Keep the legacy `user:<token>` and `invite:<code>` keys compatible. New wallpaper keys use `wallpaper:<wallpaperKey> -> token` and are read-only at the HTTP boundary.

## Commands

```bash
npm install
npm run check
npx vercel dev --yes --listen 3000
```

Use `npm run format` for mechanical formatting. Do not deploy, register Telegram webhooks, or mutate live Redis while developing locally unless the user explicitly requests it.

## Runtime constraints

- Keep code compatible with the Vercel Edge runtime.
- Prefer Web Crypto and `fetch`; do not add Node-only calendar libraries.
- Public wallpaper rendering must not require Redis.
- Personalized wallpaper responses are private/no-store.
- Google refresh tokens must be encrypted before Redis persistence.
- Google OAuth state is bound to a short-lived HttpOnly browser nonce cookie and is consumed only after that binding is validated.
- Serialize every Redis read-modify-write by resource with the owner-token lock in `lib/redisLock.ts`, and use its fenced commit helper so a stale lease cannot write; never hold a user lock across Google network requests.
- Telegram commands and account linking are private-chat only and authorized by `message.from.id`.
- Settings changed by web or Telegram apply on the next wallpaper fetch; the service cannot remotely refresh iOS.

## Temporary admin endpoint

`api/admin/create-invite.ts` and its current credential are intentionally preserved. Do not modify them unless the user explicitly changes that requirement.
