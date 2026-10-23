// Script to create invite codes
// Usage: node --loader ts-node/esm scripts/create-invite.ts

import { createInviteCode } from '../lib/tokenManager.js';

const code = process.argv[2] || 'BETA2026';
const maxUses = parseInt(process.argv[3] || '10', 10);

console.log(`Creating invite code: ${code}`);
console.log(`Max uses: ${maxUses}`);

await createInviteCode(code, maxUses);

console.log('✅ Invite code created successfully!');
console.log(`\nShare this code with friends: ${code}`);
