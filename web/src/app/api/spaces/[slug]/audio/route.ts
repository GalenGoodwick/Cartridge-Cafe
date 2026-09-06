import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { readAudio, saveTrack, deleteTrack, trackUrl, AUDIO_MIMES, cleanTrackName } from '@/lib/audio-store'

export const dynamic = 'force-dynamic'

/** MUSIC/SFX uploads (Galen, Sep 5). Same premium gate as sprites — media
 *  imports ride the ◆ suite; admins pass (the keeper demos). Serving is
 *  as-public-as-the-world: anyone who can play it can hear it. */
async function mayImportAssets(ownerId: string): Promise<boolean> {
  const { hasIpControl } = await import('@/lib/stripe')
  const { isAdminUserId } = await import('@/lib/adminAuth')
  return (await hasIpControl(ownerId)) || (await isAdminUserId(ownerId))
}

async function findSpace(slug: string) {
  return prisma.playerSpace.findUnique({
    where: { slug: slug.trim().toLowerCase() },
    select: { id: true, ownerId: true, isPublic: true },
  })
}

async function sessionUserId(): Promise<string | null> {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return null
  const u = await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true } })
  return u?.id ?? null
}

/** GET ?name=x → the audio bytes (engine playback URL) · bare GET → the list */
export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const space = await findSpace(slug)
  if (!space) return NextResponse.json({ error: 'not found' }, { status: 404 })
  if (!space.isPublic) {
    const uid = await sessionUserId()
    if (uid !== space.ownerId) {
      const { isAdminUserId } = await import('@/lib/adminAuth')
      if (!uid || !(await isAdminUserId(uid))) return NextResponse.json({ error: 'not found' }, { status: 404 })
    }
  }
  const doc = await readAudio(space.id)
  const name = req.nextUrl.searchParams.get('name')
  const clean = slug.trim().toLowerCase()
  if (!name) {
    return NextResponse.json({ tracks: doc.tracks.map(t => ({ name: t.name, mime: t.mime, bytes: t.bytes, at: t.at, url: trackUrl(clean, t) })) })
  }
  const t = doc.tracks.find(x => x.name === cleanTrackName(name))
  if (!t) return NextResponse.json({ error: 'no such track' }, { status: 404 })
  if (t.url) return NextResponse.redirect(t.url, 302)   // blob rail: the CDN serves
  return new NextResponse(Buffer.from(String(t.b64 ?? ''), 'base64'), {
    headers: { 'Content-Type': t.mime, 'Cache-Control': 'public, max-age=300' },
  })
}

/** POST { name, b64, mime|ext } — upload (owner + ◆ suite / keeper) */
export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const space = await findSpace(slug)
  if (!space) return NextResponse.json({ error: 'not found' }, { status: 404 })
  const uid = await sessionUserId()
  if (!uid || uid !== space.ownerId) {
    const { isAdminUserId } = await import('@/lib/adminAuth')
    if (!uid || !(await isAdminUserId(uid))) return NextResponse.json({ error: 'only the maker uploads audio' }, { status: 403 })
  }
  if (!(await mayImportAssets(space.ownerId))) {
    return NextResponse.json({ error: 'audio uploads are a ◆ premium-suite feature — the world owner needs the IP control membership' }, { status: 402 })
  }
  const body = (await req.json().catch(() => ({}))) as { name?: string; b64?: string; mime?: string; ext?: string }
  const mime = body.mime || AUDIO_MIMES[String(body.ext ?? '').toLowerCase()] || ''
  const r = await saveTrack(space.id, String(body.name ?? ''), String(body.b64 ?? '').replace(/^data:[^,]*,/, ''), mime)
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 })
  const u = trackUrl(slug.trim().toLowerCase(), r.track)
  return NextResponse.json({ ok: true, name: r.track.name, bytes: r.track.bytes, url: u, next: `wire it: wd.sounds = { "${r.track.name}": "${u}" } for sfx, or wd.__play_music = { url: "${u}", loop: true } for music` })
}

/** DELETE { name } — owner/keeper */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const space = await findSpace(slug)
  if (!space) return NextResponse.json({ error: 'not found' }, { status: 404 })
  const uid = await sessionUserId()
  if (!uid || uid !== space.ownerId) {
    const { isAdminUserId } = await import('@/lib/adminAuth')
    if (!uid || !(await isAdminUserId(uid))) return NextResponse.json({ error: 'only the maker' }, { status: 403 })
  }
  const body = (await req.json().catch(() => ({}))) as { name?: string }
  const ok = await deleteTrack(space.id, String(body.name ?? ''))
  return NextResponse.json({ ok })
}
