import { describe, it, expect } from 'vitest'
import { dispatchBridgeCommand, BRIDGE_HANDLERS } from '@/app/api/engine/bridge-dispatch'
import { COMMAND_REGISTRY } from '@/lib/command-registry'
import type { BridgeAuth } from '@/app/api/engine/bridge-auth'

// The registry-keyed dispatch table (item 4/#7): unmigrated verbs fall through
// (null), migrated ones are scope-checked against the ONE registry before their
// handler runs.

const noSpace: BridgeAuth = { authorized: true, spaceId: null, ownerId: null, playerId: 'u1' }

describe('bridge dispatch', () => {
  it('unmigrated verbs return null → legacy chain handles them', async () => {
    expect(await dispatchBridgeCommand({ cmd: { type: 'create_field' }, auth: noSpace })).toBeNull()
    expect(await dispatchBridgeCommand({ cmd: { type: 'no_such_verb' }, auth: noSpace })).toBeNull()
  })

  it('every migrated verb exists in the registry (dispatch is registry-keyed)', () => {
    for (const verb of Object.keys(BRIDGE_HANDLERS)) {
      expect(COMMAND_REGISTRY[verb], `${verb} missing from the registry`).toBeTruthy()
    }
  })

  it('a space-scoped verb without a world token is refused at the table, not in the handler', async () => {
    const r = await dispatchBridgeCommand({ cmd: { type: 'build_status' }, auth: noSpace })
    expect(r).toBeTruthy()
    expect(String(r!.error)).toContain('needs a world token')
  })
})
