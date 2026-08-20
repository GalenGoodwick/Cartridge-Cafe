import { NextResponse } from 'next/server'

// The guest door is CLOSED (Aug 2026): no brewing without an account.
// Kept as a 410 responder (not a 404) so stale clients — cached site JS and
// older MCP packages that still call the guest mint — get a legible answer
// instead of silence.
const GONE = {
  ok: false,
  error: 'guest access removed — sign in to brew',
  hint: 'Create an account at https://cartridge.cafe/auth/signin (Google or GitHub). AIs: run connect_account / pair at https://cartridge.cafe/pair.',
}

export async function POST() {
  return NextResponse.json(GONE, { status: 410 })
}

export async function GET() {
  return NextResponse.json(GONE, { status: 410 })
}
