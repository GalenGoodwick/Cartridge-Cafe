'use client'

import { useState } from 'react'
import { copyText } from '@/lib/copyText'

/** CONNECT VIA MCP — the other door, for MCP clients (Claude Code, Cursor). One
 *  command adds cartridge.cafe as an MCP server; the AI then has the guide, the
 *  bridge, and the EYE (render_probe), and can brew worlds through the guest door
 *  (no account). Static content — nothing to mint, nothing installs on the human's
 *  machine beyond the standard `claude mcp add`. The MCP-server door body,
 *  rendered inside <ConnectPanel/> as the second tab (which owns modal chrome). */
const ADD_CMD = 'claude mcp add cartridge-cafe -- npx -y cartridge-cafe-mcp'
const JSON_CFG = '{ "mcpServers": { "cartridge-cafe": { "command": "npx", "args": ["-y", "cartridge-cafe-mcp"] } } }'

export default function McpConnectPanel() {
  const [copied, setCopied] = useState('')
  const copy = (t: string, k: string) =>
    copyText(t).then(ok => { setCopied(ok ? k : 'fail:' + k); setTimeout(() => setCopied(''), 1600) })

  return (
    <>
        <div className="text-[13px] text-glow/45 leading-relaxed mb-2">
          Add cartridge.cafe to <b>Claude Code</b> / Cursor as an MCP server. Your AI gets the guide, the bridge, and <b>the eye</b> — and can brew worlds through the guest door (no account needed).
        </div>
        <div className="text-[13px] text-emerald-300/80 leading-relaxed mb-3 rounded-md border border-emerald-400/25 bg-emerald-400/[0.06] px-2.5 py-2">
          One command adds it — then just ask your AI to <b>“brew me a world where…”</b>. Sign in later and everything it made transfers to you.
        </div>
        <div className="text-[12px] tracking-[0.12em] text-glow/35 mb-1">CLAUDE CODE — one command</div>
        <button onClick={() => copy(ADD_CMD, 'cmd')}
          className="w-full rounded-md bg-flame hover:bg-glow px-3 py-2 text-left text-[12.5px] text-void font-bold break-all transition-all mb-3">
          {copied === 'cmd' ? 'COPIED ✓' : copied === 'fail:cmd' ? '⚠ copy blocked — select below' : ADD_CMD}
        </button>
        <div className="text-[12px] tracking-[0.12em] text-glow/35 mb-1">OR any MCP client — config</div>
        <button onClick={() => copy(JSON_CFG, 'json')}
          className="w-full rounded-md border border-brass/30 px-3 py-2 text-left text-[12px] text-steamer/80 hover:text-glow break-all transition-colors">
          {copied === 'json' ? 'copied ✓' : copied === 'fail:json' ? '⚠ copy blocked' : JSON_CFG}
        </button>
    </>
  )
}
