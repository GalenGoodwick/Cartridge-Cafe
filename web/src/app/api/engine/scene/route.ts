import { NextRequest, NextResponse } from 'next/server'
import { mayWriteScene } from '../scene-auth'
import { saveScene, loadScene, listScenes, deleteScene, listSceneVersions, loadSceneVersion, revertScene, hydrateScene, hydrateAllScenes } from '../store'
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
    await hydrateAllScenes()   // bridge-built branches live in Neon, not this lambda's disk
    return NextResponse.json({ scenes: listScenes() })
  }

  if (action === 'versions' && name) {
    return NextResponse.json({ name, versions: listSceneVersions(name) })
  }

  // lightweight change-detection for open tabs: just the stamp, not the world
  if (action === 'stat' && name) {
    await hydrateScene(name)
    const scene = loadScene(name)
    if (!scene) return NextResponse.json({ error: 'Scene not found' }, { status: 404 })
    return NextResponse.json({ name, timestamp: (scene as { timestamp?: number }).timestamp ?? 0 })
  }

  if (action === 'version' && name) {
    const ts = parseInt(searchParams.get('timestamp') || '')
    const scene = loadSceneVersion(name, ts)
    if (!scene) return NextResponse.json({ error: 'Version not found' }, { status: 404 })
    return NextResponse.json({ scene })
  }

  if (name) {
    await hydrateScene(name)
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
    await hydrateAllScenes()   // fork/version probes must see Neon-only branches
    // authority is per-scene: only your own branches, or admin
    if (!(await mayWriteScene(req, body.name))) {
      return NextResponse.json({ error: 'Not authorized to write this world' }, { status: 403 })
    }
    if (body.action === 'save' && body.scene) {
      // FORK-ON-OVERWRITE: never clobber an existing world in place. A save onto
      // an existing name mints the NEXT version instead — so a build can't erase
      // main or a branch (the branch-create/auth hole). Pass overwrite:true only
      // for a deliberate head-update (the eye already saves to fresh names).
      let target = body.name
      if (body.overwrite !== true && loadScene(target)) {
        const bm = target.match(/^(.*⑂\s*.+?)\s*·\s*v(\d+)\s*$/)
        if (bm) {
          let n = parseInt(bm[2], 10)
          do { n++; target = `${bm[1]} · v${n}` } while (loadScene(target))   // branch → v(n+1)
        } else {
          const author = (typeof body.author === 'string' && body.author) || 'ai'
          let n = 1; const base = `${body.name} ⑂ ${author}`
          target = `${base} · v${n}`
          while (loadScene(target)) { n++; target = `${base} · v${n}` }        // canonical → a fresh branch
        }
      }
      // DEDUPE: a save-point identical to the version right before it shouldn't
      // spawn a twin. Compare content (ignoring the volatile timestamp/name) to
      // the predecessor version; if unchanged, keep the existing one.
      const fp = (s: unknown): string => {
        try { const o = { ...(s as Record<string, unknown>) }; delete o.timestamp; delete o.name; return JSON.stringify(o) }
        catch { return JSON.stringify(s) }
      }
      const vm = target.match(/^(.*?)\s*·\s*v(\d+)\s*$/)
      if (vm) {
        const k = parseInt(vm[2], 10)
        const predecessor = k > 1 ? `${vm[1]} · v${k - 1}` : vm[1].trim()   // v1's predecessor is the un-versioned name
        const prev = predecessor ? loadScene(predecessor) : undefined
        if (prev && fp(prev) === fp(body.scene)) {
          return NextResponse.json({ ok: true, savedAs: predecessor, deduped: true, forked: false })
        }
      }
      saveScene(target, body.scene)
      // first branch off a world stamps its lineage — the BASE is the immortal
      // original (king-of-the-hill promotion hangs off this record).
      const bi = target.indexOf(' ⑂ ')
      if (bi > 0) { try { await ensureLineage(target.slice(0, bi), target.slice(0, bi)) } catch { /* non-fatal */ } }
      return NextResponse.json({ ok: true, savedAs: target, forked: target !== body.name })
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
