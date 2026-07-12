import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { writeFileSync } from 'fs'

export const dynamic = 'force-dynamic'

const SNAPSHOT_PATH = '/tmp/engine-snapshot.png'

async function checkAuth(req: NextRequest): Promise<boolean> {
  const authHeader = req.headers.get('authorization')
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7)
    const envToken = process.env.ENGINE_AGENT_TOKEN || process.env.ANTHROPIC_API_KEY
    if (envToken && token === envToken) return true
  }
  const session = await getServerSession(authOptions)
  return !!session?.user?.id
}

export async function POST(req: NextRequest) {
  if (!(await checkAuth(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const { image } = await req.json()
    if (!image || typeof image !== 'string') {
      return NextResponse.json({ error: 'Expected { image: "data:..." }' }, { status: 400 })
    }
    const base64 = image.replace(/^data:image\/\w+;base64,/, '')
    const buffer = Buffer.from(base64, 'base64')
    writeFileSync(SNAPSHOT_PATH, buffer)
    return NextResponse.json({ ok: true, path: SNAPSHOT_PATH, size: buffer.length })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Save failed' },
      { status: 500 }
    )
  }
}
