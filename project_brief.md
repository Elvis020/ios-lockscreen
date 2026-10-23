# Year Progress Wallpaper API

> Historical brief: the current product supports week, month, and quarter views. See README.md for the implemented contract.

## Project Overview

A Vercel Edge Function that generates a dynamic wallpaper image showing the current year's progress as a dot grid. Each dot represents one week of the year (52 total), with filled dots indicating weeks that have passed.

## Core Functionality

### API Endpoint

```
GET /api/wallpaper
```

**Query Parameters:**

| Parameter | Type   | Default | Description                                      |
| --------- | ------ | ------- | ------------------------------------------------ |
| `week`    | number | (auto)  | Override current week (1-52), useful for testing |

**Response:**

- Content-Type: `image/png`
- Resolution: 1284 × 2778 pixels (iPhone 13 Pro Max)

### Week Calculation Logic

- Week 1 starts on the first Sunday of January
- Weeks are numbered 1-52
- Current week is calculated based on server time (or can be overridden via query param)
- Week starts on **Sunday**

## Visual Design

### Layout

- **Grid:** 13 columns × 4 rows = 52 dots
- **Positioning:** Centered on screen, positioned in the lower-middle area to avoid the notch and time display
- **Orientation:** Left-to-right, top-to-bottom (Week 1 = top-left, Week 52 = bottom-right)

### Styling (matching reference image)

- **Background:** Pure black (`#000000`)
- **Passed weeks:** Filled white/light gray dots
- **Future weeks:** Hollow dots (circle outline only)
- **Current week:** Could be highlighted (optional accent color or slightly different style)
- **Dot size:** ~20-24px diameter
- **Dot spacing:** ~8-12px gap between dots

### Safe Zones

```
┌─────────────────────────────────┐
│         NOTCH / TIME            │  ← Avoid top ~200px
│                                 │
│                                 │
│        ┌───────────────┐        │
│        │   DOT GRID    │        │
│        │   13 × 4      │        │
│        └───────────────┘        │
│                                 │
│                                 │
│       HOME INDICATOR            │  ← Avoid bottom ~100px
└─────────────────────────────────┘
```

## Tech Stack

- **Runtime:** Vercel Edge Functions
- **Image Generation:** `@vercel/og` (uses Satori under the hood) OR `sharp` + SVG
- **Language:** TypeScript
- **Framework:** Next.js API routes (or standalone edge function)

## Project Structure

```
year-progress-wallpaper/
├── api/
│   └── wallpaper.ts        # Edge function
├── lib/
│   └── weekCalculator.ts   # Week calculation logic
├── vercel.json             # Vercel config
├── package.json
├── tsconfig.json
└── README.md
```

## Implementation Notes

### Option A: Using @vercel/og (Recommended)

- Renders JSX/HTML to PNG using Satori + Resvg
- Easy to style with CSS-like properties
- Good for this use case (simple shapes)

### Option B: Using sharp + SVG

- Generate SVG string programmatically
- Convert to PNG using sharp
- More control but more verbose

### Week Calculation Function

```typescript
function getCurrentWeek(): number {
  const now = new Date();
  const startOfYear = new Date(now.getFullYear(), 0, 1);

  // Find first Sunday of the year
  const firstSunday = new Date(startOfYear);
  const dayOfWeek = firstSunday.getDay();
  if (dayOfWeek !== 0) {
    firstSunday.setDate(firstSunday.getDate() + (7 - dayOfWeek));
  }

  // If we're before the first Sunday, we're in week 0 (or week 52 of last year)
  if (now < firstSunday) {
    return 1; // Treat as week 1
  }

  const diffTime = now.getTime() - firstSunday.getTime();
  const diffWeeks = Math.floor(diffTime / (7 * 24 * 60 * 60 * 1000));

  return Math.min(diffWeeks + 1, 52);
}
```

## iOS Shortcut Integration

After deployment, create an iOS Shortcut:

1. **Get Contents of URL:** `https://your-app.vercel.app/api/wallpaper`
2. **Set Wallpaper:** Use the image from step 1, set to Lock Screen (or both)

### Automation Setup

- Create a Personal Automation
- Trigger: Time of Day → 6:00 AM → Daily
- Action: Run Shortcut → [Your wallpaper shortcut]
- Disable "Ask Before Running" (may require confirmation depending on iOS version)

## Deployment

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel

# Production deploy
vercel --prod
```

## Future Enhancements (Optional)

- [ ] Multiple device resolutions via `model` query param
- [ ] Custom color themes via query params
- [ ] "Life calendar" mode (weeks × years) with birthdate param
- [ ] Month labels or week numbers overlay
- [ ] Different dot styles (squares, rounded squares)
- [ ] Dark/light mode variants

## Reference

- **Target Device:** iPhone 13 Pro Max (1284 × 2778)
- **Aesthetic:** Dark, minimal, similar to the "Life Calendar" screenshot provided
- **Inspiration:** The uploaded reference image showing a dot grid life calendar widget
