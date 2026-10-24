export const config = {
  runtime: 'edge',
};

const DAY_MS = 86_400_000;

function dateAfter(date: Date, days: number): string {
  return new Date(date.getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

function buildPreviewUrl(date: Date): string {
  const events = [
    ['Dinner with Ama', dateAfter(date, 2)],
    ['Design review', dateAfter(date, 8)],
    ['Cape Town', dateAfter(date, 19)],
  ]
    .map(([name, eventDate]) => `${encodeURIComponent(name)}:${eventDate}`)
    .join(',');

  return `/api/wallpaper?preset=hybrid&theme=default&preview=ios&events=${events}`;
}

export default function handler() {
  const previewUrl = buildPreviewUrl(new Date());
  const previewAttribute = previewUrl.replaceAll('&', '&amp;');
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="theme-color" content="#1C1C1C">
  <meta name="color-scheme" content="dark">
  <title>Calendar Lockscreen — Your calendar, before you unlock</title>
  <meta name="description" content="Turn upcoming events and time progress into an iPhone Lock Screen wallpaper, controlled from Telegram.">
  <meta property="og:title" content="Calendar Lockscreen">
  <meta property="og:description" content="Your calendar, visible before you unlock.">
  <meta property="og:type" content="website">
  <style>
    *,
    *::before,
    *::after {
      box-sizing: border-box;
    }

    :root {
      color-scheme: dark;
      --color-bg: #1C1C1C;
      --color-surface: #232323;
      --color-surface-raised: #2A2A2A;
      --color-border: #383838;
      --color-border-strong: #4A4A4A;
      --color-text: #E5E5E5;
      --color-muted: #A1A1A1;
      --color-faint: #8A8A8A;
      --color-accent: #FF6B35;
      --color-accent-hover: #FF7B4A;
      --color-telegram: #82BFE8;
      --space-1: 4px;
      --space-2: 8px;
      --space-3: 12px;
      --space-4: 16px;
      --space-5: 24px;
      --space-6: 32px;
      --space-7: 48px;
      --space-8: 64px;
      --space-9: 96px;
      --radius-sm: 6px;
      --radius-md: 8px;
      --radius-lg: 12px;
      --ease-enter: cubic-bezier(0.16, 1, 0.3, 1);
      --ease-press: cubic-bezier(0.2, 0, 0, 1);
      --content-width: 1180px;
    }

    html {
      scroll-behavior: smooth;
    }

    body {
      margin: 0;
      min-width: 320px;
      min-height: 100vh;
      min-height: 100dvh;
      overflow-x: hidden;
      background: var(--color-bg);
      color: var(--color-text);
      font-family: "Avenir Next", Avenir, "SF Pro Text", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 16px;
      line-height: 1.5;
      text-rendering: optimizeLegibility;
      -webkit-font-smoothing: antialiased;
    }

    a {
      color: inherit;
      text-decoration: none;
    }

    img {
      display: block;
      max-width: 100%;
    }

    button,
    a {
      -webkit-tap-highlight-color: transparent;
    }

    .skip-link {
      position: fixed;
      z-index: 100;
      top: var(--space-3);
      left: var(--space-3);
      padding: var(--space-3) var(--space-4);
      border-radius: var(--radius-md);
      background: var(--color-text);
      color: var(--color-bg);
      transform: translateY(-160%);
      transition: transform 180ms var(--ease-enter);
    }

    .skip-link:focus {
      transform: translateY(0);
    }

    .site-header,
    main,
    .site-footer {
      width: min(var(--content-width), calc(100% - 40px));
      margin-inline: auto;
    }

    .site-header {
      display: flex;
      min-height: 80px;
      align-items: center;
      justify-content: space-between;
      padding-top: env(safe-area-inset-top);
      border-bottom: 1px solid var(--color-border);
    }

    .brand {
      display: inline-flex;
      min-height: 44px;
      align-items: center;
      gap: var(--space-3);
      font-weight: 650;
    }

    .brand-mark {
      display: grid;
      width: 28px;
      height: 28px;
      grid-template-columns: repeat(3, 5px);
      grid-template-rows: repeat(3, 5px);
      place-content: center;
      gap: 3px;
      border: 1px solid var(--color-border-strong);
      border-radius: var(--radius-md);
    }

    .brand-mark span {
      width: 5px;
      height: 5px;
      border-radius: 50%;
      background: var(--color-faint);
    }

    .brand-mark span:nth-child(-n + 4) {
      background: var(--color-text);
    }

    .brand-mark span:nth-child(5) {
      background: var(--color-accent);
    }

    .nav-link {
      display: inline-flex;
      min-height: 44px;
      align-items: center;
      color: var(--color-muted);
      font-size: 14px;
      font-weight: 600;
      transition: color 140ms var(--ease-press);
    }

    .nav-link:hover {
      color: var(--color-text);
    }

    .hero {
      display: grid;
      min-height: min(800px, calc(100dvh - 80px));
      grid-template-columns: minmax(0, 1.05fr) minmax(340px, 0.95fr);
      align-items: center;
      gap: clamp(48px, 8vw, 112px);
      padding-block: clamp(64px, 10vw, 120px);
    }

    .hero-copy {
      max-width: 670px;
      animation: enter-copy 420ms var(--ease-enter) both;
    }

    .eyebrow {
      margin: 0 0 var(--space-5);
      color: var(--color-accent);
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }

    h1,
    h2,
    h3,
    p {
      margin-top: 0;
    }

    h1 {
      max-width: 720px;
      margin-bottom: var(--space-5);
      font-family: "Avenir Next", Avenir, "SF Pro Display", -apple-system, sans-serif;
      font-size: clamp(48px, 7vw, 88px);
      font-weight: 500;
      letter-spacing: -0.035em;
      line-height: 0.98;
      text-wrap: balance;
    }

    .hero-lede {
      max-width: 590px;
      margin-bottom: var(--space-6);
      color: var(--color-muted);
      font-size: clamp(18px, 2vw, 21px);
      line-height: 1.55;
    }

    .hero-actions {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-5);
    }

    .button {
      display: inline-flex;
      min-height: 48px;
      align-items: center;
      justify-content: center;
      gap: var(--space-2);
      padding: 0 20px;
      border: 1px solid var(--color-accent);
      border-radius: var(--radius-md);
      background: var(--color-accent);
      color: #161616;
      font-size: 15px;
      font-weight: 750;
      transition:
        transform 140ms var(--ease-press),
        background 140ms var(--ease-press),
        border-color 140ms var(--ease-press);
    }

    .button svg {
      width: auto;
      height: 1cap;
      flex: 0 0 auto;
    }

    .button:hover {
      border-color: var(--color-accent-hover);
      background: var(--color-accent-hover);
      transform: translateY(-1px);
    }

    .button:active {
      transform: translateY(1px);
    }

    .text-link {
      display: inline-flex;
      min-height: 44px;
      align-items: center;
      color: var(--color-text);
      font-size: 14px;
      font-weight: 600;
      text-decoration: underline;
      text-decoration-color: var(--color-border-strong);
      text-underline-offset: 5px;
      transition: text-decoration-color 140ms var(--ease-press);
    }

    .text-link:hover {
      text-decoration-color: var(--color-accent);
    }

    .beta-note {
      margin: var(--space-4) 0 0;
      color: var(--color-faint);
      font-size: 13px;
    }

    .hero-visual {
      position: relative;
      display: grid;
      justify-items: center;
      animation: enter-phone 520ms 80ms var(--ease-enter) both;
    }

    .phone-frame {
      position: relative;
      width: min(100%, 368px);
      aspect-ratio: 1284 / 2778;
      overflow: hidden;
      border: 1px solid #515151;
      border-radius: 52px;
      background: #111;
      box-shadow:
        0 32px 72px rgba(0, 0, 0, 0.42),
        inset 0 0 0 7px #111;
      transform: rotate(1.2deg);
      transition: transform 350ms var(--ease-enter);
    }

    .phone-frame:hover {
      transform: rotate(0deg) translateY(-4px);
    }

    .phone-frame img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }

    .phone-caption {
      display: flex;
      width: min(100%, 368px);
      justify-content: space-between;
      gap: var(--space-4);
      margin-top: var(--space-4);
      color: var(--color-faint);
      font-size: 12px;
    }

    .phone-caption strong {
      color: var(--color-muted);
      font-weight: 600;
    }

    .proof-strip {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      border-block: 1px solid var(--color-border);
    }

    .proof-item {
      min-width: 0;
      padding: var(--space-5) var(--space-6);
      color: var(--color-muted);
      font-size: 14px;
      text-align: center;
    }

    .proof-item + .proof-item {
      border-left: 1px solid var(--color-border);
    }

    .proof-item strong {
      display: block;
      margin-bottom: var(--space-1);
      color: var(--color-text);
      font-size: 15px;
      font-weight: 650;
    }

    .section {
      padding-block: var(--space-9);
      border-bottom: 1px solid var(--color-border);
    }

    .section-heading {
      display: grid;
      grid-template-columns: minmax(0, 0.75fr) minmax(320px, 1fr);
      gap: clamp(32px, 8vw, 112px);
      align-items: end;
      margin-bottom: var(--space-8);
    }

    h2 {
      margin-bottom: 0;
      font-size: clamp(34px, 5vw, 56px);
      font-weight: 500;
      letter-spacing: -0.025em;
      line-height: 1.05;
      text-wrap: balance;
    }

    .section-heading p {
      margin-bottom: 0;
      color: var(--color-muted);
      font-size: 17px;
      line-height: 1.6;
    }

    .steps {
      margin: 0;
      padding: 0;
      border-top: 1px solid var(--color-border);
      list-style: none;
      counter-reset: setup-step;
    }

    .step {
      display: grid;
      grid-template-columns: 64px minmax(180px, 0.7fr) minmax(280px, 1fr);
      gap: var(--space-5);
      align-items: baseline;
      padding-block: var(--space-6);
      border-bottom: 1px solid var(--color-border);
      counter-increment: setup-step;
    }

    .step::before {
      color: var(--color-accent);
      content: "0" counter(setup-step);
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 0.08em;
    }

    .step h3 {
      margin-bottom: 0;
      font-size: 21px;
      font-weight: 600;
    }

    .step p {
      margin-bottom: 0;
      color: var(--color-muted);
      line-height: 1.6;
    }

    .telegram-section {
      display: grid;
      grid-template-columns: minmax(0, 0.92fr) minmax(360px, 1.08fr);
      gap: clamp(48px, 9vw, 120px);
      align-items: center;
    }

    .telegram-copy h2 {
      margin-bottom: var(--space-5);
    }

    .telegram-copy > p {
      max-width: 540px;
      margin-bottom: var(--space-6);
      color: var(--color-muted);
      font-size: 17px;
      line-height: 1.65;
    }

    .telegram-label {
      display: inline-flex;
      align-items: center;
      gap: var(--space-2);
      margin-bottom: var(--space-5);
      color: var(--color-telegram);
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 0.07em;
      text-transform: uppercase;
    }

    .telegram-label::before {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: var(--color-telegram);
      content: "";
    }

    .chat-panel {
      padding: var(--space-5);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-lg);
      background: var(--color-surface);
      box-shadow: 0 28px 64px rgba(0, 0, 0, 0.22);
    }

    .chat-header {
      display: flex;
      align-items: center;
      gap: var(--space-3);
      padding-bottom: var(--space-5);
      border-bottom: 1px solid var(--color-border);
    }

    .chat-avatar {
      display: grid;
      width: 40px;
      height: 40px;
      place-items: center;
      border-radius: 50%;
      background: var(--color-telegram);
      color: #17212B;
      font-size: 13px;
      font-weight: 800;
    }

    .chat-title {
      font-size: 15px;
      font-weight: 650;
    }

    .chat-status {
      color: var(--color-muted);
      font-size: 12px;
    }

    .command-list {
      display: grid;
      gap: var(--space-4);
      margin: var(--space-5) 0 0;
      padding: 0;
      list-style: none;
    }

    .command {
      display: grid;
      grid-template-columns: minmax(150px, auto) 1fr;
      gap: var(--space-4);
      align-items: center;
      padding: var(--space-4);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-md);
      background: var(--color-surface-raised);
      transition:
        border-color 150ms var(--ease-press),
        transform 150ms var(--ease-press);
    }

    .command:hover {
      border-color: var(--color-border-strong);
      transform: translateX(3px);
    }

    .command code {
      color: var(--color-text);
      font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
      font-size: 13px;
      white-space: nowrap;
    }

    .command span {
      color: var(--color-muted);
      font-size: 13px;
    }

    .security-note {
      display: flex;
      gap: var(--space-3);
      align-items: flex-start;
      margin-top: var(--space-5);
      color: var(--color-faint);
      font-size: 13px;
      line-height: 1.55;
    }

    .security-note svg {
      width: auto;
      height: 1cap;
      flex: 0 0 auto;
      margin-top: 0.25em;
    }

    .final-cta {
      display: grid;
      min-height: 440px;
      place-items: center;
      padding-block: var(--space-9);
      text-align: center;
    }

    .final-cta-inner {
      max-width: 760px;
    }

    .final-cta h2 {
      margin-bottom: var(--space-5);
    }

    .final-cta p {
      max-width: 560px;
      margin: 0 auto var(--space-6);
      color: var(--color-muted);
      font-size: 17px;
    }

    .site-footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-5);
      padding-block: var(--space-6) calc(var(--space-6) + env(safe-area-inset-bottom));
      border-top: 1px solid var(--color-border);
      color: var(--color-faint);
      font-size: 13px;
    }

    .footer-links {
      display: flex;
      gap: var(--space-5);
    }

    .footer-links a:hover {
      color: var(--color-text);
    }

    a:focus-visible {
      outline: 2px solid var(--color-accent);
      outline-offset: 4px;
    }

    @keyframes enter-copy {
      from {
        opacity: 0;
        transform: translateY(18px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    @keyframes enter-phone {
      from {
        opacity: 0;
        transform: translateY(24px) scale(0.985);
      }
      to {
        opacity: 1;
        transform: translateY(0) scale(1);
      }
    }

    @media (max-width: 860px) {
      .hero {
        min-height: auto;
        grid-template-columns: 1fr;
        padding-block: var(--space-8);
      }

      .hero-copy {
        max-width: 720px;
      }

      .hero-visual {
        justify-items: start;
      }

      .phone-frame,
      .phone-caption {
        width: min(100%, 332px);
      }

      .section-heading,
      .telegram-section {
        grid-template-columns: 1fr;
      }

      .section-heading {
        gap: var(--space-5);
      }
    }

    @media (max-width: 620px) {
      .site-header,
      main,
      .site-footer {
        width: min(var(--content-width), calc(100% - 32px));
      }

      .site-header {
        min-height: 72px;
      }

      .brand-name {
        font-size: 14px;
      }

      h1 {
        font-size: clamp(44px, 15vw, 64px);
      }

      .hero-actions {
        align-items: flex-start;
        flex-direction: column;
        gap: var(--space-3);
      }

      .button {
        width: 100%;
      }

      .hero-visual {
        justify-items: center;
      }

      .proof-strip {
        grid-template-columns: 1fr;
      }

      .proof-item {
        text-align: left;
      }

      .proof-item + .proof-item {
        border-top: 1px solid var(--color-border);
        border-left: 0;
      }

      .section {
        padding-block: var(--space-8);
      }

      .step {
        grid-template-columns: 44px 1fr;
      }

      .step p {
        grid-column: 2;
      }

      .telegram-section {
        gap: var(--space-7);
      }

      .chat-panel {
        padding: var(--space-4);
      }

      .command {
        grid-template-columns: 1fr;
        gap: var(--space-1);
      }

      .command code {
        overflow-wrap: anywhere;
        white-space: normal;
      }

      .site-footer {
        align-items: flex-start;
        flex-direction: column;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      html {
        scroll-behavior: auto;
      }

      *,
      *::before,
      *::after {
        animation-duration: 0.01ms !important;
        animation-iteration-count: 1 !important;
        scroll-behavior: auto !important;
        transition-duration: 0.01ms !important;
      }
    }
  </style>
</head>
<body>
  <a class="skip-link" href="#main">Skip to content</a>
  <header class="site-header">
    <a class="brand" href="/" aria-label="Calendar Lockscreen home">
      <span class="brand-mark" aria-hidden="true">
        <span></span><span></span><span></span>
        <span></span><span></span><span></span>
        <span></span><span></span><span></span>
      </span>
      <span class="brand-name">Calendar Lockscreen</span>
    </a>
    <a class="nav-link" href="/app">Open dashboard</a>
  </header>

  <main id="main">
    <section class="hero" aria-labelledby="hero-title">
      <div class="hero-copy">
        <p class="eyebrow">Calendar, meet Lock Screen</p>
        <h1 id="hero-title">Your calendar, visible before you unlock.</h1>
        <p class="hero-lede">
          Turn upcoming events and time progress into an iPhone wallpaper. Make changes in the dashboard or Telegram; your Shortcut fetches the latest version.
        </p>
        <div class="hero-actions">
          <a class="button" href="/app">
            Start your setup
            <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M3 8h9M9 4l4 4-4 4" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </a>
          <a class="text-link" href="${previewAttribute}" target="_blank" rel="noreferrer">Preview the wallpaper</a>
        </div>
        <p class="beta-note">Invite code required during beta · iPhone · Telegram required</p>
      </div>

      <div class="hero-visual">
        <div class="phone-frame">
          <img src="${previewAttribute}" width="1284" height="2778" alt="Simulated iPhone Lock Screen preview showing a month dot grid and upcoming events" fetchpriority="high">
        </div>
        <div class="phone-caption" aria-hidden="true">
          <strong>Simulated Lock Screen</strong>
          <span>Generated live</span>
        </div>
      </div>
    </section>

    <div class="proof-strip" aria-label="Product qualities">
      <div class="proof-item"><strong>Glanceable</strong>Time and events in one quiet view.</div>
      <div class="proof-item"><strong>Personal</strong>Themes, layouts, rings, and focus.</div>
      <div class="proof-item"><strong>Read-only delivery</strong>Your wallpaper URL cannot manage the account.</div>
    </div>

    <section class="section" aria-labelledby="how-title">
      <div class="section-heading">
        <h2 id="how-title">Set it once. Shape it as life changes.</h2>
        <p>
          The website handles private setup. Telegram becomes the everyday remote. Your iOS Shortcut handles the final handoff to the Lock Screen.
        </p>
      </div>
      <ol class="steps">
        <li class="step">
          <h3>Create or restore</h3>
          <p>Use an invite to create your account, or restore one with its private management token.</p>
        </li>
        <li class="step">
          <h3>Make it yours</h3>
          <p>Choose the time range, layout, theme, events, and the amount of detail that belongs on your screen.</p>
        </li>
        <li class="step">
          <h3>Refresh from iPhone</h3>
          <p>Give Shortcuts the read-only wallpaper URL. One tap installs the latest image; a personal automation can refresh it daily.</p>
        </li>
      </ol>
    </section>

    <section class="section telegram-section" aria-labelledby="telegram-title">
      <div class="telegram-copy">
        <span class="telegram-label">Telegram control</span>
        <h2 id="telegram-title">Make changes from the chat you already open.</h2>
        <p>
          Add an event, change the layout, or switch the entire mood without returning to a settings maze. The next wallpaper refresh carries the change to your phone.
        </p>
        <a class="button" href="/app">
          Connect from dashboard
          <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M3 8h9M9 4l4 4-4 4" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </a>
        <p class="security-note">
          <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M5.5 7V5.25a2.5 2.5 0 0 1 5 0V7M4 7h8v6H4V7Z" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          Linking begins inside your authenticated dashboard. The Telegram link is single-use and expires after ten minutes.
        </p>
      </div>

      <div class="chat-panel" aria-label="Example Telegram commands">
        <div class="chat-header">
          <div class="chat-avatar" aria-hidden="true">CL</div>
          <div>
            <div class="chat-title">Calendar Lockscreen</div>
            <div class="chat-status">Your wallpaper is up to date</div>
          </div>
        </div>
        <ul class="command-list">
          <li class="command">
            <code>/add Design review next Friday</code>
            <span>Add an event in one message.</span>
          </li>
          <li class="command">
            <code>/view hybrid</code>
            <span>See the month and what is next.</span>
          </li>
          <li class="command">
            <code>/theme midnight</code>
            <span>Change the palette everywhere.</span>
          </li>
          <li class="command">
            <code>/living rain</code>
            <span>Add a restrained static atmosphere.</span>
          </li>
        </ul>
      </div>
    </section>

    <section class="final-cta" aria-labelledby="final-title">
      <div class="final-cta-inner">
        <p class="eyebrow">Built for the glance</p>
        <h2 id="final-title">Know what is coming without opening another app.</h2>
        <p>Start with the invite-only beta. Your dashboard will guide the private account and Telegram connection.</p>
        <a class="button" href="/app">
          Open the dashboard
          <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M3 8h9M9 4l4 4-4 4" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </a>
      </div>
    </section>
  </main>

  <footer class="site-footer">
    <span>Calendar Lockscreen</span>
    <div class="footer-links">
      <a href="/app">Dashboard</a>
      <a href="${previewAttribute}" target="_blank" rel="noreferrer">Live preview</a>
    </div>
  </footer>
</body>
</html>`;

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=0, must-revalidate',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
    },
  });
}
