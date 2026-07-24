// rig proofs — proper always
import { growDemonRig, poseJoints, rigTable, sdRigDemon, detail3, emitRigWGSL, ik2 } from './grow-rig.mjs'
let fails = 0
const ok = (c, m) => { console.log((c ? 'PASS' : 'FAIL') + '  ' + m); if (!c) fails++ }
const P = growDemonRig({ seed: 5 })
const len = (a, b) => Math.hypot(a[0]-b[0], a[1]-b[1], a[2]-b[2])

// R1: IK preserves segment lengths across the whole idle cycle
{
  let worst = 0
  for (let t = 0; t < 8; t += 0.13) {
    const J = poseJoints(P, t, 0.7)
    for (const s of ['L', 'R']) {
      const lj = 1 + P.jitters['leg' + s], aj = 1 + P.jitters['arm' + s]
      worst = Math.max(worst,
        Math.abs(len(J['hipSock' + s], J['knee' + s]) - P.thighL * lj),
        Math.abs(len(J['knee' + s], J['hock' + s]) - P.shankL * lj),
        Math.abs(len(J['sh' + s], J['elbow' + s]) - P.upperL * aj),
        Math.abs(len(J['elbow' + s], J['hand' + s]) - P.foreL * aj))
    }
  }
  ok(worst < 1e-9, `R1 IK segment lengths exact over the cycle (worst ${worst.toExponential(1)})`)
}
// R2: no teleports — joints move smoothly (bounded velocity)
{
  let worst = 0
  for (let t = 0; t < 8; t += 0.05) {
    const A = poseJoints(P, t, 0.7), B = poseJoints(P, t + 0.016, 0.7)
    for (const k of Object.keys(A)) worst = Math.max(worst, len(A[k], B[k]) / 0.016)
  }
  ok(worst < 3.0, `R2 max joint speed ${worst.toFixed(2)} u/s (< 3 — no teleports)`)
}
// R3: feet stay planted (the rig's core claim)
{
  let worst = 0
  for (let t = 0; t < 8; t += 0.11) {
    const J = poseJoints(P, t, 1.3)
    for (const s of ['L', 'R']) worst = Math.max(worst, Math.abs(J['foot' + s][1]), len(J['foot' + s], poseJoints(P, 0, 1.3)['foot' + s]))
  }
  ok(worst < 1e-9, `R3 feet planted through the whole idle (drift ${worst.toExponential(1)})`)
}
// R4: displacement bounded (marcher safety)
{
  let worst = 0
  for (let i = 0; i < 5000; i++) worst = Math.max(worst, Math.abs(detail3([i * 0.37, i * 0.11, i * 0.71], P.detailFreq, P.detailAmp)))
  ok(worst <= P.detailAmp + 1e-9, `R4 |detail| <= amp (${worst.toFixed(4)} <= ${P.detailAmp.toFixed(4)})`)
}
// R5: every rig table joint name exists in the pose
{
  const J = poseJoints(P, 1, 0)
  const missing = rigTable(P).flatMap(e => [e.a, e.b, e.ctl].filter(n => n && !J[n]))
  ok(missing.length === 0, `R5 table joints all posed${missing.length ? ' missing: ' + missing[0] : ''}`)
}
// R6: emitted WGSL sane + every joint the table references is declared
{
  const src = emitRigWGSL(P, 'mod_vf3_demon2', { strut: 'mod_vf3_strut', bez: 'mod_vf3_bez', smin: 'opSmoothUnion' })
  const open = (src.match(/\{/g) || []).length, close = (src.match(/\}/g) || []).length
  ok(open === close, `R6a braces ${open}/${close}`)
  const missing = rigTable(P).flatMap(e => [e.a, e.b, e.ctl].filter(n => n && !new RegExp(`(let|var) j_${n}[ =]`).test(src)))
  ok(missing.length === 0, `R6b all referenced joints declared in WGSL${missing.length ? ' missing: ' + missing[0] : ''}`)
  ok(!/NaN|undefined/.test(src), 'R6c no bad tokens')
}
// R7: different seeds -> different beasts; same seed -> same beast
{
  const a = JSON.stringify(growDemonRig({ seed: 5 }).jitters)
  ok(a === JSON.stringify(growDemonRig({ seed: 5 }).jitters), 'R7a deterministic')
  ok(a !== JSON.stringify(growDemonRig({ seed: 6 }).jitters), 'R7b seeds differ')
}
console.log(fails ? fails + ' FAILURES' : 'ALL PASS')
process.exit(fails ? 1 : 0)
