import { pathToFileURL } from 'node:url';

export interface TelegramCommand {
  command: string;
  description: string;
}

interface TelegramApiResponse<T> {
  ok: boolean;
  result?: T;
}

export const TELEGRAM_COMMANDS: TelegramCommand[] = [
  { command: 'help', description: 'Show command help and usage examples' },
  { command: 'status', description: 'Show settings, event counts, and wallpaper URL' },
  { command: 'url', description: 'Show the current wallpaper URL' },
  { command: 'add', description: 'Add an event: YYYY-MM-DD Event name' },
  { command: 'events', description: 'List manual events and their numbers' },
  {
    command: 'eventcount',
    description: 'Set events shown in every view: 1 to 5 (default 2)',
  },
  { command: 'delete', description: 'Delete an event by its /events number' },
  { command: 'view', description: 'Choose a wallpaper preset' },
  { command: 'range', description: 'Set the wallpaper time range' },
  { command: 'layout', description: 'Set the wallpaper presentation' },
  { command: 'profile', description: 'Calibrate lock-screen spacing' },
  { command: 'timezone', description: 'Set time zone: Area/City' },
  { command: 'theme', description: 'List, select, add, or delete themes' },
  { command: 'sync', description: 'Refresh cached Google Calendar events' },
];

export async function configureTelegramCommands(
  fetchImplementation: typeof fetch = fetch,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<string[]> {
  const botToken = environment.TELEGRAM_BOT_TOKEN;

  if (!botToken) {
    throw new Error('TELEGRAM_BOT_TOKEN is not configured');
  }

  validateCommands(TELEGRAM_COMMANDS);

  const scope = { type: 'all_private_chats' };

  await callTelegramApi<boolean>(
    botToken,
    'setMyCommands',
    { commands: TELEGRAM_COMMANDS, scope },
    fetchImplementation,
  );

  const registeredCommands = await callTelegramApi<TelegramCommand[]>(
    botToken,
    'getMyCommands',
    { scope },
    fetchImplementation,
  );

  if (!commandsMatch(registeredCommands, TELEGRAM_COMMANDS)) {
    throw new Error('Telegram command verification failed');
  }

  return registeredCommands.map(({ command }) => command);
}

function validateCommands(commands: TelegramCommand[]): void {
  const names = new Set<string>();

  if (commands.length > 100) {
    throw new Error('Telegram supports at most 100 bot commands');
  }

  for (const { command, description } of commands) {
    if (!/^[a-z0-9_]{1,32}$/.test(command)) {
      throw new Error(
        'Telegram command names must be lowercase and 1-32 characters long',
      );
    }

    if (description.length < 1 || description.length > 256) {
      throw new Error('Telegram command descriptions must be 1-256 characters long');
    }

    if (names.has(command)) {
      throw new Error('Telegram command names must be unique');
    }

    names.add(command);
  }
}

async function callTelegramApi<T>(
  botToken: string,
  method: string,
  body: Record<string, unknown>,
  fetchImplementation: typeof fetch,
): Promise<T> {
  let response: Response;

  try {
    response = await fetchImplementation(
      `https://api.telegram.org/bot${botToken}/${method}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    );
  } catch {
    throw new Error(`Telegram ${method} request failed`);
  }

  let payload: TelegramApiResponse<T>;

  try {
    payload = (await response.json()) as TelegramApiResponse<T>;
  } catch {
    throw new Error(`Telegram ${method} returned an invalid response`);
  }

  if (!response.ok || !payload.ok || payload.result === undefined) {
    throw new Error(`Telegram ${method} was rejected`);
  }

  return payload.result;
}

function commandsMatch(actual: TelegramCommand[], expected: TelegramCommand[]): boolean {
  return (
    actual.length === expected.length &&
    actual.every(
      (command, index) =>
        command.command === expected[index].command &&
        command.description === expected[index].description,
    )
  );
}

async function main(): Promise<void> {
  const commands = await configureTelegramCommands();

  console.log(
    `Registered ${commands.length} Telegram commands: /${commands.join(', /')}`,
  );
}

const entryPath = process.argv[1];

if (entryPath && import.meta.url === pathToFileURL(entryPath).href) {
  main().catch((error: unknown) => {
    const message =
      error instanceof Error ? error.message : 'Telegram command setup failed';

    console.error(message);
    process.exitCode = 1;
  });
}
