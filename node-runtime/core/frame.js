// node-runtime · core/frame.js
// The frame carries an OWNER buffer alongside color — every pixel remembers which
// node drew it. That is what makes provenance (§9) real instead of a region guess:
// render throws the owner away the instant it writes a color; we refuse to.
// (2D seed. render.3d will carry the nearest-SDF-hit node the same way.)

export class Frame {
  constructor(W, H) {
    this.W = W; this.H = H;
    this.col = new Uint8ClampedArray(W * H * 4);
    this.owner = new Int16Array(W * H).fill(-1);   // node index per pixel; -1 = untouched
    this._img = null;
  }
  clear(r, g, b, ownerIdx = -1) {
    for (let i = 0, p = 0; i < this.W * this.H; i++, p += 4) {
      this.col[p] = r; this.col[p + 1] = g; this.col[p + 2] = b; this.col[p + 3] = 255;
      this.owner[i] = ownerIdx;
    }
  }
  // a node's draw context: color overwrites, OWNER is stamped (SUPERIMPOSITION.md:
  // "color overwrites, alpha accumulates" — here owner tracks the winner).
  painter(ownerIdx) {
    const W = this.W, H = this.H, col = this.col, own = this.owner;
    function px(x, y, r, g, b, a = 1) {
      x |= 0; y |= 0; if (x < 0 || y < 0 || x >= W || y >= H) return;
      const i = y * W + x, p = i * 4;
      col[p] = col[p] * (1 - a) + r * a; col[p + 1] = col[p + 1] * (1 - a) + g * a;
      col[p + 2] = col[p + 2] * (1 - a) + b * a; col[p + 3] = 255;
      if (a > 0.5) own[i] = ownerIdx;
    }
    return {
      px,
      rect(x, y, w, h, r, g, b, a = 1) { for (let j = 0; j < h; j++) for (let k = 0; k < w; k++) px(x + k, y + j, r, g, b, a); },
      disc(cx, cy, rad, r, g, b, a = 1) {
        for (let j = -rad; j <= rad; j++) for (let k = -rad; k <= rad; k++)
          if (k * k + j * j <= rad * rad) px(cx + k, cy + j, r, g, b, a);
      },
    };
  }
  blit(ctx) {
    if (!this._img) this._img = ctx.createImageData(this.W, this.H);
    this._img.data.set(this.col);
    ctx.putImageData(this._img, 0, 0);
  }
}
