export function getManagementToken(req: Request): string | null {
  const authorization = req.headers.get('Authorization');

  if (authorization?.startsWith('Bearer ')) {
    const token = authorization.slice('Bearer '.length).trim();

    return token || null;
  }

  return new URL(req.url).searchParams.get('token');
}
