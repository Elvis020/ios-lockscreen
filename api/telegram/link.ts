import { getManagementToken } from '../../lib/auth';
import { apiErrorResponse, jsonResponse } from '../../lib/http';
import { getRedis } from '../../lib/redis';
import { getUser } from '../../lib/tokenManager';

export const config = {
  runtime: 'edge',
};

export default async function handler(req: Request) {
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const token = getManagementToken(req);

  if (!token) {
    return jsonResponse({ error: 'Management token is required' }, 401);
  }

  try {
    if (!(await getUser(token))) {
      return jsonResponse({ error: 'Invalid management token' }, 401);
    }

    const botUsername = process.env.TELEGRAM_BOT_USERNAME;

    if (!botUsername) {
      return jsonResponse({ error: 'Telegram bot is not configured' }, 503);
    }

    const code = crypto.randomUUID().replaceAll('-', '');

    await getRedis().set(`telegram:link:${code}`, token, { ex: 600 });

    return jsonResponse({
      linkUrl: `https://t.me/${botUsername}?start=${code}`,
      expiresInSeconds: 600,
    });
  } catch (error) {
    return apiErrorResponse(error, 'Telegram link creation failed');
  }
}
