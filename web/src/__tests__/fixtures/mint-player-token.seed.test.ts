import { it as vit, expect } from 'vitest'
import { writeFileSync } from 'node:fs'
import { prisma } from '@/lib/prisma'
import { mintPlayerToken } from '@/lib/player-token'
import { addGenCredits } from '@/lib/stripe'
import crypto from 'crypto'

// Gated helper (MINT_PT=1) — mints a uc_pt_ player token + grants build credits for
// the first dev-DB user, so scripts can smoke the bridge create_world door live.
const it = vit.skipIf(!process.env.MINT_PT)
const OUT = '/private/tmp/claude-501/-Users-galengoodwick/c2b6d436-7855-4b2a-9cfc-cd2b94e9d7c8/scratchpad/player-token.json'

it('mint player token + credits', async () => {
  const u = await prisma.user.findFirst({ select: { id: true } })
  expect(u).toBeTruthy()
  const { raw } = await mintPlayerToken(u!.id, 'item2 smoke', { revokeExisting: false })
  await addGenCredits(u!.id, 10, 'pt-smoke-' + crypto.randomUUID())
  writeFileSync(OUT, JSON.stringify({ token: raw, userId: u!.id }, null, 2))
  console.log('MINTED player token →', OUT)
}, 60000)
