// House-world summon: broadcastSummon must honor the /hub view door and the
// no-push option (communal summons that shouldn't wake every companion owner).
// Runs against the dev DB (needs DATABASE_URL).
import { describe, it, expect, afterAll } from 'vitest'
import { broadcastSummon, closeSummon, readSummons } from '@/app/api/engine/regions-store'

const SCENE = 'itest-house-' + Math.floor(Math.random() * 1e6)
const ORIGIN = 'http://localhost:9999'

describe.sequential('house-world summon', () => {
  afterAll(async () => { await closeSummon(SCENE).catch(() => {}) })

  it('opens a muster keyed by the scene name, pointing at /hub/<scene>', async () => {
    const out = await broadcastSummon({
      world: SCENE, spaceId: null, name: SCENE,
      brief: 'build a lantern', from: 'itest keeper', origin: ORIGIN,
      viewUrl: ORIGIN + '/hub/' + encodeURIComponent(SCENE),
      noPush: true,
    })
    expect(out.muster.world).toBe(SCENE)
    expect(out.muster.viewUrl).toBe(ORIGIN + '/hub/' + SCENE)
    // noPush → no companion owners woken
    expect(out.woke).toBe(0)
    // discoverable by any polling AI via the shared summons feed
    const open = await readSummons()
    expect(open.some((m) => m.world === SCENE)).toBe(true)
  })

  it('closeSummon stands the muster down', async () => {
    await closeSummon(SCENE)
    const open = await readSummons()
    expect(open.some((m) => m.world === SCENE)).toBe(false)
  })
})
