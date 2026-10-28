// Calendar Lockscreen countdown accessory. Configure by running interactively.
const KEY = 'calendar-lockscreen-countdown-endpoint-v1';
const UUID =
  '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';

function endpointFromWallpaper(input) {
  const match = input
    .trim()
    .match(new RegExp(`^(https://[a-zA-Z0-9.-]+(?::[0-9]+)?)/api/wallpaper\\?([^#]*)$`));

  if (!match) return null;
  const params = match[2].split('&');
  const keys = params.filter((part) => part.startsWith('wallpaperKey='));

  if (params.some((part) => part.split('=')[0] === 'token') || keys.length !== 1)
    return null;
  const key = keys[0].slice('wallpaperKey='.length);

  if (!new RegExp(`^${UUID}$`).test(key)) return null;

  return `${match[1]}/api/countdown?wallpaperKey=${key}`;
}

function validEndpoint(value) {
  return (
    typeof value === 'string' &&
    new RegExp(
      `^https://[a-zA-Z0-9.-]+(?::[0-9]+)?/api/countdown\\?wallpaperKey=${UUID}$`,
    ).test(value)
  );
}

function validPayload(data) {
  const keys = (value, expected) =>
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join(',') === expected.sort().join(',');
  const iso = (value) =>
    typeof value === 'string' &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value;

  if (
    !keys(data, ['version', 'generatedAt', 'refreshAfter', 'nextEvent']) ||
    data.version !== 1 ||
    !iso(data.generatedAt) ||
    !iso(data.refreshAfter)
  )
    return false;
  if (data.nextEvent === null) return true;
  const event = data.nextEvent;

  return (
    keys(event, ['name', 'date', 'targetAt', 'daysLeft', 'countdownLabel']) &&
    typeof event.name === 'string' &&
    event.name.length > 0 &&
    event.name.length <= 100 &&
    /^\d{4}-\d{2}-\d{2}$/.test(event.date) &&
    iso(event.targetAt) &&
    Number.isInteger(event.daysLeft) &&
    event.daysLeft >= 0 &&
    event.countdownLabel ===
      (event.daysLeft === 0
        ? 'Today'
        : event.daysLeft === 1
          ? 'Tomorrow'
          : `${event.daysLeft}d`)
  );
}

async function main() {
  const widget = new ListWidget();

  widget.addAccessoryWidgetBackground = true;

  if (!config.runsInWidget) {
    const alert = new Alert();

    alert.title = 'Countdown widget setup';
    alert.message = 'Paste your existing read-only wallpaper URL.';
    alert.addTextField('https://…/api/wallpaper?wallpaperKey=…');
    alert.addAction('Save');
    alert.addCancelAction('Cancel');

    if ((await alert.presentAlert()) !== -1) {
      const endpoint = endpointFromWallpaper(alert.textFieldValue(0));

      if (endpoint) Keychain.set(KEY, endpoint);
    }
  }

  try {
    const endpoint = Keychain.contains(KEY) ? Keychain.get(KEY) : null;

    if (!validEndpoint(endpoint)) {
      widget.addText('Open Scriptable to set up');
    } else {
      const request = new Request(endpoint);

      request.headers = { 'Cache-Control': 'no-cache' };
      const data = await request.loadJSON();

      if (!validPayload(data)) throw new Error('Invalid response');
      widget.refreshAfterDate = new Date(data.refreshAfter);

      if (!data.nextEvent) {
        widget.addText('No upcoming events');
      } else {
        const event = data.nextEvent;
        const target = new Date(event.targetAt);
        const remaining = target.getTime() - Date.now();

        if (!['accessoryCircular', 'accessoryInline'].includes(config.widgetFamily)) {
          widget.addText(event.name);
        }
        if (remaining > 0 && remaining <= 86400000) {
          widget.addDate(target).applyTimerStyle();
        } else {
          widget.addText(event.countdownLabel);
        }
      }
    }
  } catch {
    widget.addText('Countdown unavailable');
  }

  if (config.runsInWidget) Script.setWidget(widget);
  else await widget.presentAccessoryRectangular();
  Script.complete();
}

await main();
