import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

/** Scenes are world-definitions with executable hooks — writes need identity.
 *  Dev keeps the frictionless local cartridge workflow; production requires
 *  a session or the engine agent token. */
/** Store scenes are the global cartridge namespace: canonical HOUSE worlds
 *  (CAFE, HELIOS, …) and BRANCHES (`BASE ⑂ handle · vN`). Authority:
 *   · admin engine token → anything (house worlds ship via deploy anyway),
 *   · a signed-in user → only branches under THEIR OWN handle (the same
 *     email-local-part the brancher stamps into the name). You can open and
 *     edit your own branches; you can't touch a canonical world or anyone
 *     else's branch — the tournament, not edit access, decides which wins.
 *  Dev keeps the frictionless local workflow. */
async function mayWriteScene(req: NextRequest, name: string): Promise<boolean> {
  if (process.env.NODE_ENV !== 'production') return true
  const authHeader = req.headers.get('authorization')
  if (authHeader?.startsWith('Bearer ')) {
    const envToken = process.env.ENGINE_AGENT_TOKEN
    if (envToken && authHeader.slice(7) === envToken) return true
  }
  const email = (await getServerSession(authOptions))?.user?.email
  if (!email) return false
  const bi = name.indexOf(' ⑂ ')
  if (bi < 0) return false                       // canonical/house world — admin only
  const vAt = name.lastIndexOf(' · v')
  const author = (vAt > bi ? name.slice(bi + 3, vAt) : name.slice(bi + 3)).trim()
  const myHandle = email.split('@')[0].replace(/[^a-z0-9_-]/gi, '')
  return author === myHandle                     // only your own branches
}
import { saveScene, loadScene, listScenes, deleteScene, listSceneVersions, loadSceneVersion, revertScene } from '../store'
import { ensureLineage, getLineage } from '../lineage'

export const dynamic = 'force-dynamic'

/**
 * GET /api/engine/scene?name=xxx  — load a scene
 * GET /api/engine/scene?action=list — list all scenes
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const action = searchParams.get('action')
  const name = searchParams.get('name')

  if (action === 'list') {
    return NextResponse.json({ scenes: listScenes() })
  }

  if (action === 'versions' && name) {
    return NextResponse.json({ name, versions: listSceneVersions(name) })
  }

  if (action === 'version' && name) {
    const ts = parseInt(searchParams.get('timestamp') || '')
    const scene = loadSceneVersion(name, ts)
    if (!scene) return NextResponse.json({ error: 'Version not found' }, { status: 404 })
    return NextResponse.json({ scene })
  }

  if (name) {
    const scene = loadScene(name)
    if (!scene) {
      return NextResponse.json({ error: 'Scene not found' }, { status: 404 })
    }
    return NextResponse.json({ scene })
  }

  return NextResponse.json({ error: 'name or action=list required' }, { status: 400 })
}

/**
 * POST /api/engine/scene
 * Body: { action: 'save', name: string, scene: SceneSnapshot }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    if (typeof body.name !== 'string' || !body.name) {
      return NextResponse.json({ error: 'name required' }, { status: 400 })
    }
    // authority is per-scene: only your own branches, or admin
    if (!(await mayWriteScene(req, body.name))) {
      return NextResponse.json({ error: 'Not authorized to write this world' }, { status: 403 })
    }
    if (body.action === 'save' && body.scene) {
      saveScene(body.name, body.scene)
      // first branch off a world stamps its lineage — the BASE is the immortal
      // original (king-of-the-hill promotion hangs off this record).
      const bi = body.name.indexOf(' ⑂ ')
      if (bi > 0) { try { await ensureLineage(body.name.slice(0, bi), body.name.slice(0, bi)) } catch { /* non-fatal */ } }
      return NextResponse.json({ ok: true })
    }
    if (body.action === 'revert' && body.timestamp) {
      const ok = revertScene(body.name, Number(body.timestamp))
      if (!ok) return NextResponse.json({ error: 'Version not found' }, { status: 404 })
      return NextResponse.json({ ok: true, reverted: body.name, to: Number(body.timestamp) })
    }
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
}

/**
 * DELETE /api/engine/scene
 * Body: { name: string }
 */
export async function DELETE(req: NextRequest) {
  try {
    const body = await req.json()
    if (!body.name) return NextResponse.json({ error: 'name required' }, { status: 400 })
    // the immortal original can never be deleted — by anyone, admin included.
    const base = body.name.split(' ⑂ ')[0]
    const lin = await getLineage(base)
    if (lin && lin.original === body.name) {
      return NextResponse.json({ error: 'This is the original — it can never be deleted' }, { status: 409 })
    }
    // authority: only your own branches, or admin. (Closes the old hole where the
    // DELETE path had NO auth check and any caller could remove any world.)
    if (!(await mayWriteScene(req, body.name))) {
      return NextResponse.json({ error: 'Not authorized to delete this world' }, { status: 403 })
    }
    const deleted = deleteScene(body.name)
    return NextResponse.json({ ok: true, deleted })
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
}
