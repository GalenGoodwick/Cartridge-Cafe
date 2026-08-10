import { redirect } from 'next/navigation'

// RETIRED. This was the legacy device-code page for "connect Claude Code to a
// space" — a `uc_st_` token scoped to ONE existing space, approved here and
// polled by an external CLI. It's superseded on every axis:
//   · the account menu's ⚿ CONNECT AI (paste-a-prompt · MCP tabs) mints a player
//     key that can build ANY of your worlds and create new ones (a superset), and
//   · the DB-backed /pair flow registers an AI ↔ account together.
// Its no-code landing here just re-explained those two doors — pure duplication.
// The API route (/api/spaces/connect) is kept one release for any old external
// CLI still polling it; this page now just sends people to the one connect door.
export default function ConnectRedirect() {
  redirect('/')
}
