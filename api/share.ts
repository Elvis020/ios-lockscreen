import { getRedis } from '../lib/redis';
import { getUser } from '../lib/tokenManager';
import { nextOccurrenceOnOrAfter } from '../lib/eventTimeline';

export const config = { runtime: 'edge' };

/** Read-only bearer link. It deliberately exposes only the chosen event's public name/date. */
export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') return notFound();
  const key = new URL(req.url).searchParams.get('key');

  if (!key || !/^[0-9a-f-]{36}$/i.test(key)) return notFound();
  const mapping = await getRedis().get<{ token: string; shareId: string }>(
    `share:${key}`,
  );
  const user = mapping ? await getUser(mapping.token) : null;
  const share = user?.sharedCountdowns?.find(
    (item) => item.id === mapping?.shareId && item.key === key,
  );
  const storedEvent =
    share && user
      ? [...user.events, ...user.cachedCalEvents].find(
          (item) => item.id === share.eventId,
        )
      : null;
  const event =
    storedEvent &&
    user &&
    (user.events.some(({ id }) => id === storedEvent.id) ||
      user.selectedEventIds.includes(storedEvent.id))
      ? storedEvent
      : null;

  if (!event) return notFound();
  const today = localDate(user!.timeZone);
  const date = 'recurrence' in event ? nextOccurrenceOnOrAfter(event, today) : event.date;

  if (!date) return notFound();
  const days = civilDays(today, date);

  if (days < 0) return notFound();
  const label = days === 0 ? 'Today' : days === 1 ? '1 day' : `${days} days`;

  return new Response(
    `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Countdown</title><main><p>Countdown</p><h1>${escapeHtml(event.name)}</h1><strong>${label}</strong><p>${date}</p></main>`,
    {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'private, no-store',
      },
    },
  );
}

function notFound(): Response {
  return new Response('Not found', {
    status: 404,
    headers: { 'Cache-Control': 'private, no-store' },
  });
}

function localDate(timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .formatToParts(new Date())
    .reduce<Record<string, string>>(
      (result, part) => ({ ...result, [part.type]: part.value }),
      {},
    );

  return `${parts.year}-${parts.month}-${parts.day}`;
}

function civilDays(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000,
  );
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        character
      ] ?? character,
  );
}
