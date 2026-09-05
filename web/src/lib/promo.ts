import { randomBytes } from 'crypto'
import { loadGameSlot, saveGameSlot } from '@/app/api/engine/store'
import { addGenCredits, grantEntitlement, readEntitlements } from '@/lib/stripe'

// ---- PROMO CODES (Galen, Aug 30: "a promo code I can generate and give to
// multiple people for 2 free world builds and a month of live editing").
// One code, many redeemers, one redemption per account. Same KV-slot pattern
// as entitlements/credits — no migration, works on prod at first touch.

export interface PromoCode {
  code: string
  credits: number          // build credits granted per redemption
  memberDays: number       // days of editing membership granted per redemption
  permanent?: boolean      // LIFETIME: the seat is granted untimed (forever, until revoked)
  maxUses: number | null   // null = unlimited redeemers
  uses: Array<{ userId: string; at: number }>
  createdBy: string
  at: number
  disabled?: boolean
}

const codeSlot = (code: string) => 'promo:' + code
const INDEX_SLOT = 'promo:index'

// no 0/O/1/I/L — codes get read aloud and retyped
const ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789'
const chunk = () =>
  Array.from(randomBytes(4), (b) => ALPHABET[b % ALPHABET.length]).join('')

export async function createPromoCode(opts: {
  credits?: number
  memberDays?: number
  maxUses?: number | null
  permanent?: boolean
  createdBy: string
}): Promise<PromoCode> {
  const promo: PromoCode = {
    code: `CAFE-${chunk()}-${chunk()}`,
    credits: Math.max(0, Math.floor(opts.credits ?? 2)),
    memberDays: Math.max(0, Math.floor(opts.memberDays ?? 30)),
    maxUses: opts.maxUses == null ? null : Math.max(1, Math.floor(opts.maxUses)),
    ...(opts.permanent ? { permanent: true } : {}),
    uses: [],
    createdBy: opts.createdBy,
    at: Date.now(),
  }
  await saveGameSlot(codeSlot(promo.code), promo as unknown as Record<string, unknown>)
  const idx = ((await loadGameSlot(INDEX_SLOT)) ?? {}) as { codes?: string[] }
  const codes = Array.isArray(idx.codes) ? idx.codes : []
  await saveGameSlot(INDEX_SLOT, { codes: [...codes, promo.code].slice(-200) })
  return promo
}

export async function listPromoCodes(): Promise<PromoCode[]> {
  const idx = ((await loadGameSlot(INDEX_SLOT)) ?? {}) as { codes?: string[] }
  const codes = Array.isArray(idx.codes) ? idx.codes : []
  const out: PromoCode[] = []
  for (const c of codes.slice(-50).reverse()) {
    const doc = (await loadGameSlot(codeSlot(c))) as PromoCode | undefined
    if (doc?.code) out.push(doc)
  }
  return out
}

export type RedeemResult =
  | { ok: true; credits: number; memberDays: number; memberUntil: number | null }
  | { ok: false; error: string }

export async function redeemPromoCode(userId: string, rawCode: string): Promise<RedeemResult> {
  const code = rawCode.trim().toUpperCase()
  if (!/^CAFE-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(code)) return { ok: false, error: 'that is not a cafe promo code' }
  const promo = (await loadGameSlot(codeSlot(code))) as PromoCode | undefined
  if (!promo?.code) return { ok: false, error: 'unknown code' }
  if (promo.disabled) return { ok: false, error: 'this code has been turned off' }
  const uses = Array.isArray(promo.uses) ? promo.uses : []
  if (uses.some((u) => u.userId === userId)) return { ok: false, error: 'you already redeemed this code' }
  if (promo.maxUses != null && uses.length >= promo.maxUses) return { ok: false, error: 'this code is fully used' }

  if (promo.credits > 0) await addGenCredits(userId, promo.credits, `promo:${code}`)

  let memberUntil: number | null = null
  if (promo.permanent) {
    // LIFETIME (Galen, Sep 5: "give someone permanent free. like I have") —
    // an UNTIMED editor grant: entitlementLive forever, revocable only by the
    // keeper. Upgrades any timer; idempotent per product.
    await grantEntitlement(userId, { product: 'editor', sessionId: `promo:${code}` })
  } else if (promo.memberDays > 0) {
    const ents = await readEntitlements(userId)
    const editor = ents.find((e) => e.active && (e.product === 'editor' || e.product === 'editor_pro'))
    if (editor && !editor.until) {
      // a paying (or granted-forever) member — never downgrade their seat to a timer
    } else {
      const base = editor?.until && editor.until > Date.now() ? editor.until : Date.now()
      memberUntil = base + promo.memberDays * 86400_000
      await grantEntitlement(userId, { product: 'editor', sessionId: `promo:${code}`, until: memberUntil })
    }
  }

  await saveGameSlot(codeSlot(code), {
    ...promo,
    uses: [...uses, { userId, at: Date.now() }],
  } as unknown as Record<string, unknown>)
  return { ok: true, credits: promo.credits, memberDays: promo.permanent ? -1 : promo.memberDays, memberUntil }
}
