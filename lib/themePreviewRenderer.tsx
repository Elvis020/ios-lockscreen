import { ImageResponse } from '@vercel/og';
import React from 'react';
import type { WallpaperTheme } from './preferences';

const CARD_WIDTH = 413;
const CARD_HEIGHT = 190;
const COLUMNS = 2;

export function createThemePreviewImageResponse(themes: WallpaperTheme[]): ImageResponse {
  const visibleThemes = themes;
  const rows = Math.max(1, Math.ceil(visibleThemes.length / COLUMNS));
  const height = 90 + rows * 208;

  return new ImageResponse(
    <div
      style={{
        width: '900px',
        height: `${height}px`,
        display: 'flex',
        flexDirection: 'column',
        padding: '28px',
        backgroundColor: '#101010',
        color: '#E5E5E5',
        fontFamily: 'sans-serif',
      }}
    >
      <div
        style={{
          display: 'flex',
          fontSize: '28px',
          fontWeight: 700,
          marginBottom: '18px',
        }}
      >
        Choose a wallpaper theme
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '18px' }}>
        {visibleThemes.map((theme) => (
          <ThemeCard key={theme.id} theme={theme} />
        ))}
      </div>
    </div>,
    { width: 900, height },
  );
}

function ThemeCard({ theme }: { theme: WallpaperTheme }) {
  return (
    <div
      style={{
        width: `${CARD_WIDTH}px`,
        height: `${CARD_HEIGHT}px`,
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        padding: '16px',
        borderRadius: '12px',
        backgroundColor: theme.background,
        border: `2px solid ${theme.future}`,
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          color: theme.text,
          fontSize: '20px',
          fontWeight: 700,
        }}
      >
        <span>{theme.id}</span>
      </div>
      <div style={{ display: 'flex', gap: '10px', marginTop: '22px' }}>
        {[theme.passed, theme.weekend, theme.current, theme.future].map(
          (color, index) => (
            <span
              key={`${color}-${index}`}
              style={{
                width: '20px',
                height: '20px',
                borderRadius: '10px',
                backgroundColor: color,
              }}
            />
          ),
        )}
        <span
          style={{
            width: '24px',
            height: '24px',
            borderRadius: '12px',
            border: `3px solid ${theme.current}`,
          }}
        />
      </div>
      <div
        style={{
          display: 'flex',
          height: '3px',
          width: '100%',
          marginTop: '28px',
          backgroundColor: theme.future,
        }}
      >
        <span style={{ width: '58%', height: '3px', backgroundColor: theme.current }} />
      </div>
      <div
        style={{
          display: 'flex',
          color: theme.subtext,
          fontSize: '14px',
          marginTop: '14px',
        }}
      >
        passed · weekend · today · future · event
      </div>
    </div>
  );
}
