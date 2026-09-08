import { it as vit, expect } from 'vitest'

// Gated: only runs when SEED_FIXTURE=1 (it creates a DB world), so the normal
// suite skips it. Seed/refresh the input regression world with:
//   SEED_FIXTURE=1 npx vitest run src/__tests__/fixtures/input-fixture.seed.test.ts
// then drive it headless with scripts/verify-input-fixture.mjs.
const it = vit.skipIf(!process.env.SEED_FIXTURE)
import { writeFileSync } from 'node:fs'
import { prisma } from '@/lib/prisma'
import { birthWorld } from '@/lib/world-create'
import { applyCommandToSnapshot } from '@/app/api/engine/space-store'

// One-off harness (NOT a permanent suite test — deleted after the fixture is
// seeded). Creates an isolated local world with two flipper fields, a ball, and a
// step hook that (1) counts input.pressed edges and (2) actuates the flippers from
// input.held — so the headless driver can prove a between-tick tap reaches a WORKER
// hook. Writes {slug, token, spaceId} to the scratchpad for the Playwright step.

const OUT = '/private/tmp/claude-501/-Users-galengoodwick/c2b6d436-7855-4b2a-9cfc-cd2b94e9d7c8/scratchpad/tap-fixture.json'

const HOOK = `
const wd = sim.worldData;
const inp = wd.input || {};
const p = inp.pressed || {};
const h = inp.held || {};
if (!wd.__tf) wd.__tf = { left:0, right:0, space:0, la:0, ra:0 };
const S = wd.__tf;
if (p.left) S.left++;
if (p.right) S.right++;
if (p.space) S.space++;
// flippers snap up while held, ease back down — a visible actuation
S.la = h.left ? 0.7 : Math.max(0, S.la - dt*6);
S.ra = h.right ? -0.7 : Math.min(0, S.ra + dt*6);
const lf = sim.fields.get('leftFlipper'); if (lf) lf.transform.rotation = S.la;
const rf = sim.fields.get('rightFlipper'); if (rf) rf.transform.rotation = S.ra;
// mirror counts to flat wd keys the driver reads via window.__ccDevSim
wd.leftTaps = S.left; wd.rightTaps = S.right; wd.spaceTaps = S.space;
wd.leftAngle = S.la; wd.rightAngle = S.ra;
wd.hud = [{ id:'c', type:'text', x:'16px', y:'16px', text:'L '+S.left+'  R '+S.right+'  SP '+S.space, fontSize:'22px', color:'#ffdba8' }];
`.trim()

it('seed the tap-fixture world', async () => {
  const user = await prisma.user.findFirst({ select: { id: true } })
  expect(user, 'need a user in the dev DB to own the fixture').toBeTruthy()
  const baseSlug = 'tap-fixture-' + Math.abs(Date.now() % 100000)
  const { space, token } = await birthWorld({
    ownerId: user!.id, name: 'Tap Fixture ' + baseSlug, baseSlug, isPublic: true,
    worldParams: { gridSize: 576 },
  })
  const cmds: Record<string, unknown>[] = [
    { type: 'create_field', fieldId: 'leftFlipper', name: 'leftFlipper', shape: 'rect', width: 90, height: 18, x: 210, y: 470, color: [1, 0.5, 0.1, 1], visualType: 'solid' },
    { type: 'create_field', fieldId: 'rightFlipper', name: 'rightFlipper', shape: 'rect', width: 90, height: 18, x: 366, y: 470, color: [1, 0.5, 0.1, 1], visualType: 'solid' },
    { type: 'create_field', fieldId: 'ball', name: 'ball', shape: 'circle', radius: 14, x: 288, y: 120, color: [1, 1, 1, 1], visualType: 'circle' },
    { type: 'add_step_hook', hookId: 'tapcount', author: 'fixture', description: 'count input.pressed + actuate flippers', code: HOOK },
  ]
  for (const c of cmds) {
    const r = await applyCommandToSnapshot(space.id, c)
    expect((r as { ok?: boolean; error?: string }).error, `cmd ${c.type} ${(c as {fieldId?:string}).fieldId ?? ''}`).toBeFalsy()
  }
  writeFileSync(OUT, JSON.stringify({ slug: space.slug, token, spaceId: space.id }, null, 2))
  console.log('SEEDED', space.slug, '→', OUT)
}, 90000)
