import { NextRequest, NextResponse } from 'next/server'
import { getFieldSnapshot, getAllFieldSnapshots, getEngineState, addInteractionRuleStore, removeInteractionRuleStore, addCustomCommandStore, getCustomCommandStore, getRenderedSamples, getRenderedSample, addGlslMod, removeGlslMod, addVisualType, undoVisualType, removeVisualType, addInteractionDef, addModule, addRenderTargetDef, removeRenderTargetDef, waitForCommandResult, resetStore } from '../store'
import type { GlslMod } from '../store'
import { validateSpaceToken, getSpaceSnapshot, applyCommandToSnapshot } from '../space-store'

export const maxDuration = 30

interface BridgeAuth {
  authorized: boolean
  spaceId: string | null    // null = legacy global mode
  ownerId: string | null
  slug?: string
  spaceName?: string
}

// Auth: ENGINE_AGENT_TOKEN or uc_st_ space token
async function authorize(req: NextRequest): Promise<BridgeAuth> {
  const authHeader = req.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return { authorized: false, spaceId: null, ownerId: null }
  }

  const token = authHeader.slice(7)

  // Space token path
  if (token.startsWith('uc_st_')) {
    const result = await validateSpaceToken(token)
    if (!result) return { authorized: false, spaceId: null, ownerId: null }
    return { authorized: true, spaceId: result.spaceId, ownerId: result.ownerId, slug: result.slug, spaceName: result.spaceName }
  }

  // Legacy global token path (admin)
  const envToken = process.env.ENGINE_AGENT_TOKEN || process.env.ANTHROPIC_API_KEY
  if (envToken && token === envToken) {
    return { authorized: true, spaceId: null, ownerId: null }
  }

  return { authorized: false, spaceId: null, ownerId: null }
}

// Relay commands to the agent SSE queue
async function pushToAgent(command: Record<string, unknown>, req: NextRequest, spaceId?: string | null): Promise<unknown> {
  const baseUrl = req.nextUrl.origin
  const token = process.env.ENGINE_AGENT_TOKEN || process.env.ANTHROPIC_API_KEY || ''

  // Tag command with spaceId so the SSE queue routes it correctly
  const payload = spaceId ? { ...command, __spaceId: spaceId } : command

  const res = await fetch(`${baseUrl}/api/engine/agent`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  })

  return res.json()
}

// Save experience directly to Shell DB (bypasses SSE queue)
async function saveExperience(cmd: Record<string, unknown>, req: NextRequest): Promise<unknown> {
  const baseUrl = req.nextUrl.origin
  const shellSecret = process.env.SHELL_SECRET || process.env.ANTHROPIC_API_KEY || ''

  const res = await fetch(`${baseUrl}/api/shell/experience`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${shellSecret}`,
    },
    body: JSON.stringify({
      text: cmd.text,
      valence: cmd.valence,
      domain: cmd.domain || 'identity',
      shellName: cmd.shellName,
      source: 'engine',
      session: new Date().toISOString().split('T')[0],
    }),
  })

  return res.json()
}

// Fetch Shell identity from champion endpoint
async function fetchShellIdentity(shellName: string, req: NextRequest): Promise<unknown> {
  const baseUrl = req.nextUrl.origin
  const shellSecret = process.env.SHELL_SECRET || process.env.ANTHROPIC_API_KEY || ''

  const res = await fetch(`${baseUrl}/api/shell/champion?shell=${encodeURIComponent(shellName)}`, {
    headers: { 'Authorization': `Bearer ${shellSecret}` },
  })

  return res.json()
}

/**
 * GET /api/engine/bridge
 * Returns field state from the server-side store.
 * Optional ?fieldId=xxx for a single field.
 */
export async function GET(req: NextRequest) {
  const auth = await authorize(req)
  if (!auth.authorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Space-scoped: return snapshot from DB
  if (auth.spaceId) {
    const snapshot = await getSpaceSnapshot(auth.spaceId)
    return NextResponse.json({
      space: { slug: auth.slug, name: auth.spaceName, viewUrl: req.nextUrl.origin + '/space/' + auth.slug },
      spaceId: auth.spaceId,
      fields: snapshot?.fields ?? [],
      fieldCount: snapshot?.fields?.length ?? 0,
      worldParams: snapshot?.worldParams ?? {},
      worldData: snapshot?.worldData ?? {},
      interactionRules: snapshot?.interactionRules ?? [],
      interactionEffects: snapshot?.interactionEffects ?? [],
      visualTypes: snapshot?.visualTypes ?? [],
      modules: snapshot?.modules ?? [],
      stepHooks: snapshot?.stepHooks ?? [],
    })
  }

  // Trim memory for efficiency in bridge responses
  const trimMemory = (snap: Record<string, unknown>) => {
    if (Array.isArray(snap.memory) && snap.memory.length > 20) {
      snap.memory = snap.memory.slice(-20)
    }
    return snap
  }

  // Optional: fetch Shell identity alongside field state
  const shellName = req.nextUrl.searchParams.get('shell')
  let shellIdentity: unknown = undefined
  if (shellName) {
    try {
      shellIdentity = await fetchShellIdentity(shellName, req)
    } catch {
      // Shell identity is optional — don't fail the whole request
    }
  }

  const fieldId = req.nextUrl.searchParams.get('fieldId')
  const fieldName = req.nextUrl.searchParams.get('name')
  if (fieldId) {
    const snap = getFieldSnapshot(fieldId)
    if (!snap) {
      return NextResponse.json({ error: 'Field not found' }, { status: 404 })
    }
    const response: Record<string, unknown> = trimMemory(snap as unknown as Record<string, unknown>)
    const sample = getRenderedSample(fieldId)
    if (sample) response.renderedPixels = sample
    if (shellIdentity) response.shellIdentity = shellIdentity
    return NextResponse.json(response)
  }

  // Cell presence query: ?cell=x,y
  const cellParam = req.nextUrl.searchParams.get('cell')
  if (cellParam) {
    const [cx, cy] = cellParam.split(',').map(Number)
    const state = getEngineState()
    const cellSamples = (state.worldData?.cellSample as Record<string, unknown>) || null
    return NextResponse.json({ cell: { x: cx, y: cy }, worldData: cellSamples })
  }

  // Name-based field lookup: ?name=Beta
  if (fieldName) {
    const allSnaps = getAllFieldSnapshots()
    const match = allSnaps.find(s => s.name.toLowerCase() === fieldName.toLowerCase())
    if (!match) {
      return NextResponse.json({ error: `Field "${fieldName}" not found` }, { status: 404 })
    }
    const response: Record<string, unknown> = trimMemory(match as unknown as Record<string, unknown>)
    const sample = getRenderedSample(match.id)
    if (sample) response.renderedPixels = sample
    if (shellIdentity) response.shellIdentity = shellIdentity
    return NextResponse.json(response)
  }

  const state = getEngineState()
  const allSamples = getRenderedSamples()

  // Elevate worldData plan/rules/roles to top-level for field agent visibility
  const wd = state.worldData || {}
  const response: Record<string, unknown> = {
    ...state,
    fields: state.fields.map(f => {
      const trimmed = trimMemory(f as unknown as Record<string, unknown>)
      const sample = allSamples[f.id]
      if (sample) trimmed.renderedPixels = sample
      return trimmed
    }),
    // Top-level world context (from planning agent)
    worldPlan: wd.plan || null,
    worldRules: wd.rules || null,
    worldRoles: wd.roles || null,
    worldPhase: wd.phase || null,
  }
  if (shellIdentity) response.shellIdentity = shellIdentity
  return NextResponse.json(response)
}

/**
 * POST /api/engine/bridge
 *
 * Direct command relay — Claude Code sends commands, engine executes them live.
 * No intermediate AI calls. Just you and the engine.
 *
 * Body: single command or { commands: [...] }
 * Commands: create_field, paint, add_effect, inject_glsl, emit_data, set_position, etc.
 */
export async function POST(req: NextRequest) {
  const auth = await authorize(req)
  if (!auth.authorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await req.json()

    // Accept single command or array
    const commands: Record<string, unknown>[] = Array.isArray(body.commands)
      ? body.commands
      : body.type
        ? [body]
        : []

    if (commands.length === 0) {
      return NextResponse.json({ error: 'No commands. Send {type:"paint",...} or {commands:[...]}' }, { status: 400 })
    }

    const results: unknown[] = []
    const isSpaceScoped = !!auth.spaceId

    // Provenance cross-check: stamp the User-Agent of the FIRST agent to post a
    // build command to this world (self-reported worldData.built_by is separate,
    // and can be spoofed; this is the unspoofed hint). Best-effort — never blocks.
    if (isSpaceScoped) {
      try {
        const snap = await getSpaceSnapshot(auth.spaceId!)
        const wd = (snap?.worldData ?? {}) as Record<string, unknown>
        if (!wd.__built_ua) {
          const ua = (req.headers.get('user-agent') || 'unknown').slice(0, 200)
          await applyCommandToSnapshot(auth.spaceId!, { type: 'set_world_data', data: { __built_ua: ua, __built_at: Date.now() } })
        }
      } catch { /* provenance is best-effort */ }
    }

    for (const cmd of commands) {
      // Add delay between commands so the engine page can process each one
      if (results.length > 0) {
        await new Promise(r => setTimeout(r, 100))
      }

      // reset: clear server-side store alongside browser reset
      if (cmd.type === 'reset') {
        resetStore()
      }

      // save_experience goes directly to Shell DB, not through SSE
      if (cmd.type === 'save_experience') {
        const result = await saveExperience(cmd, req)
        results.push(result)
        continue
      }

      // Server-side store operations only for global mode (space state is persisted via browser state sync)
      if (!isSpaceScoped) {
        // define_interaction: store server-side AND forward to browser
        if (cmd.type === 'define_interaction' && cmd.rule) {
          const rule = cmd.rule as Record<string, unknown>
          const ruleId = addInteractionRuleStore({
            id: '',
            definedBy: (rule.definedBy as string) || 'unknown',
            trigger: rule.trigger as 'overlap' | 'proximity' | 'always',
            triggerDistance: rule.triggerDistance as number | undefined,
            fieldA: rule.fieldA as string | undefined,
            fieldB: rule.fieldB as string | undefined,
            effect: rule.effect as 'transfer_property' | 'apply_force' | 'modify_property' | 'exchange_wgsl' | 'send_event',
            effectParams: (rule.effectParams as Record<string, unknown>) || {},
            description: rule.description as string | undefined,
          })
          if (ruleId) {
            ;(cmd.rule as Record<string, unknown>).id = ruleId
          }
        }

        if (cmd.type === 'remove_interaction' && cmd.ruleId) {
          removeInteractionRuleStore(cmd.ruleId as string)
        }

        if (cmd.type === 'define_command' && cmd.command) {
          const cmdDef = cmd.command as Record<string, unknown>
          addCustomCommandStore({
            name: cmdDef.name as string,
            definedBy: (cmdDef.definedBy as string) || 'unknown',
            description: (cmdDef.description as string) || '',
            macro: (cmdDef.macro as Array<Record<string, unknown>>) || [],
          })
        }

        if (cmd.type === 'define_visual' && cmd.name && cmd.wgsl) {
          addVisualType(cmd.name as string, cmd.wgsl as string)
        }

        if (cmd.type === 'define_module' && cmd.name && cmd.wgsl) {
          addModule(cmd.name as string, cmd.wgsl as string)
        }

        if (cmd.type === 'create_render_target' && cmd.name) {
          addRenderTargetDef(cmd.name as string)
        }

        if (cmd.type === 'destroy_render_target' && cmd.name) {
          removeRenderTargetDef(cmd.name as string)
        }

        if (cmd.type === 'define_interaction' && cmd.wgsl && cmd.name && cmd.fieldA && cmd.fieldB) {
          addInteractionDef(cmd.name as string, cmd.wgsl as string, cmd.fieldA as string, cmd.fieldB as string)
        }

        if (cmd.type === 'register_glsl_mod') {
          const mod: GlslMod = {
            id: cmd.id as string,
            author: (cmd.author as string) || 'unknown',
            description: (cmd.description as string) || '',
            code: cmd.code as string,
            timestamp: Date.now(),
          }
          addGlslMod(mod)
        }

        if (cmd.type === 'remove_glsl_mod' && cmd.id) {
          removeGlslMod(cmd.id as string)
        }

        // undo_visual: restore previous shader version from history
        if (cmd.type === 'undo_visual' && cmd.name) {
          const restored = undoVisualType(cmd.name as string)
          if (!restored) {
            results.push({ error: `No history for visual type "${cmd.name}"` })
            continue
          }
          // Forward as define_visual with the restored WGSL so the browser recompiles
          cmd.type = 'define_visual'
          cmd.wgsl = restored.wgsl
        }
      }

      // execute_command: expand macro server-side, push each step
      if (cmd.type === 'execute_command') {
        const customCmd = getCustomCommandStore(cmd.name as string)
        if (!customCmd) {
          results.push({ error: `Unknown command: ${cmd.name}` })
          continue
        }
        const args = (cmd.args || {}) as Record<string, unknown>
        for (const step of customCmd.macro) {
          // Substitute {{arg}} placeholders
          const resolved = Object.keys(args).length > 0
            ? JSON.parse(JSON.stringify(step).replace(/\{\{(\w+)\}\}/g, (_, k) =>
                String(args[k] ?? `{{${k}}}`)))
            : step
          const stepResult = await pushToAgent(resolved, req, auth.spaceId)
          results.push(stepResult)
          await new Promise(r => setTimeout(r, 100))
        }
        continue
      }

      // Space-scoped: apply command to snapshot server-side (works without browser)
      let spaceResult: Record<string, unknown> | null = null
      if (isSpaceScoped) {
        spaceResult = await applyCommandToSnapshot(auth.spaceId!, cmd)
        // Merge server-generated IDs into the command so SSE relays the correct fieldId
        if (spaceResult.fieldId) {
          cmd.fieldId = spaceResult.fieldId
        }
      }

      const result = await pushToAgent(cmd, req, auth.spaceId) as Record<string, unknown>
      // Merge space result metadata into the response
      if (spaceResult) {
        Object.assign(result, spaceResult)
      }
      results.push(result)

      // Wait for the browser's compile result so the AI gets shader errors
      // synchronously in its bridge response — not just visuals/modules but
      // effects and state shaders too (the agent authors those and needs the
      // error the moment it makes it).
      const AWAIT_COMPILE = new Set(['define_visual', 'define_module', 'add_effect', 'inject_wgsl', 'inject_glsl', 'update_effect', 'add_state_shader'])
      if (AWAIT_COMPILE.has(cmd.type as string) && result.commands) {
        const cmds = result.commands as Array<{ id: string; type: string }>
        const cmdEntry = cmds.find(c => c.type === cmd.type)
        if (cmdEntry?.id) {
          const compileResult = await waitForCommandResult(cmdEntry.id, 8000)
          if (compileResult) {
            const cr = compileResult as Record<string, unknown>
            ;(result as Record<string, unknown>).compileResult = cr
          }
        }
      }
    }

    // AI focus beacon: derive what the agent just touched and publish it so the
    // world UI can show "AI -> <thing>". Written to the snapshot AND relayed live.
    if (isSpaceScoped && commands.length > 0) {
      const last = commands[commands.length - 1] as Record<string, unknown>
      const focus = {
        action: last.type ?? null,
        fieldId: last.fieldId ?? null,
        fieldName: last.name ?? null,
        at: Date.now(),
      }
      const beacon = { type: 'set_world_data', data: { ai_focus: focus } }
      try {
        await applyCommandToSnapshot(auth.spaceId!, beacon)
        await pushToAgent(beacon, req, auth.spaceId)
      } catch { /* the beacon must never break the bridge */ }
    }

    return NextResponse.json({ ok: true, executed: results.length, results })
  } catch (error) {
    console.error('[Engine Bridge] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Bridge failed' },
      { status: 500 }
    )
  }
}
