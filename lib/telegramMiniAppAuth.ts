const MAX_INIT_DATA_LENGTH = 4096;
const MAX_AGE_MS = 10 * 60 * 1000;
const MAX_FUTURE_SKEW_MS = 60 * 1000;

export interface VerifiedTelegramMiniAppUser {
  userId: string;
}

export async function verifyTelegramInitData(
  initData: string,
  now = Date.now(),
  botToken = process.env.TELEGRAM_BOT_TOKEN,
): Promise<VerifiedTelegramMiniAppUser | null> {
  if (!botToken || !initData || initData.length > MAX_INIT_DATA_LENGTH) {
    return null;
  }

  const params = new URLSearchParams(initData);

  if (
    params.getAll('hash').length !== 1 ||
    params.getAll('auth_date').length !== 1 ||
    params.getAll('user').length !== 1
  ) {
    return null;
  }

  const hash = params.get('hash');
  const authDateValue = params.get('auth_date');
  const userValue = params.get('user');

  if (
    !hash ||
    !/^[a-f0-9]{64}$/i.test(hash) ||
    !authDateValue ||
    !/^\d{1,12}$/.test(authDateValue) ||
    !userValue
  ) {
    return null;
  }

  const authDateMs = Number(authDateValue) * 1000;

  if (
    !Number.isSafeInteger(authDateMs) ||
    authDateMs < now - MAX_AGE_MS ||
    authDateMs > now + MAX_FUTURE_SKEW_MS
  ) {
    return null;
  }

  let user: { id?: unknown };

  try {
    user = JSON.parse(userValue) as { id?: unknown };
  } catch {
    return null;
  }

  if (typeof user.id !== 'number' || !Number.isSafeInteger(user.id) || user.id <= 0) {
    return null;
  }

  const dataCheckString = [...params.entries()]
    .filter(([key]) => key !== 'hash')
    .map(([key, value]) => `${key}=${value}`)
    .sort()
    .join('\n');
  const encoder = new TextEncoder();
  const webAppDataKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode('WebAppData'),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const secretKeyBytes = await crypto.subtle.sign(
    'HMAC',
    webAppDataKey,
    encoder.encode(botToken),
  );
  const verificationKey = await crypto.subtle.importKey(
    'raw',
    secretKeyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );

  const verified = await crypto.subtle.verify(
    'HMAC',
    verificationKey,
    hexToBytes(hash).buffer as ArrayBuffer,
    encoder.encode(dataCheckString),
  );

  return verified ? { userId: String(user.id) } : null;
}

function hexToBytes(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length / 2);

  for (let index = 0; index < value.length; index += 2) {
    bytes[index / 2] = Number.parseInt(value.slice(index, index + 2), 16);
  }

  return bytes;
}
