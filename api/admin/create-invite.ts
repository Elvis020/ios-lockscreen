// Temporary admin endpoint to create invite codes
// DELETE THIS FILE after creating your codes!

import { createInviteCode } from '../../lib/tokenManager';

export const config = {
  runtime: 'edge',
};

export default async function handler(req: Request) {
  // Simple protection: only allow from localhost or specific secret
  const url = new URL(req.url);
  const secret = url.searchParams.get('secret');
  const adminInviteSecret = process.env.ADMIN_INVITE_SECRET;

  if (!adminInviteSecret || secret !== adminInviteSecret) {
    return new Response('Unauthorized', { status: 401 });
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const body = await req.json();
    const { code, maxUses } = body;

    if (!code) {
      return new Response(
        JSON.stringify({ error: 'Code is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    await createInviteCode(
      code,
      maxUses || 10
    );

    return new Response(
      JSON.stringify({ success: true, code, maxUses: maxUses || 10 }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Create invite error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
