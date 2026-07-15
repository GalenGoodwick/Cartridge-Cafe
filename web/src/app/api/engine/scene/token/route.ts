import { NextRequest, NextResponse } from 'next/server'
import { mayWriteScene } from '../../scene-auth'
import { mintSceneToken } from '../../scene-token'

export const dynamic = 'force-dynamic'

/** POST /api/engine/scene/token  { name }
 *  Mint a branch-scoped token for a scene. Authorized by the SAME rule that guards
 *  writing the scene (mayWriteScene): only the branch's own owner — or admin — can
 *  mint a token for it. The token binds a connected AI to this one branch, so it
 *  can never reach main or another world. Only branch names (`BASE ⑂ handle · vN`)
 *  are token-able; canonical/house worlds are not. */
export async function POST(req: NextRequest) {
  let name: string
  try {
    const body = await req.json()
    name = String(body?.name ?? '').trim()
  } catch {
    return NextResponse.json({ error: 'name is required' }, { status: 400 })
  }
  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 })
  if (!name.includes(' ⑂ ')) {
    return NextResponse.json({ error: 'only branches are token-able (a canonical world is admin-only)' }, { status: 400 })
  }
  if (!(await mayWriteScene(req, name))) {
    return NextResponse.json({ error: 'not authorized to mint a token for this branch' }, { status: 403 })
  }
  return NextResponse.json({ token: mintSceneToken(name), scene: name })
}
