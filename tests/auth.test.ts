import { describe, expect, it } from 'vitest';
import { getManagementToken } from '../lib/auth';

describe('getManagementToken', () => {
  it('prefers bearer auth while retaining query compatibility', () => {
    const bearerRequest = new Request('https://example.com/api/events?token=legacy', {
      headers: { Authorization: 'Bearer management' },
    });
    const legacyRequest = new Request('https://example.com/api/events?token=legacy');

    expect(getManagementToken(bearerRequest)).toBe('management');
    expect(getManagementToken(legacyRequest)).toBe('legacy');
  });
});
