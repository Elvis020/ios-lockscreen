export const config = {
  runtime: 'edge',
};

export default function handler() {
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Calendar Lockscreen</title>
  <meta name="description" content="A calendar-aware iPhone wallpaper controlled from the web or Telegram.">
  <style>
    * {
      box-sizing: border-box;
    }

    :root {
      color-scheme: dark;
      --bg: #1C1C1C;
      --panel: #232323;
      --panel-2: #2A2A2A;
      --border: #383838;
      --text: #E5E5E5;
      --muted: #A1A1A1;
      --accent: #FF6B35;
      --danger: #FF6B6B;
    }

    body {
      margin: 0;
      min-height: 100vh;
      background: var(--bg);
      color: var(--text);
      font-family: Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      letter-spacing: -0.15px;
    }

    button,
    input,
    select {
      font: inherit;
    }

    button {
      cursor: pointer;
    }

    .shell {
      width: min(1080px, calc(100% - 32px));
      margin: 0 auto;
      padding: 48px 0 80px;
    }

    header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 24px;
      margin-bottom: 40px;
    }

    h1,
    h2,
    h3,
    p {
      margin: 0;
    }

    h1 {
      font-size: clamp(32px, 6vw, 54px);
      line-height: 1;
    }

    h2 {
      font-size: 22px;
      margin-bottom: 8px;
    }

    h3 {
      font-size: 14px;
      margin-bottom: 14px;
    }

    .eyebrow {
      color: var(--accent);
      text-transform: uppercase;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.08em;
      margin-bottom: 12px;
    }

    .muted {
      color: var(--muted);
      font-size: 14px;
      line-height: 1.5;
    }

    .grid {
      display: grid;
      grid-template-columns: minmax(0, 1.15fr) minmax(300px, 0.85fr);
      gap: 24px;
      align-items: start;
    }

    .stack {
      display: grid;
      gap: 20px;
    }

    .card {
      padding: 22px;
      border: 1px solid var(--border);
      border-radius: 12px;
      background: var(--panel);
    }

    .row {
      display: flex;
      gap: 10px;
      align-items: center;
    }

    .row + .row {
      margin-top: 10px;
    }

    .spread {
      justify-content: space-between;
    }

    input,
    select {
      width: 100%;
      min-width: 0;
      color: var(--text);
      background: var(--panel-2);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 12px 13px;
    }

    input:focus,
    select:focus {
      outline: 2px solid rgba(255, 107, 53, 0.4);
      border-color: var(--accent);
    }

    .button {
      border: 0;
      border-radius: 8px;
      padding: 12px 15px;
      color: #fff;
      background: var(--accent);
      font-weight: 700;
      white-space: nowrap;
    }

    .button.secondary {
      background: var(--panel-2);
      border: 1px solid var(--border);
      color: var(--text);
    }

    .button.danger {
      color: var(--danger);
      background: transparent;
      border: 1px solid var(--border);
    }

    .button.small {
      padding: 8px 10px;
      font-size: 13px;
    }

    .full {
      width: 100%;
    }

    .event {
      padding: 12px 0;
      border-top: 1px solid var(--border);
    }

    .event:first-child {
      border-top: 0;
    }

    .event-title {
      font-weight: 650;
    }

    .setting-help {
      margin-top: 7px;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.45;
    }

    .url {
      padding: 12px;
      border-radius: 8px;
      background: #171717;
      color: var(--accent);
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 12px;
      line-height: 1.45;
      word-break: break-all;
      margin: 14px 0;
    }

    .notice {
      display: none;
      margin-bottom: 20px;
      padding: 12px 14px;
      border: 1px solid var(--border);
      border-radius: 8px;
      color: var(--muted);
    }

    .notice.show {
      display: block;
    }

    .hidden {
      display: none !important;
    }

    .checks {
      display: grid;
      gap: 8px;
      max-height: 240px;
      overflow: auto;
      margin-top: 12px;
    }

    .check {
      display: grid;
      grid-template-columns: 18px 1fr;
      gap: 10px;
      align-items: start;
      color: var(--muted);
      font-size: 13px;
    }

    .check input {
      width: 16px;
      margin: 2px 0 0;
    }

    @media (max-width: 760px) {
      .shell {
        padding-top: 28px;
      }

      header,
      .row.mobile-stack {
        align-items: stretch;
        flex-direction: column;
      }

      .grid {
        grid-template-columns: 1fr;
      }
    }
  </style>
</head>
<body>
  <main class="shell">
    <header>
      <div>
        <div class="eyebrow">iPhone shortcut wallpaper</div>
        <h1>Calendar Lockscreen</h1>
        <p class="muted" style="margin-top: 14px; max-width: 620px;">Choose a time range, presentation, theme, and events here or through Telegram. Changes appear the next time your iOS Shortcut fetches the wallpaper.</p>
      </div>
      <button id="logoutButton" class="button danger hidden" type="button">Log out</button>
    </header>

    <div id="notice" class="notice"></div>

    <section id="authSection" class="grid">
      <div class="card">
        <h2>Create your wallpaper</h2>
        <p class="muted">Use an invite code to create a private management session and a separate read-only wallpaper URL.</p>
        <div class="row mobile-stack" style="margin-top: 20px;">
          <input id="nameInput" maxlength="50" placeholder="Your name" autocomplete="name">
          <input id="inviteInput" placeholder="Invite code" autocomplete="off">
          <button id="registerButton" class="button" type="button">Register</button>
        </div>
      </div>
      <div class="card">
        <h2>Recover a session</h2>
        <p class="muted">Paste your management token if this browser lost its saved session. This is not the wallpaper key.</p>
        <div class="row mobile-stack" style="margin-top: 20px;">
          <input id="recoveryInput" placeholder="Management token" autocomplete="off">
          <button id="recoveryButton" class="button secondary" type="button">Restore</button>
        </div>
      </div>
    </section>

    <section id="dashboardSection" class="grid hidden">
      <div class="stack">
        <div class="card">
          <h2>Manual events</h2>
          <p class="muted">Track up to seven manual and selected Google events combined.</p>
          <div class="row mobile-stack" style="margin-top: 18px;">
            <input id="eventName" maxlength="50" placeholder="Event name">
            <input id="eventDate" type="date">
            <button id="addEventButton" class="button" type="button">Add</button>
          </div>
          <div id="eventList" style="margin-top: 16px;"></div>
        </div>

        <div class="card">
          <h2>Google Calendar</h2>
          <p id="googleSummary" class="muted">Checking configuration…</p>
          <div class="row mobile-stack" style="margin-top: 16px;">
            <button id="googleConnectButton" class="button" type="button">Connect Google</button>
            <button id="googleSyncButton" class="button secondary" type="button">Sync events</button>
            <button id="saveGoogleButton" class="button secondary" type="button">Save selection</button>
          </div>
          <div id="googleEvents" class="checks"></div>
        </div>
      </div>

      <aside class="stack">
        <div class="card">
          <h2>Wallpaper settings</h2>
          <div style="margin-top: 18px;">
            <h3>Preset</h3>
            <select id="wallpaperPreset"></select>
            <p class="setting-help">Start with a composed view, then fine-tune its range and layout below.</p>
          </div>
          <div style="margin-top: 16px;">
            <h3>Time range</h3>
            <select id="timeRange"></select>
          </div>
          <div style="margin-top: 16px;">
            <h3>Presentation</h3>
            <select id="presentation"></select>
          </div>
          <div style="margin-top: 16px;">
            <h3>Lock-screen fit</h3>
            <select id="lockScreenProfile"></select>
            <p class="setting-help">Lock screens vary. Preview on your phone; Large clock reserves more space above without moving into notifications.</p>
          </div>
          <div style="margin-top: 16px;">
            <h3><label for="eventCount">Events shown</label></h3>
            <select id="eventCount" aria-describedby="eventCountHelp"></select>
            <p id="eventCountHelp" class="setting-help">Up to this many upcoming events in every view. Default: 2.</p>
          </div>
          <div style="margin-top: 16px;">
            <h3>Theme</h3>
            <select id="theme"></select>
          </div>
          <div style="margin-top: 16px;">
            <h3>IANA time zone</h3>
            <input id="timeZone" placeholder="Africa/Accra">
          </div>
          <button id="saveSettingsButton" class="button full" type="button" style="margin-top: 18px;">Save settings</button>
        </div>

        <div class="card">
          <h2>Your wallpaper</h2>
          <p class="muted">Use this read-only URL in the iOS Shortcut. It cannot edit your settings.</p>
          <div id="wallpaperUrl" class="url">Loading…</div>
          <div class="row mobile-stack">
            <button id="copyUrlButton" class="button" type="button">Copy URL</button>
            <button id="previewButton" class="button secondary" type="button">Preview</button>
          </div>
        </div>

        <div class="card">
          <h2>Recovery token</h2>
          <p class="muted">Keep this private. It can manage your account and restore access in another browser; it is not the wallpaper URL.</p>
          <div id="managementToken" class="url">Loading…</div>
          <button id="copyTokenButton" class="button secondary full" type="button">Copy management token</button>
        </div>

        <div class="card">
          <h2>Telegram</h2>
          <p id="telegramStatus" class="muted" aria-live="polite">Link the bot, then manage events, presets, layout, theme, or time zone by command.</p>
          <button id="telegramButton" class="button full" type="button" style="margin-top: 16px;">Link Telegram</button>
        </div>
      </aside>
    </section>
  </main>

  <script>
    const TOKEN_KEY = 'calendarLockscreenManagementToken';
    const LEGACY_TOKEN_KEY = 'quarterProgressToken';
    const TELEGRAM_POLL_INTERVAL_MS = 2_000;
    const TELEGRAM_POLL_TIMEOUT_MS = 60_000;

    function loadStoredToken() {
      const currentToken = localStorage.getItem(TOKEN_KEY);

      if (currentToken) {
        localStorage.removeItem(LEGACY_TOKEN_KEY);

        return currentToken;
      }

      const legacyToken = localStorage.getItem(LEGACY_TOKEN_KEY);

      if (legacyToken) {
        localStorage.setItem(TOKEN_KEY, legacyToken);
        localStorage.removeItem(LEGACY_TOKEN_KEY);
      }

      return legacyToken;
    }

    let token = loadStoredToken();
    let authSessionId = 0;
    let wallpaperUrl = '';
    let telegramLinked = false;
    let wallpaperPresets = [];
    let telegramPollTimer = null;
    let telegramPollDeadline = 0;

    const byId = (id) => document.getElementById(id);

    function isCurrentSession(sessionId, sessionToken) {
      return sessionId === authSessionId && sessionToken === token;
    }

    function authHeaders(json, requestToken) {
      const headers = { Authorization: 'Bearer ' + requestToken };

      if (json) {
        headers['Content-Type'] = 'application/json';
      }

      return headers;
    }

    async function api(path, options) {
      const requestToken = token;
      const requestSessionId = authSessionId;
      const response = await fetch(path, {
        ...options,
        headers: {
          ...authHeaders(Boolean(options && options.body), requestToken),
          ...(options && options.headers),
        },
      });
      const data = await response
        .json()
        .catch(() => ({ error: 'Unexpected server response' }));

      if (response.status === 401) {
        if (isCurrentSession(requestSessionId, requestToken)) {
          logout('Your management session is invalid. Register again or restore a saved token.');
        }

        throw new Error(data.error || 'Unauthorized');
      }

      if (!response.ok) {
        throw new Error(data.error || 'Request failed');
      }

      return data;
    }

    function showNotice(message) {
      const notice = byId('notice');

      notice.textContent = message;
      notice.classList.add('show');
    }

    function setAuthenticated(authenticated) {
      byId('authSection').classList.toggle('hidden', authenticated);
      byId('dashboardSection').classList.toggle('hidden', !authenticated);
      byId('logoutButton').classList.toggle('hidden', !authenticated);
    }

    function logout(message) {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(LEGACY_TOKEN_KEY);
      token = null;
      authSessionId += 1;
      stopTelegramStatusPolling();
      renderTelegramStatus(false);
      setAuthenticated(false);

      if (message) {
        showNotice(message);
      }
    }

    async function register() {
      try {
        const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
        const response = await fetch('/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: byId('nameInput').value,
            inviteCode: byId('inviteInput').value,
            timeZone,
          }),
        });
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || 'Registration failed');
        }

        token = data.token;
        authSessionId += 1;
        localStorage.setItem(TOKEN_KEY, token);
        setAuthenticated(true);
        await loadDashboard();
        showNotice('Registered. Copy the management token below and keep it private for recovery.');
      } catch (error) {
        showNotice(error.message);
      }
    }

    async function recover() {
      const candidate = byId('recoveryInput').value.trim();

      if (!candidate) {
        return showNotice('Enter a management token.');
      }

      token = candidate;
      authSessionId += 1;

      try {
        await api('/api/settings');
        localStorage.setItem(TOKEN_KEY, token);
        setAuthenticated(true);
        await loadDashboard();
        showNotice('Session restored.');
      } catch (error) {
        token = null;
        authSessionId += 1;
        showNotice(error.message);
      }
    }

    async function loadDashboard() {
      const dashboardToken = token;
      const dashboardSessionId = authSessionId;
      const settings = await api('/api/settings');

      if (!isCurrentSession(dashboardSessionId, dashboardToken)) {
        return;
      }

      const events = await api('/api/events');

      if (!isCurrentSession(dashboardSessionId, dashboardToken)) {
        return;
      }

      renderWallpaperOptions(settings);
      byId('timeZone').value = settings.timeZone;
      byId('theme').innerHTML = '';

      settings.themes.forEach((theme) => {
        const option = document.createElement('option');

        option.value = theme;
        option.textContent = theme;
        byId('theme').appendChild(option);
      });
      byId('theme').value = settings.theme;
      wallpaperUrl = settings.wallpaperUrl;
      byId('wallpaperUrl').textContent = wallpaperUrl;
      byId('managementToken').textContent = token;
      renderTelegramStatus(settings.telegramLinked);
      renderEvents(events.events);
      await loadGoogle();
    }

    function renderWallpaperOptions(settings) {
      const options = settings.wallpaperOptions || {
        timeRanges: ['week', 'month', 'quarter', 'rolling14', 'year'],
        presentations: ['calendar', 'countdown', 'progress', 'hybrid'],
        lockScreenProfiles: ['standard', 'large-clock'],
        presets: [],
      };

      wallpaperPresets = options.presets || [];
      populateSelect(
        'timeRange',
        options.timeRanges,
        (value) => optionLabel(value),
      );
      populateSelect(
        'presentation',
        options.presentations,
        (value) => optionLabel(value),
      );
      populateSelect(
        'lockScreenProfile',
        options.lockScreenProfiles,
        (value) => optionLabel(value),
      );
      populateSelect('eventCount', options.eventCounts || [1, 2, 3, 4, 5], (value) => String(value));

      const presetSelect = byId('wallpaperPreset');

      presetSelect.innerHTML = '';

      const customOption = document.createElement('option');

      customOption.value = 'custom';
      customOption.textContent = 'Custom selection';
      presetSelect.appendChild(customOption);

      wallpaperPresets.forEach((preset) => {
        const option = document.createElement('option');

        option.value = preset.id;
        option.textContent = preset.label;
        presetSelect.appendChild(option);
      });

      byId('timeRange').value = settings.timeRange || settings.viewMode || 'quarter';
      byId('presentation').value = settings.presentation || 'calendar';
      byId('lockScreenProfile').value = settings.lockScreenProfile || 'standard';
      byId('eventCount').value = String(settings.eventCount || 2);
      syncPresetSelection();
    }

    function populateSelect(id, values, label) {
      const select = byId(id);

      select.innerHTML = '';

      values.forEach((value) => {
        const option = document.createElement('option');

        option.value = value;
        option.textContent = label(value);
        select.appendChild(option);
      });
    }

    function optionLabel(value) {
      const labels = {
        rolling14: 'Rolling 14 days',
        'large-clock': 'Large clock',
      };

      return labels[value] || value.charAt(0).toUpperCase() + value.slice(1);
    }

    function applyPresetSelection() {
      const preset = wallpaperPresets.find(
        (candidate) => candidate.id === byId('wallpaperPreset').value,
      );

      if (!preset) {
        return;
      }

      byId('timeRange').value = preset.timeRange;
      byId('presentation').value = preset.presentation;
    }

    function syncPresetSelection() {
      const preset = wallpaperPresets.find(
        (candidate) =>
          candidate.timeRange === byId('timeRange').value &&
          candidate.presentation === byId('presentation').value,
      );

      byId('wallpaperPreset').value = preset ? preset.id : 'custom';
    }

    function renderTelegramStatus(linked) {
      const button = byId('telegramButton');

      telegramLinked = Boolean(linked);
      byId('telegramStatus').textContent = telegramLinked
        ? 'Connected. Use the bot to manage events, presets, layout, theme, or time zone. Relink only to change Telegram accounts.'
        : 'Link the bot, then manage events, presets, layout, theme, or time zone by command.';
      button.textContent = telegramLinked ? 'Relink Telegram' : 'Link Telegram';
      button.classList.toggle('secondary', telegramLinked);
    }

    async function refreshTelegramStatus() {
      const requestToken = token;
      const requestSessionId = authSessionId;

      if (!requestToken) {
        return null;
      }

      const settings = await api('/api/settings');

      if (!isCurrentSession(requestSessionId, requestToken)) {
        return null;
      }

      renderTelegramStatus(settings.telegramLinked);

      return telegramLinked;
    }

    function stopTelegramStatusPolling() {
      if (telegramPollTimer !== null) {
        clearTimeout(telegramPollTimer);
        telegramPollTimer = null;
      }
    }

    async function pollTelegramStatus() {
      const pollSessionId = authSessionId;

      if (!token || Date.now() >= telegramPollDeadline) {
        stopTelegramStatusPolling();

        return;
      }

      try {
        const linked = await refreshTelegramStatus();

        if (pollSessionId !== authSessionId || !token) {
          return;
        }

        if (linked) {
          stopTelegramStatusPolling();
          showNotice('Telegram linked. You can now manage the wallpaper from the bot.');

          return;
        }
      } catch {
        if (pollSessionId !== authSessionId || !token) {
          return;
        }
      }

      if (pollSessionId !== authSessionId || !token) {
        return;
      }

      telegramPollTimer = setTimeout(pollTelegramStatus, TELEGRAM_POLL_INTERVAL_MS);
    }

    function startTelegramStatusPolling() {
      stopTelegramStatusPolling();
      telegramPollDeadline = Date.now() + TELEGRAM_POLL_TIMEOUT_MS;
      telegramPollTimer = setTimeout(pollTelegramStatus, TELEGRAM_POLL_INTERVAL_MS);
    }

    function renderEvents(events) {
      const list = byId('eventList');

      list.innerHTML = '';

      if (!events.length) {
        list.innerHTML = '<p class="muted">No manual events yet.</p>';

        return;
      }

      events.forEach((event) => {
        const row = document.createElement('div');

        row.className = 'event row spread';

        const label = document.createElement('div');

        label.innerHTML = '<div class="event-title"></div><div class="muted"></div>';
        label.children[0].textContent = event.name;
        label.children[1].textContent = event.date;

        const button = document.createElement('button');

        button.className = 'button danger small';
        button.textContent = 'Delete';
        button.addEventListener('click', () => deleteEvent(event.id));
        row.append(label, button);
        list.appendChild(row);
      });
    }

    async function addEvent() {
      try {
        const data = await api('/api/events', {
          method: 'POST',
          body: JSON.stringify({
            name: byId('eventName').value,
            date: byId('eventDate').value,
          }),
        });

        byId('eventName').value = '';
        byId('eventDate').value = '';
        renderEvents(data.events);
        showNotice('Event added.');
      } catch (error) {
        showNotice(error.message);
      }
    }

    async function deleteEvent(id) {
      try {
        const data = await api('/api/events?id=' + encodeURIComponent(id), {
          method: 'DELETE',
        });

        renderEvents(data.events);
      } catch (error) {
        showNotice(error.message);
      }
    }

    async function saveSettings() {
      try {
        await api('/api/settings', {
          method: 'PATCH',
          body: JSON.stringify({
            timeRange: byId('timeRange').value,
            presentation: byId('presentation').value,
            lockScreenProfile: byId('lockScreenProfile').value,
            eventCount: Number(byId('eventCount').value),
            theme: byId('theme').value,
            timeZone: byId('timeZone').value.trim(),
          }),
        });

        showNotice('Settings saved. They apply on the next wallpaper fetch.');
      } catch (error) {
        showNotice(error.message);
      }
    }

    async function loadGoogle() {
      try {
        const [status, events] = await Promise.all([
          api('/api/google/status'),
          api('/api/google/events'),
        ]);

        byId('googleConnectButton').disabled = !status.configured;
        byId('googleSyncButton').disabled = !status.accounts.length;
        byId('saveGoogleButton').disabled = !events.events.length;

        if (!status.configured) {
          byId('googleSummary').textContent = 'Google OAuth is not configured on this deployment.';
        } else if (status.accounts.length) {
          byId('googleSummary').textContent = status.accounts
            .map((account) => account.email)
            .join(', ');
        } else {
          byId('googleSummary').textContent = 'Google is ready to connect.';
        }

        const selected = new Set(events.selectedEventIds);
        const container = byId('googleEvents');

        container.innerHTML = '';

        events.events.forEach((event) => {
          const label = document.createElement('label');

          label.className = 'check';

          const input = document.createElement('input');

          input.type = 'checkbox';
          input.value = event.id;
          input.checked = selected.has(event.id);
          const text = document.createElement('span');

          text.textContent = event.date + ' — ' + event.name + ' (' + event.accountEmail + ')';

          label.append(input, text);
          container.appendChild(label);
        });
      } catch (error) {
        showNotice(error.message);
      }
    }

    async function connectGoogle() {
      try {
        const data = await api('/api/google/start', { method: 'POST' });
        window.location.assign(data.authorizationUrl);
      } catch (error) {
        showNotice(error.message);
      }
    }

    async function syncGoogle() {
      try {
        const data = await api('/api/google/events', { method: 'POST' });

        await loadGoogle();
        showNotice('Synced ' + data.count + ' Google events.');
      } catch (error) {
        showNotice(error.message);
      }
    }

    async function saveGoogleSelection() {
      try {
        const selectedEventIds = Array.from(
          byId('googleEvents').querySelectorAll('input:checked'),
        ).map((input) => input.value);

        await api('/api/google/events', {
          method: 'PATCH',
          body: JSON.stringify({ selectedEventIds }),
        });

        showNotice('Google event selection saved.');
      } catch (error) {
        showNotice(error.message);
      }
    }

    async function linkTelegram() {
      const linkToken = token;
      const linkSessionId = authSessionId;

      try {
        const wasLinked = telegramLinked;
        const data = await api('/api/telegram/link', { method: 'POST' });

        if (!isCurrentSession(linkSessionId, linkToken)) {
          return;
        }

        window.open(data.linkUrl, '_blank', 'noopener,noreferrer');

        if (wasLinked) {
          showNotice('A fresh Telegram link opened. Complete it only if you want to change accounts.');
        } else {
          byId('telegramStatus').textContent = 'Waiting for Telegram to finish linking…';
          showNotice('Complete the link in Telegram, then return here.');
          startTelegramStatusPolling();
        }
      } catch (error) {
        if (isCurrentSession(linkSessionId, linkToken)) {
          showNotice(error.message);
        }
      }
    }

    function copyWallpaperUrl() {
      navigator.clipboard
        .writeText(wallpaperUrl)
        .then(() => showNotice('Wallpaper URL copied.'));
    }

    function copyManagementToken() {
      navigator.clipboard
        .writeText(token)
        .then(() => showNotice('Management token copied. Keep it private.'));
    }

    function previewWallpaper() {
      window.open(wallpaperUrl, '_blank', 'noopener,noreferrer');
    }

    byId('registerButton').addEventListener('click', register);
    byId('recoveryButton').addEventListener('click', recover);
    byId('logoutButton').addEventListener('click', () => {
      logout('Logged out from this browser.');
    });
    byId('addEventButton').addEventListener('click', addEvent);
    byId('saveSettingsButton').addEventListener('click', saveSettings);
    byId('wallpaperPreset').addEventListener('change', applyPresetSelection);
    byId('timeRange').addEventListener('change', syncPresetSelection);
    byId('presentation').addEventListener('change', syncPresetSelection);
    byId('googleConnectButton').addEventListener('click', connectGoogle);
    byId('googleSyncButton').addEventListener('click', syncGoogle);
    byId('saveGoogleButton').addEventListener('click', saveGoogleSelection);
    byId('telegramButton').addEventListener('click', linkTelegram);
    byId('copyUrlButton').addEventListener('click', copyWallpaperUrl);
    byId('copyTokenButton').addEventListener('click', copyManagementToken);
    byId('previewButton').addEventListener('click', previewWallpaper);

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && token) {
        refreshTelegramStatus().catch(() => {});
      }
    });

    const googleResult = new URLSearchParams(window.location.search).get('google');

    if (googleResult === 'connected') {
      showNotice('Google Calendar connected. Sync to load events.');
    }

    if (googleResult === 'error') {
      showNotice('Google Calendar connection failed. Check the OAuth configuration and try again.');
    }

    if (token) {
      setAuthenticated(true);
      loadDashboard().catch((error) => showNotice(error.message));
    } else {
      setAuthenticated(false);
    }
  </script>
</body>
</html>`;

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=0, must-revalidate',
    },
  });
}
