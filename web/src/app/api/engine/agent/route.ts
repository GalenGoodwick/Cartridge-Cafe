import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { appendMemory, getEngineState, setWorldData, setWorldParamsStore, resetStore, postCommandResult } from '../store'

export const maxDuration = 120 // SSE can stay open
export const dynamic = 'force-dynamic'

// --- In-memory command queue ---
export type EngineCommand =
  | { type: 'select'; fieldId: string }
  | { type: 'generate'; prompt: string; fieldId?: string }
  | { type: 'clear_effect'; fieldId?: string }
  | { type: 'clear_all' }
  // Shape-based field creation (no cells — shape IS the body)
  | { type: 'create_field'; fieldId?: string; name?: string; color?: [number, number, number, number]; shape?: 'circle' | 'rect'; shapeType?: 'circle' | 'rect'; radius?: number; w?: number; h?: number; x?: number; y?: number; parentFieldId?: string; visualType?: string | number; visualParams?: [number, number, number, number]; renderTarget?: string; sampleTargets?: string[] }
  | { type: 'delete_field'; fieldId: string }
  | { type: 'set_parent'; fieldId: string; parentFieldId?: string }
  | { type: 'set_shape'; fieldId: string; shape?: 'circle' | 'rect'; shapeType?: 'circle' | 'rect'; radius?: number; w?: number; h?: number }
  | { type: 'set_position'; fieldId: string; x: number; y: number }
  | { type: 'set_color'; fieldId: string; color: [number, number, number, number] }
  | { type: 'set_scale'; fieldId: string; scale: number }
  | { type: 'set_name'; fieldId: string; name: string }
  | { type: 'set_property'; fieldId: string; key: string; value: unknown }
  | { type: 'get_properties'; fieldId: string }
  | { type: 'set_tool'; tool: string }
  // Shader effect stack
  | { type: 'inject_wgsl'; wgsl: string; description?: string; fieldId?: string; fromFieldId?: string; feedback?: boolean }
  | { type: 'add_effect'; fieldId: string; wgsl: string; description?: string; blend?: 'alpha' | 'additive' | 'multiply'; order?: number; author?: string; fromFieldId?: string; feedback?: boolean }
  | { type: 'remove_effect'; fieldId: string; effectId: string }
  // World effects (composited, multiple allowed)
  | { type: 'add_world_effect'; wgsl: string; description?: string; blend?: 'alpha' | 'additive' | 'multiply'; fieldId?: string }
  | { type: 'remove_world_effect'; effectId: string }
  | { type: 'inject_world_wgsl'; wgsl: string; description?: string; fieldId?: string }
  | { type: 'clear_world_effect' }
  // Communication
  | { type: 'field_message'; fromFieldId: string; toFieldId: string; content: string; data?: Record<string, unknown> }
  // Movement / physics
  | { type: 'move'; fieldId: string; dx: number; dy: number }
  | { type: 'set_world_params'; params: Partial<{ gravity: number; friction: number; collisionForce: number; boundaryMode: 'solid' | 'wrap' | 'open'; bounciness: number; gravitationalConstant: number }> }
  | { type: 'apply_force'; fieldId: string; fx: number; fy: number }
  | { type: 'set_world_data'; data: Record<string, unknown>; fieldId?: string }
  // Interaction rules
  | { type: 'define_interaction'; rule: {
      definedBy: string; trigger: 'overlap' | 'proximity' | 'always';
      triggerDistance?: number; fieldA?: string; fieldB?: string;
      effect: 'transfer_property' | 'apply_force' | 'modify_property' | 'exchange_wgsl' | 'send_event' | 'damage' | 'destroy_field';
      effectParams: Record<string, unknown>; description?: string;
    }}
  | { type: 'remove_interaction'; ruleId: string }
  // Interaction effects — WGSL shaders rendered at field overlap pixels
  | { type: 'add_interaction_effect'; fieldA?: string; fieldB?: string; wgsl: string; description?: string; blend?: 'alpha' | 'additive' | 'multiply'; spread?: number; order?: number; author?: string }
  | { type: 'remove_interaction_effect'; effectId: string }
  // Custom commands
  | { type: 'define_command'; command: {
      name: string; definedBy: string; description: string;
      macro: Array<Record<string, unknown>>;
    }}
  | { type: 'execute_command'; name: string; args?: Record<string, unknown> }
  // Step hooks — JavaScript that runs every simulation tick
  | { type: 'add_step_hook'; hookId: string; author: string; description: string; code: string }
  | { type: 'remove_step_hook'; hookId: string }
  // GPU step hooks — WGSL compute shaders that run per-field on the GPU (sandboxed)
  | { type: 'add_gpu_step_hook'; hookId: string; author: string; description: string; wgsl: string; order?: number }
  | { type: 'remove_gpu_step_hook'; hookId: string }
  // Field links — visual energy beams between fields
  | { type: 'link_fields'; fromFieldId: string; toFieldId: string; color?: [number, number, number, number]; width?: number; style?: 'beam' | 'lightning' | 'pulse' | 'helix'; intensity?: number; bidirectional?: boolean; author?: string }
  | { type: 'unlink_fields'; linkId: string }
  // Propagation types — how interaction effects spread beyond overlap
  | { type: 'define_propagation'; name: string; wgsl: string; author?: string }
  // Shader modules — reusable WGSL functions injected into uber-shader (mod_NAME prefix)
  | { type: 'define_module'; name: string; wgsl: string }
  // Render targets — named intermediate buffers for render-to-texture
  | { type: 'create_render_target'; name: string }
  | { type: 'destroy_render_target'; name: string }
  // WGSL mods — reusable shader code registered by agents
  | { type: 'register_wgsl_mod'; id: string; author: string; description: string; code: string }
  | { type: 'remove_wgsl_mod'; id: string }
  // Field cloning
  | { type: 'clone_field'; fieldId: string; name?: string; color?: [number, number, number, number]; offsetX?: number; offsetY?: number }
  | { type: 'list_fields' }
  | { type: 'status' }
  | { type: 'reset' }
  // Visual type undo — restore previous shader version
  | { type: 'undo_visual'; name: string }

type QueueEntry = { id: string; command: EngineCommand; timestamp: number }

// Persist across hot-reloads using globalThis
const g = globalThis as unknown as {
  __engineCommandQueue?: QueueEntry[]
  __engineSSEListeners?: Set<(entry: QueueEntry) => void>
  __engineCommandCounter?: number
  __spaceCommandQueues?: Map<string, QueueEntry[]>
  __spaceSSEListeners?: Map<string, Set<(entry: QueueEntry) => void>>
}
const commandQueue: QueueEntry[] = g.__engineCommandQueue ??= []
const listeners: Set<(entry: QueueEntry) => void> = g.__engineSSEListeners ??= new Set()
let commandCounter = g.__engineCommandCounter ?? 0

// Per-space command queues and listeners
const spaceQueues: Map<string, QueueEntry[]> = g.__spaceCommandQueues ??= new Map()
const spaceListeners: Map<string, Set<(entry: QueueEntry) => void>> = g.__spaceSSEListeners ??= new Map()

function getSpaceQueue(spaceId: string): QueueEntry[] {
  let queue = spaceQueues.get(spaceId)
  if (!queue) {
    queue = []
    spaceQueues.set(spaceId, queue)
  }
  return queue
}

function getSpaceListenerSet(spaceId: string): Set<(entry: QueueEntry) => void> {
  let set = spaceListeners.get(spaceId)
  if (!set) {
    set = new Set()
    spaceListeners.set(spaceId, set)
  }
  return set
}

// Deduplicate define_visual/define_module in a queue: keep only the latest per name.
// This prevents OOM on replay (no duplicate shader source strings) while preserving
// full WGSL so reconnecting browsers can restore visual types from the queue.
function deduplicateQueue(queue: QueueEntry[], entry: QueueEntry): void {
  const cmd = entry.command as Record<string, unknown>
  const cmdType = cmd.type
  if ((cmdType === 'define_visual' || cmdType === 'define_module') && cmd.name) {
    const name = cmd.name as string
    for (let i = queue.length - 1; i >= 0; i--) {
      const qc = queue[i].command as Record<string, unknown>
      if (qc.type === cmdType && qc.name === name) {
        queue.splice(i, 1)
      }
    }
  }
}

// Commands that must execute exactly once, live — replaying them against a
// freshly-restored session re-runs destructive state transitions (e.g. a
// replayed save_scene overwrites the saved scene with whatever world the new
// session happens to hold). Broadcast to live listeners, never queue.
const NO_REPLAY = new Set(['save_scene', 'load_scene', 'delete_scene', 'reset'])

/** Ephemeral input (key/mouse flags) must broadcast live but never replay —
 *  a reconnecting tab re-running an hour-old key press is a phantom input.
 *  Returns the command to queue (stripped), or null if nothing durable remains. */
function stripEphemeral(command: EngineCommand): EngineCommand | null {
  const cmd = command as Record<string, unknown>
  if (cmd.type !== 'set_world_data' || !cmd.data || typeof cmd.data !== 'object') return command
  const data = cmd.data as Record<string, unknown>
  const durable: Record<string, unknown> = {}
  let stripped = false
  for (const k of Object.keys(data)) {
    if (k.startsWith('key_') || k.startsWith('mouse_')) { stripped = true; continue }
    durable[k] = data[k]
  }
  if (!stripped) return command
  if (Object.keys(durable).length === 0) return null
  return { ...cmd, data: durable } as EngineCommand
}

function pushCommand(command: EngineCommand, spaceId?: string | null): QueueEntry {
  const entry: QueueEntry = {
    id: `cmd_${(g.__engineCommandCounter = ++commandCounter)}_${Date.now()}`,
    command,
    timestamp: Date.now(),
  }
  const durableCommand = stripEphemeral(command)
  const skipReplay = NO_REPLAY.has((command as Record<string, unknown>).type as string) || durableCommand === null
  const queueEntry: QueueEntry = durableCommand === command ? entry : { ...entry, command: durableCommand as EngineCommand }

  if (spaceId) {
    const queue = getSpaceQueue(spaceId)
    const sListeners = spaceListeners.get(spaceId)
    if (sListeners) {
      for (const listener of sListeners) {
        listener(entry)
      }
    }
    if (!skipReplay) {
      deduplicateQueue(queue, queueEntry)
      queue.push(queueEntry)
      if (queue.length > 1000) queue.splice(0, queue.length - 1000)
    }
  } else {
    for (const listener of listeners) {
      listener(entry)
    }
    if (!skipReplay) {
      deduplicateQueue(commandQueue, queueEntry)
      commandQueue.push(queueEntry)
      if (commandQueue.length > 1000) commandQueue.splice(0, commandQueue.length - 1000)
    }
  }

  return entry
}

// Check auth — session OR bearer token (ENGINE_AGENT_TOKEN env var)
async function checkAuth(req: NextRequest): Promise<{ authorized: boolean; isAdmin: boolean }> {
  // Check bearer token first (for CLI/external agent access)
  const authHeader = req.headers.get('authorization')
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7)
    const envToken = process.env.ENGINE_AGENT_TOKEN
    if (envToken && token === envToken) {
      return { authorized: true, isAdmin: true }
    }
  }

  // Fall back to session auth
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return { authorized: false, isAdmin: false }
  }

  const adminEmails = (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim())
  const isAdmin = adminEmails.includes(session.user.email || '')
  return { authorized: true, isAdmin }
}

/**
 * GET — SSE stream for the engine page to subscribe to
 * The engine page opens an EventSource to this endpoint and receives commands in real-time.
 */
export async function GET(req: NextRequest) {
  // Dev keeps the frictionless local workflow (same posture as the scene route);
  // production requires a session.
  if (process.env.NODE_ENV === 'production') {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
    }
  }

  const spaceId = req.nextUrl.searchParams.get('spaceId')

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    start(controller) {
      // Send initial heartbeat
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'connected', spaceId: spaceId || undefined })}\n\n`))

      if (spaceId) {
        // Space-scoped: replay from space queue
        const queue = getSpaceQueue(spaceId)
        const MAX_REPLAY = 200
        let replayStart = 0
        for (let i = queue.length - 1; i >= 0; i--) {
          if (queue[i].command.type === 'reset') {
            replayStart = i
            break
          }
        }
        const effectiveStart = Math.max(replayStart, queue.length - MAX_REPLAY)
        for (let i = effectiveStart; i < queue.length; i++) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(queue[i])}\n\n`))
        }

        // Listen for space-specific commands
        const sListeners = getSpaceListenerSet(spaceId)
        const listener = (entry: QueueEntry) => {
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(entry)}\n\n`))
          } catch {
            sListeners.delete(listener)
          }
        }
        sListeners.add(listener)

        // Heartbeat
        const heartbeat = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(`data: {"type":"ping"}\n\n`))
          } catch {
            clearInterval(heartbeat)
            sListeners.delete(listener)
          }
        }, 15000)

        req.signal.addEventListener('abort', () => {
          clearInterval(heartbeat)
          sListeners.delete(listener)
          try { controller.close() } catch { /* already closed */ }
        })
      } else {
        // Global: replay from global queue
        const MAX_REPLAY = 200
        let replayStart = 0
        for (let i = commandQueue.length - 1; i >= 0; i--) {
          if (commandQueue[i].command.type === 'reset') {
            replayStart = i
            break
          }
        }
        const effectiveStart = Math.max(replayStart, commandQueue.length - MAX_REPLAY)
        for (let i = effectiveStart; i < commandQueue.length; i++) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(commandQueue[i])}\n\n`))
        }

        // Listen for new commands
        const listener = (entry: QueueEntry) => {
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(entry)}\n\n`))
          } catch {
            listeners.delete(listener)
          }
        }
        listeners.add(listener)

        // Heartbeat every 15s to keep connection alive
        const heartbeat = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(`data: {"type":"ping"}\n\n`))
          } catch {
            clearInterval(heartbeat)
            listeners.delete(listener)
          }
        }, 15000)

        // Cleanup on abort
        req.signal.addEventListener('abort', () => {
          clearInterval(heartbeat)
          listeners.delete(listener)
          try { controller.close() } catch { /* already closed */ }
        })
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}

/**
 * POST — Accept commands from an AI agent or external caller
 * Body: { commands: EngineCommand[] } or a single EngineCommand
 */
export async function POST(req: NextRequest) {
  const { authorized, isAdmin } = await checkAuth(req)
  if (!authorized) {
    return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
  }
  if (!isAdmin) {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
  }

  try {
    const body = await req.json()

    // Accept single command or array
    const rawCommands = Array.isArray(body.commands)
      ? body.commands
      : body.type
        ? [body as EngineCommand]
        : []

    // Parse string shorthand commands into objects
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const commands: EngineCommand[] = rawCommands.map((cmd: any) => {
      if (typeof cmd === 'string') {
        const parts = cmd.trim().split(/\s+/)
        const type = parts[0]
        if (type === 'set_visual' && parts.length >= 3) {
          return { type: 'set_visual', fieldId: parts[1], visualType: parts[2] }
        }
        if (type === 'reset') {
          return { type: 'reset' }
        }
        // Fallback: treat first word as type, second as fieldId
        return { type, fieldId: parts[1] }
      }
      return cmd
    })

    if (commands.length === 0) {
      return NextResponse.json({ error: 'No commands provided' }, { status: 400 })
    }

    if (commands.length > 500) {
      return NextResponse.json({ error: 'Max 500 commands per request' }, { status: 400 })
    }

    const results: { id: string; type: string; fieldId?: string }[] = []
    let statusPayload: ReturnType<typeof getEngineState> | null = null

    for (const cmd of commands) {
      // Command result from browser — resolve waiting bridge requests
      if (cmd.type === 'command_result' as string) {
        const crCmd = cmd as unknown as { commandId: string; result: unknown }
        if (crCmd.commandId && crCmd.result !== undefined) {
          postCommandResult(crCmd.commandId, crCmd.result)
        }
        results.push({ id: `cr_${Date.now()}`, type: 'command_result' })
        continue
      }
      // Assign a stable fieldId for create_field commands so browser and agents share the same ID
      if (cmd.type === 'create_field' && !cmd.fieldId) {
        cmd.fieldId = `field_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
      }

      // Extract and strip space routing metadata
      const cmdSpaceId = (cmd as Record<string, unknown>).__spaceId as string | undefined
      if (cmdSpaceId) delete (cmd as Record<string, unknown>).__spaceId

      const entry = pushCommand(cmd, cmdSpaceId)
      const result: { id: string; type: string; fieldId?: string } = { id: entry.id, type: cmd.type }
      if (cmd.type === 'create_field' && cmd.fieldId) {
        result.fieldId = cmd.fieldId
      }
      results.push(result)

      // Server-side store operations only for global mode (space state is browser-synced to DB)
      if (!cmdSpaceId) {
        // Server-side memory injection for field messages (immediate visibility before client sync)
        if (cmd.type === 'field_message') {
          const now = new Date().toISOString()
          appendMemory(cmd.fromFieldId, {
            timestamp: now,
            type: 'message_sent',
            content: `Sent to ${cmd.toFieldId}: "${cmd.content}"`,
            sourceFieldId: cmd.toFieldId,
            data: cmd.data,
          })
          appendMemory(cmd.toFieldId, {
            timestamp: now,
            type: 'message_received',
            content: `From ${cmd.fromFieldId}: "${cmd.content}"`,
            sourceFieldId: cmd.fromFieldId,
            data: cmd.data,
          })
        }

        // Server-side world data writes (immediate visibility before client sync)
        if (cmd.type === 'set_world_data') {
          setWorldData(cmd.data)
        }

        // Server-side world params writes (immediate visibility)
        if (cmd.type === 'set_world_params') {
          setWorldParamsStore(cmd.params)
        }

        // Reset entire server store
        if (cmd.type === 'reset') {
          resetStore()
        }

        // Include engine state in status response
        if (cmd.type === 'status') {
          statusPayload = getEngineState()
        }
      }
    }

    return NextResponse.json({
      queued: results.length,
      commands: results,
      listeners: listeners.size,
      ...(statusPayload ? { engineState: statusPayload } : {}),
    })
  } catch (err) {
    console.error('Agent command error:', err)
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
}
