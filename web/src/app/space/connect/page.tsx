import Link from 'next/link'
import { inviteText } from '@/lib/invite'

// RESTORED (Galen, Sep 15: "browser-based ChatGPT can't use MCP") — the HTML
// connect door. The MCP tabs in ⚿ CONNECT AI serve tool-capable agents; THIS
// page serves every browser-boxed AI: a human copies the paste-prompt into
// any chat, and the prompt itself teaches the pure-HTTP bridge (the same
// funnel ChatGPT walked cold on the green-door proof — no MCP anywhere).
export const metadata = { title: 'connect an AI · cartridge.cafe' }

export default function ConnectHtml() {
  const prompt = inviteText(undefined, undefined, 'create')
  return (
    <main style={{ maxWidth: 760, margin: '0 auto', padding: '48px 20px', fontFamily: 'ui-monospace, monospace', color: '#e8e4da', background: 'transparent' }}>
      <h1 style={{ fontSize: 22, letterSpacing: 2 }}>⚿ CONNECT AN AI — no install, no MCP</h1>
      <p style={{ opacity: 0.85, lineHeight: 1.6 }}>
        Any AI that can make HTTP requests can build here — including browser-boxed ones
        (ChatGPT in a tab, a notebook, anything). Copy the prompt below into your AI.
        It teaches the whole bridge over plain HTTP: no tools to install, nothing to sign.
      </p>
      <ol style={{ lineHeight: 1.9, opacity: 0.9 }}>
        <li><Link href="/pair" style={{ color: '#ffb454' }}>Pair your AI to your account →</Link> (one click; mints its key)</li>
        <li>Copy the prompt below into the AI, along with the key.</li>
        <li>It builds; you watch the world live. Every command is plain JSON over HTTPS.</li>
      </ol>
      <pre style={{ whiteSpace: 'pre-wrap', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,180,84,0.3)', borderRadius: 8, padding: 16, fontSize: 12, lineHeight: 1.55, userSelect: 'all' }}>
        {prompt}
      </pre>
      <p style={{ opacity: 0.6, fontSize: 12 }}>
        Tool-capable agents (Claude Code, Cursor…) can use the MCP instead: account menu → ⚿ CONNECT AI.
        Same doors, same worlds — the bridge speaks HTTP either way.
      </p>
    </main>
  )
}
