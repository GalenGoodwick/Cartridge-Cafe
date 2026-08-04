// node-runtime · core/state.js
// The owned whiteboard — one Float32Array (the veilfire gpuUniforms, made safe).
// Each node writes only its declared ranges. Out-of-range writes are logged
// (advisory) or dropped (strict). Spec §4. This is what makes the weapons clobber
// structurally impossible: the base cannot write u69–79 no matter when it runs.

export class State {
  constructor(size = 256, mode = 'advisory') {
    this.U = new Float32Array(size);
    this.mode = mode;            // 'advisory' | 'strict'
    this.violations = [];        // {node, index, frame}
    this.frame = 0;
  }
  // bind a guarded writer for the node currently running.
  bind(node) {
    const owns = (node.owns && node.owns.uni) || [];
    const inRange = (i) => { for (const [a, b] of owns) if (i >= a && i <= b) return true; return false; };
    const self = this;
    return {
      get: (i) => self.U[i],
      set: (i, v) => {
        if (inRange(i)) { self.U[i] = v; return true; }
        self.violations.push({ node: node.id, index: i, frame: self.frame });
        if (self.mode === 'strict') return false;   // dropped — clobber prevented
        self.U[i] = v; return true;                  // advisory — allowed but recorded
      },
    };
  }
}
