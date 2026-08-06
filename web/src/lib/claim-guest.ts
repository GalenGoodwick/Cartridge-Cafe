import { prisma } from '@/lib/prisma'

/** The one deed-transfer: move every world (and, best-effort, every branch) a
 *  guest brewed onto a real account, then retire the guest shell. Used by BOTH
 *  claim paths — the browser-cookie claim (/api/spaces/claim) and AI pairing
 *  (/api/ai/pair), whose guest lives in the MCP's cookie jar, not the browser's.
 *  Refuses anything that isn't a real @guest user; idempotent. */
export async function claimGuestEstate(
  guestId: string,
  me: { id: string; email: string },
): Promise<number> {
  if (!guestId || guestId === me.id) return 0

  const guest = await prisma.user.findUnique({ where: { id: guestId }, select: { email: true } })
  if (!guest?.email.endsWith('@guest.cartridge.cafe')) return 0

  const moved = await prisma.playerSpace.updateMany({
    where: { ownerId: guestId },
    data: { ownerId: me.id },
  })

  // branches follow too: rename "BASE ⑂ guesthandle …" to the new handle
  let branchesMoved = 0
  try {
    const { handleOf } = await import('@/lib/guest-quota')
    const { hydrateAllScenes, listScenes, loadScene, saveScene, deleteScene } = await import('@/app/api/engine/store')
    const gh = handleOf(guest.email)
    const nh = handleOf(me.email)
    if (gh && nh && gh !== nh) {
      await hydrateAllScenes()
      const existing = new Set(listScenes())
      for (const n of listScenes()) {
        const f = n.indexOf(' ⑂ ')
        if (f < 0 || n.slice(f + 3).split(' · ')[0].trim() !== gh) continue
        const scene = loadScene(n)
        if (!scene) continue
        let renamed = n.slice(0, f + 3) + nh + n.slice(f + 3 + gh.length)
        // NEVER clobber an existing branch of the new handle (saveScene would
        // overwrite it — data loss). De-dupe by inserting a short suffix before
        // the trailing version so both the claimed and the existing branch live.
        if (existing.has(renamed) && renamed !== n) {
          const vm = renamed.match(/^(.*?)( · v\d+)?$/)
          const stem = vm?.[1] ?? renamed, ver = vm?.[2] ?? ''
          let dedup = renamed
          for (let k = 2; existing.has(dedup); k++) dedup = `${stem} (${k})${ver}`
          renamed = dedup
        }
        saveScene(renamed, { ...scene, name: renamed })
        existing.add(renamed)
        deleteScene(n)
        branchesMoved++
      }
    }
  } catch { /* branch carry is best-effort; worlds already moved */ }

  // retire the guest shell — its worlds now live under a signed deed
  await prisma.user.update({ where: { id: guestId }, data: { status: 'DELETED', deletedAt: new Date() } }).catch(() => {})

  return moved.count + branchesMoved
}
