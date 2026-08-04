// node-runtime · core/scheduler.js
// Runs the live nodes in DECLARED order (not push order) — the fix for the bug
// that started all this. Each node runs in its own try/catch with per-node error
// attribution (§3 MUST). Re-registering a node can never move it: order is data.

export class Scheduler {
  constructor(registry, state) { this.reg = registry; this.state = state; this.errors = []; this.timings = {}; }

  tick(ctx) {
    this.errors = [];
    this.state.frame = (this.state.frame || 0) + 1;
    const nodes = this.reg.ordered();               // sorted by node.order, stable
    for (const node of nodes) {
      const t0 = performance.now();
      try {
        const u = this.state.bind(node);            // guarded whiteboard writer (§4)
        node.run({ u, U: this.state.U, ...ctx, node });
        if (node.holder) node.holder.lastActive = performance.now();  // activity renews claim (§5)
      } catch (e) {
        this.errors.push({ node: node.id, error: String(e && e.message || e) });
      }
      this.timings[node.id] = performance.now() - t0;
    }
    return { errors: this.errors, ran: nodes.map(n => n.id) };
  }
}
