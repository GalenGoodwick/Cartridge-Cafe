# UNIFIED ENGINEERING PLAN — cartridge.cafe build program
**Sep 15 2026 · owner: Galen · executor: the AI · status: ratified designs in hand, sequencing below**

---

## 0. Objective (one sentence)
Make AI-built games **correct on the first shot** by turning every hard-won
lesson into engine-enforced law, then prove the whole stack by shipping
VEILFIRE NEO — a real game a swarm can edit without being able to break it.

---

## 1. Current state (evidence, not memory)

### 1.1 Live in production (verified by read-markers post-deploy)
| Capability | Evidence |
|---|---|
| Phase docks (10-stage tree, creation-earns / edit-jumps, verb whitelists) | `dock_phase` in verb list; 7-test walk green |
| Triage accounting (born ≡ ledger, server-computed gate) | OMEGA: 17/17 accounted, bay clean |
| Gate set: visual-first · node-green · performance (live-tab) · no-live-bugs · triage-complete | OMEGA `complete_build` refused on `performance(unavailable)` — gate proven on its author |
| Owner notes (signed, pinned in every bridge read) | 3 notes live on veilfire-3d during a real incident |
| Relay mode + bridge console + HTML connect + JUST CONNECT + engine button | `/space/connect` serving; smoke-checked |
| base-2d-mobile P1–P5 (pixels≡hitbox, field-owned geometry, hooks see `sim.fields`) | full ladder + fork plays at tick 0 |
| First-pair gift: newcomers only | guard covers all products, active or not |

### 1.2 Proven by walking, with lessons banked
- **OMEGA** — triage end-to-end; found: eye inputStart trap, Map-vs-object sim
  divergence, screen-field containment violation, control-zone seam, hold-to-fire.
- **MARBLE** — wrong-vision autopsy (→ VISION phase), DataCloneError
  (functions never cross the worker boundary), destructive-poll law.
- **Veilfire incident (Sep 15)** — push-pattern cross-cut darkened a live
  world; healed via version history + parity diff; produced the pull-binding
  ruling and Neo itself.

### 1.3 Open defects (the honest list)
| ID | Defect | Severity | Blocker for |
|---|---|---|---|
| D1 | Tab-eye cannot truly see: headless WebGPU absent; canvas-readback probe false-negatives even headed | HIGH | visual gate automation, D2, #13 |
| D2 | OMEGA viewport scope at wide aspect unverified (#13) | MED | OMEGA completion |
| D3 | Dark-world class lacks a structural stamp: `skinned:false` / all-hooks-gated worlds go silently black (#12 tail) | HIGH | TEND phase integrity |
| D4 | `triage` verb internal claim runs under wrong identity (workaround: caller removes, verb records) | LOW | port ergonomics |
| D5 | pages-flow integration tests red (dev-DB env, `$executeRawUnsafe`) | LOW | CI hygiene |

### 1.4 Ratified, not yet built
Pull binding (`uses`) · flow return on bridge writes · TUNE metrics
instrument · MCP self-daemon wiring · omega 2D mechanic bay (#9) · base
matrix cells 2–4 · Neo stages 2–3.

---

## 2. Dependency analysis (why this order and no other)

```
D1 tab-eye sight ──► visual gate automated ──► D2, D3 verifiable
                                        │
Pull binding (engine) ──► Neo stage 1 DONE ──► Neo vertical slice (stage 2)
                                        │              │
Flow return ────────────────────────────┘              ▼
                                            Scrap port (stage 3, room×room)
                                                       │
Omega 2D bay (#9) ◄── grammar proven by slice ────────┘
Base cells 2–4 ◄── replication after bay
```

Rationale: **instruments before gates, gates before architecture,
architecture before content.** Every failure this week traces to inverting
one of those three arrows. The slice proves the grammar before we commit
40 rooms to it; the 2D bay replicates a proven grammar rather than
pioneering a second one in parallel.

---

## 3. Workstreams

### WS0 — STABILIZE (instrument + defect floor) — first, small, unblocking
1. **True sight**: tab-shot judges the *screenshot* (not canvas readback);
   headed-Chrome path is the honest default on this machine; front-door
   click-through hardened. *Exit: OMEGA photographed rendering at both
   aspects, or a true failure isolated.*
2. **D2**: diff OMEGA screen-mapping vs base pattern under true sight; fix; re-gate.
3. **D3**: structural dark stamp — server check fails when any skinned field's
   visual is missing, or a live frame reports sub-threshold luminance;
   stamps `__liveBug` exactly like quarantine. *Closes #12 as a class.*
4. **D4**: thread caller identity through the triage verb's internal claim.
*Exit criteria: OMEGA completes end-to-end through every gate on a real
measurement — the first fully-certified world. Est. 1 session.*

### WS1 — ENGINE CONTRACT (Neo stage 1 completion)
1. **Pull binding**: `uses:[profileIds]` on node records; inert-until-pulled;
   unpulled profile = visible leftover; owns-guard flags reads outside
   declared pulls. Pure lib + unit walk + registry + bridge. 
2. **Flow return**: every bridge write echoes `{phase, frameMs, errors Δ,
   gate-distance}` from existing buffers. No polling anywhere.
3. **TUNE instrument**: playthrough metrics (time-to-first-success,
   deaths/min) emitted by the local runner; bands declared in spec.
*Exit: the methodology is 100% engine-enforced; a hostile builder cannot
bypass any of it. Est. 1–2 sessions.*

### WS2 — NEO VERTICAL SLICE (stage 2)
Born through the docks at VISION. Spine (player/camera/uplink) + **the nave**
as the first room node pulling its profiles; one entity (nave demon), one
event (door), player-start as a fact node. Walk every phase gate honestly,
including TUNE with a human play. *Exit: the slice ships private through all
ten phases; the grammar is proven on real content. Est. 2–3 sessions.*

### WS3 — THE PORT (stage 3)
Scrap bay loaded from the 496KB dump (`scrap-*`, role-labeled). Room-by-room
rewrite: crypt, warren, tomb, arena, city, time-cells; entities and events
as their rooms arrive. Interpretation licensed — vision doc is the arbiter
of spirit. Owner notes carry standing guidance to any co-builders; claims +
teeth make collisions impossible. *Exit: zero scrap · all nodes green · full
ladder · live measurement · Galen's word. Neo ships beside classic.*

### WS4 — PARALLEL / AFTER (explicitly deferred, not forgotten)
Omega 2D mechanic bay (#9, replicates Neo grammar) → base matrix cells 2–4 →
MCP self-daemon publish ritual → cleanup (p5-* scrap worlds, MARBLE
disposition) → D5 CI hygiene.

---

## 4. Risk register
| Risk | Likelihood | Mitigation |
|---|---|---|
| Instrument blindness masks a regression again | MED | WS0 first; "no green without a real screen" is now a required check, not discipline |
| Swarm co-edit during port breaks Neo | LOW | granularity + claims + P4 + owner notes; blast radius = 1 node by grammar |
| Granular node count hurts frame budget | MED | per-node `__budget.hooks` attribution exists; perf gate is required; profiles are data, not per-tick cost |
| Interpretation drift (port loses veilfire's soul) | MED | VISION phase gate + Galen plays the slice before the port scales |
| Scope creep (new ideas mid-port) | HIGH (observed) | new ideas land as tasks/designs, not mid-stream builds; the phase dock we're in is the phase dock we finish |

## 5. Operating rules (standing, from this week's law)
One push per ship-word · deploy polls are reads · every visible change passes
the visual gate before being shown · incidents produce laws-as-code, not
resolutions · the task list is the single board; this plan is its map.
