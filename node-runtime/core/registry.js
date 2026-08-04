// node-runtime · core/registry.js
// The registry IS the work graph. Every part of the engine — core, render,
// audio, playback, tournament, provenance — is one node record here. The runtime
// reads this to schedule; the page reads this to draw the graph of itself.
// Spec: node-runtime v1.2 §1 (record), §2 (verbs), §5 (claim/scratch/bump).

const NOW = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export class Registry {
  constructor() { this.nodes = new Map(); this.violations = []; }

  // register / update a node. validates uniform-range exclusivity. CAS on rev.
  register(rec) {
    const id = rec.id;
    if (!id) throw new Error('node needs an id');
    const prev = this.nodes.get(id);
    // ownership exclusivity: no other node may claim my uniform ranges (§1 MUST)
    const mine = (rec.owns && rec.owns.uni) || [];
    for (const [oid, o] of this.nodes) {
      if (oid === id) continue;
      const theirs = (o.owns && o.owns.uni) || [];
      for (const a of mine) for (const b of theirs)
        if (a[0] <= b[1] && b[0] <= a[1])
          throw new Error(`range [${a}] of ${id} overlaps ${oid} [${b}]`);
    }
    const node = Object.assign({
      kind: 'system', order: 100, owns: { uni: [], vf: [], fields: [], geo: [] },
      holder: null, scratch: null, rev: (prev ? prev.rev : 0),
      status: 'stub', title: id, detail: '', run: null,
    }, prev || {}, rec);
    this.nodes.set(id, node);
    return node;
  }

  get(id) { return this.nodes.get(id); }
  all() { return [...this.nodes.values()]; }
  // §3 scheduler view — stable sort by order, tiebreak id.
  ordered() {
    return this.all().filter(n => n.status === 'live' && typeof n.run === 'function')
      .sort((a, b) => (a.order - b.order) || (a.id < b.id ? -1 : 1));
  }
  freeRanges(max = 256) {
    const used = new Array(max).fill(false);
    for (const n of this.all()) for (const [a, b] of (n.owns.uni || []))
      for (let i = a; i <= b && i < max; i++) used[i] = true;
    const free = []; let s = -1;
    for (let i = 0; i < max; i++) {
      if (!used[i] && s < 0) s = i;
      else if (used[i] && s >= 0) { free.push([s, i - 1]); s = -1; }
    }
    if (s >= 0) free.push([s, max - 1]);
    return free;
  }

  // ---- §5: claim is a tenancy that renews on activity ----
  claim(id, who, ttl = 60_000) {
    const n = this.get(id); if (!n) throw new Error('no node ' + id);
    if (n.holder && n.holder.who !== who && (NOW() - n.holder.lastActive) < n.holder.ttl)
      throw new Error(`held by ${n.holder.who}`);
    n.holder = { who, lastActive: NOW(), ttl };
    return n;
  }
  touch(id) { const n = this.get(id); if (n && n.holder) n.holder.lastActive = NOW(); }
  // bump: take an IDLE claim; the scratch transfers with it (§5 MUST no orphaned work).
  bump(id, who) {
    const n = this.get(id); if (!n || !n.holder) throw new Error('nothing to bump');
    if ((NOW() - n.holder.lastActive) < n.holder.ttl) throw new Error('holder still active');
    const inheritedScratch = n.scratch;              // hands over, never drops
    n.holder = { who, lastActive: NOW(), ttl: n.holder.ttl };
    return { claimed: n, scratch: inheritedScratch };
  }
  writeScratch(id, draft) { const n = this.get(id); if (n) { n.scratch = draft; this.touch(id); } }
  // promote: scratch -> real. the ONLY verb that changes what runs. bumps rev (CAS point).
  promote(id) {
    const n = this.get(id); if (!n || !n.scratch) return n;
    if (n.scratch.run) n.run = n.scratch.run;
    if (n.scratch.order != null) n.order = n.scratch.order;
    n.status = 'live'; n.scratch = null; n.rev++;
    return n;
  }
  wipeScratch(id) { const n = this.get(id); if (n) n.scratch = null; }
}
