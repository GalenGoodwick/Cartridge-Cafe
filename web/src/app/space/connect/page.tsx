'use client'
import { useState } from 'react'
import Link from 'next/link'
import { inviteText } from '@/lib/invite'

// THE HTML CONNECT DOOR + RELAY CONSOLE (Galen, Sep 15: "HTML bridge was
// rejected by ChatGPT"). Root cause: browser-boxed ChatGPT cannot POST —
// its web tool only READS pages and its sandbox has no network. So the HTTP
// contract alone is unusable there. RELAY MODE is the honest mirror: the AI
// writes ONE JSON command per message; the human ferries it through this
// console (which POSTs to the bridge with their key) and pastes the result
// back. The human is the transport — the fast-loop law as a doorway.
export default function ConnectHtml() {
  const [key, setKey] = useState('')
  const [cmd, setCmd] = useState('{"commands":[{"type":"help"}]}')
  const [out, setOut] = useState('')
  const [busy, setBusy] = useState(false)
  const prompt = inviteText(undefined, undefined, 'create')
  const relayPrompt = [
    'You are my AI, building a game world on cartridge.cafe with me — in RELAY MODE:',
    'you cannot reach the network, so I am your hands. Each turn, give me EXACTLY ONE',
    'JSON command block like {"commands":[{"type":"help"}]} — I paste it into the',
    'bridge console and paste the full JSON result back to you. Start with',
    '{"commands":[{"type":"help"}]} to learn every verb, then read the guide section',
    'the help points you to. Announce what each command will do before you hand it to',
    'me. Your eyes: ask me to describe the screen or press 📸 SNAPSHOT → AI in the',
    'world tab whenever you need pixels — never claim a visual is right unseen.',
  ].join('\n')
  const send = async () => {
    setBusy(true)
    try {
      const r = await fetch('/api/engine/bridge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key.trim()}` },
        body: cmd,
      })
      setOut(JSON.stringify(await r.json(), null, 1))
    } catch (e) { setOut(String(e)) } finally { setBusy(false) }
  }
  const box: React.CSSProperties = { whiteSpace: 'pre-wrap', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,180,84,0.3)', borderRadius: 8, padding: 14, fontSize: 12, lineHeight: 1.55 }
  return (
    <main style={{ maxWidth: 780, margin: '0 auto', padding: '40px 20px', fontFamily: 'ui-monospace, monospace', color: '#e8e4da' }}>
      <h1 style={{ fontSize: 21, letterSpacing: 2 }}>⚿ CONNECT AN AI — no install required</h1>
      <p style={{ opacity: 0.85, lineHeight: 1.6 }}>
        Tool-capable AIs (Claude Code, Cursor…) use the prompt below directly.
        Browser-boxed AIs (ChatGPT in a tab) <b>cannot make network requests</b> —
        for them, use <b>RELAY MODE</b>: your AI writes commands, you ferry them
        through the console here. <Link href="/pair" style={{ color: '#ffb454' }}>Pair your AI for a key first →</Link>
      </p>
      <h2 style={{ fontSize: 14, letterSpacing: 2, marginTop: 24 }}>RELAY PROMPT (browser AIs — copy this)</h2>
      <pre style={{ ...box, userSelect: 'all' }}>{relayPrompt}</pre>
      <h2 style={{ fontSize: 14, letterSpacing: 2, marginTop: 20 }}>THE BRIDGE CONSOLE (you are the transport)</h2>
      <input value={key} onChange={e => setKey(e.target.value)} placeholder="your AI's key (uc_pt_… or uc_st_…)"
        style={{ width: '100%', padding: 10, marginTop: 8, background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 6, color: '#fff', fontFamily: 'inherit', fontSize: 12 }} />
      <textarea value={cmd} onChange={e => setCmd(e.target.value)} rows={4}
        style={{ width: '100%', padding: 10, marginTop: 8, background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 6, color: '#9fe8d8', fontFamily: 'inherit', fontSize: 12 }} />
      <button onClick={send} disabled={busy || !key.trim()}
        style={{ marginTop: 8, padding: '10px 18px', borderRadius: 6, border: '1px solid rgba(255,180,84,0.5)', background: busy ? '#444' : '#ffb454', color: '#000', fontWeight: 700, letterSpacing: 1.5, cursor: 'pointer' }}>
        {busy ? 'SENDING…' : '⇥ SEND TO THE BRIDGE'}
      </button>
      {out && <pre style={{ ...box, marginTop: 10, maxHeight: 380, overflow: 'auto', userSelect: 'all' }}>{out}</pre>}
      <h2 style={{ fontSize: 14, letterSpacing: 2, marginTop: 28 }}>FULL PROMPT (tool-capable AIs)</h2>
      <pre style={{ ...box, userSelect: 'all' }}>{prompt}</pre>
    </main>
  )
}
