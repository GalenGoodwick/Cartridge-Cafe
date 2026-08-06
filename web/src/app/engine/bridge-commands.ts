// engine/bridge-commands.ts — the AI command surface, carved out of FieldEngine.tsx
// (DESIGN-fieldengine-carve.md, Phase 1). The 78-case switch that executes every
// bridge command an agent sends over the SSE channel.
//
// PURE MOVE: the body below is byte-identical to the code that lived inside
// FieldEngine's es.onmessage handler (indentation preserved — WGSL template
// literals must not change bytes, shader dedup hashes compiled source).
// CommandContext reproduces the closure the switch had there. Stale-closure
// semantics are LOAD-BEARING (spec §1c): getModCode/saveSceneAs/syncFields/
// showToast are the identities the SSE effect captured at MOUNT; refs are the
// stable ref objects, dereferenced per use, exactly as before.
/* eslint-disable @typescript-eslint/no-explicit-any */
'use client'

import type { Dispatch, SetStateAction, MutableRefObject } from 'react'
import type { FieldSimulation } from './simulation'
import type { FieldRenderer } from './renderer'
import type { FieldInput } from './input'
import type { BrushState, Camera, CameraFollow, GenerationState, FieldEffect, InteractionEffect } from './types'
import type { GameAudio } from './audio'
import type { DialogEntry } from './AgentDialogPanel'
import type { TerminalEntry } from './AgentTerminalPanel'
import { genFieldId, genEffectId, hueToRgba, DEFAULT_HUES, wrapInteractionWgsl } from './engine-utils'
import { serializeSceneDocument } from './persistence/serialize'

export interface CommandContext {
  // per-message (caller resolves from refs after its null-guard)
  sim: FieldSimulation
  renderer: FieldRenderer
  input: FieldInput
  /** the raw SSE envelope (JSON.parse of event.data) — cases POST compile
   *  results back against data.id */
  data: any
  // React state setters (stable identities)
  setGeneration: Dispatch<SetStateAction<GenerationState>>
  setRunning: Dispatch<SetStateAction<boolean>>
  setBrush: Dispatch<SetStateAction<BrushState>>
  setDialogLog: Dispatch<SetStateAction<DialogEntry[]>>
  setTerminalLog: Dispatch<SetStateAction<TerminalEntry[]>>
  // refs — stable objects, dereferenced per use
  liveHooksRef: MutableRefObject<Map<string, { id: string; author: string; description: string; code: string }>>
  cameraRef: MutableRefObject<Camera>
  cameraFollowRef: MutableRefObject<CameraFollow | null>
  audioRef: MutableRefObject<GameAudio>
  wgslModsRef: MutableRefObject<Map<string, { id: string; code: string }>>
  cachedOverlapMasksRef: MutableRefObject<Map<string, Uint8Array>>
  simulationRef: MutableRefObject<FieldSimulation | null>
  // mount-captured callbacks (spec §1c — identities as captured by the SSE effect)
  getModCode: () => string | undefined
  saveSceneAs: (name: string, extra?: Record<string, unknown>) => Promise<string | null>
  syncFields: () => void
  installHooks: (sim: FieldSimulation, stepHooks: { id: string; author: string; description: string; code: string }[] | undefined, worldData: Record<string, unknown> | undefined) => void
  allStepHookSnapshots: (sim: FieldSimulation) => { id: string; author: string; description: string; code: string }[]
  updateSelectionMask: (fieldId: string | null) => void
  gridSize: number
  FIT_ZOOM: number
  showToast: (message: string, type?: 'info' | 'success' | 'error', subtitle?: string) => void
}

/** Execute one bridge command. `cmd` is untyped JSON from the SSE stream —
 *  exactly what the inline handler received (data.command from JSON.parse). */
export async function applyBridgeCommand(cmd: any, ctx: CommandContext): Promise<void> {
  const {
    sim, renderer, data,
    setGeneration, setRunning, setBrush, setDialogLog, setTerminalLog,
    liveHooksRef, cameraRef, cameraFollowRef, audioRef, wgslModsRef,
    cachedOverlapMasksRef, simulationRef,
    getModCode, saveSceneAs, syncFields, showToast,
    installHooks, allStepHookSnapshots, updateSelectionMask, gridSize, FIT_ZOOM,
  } = ctx

          // Resolve field by name when fieldId is missing, or when fieldId doesn't match any actual field ID (agents often send names as fieldId)
          if (cmd.type !== 'create_field' && cmd.type !== 'set_world_data' && cmd.type !== 'set_world_params') {
            const nameToResolve = cmd.fieldId && !sim.fields.has(cmd.fieldId) ? cmd.fieldId : (!cmd.fieldId ? cmd.name : null)
            if (nameToResolve) {
              for (const [id, f] of sim.fields) {
                if (f.name === nameToResolve) {
                  cmd.fieldId = id
                  break
                }
              }
            }
          }

          // Helper to push terminal entries
          const pushTerminal = (type: string, fieldId: string | undefined, summary: string, detail?: string, author?: string) => {
            const field = fieldId ? sim.fields.get(fieldId) : undefined
            setTerminalLog(prev => [...prev.slice(-99), {
              type,
              fieldName: field?.name || fieldId || '?',
              fieldColor: field?.color || [0.5, 0.5, 0.5, 1],
              summary,
              detail,
              author: author || '',
              timestamp: Date.now(),
            }])
          }

          // Extract author from command for terminal identity
          const cmdAuthor = (cmd.author || cmd.fromFieldId || '') as string

          switch (cmd.type) {
            case 'select': {
              const field = sim.fields.get(cmd.fieldId)
              if (field) {
                setBrush(prev => ({ ...prev, activeFieldId: cmd.fieldId }))
              }
              break
            }

            case 'generate': {
              const targetFieldId = cmd.fieldId || Array.from(sim.fields.keys())[0]
              if (!targetFieldId) break

              const field = sim.fields.get(targetFieldId)
              if (field) {
                setBrush(prev => ({ ...prev, activeFieldId: targetFieldId }))
              }

              pushTerminal('generate', targetFieldId, `"${cmd.prompt}"`)

              setGeneration({ loading: true, error: null, targetFieldId })
              try {
                const bounds = sim.getFieldBounds(targetFieldId)
                const res = await fetch('/api/engine/generate', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ prompt: cmd.prompt, bounds, fieldId: targetFieldId }),
                })
                const genData = await res.json()

                if (!res.ok) {
                  setGeneration({ loading: false, error: genData.error || 'Generation failed', targetFieldId })
                  break
                }

                const shaderCode = genData.wgsl || genData.glsl
                if (!shaderCode || typeof shaderCode !== 'string') {
                  setGeneration({ loading: false, error: 'No shader code in response', targetFieldId })
                  break
                }
                const effectId = genEffectId()
                const programKey = `${targetFieldId}_${effectId}`
                const result = await renderer.compileFieldEffect(programKey, targetFieldId, shaderCode, getModCode())
                if (result.success) {
                  const effect: FieldEffect = {
                    id: effectId,
                    author: 'ai_generate',
                    wgsl: shaderCode,
                    description: genData.description || 'AI generated',
                    blend: 'alpha',
                    order: 10,
                  }
                  sim.addFieldEffect(targetFieldId, effect)
                  setGeneration({ loading: false, error: null, targetFieldId: null })
                  syncFields()
                  pushTerminal('generate', targetFieldId, 'complete', shaderCode)
                } else {
                  setGeneration({ loading: false, error: `Shader compile error: ${result.error}`, targetFieldId })
                }
              } catch (err) {
                setGeneration({
                  loading: false,
                  error: err instanceof Error ? err.message : 'Network error',
                  targetFieldId,
                })
              }
              break
            }

            case 'inject_wgsl':
            case 'inject_glsl': {
              // Backward-compatible: translates to add_effect. If same author has an
              // existing effect, replaces it.
              const shaderCode = cmd.wgsl || cmd.glsl
              if (!shaderCode || typeof shaderCode !== 'string') {
                pushTerminal('inject_wgsl', undefined, 'ERROR: wgsl or glsl string required')
                break
              }
              const allFieldIds = Array.from(sim.fields.keys())
              const targetId = cmd.fieldId || allFieldIds[0]
              if (!targetId) {
                pushTerminal('inject_wgsl', undefined, 'ERROR: no fields exist')
                break
              }

              // Consent check: fields can only code themselves
              const fromField = (cmd as Record<string, unknown>).fromFieldId as string | undefined
              if (fromField && fromField !== targetId) {
                const targetField = sim.fields.get(targetId)
                pushTerminal('inject_wgsl', fromField, `BLOCKED: cannot code '${targetField?.name || targetId}' — send a field_message proposing your shader instead`)
                break
              }

              setBrush(prev => ({ ...prev, activeFieldId: targetId }))

              const field = sim.fields.get(targetId)
              if (!field) break

              // Remove existing effects from same author (backward compat: author = fromField or 'agent')
              const author = fromField || 'agent'
              const existingEffects = field.effects.filter(e => e.author === author)
              for (const e of existingEffects) {
                const pk = `${targetId}_${e.id}`
                renderer.removeFieldEffect(pk)
                sim.removeFieldEffect(targetId, e.id)
              }

              const effectId = genEffectId()
              const programKey = `${targetId}_${effectId}`
              const result = await renderer.compileFieldEffect(programKey, targetId, shaderCode, getModCode())
              if (data.id) fetch('/api/engine/compile-result', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ commandId: data.id, result: result.success ? { ok: true } : { ok: false, error: (result.error || '').slice(0, 300) } }) }).catch(() => {})

              if (result.success) {
                const effect: FieldEffect = {
                  id: effectId,
                  author,
                  wgsl: shaderCode,
                  description: cmd.description || 'Injected by agent',
                  blend: 'alpha',
                  order: 10,
                  feedback: !!cmd.feedback,
                }
                sim.addFieldEffect(targetId, effect)
                syncFields()
                pushTerminal('inject_wgsl', targetId, cmd.description || 'shader injected', shaderCode)
              } else {
                pushTerminal('inject_wgsl', targetId, `COMPILE ERROR: ${result.error?.substring(0, 100)}`)
              }
              break
            }

            case 'add_effect': {
              const targetId = cmd.fieldId
              if (!targetId) {
                pushTerminal('add_effect', undefined, 'ERROR: fieldId required')
                break
              }
              const field = sim.fields.get(targetId)
              if (!field) {
                pushTerminal('add_effect', targetId, `ERROR: field '${targetId}' not found — create_field first`)
                break
              }
              // Accept wgsl/glsl at top level, as 'shader', or nested inside cmd.effect
              const shaderSrc = cmd.wgsl || cmd.glsl || cmd.shader
                || (cmd.effect && typeof cmd.effect === 'object' ? (cmd.effect.wgsl || cmd.effect.glsl) : undefined)
              if (cmd.effect && typeof cmd.effect === 'object') {
                cmd.blend = cmd.blend || cmd.effect.blend
                cmd.author = cmd.author || cmd.effect.author
                cmd.description = cmd.description || cmd.effect.description
              }
              if (!shaderSrc || typeof shaderSrc !== 'string') {
                pushTerminal('add_effect', targetId, 'ERROR: wgsl string required')
                break
              }

              const effectId = genEffectId()
              const programKey = `${targetId}_${effectId}`
              // Accept blend mode from 'blend' or 'effectType' (agents sometimes use effectType for blend)
              const rawBlend = cmd.blend || cmd.effectType
              const blend = (rawBlend === 'additive' || rawBlend === 'multiply') ? rawBlend : 'alpha'
              const result = await renderer.compileFieldEffect(programKey, targetId, shaderSrc, getModCode())
              // report the compile outcome straight back to the AI through the
              // bridge's command_result channel (same as define_visual) so the
              // agent sees its OWN shader errors synchronously, not just in memory
              if (data.id) fetch('/api/engine/compile-result', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ commandId: data.id, result: result.success ? { ok: true } : { ok: false, error: (result.error || '').slice(0, 300) } }) }).catch(() => {})

              if (result.success) {
                const effect: FieldEffect = {
                  id: effectId,
                  author: cmd.author || cmd.fromFieldId || 'agent',
                  wgsl: shaderSrc,
                  description: cmd.description || 'effect added',
                  blend,
                  order: cmd.order ?? (field.effects.length + 1) * 10,
                  feedback: !!cmd.feedback,
                }
                sim.addFieldEffect(targetId, effect)
                syncFields()
                pushTerminal('add_effect', targetId, `${effect.description} (${blend}${cmd.feedback ? ' +feedback' : ''})`, shaderSrc, cmdAuthor)
              } else {
                // Compile error — write to field memory and worldData so agents can see it
                const errMsg = result.error?.substring(0, 200) || 'unknown error'
                sim.addMemory(targetId, {
                  timestamp: new Date().toISOString(),
                  type: 'effect_added',
                  content: `COMPILE ERROR: ${errMsg}`,
                  sourceFieldId: null,
                })
                sim.worldData['last_compile_error'] = {
                  fieldId: targetId,
                  error: errMsg,
                  timestamp: Date.now(),
                }
                pushTerminal('add_effect', targetId, `COMPILE ERROR: ${errMsg}`, undefined, cmdAuthor)
              }
              break
            }

            case 'remove_effect': {
              const targetId = cmd.fieldId
              const effectId = cmd.effectId
              if (!targetId || !effectId) {
                pushTerminal('remove_effect', targetId, 'ERROR: fieldId and effectId required')
                break
              }
              const programKey = `${targetId}_${effectId}`
              renderer.removeFieldEffect(programKey)
              sim.removeFieldEffect(targetId, effectId)
              syncFields()
              pushTerminal('remove_effect', targetId, `removed ${effectId}`)
              break
            }

            case 'update_effect': {
              // Atomic swap: remove old effect by effectId, compile + add new one in one step
              const targetId = cmd.fieldId
              const effectId = cmd.effectId
              const updateShader = cmd.wgsl || cmd.glsl
              if (!targetId || !effectId || !updateShader) {
                pushTerminal('update_effect', targetId, 'ERROR: fieldId, effectId, and wgsl required')
                break
              }
              const field = sim.fields.get(targetId)
              if (!field) { pushTerminal('update_effect', targetId, 'ERROR: field not found'); break }
              const oldEffect = field.effects.find(e => e.id === effectId)
              if (!oldEffect) { pushTerminal('update_effect', targetId, `ERROR: effect ${effectId} not found`); break }

              const programKey = `${targetId}_${effectId}`
              const result = await renderer.compileFieldEffect(programKey, targetId, updateShader, getModCode())
              if (data.id) fetch('/api/engine/compile-result', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ commandId: data.id, result: result.success ? { ok: true } : { ok: false, error: (result.error || '').slice(0, 300) } }) }).catch(() => {})
              if (result.success) {
                // Update in place — no gap
                oldEffect.wgsl = updateShader
                if (cmd.description) oldEffect.description = cmd.description
                if (cmd.blend) oldEffect.blend = cmd.blend
                if (cmd.feedback !== undefined) oldEffect.feedback = !!cmd.feedback
                syncFields()
                pushTerminal('update_effect', targetId, `updated ${effectId}: ${cmd.description || oldEffect.description}`, updateShader, cmdAuthor)
              } else {
                const errMsg = result.error?.substring(0, 200) || 'unknown error'
                sim.worldData['last_compile_error'] = { fieldId: targetId, effectId, error: errMsg, timestamp: Date.now() }
                pushTerminal('update_effect', targetId, `COMPILE ERROR (kept old): ${errMsg}`, undefined, cmdAuthor)
              }
              break
            }

            case 'update_step_hook': {
              // JS hooks are allowed for everyone now — they run ONLY in the sealed
              // Worker sandbox (no DOM/cookies/network), never on the main thread.
              // `id` is accepted as an alias for `hookId`/`name` — otherwise a caller
              // passing `id` silently minted a `hook_<ts>` ghost that shadowed the
              // named hook and ran alongside it (the Aug 2026 veilfire deploy trap).
              const hookId = (cmd.hookId as string) || (cmd.name as string) || (cmd.id as string) || `hook_${Date.now()}`
              const code = String(cmd.code || '')
              if (!code) { pushTerminal('update_step_hook', cmd.author, 'ERROR: step hook needs code', undefined, cmdAuthor); break }
              liveHooksRef.current.set(hookId, { id: hookId, author: String(cmd.author || 'ai'), description: String(cmd.description || ''), code })
              ;(sim.worldData as Record<string, unknown>).__sandbox = true
              installHooks(sim, [...liveHooksRef.current.values()], sim.worldData)
              pushTerminal('update_step_hook', cmd.author, `hook "${hookId}" updated (sandboxed) — ${liveHooksRef.current.size} active`, code, cmdAuthor)
              break
            }

            case 'clear_effect': {
              const clearTargetId = cmd.fieldId || undefined
              if (clearTargetId) {
                renderer.removeAllFieldEffects(clearTargetId)
                const field = sim.fields.get(clearTargetId)
                if (field) {
                  field.effects = []
                }
                syncFields()
              } else {
                for (const field of sim.fields.values()) {
                  renderer.removeAllFieldEffects(field.id)
                  field.effects = []
                }
                syncFields()
              }
              setGeneration({ loading: false, error: null, targetFieldId: null })
              break
            }

            case 'clear_all':
              for (const field of sim.fields.values()) {
                renderer.removeAllFieldEffects(field.id)
              }
              sim.clearAll()
              for (const field of sim.fields.values()) {
                field.effects = []
              }
              updateSelectionMask(null)
              setGeneration({ loading: false, error: null, targetFieldId: null })
              syncFields()
              break

            case 'reset':
              // Nuclear reset — remove ALL fields, effects, everything
              for (const field of sim.fields.values()) {
                renderer.removeAllFieldEffects(field.id)
              }
              // Clean up ix_* interaction effect programs
              for (const key of Array.from(renderer.getFieldEffectKeys())) {
                if (key.startsWith('ix_')) {
                  renderer.removeFieldEffect(key)
                  renderer.removeFieldMask(key)
                }
              }
              sim.clearAll()
              sim.fields.clear()
              sim.interactionRules = []
              sim.interactionEffects = []
              sim.customCommands.clear()
              sim.tweens.clear()
              sim.timers.clear()
              sim.collisionCallbacks.clear()
              sim.tagIndex.clear()
              sim.gameState = ''
              sim.gameStates.clear()
              sim.interactionPairs = []
              sim.worldData = {}
              sim.stepHooks.clear()
              cameraFollowRef.current = null
              cachedOverlapMasksRef.current = new Map()
              renderer.clearRegistries()

              updateSelectionMask(null)
              setGeneration({ loading: false, error: null, targetFieldId: null })
              syncFields()
              pushTerminal('reset', undefined, 'Full reset — all fields and rules deleted')
              break

            case 'create_field': {
              // Accept id, fieldId, or fall back to name, then auto-generate
              const id = cmd.id || cmd.fieldId || cmd.name || genFieldId()
              const hue = DEFAULT_HUES[sim.fields.size % DEFAULT_HUES.length]
              const color = cmd.color || hueToRgba(hue)
              const name = cmd.name || `Field ${sim.fields.size + 1}`

              sim.createField(id, name, color, cmd.parentFieldId as string | undefined)

              if (cmd.x !== undefined && cmd.y !== undefined) {
                sim.setPosition(id, cmd.x as number, cmd.y as number)
              }
              // 3D position
              if (cmd.z !== undefined) {
                const f = sim.fields.get(id)
                if (f) f.transform.z = cmd.z as number
              }
              if (cmd.rotX !== undefined || cmd.rotY !== undefined) {
                const f = sim.fields.get(id)
                if (f) {
                  if (cmd.rotX !== undefined) f.transform.rotX = cmd.rotX as number
                  if (cmd.rotY !== undefined) f.transform.rotY = cmd.rotY as number
                }
              }

              // Store shape properties on the field
              const newField = sim.fields.get(id)
              if (newField) {
                // Accept shape as string ('rect'/'circle') or object ({type:'rect', width, height})
                const shapeRaw = cmd.shape || cmd.shapeType
                if (typeof shapeRaw === 'string') {
                  newField.shapeType = shapeRaw as 'circle' | 'rect' | 'screen'
                } else if (shapeRaw && typeof shapeRaw === 'object') {
                  const so = shapeRaw as Record<string, unknown>
                  if (so.type) newField.shapeType = so.type as 'circle' | 'rect' | 'screen'
                  if (so.width !== undefined) newField.w = so.width as number
                  if (so.height !== undefined) newField.h = so.height as number
                  if (so.radius !== undefined) newField.radius = so.radius as number
                }
                // Also accept top-level w/h/radius
                if (cmd.radius !== undefined) newField.radius = cmd.radius as number
                if (cmd.w !== undefined) newField.w = cmd.w as number
                if (cmd.h !== undefined) newField.h = cmd.h as number
                if (cmd.width !== undefined) newField.w = cmd.width as number
                if (cmd.height !== undefined) newField.h = cmd.height as number
                // Visual type for superimposed rendering
                if (cmd.visualType !== undefined) {
                  const vt = cmd.visualType
                  if (typeof vt === 'string') {
                    const resolved = renderer.resolveVisualType(vt)
                    if (resolved !== undefined) {
                      newField.visualType = resolved
                      // Persist the name — numeric IDs shift between sessions
                      newField.visualTypeName = vt
                    }
                  } else if (typeof vt === 'number') {
                    newField.visualType = vt
                  }
                }
                if (cmd.visualParams) {
                  newField.visualParams = cmd.visualParams as [number, number, number, number]
                }
                // Render target assignment
                if (cmd.renderTarget) {
                  newField.properties.set('renderTarget', cmd.renderTarget as string)
                }
                // Sample targets — list of render target names this field reads from
                if (cmd.sampleTargets) {
                  newField.properties.set('sampleTargets', cmd.sampleTargets as string[])
                }
                // Render order for layer stacking
                if (cmd.renderOrder !== undefined) {
                  newField.renderOrder = typeof cmd.renderOrder === 'number' ? cmd.renderOrder : 0
                }
                // NoHit — field renders but doesn't capture mouse clicks
                if (cmd.noHit) {
                  newField.noHit = true
                }
                if (cmd.noCollide) newField.noCollide = true
                // PIXEL-COLLIDE LAW — collision body = rendered pixels, not bounds
                if (cmd.pixelCollide) newField.pixelCollide = true
                // properties (e.g. {static:true}) — the client handler dropped these,
                // so the owner tab's 2s sync then wrote EMPTY properties back over the
                // server's, un-pinning static fields (KEYHOLE ring drifted). Copy them.
                if (cmd.properties && typeof cmd.properties === 'object') {
                  for (const [k, v] of Object.entries(cmd.properties as Record<string, unknown>)) newField.properties.set(k, v)
                }
              }

              setBrush(prev => ({ ...prev, activeFieldId: id }))
              syncFields()
              const parentLabel = cmd.parentFieldId ? ` parent=${cmd.parentFieldId}` : ''
              pushTerminal('create_field', id, `'${name}'${parentLabel}`, undefined, cmdAuthor)
              break
            }

            case 'set_tool':
              setBrush(prev => ({ ...prev, tool: cmd.tool as BrushState['tool'] }))
              break

            case 'field_message': {
              const fromField = sim.fields.get(cmd.fromFieldId)
              const toField = sim.fields.get(cmd.toFieldId)
              const fromName = fromField?.name || cmd.fromFieldId
              const toName = toField?.name || cmd.toFieldId
              setDialogLog(prev => [...prev.slice(-99), {
                from: fromName,
                to: toName,
                fromColor: fromField?.color || [0.5, 0.5, 0.5, 1],
                content: cmd.content,
                data: cmd.data,
                timestamp: Date.now(),
              }])
              sim.addMemory(cmd.fromFieldId, {
                timestamp: new Date().toISOString(),
                type: 'message_sent',
                content: `Sent to ${toName}: "${cmd.content}"`,
                sourceFieldId: cmd.toFieldId,
                data: cmd.data,
              })
              sim.addMemory(cmd.toFieldId, {
                timestamp: new Date().toISOString(),
                type: 'message_received',
                content: `From ${fromName}: "${cmd.content}"`,
                sourceFieldId: cmd.fromFieldId,
                data: cmd.data,
              })
              syncFields()
              break
            }

            case 'move': {
              const field = sim.fields.get(cmd.fieldId)
              if (!field) break
              field.transform.x += cmd.dx
              field.transform.y += cmd.dy
              syncFields()
              pushTerminal('move', cmd.fieldId, `(${cmd.dx}, ${cmd.dy})`)
              break
            }

            case 'delete_field': {
              const delField = sim.fields.get(cmd.fieldId)
              if (!delField) {
                pushTerminal('delete_field', cmd.fieldId, 'ERROR: field not found')
                break
              }
              const delName = delField.name
              renderer.removeAllFieldEffects(cmd.fieldId)
              sim.removeField(cmd.fieldId)
              syncFields()
              pushTerminal('delete_field', cmd.fieldId, `'${delName}' deleted`)
              break
            }

            case 'set_parent': {
              const field = sim.fields.get(cmd.fieldId)
              if (!field) {
                pushTerminal('set_parent', cmd.fieldId, 'ERROR: field not found')
                break
              }
              const success = sim.setParent(cmd.fieldId, cmd.parentFieldId as string | undefined)
              if (success) {
                syncFields()
                pushTerminal('set_parent', cmd.fieldId, cmd.parentFieldId ? `parent=${cmd.parentFieldId}` : 'parent cleared')
              } else {
                pushTerminal('set_parent', cmd.fieldId, `ERROR: invalid parent (not found, cycle, or depth limit exceeded)`)
              }
              break
            }

            case 'set_position': {
              const posField = sim.fields.get(cmd.fieldId)
              if (!posField) break
              sim.setPosition(cmd.fieldId, cmd.x, cmd.y)
              if (cmd.z !== undefined) posField.transform.z = cmd.z as number
              if (cmd.rotX !== undefined) posField.transform.rotX = cmd.rotX as number
              if (cmd.rotY !== undefined) posField.transform.rotY = cmd.rotY as number
              syncFields()
              pushTerminal('set_position', cmd.fieldId, `(${cmd.x}, ${cmd.y}${cmd.z !== undefined ? `, z=${cmd.z}` : ''})`)
              break
            }

            case 'set_color': {
              const field = sim.fields.get(cmd.fieldId)
              if (!field) break
              if (Array.isArray(cmd.color) && cmd.color.length >= 3) {
                field.color = [cmd.color[0], cmd.color[1], cmd.color[2], cmd.color[3] ?? 1.0]
              }
              syncFields()
              pushTerminal('set_color', cmd.fieldId, `[${field.color.map((c: number) => c.toFixed(2)).join(', ')}]`)
              break
            }

            case 'set_scale': {
              const field = sim.fields.get(cmd.fieldId)
              if (!field) break
              field.transform.scale = (cmd.scale as number) || 1.0
              syncFields()
              pushTerminal('set_scale', cmd.fieldId, `scale=${field.transform.scale.toFixed(2)}`)
              break
            }

            case 'set_order': {
              const field = sim.fields.get(cmd.fieldId)
              if (!field) break
              field.renderOrder = typeof cmd.order === 'number' ? cmd.order : 0
              syncFields()
              pushTerminal('set_order', cmd.fieldId, `order=${field.renderOrder}`)
              break
            }

            case 'set_shape': {
              const field = sim.fields.get(cmd.fieldId)
              if (!field) break
              const shapeVal = ((cmd as Record<string, unknown>).shape || (cmd as Record<string, unknown>).shapeType) as 'circle' | 'rect' | 'screen' | undefined
              if (shapeVal) field.shapeType = shapeVal
              if ((cmd as Record<string, unknown>).radius !== undefined) field.radius = (cmd as Record<string, unknown>).radius as number
              if ((cmd as Record<string, unknown>).w !== undefined) field.w = (cmd as Record<string, unknown>).w as number
              if ((cmd as Record<string, unknown>).h !== undefined) field.h = (cmd as Record<string, unknown>).h as number
              syncFields()
              const shapeDesc = field.shapeType === 'circle' ? `circle r=${field.radius}` : field.shapeType === 'screen' ? `screen ${field.w}x${field.h}` : `rect ${field.w}x${field.h}`
              pushTerminal('set_shape', cmd.fieldId, shapeDesc)
              break
            }

            case 'set_name': {
              const field = sim.fields.get(cmd.fieldId)
              if (!field) break
              const oldName = field.name
              field.name = (cmd.name as string) || field.name
              syncFields()
              pushTerminal('set_name', cmd.fieldId, `"${oldName}" -> "${field.name}"`)
              break
            }


            case 'set_property': {
              const propField = sim.fields.get(cmd.fieldId)
              if (!propField) {
                pushTerminal('set_property', cmd.fieldId, 'ERROR: field not found')
                break
              }
              const key = cmd.key as string
              const value = cmd.value
              if (!key) {
                pushTerminal('set_property', cmd.fieldId, 'ERROR: key required')
                break
              }
              propField.properties.set(key, value)
              syncFields()
              pushTerminal('set_property', cmd.fieldId, `${key} = ${JSON.stringify(value)}`)
              break
            }

            case 'get_properties': {
              const gpField = sim.fields.get(cmd.fieldId)
              if (!gpField) {
                pushTerminal('get_properties', cmd.fieldId, 'ERROR: field not found')
                break
              }
              const props = Object.fromEntries(gpField.properties)
              pushTerminal('get_properties', cmd.fieldId, JSON.stringify(props).substring(0, 200))
              break
            }

            case 'set_world_params': {
              if (!cmd.params || typeof cmd.params !== 'object') break
              sim.setWorldParams(cmd.params)
              if (cmd.params.gravity || cmd.params.friction || cmd.params.collisionForce) {
                if (!sim.running) {
                  sim.running = true
                  setRunning(true)
                }
              }
              syncFields()
              pushTerminal('set_world_params', undefined, JSON.stringify(cmd.params))
              break
            }

            case 'apply_force': {
              sim.applyForce(cmd.fieldId, cmd.fx, cmd.fy)
              if (!sim.running) {
                sim.running = true
                setRunning(true)
              }
              syncFields()
              pushTerminal('apply_force', cmd.fieldId, `(${cmd.fx}, ${cmd.fy})`)
              break
            }

            case 'set_world_data': {
              const wdKeys = (cmd.data && typeof cmd.data === 'object') ? Object.keys(cmd.data) : []
              // Apply to sim.worldData
              if (cmd.data && typeof cmd.data === 'object') {
                Object.assign(sim.worldData, cmd.data)
              }
              // Pipe narrative channel messages into dialog panel
              const narr = cmd.data?.narrative as { channel?: Array<{ author: string; text: string; time?: number }> } | undefined
              if (narr?.channel) {
                const prevLen = (sim.worldData as Record<string, unknown>).__narrativeLen as number || 0
                const newMsgs = narr.channel.slice(prevLen)
                for (const msg of newMsgs) {
                  setDialogLog(prev => [...prev.slice(-99), {
                    from: msg.author || '?',
                    to: 'all',
                    fromColor: msg.author === 'Alpha' ? [0.9, 0.3, 0.1, 1] as [number, number, number, number]
                      : msg.author === 'Beta' ? [0.1, 0.6, 0.9, 1] as [number, number, number, number]
                      : msg.author === 'Gamma' ? [0.2, 0.9, 0.4, 1] as [number, number, number, number]
                      : [0.7, 0.7, 0.7, 1] as [number, number, number, number],
                    content: msg.text,
                    timestamp: Date.now(),
                  }])
                }
                ;(sim.worldData as Record<string, unknown>).__narrativeLen = narr.channel.length
              }
              pushTerminal('set_world_data', cmd.fieldId, wdKeys.join(', ') || '(no data)')
              break
            }

            case 'define_interaction': {
              // Route: if cmd.wgsl is present, this is a superimposed interaction (a + b = c)
              if (cmd.wgsl) {
                const name = cmd.name as string
                const wgsl = cmd.wgsl as string
                const fieldA = cmd.fieldA as string
                const fieldB = cmd.fieldB as string
                if (!name) { pushTerminal('define_interaction', '', 'ERROR: name required'); break }
                if (!fieldA || !fieldB) { pushTerminal('define_interaction', name, 'ERROR: fieldA and fieldB required'); break }
                const expectedFn = `interaction_${name}`
                if (!wgsl.includes(expectedFn)) {
                  pushTerminal('define_interaction', name, `ERROR: WGSL must define fn ${expectedFn}(uvA: vec2f, uvB: vec2f, colorA: vec4f, colorB: vec4f, time: f32) -> vec4f`)
                  break
                }
                const result = renderer.registerInteraction(name, wgsl)
                // Resolve optional propagation type
                const propagationName = cmd.propagation as string | undefined
                const propagationTypeId = propagationName ? renderer.resolvePropagation(propagationName) : undefined
                if (!sim.interactionPairs) sim.interactionPairs = []
                sim.interactionPairs = sim.interactionPairs.filter((p: { name: string }) => p.name !== name)
                sim.interactionPairs.push({ name, fieldA, fieldB, interactionTypeId: result.id, propagationTypeId })
                const propLabel = propagationName ? ` propagation: ${propagationName}` : ''
                pushTerminal('define_interaction', name, `${fieldA} + ${fieldB} = ${name} (type ${result.id})${propLabel}`, undefined, cmdAuthor)
                break
              }
              // Legacy: interaction rule system
              const rule = cmd.rule
              if (!rule || !rule.trigger || !rule.effect) {
                pushTerminal('define_interaction', (rule as Record<string, unknown>)?.definedBy as string, 'ERROR: missing trigger or effect')
                break
              }
              const ruleId = sim.addInteractionRule({
                id: (rule as Record<string, unknown>).id as string || '',
                definedBy: rule.definedBy || 'unknown',
                trigger: rule.trigger,
                triggerDistance: rule.triggerDistance,
                fieldA: rule.fieldA,
                fieldB: rule.fieldB,
                effect: rule.effect,
                effectParams: rule.effectParams || {},
                description: rule.description,
              })
              if (!sim.running) {
                sim.running = true
                setRunning(true)
              }
              syncFields()
              pushTerminal('define_interaction', rule.definedBy, rule.description || `${rule.trigger} → ${rule.effect}`, `rule_id: ${ruleId}`)
              break
            }

            case 'remove_interaction': {
              if (cmd.ruleId) {
                sim.removeInteractionRule(cmd.ruleId)
                syncFields()
                pushTerminal('remove_interaction', undefined, cmd.ruleId)
              }
              break
            }

            case 'add_interaction_effect': {
              const ixWgsl = ((cmd as Record<string, unknown>).wgsl || (cmd as Record<string, unknown>).glsl) as string
              if (!ixWgsl) {
                pushTerminal('add_interaction_effect', (cmd as Record<string, unknown>).author as string, 'ERROR: wgsl required')
                break
              }
              // Validate the wrapped WGSL before adding
              const wrappedWgsl = wrapInteractionWgsl(ixWgsl)
              const testKey = `ix_validate_${Date.now()}`
              const compileResult = await renderer.compileFieldEffect(testKey, testKey, wrappedWgsl, getModCode())
              if (!compileResult.success) {
                pushTerminal('add_interaction_effect', (cmd as Record<string, unknown>).author as string, `WGSL error: ${compileResult.error}`)
                renderer.removeFieldEffect(testKey)
                renderer.removeFieldMask(testKey)
                break
              }
              // Clean up validation program — real programs are compiled per-pair in the frame loop
              renderer.removeFieldEffect(testKey)
              renderer.removeFieldMask(testKey)

              const effectId = sim.addInteractionEffect({
                author: (cmd as Record<string, unknown>).author as string || 'unknown',
                fieldA: (cmd as Record<string, unknown>).fieldA as string || null,
                fieldB: (cmd as Record<string, unknown>).fieldB as string || null,
                wgsl: ixWgsl,
                description: (cmd as Record<string, unknown>).description as string || '',
                blend: ((cmd as Record<string, unknown>).blend as 'alpha' | 'additive' | 'multiply') || 'alpha',
                spread: (cmd as Record<string, unknown>).spread as number || 0,
                order: (cmd as Record<string, unknown>).order as number || 0,
                precedence: !!(cmd as Record<string, unknown>).precedence,
                hooks: ((cmd as Record<string, unknown>).hooks as InteractionEffect['hooks'] || [])
                  ?.filter(h => h.type !== 'webhook') || undefined,
              })
              const fieldALabel = (cmd as Record<string, unknown>).fieldA as string || 'any'
              const fieldBLabel = (cmd as Record<string, unknown>).fieldB as string || 'any'
              pushTerminal('add_interaction_effect', (cmd as Record<string, unknown>).author as string,
                (cmd as Record<string, unknown>).description as string || `${fieldALabel} × ${fieldBLabel}`,
                `id: ${effectId}`, cmdAuthor)
              syncFields()
              break
            }

            case 'remove_interaction_effect': {
              const effectId = (cmd as Record<string, unknown>).effectId as string
              if (effectId) {
                sim.removeInteractionEffect(effectId)
                // Clean up any compiled per-pair programs for this effect
                for (const key of Array.from(renderer.getFieldEffectKeys())) {
                  if (key.startsWith(`ix_${effectId}_`)) {
                    renderer.removeFieldEffect(key)
                    renderer.removeFieldMask(key)
                  }
                }
                syncFields()
                pushTerminal('remove_interaction_effect', undefined, effectId)
              }
              break
            }

            case 'define_command': {
              const cmdDef = cmd.command
              if (!cmdDef || !cmdDef.name || !cmdDef.macro || cmdDef.macro.length === 0) {
                pushTerminal('define_command', cmdDef?.definedBy, 'ERROR: name and macro required')
                break
              }
              sim.addCustomCommand({
                name: cmdDef.name,
                definedBy: cmdDef.definedBy || 'unknown',
                description: cmdDef.description || '',
                macro: cmdDef.macro,
              })
              pushTerminal('define_command', cmdDef.definedBy, `"${cmdDef.name}" (${cmdDef.macro.length} steps)`)
              break
            }

            case 'execute_command': {
              const customCmd = sim.getCustomCommand(cmd.name)
              pushTerminal('execute_command', customCmd?.definedBy, `"${cmd.name}" — ${customCmd ? `${customCmd.macro.length} steps (expanded by bridge)` : 'unknown command'}`)
              break
            }

            case 'add_step_hook': {
              // Allowed for everyone — runs ONLY in the sealed Worker sandbox.
              // `id` accepted as an alias for `hookId`/`name` (see update_step_hook).
              const hookId = (cmd.hookId as string) || (cmd.name as string) || (cmd.id as string) || `hook_${Date.now()}`
              const code = String(cmd.code || '')
              if (!code) { pushTerminal('add_step_hook', cmd.author, 'ERROR: step hook needs code', undefined, cmdAuthor); break }
              liveHooksRef.current.set(hookId, { id: hookId, author: String(cmd.author || 'ai'), description: String(cmd.description || ''), code })
              ;(sim.worldData as Record<string, unknown>).__sandbox = true
              installHooks(sim, [...liveHooksRef.current.values()], sim.worldData)
              pushTerminal('add_step_hook', cmd.author, `hook "${hookId}" installed (sandboxed) — ${liveHooksRef.current.size} active`, code, cmdAuthor)
              break
            }
            case 'remove_step_hook': {
              const hookId = (cmd.hookId as string) || (cmd.name as string) || (cmd.id as string) || ''
              liveHooksRef.current.delete(hookId)
              installHooks(sim, [...liveHooksRef.current.values()], sim.worldData)
              pushTerminal('remove_step_hook', cmd.author, `hook "${hookId}" removed — ${liveHooksRef.current.size} active`, undefined, cmdAuthor)
              break
            }

            case 'save_world': {
              // finish-the-creation: snapshot the live world as a NAMED store
              // scene. Main's shelf polls the store, so the new world appears
              // there automatically — no manual promotion step.
              const nm = String((cmd as { name?: string }).name || '').trim().toUpperCase()
              if (!nm) { pushTerminal('save_world', cmd.author, 'ERROR: name required', undefined, cmdAuthor); break }
              saveSceneAs(nm).then(ok => pushTerminal('save_world', cmd.author,
                ok ? `world "${nm}" saved — it joins main's shelf on its next breath` : 'ERROR: nothing to save', undefined, cmdAuthor))
              break
            }

            case 'add_gpu_step_hook': {
              if (!cmd.hookId && cmd.name) cmd.hookId = cmd.name
              const wgsl = cmd.wgsl as string
              if (!cmd.hookId || !wgsl) {
                pushTerminal('add_gpu_step_hook', cmd.author, 'ERROR: hookId and wgsl required', undefined, cmdAuthor)
                break
              }
              const gpuErr = sim.addGpuStepHook(cmd.hookId, cmd.author || 'unknown', cmd.description || '', wgsl, cmd.order as number | undefined)
              if (!gpuErr) {
                if (!sim.running) { sim.running = true; setRunning(true) }
                pushTerminal('add_gpu_step_hook', cmd.author, `"${cmd.hookId}": ${cmd.description || 'GPU step hook added'}`, wgsl, cmdAuthor)
              } else {
                pushTerminal('add_gpu_step_hook', cmd.author, `ERROR for "${cmd.hookId}": ${gpuErr}`, wgsl, cmdAuthor)
              }
              syncFields()
              break
            }

            case 'remove_gpu_step_hook': {
              if (cmd.hookId) {
                sim.removeGpuStepHook(cmd.hookId)
                pushTerminal('remove_gpu_step_hook', undefined, `removed GPU hook ${cmd.hookId}`)
              }
              break
            }

            case 'add_state_shader': {
              // GPU state update shader — runs each frame via render-to-texture ping-pong
              // Agent provides cellUpdate(coord, state, color, time, dt) function
              const stateShader = (cmd.wgsl || cmd.glsl) as string
              if (stateShader) {
                const stateResult = await renderer.compileStateUpdate(stateShader, getModCode())
                if (data.id) fetch('/api/engine/compile-result', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ commandId: data.id, result: stateResult.success ? { ok: true } : { ok: false, error: (stateResult.error || '').slice(0, 300) } }) }).catch(() => {})
                if (stateResult.success) {
                  pushTerminal('add_state_shader', cmd.fieldId, cmd.description || 'state update shader active', stateShader, cmd.author as string)
                } else {
                  pushTerminal('add_state_shader', cmd.fieldId, `STATE SHADER COMPILE ERROR: ${stateResult.error?.substring(0, 100)}`)
                  sim.worldData['last_compile_error'] = {
                    type: 'state_shader',
                    error: stateResult.error,
                    timestamp: Date.now()
                  }
                }
              }
              break
            }

            case 'remove_state_shader': {
              renderer.removeStateUpdate()
              pushTerminal('remove_state_shader', undefined, 'state update shader removed')
              break
            }

            case 'clone_field': {
              const sourceField = sim.fields.get(cmd.fieldId)
              if (!sourceField) {
                pushTerminal('clone_field', cmd.fieldId, 'ERROR: source field not found')
                break
              }
              const cloneId = genFieldId()
              const cloneName = (cmd.name as string) || `${sourceField.name} (clone)`
              const cloneColor = (cmd.color as [number, number, number, number]) || [...sourceField.color] as [number, number, number, number]

              sim.createField(cloneId, cloneName, cloneColor)
              
              // Copy position with optional offset
              const offsetX = (cmd.offsetX as number) || 30
              const offsetY = (cmd.offsetY as number) || 0
              sim.setPosition(cloneId, sourceField.transform.x + offsetX, sourceField.transform.y + offsetY)
              
              // Clone effects
              for (const effect of sourceField.effects) {
                const newEffectId = genEffectId()
                const programKey = `${cloneId}_${newEffectId}`
                const result = await renderer.compileFieldEffect(programKey, cloneId, effect.wgsl, getModCode())
                if (result.success) {
                  sim.addFieldEffect(cloneId, {
                    id: newEffectId,
                    author: effect.author,
                    wgsl: effect.wgsl,
                    description: effect.description,
                    blend: effect.blend,
                    order: effect.order,
                    feedback: effect.feedback,
                  })
                }
              }
              
              syncFields()
              pushTerminal('clone_field', cmd.fieldId, `cloned as '${cloneName}' (id: ${cloneId})`)
              break
            }

            case 'list_fields': {
              const fieldList = Array.from(sim.fields.values()).map(f => {
                return `${f.name} [${f.id}] at (${f.transform.x.toFixed(0)},${f.transform.y.toFixed(0)}) effects=${f.effects.length}`
              })
              pushTerminal('list_fields', undefined, `${sim.fields.size} fields`, fieldList.join('\n'))
              break
            }

            // --- Lightweight effect commands (no field creation) ---
            case 'spawn_effect': {
              const ex = cmd.x as number, ey = cmd.y as number
              const et = (cmd.effectType as number) || 1
              const ec = (cmd.color as number) || 0.5
              const es2 = (cmd.size as number) || 2
              const ei = (cmd.intensity as number) || 1.0
              if (cmd.offsets && Array.isArray(cmd.offsets)) {
                sim.stampEffectShape(ex, ey, cmd.offsets as [number, number][], et, ec, 1.0, ei)
              } else {
                sim.stampEffectCircle(ex, ey, es2, et, ec, 1.0, ei)
              }
              break
            }

            case 'spawn_projectile': {
              const px = cmd.x as number, py = cmd.y as number
              const pvx = (cmd.vx as number) || 0, pvy = (cmd.vy as number) || 0
              const pt = (cmd.effectType as number) || 1
              const pc = (cmd.color as number) || 0.5
              const ps = (cmd.size as number) || 2
              const pi = (cmd.intensity as number) || 1.0
              const pl = (cmd.lifetime as number) || 3.0
              sim.spawnProjectile(px, py, pvx, pvy, pt, pc, ps, pi, pl)
              break
            }

            case 'clear_effects': {
              const cx = cmd.x as number, cy = cmd.y as number
              const cr = (cmd.radius as number) || 50
              sim.clearEffects(cx, cy, cr)
              break
            }

            // --- WGSL Mod commands ---
            case 'register_wgsl_mod':
            case 'register_glsl_mod': {
              const modId = cmd.id as string
              const modCode = cmd.code as string
              if (!modId || !modCode) {
                pushTerminal('register_wgsl_mod', undefined, 'ERROR: id and code required')
                break
              }
              wgslModsRef.current.set(modId, { id: modId, code: modCode })
              pushTerminal('register_wgsl_mod', undefined, `Registered mod "${modId}" (${modCode.length} chars)`)
              break
            }

            case 'remove_wgsl_mod':
            case 'remove_glsl_mod': {
              const modId = cmd.id as string
              if (!modId) {
                pushTerminal('remove_wgsl_mod', undefined, 'ERROR: id required')
                break
              }
              const existed = wgslModsRef.current.delete(modId)
              pushTerminal('remove_wgsl_mod', undefined, existed ? `Removed mod "${modId}"` : `Mod "${modId}" not found`)
              break
            }

            case 'sample_region': {
              const srX = cmd.x as number ?? 256
              const srY = cmd.y as number ?? 256
              const srRadius = Math.min(cmd.radius as number ?? 16, 64) // cap at 64
              const srResult = sim.sampleRegion(srX, srY, srRadius)
              pushTerminal('sample_region', undefined, `(${srX},${srY}) r=${srRadius}: ${srResult.uniqueFieldIds.length} fields, avg=(${srResult.avgColor.map(c => c.toFixed(2)).join(',')})`)
              break
            }

            // ─── Game Engine Commands ───

            case 'set_camera': {
              if (cmd.follow) {
                cameraFollowRef.current = {
                  targetFieldId: cmd.follow as string,
                  smoothing: (cmd.smoothing as number) ?? 0.1,
                  offsetX: (cmd.offsetX as number) ?? 0,
                  offsetY: (cmd.offsetY as number) ?? 0,
                  deadZone: (cmd.deadZone as number) ?? 5,
                }
                pushTerminal('set_camera', cmd.follow as string, `following, smoothing=${cameraFollowRef.current.smoothing}`)
              } else if (cmd.follow === null || cmd.follow === false) {
                cameraFollowRef.current = null
                pushTerminal('set_camera', undefined, 'follow disabled')
              }
              if (cmd.x !== undefined && cmd.y !== undefined) {
                cameraRef.current.x = cmd.x as number
                cameraRef.current.y = cmd.y as number
              }
              if (cmd.zoom !== undefined) {
                cameraRef.current.zoom = Math.max(0.1, Math.min(10, cmd.zoom as number))
              }
              break
            }

            case 'save_scene': {
              const sceneName = cmd.name as string
              if (!sceneName) { pushTerminal('save_scene', undefined, 'ERROR: name required'); break }
              // 'notBroken': quarantined visuals are not persisted — a broken shader
              // must not circulate through the store forever.
              const sceneData = serializeSceneDocument(sim, renderer, {
                name: sceneName,
                stepHooks: allStepHookSnapshots(sim),
                visualScope: 'notBroken',
              })
              try {
                await fetch('/api/engine/scene', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ action: 'save', name: sceneName, scene: sceneData }),
                })
                pushTerminal('save_scene', undefined, `"${sceneName}" saved (${sceneData.fields.length} fields)`)
              } catch { pushTerminal('save_scene', undefined, `ERROR: failed to save "${sceneName}"`) }
              break
            }

            case 'load_scene': {
              const sceneName = cmd.name as string
              if (!sceneName) { pushTerminal('load_scene', undefined, 'ERROR: name required'); break }
              try {
                const resp = await fetch(`/api/engine/scene?name=${encodeURIComponent(sceneName)}`)
                const { scene } = await resp.json()
                if (!scene) { pushTerminal('load_scene', undefined, `ERROR: scene "${sceneName}" not found`); break }

                // Clear current state
                for (const field of sim.fields.values()) {
                  renderer.removeAllFieldEffects(field.id)
                }
                for (const key of Array.from(renderer.getFieldEffectKeys())) {
                  if (key.startsWith('ix_')) { renderer.removeFieldEffect(key); renderer.removeFieldMask(key) }
                }
                sim.clearAll()
                sim.fields.clear()
                sim.interactionRules = []
                sim.interactionEffects = []
                sim.stepHooks.clear()
                sim.tweens.clear()
                sim.timers.clear()
                sim.collisionCallbacks.clear()
                cachedOverlapMasksRef.current = new Map()

                // a loaded scene starts framed whole, not wherever the camera
                // was. CONTAIN, not cover — backed out a touch (FIT_ZOOM) so
                // the chrome doesn't overflow the grid (see the fit effect above).
                cameraRef.current = { x: gridSize / 2, y: gridSize / 2, zoom: FIT_ZOOM }

                // Restore modules FIRST, visuals second (a visual compiled
                // before its modules land gets falsely quarantined)
                if (scene.modules) {
                  for (const m of scene.modules) {
                    renderer.registerModule(m.name, m.wgsl)
                  }
                }
                if (scene.visualTypes) {
                  for (const vt of scene.visualTypes) {
                    renderer.registerVisualType(vt.name, vt.wgsl)
                  }
                }

                // Restore scene
                sim.restoreFromSnapshots(scene.fields || [])
                // Name is authoritative — resolve visual types against this
                // session's registry (numeric IDs shift between sessions)
                for (const field of sim.fields.values()) {
                  if (field.visualTypeName) {
                    const runtimeId = renderer.resolveVisualType(field.visualTypeName)
                    if (runtimeId !== undefined) field.visualType = runtimeId
                  }
                }
                if (scene.worldParams) sim.setWorldParams(scene.worldParams)
                if (scene.worldData) Object.assign(sim.worldData, scene.worldData)
                // Transient input state must never arrive via a scene
                for (const k of Object.keys(sim.worldData)) {
                  if (k.startsWith('key_') || k.startsWith('mouse_')) delete sim.worldData[k]
                }
                if (scene.interactionRules) sim.interactionRules = scene.interactionRules
                if (scene.interactionEffects) {
                  for (const ie of scene.interactionEffects) sim.addInteractionEffect(ie)
                }
                if (scene.stepHooks) {
                  // through installHooks: resets the liveHooksRef mirror (else the
                  // PREVIOUS world's sandbox hooks leak into this world's saves) and
                  // honors __sandbox so untrusted hooks never hit the main thread
                  installHooks(sim, scene.stepHooks, sim.worldData)
                  // A scene with logic should boot running (game cartridges)
                  if (scene.stepHooks.length > 0 && !sim.running) {
                    sim.running = true
                    setRunning(true)
                  }
                }

                // Recompile effects
                for (const field of sim.fields.values()) {
                  for (const effect of field.effects) {
                    const programKey = `${field.id}_${effect.id}`
                    await renderer.compileFieldEffect(programKey, field.id, effect.wgsl, getModCode())
                  }
                }

                updateSelectionMask(null)
                syncFields()
                pushTerminal('load_scene', undefined, `"${sceneName}" loaded (${scene.fields?.length || 0} fields)`)
              } catch { pushTerminal('load_scene', undefined, `ERROR: failed to load "${sceneName}"`) }
              break
            }

            case 'list_scenes': {
              try {
                const resp = await fetch('/api/engine/scene?action=list')
                const { scenes } = await resp.json()
                pushTerminal('list_scenes', undefined, `${(scenes as string[])?.length || 0} scenes`, (scenes as string[])?.join(', ') || 'none')
              } catch { pushTerminal('list_scenes', undefined, 'ERROR: failed to list scenes') }
              break
            }

            case 'delete_scene': {
              const sceneName = cmd.name as string
              if (!sceneName) { pushTerminal('delete_scene', undefined, 'ERROR: name required'); break }
              try {
                await fetch('/api/engine/scene', {
                  method: 'DELETE',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ name: sceneName }),
                })
                pushTerminal('delete_scene', undefined, `"${sceneName}" deleted`)
              } catch { pushTerminal('delete_scene', undefined, `ERROR: failed to delete "${sceneName}"`) }
              break
            }

            case 'play_sound': {
              const audio = audioRef.current
              if (cmd.id && audio.hasSound(cmd.id as string)) {
                audio.play(cmd.id as string, (cmd.volume as number) ?? 1.0, (cmd.pitch as number) ?? 1.0)
                pushTerminal('play_sound', undefined, `"${cmd.id}"`)
              } else if (cmd.frequency) {
                audio.beep(cmd.frequency as number, (cmd.duration as number) ?? 0.2, (cmd.volume as number) ?? 0.5, (cmd.type as OscillatorType) ?? 'sine')
                pushTerminal('play_sound', undefined, `beep ${cmd.frequency}Hz`)
              } else {
                pushTerminal('play_sound', undefined, 'ERROR: id or frequency required')
              }
              break
            }

            case 'load_sound': {
              if (!cmd.id || !cmd.url) { pushTerminal('load_sound', undefined, 'ERROR: id and url required'); break }
              const loaded = await audioRef.current.loadSound(cmd.id as string, cmd.url as string)
              pushTerminal('load_sound', undefined, loaded ? `"${cmd.id}" loaded` : `ERROR: failed to load "${cmd.id}"`)
              break
            }

            case 'set_volume': {
              audioRef.current.setVolume((cmd.volume as number) ?? 1.0)
              pushTerminal('set_volume', undefined, `${audioRef.current.getVolume().toFixed(2)}`)
              break
            }

            case 'set_game_state': {
              const stateName = cmd.state as string
              if (!stateName) { pushTerminal('set_game_state', undefined, 'ERROR: state required'); break }
              sim.setGameState(stateName)
              pushTerminal('set_game_state', undefined, `→ "${stateName}"`)
              break
            }

            case 'define_game_state': {
              const stateName = cmd.name as string
              if (!stateName) { pushTerminal('define_game_state', undefined, 'ERROR: name required'); break }
              sim.defineGameState(stateName, {
                name: stateName,
                onEnter: cmd.onEnter as string | undefined,
                onExit: cmd.onExit as string | undefined,
                pausePhysics: !!(cmd.pausePhysics),
              })
              pushTerminal('define_game_state', undefined, `"${stateName}" defined${cmd.pausePhysics ? ' (pauses physics)' : ''}`)
              break
            }

            case 'add_tag': {
              const fieldId = cmd.fieldId as string
              const tags = cmd.tags as string[]
              if (!fieldId || !tags?.length) { pushTerminal('add_tag', cmd.fieldId, 'ERROR: fieldId and tags required'); break }
              sim.addTag(fieldId, tags)
              syncFields()
              pushTerminal('add_tag', fieldId, tags.join(', '))
              break
            }

            case 'remove_tag': {
              const fieldId = cmd.fieldId as string
              const tags = cmd.tags as string[]
              if (!fieldId || !tags?.length) { pushTerminal('remove_tag', cmd.fieldId, 'ERROR: fieldId and tags required'); break }
              sim.removeTag(fieldId, tags)
              syncFields()
              pushTerminal('remove_tag', fieldId, tags.join(', '))
              break
            }

            case 'set_visual': {
              const fieldId = cmd.fieldId as string
              if (!fieldId) { pushTerminal('set_visual', '', 'ERROR: fieldId required'); break }
              const field = sim.fields.get(fieldId)
              if (!field) { pushTerminal('set_visual', fieldId, 'ERROR: field not found'); break }
              const vt = cmd.visualType
              if (vt !== undefined) {
                if (typeof vt === 'string') {
                  const resolved = renderer.resolveVisualType(vt)
                  if (resolved !== undefined) {
                    field.visualType = resolved
                    field.visualTypeName = vt
                  }
                } else if (typeof vt === 'number') {
                  field.visualType = vt
                } else if (vt === null) {
                  field.visualType = undefined
                  field.visualTypeName = undefined
                }
              }
              if (cmd.visualParams !== undefined) {
                field.visualParams = cmd.visualParams as [number, number, number, number]
              }
              if (cmd.renderTarget !== undefined) {
                if (cmd.renderTarget === null) {
                  field.properties.delete('renderTarget')
                } else {
                  field.properties.set('renderTarget', cmd.renderTarget as string)
                }
              }
              if (cmd.sampleTargets !== undefined) {
                if (cmd.sampleTargets === null) {
                  field.properties.delete('sampleTargets')
                } else {
                  field.properties.set('sampleTargets', cmd.sampleTargets as string[])
                }
              }
              if (cmd.renderOrder !== undefined) {
                field.renderOrder = typeof cmd.renderOrder === 'number' ? cmd.renderOrder : 0
              }
              syncFields()
              pushTerminal('set_visual', fieldId, `type=${field.visualType} order=${field.renderOrder ?? 0}`, undefined, cmdAuthor)
              break
            }

            case 'define_visual': {
              const name = cmd.name as string
              const wgsl = cmd.wgsl as string
              if (!name) { pushTerminal('define_visual', '', 'ERROR: name required'); break }
              if (!wgsl) { pushTerminal('define_visual', name, 'ERROR: wgsl required'); break }
              // Validate function name matches
              const expectedFn = `visual_${name}`
              if (!wgsl.includes(expectedFn)) {
                pushTerminal('define_visual', name, `ERROR: WGSL must define fn ${expectedFn}(uv: vec2f, sdf: f32, color: vec4f, time: f32, params: vec4f, behind: vec4f) -> vec4f`)
                break
              }
              const result = renderer.registerVisualType(name, wgsl)
              pushTerminal('define_visual', name, `registered as type ${result.id}`, undefined, cmdAuthor)
              // Force-compile uber-shader and report result back to server
              const dvCommandId = data.id as string | undefined
              ;(async () => {
                const compileStatus = await renderer.compileSuperPipeline()
                const compileErr = compileStatus.error
                const curSim = simulationRef.current
                if (compileErr) {
                  if (curSim) {
                    curSim.worldData['last_compile_error'] = {
                      type: 'uber_shader',
                      visualName: name,
                      error: compileErr,
                      timestamp: Date.now(),
                    }
                  }
                  pushTerminal('define_visual', name, `COMPILE ERROR: ${compileErr.substring(0, 200)}`)
                  showToast(`Shader "${name}" failed to compile`, 'error')
                } else if (curSim && curSim.worldData['last_compile_error']) {
                  delete curSim.worldData['last_compile_error']
                }
                // Send compile result back to server for bridge API response
                if (dvCommandId) {
                  try {
                    await fetch('/api/engine/compile-result', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        commandId: dvCommandId,
                        result: compileErr
                          ? { ok: false, error: compileErr }
                          : { ok: true, visualName: name, typeId: result.id },
                      }),
                    })
                  } catch { /* best-effort */ }
                }
              })()
              break
            }

            case 'undo_visual': {
              const name = cmd.name as string
              if (!name) { pushTerminal('undo_visual', '', 'ERROR: name required'); break }
              // undo_visual arrives as define_visual from bridge (with restored WGSL)
              // This case handles direct SSE delivery if ever sent raw
              pushTerminal('undo_visual', name, 'no WGSL — use define_visual path')
              break
            }

            case 'define_propagation': {
              const name = cmd.name as string
              const wgsl = cmd.wgsl as string
              if (!name) { pushTerminal('define_propagation', '', 'ERROR: name required'); break }
              if (!wgsl) { pushTerminal('define_propagation', name, 'ERROR: wgsl required'); break }
              const expectedFn = `propagation_${name}`
              if (!wgsl.includes(expectedFn)) {
                pushTerminal('define_propagation', name, `ERROR: WGSL must define fn ${expectedFn}(srcColor: vec4f, offset: vec2f, dist: f32, time: f32) -> vec4f`)
                break
              }
              const result = renderer.registerPropagation(name, wgsl)
              pushTerminal('define_propagation', name, `registered as type ${result.id}`, undefined, cmdAuthor)
              break
            }

            case 'define_module': {
              const name = cmd.name as string
              const wgsl = cmd.wgsl as string
              if (!name) { pushTerminal('define_module', '', 'ERROR: name required'); break }
              if (!wgsl) { pushTerminal('define_module', name, 'ERROR: wgsl required'); break }
              const expectedFn = `mod_${name}`
              if (!wgsl.includes(expectedFn)) {
                pushTerminal('define_module', name, `ERROR: WGSL must define fn ${expectedFn}(...)`)
                break
              }
              renderer.registerModule(name, wgsl)
              pushTerminal('define_module', name, 'registered', undefined, cmdAuthor)
              break
            }

            case 'create_render_target': {
              const name = cmd.name as string
              if (!name) { pushTerminal('create_render_target', '', 'ERROR: name required'); break }
              const result = renderer.createRenderTarget(name, cmd.persist as boolean | undefined)
              if (result.error) {
                pushTerminal('create_render_target', name, `ERROR: ${result.error}`)
              } else {
                pushTerminal('create_render_target', name, `created (id=${result.id}${cmd.persist ? ', persist' : ''})`, undefined, cmdAuthor)
              }
              break
            }

            case 'destroy_render_target': {
              const name = cmd.name as string
              if (!name) { pushTerminal('destroy_render_target', '', 'ERROR: name required'); break }
              renderer.destroyRenderTarget(name)
              pushTerminal('destroy_render_target', name, 'destroyed', undefined, cmdAuthor)
              break
            }

            case 'add_timer': {
              const timerId = cmd.id as string || cmd.timerId as string
              const hookId = cmd.hookId as string
              const delay = cmd.delay as number
              if (!timerId || !hookId || !delay) { pushTerminal('add_timer', undefined, 'ERROR: id, hookId, and delay required'); break }
              sim.addTimer(timerId, hookId, delay, !!(cmd.repeat))
              if (!sim.running) { sim.running = true; setRunning(true) }
              pushTerminal('add_timer', undefined, `"${timerId}" → hook "${hookId}" after ${delay}s${cmd.repeat ? ' (repeat)' : ''}`)
              break
            }

            case 'remove_timer': {
              const timerId = cmd.id as string || cmd.timerId as string
              if (!timerId) { pushTerminal('remove_timer', undefined, 'ERROR: id required'); break }
              sim.removeTimer(timerId)
              pushTerminal('remove_timer', undefined, `"${timerId}" removed`)
              break
            }

            case 'fire_event': {
              const eventName = cmd.event as string || cmd.name as string
              if (!eventName) { pushTerminal('fire_event', undefined, 'ERROR: event/name required'); break }
              sim.fireEvent(eventName, cmd.data as Record<string, unknown> | undefined)
              pushTerminal('fire_event', undefined, `"${eventName}"`)
              break
            }

            case 'add_collision_callback': {
              const cbId = cmd.id as string
              if (!cbId) { pushTerminal('add_collision_callback', undefined, 'ERROR: id required'); break }
              sim.addCollisionCallback({
                id: cbId,
                matchA: (cmd.matchA as { fieldId?: string; tag?: string }) || {},
                matchB: (cmd.matchB as { fieldId?: string; tag?: string }) || {},
                onEnter: cmd.onEnter as string | undefined,
                onExit: cmd.onExit as string | undefined,
                onStay: cmd.onStay as string | undefined,
              })
              if (!sim.running) { sim.running = true; setRunning(true) }
              pushTerminal('add_collision_callback', undefined, `"${cbId}" registered`)
              break
            }

            case 'remove_collision_callback': {
              const cbId = cmd.id as string
              if (!cbId) { pushTerminal('remove_collision_callback', undefined, 'ERROR: id required'); break }
              sim.removeCollisionCallback(cbId)
              pushTerminal('remove_collision_callback', undefined, `"${cbId}" removed`)
              break
            }

            case 'tween': {
              const tweenId = cmd.id as string || `tween_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
              const fieldId = cmd.fieldId as string
              const property = cmd.property as string
              const to = cmd.to as number
              const duration = cmd.duration as number
              if (!fieldId || !property || to === undefined || !duration) {
                pushTerminal('tween', cmd.fieldId, 'ERROR: fieldId, property, to, and duration required')
                break
              }
              sim.addTween(tweenId, fieldId, property, to, duration, (cmd.easing as 'linear' | 'easeIn' | 'easeOut' | 'easeInOut') || 'linear', cmd.onComplete as string | undefined)
              if (!sim.running) { sim.running = true; setRunning(true) }
              pushTerminal('tween', fieldId, `${property} → ${to} over ${duration}s (${cmd.easing || 'linear'})`)
              break
            }

            case 'cancel_tween': {
              const tweenId = cmd.id as string
              if (!tweenId) { pushTerminal('cancel_tween', undefined, 'ERROR: id required'); break }
              sim.cancelTween(tweenId)
              pushTerminal('cancel_tween', undefined, `"${tweenId}" cancelled`)
              break
            }

            case 'status':
              pushTerminal('status', undefined, `fields=${sim.fields.size} running=${sim.running} effects=${sim.getFieldsWithEffects().length} rules=${sim.interactionRules.length} projectiles=${sim.projectiles.length} mods=${wgslModsRef.current.size} tweens=${sim.tweens.size} timers=${sim.timers.size} gameState=${sim.gameState || 'none'}`)
              break
          }
}
