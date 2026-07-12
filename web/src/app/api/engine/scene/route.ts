import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

/** Scenes are world-definitions with executable hooks — writes need identity.
 *  Dev keeps the frictionless local cartridge workflow; production requires
 *  a session or the engine agent token. */
async function sceneWriteAllowed(req: NextRequest): Promise<boolean> {
  if (process.env.NODE_ENV !== 'production') return true
  const authHeader = req.headers.get('authorization')
  if (authHeader?.startsWith('Bearer ')) {
    const envToken = process.env.ENGINE_AGENT_TOKEN
    if (envToken && authHeader.slice(7) === envToken) return true
  }
  const session = await getServerSession(authOptions)
  return !!session?.user?.email
}
import { saveScene, loadScene, listScenes, deleteScene } from '../store'

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
  if (!(await sceneWriteAllowed(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const body = await req.json()
    if (body.action === 'save' && body.name && body.scene) {
      saveScene(body.name, body.scene)
      return NextResponse.json({ ok: true })
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
    if (body.name) {
      const deleted = deleteScene(body.name)
      return NextResponse.json({ ok: true, deleted })
    }
    return NextResponse.json({ error: 'name required' }, { status: 400 })
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
}
