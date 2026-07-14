import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { writeFile, mkdir, access } from 'fs/promises'
import path from 'path'

export const dynamic = 'force-dynamic'

const sanitize = (s: string) => s.toUpperCase().replace(/[/\\]/g, '').replace(/\.\./g, '').trim()

/** POST /api/engine/thumb — capture a level's shelf icon.
 *  Body is ONE of:
 *   - { slug, image }  — a player world: resolve its display NAME (owner/token
 *     gated) and ALWAYS (re)write /thumbs/<NAME>.jpg. Its content changes.
 *   - { scene, image } — a house world with no curated mini (e.g. HANABI):
 *     write /thumbs/<SCENE>.jpg only if it's MISSING (heal an empty icon),
 *     never clobber a curated one. Any signed-in viewer can heal.
 *  image is a JPEG data URL from the world's live canvas. */
export async function POST(req: NextRequest) {
  let body: { slug?: string; scene?: string; image?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'bad body' }, { status: 400 }) }
  const { slug, scene, image } = body
  if (!image || typeof image !== 'string' || (!slug && !scene)) {
    return NextResponse.json({ error: 'Expected { image } with { slug } or { scene }' }, { status: 400 })
  }

  const base64 = image.replace(/^data:image\/\w+;base64,/, '')
  const buffer = Buffer.from(base64, 'base64')
  if (buffer.length < 100) return NextResponse.json({ error: 'empty image' }, { status: 400 })

  const dir = path.join(process.cwd(), 'public', 'thumbs')
  const write = async (fileName: string) => {
    await mkdir(dir, { recursive: true }).catch(() => {})
    await writeFile(path.join(dir, `${fileName}.jpg`), buffer)
  }

  if (slug) {
    const space = await prisma.playerSpace.findUnique({ where: { slug }, select: { name: true, ownerId: true } })
    if (!space) return NextResponse.json({ error: 'Space not found' }, { status: 404 })
    // owner or engine token only
    const auth = req.headers.get('authorization')
    const envToken = process.env.ENGINE_AGENT_TOKEN || process.env.ANTHROPIC_API_KEY
    const tokenOk = !!envToken && auth === `Bearer ${envToken}`
    if (!tokenOk) {
      const session = await getServerSession(authOptions)
      const uid = session?.user?.id
        || (session?.user?.email
          ? (await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true } }))?.id
          : null)
      if (!uid || uid !== space.ownerId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const fileName = sanitize(space.name || slug)
    if (!fileName) return NextResponse.json({ error: 'unnamed' }, { status: 400 })
    await write(fileName)
    return NextResponse.json({ ok: true, name: fileName, size: buffer.length })
  }

  // house-scene heal — signed-in, write only when missing
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const fileName = sanitize(scene!)
  if (!fileName) return NextResponse.json({ error: 'unnamed' }, { status: 400 })
  try {
    await access(path.join(dir, `${fileName}.jpg`))
    return NextResponse.json({ ok: true, name: fileName, skipped: 'exists' })   // already has an icon
  } catch { /* missing — heal it */ }
  await write(fileName)
  return NextResponse.json({ ok: true, name: fileName, size: buffer.length, healed: true })
}
